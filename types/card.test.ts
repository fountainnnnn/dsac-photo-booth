import { describe, expect, it, vi } from 'vitest';
import { CARD_KICKER, drawTracked } from './card';

/**
 * A canvas context stub that records what was filled.
 *
 * `letterSpacing` is present or absent depending on the test, because the two
 * branches of `drawTracked` are exactly what is being pinned: the browser path
 * must not pad the string, and the fallback must keep word gaps wider than
 * letter gaps.
 */
function stubContext(withLetterSpacing: boolean) {
  const calls: string[] = [];
  const ctx = {
    fillText: vi.fn((text: string) => { calls.push(text); }),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { letterSpacing?: string };
  if (withLetterSpacing) (ctx as { letterSpacing?: string }).letterSpacing = '';
  return { ctx, calls };
}

describe('drawTracked', () => {
  it('uses letterSpacing where the browser has it, leaving the text alone', () => {
    const { ctx, calls } = stubContext(true);
    drawTracked(ctx, CARD_KICKER, 0, 0);
    expect(calls).toEqual([CARD_KICKER]);
  });

  /**
   * The tracking must not escape the one line it was asked for.
   *
   * This is pinned against a context that behaves like the real one: canvas
   * restores `letterSpacing` on `restore()`, and putting the old value back by
   * hand did not work — which spaced out the event name and pushed the footer
   * off the edge of the card.
   */
  it('leaves letterSpacing untouched for everything drawn afterwards', () => {
    const state: string[] = [];
    let letterSpacing = '0px';
    const ctx = {
      fillText: vi.fn(),
      save: vi.fn(() => { state.push(letterSpacing); }),
      restore: vi.fn(() => { letterSpacing = state.pop() ?? '0px'; }),
      get letterSpacing() { return letterSpacing; },
      set letterSpacing(v: string) { letterSpacing = v; },
    } as unknown as CanvasRenderingContext2D;

    drawTracked(ctx, CARD_KICKER, 0, 0);

    expect((ctx as unknown as { letterSpacing: string }).letterSpacing).toBe('0px');
    expect(state).toHaveLength(0);
  });

  it('keeps word gaps wider than letter gaps in the fallback', () => {
    // The bug this pins: joining every character with one space made the gap
    // between words identical to the gap between letters, so "I WAS THERE"
    // read as "IWAS THERE".
    const { ctx, calls } = stubContext(false);
    drawTracked(ctx, CARD_KICKER, 0, 0);

    const drawn = calls[0];

    // Asserted as a property, not a literal: which space characters are used
    // is a typographic choice, but the word gap being distinct from the letter
    // gap is the thing that was broken and must stay fixed.
    //
    // "I" is a single letter, so the separator right after it is the *word*
    // gap; the one inside "WAS" is the letter gap.
    const wordGap = drawn[1];
    const letterGap = drawn[3];

    expect(wordGap).not.toBe(letterGap);
    expect(drawn.split(wordGap)).toHaveLength(CARD_KICKER.split(' ').length);
    expect(drawn.split(wordGap)[1].split(letterGap)).toEqual(['W', 'A', 'S']);

    // Every letter still present, in order, once the padding is taken out.
    expect(drawn.replace(/\s+/gu, '')).toBe(CARD_KICKER.replace(/\s+/gu, ''));
  });
});
