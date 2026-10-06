import type { FacePoints } from './faces';

/**
 * Who the photo is of: the people nearer the camera than a line.
 *
 * A booth at an open house has a queue behind it and people walking past.
 * They should not get avatars, and with no green screen they should not be
 * cut out and pasted onto the background either. The camera has no depth, but
 * faces shrink with distance, so how big a face is says roughly how far away
 * it is (`faceDistance`).
 *
 * Everyone nearer than the line the operator sets in Settings (`frontLineM`)
 * is the group, however many; everyone beyond it is left out. The line is set
 * at the venue by standing where it should be and letting Settings measure
 * (Settings > Background), so the rough guess at the camera below cancels out:
 * the line is measured with the same guess it is checked with. A child still
 * counts: a smaller face reads as a little further away, not as a few metres.
 *
 * It used to be relative instead — the nearest face set the scale and anyone
 * nearly as big was in — which needed no setting, but whoever was nearest
 * decided it. A guest standing close put the friend beside them out; a group
 * standing back let the queue in. A fixed line does what the floor tape does.
 *
 * Membership is sticky. A guest already in the group stays in it a little past
 * the line, so someone leaning back for a moment does not lose their hat.
 */

/**
 * Height of the face mesh, forehead to chin, in metres: an adult's, roughly.
 * Only scales the metres shown; see above.
 */
const FACE_HEIGHT_M = 0.17;

/** A laptop webcam's vertical field of view, roughly. Only scales the metres shown. */
const CAMERA_VFOV_DEG = 45;

/** Where the line is until the operator moves it, in metres. */
export const DEFAULT_LINE_M = 2;

/** Once in, a guest stays until this much past the line. */
const STAY_SLACK = 1.15;

/**
 * How long someone stays cut out after their face was last found, in ms. The
 * tracker misses a face now and then — a hand across it, a quick turn — and
 * for that moment the guest's whole body vanished into the background.
 */
export const HOLD_MS = 1000;

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

/**
 * Roughly how far a face is from the camera, in metres, from its height in
 * the picture. The height, not the width: the width narrows sharply when a
 * guest turns their head, and a guest turned towards a friend for the photo
 * was judged to be standing well back and dropped out. The height barely
 * changes as a head turns.
 */
export function faceDistance(face: FacePoints): number {
  const b = faceBox(face);
  const h = b.y1 - b.y0;
  if (!(h > 0)) return Infinity;
  const halfFov = ((CAMERA_VFOV_DEG / 2) * Math.PI) / 180;
  return FACE_HEIGHT_M / (2 * h * Math.tan(halfFov));
}

/** The nearest face's distance, in metres, or null for no faces. */
export function nearestDistance(faces: FacePoints[]): number | null {
  return faces.length ? Math.min(...faces.map(faceDistance)) : null;
}

function samePerson(a: FacePoints, b: FacePoints): boolean {
  return Math.hypot(a[NOSE].x - b[NOSE].x, a[NOSE].y - b[NOSE].y) < SAME_PERSON;
}

/**
 * The faces of the people nearer than `lineM`. `previous` is the group as it
 * was last time, for stickiness; pass [] the first time.
 */
export function frontFaces(
  faces: FacePoints[], previous: FacePoints[], lineM = DEFAULT_LINE_M,
): FacePoints[] {
  return faces.filter((face) => {
    const wasIn = previous.some(p => samePerson(p, face));
    return faceDistance(face) <= lineM * (wasIn ? STAY_SLACK : 1);
  });
}

/** Someone in the group, and when their face was last found there. */
export interface Member { face: FacePoints; seenAt: number }

/**
 * The group for the cut-out: the front faces now, plus anyone who was in it
 * within the last HOLD_MS and has not been found since, at their last place.
 * Only for the cut-out — an avatar held where a face was would float.
 */
export function holdGroup(front: FacePoints[], held: Member[], now: number): Member[] {
  return [
    ...front.map(face => ({ face, seenAt: now })),
    ...held.filter(m => now - m.seenAt < HOLD_MS && !front.some(f => samePerson(f, m.face))),
  ];
}
