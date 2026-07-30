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

    // Cover-crop the video into the destination so it fills without distorting.
    const vw = video.videoWidth  || dw;
    const vh = video.videoHeight || dh;
    const videoAspect = vw / vh;
    const destAspect  = dw / dh;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (videoAspect > destAspect) {
      sw = Math.round(vh * destAspect);
      sx = Math.round((vw - sw) / 2);
    } else {
      sh = Math.round(vw / destAspect);
      sy = Math.round((vh - sh) / 2);
    }

    ctx.save();
    ctx.filter = filtersToCSS(filters);
    // Mirror about the destination's own centre, so the flip stays correct
    // when the photo is inset rather than full-bleed.
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
