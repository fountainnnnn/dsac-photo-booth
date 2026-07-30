/**
 * Event frames.
 *
 * Each frame is a full-bleed PNG with a transparent photo window, drawn over
 * the captured photo. The artboards are 1921x1201 (16:10), so the camera stage
 * uses that aspect too — stretching a 16:10 frame onto a 16:9 photo would
 * distort the SP logos and the caption.
 *
 * Neither artboard has the event date baked in, so we stamp it at capture
 * time. All stamp geometry is expressed as a fraction of the frame, measured
 * off the artboards, so it survives any output resolution.
 */

/** Native artboard size shared by every frame. */
export const FRAME_W = 1921;
export const FRAME_H = 1201;
export const FRAME_ASPECT = FRAME_W / FRAME_H; // ~1.5995 (16:10)

export interface DateStamp {
  /** Anchor x as a fraction of frame width. */
  xFrac: number;
  /** Text baseline as a fraction of frame height. */
  yFrac: number;
  align: 'center' | 'left';
  /** Font size as a fraction of frame height. Shrunk if it would exceed maxWidthFrac. */
  sizeFrac: number;
  colour: string;
  /** Leading words, e.g. "on ". Dropped where space is tight. */
  prefix: string;
  /**
   * Hard width budget as a fraction of frame width. The doodle artboard has
   * only ~231px of clear space between the caption and the magnifier doodle,
   * so the stamp must fit or it collides with the artwork.
   */
  maxWidthFrac?: number;
}

export interface FrameConfig {
  id: string;
  label: string;
  src: string;
  /** Omit for a frame that already carries its own date. */
  dateStamp?: DateStamp;
}

/**
 * The caption font is a casual handwriting face. We cannot embed the original,
 * so approximate it with what a Windows kiosk ships; Ink Free is the closest.
 */
export const STAMP_FONT_STACK =
  "'Ink Free','Segoe Script','Bradley Hand','Comic Sans MS',cursive";

export const FRAMES: FrameConfig[] = [
  {
    id: 'tech',
    label: 'Tech',
    src: '/frames/frame-tech.png',
    // Caption "Transformation Made Possible" ends at y=1096 with 105px clear
    // below it, so the date goes on a second line, centred like the mockup.
    dateStamp: {
      xFrac: 0.5,
      yFrac: 0.963,
      align: 'center',
      sizeFrac: 0.053,
      colour: '#b8e9e8',
      prefix: 'on ',
    },
  },
  {
    id: 'doodle',
    label: 'Doodle',
    src: '/frames/frame-doodle.png',
    // This artboard has no room for a second line (11px below the caption) and
    // only x=1322..1552 clear to its right before the magnifier doodle. The
    // date sits centred in that gap, without the "on " prefix, auto-shrunk to
    // fit. A roomier stamp needs the caption shifted left on the artboard.
    dateStamp: {
      xFrac: 0.7480,
      yFrac: 0.963,
      align: 'center',
      sizeFrac: 0.048,
      colour: '#12817b',
      prefix: '',
      maxWidthFrac: 0.112,
    },
  },
];

/** "19/5/2026" — day/month/year, no leading zeros, matching the mockup. */
export function formatEventDate(date: Date = new Date()): string {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

/** The full stamp text for a frame, including its prefix. */
export function stampText(frame: FrameConfig, date: Date = new Date()): string {
  return `${frame.dateStamp?.prefix ?? ''}${formatEventDate(date)}`;
}

/**
 * Font size in px for a stamp on a canvas `h` tall, shrunk if the text would
 * overrun its width budget. Callers that render in the DOM need the same
 * number, so the preview and the captured photo cannot drift apart.
 */
export function stampFontPx(
  measure: CanvasRenderingContext2D,
  frame: FrameConfig,
  w: number,
  h: number,
  date: Date = new Date(),
): number {
  const stamp = frame.dateStamp;
  if (!stamp) return 0;

  const size = Math.round(stamp.sizeFrac * h);
  if (!stamp.maxWidthFrac) return size;

  // jsdom and other non-rendering contexts have no text metrics; fall back to
  // the nominal size rather than throwing during tests.
  if (typeof measure?.measureText !== 'function') return size;

  measure.save();
  measure.font = `${size}px ${STAMP_FONT_STACK}`;
  const width = measure.measureText(stampText(frame, date)).width;
  measure.restore();

  if (!Number.isFinite(width) || width <= 0) return size;

  const budget = stamp.maxWidthFrac * w;
  return width <= budget ? size : Math.max(8, Math.floor(size * (budget / width)));
}

/**
 * Stamp the event date onto a canvas already holding the photo + frame.
 * `w`/`h` are the canvas dimensions, not the artboard's.
 */
export function drawDateStamp(
  ctx: CanvasRenderingContext2D,
  frame: FrameConfig,
  w: number,
  h: number,
  date: Date = new Date(),
) {
  const stamp = frame.dateStamp;
  if (!stamp) return;

  ctx.save();
  ctx.font = `${stampFontPx(ctx, frame, w, h, date)}px ${STAMP_FONT_STACK}`;
  ctx.fillStyle = stamp.colour;
  ctx.textAlign = stamp.align === 'center' ? 'center' : 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(stampText(frame, date), stamp.xFrac * w, stamp.yFrac * h);
  ctx.restore();
}
