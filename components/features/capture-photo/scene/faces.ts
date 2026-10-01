import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createFaceLandmarker, videoClock } from './vision';
import { recordSpeed } from './speed';

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
 * whole of it every update, which finds anyone close and follows them frame to
 * frame; and one of three overlapping square tiles across its upper part, in
 * turn, which finds people further back.
 *
 * The tiles look afresh each time rather than following. Following, a tile
 * visited every third update kept a face where it had been after it moved
 * away, and a moving guest got a second, ghost pair of glasses. For the same
 * reason a face a tile sees cut by one of its inner edges is dropped — the
 * mesh fits a half face badly — and two faces whose boxes overlap are taken
 * to be one person.
 *
 * And a tile only reports small faces. On a live camera the centre tile once
 * found a large face in a mottled grey backdrop that was not there; a face
 * that large would have been found by the whole-region pass, which did not
 * see it. Tiles exist for the faces too small for that pass, so anything
 * bigger from a tile alone is taken to be a mistake.
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
 * How long a tile's faces stand before they are dropped, if the tile has not
 * come round again. Each tile only runs every third update, and on a slow
 * laptop an update takes far longer than MIN_INTERVAL_MS: a window counted in
 * intervals expired faces before their tile came back, and avatars on a group
 * standing back flickered on and off.
 */
const TILE_MAX_AGE_MS = 1500;

/**
 * How much of a new position is taken each update. Below 1 so a face that
 * jitters by a pixel does not make its hat shake; high enough that a guest
 * who moves is followed rather than chased.
 */
const FOLLOW = 0.6;

/** Faces closer than this (fraction of the frame) are the same face, for smoothing. */
const SAME_FACE = 0.04;

/** Two face boxes sharing more than this of the smaller one are one person. */
const SAME_PERSON_OVERLAP = 0.2;

/** How close to a tile's inner edge (fraction of the tile) a face may come. */
const EDGE_MARGIN = 0.02;

/**
 * Widest face a tile may report, as a fraction of the region's width. The
 * whole-region pass found a face 0.12 wide and missed ones about 0.06 wide.
 */
const MAX_TILE_FACE = 0.11;

const NOSE = 1;

function near(a: FacePoints, b: FacePoints, within: number): boolean {
  return Math.hypot(a[NOSE].x - b[NOSE].x, a[NOSE].y - b[NOSE].y) < within;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function box(face: FacePoints): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of face) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** Overlap as a share of the smaller box. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const area = (r: Box) => (r.x1 - r.x0) * (r.y1 - r.y0);
  return (w * h) / Math.max(1e-9, Math.min(area(a), area(b)));
}

/** Every person once, the first sighting kept. Exported for tests. */
export function dedupe(faces: FacePoints[]): FacePoints[] {
  const out: FacePoints[] = [];
  const boxes: Box[] = [];
  for (const f of faces) {
    const b = box(f);
    if (boxes.some(o => overlap(o, b) > SAME_PERSON_OVERLAP)) continue;
    out.push(f);
    boxes.push(b);
  }
  return out;
}

/** Whether a face a tile found is too big to be one the tiles are for. Exported for tests. */
export function tooBigForTile(face: FacePoints, tile: Region): boolean {
  const b = box(face);
  return (b.x1 - b.x0) * tile.w > MAX_TILE_FACE;
}

/**
 * Whether a face, in a tile's own 0–1 coordinates, is cut by one of the
 * tile's inner edges. Edges that are also the edge of the region do not
 * count: a face cut there is cut in the photo too. Exported for tests.
 */
export function cutByTileEdge(face: FacePoints, tile: Region): boolean {
  const b = box(face);
  return (tile.x > 0 && b.x0 < EDGE_MARGIN)
    || (tile.x + tile.w < 1 && b.x1 > 1 - EDGE_MARGIN)
    || (tile.y > 0 && b.y0 < EDGE_MARGIN)
    || (tile.y + tile.h < 1 && b.y1 > 1 - EDGE_MARGIN);
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

/** One search over one part of the picture. */
class Pass {
  private clock = videoClock();
  private canvas = document.createElement('canvas');
  /** Its last faces, in camera coordinates, and when it found them. */
  faces: FacePoints[] = [];
  at = -Infinity;

  /** `follows`: VIDEO mode, tracking between frames, for the whole region. */
  constructor(private landmarker: FaceLandmarker, readonly tile: Region, private follows: boolean) {}

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

    const result = this.follows
      ? this.landmarker.detectForVideo(this.canvas, this.clock())
      : this.landmarker.detect(this.canvas);
    this.faces = result.faceLandmarks
      .filter(face => this.follows || (!cutByTileEdge(face, this.tile) && !tooBigForTile(face, this.tile)))
      .map(face => face.map(({ x, y }) => ({ x: fx + x * fw, y: fy + y * fh })));
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
    const [whole, ...tiles] = await Promise.all([
      createFaceLandmarker('VIDEO').then(l => new Pass(l, WHOLE, true)),
      ...TILES.map(t => createFaceLandmarker('IMAGE').then(l => new Pass(l, t, false))),
    ]);
    return new FaceTracker(whole, tiles);
  }

  /** Whole-region faces first, then any the tiles found that it missed. */
  private merged(now: number): FacePoints[] {
    // A tile's answer stands until it comes round again (it is replaced then),
    // or until it is too old to trust.
    const fresh = (p: Pass) => now - p.at < TILE_MAX_AGE_MS;
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
    recordSpeed('faces', performance.now() - now);
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
