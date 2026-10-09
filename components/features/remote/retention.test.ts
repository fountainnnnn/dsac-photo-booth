import { describe, expect, it } from 'vitest';
import { PHOTO_MINUTE_OPTIONS } from './CaptureSettingsCard';
import { DEFAULT_CAPTURE_SETTINGS } from './useCaptureSettings';

/**
 * Retention is the one setting where a wrong default changes what happens to
 * people's pictures rather than merely looking odd, so it is pinned here on
 * purpose. Open House keeps a photo only long enough for the guest to scan and
 * save it, then deletes it from the laptop: ten minutes unless an operator
 * picks another span, and never "forever".
 */
describe('photo retention', () => {
  it('deletes photos ten minutes after their QR code, by default', () => {
    expect(DEFAULT_CAPTURE_SETTINGS.photoMinutes).toBe(10);
  });

  it('offers the default, and no way to keep photos indefinitely', () => {
    expect(PHOTO_MINUTE_OPTIONS).toContain(10);
    expect(PHOTO_MINUTE_OPTIONS.every(m => m > 0 && m <= 60)).toBe(true);
  });
});
