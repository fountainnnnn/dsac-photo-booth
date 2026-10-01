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
export type AvatarAnchor = 'eyes' | 'forehead' | 'nose' | 'upperLip';

export interface AvatarOption {
  id: string;
  label: string;
  src: string;
  anchor: AvatarAnchor;
  /** Drawn width, in multiples of the distance between the outer eye corners. */
  width: number;
  /**
   * How far to move the anchor up the face (negative: down), in the same
   * eye-span units, so a hat can sit above the forehead point.
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
    id: 'shades', label: 'Shades', src: '/avatars/shades.svg',
    anchor: 'eyes', width: 1.75, lift: 0, pivot: { x: 0.5, y: 0.42 },
  },
  {
    id: 'party-hat', label: 'Party hat', src: '/avatars/party-hat.svg',
    anchor: 'forehead', width: 1.1, lift: 0.15, pivot: { x: 0.5, y: 1 },
  },
  {
    id: 'cat-ears', label: 'Cat ears', src: '/avatars/cat-ears.svg',
    anchor: 'forehead', width: 2.2, lift: 0.1, pivot: { x: 0.5, y: 0.85 },
  },
  {
    id: 'crown', label: 'Crown', src: '/avatars/crown.svg',
    anchor: 'forehead', width: 1.5, lift: 0.1, pivot: { x: 0.5, y: 0.95 },
  },
  {
    id: 'moustache', label: 'Moustache', src: '/avatars/moustache.svg',
    anchor: 'upperLip', width: 0.85, lift: 0, pivot: { x: 0.5, y: 0.4 },
  },
];

/** The background id that means "the one the guest typed". */
export const TYPED_BACKGROUND_ID = 'typed';

/** A background drawn from what the guest typed. */
export interface TypedBackground {
  /** An object URL for the picture, owned by the capture page. */
  src: string;
  text: string;
}

/** What the guest has chosen on the capture screen. Empty avatar is none. */
export interface SceneChoice {
  backgroundId: string;
  avatarId: string;
  /** Set once the guest has had a background made from their words. */
  typed?: TypedBackground | null;
}

export const DEFAULT_SCENE_CHOICE: SceneChoice = {
  backgroundId: BACKGROUNDS[0].id,
  avatarId: '',
  typed: null,
};

/** Backgrounds a guest may have made, before they have to pick a ready one. */
export const TYPED_PER_GUEST = 3;
