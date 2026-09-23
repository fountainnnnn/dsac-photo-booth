/**
 * Tap yourself in the photo, get a card.
 *
 * The interaction is deliberately one step: tap a face, a crop box lands on
 * it, drag or pinch if it is not quite right, confirm. No mode to enter, no
 * handles to find on a phone screen. Guests do this once, standing up, with
 * people waiting.
 */

import { useCallback, useRef, useState } from 'react';
import { ArrowsOut, Check, Spinner } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';
import { CARD_ASPECT, CARD_H, CARD_W, drawCard } from '@/types/card';
import type { EventDetails } from '@/types/frame';
import {
  cropAroundFace,
  cropAroundPoint,
  faceAtPoint,
  moveCrop,
  scaleCrop,
  type Rect,
} from './cropGeometry';

interface CropCardProps {
  /** The composed event photo, same URL the page already shows. */
  photoSrc: string;
  event?: Partial<EventDetails> | null;
  /**
   * Face boxes in the photo's own pixels, detected by the kiosk when the shot
   * was taken. Empty is normal — for photos taken before the booth detected
   * faces, and wherever detection could not run — and means the crop is placed
   * where the guest tapped instead.
   */
  faces?: Rect[];
  /** Handed the finished card as a PNG. */
  onCard(card: Blob): void | Promise<void>;
  busy?: boolean;
}

export default function CropCard({
  photoSrc, event, faces = [], onCard, busy = false,
}: CropCardProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [crop, setCrop] = useState<Rect | null>(null);

  /**
   * Natural size of the photo. Every rect in state is in these pixels.
   *
   * State rather than a ref because the overlay geometry is derived from it
   * during render — as a ref it would be read before React had re-rendered,
   * and the crop box would sit at the wrong scale until something else moved.
   */
  const [size, setSize] = useState({ w: 0, h: 0 });

  /** CSS pixels on the displayed photo → pixels in the original. */
  const toSource = useCallback((clientX: number, clientY: number) => {
    const img = imageRef.current;
    if (!img) return null;
    const box = img.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: ((clientX - box.left) / box.width) * size.w,
      y: ((clientY - box.top) / box.height) * size.h,
    };
  }, [size]);

  const handleTap = (e: React.PointerEvent) => {
    // A drag ends with a pointerup too; only a tap that moved nothing places
    // a new crop, or nudging the box would jump it back under the finger.
    if (dragging.current.moved) return;

    const point = toSource(e.clientX, e.clientY);
    if (!point) return;

    const face = faceAtPoint(faces, point);
    setCrop(face
      ? cropAroundFace(face, size.w, size.h, CARD_ASPECT)
      : cropAroundPoint(point, size.w, size.h, CARD_ASPECT));
  };

  // ── Dragging the crop box ──────────────────────────────────────────────────
  const dragging = useRef({ active: false, moved: false, x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = { active: true, moved: false, x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag.active || !crop) return;

    const img = imageRef.current;
    const box = img?.getBoundingClientRect();
    if (!box?.width) return;

    const dx = ((e.clientX - drag.x) / box.width) * size.w;
    const dy = ((e.clientY - drag.y) / box.height) * size.h;

    // A few pixels of slop, so a tap with a shaky hand is still a tap.
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
    if (!drag.moved) return;

    drag.x = e.clientX;
    drag.y = e.clientY;
    setCrop(moveCrop(crop, dx, dy, size.w, size.h));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    handleTap(e);
    dragging.current.active = false;
  };

  const zoom = (factor: number) => {
    if (crop) setCrop(scaleCrop(crop, factor, size.w, size.h));
  };

  /** Render the crop into a card and hand the caller the PNG. */
  const confirm = async () => {
    const img = imageRef.current;
    if (!img || !crop) return;

    // Draw the crop to its own canvas first, so `drawCard` receives an image
    // it can simply cover its window with and never has to know about source
    // rectangles.
    const cut = document.createElement('canvas');
    cut.width = Math.round(crop.w);
    cut.height = Math.round(crop.h);
    const cutCtx = cut.getContext('2d');
    if (!cutCtx) return;
    cutCtx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cut.width, cut.height);

    const card = document.createElement('canvas');
    card.width = CARD_W;
    card.height = CARD_H;
    const cardCtx = card.getContext('2d');
    if (!cardCtx) return;
    drawCard(cardCtx, cut, cut.width, cut.height, { event });

    const blob = await new Promise<Blob | null>(res => card.toBlob(res, 'image/png'));
    if (blob) await onCard(blob);
  };

  // The crop box in percentages, so it tracks the photo through any resize.
  const overlay = crop && size.w
    ? {
      left: `${(crop.x / size.w) * 100}%`,
      top: `${(crop.y / size.h) * 100}%`,
      width: `${(crop.w / size.w) * 100}%`,
      height: `${(crop.h / size.h) * 100}%`,
    }
    : null;

  return (
    <div data-testid="crop-card" className="flex flex-col gap-3">
      <div
        ref={surfaceRef}
        className="relative touch-none select-none overflow-hidden rounded-lg bg-black"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragging.current.active = false; }}
      >
        <img
          ref={imageRef}
          src={photoSrc}
          alt="Tap yourself in the photo"
          draggable={false}
          onLoad={e => {
            const img = e.currentTarget;
            setSize({ w: img.naturalWidth, h: img.naturalHeight });
            setLoaded(true);
          }}
          className="block w-full"
        />

        {crop && overlay && (
          <>
            {/* Dim everything outside the crop, so the card is what stands out. */}
            <div className="pointer-events-none absolute inset-0 bg-black/50" />
            <div
              data-testid="crop-card-window"
              className="pointer-events-none absolute overflow-hidden rounded-md ring-2 ring-white"
              style={overlay}
            >
              <img
                src={photoSrc}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute max-w-none"
                style={{
                  width: `${(size.w / crop.w) * 100}%`,
                  left: `${(-crop.x / crop.w) * 100}%`,
                  top: `${(-crop.y / crop.h) * 100}%`,
                }}
              />
            </div>
          </>
        )}

        {!crop && loaded && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-center text-sm font-semibold text-white">
            Tap yourself in the photo
          </p>
        )}
      </div>

      {/*
        Three buttons on one row, and at 390px they do not fit at the default
        padding — "Use this" wrapped onto two lines. Tightened horizontally and
        told not to wrap, because a shutter-style control that reflows mid-queue
        reads as broken.
      */}
      {crop && (
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="secondary" size="sm"
            className="!px-3 whitespace-nowrap"
            onClick={() => zoom(1 / 1.2)} aria-label="Zoom in"
          >
            <ArrowsOut className="h-4 w-4 rotate-45" /> Closer
          </Button>
          <Button
            type="button" variant="secondary" size="sm"
            className="!px-3 whitespace-nowrap"
            onClick={() => zoom(1.2)} aria-label="Zoom out"
          >
            <ArrowsOut className="h-4 w-4" /> Wider
          </Button>
          <Button
            type="button" size="sm" className="ml-auto !px-4 whitespace-nowrap"
            onClick={confirm} disabled={busy}
            data-testid="crop-card-confirm"
          >
            {busy
              ? <><Spinner className="h-4 w-4 animate-spin" /> Working</>
              : <><Check className="h-4 w-4" /> Use this</>}
          </Button>
        </div>
      )}

      <p className="text-xs leading-5 text-[#a1a1aa]">
        {crop
          ? 'Drag to move it, or tap Closer until it holds just you.'
          : 'Your card is cropped on this phone. Nothing is sent until you tap Use this.'}
      </p>
    </div>
  );
}
