export type OverlayPosition =
  | 'full'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center'
  | 'top-left'
  | 'top-right';

export interface OverlayConfig {
  id: string;
  label: string;
  src: string;
  position: OverlayPosition;
  /** Width as fraction of canvas width (ignored for 'full'). Default 0.28. */
  scale?: number;
  /** Opacity 0–1. Default 1. */
  opacity?: number;
}

/**
 * Position and size of an overlay as fractions of the canvas/container (0–1).
 * Produced by the interactive OverlayPicker editor and consumed by usePhotoComposer.
 */
export interface OverlayTransform {
  x: number;  // left edge
  y: number;  // top edge
  w: number;  // width
  h: number;  // height
}

/** A placed overlay with its current position/size. */
export interface ActiveOverlay {
  config: OverlayConfig;
  transform: OverlayTransform;
}
