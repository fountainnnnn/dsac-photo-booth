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
  /**
   * Degrees to turn the picture, positive clockwise as it appears on screen.
   * Turns the already-cropped image about the destination window's own
   * centre — the crop rectangle itself never rotates, only the pixels it
   * selected. Null, undefined or 0 draws straight, as before this existed.
   */
  rotationDeg?: number | null;
}

/**
 * The largest centred part of a source rectangle that has `aspect`.
 *
 * The draw below is a plain scale, which is only honest if what it samples is
 * already the shape of where it is going. Frame windows are 16:9 by
 * construction, but the camera is whatever the laptop happened to open —
 * `cameraConstraints` asks for no aspect ratio on purpose, so a 4:3 webcam or
 * an iPhone over Continuity hands back 1.333 and every face in a frame came
 * out a third too wide. With no frame on, the stage takes the camera's own
 * shape and nothing was ever wrong, which is what made this look like the
 * frames' fault.
 *
 * So trim rather than stretch: sample a little less of the picture and keep
 * everyone the shape they are. It is the same rule the frame windows already
 * follow for their own cut-outs — cover, never reshape.
 */
export function coverAspect(
  rect: { sx: number; sy: number; sw: number; sh: number },
  aspect: number,
) {
  const have = rect.sw / rect.sh;
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(have)) return rect;
  // A rounding-width difference is not worth a crop, and re-cropping every
  // frame by a pixel would shimmer.
  if (Math.abs(have - aspect) < 1e-6) return rect;

  if (have > aspect) {
    const sw = Math.max(1, Math.round(rect.sh * aspect));
    return { ...rect, sx: rect.sx + Math.round((rect.sw - sw) / 2), sw };
  }
  const sh = Math.max(1, Math.round(rect.sw / aspect));
  return { ...rect, sy: rect.sy + Math.round((rect.sh - sh) / 2), sh };
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
  { w, h, filters, contentRect, sourceRect, lookRamp, rotationDeg }: DrawPhotoOptions,
) {
  // Destination: the frame's cut-out, or the whole canvas when bare.
  const dx = contentRect ? Math.round(contentRect.x * w) : 0;
  const dy = contentRect ? Math.round(contentRect.y * h) : 0;
  const dw = contentRect ? Math.round(contentRect.w * w) : w;
  const dh = contentRect ? Math.round(contentRect.h * h) : h;

  // A CSS-style clockwise-positive angle, in canvas's own (counterclockwise
  // positive-radians-negated) terms: see the note on the rotate below for why
  // it is negated.
  const rotationRad = ((rotationDeg ?? 0) * Math.PI) / 180;

  // Anywhere the picture does not reach must be white, not transparent: a
  // captured JPEG has no alpha and would turn it black. That is the border
  // around a frame's cut-out, the margins when the crop is zoomed out past
  // the whole scene so the camera sits inside the photo, and the corners a
  // rotated picture swings clear of.
  if (contentRect || sourceRect || rotationRad) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  // Source: the operator's crop region, or the whole picture, narrowed to the
  // shape of where it is going.
  //
  // Nothing is fitted, stretched or letterboxed here — the draw below is a
  // plain scale. That used to rest on the camera being 16:9 like the window,
  // which nothing guarantees: a 4:3 webcam stretched every face by a third,
  // but only with a frame on, because a bare stage takes the camera's own
  // shape. `coverAspect` trims the overhang instead.
  const vw = video.videoWidth  || dw;
  const vh = video.videoHeight || dh;
  const { sx, sy, sw, sh } = coverAspect({
    sx: sourceRect ? Math.round(sourceRect.x * vw) : 0,
    sy: sourceRect ? Math.round(sourceRect.y * vh) : 0,
    sw: sourceRect ? Math.max(1, Math.round(sourceRect.w * vw)) : vw,
    sh: sourceRect ? Math.max(1, Math.round(sourceRect.h * vh)) : vh,
  }, dw / dh);

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
  // Rotate about that same centre, after the mirror. Canvas rotation is
  // clockwise-positive on an unflipped axis, but this axis is already
  // mirrored — on a mirrored axis the same positive angle turns
  // anticlockwise as anyone looking at the result would call it, so the
  // angle is negated to keep the setting's own clockwise-positive promise.
  if (rotationRad) {
    ctx.translate(dw / 2, dh / 2);
    ctx.rotate(-rotationRad);
    ctx.translate(-dw / 2, -dh / 2);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  ctx.restore();

  if (ramping) {
    drawLookRamp(ctx, video, startEdge, filters, { sx, sy, sw, sh, dx, dy, dw, dh, rotationRad });
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
  g: {
    sx: number; sy: number; sw: number; sh: number;
    dx: number; dy: number; dw: number; dh: number;
    rotationRad: number;
  },
) {
  // jsdom's stub context has no filter support; the ramp is a no-op there.
  if (typeof ctx.drawImage !== 'function' || ctx.filter === undefined) return;
  if (typeof document === 'undefined') return;

  rampLayer ??= document.createElement('canvas');
  if (rampLayer.width !== g.dw) rampLayer.width = g.dw;
  if (rampLayer.height !== g.dh) rampLayer.height = g.dh;
  const layer = rampLayer.getContext('2d');
  if (!layer || typeof layer.createLinearGradient !== 'function') return;

  // The adjusted picture, mirrored and rotated exactly as the base was.
  layer.save();
  layer.clearRect(0, 0, g.dw, g.dh);
  layer.filter = filtersToCSS(filters);
  layer.translate(g.dw, 0);
  layer.scale(-1, 1);
  if (g.rotationRad) {
    layer.translate(g.dw / 2, g.dh / 2);
    layer.rotate(-g.rotationRad);
    layer.translate(-g.dw / 2, -g.dh / 2);
  }
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
