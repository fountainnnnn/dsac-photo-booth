/**
 * The "I was there" card.
 *
 * A guest taps their own face in the group photo and gets a portrait card of
 * just them, framed and captioned. It is the same idea as the event frames in
 * `frame.ts` — artwork with a window the photo is drawn into — with one
 * difference that matters: there is no artboard PNG behind it. The card is
 * drawn in code.
 *
 * That is deliberate for now. The stage frames exist because a designer made
 * them; nobody has drawn a card yet, and a booth feature that cannot be tried
 * until artwork lands is a feature nobody can give feedback on. Everything
 * below is expressed in the same fractional geometry the PNG frames use, so
 * swapping in real artwork later is a `FrameConfig` and a `drawImage`, not a
 * rewrite.
 */

import {
  EVENT_NAME_FONT_STACK,
  NAME_WEIGHT,
  STAMP_FONT_STACK,
  fitFontPx,
  formatEventDate,
  stampDate,
  type EventDetails,
} from './frame';

/** Portrait, in the proportions of a trading card. */
export const CARD_W = 1000;
export const CARD_H = 1400;
export const CARD_ASPECT = CARD_W / CARD_H;

/** The photo window, as fractions of the card. A wide margin holds the caption. */
export const CARD_WINDOW = { x: 0.06, y: 0.06, w: 0.88, h: 0.72 };

/** The line above the event name on the card. */
export const CARD_KICKER = 'I WAS THERE';

/** DSAC red and the deep ink the kiosk already uses. */
const ACCENT = '#e1262f';
const INK = '#0b0a0c';
const PAPER = '#ffffff';

/** Rounded rect, because `roundRect` is missing in jsdom and older Safari. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draw tracked-out capitals, as the card's kicker line is set.
 *
 * `letterSpacing` is the right tool and is in every browser that can reach the
 * booth, but it is missing in jsdom and in older Safari, and a canvas that
 * ignores it would set the kicker solid. So the fallback pads the string by
 * hand. Splitting on the character and joining with a space is what the card
 * did before, and it is wrong for text that already contains spaces — a word
 * gap becomes indistinguishable from a letter gap, which is how "I WAS THERE"
 * came out reading as "IWAS THERE". Padding word by word keeps the two apart.
 */
export function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  em = 0.22,
) {
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof spaced.letterSpacing === 'string') {
    // save/restore rather than putting the old value back by hand:
    // `letterSpacing` is part of the canvas drawing state, and reading it back
    // can yield a string the setter then rejects, which left the tracking
    // switched on and spaced out every line drawn after the kicker.
    ctx.save();
    spaced.letterSpacing = `${em}em`;
    ctx.fillText(text, x, y);
    ctx.restore();
    return;
  }
  ctx.fillText(
    text.split(/\s+/).map(word => word.split('').join(' ')).join(' '),
    x, y,
  );
}

export interface CardOptions {
  /** Printed under the photo. Falls back to the booth's configured event. */
  event?: Partial<EventDetails> | null;
  /** The line above the event name. Kept short; it is set in small caps. */
  kicker?: string;
}

/**
 * Draw the finished card onto `ctx`, which must be CARD_W x CARD_H.
 *
 * `source` is the already-cropped square-ish region of the guest — cropping is
 * the caller's job, because the crop is what the guest adjusted by hand and
 * this function must not second-guess it. The image is drawn to *cover* the
 * window, never letterboxed, matching the rule the event frames hold.
 */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  options: CardOptions = {},
) {
  const w = CARD_W;
  const h = CARD_H;

  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  // A thin accent bar down the left edge, so the card reads as DSAC's at a
  // glance in a camera roll full of other people's photos.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, w * 0.018, h);

  // The photo, covering its window.
  const wx = CARD_WINDOW.x * w;
  const wy = CARD_WINDOW.y * h;
  const ww = CARD_WINDOW.w * w;
  const wh = CARD_WINDOW.h * h;

  ctx.save();
  roundedPath(ctx, wx, wy, ww, wh, w * 0.03);
  ctx.clip();

  const scale = Math.max(ww / sourceW, wh / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  ctx.drawImage(
    source,
    wx + (ww - drawW) / 2,
    wy + (wh - drawH) / 2,
    drawW,
    drawH,
  );
  ctx.restore();

  // Hairline around the window, to separate a dark photo from a white card.
  ctx.save();
  roundedPath(ctx, wx, wy, ww, wh, w * 0.03);
  ctx.strokeStyle = 'rgba(11,10,12,0.10)';
  ctx.lineWidth = Math.max(1, w * 0.002);
  ctx.stroke();
  ctx.restore();

  // Caption block.
  const kicker = (options.kicker ?? CARD_KICKER).toUpperCase();
  const name = (options.event?.eventName ?? '').trim();
  const date = formatEventDate(stampDate(options.event?.eventDate));

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const left = w * 0.075;
  const budget = w * 0.85;

  ctx.fillStyle = ACCENT;
  ctx.font = `${NAME_WEIGHT} ${Math.round(h * 0.021)}px ${STAMP_FONT_STACK}`;
  drawTracked(ctx, kicker, left, h * 0.845);

  if (name) {
    const size = fitFontPx(
      ctx, name, Math.round(h * 0.046), budget, NAME_WEIGHT, EVENT_NAME_FONT_STACK,
    );
    ctx.fillStyle = INK;
    ctx.font = `${NAME_WEIGHT} ${size}px ${EVENT_NAME_FONT_STACK}`;
    ctx.fillText(name, left, h * 0.905);
  }

  // Fitted to the same budget as the name above it. The date is fixed-width
  // but the line it sits on is not: it runs to the card edge on a narrow
  // artboard, and did, before this was measured.
  const footer = `${date}  ·  DSAC, Singapore Polytechnic`;
  ctx.fillStyle = 'rgba(11,10,12,0.55)';
  ctx.font = `${fitFontPx(ctx, footer, Math.round(h * 0.026), budget)}px ${STAMP_FONT_STACK}`;
  ctx.fillText(footer, left, h * 0.952);

  ctx.restore();
}
