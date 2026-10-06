import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';
import type { CaptureSettingsControl } from '@/components/features/remote/CaptureSettingsCard';
import { cameraConstraints, raiseToMaxResolution } from '@/components/features/capture-photo/cameras';
import { useLivePreview } from '@/components/features/capture-photo/useLivePreview';
import { CLEAN_PLATE_URL, useScene } from '@/components/features/capture-photo/scene/useScene';
import { plateKeyColour } from '@/components/features/capture-photo/scene/chromaKey';
import { readSpeeds } from '@/components/features/capture-photo/scene/speed';
import { readFaces } from '@/components/features/capture-photo/scene/frameRate';
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
    // Who counts as the group, as on the capture screen, so the distance line
    // can be measured and tuned against this preview.
    region: settings.cropEnabled ? unmirrorCrop(settings.crop) : null,
    focusFront: settings.focusFront,
    frontLineM: settings.frontLineM,
    trackFaces: settings.focusFront,
    showTracking: settings.showFaceBoxes,
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
          <SpeedReadout />
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

      <label className="mt-6 flex items-start gap-3">
        <input type="checkbox" checked={settings.focusFront}
          onChange={e => push({ ...settings, focusFront: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        <span>
          <span className="block text-[0.8rem] font-semibold text-[var(--ink)]">Only the people at the front</span>
          <span className="mt-1 block text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
            Everyone nearer the camera than the distance line below — however
            many — gets avatars and, with no green screen, is kept in front of the
            background. People further back, like a queue, are left out. Distance
            is judged by how big faces are, so guests should face the camera.
            Someone overlapping a guest in the picture stays; a green screen
            avoids that.
          </span>
        </span>
      </label>

      {settings.focusFront && (
        <DistanceLine value={settings.frontLineM} canMeasure={mode !== 'off'}
          onChange={v => push({ ...settings, frontLineM: v })} />
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

      <label className="mt-6 flex items-start gap-3">
        <input type="checkbox" checked={settings.showFps}
          onChange={e => push({ ...settings, showFps: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        <span>
          <span className="block text-[0.8rem] font-semibold text-[var(--ink)]">Show the frame rate</span>
          <span className="mt-1 block text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
            A readout beside the stage on the capture screen: frames a second the
            preview draws, new pictures from the camera, with no green screen how
            often the cut-out keeps up, and the faces found. Guests see it too, so
            turn it off before the doors open.
          </span>
        </span>
      </label>

      <label className="mt-6 flex items-start gap-3">
        <input type="checkbox" checked={settings.showFaceBoxes}
          onChange={e => push({ ...settings, showFaceBoxes: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        <span>
          <span className="block text-[0.8rem] font-semibold text-[var(--ink)]">Show face boxes (debug)</span>
          <span className="mt-1 block text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
            A box round every face the tracker finds, on the previews only, never
            in a photo: green is in the photo, amber is beyond the distance line,
            red dashed was found and then set aside, with why. Someone with no box
            was never found. Guests see it too, so turn it off before the doors
            open.
          </span>
        </span>
      </label>
    </section>
  );
}

/**
 * How long the work takes on this laptop, read off the live preview above and
 * the last photo taken on the capture screen. The point is to judge a slow
 * laptop on the day, not to benchmark.
 */
function SpeedReadout() {
  const [speeds, setSpeeds] = useState(readSpeeds);
  useEffect(() => {
    const id = setInterval(() => setSpeeds(readSpeeds()), 1000);
    return () => clearInterval(id);
  }, []);

  const rows: [string, string][] = [];
  if (speeds.segment !== undefined) {
    const perSecond = Math.max(1, Math.round(1000 / Math.max(33, speeds.segment * 1.5)));
    rows.push(['Cut-out, live', `${speeds.segment} ms each, about ${perSecond} a second`]);
  }
  if (speeds.faces !== undefined) rows.push(['Face tracking, live', `${speeds.faces} ms each`]);
  if (speeds.shutter !== undefined) rows.push(['Last photo, shutter to finished', `${(speeds.shutter / 1000).toFixed(1)} s`]);
  if (speeds.cleanup !== undefined) rows.push(['…of which edge clean-up', `${(speeds.cleanup / 1000).toFixed(1)} s`]);
  if (!rows.length) return null;

  // At 150ms a cut-out the mask moves a few times a second and visibly trails
  // a guest who moves; that is the point to suggest the green screen.
  const slow = (speeds.segment ?? 0) > 150;
  return (
    <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] px-3.5 py-2.5">
      <p className="text-[0.72rem] font-semibold text-[var(--ink-2)]">Speed on this laptop</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[0.72rem] text-[var(--ink-3)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt>{k}</dt><dd className="font-mono">{v}</dd></div>
        ))}
      </dl>
      {slow && (
        <p className="mt-1.5 text-[0.72rem] font-medium text-[var(--accent-ink)]">
          Slow for live cut-outs: the edges will trail guests who move. A green
          screen is much lighter work.
        </p>
      )}
    </div>
  );
}

/** Seconds between pressing Measure and the measurement: time to walk to the line. */
const MEASURE_DELAY_S = 5;
const MIN_LINE_M = 0.5;
const MAX_LINE_M = 5;

/**
 * Where "the front" ends. Set at the venue by standing at the far edge of
 * where guests should be and letting the preview above measure the nearest
 * face. The metres are a rough guess from face size, but a line measured this
 * way is exactly where the person stood, because it is checked with the same
 * guess. The slider nudges it after.
 */
function DistanceLine({ value, canMeasure, onChange }: {
  value: number;
  /** Whether the preview above is running, so there is a face to measure. */
  canMeasure: boolean;
  onChange: (metres: number) => void;
}) {
  const [nearest, setNearest] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The latest, for a measurement that lands seconds after the click: the
  // settings it was made with may have changed meanwhile.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    const id = setInterval(() => setNearest(readFaces()?.nearestM ?? null), 300);
    return () => {
      clearInterval(id);
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const measure = () => {
    if (timer.current) clearInterval(timer.current);
    setNote(null);
    let left = MEASURE_DELAY_S;
    setCountdown(left);
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) { setCountdown(left); return; }
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setCountdown(null);
      const m = readFaces()?.nearestM ?? null;
      if (m === null) {
        setNote('No face found. Stand at the line facing the camera, and try again.');
        return;
      }
      // A little past where they stood, so the person who stood there is inside it.
      const line = Math.round(Math.min(MAX_LINE_M, Math.max(MIN_LINE_M, m * 1.1)) * 10) / 10;
      onChangeRef.current(line);
      setNote(`Set to about ${line.toFixed(1)} m.`);
    }, 1000);
  };

  return (
    <div className="mt-4 flex flex-col gap-3 pl-7">
      <Slider label="Distance line" value={value} min={MIN_LINE_M} max={MAX_LINE_M} step={0.1}
        format={v => `about ${v.toFixed(1)} m`}
        help="Anyone nearer the camera than this is in the photo; anyone further back is left out. The metres are approximate, so measure it rather than guess."
        onChange={onChange} />
      {canMeasure ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="secondary" onClick={measure} disabled={countdown !== null}>
            {countdown !== null ? `Measuring in ${countdown}…` : 'Measure from where I stand'}
          </Button>
          <span className="font-mono text-[0.72rem] text-[var(--ink-3)]">
            {nearest === null ? 'No face in view' : `Nearest face: about ${nearest.toFixed(1)} m`}
          </span>
        </div>
      ) : (
        <p className="text-[0.72rem] text-[var(--ink-3)]">
          Turn background removal on to measure the line against the camera.
        </p>
      )}
      <p className="text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
        {note ?? `Press Measure, walk to the far edge of where guests should stand, and face the camera. It measures after ${MEASURE_DELAY_S} seconds.`}
      </p>
    </div>
  );
}

function Slider({ label, value, min, max, step, help, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  help: string; format?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[0.78rem] font-semibold text-[var(--ink-2)]">
        {label}
        <span className="font-mono text-[0.72rem] font-normal text-[var(--ink-3)]">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]" />
      <span className="mt-1 block text-[0.72rem] leading-[1.5] text-[var(--ink-3)]">{help}</span>
    </label>
  );
}
