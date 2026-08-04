import { useCallback, useEffect, useState } from 'react';
import type { ImageFilters } from '@/types/editor';
import { DEFAULT_FILTERS } from '@/types/editor';
import { DEFAULT_EVENT_DETAILS } from '@/types/frame';

/**
 * Timer and image adjustments, which live in Settings rather than on the
 * capture screen. The kiosk reads them; the settings page writes them.
 *
 * A failed fetch falls back to the defaults instead of blocking capture —
 * losing the configured look is far better than losing the shutter.
 */

export interface CaptureSettings {
  timerSecs: number;
  selectedFrameId: string;
  filters: ImageFilters;
  /** Printed on frames that do not bake their own caption. */
  eventName: string;
  /** ISO yyyy-mm-dd. Empty means "use today". */
  eventDate: string;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  timerSecs: 3,
  selectedFrameId: '',
  filters: DEFAULT_FILTERS,
  eventName: DEFAULT_EVENT_DETAILS.eventName,
  eventDate: DEFAULT_EVENT_DETAILS.eventDate,
};

export function useCaptureSettings() {
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_CAPTURE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/capture');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { settings: CaptureSettings };
      setSettings({ ...DEFAULT_CAPTURE_SETTINGS, ...data.settings });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (next: CaptureSettings) => {
    setSettings(next); // optimistic: the sliders must not lag the finger
    const res = await fetch('/api/settings/capture', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next }),
    });
    if (!res.ok) throw new Error(`Could not save (HTTP ${res.status})`);
  }, []);

  return { settings, setSettings, save, reload, loading, error };
}
