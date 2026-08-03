import { useCallback, useEffect, useState } from 'react';
import type { DateStamp, FrameConfig } from '@/types/frame';
import { BUILT_IN_FRAMES } from '@/types/frame';

/**
 * The frame catalogue as the app sees it: the built-in frames merged with
 * anything uploaded through settings, each carrying its operator-set weight.
 *
 * Built-in artwork and date-stamp geometry come from the bundle, never the
 * server — only weight and enabled are stored remotely. If the API is
 * unreachable the kiosk still gets its built-ins at default weight, so a
 * settings outage can never leave someone unable to take a photo.
 */

export interface FrameSetting {
  weight: number;
  enabled: boolean;
}

interface ApiCustomFrame {
  id: string;
  label: string;
  src: string;
  dateStamp: DateStamp | null;
}

export interface UseFrameCatalogue {
  frames: FrameConfig[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  saveSettings: (settings: Record<string, FrameSetting>) => Promise<void>;
  uploadFrame: (file: File, label: string) => Promise<void>;
  deleteFrame: (id: string) => Promise<void>;
}

function applySettings(
  frames: FrameConfig[],
  settings: Record<string, FrameSetting>,
): FrameConfig[] {
  return frames.map((frame) => {
    const s = settings[frame.id];
    return {
      ...frame,
      weight: s ? s.weight : (frame.weight ?? 1),
      enabled: s ? s.enabled : (frame.enabled ?? true),
    };
  });
}

export function useFrameCatalogue(): UseFrameCatalogue {
  const [frames, setFrames] = useState<FrameConfig[]>(BUILT_IN_FRAMES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/frames');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        settings: Record<string, FrameSetting>;
        custom: ApiCustomFrame[];
      };

      const custom: FrameConfig[] = (data.custom ?? []).map((f) => ({
        id: f.id,
        label: f.label,
        src: f.src,
        dateStamp: f.dateStamp ?? undefined,
        // An uploaded frame has no printed "on" to sit beside, so the caption
        // is written as one line low on the artwork with a nominal gap.
        captionSlot: f.dateStamp ? undefined : {
          nameRightFrac: 0.475,
          dateLeftFrac: 0.525,
          baselineFrac: 0.955,
          sizeFrac: 0.045,
          colour: '#17161a',
          gapFrac: 0.006,
          maxNameWidthFrac: 0.42,
        },
        builtIn: false,
      }));

      setFrames(applySettings([...BUILT_IN_FRAMES, ...custom], data.settings ?? {}));
      setError(null);
    } catch (err) {
      // Degrade to built-ins rather than blocking capture.
      setFrames(BUILT_IN_FRAMES);
      setError(err instanceof Error ? err.message : 'Could not load frames');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const saveSettings = useCallback(async (settings: Record<string, FrameSetting>) => {
    const res = await fetch('/api/frames/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!res.ok) throw new Error(`Could not save (HTTP ${res.status})`);
    await reload();
  }, [reload]);

  const uploadFrame = useCallback(async (file: File, label: string) => {
    const body = new FormData();
    body.append('file', file);
    body.append('label', label);
    const res = await fetch('/api/frames', { method: 'POST', body });
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: null }));
      throw new Error(msg ?? `Upload failed (HTTP ${res.status})`);
    }
    await reload();
  }, [reload]);

  const deleteFrame = useCallback(async (id: string) => {
    const res = await fetch(`/api/frames/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Could not delete (HTTP ${res.status})`);
    await reload();
  }, [reload]);

  return { frames, loading, error, reload, saveSettings, uploadFrame, deleteFrame };
}
