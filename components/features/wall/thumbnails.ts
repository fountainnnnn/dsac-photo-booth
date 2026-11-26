/**
 * Small copies of the photos for the wall.
 *
 * A booth photo can be 4,000 pixels wide or more. Dozens of those, moving,
 * would ask a laptop to keep gigabytes of decoded pixels, so each is drawn
 * once at wall size and only the small copy is shown.
 */

export interface Thumb {
  token: string;
  /** An object URL; revoke it with `dropThumb` when the photo leaves the wall. */
  url: string;
  /** Width over height. */
  aspect: number;
}

/** The long edge of a wall copy, in pixels: sharp on a large lane at 2x. */
export const THUMB_LONG_EDGE = 900;

export async function makeThumb(token: string, src: string, longEdge = THUMB_LONG_EDGE): Promise<Thumb> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const aspect = bitmap.width / bitmap.height;
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode'))), 'image/jpeg', 0.86);
    });
    return { token, url: URL.createObjectURL(blob), aspect };
  } finally {
    bitmap.close();
  }
}

export function dropThumb(thumb: Thumb): void {
  URL.revokeObjectURL(thumb.url);
}

/**
 * Wall copies of every photo given, a few at a time. A photo that cannot be
 * made (deleted a moment ago, say) is left out rather than failing the rest.
 */
export async function makeThumbs(
  photos: { token: string; src: string }[],
  concurrency = 4,
): Promise<Thumb[]> {
  const out: (Thumb | null)[] = new Array(photos.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < photos.length) {
      const i = next++;
      try {
        out[i] = await makeThumb(photos[i].token, photos[i].src);
      } catch {
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, photos.length) }, worker));
  return out.filter((t): t is Thumb => t !== null);
}
