import { useCallback, useEffect, useState } from 'react';
import { Camera, Eye, EyeSlash, Image as ImageIcon } from '@phosphor-icons/react';

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
  /**
   * The deployment supplies this password, so Settings may show it but not
   * change it — only whoever can set the deployment's secrets can do that.
   */
  managed?: boolean;
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

/**
 * The line the art panel carries. It is the only copy that differs between the
 * two scopes, so it lives here rather than being threaded through as props no
 * caller would ever want to vary.
 */
const PITCH: Record<AuthScope, { eyebrow: string; line: string }> = {
  booth: {
    eyebrow: 'SP Data Science & Analytics Centre',
    line: 'Three, two, one — and the booth does the rest.',
  },
  download: {
    eyebrow: 'SP Data Science & Analytics Centre',
    line: 'Your photo is waiting on the other side of this.',
  },
};

/** A camera for the booth itself, a photo for the picture waiting on the other side. */
const ICON: Record<AuthScope, typeof Camera> = { booth: Camera, download: ImageIcon };

/** What the submit button says, so it reads as opening a booth or a photo rather than a generic form. */
const UNLOCK_LABEL: Record<AuthScope, string> = {
  booth: 'Unlock the booth',
  download: 'Unlock my photo',
};

/**
 * The left half of the card: a photo of an actual photo booth — flash lit,
 * curtain drawn, filmstrip curling off the camera — so the lock screen reads
 * as this app's lock screen and not a generic login form. Dropped entirely on
 * narrow screens, where a guest on a phone wants the field, not the scenery.
 */
function AuroraPanel({ scope }: { scope: AuthScope }) {
  const { eyebrow, line } = PITCH[scope];

  return (
    <div className="relative hidden w-[300px] shrink-0 overflow-hidden rounded-[20px] md:block">
      <img
        src="/login-photobooth.png"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* The copy sits on the lower half, so darken just that end rather than
          dimming the whole photo to buy the contrast. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[62%]"
        style={{ background: 'linear-gradient(to top, rgba(12,8,20,0.8), transparent)' }}
      />

      <div className="relative flex h-full flex-col justify-end p-7 text-white">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/70">
          {eyebrow}
        </p>
        <p className="mt-2 text-[1.3rem] font-semibold leading-[1.25] tracking-[-0.01em]">
          {line}
        </p>
      </div>
    </div>
  );
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
  const [show, setShow] = useState(false);
  const ScopeIcon = ICON[scope];

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
      <div className="dsac-rise flex w-full max-w-[760px] gap-0 rounded-[26px] bg-white p-3 shadow-[0_1px_3px_rgba(11,10,12,0.06),0_18px_44px_-20px_rgba(11,10,12,0.22)]">
        <AuroraPanel scope={scope} />

        <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col justify-center px-5 py-8 sm:px-9">
          <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-9 w-auto self-start" />

          <span className="mt-7 flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]">
            <ScopeIcon size={21} weight="fill" />
          </span>
          <h1 className="mt-4 text-[1.5rem] font-semibold tracking-[-0.015em] text-[var(--ink)]">
            {title}<span className="text-[var(--accent)]">.</span>
          </h1>
          <p className="mt-1.5 text-[0.875rem] text-[var(--ink-2)]">{hint}</p>

          <label htmlFor="dsac-gate-password" className="mt-7 text-[0.78rem] font-semibold text-[var(--ink-2)]">
            Password
          </label>
          {/* The reveal button sits inside the field, so the input carries the
              padding that keeps the text clear of it. */}
          <div className="relative mt-2">
            <input
              id="dsac-gate-password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setWrong(false); }}
              placeholder="••••••••"
              autoFocus
              aria-invalid={wrong || undefined}
              className={`w-full rounded-xl border bg-white py-3.5 pl-4 pr-12 text-[1rem] tracking-[0.06em] outline-none transition-[border-color,box-shadow] duration-150 ${
                wrong
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]'
                  : 'border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_12%,transparent)]'
              }`}
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide the password' : 'Show the password'}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ink-3)] transition-colors hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {show ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {wrong && (
            <p role="alert" className="mt-2 text-[0.8rem] font-semibold text-[var(--accent-ink)]">
              That password is not right. Try again.
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--accent)] text-[0.95rem] font-semibold text-white shadow-[0_8px_24px_rgba(225,38,47,0.26)] transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            {busy ? 'Checking…' : UNLOCK_LABEL[scope]}
          </button>
        </form>
      </div>
    </main>
  );
}
