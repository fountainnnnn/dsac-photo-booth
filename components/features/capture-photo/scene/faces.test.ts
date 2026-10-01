import { describe, expect, it } from 'vitest';
import { cutByTileEdge, dedupe, tooBigForTile, type FacePoints } from './faces';

/** A face as a square of points, centred at (cx, cy), `size` across. */
function face(cx: number, cy: number, size: number): FacePoints {
  const h = size / 2;
  return [
    { x: cx - h, y: cy - h }, { x: cx, y: cy }, { x: cx + h, y: cy + h },
    { x: cx + h, y: cy - h }, { x: cx - h, y: cy + h },
  ];
}

describe('dedupe', () => {
  it('keeps one of two sightings of the same person, the first', () => {
    const whole = face(0.5, 0.4, 0.1);
    const fromTile = face(0.53, 0.38, 0.08); // shifted: a half-fitted mesh
    expect(dedupe([whole, fromTile])).toEqual([whole]);
  });

  it('keeps people standing side by side', () => {
    const a = face(0.4, 0.4, 0.06);
    const b = face(0.5, 0.4, 0.06);
    expect(dedupe([a, b])).toHaveLength(2);
  });
});

describe('tooBigForTile', () => {
  const tile = { x: 0.3, y: 0, w: 0.4, h: 0.7 };

  it('keeps the small faces tiles are for, drops big ones only a tile saw', () => {
    // 0.15 of a 0.4-wide tile is 0.06 of the region: a guest standing back.
    expect(tooBigForTile(face(0.5, 0.5, 0.15), tile)).toBe(false);
    // 0.39 of the tile is 0.156 of the region: the backdrop "face".
    expect(tooBigForTile(face(0.4, 0.3, 0.39), tile)).toBe(true);
  });
});

describe('cutByTileEdge', () => {
  const middle = { x: 0.3, y: 0, w: 0.4, h: 0.7 };
  const leftmost = { x: 0, y: 0, w: 0.4, h: 0.7 };

  it('drops a face a tile sees cut by its inner edge', () => {
    expect(cutByTileEdge(face(0.02, 0.5, 0.1), middle)).toBe(true);
    expect(cutByTileEdge(face(0.97, 0.5, 0.1), middle)).toBe(true);
    expect(cutByTileEdge(face(0.5, 0.98, 0.1), middle)).toBe(true);
  });

  it('keeps a face inside, or cut only where the photo itself ends', () => {
    expect(cutByTileEdge(face(0.5, 0.5, 0.1), middle)).toBe(false);
    expect(cutByTileEdge(face(0.02, 0.5, 0.1), leftmost)).toBe(false);
    expect(cutByTileEdge(face(0.5, 0.02, 0.1), middle)).toBe(false);
  });
});
