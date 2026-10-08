import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { createSegmenter } from './vision';
import type { FaceBox } from './front';
import type { Region } from './faces';
import { recordSpeed } from './speed';
import { countCutout } from './frameRate';

/**
 * Finding the people without a green screen.
 *
 * MediaPipe's multiclass selfie segmenter. The plain selfie segmenters are
 * lighter, but on a busy backdrop they ate through faces (dark skin against a
 * dark stage, a bald head against a light one); this one, trained to tell
 * hair, skin and clothes apart, kept every face whole.
 *
 * It only ever sees 256x256 pixels, so over a whole frame a group's arms are a
 * few of its pixels wide and came out cut short. So it runs twice: every third
 * update over the whole frame, to find where the people are; and every update
 * over just that area, so the people fill its view. On a test
 * group that gave whole arms and hands and complete legs, for the price of a
 * second pass. Both passes are fed small copies — MediaPipe returns the mask
 * at the size of its input, and a full 4K mask was all cost and no detail.
 *
 * Edges are still soft once stretched over the photo, which is what the
 * optional clean-up pass at the shutter (see `matting.ts`) is for.
 */

/** Width of the whole-frame copy. Twice the model's own input: enough. */
const INPUT_WIDTH = 512;

/**
 * Longest side of the close-up copy. The model looks at 256x256 whatever it
 * is given, and returns its mask at the size of the copy, so a bigger copy
 * buys nothing but a bigger mask to read back.
 */
const ZOOM_SIZE = 384;

/**
 * How often the whole frame is looked at again, in updates. Once a second was
 * too seldom: a guest walking across left the close-up's area within it, and
 * outside that area the cut-out was up to a second old, so most of them
 * vanished until it caught up. Every third update is about a tenth of a
 * second on a laptop that keeps up.
 */
const WHOLE_EVERY = 3;

/** Width of the combined mask, enough to keep the close-up's detail. */
const MASK_WIDTH = 960;

/** Confidence at which a pixel counts towards where the people are. */
const BOX_THRESHOLD = 0.5;

/**
 * Margin around the people for the close-up, as a share of their extent:
 * room for a guest to move between one look at the whole frame and the next.
 */
const BOX_PAD = 0.15;

/**
 * How far past the whole-frame pass's people the close-up may add, as a share
 * of the frame's width. Enough for the arm or hand the whole frame cut short;
 * not enough for the flag or chair behind someone, which the close-up alone
 * picked up on a busy stage.
 */
const REACH = 0.02;

/**
 * How often the model runs. It paces itself: never more than every 33ms, and
 * otherwise half as long again as it last took, so on a slow laptop it leaves
 * a third of the time to the preview instead of starving it. (Twice as long
 * left the cut-out trailing guests who moved.)
 */
const MIN_INTERVAL_MS = 33;
const MAX_INTERVAL_MS = 250;

/**
 * How much of each new mask goes into the running one. Less than all of it,
 * so an edge that flickers between frames settles instead of shimmering;
 * not much less, or a guest who moves leaves a ghost behind.
 */
const BLEND = 0.8;

/** Confidence below LO is room, above HI person; between, a soft edge. */
const LO = 0.3;
const HI = 0.7;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * A canvas whose alpha is the mask: opaque where the people are. Drawn with
 * `destination-in` over the camera, it cuts the people out.
 */
export function alphaMaskCanvas(
  values: Float32Array, w: number, h: number,
  into?: HTMLCanvasElement, lo = LO, hi = HI,
): HTMLCanvasElement {
  const canvas = into ?? document.createElement('canvas');
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4 + 3] = Math.round(smoothstep(lo, hi, values[i]) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * The camera with everything but the people transparent, at up to `maxWidth`
 * pixels wide. The mask is stretched to fit; its bilinear upscale is what
 * softens the edge.
 */
export function cutOut(
  video: HTMLVideoElement | HTMLCanvasElement,
  mask: HTMLCanvasElement,
  maxWidth = Infinity,
  into?: HTMLCanvasElement,
): HTMLCanvasElement | null {
  const vw = video instanceof HTMLVideoElement ? video.videoWidth : video.width;
  const vh = video instanceof HTMLVideoElement ? video.videoHeight : video.height;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const canvas = into ?? document.createElement('canvas');
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(video, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Confidence at which a pixel belongs to a person's shape, for telling shapes apart. */
const SHAPE_THRESHOLD = 0.25;

/** How far past a face's own box a person's shape may be found, as a share of the box. */
const FACE_REACH = 0.25;

/**
 * Where one person is, roughly, from their face: the face box widened for
 * hair and ears, and below the chin a body that widens to the shoulders. In
 * mask pixels. Only for sharing out a shape two people make together (see
 * `keepPeopleWith`), so a rough figure is enough.
 */
interface Figure { cx: number; fw: number; chin: number; fh: number; headX0: number; headX1: number; headY0: number }

function figureOf(b: FaceBox, w: number, h: number): Figure {
  const x0 = b.x0 * w, x1 = b.x1 * w, y0 = b.y0 * h, y1 = b.y1 * h;
  const fw = Math.max(1, x1 - x0);
  const fh = Math.max(1, y1 - y0);
  return {
    cx: (x0 + x1) / 2, fw, chin: y1, fh,
    headX0: x0 - fw * 0.35, headX1: x1 + fw * 0.35, headY0: y0 - fh * 0.5,
  };
}

/** How far a mask pixel is from a figure, in pixels; 0 inside it. */
function distanceToFigure(f: Figure, x: number, y: number): number {
  if (y < f.headY0) {
    const dx = x < f.headX0 ? f.headX0 - x : x > f.headX1 ? x - f.headX1 : 0;
    return Math.hypot(dx, f.headY0 - y);
  }
  let left = f.headX0, right = f.headX1;
  if (y > f.chin) {
    // Neck at the chin, shoulders a little under a face's height below it.
    const t = Math.min(1, (y - f.chin) / (0.8 * f.fh));
    const half = f.fw * (0.5 + 1.3 * t);
    left = f.cx - half;
    right = f.cx + half;
  }
  return x < left ? left - x : x > right ? x - right : 0;
}

/**
 * Only the people whose shape holds one of `keep`'s faces; everyone else is
 * zeroed.
 *
 * The mask is split into separate shapes (pixels above SHAPE_THRESHOLD that
 * touch), and a shape is kept if any of it lies within a kept face's box.
 * People at the back who stand apart from the group drop out.
 *
 * Someone left out who overlaps a guest in the picture makes one shape with
 * them, and the camera has no depth to part them; kept whole, half of the
 * person behind showed through. So a shape holding a face from `drop` as well
 * is shared out: each pixel goes to the person whose figure (see `figureOf`)
 * it is in, or nearest to, and the ones that go to a dropped face are zeroed.
 * Where figures overlap, the kept one wins: the nearer person is in front.
 *
 * With no faces at all the mask is returned whole: guests facing away, or a
 * face tracker still loading, must not cut everybody out. Exported for tests.
 */
export function keepPeopleWith(
  values: Float32Array, w: number, h: number, keep: FaceBox[], drop: FaceBox[] = [],
): Float32Array {
  if (!keep.length && !drop.length) return values;
  // Runs every few frames on a 512-wide mask, so no allocation per pixel.
  const size = w * h;
  const labels = new Int32Array(size);
  const stack = new Int32Array(size);
  let next = 0;
  for (let start = 0; start < size; start++) {
    if (labels[start] || values[start] < SHAPE_THRESHOLD) continue;
    next += 1;
    labels[start] = next;
    let top = 0;
    stack[top++] = start;
    while (top) {
      const i = stack[--top];
      const x = i % w;
      if (x > 0 && !labels[i - 1] && values[i - 1] >= SHAPE_THRESHOLD) { labels[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && !labels[i + 1] && values[i + 1] >= SHAPE_THRESHOLD) { labels[i + 1] = next; stack[top++] = i + 1; }
      if (i >= w && !labels[i - w] && values[i - w] >= SHAPE_THRESHOLD) { labels[i - w] = next; stack[top++] = i - w; }
      if (i < size - w && !labels[i + w] && values[i + w] >= SHAPE_THRESHOLD) { labels[i + w] = next; stack[top++] = i + w; }
    }
  }

  /** The shapes that lie within any of these faces' boxes. */
  const shapesHolding = (faces: FaceBox[]) => {
    const found = new Set<number>();
    for (const b of faces) {
      const padX = (b.x1 - b.x0) * FACE_REACH;
      const padY = (b.y1 - b.y0) * FACE_REACH;
      const x0 = Math.max(0, Math.floor((b.x0 - padX) * w));
      const x1 = Math.min(w - 1, Math.ceil((b.x1 + padX) * w));
      const y0 = Math.max(0, Math.floor((b.y0 - padY) * h));
      const y1 = Math.min(h - 1, Math.ceil((b.y1 + padY) * h));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const l = labels[y * w + x];
          if (l) found.add(l);
        }
      }
    }
    return found;
  };
  const kept = shapesHolding(keep);
  const shared = drop.length ? shapesHolding(drop) : new Set<number>();

  const keepFigures = keep.map(b => figureOf(b, w, h));
  const dropFigures = drop.map(b => figureOf(b, w, h));
  const nearest = (figures: Figure[], x: number, y: number) => {
    let best = Infinity;
    for (const f of figures) best = Math.min(best, distanceToFigure(f, x, y));
    return best;
  };

  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i++) {
    const l = labels[i];
    if (!kept.has(l)) continue;
    if (shared.has(l)) {
      const x = i % w;
      const y = (i - x) / w;
      if (nearest(dropFigures, x, y) < nearest(keepFigures, x, y)) continue;
    }
    out[i] = values[i];
  }
  return out;
}

/** A person mask: confidence 0–1 per pixel, `w` x `h`. */
export interface Mask { data: Float32Array; w: number; h: number }

/**
 * Where the people are in a whole-frame mask, as a region of the frame with a
 * margin, or null for nobody. With `invert` the mask holds "background".
 * Exported for tests.
 */
export function peopleRegion(mask: Mask, invert = false, threshold = BOX_THRESHOLD, pad = BOX_PAD): Region | null {
  let x0 = mask.w, y0 = mask.h, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.h; y++) {
    const row = y * mask.w;
    for (let x = 0; x < mask.w; x++) {
      const v = mask.data[row + x];
      if ((invert ? 1 - v : v) < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const fx0 = x0 / mask.w, fx1 = (x1 + 1) / mask.w;
  const fy0 = y0 / mask.h, fy1 = (y1 + 1) / mask.h;
  const px = (fx1 - fx0) * pad, py = (fy1 - fy0) * pad;
  const rx0 = Math.max(0, fx0 - px), ry0 = Math.max(0, fy0 - py);
  const rx1 = Math.min(1, fx1 + px), ry1 = Math.min(1, fy1 + py);
  return { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
}

/**
 * One whole-frame mask of `w` x `h`: the close-up inside its region, the
 * whole-frame pass everywhere else. Exported for tests.
 *
 * With `invert`, the masks hold "background" and are turned into "person" on
 * the way. With `into`, the result is blended into that running mask by
 * `blend` rather than returned fresh — one pass over the pixels, not three.
 */
export function combineMasks(
  whole: Mask, close: Mask | null, region: Region | null, w: number, h: number,
  { invert = false, into, blend = 1, reach }: {
    invert?: boolean; into?: Float32Array; blend?: number;
    /** Where the close-up may count, 0–1, at the whole mask's size (see `reachOf`). */
    reach?: Float32Array;
  } = {},
): Float32Array {
  const out = into ?? new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / h;
    const wholeRow = Math.min(whole.h - 1, Math.floor(fy * whole.h)) * whole.w;
    const inRows = close && region && fy >= region.y && fy < region.y + region.h;
    const closeRow = inRows
      ? Math.min(close.h - 1, Math.floor(((fy - region.y) / region.h) * close.h)) * close.w
      : 0;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      const wi = wholeRow + Math.min(whole.w - 1, Math.floor(fx * whole.w));
      let v: number;
      if (inRows && fx >= region.x && fx < region.x + region.w) {
        v = close.data[closeRow + Math.min(close.w - 1, Math.floor(((fx - region.x) / region.w) * close.w))];
        if (invert) v = 1 - v;
        if (reach) v *= reach[wi];
      } else {
        v = whole.data[wi];
        if (invert) v = 1 - v;
      }
      const i = y * w + x;
      out[i] = into ? out[i] + (v - out[i]) * blend : v;
    }
  }
  return out;
}

/**
 * Where the close-up may count: 1 on and near the whole-frame pass's people,
 * fading to 0 beyond REACH. A blur of their shape, on the graphics chip.
 * Exported for tests.
 */
export function reachOf(whole: Mask, invert: boolean): Float32Array {
  const person = new Float32Array(whole.data.length);
  for (let i = 0; i < person.length; i++) person[i] = invert ? 1 - whole.data[i] : whole.data[i];
  const shape = alphaMaskCanvas(person, whole.w, whole.h);
  const c = document.createElement('canvas');
  c.width = whole.w;
  c.height = whole.h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = `blur(${Math.max(1, Math.round(whole.w * REACH))}px)`;
  ctx.drawImage(shape, 0, 0);
  const { data } = ctx.getImageData(0, 0, whole.w, whole.h);
  const out = new Float32Array(whole.w * whole.h);
  // Times three: full strength well into the blur's fade, not just at its core.
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, (data[i * 4 + 3] / 255) * 3);
  return out;
}

export class PersonSegmenter {
  private lastRun = -Infinity;
  private sinceWhole = Infinity;
  private interval = MIN_INTERVAL_MS;
  private wholeInput = document.createElement('canvas');
  private closeInput = document.createElement('canvas');
  private whole: Mask | null = null;
  private reach: Float32Array | null = null;
  private region: Region | null = null;
  private running: Float32Array | null = null;
  /** An all-room mask, for when faces were found but nobody is in the group. */
  private empty: Float32Array | null = null;
  private maskW = 0;
  private maskH = 0;
  /** Whether the first mask is "background", to be inverted into the person. */
  private invert: boolean;
  /** The current mask, as a canvas the shape of the frame; null until the first. */
  mask: HTMLCanvasElement | null = null;

  private constructor(private segmenter: ImageSegmenter) {
    this.invert = segmenter.getLabels()[0]?.toLowerCase() === 'background';
  }

  static async create(): Promise<PersonSegmenter> {
    return new PersonSegmenter(await createSegmenter());
  }

  /** The person mask for one picture. */
  private run(input: HTMLCanvasElement): Mask | null {
    let out: Mask | null = null;
    this.segmenter.segment(input, (result) => {
      const masks = result.confidenceMasks;
      if (!masks?.length) return;
      // The person is everything but "background" for the multiclass model;
      // for a one-channel model it is that channel itself.
      // Copied: the mask is only valid inside this callback. Inverting waits
      // for combineMasks, which touches every pixel anyway.
      const m = this.invert ? masks[0] : masks[masks.length - 1];
      out = { data: Float32Array.from(m.getAsFloat32Array()), w: m.width, h: m.height };
    });
    return out;
  }

  /**
   * Run the model on this frame, unless it ran recently enough. With
   * `focus`, only the people whose shape holds one of the `keep` faces are
   * kept, minus whatever of a shared shape belongs to a `drop` face (see
   * `keepPeopleWith`); no `keep` faces keeps nobody, since faces were found and
   * none of them is in the group. Null keeps everyone. True when it ran, so the
   * caller can leave other heavy work to the next frame.
   */
  update(
    video: HTMLVideoElement,
    focus: { keep: FaceBox[]; drop: FaceBox[] } | null = null,
    now = performance.now(),
  ): boolean {
    if (now - this.lastRun < this.interval) return false;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || video.readyState < 2) return false;
    this.lastRun = now;

    try {
      if (!this.whole || !this.region || this.sinceWhole >= WHOLE_EVERY - 1) {
        const scale = Math.min(1, INPUT_WIDTH / vw);
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        if (this.wholeInput.width !== w) this.wholeInput.width = w;
        if (this.wholeInput.height !== h) this.wholeInput.height = h;
        this.wholeInput.getContext('2d')!.drawImage(video, 0, 0, w, h);
        this.whole = this.run(this.wholeInput) ?? this.whole;
        this.region = this.whole ? peopleRegion(this.whole, this.invert) : null;
        this.reach = this.whole ? reachOf(this.whole, this.invert) : null;
        this.sinceWhole = 0;
      } else {
        this.sinceWhole += 1;
      }
      if (!this.whole) return true;

      let close: Mask | null = null;
      const r = this.region;
      if (r) {
        const sw = r.w * vw;
        const sh = r.h * vh;
        const scale = Math.min(1, ZOOM_SIZE / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        if (this.closeInput.width !== w) this.closeInput.width = w;
        if (this.closeInput.height !== h) this.closeInput.height = h;
        this.closeInput.getContext('2d')!.drawImage(video, r.x * vw, r.y * vh, sw, sh, 0, 0, w, h);
        close = this.run(this.closeInput);
      }

      const mw = MASK_WIDTH;
      const mh = Math.max(1, Math.round((MASK_WIDTH * vh) / vw));
      if (!this.running || this.maskW !== mw || this.maskH !== mh) {
        this.running = combineMasks(this.whole, close, r, mw, mh, { invert: this.invert, reach: this.reach ?? undefined });
        this.maskW = mw;
        this.maskH = mh;
      } else {
        combineMasks(this.whole, close, r, mw, mh, {
          invert: this.invert, into: this.running, blend: BLEND, reach: this.reach ?? undefined,
        });
      }
      let shown = this.running;
      if (focus?.keep.length) {
        shown = keepPeopleWith(this.running, mw, mh, focus.keep, focus.drop);
      } else if (focus) {
        if (this.empty?.length !== mw * mh) this.empty = new Float32Array(mw * mh);
        shown = this.empty;
      }
      this.mask = alphaMaskCanvas(shown, mw, mh, this.mask ?? undefined);
      countCutout();
    } catch (err) {
      // One bad frame must not stop the preview; the last mask stands.
      console.warn('[booth] Segmentation failed on a frame:', err);
    } finally {
      const took = performance.now() - now;
      recordSpeed('segment', took);
      this.interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, took * 1.5));
    }
    return true;
  }

  close() {
    this.segmenter.close();
  }
}
