import { useEffect } from 'react';
import { usePhotoComposer } from './usePhotoComposer';

interface Props {
  photoDataUrl: string;
  onComposed: (composedDataUrl: string) => void;
  onError: (error: string) => void;
}

export default function PhotoComposer({ photoDataUrl, onComposed, onError }: Props) {
  const { composedDataUrl, isComposing, progress, error, compose } = usePhotoComposer({
    photoDataUrl,
  });

  useEffect(() => {
    compose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (composedDataUrl) {
      onComposed(composedDataUrl);
    }
  }, [composedDataUrl, onComposed]);

  useEffect(() => {
    if (error) {
      onError(error);
    }
  }, [error, onError]);

  return (
    <div
      data-testid="photo-composer-root"
      role="status"
      aria-label="Composing your photo, please wait"
      className="flex flex-1 flex-col items-center justify-center bg-[#f4f1ec] px-6 text-[#11100f]"
    >
      {isComposing && (
        <>
          <div className="w-full max-w-sm border border-[#d7d2ca] bg-white p-5 shadow-[0_18px_45px_rgba(17,16,15,0.08)]">
            <div
              data-testid="photo-composer-spinner"
              className="h-1.5 w-full overflow-hidden bg-[#eee8df]"
            >
              <span className="block h-full w-2/3 animate-pulse bg-[#e1262f]" />
            </div>
            <p className="mt-4 text-sm font-semibold text-[#11100f]">
              Building final photo
            </p>
          </div>
          {progress && (
            <p data-testid="photo-composer-progress" className="mt-4 text-sm text-[#6e675d]">
              {progress}
            </p>
          )}
        </>
      )}
      {error && (
        <p
          data-testid="photo-composer-error"
          className="px-4 text-center text-sm text-[#b4232c]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
