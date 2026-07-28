import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ImageFilters } from '@/types/editor';
import { filtersToCSS } from '@/types/editor';

export interface LivePreviewOptions {
  filters: ImageFilters;
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
    const { filters } = optionsRef.current;

    // Cover-crop video to fill canvas (matching object-cover behaviour)
    const vw = video.videoWidth  || w;
    const vh = video.videoHeight || h;
    const videoAspect  = vw / vh;
    const canvasAspect = w  / h;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (videoAspect > canvasAspect) {
      sw = Math.round(vh * canvasAspect);
      sx = Math.round((vw - sw) / 2);
    } else {
      sh = Math.round(vw / canvasAspect);
      sy = Math.round((vh - sh) / 2);
    }

    // Draw mirrored + filtered video
    ctx.save();
    ctx.filter = filtersToCSS(filters);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return { canvasRef };
}
