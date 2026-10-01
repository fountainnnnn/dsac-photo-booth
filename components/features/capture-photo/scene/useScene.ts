import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AVATARS, BACKGROUNDS, TYPED_BACKGROUND_ID,
  type BgRemoval, type ChromaKeySettings, type SceneChoice,
} from '@/types/scene';
import type { SceneLayers } from '../useLivePreview';
import { ChromaKeyer } from './chromaKey';
import { PersonSegmenter, cutOut } from './segmentation';
import { FaceTracker, type Region } from './faces';
import { matte, preloadMatting } from './matting';

/**
 * Everything the camera needs to draw a scene: the keyer or the segmenter,
 * the face tracker, and the pictures. Used by the capture screen and by the
 * Settings preview, so the operator tunes exactly what guests will see.
 *
 * Each part is only loaded once it is wanted — the segmenter when background
 * removal is set to it, the face tracker when a guest first picks an avatar —
 * and until it is ready the preview simply shows the plain camera. Nothing
 * here can stop the shutter.
 */

export interface SceneConfig {
  bgRemoval: BgRemoval;
  chromaKey: ChromaKeySettings;
  edgeCleanup: boolean;
  /** Changes whenever the clean plate does, so it is fetched again. */
  cleanPlateAt: string;
  choice: SceneChoice;
  /**
   * The part of the camera the photo uses (the operator's crop, in the
   * camera's own unmirrored fractions), or null for all of it. Faces are only
   * looked for there.
   */
  region?: Region | null;
}

export type PartStatus = 'off' | 'loading' | 'ready' | 'failed';

export interface SceneStatus {
  removal: PartStatus;
  faces: PartStatus;
}

/**
 * The live preview never needs the camera's full resolution: the stage is a
 * laptop screen. Capping the work here is most of what keeps it smooth on a
 * weak machine with a 4K webcam.
 */
const PREVIEW_MAX_WIDTH = 1280;

export const CLEAN_PLATE_URL = '/api/settings/clean-plate';

function loadImage(src: string): HTMLImageElement {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img;
}

function ready(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** A frame of the camera, held still while slower work runs on it. */
function snapshot(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  return c;
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

export function useScene(config: SceneConfig) {
  const configRef = useRef(config);
  configRef.current = config;

  const keyer = useRef<ChromaKeyer | null>(null);
  const segmenter = useRef<PersonSegmenter | null>(null);
  const tracker = useRef<FaceTracker | null>(null);
  const previewCut = useRef<HTMLCanvasElement | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());

  const [removal, setRemoval] = useState<PartStatus>('off');
  const [faces, setFaces] = useState<PartStatus>('off');

  // Every picture up front. They are small, and a guest flicking between
  // backgrounds should never see one arrive late.
  useEffect(() => {
    for (const { src } of [...BACKGROUNDS, ...AVATARS]) {
      if (!images.current.has(src)) images.current.set(src, loadImage(src));
    }
  }, []);

  const { bgRemoval, cleanPlateAt, edgeCleanup } = config;
  const wantsFaces = Boolean(config.choice.avatarId);

  // The keyer, and the clean plate it compares against.
  useEffect(() => {
    if (bgRemoval !== 'key') return;
    keyer.current ??= ChromaKeyer.create();
    const k = keyer.current;
    queueMicrotask(() => setRemoval(k ? 'ready' : 'failed'));
    if (!k) return;

    let live = true;
    const plate = new Image();
    plate.onload = () => { if (live) k.setPlate(plate); };
    plate.onerror = () => { if (live) k.setPlate(null); };
    plate.src = `${CLEAN_PLATE_URL}?v=${encodeURIComponent(cleanPlateAt || 'none')}`;
    return () => { live = false; };
  }, [bgRemoval, cleanPlateAt]);

  // The segmenter, loaded only while it is the chosen method.
  useEffect(() => {
    if (bgRemoval !== 'segment') return;
    let live = true;
    queueMicrotask(() => setRemoval('loading'));
    PersonSegmenter.create().then((s) => {
      if (!live) { s.close(); return; }
      segmenter.current = s;
      setRemoval('ready');
    }).catch((err) => {
      console.warn('[booth] Could not load the segmenter:', err);
      if (live) setRemoval('failed');
    });
    return () => {
      live = false;
      segmenter.current?.close();
      segmenter.current = null;
    };
  }, [bgRemoval]);

  useEffect(() => {
    if (bgRemoval === 'off') queueMicrotask(() => setRemoval('off'));
  }, [bgRemoval]);

  // The face tracker, loaded the first time anyone picks an avatar and kept
  // after that: guests flick between avatars and "none".
  useEffect(() => {
    if (!wantsFaces || tracker.current) return;
    let live = true;
    queueMicrotask(() => setFaces('loading'));
    FaceTracker.create().then((t) => {
      if (!live) { t.close(); return; }
      tracker.current = t;
      setFaces('ready');
    }).catch((err) => {
      console.warn('[booth] Could not load face tracking:', err);
      if (live) setFaces('failed');
    });
    return () => { live = false; };
  }, [wantsFaces]);

  useEffect(() => () => {
    tracker.current?.close();
    tracker.current = null;
  }, []);

  // The clean-up model is twenty-odd megabytes; fetch it before the first
  // photo needs it, not when the guest is waiting.
  useEffect(() => {
    if (bgRemoval === 'segment' && edgeCleanup) void preloadMatting().catch(() => {});
  }, [bgRemoval, edgeCleanup]);

  const pictures = useCallback(() => {
    const c = configRef.current;
    const typed = c.choice.backgroundId === TYPED_BACKGROUND_ID ? c.choice.typed : null;
    const src = typed?.src
      ?? (BACKGROUNDS.find(b => b.id === c.choice.backgroundId) ?? BACKGROUNDS[0]).src;
    // A typed background arrives as an object URL after the page loaded.
    if (!images.current.has(src)) images.current.set(src, loadImage(src));
    const option = AVATARS.find(a => a.id === c.choice.avatarId) ?? null;
    const bgImg = images.current.get(src);
    const avatarImg = option ? images.current.get(option.src) : undefined;
    return {
      background: ready(bgImg) ? bgImg : null,
      avatar: option && ready(avatarImg) ? { option, image: avatarImg } : null,
    };
  }, []);

  /** This preview frame's scene. Cheap: everything heavy is throttled. */
  const sceneFrame = useCallback((video: HTMLVideoElement): SceneLayers | null => {
    const c = configRef.current;
    let person: HTMLCanvasElement | null = null;
    if (c.bgRemoval === 'key' && keyer.current) {
      person = keyer.current.process(video, c.chromaKey, PREVIEW_MAX_WIDTH);
    } else if (c.bgRemoval === 'segment' && segmenter.current) {
      segmenter.current.update(video);
      const mask = segmenter.current.mask;
      if (mask) {
        person = cutOut(video, mask, PREVIEW_MAX_WIDTH, previewCut.current ?? undefined);
        previewCut.current = person;
      }
    }

    const { background, avatar } = pictures();
    let tracked = null;
    if (avatar && tracker.current) {
      tracker.current.update(video, c.region ?? null);
      tracked = tracker.current.faces;
    }
    if (!person && !avatar) return null;
    return { person, background, avatar, faces: tracked };
  }, [pictures]);

  /**
   * The scene for the photo itself, at full resolution. Everything that
   * depends on the moment — the frame, the faces — is taken before anything
   * slow runs, so the photo is of the instant the shutter went.
   */
  const captureScene = useCallback(async (video: HTMLVideoElement): Promise<SceneLayers | null> => {
    const c = configRef.current;
    const { background, avatar } = pictures();
    const facesNow = avatar && tracker.current ? tracker.current.detectNow(video, c.region ?? null) : null;

    let person: HTMLCanvasElement | null = null;
    if (c.bgRemoval === 'key' && keyer.current) {
      // Copied: the keyer's canvas is reused by the very next preview frame.
      const keyed = keyer.current.process(video, c.chromaKey);
      person = keyed ? copyCanvas(keyed) : null;
    } else if (c.bgRemoval === 'segment' && segmenter.current) {
      const frame = snapshot(video);
      const liveMask = segmenter.current.mask;
      const mask = (c.edgeCleanup ? await matte(frame, liveMask) : null) ?? liveMask;
      person = mask ? cutOut(frame, mask) : null;
    }

    if (!person && !avatar) return null;
    return { person, background, avatar, faces: facesNow };
  }, [pictures]);

  const status: SceneStatus = { removal, faces };
  return { sceneFrame, captureScene, status };
}
