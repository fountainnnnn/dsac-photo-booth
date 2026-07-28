import { useCallback, useState } from 'react';
import CameraView from '@/components/features/capture-photo/CameraView';
import ComposedPreview from '@/components/features/compose-photo/ComposedPreview';
import QrDownloadScreen from '@/components/features/qr-download/QrDownloadScreen';
import type { CapturedPhoto } from '@/types/capture';
import type { ComposedUploadResponse } from '@/types/download';

type Step = 'camera' | 'composed' | 'uploading-composed' | 'qr-download';

export default function CapturePage() {
  const [step, setStep] = useState<Step>('camera');
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [composedDataUrl, setComposedDataUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [linkedInShareUrl, setLinkedInShareUrl] = useState<string | null>(null);

  const resetFlow = useCallback(() => {
    setCaptured(null);
    setUploadError(null);
    setComposedDataUrl(null);
    setDownloadUrl(null);
    setLinkedInShareUrl(null);
    setStep('camera');
  }, []);

  const handleCapture = useCallback((blob: Blob, dataUrl: string) => {
    const createdAt = new Date().toISOString();
    setCaptured({ dataUrl, blob, createdAt, composedDataUrl: dataUrl });
    setComposedDataUrl(dataUrl);
    setUploadError(null);
    setStep('composed');
  }, []);

  const handleContinue = useCallback(async () => {
    if (!composedDataUrl) return;
    setStep('uploading-composed');
    setUploadError(null);

    try {
      const res = await fetch(composedDataUrl);
      const blob = await res.blob();
      const body = new FormData();
      body.append('file', blob, 'composed-photo.jpg');

      const uploadRes = await fetch('/api/photos/composed', { method: 'POST', body });
      if (!uploadRes.ok) {
        const { error } = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(error ?? `HTTP ${uploadRes.status}`);
      }

      const data = await uploadRes.json() as ComposedUploadResponse;
      setCaptured(prev => prev ? { ...prev, composedId: data.token, composedUrl: data.downloadUrl } : prev);
      setDownloadUrl(data.downloadUrl);
      setLinkedInShareUrl(data.linkedInShareUrl ?? null);
      setStep('qr-download');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setStep('composed');
    }
  }, [composedDataUrl]);

  return (
    <main
      data-testid="capture-page-root"
      className="flex h-dvh w-full flex-col overflow-hidden bg-[var(--background)] text-[var(--ink)]"
    >
      {step === 'camera' && (
        <>
          <CameraView onCapture={handleCapture} />
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

      {(step === 'composed' || step === 'uploading-composed') && composedDataUrl && captured && (
        <>
          <ComposedPreview
            composedDataUrl={composedDataUrl}
            capturedAt={captured.createdAt ?? ''}
            onContinue={handleContinue}
            onRetake={resetFlow}
            isUploading={step === 'uploading-composed'}
          />
          {uploadError && (
            <p
              data-testid="composed-upload-error"
              role="alert"
              className="absolute bottom-24 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-xl border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-white px-5 py-3 text-center text-sm font-medium text-[var(--accent-ink)] shadow-[0_10px_30px_-10px_rgba(11,10,12,0.25)]"
            >
              {uploadError}
            </p>
          )}
        </>
      )}

      {step === 'qr-download' && composedDataUrl && downloadUrl && (
        <QrDownloadScreen
          composedDataUrl={composedDataUrl}
          downloadUrl={downloadUrl}
          linkedInShareUrl={linkedInShareUrl ?? undefined}
          onDone={resetFlow}
          onRetake={resetFlow}
        />
      )}
    </main>
  );
}
