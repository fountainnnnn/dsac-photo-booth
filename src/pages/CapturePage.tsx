import { useCallback, useState } from 'react';
import CameraView from '@/components/features/capture-photo/CameraView';
import QrDownloadScreen from '@/components/features/qr-download/QrDownloadScreen';
import type { ComposedUploadResponse } from '@/types/download';
import { DEFAULT_SCENE_CHOICE, type SceneChoice } from '@/types/scene';
import { useTypedBackground } from '@/components/features/capture-photo/scene/useTypedBackground';

/**
 * There is no confirmation step. A guest is standing at the booth, so the
 * photo goes straight to its QR code — a retake is one tap away on that
 * screen if it is wanted.
 */
type Step = 'camera' | 'uploading' | 'qr-download';

export default function CapturePage() {
  const [step, setStep] = useState<Step>('camera');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [composedDataUrl, setComposedDataUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  // Carried through so the QR screen can state this photo's own link window
  // rather than a figure written into the copy.
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  // The guest's background and avatar. Kept here, not in the camera view, so
  // a retake keeps them; the next guest simply picks again.
  const [choice, setChoice] = useState<SceneChoice>(DEFAULT_SCENE_CHOICE);
  // Asked again each time the camera comes back, so a key saved in Settings
  // turns typing on for the next guest.
  const typing = useTypedBackground(step === 'camera');

  const resetFlow = useCallback(() => {
    setUploadError(null);
    setComposedDataUrl(null);
    setDownloadUrl(null);
    setExpiresAt(undefined);
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
      setExpiresAt(data.expiresAt);
      setStep('qr-download');
    } catch (err) {
      // Back to the camera rather than stranding the guest on a dead screen.
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setStep('camera');
    }
  }, []);

  const handleRetake = resetFlow;

  // The next guest starts from scratch: their own background, avatar and
  // tries. A retake (above) keeps all three.
  const handleDone = useCallback(() => {
    setChoice(DEFAULT_SCENE_CHOICE);
    typing.reset();
    handleRetake();
  }, [handleRetake, typing]);

  return (
    // A plain div, not <main>: StudioShell renders the page's <main>, and
    // nesting one inside another is invalid and confuses assistive tech.
    <div
      data-testid="capture-page-root"
      className="relative flex h-dvh w-full flex-col overflow-hidden text-[var(--ink)]"
    >
      {step === 'camera' && (
        <>
          <CameraView
            onCapture={handleCapture}
            choice={choice}
            onChoiceChange={setChoice}
            typing={typing}
          />
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
          expiresAt={expiresAt}
          onDone={handleDone}
          onRetake={handleRetake}
        />
      )}
    </div>
  );
}
