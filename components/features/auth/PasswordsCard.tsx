import { LockSimple, LockSimpleOpen } from '@phosphor-icons/react';
import { useAuthStatus } from './PasswordGate';

/**
 * Say whether the booth password is on, and where it is set. Read-only.
 *
 * The password itself is never shown: Settings sits behind it, but a booth
 * left unattended is exactly the case that matters, and it is the same
 * password on every device. It is set on the Environment tab, which writes the
 * .env the booth reads.
 *
 * Guests' photos have no password. Their links carry a random UUID, so only
 * someone handed the QR code or the link can open one.
 */
export default function PasswordsCard() {
  const { status } = useAuthStatus();
  const required = status?.booth?.required;

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Access</p>
      <p className="mt-1.5 text-[0.75rem] leading-[1.6] text-[var(--ink-3)]">
        One password, for this interface. Guests open their photo straight from
        the QR code with no password: each link is unguessable.
      </p>

      <div className="mt-4">
        <p className="flex items-center gap-1.5 text-[0.78rem] font-semibold text-[var(--ink-2)]">
          {required
            ? <LockSimple size={14} weight="fill" className="text-[#127a4a]" />
            : <LockSimpleOpen size={14} className="text-[var(--accent)]" />}
          Booth password
        </p>
        <p className={`mt-1 text-[0.72rem] leading-[1.5] ${
          required ? 'text-[var(--ink-3)]' : 'font-medium text-[var(--accent-ink)]'
        }`}>
          {required
            ? 'Locks capture, gallery, settings and the phone remote.'
            : 'Not set — anyone with the link can open this interface and take photos.'}
        </p>
        <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] px-3.5 py-2.5 text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
          Not shown here — it is the same password on every device, and this screen
          is often one someone else can see. Change it on the{' '}
          <span className="font-semibold text-[var(--ink-2)]">Environment</span> tab,
          as <span className="font-semibold text-[var(--ink-2)]">BOOTH_PASSWORD</span>.
        </p>
      </div>
    </section>
  );
}
