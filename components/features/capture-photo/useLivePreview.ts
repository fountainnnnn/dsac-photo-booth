import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { LookRamp, ImageFilters } from '@/types/editor';
import { filtersAreNeutral, filtersToCSS, rampStartEdge } from '@/types/editor';
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
  /**
   * How the Look is spread: 'even' (or null) applies the adjustments
   * uniformly; a direction applies them in full at the edge the ramp starts
   * from, fading to the untouched camera at the other end.
   */
  lookRamp?: LookRamp | null;
}

/** Everything `drawPhoto` needs, plus the size of the canvas it draws onto. */
export interface DrawPhotoOptions extends LivePreviewOptions {
  /** Canvas dimensions in device pixels. */
  w: number;
  h: number;
}

export interface UseLivePreviewResult {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

/**
 * Draw one frame of video onto a canvas: white bed, crop, mirror, filters,
 * then the Look ramp.
 *
 * This is the single place that turns the camera into a picture. The live
 * preview runs it every rAF and the shutter runs it once at full resolution,
 * so the two cannot drift apart — everything here is expressed as fractions,
 * which is what makes the same call work at 900px and at 1921px.
 */
export function drawPhoto(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  { w, h, filters, contentRect, sourceRect, lookRamp }: DrawPhotoOptions,
) {
  // Destination: the frame's cut-out, or the whole canvas when bare.
  const dx = contentRect ? Math.round(contentRect.x * w) : 0;
  const dy = contentRect ? Math.round(contentRect.y * h) : 0;
  const dw = contentRect ? Math.round(contentRect.w * w) : w;
  const dh = contentRect ? Math.round(contentRect.h * h) : h;

  // Anywhere the picture does not reach must be white, not transparent: a
  // captured JPEG has no alpha and would turn it black. That is the border
  // around a frame's cut-out, and the margins when the crop is zoomed out
  // past the whole scene so the camera sits inside the photo.
  if (contentRect || sourceRect) {
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

  // With a ramp on, the untouched camera is drawn first and the fully
  // adjusted picture is laid over it through a gradient mask — the whole
  // Look at the ramp's starting edge, the bare camera at the other end.
  const startEdge = lookRamp ? rampStartEdge(lookRamp) : null;
  const ramping = startEdge !== null && !filtersAreNeutral(filters);

  ctx.save();
  ctx.filter = ramping ? 'none' : filtersToCSS(filters);
  // Mirror about the drawn image's own centre, so the flip stays correct
  // wherever it has been placed.
  ctx.translate(dx + dw, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  ctx.restore();

  if (ramping) {
    drawLookRamp(ctx, video, startEdge, filters, { sx, sy, sw, sh, dx, dy, dw, dh });
  }
}

/**
 * Spread the whole Look across the picture: the fully adjusted image in full
 * at `startEdge`, fading linearly to the untouched camera at the opposite
 * edge.
 *
 * The adjusted picture is drawn once onto a scratch layer, masked to a
 * gradient with destination-in, and laid over the untouched base — the same
 * two-layer construction the framing card builds out of CSS, so the two
 * previews and the captured photo all agree pixel for pixel. A continuous
 * mask, so there is nothing to band.
 *
 * The scratch canvas is module-level and reused: this runs every rAF, and
 * allocating a full-resolution canvas per frame is how previews start
 * stuttering.
 */
let rampLayer: HTMLCanvasElement | null = null;

function drawLookRamp(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  startEdge: 'top' | 'bottom' | 'left' | 'right',
  filters: ImageFilters,
  g: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number },
) {
  // jsdom's stub context has no filter support; the ramp is a no-op there.
  if (typeof ctx.drawImage !== 'function' || ctx.filter === undefined) return;
  if (typeof document === 'undefined') return;

  rampLayer ??= document.createElement('canvas');
  if (rampLayer.width !== g.dw) rampLayer.width = g.dw;
  if (rampLayer.height !== g.dh) rampLayer.height = g.dh;
  const layer = rampLayer.getContext('2d');
  if (!layer || typeof layer.createLinearGradient !== 'function') return;

  // The adjusted picture, mirrored exactly as the base was.
  layer.save();
  layer.clearRect(0, 0, g.dw, g.dh);
  layer.filter = filtersToCSS(filters);
  layer.translate(g.dw, 0);
  layer.scale(-1, 1);
  layer.drawImage(video, g.sx, g.sy, g.sw, g.sh, 0, 0, g.dw, g.dh);
  layer.restore();

  // Keep it only where the ramp wants it: opaque at the starting edge,
  // gone at the other. Only the gradient's alpha matters here.
  const ends: Record<typeof startEdge, [number, number, number, number]> = {
    top:    [0, 0, 0, g.dh],
    bottom: [0, g.dh, 0, 0],
    left:   [0, 0, g.dw, 0],
    right:  [g.dw, 0, 0, 0],
  };
  const [x0, y0, x1, y1] = ends[startEdge];
  const mask = layer.createLinearGradient(x0, y0, x1, y1);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');

  layer.save();
  layer.globalCompositeOperation = 'destination-in';
  layer.fillStyle = mask;
  layer.fillRect(0, 0, g.dw, g.dh);
  layer.restore();

  ctx.drawImage(rampLayer, g.dx, g.dy);
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

    drawPhoto(ctx, video, {
      ...optionsRef.current,
      w: canvas.width,
      h: canvas.height,
    });

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return { canvasRef };
}
