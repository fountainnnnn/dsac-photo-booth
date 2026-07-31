import { describe, expect, it } from 'vitest';
import { BUILT_IN_FRAMES, FRAME_H, FRAME_W, drawDateStamp } from './frame';

/**
 * The caption layout is measured off the artwork and differs per frame, so a
 * wrong constant produces a photo that looks fine in code review and wrong on
 * the print. These tests pin the layout the design PDF specifies: tech stacks
 * the event name on its own centred line above "on <date>", doodle runs the
 * whole caption inline.
 */

interface Drawn { text: string; x: number; y: number; align: string; font: string }

/** Records what was drawn. Text metrics are stubbed proportional to length. */
function recorder() {
  const drawn: Drawn[] = [];
  const ctx = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() {}, restore() {},
    measureText: (t: string) => ({ width: t.length * 0.5 * parseInt(ctx.font, 10) }),
    fillText(text: string, x: number, y: number) {
      drawn.push({ text, x, y, align: ctx.textAlign, font: ctx.font });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

const frame = (id: string) => {
  const f = BUILT_IN_FRAMES.find((b) => b.id === id);
  if (!f) throw new Error(`no built-in frame "${id}"`);
  return f;
};

const EVENT = { eventName: 'AI Learning Journey', eventDate: '2026-05-19' };

function draw(id: string) {
  const { ctx, drawn } = recorder();
  drawDateStamp(ctx, frame(id), FRAME_W, FRAME_H, EVENT);
  return drawn;
}

describe('drawDateStamp', () => {
  it('stacks the event name above the date on the tech frame', () => {
    const [name, date] = draw('tech');

    expect(name.text).toBe('AI Learning Journey');
    expect(name.align).toBe('center');
    expect(name.x).toBeCloseTo(FRAME_W / 2, 0);
    expect(date.text).toBe('19/5/2026');

    // Its own line, clear of the one below and larger than it.
    expect(name.y).toBeLessThan(date.y - 40);
    expect(parseInt(name.font, 10)).toBeGreaterThan(parseInt(date.font, 10));
  });

  it('runs the whole caption inline on the doodle frame', () => {
    const [name, date] = draw('doodle');
    const slot = frame('doodle').captionSlot!;

    expect(name.text).toBe('AI Learning Journey');
    expect(name.y).toBe(date.y);                       // one line
    expect(name.align).toBe('right');                  // ends before the "on"
    expect(name.x).toBeLessThan(slot.onLeftFrac * FRAME_W);
    expect(date.x).toBeGreaterThan(slot.onRightFrac * FRAME_W);
  });

  it('lands the date after the printed "on" on both frames', () => {
    for (const id of ['tech', 'doodle']) {
      const slot = frame(id).captionSlot!;
      const date = draw(id).find((d) => d.text === '19/5/2026');
      expect(date?.align).toBe('left');
      expect(date?.x).toBeGreaterThan(slot.onRightFrac * FRAME_W);
      expect(date?.y).toBeCloseTo(slot.baselineFrac * FRAME_H, 0);
    }
  });

  it('shrinks a long name rather than overrunning its budget', () => {
    const { ctx, drawn } = recorder();
    const long = 'An Extraordinarily Long Event Name That Will Never Fit';
    drawDateStamp(ctx, frame('tech'), FRAME_W, FRAME_H, { ...EVENT, eventName: long });

    const nominal = frame('tech').captionSlot!.nameAbove!.sizeFrac * FRAME_H;
    const size = parseInt(drawn[0].font, 10);
    expect(size).toBeLessThan(nominal);
    expect(long.length * 0.5 * size).toBeLessThanOrEqual(
      frame('tech').captionSlot!.nameAbove!.maxWidthFrac * FRAME_W + 1,
    );
  });

  it('draws only the date when the event name is blank', () => {
    const { ctx, drawn } = recorder();
    drawDateStamp(ctx, frame('tech'), FRAME_W, FRAME_H, { ...EVENT, eventName: '  ' });
    expect(drawn.map((d) => d.text)).toEqual(['19/5/2026']);
  });
});
