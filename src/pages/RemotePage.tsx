import { useCallback, useEffect, useState } from 'react';
import {
  ArrowCounterClockwise, ArrowSquareOut, Camera, CheckCircle, DiceFive, WifiHigh, WifiSlash, X,
} from '@phosphor-icons/react';
import { useRemote } from '@/components/features/remote/useRemote';

/**
 * The organiser's phone. They stand with the guests, well away from the
 * laptop, so this is the shutter.
 *
 * Built for one-handed use at arm's length: a few very large targets, no
 * scrolling, and the primary action always in the same place. Once a photo
 * lands, the only choice offered is whether to retake it.
 */
export default function RemotePage() {
  const { state, connected, send } = useRemote();
  const [busy, setBusy] = useState(false);

  // Keep the screen awake — a locked phone mid-event is useless.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => { /* unsupported */ });
    return () => { void lock?.release().catch(() => {}); };
  }, []);

  const act = useCallback(async (action: Parameters<typeof send>[0]) => {
    setBusy(true);
    await send(action);
    // Just long enough to swallow a double-tap; the real state arrives by SSE.
    setTimeout(() => setBusy(false), 400);
  }, [send]);

  const { phase, countdown, frameLabel, streaming } = state;
  const counting = phase === 'counting';
  const captured = phase === 'captured';

  return (
    <main
      className="flex min-h-dvh flex-col px-6 py-7"
      style={{ background: 'var(--stage)', color: '#fff' }}
    >
      {/* Status bar */}
      <header className="flex shrink-0 items-center gap-2">
        <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-7 w-auto rounded bg-white/90 px-1.5 py-1" />
        <span className="text-[0.9rem] font-semibold">Camera remote</span>
        <span className={`ml-auto flex items-center gap-1.5 text-[0.75rem] font-semibold ${
          connected ? 'text-emerald-400' : 'text-amber-400'
        }`}>
          {connected ? <WifiHigh size={16} weight="fill" /> : <WifiSlash size={16} weight="fill" />}
          {connected ? 'Connected' : 'Reconnecting…'}
        </span>
      </header>

      {/* What the kiosk is doing */}
      <section className="mt-8 shrink-0 text-center">
        {captured ? (
          <>
            {/* The booth is showing the QR code; mirror the photo so the
                organiser can judge it without walking over. */}
            {state.photoToken ? (
              <img
                src={`/api/preview/${encodeURIComponent(state.photoToken)}`}
                alt="The photo just taken"
                className="mx-auto max-h-[34vh] rounded-[14px] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.8)]"
              />
            ) : (
              <CheckCircle size={54} weight="fill" className="mx-auto text-emerald-400" />
            )}
            <h1 className="mt-3 text-[1.6rem] font-medium leading-tight">Photo taken<span className="text-[var(--accent)]">.</span></h1>
            <p className="mt-2 text-[0.95rem] text-white/60">
              They&rsquo;re scanning the QR code now. Happy with it?
            </p>
          </>
        ) : counting ? (
          <>
            <div className="mx-auto flex h-[132px] w-[132px] items-center justify-center rounded-full border-4 border-[var(--accent)]">
              <span className="text-[4rem] font-medium leading-none tabular-nums">{countdown}</span>
            </div>
            <h1 className="mt-4 text-[1.6rem] font-medium leading-tight">Get ready…</h1>
          </>
        ) : (
          <>
            <h1 className="text-[1.9rem] font-medium leading-tight">Ready<span className="text-[var(--accent)]">.</span></h1>
            <p className="mt-2 text-[0.95rem] text-white/60">
              {streaming ? 'Camera is live. Tap to take the photo.' : 'Waiting for the kiosk camera…'}
            </p>
          </>
        )}

        <p className="mt-4 text-[0.8rem] text-white/40">
          Frame: <strong className="font-semibold text-white/75">{frameLabel ?? 'none yet'}</strong>
        </p>
      </section>

      {/* Controls */}
      <section className="mt-auto flex shrink-0 flex-col gap-3 pt-8">
        {captured ? (
          <>
            <button
              type="button"
              onClick={() => act('retake')}
              disabled={busy}
              className="flex min-h-[92px] w-full items-center justify-center gap-3 rounded-[22px] bg-white text-[1.25rem] font-semibold text-[var(--stage)] transition active:scale-[0.98] disabled:opacity-50"
            >
              <ArrowCounterClockwise size={28} weight="bold" />
              Retake
            </button>
            {state.downloadUrl && (
              <a
                href={state.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[62px] w-full items-center justify-center gap-2.5 rounded-[20px] border-2 border-white/20 text-[1rem] font-semibold text-white transition active:scale-[0.98]"
              >
                <ArrowSquareOut size={22} />
                Open the photo
              </a>
            )}
          </>
        ) : counting ? (
          <button
            type="button"
            onClick={() => act('cancel')}
            disabled={busy}
            className="flex min-h-[92px] w-full items-center justify-center gap-3 rounded-[22px] border-2 border-white/25 text-[1.25rem] font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            <X size={28} weight="bold" />
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => act('capture')}
              disabled={busy || !streaming}
              className="flex min-h-[124px] w-full items-center justify-center gap-3 rounded-[26px] bg-[var(--accent)] text-[1.45rem] font-semibold text-white shadow-[0_14px_40px_-10px_rgba(225,38,47,0.65)] transition active:scale-[0.98] disabled:opacity-40"
            >
              <Camera size={36} weight="fill" />
              Take photo
            </button>
            <button
              type="button"
              onClick={() => act('spin')}
              disabled={busy}
              className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-[20px] border-2 border-white/20 text-[1.05rem] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              <DiceFive size={24} />
              Spin for a frame
            </button>
          </>
        )}
      </section>

      <p className="mt-6 shrink-0 text-center text-[0.72rem] text-white/30">
        Keep this page open. It stays in sync with the booth automatically.
      </p>
    </main>
  );
}
