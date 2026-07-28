import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PhotoPreview from './PhotoPreview';

const FAKE_URL = 'data:image/jpeg;base64,/9j/fakedata';

describe('PhotoPreview', () => {
  it('renders the captured image', () => {
    render(
      <PhotoPreview
        imageUrl={FAKE_URL}
        onConfirm={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    const img = screen.getByTestId('photo-preview-image') as HTMLImageElement;
    expect(img.src).toBe(FAKE_URL);
    expect(img.alt).toBe('Captured photo preview');
  });

  it('renders root and control elements', () => {
    render(
      <PhotoPreview
        imageUrl={FAKE_URL}
        onConfirm={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('photo-preview-root')).toBeDefined();
    expect(screen.getByTestId('photo-preview-controls')).toBeDefined();
    expect(screen.getByTestId('photo-preview-confirm')).toBeDefined();
    expect(screen.getByTestId('photo-preview-retake')).toBeDefined();
  });

  it('calls onConfirm when "Use Photo" is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <PhotoPreview
        imageUrl={FAKE_URL}
        onConfirm={onConfirm}
        onRetake={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('photo-preview-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onRetake when "Retake" is clicked', () => {
    const onRetake = vi.fn();
    render(
      <PhotoPreview
        imageUrl={FAKE_URL}
        onConfirm={vi.fn()}
        onRetake={onRetake}
      />
    );

    fireEvent.click(screen.getByTestId('photo-preview-retake'));
    expect(onRetake).toHaveBeenCalledTimes(1);
  });

  it('confirm button label is "Use Photo"', () => {
    render(
      <PhotoPreview
        imageUrl={FAKE_URL}
        onConfirm={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('photo-preview-confirm').textContent).toBe(
      'Use Photo'
    );
  });

  it('retake button label is "Retake"', () => {
    render(
      <PhotoPreview
        imageUrl={FAKE_URL}
        onConfirm={vi.fn()}
        onRetake={vi.fn()}
      />
    );

    expect(screen.getByTestId('photo-preview-retake').textContent).toBe(
      'Retake'
    );
  });
});
