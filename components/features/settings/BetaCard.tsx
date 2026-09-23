/**
 * Features that are finished enough to try but not yet the booth's default.
 *
 * Each is off until switched on here, and off means exactly the booth as it
 * was: nothing extra on the guest's download page, nothing extra done at the
 * shutter. That is what makes a beta safe to ship to a booth running events —
 * the operator who never opens this card never meets it.
 */

import type { CaptureSettingsControl } from '@/components/features/remote/CaptureSettingsCard';

export default function BetaCard({ settings, push, saved, loading }: CaptureSettingsControl) {
  const on = settings.betaCardCrop === true;

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Beta</p>
        <span className={`ml-auto text-[0.72rem] font-semibold transition-opacity duration-200 ${
          saved ? 'text-[#127a4a] opacity-100' : 'opacity-0'
        }`}>
          Saved
        </span>
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Newer features, off until you switch them on. Each takes effect for the
        next guest and can be switched off again at any time.
      </p>

      <div className="mt-5 flex items-start gap-4">
        <div className="flex-1">
          <p id="beta-card-label" className="text-[0.82rem] font-semibold text-[var(--ink)]">
            Tap-yourself card
          </p>
          <p className="mt-1 text-[0.75rem] leading-[1.6] text-[var(--ink-2)]">
            Adds a section to the guest&rsquo;s download page where they tap
            themselves in the group photo and save a card of just them, printed
            with the event name and date. The booth finds the faces in each
            photo just after it is taken, so the crop lands on one person.
          </p>
          <p className="mt-1 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
            Off: the download page and capture are exactly as they were.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="beta-card-label"
          data-testid="beta-card-toggle"
          disabled={loading}
          onClick={() => push({ ...settings, betaCardCrop: !on })}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-40 ${
            on ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ${
              on ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </section>
  );
}
