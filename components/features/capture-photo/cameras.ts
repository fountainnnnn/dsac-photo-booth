/**
 * Which camera the booth shoots with.
 *
 * A booth laptop routinely has three: the built-in one, whatever webcam is
 * clamped to the backdrop, and — on a Mac — the operator's own iPhone offering
 * itself over Continuity. `facingMode: 'user'` picks the browser's default,
 * which is the built-in one, so the good camera someone brought to the event
 * sat unused and the photos came out at the laptop's 1080p.
 *
 * The operator chooses instead, in Settings. Nothing is auto-selected: the
 * highest-resolution device is often the iPhone sitting on a desk pointing at
 * the ceiling, and a booth that silently shoots the ceiling in exchange for
 * more pixels is worse than one that shoots the room.
 */

export interface CameraOption {
  deviceId: string;
  label: string;
  /** Largest mode the device reports, once probed. */
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Constraints for a chosen camera, or the browser's default when none is set.
 *
 * The size is asked for absurdly large on purpose. `ideal` is a target the
 * browser clamps to what the device can do, so this reads "as much as you
 * have". Dropping it would be the opposite: cameras hand back their *default*
 * mode, which is routinely 640x480.
 */
export function cameraConstraints(deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
    width: { ideal: 7680 },
    height: { ideal: 4320 },
  };
}

/**
 * Real modes to try, largest first.
 *
 * `getCapabilities()` cannot be trusted for this. It reports max width and max
 * height as *independent* ranges, so a camera whose widest mode is 1920x1080
 * and whose tallest is 1440x1920 advertises "1920x1920" — a mode it cannot
 * actually produce. So we ask for real modes, in order, and keep the first
 * that works.
 *
 * On macOS the ladder will not get past 1080p from a USB webcam, and that is
 * not something this code can fix. A 4K UVC camera offers its top modes as
 * MJPEG, and AVFoundation does not surface those to browser capture — it hands
 * over uncompressed YUV, which USB bandwidth caps around 1080p30. Chrome and
 * Safari behave identically, because the limit is below both of them. Windows
 * goes through MediaFoundation, which does expose the MJPEG modes, so the same
 * camera reaches 4K on the booth laptop the app is actually packaged for.
 */
const MODE_LADDER: Array<[number, number]> = [
  [4096, 2160],  // BRIO / cinema 4K
  [3840, 2160],  // UHD
  [2560, 1440],  // QHD
  [1920, 1080],  // FHD — the floor for any modern webcam
];

/**
 * Drive a live track to the largest mode it will actually accept.
 *
 * Returns the achieved size. An `exact` constraint a camera cannot meet throws
 * OverconstrainedError and leaves the track untouched, which is what makes
 * walking the ladder safe: every failure costs a rejected promise and nothing
 * else. A booth that keeps the mode it already had is fine; one that threw
 * here would show no picture at all.
 */
export async function raiseToMaxResolution(
  stream: MediaStream,
): Promise<{ width: number; height: number } | null> {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.applyConstraints !== 'function') return null;

  const current = track.getSettings?.() ?? {};
  for (const [width, height] of MODE_LADDER) {
    // Nothing to gain from asking for a mode we are already at or above.
    if ((current.width ?? 0) >= width) break;
    try {
      await track.applyConstraints({ width: { exact: width }, height: { exact: height } });
      const got = track.getSettings();
      return { width: got.width ?? width, height: got.height ?? height };
    } catch {
      // Unsupported mode — try the next one down.
    }
  }

  return { width: current.width ?? 0, height: current.height ?? 0 };
}

/**
 * Every camera attached, with the resolution each one tops out at.
 *
 * Labels are only readable once camera permission has been given, and
 * capabilities only once a device has actually been opened — so this opens
 * each in turn and closes it again. That makes it slow and it flickers capture
 * lights, which is why it belongs in Settings and never on the kiosk screen.
 */
export async function listCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');

  const probed: CameraOption[] = [];
  for (const [i, device] of cameras.entries()) {
    const option: CameraOption = {
      deviceId: device.deviceId,
      label: device.label || `Camera ${i + 1}`,
    };

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: device.deviceId } },
        audio: false,
      });
      // The mode it will actually give us, not the bounding box it advertises.
      const best = await raiseToMaxResolution(stream);
      option.maxWidth = best?.width;
      option.maxHeight = best?.height;
    } catch {
      // In use by another app, or permission refused for this one. It stays in
      // the list without a resolution rather than vanishing.
    } finally {
      stream?.getTracks().forEach(t => t.stop());
    }

    probed.push(option);
  }

  return probed;
}
