import { useCallback, useEffect, useState } from 'react';
import { LockSimple } from '@phosphor-icons/react';

/**
 * A full-screen password card in front of a page.
 *
 * `booth` guards the interface, `download` guards a guest's photo. The check
 * lives on the server — every gated API route demands the same cookie this
 * login sets — so the card is the door handle, not the lock: skipping it just
 * moves the 401 from a tidy screen into a broken-looking page.
 *
 * A scope with no password configured reports itself open and the card never
 * appears, so a fresh install works before anyone has set anything up.
 */

export type AuthScope = 'booth' | 'download';

interface ScopeStatus {
  required: boolean;
  authed: boolean;
  source: 'settings' | 'env' | null;
}

export type AuthStatus = Record<AuthScope, ScopeStatus>;

export function useAuthStatus() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error(String(res.status));
      setStatus(await res.json() as AuthStatus);
      setError(false);
    } catch {
      // If the server is unreachable the pages will surface their own errors;
      // the gate failing open here just avoids a second, misleading wall.
      setError(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { status, error, reload };
}

export default function PasswordGate({ scope, title, hint, children }: {
  scope: AuthScope;
  /** e.g. "Booth locked" — what the person is unlocking. */
  title: string;
  /** One line under the field, e.g. who to ask for the password. */
  hint: string;
  children: React.ReactNode;
}) {
  const { status, error, reload } = useAuthStatus();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setWrong(false);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, password }),
      });
      if (!res.ok) { setWrong(true); return; }
      setPassword('');
      await reload();
    } finally {
      setBusy(false);
    }
  }, [password, busy, scope, reload]);

  // Nothing to decide yet: render nothing rather than flashing the lock at
  // people who are already in, or the page at people who are not.
  if (!status && !error) return null;

  if (error || !status || !status[scope].required || status[scope].authed) {
    return <>{children}</>;
  }

  return (
    <main
      className="flex min-h-dvh items-center justify-center p-6"
      style={{ background: 'var(--shell-bg)' }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[400px] rounded-[26px] bg-white px-8 py-9 text-center shadow-[0_1px_3px_rgba(11,10,12,0.06),0_12px_32px_-16px_rgba(11,10,12,0.14)]"
      >
        <img src="/sp-dsac-logo.png" alt="SP DSAC" className="mx-auto h-10 w-auto" />
        <span className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]">
          <LockSimple size={22} weight="fill" />
        </span>
        <h1 className="mt-4 text-[1.35rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">
          {title}<span className="text-[var(--accent)]">.</span>
        </h1>
        <p className="mt-1.5 text-[0.85rem] text-[var(--ink-2)]">{hint}</p>

        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setWrong(false); }}
          placeholder="Password"
          autoFocus
          aria-label="Password"
          aria-invalid={wrong || undefined}
          className={`mt-6 w-full rounded-xl border px-4 py-3.5 text-center text-[1rem] tracking-[0.08em] outline-none transition ${
            wrong
              ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]'
              : 'border-[var(--border)] focus:border-[var(--accent)]'
          }`}
        />
        {wrong && (
          <p role="alert" className="mt-2 text-[0.8rem] font-semibold text-[var(--accent-ink)]">
            That password is not right. Try again.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--accent)] text-[0.95rem] font-semibold text-white shadow-[0_8px_24px_rgba(225,38,47,0.26)] transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
