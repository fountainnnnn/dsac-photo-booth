import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  Camera,
  CameraSlash,
  CaretRight,
  CircleHalf,
  DiceFive,
  Drop,
  Eye,
  Image as ImageIcon,
  Palette,
  Sun,
  Timer as TimerIcon,
} from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import FrameWheelModal from '@/components/ui/FrameWheelModal';
import { useLivePreview } from './useLivePreview';
import { useFrameCatalogue } from '@/components/features/frames/useFrameCatalogue';
import { rememberCapture } from '@/components/features/gallery/galleryStore';
import type { FrameConfig } from '@/types/frame';
import {
  FRAME_ASPECT, FRAME_W as FRAME_W_PX, FRAME_H as FRAME_H_PX,
  STAMP_FONT_STACK, drawDateStamp, stampFontPx, stampText,
} from '@/types/frame';
import type { ImageFilters } from '@/types/editor';
import { DEFAULT_FILTERS, FILTER_PRESETS, filtersToCSS } from '@/types/editor';

const TIMER_OPTIONS = [0, 3, 5, 10] as const;
type TimerOption = typeof TIMER_OPTIONS[number];

type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface CameraViewProps {
  facingMode?: 'user' | 'environment';
  onCapture: (blob: Blob, dataUrl: string) => void;
  onError?: (error: Error) => void;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not capture photo'));
    }, type, quality);
  });
}

/** True once an <img> holds decoded pixels we can safely draw. */
function isDrawable(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

export default function CameraView({ facingMode = 'user', onCapture, onError }: CameraViewProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const stageBoxRef   = useRef<HTMLDivElement>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const framesCardRef = useRef<HTMLDivElement>(null);
  const filtersCardRef = useRef<HTMLDivElement>(null);
  const adjustCardRef = useRef<HTMLDivElement>(null);

  const [permission, setPermission]     = useState<PermissionStatus>('prompt');
  const [isStreaming, setIsStreaming]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { frames } = useFrameCatalogue();

  // Only the wheel can award a frame. Tapping a swatch in the Frames card is a
  // preview — it changes what you see, never what gets baked into the photo.
  //   undefined -> not previewing, show whatever was won
  //   null      -> previewing "no frame"
  //   frame     -> previewing that frame
  const [wonFrame, setWonFrame] = useState<FrameConfig | null>(null);
  const [preview, setPreview]   = useState<FrameConfig | null | undefined>(undefined);
  const [wheelOpen, setWheelOpen] = useState(false);

  const displayFrame = preview !== undefined ? preview : wonFrame;
  const isPreviewing = preview !== undefined && (preview?.id ?? null) !== (wonFrame?.id ?? null);
  const [filters, setFilters]         = useState<ImageFilters>(DEFAULT_FILTERS);
  const [filterThumb, setFilterThumb] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [stageSize, setStageSize]     = useState({ w: 0, h: 0 });

  const [timerSecs, setTimerSecs]     = useState<TimerOption>(0);
  const [countdown, setCountdown]     = useState<number | null>(null);

  // Drop references to frames an operator deleted while the kiosk was open.
  useEffect(() => {
    if (wonFrame && !frames.some(f => f.id === wonFrame.id)) setWonFrame(null);
    if (preview && !frames.some(f => f.id === preview.id)) setPreview(undefined);
  }, [frames, wonFrame, preview]);

  // ── Camera ───────────────────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission('unsupported');
      setErrorMessage('Camera not supported on this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 16:10 to match the frame artboards (1921x1201).
        video: { facingMode, aspectRatio: FRAME_ASPECT, width: { ideal: 1920 }, height: { ideal: 1200 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPermission('granted');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setPermission('denied');
        setErrorMessage('Camera access was denied. Allow camera in browser settings and refresh.');
      } else if (error.name === 'NotFoundError') {
        setErrorMessage('No camera found. Connect a camera and try again.');
      } else {
        setErrorMessage(`Camera error: ${error.message}`);
      }
      onError?.(error);
    }
  }, [facingMode, onError]);

  useEffect(() => {
    queueMicrotask(() => { void startCamera(); });
    return () => stopStream();
  }, [startCamera, stopStream]);

  // ── Frame preloading ─────────────────────────────────────────────────────────
  // The shutter must never await a network image: a slow or failed PNG would
  // otherwise leave the button doing nothing at all.
  const frameCache = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    for (const frame of frames) {
      if (frameCache.current.has(frame.src)) continue;
      const img = new Image();
      img.onerror = () => console.warn('[DSAC] Frame failed to preload:', frame.src);
      img.src = frame.src;
      frameCache.current.set(frame.src, img);
    }
  }, [frames]);

  // ── Live preview ─────────────────────────────────────────────────────────────

  // The photo is drawn inside the frame's cut-out, so the frame wraps it
  // rather than covering its edges.
  const { canvasRef } = useLivePreview(videoRef, {
    filters,
    contentRect: displayFrame?.window ?? null,
  });

  // Size the stage in JS rather than with aspect-ratio + max-height. Those two
  // fight: whichever axis is binding wins and the other is left over-long, so
  // the frame artwork gets stretched. Fitting the artboard into the available
  // box keeps it exact on both axes.
  useLayoutEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;

    const fit = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const scale = Math.min(width / FRAME_W_PX, height / FRAME_H_PX);
      const w = Math.max(1, Math.floor(FRAME_W_PX * scale));
      const h = Math.max(1, Math.floor(FRAME_H_PX * scale));
      setStageSize({ w, h });
      if (canvasRef.current) {
        canvasRef.current.width = w;
        canvasRef.current.height = h;
      }
    };

    // Measure straight away. ResizeObserver callbacks are delivered as part of
    // the rendering steps, so a backgrounded or not-yet-composited tab never
    // gets one — relying on it alone would leave the stage collapsed to 0x0.
    const initial = box.getBoundingClientRect();
    fit(initial.width, initial.height);

    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => {
        const r = box.getBoundingClientRect();
        fit(r.width, r.height);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) fit(r.width, r.height);
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [canvasRef]);

  // Small unfiltered snapshot so each preset chip can preview itself.
  useEffect(() => {
    if (!isStreaming) return;
    const grab = () => {
      const video = videoRef.current;
      if (!video?.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = 96; c.height = 60;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, c.width, c.height);
      setFilterThumb(c.toDataURL('image/jpeg', 0.6));
    };
    grab();
    const id = setInterval(grab, 2500);
    return () => clearInterval(id);
  }, [isStreaming]);

  // ── Capture ──────────────────────────────────────────────────────────────────

  const doCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !isStreaming) return;

    const liveCanvas = canvasRef.current;
    if (liveCanvas?.width && liveCanvas.height) {
      const output = document.createElement('canvas');
      output.width = liveCanvas.width;
      output.height = liveCanvas.height;
      const ctx = output.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(liveCanvas, 0, 0);

      // Only a frame that was actually won is baked in. A preview is for
      // looking at, so it must never reach the photo.
      if (wonFrame) {
        const cached = frameCache.current.get(wonFrame.src);
        if (isDrawable(cached)) {
          ctx.drawImage(cached, 0, 0, output.width, output.height);
          drawDateStamp(ctx, wonFrame, output.width, output.height);
        } else {
          console.warn('[DSAC] Frame not ready; capturing without it:', wonFrame.src);
        }
      }

      const dataUrl = output.toDataURL('image/jpeg', 0.92);
      setLastCapture(dataUrl);
      rememberCapture(dataUrl);
      const blob = await canvasToBlob(output);
      onCapture(blob, dataUrl);
      return;
    }

    // Fallback path (no live canvas yet). Render at the artboard size so the
    // frame lands pixel-for-pixel.
    const outW = FRAME_W_PX;
    const outH = FRAME_H_PX;
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // The photo goes inside the frame's cut-out; the frame wraps it.
    const win = wonFrame?.window;
    const dx = win ? Math.round(win.x * outW) : 0;
    const dy = win ? Math.round(win.y * outH) : 0;
    const dw = win ? Math.round(win.w * outW) : outW;
    const dh = win ? Math.round(win.h * outH) : outH;

    if (win) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
    }

    const vw = video.videoWidth  || dw;
    const vh = video.videoHeight || dh;
    const sourceAspect = vw / vh;
    const destAspect = dw / dh;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (sourceAspect > destAspect) {
      sw = Math.round(vh * destAspect); sx = Math.round((vw - sw) / 2);
    } else {
      sh = Math.round(vw / destAspect); sy = Math.round((vh - sh) / 2);
    }

    ctx.save();
    ctx.filter = filtersToCSS(filters);
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();

    if (wonFrame) {
      const cachedFrame = frameCache.current.get(wonFrame.src);
      if (isDrawable(cachedFrame)) {
        ctx.drawImage(cachedFrame, 0, 0, outW, outH);
        drawDateStamp(ctx, wonFrame, outW, outH);
      }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setLastCapture(dataUrl);
    rememberCapture(dataUrl);
    const blob = await canvasToBlob(canvas);
    onCapture(blob, dataUrl);
  }, [isStreaming, canvasRef, filters, wonFrame, onCapture]);

  const handleCapturePress = useCallback(() => {
    if (countdown !== null) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(null);
      return;
    }
    if (timerSecs === 0) { void doCapture(); return; }

    setCountdown(timerSecs);
    let remaining: number = timerSecs;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        void doCapture();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [countdown, timerSecs, doCapture]);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  // ── Navigation ───────────────────────────────────────────────────────────────

  const navigate = useCallback((section: StudioSection) => {
    if (section === 'settings') { window.location.href = '/settings'; return; }
    if (section === 'gallery')  { window.location.href = '/gallery'; return; }
    if (section === 'frames')   { window.location.href = '/frames'; return; }
    const target = section === 'filters' ? filtersCardRef
      : section === 'adjust' ? adjustCardRef
      : null;
    target?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    target?.current?.animate?.(
      [{ boxShadow: '0 0 0 0 rgba(225,38,47,0.5)' }, { boxShadow: '0 0 0 6px rgba(225,38,47,0)' }],
      { duration: 700, easing: 'ease-out' },
    );
  }, []);

  const enabledFrames = useMemo(() => frames.filter((f) => f.enabled !== false), [frames]);

  return (
    <StudioShell active="capture" onNavigate={navigate}>
      <video ref={videoRef} data-testid="capture-video-element" autoPlay playsInline muted
        onCanPlay={() => setIsStreaming(true)} className="hidden" />

      {/* Header */}
      <header className="flex shrink-0 items-center gap-6">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
          Make it yours<span className="text-[var(--accent)]">.</span>
        </h1>

        <div className="ml-auto flex items-center gap-1 rounded-full border border-[var(--border)] p-1.5 pl-4">
          <TimerIcon size={19} className="mr-1.5 text-[var(--ink-2)]" />
          <span className="mr-1.5 text-[0.85rem] font-semibold text-[var(--ink-2)]">Timer</span>
          {TIMER_OPTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setTimerSecs(s)}
              className={`min-w-[62px] rounded-full px-4 py-2 text-[0.85rem] font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                timerSecs === s
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-2)] hover:bg-[var(--shell-bg)]'
              }`}
            >
              {s === 0 ? 'Off' : `${s}s`}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilters(DEFAULT_FILTERS)}
          aria-label="Reset adjustments"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--ink-2)] transition hover:border-[var(--ink-3)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Sun size={19} />
        </button>
      </header>

      {/* Stage + capture rail */}
      <div data-testid="capture-camera-root" className="mt-6 flex min-h-0 flex-1 gap-5">
        <div ref={stageBoxRef}
          className="flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[20px]"
          style={{ background: 'var(--shell-bg)' }}>
          <div
            ref={canvasAreaRef}
            className="relative overflow-hidden rounded-[16px]"
            style={{
              width: stageSize.w || undefined,
              height: stageSize.h || undefined,
              containerType: 'size',
              // A hairline plus a soft drop shadow. Without these, a frame with
              // a white border (or a blown-out feed) runs straight into the
              // light panel behind it and the photo loses its edge.
              boxShadow:
                '0 0 0 1px rgba(11,10,12,0.10), 0 10px 30px -10px rgba(11,10,12,0.32)',
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full"
              style={{ background: 'var(--shell-bg)' }} />

            {displayFrame && (
              <>
                <img src={displayFrame.src} alt="" draggable={false}
                  className="pointer-events-none absolute inset-0 z-10 h-full w-full" />
                <LiveDateStamp frame={displayFrame} />
              </>
            )}

            {/* Say plainly that a previewed frame is not the one you'll get. */}
            {isPreviewing && (
              <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/65 px-4 py-2 backdrop-blur-md">
                <Eye size={15} className="text-white/80" />
                <span className="text-[0.75rem] font-semibold text-white">
                  Preview only — spin to win a frame
                </span>
              </div>
            )}

            {countdown !== null && (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                <div className="flex h-32 w-32 items-center justify-center rounded-full border border-white/20 bg-black/45 backdrop-blur-md">
                  <span className="text-7xl font-medium leading-none tabular-nums text-white">{countdown}</span>
                </div>
              </div>
            )}

            {errorMessage && (
              <div data-testid="capture-permission-notice" role="alert"
                className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 px-8 text-center"
                style={{ background: 'var(--shell-bg)' }}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]">
                  <CameraSlash size={26} />
                </span>
                <p className="max-w-[38ch] text-[0.95rem] font-medium leading-[1.5] text-[var(--ink)]">{errorMessage}</p>
                {permission !== 'denied' && permission !== 'unsupported' && (
                  <button type="button" onClick={startCamera}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                    <ArrowClockwise size={17} />
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Capture rail */}
        <aside data-testid="capture-controls"
          className="flex w-[266px] shrink-0 flex-col rounded-[20px] border border-[var(--border)] px-6 py-6">
          <p className="text-center text-[1.05rem] font-semibold text-[var(--ink)]">Capture</p>

          <div className="mt-5 flex justify-center">
            <button
              data-testid="capture-button"
              type="button"
              onClick={handleCapturePress}
              disabled={!isStreaming}
              aria-label={countdown !== null ? 'Cancel timer' : 'Take photo'}
              className="group flex h-[108px] w-[108px] items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_10px_30px_-8px_rgba(225,38,47,0.55)] ring-[6px] ring-white transition-all duration-150 hover:-translate-y-px hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-[6px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_35%,white)]"
            >
              <Camera size={40} weight="fill" />
            </button>
          </div>

          <button
            data-testid="open-frame-wheel"
            type="button"
            onClick={() => setWheelOpen(true)}
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] px-4 text-[0.9rem] font-semibold text-[var(--ink)] transition hover:border-[var(--ink-3)] hover:bg-[var(--shell-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <DiceFive size={19} />
            {wonFrame ? 'Spin again' : 'Spin for a frame'}
          </button>

          <a
            href="/gallery"
            className="mt-2.5 inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] px-4 text-[0.9rem] font-semibold text-[var(--ink)] transition hover:border-[var(--ink-3)] hover:bg-[var(--shell-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ImageIcon size={19} />
            Last capture
          </a>

          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <p className="text-[0.78rem] font-medium text-[var(--ink-3)]">Last capture</p>
            <div className="mt-3 flex items-start gap-3">
              <div className="h-[52px] w-[74px] shrink-0 overflow-hidden rounded-lg"
                style={{ background: 'var(--shell-bg)' }}>
                {lastCapture && <img src={lastCapture} alt="Most recent capture" className="h-full w-full object-cover" />}
              </div>
              <p className="text-[0.75rem] leading-[1.45] text-[var(--ink-3)]">
                {lastCapture ? (
                  <>Saved<br />Ready to share.</>
                ) : (
                  <>No captures yet<br />Your latest photo will appear here.</>
                )}
              </p>
            </div>
          </div>

          <p className="mt-auto pt-4 text-center text-[0.72rem] text-[var(--ink-3)]">
            {wonFrame
              ? <>Frame: <strong className="font-semibold text-[var(--ink)]">{wonFrame.label}</strong></>
              : isPreviewing
                ? <>Previewing <strong className="font-semibold text-[var(--ink)]">{displayFrame?.label ?? 'no frame'}</strong> — not yours yet</>
                : 'No frame yet'}
          </p>
        </aside>
      </div>

      {/* Bottom cards */}
      <div className="mt-5 grid shrink-0 grid-cols-3 gap-5">
        <Card ref={framesCardRef} title="Frames" actionLabel="View all"
          onAction={() => { window.location.href = '/frames'; }}>
          <div className="flex items-end gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <Swatch active={!displayFrame} label="None" onClick={() => setPreview(null)}>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-8 w-px rotate-45 bg-[var(--ink-3)]" />
              </span>
            </Swatch>
            {enabledFrames.map((f) => (
              <Swatch key={f.id} active={displayFrame?.id === f.id} label={f.label} onClick={() => setPreview(f)}>
                <img src={f.src} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
              </Swatch>
            ))}
            <button
              type="button"
              onClick={() => setWheelOpen(true)}
              aria-label="Open the frame wheel"
              className="mb-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--ink-2)] shadow-sm transition hover:border-[var(--ink-3)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <CaretRight size={15} weight="bold" />
            </button>
          </div>
        </Card>

        <Card ref={filtersCardRef} title="Filters" actionLabel="View all"
          onAction={() => setFilters(DEFAULT_FILTERS)}>
          <div className="flex items-end gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {FILTER_PRESETS.slice(0, 6).map(p => {
              const on = filters.brightness === p.filters.brightness
                && filters.contrast === p.filters.contrast
                && filters.saturation === p.filters.saturation
                && filters.hue === p.filters.hue;
              return (
                <Swatch key={p.label} active={on} label={p.label} onClick={() => setFilters(p.filters)}>
                  {filterThumb
                    ? <img src={filterThumb} alt="" className="absolute inset-0 h-full w-full object-cover"
                        style={{ filter: filtersToCSS(p.filters) }} draggable={false} />
                    : <span className="absolute inset-0" style={{ background: '#dcdce0', filter: filtersToCSS(p.filters) }} />}
                </Swatch>
              );
            })}
          </div>
        </Card>

        <Card ref={adjustCardRef} title="Adjustments" actionLabel="Reset"
          onAction={() => setFilters(DEFAULT_FILTERS)}>
          <div className="flex flex-col gap-2">
            <Slider icon={<Sun size={16} />} label="Brightness" value={filters.brightness} min={50} max={150}
              onChange={v => setFilters(f => ({ ...f, brightness: v }))} />
            <Slider icon={<CircleHalf size={16} weight="fill" />} label="Contrast" value={filters.contrast} min={50} max={150}
              onChange={v => setFilters(f => ({ ...f, contrast: v }))} />
            <Slider icon={<Drop size={16} />} label="Saturation" value={filters.saturation} min={0} max={200}
              onChange={v => setFilters(f => ({ ...f, saturation: v }))} />
            <Slider icon={<Palette size={16} />} label="Hue" value={filters.hue} min={-180} max={180} unit="°" hue
              onChange={v => setFilters(f => ({ ...f, hue: v }))} />
          </div>
        </Card>
      </div>

      <FrameWheelModal
        open={wheelOpen}
        frames={enabledFrames}
        onPicked={(f) => { setWonFrame(f); setPreview(undefined); }}
        onClose={() => setWheelOpen(false)}
      />
    </StudioShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ ref, title, actionLabel, onAction, children }: {
  ref?: React.Ref<HTMLDivElement>;
  title: string; actionLabel: string; onAction: () => void; children: React.ReactNode;
}) {
  return (
    <div ref={ref} className="min-w-0 rounded-[18px] border border-[var(--border)] px-5 py-4">
      <div className="mb-3.5 flex items-center justify-between">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">{title}</p>
        <button type="button" onClick={onAction}
          className="text-[0.8rem] font-semibold text-[var(--accent)] transition hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          {actionLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

function Swatch({ active, label, onClick, children }: {
  active: boolean; label: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={label}
      className="group flex shrink-0 flex-col items-center gap-1.5 focus:outline-none">
      <span
        className={`relative block h-[74px] w-[62px] overflow-hidden rounded-[10px] border transition-all duration-150 ${
          active ? 'border-[var(--accent)] ring-2 ring-[color-mix(in_srgb,var(--accent)_28%,transparent)]'
                 : 'border-[var(--border)] group-hover:border-[var(--ink-3)]'
        }`}
        style={{ background: '#e6e6ea' }}
      >
        {children}
      </span>
      <span className={`max-w-[64px] truncate text-[0.72rem] font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--ink-2)]'}`}>
        {label}
      </span>
    </button>
  );
}

function Slider({ icon, label, value, min, max, unit = '', hue = false, onChange }: {
  icon: React.ReactNode; label: string; value: number; min: number; max: number;
  unit?: string; hue?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[var(--ink-2)]">{icon}</span>
      <span className="w-[74px] shrink-0 text-[0.8rem] font-medium text-[var(--ink-2)]">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={hue ? 'dsac-range dsac-range-hue' : 'dsac-range'}
        aria-label={label}
      />
      <span className="w-9 shrink-0 text-right text-[0.78rem] tabular-nums text-[var(--ink-2)]">
        {hue ? value : value - 100}{unit}
      </span>
    </div>
  );
}

/**
 * The event date over the live feed, so the preview matches the photo.
 * Sized in cqh against the stage — the same fraction-of-height the canvas stamp
 * uses — so the two cannot drift.
 */
function LiveDateStamp({ frame }: { frame: FrameConfig }) {
  const stamp = frame.dateStamp;
  const [shrink, setShrink] = useState(1);

  useEffect(() => {
    if (!stamp?.maxWidthFrac) { setShrink(1); return; }
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    const full = Math.round(stamp.sizeFrac * FRAME_H_PX);
    const fitted = stampFontPx(ctx, frame, FRAME_W_PX, FRAME_H_PX);
    setShrink(full > 0 ? fitted / full : 1);
  }, [frame, stamp]);

  if (!stamp) return null;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-20 whitespace-nowrap"
      style={{
        left: `${stamp.xFrac * 100}%`,
        top: `${stamp.yFrac * 100}%`,
        transform: `translate(${stamp.align === 'center' ? '-50%' : '0'}, -100%)`,
        fontFamily: STAMP_FONT_STACK,
        fontSize: `${stamp.sizeFrac * shrink * 100}cqh`,
        color: stamp.colour,
        lineHeight: 1,
      }}
    >
      {stampText(frame)}
    </span>
  );
}
