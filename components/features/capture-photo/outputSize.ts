import { FRAME_ASPECT, FRAME_W, type FrameWindow } from '@/types/frame';

/**
 * How big the photo will be, and how much of it is real camera.
 *
 * The shutter and the framing preview both read this, so the size quoted in
 * Settings is the size that actually lands on disk — the operator should never
 * have to take a shot and inspect the file to learn what zooming cost them.
 */

/**
 * Widest photo we will write.
 *
 * With the camera uncapped an 8K webcam would otherwise ask for a ~9100px
 * artboard — past what some canvas implementations will allocate, and slow to
 * JPEG-encode while a guest waits at the booth. No booth camera gets near
 * this, so in practice it is a backstop rather than a limit.
 */
export const MAX_OUTPUT_W = 8192;

export interface PhotoSize {
  /** The whole image: photo plus the frame's border. */
  width: number;
  height: number;
  /** Sensor pixels that survive the crop — the only part that is real detail. */
  cameraWidth: number;
  cameraHeight: number;
  /** True when the artboard floor is doing the work and the photo is stretched. */
  upscaled: boolean;
}

export function photoOutputSize(
  video: { width: number; height: number },
  /** Region of the camera sampled, as fractions. Null uses all of it. */
  crop: { w: number; h: number } | null,
  /** The frame in use, if any — its window is what the photo is drawn into. */
  frame: { window?: FrameWindow | null } | null,
): PhotoSize {
  const croppedWidth = Math.max(1, Math.round((crop?.w ?? 1) * video.width));
  const croppedHeight = Math.max(1, Math.round((crop?.h ?? 1) * video.height));

  if (!frame) {
    return {
      width: croppedWidth, height: croppedHeight,
      cameraWidth: croppedWidth, cameraHeight: croppedHeight,
      upscaled: false,
    };
  }

  const win = frame.window;

  // Only the part of the camera shaped like the window is drawn — see
  // `coverAspect` in useLivePreview. Counting the trimmed overhang here would
  // quote the operator detail the photo does not contain, and size the
  // artboard for pixels that never arrive.
  const windowAspect = win ? (win.w / win.h) * FRAME_ASPECT : croppedWidth / croppedHeight;
  const sampled = croppedWidth / croppedHeight > windowAspect
    ? { w: Math.max(1, Math.round(croppedHeight * windowAspect)), h: croppedHeight }
    : { w: croppedWidth, h: Math.max(1, Math.round(croppedWidth / windowAspect)) };
  const cameraWidth = sampled.w;
  const cameraHeight = sampled.h;

  // Grow the artboard until its window lands on the camera's own pixels, so
  // the photo is never resampled — the frame artwork is stretched instead.
  const wanted = win ? Math.round(cameraWidth / win.w) : cameraWidth;
  const width = Math.min(MAX_OUTPUT_W, Math.max(FRAME_W, wanted));
  const height = Math.round(width / FRAME_ASPECT);

  return { width, height, cameraWidth, cameraHeight, upscaled: wanted < FRAME_W };
}
