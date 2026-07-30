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

/** The transparent cut-out a photo sits inside, as fractions of the frame. */
export interface FrameWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameConfig {
  id: string;
  label: string;
  src: string;
  /**
   * Where the photo goes. The frame wraps the photo rather than covering it,
   * so the image is drawn into this cut-out instead of full-bleed. Measured
   * from each artboard's alpha channel. Omit to fill the whole frame.
   */
  window?: FrameWindow;
  /** Omit for a frame that already carries its own date. */
  dateStamp?: DateStamp | null;
  /** Relative spin weight. Never shown to the person spinning. */
  weight?: number;
  /** Excluded from the wheel entirely when false. */
  enabled?: boolean;
  /** Built-ins ship with the app and cannot be deleted. */
  builtIn?: boolean;
}

/**
 * The caption font is a casual handwriting face. We cannot embed the original,
 * so approximate it with what a Windows kiosk ships; Ink Free is the closest.
 */
export const STAMP_FONT_STACK =
  "'Ink Free','Segoe Script','Bradley Hand','Comic Sans MS',cursive";

/** Ships with the app. Geometry is measured off the artboards, so it lives here
 *  rather than in the database an operator can edit. */
const BUILT_IN_SOURCE: FrameConfig[] = [
  {
    id: 'tech',
    label: 'Tech',
    src: '/frames/frame-tech.png',
    // Cut-out at 163,192 sized 1610x781 on the 1921x1201 artboard.
    window: { x: 0.08485, y: 0.15987, w: 0.83811, h: 0.65029 },
    // The artboard already sets "Transformation Made Possible" / "on" across
    // two lines; we only append the date. Measured off the artwork: the baked
    // "on" ends at x=852 on a baseline of y=1136, with a 24px x-height.
    dateStamp: {
      xFrac: 0.4508, // just past the "on", plus a word space
      yFrac: 0.9459, // shares the baked baseline
      align: 'left',
      sizeFrac: 0.0425, // matches the 24px x-height of the baked "on"
      colour: '#abdddd', // sampled from the caption ink
      prefix: '',
    },
  },
  {
    id: 'doodle',
    label: 'Doodle',
    src: '/frames/frame-doodle.png',
    // Cut-out at 137,160 sized 1644x923. The brush edge is irregular, so this
    // is its bounding box — the artwork covers the corners the photo overshoots.
    window: { x: 0.07132, y: 0.13322, w: 0.8558, h: 0.76853 },
    // One line here: "Transformation Made Possible on" ends at x=1204 on a
    // baseline of y=1154, 32px x-height. Capped so a long date can never run
    // into the magnifier doodle that starts around x=1650.
    dateStamp: {
      xFrac: 0.6361,
      yFrac: 0.9609,
      align: 'left',
      sizeFrac: 0.0566,
      colour: '#218684',
      prefix: '',
      maxWidthFrac: 0.21,
    },
  },
];

export const BUILT_IN_FRAMES: FrameConfig[] = BUILT_IN_SOURCE.map((f) => ({
  ...f, builtIn: true, weight: 1, enabled: true,
}));

/**
 * Pick a frame using its weight.
 *
 * Weights are an operator setting and are deliberately invisible on the wheel —
 * every segment is drawn the same size, so a rare frame looks exactly as likely
 * as a common one. The odds live here, not in the geometry.
 */
export function pickWeighted(
  frames: FrameConfig[],
  random: () => number = Math.random,
): FrameConfig | null {
  const pool = frames.filter((f) => f.enabled !== false && (f.weight ?? 1) > 0);
  if (pool.length === 0) return null;

  const total = pool.reduce((sum, f) => sum + (f.weight ?? 1), 0);
  let ticket = random() * total;
  for (const frame of pool) {
    ticket -= frame.weight ?? 1;
    if (ticket <= 0) return frame;
  }
  return pool[pool.length - 1]; // floating-point guard
}

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
