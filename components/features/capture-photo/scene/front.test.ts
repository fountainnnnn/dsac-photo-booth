import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LINE_M, HOLD_MS, faceDistance, frontFaces, holdGroup, nearestDistance,
} from './front';
import { keepPeopleWith } from './segmentation';
import type { FacePoints } from './faces';

/** A face `w` wide and `h` tall, nose at (cx, cy). */
function box(cx: number, cy: number, w: number, h: number): FacePoints {
  return [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx, y: cy }, { x: cx + w / 2, y: cy + h / 2 }];
}

/** Height of a face 1 m away, worked back from `faceDistance` itself. */
const H_AT_1M = 0.1 * faceDistance(box(0.5, 0.5, 0.05, 0.1));

/** A face `metres` from the camera, nose at (cx, cy). */
function at(cx: number, cy: number, metres: number): FacePoints {
  const h = H_AT_1M / metres;
  return box(cx, cy, h * 0.75, h);
}

/** The same face turned to one side: as tall, but much narrower. */
function turnedAt(cx: number, cy: number, metres: number): FacePoints {
  const h = H_AT_1M / metres;
  return box(cx, cy, h * 0.3, h);
}

describe('faceDistance', () => {
  it('halves when the face doubles', () => {
    expect(faceDistance(box(0.5, 0.5, 0.1, 0.2))).toBeCloseTo(faceDistance(box(0.5, 0.5, 0.05, 0.1)) / 2);
  });

  it('is a plausible distance for a face filling a fifth of a webcam picture', () => {
    const d = faceDistance(box(0.5, 0.5, 0.1, 0.2));
    expect(d).toBeGreaterThan(0.6);
    expect(d).toBeLessThan(1.6);
  });

  it('finds the nearest of several, or none', () => {
    expect(nearestDistance([at(0.3, 0.4, 2.5), at(0.6, 0.4, 1.2)])).toBeCloseTo(1.2);
    expect(nearestDistance([])).toBeNull();
  });
});

describe('frontFaces', () => {
  it('keeps everyone nearer than the line, however many', () => {
    const group = [at(0.2, 0.4, 1), at(0.4, 0.4, 1.3), at(0.6, 0.42, 1.6), at(0.8, 0.4, 1.9)];
    expect(frontFaces(group, [], 2)).toEqual(group);
  });

  it('leaves out a queue beyond the line', () => {
    const front = [at(0.4, 0.45, 1), at(0.55, 0.45, 1.1)];
    const queue = [at(0.2, 0.3, 3), at(0.8, 0.28, 3.5)];
    expect(frontFaces([...front, ...queue], [], 2)).toEqual(front);
  });

  it('leaves out someone beyond the line even when nobody is nearer', () => {
    expect(frontFaces([at(0.5, 0.4, 3)], [], 2)).toEqual([]);
  });

  it('keeps a guest who leans back for a moment, but does not let a stranger join that way', () => {
    const near = at(0.4, 0.4, 1);
    const justPast = at(0.6, 0.4, 2.1);
    expect(frontFaces([near, justPast], [], 2)).toEqual([near]);
    expect(frontFaces([near, justPast], [near, justPast], 2)).toEqual([near, justPast]);
  });

  it('keeps a guest beside the front one who has turned to them', () => {
    const me = at(0.4, 0.4, 0.9);
    const friend = turnedAt(0.6, 0.4, 1.1);
    expect(frontFaces([me, friend], [], 1.5)).toEqual([me, friend]);
  });

  it('moves with the line', () => {
    const near = at(0.4, 0.4, 1);
    const back = at(0.6, 0.4, 1.8);
    expect(frontFaces([near, back], [], 1.5)).toEqual([near]);
    expect(frontFaces([near, back], [], DEFAULT_LINE_M)).toEqual([near, back]);
  });
});

describe('holdGroup', () => {
  const me = at(0.4, 0.4, 1);
  const friend = at(0.6, 0.4, 1.1);

  it('keeps someone whose face was missed for a moment, then lets them go', () => {
    const before = holdGroup([me, friend], [], 0);
    const missed = holdGroup([me], before, HOLD_MS / 2);
    expect(missed.map(m => m.face)).toEqual([me, friend]);
    expect(holdGroup([me], missed, HOLD_MS + 1).map(m => m.face)).toEqual([me]);
  });

  it('takes a face found again at its new place, once', () => {
    const before = holdGroup([me, friend], [], 0);
    const moved = at(0.62, 0.41, 1.1);
    const now = holdGroup([me, moved], before, 100);
    expect(now.map(m => m.face)).toEqual([me, moved]);
  });
});

describe('keepPeopleWith', () => {
  /** A 10x4 mask with two separate shapes: columns 1-3 and 6-8. */
  const w = 10;
  const h = 4;
  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (const x of [1, 2, 3, 6, 7, 8]) mask[y * w + x] = 0.9;
  }

  it('keeps the shape holding a front face and drops the other', () => {
    const out = keepPeopleWith(mask, w, h, [{ x0: 0.15, y0: 0, x1: 0.25, y1: 0.25 }]);
    expect(out[1 * w + 2]).toBeCloseTo(0.9);
    expect(out[1 * w + 7]).toBe(0);
  });

  it('keeps everyone when no faces are known', () => {
    expect(keepPeopleWith(mask, w, h, [])).toBe(mask);
  });
});
