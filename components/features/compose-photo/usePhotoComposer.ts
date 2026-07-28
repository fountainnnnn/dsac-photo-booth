import { useCallback, useState } from 'react';

export interface UsePhotoComposerOptions {
  photoDataUrl: string;
  outputWidth?: number;
  outputHeight?: number;
}

export interface UsePhotoComposerResult {
  composedDataUrl: string | null;
  isComposing: boolean;
  progress: string;
  error: string | null;
  compose: () => Promise<void>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    if (src.startsWith('http')) img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

export function usePhotoComposer({
  photoDataUrl,
  outputWidth,
  outputHeight,
}: UsePhotoComposerOptions): UsePhotoComposerResult {
  const [composedDataUrl, setComposedDataUrl] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const compose = useCallback(async () => {
    setIsComposing(true);
    setError(null);
    setProgress('Compositing image…');

    try {
      const photo = await loadImage(photoDataUrl);

      const canvasW = outputWidth ?? photo.width;
      const canvasH = outputHeight ?? photo.height;

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2d canvas context');

      // 1. Draw captured photo (already has filters + overlays baked in)
      ctx.drawImage(photo, 0, 0, canvasW, canvasH);

      // 2. Timestamp stamp — bottom-right corner
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
      const stampText = `${dateStr}  ${timeStr}`;

      const font = 'bold 28px Arial, sans-serif';
      ctx.font = font;
      const metrics = ctx.measureText(stampText);
      const textW = metrics.width;
      const textH = 28;
      const margin = 20;
      const bgPad = 10;
      const stampBgX = canvasW - textW - margin - bgPad * 2;
      const stampBgY = canvasH - textH - margin - bgPad * 2;

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      const rc2d = ctx as CanvasRenderingContext2D;
      if (typeof rc2d.roundRect === 'function') {
        rc2d.roundRect(stampBgX, stampBgY, textW + bgPad * 2, textH + bgPad * 2, 6);
      } else {
        rc2d.rect(stampBgX, stampBgY, textW + bgPad * 2, textH + bgPad * 2);
      }
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = font;
      ctx.fillText(stampText, stampBgX + bgPad, stampBgY + bgPad + textH - 4);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      setComposedDataUrl(dataUrl);
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Composition failed');
      setProgress('');
    } finally {
      setIsComposing(false);
    }
  }, [photoDataUrl, outputWidth, outputHeight]);

  return { composedDataUrl, isComposing, progress, error, compose };
}
