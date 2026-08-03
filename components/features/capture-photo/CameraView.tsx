import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  Camera,
  CameraSlash,
  DiceFive,
  Eye,
  Image as ImageIcon,
  Timer as TimerIcon,
  WifiHigh,
  WifiSlash,
} from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import FrameWheelModal from '@/components/ui/FrameWheelModal';
import { useLivePreview } from './useLivePreview';
import { useFrameCatalogue } from '@/components/features/frames/useFrameCatalogue';
import { useCaptureSettings } from '@/components/features/remote/useCaptureSettings';
import { useRemote, type RemoteCommand } from '@/components/features/remote/useRemote';
import { rememberCapture } from '@/components/features/gallery/galleryStore';
import type { FrameConfig, EventDetails } from '@/types/frame';
import {
  FRAME_ASPECT, FRAME_W as FRAME_W_PX, FRAME_H as FRAME_H_PX,
  STAMP_FONT_STACK, drawDateStamp, fitFontPx, stampFontPx, stampText, formatEventDate, resolveEventDate,
} from '@/types/frame';
import { filtersToCSS } from '@/types/editor';

type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface CameraViewProps {
  facingMode?: 'user' | 'environment';
  onCapture: (blob: Blob, dataUrl: string) => void;
  onError?: (error: Error) => void;
  /** Fired when the phone remote asks to retake, so the flow can reset. */
  onRetake?: () => void;
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

export default function CameraView({ facingMode = 'user', onCapture, onError, onRetake }: CameraViewProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const stageBoxRef   = useRef<HTMLDivElement>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

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
  // Bumped when the phone asks for a spin; the modal watches this.
  const [spinSignal, setSpinSignal] = useState(0);
  const [wheelStatus, setWheelStatus] = useState({ spinning: false, result: null as string | null });

  const displayFrame = preview !== undefined ? preview : wonFrame;
  const isPreviewing = preview !== undefined && (preview?.id ?? null) !== (wonFrame?.id ?? null);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [stageSize, setStageSize]     = useState({ w: 0, h: 0 });
  // The camera's own shape. Cameras rarely deliver the 16:10 we ask for — most
  // hand back 16:9 — and with no frame on there is nothing to justify squashing
  // the picture into the artboard's shape, so the stage follows the camera.
  const [cameraAspect, setCameraAspect] = useState(FRAME_ASPECT);

  const {
    settings: captureSettings,
    save: saveCaptureSettings,
    reload: reloadSettings,
  } = useCaptureSettings();
  const filters = captureSettings.filters;
  const timerSecs = captureSettings.timerSecs;
  const frameMode = captureSettings.frameMode;

  const [countdown, setCountdown]     = useState<number | null>(null);

  const updateCaptureSettings = useCallback((patch: Partial<typeof captureSettings>) => {
    void saveCaptureSettings({ ...captureSettings, ...patch }).catch(() => {});
  }, [captureSettings, saveCaptureSettings]);

  // Drop references to frames an operator deleted while the kiosk was open.
  useEffect(() => {
    if (wonFrame && !frames.some(f => f.id === wonFrame.id)) setWonFrame(null);
    if (preview && !frames.some(f => f.id === preview.id)) setPreview(undefined);
  }, [frames, wonFrame, preview]);

  // A fixed frame is an operator choice, not a per-guest wheel result. Resolve
  // it from persisted settings every time the booth launches or returns here.
  useEffect(() => {
    if (frameMode !== 'fixed') return;
    const selected = frames.find(f => f.id === captureSettings.selectedFrameId && f.enabled !== false) ?? null;
    setWonFrame(selected);
    setPreview(undefined);
  }, [frameMode, captureSettings.selectedFrameId, frames]);

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
        // No aspectRatio constraint. Asking for the artboard's 16:10 only ever
        // cost us: webcams are 16:9, so a browser that honours it crops away
        // field of view, and one that ignores it hands back 16:9 anyway. Take
        // the camera's native shape and let the stage adapt to it.
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
  // the frame artwork gets stretched. Fitting the target shape into the
  // available box keeps it exact on both axes.
  //
  // Which shape depends on whether a frame is on. With one, the stage is the
  // artboard and the picture is stretched into its cut-out, because the frame
  // has to line up exactly. With no frame there is nothing to line up with, so
  // the stage takes the camera's shape and the picture stays undistorted.
  const stageAspect = displayFrame ? FRAME_ASPECT : cameraAspect;

  useLayoutEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;

    const fit = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const w = Math.max(1, Math.floor(Math.min(width, height * stageAspect)));
      const h = Math.max(1, Math.floor(w / stageAspect));
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
  }, [canvasRef, stageAspect]);

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
          drawDateStamp(ctx, wonFrame, output.width, output.height, captureSettings);
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

    // Stretch to fill the cut-out exactly — matches the live preview.
    const vw = video.videoWidth  || dw;
    const vh = video.videoHeight || dh;

    ctx.save();
    ctx.filter = filtersToCSS(filters);
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, dw, dh);
    ctx.restore();

    if (wonFrame) {
      const cachedFrame = frameCache.current.get(wonFrame.src);
      if (isDrawable(cachedFrame)) {
        ctx.drawImage(cachedFrame, 0, 0, outW, outH);
        drawDateStamp(ctx, wonFrame, outW, outH, captureSettings);
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

  // ── Phone remote ─────────────────────────────────────────────────────────────
  // The organiser stands with the guests, so the phone drives the shutter.
  // Handlers are held in a ref: the SSE subscription must not be torn down and
  // rebuilt every time a dependency of doCapture changes.
  const actionsRef = useRef({ doCapture, handleCapturePress, reloadSettings });
  actionsRef.current = { doCapture, handleCapturePress, reloadSettings };

  const { connected: remoteConnected, publish: publishRemote } = useRemote({
    onCommand: useCallback((cmd: RemoteCommand) => {
      const a = actionsRef.current;
      switch (cmd.action) {
        case 'capture': a.handleCapturePress(); break;
        case 'spin':    setWheelOpen(true); break;
        case 'spin-now': setSpinSignal(n => n + 1); break;
        case 'close-wheel': setWheelOpen(false); break;
        case 'retake':  onRetake?.(); break;
        case 'cancel':
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          setCountdown(null);
          break;
        case 'settings-changed': void a.reloadSettings(); break;
      }
    }, [onRetake]),
  });

  // Mirror what the booth is doing so the phone can render it.
  useEffect(() => {
    void publishRemote({
      phase: countdown !== null ? 'counting' : 'idle',
      countdown,
      frameLabel: wonFrame?.label ?? null,
      timer: timerSecs,
      streaming: isStreaming,
      wheelOpen,
      wheelSpinning: wheelStatus.spinning,
      wheelResult: wheelStatus.result,
    });
  }, [countdown, wonFrame, timerSecs, isStreaming, wheelOpen, wheelStatus, publishRemote]);

  // ── Navigation ───────────────────────────────────────────────────────────────

  const navigate = useCallback((section: StudioSection) => {
    if (section === 'settings') { window.location.href = '/settings'; return; }
    if (section === 'gallery')  { window.location.href = '/gallery'; return; }
  }, []);

  const enabledFrames = useMemo(() => frames.filter((f) => f.enabled !== false), [frames]);

  return (
    <StudioShell active="capture" onNavigate={navigate}>
      <video ref={videoRef} data-testid="capture-video-element" autoPlay playsInline muted
        onCanPlay={() => setIsStreaming(true)}
        onLoadedMetadata={e => {
          const { videoWidth: w, videoHeight: h } = e.currentTarget;
          if (w > 0 && h > 0) setCameraAspect(w / h);
        }}
        className="hidden" />

      {/* Header */}
      <header className="flex shrink-0 items-center gap-4">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
          Say cheese<span className="text-[var(--accent)]">.</span>
        </h1>

        <div className="ml-auto flex items-center gap-2.5">
          <label className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--ink-2)]">
            <TimerIcon size={16} />
            <span className="sr-only">Countdown timer</span>
            <select
              aria-label="Countdown timer"
              value={timerSecs}
              onChange={e => updateCaptureSettings({ timerSecs: Number(e.target.value) })}
              className="bg-transparent pr-1 font-semibold text-[var(--ink)] outline-none"
            >
              <option value={0}>Off</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
            </select>
          </label>
          <span
            title={remoteConnected ? 'A phone remote is connected' : 'No phone remote connected'}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[0.8rem] font-semibold ${
              remoteConnected
                ? 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--ink-3)]'
            }`}
          >
            {remoteConnected ? <WifiHigh size={16} weight="fill" /> : <WifiSlash size={16} />}
            Remote
          </span>
        </div>
      </header>

      {/* Stage + capture rail */}
      <div data-testid="capture-camera-root" className="mt-6 flex min-h-0 flex-1 gap-5">
        {/* No background here. A 16:10 frame cannot fill a wider box without
            cropping its logos and caption, so it centres — a grey bed would
            just show pillarbox bars beside it. On the white panel the leftover
            space is invisible and the frame's own shadow gives it definition. */}
        <div ref={stageBoxRef}
          className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
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
                <LiveDateStamp frame={displayFrame} event={captureSettings} />
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

          {frameMode === 'wheel' && (
            <button
              data-testid="open-frame-wheel"
              type="button"
              onClick={() => setWheelOpen(true)}
              className="mt-7 inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] px-4 text-[0.9rem] font-semibold text-[var(--ink)] transition hover:border-[var(--ink-3)] hover:bg-[var(--shell-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <DiceFive size={19} />
              {wonFrame ? 'Spin again' : 'Spin for a frame'}
            </button>
          )}

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

      <FrameWheelModal
        open={wheelOpen}
        frames={enabledFrames}
        onPicked={(f) => { setWonFrame(f); setPreview(undefined); }}
        onClose={() => setWheelOpen(false)}
        spinSignal={spinSignal}
        onStatus={setWheelStatus}
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
 * How much to shrink the event name so it fits its width budget — the same
 * calculation `drawDateStamp` does, against the same artboard dimensions, so
 * the DOM preview and the captured photo cannot disagree.
 *
 * Measured on a throwaway canvas rather than in the DOM because that is what
 * the canvas will do at capture time, down to the font stack.
 */
function nameFitScale(name: string | undefined, sizeFrac: number, maxWidthFrac: number): number {
  if (!name) return 1;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 1;
  const nominal = Math.round(sizeFrac * FRAME_H_PX);
  if (nominal <= 0) return 1;
  return fitFontPx(ctx, name, nominal, maxWidthFrac * FRAME_W_PX) / nominal;
}

/**
 * The event date over the live feed, so the preview matches the photo.
 * Sized in cqh against the stage — the same fraction-of-height the canvas stamp
 * uses — so the two cannot drift.
 */
function LiveDateStamp({ frame, event }: { frame: FrameConfig; event: EventDetails }) {
  const stamp = frame.dateStamp;
  const slot = frame.captionSlot;
  const [shrink, setShrink] = useState(1);
  const date = resolveEventDate(event);

  useEffect(() => {
    if (!stamp?.maxWidthFrac) { setShrink(1); return; }
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    const full = Math.round(stamp.sizeFrac * FRAME_H_PX);
    const fitted = stampFontPx(ctx, frame, FRAME_W_PX, FRAME_H_PX, date);
    setShrink(full > 0 ? fitted / full : 1);
  }, [frame, stamp, date]);

  // The artwork prints only "on"; the date always goes to its right. The name
  // goes either on its own centred line above or inline to the left, whichever
  // the artwork was designed for.
  if (slot) {
    const name = event.eventName?.trim();
    const above = slot.nameAbove;
    const common: React.CSSProperties = {
      top: `${slot.baselineFrac * 100}%`,
      fontFamily: STAMP_FONT_STACK,
      fontSize: `${slot.sizeFrac * 100}cqh`,
      color: slot.colour,
      lineHeight: 1,
    };

    // A name that overruns its budget is shrunk to fit, exactly as the canvas
    // does. Clipping it with overflow:hidden was wrong twice over: the preview
    // showed a truncated name, and the photo it was previewing showed a
    // complete but smaller one.
    const nameSizeFrac = above?.sizeFrac ?? slot.sizeFrac;
    const nameScale = nameFitScale(
      name, nameSizeFrac, (above?.maxWidthFrac ?? slot.maxNameWidthFrac),
    );

    return (
      <>
        {name && (
          <span
            aria-hidden
            className="pointer-events-none absolute z-20 whitespace-nowrap"
            style={above ? {
              ...common,
              top: `${above.baselineFrac * 100}%`,
              fontSize: `${nameSizeFrac * nameScale * 100}cqh`,
              left: `${above.centreFrac * 100}%`,
              transform: 'translate(-50%, -100%)',
            } : {
              ...common,
              fontSize: `${nameSizeFrac * nameScale * 100}cqh`,
              right: `${(1 - slot.nameRightFrac + slot.gapFrac) * 100}%`,
              transform: 'translateY(-100%)',
            }}
          >
            {name}
          </span>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute z-20 whitespace-nowrap"
          style={{
            ...common,
            left: `${(slot.dateLeftFrac + slot.gapFrac) * 100}%`,
            transform: 'translateY(-100%)',
          }}
        >
          {formatEventDate(date)}
        </span>
      </>
    );
  }

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
      {stampText(frame, date)}
    </span>
  );
}
