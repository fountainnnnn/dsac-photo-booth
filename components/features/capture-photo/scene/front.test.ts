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

/**
 * A face mesh with only the outer corners of the eyes placed, `span` of the
 * picture's width apart in 3D, turned `yawDeg` and tilted `rollDeg`.
 */
function eyes(cx: number, cy: number, span: number, yawDeg = 0, rollDeg = 0, aspect = 9 / 16): FacePoints {
  const pts: FacePoints = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  const yaw = (yawDeg * Math.PI) / 180;
  const roll = (rollDeg * Math.PI) / 180;
  const hx = (span / 2) * Math.cos(yaw) * Math.cos(roll);
  const hy = (span / 2) * Math.sin(roll); // in shares of the width
  const hz = (span / 2) * Math.sin(yaw) * Math.cos(roll);
  pts[33] = { x: cx - hx, y: cy - hy / aspect, z: -hz };
  pts[263] = { x: cx + hx, y: cy + hy / aspect, z: hz };
  return pts;
}

describe('faceDistance from the eyes', () => {
  it('reads the same however the head turns or tilts', () => {
    const straight = faceDistance(eyes(0.5, 0.4, 0.1));
    expect(faceDistance(eyes(0.5, 0.4, 0.1, 40))).toBeCloseTo(straight, 6);
    expect(faceDistance(eyes(0.5, 0.4, 0.1, 0, 20))).toBeCloseTo(straight, 6);
  });

  it('is plausible for a webcam, and follows the calibration', () => {
    const d = faceDistance(eyes(0.5, 0.4, 0.1));
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(1.2);
    expect(faceDistance(eyes(0.5, 0.4, 0.1), { aspect: 9 / 16, scale: 1.5 })).toBeCloseTo(d * 1.5);
  });
});

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

  it('keeps only as many people as are posing, the nearest', () => {
    const me = at(0.4, 0.4, 1);
    const friend = at(0.6, 0.4, 1.2);
    const behind = at(0.5, 0.3, 1.8);
    expect(frontFaces([me, friend, behind], [], 2, 2)).toEqual([me, friend]);
    expect(frontFaces([me, friend, behind], [], 2, 1)).toEqual([me]);
    expect(frontFaces([me, friend, behind], [], 2, 0)).toEqual([me, friend, behind]);
  });

  it('does not swap a guest out for someone only a touch nearer', () => {
    const guest = at(0.4, 0.4, 1.05);
    const passer = at(0.6, 0.4, 1);
    expect(frontFaces([guest, passer], [guest], 2, 1)).toEqual([guest]);
    // Clearly nearer is another matter.
    const stepsIn = at(0.6, 0.4, 0.85);
    expect(frontFaces([guest, stepsIn], [guest], 2, 1)).toEqual([stepsIn]);
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

  describe('a guest and someone left out, overlapping in the picture', () => {
    // 40x30. The guest: head at columns 18-26, rows 8-15, and a wide body
    // below. Behind them and to the left, smaller: a head at columns 6-11,
    // rows 3-8, a torso that runs into the guest's shoulder, and an arm out to
    // the left. One shape, as the camera sees it.
    const W = 40;
    const H = 30;
    const both = new Float32Array(W * H);
    const fill = (c0: number, c1: number, r0: number, r1: number) => {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) both[r * W + c] = 0.9;
    };
    fill(18, 26, 8, 15); // guest's head
    fill(12, 32, 16, 29); // guest's body
    fill(6, 11, 3, 8); // the other's head
    fill(4, 13, 9, 17); // the other's torso, touching the guest at the shoulder
    fill(0, 4, 12, 12); // the other's arm
    const guestFace = { x0: 19 / W, y0: 9 / H, x1: 26 / W, y1: 16 / H };
    const otherFace = { x0: 7 / W, y0: 4 / H, x1: 11 / W, y1: 9 / H };
    const px = (out: Float32Array, row: number, col: number) => out[row * W + col];

    it('keeps the whole shape when nobody is left out, as before', () => {
      const out = keepPeopleWith(both, W, H, [guestFace]);
      expect(px(out, 5, 8)).toBeCloseTo(0.9);
    });

    it('takes the one left out back out of it, and leaves the guest whole', () => {
      const out = keepPeopleWith(both, W, H, [guestFace], [otherFace]);
      expect(px(out, 5, 8)).toBe(0); // their head
      expect(px(out, 12, 6)).toBe(0); // their torso
      expect(px(out, 12, 1)).toBe(0); // their arm
      expect(px(out, 12, 22)).toBeCloseTo(0.9); // the guest's head
      expect(px(out, 25, 13)).toBeCloseTo(0.9); // the guest's shoulder
      expect(px(out, 28, 31)).toBeCloseTo(0.9); // the guest's other side
    });

    it('drops a shape holding only faces left out', () => {
      const out = keepPeopleWith(both, W, H, [], [otherFace]);
      expect(px(out, 12, 22)).toBe(0);
    });
  });
});
