import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ComposedPreview from './ComposedPreview';

const FAKE_COMPOSED_URL = 'data:image/jpeg;base64,/9j/composedresult';
const FAKE_CAPTURED_AT = '2024-06-15T10:30:00.000Z';

describe('ComposedPreview', () => {
  it('renders the composed image', () => {
    render(
      <ComposedPreview
        composedDataUrl={FAKE_COMPOSED_URL}
        capturedAt={FAKE_CAPTURED_AT}
        onContinue={vi.fn()}
        onRetake={vi.fn()}
      />
    );
    const img = screen.getByTestId('composed-preview-image') as HTMLImageElement;
    expect(img.src).toBe(FAKE_COMPOSED_URL);
    expect(img.alt).toBe('Your composed DSAC event photo');
  });

  it('renders root, controls, continue and retake elements', () => {
    render(
      <ComposedPreview
        composedDataUrl={FAKE_COMPOSED_URL}
        capturedAt={FAKE_CAPTURED_AT}
        onContinue={vi.fn()}
        onRetake={vi.fn()}
      />
    );
    expect(screen.getByTestId('composed-preview-root')).toBeDefined();
    expect(screen.getByTestId('composed-preview-controls')).toBeDefined();
    expect(screen.getByTestId('composed-preview-continue')).toBeDefined();
    expect(screen.getByTestId('composed-preview-retake')).toBeDefined();
  });

  it('calls onContinue when "Continue" is clicked', () => {
    const onContinue = vi.fn();
    render(
      <ComposedPreview
        composedDataUrl={FAKE_COMPOSED_URL}
        capturedAt={FAKE_CAPTURED_AT}
        onContinue={onContinue}
        onRetake={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('composed-preview-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('calls onRetake when "Retake" is clicked', () => {
    const onRetake = vi.fn();
    render(
      <ComposedPreview
        composedDataUrl={FAKE_COMPOSED_URL}
        capturedAt={FAKE_CAPTURED_AT}
        onContinue={vi.fn()}
        onRetake={onRetake}
      />
    );
    fireEvent.click(screen.getByTestId('composed-preview-retake'));
    expect(onRetake).toHaveBeenCalledTimes(1);
  });

  it('continue button label is "Continue"', () => {
    render(
      <ComposedPreview
        composedDataUrl={FAKE_COMPOSED_URL}
        capturedAt={FAKE_CAPTURED_AT}
        onContinue={vi.fn()}
        onRetake={vi.fn()}
      />
    );
    expect(screen.getByTestId('composed-preview-continue').textContent).toBe('Continue');
  });

  it('retake button label is "Retake"', () => {
    render(
      <ComposedPreview
        composedDataUrl={FAKE_COMPOSED_URL}
        capturedAt={FAKE_CAPTURED_AT}
        onContinue={vi.fn()}
        onRetake={vi.fn()}
      />
    );
    expect(screen.getByTestId('composed-preview-retake').textContent).toBe('Retake');
  });
});
