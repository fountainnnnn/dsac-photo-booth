import { describe, expect, it } from 'vitest';
import { frontFaces, JOIN_RATIO, STAY_RATIO } from './front';
import { keepPeopleWith } from './segmentation';
import type { FacePoints } from './faces';

/** A face `size` wide, nose at (cx, cy). */
function face(cx: number, cy: number, size: number): FacePoints {
  const h = size / 2;
  return [{ x: cx - h, y: cy }, { x: cx, y: cy }, { x: cx + h, y: cy + h }];
}

describe('frontFaces', () => {
  it('keeps a whole group standing together, however many', () => {
    const group = [face(0.3, 0.4, 0.1), face(0.45, 0.4, 0.095), face(0.6, 0.42, 0.105), face(0.75, 0.4, 0.09)];
    expect(frontFaces(group, [])).toEqual(group);
  });

  it('leaves out a queue further back', () => {
    const front = [face(0.4, 0.45, 0.12), face(0.55, 0.45, 0.11)];
    const queue = [face(0.2, 0.3, 0.05), face(0.8, 0.28, 0.045)];
    expect(frontFaces([...front, ...queue], [])).toEqual(front);
  });

  it('keeps a child in front with the adults', () => {
    const adult = face(0.4, 0.35, 0.12);
    const child = face(0.55, 0.55, 0.08);
    expect(frontFaces([adult, child], [])).toEqual([adult, child]);
  });

  it('keeps a guest who leans back for a moment, but does not let a stranger join that way', () => {
    const near = face(0.4, 0.4, 0.12);
    const between = face(0.6, 0.4, 0.12 * ((JOIN_RATIO + STAY_RATIO) / 2));
    expect(frontFaces([near, between], [])).toEqual([near]);
    expect(frontFaces([near, between], [near, between])).toEqual([near, between]);
  });

  it('leaves one face, or none, alone', () => {
    expect(frontFaces([], [])).toEqual([]);
    const one = [face(0.5, 0.5, 0.02)];
    expect(frontFaces(one, [])).toEqual(one);
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
