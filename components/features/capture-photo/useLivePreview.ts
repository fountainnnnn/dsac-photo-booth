import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ImageFilters } from '@/types/editor';
import { filtersToCSS } from '@/types/editor';
import type { FrameWindow } from '@/types/frame';

export interface LivePreviewOptions {
  filters: ImageFilters;
  /**
   * Where the photo belongs, as fractions of the canvas. When a frame is
   * active this is its cut-out, so the frame wraps the photo instead of
   * covering its edges. Null or undefined fills the whole canvas.
   */
  contentRect?: FrameWindow | null;
  /**
   * Which part of the camera's picture to use, as fractions of the video.
   * Null or undefined uses all of it. Always 16:9 like the video itself, so
   * cropping zooms in without reshaping anything.
   */
  sourceRect?: FrameWindow | null;
}

export interface UseLivePreviewResult {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function useLivePreview(
  videoRef: RefObject<HTMLVideoElement | null>,
  options: LivePreviewOptions,
): UseLivePreviewResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const rafRef = useRef<number>(0);

  const drawFrame = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2 || !canvas.width || !canvas.height) {
      rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const { filters, contentRect, sourceRect } = optionsRef.current;

    // Destination: the frame's cut-out, or the whole canvas when bare.
    const dx = contentRect ? Math.round(contentRect.x * w) : 0;
    const dy = contentRect ? Math.round(contentRect.y * h) : 0;
    const dw = contentRect ? Math.round(contentRect.w * w) : w;
    const dh = contentRect ? Math.round(contentRect.h * h) : h;

    // Everything outside the cut-out is covered by the frame artwork, but it
    // must not be left transparent — a captured JPEG has no alpha and would
    // turn it black.
    if (contentRect) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }

    // Source: the operator's crop region, or the whole picture.
    //
    // Nothing is fitted, stretched or letterboxed here. Both the source and
    // the destination window are 16:9 by construction — the crop is locked to
    // it, and every frame window is the 16:9 rect covering its cut-out — so
    // this is a plain scale. The old fill-to-window behaviour existed to paper
    // over windows that were not 16:9, and reshaped people to do it.
    const vw = video.videoWidth  || dw;
    const vh = video.videoHeight || dh;
    const sx = sourceRect ? Math.round(sourceRect.x * vw) : 0;
    const sy = sourceRect ? Math.round(sourceRect.y * vh) : 0;
    const sw = sourceRect ? Math.max(1, Math.round(sourceRect.w * vw)) : vw;
    const sh = sourceRect ? Math.max(1, Math.round(sourceRect.h * vh)) : vh;

    ctx.save();
    ctx.filter = filtersToCSS(filters);
    // Mirror about the drawn image's own centre, so the flip stays correct
    // wherever it has been placed.
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return { canvasRef };
}
