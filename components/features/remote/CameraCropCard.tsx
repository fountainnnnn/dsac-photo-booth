import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsInSimple, ArrowsOut, Crop, MagnifyingGlass } from '@phosphor-icons/react';
import { FULL_FRAME, type CameraCrop } from './useCaptureSettings';
import type { CaptureSettingsControl } from './CaptureSettingsCard';
import { FRAME_W, FRAME_H, type FrameConfig } from '@/types/frame';
import { filtersToCSS } from '@/types/editor';

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

/**
 * How far the frame is inset in the framed preview, per side.
 *
 * The margin is what makes this an adjustment view rather than a result view:
 * the picture is larger than the window, and this is where the part being cut
 * off stays visible while it is dragged into place.
 */
const FRAME_INSET = 0.13;

/** Which corner is held; the opposite one stays put while it is dragged. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Whether dragging right / down grows the region, per corner. */
const CORNER_SIGNS: Record<Corner, [number, number]> = {
  br: [1, 1], bl: [-1, 1], tr: [1, -1], tl: [-1, -1],
};

const CORNER_STYLE: Record<Corner, string> = {
  tl: '-top-px -left-px cursor-nwse-resize',
  tr: '-top-px -right-px cursor-nesw-resize',
  bl: '-bottom-px -left-px cursor-nesw-resize',
  br: '-bottom-px -right-px cursor-nwse-resize',
};

export interface CameraCropCardProps extends CaptureSettingsControl {
  /** The frame in use, so the region can be judged against what it hides. */
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
   * Hand the stream to whichever <video> is currently mounted.
   *
   * Ticking the frame checkbox swaps the plain preview for the framed one,
   * which is a different element in a different parent — React unmounts the
   * first and mounts the second. Assigning srcObject once, when the camera
   * started, left the replacement empty and the window went black. A callback
   * ref runs on every mount, so the stream follows the element.
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
   * Drag to move the region, or drag the corner to resize it.
   *
   * Pointer events rather than mouse: the booth laptop may well be a
   * touchscreen, and capture means the drag keeps working past the edge.
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
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
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
  // The framed view needs a window to place the picture in; without one there
  // is nothing to preview against, so fall back to the plain crop box.
  const framed = Boolean(frame && showFrame && win);

  /**
   * Where the frame, its window and the picture sit, as fractions of the
   * preview box.
   *
   * The frame is inset rather than filling the box, which is the whole point:
   * the picture is bigger than the window and the margin is where the overflow
   * shows. Without it the artwork covers everything outside the window and you
   * are moving a photo you cannot see.
   */
  const geom = win && (() => {
    const frameX = FRAME_INSET, frameY = FRAME_INSET;
    const frameW = 1 - FRAME_INSET * 2, frameH = 1 - FRAME_INSET * 2;

    const winX = frameX + win.x * frameW;
    const winY = frameY + win.y * frameH;
    const winW = win.w * frameW;
    const winH = win.h * frameH;

    // Scale the picture so the chosen region covers the window exactly.
    const videoW = winW / crop.w;
    const videoH = winH / crop.h;
    return {
      frameX, frameY, frameW, frameH,
      winX, winY, winW, winH,
      videoW, videoH,
      videoX: winX - crop.x * videoW,
      videoY: winY - crop.y * videoH,
    };
  })();

  /**
   * Move the camera by dragging the picture, in the framed view.
   *
   * The frame does not move — it is fixed artwork, and the whole point is to
   * see how the shot sits inside it. Dragging the picture right reveals more
   * of its left, so the region travels the other way. The pointer moves in box
   * fractions and the region lives in picture fractions, so the delta is
   * divided by how much of the box the picture spans.
   */
  const startPan = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = boxRef.current;
    if (!box || !geom) return;
    const rect = box.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const from = { ...crop };
    const { videoW, videoH } = geom;
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / rect.width) / videoW;
      const dy = ((ev.clientY - startY) / rect.height) / videoH;
      set(clampMove(from, -dx, -dy));
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
        {framed
          ? 'Drag the picture to move it inside the frame, and zoom below. The frame stays put.'
          : 'Drag inside the box to move it, or a corner handle to resize. Everything dimmed is left out of the photo.'}
      </p>

      {frame && (
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[0.78rem] font-medium text-[var(--ink-2)]">
          <input
            type="checkbox" checked={showFrame}
            onChange={e => setShowFrame(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Fit inside the {frame.label} frame
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
        {framed && win && geom ? (
          <>
            {/* The whole picture, never clipped — the point is to see what is
                being left out while moving it. It is placed so the chosen
                region lands exactly on the frame's window, so the bright part
                is the photo and everything beyond it is what gets cut.
                Mirrored space throughout: the video is flipped about its own
                centre, so offsetting it afterwards moves what is seen. */}
            <video
              ref={attachVideo} autoPlay playsInline muted
              className="absolute max-w-none"
              style={{
                width: pct(geom.videoW),
                height: pct(geom.videoH),
                left: pct(geom.videoX),
                top: pct(geom.videoY),
                transform: 'scaleX(-1)',
                filter: filtersToCSS(settings.filters),
              }}
            />

            {/* Everything outside the window is thrown away, so it is dimmed
                hard — at a glance the bright rectangle is the photo and the
                rest is offcut. Four panels rather than one clipped box: a
                clip-path hole is invisible wherever the artwork covers it,
                which is most of the frame. */}
            {[
              { left: 0, top: 0, width: 1, height: geom.winY },
              { left: 0, top: geom.winY + geom.winH, width: 1, height: 1 - geom.winY - geom.winH },
              { left: 0, top: geom.winY, width: geom.winX, height: geom.winH },
              {
                left: geom.winX + geom.winW, top: geom.winY,
                width: 1 - geom.winX - geom.winW, height: geom.winH,
              },
            ].map((r, i) => (
              <div
                key={i}
                className="pointer-events-none absolute z-10"
                style={{
                  left: pct(r.left), top: pct(r.top),
                  width: pct(Math.max(0, r.width)), height: pct(Math.max(0, r.height)),
                  background: 'rgba(11,10,12,0.66)',
                }}
              />
            ))}

            {/* The artwork, inset so the overspill stays visible around it.
                It surrounds the photo rather than covering it, and is
                unfiltered because at capture time it is drawn after the Look
                is lifted. */}
            <img
              src={frame!.src} alt="" draggable={false}
              className="pointer-events-none absolute z-20"
              style={{
                left: pct(geom.frameX), top: pct(geom.frameY),
                width: pct(geom.frameW), height: pct(geom.frameH),
              }}
            />

            {/* The crop line, above the artwork so it is never buried by it.
                This is the edge of the photo — the frame's own border sits a
                little outside it and is easy to mistake for the boundary. */}
            <div
              className="pointer-events-none absolute z-30 ring-2 ring-white"
              style={{
                left: pct(geom.winX), top: pct(geom.winY),
                width: pct(geom.winW), height: pct(geom.winH),
                boxShadow: '0 0 0 1px rgba(11,10,12,0.55)',
              }}
            >
              {['-left-px -top-px border-l-4 border-t-4', '-right-px -top-px border-r-4 border-t-4',
                '-left-px -bottom-px border-l-4 border-b-4', '-right-px -bottom-px border-r-4 border-b-4',
              ].map(pos => (
                <span
                  key={pos}
                  className={`absolute h-5 w-5 border-[var(--accent)] ${pos}`}
                />
              ))}
            </div>

            {/* The drag surface covers everything, so the picture can be
                grabbed anywhere — including out in the offcut. */}
            <div
              onPointerDown={startPan}
              className={`absolute inset-0 z-40 touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            />
          </>
        ) : (
          <>
            {/* Mirrored to match the booth, and carrying the Look: a region
                judged against an unfiltered picture is judged against
                something the booth never produces. */}
            <video
              ref={attachVideo} autoPlay playsInline muted
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)', filter: filtersToCSS(settings.filters) }}
            />

            {ready && (
              <>
                {/* Dim everything outside the region, so the framing reads at
                    a glance rather than having to trace a thin outline. */}
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
                  className={`absolute z-20 cursor-move touch-none rounded-[3px] ring-2 ring-[var(--accent)] ${
                    dragging ? 'ring-[3px]' : ''
                  }`}
                  style={{
                    left: pct(crop.x), top: pct(crop.y),
                    width: pct(crop.w), height: pct(crop.h),
                  }}
                >
                  {/* A handle on every corner, each anchoring the opposite one.
                      They sit just inside the edge: hung outside they were
                      clipped away by the preview's overflow the moment the
                      region touched one. */}
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
          </>
        )}

        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[0.78rem] text-white/70">
            {error ? `Camera unavailable — ${error}` : 'Starting the camera…'}
          </p>
        )}
      </div>

      {/* Zoom belongs here rather than on corner handles: with the frame fixed
          there are no corners to pull, and zooming about the centre is what
          "fit it in the frame" actually means. */}
      {framed && (
        <label className="mt-4 flex items-center gap-3 text-[0.75rem] font-semibold text-[var(--ink-2)]">
          <MagnifyingGlass size={15} className="shrink-0" />
          <input
            type="range" min={100} max={Math.round(100 / MIN_W)} step={1}
            value={Math.round(100 / crop.w)}
            onChange={e => set(clampZoom(crop, 100 / Number(e.target.value)))}
            aria-label="Zoom"
            className="dsac-range"
          />
          <span className="w-10 shrink-0 text-right tabular-nums text-[var(--ink-3)]">
            {(1 / crop.w).toFixed(1)}&times;
          </span>
        </label>
      )}

      <p className="mt-3 text-[0.72rem] tabular-nums text-[var(--ink-3)]">
        {settings.cropEnabled
          ? `Using ${Math.round(crop.w * 100)}% of the camera's width — a ${(1 / crop.w).toFixed(1)}× zoom.`
          : framed
            ? 'Using the whole scene. Drag or zoom to change what fills the frame.'
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
