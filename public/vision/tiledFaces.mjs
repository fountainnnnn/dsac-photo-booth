/**
 * Face detection for the booth, in one place.
 *
 * Plain ESM served from `public/` rather than bundled, for two reasons. The
 * runtime it loads is about twelve megabytes, and nothing that a guest's phone
 * fetches should be able to pull that in by accident — kept out of the bundle,
 * it cannot. And the operator's backfill page is a static file that has no
 * bundler behind it, so a shared module is the only way both callers can run
 * the same code rather than two drifting copies of it.
 *
 * Everything here is allowed to fail. A photo with no boxes is not an error;
 * it means the guest places the crop by tapping, which still works.
 */

import { FilesetResolver, FaceDetector } from './vision_bundle.mjs';

const WASM_DIR = new URL('./wasm', import.meta.url).href;
const MODEL = new URL('./blaze_face_short_range.tflite', import.meta.url).href;

/**
 * How much of the frame a face has to fill before the model can see it.
 *
 * The model scales whatever it is given down to a small square before looking,
 * so what matters is not how many pixels a face has but what fraction of the
 * frame it occupies. A guest posing at the booth fills plenty of it. A row of
 * people photographed across a room does not: on this booth's own gallery a
 * face there is about three per cent of the width, which survives the downscale
 * as a handful of pixels and is found nowhere.
 *
 * So the picture is searched again in tiles. A face that is three per cent of a
 * whole photograph is a fifth of a sixth-sized tile, which the model finds
 * easily.
 *
 * Every pass runs and the results are merged, rather than stopping at the first
 * that finds anything. Stopping was quicker and wrong: on a six-person group the
 * coarse pass found two faces and returned, leaving four guests to crop by hand.
 * A close-up needs the whole-image pass, because a face larger than a tile is
 * invisible to the fine ones; a distant group needs the fine passes. Only doing
 * both finds everybody. It costs a couple of seconds, spent in the background
 * after the guest already has their QR code.
 */
const TILE_PASSES = [1, 3, 6];

/** How far a tile reaches into its neighbour, so a face on a seam is whole
 *  in at least one of them. */
const TILE_OVERLAP = 0.25;

/** Two boxes are the same face when they overlap this much. */
const SAME_FACE_IOU = 0.3;

/**
 * How sure the model has to be before a box counts as a face.
 *
 * Searching in tiles finds more faces and also more things that are not faces —
 * a fold in a seat back, a pattern on a wall. Measured across this booth's own
 * gallery the two separate cleanly: real faces came back at 0.75 to 0.97, and
 * every false one at 0.56 to 0.60. Seven tenths sits in the gap.
 *
 * Erring high is the right way round. A missed face costs a guest one tap and a
 * drag, which is what they did before any of this existed. A false one puts a
 * crop box on a chair.
 */
const MIN_CONFIDENCE = 0.7;

let detectorPromise = null;

/** Built once and kept: creating it loads the runtime, and the kiosk takes
 *  hundreds of photos in a session. */
export function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
        return await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL },
          runningMode: 'IMAGE',
          minDetectionConfidence: MIN_CONFIDENCE,
        });
      } catch {
        // No runtime, no WebGL, or a device that cannot manage it.
        return null;
      }
    })();
  }
  return detectorPromise;
}

function iou(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const overlap = x * y;
  const union = a.w * a.h + b.w * b.h - overlap;
  return union > 0 ? overlap / union : 0;
}

/** Drop boxes that are the same face seen in two overlapping tiles. */
function dedupe(boxes) {
  const kept = [];
  // Biggest first, so the tile that saw most of the face wins.
  for (const box of [...boxes].sort((p, q) => q.w * q.h - p.w * p.h)) {
    if (!kept.some(k => iou(k, box) > SAME_FACE_IOU)) kept.push(box);
  }
  return kept;
}

function boxesOf(detector, source) {
  const out = detector.detect(source);
  return (out?.detections ?? [])
    // Filtered here as well as in the options: the threshold is the thing
    // keeping crop boxes off the furniture, and it should not depend on one
    // option name staying put across versions of the runtime.
    .filter(d => (d.categories?.[0]?.score ?? 0) >= MIN_CONFIDENCE)
    .map(d => d.boundingBox)
    .filter(Boolean)
    .map(b => ({ x: b.originX, y: b.originY, w: b.width, h: b.height }))
    .filter(r => r.w > 0 && r.h > 0);
}

/** Face boxes in the image's own pixels. Never throws; returns [] on failure. */
export async function detectFacesTiled(image) {
  try {
    const detector = await getDetector();
    if (!detector) return [];

    const width = image.naturalWidth ?? image.width;
    const height = image.naturalHeight ?? image.height;
    if (!width || !height) return [];

    const all = [];

    for (const divisions of TILE_PASSES) {
      if (divisions === 1) {
        all.push(...boxesOf(detector, image));
        continue;
      }

      const step = 1 / divisions;
      const span = step * (1 + TILE_OVERLAP);
      const tile = document.createElement('canvas');
      const ctx = tile.getContext('2d');
      if (!ctx) return [];

      for (let row = 0; row < divisions; row += 1) {
        for (let col = 0; col < divisions; col += 1) {
          const sx = Math.min(col * step * width, width);
          const sy = Math.min(row * step * height, height);
          const sw = Math.min(span * width, width - sx);
          const sh = Math.min(span * height, height - sy);
          if (sw < 8 || sh < 8) continue;

          tile.width = Math.round(sw);
          tile.height = Math.round(sh);
          ctx.drawImage(image, sx, sy, sw, sh, 0, 0, tile.width, tile.height);

          // Tile-local boxes, put back where they came from.
          for (const b of boxesOf(detector, tile)) {
            all.push({ x: b.x + sx, y: b.y + sy, w: b.w, h: b.h });
          }
        }
      }
    }

    return dedupe(all);
  } catch {
    return [];
  }
}
