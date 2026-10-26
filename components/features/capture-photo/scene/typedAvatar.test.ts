import { describe, expect, it } from 'vitest';
import {
  backdropOf, filterPieces, keyOut, solidBox, splitFilter, typedAvatarOption, type Pixels,
} from './typedAvatar';
import { AVATARS, HEAD_TOP_LIFT, TYPED_SLOTS, toggleAvatar, type AvatarOption } from '@/types/scene';

const MAGENTA = [255, 0, 255];
const BLUE = [20, 40, 200];

/** A picture of one colour, with `paint` choosing others pixel by pixel. */
function picture(w: number, h: number, paint: (x: number, y: number) => number[] = () => MAGENTA): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

const alpha = (img: { data: Uint8ClampedArray }, w: number, x: number, y: number) => img.data[(y * w + x) * 4 + 3];

describe('keyOut', () => {
  // A blue ring on magenta: the ring from 10 to 30, a magenta hole in it from 15 to 25.
  const ring = (x: number, y: number) => {
    const inRing = x >= 10 && x < 30 && y >= 10 && y < 30;
    const inHole = x >= 15 && x < 25 && y >= 15 && y < 25;
    return inRing && !inHole ? BLUE : MAGENTA;
  };

  it('takes the backdrop away, through the item\'s openings too, and boxes what is left', () => {
    const keyed = keyOut(picture(40, 40, ring))!;
    expect(keyed.box).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(alpha(keyed, 40, 2, 2)).toBe(0);
    expect(alpha(keyed, 40, 20, 20)).toBe(0); // the hole
    expect(alpha(keyed, 40, 12, 12)).toBe(255);
  });

  it('makes a blended edge part see-through, and takes the backdrop\'s tint off it', () => {
    // Half blue, half magenta, along the ring's left edge.
    const mixed = BLUE.map((c, i) => Math.round((c + MAGENTA[i]) / 2));
    const keyed = keyOut(picture(40, 40, (x, y) => (x === 10 && y >= 10 && y < 30 ? mixed : ring(x, y))))!;
    const a = alpha(keyed, 40, 10, 20);
    expect(a).toBeGreaterThan(30);
    expect(a).toBeLessThan(120);
    // No longer magenta: as blue as the ring, not red and blue.
    const i = (20 * 40 + 10) * 4;
    expect(keyed.data[i + 2] - keyed.data[i]).toBeGreaterThan(60);
  });

  it('works out a green backdrop as well as magenta', () => {
    const green = [10, 230, 20];
    const keyed = keyOut(picture(40, 40, (x, y) => (ring(x, y) === BLUE ? BLUE : green)))!;
    expect(backdropOf(picture(40, 40, () => green)).g).toBe(230);
    expect(keyed.box).toEqual({ x: 10, y: 10, w: 20, h: 20 });
  });

  it('gives up on a picture without a plain backdrop, or with nothing on it', () => {
    const busy = picture(40, 40, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256]);
    expect(keyOut(busy)).toBeNull();
    expect(keyOut(picture(40, 40))).toBeNull();
  });
});

describe('typedAvatarOption', () => {
  const base = { id: 'typed-1', label: 'a hat', src: 'blob:x', size: 'normal', width: 1000, height: 1000 };

  it('pins the item by the server\'s mark, sized to the face', () => {
    // The item fills 200-800 across; the eyes are marked 40% down it; the face is 400 wide.
    const option = typedAvatarOption({
      ...base, where: 'eyes', fit: { x: 0.5, y: 0.46, faceWidth: 0.4 },
      box: { x: 200, y: 300, w: 600, h: 400 },
    });
    expect(option.slot).toBe('eyes');
    expect(option.anchor).toBe('eyes');
    expect(option.per).toBe('face');
    expect(option.width).toBeCloseTo(1.5);
    expect(option.pivot.x).toBeCloseTo(0.5);
    expect(option.pivot.y).toBeCloseTo(0.4);
  });

  it('rests something on the head by its bottom edge, wherever the mark is', () => {
    // A band of ears once came back marked at the top of the band.
    const option = typedAvatarOption({
      ...base, where: 'head', fit: { x: 0.5, y: 0.5, faceWidth: 0.45 },
      box: { x: 250, y: 100, w: 500, h: 800 },
    });
    expect(option.anchor).toBe('forehead');
    expect(option.per).toBe('face');
    expect(option.pivot.y).toBeCloseTo(TYPED_SLOTS.head.pivot.y);
    expect(option.width).toBeCloseTo(500 / 450);
  });

  it('places it by its part of the face when the mark makes no sense', () => {
    const option = typedAvatarOption({
      ...base, where: 'eyes', size: 'large', fit: { x: 0.5, y: 0.5, faceWidth: 0.05 },
      box: { x: 100, y: 400, w: 800, h: 200 },
    });
    expect(option.per).toBe('eyes');
    expect(option.anchor).toBe('eyes');
    expect(option.width).toBeCloseTo(TYPED_SLOTS.eyes.width * 1.35);
    expect(option.pivot).toEqual(TYPED_SLOTS.eyes.pivot);
  });

  it('sizes something worn below the face by its part, whatever the mark says', () => {
    // A bow tie once came back marked as twice the width of the face.
    const option = typedAvatarOption({
      ...base, where: 'neck', fit: { x: 0.5, y: 0.4, faceWidth: 0.45 },
      box: { x: 100, y: 300, w: 800, h: 400 },
    });
    expect(option.per).toBe('eyes');
    expect(option.width).toBeCloseTo(TYPED_SLOTS.neck.width);
  });

  it('treats an unknown part of the face as the head', () => {
    const option = typedAvatarOption({ ...base, where: 'elbow', fit: null, box: { x: 0, y: 0, w: 10, h: 10 } });
    expect(option.slot).toBe('head');
  });
});

describe('face filters', () => {
  // A bunny filter, 100 square: two ears from rows 10 to 39, a nose and
  // whiskers from 60 to 74, nothing between.
  const W = 100;
  const bunny = picture(W, W, (x, y) => {
    const ear = y >= 10 && y < 40 && ((x >= 25 && x < 35) || (x >= 65 && x < 75));
    const face = y >= 60 && y < 75 && x >= 30 && x < 70;
    return ear || face ? BLUE : MAGENTA;
  });
  const keyed = keyOut(bunny)!;

  it('divides into what goes on the head and what goes on the face', () => {
    const split = splitFilter(keyed.data, W, keyed.box, 66)!;
    expect(split.upper).toEqual({ x: 25, y: 10, w: 50, h: 30 });
    expect(split.lower).toEqual({ x: 30, y: 60, w: 40, h: 15 });
  });

  it('does not divide a mask, which has no gap above the nose', () => {
    const mask = keyOut(picture(W, W, (x, y) => (x >= 20 && x < 80 && y >= 10 && y < 90 ? BLUE : MAGENTA)))!;
    expect(splitFilter(mask.data, W, mask.box, 60)).toBeNull();
  });

  it('rests the head piece on the top of the head and pins the rest by the nose', () => {
    const split = splitFilter(keyed.data, W, keyed.box, 66)!;
    // The nose marked at (50, 66); the face 40 wide.
    const [head, face] = filterPieces({
      fit: { x: 0.5, y: 0.66, faceWidth: 0.4 }, split, width: W, height: W, upperSrc: 'u', lowerSrc: 'l',
    });
    expect(head).toMatchObject({ src: 'u', slot: 'top', anchor: 'forehead', lift: HEAD_TOP_LIFT, per: 'face' });
    expect(head.width).toBeCloseTo(50 / 40);
    expect(head.pivot.x).toBeCloseTo(0.5);
    expect(head.pivot.y).toBeCloseTo(0.9);
    expect(face).toMatchObject({ src: 'l', slot: 'filter', anchor: 'nose', per: 'face' });
    expect(face.width).toBeCloseTo(1);
    expect(face.pivot.y).toBeCloseTo(6 / 15);
  });

  it('takes the face piece as the face\'s width when the mark makes no sense', () => {
    const split = splitFilter(keyed.data, W, keyed.box, 66)!;
    const [head, face] = filterPieces({
      fit: { x: 0.5, y: 0.66, faceWidth: 0.01 }, split, width: W, height: W, upperSrc: 'u', lowerSrc: 'l',
    });
    expect(face.width).toBeCloseTo(1);
    expect(head.width).toBeCloseTo(50 / 40);
  });

  it('boxes what is solid in some rows', () => {
    expect(solidBox(keyed.data, W, keyed.box, 0, 20)).toEqual({ x: 25, y: 10, w: 50, h: 11 });
    expect(solidBox(keyed.data, W, keyed.box, 45, 55)).toBeNull();
  });
});

describe('toggleAvatar', () => {
  const shades = AVATARS.find(a => a.id === 'shades')!;
  const crown = AVATARS.find(a => a.id === 'crown')!;
  const partyHat = AVATARS.find(a => a.id === 'party-hat')!;
  const moustache = AVATARS.find(a => a.id === 'moustache')!;

  it('wears several, one per part of the face', () => {
    let ids: string[] = [];
    for (const a of [shades, crown, moustache]) ids = toggleAvatar(ids, a, AVATARS);
    expect(ids).toEqual(['shades', 'crown', 'moustache']);
    ids = toggleAvatar(ids, partyHat, AVATARS);
    expect(ids).toEqual(['shades', 'moustache', 'party-hat']);
  });

  it('takes one off when tapped again', () => {
    expect(toggleAvatar(['shades', 'crown'], shades, AVATARS)).toEqual(['crown']);
  });

  it('counts something sticking up from the head as the head', () => {
    const ears: AvatarOption = { ...crown, id: 'typed-1', slot: 'top' };
    expect(toggleAvatar(['crown', 'shades'], ears, [ears, ...AVATARS])).toEqual(['shades', 'typed-1']);
  });
});
