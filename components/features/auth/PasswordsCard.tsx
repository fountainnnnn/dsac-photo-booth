import { useCallback, useState } from 'react';
import { LockSimple, LockSimpleOpen } from '@phosphor-icons/react';
import { useAuthStatus, type AuthScope, type AuthStatus } from './PasswordGate';

/**
 * Set the two passwords from Settings.
 *
 * Values from .env are the seed; anything set here overrides them and is
 * stored hashed in the database. Clearing falls back to .env, or to open.
 * Reaching this card already required the booth password when one is set, so
 * a stranger cannot simply change the locks.
 */

const SCOPE_COPY: Record<AuthScope, { label: string; what: string; offWarning: string }> = {
  booth: {
    label: 'Booth password',
    what: 'Locks capture, gallery, settings and the phone remote.',
    offWarning: 'Not set — anyone with the link can open this interface and take photos.',
  },
  download: {
    label: 'Photo password',
    what: 'Guests enter it after scanning the QR, before seeing their photo.',
    offWarning: 'Not set — anyone a QR link is forwarded to can open the photo.',
  },
};

export default function PasswordsCard() {
  const { status, reload } = useAuthStatus();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const put = useCallback(async (body: Partial<Record<AuthScope, string | null>>) => {
    setError(null);
    const res = await fetch('/api/settings/passwords', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: null }));
      setError(msg ?? `Could not save (HTTP ${res.status})`);
      return false;
    }
    await reload();
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    return true;
  }, [reload]);

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Access</p>
        <span className={`ml-auto text-[0.72rem] font-semibold transition-opacity duration-200 ${
          saved ? 'text-[#127a4a] opacity-100' : 'opacity-0'
        }`}>
          Saved
        </span>
      </div>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Two passwords: one for this interface, one guests type to open their
        photo. This keeps passers-by out; it is not bank-grade security.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] px-3 py-2 text-[0.75rem] font-semibold text-[var(--accent-ink)]">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-5">
        {(Object.keys(SCOPE_COPY) as AuthScope[]).map(scope => (
          <ScopeRow key={scope} scope={scope} status={status} onSave={put} />
        ))}
      </div>
    </section>
  );
}

function ScopeRow({ scope, status, onSave }: {
  scope: AuthScope;
  status: AuthStatus | null;
  onSave: (body: Partial<Record<AuthScope, string | null>>) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = SCOPE_COPY[scope];
  const s = status?.[scope];

  const save = async (next: string | null) => {
    setBusy(true);
    try {
      if (await onSave({ [scope]: next })) setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
        {s?.required
          ? <LockSimple size={14} weight="fill" className="text-[#127a4a]" />
          : <LockSimpleOpen size={14} className="text-[var(--accent)]" />}
        {copy.label}
        {s?.source === 'env' && (
          <span className="rounded bg-[var(--shell-bg)] px-1.5 py-0.5 text-[0.62rem] font-semibold text-[var(--ink-3)]">
            from .env
          </span>
        )}
      </p>
      <p className={`mt-1 text-[0.72rem] leading-[1.5] ${
        s?.required ? 'text-[var(--ink-3)]' : 'font-medium text-[var(--accent-ink)]'
      }`}>
        {s?.required ? copy.what : copy.offWarning}
      </p>

      <form
        className="mt-2 flex gap-2"
        onSubmit={e => { e.preventDefault(); if (value) void save(value); }}
      >
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={s?.required ? 'Change password' : 'Set a password'}
          aria-label={copy.label}
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[0.85rem] outline-none transition focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={busy || !value}
          className="shrink-0 rounded-xl bg-[var(--accent)] px-4 text-[0.8rem] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Set
        </button>
        {s?.source === 'settings' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            title="Remove this password (falls back to .env if one is set there)"
            className="shrink-0 rounded-xl border border-[var(--border)] px-3 text-[0.8rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
          >
            Remove
          </button>
        )}
      </form>
    </div>
  );
}
