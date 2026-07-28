import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const FAKE_CUTOUT_URL = 'data:image/png;base64,cutoutdata';
const FAKE_DATA_URL = 'data:image/jpeg;base64,/9j/composedresult';

// Minimal canvas context stub
function makeCtxStub() {
  return {
    drawImage: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 120 })),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

// Import hook after mocks are set up
import { usePhotoComposer } from './usePhotoComposer';

describe('usePhotoComposer', () => {
  let ctxStub: ReturnType<typeof makeCtxStub>;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let imageInstances: Array<{ onload?: () => void; onerror?: () => void; src: string; width: number; height: number; crossOrigin: string }>;

  beforeEach(() => {
    ctxStub = makeCtxStub();
    imageInstances = [];

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => FAKE_DATA_URL) as typeof HTMLCanvasElement.prototype.toDataURL;

    // Stub Image constructor
    vi.stubGlobal('Image', class {
      src = '';
      onload?: () => void;
      onerror?: () => void;
      width = 800;
      height = 600;
      crossOrigin = '';

      constructor() {
        imageInstances.push(this as unknown as typeof imageInstances[0]);
      }
    });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts with null composedDataUrl and isComposing=false', () => {
    const { result } = renderHook(() =>
      usePhotoComposer({ photoDataUrl: FAKE_CUTOUT_URL })
    );

    expect(result.current.composedDataUrl).toBeNull();
    expect(result.current.isComposing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe('');
  });

  it('sets isComposing=true when compose() is called', async () => {
    const { result } = renderHook(() =>
      usePhotoComposer({ photoDataUrl: FAKE_CUTOUT_URL })
    );

    let composePromise: Promise<void>;
    act(() => {
      composePromise = result.current.compose();
    });

    expect(result.current.isComposing).toBe(true);

    // Resolve the image loads (bg image + cutout image)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      imageInstances.forEach((img) => img.onload?.());
    });

    await act(async () => { await composePromise!; });
    expect(result.current.isComposing).toBe(false);
  });

  it('resolves composedDataUrl after successful composition', async () => {
    const { result } = renderHook(() =>
      usePhotoComposer({ photoDataUrl: FAKE_CUTOUT_URL })
    );

    let composePromise: Promise<void>;
    act(() => {
      composePromise = result.current.compose();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      imageInstances.forEach((img) => img.onload?.());
    });

    await act(async () => { await composePromise!; });

    expect(result.current.composedDataUrl).toBe(FAKE_DATA_URL);
    expect(result.current.error).toBeNull();
  });

  it('draws photo on canvas', async () => {
    const { result } = renderHook(() =>
      usePhotoComposer({ photoDataUrl: FAKE_CUTOUT_URL })
    );

    let composePromise: Promise<void>;
    act(() => {
      composePromise = result.current.compose();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      imageInstances.forEach((img) => img.onload?.());
    });

    await act(async () => { await composePromise!; });

    expect(ctxStub.drawImage).toHaveBeenCalled();
  });

  it('sets error when image fails to load', async () => {
    const { result } = renderHook(() =>
      usePhotoComposer({ photoDataUrl: FAKE_CUTOUT_URL })
    );

    let composePromise: Promise<void>;
    act(() => {
      composePromise = result.current.compose();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      imageInstances.forEach((img) => img.onerror?.());
    });

    await act(async () => { await composePromise!; });

    expect(result.current.error).toBeTruthy();
    expect(result.current.composedDataUrl).toBeNull();
    expect(result.current.isComposing).toBe(false);
  });
});
