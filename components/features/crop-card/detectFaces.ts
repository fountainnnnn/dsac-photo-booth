/**
 * Finding the faces in a photo, so a crop can be sized to a person.
 *
 * This used to lean on the browser's own `FaceDetector`, described as an
 * enhancement over tapping. Testing it on real event photographs showed the
 * enhancement never happens: `FaceDetector` is absent from Safari and Firefox
 * and unreliable elsewhere, so every crop in practice was the fallback — a box
 * sized for somebody standing close to the camera. On a group photographed
 * across a room that box took in three or four people at once, which is not a
 * card of just you.
 *
 * So the booth ships its own model, and runs it where the cost is bearable.
 * The runtime is about twelve megabytes: paid once on a laptop that is open all
 * day, that is nothing; paid by three hundred guests on mobile data through the
 * tunnel, it is several gigabytes and a slow first tap for every one of them.
 * The kiosk therefore detects once, just after the shutter, and the boxes reach
 * the guest as a few hundred bytes of JSON.
 *
 * The detection itself lives in `public/vision/tiledFaces.mjs`, unbundled, and
 * is loaded by URL at the moment it is wanted. That is what guarantees none of
 * it can reach a guest's phone: there is no import for a bundler to follow.
 */

import type { Rect } from './cropGeometry';

const MODULE_URL = '/vision/tiledFaces.mjs';

interface TiledFaces {
  detectFacesTiled(image: HTMLImageElement | HTMLCanvasElement): Promise<Rect[]>;
}

/** Resolved once. A failed load stays failed rather than retrying per photo. */
let modulePromise: Promise<TiledFaces | null> | null = null;

function load(): Promise<TiledFaces | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        // A variable, and annotated, so the bundler leaves it alone: this must
        // stay a runtime fetch of a file in `public/`, never an inlined import.
        const url = /* @vite-ignore */ MODULE_URL;
        return await import(url) as TiledFaces;
      } catch {
        return null;
      }
    })();
  }
  return modulePromise;
}

/** Whether detection could run here at all. Cheap to ask, downloads nothing. */
export function detectionAvailable(): boolean {
  return typeof window !== 'undefined' && typeof WebAssembly !== 'undefined';
}

/**
 * Face boxes in the image's own pixels, or an empty array.
 *
 * Never throws. Every failure — no runtime, no WebGL, a model that will not
 * load, an image the detector chokes on — means the same thing to the caller,
 * which is "let them place the crop by tapping instead".
 */
export async function detectFaces(
  image: HTMLImageElement | HTMLCanvasElement,
): Promise<Rect[]> {
  if (!detectionAvailable()) return [];
  try {
    const mod = await load();
    if (!mod) return [];
    return await mod.detectFacesTiled(image);
  } catch {
    return [];
  }
}

/**
 * Detect on a decoded copy of `src`, for callers holding a data URL rather than
 * an element. This is the kiosk's entry point, used on the composed photo it
 * has just uploaded.
 */
export async function detectFacesIn(src: string): Promise<Rect[]> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    return await detectFaces(img);
  } catch {
    return [];
  }
}
