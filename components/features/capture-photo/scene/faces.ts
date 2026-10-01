import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createFaceLandmarker, videoClock } from './vision';

/**
 * Tracking faces for the avatars.
 *
 * MediaPipe's face mesh gives 478 points per face. Its face finder, though,
 * looks at a 128x128 copy of whatever it is given, so a face has to fill a fair
 * share of the picture to be found at all. Tested on a group photo, faces about
 * a twentieth of the frame wide — a group standing back from a booth — were
 * found in none of: the whole frame, its halves, or tall thirds. They were
 * found in roughly square tiles about 40% of the frame wide.
 *
 * So two kinds of pass run over the part of the camera the photo uses: the
 * whole of it every update, which finds anyone close; and one of three
 * overlapping square tiles across its upper part, in turn, which finds people
 * further back. Each pass is its own tracker, so a face it has found is
 * followed from frame to frame without searching again.
 *
 * Points are in the camera's own coordinates, 0–1 across and down the raw
 * frame, before any crop or mirror. `avatars.ts` maps them onto the photo.
 */

export interface FacePoint { x: number; y: number }
export type FacePoints = FacePoint[];

/** A rectangle as fractions of whatever contains it. */
export interface Region { x: number; y: number; w: number; h: number }

const WHOLE: Region = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The tiles, as fractions of the photo's region. Square on a 16:9 picture,
 * overlapping by more than a face's width, and over the upper part only:
 * standing guests do not have faces at their knees.
 */
const TILES: Region[] = [
  { x: 0, y: 0, w: 0.4, h: 0.7 },
  { x: 0.3, y: 0, w: 0.4, h: 0.7 },
  { x: 0.6, y: 0, w: 0.4, h: 0.7 },
];

/** Largest side of the picture a pass is given. The finder uses 128 anyway. */
const PASS_SIZE = 640;

const MIN_INTERVAL_MS = 50;

/**
 * How much of a new position is taken each update. Below 1 so a face that
 * jitters by a pixel does not make its hat shake; high enough that a guest
 * who moves is followed rather than chased.
 */
const FOLLOW = 0.6;

/** Faces closer than this (fraction of the frame) are the same face. */
const SAME_FACE = 0.04;

const NOSE = 1;

function near(a: FacePoints, b: FacePoints, within: number): boolean {
  return Math.hypot(a[NOSE].x - b[NOSE].x, a[NOSE].y - b[NOSE].y) < within;
}

/** Every face once, the first sighting kept. Exported for tests. */
export function dedupe(faces: FacePoints[]): FacePoints[] {
  const out: FacePoints[] = [];
  for (const f of faces) if (!out.some(o => near(o, f, SAME_FACE))) out.push(f);
  return out;
}

function smooth(prev: FacePoints[], next: FacePoints[]): FacePoints[] {
  if (!prev.length) return next;
  return next.map((face) => {
    const was = prev.find(p => p.length === face.length && near(p, face, SAME_FACE * 2));
    if (!was) return face;
    return face.map((pt, i) => ({
      x: was[i].x + (pt.x - was[i].x) * FOLLOW,
      y: was[i].y + (pt.y - was[i].y) * FOLLOW,
    }));
  });
}

/** One tracker over one part of the picture. */
class Pass {
  private clock = videoClock();
  private canvas = document.createElement('canvas');
  /** Its last faces, in camera coordinates, and when it found them. */
  faces: FacePoints[] = [];
  at = -Infinity;

  constructor(private landmarker: FaceLandmarker, readonly tile: Region) {}

  run(video: HTMLVideoElement, region: Region, now: number) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // The tile, inside the region, in camera fractions.
    const fx = region.x + this.tile.x * region.w;
    const fy = region.y + this.tile.y * region.h;
    const fw = this.tile.w * region.w;
    const fh = this.tile.h * region.h;
    const sw = fw * vw;
    const sh = fh * vh;
    const scale = Math.min(1, PASS_SIZE / Math.max(sw, sh));
    const cw = Math.max(1, Math.round(sw * scale));
    const ch = Math.max(1, Math.round(sh * scale));
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    this.canvas.getContext('2d')!.drawImage(video, fx * vw, fy * vh, sw, sh, 0, 0, cw, ch);

    const result = this.landmarker.detectForVideo(this.canvas, this.clock());
    this.faces = result.faceLandmarks.map(face => face.map(({ x, y }) => ({
      x: fx + x * fw,
      y: fy + y * fh,
    })));
    this.at = now;
  }

  close() {
    this.landmarker.close();
  }
}

export class FaceTracker {
  private lastRun = -Infinity;
  private next = 0;
  /** The faces as last seen, smoothed. Empty until the first detection. */
  faces: FacePoints[] = [];

  private constructor(private whole: Pass, private tiles: Pass[]) {}

  static async create(): Promise<FaceTracker> {
    const [whole, ...tiles] = await Promise.all(
      [WHOLE, ...TILES].map(async t => new Pass(await createFaceLandmarker(), t)),
    );
    return new FaceTracker(whole, tiles);
  }

  /** Whole-region faces first, then any the tiles found that it missed. */
  private merged(now: number): FacePoints[] {
    // A tile's answer is kept until it comes round again, and a little longer.
    const fresh = (p: Pass) => now - p.at < MIN_INTERVAL_MS * (this.tiles.length + 1) * 2;
    return dedupe([
      ...this.whole.faces,
      ...this.tiles.filter(fresh).flatMap(p => p.faces),
    ]);
  }

  /**
   * Track this frame, unless the model ran very recently. `region` is the
   * part of the camera the photo uses (the operator's crop), so nobody
   * outside the photo is looked for.
   */
  update(video: HTMLVideoElement, region: Region | null, now = performance.now()) {
    if (now - this.lastRun < MIN_INTERVAL_MS) return;
    if (!video.videoWidth || video.readyState < 2) return;
    this.lastRun = now;
    const r = region ?? WHOLE;
    try {
      this.whole.run(video, r, now);
      this.tiles[this.next].run(video, r, now);
      this.next = (this.next + 1) % this.tiles.length;
      this.faces = smooth(this.faces, this.merged(now));
    } catch (err) {
      console.warn('[booth] Face tracking failed on a frame:', err);
    }
  }

  /**
   * The faces in exactly this frame, every pass, unsmoothed, for the
   * shutter: the photo should have the hat where the head was, not where it
   * was heading.
   */
  detectNow(video: HTMLVideoElement, region: Region | null): FacePoints[] {
    const now = performance.now();
    const r = region ?? WHOLE;
    try {
      this.whole.run(video, r, now);
      for (const t of this.tiles) t.run(video, r, now);
      return this.merged(now);
    } catch {
      return this.faces;
    }
  }

  close() {
    this.whole.close();
    for (const t of this.tiles) t.close();
  }
}
