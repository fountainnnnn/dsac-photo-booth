import { BACKGROUNDS, type BackgroundOption } from '@/types/scene';

/**
 * Places a guest may type that get a real photo instead of a drawn one.
 *
 * The booth stands at Singapore Polytechnic's own Open House, so "SP" is the
 * most likely thing typed, and an image model cannot draw the real campus.
 * Any way of writing it — "SP", "S.P.", "sp campus", "Singapore Poly",
 * "singapore polytechnic", a typo of it — gets the campus photo, at once and
 * for nothing: nothing is sent to the image service.
 */

const SP = BACKGROUNDS.find(b => b.id === 'sp');

/**
 * The words as lower-case letters, spaced, with single letters run together
 * ("S.P." and "s p" both read as "sp"), a possessive dropped ("SP's") and
 * other apostrophes closed up ("s'pore").
 */
function words(text: string): string[] {
  const split = text.toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .split(/[^a-z]+/).filter(Boolean);
  const out: string[] = [];
  let run = '';
  for (const w of split) {
    if (w.length === 1) { run += w; continue; }
    if (run) out.push(run);
    run = '';
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}

/** Singapore, as people shorten it. */
const SINGAPORE = /^(singapore|spore|sgpore|sg)$/;

/** True for any way of writing Singapore Polytechnic. */
export function meansSP(text: string): boolean {
  const w = words(text);
  if (w.includes('sp')) return true;
  // "singaporepolytechnic", typed without the space.
  if (w.some(x => /^(singapore|spore|sg)poly/.test(x))) return true;
  // "Singapore Poly", "Singapore Polytechnic", "Singapore Polytrechnic".
  return w.some((x, i) => SINGAPORE.test(x) && /^poly/.test(w[i + 1] ?? ''));
}

/** The ready-made photo for what was typed, or null to have one drawn. */
export function knownPlace(text: string): BackgroundOption | null {
  return SP && meansSP(text) ? SP : null;
}
