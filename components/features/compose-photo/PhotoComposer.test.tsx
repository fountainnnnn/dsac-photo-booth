import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhotoComposer from './PhotoComposer';

// Mock the hook so we control its output without canvas
vi.mock('./usePhotoComposer', () => ({
  usePhotoComposer: vi.fn(),
}));

import { usePhotoComposer } from './usePhotoComposer';

const FAKE_DATA_URL = 'data:image/jpeg;base64,/9j/composedresult';
const FAKE_CUTOUT_URL = 'data:image/png;base64,cutoutdata';

function mockHook(overrides: Partial<ReturnType<typeof usePhotoComposer>>) {
  const defaults = {
    composedDataUrl: null,
    isComposing: false,
    progress: '',
    error: null,
    compose: vi.fn(),
  };
  vi.mocked(usePhotoComposer).mockReturnValue({ ...defaults, ...overrides });
}

describe('PhotoComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders root with correct role and aria-label', () => {
    mockHook({ isComposing: true });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={vi.fn()}
        onError={vi.fn()}
      />
    );
    const root = screen.getByTestId('photo-composer-root');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-label')).toBe('Composing your photo, please wait');
  });

  it('shows spinner while isComposing', () => {
    mockHook({ isComposing: true });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByTestId('photo-composer-spinner')).toBeDefined();
  });

  it('does not show spinner when not composing', () => {
    mockHook({ isComposing: false });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.queryByTestId('photo-composer-spinner')).toBeNull();
  });

  it('shows error message when error is set', () => {
    mockHook({ error: 'Canvas failed' });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(screen.getByTestId('photo-composer-error').textContent).toBe('Canvas failed');
  });

  it('calls onComposed when composedDataUrl becomes available', () => {
    const onComposed = vi.fn();
    mockHook({ composedDataUrl: FAKE_DATA_URL });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={onComposed}
        onError={vi.fn()}
      />
    );
    expect(onComposed).toHaveBeenCalledWith(FAKE_DATA_URL);
  });

  it('calls onError when error becomes set', () => {
    const onError = vi.fn();
    mockHook({ error: 'Something went wrong' });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={vi.fn()}
        onError={onError}
      />
    );
    expect(onError).toHaveBeenCalledWith('Something went wrong');
  });

  it('invokes compose() on mount', () => {
    const compose = vi.fn();
    mockHook({ compose });
    render(
      <PhotoComposer
        photoDataUrl={FAKE_CUTOUT_URL}
        onComposed={vi.fn()}
        onError={vi.fn()}
      />
    );
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
