/**
 * How long the scene's work takes on this laptop, so the operator can judge
 * whether it keeps up, on the machine that will actually run the booth.
 *
 * Each step keeps a running average. The live steps are measured wherever the
 * camera runs (the capture screen, or the preview in Settings); the shutter's
 * are also saved in this browser, so Settings can show the last photo's even
 * though it was taken on the capture screen.
 */

export type SpeedStep = 'segment' | 'faces' | 'cleanup' | 'shutter';

const KEY = 'booth.speed';
const WEIGHT = 0.2;

type Speeds = Partial<Record<SpeedStep, number>>;

function load(): Speeds {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Speeds;
  } catch {
    return {};
  }
}

/** Steps measured in this page, which are fresher than what was saved. */
const here: Speeds = {};

/** Record one timing, in milliseconds. */
export function recordSpeed(step: SpeedStep, ms: number) {
  if (!Number.isFinite(ms)) return;
  const was = here[step] ?? load()[step];
  here[step] = was === undefined ? ms : was + (ms - was) * WEIGHT;
  // Live steps run many times a second and are measured wherever they are
  // shown; only the shutter's need to reach another page.
  if (step !== 'shutter' && step !== 'cleanup') return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...here }));
  } catch {
    // Private mode: the readout just lasts as long as the page.
  }
}

/** The averages so far, in milliseconds, rounded. */
export function readSpeeds(): Speeds {
  const fresh = { ...load(), ...here };
  return Object.fromEntries(
    Object.entries(fresh).map(([k, v]) => [k, Math.round(v as number)]),
  ) as Speeds;
}
