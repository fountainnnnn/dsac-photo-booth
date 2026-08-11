import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowCounterClockwise, LockSimple, Scan } from '@phosphor-icons/react';
import AmbientOrb from '@/components/ui/AmbientOrb';
import SectionHeader from '@/components/ui/SectionHeader';
import Button from '@/components/ui/Button';

export interface QrDownloadScreenProps {
  composedDataUrl: string;
  downloadUrl: string;
  /**
   * When this photo's link stops working, as the upload returned it. It is
   * computed from the link window in Settings at the moment of the shot, so
   * saying it here cannot drift from what the booth will actually honour.
   */
  expiresAt?: string;
  onDone: () => void;
  onRetake: () => void;
}

/** The sentinel a never-expiring link carries — a date no event outlives. */
const NEVER_EXPIRES = '9999-12-31T23:59:59.999Z';

/**
 * How long the link has left, said the way a guest would say it. Rounded up:
 * "6 days" on a link with six and a half left is a promise the booth keeps,
 * where rounding down invites someone back to a dead page.
 */
function linkLifetime(expiresAt: string | undefined): string {
  if (!expiresAt) return '';
  if (expiresAt === NEVER_EXPIRES) return 'The link does not expire.';

  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'The link has already expired.';

  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 2) return 'The link is available for an hour.';
  if (hours < 48) return `The link is available for ${hours} hours.`;

  const days = Math.ceil(hours / 24);
  return `The link is available for ${days} days.`;
}

export default function QrDownloadScreen({
  composedDataUrl,
  downloadUrl,
  expiresAt,
  onDone,
  onRetake,
}: QrDownloadScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // The photo password, read back from the deployment. The guest has to type it
  // on the download page, so the booth says it here rather than making them ask
  // — the screen they scan from is the natural place to read it off.
  //
  // This screen only ever renders behind the booth gate, which is what the
  // endpoint requires. If it refuses, or no password is set, the block simply
  // does not appear: the QR is the part that must never fail.
  const [photoPassword, setPhotoPassword] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/settings/passwords/reveal');
        if (!res.ok) return;
        const data = await res.json() as Record<string, { password: string | null }>;
        if (live) setPhotoPassword(data.download?.password ?? null);
      } catch {
        // No password on screen is a smaller failure than a broken QR screen.
      }
    })();
    return () => { live = false; };
  }, []);

  // Drawn locally rather than fetched as a PNG from the API. A network image
  // gives the one screen that must never fail a single point of failure — and
  // an absolute src (built from the server's own idea of its origin) can be
  // unreachable or blocked as mixed content from the kiosk browser, which
  // renders as a silently blank box. Encoding here needs nothing but the URL.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!downloadUrl) {
      setQrError('No download link was returned.');
      return;
    }

    QRCode.toCanvas(canvas, downloadUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#17161a', light: '#FFFFFF' },
    })
      .then(() => setQrError(null))
      .catch((err: unknown) => {
        console.error('[DSAC] QR render failed:', err);
        setQrError('Could not draw the QR code.');
      });
  }, [downloadUrl]);

  return (
    <div
      data-testid="qr-screen-root"
      className="grid h-full w-full md:grid-cols-[1fr_460px]"
    >
      {/* Photo — deep band, so the light panel reads as the active surface */}
      <div
        className="relative flex min-h-0 items-center justify-center overflow-hidden p-8"
        style={{ background: 'var(--stage)' }}
      >
        <AmbientOrb tone="dark" />
        <img
          data-testid="qr-screen-photo"
          src={composedDataUrl}
          alt="Your composed event photo"
          className="dsac-rise max-h-full max-w-full rounded-[20px] object-contain shadow-[0_24px_70px_-16px_rgba(0,0,0,0.6)]"
        />
      </div>

      {/* Panel */}
      {/* The panel itself never scrolls: Retake and Done are the way off this
          screen and must stay on it. Only the middle scrolls, and only on a
          short display — on the kiosk it never has to. */}
      <aside className="relative flex flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--background)] px-9 py-6">
        <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-10 w-auto shrink-0 self-start" />

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto py-5">
          <SectionHeader
            className="dsac-rise"
            eyebrow="Your photo is ready"
            title={
              <>
                Scan to download<span className="text-[var(--accent)]">.</span>
              </>
            }
          />

          {/* QR — white bed, because dense marks need solid ground */}
          <div className="dsac-rise flex flex-col items-center gap-4">
            <div className="relative rounded-[20px] bg-white p-4 shadow-[0_10px_30px_-10px_rgba(11,10,12,0.18)]">
              <canvas
                ref={canvasRef}
                data-testid="qr-screen-qr-canvas"
                aria-label="QR code to download your photo"
                width={220}
                height={220}
              />
              {/* Never leave a blank white square: if encoding fails, say so and
                  show the raw link so the photo is still reachable. */}
              {qrError && (
                <div
                  data-testid="qr-screen-qr-error"
                  role="alert"
                  className="absolute inset-5 flex flex-col items-center justify-center gap-2 bg-white px-3 text-center"
                >
                  <p className="text-[0.75rem] font-semibold text-[var(--accent-ink)]">{qrError}</p>
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      className="break-all text-[0.625rem] leading-[1.4] text-[var(--ink-2)] underline"
                    >
                      {downloadUrl}
                    </a>
                  )}
                </div>
              )}
            </div>
            <p
              data-testid="qr-screen-instruction"
              className="flex max-w-[34ch] items-center justify-center gap-1.5 text-center text-[0.75rem] leading-[1.5] text-[var(--ink-3)]"
            >
              <Scan className="h-3.5 w-3.5 shrink-0" />
              Opens a private download page. {linkLifetime(expiresAt)}
            </p>
          </div>

          {/* The password, big enough to read from arm's length and from a
              queue. Letter-spaced and monospaced so l/1 and O/0 cannot be
              mistaken for each other when someone types it on a phone. */}
          {photoPassword && (
            <div
              data-testid="qr-screen-password"
              className="dsac-rise flex w-full max-w-[300px] flex-col items-center gap-1.5 rounded-[20px] border border-[var(--border)] bg-white px-6 py-4 text-center shadow-[0_10px_30px_-14px_rgba(11,10,12,0.16)]"
            >
              <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">
                <LockSimple className="h-3.5 w-3.5 shrink-0" weight="fill" />
                Photo password
              </p>
              <p
                data-testid="qr-screen-password-value"
                className="select-all break-all font-mono text-[1.55rem] font-semibold leading-[1.2] tracking-[0.12em] text-[var(--ink)]"
              >
                {photoPassword}
              </p>
              <p className="text-[0.72rem] leading-[1.5] text-[var(--ink-3)]">
                Enter this on your phone to open the photo.
              </p>
            </div>
          )}

        </div>

        {/* Actions */}
        <div
          data-testid="qr-screen-controls"
          className="flex w-full shrink-0 items-center justify-center gap-3"
        >
          <Button
            data-testid="qr-screen-retake"
            type="button"
            variant="secondary"
            onClick={onRetake}
            className="flex-1"
          >
            <ArrowCounterClockwise className="h-4 w-4" />
            Retake
          </Button>
          <Button
            data-testid="qr-screen-done"
            type="button"
            onClick={onDone}
            className="flex-1"
          >
            Done
          </Button>
        </div>
      </aside>
    </div>
  );
}
