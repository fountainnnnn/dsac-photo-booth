import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, Eye, EyeSlash, GoogleDriveLogo, Warning } from '@phosphor-icons/react';
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
  /**
   * Whether this booth owns its settings. False on the hosted one, whose
   * values are Cloudflare secrets — write-once, never readable, and changed
   * only by whoever can deploy. Both booths serve this same bundle, so the
   * card has to be told which it is rather than assume.
   */
  editable?: boolean;
  managedBy?: string | null;
  /** Read-only booths report which keys are set, never what they are. */
  configured?: string[];
}

export default function EnvironmentCard() {
  const [payload, setPayload] = useState<EnvPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  /**
   * Hand the operator to Google, and wait for the booth to catch the redirect.
   *
   * The consent page is opened in their ordinary browser rather than in the
   * kiosk window: signing in to Google inside a frameless kiosk with no
   * address bar is the kind of thing people are rightly taught not to do, and
   * Google blocks embedded webviews for sign-in regardless.
   */
  const connect = useCallback(async () => {
    setConnecting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/drive/connect');
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not start the connection.');
      window.open(data.url, '_blank', 'noopener');
      setStatus({ kind: 'ok', text: 'Approve in your browser, then come back.' });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Could not connect.' });
      setConnecting(false);
    }
  }, []);

  // While a consent is out, watch for the token to land. The callback writes
  // it from a different browser entirely, so nothing else would tell this card.
  useEffect(() => {
    if (!connecting) return;
    const id = setInterval(() => { void load(); }, 2000);
    return () => clearInterval(id);
  }, [connecting, load]);

  useEffect(() => {
    if (connecting && payload?.values.GOOGLE_REFRESH_TOKEN) {
      setConnecting(false);
      setStatus({ kind: 'ok', text: 'Google Drive connected.' });
    }
  }, [connecting, payload]);

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

  // Drive is set up as a pair: two values pasted from Google Cloud, and a
  // refresh token the booth fetches for itself. The button only makes sense
  // once the first pair is saved, because the consent link is built from them.
  const readOnly = payload.editable === false;
  const hasClient = Boolean(payload.values.GOOGLE_CLIENT_ID && payload.values.GOOGLE_CLIENT_SECRET);
  const connected = Boolean(payload.values.GOOGLE_REFRESH_TOKEN);

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
        {readOnly
          ? `Set where this booth is deployed, not here — ${payload.managedBy ?? 'the deployment'} `
            + 'holds them and never hands a secret back. This lists which are configured.'
          : 'Settings the booth reads from its own file, rather than from this screen. '
            + 'Passwords and the public URL apply as soon as you save.'}
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

      {readOnly && (
        <div className="mt-5 flex flex-col gap-3">
          {payload.fields.map(field => {
            const set = payload.configured?.includes(field.key);
            return (
              <div key={field.key} className="flex items-baseline gap-3">
                <span className="text-[0.8rem] font-semibold text-[var(--ink)]">{field.label}</span>
                <span className={`ml-auto text-[0.75rem] font-semibold ${
                  set ? 'text-[#127a4a]' : 'text-[var(--ink-3)]'
                }`}>{set ? 'Set' : 'Not set'}</span>
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
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
      )}

      {!readOnly && (
      <>
      {/* Drive's third value is not pasted like the others: Google shows a
          refresh token once, at consent, and never again — so the booth goes
          and gets it rather than asking an operator to catch it. */}
      <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] px-4 py-3.5">
        <p className="flex items-center gap-2 text-[0.8rem] font-semibold text-[var(--ink)]">
          <GoogleDriveLogo size={16} /> Google Drive
          {connected && (
            <span className="ml-auto text-[0.72rem] font-semibold text-[#127a4a]">Connected</span>
          )}
        </p>
        <p className="mt-1.5 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
          {!hasClient
            ? 'Save the client ID and secret above first, then connect. The refresh token is filled in for you.'
            : connected
              ? 'The booth holds a refresh token. Connect again to replace it — for a different account, or if uploads start failing.'
              : 'Opens Google in your browser. Approve once and the booth fills in the refresh token itself.'}
        </p>
        <div className="mt-3">
          <Button
            size="sm" variant={connected ? 'ghost' : undefined}
            onClick={() => void connect()}
            disabled={!hasClient || connecting || dirty}
          >
            <GoogleDriveLogo size={15} />
            {connecting ? 'Waiting for Google…' : connected ? 'Reconnect' : 'Connect Google Drive'}
          </Button>
        </div>
        {dirty && hasClient && (
          <p className="mt-2 text-[0.7rem] text-[var(--ink-3)]">
            Save your changes first — the consent link is built from the saved client ID.
          </p>
        )}
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
      </>
      )}

      <p className="mt-5 break-all text-[0.68rem] leading-[1.6] text-[var(--ink-3)]">
        {readOnly ? 'Changed in ' : 'Written to '}<code>{payload.file}</code>
      </p>
    </section>
  );
}
