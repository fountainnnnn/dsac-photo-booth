import type { FacePoints } from './faces';

/**
 * Who the photo is of: the people nearer the camera than a line.
 *
 * A booth at an open house has a queue behind it and people walking past.
 * They should not get avatars, and with no green screen they should not be
 * cut out and pasted onto the background either. The camera has no depth, but
 * faces shrink with distance, so how big a face is says how far away it is
 * (`faceDistance`).
 *
 * Everyone nearer than the line the operator sets in Settings (`frontLineM`)
 * is the group, however many — or, when Settings says how many are posing
 * (`maxPeople`), only that many of them, the nearest. Everyone else is left
 * out. The metres rest on a guess at the camera's lens until it is calibrated
 * at the venue — someone stands a measured distance away and Settings works
 * out the correction (`distanceScale`). A child still counts: a smaller face
 * reads as a little further away, not as a few metres.
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
 * The span between the outer corners of the eyes, in metres: an adult's,
 * roughly. Calibration corrects for whatever this and the lens below get wrong.
 */
const EYE_SPAN_M = 0.09;

/**
 * Height of the face mesh, forehead to chin, in metres, roughly: for a face
 * with no depth measured, which only tests make now.
 */
const FACE_HEIGHT_M = 0.17;

/** A laptop webcam's horizontal field of view, roughly, before calibration. */
const CAMERA_HFOV_DEG = 70;

/** Face-mesh points: the outer corner of each eye. See MediaPipe's canonical face. */
const EYE_OUTER_A = 33;
const EYE_OUTER_B = 263;

/**
 * What turning a face's size into metres needs to know about the camera: the
 * picture's height over its width, and the calibration's correction (1 until
 * calibrated).
 */
export interface CameraModel { aspect: number; scale: number }

export const DEFAULT_CAMERA: CameraModel = { aspect: 9 / 16, scale: 1 };

/** Where the line is until the operator moves it, in metres. */
export const DEFAULT_LINE_M = 2;

/** Once in, a guest stays until this much past the line. */
const STAY_SLACK = 1.15;

/**
 * At most this many people in the group, the nearest; 0 for no limit. Settings
 * sets it (`maxPeople`) when the operator knows how many are posing, so a
 * crowd inside the line still cannot get in.
 */
export const DEFAULT_MAX_PEOPLE = 0;

/**
 * With a limit, someone already in the group is counted this much nearer than
 * they are, so two guests at much the same distance do not trade places every
 * time the tracker's estimate wobbles.
 */
const CAP_SLACK = 1.1;

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
 * How far a face is from the camera, in metres, from the span between the
 * outer corners of its eyes, measured in three dimensions.
 *
 * The face's width came first, and narrowed sharply when a guest turned their
 * head: a guest turned towards a friend for the photo was judged to be well
 * back and dropped out. Its height came next, which a turn barely touches —
 * but looking down shortens it and a smile or an open mouth lengthens it, so
 * the reading wandered for someone standing still. The eyes'
 * span with the mesh's depth included is the same whichever way the head
 * turns or tilts, and no expression moves the corners of the eyes.
 */
export function faceDistance(face: FacePoints, camera: CameraModel = DEFAULT_CAMERA): number {
  const halfH = ((CAMERA_HFOV_DEG / 2) * Math.PI) / 180;
  const a = face[EYE_OUTER_A];
  const b = face[EYE_OUTER_B];
  if (a?.z !== undefined && b?.z !== undefined) {
    // In shares of the picture's width throughout: y is a share of its
    // height, so it is scaled by the aspect.
    const span = Math.hypot(b.x - a.x, (b.y - a.y) * camera.aspect, b.z - a.z);
    if (!(span > 0)) return Infinity;
    return (EYE_SPAN_M / (2 * span * Math.tan(halfH))) * camera.scale;
  }
  // No depth: the face's height, against the matching vertical view.
  const box = faceBox(face);
  const h = box.y1 - box.y0;
  if (!(h > 0)) return Infinity;
  return (FACE_HEIGHT_M / (2 * h * Math.tan(halfH) * camera.aspect)) * camera.scale;
}

/** The nearest face's distance, in metres, or null for no faces. */
export function nearestDistance(faces: FacePoints[], camera: CameraModel = DEFAULT_CAMERA): number | null {
  return faces.length ? Math.min(...faces.map(f => faceDistance(f, camera))) : null;
}

function samePerson(a: FacePoints, b: FacePoints): boolean {
  return Math.hypot(a[NOSE].x - b[NOSE].x, a[NOSE].y - b[NOSE].y) < SAME_PERSON;
}

/**
 * The faces of the people nearer than `lineM`, and of those only the
 * `maxPeople` nearest (0 for all of them). `previous` is the group as it was
 * last time, for stickiness; pass [] the first time.
 */
export function frontFaces(
  faces: FacePoints[], previous: FacePoints[], lineM = DEFAULT_LINE_M,
  maxPeople = DEFAULT_MAX_PEOPLE, camera: CameraModel = DEFAULT_CAMERA,
): FacePoints[] {
  const wasIn = (face: FacePoints) => previous.some(p => samePerson(p, face));
  const dist = (face: FacePoints) => faceDistance(face, camera);
  const within = faces.filter(face => dist(face) <= lineM * (wasIn(face) ? STAY_SLACK : 1));
  if (!(maxPeople > 0) || within.length <= maxPeople) return within;

  const nearest = new Set(within
    .map(face => ({ face, d: dist(face) / (wasIn(face) ? CAP_SLACK : 1) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, maxPeople)
    .map(x => x.face));
  return within.filter(face => nearest.has(face));
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
