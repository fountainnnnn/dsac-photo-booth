/**
 * Session gallery.
 *
 * Only downscaled thumbnails are kept. A full 16:10 capture is ~300KB of
 * base64, which would exhaust localStorage after a handful of photos and start
 * throwing mid-event; a 360px thumbnail is roughly 20KB.
 */

const KEY = 'dsac.gallery.v1';
const MAX_ENTRIES = 12;
const THUMB_W = 360;

export interface GalleryEntry {
  thumb: string;
  at: string;
}

export function readGallery(): GalleryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearGallery() {
  try { localStorage.removeItem(KEY); } catch { /* storage disabled */ }
}

/** Downscale then persist. Never throws — a full gallery must not break capture. */
export function rememberCapture(dataUrl: string) {
  const img = new Image();
  img.onload = () => {
    try {
      const scale = THUMB_W / (img.naturalWidth || THUMB_W);
      const c = document.createElement('canvas');
      c.width = THUMB_W;
      c.height = Math.round((img.naturalHeight || THUMB_W) * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, c.width, c.height);

      const next: GalleryEntry[] = [
        { thumb: c.toDataURL('image/jpeg', 0.7), at: new Date().toISOString() },
        ...readGallery(),
      ].slice(0, MAX_ENTRIES);

      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Quota exceeded or storage disabled — drop the oldest and give up quietly.
      try { localStorage.removeItem(KEY); } catch { /* nothing more to do */ }
    }
  };
  img.src = dataUrl;
}
