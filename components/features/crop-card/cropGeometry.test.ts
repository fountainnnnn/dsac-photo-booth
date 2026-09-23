import { describe, expect, it } from 'vitest';
import {
  clampToImage,
  cropAroundFace,
  cropAroundPoint,
  faceAtPoint,
  moveCrop,
  scaleCrop,
} from './cropGeometry';

const W = 4000;
const H = 2250;
const ASPECT = 1000 / 1400; // the card

const inside = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= -0.001 && r.y >= -0.001 && r.x + r.w <= W + 0.001 && r.y + r.h <= H + 0.001;

describe('clampToImage', () => {
  it('slides a rect back inside rather than shrinking it', () => {
    const r = clampToImage({ x: -50, y: -80, w: 400, h: 600 }, W, H);
    expect(r).toEqual({ x: 0, y: 0, w: 400, h: 600 });
  });

  it('shrinks only what is genuinely larger than the photo', () => {
    const r = clampToImage({ x: 0, y: 0, w: W + 500, h: H + 500 }, W, H);
    expect(r).toEqual({ x: 0, y: 0, w: W, h: H });
  });
});

describe('cropAroundPoint', () => {
  it('centres on the tap and keeps the card aspect', () => {
    const r = cropAroundPoint({ x: 2000, y: 1100 }, W, H, ASPECT);
    expect(r.w / r.h).toBeCloseTo(ASPECT, 5);
    expect(r.x + r.w / 2).toBeCloseTo(2000, 5);
    expect(r.y + r.h / 2).toBeCloseTo(1100, 5);
  });

  it('stays inside the photo for a tap in the corner', () => {
    for (const p of [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }]) {
      const r = cropAroundPoint(p, W, H, ASPECT);
      expect(inside(r)).toBe(true);
      expect(r.w / r.h).toBeCloseTo(ASPECT, 5);
    }
  });
});

describe('cropAroundFace', () => {
  it('leaves more room below the face than above it', () => {
    const face = { x: 1900, y: 900, w: 200, h: 200 };
    const r = cropAroundFace(face, W, H, ASPECT);
    const above = face.y - r.y;
    const below = r.y + r.h - (face.y + face.h);
    expect(below).toBeGreaterThan(above);
  });

  it('keeps the card aspect and stays in bounds near an edge', () => {
    const r = cropAroundFace({ x: 10, y: 10, w: 180, h: 180 }, W, H, ASPECT);
    expect(r.w / r.h).toBeCloseTo(ASPECT, 5);
    expect(inside(r)).toBe(true);
  });
});

describe('faceAtPoint', () => {
  const a = { x: 100, y: 100, w: 200, h: 200 };
  const b = { x: 1000, y: 100, w: 200, h: 200 };

  it('is null when nothing was detected', () => {
    expect(faceAtPoint([], { x: 50, y: 50 })).toBeNull();
  });

  it('prefers the box the tap is inside, not the nearest centre', () => {
    // Just inside a's right edge — b's centre is far, but a tap on a is an a.
    expect(faceAtPoint([a, b], { x: 295, y: 200 })).toBe(a);
  });

  it('takes a tap just outside a box as meaning that box', () => {
    // Fingers are blunt and a face box stops at the chin, so a tap a little
    // below or beside someone still means them.
    expect(faceAtPoint([a, b], { x: 200, y: 360 })).toBe(a);
  });

  it('ignores faces the tap was nowhere near', () => {
    // The regression this guards: detection misses people, and snapping to the
    // nearest face regardless of distance handed those guests a stranger. Null
    // sends the caller back to cropping where they actually tapped.
    expect(faceAtPoint([a, b], { x: 1400, y: 1400 })).toBeNull();
  });
});

describe('moveCrop', () => {
  it('drags, then stops at the edge', () => {
    const start = cropAroundPoint({ x: 2000, y: 1100 }, W, H, ASPECT);
    const moved = moveCrop(start, -99999, 0, W, H);
    expect(moved.x).toBe(0);
    expect(moved.w).toBe(start.w);
  });
});

describe('scaleCrop', () => {
  const start = cropAroundPoint({ x: 2000, y: 1100 }, W, H, ASPECT);

  it('keeps the aspect while zooming', () => {
    expect(scaleCrop(start, 1.4, W, H).w / scaleCrop(start, 1.4, W, H).h)
      .toBeCloseTo(ASPECT, 5);
  });

  it('refuses to shrink past a face-sized crop', () => {
    const tiny = scaleCrop(start, 0.001, W, H);
    expect(tiny.h).toBeCloseTo(Math.min(W, H) * 0.12, 5);
  });

  it('refuses to grow past the photo', () => {
    const huge = scaleCrop(start, 1000, W, H);
    expect(inside(huge)).toBe(true);
    expect(huge.w / huge.h).toBeCloseTo(ASPECT, 5);
  });
});
