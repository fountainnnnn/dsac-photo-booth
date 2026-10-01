# Open House booth plan

Status (2026-10-01): **built**, phases 0-4, with OpenRouter set up but
waiting for an API key. Written 2026-09-29 from planning discussions; the plan
below is kept as the record of why. Applies to the `open-house` branch only
(see `CLAUDE.md`). None of this touches the DSAC booth on `main`.

What changed from the plan while building, after testing on real photos:

- Segmentation uses MediaPipe's **multiclass** selfie segmenter (16 MB), not
  the 250 KB selfie one: the light models ate through faces on a busy
  backdrop. It is fed a 512px copy of each frame and paces itself.
- The edge clean-up pass only adds MODNet's detail close to people the
  segmenter found; on its own MODNet kept flags and chairs.
- Face tracking also searches three square tiles across the photo's crop, at
  a 0.3 detection threshold: a group standing back was otherwise missed.
- Typed backgrounds use OpenRouter's `/api/v1/images` endpoint
  (`resolution: 2K`, `aspect_ratio: 16:9`), are cached by prompt, and are
  capped at three per guest.
- Open question 1 settled on the local matting model. The phone remote stays
  (booth password kept).

Still to do: real avatar and background artwork; the OpenRouter key; a run on
the actual booth laptop to see how the live preview copes with segmentation
and face tracking together.

## Goal

A stripped-down booth for Open House that runs on the booth laptop
(localhost only, never hosted), where a guest:

1. **Types a background** ("a beach at sunset", "on the moon"). An AI image
   model generates it, and it is placed behind the guest.
2. **Picks an avatar**: a Snapchat-style face filter that follows each face,
   chosen from a fixed set made in advance. No customising.
3. Sees all of it live in the preview, takes the photo, and scans a QR code
   to download it. Photos stay on the laptop and are served through the
   Cloudflare tunnel, as today.

Work order: Phase 0 (strip down) first, then phases 1-4.

## Phase 0: strip the booth down

### 0.1 Frames: keep only the doodle frame

- [ ] Delete from `public/frames/` everything except `frame-doodle.png`
      (tech, amber, crystal, diamond, sapphire, and their `-text` variants).
- [ ] `types/frame.ts`: drop the tech frame and the four in the list near the
      bottom (diamond, sapphire, amber, crystal); keep `doodle`.
- [ ] Make doodle the default: `selectedFrameId` is `''` today in both
      `server/index.mjs` and `components/features/remote/useCaptureSettings.ts`.

### 0.2 Hosting: remove the Cloudflare Worker, keep the tunnel

- [ ] Delete `worker/` (index, auth, blobs, db, env, remote, schema.sql,
      CONTRACTS.md) and `wrangler.jsonc`. Without `wrangler.jsonc`,
      `wrangler deploy` cannot run from this branch at all, so the live DSAC
      booth is safe by construction.
- [ ] `package.json`: remove `wrangler`, `@cloudflare/workers-types` and
      `hono` (only `worker/` imports it).
- [ ] Remove front-end branches that exist only for the hosted booth:
      `localArchive` in `/api/health` and `GalleryPage.tsx`, the
      `editable: false` path in `EnvironmentCard.tsx`, and hosted notes in
      `PasswordsCard.tsx` / `useCaptureSettings.ts`.
- [ ] **Keep**: `server/tunnel.mjs`, the `cloudflared` dependency,
      `scripts/fetch-cloudflared-win.mjs` (Windows packaging), and the
      `PUBLIC_URL` / `CLOUDFLARED_PROTOCOL` settings. The QR codes depend on
      the tunnel.

### 0.3 Passwords: keep the booth password, remove the photo password

The **booth password stays** as it is: it guards capture, settings, gallery,
frames and the phone remote, over the tunnel too. That matters because the
tunnel URL is printed in every QR code; without it any guest could open
`<tunnel>/gallery` or `/settings`. The phone remote keeps working over the
tunnel, behind the same password.

The **photo password goes**: a guest scans and sees their photo straight
away.

- [ ] `server/auth.mjs`: drop the `download` scope (`SCOPES`,
      `TOKEN_TTL_MS`, `COOKIE`, env reading); keep `booth`.
- [ ] `server/index.mjs`: `/api/download/:token` and `/api/preview/:token`
      use `auth.requireAuth('download', 'booth')` today; make them open.
      (`guestOrBooth` goes with the crop card, 0.4.)
- [ ] `src/App.tsx`: remove the `PasswordGate` around `DownloadPage`; keep
      `boothGated`.
- [ ] `QrDownloadScreen.tsx`: remove the photo-password block (it reads
      `/api/settings/passwords/reveal` and shows the password under the QR).
- [ ] `PasswordsCard.tsx` and `revealPasswords`: booth password only.
- [ ] `DOWNLOAD_PASSWORD` out of `server/env-file.mjs` and `.env.example`.
- [ ] No photo password is safe enough: photo tokens are random UUIDs
      (`crypto.randomUUID()` in `server/index.mjs`), so a link cannot be
      guessed. Only someone given the QR or link can open a photo.

### 0.4 Remove the guest crop card

The "crop a card of yourself" feature on the download page, behind the Beta
switch. Not to be confused with `CameraCropCard.tsx` in the remote, which is
the camera zoom/crop and stays.

- [ ] Delete `components/features/crop-card/` (CropCard, useCard,
      detectFaces, cropGeometry and its test).
- [ ] Remove the card section from `src/pages/DownloadPage.tsx`, the Beta
      card (`components/features/settings/BetaCard.tsx`) from Settings, the
      face detection that runs after the shutter (`CameraView.tsx` /
      `CapturePage.tsx`), the routes `/api/photos/:token/faces` and
      `/api/derivatives/*`, and the faces/derivatives tables in
      `server/db.mjs`.
- [ ] Delete `public/vision/tiledFaces.mjs`, `backfill.html` and
      `blaze_face_short_range.tflite`.
- [ ] **Keep** `scripts/vendor-vision.mjs` and the MediaPipe runtime it
      copies: phases 1 and 3 need it.

### 0.5 Remove Google Drive archiving

- [ ] Delete `server/drive.mjs`, the `/api/drive/connect` and
      `/api/drive/callback` routes, the `GOOGLE_*` settings in
      `server/env-file.mjs` and `.env.example`, the Drive UI in
      `EnvironmentCard.tsx` and `CaptureSettingsCard.tsx`, and `archive` in
      `/api/health`.
- [ ] `sweepGallery` in `server/index.mjs`: drop the Drive branch. Photos
      stay in the local `data/` folder. Gallery auto-delete
      (`galleryTtlHours`) keeps its default of 0, meaning keep forever; link
      expiry (`linkTtlHours`) stays as it is.

### 0.6 Housekeeping

- [ ] The desktop updater (`server/updates.mjs`, `UpdateCard.tsx`,
      `electron-updater`) checks **DSAC's** GitHub releases. In a packaged
      Open House app it would offer to install DSAC over it. Remove it, or
      point it at an Open House release channel.
- [ ] Rename for Open House: `package.json` `name`/`description`,
      `electron-builder.yml` `appId`/`productName`/artifact names/`publish`,
      `README.md`. `docs/stories/` and `docs/app_description.txt` describe DSAC.
- [ ] `CLAUDE.md` is shared with `main` apart from the "This checkout is"
      line. Once `wrangler.jsonc` is gone, update its deploy section on both
      branches (cherry-pick) so they stay in step.

## Decisions

| Decision | Why |
| --- | --- |
| Background removal is a **setting with two modes**: colour key (green screen) or segmentation (no green screen) | Use the green screen when there is one; segmentation as the fallback. |
| Colour key in the browser, not an AI keyer | Sharpest edges, keeps hair and props, and it is simple maths on the graphics chip, so it runs live on the weak booth laptop. |
| Segmentation with **MediaPipe Selfie Segmenter** live | ~250 KB, runs live on CPU. Good for 1-4 people near the camera; softer hair edges. |
| Optional **edge clean-up pass** at the shutter | A stronger matting model re-cuts the saved photo when live segmentation looks jagged. Toggle it by how well segmentation does on the day. |
| Guests **type the background**; AI generates only the background | Editing models redraw the whole picture, so faces, hair and filters drift. Generating just the background, placed behind the cut-out people, never touches them. |
| **Avatars from a fixed set**, made in advance | No moderation problem, predictable look, no per-photo cost. Artwork can be made once with an image model and cleaned up into transparent PNGs. |
| Face tracking with **MediaPipe Face Landmarker** | 478 points and head angle per face, live on a laptop CPU, Apache 2.0. The runtime is already vendored. |
| One drawing routine for preview and photo | `drawPhoto` in `useLivePreview.ts` is shared by the live preview and the shutter (`doCapture` in `CameraView.tsx`). New layers go into it so the two cannot disagree. |

### Rejected

- **CorridorKey** (Corridor Digital's AI keyer): needs a 6-8 GB GPU or Apple
  M1+, runs as a Python program, built for film frames not live video, not an
  API. The booth laptop cannot run it.
- **Instance segmentation (YOLO-seg etc.)**: low-resolution masks, soft
  blotchy edges, too heavy live on this laptop, cuts off props. Separate
  people are not needed. Ultralytics YOLO is AGPL-3.0.
- **BRIA RMBG-2.0**: licence does not allow commercial use.
- **AI edit of the whole final photo** (the first idea): alters faces and
  filters. See open question 1.

## Layer order

Both the preview and the shutter draw, bottom to top:

1. Background (generated from the guest's text, or a preset), cover-cropped
   into the frame's photo window. **Not mirrored**: the preview mirrors the
   camera, and a mirrored background would show any text backwards.
2. The people: camera image with the background removed (colour key or
   segmentation), with the existing crop, mirror, rotation and colour looks.
3. Avatar filters at the face points, mapped through the same crop, mirror
   and rotation as layer 2.
4. Doodle frame, then the date stamp (as today).

With background removal off, layers 1 and 2 are just the camera, as today.

## Phase 1: background removal, two modes

- [ ] Setting **Background removal**: Off / Colour key (green screen) /
      Segmentation. Off keeps the booth as it is today.
- [ ] Both modes produce the same thing, a canvas of the people with
      transparency, which `drawPhoto` draws over layer 1. Reuse the scratch
      canvas pattern of `rampLayer` (no per-frame allocation).

**Colour key**

- [ ] WebGL keyer on the raw `<video>` frame: colour distance with tolerance
      and softness (`smoothstep`) for transparency, spill suppression (pull
      green down to `max(r, b)`), slight edge feather.
- [ ] Uneven lighting: compare colour only (Cb/Cr, ignoring brightness Y)
      and/or green dominance (`g - max(r, b)`), so shadowed green still keys.
- [ ] Clean plate: a "capture empty screen" button stores one frame of the
      empty green screen; each pixel is then compared with the same spot in
      that frame. Re-capture if the camera, crop or lighting changes.
- [ ] Settings for key colour (pick from the preview), tolerance, softness,
      spill; editable during the event.

**Segmentation**

- [ ] Commit the MediaPipe Selfie Segmenter model (~250 KB) in
      `public/vision/`. Run it live on CPU; smooth the mask between frames so
      edges do not flicker; feather the edge.

**Tests**: keyer maths as a pure function, layer order in `drawPhoto`,
preview/shutter parity, existing e2e still pass.

## Phase 2: backgrounds from a typed prompt

- [ ] Text box on the capture screen: "Where do you want to be?"
- [ ] Server route (behind the booth password) calls OpenRouter
      `POST https://openrouter.ai/api/v1/chat/completions`, model
      `google/gemini-3.1-flash-image`, `modalities: ["image", "text"]`, 2K
      output, aspect close to the frame's photo window. Returns the image,
      which becomes layer 1 in the live preview before the guest poses.
- [ ] The guest never writes the prompt. The server wraps their text: "A photo
      backdrop of: {text}. No people, no text, no logos. Photorealistic,
      eye-level, even lighting." Length cap, blocked-word list, fall back to a
      preset if the model refuses or fails.
- [ ] `OPENROUTER_API_KEY` in `server/env-file.mjs`, set on the Environment
      tab. It never reaches the browser.
- [ ] Waiting state (5-30 s) showing a preset meanwhile. A few preset
      backgrounds bundled in `public/backgrounds/` for that and as defaults.
- [ ] Cap generations per guest (each costs the same again).
- [ ] Short notice on screen that the typed text goes to an online service.

## Phase 3: avatars (face filters from a fixed set)

- [ ] Make the avatar set in advance: transparent PNGs in `public/filters/`.
      Can be generated once with an image model, then cleaned up.
- [ ] Filter definitions in `types/filter.ts` (like `types/frame.ts`): the
      image, which landmarks anchor it (e.g. eye centres), how it scales (e.g.
      eye distance), an offset. Angle from the eye line / head pose.
- [ ] Commit `face_landmarker.task` (~4 MB) in `public/vision/`.
- [ ] Live tracking: `FaceLandmarker` in VIDEO mode on the raw video, CPU by
      default (GPU is a one-line switch), about 6 faces max. Detect at ~15 fps,
      reuse the last result in between, smoothed so filters do not jitter.
- [ ] Map landmarks through the same crop, mirror and rotation as the video.
- [ ] At the shutter, one fresh detection on the full-resolution frame.
- [ ] Avatar picker on the capture screen, including "none".
- [ ] Test at the real booth distance: Face Landmarker is short-range, and
      the back row of a group may lose tracking.

## Phase 4: edge clean-up pass (toggle)

- [ ] Setting **Edge clean-up**: on/off, default off. When on, the shutter
      re-cuts the people from the full-resolution frame with a stronger
      matting model, and that mask replaces the live one for the saved photo
      only. The preview stays on the fast live mask.
- [ ] Model: MODNet (Apache 2.0, 7-26 MB, runs in the browser through ONNX
      Runtime Web / transformers.js, probably about a second on the weak
      laptop; measure). BiRefNet-lite (MIT, 115-224 MB) if the laptop can
      take it.
- [ ] Mainly for segmentation mode; check whether colour key benefits too.
- [ ] Turn it on when live segmentation edges look jagged on the day.

## Costs

Everything runs on the laptop and the tunnel is free, except phase 2. Per
generated background with Gemini 3.1 Flash Image, including OpenRouter's
5.5% card fee on credits (the prompt text costs effectively nothing):

| Size | Per background | 300 guests |
| --- | --- | --- |
| 2048px (matches the 1921x1201 frame) | ~US$0.107 | ~US$32 |
| 1024px | ~US$0.071 | ~US$21 |

Each regenerate costs the same again. Do not use Gemini 2.5 Flash Image:
Google shuts it down on 2026-10-02.

## Event-day setup

With a green screen:

- It fills the camera's whole view, including for groups. Anything past its
  edges shows as the real room.
- Light it evenly with its own light(s), separate from the guests' light;
  no creases.
- Guests stand 1-2 m in front, so it does not throw green onto them and their
  shadows do not land on it (near-black shadow cannot be told apart from dark
  hair or clothes).
- Green clothing disappears; tell guests.
- Tune key colour and tolerance on the day, and capture the clean plate.

Without a green screen:

- Plain, evenly lit wall or cloth in a colour unlike typical clothing.
- Guests near the camera, small groups, no one walking past behind.

Both: laptop on mains power in high-performance mode, and internet for the
tunnel and background generation.

## Open questions

1. **Edge clean-up pass**: this plan uses a local matting model (free,
   offline, never alters faces). The other reading of "final pass with the
   vision model" is the AI edit model (Gemini through OpenRouter): about
   US$0.10 more per photo, and it can change faces and avatars. Which?
2. **Frames page**: with only doodle left, keep the Frames page (uploading
   other frames) and the "no frame" option, or remove both?
3. **How the laptop runs it**: `npm run booth` from a checkout, or a packaged
   app? Which OS and model? This decides 0.6 and how hard to push phases 1
   and 3.
4. **Typing the prompt**: guests type at the laptop's keyboard, or something
   else?
5. **Avatars**: how many, and who makes the artwork?
6. Do the existing colour looks apply to the people only, or the background
   too? Default: people only.

## Validation

`npm run lint`, `npm run test:run`, `npm run build`, then `npm run booth` on
the booth laptop. Through the tunnel: a guest link opens the photo with no
password, while `/gallery` and `/settings` still ask for the booth password.
Then test in front of the green screen and without it, with a group, and
compare the preview with the downloaded photo.

## References

- OpenRouter image generation: https://openrouter.ai/docs/features/multimodal/image-generation
- OpenRouter fees: https://openrouter.ai/docs/faq
- Gemini image pricing and reference-image limits: https://ai.google.dev/gemini-api/docs/pricing,
  https://ai.google.dev/gemini-api/docs/image-generation
- MODNet: https://github.com/ZHKKKe/MODNet (browser build: https://huggingface.co/Xenova/modnet)
- BiRefNet: https://github.com/ZhengPeng7/BiRefNet (browser build: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)
- CorridorKey: https://github.com/nikopueringer/CorridorKey
