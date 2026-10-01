import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';
import type { CaptureSettingsControl } from '@/components/features/remote/CaptureSettingsCard';
import { cameraConstraints, raiseToMaxResolution } from '@/components/features/capture-photo/cameras';
import { useLivePreview } from '@/components/features/capture-photo/useLivePreview';
import { CLEAN_PLATE_URL, useScene } from '@/components/features/capture-photo/scene/useScene';
import { plateKeyColour } from '@/components/features/capture-photo/scene/chromaKey';
import { unmirrorCrop } from '@/components/features/remote/useCaptureSettings';
import { BACKGROUNDS, type BgRemoval, type ChromaKeySettings } from '@/types/scene';

/**
 * How the booth takes the room away from behind the guests, with a live
 * preview to tune it against. The preview runs the very code the capture
 * screen runs, so what looks right here is what guests get.
 */

const MODES: { value: BgRemoval; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: 'The photo is the camera, as it is.' },
  { value: 'key', label: 'Green screen', help: 'Keys out a green or blue screen behind the guests.' },
  {
    value: 'segment', label: 'No green screen',
    help: 'A model finds the people. Softer edges; best with a plain wall and guests near the camera.',
  },
];

/** The empty screen is a reference, not a photo: a laptop screen's worth is plenty. */
const PLATE_MAX_WIDTH = 1280;

export default function SceneSettingsCard({ settings, push, saved, loading }: CaptureSettingsControl) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [previewBg, setPreviewBg] = useState(BACKGROUNDS[0].id);
  const [plateBusy, setPlateBusy] = useState(false);
  const [plateNote, setPlateNote] = useState<string | null>(null);
  // Whether an OpenRouter key is saved, which typed backgrounds need.
  const [keySet, setKeySet] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/backgrounds/status')
      .then(r => (r.ok ? r.json() as Promise<{ configured?: boolean }> : null))
      .then(s => { if (live) setKeySet(Boolean(s?.configured)); })
      .catch(() => { if (live) setKeySet(false); });
    return () => { live = false; };
  }, []);

  const mode = settings.bgRemoval;
  const key = settings.chromaKey;

  const { sceneFrame, status } = useScene({
    bgRemoval: mode,
    chromaKey: key,
    edgeCleanup: false, // the clean-up pass only runs at the shutter
    cleanPlateAt: settings.cleanPlateAt,
    choice: { backgroundId: previewBg, avatarId: '' },
  });

  const { canvasRef } = useLivePreview(videoRef, {
    filters: settings.filters,
    lookRamp: settings.lookRamp,
    sourceRect: settings.cropEnabled ? unmirrorCrop(settings.crop) : null,
    rotationDeg: settings.rotationDeg,
    sceneFrame,
  });

  // The camera the booth uses, opened only while there is something to tune.
  // Waits for the saved settings, for the reason CameraCropCard gives.
  useEffect(() => {
    if (loading || mode === 'off') return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({
      video: cameraConstraints(settings.cameraDeviceId),
      audio: false,
    }).then(async (s) => {
      await raiseToMaxResolution(s);
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      const video = videoRef.current;
      if (video) {
        video.srcObject = s;
        void video.play().catch(() => {});
      }
      setCamError(null);
    }).catch((e: Error) => setCamError(e.message));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [loading, mode, settings.cameraDeviceId]);

  const setKey = useCallback((patch: Partial<ChromaKeySettings>) => {
    push({ ...settings, chromaKey: { ...settings.chromaKey, ...patch } });
  }, [push, settings]);

  /** Grab the empty screen from the camera, as it is right now. */
  const capturePlate = useCallback(async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    setPlateBusy(true);
    setPlateNote(null);
    try {
      const scale = Math.min(1, PLATE_MAX_WIDTH / video.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(video.videoWidth * scale);
      c.height = Math.round(video.videoHeight * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, c.width, c.height);
      const colour = plateKeyColour(ctx.getImageData(0, 0, c.width, c.height).data);

      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Could not read the camera.');
      const body = new FormData();
      body.append('file', blob, 'clean-plate.png');
      const res = await fetch(CLEAN_PLATE_URL, { method: 'PUT', body });
      const data = await res.json() as { settings?: { cleanPlateAt: string }; error?: string };
      if (!res.ok || !data.settings) throw new Error(data.error ?? `HTTP ${res.status}`);

      push({
        ...settings,
        cleanPlateAt: data.settings.cleanPlateAt,
        // The screen's real colour, read off the plate, beats a guess.
        chromaKey: colour ? { ...settings.chromaKey, colour } : settings.chromaKey,
      });
      setPlateNote(colour
        ? 'Captured. The key colour was set from it.'
        : 'Captured, but it does not look like a green screen — is the camera pointed at it?');
    } catch (err) {
      setPlateNote(err instanceof Error ? err.message : 'Could not capture the empty screen.');
    } finally {
      setPlateBusy(false);
    }
  }, [push, settings]);

  const clearPlate = useCallback(async () => {
    setPlateBusy(true);
    try {
      const res = await fetch(CLEAN_PLATE_URL, { method: 'DELETE' });
      if (res.ok) push({ ...settings, cleanPlateAt: '' });
      setPlateNote(null);
    } finally {
      setPlateBusy(false);
    }
  }, [push, settings]);

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Background removal</p>
        <span className={`ml-auto text-[0.72rem] font-semibold transition-opacity duration-200 ${
          saved ? 'text-[#127a4a] opacity-100' : 'opacity-0'
        }`}>Saved</span>
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Takes the room away from behind the guests, who then pick a background on
        the capture screen. Applies to the booth immediately.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Background removal">
        {MODES.map(m => (
          <button key={m.value} type="button" role="radio" aria-checked={mode === m.value}
            disabled={loading}
            onClick={() => push({ ...settings, bgRemoval: m.value })}
            className={`min-h-11 rounded-xl border px-3 text-[0.8rem] font-semibold transition ${
              mode === m.value
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--ink-2)] hover:border-[var(--ink-3)]'
            }`}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
        {MODES.find(m => m.value === mode)?.help}
      </p>

      {mode !== 'off' && (
        <>
          <div className="relative mt-5 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--shell-bg)]">
            <video ref={videoRef} playsInline muted autoPlay className="hidden" />
            <canvas ref={canvasRef} width={960} height={540} className="block aspect-video w-full" />
            {(camError || status.removal === 'loading' || status.removal === 'failed') && (
              <p className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-[0.72rem] text-white">
                {camError
                  ? `Camera: ${camError}`
                  : status.removal === 'loading'
                    ? 'Loading the model…'
                    : 'This laptop cannot run background removal.'}
              </p>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[0.72rem] text-[var(--ink-3)]">Preview over</span>
            {BACKGROUNDS.map(bg => (
              <button key={bg.id} type="button" onClick={() => setPreviewBg(bg.id)}
                aria-pressed={previewBg === bg.id}
                className={`rounded-lg border px-2 py-1 text-[0.7rem] font-semibold ${
                  previewBg === bg.id ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--ink-3)]'
                }`}>
                {bg.label}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'key' && (
        <div className="mt-6 flex flex-col gap-5">
          <div>
            <p className="text-[0.78rem] font-semibold text-[var(--ink-2)]">Empty screen</p>
            <p className="mt-1 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
              With nobody in front of the screen, capture it once. Each pixel is
              then compared with the same spot on the empty screen, so shadows and
              uneven light key cleanly. Capture again if the camera, its crop or
              the lighting moves.
            </p>
            <div className="mt-3 flex items-center gap-2.5">
              <Button size="sm" onClick={() => void capturePlate()} disabled={plateBusy || Boolean(camError)}>
                <Camera size={15} /> {settings.cleanPlateAt ? 'Capture again' : 'Capture empty screen'}
              </Button>
              {settings.cleanPlateAt && (
                <Button size="sm" variant="ghost" onClick={() => void clearPlate()} disabled={plateBusy}>
                  <Trash size={15} /> Remove
                </Button>
              )}
            </div>
            <p className="mt-2 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
              {plateNote ?? (settings.cleanPlateAt
                ? `Captured ${new Date(settings.cleanPlateAt).toLocaleString()}.`
                : 'Not captured: keying against the colour below alone.')}
            </p>
          </div>

          <label className="flex items-center gap-3 text-[0.78rem] font-semibold text-[var(--ink-2)]">
            Screen colour
            <input type="color" value={key.colour}
              onChange={e => setKey({ colour: e.target.value })}
              className="h-9 w-14 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent" />
            <span className="font-mono text-[0.72rem] font-normal text-[var(--ink-3)]">{key.colour}</span>
          </label>

          <Slider label="Tolerance" value={key.tolerance} min={0} max={0.9} step={0.01}
            help="Raise it if green or shadows are left behind; lower it if it eats into people."
            onChange={v => setKey({ tolerance: v })} />
          <Slider label="Edge softness" value={key.softness} min={0.02} max={0.6} step={0.01}
            help="Wider is a softer edge around hair; narrower is a crisper cut."
            onChange={v => setKey({ softness: v })} />
          <Slider label="Remove green cast" value={key.spill} min={0} max={1} step={0.01}
            help="Takes back the green the screen reflects onto skin and hair."
            onChange={v => setKey({ spill: v })} />
        </div>
      )}

      {mode !== 'off' && (
        <label className="mt-6 flex items-start gap-3">
          <input type="checkbox" checked={settings.promptBackgrounds}
            onChange={e => push({ ...settings, promptBackgrounds: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span>
            <span className="block text-[0.8rem] font-semibold text-[var(--ink)]">Let guests type a background</span>
            <span className="mt-1 block text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
              A guest types a place and an image model draws it, through OpenRouter:
              about US$0.10 a background, three tries per guest, and the same words
              are only paid for once.{' '}
              {keySet === false && (
                <strong className="font-semibold text-[var(--accent-ink)]">
                  Needs an OpenRouter API key on the Environment tab; until then guests
                  only see the ready-made backgrounds.
                </strong>
              )}
            </span>
          </span>
        </label>
      )}

      {mode === 'segment' && (
        <label className="mt-6 flex items-start gap-3">
          <input type="checkbox" checked={settings.edgeCleanup}
            onChange={e => push({ ...settings, edgeCleanup: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span>
            <span className="block text-[0.8rem] font-semibold text-[var(--ink)]">Edge clean-up pass</span>
            <span className="mt-1 block text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
              Re-cuts the people in each photo with a matting model, for cleaner
              hair and edges than the live preview shows. Adds about a second per
              photo on a slow laptop. Turn it on if edges look jagged.
            </span>
          </span>
        </label>
      )}
    </section>
  );
}

function Slider({ label, value, min, max, step, help, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  help: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[0.78rem] font-semibold text-[var(--ink-2)]">
        {label}
        <span className="font-mono text-[0.72rem] font-normal text-[var(--ink-3)]">{value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]" />
      <span className="mt-1 block text-[0.72rem] leading-[1.5] text-[var(--ink-3)]">{help}</span>
    </label>
  );
}
