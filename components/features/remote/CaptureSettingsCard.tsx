import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, CircleHalf, Drop, Palette, Sun, Timer as TimerIcon } from '@phosphor-icons/react';
import { useCaptureSettings, type CaptureSettings } from './useCaptureSettings';
import { DEFAULT_FILTERS, FILTER_PRESETS, filtersToCSS } from '@/types/editor';
import type { ImageFilters } from '@/types/editor';

const TIMER_OPTIONS = [0, 3, 5, 10] as const;

/**
 * Timer and image adjustments, moved off the booth screen so the guest only
 * ever sees a camera and a wheel.
 *
 * Saving is debounced rather than manual: an operator dragging a slider expects
 * the kiosk to follow, not to hunt for a Save button afterwards.
 */
export default function CaptureSettingsCard() {
  const { settings, setSettings, save, loading } = useCaptureSettings();
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((next: CaptureSettings) => {
    setSettings(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save(next).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
      }).catch(() => { /* surfaced by the page-level error banner */ });
    }, 350);
  }, [save, setSettings]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const setFilters = (fn: (f: ImageFilters) => ImageFilters) =>
    push({ ...settings, filters: fn(settings.filters) });

  const f = settings.filters;

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-5 py-4">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Camera</p>
        <span className={`ml-auto text-[0.72rem] font-semibold transition-opacity duration-200 ${
          saved ? 'text-[#127a4a] opacity-100' : 'opacity-0'
        }`}>
          Saved
        </span>
      </div>
      <p className="mt-1 text-[0.75rem] leading-[1.5] text-[var(--ink-3)]">
        Applies to the booth immediately. Guests never see these controls.
      </p>

      {/* Event details */}
      <div className="mt-4 flex flex-col gap-2.5">
        <label className="text-[0.78rem] font-semibold text-[var(--ink-2)]">
          Event name
          <input
            type="text" value={settings.eventName} maxLength={60}
            onChange={e => push({ ...settings, eventName: e.target.value })}
            placeholder="Transformation Made Possible"
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="text-[0.78rem] font-semibold text-[var(--ink-2)]">
          Event date
          <input
            type="date" value={settings.eventDate}
            onChange={e => push({ ...settings, eventDate: e.target.value })}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
          <span className="mt-1 block text-[0.7rem] font-normal text-[var(--ink-3)]">
            {settings.eventDate ? 'Stamped on every photo.' : "Empty — today's date is used."}
          </span>
        </label>
        <p className="rounded-lg bg-[var(--shell-bg)] px-3 py-2 text-[0.7rem] leading-[1.5] text-[var(--ink-2)]">
          The two built-in frames have their caption printed into the artwork, so
          only the date changes on those. The event name appears on uploaded
          frames, and on any artboard supplied without a caption.
        </p>
      </div>

      {/* Timer */}
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
          <TimerIcon size={15} /> Countdown
        </p>
        <div className="flex gap-2">
          {TIMER_OPTIONS.map(s => (
            <button
              key={s} type="button" disabled={loading}
              onClick={() => push({ ...settings, timerSecs: s })}
              className={`min-h-10 flex-1 rounded-xl text-[0.82rem] font-semibold transition ${
                settings.timerSecs === s
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'
              }`}
            >
              {s === 0 ? 'Off' : `${s}s`}
            </button>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="mt-5">
        <p className="mb-2 text-[0.78rem] font-semibold text-[var(--ink-2)]">Look</p>
        <div className="grid grid-cols-4 gap-1.5">
          {FILTER_PRESETS.map(p => {
            const on = f.brightness === p.filters.brightness && f.contrast === p.filters.contrast
              && f.saturation === p.filters.saturation && f.hue === p.filters.hue;
            return (
              <button
                key={p.label} type="button"
                onClick={() => push({ ...settings, filters: p.filters })}
                className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[0.68rem] font-semibold transition ${
                  on ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                     : 'text-[var(--ink-2)] hover:bg-[var(--shell-bg)]'
                }`}
              >
                <span className="h-6 w-full rounded"
                  style={{ background: '#b9bcc4', filter: filtersToCSS(p.filters) }} />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fine adjustments */}
      <div className="mt-5 flex flex-col gap-2.5">
        <div className="flex items-center">
          <p className="text-[0.78rem] font-semibold text-[var(--ink-2)]">Adjustments</p>
          <button type="button"
            onClick={() => push({ ...settings, filters: DEFAULT_FILTERS })}
            className="ml-auto inline-flex items-center gap-1 text-[0.72rem] font-semibold text-[var(--ink-3)] transition hover:text-[var(--accent)]">
            <ArrowCounterClockwise size={13} /> Reset
          </button>
        </div>
        <Row icon={<Sun size={15} />} label="Brightness" value={f.brightness} min={50} max={150}
          onChange={v => setFilters(x => ({ ...x, brightness: v }))} />
        <Row icon={<CircleHalf size={15} weight="fill" />} label="Contrast" value={f.contrast} min={50} max={150}
          onChange={v => setFilters(x => ({ ...x, contrast: v }))} />
        <Row icon={<Drop size={15} />} label="Saturation" value={f.saturation} min={0} max={200}
          onChange={v => setFilters(x => ({ ...x, saturation: v }))} />
        <Row icon={<Palette size={15} />} label="Hue" value={f.hue} min={-180} max={180} unit="°" hue
          onChange={v => setFilters(x => ({ ...x, hue: v }))} />
      </div>
    </section>
  );
}

function Row({ icon, label, value, min, max, unit = '', hue = false, onChange }: {
  icon: React.ReactNode; label: string; value: number; min: number; max: number;
  unit?: string; hue?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[var(--ink-3)]">{icon}</span>
      <span className="w-[68px] shrink-0 text-[0.75rem] text-[var(--ink-2)]">{label}</span>
      <input type="range" min={min} max={max} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className={hue ? 'dsac-range dsac-range-hue' : 'dsac-range'} />
      <span className="w-9 shrink-0 text-right text-[0.72rem] tabular-nums text-[var(--ink-3)]">
        {hue ? value : value - 100}{unit}
      </span>
    </div>
  );
}
