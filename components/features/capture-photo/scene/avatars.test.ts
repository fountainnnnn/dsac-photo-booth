import { describe, expect, it } from 'vitest';
import { LANDMARK, drawAvatars, placeAvatar, toPhoto, type PhotoGeometry } from './avatars';
import type { FacePoints } from './faces';
import type { AvatarOption } from '@/types/scene';

/** The whole camera, straight into a 1600x900 photo. */
const plain: PhotoGeometry = {
  sx: 0, sy: 0, sw: 1280, sh: 720, srcW: 1280, srcH: 720,
  dx: 0, dy: 0, dw: 1600, dh: 900, rotationRad: 0,
};

/** A face with only the points avatars use, eyes 0.1 of the frame apart. */
function face(cx: number, cy: number): FacePoints {
  const pts: FacePoints = Array.from({ length: 478 }, () => ({ x: cx, y: cy }));
  pts[LANDMARK.eyeOuterA] = { x: cx + 0.05, y: cy };
  pts[LANDMARK.eyeInnerA] = { x: cx + 0.02, y: cy };
  pts[LANDMARK.eyeInnerB] = { x: cx - 0.02, y: cy };
  pts[LANDMARK.eyeOuterB] = { x: cx - 0.05, y: cy };
  pts[LANDMARK.forehead] = { x: cx, y: cy - 0.08 };
  pts[LANDMARK.mouthTop] = { x: cx, y: cy + 0.1 };
  pts[LANDMARK.mouthBottom] = { x: cx, y: cy + 0.12 };
  pts[LANDMARK.chin] = { x: cx, y: cy + 0.18 };
  pts[LANDMARK.faceSideA] = { x: cx + 0.08, y: cy };
  pts[LANDMARK.faceSideB] = { x: cx - 0.08, y: cy };
  return pts;
}

const glasses: AvatarOption = {
  id: 'g', label: 'g', src: '', slot: 'eyes', anchor: 'eyes', width: 2, lift: 0, pivot: { x: 0.5, y: 0.5 },
};

describe('toPhoto', () => {
  it('mirrors the camera, as the photo is', () => {
    expect(toPhoto({ x: 0.25, y: 0.5 }, plain)).toEqual({ x: 1200, y: 450 });
  });

  it('follows the crop and the window', () => {
    const cropped = { ...plain, sx: 320, sw: 640, sy: 180, sh: 360, dx: 100, dy: 50 };
    // The crop's own centre lands in the window's centre.
    expect(toPhoto({ x: 0.5, y: 0.5 }, cropped)).toEqual({ x: 900, y: 500 });
  });

  it('turns about the window centre, clockwise as seen in the photo', () => {
    const turned = { ...plain, rotationRad: Math.PI / 2 };
    // Straight above the centre in the camera (and so in the mirror) ends up
    // to its right once the photo is turned a quarter clockwise.
    const p = toPhoto({ x: 0.5, y: 0.25 }, turned);
    expect(p.x).toBeCloseTo(800 + 225, 6);
    expect(p.y).toBeCloseTo(450, 6);
  });
});

describe('placeAvatar', () => {
  it('centres glasses between the eyes, sized to the eye span, upright', () => {
    const place = placeAvatar(face(0.5, 0.4), glasses, 0.5, plain)!;
    expect(place.x).toBeCloseTo(800, 6);
    expect(place.y).toBeCloseTo(360, 6);
    expect(place.angle).toBeCloseTo(0, 6);
    expect(place.width).toBeCloseTo(2 * 160, 6); // eyes 0.1 x 1600 apart
    expect(place.height).toBeCloseTo(160, 6);
  });

  it('tilts with the head', () => {
    const tilted = face(0.5, 0.4);
    tilted[LANDMARK.eyeOuterA] = { x: 0.55, y: 0.45 };
    tilted[LANDMARK.eyeOuterB] = { x: 0.45, y: 0.35 };
    const place = placeAvatar(tilted, glasses, 0.5, plain)!;
    expect(Math.abs(place.angle)).toBeGreaterThan(0.3);
    expect(Math.abs(place.angle)).toBeLessThan(Math.PI / 2);
  });

  it('lifts a hat up the face from the forehead', () => {
    const hat: AvatarOption = { ...glasses, anchor: 'forehead', lift: 0.5 };
    const place = placeAvatar(face(0.5, 0.4), hat, 1, plain)!;
    const forehead = toPhoto({ x: 0.5, y: 0.32 }, plain);
    expect(place.x).toBeCloseTo(forehead.x, 6);
    expect(place.y).toBeCloseTo(forehead.y - 0.5 * 160, 6);
  });

  it('skips a face without the points it needs', () => {
    expect(placeAvatar([{ x: 0.5, y: 0.5 }], glasses, 1, plain)).toBeNull();
  });

  it('sizes a typed avatar to the face, not the eyes', () => {
    const mask: AvatarOption = { ...glasses, slot: 'face', per: 'face', width: 1.5 };
    const place = placeAvatar(face(0.5, 0.4), mask, 1, plain)!;
    expect(place.width).toBeCloseTo(1.5 * 0.16 * 1600, 6); // face sides 0.16 apart
  });

  it('pins to the mouth and the chin', () => {
    const beard: AvatarOption = { ...glasses, slot: 'chin', anchor: 'mouth' };
    const tie: AvatarOption = { ...glasses, slot: 'neck', anchor: 'chin' };
    expect(placeAvatar(face(0.5, 0.4), beard, 1, plain)!.y).toBeCloseTo(0.51 * 900, 6);
    expect(placeAvatar(face(0.5, 0.4), tie, 1, plain)!.y).toBeCloseTo(0.58 * 900, 6);
  });
});

describe('drawAvatars', () => {
  function recorder() {
    const drawn: unknown[] = [];
    const ctx = {
      drawImage: (img: unknown) => { drawn.push(img); },
      save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, rect() {}, clip() {},
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
  }
  const picture = (name: string) => ({ name, width: 100, height: 50 }) as unknown as HTMLCanvasElement;

  it('draws everything worn on every face, back to front', () => {
    const { ctx, drawn } = recorder();
    const hat = picture('hat');
    const mask = picture('mask');
    const specs = picture('specs');
    drawAvatars(ctx, [face(0.3, 0.4), face(0.7, 0.4)], [
      { option: { ...glasses, id: 'h', slot: 'head', anchor: 'forehead' }, image: hat },
      { option: { ...glasses, id: 's' }, image: specs },
      { option: { ...glasses, id: 'm', slot: 'face' }, image: mask },
    ], plain);
    expect(drawn).toEqual([mask, specs, hat, mask, specs, hat]);
  });
});
