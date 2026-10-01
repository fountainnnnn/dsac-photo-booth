import { describe, expect, it } from 'vitest';
import { combineMasks, peopleRegion, type Mask } from './segmentation';

/** A w x h mask, 1 inside [x0, x1) x [y0, y1) (in pixels), 0 elsewhere. */
function block(w: number, h: number, x0: number, x1: number, y0: number, y1: number): Mask {
  const data = new Float32Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * w + x] = 1;
  return { data, w, h };
}

describe('peopleRegion', () => {
  it('frames the people with a margin, inside the frame', () => {
    const r = peopleRegion(block(100, 50, 40, 60, 20, 50), false, 0.5, 0.1)!;
    expect(r.x).toBeCloseTo(0.38);
    expect(r.w).toBeCloseTo(0.24);
    expect(r.y).toBeCloseTo(0.34);
    expect(r.y + r.h).toBe(1);
  });

  it('reads a background mask the other way round', () => {
    const bg = block(100, 50, 40, 60, 20, 50);
    for (let i = 0; i < bg.data.length; i++) bg.data[i] = 1 - bg.data[i];
    expect(peopleRegion(bg, true, 0.5, 0)).toEqual(peopleRegion(block(100, 50, 40, 60, 20, 50), false, 0.5, 0));
  });

  it('is null for an empty frame', () => {
    expect(peopleRegion(block(10, 10, 0, 0, 0, 0))).toBeNull();
  });
});

describe('combineMasks', () => {
  const whole = block(10, 10, 0, 0, 0, 0); // the whole-frame pass saw nobody
  const close = block(4, 4, 0, 4, 0, 4);   // the close-up is all person
  const region = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };

  it('takes the close-up inside its region and the whole frame outside', () => {
    const out = combineMasks(whole, close, region, 10, 10);
    expect(out[7 * 10 + 7]).toBe(1);
    expect(out[2 * 10 + 2]).toBe(0);
  });

  it('turns background into person, and blends into a running mask', () => {
    const running = new Float32Array(100).fill(0.5);
    combineMasks(whole, null, null, 10, 10, { invert: true, into: running, blend: 0.5 });
    expect(running[0]).toBeCloseTo(0.75);
  });
});
