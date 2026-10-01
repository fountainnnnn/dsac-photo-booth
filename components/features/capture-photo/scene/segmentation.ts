import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { createSegmenter, videoClock } from './vision';
import type { FaceBox } from './front';

/**
 * Finding the people without a green screen.
 *
 * MediaPipe's multiclass selfie segmenter. The plain selfie segmenters are
 * lighter, but on a busy backdrop they ate through faces (dark skin against a
 * dark stage, a bald head against a light one); this one, trained to tell
 * hair, skin and clothes apart, kept every face whole. It looks at 256x256, so
 * it is fed a small copy of the frame — MediaPipe returns the mask at the size
 * of its input, and a full 4K mask every frame was all cost and no detail.
 *
 * Its mask is still low resolution, so edges come out soft once stretched over
 * the photo — which is what the optional clean-up pass at the shutter (see
 * `matting.ts`) is for.
 */

/** Width of the copy the model is given. Twice its own input: enough. */
const INPUT_WIDTH = 512;

/**
 * How often the model runs. It paces itself: never more than every 33ms, and
 * otherwise twice as long as it last took, so on a slow laptop it leaves half
 * the time to the preview instead of starving it.
 */
const MIN_INTERVAL_MS = 33;
const MAX_INTERVAL_MS = 250;

/**
 * How much of each new mask goes into the running one. Less than all of it,
 * so an edge that flickers between frames settles instead of shimmering;
 * not much less, or a guest who moves leaves a ghost behind.
 */
const BLEND = 0.65;

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
 * Only the people whose shape holds one of `faces`; everyone else is zeroed.
 *
 * The mask is split into separate shapes (pixels above SHAPE_THRESHOLD that
 * touch), and a shape is kept if any of it lies within a face's box. People
 * at the back who stand apart from the group drop out. Someone who overlaps a
 * guest in the picture is part of that guest's shape and stays — the camera
 * has no depth to separate them.
 *
 * With no faces at all the mask is returned whole: guests facing away, or a
 * face tracker still loading, must not cut everybody out. Exported for tests.
 */
export function keepPeopleWith(
  values: Float32Array, w: number, h: number, faces: FaceBox[],
): Float32Array {
  if (!faces.length) return values;
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

  const keep = new Set<number>();
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
        if (l) keep.add(l);
      }
    }
  }

  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i++) out[i] = keep.has(labels[i]) ? values[i] : 0;
  return out;
}

export class PersonSegmenter {
  private clock = videoClock();
  private lastRun = -Infinity;
  private interval = MIN_INTERVAL_MS;
  private input = document.createElement('canvas');
  private running: Float32Array | null = null;
  private maskW = 0;
  private maskH = 0;
  /** Whether the first mask is "background", to be inverted into the person. */
  private invert: boolean;
  /** The current mask, as a small canvas; null until the first frame. */
  mask: HTMLCanvasElement | null = null;

  private constructor(private segmenter: ImageSegmenter) {
    this.invert = segmenter.getLabels()[0]?.toLowerCase() === 'background';
  }

  static async create(): Promise<PersonSegmenter> {
    return new PersonSegmenter(await createSegmenter());
  }

  /**
   * Run the model on this frame, unless it ran recently enough. With
   * `focus`, only the people whose shape holds one of those faces are kept
   * (see `keepPeopleWith`); null keeps everyone.
   */
  update(video: HTMLVideoElement, focus: FaceBox[] | null = null, now = performance.now()) {
    if (now - this.lastRun < this.interval) return;
    if (!video.videoWidth || video.readyState < 2) return;
    this.lastRun = now;

    const scale = Math.min(1, INPUT_WIDTH / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    if (this.input.width !== w) this.input.width = w;
    if (this.input.height !== h) this.input.height = h;
    this.input.getContext('2d')!.drawImage(video, 0, 0, w, h);

    try {
      this.segmenter.segmentForVideo(this.input, this.clock(), (result) => {
        const masks = result.confidenceMasks;
        if (!masks?.length) return;
        // The person is everything but "background" for the multiclass
        // model; for a one-channel model it is that channel itself.
        const m = this.invert ? masks[0] : masks[masks.length - 1];
        const raw = m.getAsFloat32Array();
        const fresh = this.invert ? raw.map(v => 1 - v) : raw;
        if (!this.running || this.maskW !== m.width || this.maskH !== m.height) {
          this.running = Float32Array.from(fresh);
          this.maskW = m.width;
          this.maskH = m.height;
        } else {
          for (let i = 0; i < fresh.length; i++) {
            this.running[i] += (fresh[i] - this.running[i]) * BLEND;
          }
        }
        const shown = focus ? keepPeopleWith(this.running, this.maskW, this.maskH, focus) : this.running;
        this.mask = alphaMaskCanvas(shown, this.maskW, this.maskH, this.mask ?? undefined);
      });
    } catch (err) {
      // One bad frame must not stop the preview; the last mask stands.
      console.warn('[booth] Segmentation failed on a frame:', err);
    }
    const took = performance.now() - now;
    this.interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, took * 2));
  }

  close() {
    this.segmenter.close();
  }
}
