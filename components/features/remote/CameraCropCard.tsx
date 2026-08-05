import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsOut, Crop } from '@phosphor-icons/react';
import { FULL_FRAME, type CameraCrop } from './useCaptureSettings';
import type { CaptureSettingsControl } from './CaptureSettingsCard';

/**
 * Line up the part of the room the booth actually photographs.
 *
 * Two framings from one camera: the whole scene, or a region the operator
 * drags out once — the seats and stairs, say — so guests are filling the shot
 * instead of sitting in the middle of an empty hall.
 *
 * The region is locked to 16:9. The camera is 16:9 and every frame window is
 * 16:9, so keeping the crop the same shape means it only ever zooms in. Let it
 * be freeform and every photo taken with it would be stretched back.
 */

/** Small enough to be a tight zoom, large enough that the picture holds up. */
const MIN_W = 0.2;

export default function CameraCropCard({ settings, push }: CaptureSettingsControl) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = settings.crop ?? FULL_FRAME;

  // Its own stream: this card is open while the capture screen is not, and
  // sharing one across pages would mean keeping the camera awake needlessly.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      setReady(true);
    }).catch((e: Error) => setError(e.message));

    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const set = useCallback((next: CameraCrop) => {
    push({ ...settings, crop: next, cropEnabled: true });
  }, [push, settings]);

  /**
   * Drag to move the region, or drag the corner to resize it.
   *
   * Pointer events rather than mouse: the booth laptop may well be a
   * touchscreen, and capture means the drag keeps working past the edge.
   */
  const startDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const from = { ...crop };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      if (mode === 'move') {
        set(clampMove(from, dx, dy));
      } else {
        // Resize from the top-left anchor, driven by the horizontal drag so
        // the 16:9 shape follows without fighting the pointer.
        set(clampSize(from, dx));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const pct = (n: number) => `${n * 100}%`;

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
        Drag the box to frame the shot, or the corner to resize it. Everything
        outside is dimmed, and photos are taken from inside it.
      </p>

      <div
        ref={boxRef}
        className="relative mt-4 w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: '16 / 9', background: 'var(--stage)' }}
      >
        {/* Mirrored to match the booth, so left really is left. */}
        <video
          ref={videoRef} autoPlay playsInline muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[0.78rem] text-white/70">
            {error ? `Camera unavailable — ${error}` : 'Starting the camera…'}
          </p>
        )}

        {ready && (
          <>
            {/* Dim everything outside the region, so the framing reads at a
                glance rather than having to trace a thin outline. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: 'rgba(11,10,12,0.58)',
                clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${pct(crop.x)} ${pct(crop.y)},
                  ${pct(crop.x)} ${pct(crop.y + crop.h)},
                  ${pct(crop.x + crop.w)} ${pct(crop.y + crop.h)},
                  ${pct(crop.x + crop.w)} ${pct(crop.y)},
                  ${pct(crop.x)} ${pct(crop.y)})`,
              }}
            />
            <div
              onPointerDown={startDrag('move')}
              className="absolute cursor-move touch-none rounded-[3px] ring-2 ring-[var(--accent)]"
              style={{
                left: pct(crop.x), top: pct(crop.y),
                width: pct(crop.w), height: pct(crop.h),
              }}
            >
              <span
                onPointerDown={startDrag('resize')}
                className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-[var(--accent)]"
              />
            </div>
          </>
        )}
      </div>

      <p className="mt-3 text-[0.72rem] tabular-nums text-[var(--ink-3)]">
        {settings.cropEnabled
          ? `Cropped to ${Math.round(crop.w * 100)}% of the width — a ${(1 / crop.w).toFixed(1)}× zoom.`
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
 * Resize from the top-left corner, keeping 16:9.
 *
 * Width and height are fractions of *different* dimensions, so a 16:9 region
 * of a 16:9 picture has w and h numerically equal — the aspect is already
 * baked into the coordinate space. That is why this scales both by the same
 * amount rather than dividing by the ratio.
 */
export function clampSize(from: CameraCrop, dx: number): CameraCrop {
  const w = Math.min(Math.min(1 - from.x, 1 - from.y), Math.max(MIN_W, from.w + dx));
  return { ...from, w, h: w };
}
