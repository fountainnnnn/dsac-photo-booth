import {
  AVATAR_SIZE_SCALE, TYPED_SLOTS, type AvatarOption, type AvatarSlot,
} from '@/types/scene';

/**
 * Turning a typed avatar from the server into one the face can wear.
 *
 * The image model cannot draw transparency, so the item comes on one flat
 * colour, magenta or green (see server/avatars.mjs). That colour is taken
 * away here, the picture is cut down to the item itself, and the server's mark
 * of where the wearer's face sits becomes the avatar's pin.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How strongly a pixel shows the backdrop's own colour, in the backdrop's
 * terms: for green, how far green outruns red and blue; for magenta, how far
 * red and blue both outrun green. The backdrop itself scores highest, and an
 * item's colours, kept off the backdrop's by the server, score 0 or less.
 */
function keyness(r: number, g: number, b: number, green: boolean): number {
  return green ? g - Math.max(r, b) : Math.min(r, b) - g;
}

/** Up to this share of the backdrop's own keyness, a pixel is all item... */
const SOLID = 0.1;
/** ...and from this share up, all backdrop. Between, it is the two blended. */
const SEE_THROUGH = 0.6;
/** A backdrop weaker than this is not a key colour at all. */
const LEAST_KEY = 80;
/** Most of the border must be backdrop, or the picture is not on one. */
const PLAIN = 0.85;
/** Smaller than this share of the picture, and nothing much was drawn. */
const LEAST_ITEM = 0.005;

/** The picture's backdrop colour: the median of its border. */
export function backdropOf(img: Pixels): { r: number; g: number; b: number } {
  const { data, width: w, height: h } = img;
  const border = borderPixels(w, h);
  const median = (c: number) => {
    const v = border.map(i => data[i * 4 + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return { r: median(0), g: median(1), b: median(2) };
}

function borderPixels(w: number, h: number): number[] {
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  return border;
}

/**
 * The picture with its backdrop taken away, and the box round what is left;
 * null when it is not on a plain backdrop, or has nothing on it.
 *
 * A difference key, as for a green screen: each pixel is as see-through as it
 * shows the backdrop's colour, so the backdrop goes wherever it is, through a
 * lens or an eye hole too. A pixel part way, on the item's edge or in a curl
 * of hair, is made part see-through, and the backdrop's tint is taken off its
 * colour; without that, every item has a magenta rim. (Dividing the backdrop
 * back out instead, the textbook way, turned the faintest edge pixels green:
 * it magnifies the picture's noise wherever there is little item left.)
 */
export function keyOut(img: Pixels): { data: Uint8ClampedArray; box: Box } | null {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const k = backdropOf(img);
  const green = k.g > Math.max(k.r, k.b);
  const full = keyness(k.r, k.g, k.b, green);
  if (full < LEAST_KEY) return null;

  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const t = keyness(data[p], data[p + 1], data[p + 2], green) / full;
    const a = Math.min(1, Math.max(0, (SEE_THROUGH - t) / (SEE_THROUGH - SOLID)));
    if (a === 0) {
      out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      continue;
    }
    let r = data[p];
    let g = data[p + 1];
    let b = data[p + 2];
    const tint = keyness(r, g, b, green);
    if (tint > 0) {
      if (green) g -= tint;
      else { r -= tint; b -= tint; }
    }
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = Math.round(a * data[p + 3]);
  }

  const border = borderPixels(w, h);
  if (border.filter(i => out[i * 4 + 3] === 0).length < border.length * PLAIN) return null;

  // What is left, and the box round it.
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1; let solid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (out[(y * w + x) * 4 + 3] < 24) continue;
      solid++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (solid < n * LEAST_ITEM) return null;
  return { data: out, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/** Where the server says the wearer's face sits, as fractions of its picture. */
export interface AvatarFit {
  x: number;
  y: number;
  faceWidth: number;
}

/**
 * The typed avatar, pinned by as much of the server's mark as its part of
 * the face trusts (`TYPED_SLOTS`), when the mark is sensible — an item no
 * wider than four faces (and on the head, no narrower than one), its pin no
 * further from it than its own size — and otherwise by its part of the face
 * alone.
 */
export function typedAvatarOption({ id, label, src, where, size, fit, box, width, height }: {
  id: string;
  label: string;
  src: string;
  where: string;
  size: string;
  fit: AvatarFit | null;
  /** The item, in the server's picture. */
  box: Box;
  /** The server's picture. */
  width: number;
  height: number;
}): AvatarOption {
  const slot = (Object.hasOwn(TYPED_SLOTS, where) ? where : 'head') as AvatarSlot;
  const place = TYPED_SLOTS[slot];
  const base = { id, label, src, slot, anchor: place.anchor, lift: place.lift };
  if (fit && place.fit !== 'none') {
    const faceWidth = fit.faceWidth * width;
    const marked = { x: (fit.x * width - box.x) / box.w, y: (fit.y * height - box.y) / box.h };
    // On the head, the item rests by its bottom edge; only where across it is marked.
    const pivot = place.fit === 'size' ? { x: marked.x, y: place.pivot.y } : marked;
    const across = (box.w / faceWidth) * (place.grow ?? 1);
    const least = place.fit === 'size' ? 0.8 : 0.3;
    if (across >= least && across <= 4 && [pivot.x, pivot.y].every(v => v >= -1 && v <= 2)) {
      return { ...base, per: 'face', width: across, pivot };
    }
  }
  const scale = AVATAR_SIZE_SCALE[size as keyof typeof AVATAR_SIZE_SCALE] ?? 1;
  return { ...base, per: 'eyes', width: place.width * scale, pivot: place.pivot };
}

/**
 * The server's picture with its backdrop taken away and cut down to the
 * item, as a PNG; null when there is no plain backdrop to take away.
 */
export async function cutOutAvatar(blob: Blob): Promise<{ png: Blob; box: Box; width: number; height: number } | null> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const full = document.createElement('canvas');
  full.width = width;
  full.height = height;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  const keyed = keyOut(pixels);
  if (!keyed) return null;
  pixels.data.set(keyed.data);
  ctx.putImageData(pixels, 0, 0);

  const { box } = keyed;
  const cut = document.createElement('canvas');
  cut.width = box.w;
  cut.height = box.h;
  cut.getContext('2d')!.drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const png = await new Promise<Blob | null>(resolve => cut.toBlob(resolve, 'image/png'));
  return png ? { png, box, width, height } : null;
}
