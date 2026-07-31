import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, LockSimple, Trash, UploadSimple, Warning } from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import { useFrameCatalogue, type FrameSetting } from '@/components/features/frames/useFrameCatalogue';
import {
  EventSettingsCard, LookSettingsCard, useCaptureSettingsControl,
} from '@/components/features/remote/CaptureSettingsCard';
import RemoteAccessCard from '@/components/features/remote/RemoteAccessCard';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Rescale the enabled frames so their percentages sum to exactly 100, keeping
 * their ratios. Disabled frames are left untouched (and excluded).
 */
function normalise(
  draft: Record<string, FrameSetting>,
  ids: string[],
): Record<string, FrameSetting> {
  const enabled = ids.filter(id => draft[id]?.enabled !== false);
  if (enabled.length === 0) return draft;

  const sum = enabled.reduce((s, id) => s + (draft[id]?.weight ?? 0), 0);
  const next = { ...draft };
  for (const id of enabled) {
    const cur = draft[id]?.weight ?? 0;
    next[id] = {
      weight: round1(sum > 0 ? (cur / sum) * 100 : 100 / enabled.length),
      enabled: true,
    };
  }
  return next;
}

/**
 * Settings — upload frames and set how often each one comes up.
 *
 * The number on each frame IS its percentage chance. The enabled frames always
 * add up to 100, so raising one lowers the others to make room. None of this
 * shows on the wheel — every segment there is the same size, so a rare frame
 * looks exactly as likely as a common one.
 */
export default function SettingsPage() {
  const { frames, loading, error, saveSettings, uploadFrame, deleteFrame } = useFrameCatalogue();
  // Owned here, not in the cards: they sit in different columns but must write
  // to one snapshot, or each would save over the other's edits.
  const capture = useCaptureSettingsControl();

  const [draft, setDraft] = useState<Record<string, FrameSetting>>({});
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed the draft from the server, but never clobber edits in progress. Stored
  // weights may be raw (e.g. 1/1) so normalise them to real percentages first.
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      const isFirstSeed = Object.keys(prev).length === 0;
      for (const f of frames) {
        if (!(f.id in next)) next[f.id] = { weight: f.weight ?? 1, enabled: f.enabled !== false };
      }
      for (const id of Object.keys(next)) {
        if (!frames.some((f) => f.id === id)) delete next[id];
      }
      return isFirstSeed ? normalise(next, frames.map(f => f.id)) : next;
    });
  }, [frames]);

  const totalWeight = useMemo(
    () => frames.reduce((sum, f) => {
      const d = draft[f.id];
      return d?.enabled === false ? sum : sum + (d?.weight ?? 0);
    }, 0),
    [frames, draft],
  );

  // The number typed is the percentage. Keep the edited frame exact and share
  // the remaining 100 - value across the other enabled frames by their ratios,
  // so the set always totals 100 and only the others move.
  const setWeight = (id: string, weight: number) =>
    setDraft(d => {
      const val = Math.max(0, Math.min(100, Number.isFinite(weight) ? weight : 0));
      const next = { ...d, [id]: { weight: val, enabled: d[id]?.enabled !== false } };

      const others = frames.filter(f => f.id !== id && (next[f.id]?.enabled !== false));
      const remaining = 100 - val;
      const otherSum = others.reduce((s, f) => s + (next[f.id]?.weight ?? 0), 0);
      for (const f of others) {
        const cur = next[f.id]?.weight ?? 0;
        next[f.id] = {
          weight: round1(otherSum > 0 ? (cur / otherSum) * remaining : remaining / others.length),
          enabled: true,
        };
      }
      return next;
    });

  const setEnabled = (id: string, enabled: boolean) =>
    setDraft(d => normalise({ ...d, [id]: { weight: d[id]?.weight ?? 0, enabled } }, frames.map(f => f.id)));

  const save = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      await saveSettings(draft);
      setStatus({ kind: 'ok', text: 'Saved. The wheel will use these odds.' });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  }, [draft, saveSettings]);

  const onUpload = useCallback(async (file: File) => {
    setBusy(true); setStatus(null);
    try {
      await uploadFrame(file, label.trim() || file.name.replace(/\.[^.]+$/, ''));
      setLabel('');
      setStatus({ kind: 'ok', text: 'Frame uploaded.' });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setBusy(false);
    }
  }, [label, uploadFrame]);

  const onDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete the "${name}" frame? This cannot be undone.`)) return;
    setBusy(true); setStatus(null);
    try {
      await deleteFrame(id);
      setStatus({ kind: 'ok', text: 'Frame deleted.' });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setBusy(false);
    }
  }, [deleteFrame]);

  const navigate = (section: StudioSection) => {
    window.location.href = section === 'settings' ? '/settings'
      : section === 'gallery' ? '/gallery'
      : '/capture';
  };

  return (
    <StudioShell active="settings" onNavigate={navigate}>
      <header className="flex shrink-0 items-center gap-6">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            Settings<span className="text-[var(--accent)]">.</span>
          </h1>
          <p className="mt-1 text-[0.85rem] text-[var(--ink-2)]">
            Manage the frames in the pool and how often each one is drawn.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {status && (
            <span className={`flex items-center gap-1.5 text-[0.82rem] font-semibold ${
              status.kind === 'ok' ? 'text-[#127a4a]' : 'text-[var(--accent-ink)]'
            }`}>
              {status.kind === 'ok' ? <CheckCircle size={17} weight="fill" /> : <Warning size={17} weight="fill" />}
              {status.text}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || loading}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--accent)] px-7 text-[0.9rem] font-semibold text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_8px_24px_rgba(225,38,47,0.26)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-4 shrink-0 rounded-xl border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] px-4 py-3 text-[0.82rem] text-[var(--accent-ink)]">
          Could not reach the frame service ({error}). Showing built-in frames only; changes will not save.
        </p>
      )}

      {/*
        Two columns, split by what each thing is about rather than by size:
        everything to do with the frame pool sits with the pool on the left, and
        the right rail is the booth itself — camera, event, phone remote. The
        rail used to carry all five cards and had to scroll to reach any of them.
      */}
      <div className="mt-6 grid min-h-0 flex-1 grid-cols-[1fr_330px] gap-5 overflow-hidden">
        <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
        {/* Frame list */}
        <section className="flex min-h-[210px] flex-1 flex-col overflow-hidden rounded-[18px] border border-[var(--border)]">
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-4">
            <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Frame pool</p>
            <p className="text-[0.78rem] text-[var(--ink-3)]">
              {frames.filter(f => draft[f.id]?.enabled !== false).length} of {frames.length} in the wheel
            </p>

            <span className="ml-auto text-[0.78rem] tabular-nums text-[var(--ink-3)]">
              Totals {totalWeight.toFixed(0)}%
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-3">
              {frames.map((frame) => {
                const d = draft[frame.id] ?? { weight: frame.weight ?? 1, enabled: true };
                return (
                  <div
                    key={frame.id}
                    className="flex items-center gap-4 rounded-[14px] border border-[var(--border)] px-4 py-3.5"
                    style={{ opacity: d.enabled ? 1 : 0.55 }}
                  >
                    <div className="h-[54px] w-[86px] shrink-0 overflow-hidden rounded-lg" style={{ background: '#8a8f8a' }}>
                      <img src={frame.src} alt="" className="h-full w-full" draggable={false} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[0.9rem] font-semibold text-[var(--ink)]">
                        {frame.label}
                        {frame.builtIn && (
                          <span title="Built-in frame" className="text-[var(--ink-3)]"><LockSimple size={13} /></span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                        {d.enabled ? `${d.weight}% chance` : 'Not in the wheel'}
                        {frame.dateStamp ? ' · stamps the date' : ''}
                      </p>
                    </div>

                    <div className="flex w-[250px] shrink-0 items-center gap-3">
                      <input
                        type="range" min={0} max={100} step={0.5} value={d.weight}
                        disabled={!d.enabled}
                        onChange={e => setWeight(frame.id, Number(e.target.value))}
                        className="dsac-range" aria-label={`${frame.label} probability`}
                      />
                      <label className="relative shrink-0">
                        <input
                          type="number" min={0} max={100} step={0.1} value={d.weight}
                          disabled={!d.enabled}
                          onChange={e => setWeight(frame.id, Number(e.target.value))}
                          aria-label={`${frame.label} probability, percent`}
                          className="w-[76px] rounded-lg border border-[var(--border)] py-1.5 pl-2.5 pr-6 text-right text-[0.82rem] font-semibold tabular-nums text-[var(--ink)] outline-none transition focus:border-[var(--accent)] disabled:opacity-40"
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.75rem] text-[var(--ink-3)]">%</span>
                      </label>
                    </div>

                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[0.78rem] font-medium text-[var(--ink-2)]">
                      <input
                        type="checkbox" checked={d.enabled}
                        onChange={e => setEnabled(frame.id, e.target.checked)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      On
                    </label>

                    <button
                      type="button"
                      onClick={() => onDelete(frame.id, frame.label)}
                      disabled={frame.builtIn || busy}
                      title={frame.builtIn ? 'Built-in frames cannot be deleted' : 'Delete frame'}
                      aria-label={`Delete ${frame.label}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-3)] transition hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-[var(--ink-3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <Trash size={17} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Wide things go left: twelve presets and four sliders are cramped in
            a 330px rail and comfortable across the full column. */}
        <LookSettingsCard {...capture} />

        {/* Adding a frame and the resulting odds both belong with the pool. */}
        <div className="grid shrink-0 grid-cols-2 gap-5">
          <section className="rounded-[18px] border border-[var(--border)] px-5 py-4">
            <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Add a frame</p>
            <p className="mt-1 text-[0.75rem] leading-[1.5] text-[var(--ink-3)]">
              A 1921&times;1201 PNG with a transparent centre. Uploads join the wheel
              at weight 1.
            </p>

            <label className="mt-3 block text-[0.78rem] font-semibold text-[var(--ink-2)]">
              Name
              <input
                type="text" value={label} onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Confetti" maxLength={40}
                className="mt-1.5 w-full rounded-xl border border-[var(--border)] px-3 py-2.5 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <input
              ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ''; }}
            />
            <button
              type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--ink-3)] text-[0.88rem] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <UploadSimple size={18} />
              Choose image
            </button>
          </section>

          <section className="flex min-h-0 flex-col rounded-[18px] border border-[var(--border)] px-5 py-4">
            <p className="shrink-0 text-[0.92rem] font-semibold text-[var(--ink)]">Current odds</p>
            {/* Scrolls on its own: a long frame pool must not push the row
                taller than the column and squeeze the list above it. */}
            <div className="mt-3 flex max-h-[190px] flex-col gap-2 overflow-y-auto pr-1">
              {frames.filter(f => (draft[f.id]?.enabled ?? true)).map(f => {
                const pct = draft[f.id]?.weight ?? 0;
                return (
                  <div key={f.id}>
                    <div className="flex justify-between text-[0.75rem]">
                      <span className="truncate text-[var(--ink-2)]">{f.label}</span>
                      <span className="ml-2 shrink-0 font-semibold tabular-nums text-[var(--ink)]">{pct.toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--shell-bg)]">
                      <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {totalWeight === 0 && (
                <p className="text-[0.75rem] text-[var(--accent-ink)]">
                  Every frame is off or at zero — the wheel would have nothing to draw.
                </p>
              )}
            </div>
          </section>
        </div>
        </div>

        {/* The booth itself: event details and the phone remote. */}
        <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
          <EventSettingsCard {...capture} />
          <RemoteAccessCard />

          <section className="rounded-[18px] border border-[var(--border)] px-5 py-4">
            <p className="text-[0.92rem] font-semibold text-[var(--ink)]">How the odds work</p>
            <p className="mt-2 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
              The number on each frame is its chance of coming up. The enabled
              frames always add up to 100%, so raising one lowers the others to
              make room.
            </p>
            <p className="mt-2 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
              Set a frame to <strong>0</strong>, or switch it off, to keep it out
              of the draw.
            </p>
            <p className="mt-3 rounded-xl bg-[var(--shell-bg)] px-3.5 py-3 text-[0.75rem] leading-[1.6] text-[var(--ink-2)]">
              The wheel never reveals this. Every segment is drawn the same size, so a
              rare frame looks exactly as likely as a common one.
            </p>
          </section>
        </aside>
      </div>
    </StudioShell>
  );
}
