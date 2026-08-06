import { describe, expect, it } from 'vitest';
import { GALLERY_TTL_OPTIONS, splitTtl } from './CaptureSettingsCard';
import { DEFAULT_CAPTURE_SETTINGS } from './useCaptureSettings';

/**
 * Retention is the one setting where a wrong default destroys an event's
 * photographs rather than merely looking odd, so the default is pinned here
 * on purpose: a booth that has never been configured must keep everything.
 *
 * Changing this test is a decision to delete other people's pictures. It
 * should feel like one.
 */
describe('gallery retention', () => {
  it('keeps photos forever until an operator says otherwise', () => {
    expect(DEFAULT_CAPTURE_SETTINGS.galleryTtlHours).toBe(0);
  });

  it('offers Never first, then whole numbers of days', () => {
    expect(GALLERY_TTL_OPTIONS[0].hours).toBe(0);
    expect(GALLERY_TTL_OPTIONS.map(o => o.hours)).toEqual([0, 168, 720, 2160]);
  });

  /**
   * The custom field shows a span back in the largest unit that divides it,
   * so every quick pick has to survive the round trip — a "30 days" button
   * that reads back as 720 hours would look like a different setting.
   */
  it('shows each quick pick back in the unit its label uses', () => {
    for (const o of GALLERY_TTL_OPTIONS.filter(x => x.hours > 0)) {
      const { value, unit } = splitTtl(o.hours);
      expect(unit).toBe('days');
      expect(o.label).toBe(`${value} days`);
    }
  });
});
