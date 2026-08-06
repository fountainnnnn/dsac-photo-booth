import { describe, expect, it } from 'vitest';
import { BUILT_IN_FRAMES, FRAME_H, FRAME_W, drawDateStamp } from './frame';

/**
 * The caption layout is measured off the artwork and differs per frame, so a
 * wrong constant produces a photo that looks fine in code review and wrong on
 * the print. Both built-ins use a centred two-line block in the quiet middle
 * of the footer.
 */

interface Drawn { text: string; x: number; y: number; align: string; font: string }

/** Pixel size out of a CSS font string, which may lead with a weight. */
const fontPx = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);

/** An outline pass, kept apart from the fills so the fill assertions still line up. */
interface Stroked { text: string; colour: string; lineWidth: number; font: string }

/** Records what was drawn. Text metrics are stubbed proportional to length. */
function recorder() {
  const drawn: Drawn[] = [];
  const stroked: Stroked[] = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineJoin: 'miter', lineWidth: 1,
    textAlign: 'left', textBaseline: 'alphabetic',
    save() {}, restore() {},
    measureText: (t: string) => ({ width: t.length * 0.5 * fontPx(ctx.font) }),
    fillText(text: string, x: number, y: number) {
      drawn.push({ text, x, y, align: ctx.textAlign, font: ctx.font });
    },
    strokeText(text: string) {
      stroked.push({ text, colour: ctx.strokeStyle, lineWidth: ctx.lineWidth, font: ctx.font });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, stroked };
}

const frame = (id: string) => {
  const f = BUILT_IN_FRAMES.find((b) => b.id === id);
  if (!f) throw new Error(`no built-in frame "${id}"`);
  return f;
};

const EVENT = { eventName: 'AI Learning Journey' };

/** Today, formatted the way the stamp writes it. */
const TODAY = (() => {
  const d = new Date();
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
})();

function draw(id: string) {
  const { ctx, drawn } = recorder();
  drawDateStamp(ctx, frame(id), FRAME_W, FRAME_H, EVENT);
  return drawn;
}

describe('drawDateStamp', () => {
  it('centres the event name above the date on both frames', () => {
    for (const id of ['tech', 'doodle']) {
      const slot = frame(id).captionSlot!;
      const [name, date] = draw(id);
      expect(name.text).toBe('AI Learning Journey');
      expect(name.align).toBe('center');
      expect(name.x).toBeCloseTo(FRAME_W / 2, 0);
      expect(name.y).toBeLessThan(date.y);
      expect(date.text).toBe(TODAY);
      expect(date.align).toBe('center');
      expect(date.x).toBeCloseTo(FRAME_W / 2, 0);
      expect(date.y).toBeCloseTo(slot.baselineFrac * FRAME_H, 0);
    }
  });

  it('shrinks a long name rather than overrunning its budget', () => {
    const { ctx, drawn } = recorder();
    const long = 'An Extraordinarily Long Event Name That Will Never Fit';
    drawDateStamp(ctx, frame('tech'), FRAME_W, FRAME_H, { ...EVENT, eventName: long });

    const slot = frame('tech').captionSlot!;
    const nominal = slot.nameAbove!.sizeFrac * FRAME_H;
    const size = fontPx(drawn[0].font);
    expect(size).toBeLessThan(nominal);
    expect(long.length * 0.5 * size).toBeLessThanOrEqual(
      slot.nameAbove!.maxWidthFrac * FRAME_W + 1,
    );
  });

  it('draws only the date when the event name is blank', () => {
    const { ctx, drawn } = recorder();
    drawDateStamp(ctx, frame('tech'), FRAME_W, FRAME_H, { ...EVENT, eventName: '  ' });
    expect(drawn.map((d) => d.text)).toEqual([TODAY]);
  });

  it('sets the event name bold and the date regular', () => {
    const [name, date] = draw('tech');
    expect(name.font).toMatch(/^bold /);
    expect(date.font).not.toMatch(/bold/);
  });

  // Ink Free has no bold face, so the weight alone is a synthesised one and
  // prints thin. The name is outlined in its own colour to thicken it; the
  // date is not, or the two lines would weigh the same.
  it('outlines only the event name, in the caption colour', () => {
    for (const id of ['tech', 'doodle']) {
      const slot = frame(id).captionSlot!;
      const { ctx, stroked } = recorder();
      drawDateStamp(ctx, frame(id), FRAME_W, FRAME_H, EVENT);

      expect(stroked.map((s) => s.text)).toEqual(['AI Learning Journey']);
      expect(stroked[0].colour).toBe(slot.colour);
      expect(stroked[0].lineWidth).toBeCloseTo(fontPx(stroked[0].font) / 24, 5);
    }
  });

  it('writes today, spelled out, with no way to pin a stale date', () => {
    const { ctx, drawn } = recorder();
    drawDateStamp(ctx, frame('tech'), FRAME_W, FRAME_H, { eventName: '' });
    expect(drawn[0].text).toBe(TODAY);
    expect(drawn[0].text).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  });
});
