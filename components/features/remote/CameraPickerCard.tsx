import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, Camera, CheckCircle } from '@phosphor-icons/react';
import type { CaptureSettingsControl } from './CaptureSettingsCard';
import { listCameras, type CameraOption } from '@/components/features/capture-photo/cameras';

/**
 * Which camera the booth shoots with.
 *
 * A booth laptop usually has more than one, and the browser's default is the
 * built-in lens — so an event that brought a good webcam was shooting on the
 * laptop's anyway, at a fraction of the resolution. The resolution beside each
 * name is what that device tops out at, which is the number that decides how
 * much of the photo is real detail.
 *
 * Probing opens every camera in turn, so it runs on demand rather than on
 * mount: three capture lights blinking whenever Settings opens would look like
 * a fault.
 */
export default function CameraPickerCard({ settings, push }: CaptureSettingsControl) {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setCameras(await listCameras());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list the cameras');
    } finally {
      setBusy(false);
    }
  }, []);

  // Names alone are cheap once permission exists, so the list is populated
  // straight away; resolutions arrive when the operator asks for them.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      setCameras(devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })));
    }).catch(() => { /* the scan button is the fallback */ });
  }, []);

  const chosen = settings.cameraDeviceId;

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="flex items-center gap-2 text-[0.92rem] font-semibold text-[var(--ink)]">
          <Camera size={16} /> Camera
        </p>
        <button
          type="button" onClick={() => void scan()} disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-[0.72rem] font-semibold text-[var(--ink-3)] transition hover:text-[var(--accent)] disabled:opacity-50"
        >
          <ArrowClockwise size={13} />
          {busy ? 'Checking…' : 'Check resolutions'}
        </button>
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        The booth uses whichever camera is picked here. Bigger is better — the
        photo keeps every pixel the camera gives it. On a Mac every USB webcam
        stops at 1080p whatever it is capable of, which is a macOS limit rather
        than this camera&rsquo;s; the same one reaches 4K on Windows.
      </p>

      {error && (
        <p className="mt-3 text-[0.75rem] font-medium text-[var(--accent-ink)]">{error}</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <CameraRow
          label="Browser default"
          detail="Usually the built-in camera"
          active={!chosen}
          onClick={() => push({ ...settings, cameraDeviceId: '' })}
        />
        {cameras.map((cam, i) => (
          <CameraRow
            key={cam.deviceId || i}
            label={cam.label}
            detail={cam.maxWidth
              ? `Up to ${cam.maxWidth} × ${cam.maxHeight}`
              : 'Resolution unknown — press Check'}
            // A deviceId is only handed out once camera permission exists;
            // before that it is an empty string, which would otherwise match
            // the "browser default" sentinel and tick every row at once.
            active={Boolean(cam.deviceId) && chosen === cam.deviceId}
            disabled={!cam.deviceId}
            onClick={() => push({ ...settings, cameraDeviceId: cam.deviceId })}
          />
        ))}
      </div>

      {cameras.length === 0 && (
        <p className="mt-3 rounded-lg bg-[var(--shell-bg)] px-3.5 py-3 text-[0.75rem] leading-[1.6] text-[var(--ink-2)]">
          No cameras listed yet. Open the capture screen once and allow camera
          access — names stay hidden until then.
        </p>
      )}
    </section>
  );
}

function CameraRow({ label, detail, active, disabled = false, onClick }: {
  label: string; detail: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active} disabled={disabled}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]'
          : 'border-[var(--border)] bg-white hover:border-[var(--ink-3)]'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[0.85rem] font-semibold ${
          active ? 'text-[var(--accent)]' : 'text-[var(--ink)]'
        }`}>
          {label}
        </span>
        <span className="mt-0.5 block text-[0.72rem] text-[var(--ink-3)]">{detail}</span>
      </span>
      {active && <CheckCircle size={18} weight="fill" className="shrink-0 text-[var(--accent)]" />}
    </button>
  );
}
