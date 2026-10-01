import type { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

/**
 * MediaPipe, loaded only when the capture screen asks for it.
 *
 * The library is imported dynamically, so Vite splits it into its own chunk
 * and a guest's phone opening the download page never fetches it. Its wasm
 * runtime (about twelve megabytes) is copied into `public/vision/wasm` at build
 * time by `scripts/vendor-vision.mjs`; the models sit beside it, committed.
 *
 * Everything runs on the CPU by default: the booth laptop is weak, and the CPU
 * path is the one that works on every machine. Both models are small enough
 * for a live preview there.
 */

const WASM_DIR = '/vision/wasm';
const SEGMENTER_MODEL = '/vision/selfie_multiclass_256x256.tflite';
const LANDMARKER_MODEL = '/vision/face_landmarker.task';

/** Most faces tracked at once. Each costs a pass of the landmark model. */
export const MAX_FACES = 6;

type Vision = typeof import('@mediapipe/tasks-vision');
type Fileset = Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>>;

let loaded: Promise<{ vision: Vision; fileset: Fileset }> | null = null;

function load() {
  loaded ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_DIR);
    return { vision, fileset };
  })();
  return loaded;
}

/** The person segmenter, for removing a background without a green screen. */
export async function createSegmenter(): Promise<ImageSegmenter> {
  const { vision, fileset } = await load();
  return vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

/** The face mesh, for pinning avatars to faces. */
export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  const { vision, fileset } = await load();
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: LANDMARKER_MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: MAX_FACES,
    // Below the 0.5 default: on a group photo the stricter threshold missed
    // two of four faces in every tiling tried, 0.3 found all four with no
    // false ones. A missed face loses its avatar; a stray one would be drawn
    // on the wall, but none turned up.
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

/**
 * A strictly increasing timestamp for VIDEO-mode calls. MediaPipe refuses a
 * frame stamped at or before the last one it saw, and two calls inside one
 * millisecond would otherwise collide.
 */
export function videoClock() {
  let last = 0;
  return () => {
    last = Math.max(last + 1, Math.floor(performance.now()));
    return last;
  };
}
