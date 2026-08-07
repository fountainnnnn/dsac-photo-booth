/**
 * Event frames.
 *
 * Each frame is a full-bleed PNG with a transparent photo window, drawn over
 * the captured photo. The artboards are 1921x1201 (16:10), and the stage uses
 * that aspect whenever a frame is on — stretching a 16:10 frame onto a 16:9
 * photo would distort the SP logos and the caption.
 *
 * Every `window` is 16:9, matching the camera, so the photo is only ever
 * scaled into it — never fitted, stretched or letterboxed. Where a cut-out is
 * not 16:9 the window is the 16:9 rect that *covers* it: the photo fills the
 * hole completely and the artwork hides the overhang. Holding that invariant
 * in the geometry is what removed the reshaping from the drawing code.
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

/** A caption drawn entirely by us: event name on the left, date on the right. */
export interface CaptionSlot {
  /** The name ends here and the date starts here, leaving a clean centre gap. */
  nameRightFrac: number;
  dateLeftFrac: number;
  /** Shared baseline, as a fraction of frame height. */
  baselineFrac: number;
  /** Font size as a fraction of frame height. */
  sizeFrac: number;
  colour: string;
  /** Date alignment; built-in frames centre it beneath the event name. */
  dateAlign?: 'left' | 'center';
  /** Extra breathing room on both sides of the centre gap. */
  gapFrac: number;
  /** Budget for an inline event name; a longer one shrinks rather than colliding. */
  maxNameWidthFrac: number;
  /** Optional legacy layout for uploaded artwork that needs a stacked name. */
  nameAbove?: NameLine;
}

/** A centred line of its own for the event name, above the "on ..." line. */
export interface NameLine {
  /** Centre x and baseline y, as fractions of the frame. */
  centreFrac: number;
  baselineFrac: number;
  /** Font size as a fraction of frame height. Larger than the line below it. */
  sizeFrac: number;
  /** Width budget; a longer name shrinks rather than running into the artwork. */
  maxWidthFrac: number;
}

/**
 * `size`, shrunk just enough that `text` fits `budget` px wide.
 *
 * jsdom and other non-rendering contexts have no text metrics, so an
 * unmeasurable string keeps its nominal size rather than throwing.
 */
export function fitFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  budget: number,
  weight = '',
): number {
  if (!text || typeof ctx?.measureText !== 'function' || budget <= 0) return size;
  ctx.save();
  // Measure at the weight it will be drawn at — bold is wider, and measuring
  // regular would let a bold name overrun the budget it was fitted to.
  ctx.font = `${weight} ${size}px ${STAMP_FONT_STACK}`.trim();
  const width = ctx.measureText(text).width;
  ctx.restore();
  if (!Number.isFinite(width) || width <= budget) return size;
  return Math.max(8, Math.floor(size * (budget / width)));
}

/** Event details an operator can change without touching the artwork. */
export interface EventDetails {
  eventName: string;
  /**
   * The date printed on the photo, as `YYYY-MM-DD`. Empty means today.
   *
   * Today was once the only option, on the reasoning that a booth is set up on
   * the day it runs and a stale pinned date is wrong silently. That holds — so
   * empty is still the default and still means "whatever day it is". But it is
   * not the whole story: a booth shot after midnight, or set up the evening
   * before, or run for a dated event on a different day, needs to say so.
   * Setting it is now deliberate rather than accidental.
   */
  eventDate: string;
}

export const DEFAULT_EVENT_DETAILS: EventDetails = {
  eventName: 'Transformation Made Possible',
  eventDate: '',
};

/**
 * The date to stamp: the operator's if they set one, otherwise today.
 *
 * Parsed field by field rather than handed to `new Date(string)`, which reads
 * a bare `YYYY-MM-DD` as UTC midnight — far enough east or west of Greenwich
 * and the photo prints the day before the one that was typed.
 */
export function stampDate(eventDate?: string | null): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((eventDate ?? '').trim());
  if (!m) return new Date();
  const [, y, mo, d] = m;
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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
  /** Hidden from the operator's frame picker when false. */
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

/**
 * The event name is set bold, the date is not, so the name reads as the
 * heading of the two-line block. Ink Free ships no bold face, so this is a
 * synthesised bold — heavier and slightly wider, which is why `fitFontPx`
 * has to measure at the same weight.
 */
export const NAME_WEIGHT = 'bold';

/** Ships with the app. Geometry is measured off the artboards, so it lives here
 *  rather than in the database an operator can edit. */
const BUILT_IN_SOURCE: FrameConfig[] = [
  {
    id: 'tech',
    label: 'Tech',
    src: '/frames/frame-tech.png',
    // Cut-out measured at 161,190 sized 1614x786 — a wide 2.05 slot. The window
    // is the 16:9 rect that covers it, so 61px above and 62px below sit behind
    // the artwork. That loss is the price of not distorting anyone.
    window: { x: 0.08381, y: 0.10746, w: 0.84019, h: 0.75593 },
    // A centred two-line block keeps the caption away from edge artwork.
    captionSlot: {
      nameRightFrac: 0.5,
      dateLeftFrac: 0.5,
      baselineFrac: 0.968,
      sizeFrac: 0.031,
      colour: '#b1dfe0',
      dateAlign: 'center',
      gapFrac: 0,
      maxNameWidthFrac: 0.46,
      nameAbove: {
        centreFrac: 0.5,
        baselineFrac: 0.91,
        sizeFrac: 0.038,
        maxWidthFrac: 0.5,
      },
    },
  },
  {
    id: 'doodle',
    label: 'Doodle',
    src: '/frames/frame-doodle.png',
    // Cut-out measured at 137,160 sized 1644x923, which is already 1.781 — all
    // but 16:9. Widened by a pixel or two to match exactly. The brush edge is
    // irregular, so this is its bounding box; the artwork covers the corners.
    window: { x: 0.07132, y: 0.13249, w: 0.85580, h: 0.76998 },
    // A centred two-line block fits between the footer's edge doodles.
    captionSlot: {
      nameRightFrac: 0.5,
      dateLeftFrac: 0.5,
      baselineFrac: 0.978,
      sizeFrac: 0.032,
      colour: '#12817b',
      dateAlign: 'center',
      gapFrac: 0,
      maxNameWidthFrac: 0.44,
      nameAbove: {
        centreFrac: 0.5,
        baselineFrac: 0.935,
        sizeFrac: 0.034,
        maxWidthFrac: 0.48,
      },
    },
  },
];

export const BUILT_IN_FRAMES: FrameConfig[] = BUILT_IN_SOURCE.map((f) => ({
  ...f, builtIn: true, enabled: true,
}));

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * "31 Dec 2026" — day, short month, year. Spelled out rather than numeric so
 * the photo reads the same to a guest who writes dates month-first.
 */
export function formatEventDate(date: Date = new Date()): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
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
  // The operator's date if they set one, today if they did not.
  const date = stampDate(event?.eventDate);

  // Artwork with no caption of its own gets the whole line drawn here, so the
  // event name is ours to set. Artwork that bakes its caption into the pixels
  // can only have the date appended after it.
  const slot = frame.captionSlot;
  if (slot) {
    const name = (event?.eventName ?? DEFAULT_EVENT_DETAILS.eventName).trim();
    const dateText = formatEventDate(date);
    const baseline = slot.baselineFrac * h;
    const gap = slot.gapFrac * w;
    const above = slot.nameAbove;

    ctx.save();
    ctx.fillStyle = slot.colour;
    ctx.textBaseline = 'alphabetic';

    /**
     * The name, drawn heavier than a synthesised bold manages on its own.
     *
     * Ink Free has no bold face, so `NAME_WEIGHT` only asks the rasteriser to
     * fake one and the result still looks light against the artwork. Stroking
     * the same text in the same colour before filling it thickens every stroke
     * evenly; a round join keeps the corners from spiking. Only the name gets
     * this — the date is meant to read as the lighter of the two lines.
     */
    const drawName = (size: number, x: number, y: number) => {
      ctx.strokeStyle = slot.colour;
      ctx.lineJoin = 'round';
      ctx.lineWidth = size / 24;
      ctx.strokeText(name, x, y);
      ctx.fillText(name, x, y);
    };

    if (name && above) {
      // Its own centred line, set larger than the date below it.
      const size = fitFontPx(ctx, name, Math.round(above.sizeFrac * h), above.maxWidthFrac * w, NAME_WEIGHT);
      ctx.font = `${NAME_WEIGHT} ${size}px ${STAMP_FONT_STACK}`;
      ctx.textAlign = 'center';
      drawName(size, above.centreFrac * w, above.baselineFrac * h);
    } else if (name) {
      // Inline, shrunk only if it would collide with the surrounding artwork.
      const size = fitFontPx(ctx, name, Math.round(slot.sizeFrac * h), slot.maxNameWidthFrac * w, NAME_WEIGHT);
      ctx.font = `${NAME_WEIGHT} ${size}px ${STAMP_FONT_STACK}`;
      ctx.textAlign = 'right';
      drawName(size, slot.nameRightFrac * w - gap, baseline);
    }

    ctx.font = `${Math.round(slot.sizeFrac * h)}px ${STAMP_FONT_STACK}`;
    ctx.textAlign = slot.dateAlign === 'center' ? 'center' : 'left';
    ctx.fillText(dateText, slot.dateLeftFrac * w + gap, baseline);
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
