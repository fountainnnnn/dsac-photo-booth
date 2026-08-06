export interface ImageFilters {
  brightness: number;  // CSS % — 100 = normal
  contrast: number;
  saturation: number;
  hue: number;         // degrees, -180 to 180
}

export const DEFAULT_FILTERS: ImageFilters = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
};

export function filtersToCSS(f: ImageFilters): string {
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) hue-rotate(${f.hue}deg)`;
}

/**
 * How the Look is spread across the picture.
 *
 * 'even' is the ordinary case: the adjustments apply everywhere. A direction
 * applies the whole Look — brightness, contrast, saturation and hue together —
 * in full at the edge the ramp starts from, fading linearly to the untouched
 * camera at the other end: 'down' starts fully adjusted at the top and fades
 * toward the bottom. There is no second amount to set; the sliders are the
 * amount.
 *
 * Deliberately not part of `ImageFilters`: a CSS filter string is uniform by
 * definition, so a ramp cannot be expressed in one. It is painted as a faded
 * second layer in the shared draw routine instead.
 */
export type LookRamp = 'even' | 'down' | 'up' | 'rightward' | 'leftward';

export const DEFAULT_RAMP: LookRamp = 'even';

/** The edge a ramp starts from, i.e. where the Look applies in full. */
export function rampStartEdge(ramp: LookRamp): 'top' | 'bottom' | 'left' | 'right' | null {
  switch (ramp) {
    case 'down': return 'top';
    case 'up': return 'bottom';
    case 'rightward': return 'left';
    case 'leftward': return 'right';
    default: return null;
  }
}

/** True when the sliders sit at their no-op values and there is nothing to spread. */
export function filtersAreNeutral(f: ImageFilters): boolean {
  return f.brightness === 100 && f.contrast === 100 && f.saturation === 100 && f.hue === 0;
}
