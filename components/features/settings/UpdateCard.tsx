import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, CheckCircle, DownloadSimple, Warning } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';

/**
 * New versions of the installed app.
 *
 * Reports and offers; never acts on its own. A booth is live in front of a
 * queue, so nothing downloads or restarts until the operator says so — see
 * server/updates.mjs for the reasoning and electron/main.cjs for the updater
 * itself.
 *
 * The card hides entirely outside the installed app: a checkout updates with
 * git, and the portable .exe cannot patch itself, so an offer to update either
 * one would be a button that could only fail.
 */

type UpdateStatus =
  | 'unsupported' | 'idle' | 'checking' | 'current'
  | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  supported: boolean;
  status: UpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  releaseNotes: string | null;
  percent: number;
  error: string | null;
  checkedAt: string | null;
}

/** Poll only while something is moving; a settled card has nothing to watch. */
const BUSY: UpdateStatus[] = ['checking', 'downloading'];

export default function UpdateCard() {
  const [state, setState] = useState<UpdateState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/update');
      if (!res.ok) throw new Error(String(res.status));
      setState(await res.json() as UpdateState);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!state || !BUSY.includes(state.status)) return;
    const id = setInterval(() => { void load(); }, 1000);
    return () => clearInterval(id);
  }, [state, load]);

  const act = useCallback(async (action: 'check' | 'download' | 'install') => {
    try {
      const res = await fetch(`/api/update/${action}`, { method: 'POST' });
      setState(await res.json() as UpdateState);
    } catch { /* the next poll reports it */ }
  }, []);

  if (!state?.supported) return null;

  const { status } = state;

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">App updates</p>
        <span className="ml-auto text-[0.72rem] font-semibold text-[var(--ink-3)]">
          v{state.currentVersion}
        </span>
      </div>

      {status === 'current' && (
        <p className="mt-3 flex items-center gap-2 text-[0.78rem] text-[var(--ink-2)]">
          <CheckCircle size={16} weight="fill" className="text-[#127a4a]" />
          This is the newest version.
        </p>
      )}

      {status === 'checking' && (
        <p className="mt-3 text-[0.78rem] text-[var(--ink-2)]">Checking GitHub…</p>
      )}

      {(status === 'idle') && (
        <p className="mt-3 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
          The booth checks once when it opens. Check again whenever you like —
          nothing downloads or installs without you.
        </p>
      )}

      {status === 'available' && (
        <>
          <p className="mt-3 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
            Version <strong>{state.availableVersion}</strong> is available.
          </p>
          {state.releaseNotes && (
            <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-line text-[0.72rem] leading-[1.6] text-[var(--ink-3)]">
              {state.releaseNotes}
            </p>
          )}
        </>
      )}

      {status === 'downloading' && (
        <div className="mt-3">
          <p className="text-[0.78rem] text-[var(--ink-2)]">
            Downloading {state.availableVersion}… {state.percent}%
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        </div>
      )}

      {status === 'ready' && (
        <p className="mt-3 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
          Version {state.availableVersion} is downloaded. Installing closes the
          booth and reopens it — do this between events, not during one.
        </p>
      )}

      {status === 'error' && (
        <p className="mt-3 flex items-start gap-2 text-[0.75rem] leading-[1.6] text-[var(--ink-2)]">
          <Warning size={15} weight="fill" className="mt-px shrink-0 text-[var(--accent)]" />
          <span>{state.error ?? 'The update check failed.'}</span>
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        {status === 'available' && (
          <Button size="sm" onClick={() => void act('download')}>
            <DownloadSimple size={15} /> Download
          </Button>
        )}
        {status === 'ready' && (
          <Button size="sm" onClick={() => void act('install')}>
            Install and restart
          </Button>
        )}
        {status !== 'downloading' && (
          <Button
            size="sm"
            variant={status === 'available' || status === 'ready' ? 'ghost' : 'secondary'}
            onClick={() => void act('check')}
            disabled={status === 'checking'}
          >
            <ArrowClockwise size={15} /> Check now
          </Button>
        )}
      </div>
    </section>
  );
}
