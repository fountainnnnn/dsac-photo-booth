import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, Eye, EyeSlash, Warning } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';

/**
 * The settings that used to live in a file nobody could reach.
 *
 * On a packaged booth there is no source tree to edit and no deployment
 * holding secrets, so the passwords, the public URL and the ports had no way
 * of being set at all — the app shipped without a `.env` and without any means
 * of writing one. This card is that means. It writes a real dotenv file in the
 * app's own data folder; the path is shown at the bottom so a support call can
 * ask an operator to open it.
 *
 * Two kinds of value live here and the difference is stated on each row.
 * Passwords and the public URL take effect the moment they are saved. Ports
 * and folders are read once while the server starts, so those rows say so and
 * the card warns until the booth has been restarted.
 */

interface EnvField {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  secret?: boolean;
  restart: boolean;
}

interface EnvPayload {
  file: string;
  fields: EnvField[];
  values: Record<string, string>;
  pendingRestart: string[];
}

export default function EnvironmentCard() {
  const [payload, setPayload] = useState<EnvPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/env');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as EnvPayload;
      setPayload(data);
      setDraft(data.values);
    } catch {
      setStatus({ kind: 'err', text: 'Could not read the settings file.' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/settings/env', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: draft }),
      });
      const data = await res.json() as EnvPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
      setPayload(data);
      setDraft(data.values);
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }, [draft]);

  if (!payload) {
    return (
      <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Environment</p>
        <p className="mt-2 text-[0.78rem] text-[var(--ink-3)]">
          {status?.text ?? 'Loading…'}
        </p>
      </section>
    );
  }

  const dirty = payload.fields.some(f => (draft[f.key] ?? '') !== (payload.values[f.key] ?? ''));

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Environment</p>
        {status && (
          <span className={`ml-auto text-[0.72rem] font-semibold ${
            status.kind === 'ok' ? 'text-[#127a4a]' : 'text-[var(--accent)]'
          }`}>{status.text}</span>
        )}
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Settings the booth reads from its own file, rather than from this screen.
        Passwords and the public URL apply as soon as you save.
      </p>

      {payload.pendingRestart.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3.5 py-2.5 text-[0.75rem] leading-[1.6] text-[var(--ink-2)]">
          <Warning size={15} weight="fill" className="mt-px shrink-0 text-[var(--accent)]" />
          <span>
            Saved, but not in use yet: <strong>{payload.pendingRestart.join(', ')}</strong>.
            Close the booth and open it again to apply.
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-col gap-5">
        {payload.fields.map(field => (
          <label key={field.key} className="block">
            <span className="flex items-center gap-2 text-[0.8rem] font-semibold text-[var(--ink)]">
              {field.label}
              {field.restart && (
                <span className="rounded-md bg-[var(--surface-2,rgba(0,0,0,0.05))] px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                  restart to apply
                </span>
              )}
            </span>
            <span className="mt-1 block text-[0.72rem] leading-[1.55] text-[var(--ink-3)]">
              {field.help}
            </span>
            <span className="mt-2 flex items-center gap-2">
              <input
                type={field.secret && !shown[field.key] ? 'password' : 'text'}
                value={draft[field.key] ?? ''}
                placeholder={field.placeholder ?? 'Not set'}
                autoComplete="off"
                spellCheck={false}
                onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-transparent px-3.5 text-[0.85rem] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
              {field.secret && (
                <button
                  type="button"
                  onClick={() => setShown(v => ({ ...v, [field.key]: !v[field.key] }))}
                  aria-label={shown[field.key] ? `Hide ${field.label}` : `Show ${field.label}`}
                  className="shrink-0 rounded-lg p-2 text-[var(--ink-3)] hover:text-[var(--ink)]"
                >
                  {shown[field.key] ? <EyeSlash size={17} /> : <Eye size={17} />}
                </button>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          size="sm" variant="ghost"
          onClick={() => { setDraft(payload.values); setStatus(null); }}
          disabled={busy || !dirty}
        >
          <ArrowClockwise size={15} /> Discard
        </Button>
      </div>

      <p className="mt-5 break-all text-[0.68rem] leading-[1.6] text-[var(--ink-3)]">
        Written to <code>{payload.file}</code>
      </p>
    </section>
  );
}
