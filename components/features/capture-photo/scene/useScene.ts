import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AVATARS, BACKGROUNDS, TYPED_BACKGROUND_ID,
  type BgRemoval, type ChromaKeySettings, type SceneChoice,
} from '@/types/scene';
import type { SceneLayers } from '../useLivePreview';
import { ChromaKeyer } from './chromaKey';
import { PersonSegmenter, cutOut } from './segmentation';
import { FaceTracker, type FacePoints, type Region } from './faces';
import {
  DEFAULT_CAMERA, DEFAULT_LINE_M, faceBox, faceDistance, frontFaces, holdGroup, nearestDistance,
  type CameraModel, type FaceBox, type Member,
} from './front';
import { DROP_LABEL, type OverlayFace } from './overlay';
import { matte, preloadMatting } from './matting';
import { noteFaces } from './frameRate';

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
  /**
   * Only the people at the front: avatars on their faces alone, and with no
   * green screen, only their shapes cut out. See `front.ts`.
   */
  focusFront?: boolean;
  /** With `focusFront`, the distance line in metres: nearer is the group. See `front.ts`. */
  frontLineM?: number;
  /** With `focusFront`, at most this many people, the nearest; 0 for any. */
  maxPeople?: number;
  /** The calibration's correction to face distances; 1 uncalibrated. See `front.ts`. */
  distanceScale?: number;
  /**
   * Track faces even when nothing on screen needs them, so the distance to
   * the nearest can be read off: the Settings preview, measuring the line.
   */
  trackFaces?: boolean;
  /** Draw boxes round the faces on the preview (see `overlay.ts`). */
  showTracking?: boolean;
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

/** The camera as `front.ts` needs it: its shape, and the calibration. */
function cameraOf(video: HTMLVideoElement, c: SceneConfig): CameraModel {
  const aspect = video.videoWidth ? video.videoHeight / video.videoWidth : DEFAULT_CAMERA.aspect;
  return { aspect, scale: c.distanceScale && c.distanceScale > 0 ? c.distanceScale : 1 };
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
  // Faces are wanted for avatars, and to tell the group from the crowd when a
  // model is finding the people.
  const wantsFaces = Boolean(config.choice.avatarId)
    || (Boolean(config.focusFront) && bgRemoval === 'segment')
    || Boolean(config.trackFaces);

  // The group as it was last frame, so membership is sticky (see front.ts).
  const lastFront = useRef<FacePoints[]>([]);
  // ...and everyone in it lately, so a face missed for a moment keeps its body.
  const held = useRef<Member[]>([]);
  // The camera as last seen, for turning face sizes into metres.
  const camera = useRef<CameraModel>(DEFAULT_CAMERA);

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

  /** The faces that count: everyone, or only the group at the front. */
  const focused = useCallback((faces: FacePoints[]): FacePoints[] => {
    const c = configRef.current;
    if (!c.focusFront) return faces;
    const front = frontFaces(faces, lastFront.current, c.frontLineM, c.maxPeople, camera.current);
    lastFront.current = front;
    held.current = holdGroup(front, held.current, performance.now());
    return front;
  }, []);

  /** This preview frame's scene. Cheap: everything heavy is throttled. */
  const sceneFrame = useCallback((video: HTMLVideoElement): SceneLayers | null => {
    const c = configRef.current;
    camera.current = cameraOf(video, c);
    const { background, avatar } = pictures();

    const t = tracker.current
      && (avatar || (c.focusFront && c.bgRemoval === 'segment') || c.trackFaces)
      ? tracker.current : null;

    // The group as the tracker last saw it, worked out before the cut-out so
    // the cut-out knows whose shapes to keep and whose to take back out.
    let faces: FacePoints[] | null = t ? focused(t.faces) : null;

    let person: HTMLCanvasElement | null = null;
    let segmented = false;
    if (c.bgRemoval === 'key' && keyer.current) {
      person = keyer.current.process(video, c.chromaKey, PREVIEW_MAX_WIDTH);
    } else if (c.bgRemoval === 'segment' && segmenter.current) {
      // The group, with anyone just missed; everyone else found is taken back
      // out of any shape they share with the group. Faces found but none in
      // the group: nobody. No faces at all — guests facing away, or the
      // tracker still loading — and everyone is kept.
      let focus: { keep: FaceBox[]; drop: FaceBox[] } | null = null;
      if (c.focusFront && t && faces && (held.current.length || t.faces.length)) {
        const group = new Set(faces);
        focus = {
          keep: held.current.map(m => faceBox(m.face)),
          drop: t.faces.filter(f => !group.has(f)).map(faceBox),
        };
      }
      segmented = segmenter.current.update(video, focus);
      const mask = segmenter.current.mask;
      if (mask) {
        person = cutOut(video, mask, PREVIEW_MAX_WIDTH, previewCut.current ?? undefined);
        previewCut.current = person;
      }
    }

    // Faces on a frame the segmenter did not run on: both at once stalled the
    // preview for a tenth of a second at a time.
    let overlay: OverlayFace[] | null = null;
    if (t) {
      if (!segmented) {
        t.update(video, c.region ?? null);
        faces = focused(t.faces);
      }
      const group = faces ?? [];
      noteFaces(t.faces.length, group.length, nearestDistance(t.faces, camera.current));
      if (c.showTracking) {
        const inGroup = new Set(group);
        const lineM = c.frontLineM ?? DEFAULT_LINE_M;
        const why = (face: FacePoints) => (faceDistance(face, camera.current) > lineM
          ? ', beyond the line'
          : `, not among the ${c.maxPeople} nearest`);
        overlay = [
          ...t.faces.map(face => ({
            face,
            state: inGroup.has(face) ? 'group' as const : 'beyond' as const,
            label: `${faceDistance(face, camera.current).toFixed(1)} m${inGroup.has(face) ? '' : why(face)}`,
          })),
          ...t.dropped.map(d => ({ face: d.face, state: 'dropped' as const, label: DROP_LABEL[d.why] })),
        ];
      }
    }

    if (!person && !avatar && !overlay) return null;
    return { person, background, avatar, faces: avatar ? faces : null, overlay };
  }, [pictures, focused]);

  /**
   * The scene for the photo itself, at full resolution. Everything that
   * depends on the moment — the frame, the faces — is taken before anything
   * slow runs, so the photo is of the instant the shutter went.
   */
  const captureScene = useCallback(async (video: HTMLVideoElement): Promise<SceneLayers | null> => {
    const c = configRef.current;
    camera.current = cameraOf(video, c);
    const { background, avatar } = pictures();
    const facesNow = avatar && tracker.current
      ? focused(tracker.current.detectNow(video, c.region ?? null))
      : null;

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
  }, [pictures, focused]);

  const status: SceneStatus = { removal, faces };
  return { sceneFrame, captureScene, status };
}
