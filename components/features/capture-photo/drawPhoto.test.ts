import { describe, expect, it } from 'vitest';
import { drawPhoto } from './useLivePreview';
import { LANDMARK } from './scene/avatars';
import type { FacePoints } from './scene/faces';
import { AVATARS } from '@/types/scene';

/** A 2D context that records what was drawn, in order. */
function recorder() {
  const drawn: unknown[] = [];
  const ctx = {
    filter: 'none',
    fillStyle: '',
    drawImage: (img: unknown) => { drawn.push(img); },
    clearRect() {}, fillRect() {}, save() {}, restore() {},
    translate() {}, scale() {}, rotate() {}, beginPath() {}, rect() {}, clip() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement;
const neutral = { brightness: 100, contrast: 100, saturation: 100, hue: 0 };

function aFace(): FacePoints {
  const pts: FacePoints = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4 }));
  pts[LANDMARK.eyeOuterA] = { x: 0.55, y: 0.4 };
  pts[LANDMARK.eyeOuterB] = { x: 0.45, y: 0.4 };
  return pts;
}

describe('drawPhoto with a scene', () => {
  it('draws the camera alone when there is no scene', () => {
    const { ctx, drawn } = recorder();
    drawPhoto(ctx, video, { w: 1600, h: 900, filters: neutral });
    expect(drawn).toEqual([video]);
  });

  it('puts the background behind the people and the avatar in front', () => {
    const { ctx, drawn } = recorder();
    const person = canvas(640, 360);
    const background = canvas(1920, 1080);
    const avatarImage = canvas(400, 150);
    drawPhoto(ctx, video, {
      w: 1600, h: 900, filters: neutral,
      scene: {
        person,
        background,
        avatar: { option: AVATARS[0], image: avatarImage as unknown as HTMLImageElement },
        faces: [aFace()],
      },
    });
    expect(drawn).toEqual([background, person, avatarImage]);
  });

  it('draws the cut-out people in place of the camera, never both', () => {
    const { ctx, drawn } = recorder();
    const person = canvas(640, 360);
    drawPhoto(ctx, video, {
      w: 1600, h: 900, filters: neutral,
      scene: { person, background: canvas(1920, 1080) },
    });
    expect(drawn).not.toContain(video);
  });

  it('draws avatars on the plain camera too, with background removal off', () => {
    const { ctx, drawn } = recorder();
    const avatarImage = canvas(400, 150);
    drawPhoto(ctx, video, {
      w: 1600, h: 900, filters: neutral,
      scene: {
        avatar: { option: AVATARS[0], image: avatarImage as unknown as HTMLImageElement },
        faces: [aFace(), aFace()],
      },
    });
    expect(drawn).toEqual([video, avatarImage, avatarImage]);
  });
});
