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

/**
 * A caption drawn entirely by us: "<event name> on <date>".
 *
 * Only for artwork that does not already carry its own caption — an uploaded
 * frame, or a future artboard with the text left off. The two built-in
 * artboards bake "Transformation Made Possible on" into the pixels, so their
 * wording cannot be changed from here; they use `dateStamp` to append the date
 * after the baked "on" instead.
 */
/**
 * The artboards print only the word "on", with the space either side left
 * blank. The event name is written to its left and the date to its right, both
 * sharing that word's baseline, so the finished line reads as one sentence.
 */
export interface CaptionSlot {
  /** Left and right edges of the printed "on", as fractions of frame width. */
  onLeftFrac: number;
  onRightFrac: number;
  /** Shared baseline, as a fraction of frame height. */
  baselineFrac: number;
  /** Font size as a fraction of frame height, matched to the printed word. */
  sizeFrac: number;
  colour: string;
  /** Space between "on" and the words either side, as a fraction of width. */
  gapFrac: number;
  /** Budget for the event name; a longer one shrinks rather than colliding. */
  maxNameWidthFrac: number;
}

/** Event details an operator can change without touching the artwork. */
export interface EventDetails {
  eventName: string;
  /** ISO yyyy-mm-dd. Empty means "use today", so an unattended booth stays right. */
  eventDate: string;
}

export const DEFAULT_EVENT_DETAILS: EventDetails = {
  eventName: 'Transformation Made Possible',
  eventDate: '',
};

/** The date to stamp: the configured one, else today. */
export function resolveEventDate(details?: Partial<EventDetails> | null): Date {
  const raw = details?.eventDate?.trim();
  if (raw) {
    // Parse as local midnight; `new Date('2026-05-19')` is UTC and can land on
    // the previous day for anyone east of Greenwich, Singapore included.
    const [y, m, d] = raw.split('-').map(Number);
    if (y && m && d) {
      const parsed = new Date(y, m - 1, d);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
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
  /** Appends the date after a caption already baked into the artwork. */
  dateStamp?: DateStamp | null;
  /**
   * Draws the whole caption ourselves. Only for artwork without its own —
   * uploads, or an artboard with the text left off. Wins over dateStamp.
   */
  captionSlot?: CaptionSlot | null;
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
    // Printed "on" occupies x 817..850 on a baseline of y=1134, 21px x-height
    // (~45px type). The name is written to its left, the date to its right.
    captionSlot: {
      onLeftFrac: 0.4253,
      onRightFrac: 0.4425,
      baselineFrac: 0.9442,
      sizeFrac: 0.0375,
      colour: '#b1dfe0',   // sampled from the printed word
      gapFrac: 0.008,
      maxNameWidthFrac: 0.38,
    },
  },
  {
    id: 'doodle',
    label: 'Doodle',
    src: '/frames/frame-doodle.png',
    // Cut-out at 146,167 sized 1628x896. The brush edge is irregular, so this
    // is its bounding box — the artwork covers the corners the photo overshoots.
    window: { x: 0.076, y: 0.13905, w: 0.84748, h: 0.74604 },
    // Printed "on" occupies x 1159..1204 on a baseline of y=1153, 30px x-height
    // (~64px type). The name budget keeps it clear of the red squiggle on the
    // left, and the date lands before the magnifier doodle at x~1568.
    captionSlot: {
      onLeftFrac: 0.6033,
      onRightFrac: 0.6268,
      baselineFrac: 0.96,
      sizeFrac: 0.0533,
      colour: '#12817b',
      gapFrac: 0.009,
      maxNameWidthFrac: 0.40,
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
  event?: Partial<EventDetails> | null,
) {
  const date = resolveEventDate(event);

  // Artwork with no caption of its own gets the whole line drawn here, so the
  // event name is ours to set. Artwork that bakes its caption into the pixels
  // can only have the date appended after it.
  const slot = frame.captionSlot;
  if (slot) {
    const name = (event?.eventName ?? DEFAULT_EVENT_DETAILS.eventName).trim();
    const dateText = formatEventDate(date);
    const baseline = slot.baselineFrac * h;
    const gap = slot.gapFrac * w;

    // Match the printed "on"; shrink only if the name would run into it.
    let nameSize = Math.round(slot.sizeFrac * h);
    if (name && typeof ctx.measureText === 'function') {
      ctx.save();
      ctx.font = `${nameSize}px ${STAMP_FONT_STACK}`;
      const width = ctx.measureText(name).width;
      ctx.restore();
      const budget = slot.maxNameWidthFrac * w;
      if (Number.isFinite(width) && width > budget && width > 0) {
        nameSize = Math.max(8, Math.floor(nameSize * (budget / width)));
      }
    }

    ctx.save();
    ctx.fillStyle = slot.colour;
    ctx.textBaseline = 'alphabetic';

    if (name) {
      ctx.font = `${nameSize}px ${STAMP_FONT_STACK}`;
      ctx.textAlign = 'right';
      ctx.fillText(name, slot.onLeftFrac * w - gap, baseline);
    }

    ctx.font = `${Math.round(slot.sizeFrac * h)}px ${STAMP_FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(dateText, slot.onRightFrac * w + gap, baseline);
    ctx.restore();
    return;
  }

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
