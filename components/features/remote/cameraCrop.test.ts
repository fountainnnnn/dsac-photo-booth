import { describe, expect, it } from 'vitest';
import { clampMove, clampSize } from './CameraCropCard';
import { FULL_FRAME } from './useCaptureSettings';

/**
 * The crop is stored as fractions of the frame's own width and height, so a
 * region that keeps the camera's 16:9 shape has w and h numerically *equal* —
 * the aspect is already baked into the coordinate space. It reads like a bug,
 * which is exactly why it is worth pinning: a "fix" that divides h by 16/9
 * would silently squash every cropped photo.
 */

const aspectOf = (c: { w: number; h: number }, vw = 1920, vh = 1080) =>
  (c.w * vw) / (c.h * vh);

describe('camera crop', () => {
  it('keeps the camera aspect when resized', () => {
    for (const dx of [-0.6, -0.25, -0.05, 0.1, 0.4]) {
      const next = clampSize({ x: 0.1, y: 0.1, w: 0.6, h: 0.6 }, dx);
      expect(aspectOf(next)).toBeCloseTo(16 / 9, 6);
    }
  });

  it('never resizes past the edges or below the minimum', () => {
    expect(clampSize({ x: 0.7, y: 0.1, w: 0.3, h: 0.3 }, 5).w).toBeCloseTo(0.3, 6);
    expect(clampSize({ x: 0, y: 0, w: 0.5, h: 0.5 }, -5).w).toBeCloseTo(0.2, 6);
    expect(clampSize(FULL_FRAME, 5).w).toBeCloseTo(1, 6);
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
});
