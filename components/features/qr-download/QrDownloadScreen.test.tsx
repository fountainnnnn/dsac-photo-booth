import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QrDownloadScreen from './QrDownloadScreen';

// ---------------------------------------------------------------------------
// Mock qrcode — canvas operations are not available in jsdom
// ---------------------------------------------------------------------------
const toCanvasMock = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toCanvas: toCanvasMock }, toCanvas: toCanvasMock }));

const FAKE_COMPOSED = 'data:image/jpeg;base64,/9j/composedFake';
const FAKE_DOWNLOAD = 'https://example.com/download/abc-123';

describe('QrDownloadScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the root container', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('qr-screen-root')).toBeDefined();
  });

  it('renders the composed photo thumbnail', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    const img = screen.getByTestId('qr-screen-photo') as HTMLImageElement;
    expect(img.src).toBe(FAKE_COMPOSED);
    expect(img.alt).toBe('Your composed event photo');
  });

  it('renders the QR canvas element', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    const canvas = screen.getByTestId('qr-screen-qr-canvas');
    expect(canvas).toBeDefined();
    expect(canvas.getAttribute('aria-label')).toBe('QR code to download your photo');
  });

  it('calls QRCode.toCanvas with the download URL', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(toCanvasMock).toHaveBeenCalledTimes(1);
    expect(toCanvasMock).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      FAKE_DOWNLOAD,
      expect.objectContaining({ width: 220 })
    );
  });

  it('renders instruction text', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    const instruction = screen.getByTestId('qr-screen-instruction');
    expect(instruction.textContent).toContain('Opens a private download page');
  });

  it('renders controls container', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('qr-screen-controls')).toBeDefined();
  });

  it('calls onDone when Done is clicked', () => {
    const onDone = vi.fn();
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={onDone}
        onRetake={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('qr-screen-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onRetake when Retake is clicked', () => {
    const onRetake = vi.fn();
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={onRetake}
      />
    );

    fireEvent.click(screen.getByTestId('qr-screen-retake'));
    expect(onRetake).toHaveBeenCalledTimes(1);
  });

  it('Done button label is "Done"', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('qr-screen-done').textContent).toBe('Done');
  });

  it('Retake button label is "Retake"', () => {
    render(
      <QrDownloadScreen
        composedDataUrl={FAKE_COMPOSED}
        downloadUrl={FAKE_DOWNLOAD}
        onDone={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('qr-screen-retake').textContent).toBe('Retake');
  });
});
