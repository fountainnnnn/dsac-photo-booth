import { describe, expect, it } from 'vitest';
import { clampMove, clampSize, clampZoom, type Corner } from './CameraCropCard';
import { FULL_FRAME, unmirrorCrop } from './useCaptureSettings';

/**
 * The crop is stored as fractions of the frame's own width and height, so a
 * region that keeps the camera's 16:9 shape has w and h numerically *equal* —
 * the aspect is already baked into the coordinate space. It reads like a bug,
 * which is exactly why it is worth pinning: a "fix" that divides h by 16/9
 * would silently squash every cropped photo.
 */

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const aspectOf = (c: { w: number; h: number }, vw = 1920, vh = 1080) =>
  (c.w * vw) / (c.h * vh);
const inBounds = (c: { x: number; y: number; w: number; h: number }) =>
  c.x >= -1e-9 && c.y >= -1e-9 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9;

describe('camera crop', () => {
  it('keeps the camera aspect however it is resized', () => {
    for (const corner of CORNERS) {
      for (const d of [-0.6, -0.25, -0.05, 0.1, 0.4, 5]) {
        const next = clampSize({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, d, corner);
        expect(aspectOf(next)).toBeCloseTo(16 / 9, 6);
        expect(inBounds(next)).toBe(true);
      }
    }
  });

  it('holds the opposite corner still while resizing', () => {
    const from = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    // A small shrink, so no clamp interferes with the anchor.
    expect(clampSize(from, -0.1, 'br')).toMatchObject({ x: 0.2, y: 0.2 });

    const bl = clampSize(from, -0.1, 'bl');
    expect(bl.x + bl.w).toBeCloseTo(0.7, 6);   // right edge pinned
    expect(bl.y).toBeCloseTo(0.2, 6);          // top pinned

    const tr = clampSize(from, -0.1, 'tr');
    expect(tr.x).toBeCloseTo(0.2, 6);          // left pinned
    expect(tr.y + tr.h).toBeCloseTo(0.7, 6);   // bottom pinned

    const tl = clampSize(from, -0.1, 'tl');
    expect(tl.x + tl.w).toBeCloseTo(0.7, 6);
    expect(tl.y + tl.h).toBeCloseTo(0.7, 6);
  });

  it('never resizes past the edges or below the minimum', () => {
    expect(clampSize({ x: 0.7, y: 0.1, w: 0.3, h: 0.3 }, 5, 'br').w).toBeCloseTo(0.3, 6);
    expect(clampSize({ x: 0, y: 0, w: 0.5, h: 0.5 }, -5, 'br').w).toBeCloseTo(0.2, 6);
    expect(clampSize(FULL_FRAME, 5, 'br').w).toBeCloseTo(1, 6);
  });

  it('keeps the region inside the picture when moved', () => {
    const from = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(clampMove(from, -9, -9)).toMatchObject({ x: 0, y: 0 });
    const far = clampMove(from, 9, 9);
    expect(far.x).toBeCloseTo(0.5, 6);
    expect(far.y).toBeCloseTo(0.5, 6);
    expect(aspectOf(far)).toBeCloseTo(16 / 9, 6);
  });

  it('leaves the whole frame at the camera aspect', () => {
    expect(aspectOf(FULL_FRAME)).toBeCloseTo(16 / 9, 6);
  });

  describe('zoom', () => {
    it('keeps the centre still, so the shot stays pointed where it was', () => {
      // Centred on 0.4, so anything up to 0.8 wide still fits either side.
      const from = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
      for (const w of [0.25, 0.35, 0.6, 0.8]) {
        const next = clampZoom(from, w);
        expect(next.x + next.w / 2).toBeCloseTo(0.4, 6);
        expect(next.y + next.h / 2).toBeCloseTo(0.4, 6);
        expect(aspectOf(next)).toBeCloseTo(16 / 9, 6);
      }
    });

    it('gives up the centre rather than the edge when it cannot have both', () => {
      // Wider than the room on one side: staying centred would run off the
      // picture, so it slides back in and the centre shifts instead.
      const next = clampZoom({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 0.9);
      expect(next.w).toBeCloseTo(0.9, 6);
      expect(inBounds(next)).toBe(true);
      expect(next.x).toBeCloseTo(0, 6);
    });

    it('stops at the whole picture and at the tightest crop', () => {
      const from = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
      expect(clampZoom(from, 9).w).toBeCloseTo(1, 6);
      expect(clampZoom(from, 0).w).toBeCloseTo(0.2, 6);
    });

    it('never leaves the picture, even zooming out near an edge', () => {
      const corner = { x: 0, y: 0, w: 0.3, h: 0.3 };
      for (const w of [0.4, 0.7, 1]) expect(inBounds(clampZoom(corner, w))).toBe(true);
    });
  });

  /**
   * The operator draws on a mirrored preview, so a box on the left of the
   * screen is the right of the room. Sampling the raw camera without flipping
   * it back photographs the opposite side.
   */
  describe('mirroring', () => {
    it('flips a left-hand region to the right of the raw picture', () => {
      expect(unmirrorCrop({ x: 0, y: 0.1, w: 0.25, h: 0.25 }))
        .toMatchObject({ x: 0.75, y: 0.1, w: 0.25 });
    });

    it('leaves a centred region and the whole frame where they are', () => {
      expect(unmirrorCrop({ x: 0.25, y: 0.3, w: 0.5, h: 0.5 }).x).toBeCloseTo(0.25, 6);
      expect(unmirrorCrop(FULL_FRAME).x).toBeCloseTo(0, 6);
    });

    it('is its own inverse, and never leaves the picture', () => {
      for (const c of [
        { x: 0, y: 0, w: 0.3, h: 0.3 },
        { x: 0.7, y: 0.2, w: 0.3, h: 0.3 },
        { x: 0.4, y: 0, w: 0.2, h: 0.2 },
      ]) {
        expect(inBounds(unmirrorCrop(c))).toBe(true);
        // Close, not exact: 1 - (1 - x - w) - w leaves floating-point residue.
        expect(unmirrorCrop(unmirrorCrop(c)).x).toBeCloseTo(c.x, 12);
      }
    });
  });
});
