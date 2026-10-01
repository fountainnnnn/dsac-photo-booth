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

/**
 * The face mesh, for pinning avatars to faces. VIDEO mode follows a face it
 * has found from frame to frame; IMAGE mode looks afresh every time.
 */
export async function createFaceLandmarker(runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'): Promise<FaceLandmarker> {
  const { vision, fileset } = await load();
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: LANDMARKER_MODEL, delegate: 'CPU' },
    runningMode,
    numFaces: MAX_FACES,
    // Find generously, keep strictly. The finder at its 0.5 default missed
    // one of four faces in a group photo, so it runs at 0.3. But on a mottled
    // grey backdrop it also found a face that was not there — at the defaults
    // too — and a guest got a second pair of glasses floating beside them. The
    // mesh's own "is this a face" check at 0.7 dropped it and kept all four.
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.7,
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
