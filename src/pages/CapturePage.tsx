import { useCallback, useState } from 'react';
import CameraView from '@/components/features/capture-photo/CameraView';
import QrDownloadScreen from '@/components/features/qr-download/QrDownloadScreen';
import { useRemote, type RemoteCommand } from '@/components/features/remote/useRemote';
import type { ComposedUploadResponse } from '@/types/download';

/**
 * There is no confirmation step. A guest is standing at the booth and the
 * organiser is holding the remote, so the photo goes straight to its QR code —
 * a retake is one tap away on the phone if it is wanted.
 */
type Step = 'camera' | 'uploading' | 'qr-download';

export default function CapturePage() {
  const [step, setStep] = useState<Step>('camera');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [composedDataUrl, setComposedDataUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [linkedInShareUrl, setLinkedInShareUrl] = useState<string | null>(null);

  const resetFlow = useCallback(() => {
    setUploadError(null);
    setComposedDataUrl(null);
    setDownloadUrl(null);
    setLinkedInShareUrl(null);
    setStep('camera');
  }, []);

  // Straight from shutter to QR code — upload as soon as the photo exists.
  const handleCapture = useCallback(async (blob: Blob, dataUrl: string) => {
    setComposedDataUrl(dataUrl);
    setUploadError(null);
    setStep('uploading');

    try {
      const body = new FormData();
      body.append('file', blob, 'composed-photo.jpg');

      const uploadRes = await fetch('/api/photos/composed', { method: 'POST', body });
      if (!uploadRes.ok) {
        const { error } = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(error ?? `HTTP ${uploadRes.status}`);
      }

      const data = await uploadRes.json() as ComposedUploadResponse;
      setDownloadUrl(data.downloadUrl);
      setLinkedInShareUrl(data.linkedInShareUrl ?? null);
      setStep('qr-download');
    } catch (err) {
      // Back to the camera rather than stranding the guest on a dead screen.
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setStep('camera');
    }
  }, []);

  // Tell the phone the booth is free again whenever we return to the camera.
  const handleRetake = useCallback(() => {
    void fetch('/api/remote/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    }).catch(() => {});
    resetFlow();
  }, [resetFlow]);

  // Retake is the only control the phone offers once a photo has landed, and
  // by then CameraView is unmounted — so the page itself has to listen for it.
  useRemote({
    onCommand: useCallback((cmd: RemoteCommand) => {
      if (cmd.action === 'retake') resetFlow();
    }, [resetFlow]),
  });

  return (
    // A plain div, not <main>: StudioShell renders the page's <main>, and
    // nesting one inside another is invalid and confuses assistive tech.
    <div
      data-testid="capture-page-root"
      className="relative flex h-dvh w-full flex-col overflow-hidden text-[var(--ink)]"
    >
      {step === 'camera' && (
        <>
          <CameraView onCapture={handleCapture} onRetake={handleRetake} />
          {uploadError && (
            <p
              data-testid="upload-error"
              role="alert"
              className="absolute bottom-24 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-xl border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-white px-5 py-3 text-center text-sm font-medium text-[var(--accent-ink)] shadow-[0_10px_30px_-10px_rgba(11,10,12,0.25)]"
            >
              {uploadError}
            </p>
          )}
        </>
      )}

      {step === 'uploading' && (
        <div className="flex h-full flex-col items-center justify-center gap-4" style={{ background: 'var(--shell-bg)' }}>
          {composedDataUrl && (
            <img src={composedDataUrl} alt="" className="max-h-[52vh] max-w-[70vw] rounded-[18px] shadow-[0_20px_50px_-18px_rgba(11,10,12,0.4)]" />
          )}
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-[var(--border)]">
            <span className="block h-full w-1/2 animate-pulse rounded-full bg-[var(--accent)]" />
          </div>
          <p className="text-[0.95rem] font-semibold text-[var(--ink)]">Preparing your download…</p>
        </div>
      )}

      {step === 'qr-download' && composedDataUrl && downloadUrl && (
        <QrDownloadScreen
          composedDataUrl={composedDataUrl}
          downloadUrl={downloadUrl}
          linkedInShareUrl={linkedInShareUrl ?? undefined}
          onDone={handleRetake}
          onRetake={handleRetake}
        />
      )}
    </div>
  );
}
