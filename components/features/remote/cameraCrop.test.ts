import { describe, expect, it } from 'vitest';
import { clampCropRect, clampZoom } from './CameraCropCard';
import { FULL_FRAME, unmirrorCrop } from './useCaptureSettings';

/**
 * The crop says where the photo window sits on the camera, in fractions of the
 * camera's own width and height — so a region that keeps the camera's 16:9
 * shape has w and h numerically *equal*, the aspect already baked into the
 * coordinate space. It reads like a bug, which is exactly why it is worth
 * pinning: a "fix" that divides h by 16/9 would silently squash every photo.
 *
 * w may exceed 1: that is the camera sitting inside the photo with white
 * margins, rather than the window keeping part of the camera.
 */

const aspectOf = (c: { w: number; h: number }, vw = 1920, vh = 1080) =>
  (c.w * vw) / (c.h * vh);

/** The smaller rectangle must be contained by the larger, whichever way round. */
const contained = (c: { x: number; y: number; w: number; h: number }) => {
  const lo = Math.min(0, 1 - c.w);
  const hi = Math.max(0, 1 - c.w);
  return c.x >= lo - 1e-9 && c.x <= hi + 1e-9 && c.y >= lo - 1e-9 && c.y <= hi + 1e-9;
};

describe('camera crop', () => {
  it('keeps the camera aspect whatever is asked of it', () => {
    for (const w of [0.1, 0.2, 0.6, 1, 1.5, 2, 3]) {
      const next = clampCropRect({ x: 0.2, y: 0.2, w, h: w });
      expect(aspectOf(next)).toBeCloseTo(16 / 9, 6);
      expect(contained(next)).toBe(true);
    }
  });

  it('clamps zoom to the range: 5x in, half-size out', () => {
    expect(clampCropRect({ x: 0, y: 0, w: 0.01, h: 0.01 }).w).toBeCloseTo(0.2, 6);
    expect(clampCropRect({ x: 0, y: 0, w: 9, h: 9 }).w).toBeCloseTo(2, 6);
  });

  it('keeps the window on the camera when zoomed in', () => {
    const c = clampCropRect({ x: 5, y: -5, w: 0.5, h: 0.5 });
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0, 6);
  });

  it('keeps the camera inside the photo when zoomed out', () => {
    // w = 1.5: the camera is smaller than the window, so x lives in [-0.5, 0].
    expect(clampCropRect({ x: 5, y: 5, w: 1.5, h: 1.5 }).x).toBeCloseTo(0, 6);
    expect(clampCropRect({ x: -5, y: -5, w: 1.5, h: 1.5 }).x).toBeCloseTo(-0.5, 6);
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
      expect(contained(next)).toBe(true);
      expect(next.x).toBeCloseTo(0, 6);
    });

    it('zooms out past the whole scene into margins, still contained', () => {
      const next = clampZoom(FULL_FRAME, 1.6);
      expect(next.w).toBeCloseTo(1.6, 6);
      expect(contained(next)).toBe(true);
      // Symmetric around the same centre: equal margins both sides.
      expect(next.x).toBeCloseTo(-0.3, 6);
    });

    it('stops at the range ends', () => {
      expect(clampZoom(FULL_FRAME, 0).w).toBeCloseTo(0.2, 6);
      expect(clampZoom(FULL_FRAME, 9).w).toBeCloseTo(2, 6);
    });
  });

  /**
   * The operator lines the shot up on a mirrored preview, so a region on the
   * left of the screen is the right of the room. Sampling the raw camera
   * without flipping it back photographs the opposite side.
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

    it('handles a zoomed-out crop, where x is negative', () => {
      // Camera inside the photo, flush left of it: x = 1 - (-0.5) - 1.5 = 0.
      expect(unmirrorCrop({ x: -0.5, y: 0, w: 1.5, h: 1.5 }).x).toBeCloseTo(0, 6);
    });

    it('is its own inverse', () => {
      for (const c of [
        { x: 0, y: 0, w: 0.3, h: 0.3 },
        { x: 0.7, y: 0.2, w: 0.3, h: 0.3 },
        { x: -0.2, y: -0.1, w: 1.4, h: 1.4 },
      ]) {
        // Close, not exact: 1 - (1 - x - w) - w leaves floating-point residue.
        expect(unmirrorCrop(unmirrorCrop(c)).x).toBeCloseTo(c.x, 12);
      }
    });
  });
});
