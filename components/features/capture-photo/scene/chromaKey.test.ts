import { describe, expect, it } from 'vitest';
import { keyPixel, parseHexColour, plateKeyColour, type Rgb } from './chromaKey';
import { DEFAULT_CHROMA_KEY } from '@/types/scene';

const GREEN = parseHexColour(DEFAULT_CHROMA_KEY.colour);
const key = (px: Rgb, plate?: Rgb) => keyPixel(px, GREEN, DEFAULT_CHROMA_KEY, plate);

describe('keyPixel on a green screen', () => {
  it('removes the screen itself', () => {
    expect(key(GREEN).alpha).toBeCloseTo(0, 2);
  });

  it('removes the screen in shadow too: darker, but no less green', () => {
    const shadow: Rgb = [GREEN[0] * 0.45, GREEN[1] * 0.45, GREEN[2] * 0.45];
    expect(key(shadow).alpha).toBeLessThan(0.05);
  });

  it('keeps skin, grey clothing, white and dark hair', () => {
    for (const px of [[0.9, 0.7, 0.6], [0.5, 0.5, 0.5], [1, 1, 1], [0.08, 0.06, 0.05]] as Rgb[]) {
      expect(key(px).alpha).toBe(1);
    }
  });

  it('does not key near-black noise, which can read as any colour', () => {
    expect(key([0.0, 0.03, 0.01]).alpha).toBeGreaterThan(0.9);
  });

  it('gives a soft edge between screen and person', () => {
    // Half skin, half screen: the kind of pixel a strand of hair makes.
    const mixed: Rgb = [0.45, 0.7, 0.42];
    const { alpha } = key(mixed);
    expect(alpha).toBeGreaterThan(0.05);
    expect(alpha).toBeLessThan(0.95);
  });

  it('takes the green cast off what it keeps', () => {
    const tinted: Rgb = [0.8, 0.85, 0.6];
    const { rgb } = key(tinted);
    expect(rgb[1]).toBeLessThan(0.85);
    expect(rgb[0]).toBe(0.8);
    expect(rgb[2]).toBe(0.6);
  });

  it('leaves colour alone with spill at zero', () => {
    const tinted: Rgb = [0.8, 0.85, 0.6];
    expect(keyPixel(tinted, GREEN, { ...DEFAULT_CHROMA_KEY, spill: 0 }).rgb).toEqual(tinted);
  });
});

describe('keyPixel with a clean plate', () => {
  // A washed-out corner of the screen: still green, but far less so than the
  // key colour, so against the key alone it reads as half person.
  const washed: Rgb = [0.55, 0.75, 0.55];

  it('judges each pixel against the same spot on the empty screen', () => {
    expect(key(washed).alpha).toBeGreaterThan(0.5);
    expect(key(washed, washed).alpha).toBeCloseTo(0, 2);
  });

  it('falls back to the key colour where the plate is not screen', () => {
    const room: Rgb = [0.6, 0.55, 0.5];
    expect(key(GREEN, room).alpha).toBeCloseTo(0, 2);
  });
});

describe('keyPixel on a blue screen', () => {
  const BLUE = parseHexColour('#0047bb');
  const blueKey = (px: Rgb) => keyPixel(px, BLUE, DEFAULT_CHROMA_KEY);

  it('removes blue and keeps green, which is clothing here', () => {
    expect(blueKey(BLUE).alpha).toBeCloseTo(0, 2);
    expect(blueKey(GREEN).alpha).toBe(1);
  });
});

describe('parseHexColour', () => {
  it('reads #rrggbb and falls back to green for anything else', () => {
    expect(parseHexColour('#ff0000')).toEqual([1, 0, 0]);
    expect(parseHexColour('nonsense')).toEqual(parseHexColour('#00b140'));
  });
});

describe('plateKeyColour', () => {
  /** RGBA bytes for a list of [r, g, b] bytes. */
  const pixels = (colours: Rgb[]) => new Uint8ClampedArray(
    colours.flatMap(([r, g, b]) => [r, g, b, 255]),
  );

  it('averages the screen and ignores the room around it', () => {
    const plate = pixels([
      ...Array<Rgb>(90).fill([0x00, 0xb3, 0x40]),
      ...Array<Rgb>(10).fill([0x99, 0x8c, 0x80]),
    ]);
    expect(plateKeyColour(plate)).toBe('#00b340');
  });

  it('refuses a picture with no screen in it', () => {
    expect(plateKeyColour(pixels(Array<Rgb>(100).fill([0x99, 0x8c, 0x80])))).toBeNull();
  });
});
