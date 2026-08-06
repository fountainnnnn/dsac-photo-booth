import { useCallback, useEffect, useState } from 'react';
import type { LookRamp, ImageFilters } from '@/types/editor';
import { DEFAULT_FILTERS, DEFAULT_RAMP } from '@/types/editor';
import { DEFAULT_EVENT_DETAILS } from '@/types/frame';

/**
 * Timer and image adjustments, which live in Settings rather than on the
 * capture screen. The kiosk reads them; the settings page writes them.
 *
 * A failed fetch falls back to the defaults instead of blocking capture —
 * losing the configured look is far better than losing the shutter.
 */

/**
 * The part of the camera's picture actually used, as fractions of the frame.
 *
 * Always 16:9, the camera's own shape, so cropping never changes the output
 * aspect and nothing downstream has to compensate. The whole frame is
 * `{ x: 0, y: 0, w: 1, h: 1 }`.
 */
export interface CameraCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_FRAME: CameraCrop = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The same region in the camera's own coordinates.
 *
 * Everything an operator looks at is mirrored — the booth shows people their
 * reflection, and the crop editor mirrors its preview to match — so the region
 * is stored the way it was drawn, in mirrored space. Sampling the raw video
 * needs it flipped back, or a box dragged over the left of the preview
 * photographs the right of the room.
 */
export function unmirrorCrop(crop: CameraCrop): CameraCrop {
  return { ...crop, x: 1 - crop.x - crop.w };
}

export interface CaptureSettings {
  timerSecs: number;
  selectedFrameId: string;
  filters: ImageFilters;
  /**
   * How the Look is spread across the picture — evenly, or as a ramp that
   * starts at one edge and fades to the untouched camera. Kept beside
   * `filters` rather than inside it because a CSS filter string cannot
   * express a ramp — it is painted as a second layer at draw time.
   */
  lookRamp: LookRamp;
  /**
   * Which camera to shoot with, as a MediaDevices deviceId. Empty means the
   * browser's default — the built-in one on a laptop, which is rarely the
   * best camera present at an event.
   */
  cameraDeviceId: string;
  /** Printed on frames that do not bake their own caption. */
  eventName: string;
  /**
   * Two framings from one camera: the whole scene, or the region set below.
   * Kept as a flag rather than "crop === FULL_FRAME" so an operator can switch
   * back to the wide shot without losing the region they lined up earlier.
   */
  cropEnabled: boolean;
  crop: CameraCrop;
  /**
   * How long a guest's download link keeps working, with 0 meaning never
   * expires. Hours rather than days because the shortest useful setting is
   * shorter than a day — a company that wants the links dead by the time the
   * afternoon's event is packed up cannot say that in whole days.
   *
   * This governs the link only. The photo itself stays in the gallery until an
   * operator deletes it — or until `galleryTtlHours` below comes for it.
   */
  linkTtlHours: number;
  /**
   * How long the photo itself is kept before the booth deletes it on its own,
   * with 0 meaning kept forever. Measured from the moment the shutter went,
   * never from the link's expiry: the two clocks are deliberately unrelated,
   * so a link can lapse in an hour while the picture it pointed at lives a
   * month, or the other way about.
   *
   * Defaults to 0 because that is what the booth did before this setting
   * existed. Nobody should lose an event's photos to an upgrade.
   */
  galleryTtlHours: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  timerSecs: 3,
  selectedFrameId: '',
  filters: DEFAULT_FILTERS,
  lookRamp: DEFAULT_RAMP,
  cameraDeviceId: '',
  eventName: DEFAULT_EVENT_DETAILS.eventName,
  cropEnabled: false,
  crop: FULL_FRAME,
  linkTtlHours: 168,
  galleryTtlHours: 0,
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
      // A shallow spread is enough for settings saved before a field existed:
      // an absent `lookRamp` takes the default. Keys from the two retired
      // experiments are dropped, though a brightness-only ramp carries its
      // direction over — same gesture, wider effect.
      const { gradient: _retired, brightnessRamp, ...stored } =
        data.settings as CaptureSettings & { gradient?: unknown; brightnessRamp?: LookRamp };
      void _retired;
      setSettings({
        ...DEFAULT_CAPTURE_SETTINGS,
        ...(brightnessRamp ? { lookRamp: brightnessRamp } : null),
        ...stored,
      });
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
