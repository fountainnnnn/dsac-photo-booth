import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsInSimple, ArrowsOut, Crop } from '@phosphor-icons/react';
import { FULL_FRAME, type CameraCrop } from './useCaptureSettings';
import type { CaptureSettingsControl } from './CaptureSettingsCard';
import type { FrameConfig } from '@/types/frame';
import { filtersToCSS } from '@/types/editor';

/**
 * Line up the part of the room the booth actually photographs.
 *
 * The camera is the fixed thing here, filling the preview, and the crop box
 * moves and resizes over it — that is what an operator is choosing. With a
 * frame on, the artwork rides along with the box so its window sits exactly on
 * the crop, showing how the shot will be wrapped without changing what is
 * being chosen.
 *
 * The region is locked to 16:9. The camera is 16:9 and every frame window is
 * 16:9, so keeping the crop the same shape means it only ever zooms in. Let it
 * be freeform and every photo taken with it would be stretched back.
 */

/** Small enough to be a tight zoom, large enough that the picture holds up. */
const MIN_W = 0.2;

/**
 * Margin left around the camera inside the preview, per side.
 *
 * The frame is bigger than its window, so it always overhangs the crop box.
 * Without room to overhang into, it gets sliced off by the edge of the preview
 * the moment the box goes near a corner.
 */
const CAMERA_INSET = 0.1;

/** Which corner is held; the opposite one stays put while it is dragged. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Whether dragging right / down grows the region, per corner. */
const CORNER_SIGNS: Record<Corner, [number, number]> = {
  br: [1, 1], bl: [-1, 1], tr: [1, -1], tl: [-1, -1],
};

const CORNER_STYLE: Record<Corner, string> = {
  tl: '-top-3 -left-3 cursor-nwse-resize',
  tr: '-top-3 -right-3 cursor-nesw-resize',
  bl: '-bottom-3 -left-3 cursor-nesw-resize',
  br: '-bottom-3 -right-3 cursor-nwse-resize',
};

export interface CameraCropCardProps extends CaptureSettingsControl {
  /** The frame in use, so the crop can be judged against what it wraps. */
  frame?: FrameConfig | null;
}

export default function CameraCropCard({ settings, push, frame }: CameraCropCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showFrame, setShowFrame] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const crop = settings.crop ?? FULL_FRAME;

  /**
   * Hand the stream to whichever <video> is mounted. It only ever mounts once
   * now, but a callback ref costs nothing and survives the next restructure —
   * an element swap silently emptying srcObject has already cost a round here.
   */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => { /* autoplay policy; the attribute retries */ });
    }
  }, []);

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
      attachVideo(videoRef.current);
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

  /**
   * Drag the box to move it, or a corner to resize it.
   *
   * Pointer events rather than mouse: the booth laptop may well be a
   * touchscreen, and listening on the window keeps the drag alive past the
   * edge of the element.
   */
  const startDrag = (mode: 'move' | Corner) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const from = { ...crop };
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      // The pointer moves in preview fractions; the crop lives in camera
      // fractions, and the camera is inset, so convert between them.
      const span = 1 - CAMERA_INSET * 2;
      const dx = ((ev.clientX - startX) / rect.width) / span;
      const dy = ((ev.clientY - startY) / rect.height) / span;
      if (mode === 'move') { set(clampMove(from, dx, dy)); return; }

      // Outwards grows, inwards shrinks, whichever corner is held. Following
      // whichever axis moved further keeps a diagonal drag tracking the
      // pointer, even though only one number is actually free.
      const [sx, sy] = CORNER_SIGNS[mode];
      set(clampSize(from, Math.abs(dx) >= Math.abs(dy) ? dx * sx : dy * sy, mode));
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
  const win = frame?.window;
  const framed = Boolean(frame && showFrame && win);

  // Everything below is in preview fractions. The camera is inset; the crop
  // box is placed inside it; the frame is scaled so its window lands on the box.
  const cam = { x: CAMERA_INSET, y: CAMERA_INSET, w: 1 - CAMERA_INSET * 2, h: 1 - CAMERA_INSET * 2 };
  const box = {
    x: cam.x + crop.x * cam.w,
    y: cam.y + crop.y * cam.h,
    w: crop.w * cam.w,
    h: crop.h * cam.h,
  };
  const art = win && {
    w: box.w / win.w,
    h: box.h / win.h,
    get x() { return box.x - win.x * this.w; },
    get y() { return box.y - win.y * this.h; },
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
        Drag the box to move it, or a corner to resize. Only what is inside it
        is photographed.
      </p>

      {frame && (
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[0.78rem] font-medium text-[var(--ink-2)]">
          <input
            type="checkbox" checked={showFrame}
            onChange={e => setShowFrame(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Show the {frame.label} frame around the box
        </label>
      )}

      <div
        ref={boxRef}
        className="relative mt-4 w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: '16 / 9', background: 'var(--stage)' }}
      >
        {/* The camera, fixed. Mirrored to match the booth, and carrying the
            Look — a crop judged against an unfiltered picture is judged
            against something the booth never produces. */}
        <video
          ref={attachVideo} autoPlay playsInline muted
          className="absolute"
          style={{
            left: pct(cam.x), top: pct(cam.y), width: pct(cam.w), height: pct(cam.h),
            transform: 'scaleX(-1)',
            filter: filtersToCSS(settings.filters),
          }}
        />

        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[0.78rem] text-white/70">
            {error ? `Camera unavailable — ${error}` : 'Starting the camera…'}
          </p>
        )}

        {ready && (
          <>
            {/* Dim outside the box as four panels rather than one clipped box:
                a clip-path hole is invisible wherever the artwork covers it. */}
            {[
              { left: 0, top: 0, width: 1, height: box.y },
              { left: 0, top: box.y + box.h, width: 1, height: 1 - box.y - box.h },
              { left: 0, top: box.y, width: box.x, height: box.h },
              { left: box.x + box.w, top: box.y, width: 1 - box.x - box.w, height: box.h },
            ].map((r, i) => (
              <div
                key={i}
                className="pointer-events-none absolute z-10"
                style={{
                  left: pct(r.left), top: pct(r.top),
                  width: pct(Math.max(0, r.width)), height: pct(Math.max(0, r.height)),
                  background: 'rgba(11,10,12,0.62)',
                }}
              />
            ))}

            {/* The artwork rides with the box, scaled so its window lands on
                the crop exactly. It overhangs, which is the point — that is
                the border the photo gets — and the camera is inset to leave
                room for the overhang instead of slicing it off. Unfiltered,
                because at capture time it is drawn after the Look is lifted. */}
            {framed && art && (
              <img
                src={frame!.src} alt="" draggable={false}
                className="pointer-events-none absolute z-20"
                style={{ left: pct(art.x), top: pct(art.y), width: pct(art.w), height: pct(art.h) }}
              />
            )}

            {/* The box itself, above the artwork so the crop edge is never
                buried by the frame's own printed border. */}
            <div
              onPointerDown={startDrag('move')}
              className={`absolute z-30 cursor-move touch-none ring-2 ring-white ${
                dragging ? 'ring-[3px]' : ''
              }`}
              style={{
                left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h),
                boxShadow: '0 0 0 1px rgba(11,10,12,0.55)',
              }}
            >
              {(Object.keys(CORNER_STYLE) as Corner[]).map(corner => (
                <span
                  key={corner}
                  onPointerDown={startDrag(corner)}
                  title="Drag to resize"
                  className={`absolute flex h-6 w-6 touch-none items-center justify-center rounded-full border-2 border-white bg-[var(--accent)] shadow-[0_2px_8px_rgba(11,10,12,0.45)] ${CORNER_STYLE[corner]}`}
                >
                  <ArrowsInSimple size={11} weight="bold" className="text-white" />
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="mt-3 text-[0.72rem] tabular-nums text-[var(--ink-3)]">
        {settings.cropEnabled
          ? `Using ${Math.round(crop.w * 100)}% of the camera's width — a ${(1 / crop.w).toFixed(1)}× zoom.`
          : 'Using the whole scene. Drag the box to start cropping.'}
      </p>
    </section>
  );
}

/** Move without leaving the picture. */
export function clampMove(from: CameraCrop, dx: number, dy: number): CameraCrop {
  return {
    ...from,
    x: Math.min(1 - from.w, Math.max(0, from.x + dx)),
    y: Math.min(1 - from.h, Math.max(0, from.y + dy)),
  };
}

/**
 * Resize by `delta`, holding the corner opposite the one being dragged.
 *
 * Width and height are fractions of *different* dimensions, so a 16:9 region
 * of a 16:9 picture has w and h numerically equal — the aspect is already
 * baked into the coordinate space. That is why this scales both by the same
 * amount rather than dividing by the ratio.
 *
 * The size is capped by how much room the anchored corner leaves, so the
 * region grows until it meets an edge and then stops, rather than sliding
 * along it.
 */
export function clampSize(from: CameraCrop, delta: number, corner: Corner = 'br'): CameraCrop {
  const right = from.x + from.w;
  const bottom = from.y + from.h;

  const roomX = corner === 'br' || corner === 'tr' ? 1 - from.x : right;
  const roomY = corner === 'br' || corner === 'bl' ? 1 - from.y : bottom;
  const w = Math.min(roomX, roomY, Math.max(MIN_W, from.w + delta));

  return {
    w,
    h: w,
    x: corner === 'br' || corner === 'tr' ? from.x : right - w,
    y: corner === 'br' || corner === 'bl' ? from.y : bottom - w,
  };
}

/**
 * Zoom about the centre, so the shot stays pointed where it was.
 *
 * `w` is the fraction of the picture kept, which is the reciprocal of zoom:
 * half the width is a 2x zoom.
 */
export function clampZoom(from: CameraCrop, w: number): CameraCrop {
  const nw = Math.min(1, Math.max(MIN_W, w));
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  return {
    w: nw,
    h: nw,
    x: Math.min(1 - nw, Math.max(0, cx - nw / 2)),
    y: Math.min(1 - nw, Math.max(0, cy - nw / 2)),
  };
}
