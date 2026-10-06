import { useEffect, useState, type RefObject } from 'react';

/**
 * How many frames a second the capture screen manages, for the readout beside
 * the stage (Settings > Background removal > "Show the frame rate").
 *
 * Counted where the work happens rather than worked out from timings: the
 * preview loop counts each frame it draws, the segmenter each mask it makes,
 * and the camera's own pictures are counted off the video element. Module
 * level, like `speed.ts`: a page shows one preview.
 */

export interface FrameRates {
  /** Frames the preview drew, a second. The screen's refresh rate is the ceiling. */
  preview: number;
  /**
   * New pictures the camera delivered, a second, or null where the browser
   * cannot say. The preview redraws faster than this, but only these frames
   * show the guest anything new.
   */
  camera: number | null;
  /** Masks the segmenter made, a second: how often the cut-out's shape moves. */
  cutout: number;
  /**
   * The longest gap between two preview frames, in ms. A stall from the model
   * shows here well before it moves the average.
   */
  slowestMs: number;
  /**
   * Faces the tracker found, how many of them are in the group at the front,
   * and roughly how far away the nearest is; null while nothing is tracking
   * faces. Not a rate, but it is what says whether a guest who drops out of
   * the cut-out was even seen.
   */
  faces: FaceCount | null;
}

export interface FaceCount {
  found: number;
  group: number;
  /** The nearest face's distance in metres, roughly (see `front.ts`); null for none. */
  nearestM: number | null;
}

let previewFrames = 0;
let cutouts = 0;
let lastPreviewAt = 0;
let slowestGap = 0;
let faces: (FaceCount & { at: number }) | null = null;

/** Faces found this frame, how many are in the group, and how near the nearest is. */
export function noteFaces(found: number, group: number, nearestM: number | null) {
  faces = { found, group, nearestM, at: performance.now() };
}

/**
 * The faces as last counted, or null if nothing has counted them in the last
 * second: tracking stopped, and nothing reports "no faces" then.
 */
export function readFaces(now = performance.now()): FaceCount | null {
  if (!faces || now - faces.at >= 1000) return null;
  return { found: faces.found, group: faces.group, nearestM: faces.nearestM };
}

/** One preview frame drawn. */
export function countPreviewFrame(now = performance.now()) {
  previewFrames += 1;
  if (lastPreviewAt) slowestGap = Math.max(slowestGap, now - lastPreviewAt);
  lastPreviewAt = now;
}

/** One new mask from the segmenter. */
export function countCutout() {
  cutouts += 1;
}

/** The rates over each `everyMs`, while `on`; null while off. */
export function useFrameRates(
  on: boolean,
  videoRef: RefObject<HTMLVideoElement | null>,
  everyMs = 500,
): FrameRates | null {
  const [rates, setRates] = useState<FrameRates | null>(null);

  useEffect(() => {
    if (!on) {
      queueMicrotask(() => setRates(null));
      return;
    }

    // The camera's frames, as the browser hands them to the page.
    const video = videoRef.current;
    const canCount = !!video && typeof video.requestVideoFrameCallback === 'function';
    let cameraFrames = 0;
    let handle = 0;
    const onCameraFrame = () => {
      cameraFrames += 1;
      handle = video!.requestVideoFrameCallback(onCameraFrame);
    };
    if (canCount) handle = video.requestVideoFrameCallback(onCameraFrame);

    // Whatever ran before this started is not this window's to report.
    lastPreviewAt = 0;
    slowestGap = 0;
    let from = { at: performance.now(), preview: previewFrames, cutout: cutouts, camera: cameraFrames };

    const id = setInterval(() => {
      const now = performance.now();
      const secs = (now - from.at) / 1000;
      if (secs <= 0) return;
      setRates({
        preview: (previewFrames - from.preview) / secs,
        camera: canCount ? (cameraFrames - from.camera) / secs : null,
        cutout: (cutouts - from.cutout) / secs,
        slowestMs: slowestGap,
        faces: readFaces(now),
      });
      from = { at: now, preview: previewFrames, cutout: cutouts, camera: cameraFrames };
      slowestGap = 0;
    }, everyMs);

    return () => {
      clearInterval(id);
      if (canCount) video.cancelVideoFrameCallback(handle);
    };
  }, [on, videoRef, everyMs]);

  return rates;
}
