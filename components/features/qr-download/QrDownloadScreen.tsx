import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { RotateCcw, ScanLine } from 'lucide-react';
import LinkedInGlyph from '@/components/ui/LinkedInGlyph';
import AmbientOrb from '@/components/ui/AmbientOrb';
import SectionHeader from '@/components/ui/SectionHeader';
import Button from '@/components/ui/Button';

export interface QrDownloadScreenProps {
  composedDataUrl: string;
  downloadUrl: string;
  linkedInShareUrl?: string;
  onDone: () => void;
  onRetake: () => void;
}

export default function QrDownloadScreen({
  composedDataUrl,
  downloadUrl,
  linkedInShareUrl,
  onDone,
  onRetake,
}: QrDownloadScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrError, setQrError] = useState<string | null>(null);

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
      <aside className="relative flex flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--background)] px-9 py-8">
        <img src="/sp-dsac-logo.png" alt="SP DSAC" className="h-10 w-auto shrink-0 self-start" />

        <div className="flex flex-1 flex-col items-center justify-center gap-7 py-8">
          <SectionHeader
            className="dsac-rise"
            eyebrow="Your photo is ready"
            title={
              <>
                Scan to download<span className="text-[var(--accent)]">.</span>
              </>
            }
            subtitle="Point your phone camera at the code to save it."
          />

          {/* QR — white bed, because dense marks need solid ground */}
          <div className="dsac-rise flex flex-col items-center gap-4">
            <div className="relative rounded-[20px] bg-white p-5 shadow-[0_10px_30px_-10px_rgba(11,10,12,0.18)]">
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
              <ScanLine className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Opens a private download page. The link is available for 7 days.
            </p>
          </div>

          {linkedInShareUrl && (
            <a
              href={linkedInShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] px-5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(11,10,12,0.18),0_8px_24px_rgba(10,102,194,0.26)] transition-all duration-150 hover:-translate-y-px hover:bg-[#004182] active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a66c2] focus-visible:ring-offset-2"
            >
              <LinkedInGlyph className="h-4 w-4" />
              Share on LinkedIn
            </a>
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
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
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
