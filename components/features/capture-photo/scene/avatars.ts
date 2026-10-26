import { AVATAR_DRAW_ORDER, type AvatarAnchor, type AvatarOption } from '@/types/scene';
import type { FacePoint, FacePoints } from './faces';

/**
 * Pinning an avatar to a face.
 *
 * The face mesh reports points in the raw camera frame. The photo is that
 * frame cropped, mirrored and possibly turned, then placed in the frame's
 * window — so every point goes through exactly the transform `drawPhoto`
 * applies to the camera, and the avatar is then drawn upright (never
 * mirrored, so a printed hat reads the right way round) at the angle the
 * eyes make.
 */

/** Face-mesh indices this file uses. See MediaPipe's canonical face model. */
export const LANDMARK = {
  eyeOuterA: 33,
  eyeInnerA: 133,
  eyeInnerB: 362,
  eyeOuterB: 263,
  forehead: 10,
  noseTip: 1,
  noseBottom: 2,
  upperLip: 0,
  mouthTop: 13,
  mouthBottom: 14,
  chin: 152,
  faceSideA: 234,
  faceSideB: 454,
} as const;

/** The highest landmark index used here: a face needs at least this many points. */
const LAST_LANDMARK = Math.max(...Object.values(LANDMARK));

/**
 * Where the camera ends up in the photo, in the photo's pixels — the numbers
 * `drawPhoto` computes for its own draw.
 *
 * `s*` is the region of the source sampled, in source pixels (`srcW` x
 * `srcH`), and `d*` where it lands. `rotationRad` turns it about the window's
 * centre, clockwise as seen in the photo.
 */
export interface PhotoGeometry {
  sx: number; sy: number; sw: number; sh: number;
  srcW: number; srcH: number;
  dx: number; dy: number; dw: number; dh: number;
  rotationRad: number;
}

/**
 * A camera point (0–1 of the raw frame) to photo pixels, through the same
 * crop, mirror and rotation as the camera itself.
 */
export function toPhoto(pt: FacePoint, g: PhotoGeometry): { x: number; y: number } {
  const lx = ((pt.x * g.srcW - g.sx) / g.sw) * g.dw;
  const ly = ((pt.y * g.srcH - g.sy) / g.sh) * g.dh;
  const cx = g.dw / 2;
  const cy = g.dh / 2;
  const ux = lx - cx;
  const uy = ly - cy;
  const cos = Math.cos(g.rotationRad);
  const sin = Math.sin(g.rotationRad);
  // drawPhoto rotates by -θ on an axis it has already mirrored.
  const rx = ux * cos + uy * sin;
  const ry = -ux * sin + uy * cos;
  return { x: g.dx + g.dw - (rx + cx), y: g.dy + ry + cy };
}

function xy(a: { x: number; y: number }, b: { x: number; y: number }): [number, number] {
  return [b.x - a.x, b.y - a.y];
}

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function anchorPoint(face: FacePoints, anchor: AvatarAnchor, g: PhotoGeometry) {
  const p = (i: number) => toPhoto(face[i], g);
  switch (anchor) {
    case 'eyes':
      return mid(
        mid(p(LANDMARK.eyeOuterA), p(LANDMARK.eyeInnerA)),
        mid(p(LANDMARK.eyeInnerB), p(LANDMARK.eyeOuterB)),
      );
    case 'forehead': return p(LANDMARK.forehead);
    case 'nose': return p(LANDMARK.noseTip);
    case 'upperLip': return mid(p(LANDMARK.noseBottom), p(LANDMARK.upperLip));
    case 'mouth': return mid(p(LANDMARK.mouthTop), p(LANDMARK.mouthBottom));
    case 'chin': return p(LANDMARK.chin);
  }
}

export interface AvatarPlacement {
  /** Where the avatar's pivot lands, in photo pixels. */
  x: number;
  y: number;
  /** Radians, clockwise: the tilt of the head. */
  angle: number;
  width: number;
  height: number;
}

/**
 * Where one avatar goes on one face. `aspect` is the image's height over its
 * width. Null for a face without the points needed.
 */
export function placeAvatar(
  face: FacePoints, avatar: AvatarOption, aspect: number, g: PhotoGeometry,
): AvatarPlacement | null {
  if (face.length <= LAST_LANDMARK) return null;
  const a = toPhoto(face[LANDMARK.eyeOuterA], g);
  const b = toPhoto(face[LANDMARK.eyeOuterB], g);
  let vx = b.x - a.x;
  let vy = b.y - a.y;
  const span = Math.hypot(vx, vy);
  if (!(span > 0)) return null;
  // The eye line's direction depends on which eye the mirror put on the left.
  // An upright head is what matters, so always read it left to right.
  if (vx < 0) { vx = -vx; vy = -vy; }
  const angle = Math.atan2(vy, vx);

  const anchor = anchorPoint(face, avatar.anchor, g);
  // "Up" the face: the eye line turned a quarter anticlockwise.
  const upX = Math.sin(angle);
  const upY = -Math.cos(angle);
  // Typed avatars are sized to the face, which is what the server measures
  // them against; the ready-made ones to the eyes.
  const per = avatar.per === 'face'
    ? Math.hypot(...xy(toPhoto(face[LANDMARK.faceSideA], g), toPhoto(face[LANDMARK.faceSideB], g)))
    : span;
  const width = avatar.width * per;
  return {
    x: anchor.x + upX * avatar.lift * span,
    y: anchor.y + upY * avatar.lift * span,
    angle,
    width,
    height: width * aspect,
  };
}

type AvatarImage = CanvasImageSource & {
  naturalWidth?: number; naturalHeight?: number; width: number; height: number;
};

/** An avatar the guest is wearing, with its picture loaded. */
export interface WornAvatar {
  option: AvatarOption;
  image: AvatarImage;
}

/**
 * Draw every avatar worn on every face, clipped to the photo's window, back
 * to front (`AVATAR_DRAW_ORDER`): a hat goes over a mask, not under it.
 */
export function drawAvatars(
  ctx: CanvasRenderingContext2D,
  faces: FacePoints[],
  avatars: WornAvatar[],
  g: PhotoGeometry,
) {
  const order = (a: WornAvatar) => AVATAR_DRAW_ORDER.indexOf(a.option.slot);
  const worn = avatars
    .filter(a => (a.image.naturalWidth || a.image.width) && (a.image.naturalHeight || a.image.height))
    .sort((a, b) => order(a) - order(b));
  if (!worn.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.dx, g.dy, g.dw, g.dh);
  ctx.clip();
  for (const face of faces) {
    for (const { option, image } of worn) {
      const iw = image.naturalWidth || image.width;
      const ih = image.naturalHeight || image.height;
      const place = placeAvatar(face, option, ih / iw, g);
      if (!place) continue;
      ctx.save();
      ctx.translate(place.x, place.y);
      ctx.rotate(place.angle);
      ctx.drawImage(
        image,
        -option.pivot.x * place.width, -option.pivot.y * place.height,
        place.width, place.height,
      );
      ctx.restore();
    }
  }
  ctx.restore();
}
