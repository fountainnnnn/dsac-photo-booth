/**
 * What goes around the guest: the background behind them and the avatar on
 * their face. The guest picks both on the capture screen; the operator decides
 * in Settings how the real background is taken away.
 */

/**
 * How the booth separates the guests from the room behind them.
 *
 *  - `off`     — it does not; the photo is the camera, as it always was.
 *  - `key`     — a green (or blue) screen is keyed out by colour.
 *  - `segment` — no screen: a model finds the people.
 */
export type BgRemoval = 'off' | 'key' | 'segment';

export interface ChromaKeySettings {
  /** The screen's colour, `#rrggbb`. Green or blue. */
  colour: string;
  /**
   * How far a pixel may fall short of the screen's own greenness and still
   * count as screen, 0–1. Higher removes more, shadows included.
   */
  tolerance: number;
  /** Width of the soft edge between screen and person, 0–1. */
  softness: number;
  /** How much green cast to take back off the people, 0–1. */
  spill: number;
}

export const DEFAULT_CHROMA_KEY: ChromaKeySettings = {
  colour: '#00b140',
  tolerance: 0.35,
  softness: 0.25,
  spill: 0.7,
};

export interface BackgroundOption {
  id: string;
  label: string;
  src: string;
}

/**
 * Placeholder scenes, drawn as SVG so they ship without a licence question.
 * They are meant to be replaced: by better artwork, and later by backgrounds
 * generated from what the guest types.
 */
export const BACKGROUNDS: BackgroundOption[] = [
  { id: 'studio',  label: 'Studio',  src: '/backgrounds/studio.svg' },
  { id: 'sunset',  label: 'Sunset',  src: '/backgrounds/sunset.svg' },
  { id: 'space',   label: 'Space',   src: '/backgrounds/space.svg' },
  { id: 'neon',    label: 'Neon',    src: '/backgrounds/neon.svg' },
];

/**
 * Where on a face an avatar is pinned. Each is a point MediaPipe's face mesh
 * reports; see `avatars.ts` for which landmarks make it.
 */
export type AvatarAnchor = 'eyes' | 'forehead' | 'nose' | 'upperLip' | 'mouth' | 'chin';

/**
 * The part of the face an avatar is worn on. A guest can wear several, one
 * per part: a second hat replaces the first, glasses go with it. The names
 * are the ones the server's screening model answers with (see WHERE in
 * server/avatars.mjs).
 */
export type AvatarSlot =
  | 'head' | 'top' | 'eyes' | 'face' | 'nose' | 'cheeks' | 'mouth' | 'upperLip' | 'chin' | 'neck';

export interface AvatarOption {
  id: string;
  label: string;
  src: string;
  slot: AvatarSlot;
  anchor: AvatarAnchor;
  /**
   * Drawn width, in multiples of the distance between the outer eye corners,
   * or of the face's width when `per` is 'face'.
   */
  width: number;
  /** What `width` is measured in; the eye span when absent. */
  per?: 'eyes' | 'face';
  /**
   * How far to move the anchor up the face (negative: down), in eye spans,
   * so a hat can sit above the forehead point.
   */
  lift: number;
  /**
   * The point of the image that lands on the anchor, as fractions of its
   * width and height. The middle for glasses; the bottom edge for a hat.
   */
  pivot: { x: number; y: number };
}

/**
 * A fixed set, made in advance. Guests choose; they do not customise. These
 * are placeholder artwork in the same format the final set should use: a
 * transparent image, upright, facing the camera.
 */
export const AVATARS: AvatarOption[] = [
  {
    id: 'shades', label: 'Shades', src: '/avatars/shades.svg', slot: 'eyes',
    anchor: 'eyes', width: 1.75, lift: 0, pivot: { x: 0.5, y: 0.42 },
  },
  {
    id: 'party-hat', label: 'Party hat', src: '/avatars/party-hat.svg', slot: 'head',
    anchor: 'forehead', width: 1.1, lift: 0.15, pivot: { x: 0.5, y: 1 },
  },
  {
    id: 'cat-ears', label: 'Cat ears', src: '/avatars/cat-ears.svg', slot: 'head',
    anchor: 'forehead', width: 2.2, lift: 0.1, pivot: { x: 0.5, y: 0.85 },
  },
  {
    id: 'crown', label: 'Crown', src: '/avatars/crown.svg', slot: 'head',
    anchor: 'forehead', width: 1.5, lift: 0.1, pivot: { x: 0.5, y: 0.95 },
  },
  {
    id: 'moustache', label: 'Moustache', src: '/avatars/moustache.svg', slot: 'upperLip',
    anchor: 'upperLip', width: 0.85, lift: 0, pivot: { x: 0.5, y: 0.4 },
  },
];

/**
 * How far the top of the head is above the face mesh's forehead point, which
 * is about at the hairline, in eye spans.
 */
export const HEAD_TOP_LIFT = 0.45;

/**
 * Pinning a typed avatar, by the part of the face the server says it is
 * worn on. `anchor` and `lift` are the point on the guest that the server's
 * mark is lined up with (FIT_POINT in server/avatars.mjs: the top of the
 * forehead for a hat, between the eyes for glasses or a mask, the mouth for a
 * beard). `width` and `pivot` are only for an avatar the server could not
 * mark, in eye spans as for the ready-made ones.
 *
 * `fit`: how much of the server's mark is used. 'all' where the item covers
 * the face, so the model can see where a face would go: the eye holes of a
 * mask, a beard's mouth. 'size' on the head: the model marked a hat's brim
 * but the top of a band of ears, so the same rule put one on the hairline and
 * the other round the face. There the item rests on the head by its bottom
 * edge (`pivot.y`) and only its size comes from the mark. 'none' for
 * something small or below the face (a nose, a mouth, the neck): it guessed a
 * bow tie twice the width of the face, and the sizes here do better.
 *
 * `grow`: a correction to the size from the mark. A mask drawn as a whole
 * head was a little small for a real one.
 *
 * `part`: what it shares with others, so one replaces the other. Something
 * on the head and something sticking up from it would sit on top of each
 * other, so they count as one part.
 */
export const TYPED_SLOTS: Record<AvatarSlot, {
  part: string;
  fit: 'all' | 'size' | 'none';
  grow?: number;
  anchor: AvatarAnchor;
  lift: number;
  width: number;
  pivot: { x: number; y: number };
}> = {
  head:     { part: 'head',     fit: 'size',            anchor: 'forehead', lift: 0,             width: 1.9,  pivot: { x: 0.5, y: 0.92 } },
  top:      { part: 'head',     fit: 'size',            anchor: 'forehead', lift: HEAD_TOP_LIFT, width: 2,    pivot: { x: 0.5, y: 0.97 } },
  eyes:     { part: 'eyes',     fit: 'all',             anchor: 'eyes',     lift: 0,             width: 1.8,  pivot: { x: 0.5, y: 0.45 } },
  face:     { part: 'face',     fit: 'all', grow: 1.15, anchor: 'eyes',     lift: 0,             width: 2.1,  pivot: { x: 0.5, y: 0.45 } },
  nose:     { part: 'nose',     fit: 'none',            anchor: 'nose',     lift: 0,             width: 0.55, pivot: { x: 0.5, y: 0.55 } },
  cheeks:   { part: 'cheeks',   fit: 'all',             anchor: 'nose',     lift: 0,             width: 2,    pivot: { x: 0.5, y: 0.5 } },
  mouth:    { part: 'mouth',    fit: 'none',            anchor: 'mouth',    lift: 0,             width: 0.8,  pivot: { x: 0.5, y: 0.5 } },
  upperLip: { part: 'upperLip', fit: 'none',            anchor: 'upperLip', lift: 0,             width: 0.9,  pivot: { x: 0.5, y: 0.4 } },
  chin:     { part: 'chin',     fit: 'all',             anchor: 'mouth',    lift: 0,             width: 1.7,  pivot: { x: 0.5, y: 0.3 } },
  neck:     { part: 'neck',     fit: 'none',            anchor: 'chin',     lift: 0,             width: 1.1,  pivot: { x: 0.5, y: -0.15 } },
};

/** The size the server says an unmarked typed avatar is, as a multiple. */
export const AVATAR_SIZE_SCALE = { small: 0.75, normal: 1, large: 1.35 } as const;

/**
 * The order avatars are drawn in, back to front: a mask under glasses, a
 * beard under a moustache, a hat over everything.
 */
export const AVATAR_DRAW_ORDER: AvatarSlot[] = [
  'face', 'neck', 'chin', 'cheeks', 'mouth', 'upperLip', 'nose', 'eyes', 'head', 'top',
];

/** The part of the face an avatar takes up; see TYPED_SLOTS. */
export function avatarPart(option: AvatarOption): string {
  return TYPED_SLOTS[option.slot]?.part ?? option.slot;
}

/**
 * The avatars worn after tapping `option`: off if it was on; otherwise on, in
 * place of anything else on the same part of the face.
 */
export function toggleAvatar(ids: string[], option: AvatarOption, options: AvatarOption[]): string[] {
  if (ids.includes(option.id)) return ids.filter(id => id !== option.id);
  const part = avatarPart(option);
  const others = ids.filter((id) => {
    const o = options.find(x => x.id === id);
    return o && avatarPart(o) !== part;
  });
  return [...others, option.id];
}

/** Typed avatars per guest, as for backgrounds. */
export const TYPED_AVATARS_PER_GUEST = 3;

/** The background id that means "the one the guest typed". */
export const TYPED_BACKGROUND_ID = 'typed';

/** A background drawn from what the guest typed. */
export interface TypedBackground {
  /** An object URL for the picture, owned by the capture page. */
  src: string;
  text: string;
}

/** What the guest has chosen on the capture screen. No avatar ids is none. */
export interface SceneChoice {
  backgroundId: string;
  /** Every avatar worn, at most one per part of the face (`toggleAvatar`). */
  avatarIds: string[];
  /** Set once the guest has had a background made from their words. */
  typed?: TypedBackground | null;
  /** The avatars the guest has had made from their words, newest first. */
  typedAvatars?: AvatarOption[];
}

export const DEFAULT_SCENE_CHOICE: SceneChoice = {
  backgroundId: BACKGROUNDS[0].id,
  avatarIds: [],
  typed: null,
  typedAvatars: [],
};

/** Backgrounds a guest may have made, before they have to pick a ready one. */
export const TYPED_PER_GUEST = 3;
