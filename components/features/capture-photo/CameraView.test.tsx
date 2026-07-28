import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CameraView from './CameraView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeStream = { getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }> };

function makeFakeStream(): FakeStream {
  return { getTracks: () => [{ stop: vi.fn() }] };
}

function mockGetUserMedia(impl: () => Promise<FakeStream>) {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    writable: true,
    value: { getUserMedia: impl },
  });
}

// HTMLVideoElement.play is not implemented in jsdom — stub it
window.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the video element and capture controls', async () => {
    mockGetUserMedia(() => Promise.resolve(makeFakeStream()));

    const onCapture = vi.fn();
    await act(async () => {
      render(<CameraView onCapture={onCapture} />);
    });

    expect(screen.getByTestId('capture-camera-root')).toBeDefined();
    expect(screen.getByTestId('capture-video-element')).toBeDefined();
  });

  it('renders the capture controls once the stream is granted', async () => {
    mockGetUserMedia(() => Promise.resolve(makeFakeStream()));

    await act(async () => {
      render(<CameraView onCapture={vi.fn()} />);
    });
    // Controls are rendered when there is no error
    await waitFor(() =>
      expect(screen.getByTestId('capture-controls')).toBeDefined()
    );
  });

  it('shows a permission notice when camera access is denied', async () => {
    const deniedError = Object.assign(new Error('denied'), {
      name: 'NotAllowedError',
    });
    mockGetUserMedia(() => Promise.reject(deniedError));

    render(<CameraView onCapture={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('capture-permission-notice')).toBeDefined()
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Camera access was denied'
    );
  });

  it('calls onError callback when the camera fails', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    mockGetUserMedia(() => Promise.reject(err));

    const onError = vi.fn();
    render(<CameraView onCapture={vi.fn()} onError={onError} />);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
  });

  it('shows a "no camera found" message on NotFoundError', async () => {
    const err = Object.assign(new Error('not found'), {
      name: 'NotFoundError',
    });
    mockGetUserMedia(() => Promise.reject(err));

    render(<CameraView onCapture={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('capture-permission-notice')).toBeDefined()
    );
    expect(screen.getByRole('alert').textContent).toContain('No camera found');
  });

  it('shows unsupported message when mediaDevices is missing', async () => {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      writable: true,
      value: undefined,
    });

    render(<CameraView onCapture={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('capture-permission-notice')).toBeDefined()
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'not supported'
    );
  });

  it('capture button is disabled until streaming starts', async () => {
    // getUserMedia never resolves — stream never starts
    mockGetUserMedia(() => new Promise(() => {}));

    render(<CameraView onCapture={vi.fn()} />);

    const btn = await screen.findByTestId('capture-button');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('fires onCapture with a Blob when the shutter is pressed', async () => {
    mockGetUserMedia(() => Promise.resolve(makeFakeStream()));

    const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });

    // Stub canvas APIs (jsdom has no canvas implementation)
    const fakeCtx = {
      drawImage: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D
    );
    const toDataURLSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,fake');
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (
        this: HTMLCanvasElement,
        cb: BlobCallback | null
      ) {
        cb?.(fakeBlob);
      });

    // Stub videoWidth / videoHeight so the canvas capture path doesn't bail
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 480,
    });

    const onCapture = vi.fn();
    render(<CameraView onCapture={onCapture} />);

    // Fire canPlay inside act() so React flushes the isStreaming=true state update
    const video = screen.getByTestId('capture-video-element');
    await act(async () => {
      fireEvent.canPlay(video);
    });

    // Button should now be enabled
    const btn = screen.getByTestId('capture-button');
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    const [blob, dataUrl] = onCapture.mock.calls[0];
    expect(blob).toBe(fakeBlob);
    expect(dataUrl).toContain('data:image/jpeg');
    expect(fakeCtx.drawImage).toHaveBeenCalled();

    toDataURLSpy.mockRestore();
    toBlobSpy.mockRestore();
  });
});
