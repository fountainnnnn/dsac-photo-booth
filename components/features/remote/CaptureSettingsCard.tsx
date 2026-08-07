import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  CircleHalf, Drop, LinkSimple, Palette, Sun, Timer as TimerIcon, Trash,
} from '@phosphor-icons/react';
import { useCaptureSettings, type CaptureSettings } from './useCaptureSettings';
import { formatEventDate, stampDate, todayIso } from '@/types/frame';
import { DEFAULT_FILTERS, DEFAULT_RAMP, filtersAreNeutral } from '@/types/editor';
import type { LookRamp, ImageFilters } from '@/types/editor';

const TIMER_OPTIONS = [0, 3, 5, 10] as const;

/** Link lifetimes worth a button, shortest first, with 0 meaning never. */
/** Quick picks. Any other number is typed in beside them. */
const LINK_TTL_OPTIONS: { hours: number; label: string }[] = [
  { hours: 6,   label: '6 hours' },
  { hours: 24,  label: '1 day' },
  { hours: 168, label: '7 days' },
  { hours: 0,   label: 'Never' },
];

/**
 * How long the photos themselves are kept. Never comes first here, unlike the
 * link picks above: it is both the default and the safe answer, and an
 * operator skimming the row should meet it before they meet a number that
 * deletes things.
 */
export const GALLERY_TTL_OPTIONS: { hours: number; label: string }[] = [
  { hours: 0,    label: 'Never' },
  { hours: 168,  label: '7 days' },
  { hours: 720,  label: '30 days' },
  { hours: 2160, label: '90 days' },
];

/**
 * Show a span of hours in the largest unit that divides it exactly, so a
 * setting typed as "3 days" comes back as 3 days rather than 72 hours.
 */
export function splitTtl(hours: number): { value: number; unit: 'hours' | 'days' } {
  if (hours > 0 && hours % 24 === 0) return { value: hours / 24, unit: 'days' };
  return { value: hours, unit: 'hours' };
}

/** Which edge the ramp starts from, in the order they sit on screen. */
/** The arrow points the way the effect fades: ↓ is strong at the top, gone at
 *  the bottom. Labelled with words as well because arrows alone read both ways. */
const RAMP_OPTIONS: { value: LookRamp; label: string; icon?: React.ReactNode }[] = [
  { value: 'even',      label: 'Even' },
  { value: 'down',      label: 'Top edge, fading down',    icon: <ArrowDown size={15} /> },
  { value: 'up',        label: 'Bottom edge, fading up',   icon: <ArrowUp size={15} /> },
  { value: 'rightward', label: 'Left edge, fading right',  icon: <ArrowRight size={15} /> },
  { value: 'leftward',  label: 'Right edge, fading left',  icon: <ArrowLeft size={15} /> },
];

export interface CaptureSettingsControl {
  settings: CaptureSettings;
  push: (next: CaptureSettings) => void;
  saved: boolean;
  loading: boolean;
}

/** Load the settings once and expose a debounced writer. Call in the page. */
export function useCaptureSettingsControl(): CaptureSettingsControl {
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

  return { settings, push, saved, loading };
}

/** What is printed on the photo, and how long the countdown runs. */
export function EventSettingsCard({ settings, push, saved, loading }: CaptureSettingsControl) {
  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Event</p>
        <span className={`ml-auto text-[0.72rem] font-semibold transition-opacity duration-200 ${
          saved ? 'text-[#127a4a] opacity-100' : 'opacity-0'
        }`}>
          Saved
        </span>
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Applies to the booth immediately. Guests never see these controls.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <label className="text-[0.78rem] font-semibold text-[var(--ink-2)]">
          Event name
          <input
            type="text" value={settings.eventName} maxLength={60}
            onChange={e => push({ ...settings, eventName: e.target.value })}
            placeholder="Transformation Made Possible"
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3.5 py-3 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        {/* Left empty this is the day the photo is taken, which is right for
            almost every booth. It is settable because "almost" is not "always":
            a booth run past midnight, or set up the evening before, or shooting
            for a dated event on another day, needs to say so. */}
        <label className="text-[0.78rem] font-semibold text-[var(--ink-2)]">
          Event date
          <div className="mt-2 flex items-center gap-2">
            {/* Shows today when nothing is pinned, rather than an empty
                dd/mm/yyyy — the operator sees the date that will actually be
                printed. The *setting* stays empty until they pick something,
                which is what lets it roll over to tomorrow on its own; the
                line below says which of the two states this is. */}
            <input
              type="date"
              value={settings.eventDate || todayIso()}
              onChange={e => push({ ...settings, eventDate: e.target.value })}
              aria-label="Event date"
              className="min-h-11 flex-1 rounded-xl border border-[var(--border)] px-3.5 py-3 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
            {settings.eventDate && (
              <button
                type="button"
                onClick={() => push({ ...settings, eventDate: '' })}
                className="min-h-11 shrink-0 rounded-xl border border-[var(--border)] px-4 text-[0.78rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Use today
              </button>
            )}
          </div>
          <p className="mt-2 text-[0.72rem] font-normal leading-[1.6] text-[var(--ink-3)]">
            {settings.eventDate
              ? <>Every photo will be stamped <strong className="font-semibold text-[var(--ink)]">{formatEventDate(stampDate(settings.eventDate))}</strong>, whenever it is taken.</>
              : <>Empty, so photos carry <strong className="font-semibold text-[var(--ink)]">the day they are taken</strong> — nothing to go stale between events.</>}
          </p>
        </label>
      </div>

      <div className="mt-6">
        <p className="mb-3 flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
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

      {/* Expiry and deletion are two different things, and an operator has no
          reason to assume so — each helper line spends its one sentence on
          that rather than on restating the buttons. */}
      <div className="mt-6">
        <p className="mb-1.5 flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
          <LinkSimple size={15} /> Download link
        </p>
        <p className="mb-3 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
          How long a guest&rsquo;s QR link keeps working. This only retires the
          link — the photo stays in the gallery.
        </p>
        <TtlPicks
          options={LINK_TTL_OPTIONS} value={settings.linkTtlHours} loading={loading}
          onPick={h => push({ ...settings, linkTtlHours: h })}
        />

        {/* The quick picks are the common cases, not the whole range. An event
            that wants the link dead in 90 minutes should be able to say so
            without one of us having guessed at it in advance. */}
        <TtlCustom
          value={settings.linkTtlHours} loading={loading}
          label="Link lifetime" neverHint="links never expire"
          onChange={h => push({ ...settings, linkTtlHours: h })}
        />
      </div>

      {/* Deliberately the same shape as the block above, because the pair is
          only understandable side by side: one span retires a link, the other
          destroys the picture. The wording carries the whole difference. */}
      <div className="mt-6">
        <p className="mb-1.5 flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
          <Trash size={15} /> Gallery cleanup
        </p>
        <p className="mb-3 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
          How long a photo is kept after it is taken. When the time is up the
          booth <strong className="font-semibold text-[var(--ink)]">deletes the photo
          itself</strong> — out of the gallery and out of storage, permanently, with
          no way back. Never keeps every photo until you delete it by hand.
        </p>
        <TtlPicks
          options={GALLERY_TTL_OPTIONS} value={settings.galleryTtlHours} loading={loading}
          onPick={h => push({ ...settings, galleryTtlHours: h })}
        />
        <TtlCustom
          value={settings.galleryTtlHours} loading={loading}
          label="Photo lifetime" neverHint="photos are kept forever"
          onChange={h => push({ ...settings, galleryTtlHours: h })}
        />

        {/* Not an error — an operator may well want the photos gone before the
            links lapse. But a guest holding a link to a photo that no longer
            exists is worth hearing about before the event, not during it. A
            link set to Never is infinite, so it outlives any cleanup at all. */}
        {settings.galleryTtlHours > 0
          && (settings.linkTtlHours === 0 || settings.galleryTtlHours < settings.linkTtlHours) && (
          <p className="mt-2 text-[0.72rem] leading-[1.6] font-medium text-[var(--accent-ink)]">
            Download links outlive the photos here, so a guest could scan a QR
            code and find the picture already deleted.
          </p>
        )}
      </div>
    </section>
  );
}

/** The quick picks, shared so both spans stay one design rather than two. */
function TtlPicks({ options, value, loading, onPick }: {
  options: { hours: number; label: string }[];
  value: number; loading: boolean; onPick: (hours: number) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map(o => (
        <button
          key={o.hours} type="button" disabled={loading}
          aria-pressed={value === o.hours}
          onClick={() => onPick(o.hours)}
          className={`min-h-11 flex-1 rounded-xl text-[0.82rem] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            value === o.hours
              ? 'bg-[var(--accent)] text-white'
              : 'border border-[var(--border)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How the picture looks: four uniform adjustments, then a directional one.
 *
 * The preset swatches are gone. They were a shortcut to a look, but an operator
 * setting a booth up for one event picks the look once and then nudges it, and
 * a grid of twelve chips only made the sliders harder to find.
 */
export function LookSettingsCard({ settings, push }: CaptureSettingsControl) {
  const f = settings.filters;
  const ramp = settings.lookRamp;
  const setFilters = (fn: (x: ImageFilters) => ImageFilters) =>
    push({ ...settings, filters: fn(settings.filters) });

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Look</p>
        <button type="button"
          onClick={() => push({ ...settings, filters: DEFAULT_FILTERS, lookRamp: DEFAULT_RAMP })}
          className="ml-auto inline-flex items-center gap-1 text-[0.72rem] font-semibold text-[var(--ink-3)] transition hover:text-[var(--accent)]">
          <ArrowCounterClockwise size={13} /> Reset
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4">
        <Row icon={<Sun size={15} />} label="Brightness" value={f.brightness} min={0} max={300}
          onChange={v => setFilters(x => ({ ...x, brightness: v }))} />
        <Row icon={<CircleHalf size={15} weight="fill" />} label="Contrast" value={f.contrast} min={0} max={300}
          onChange={v => setFilters(x => ({ ...x, contrast: v }))} />
        <Row icon={<Drop size={15} />} label="Saturation" value={f.saturation} min={0} max={300}
          onChange={v => setFilters(x => ({ ...x, saturation: v }))} />
        <Row icon={<Palette size={15} />} label="Hue" value={f.hue} min={-180} max={180} unit="°" hue
          onChange={v => setFilters(x => ({ ...x, hue: v }))} />
      </div>

      {/* A booth is lit from one side more often than not — a window behind
          the backdrop, a lamp overhead. Spreading the Look as a ramp evens
          that out: the full adjustments at one edge, the untouched camera at
          the other. There is no second amount to set — the sliders above are
          the amount. */}
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <p className="text-[0.78rem] font-semibold text-[var(--ink-2)]">Gradient</p>
        <p className="mt-1 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
          How the Look is spread. Even applies the sliders everywhere; an
          arrow starts them at one edge and fades them out in that direction.
        </p>

        <div className="mt-3 flex items-center gap-1.5">
          {RAMP_OPTIONS.map(o => (
            <button
              key={o.value} type="button" title={o.label} aria-label={o.label}
              aria-pressed={ramp === o.value}
              onClick={() => push({ ...settings, lookRamp: o.value })}
              className={`flex h-9 items-center justify-center rounded-lg text-[0.78rem] font-semibold transition ${
                o.icon ? 'w-9' : 'px-3.5'
              } ${
                ramp === o.value
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)] bg-white text-[var(--ink-2)] hover:border-[var(--ink-3)]'
              }`}
            >
              {o.icon ?? o.label}
            </button>
          ))}
        </div>

        {ramp !== 'even' && filtersAreNeutral(f) && (
          <p className="mt-2 text-[0.72rem] font-medium text-[var(--accent-ink)]">
            Every slider is at 0, so there is nothing to spread yet — move one
            and the gradient appears.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A number and a unit, for any span the quick picks above do not cover.
 *
 * Deliberately knows nothing about which setting it is editing — it takes a
 * number of hours and hands one back — so the link's life and the photo's are
 * typed into the same control and cannot drift into behaving differently.
 */
function TtlCustom({ value: hours, onChange, loading, label, neverHint }: {
  value: number;
  onChange: (hours: number) => void;
  loading: boolean;
  /** Names the pair of fields for screen readers, e.g. "Link lifetime". */
  label: string;
  /** What 0 means for this particular span, said in the operator's words. */
  neverHint: string;
}) {
  const never = hours === 0;
  const { value, unit } = splitTtl(hours);
  // Held locally while typing: pushing every keystroke would turn "12" into a
  // one-hour setting the moment the "1" landed.
  const [draft, setDraft] = useState(String(value));
  const [draftUnit, setDraftUnit] = useState<'hours' | 'days'>(unit);

  // Follow the buttons when they are used, but never fight the operator's
  // own typing — only resync when the stored value is not what we last sent.
  useEffect(() => {
    const next = splitTtl(hours);
    const asHours = draftUnit === 'days' ? Number(draft) * 24 : Number(draft);
    if (asHours !== hours) {
      setDraft(String(next.value));
      setDraftUnit(next.unit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const commit = (raw: string, u: 'hours' | 'days') => {
    const n = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(n)) return;
    onChange(u === 'days' ? n * 24 : n);
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-[0.72rem] text-[var(--ink-3)]">or</span>
      <input
        type="number" min={0} step={1} inputMode="numeric"
        value={never ? '' : draft}
        placeholder={never ? '—' : ''}
        disabled={loading}
        aria-label={label}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value, draftUnit); }}
        className="w-20 rounded-xl border border-[var(--border)] px-3 py-2 text-[0.82rem] text-[var(--ink)] outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
      />
      <select
        value={draftUnit}
        disabled={loading}
        aria-label={`${label} unit`}
        onChange={(e) => {
          const u = e.target.value as 'hours' | 'days';
          setDraftUnit(u);
          commit(draft, u);
        }}
        className="rounded-xl border border-[var(--border)] px-3 py-2 text-[0.82rem] font-medium text-[var(--ink)] outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
      >
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
      <span className="text-[0.72rem] text-[var(--ink-3)]">
        {never ? neverHint : '0 also means never'}
      </span>
    </div>
  );
}

function Row({ icon, label, value, min, max, unit = '', hue = false, onChange }: {
  icon?: React.ReactNode; label: string; value: number; min: number; max: number;
  unit?: string; hue?: boolean; onChange: (v: number) => void;
}) {
  // The filter sliders are stored as CSS percentages, so 100 is "no change"
  // and the readout subtracts it. `hue` is already centred on zero and shown
  // as it is.
  const readout = `${hue ? value : value - 100}`;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {icon && <span className="text-[var(--ink-3)]">{icon}</span>}
      <span className="w-[68px] shrink-0 text-[0.75rem] text-[var(--ink-2)]">{label}</span>
      <input type="range" min={min} max={max} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className={hue ? 'dsac-range dsac-range-hue' : 'dsac-range'} />
      <span className="w-9 shrink-0 text-right text-[0.72rem] tabular-nums text-[var(--ink-3)]">
        {readout}{unit}
      </span>
    </div>
  );
}
