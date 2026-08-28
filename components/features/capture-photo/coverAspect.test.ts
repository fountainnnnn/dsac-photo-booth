import { describe, expect, it } from 'vitest';
import { coverAspect } from './useLivePreview';
import { photoOutputSize } from './outputSize';
import { BUILT_IN_FRAMES } from '@/types/frame';

/**
 * The camera is not the shape of the window it is drawn into, and nothing
 * makes it so: `cameraConstraints` asks for no aspect ratio, so the booth gets
 * 4:3 from a built-in webcam or an iPhone over Continuity as readily as 16:9
 * from a USB one. A plain scale from one to the other stretched every face by
 * a third — and only with a frame on, because a bare stage takes the camera's
 * own shape, which is what made it look like the frames were at fault.
 */
describe('coverAspect', () => {
  const SIXTEEN_NINE = 16 / 9;

  it('trims a 4:3 camera top and bottom rather than stretching it', () => {
    const out = coverAspect({ sx: 0, sy: 0, sw: 1280, sh: 960 }, SIXTEEN_NINE);

    expect(out.sw / out.sh).toBeCloseTo(SIXTEEN_NINE, 3);
    // A source narrower than the window keeps its full width; the headroom is
    // what goes, evenly from both ends. 1280x960 becomes plain 720p.
    expect(out.sw).toBe(1280);
    expect(out.sh).toBe(720);
    expect(out.sy).toBe(120);
  });

  it('trims the sides when the camera is wider than the window', () => {
    // 4096x2160 is the top of the mode ladder — 1.896, not 16:9.
    const out = coverAspect({ sx: 0, sy: 0, sw: 4096, sh: 2160 }, SIXTEEN_NINE);

    expect(out.sw / out.sh).toBeCloseTo(SIXTEEN_NINE, 3);
    expect(out.sh).toBe(2160);
    expect(out.sw).toBe(3840);
    expect(out.sx).toBe(128);
  });

  it('leaves a source that already matches exactly alone', () => {
    const rect = { sx: 12, sy: 34, sw: 1920, sh: 1080 };
    expect(coverAspect(rect, SIXTEEN_NINE)).toEqual(rect);
  });

  it('keeps the untouched axis of a crop where the operator put it', () => {
    const out = coverAspect({ sx: 200, sy: 100, sw: 800, sh: 600 }, SIXTEEN_NINE);
    expect(out.sx).toBe(200);
    expect(out.sy).toBeGreaterThan(100);
  });

  it('is a no-op for a nonsense aspect rather than dividing by zero', () => {
    const rect = { sx: 0, sy: 0, sw: 640, sh: 480 };
    expect(coverAspect(rect, 0)).toEqual(rect);
    expect(coverAspect(rect, Number.NaN)).toEqual(rect);
  });
});

describe('photoOutputSize with a non-16:9 camera', () => {
  const stage = BUILT_IN_FRAMES.find(f => f.id === 'diamond')!;

  it('counts only the pixels actually drawn', () => {
    const size = photoOutputSize({ width: 1920, height: 1440 }, null, stage);

    // The window is 16:9, so a 4:3 camera contributes a 16:9 slice of itself.
    expect(size.cameraWidth / size.cameraHeight).toBeCloseTo(16 / 9, 2);
    expect(size.cameraWidth).toBe(1920);
    expect(size.cameraHeight).toBeLessThan(1440);
  });

  it("leaves a frameless photo at the camera's own size", () => {
    const size = photoOutputSize({ width: 1920, height: 1440 }, null, null);
    expect(size).toMatchObject({ width: 1920, height: 1440 });
  });
});
