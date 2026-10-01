import type { AvatarAnchor, AvatarOption } from '@/types/scene';
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
} as const;

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
  if (face.length <= LANDMARK.eyeOuterB) return null;
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
  const width = avatar.width * span;
  return {
    x: anchor.x + upX * avatar.lift * span,
    y: anchor.y + upY * avatar.lift * span,
    angle,
    width,
    height: width * aspect,
  };
}

/** Draw the avatar on every face, clipped to the photo's window. */
export function drawAvatars(
  ctx: CanvasRenderingContext2D,
  faces: FacePoints[],
  avatar: AvatarOption,
  image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number },
  g: PhotoGeometry,
) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.dx, g.dy, g.dw, g.dh);
  ctx.clip();
  for (const face of faces) {
    const place = placeAvatar(face, avatar, ih / iw, g);
    if (!place) continue;
    ctx.save();
    ctx.translate(place.x, place.y);
    ctx.rotate(place.angle);
    ctx.drawImage(
      image,
      -avatar.pivot.x * place.width, -avatar.pivot.y * place.height,
      place.width, place.height,
    );
    ctx.restore();
  }
  ctx.restore();
}
