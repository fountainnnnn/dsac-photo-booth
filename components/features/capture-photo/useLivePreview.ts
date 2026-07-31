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
    const { filters, contentRect } = optionsRef.current;

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

    // Stretch the frame to fill the cut-out exactly. Fitting it left white
    // letterbox bars whenever the camera's shape differed from the window's,
    // and cropping would cut people off at the edges; filling keeps every
    // window fully covered with the whole shot inside it.
    const vw = video.videoWidth  || dw;
    const vh = video.videoHeight || dh;

    ctx.save();
    ctx.filter = filtersToCSS(filters);
    // Mirror about the drawn image's own centre, so the flip stays correct
    // wherever it has been placed.
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, dw, dh);
    ctx.restore();

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return { canvasRef };
}
