/**
 * Where a tap on the group photo turns into a crop.
 *
 * Kept apart from the component and free of the DOM, because this is the part
 * that is easy to get subtly wrong — an off-by-one in the clamping shows up as
 * a card with a sliver of black down one edge, which nobody notices until an
 * event. It is arithmetic, so it is tested as arithmetic.
 *
 * Every rect here is in *source pixels*, not CSS pixels. The component converts
 * once, on the way in, so nothing downstream has to know how big the photo is
 * being displayed.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How much taller than a detected face box the crop should be.
 *
 * A face box is a face. A card wants head and shoulders, so the crop is grown
 * generously below the box and modestly above it — hair needs less room than a
 * chest does, and a crop centred on the face alone looks like a mugshot.
 */
const ABOVE = 0.9;
const BELOW = 1.5;

/** The default crop, as a fraction of the photo's shorter side. */
const DEFAULT_SPAN = 0.42;

/** Clamp a rect inside `0,0,imageW,imageH`, sliding it rather than shrinking it. */
export function clampToImage(rect: Rect, imageW: number, imageH: number): Rect {
  // Shrink only if the rect is genuinely larger than the photo; otherwise a
  // crop near an edge should slide back into view at the size the guest chose.
  const w = Math.min(rect.w, imageW);
  const h = Math.min(rect.h, imageH);
  return {
    w,
    h,
    x: Math.min(Math.max(rect.x, 0), imageW - w),
    y: Math.min(Math.max(rect.y, 0), imageH - h),
  };
}

/**
 * A crop of `aspect`, centred on a point, sized `span` of the shorter side.
 *
 * This is the fallback path and the one that always works: no model, no
 * network, nothing to fail. A guest taps and gets a box they can then drag.
 */
export function cropAroundPoint(
  point: { x: number; y: number },
  imageW: number,
  imageH: number,
  aspect: number,
  span = DEFAULT_SPAN,
): Rect {
  const shorter = Math.min(imageW, imageH);
  const h = shorter * span;
  const w = h * aspect;
  return clampToImage({ x: point.x - w / 2, y: point.y - h / 2, w, h }, imageW, imageH);
}

/**
 * Grow a detected face box into a head-and-shoulders crop of `aspect`.
 *
 * The box drives the height; the width follows from the aspect. Doing it the
 * other way round makes a wide detection on a turned head produce a crop that
 * cuts the chin off.
 */
export function cropAroundFace(
  face: Rect,
  imageW: number,
  imageH: number,
  aspect: number,
): Rect {
  const h = face.h * (1 + ABOVE + BELOW);
  const w = h * aspect;
  const centreX = face.x + face.w / 2;
  const top = face.y - face.h * ABOVE;
  return clampToImage({ x: centreX - w / 2, y: top, w, h }, imageW, imageH);
}

/**
 * How far from a face a tap may land and still be taken as meaning that face,
 * as a multiple of the face's own size.
 *
 * Snapping to the nearest face no matter how far away it was is a mistake that
 * only shows up on a real photograph. Detection does not find everybody: on a
 * group photographed across a room it found two faces out of six. With an
 * unbounded search, all four of the people it missed snapped to one of the two
 * it had found, and every one of them would have been handed a stranger's
 * portrait. Placing the crop where they actually tapped is merely imprecise;
 * placing it on somebody else is wrong.
 *
 * A tap within about a face's width counts as aiming at that face — fingers are
 * blunt and a face box stops at the chin. Beyond that the tap is taken at its
 * word.
 */
const SNAP_RADIUS = 1.0;

/**
 * The detected face a tap means, or null.
 *
 * "Containing" comes first so that tapping squarely on someone always picks
 * them, even in a group photo where a neighbour's box centre happens to be
 * closer to the tap than their own. Null means either that nothing was detected
 * or that the tap was nowhere near what was — both of which are the caller's
 * cue to fall back to `cropAroundPoint`.
 */
export function faceAtPoint(faces: Rect[], point: { x: number; y: number }): Rect | null {
  if (!faces.length) return null;

  const hit = faces.find(f => (
    point.x >= f.x && point.x <= f.x + f.w
    && point.y >= f.y && point.y <= f.y + f.h
  ));
  if (hit) return hit;

  let best: Rect | null = null;
  let bestDistance = Infinity;
  for (const f of faces) {
    const dx = f.x + f.w / 2 - point.x;
    const dy = f.y + f.h / 2 - point.y;
    const distance = Math.hypot(dx, dy);
    // Measured against this face's own size, so a big close-up forgives a
    // looser tap than a small distant one.
    const reach = Math.max(f.w, f.h) * (0.5 + SNAP_RADIUS);
    if (distance < bestDistance && distance <= reach) {
      bestDistance = distance;
      best = f;
    }
  }
  return best;
}

/**
 * Move a crop by a drag, keeping it inside the photo.
 *
 * A separate function from `clampToImage` only so the component reads as what
 * it is doing rather than as arithmetic.
 */
export function moveCrop(rect: Rect, dx: number, dy: number, imageW: number, imageH: number): Rect {
  return clampToImage({ ...rect, x: rect.x + dx, y: rect.y + dy }, imageW, imageH);
}

/**
 * Scale a crop about its own centre, keeping its aspect and staying in bounds.
 *
 * Bounded below at 12% of the shorter side, because past that the crop is
 * smaller than a face and the card is a blur, and above at the whole photo.
 */
export function scaleCrop(
  rect: Rect,
  factor: number,
  imageW: number,
  imageH: number,
): Rect {
  const aspect = rect.w / rect.h;
  const shorter = Math.min(imageW, imageH);
  const minH = shorter * 0.12;
  const maxH = Math.min(imageH, imageW / aspect);

  const h = Math.min(Math.max(rect.h * factor, minH), maxH);
  const w = h * aspect;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  return clampToImage({ x: cx - w / 2, y: cy - h / 2, w, h }, imageW, imageH);
}
