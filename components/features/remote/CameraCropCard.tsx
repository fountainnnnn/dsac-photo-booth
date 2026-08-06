import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsInSimple, ArrowsOut, Crop, MagnifyingGlass } from '@phosphor-icons/react';
import { FULL_FRAME, type CameraCrop } from './useCaptureSettings';
import type { CaptureSettingsControl } from './CaptureSettingsCard';
import { FRAME_W, FRAME_H, type FrameConfig } from '@/types/frame';
import { filtersAreNeutral, filtersToCSS, rampStartEdge, type LookRamp } from '@/types/editor';

/**
 * Line up the camera inside the photo window.
 *
 * The window is the fixed thing here. With a frame on, the artwork fills the
 * preview and never moves — its window is where the photo lands. Without one,
 * the whole preview is the window. The movable thing is the CAMERA: the
 * outlined box is the camera's own bounds, dragged to slide the picture behind
 * the window and cornered to scale it, the way a layer is positioned under a
 * mask. Whatever shows through the window is the photo.
 *
 * The camera may be larger than the window (a zoom: the window keeps part of
 * the scene) or smaller (the whole scene sits inside the photo with white
 * margins). Either way it stays contained — the bigger rectangle always fully
 * covers the smaller — so the photo never has half-filled edges.
 */

/** Zoom range: window keeps 1/5 of the camera up to the camera at half size. */
const MIN_CROP_W = 0.2;  // 5.0x — tightest zoom in
const MAX_CROP_W = 2;    // 0.5x — camera at half the window, white margins

/** Which camera corner is held; the opposite one stays put. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Whether dragging right / down grows the camera, per corner. */
const CORNER_SIGNS: Record<Corner, [number, number]> = {
  br: [1, 1], bl: [-1, 1], tr: [1, -1], tl: [-1, -1],
};

// Inside the corners, not straddling them: at 1x the camera sits exactly on
// the preview and a straddling handle is clipped to a sliver by its overflow.
const CORNER_STYLE: Record<Corner, string> = {
  tl: 'top-1 left-1 cursor-nwse-resize',
  tr: 'top-1 right-1 cursor-nesw-resize',
  bl: 'bottom-1 left-1 cursor-nesw-resize',
  br: 'bottom-1 right-1 cursor-nwse-resize',
};

interface Rect { x: number; y: number; w: number; h: number }

export interface CameraCropCardProps extends CaptureSettingsControl {
  /** The frame in use — the fixed surround whose window the camera fills. */
  frame?: FrameConfig | null;
}

/** The CSS fade matching a ramp: black where the Look applies in full,
 *  transparent where it has faded out. */
const RAMP_FADE: Record<LookRamp, string | null> = {
  even: null,
  down: 'to bottom',
  up: 'to top',
  rightward: 'to right',
  leftward: 'to left',
};

export default function CameraCropCard({ settings, push, frame }: CameraCropCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videosRef = useRef<Set<HTMLVideoElement>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showFrame, setShowFrame] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const crop = settings.crop ?? FULL_FRAME;

  /**
   * Hand the stream to whichever <video> is mounted. It only mounts once now,
   * but a callback ref costs nothing and survives the next restructure — an
   * element swap silently emptying srcObject has already cost a round here.
   */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    attachAnyVideo(el);
  }, []);

  /**
   * The ramp overlay is a second copy of the same stream, mounted only while a
   * ramp is on — so every <video> this card renders registers here and gets
   * the stream whether it mounted before the camera opened or after.
   */
  const attachAnyVideo = (el: HTMLVideoElement | null) => {
    if (!el) return;
    videosRef.current.add(el);
    if (streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => { /* autoplay policy; the attribute retries */ });
    }
  };

  // Its own stream: this card is open while the capture screen is not, and
  // sharing one across pages would mean keeping the camera awake needlessly.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = s;
      for (const el of videosRef.current) {
        if (el.srcObject !== s) {
          el.srcObject = s;
          void el.play().catch(() => { /* autoplay policy; the attribute retries */ });
        }
      }
      setReady(true);
    }).catch((e: Error) => setError(e.message));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [attachVideo]);

  const set = useCallback((next: CameraCrop) => {
    push({ ...settings, crop: next, cropEnabled: true });
  }, [push, settings]);

  const winRect: Rect | null = frame?.window ?? null;
  const framed = Boolean(frame && showFrame && winRect);

  // The fixed photo window, in preview fractions. With a frame it is the
  // artwork's own window; without one the whole preview is the photo — no
  // stand-in border, no dead margin around it.
  const win: Rect = framed && winRect ? winRect : { x: 0, y: 0, w: 1, h: 1 };

  /**
   * The camera's bounds, derived from the crop.
   *
   * The crop says where the window sits on the camera, so the camera is the
   * window scaled by its reciprocal and offset to match. crop = FULL_FRAME
   * puts the camera exactly on the window.
   */
  const cam: Rect = {
    w: win.w / crop.w,
    h: win.h / crop.h,
    x: win.x - crop.x * (win.w / crop.w),
    y: win.y - crop.y * (win.h / crop.h),
  };

  /** Back the other way: where the window sits relative to a camera rect. */
  const cropFromCam = (c: Rect): CameraCrop => clampCropRect({
    w: win.w / c.w,
    h: win.h / c.h,
    x: (win.x - c.x) / c.w,
    y: (win.y - c.y) / c.h,
  });

  /**
   * Drag the camera to slide it behind the window, or a corner to scale it,
   * holding the opposite corner.
   *
   * Pointer events rather than mouse: the booth laptop may well be a
   * touchscreen, and listening on the window keeps a drag alive past the edge
   * of the element.
   */
  const startDrag = (mode: 'move' | Corner) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const from = { ...cam };
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;

      if (mode === 'move') {
        // The camera follows the pointer one-to-one; the crop falls out of it.
        set(cropFromCam({ ...from, x: from.x + dx, y: from.y + dy }));
        return;
      }

      // Outwards grows, inwards shrinks, whichever corner is held; following
      // whichever axis moved further keeps a diagonal drag on the pointer.
      const [sx, sy] = CORNER_SIGNS[mode];
      const d = Math.abs(dx) >= Math.abs(dy) ? dx * sx : dy * sy;
      const w = from.w + d;
      const h = w * (from.h / from.w);
      set(cropFromCam({
        w, h,
        // The opposite corner stays put while this one is pulled.
        x: mode === 'br' || mode === 'tr' ? from.x : from.x + from.w - w,
        y: mode === 'br' || mode === 'bl' ? from.y : from.y + from.h - h,
      }));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const pct = (n: number) => `${n * 100}%`;
  const zoom = 1 / crop.w;

  // The Look, as this card can express it. A CSS filter is uniform, so the
  // ramp needs two layers: the untouched camera underneath, and a fully
  // adjusted copy faded out by a gradient mask — the same two-layer
  // construction the canvas draws, so this preview and the photo agree. The
  // mask sits on an unmirrored wrapper so left and right mean what the
  // operator sees.
  const fade = RAMP_FADE[settings.lookRamp] ?? null;
  const ramping = fade !== null
    && rampStartEdge(settings.lookRamp) !== null
    && !filtersAreNeutral(settings.filters);
  const baseFilter = ramping ? 'none' : filtersToCSS(settings.filters);
  const camRectStyle = {
    left: pct(cam.x), top: pct(cam.y), width: pct(cam.w), height: pct(cam.h),
  };

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="flex items-center gap-2 text-[0.92rem] font-semibold text-[var(--ink)]">
          <Crop size={16} /> Camera framing
        </p>
        <button
          type="button"
          onClick={() => push({ ...settings, cropEnabled: false, crop: FULL_FRAME })}
          className="ml-auto inline-flex items-center gap-1 text-[0.72rem] font-semibold text-[var(--ink-3)] transition hover:text-[var(--accent)]"
        >
          <ArrowsOut size={13} /> Whole scene
        </button>
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        The outlined box is the camera. Drag it to line the picture up, or pull
        a corner to resize it — larger crops in, smaller leaves white margins.
      </p>

      {frame && (
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[0.78rem] font-medium text-[var(--ink-2)]">
          <input
            type="checkbox" checked={showFrame}
            onChange={e => setShowFrame(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Show the {frame.label} frame
        </label>
      )}

      <div
        ref={boxRef}
        className="relative mt-4 w-full overflow-hidden rounded-xl"
        style={{
          aspectRatio: framed ? `${FRAME_W} / ${FRAME_H}` : '16 / 9',
          background: 'var(--stage)',
        }}
      >
        {/* The photo's paper. A camera smaller than the window leaves margins,
            and they are white in the JPEG, so they are white here too. */}
        <div
          className="absolute bg-white"
          style={{ left: pct(win.x), top: pct(win.y), width: pct(win.w), height: pct(win.h) }}
        />

        {/* The camera, wherever its box is. Mirrored to match the booth, and
            carrying the Look — a shot lined up against an unfiltered picture
            is lined up against something the booth never produces. */}
        <video
          ref={attachVideo} autoPlay playsInline muted
          className="absolute max-w-none"
          style={{
            ...camRectStyle,
            transform: 'scaleX(-1)',
            filter: baseFilter,
          }}
        />

        {/* The Look ramp: the same feed again with the full adjustments,
            masked so they fade across the picture. */}
        {ramping && (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              ...camRectStyle,
              maskImage: `linear-gradient(${fade}, black, transparent)`,
              WebkitMaskImage: `linear-gradient(${fade}, black, transparent)`,
            }}
          >
            <video
              ref={attachAnyVideo} autoPlay playsInline muted
              className="h-full w-full max-w-none"
              style={{
                transform: 'scaleX(-1)',
                filter: filtersToCSS(settings.filters),
              }}
            />
          </div>
        )}

        {!ready && (
          <p className="absolute inset-0 z-40 flex items-center justify-center px-6 text-center text-[0.78rem] text-white/70">
            {error ? `Camera unavailable — ${error}` : 'Starting the camera…'}
          </p>
        )}

        {ready && (
          <>
            {/* The frame, stuck outside: full-bleed, fixed, never moving. Its
                opaque border hides the camera's overflow — the outline below
                still shows where the camera extends. Unfiltered, because at
                capture time it is drawn after the Look is lifted. */}
            {framed && (
              <img
                src={frame!.src} alt="" draggable={false}
                className="pointer-events-none absolute inset-0 z-20 h-full w-full"
              />
            )}

            {/* The camera's own outline — the movable thing, above everything
                so it reads even where the artwork covers its overflow. */}
            <div
              onPointerDown={startDrag('move')}
              className={`absolute z-30 touch-none ring-2 ring-[var(--accent)] ${
                dragging ? 'cursor-grabbing ring-[3px]' : 'cursor-grab'
              }`}
              style={{ left: pct(cam.x), top: pct(cam.y), width: pct(cam.w), height: pct(cam.h) }}
            >
              {(Object.keys(CORNER_STYLE) as Corner[]).map(corner => (
                <span
                  key={corner}
                  onPointerDown={startDrag(corner)}
                  title="Drag to resize the camera"
                  className={`absolute flex h-6 w-6 touch-none items-center justify-center rounded-full border-2 border-white bg-[var(--accent)] shadow-[0_2px_8px_rgba(11,10,12,0.45)] ${CORNER_STYLE[corner]}`}
                >
                  <ArrowsInSimple size={11} weight="bold" className="text-white" />
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Backup zoom: past ~1.3x the camera's corners are off the preview, so
          the slider is how you zoom back out without hunting for a handle. */}
      <label className="mt-4 flex items-center gap-3 text-[0.75rem] font-semibold text-[var(--ink-2)]">
        <MagnifyingGlass size={15} className="shrink-0" />
        <input
          type="range"
          min={Math.round(100 / MAX_CROP_W)} max={Math.round(100 / MIN_CROP_W)} step={1}
          value={Math.round(100 * zoom)}
          onChange={e => set(clampZoom(crop, 100 / Number(e.target.value)))}
          aria-label="Zoom"
          className="dsac-range"
        />
        <span className="w-10 shrink-0 text-right tabular-nums text-[var(--ink-3)]">
          {zoom.toFixed(1)}&times;
        </span>
      </label>

      <p className="mt-3 text-[0.72rem] tabular-nums text-[var(--ink-3)]">
        {!settings.cropEnabled
          ? 'The window is the whole camera. Drag the box or zoom to change that.'
          : zoom >= 1
            ? `${zoom.toFixed(1)}× zoom — the window keeps ${Math.round(crop.w * 100)}% of the camera's width.`
            : `${zoom.toFixed(1)}× — the camera sits inside the photo with white margins.`}
      </p>
    </section>
  );
}

/**
 * Keep the crop legal: zoom within range, and the smaller rectangle contained
 * by the larger.
 *
 * When the window keeps part of the camera (w <= 1) the window must stay on
 * the camera, so x ∈ [0, 1-w]. When the camera sits inside the photo (w > 1)
 * the containment flips and the same interval reverses to [1-w, 0]. min/max of
 * the two endpoints covers both without a branch.
 */
export function clampCropRect(c: CameraCrop): CameraCrop {
  const w = Math.min(MAX_CROP_W, Math.max(MIN_CROP_W, c.w));
  const lo = Math.min(0, 1 - w);
  const hi = Math.max(0, 1 - w);
  return {
    w,
    h: w,
    x: Math.min(hi, Math.max(lo, c.x)),
    y: Math.min(hi, Math.max(lo, c.y)),
  };
}

/**
 * Zoom about the centre, so the shot stays pointed where it was.
 *
 * `w` is the fraction of the camera the window keeps — the reciprocal of
 * zoom: half the width is 2x in, twice the width is 0.5x with margins.
 */
export function clampZoom(from: CameraCrop, w: number): CameraCrop {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  return clampCropRect({ w, h: w, x: cx - w / 2, y: cy - w / 2 });
}
