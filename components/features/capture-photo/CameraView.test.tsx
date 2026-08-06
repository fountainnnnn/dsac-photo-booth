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

/**
 * The countdown and image adjustments come from the settings API now, so the
 * tests have to say which they want. Left to a failed fetch the hook falls back
 * to a 3s countdown, and a test pressing the shutter would be timing a
 * three-second wait rather than testing capture.
 */
function mockSettings(timerSecs: number) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/settings/capture')) {
      return new Response(JSON.stringify({
        settings: {
          timerSecs,
          filters: { brightness: 100, contrast: 100, saturation: 100, hue: 0 },
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/frames')) {
      return new Response(JSON.stringify({ settings: {}, custom: [] }),
        { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/remote/poll')) {
      // The real endpoint holds the request open. Never resolve, so the poll
      // loop stays parked instead of spinning through the test.
      return new Promise<Response>(() => {});
    }
    // Remote state publishing and anything else — accepted and ignored.
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockSettings(0); // no countdown unless a test asks for one
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
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D
    );
    // The shutter renders onto a canvas of its own; note its size so the test
    // below can prove it is the camera's, not the on-screen preview's.
    const outputSize: { w: number; h: number }[] = [];
    const toDataURLSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation(function (this: HTMLCanvasElement) {
        outputSize.push({ w: this.width, h: this.height });
        return 'data:image/jpeg;base64,fake';
      });
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

    // The photo is the camera's own resolution. It used to be a copy of the
    // preview canvas, which is sized to the stage in screen pixels — that is
    // how a 1080p camera was producing a photo the size of the window.
    expect(outputSize.at(-1)).toEqual({ w: 640, h: 480 });

    toDataURLSpy.mockRestore();
    toBlobSpy.mockRestore();
  });

  // The booth ships with a countdown so guests get a moment to pose, and the
  // organiser fires it from across the room. Pressing the shutter must start
  // that countdown rather than capturing on the spot.
  it('counts down before capturing when a timer is configured', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSettings(3);
    mockGetUserMedia(() => Promise.resolve(makeFakeStream()));

    const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {
        drawImage: vi.fn(), scale: vi.fn(), translate: vi.fn(),
        save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,fake');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement, cb: BlobCallback | null,
    ) { cb?.(fakeBlob); });

    const onCapture = vi.fn();
    render(<CameraView onCapture={onCapture} />);

    const video = screen.getByTestId('capture-video-element');
    await act(async () => { fireEvent.canPlay(video); });
    await waitFor(() =>
      expect((screen.getByTestId('capture-button') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('capture-button'));

    // Still counting — nothing captured yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onCapture).not.toHaveBeenCalled();

    // Countdown elapses, then the shutter fires.
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));

    vi.useRealTimers();
  });
});
