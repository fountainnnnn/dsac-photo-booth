import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeSlash, LockSimple, LockSimpleOpen } from '@phosphor-icons/react';
import { useAuthStatus, type AuthScope, type AuthStatus } from './PasswordGate';

/**
 * Show the photo password, and say where both of them are set. Read-only.
 *
 * They are read-only here and set on the Environment tab, which writes the
 * .env the booth reads. This card only reads them back: the booth password is
 * withheld even from an operator who is already inside, because it is the same
 * password on every device and Settings is often on a borrowed screen.
 *
 * The booth password is not shown either — Settings sits behind it, but a
 * booth left unattended is exactly the case that matters, and it is the same
 * password on every device. The photo password is shown, hidden until asked
 * for, because it exists to be said out loud to a queue of guests.
 */

interface ScopeReveal {
  revealable: boolean;
  password: string | null;
  source: 'settings' | 'env' | null;
}

type RevealMap = Record<AuthScope, ScopeReveal>;

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
  const { status } = useAuthStatus();
  const [reveal, setReveal] = useState<RevealMap | null>(null);

  // The card only renders behind the booth gate, so this request is already
  // authenticated; a 401 here means the session lapsed while Settings was
  // open, and the rows simply fall back to saying nothing can be shown.
  const loadReveal = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/passwords/reveal');
      if (!res.ok) throw new Error(String(res.status));
      setReveal(await res.json() as RevealMap);
    } catch {
      setReveal(null);
    }
  }, []);

  useEffect(() => { void loadReveal(); }, [loadReveal]);

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Access</p>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        Two passwords: one for this interface, one guests type to open their
        photo. Both live with the deployment and are changed there, not here.
        The photo password is shown so you can read it out to guests; the booth
        password is not shown at all.
      </p>

      <div className="mt-4 flex flex-col gap-5">
        {(Object.keys(SCOPE_COPY) as AuthScope[]).map(scope => (
          <ScopeRow
            key={scope}
            scope={scope}
            status={status}
            reveal={reveal?.[scope] ?? null}
          />
        ))}
      </div>
    </section>
  );
}

function ScopeRow({ scope, status, reveal }: {
  scope: AuthScope;
  status: AuthStatus | null;
  reveal: ScopeReveal | null;
}) {
  const copy = SCOPE_COPY[scope];
  const s = status?.[scope];

  return (
    <div>
      <p className="flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
        {s?.required
          ? <LockSimple size={14} weight="fill" className="text-[#127a4a]" />
          : <LockSimpleOpen size={14} className="text-[var(--accent)]" />}
        {copy.label}
      </p>
      <p className={`mt-1 text-[0.72rem] leading-[1.5] ${
        s?.required ? 'text-[var(--ink-3)]' : 'font-medium text-[var(--accent-ink)]'
      }`}>
        {s?.required ? copy.what : copy.offWarning}
      </p>

      {scope === 'booth'
        ? <WhereToChange />
        : <CurrentPassword label={copy.label} reveal={reveal} />}
    </div>
  );
}

/**
 * The booth password is never shown, so this stands in its place: the one
 * question an operator staring at this row actually has is where it lives.
 *
 * It used to send them to the Cloudflare dashboard, which was right while the
 * booth was hosted there and is now simply a wrong instruction — the booth
 * runs on the laptop and the password is set on the Environment tab. Pointing
 * an operator at a dashboard they cannot reach, for a booth in front of them,
 * is worse than saying nothing.
 */
function WhereToChange() {
  return (
    <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] px-3.5 py-2.5 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
      Not shown here — it is the same password on every device, and this screen
      is often one someone else can see. Change it on the{' '}
      <span className="font-semibold text-[var(--ink-2)]">Environment</span> tab,
      as <span className="font-semibold text-[var(--ink-2)]">BOOTH_PASSWORD</span>.
    </p>
  );
}

/**
 * The password as it stands, in whichever of the three states applies.
 *
 * Hidden by default: Settings is often on a screen someone else can see, and
 * an operator glancing at this card should not broadcast the photo password to
 * the queue behind them. The eye is a deliberate act.
 */
function CurrentPassword({ label, reveal }: {
  label: string;
  reveal: ScopeReveal | null;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const name = label.toLowerCase();

  const copy = async () => {
    if (!reveal?.password) return;
    try {
      await navigator.clipboard?.writeText(reveal.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // The password is on screen behind the eye either way, so there is
      // nothing to apologise for.
    }
  };

  // Still loading, or the request was refused: say nothing rather than guess.
  if (!reveal) return null;

  if (reveal.source === 'settings') {
    return (
      <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] px-3.5 py-2.5 text-[0.72rem] leading-[1.5] text-[var(--ink-3)]">
        Left over from when passwords were set here: it is a salted hash, which
        is one-way by design, so it cannot be shown. Setting one on the
        deployment replaces it.
      </p>
    );
  }

  if (!reveal.password) {
    return (
      <p className="mt-2 text-[0.72rem] leading-[1.5] text-[var(--ink-3)]">
        No password to show — this scope is open.
      </p>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        type={shown ? 'text' : 'password'}
        value={reveal.password}
        readOnly
        aria-label={`Current ${name}`}
        className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--shell-bg)] px-3.5 py-2.5 text-[0.85rem] text-[var(--ink-2)] outline-none"
      />
      <button
        type="button"
        onClick={() => setShown(v => !v)}
        aria-pressed={shown}
        aria-label={shown ? `Hide the ${name}` : `Show the ${name}`}
        title={shown ? 'Hide' : 'Show'}
        className="shrink-0 rounded-xl border border-[var(--border)] px-3 text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy the ${name}`}
        title={copied ? 'Copied' : 'Copy'}
        className="shrink-0 rounded-xl border border-[var(--border)] px-3 text-[var(--ink-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {copied
          ? <Check size={16} weight="bold" className="text-[#127a4a]" />
          : <Copy size={16} />}
      </button>
    </div>
  );
}
