import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, LockSimple, Trash, UploadSimple, Warning } from '@phosphor-icons/react';
import StudioShell, { type StudioSection } from '@/components/ui/StudioShell';
import { useFrameCatalogue, type FrameSetting } from '@/components/features/frames/useFrameCatalogue';
import {
  EventSettingsCard, LookSettingsCard, useCaptureSettingsControl,
} from '@/components/features/remote/CaptureSettingsCard';
import RemoteAccessCard from '@/components/features/remote/RemoteAccessCard';

/**
 * Settings — everything an operator changes, so the capture screen can be
 * nothing but a camera and a shutter.
 *
 * That includes which frame is live. A guest is standing in front of the booth
 * and should not be able to change the frame, the look, or the countdown by
 * leaning on the screen.
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

  // Seed the draft from the server, but never clobber edits in progress.
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const f of frames) {
        if (!(f.id in next)) next[f.id] = { enabled: f.enabled !== false };
      }
      for (const id of Object.keys(next)) {
        if (!frames.some((f) => f.id === id)) delete next[id];
      }
      return next;
    });
  }, [frames]);

  const enabledCount = useMemo(
    () => frames.filter(f => draft[f.id]?.enabled !== false).length,
    [frames, draft],
  );

  const setEnabled = (id: string, enabled: boolean) =>
    setDraft(d => ({ ...d, [id]: { enabled } }));

  const save = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      await saveSettings(draft);
      setStatus({ kind: 'ok', text: 'Saved.' });
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
    <StudioShell active="settings" onNavigate={navigate} scroll>
      <header className="flex shrink-0 items-center gap-6">
        <div>
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            Settings<span className="text-[var(--accent)]">.</span>
          </h1>
          <p className="mt-1 text-[0.85rem] text-[var(--ink-2)]">
            Pick the frame, set the event details, and tune the camera.
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
        the right rail is the booth itself — camera, event, phone remote.

        Nothing here scrolls on its own. Every card grows to fit its contents
        and the page scrolls once, so there is one scrollbar to think about
        rather than a card-within-a-card-within-a-rail.
      */}
      <div className="mt-8 grid grid-cols-[1fr_360px] items-start gap-8">
        <div className="flex flex-col gap-8">
        {/* Frame list */}
        <section className="flex flex-col rounded-[18px] border border-[var(--border)]">
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-6 py-5">
            <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Frame pool</p>
            <p className="text-[0.78rem] text-[var(--ink-3)]">
              {enabledCount} of {frames.length} available to choose
            </p>
          </div>

          <div className="px-6 py-5">
            <div className="flex flex-col gap-4">
              {frames.map((frame) => {
                const d = draft[frame.id] ?? { enabled: true };
                return (
                  <div
                    key={frame.id}
                    className="flex items-center gap-5 rounded-[14px] border border-[var(--border)] px-5 py-4"
                    style={{ opacity: d.enabled ? 1 : 0.55 }}
                  >
                    <div className="h-[62px] w-[99px] shrink-0 overflow-hidden rounded-lg" style={{ background: '#8a8f8a' }}>
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
                        {d.enabled ? 'In the picker' : 'Hidden from the picker'}
                        {frame.dateStamp ? ' · stamps the date' : ''}
                      </p>
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

        {/* Uploading belongs with the pool it adds to. */}
        <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
          <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Add a frame</p>
          <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
            A 1921&times;1201 PNG with a transparent centre. Uploads appear in
            the picker straight away.
          </p>

          <label className="mt-5 block text-[0.78rem] font-semibold text-[var(--ink-2)]">
            Name
            <input
              type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Confetti" maxLength={40}
              className="mt-2 w-full rounded-xl border border-[var(--border)] px-3.5 py-3 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <input
            ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ''; }}
          />
          <button
            type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--ink-3)] text-[0.88rem] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <UploadSimple size={18} />
            Choose image
          </button>
        </section>
        </div>

        {/* The booth itself: event details and the phone remote. */}
        <aside className="flex flex-col gap-8">
          {/* The live frame. It lives here rather than on the capture screen so
              a guest standing at the booth has nothing to press but the
              shutter. Saves immediately; the kiosk follows without a reload. */}
          <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
            <div className="flex items-center gap-2">
              <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Frame in use</p>
              <span className={`ml-auto text-[0.72rem] font-semibold transition-opacity duration-200 ${
                capture.saved ? 'text-[#127a4a] opacity-100' : 'opacity-0'
              }`}>Saved</span>
            </div>
            <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
              What every photo is taken with, until you change it here.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <FrameSwatch
                label="None"
                selected={!capture.settings.selectedFrameId}
                onSelect={() => capture.push({ ...capture.settings, selectedFrameId: '' })}
              />
              {frames.filter(f => draft[f.id]?.enabled !== false).map(f => (
                <FrameSwatch
                  key={f.id}
                  label={f.label}
                  src={f.src}
                  selected={capture.settings.selectedFrameId === f.id}
                  onSelect={() => capture.push({ ...capture.settings, selectedFrameId: f.id })}
                />
              ))}
            </div>
          </section>

          <EventSettingsCard {...capture} />
          <RemoteAccessCard />

          <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
            <p className="text-[0.92rem] font-semibold text-[var(--ink)]">How frames work</p>
            <p className="mt-2.5 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
              Every photo uses the frame chosen above. The capture screen shows
              it live, but cannot change it.
            </p>
            <p className="mt-2.5 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
              Switch a frame off in the pool to keep it out of the chooser
              without deleting it.
            </p>
          </section>
        </aside>
      </div>
    </StudioShell>
  );
}

/** One choice in the frame selector. */
function FrameSwatch({ label, src, selected, onSelect }: {
  label: string; src?: string; selected: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={label}
      className={`flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        selected
          ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
          : 'hover:bg-[var(--shell-bg)]'
      }`}
    >
      <span
        className={`flex h-[46px] w-full items-center justify-center overflow-hidden rounded ${
          selected ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--border)]'
        }`}
        style={{ background: src ? '#8a8f8a' : 'var(--shell-bg)' }}
      >
        {src
          ? <img src={src} alt="" draggable={false} className="h-full w-full" />
          : <span className="text-[0.62rem] font-semibold text-[var(--ink-3)]">None</span>}
      </span>
      <span className={`w-full truncate text-[0.66rem] font-semibold ${
        selected ? 'text-[var(--accent)]' : 'text-[var(--ink-2)]'
      }`}>
        {label}
      </span>
    </button>
  );
}
