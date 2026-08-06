import { useCallback, useEffect, useState } from 'react';
import { FloppyDisk, Trash } from '@phosphor-icons/react';
import type { CaptureSettingsControl } from './CaptureSettingsCard';
import type { CaptureSettings } from './useCaptureSettings';

/**
 * Named camera setups.
 *
 * A booth gets re-aimed between sessions — new crop, new look, new frame — and
 * getting back to yesterday's setup by hand is a dozen small adjustments with
 * no way to tell when you have arrived. A preset is the whole capture-settings
 * object under a name: save the room you are in now, restore it in one press.
 *
 * The settings blob is copied wholesale and never picked apart. Whatever
 * fields capture settings grow later, a preset saved today carries them
 * without this file learning their names.
 */

export interface CapturePreset {
  id: string;
  name: string;
  createdAt: string;
  settings: CaptureSettings;
}

const MAX_PRESETS = 20;

export default function PresetsCard({ settings, push, loading }: CaptureSettingsControl) {
  const [presets, setPresets] = useState<CapturePreset[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/settings/presets');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { presets: CapturePreset[] };
        setPresets(data.presets ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load presets');
      }
    })();
  }, []);

  // Optimistic: the list is small and the write is a whole-list replace, so
  // showing the change first and reconciling on failure keeps it responsive.
  const persist = useCallback(async (next: CapturePreset[]) => {
    const previous = presets;
    setPresets(next);
    setError(null);
    try {
      const res = await fetch('/api/settings/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setPresets(previous);
      setError(err instanceof Error ? err.message : 'Could not save presets');
    }
  }, [presets]);

  const save = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset: CapturePreset = {
      id: `preset-${Date.now().toString(36)}`,
      name: trimmed.slice(0, 40),
      createdAt: new Date().toISOString(),
      // Verbatim snapshot of whatever the camera is set to right now.
      settings: { ...settings },
    };
    setName('');
    void persist([...presets, preset].slice(-MAX_PRESETS));
  }, [name, presets, persist, settings]);

  /**
   * Apply over the live settings rather than replacing them: a preset saved
   * before a new setting existed would otherwise wipe that setting back to
   * undefined every time it was applied.
   */
  const apply = (preset: CapturePreset) => push({ ...settings, ...preset.settings });

  const remove = (id: string) => void persist(presets.filter(p => p.id !== id));

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Presets</p>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Save the whole camera setup — crop, look, countdown, frame — and put it
        back in one press.
      </p>

      <div className="mt-4 flex items-end gap-3">
        <label className="flex-1 text-[0.78rem] font-semibold text-[var(--ink-2)]">
          Name
          <input
            type="text" value={name} maxLength={40}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder="e.g. Foyer, evening"
            className="mt-2 w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[0.85rem] font-normal text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="button" onClick={save}
          disabled={loading || !name.trim() || presets.length >= MAX_PRESETS}
          className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 text-[0.85rem] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <FloppyDisk size={17} />
          Save current
        </button>
      </div>

      {error && (
        <p className="mt-3 text-[0.75rem] text-[var(--accent-ink)]">{error}</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {presets.length === 0 ? (
          <p className="rounded-lg bg-[var(--shell-bg)] px-3.5 py-3 text-[0.75rem] leading-[1.6] text-[var(--ink-2)]">
            Nothing saved yet. Set the camera up the way you want it, name it,
            then press Save current.
          </p>
        ) : presets.map((preset) => (
          <div key={preset.id}
            className="flex items-center gap-3 rounded-[14px] border border-[var(--border)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.85rem] font-semibold text-[var(--ink)]">{preset.name}</p>
              <p className="mt-0.5 text-[0.72rem] text-[var(--ink-3)]">
                saved {new Date(preset.createdAt).toLocaleDateString('en-SG', {
                  day: '2-digit', month: 'short',
                })}
              </p>
            </div>

            <button
              type="button" onClick={() => apply(preset)} disabled={loading}
              className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-[var(--border)] px-3.5 text-[0.78rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Apply
            </button>

            <button
              type="button" onClick={() => remove(preset.id)}
              aria-label={`Delete the ${preset.name} preset`} title="Delete preset"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-3)] transition hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
