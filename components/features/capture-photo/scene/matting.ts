import type { InferenceSession } from 'onnxruntime-web';
import { alphaMaskCanvas } from './segmentation';
import { recordSpeed } from './speed';

/**
 * The edge clean-up pass: re-cutting the people once, at the shutter, with a
 * model built for hair and fine edges.
 *
 * The live segmenter is fast because it looks at a 256x256 picture, and its
 * mask is soft once stretched over a photo. MODNet (Apache 2.0) is a portrait
 * matting model: it looks at about 900x512 and returns a proper matte. Too
 * slow for every frame on a weak laptop, fine for one photo.
 *
 * On its own it also keeps anything that stands out — on a busy stage it kept
 * the flags and a chair — and it leaves holes the segmenter does not. So the
 * two are combined: the segmenter decides where the people are, MODNet adds
 * the detail at their edges. See `combine`.
 *
 * It runs on the graphics chip through WebGPU where the browser has it, and on
 * the CPU otherwise: measured in Chrome on a laptop, 190ms against 1.3s. The
 * weights are the full-precision ones: the 8-bit copy, a quarter the size,
 * left holes through people's bodies, and was no faster.
 *
 * onnxruntime-web is split into its own chunk and Vite emits its wasm as an
 * asset. The model itself is committed in `public/matting/`.
 */

const MODEL = '/matting/modnet.onnx';
/** MODNet wants each side a multiple of 32, about 512 on the short side. */
const SHORT_SIDE = 512;
const STEP = 32;

let session: Promise<InferenceSession> | null = null;

/**
 * Start loading now, so the first photo does not wait for twenty megabytes —
 * and run the model once on a blank picture the shape of a webcam's. The
 * graphics chip prepares its work for each picture size on first use, which
 * took longer than the model itself: the first photo with clean-up on took
 * over four seconds, the ones after it well under one.
 */
export function preloadMatting(): Promise<InferenceSession> {
  session ??= (async () => {
    const ort = await import('onnxruntime-web/webgpu');
    // No cross-origin isolation here, so no threads for the CPU fallback; say
    // so rather than have the runtime try and warn.
    ort.env.wasm.numThreads = 1;
    // NCHW: in its default layout WebGPU got a quarter of MODNet's pixels
    // wrong — holes through people — while matching the CPU exactly in this
    // one, at about the same speed.
    const sess = await ort.InferenceSession.create(MODEL, {
      executionProviders: [{ name: 'webgpu', preferredLayout: 'NCHW' }, 'wasm'],
    });
    const { w, h } = modelSize(16, 9);
    await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', new Float32Array(3 * w * h), [1, 3, h, w]) });
    return sess;
  })();
  session.catch(() => { session = null; });
  return session;
}

/** The model's input size for a picture of this shape. */
export function modelSize(w: number, h: number): { w: number; h: number } {
  const scale = SHORT_SIDE / Math.min(w, h);
  const round = (v: number) => Math.max(STEP, Math.round((v * scale) / STEP) * STEP);
  return { w: round(w), h: round(h) };
}

/** A mask canvas's alpha at a given size, 0–1, optionally blurred. */
function alphaAt(mask: HTMLCanvasElement, w: number, h: number, blurPx = 0): Float32Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (blurPx) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(mask, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] / 255;
  return out;
}

/**
 * The segmenter's mask, with MODNet's detail added near it.
 *
 * Close to a person's edge (the segmenter's mask, blurred outwards by about
 * one percent of the width) MODNet's matte is taken where it says more person
 * than the segmenter does: hair, fingers, a sleeve's edge. Further out it is
 * ignored, which is what drops the flags — a wider reach, tried first, let
 * pieces of them back in. Nowhere does it take away from the
 * segmenter, which is what keeps its holes from becoming the photo's.
 */
export function combine(modnet: Float32Array, seg: Float32Array, near: Float32Array): Float32Array {
  const out = new Float32Array(modnet.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(seg[i], modnet[i] * Math.min(1, near[i] * 2));
  }
  return out;
}

/**
 * A matte of the people in this frame, as a canvas whose alpha is the matte
 * (see `alphaMaskCanvas`), or null if the model could not run. A null is
 * never fatal: the shutter falls back to the live mask.
 *
 * `people` is the live segmenter's mask; without one, MODNet's matte is used
 * as it is.
 */
export async function matte(
  source: HTMLVideoElement | HTMLCanvasElement,
  people: HTMLCanvasElement | null,
): Promise<HTMLCanvasElement | null> {
  const started = performance.now();
  try {
    const sess = await preloadMatting();
    const ort = await import('onnxruntime-web/webgpu');

    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!sw || !sh) return null;
    const { w, h } = modelSize(sw, sh);

    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    // NCHW, scaled to -1..1 as MODNet was trained.
    const plane = w * h;
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      input[i] = data[i * 4] / 127.5 - 1;
      input[plane + i] = data[i * 4 + 1] / 127.5 - 1;
      input[2 * plane + i] = data[i * 4 + 2] / 127.5 - 1;
    }

    const feeds = { [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) };
    const out = await sess.run(feeds);
    const tensor = out[sess.outputNames[0]];
    const [oh, ow] = tensor.dims.slice(-2);
    let values = tensor.data as Float32Array;
    if (people) {
      const seg = alphaAt(people, ow, oh);
      const near = alphaAt(people, ow, oh, Math.max(2, Math.round(ow * 0.01)));
      values = combine(values, seg, near);
    }
    // A matte is already soft at the edges, so it keeps its whole 0–1 range
    // rather than being squeezed the way the segmenter's confidence is.
    const matteCanvas = alphaMaskCanvas(values, ow, oh, undefined, 0, 1);
    recordSpeed('cleanup', performance.now() - started);
    return matteCanvas;
  } catch (err) {
    console.warn('[booth] Edge clean-up failed; using the live mask:', err);
    return null;
  }
}
