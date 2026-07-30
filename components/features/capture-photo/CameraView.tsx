import { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, CameraOff, Dices, RotateCcw, SlidersHorizontal, Timer } from 'lucide-react';
import CaptureButton from '@/components/ui/CaptureButton';
import AmbientOrb from '@/components/ui/AmbientOrb';
import SectionHeader from '@/components/ui/SectionHeader';
import FrameWheelModal from '@/components/ui/FrameWheelModal';
import { useLivePreview } from './useLivePreview';
import type { FrameConfig } from '@/types/frame';
import {
  FRAMES, FRAME_ASPECT, FRAME_W as FRAME_W_PX, FRAME_H as FRAME_H_PX,
  STAMP_FONT_STACK, drawDateStamp, stampFontPx, stampText,
} from '@/types/frame';
import type { ImageFilters } from '@/types/editor';
import { DEFAULT_FILTERS, FILTER_PRESETS, filtersToCSS } from '@/types/editor';

// ── Preset data ───────────────────────────────────────────────────────────────

const TIMER_OPTIONS = [0, 5, 10] as const;
type TimerOption = typeof TIMER_OPTIONS[number];

// ── Types ─────────────────────────────────────────────────────────────────────

type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface CameraViewProps {
  facingMode?: 'user' | 'environment';
  onCapture: (blob: Blob, dataUrl: string) => void;
  onError?: (error: Error) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function CameraView({ facingMode = 'user', onCapture, onError }: CameraViewProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const [permission, setPermission]     = useState<PermissionStatus>('prompt');
  const [isStreaming, setIsStreaming]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // No frame until the wheel decides one.
  const [activeFrame, setActiveFrame] = useState<FrameConfig | null>(null);
  const [wheelOpen, setWheelOpen]     = useState(false);
  const [filters, setFilters]         = useState<ImageFilters>(DEFAULT_FILTERS);
  const [filterThumb, setFilterThumb] = useState<string | null>(null); // neutral live frame for filter previews

  // Timer
  const [timerSecs, setTimerSecs]     = useState<TimerOption>(0);
  const [countdown, setCountdown]     = useState<number | null>(null);

  // ── Camera init ──────────────────────────────────────────────────────────────

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
  // Decode every frame up front and keep the elements around. The shutter must
  // never await a network image: a slow or failed PNG would otherwise leave the
  // button doing nothing at all.
  const frameCache = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    for (const frame of FRAMES) {
      if (frameCache.current.has(frame.src)) continue;
      const img = new Image();
      img.onerror = () => console.warn('[DSAC] Frame failed to preload:', frame.src);
      img.src = frame.src;
      frameCache.current.set(frame.src, img);
    }
  }, []);

  // ── Live preview ─────────────────────────────────────────────────────────────

  const { canvasRef } = useLivePreview(videoRef, { filters });

  // Size canvas to match container exactly — eliminates object-contain letterboxing
  useEffect(() => {
    const container = canvasAreaRef.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') {
      const rect = container.getBoundingClientRect();
      if (canvasRef.current) {
        canvasRef.current.width = Math.round(rect.width || 1280);
        canvasRef.current.height = Math.round(rect.height || 720);
      }
      return;
    }
    const ro = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && canvasRef.current) {
        canvasRef.current.width  = Math.round(rect.width);
        canvasRef.current.height = Math.round(rect.height);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [canvasRef]);

  // ── Filter preview thumbnail ──────────────────────────────────────────────────
  // Snapshot a small *unfiltered* frame from the feed so each preset chip can show
  // the effect via its own CSS filter. Refreshed occasionally; previews stay live-ish.
  useEffect(() => {
    if (!isStreaming) return;
    const grab = () => {
      const video = videoRef.current;
      if (!video?.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 54;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, c.width, c.height);
      setFilterThumb(c.toDataURL('image/jpeg', 0.6));
    };
    grab();
    const id = setInterval(grab, 2500);
    return () => clearInterval(id);
  }, [isStreaming]);

  // ── Capture (with timer) ─────────────────────────────────────────────────────

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

      if (activeFrame) {
        const cached = frameCache.current.get(activeFrame.src);
        if (isDrawable(cached)) {
          ctx.drawImage(cached, 0, 0, output.width, output.height);
          drawDateStamp(ctx, activeFrame, output.width, output.height);
        } else {
          console.warn('[DSAC] Frame not ready; capturing without it:', activeFrame.src);
        }
      }

      const dataUrl = output.toDataURL('image/jpeg', 0.92);
      const blob = await canvasToBlob(output);
      onCapture(blob, dataUrl);
      return;
    }

    const vw = video.videoWidth  || 1920;
    const vh = video.videoHeight || 1200;
    const targetAspect = FRAME_ASPECT;
    const sourceAspect = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (Math.abs(sourceAspect - targetAspect) > 0.01) {
      if (sourceAspect > targetAspect) { sw = Math.round(vh * targetAspect); sx = Math.round((vw - sw) / 2); }
      else                              { sh = Math.round(vw / targetAspect); sy = Math.round((vh - sh) / 2); }
    }

    const canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(sw, 0);
    ctx.scale(-1, 1);
    ctx.filter = filtersToCSS(filters);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.filter = 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (activeFrame) {
      const cachedFrame = frameCache.current.get(activeFrame.src);
      if (isDrawable(cachedFrame)) {
        ctx.drawImage(cachedFrame, 0, 0, sw, sh);
        drawDateStamp(ctx, activeFrame, sw, sh);
      } else {
        console.warn('[DSAC] Frame not ready; capturing without it:', activeFrame.src);
      }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = await canvasToBlob(canvas);
    onCapture(blob, dataUrl);
  }, [isStreaming, canvasRef, filters, activeFrame, onCapture]);

  const handleCapturePress = useCallback(() => {
    if (countdown !== null) {
      // Cancel in-flight countdown
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(null);
      return;
    }
    if (timerSecs === 0) { void doCapture(); return; }

    setCountdown(timerSecs);
    let remaining = timerSecs;
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

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="capture-camera-root"
      className="flex h-dvh w-full overflow-hidden"
      style={{ background: 'var(--stage)' }}
    >
      {/* Hidden video */}
      <video ref={videoRef} data-testid="capture-video-element" autoPlay playsInline muted
        onCanPlay={() => setIsStreaming(true)} className="hidden" />

      {/* ── Live canvas column ── */}
      {/* Chrome lives above and below the stage, never on it: what you see
          inside the 16:9 rectangle is exactly what gets captured. */}
      <div
        className="relative flex min-w-0 flex-1 select-none flex-col overflow-hidden px-8 py-6"
        style={{ background: 'var(--stage)' }}
      >
        <AmbientOrb tone="dark" />

        {/* Chrome row — above the stage */}
        <div className="relative z-10 flex shrink-0 items-center pb-5">
          <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-9 w-auto opacity-90" />
        </div>

        {/* Stage row — flexes to fill, centres the 16:9 rectangle */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <div
            ref={canvasAreaRef}
            className="relative overflow-hidden rounded-[20px]"
            // width-driven so aspect-ratio actually governs the height. A definite
            // height here would win over aspect-ratio and letterbox the 16:9 frame
            // SVGs against the photo edges.
            style={{
              aspectRatio: `${FRAME_ASPECT}`,
              width: '100%',
              maxHeight: '100%',
              boxShadow: '0 30px 80px -24px rgba(0,0,0,0.8)',
              // lets the date stamp size itself in cqh, so preview and capture agree
              containerType: 'size',
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ background: '#0b0a0c' }} />

          {/* Active frame — full-bleed, never intercepts pointer events */}
          {/* Frame + its date stamp. object-fill (the default) because capture
              composites the frame stretched to the full canvas; object-contain
              would letterbox here and disagree with the photo. */}
          {activeFrame && (
            <>
              <img
                src={activeFrame.src}
                alt=""
                className="pointer-events-none absolute inset-0 z-10 h-full w-full"
                draggable={false}
              />
              <LiveDateStamp frame={activeFrame} />
            </>
          )}

          {/* Countdown overlay */}
          {countdown !== null && (
            <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-4">
              <div className="relative flex items-center justify-center">
                <div className="absolute h-40 w-40 rounded-full border-2 border-[var(--accent)]/50"
                  style={{ animation: 'dsac-countdown-ring 1s ease-out infinite' }} />
                <div className="flex h-32 w-32 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-xl">
                  <span className="text-7xl font-medium leading-none tabular-nums text-white"
                    style={{ textShadow: '0 2px 16px rgba(0,0,0,0.6)' }}>
                    {countdown}
                  </span>
                </div>
              </div>
              <span className="rounded-xl border border-white/15 bg-black/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-xl">
                Tap to cancel
              </span>
            </div>
          )}

          {/* Error overlay — stays on the stage, it replaces the feed */}
          {errorMessage && (
            <div data-testid="capture-permission-notice" role="alert"
              className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 px-8 text-center"
              style={{ background: 'color-mix(in srgb, var(--stage) 95%, transparent)' }}>
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10">
                <CameraOff className="h-6 w-6 text-[var(--accent)]" strokeWidth={1.75} />
              </div>
              <p className="max-w-[38ch] text-base font-medium leading-[1.5] text-white">{errorMessage}</p>
              {permission !== 'denied' && permission !== 'unsupported' && (
                <button onClick={startCamera}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 px-6 text-sm font-semibold text-white transition-all duration-150 hover:border-white/40 hover:bg-white/10 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
                  <RotateCcw className="h-4 w-4" strokeWidth={2} />
                  Try again
                </button>
              )}
            </div>
          )}
          </div>{/* end 16:9 stage */}
        </div>{/* end stage row */}

        {/* Shutter row — below the stage, so it never lands in the photo */}
        {!errorMessage && (
          <div
            data-testid="capture-controls"
            className="relative z-10 flex shrink-0 flex-col items-center gap-2.5 pt-5"
          >
            <CaptureButton
              onClick={handleCapturePress}
              disabled={!isStreaming}
              ariaLabel={countdown !== null ? 'Cancel timer' : 'Take photo'}
            />
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.24em] text-white/45">
              {!isStreaming
                ? 'Starting camera…'
                : countdown !== null
                  ? 'Tap to cancel'
                  : timerSecs > 0
                    ? `${timerSecs}s timer set`
                    : 'Press to capture'}
            </span>
          </div>
        )}
      </div>{/* end camera column */}

      {/* ── Right editing panel ── */}
      <aside
        className="flex w-80 flex-shrink-0 flex-col overflow-y-auto border-l border-[var(--border)]"
        style={{ background: 'var(--background)' }}
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--ink)] shadow-[0_1px_2px_rgba(11,10,12,0.06)]">
            <Aperture className="h-4 w-4" strokeWidth={2} />
          </span>
          <SectionHeader
            size="sm"
            align="left"
            eyebrow="Customize"
            title={
              <>
                Make it yours<span className="text-[var(--accent)]">.</span>
              </>
            }
          />
        </div>

        {/* Timer section */}
        <Section label="Timer" icon={Timer}>
          <div className="flex gap-2">
            {TIMER_OPTIONS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setTimerSecs(s)}
                className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition-all duration-150 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  timerSecs === s
                    ? 'bg-[var(--accent)] text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_6px_18px_rgba(225,38,47,0.26)]'
                    : 'border border-[var(--border)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)] hover:text-[var(--ink)]'
                }`}
              >
                {s === 0 ? 'Off' : `${s}s`}
              </button>
            ))}
          </div>
        </Section>

        {/* Frame section — the wheel lives in its own full-screen moment */}
        <Section label="Frame" icon={Dices}>
          <button
            type="button"
            data-testid="open-frame-wheel"
            onClick={() => setWheelOpen(true)}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_6px_18px_rgba(225,38,47,0.26)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--accent-hover)] active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            <Dices className="h-4 w-4" strokeWidth={2} />
            {activeFrame ? 'Spin again' : 'Spin for a frame'}
          </button>
          <p aria-live="polite" className="mt-2.5 text-[0.6875rem] leading-[1.5] text-[var(--ink-3)]">
            {activeFrame
              ? <>Frame: <strong className="font-semibold text-[var(--ink)]">{activeFrame.label}</strong></>
              : 'No frame yet — spin to get one.'}
          </p>
        </Section>

        {/* Filters section */}
        <Section label="Filters" icon={SlidersHorizontal}>
          {/* Preset grid — each chip previews the filter on a live frame.
              4 columns keeps all 12 presets in 3 rows so the panel never scrolls. */}
          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {FILTER_PRESETS.map(p => {
              const active =
                filters.brightness === p.filters.brightness &&
                filters.contrast   === p.filters.contrast   &&
                filters.saturation === p.filters.saturation &&
                filters.hue        === p.filters.hue;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setFilters(p.filters)}
                  className="group flex flex-col items-center gap-1 rounded-lg p-0.5 focus:outline-none"
                >
                  <span
                    className={`block w-full overflow-hidden rounded-lg border transition-all duration-150 ${
                      active
                        ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/25'
                        : 'border-[var(--border)] group-hover:border-[var(--ink-3)]'
                    }`}
                    style={{ aspectRatio: '16 / 9' }}
                  >
                    {filterThumb ? (
                      <img
                        src={filterThumb}
                        alt=""
                        className="h-full w-full object-cover"
                        style={{ filter: filtersToCSS(p.filters) }}
                        draggable={false}
                      />
                    ) : (
                      <span
                        className="block h-full w-full bg-[var(--border)]"
                        style={{ filter: filtersToCSS(p.filters) }}
                      />
                    )}
                  </span>
                  <span
                    className={`text-[0.625rem] font-semibold ${
                      active ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-2)]'
                    }`}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Manual sliders */}
          <div className="flex flex-col gap-3">
            <FilterSlider label="Brightness" value={filters.brightness} min={50}   max={150} onChange={v => setFilters(f => ({ ...f, brightness: v }))} />
            <FilterSlider label="Contrast"   value={filters.contrast}   min={50}   max={150} onChange={v => setFilters(f => ({ ...f, contrast: v }))} />
            <FilterSlider label="Saturation" value={filters.saturation} min={0}    max={200} onChange={v => setFilters(f => ({ ...f, saturation: v }))} />
            <FilterSlider label="Hue shift"  value={filters.hue}        min={-180} max={180} onChange={v => setFilters(f => ({ ...f, hue: v }))} unit="°" />
            <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)}
              className="mt-1 inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2.5 text-[0.6875rem] font-semibold text-[var(--ink-3)] transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              <RotateCcw className="h-3 w-3" strokeWidth={2} />
              Reset
            </button>
          </div>
        </Section>
      </aside>

      <FrameWheelModal
        open={wheelOpen}
        frames={FRAMES}
        onPicked={setActiveFrame}
        onClose={() => setWheelOpen(false)}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, icon: Icon, children }: {
  label: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--border)] px-5 py-4">
      <div className="mb-3 flex items-center gap-1.5 text-[var(--ink-2)]">
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[1px]">{label}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * The event date, drawn over the live feed so the preview matches the photo.
 *
 * Sized in cqh against the stage (container-type: size), which is the same
 * fraction-of-height the canvas stamp uses — so the two cannot drift. The
 * auto-shrink for a tight frame is replicated via an offscreen measuring
 * context so the preview shows the same size the capture will use.
 */
function LiveDateStamp({ frame }: { frame: FrameConfig }) {
  const stamp = frame.dateStamp;
  const [shrink, setShrink] = useState(1);

  useEffect(() => {
    if (!stamp?.maxWidthFrac) { setShrink(1); return; }
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    // Measure against the artboard, then express the result as a ratio.
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

function FilterSlider({ label, value, min, max, onChange, unit = '%' }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <span className="text-[0.6875rem] font-semibold text-[var(--ink)]">{label}</span>
        <span className="font-mono text-[0.6875rem] tabular-nums text-[var(--ink-3)]">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="dsac-range" />
    </div>
  );
}

