import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowClockwise,
  Camera,
  CameraSlash,
  Timer as TimerIcon,
  WifiHigh,
  WifiSlash,
} from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import { useLivePreview, drawPhoto } from './useLivePreview';
import { cameraConstraints, raiseToMaxResolution } from './cameras';
import { useFrameCatalogue } from '@/components/features/frames/useFrameCatalogue';
import { useCaptureSettings, unmirrorCrop } from '@/components/features/remote/useCaptureSettings';
import { useRemote, type RemoteCommand } from '@/components/features/remote/useRemote';
import type { FrameConfig, EventDetails } from '@/types/frame';
import {
  FRAME_ASPECT, FRAME_W as FRAME_W_PX, FRAME_H as FRAME_H_PX,
  NAME_WEIGHT, STAMP_FONT_STACK, drawDateStamp, fitFontPx, stampFontPx, stampText, formatEventDate,
} from '@/types/frame';

type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface CameraViewProps {
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

/**
 * Widest photo we will write.
 *
 * Uncapping the camera means an 8K webcam would otherwise ask for a ~9100px
 * artboard — past what some canvas implementations will allocate, and slow to
 * JPEG-encode while a guest waits at the booth. No camera on a booth laptop
 * gets near this, so in practice it is a backstop, not a limit.
 */
const MAX_OUTPUT_W = 8192;

/** True once an <img> holds decoded pixels we can safely draw. */
function isDrawable(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

export default function CameraView({ onCapture, onError, onRetake }: CameraViewProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const stageBoxRef   = useRef<HTMLDivElement>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const [permission, setPermission]     = useState<PermissionStatus>('prompt');
  const [isStreaming, setIsStreaming]   = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { frames } = useFrameCatalogue();

  // The operator's choice, and the only frame there is. What you see on the
  // stage is exactly what gets baked into the photo.
  const [activeFrame, setActiveFrame] = useState<FrameConfig | null>(null);
  const displayFrame = activeFrame;
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
  const cameraDeviceId = captureSettings.cameraDeviceId;
  const lookRamp = captureSettings.lookRamp;
  const timerSecs = captureSettings.timerSecs;
  // The region of the camera actually used, flipped back into the camera's own
  // coordinates: it was drawn on a mirrored preview. Null means all of it.
  const crop = captureSettings.cropEnabled ? unmirrorCrop(captureSettings.crop) : null;

  const [countdown, setCountdown]     = useState<number | null>(null);

  const updateCaptureSettings = useCallback((patch: Partial<typeof captureSettings>) => {
    void saveCaptureSettings({ ...captureSettings, ...patch }).catch(() => {});
  }, [captureSettings, saveCaptureSettings]);

  // The frame is chosen in Settings, so this screen mirrors that choice rather
  // than holding one of its own. Resolving it every time also covers a frame
  // being deleted or switched off mid-event: it simply stops resolving.
  useEffect(() => {
    setActiveFrame(
      frames.find(f => f.id === captureSettings.selectedFrameId && f.enabled !== false) ?? null,
    );
  }, [captureSettings.selectedFrameId, frames]);

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
        video: cameraConstraints(cameraDeviceId),
        audio: false,
      });
      // `ideal` only asks the browser to land *near* the target, and cameras
      // under-report what they can do — so walk a ladder of real modes and
      // keep the largest one that is actually accepted. This is what gets 4K
      // out of a webcam that advertises 1080p.
      await raiseToMaxResolution(stream);

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
  }, [cameraDeviceId, onError]);

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
    lookRamp,
    contentRect: displayFrame?.window ?? null,
    sourceRect: crop,
  });

  // Size the stage in JS rather than with aspect-ratio + max-height. Those two
  // fight: whichever axis is binding wins and the other is left over-long, so
  // the frame artwork gets stretched. Fitting the target shape into the
  // available box keeps it exact on both axes.
  //
  // Which shape depends on whether a frame is on. With one the stage is the
  // artboard, because the artwork has to line up exactly; with none it takes
  // the camera's own shape. Either way the picture itself is only ever scaled,
  // never reshaped.
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
        // The bitmap is the display size in *device* pixels, while CSS keeps
        // it at the display size — otherwise a retina stage upscales a
        // half-resolution preview and the feed looks soft next to the crisp
        // frame PNG over it. Capped at 2: past that the rAF loop is pushing
        // several times the pixels for a difference nobody can see.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvasRef.current.width = Math.round(w * dpr);
        canvasRef.current.height = Math.round(h * dpr);
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

    // Always redraw from the raw <video>, never by copying the preview canvas.
    // The preview is sized to the stage in screen pixels — perhaps 900 wide —
    // so copying it threw away most of a 1080p camera and handed the guest a
    // photo the size of the window they were standing in front of.
    //
    // With no frame there is nothing to line up against, so the cropped
    // region is written at its own native size: a straight 1:1 read of the
    // sensor, no resampling at all.
    //
    // With a frame the artboard is grown until its photo window lands on that
    // same 1:1 read, rather than the picture being squeezed into a fixed
    // 1921x1201 sheet — on that sheet the window is only 1614px wide, so a
    // 1080p camera lost a sixth of its width and a 4K one most of itself. The
    // frame PNG is interpolated up instead, which flat vector artwork survives
    // far better than a photograph survives being shrunk.
    const vw = video.videoWidth  || FRAME_W_PX;
    const vh = video.videoHeight || FRAME_H_PX;
    const srcW = Math.max(1, Math.round((crop?.w ?? 1) * vw));
    const srcH = Math.max(1, Math.round((crop?.h ?? 1) * vh));

    let outW = srcW;
    let outH = srcH;
    if (activeFrame) {
      const win = activeFrame.window;
      // Never below the artboard's own size: a hard zoom samples few pixels,
      // and rendering the artwork smaller than it was drawn would cost more
      // than the photo gains.
      const wanted = win ? Math.round(srcW / win.w) : srcW;
      outW = Math.min(MAX_OUTPUT_W, Math.max(FRAME_W_PX, wanted));
      outH = Math.round(outW / FRAME_ASPECT);
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // The same routine the preview loop runs, at a different size. That is the
    // whole guarantee: crop, mirror, filters and ramp cannot disagree
    // between what the guest saw and what they get.
    drawPhoto(ctx, video, {
      w: outW,
      h: outH,
      filters,
      lookRamp,
      contentRect: activeFrame?.window ?? null,
      sourceRect: crop,
    });

    if (activeFrame) {
      const cachedFrame = frameCache.current.get(activeFrame.src);
      if (isDrawable(cachedFrame)) {
        ctx.drawImage(cachedFrame, 0, 0, outW, outH);
        drawDateStamp(ctx, activeFrame, outW, outH, captureSettings);
      } else {
        console.warn('[DSAC] Frame not ready; capturing without it:', activeFrame.src);
      }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = await canvasToBlob(canvas);
    onCapture(blob, dataUrl);
  }, [isStreaming, filters, lookRamp, activeFrame, crop, captureSettings, onCapture]);

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
      frameLabel: activeFrame?.label ?? null,
      timer: timerSecs,
      streaming: isStreaming,
    });
  }, [countdown, activeFrame, timerSecs, isStreaming, publishRemote]);

  // ── Navigation ───────────────────────────────────────────────────────────────

  const navigate = useCallback((section: StudioSection) => {
    if (section === 'settings') { window.location.href = '/settings'; return; }
    if (section === 'gallery')  { window.location.href = '/gallery'; return; }
  }, []);


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
          className="flex w-[180px] shrink-0 flex-col self-center rounded-[20px] border border-[var(--border)] px-5 py-6">
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

          {/* The frame is chosen in Settings, not here. A guest is standing in
              front of this screen, so it carries the shutter and nothing else
              they could press by mistake. */}
          <p className="mt-5 text-center text-[0.72rem] text-[var(--ink-3)]">
            {activeFrame
              ? <>Frame: <strong className="font-semibold text-[var(--ink)]">{activeFrame.label}</strong></>
              : 'No frame'}
          </p>
        </aside>
      </div>

    </StudioShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
  return fitFontPx(ctx, name, nominal, maxWidthFrac * FRAME_W_PX, NAME_WEIGHT) / nominal;
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
  const date = new Date();

  useEffect(() => {
    if (!stamp?.maxWidthFrac) { setShrink(1); return; }
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    const full = Math.round(stamp.sizeFrac * FRAME_H_PX);
    const fitted = stampFontPx(ctx, frame, FRAME_W_PX, FRAME_H_PX, date);
    setShrink(full > 0 ? fitted / full : 1);
  }, [frame, stamp, date]);

  // Built-ins use a centred two-line caption; uploaded frames can still use
  // the compact inline layout.
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

    // Ink Free ships no bold face, so `font-weight: bold` is only a synthesised
    // one and still reads thin on the print. An outline in the caption's own
    // colour thickens every stroke. 1/24 em is the same ratio the canvas uses
    // for its lineWidth, so the preview and the photo weigh the same.
    const nameStroke = { WebkitTextStroke: `0.0417em ${slot.colour}` } as React.CSSProperties;

    return (
      <>
        {name && (
          <span
            aria-hidden
            className="pointer-events-none absolute z-20 whitespace-nowrap"
            style={above ? {
              ...common,
              ...nameStroke,
              top: `${above.baselineFrac * 100}%`,
              fontSize: `${nameSizeFrac * nameScale * 100}cqh`,
              fontWeight: NAME_WEIGHT,
              left: `${above.centreFrac * 100}%`,
              transform: 'translate(-50%, -100%)',
            } : {
              ...common,
              ...nameStroke,
              fontSize: `${nameSizeFrac * nameScale * 100}cqh`,
              fontWeight: NAME_WEIGHT,
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
            transform: slot.dateAlign === 'center' ? 'translate(-50%, -100%)' : 'translateY(-100%)',
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
