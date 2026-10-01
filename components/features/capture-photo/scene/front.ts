import type { FacePoints } from './faces';

/**
 * Who the photo is of: the people at the front.
 *
 * A booth at an open house has a queue behind it and people walking past.
 * They should not get avatars, and with no green screen they should not be
 * cut out and pasted onto the background either. The camera has no depth, but
 * faces shrink with distance, so how big a face is says how near it is.
 *
 * The nearest face sets the scale, and everyone whose face is nearly as big —
 * standing about as close — is in the group, however many that is. Someone a
 * pace or two further back has a face noticeably smaller and is left out. A
 * child in front still counts: a child's face is smaller than an adult's, but
 * not by as much as a few metres makes.
 *
 * Membership is sticky. A guest already in the group stays in it down to a
 * lower ratio, so someone leaning back for a moment does not lose their hat.
 */

/** To join the group, a face must be at least this share of the nearest's width. */
export const JOIN_RATIO = 0.6;
/** Once in, it stays until it falls below this. */
export const STAY_RATIO = 0.45;

/** Nose distance (fraction of the frame) within which two sightings are one person. */
const SAME_PERSON = 0.08;
const NOSE = 1;

export interface FaceBox { x0: number; y0: number; x1: number; y1: number }

/** A face's extent in the camera frame, 0–1. */
export function faceBox(face: FacePoints): FaceBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of face) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

function width(face: FacePoints): number {
  const b = faceBox(face);
  return b.x1 - b.x0;
}

function samePerson(a: FacePoints, b: FacePoints): boolean {
  return Math.hypot(a[NOSE].x - b[NOSE].x, a[NOSE].y - b[NOSE].y) < SAME_PERSON;
}

/**
 * The faces of the people at the front. `previous` is the group as it was
 * last time, for stickiness; pass [] the first time.
 */
export function frontFaces(faces: FacePoints[], previous: FacePoints[]): FacePoints[] {
  if (faces.length <= 1) return faces;
  const widths = faces.map(width);
  const nearest = Math.max(...widths);
  return faces.filter((face, i) => {
    const wasIn = previous.some(p => samePerson(p, face));
    return widths[i] >= nearest * (wasIn ? STAY_RATIO : JOIN_RATIO);
  });
}
