import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowSquareOut, Copy, DeviceMobile, Eye, EyeSlash, WifiHigh, WifiSlash } from '@phosphor-icons/react';

/**
 * The QR code that hands the organiser the shutter.
 *
 * Kept hidden behind a tap: this screen is often on a TV in front of guests,
 * and anyone who scans it can fire the camera. Revealing it is a deliberate act.
 */
export default function RemoteAccessCard() {
  const [revealed, setRevealed] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  const [listeners, setListeners] = useState(0);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The public origin comes from the server: it knows the tunnel URL, and the
  // browser's own location is usually localhost, which no phone can reach.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [health, remote] = await Promise.all([
          fetch('/api/health').then(r => r.json()),
          fetch('/api/remote/state').then(r => r.json()),
        ]);
        if (!alive) return;
        setOrigin(health.publicOrigin ?? null);
        setListeners(remote.listeners ?? 0);
      } catch { /* the card just shows as unavailable */ }
    };
    void poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const remoteUrl = origin ? `${origin.replace(/\/$/, '')}/remote` : null;

  useEffect(() => {
    if (!revealed || !remoteUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, remoteUrl, {
      width: 208,
      margin: 2,
      color: { dark: '#17161a', light: '#FFFFFF' },
    }).catch(() => { /* the link below still works */ });
  }, [revealed, remoteUrl]);

  const copy = useCallback(async () => {
    if (!remoteUrl) return;
    await navigator.clipboard.writeText(remoteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [remoteUrl]);

  const isLocal = !!origin && /localhost|127\.0\.0\.1/.test(origin);

  return (
    <section className="rounded-[18px] border border-[var(--border)] px-6 py-5">
      <div className="flex items-center gap-2">
        <DeviceMobile size={18} className="text-[var(--ink-2)]" />
        <p className="text-[0.92rem] font-semibold text-[var(--ink)]">Phone remote</p>
        <span className={`ml-auto flex items-center gap-1.5 text-[0.72rem] font-semibold ${
          listeners > 1 ? 'text-[#127a4a]' : 'text-[var(--ink-3)]'
        }`}>
          {listeners > 1 ? <WifiHigh size={14} weight="fill" /> : <WifiSlash size={14} />}
          {listeners > 1 ? 'Phone connected' : 'No phone'}
        </span>
      </div>

      <p className="mt-2 text-[0.78rem] leading-[1.6] text-[var(--ink-2)]">
        Scan to control the camera from your phone while you stand with the
        guests. After each shot the phone offers a retake.
      </p>

      <div className="mt-3.5 flex flex-col items-center gap-3 rounded-xl bg-[var(--shell-bg)] px-4 py-4">
        {revealed ? (
          <>
            <div className="rounded-xl bg-white p-3 shadow-[0_6px_18px_-8px_rgba(11,10,12,0.25)]">
              <canvas ref={canvasRef} width={208} height={208} aria-label="QR code to open the camera remote" />
            </div>
            <code className="max-w-full break-all text-center text-[0.7rem] leading-[1.4] text-[var(--ink-2)]">
              {remoteUrl ?? 'Waiting for a public URL…'}
            </code>
            <div className="flex w-full gap-2">
              <button type="button" onClick={copy} disabled={!remoteUrl}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-white text-[0.78rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-40">
                <Copy size={15} />
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a href="/remote" target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-white text-[0.78rem] font-semibold text-[var(--ink-2)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]">
                <ArrowSquareOut size={15} />
                Open here
              </a>
            </div>
            <button type="button" onClick={() => setRevealed(false)}
              className="inline-flex items-center gap-1.5 text-[0.75rem] font-semibold text-[var(--ink-3)] transition hover:text-[var(--ink)]">
              <EyeSlash size={14} />
              Hide
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setRevealed(true)}
            className="inline-flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--ink-3)] text-[0.85rem] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
            <Eye size={20} />
            Reveal remote QR
            <span className="text-[0.7rem] font-normal text-[var(--ink-3)]">
              Hidden by default — anyone who scans it can fire the camera
            </span>
          </button>
        )}
      </div>

      {isLocal && (
        <p className="mt-2.5 text-[0.72rem] leading-[1.5] text-[var(--accent-ink)]">
          The public URL is still localhost, so a phone cannot reach it. Check
          that the tunnel came up in the terminal.
        </p>
      )}
    </section>
  );
}
