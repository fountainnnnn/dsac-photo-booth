# Open House booth: backgrounds and face filters

Status: planned, not started. Written 2026-09-29 from a planning discussion.
Applies to the `open-house` branch only (see `CLAUDE.md`).

## Goal

On the capture screen a guest makes two choices before the shot:

1. **Background**: where they want to be (beach, space, campus...).
2. **Face filter**: a Snapchat-style effect that follows each face (glasses,
   hats, ears, masks).

The live preview shows the result as they pose, and the photo they download
is exactly what they saw. Download stays as it is today: a QR code, served
through the Cloudflare tunnel the local server opens. Open House runs on
localhost only and is never hosted.

## Decisions

| Decision | Why |
| --- | --- |
| Remove the background with a **green screen and a colour key** in the browser | Sharpest edges, keeps hair and anything guests hold, and it is simple per-pixel maths on the graphics chip, so it runs live on the weak booth laptop. No model, no download. |
| **Preset background images** first | Free, instant in the preview, no moderation problem. |
| **Face filters with MediaPipe Face Landmarker**, drawn locally | 478 points per face plus head angle, runs live on a laptop CPU, Apache 2.0. The booth already ships the MediaPipe runtime (`public/vision/`). |
| AI never touches the people | Editing models redraw the whole picture, so faces, hair and filters drift. If AI is used, it only makes the background image (phase 3). |
| One drawing routine for preview and photo | `drawPhoto` in `useLivePreview.ts` is already shared by the live preview and the shutter (`CameraView.tsx` `doCapture`). New layers go into that shared path so the two cannot disagree. |

### Rejected

- **CorridorKey** (Corridor Digital's AI keyer): needs a 6-8 GB GPU or Apple
  M1+, runs as a Python program, is built for film frames rather than live
  video, and is not an API. The booth laptop cannot run it.
- **Instance segmentation (YOLO-seg etc.)**: low-resolution masks give soft,
  blotchy edges, too heavy to run live on this laptop, cuts off props.
  Ultralytics YOLO is AGPL-3.0.
- **AI edit of the whole final photo** (the first idea): alters faces and
  filters; kept only as the background-generation step in phase 3.

## Layer order

Both the preview and the shutter draw, bottom to top:

1. Background image, cover-cropped into the frame's photo window. **Not
   mirrored**: the preview mirrors the camera, and a mirrored background
   would show any text backwards.
2. Keyed camera image (green removed), with the existing crop, mirror,
   rotation and colour filters.
3. Face filters, at the face points mapped through the same crop, mirror
   and rotation as layer 2.
4. Event frame PNG, then the date stamp (as today).

## Phase 1: green-screen key and preset backgrounds

- [ ] WebGL keyer: takes the raw `<video>` frame, outputs a canvas with alpha.
      Chroma distance from the key colour with tolerance and softness
      (`smoothstep`) for the alpha, spill suppression (pull green down to
      `max(r, b)`), slight edge feather. The same function runs every
      preview frame and once at full resolution at the shutter.
- [ ] Uneven lighting: the screen will have lighter and darker patches.
      Compare colour only (Cb/Cr, ignoring brightness Y) and/or green
      dominance (`g - max(r, b)`), so a shadowed patch still keys.
- [ ] Clean plate: a "capture empty screen" button at setup stores one frame
      of the empty green screen; the keyer then compares each pixel with the
      same position in that frame instead of a single key colour. Handles
      uneven light because camera and screen do not move. Re-capture if the
      camera, crop or lighting changes.
- [ ] `drawPhoto`: draw the background first, then the keyed canvas instead
      of the raw video. Keep the scratch-canvas reuse pattern already used
      for `rampLayer` (no per-frame allocation).
- [ ] Key settings in capture settings: key colour (pick from the preview),
      tolerance, softness, spill. Editable from Settings and the phone
      remote, since lighting changes on the day.
- [ ] Background library: upload, list and delete, modelled on frames
      (`/api/frames`, `useFrameCatalogue.ts`, SQLite). Files in
      `public/backgrounds/` for the bundled ones.
- [ ] Background picker on the capture screen (and on the remote).
- [ ] "Green screen" switch: off means the booth behaves exactly as before.
- [ ] Tests: keyer maths as a pure function (alpha, spill), layer order in
      `drawPhoto`, preview/shutter parity, existing e2e still pass.

## Phase 2: face filters

- [ ] Commit `face_landmarker.task` (~4 MB) beside `blaze_face_short_range.tflite`
      in `public/vision/`; check `scripts/vendor-vision.mjs` still copies
      what is needed.
- [ ] Live tracking: `FaceLandmarker` in VIDEO mode on the raw video, CPU
      delegate by default, capped at about 6 faces. Detect at ~15 fps and
      reuse the last result in between, smoothed so filters do not jitter.
      GPU delegate is a one-line switch if the laptop copes better with it.
- [ ] Map landmark coordinates through the same crop, mirror and rotation
      that `drawPhoto` applies to the video.
- [ ] Filter definitions in `types/filter.ts` (like `types/frame.ts`): a
      transparent PNG in `public/filters/`, which landmarks anchor it
      (e.g. eye centres), how it scales (e.g. eye distance), and an offset.
      Angle comes from the eye line / head pose.
- [ ] At the shutter: one fresh detection on the full-resolution frame, so
      filters land precisely on the saved photo.
- [ ] Filter picker on the capture screen (and on the remote), including
      "none".
- [ ] Test at the real booth distance. Face Landmarker is short-range; if the
      back row of a group loses tracking, reuse the tiled search in
      `public/vision/tiledFaces.mjs` for the detection step.

## Phase 3 (optional): AI-generated backgrounds from typed text

The guest types a scene; the booth generates just the background before the
shot, and the live preview shows them in it.

- [ ] Server route (booth-auth only) calls OpenRouter
      `POST https://openrouter.ai/api/v1/chat/completions`, model
      `google/gemini-3.1-flash-image`, `modalities: ["image", "text"]`,
      2K output. Returns the image to the kiosk, which uses it as layer 1.
- [ ] The guest never writes the prompt. The server wraps their text:
      "A photo backdrop of: {text}. No people, no text, no logos.
      Photorealistic, eye-level, even lighting." Length cap, blocked-word
      list, and fall back to a preset if the model refuses or fails.
- [ ] `OPENROUTER_API_KEY` added to `server/env-file.mjs` so it is set on the
      Environment tab. It never reaches the browser.
- [ ] Waiting state (5-30 s) that shows a preset meanwhile; cap generations
      per guest (retakes cost the same again).
- [ ] Notice on screen that the typed text goes to an online service.

## Costs

Phases 1 and 2 are free: everything runs on the laptop, and the tunnel is
free. Phase 3 costs per generated background (Gemini 3.1 Flash Image,
including OpenRouter's 5.5% card fee on credits; the prompt text costs
effectively nothing):

| Size | Per background | 300 guests |
| --- | --- | --- |
| 2048px (matches the 1921x1201 frames) | ~US$0.107 | ~US$32 |
| 1024px | ~US$0.071 | ~US$21 |

Do not use Gemini 2.5 Flash Image: Google shuts it down on 2026-10-02.

## Event-day setup

- The green screen fills the camera's whole view, including for groups.
  Anything past its edges shows as the real room. If groups spill over, add
  a person mask from MediaPipe's selfie segmenter as a garbage matte for the
  edges only.
- Light the screen evenly: no creases, no shadows.
- Guests stand 1-2 m in front of it, so it does not throw green onto them
  and their shadows do not fall on it (near-black shadow cannot be told
  apart from dark hair or clothes).
- Light the screen with its own light(s), separate from the guests' light.
- Green clothing disappears; tell guests.
- Tune key colour and tolerance on the day, in the venue's light.
- Laptop on mains power, high-performance mode. Internet for the tunnel
  (and phase 3).

## Open questions

- Which laptop (make and model)? Face tracking is the heaviest part; test on
  it early.
- Who picks the background and filter: the guest on the kiosk screen, or the
  operator on the phone remote?
- Where does the filter artwork come from, and how many filters?
- Do colour filters (the existing looks) apply to the person only, or to the
  background too? Default: person only.
- Phase 3 at all, or presets only?

## Validation

`npm run lint`, `npm run test:run`, `npm run build`, then run it with
`npm run booth` on the booth laptop in front of the green screen with a
group, and compare the preview with the downloaded photo.

## References

- OpenRouter image generation: https://openrouter.ai/docs/features/multimodal/image-generation
- OpenRouter fees: https://openrouter.ai/docs/faq
- Gemini image pricing and reference-image limits: https://ai.google.dev/gemini-api/docs/pricing,
  https://ai.google.dev/gemini-api/docs/image-generation
- CorridorKey: https://github.com/nikopueringer/CorridorKey
