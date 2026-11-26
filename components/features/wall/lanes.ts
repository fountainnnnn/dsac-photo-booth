/**
 * How the photo wall shares its photos out between lanes. Pure, so it can be
 * tested without a screen.
 */

/** Below this many photos per lane, every lane shows them all instead. */
export const SPARSE_PER_LANE = 2;

/**
 * The photos in each lane, in wall order (oldest kept first).
 *
 * With plenty of photos, each goes in one lane, dealt round like cards, so a
 * newly kept photo joins the end of a lane and nothing already up moves. With
 * only a few, dealing them out would leave lanes empty or showing one photo
 * over and over, so every lane shows all of them, each starting further along,
 * so neighbouring lanes do not line up.
 */
export function assignLanes<T>(items: T[], lanes: number): T[][] {
  const count = Math.max(1, Math.floor(lanes));
  if (items.length === 0) return Array.from({ length: count }, () => []);

  if (items.length < count * SPARSE_PER_LANE) {
    return Array.from({ length: count }, (_, i) => {
      const start = i % items.length;
      return [...items.slice(start), ...items.slice(0, start)];
    });
  }

  const out: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, j) => out[j % count].push(item));
  return out;
}

/**
 * How many times a lane's photos must be repeated so one pass of them is at
 * least as long as the screen: the lane scrolls two passes end to end, and
 * a shorter pass would leave a gap before it comes round again.
 *
 * `lengths` are each photo's length along the lane, gap included.
 */
export function repeatsToFill(lengths: number[], extent: number): number {
  const total = lengths.reduce((sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0), 0);
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(extent / total));
}

/**
 * How many lanes fit: about one per `target` pixels across, within limits,
 * so photos stay a comfortable size from a laptop to a large screen.
 */
export function laneCount(extent: number, target: number, min = 2, max = 8): number {
  if (!Number.isFinite(extent) || extent <= 0) return min;
  return Math.min(max, Math.max(min, Math.round(extent / target)));
}
