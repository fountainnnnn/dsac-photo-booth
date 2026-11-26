import { describe, expect, it } from 'vitest';
import { assignLanes, laneCount, repeatsToFill, SPARSE_PER_LANE } from './lanes';

const photos = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('assignLanes', () => {
  it('gives every lane nothing when there are no photos', () => {
    expect(assignLanes([], 3)).toEqual([[], [], []]);
  });

  it('deals plenty of photos round the lanes, each photo once', () => {
    const lanes = assignLanes(photos(9), 3);
    expect(lanes).toEqual([['p0', 'p3', 'p6'], ['p1', 'p4', 'p7'], ['p2', 'p5', 'p8']]);
  });

  it('adds a newly kept photo to the end of a lane, moving none already up', () => {
    const before = assignLanes(photos(9), 3);
    const after = assignLanes(photos(10), 3);
    expect(after[0].slice(0, before[0].length)).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expect(after[0].at(-1)).toBe('p9');
  });

  it('shows every photo in every lane when there are only a few, each starting elsewhere', () => {
    const lanes = assignLanes(photos(3), 4);
    for (const lane of lanes) expect([...lane].sort()).toEqual(['p0', 'p1', 'p2']);
    expect(lanes.map(l => l[0])).toEqual(['p0', 'p1', 'p2', 'p0']);
  });

  it('switches to dealing once there are enough for each lane', () => {
    const lanes = assignLanes(photos(4 * SPARSE_PER_LANE), 4);
    expect(lanes.flat()).toHaveLength(4 * SPARSE_PER_LANE);
  });
});

describe('repeatsToFill', () => {
  it('repeats a short lane until one pass covers the screen', () => {
    expect(repeatsToFill([300, 300], 1080)).toBe(2);
    expect(repeatsToFill([300], 1080)).toBe(4);
  });

  it('does not repeat a lane already longer than the screen', () => {
    expect(repeatsToFill([600, 600], 1080)).toBe(1);
  });

  it('copes with nothing measurable', () => {
    expect(repeatsToFill([], 1080)).toBe(1);
    expect(repeatsToFill([Number.NaN, 0], 1080)).toBe(1);
  });
});

describe('laneCount', () => {
  it('fits about one lane per target width, within limits', () => {
    expect(laneCount(1920, 400)).toBe(5);
    expect(laneCount(390, 400)).toBe(2);
    expect(laneCount(7680, 400)).toBe(8);
    expect(laneCount(0, 400)).toBe(2);
  });
});
