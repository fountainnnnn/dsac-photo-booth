# Open House Photo Booth

A photo booth for Open House, run on the booth laptop. Guests pose, and scan a
QR code to get their photo. The organiser can drive the shutter from their
phone.

This is the `open-house` branch. The DSAC booth it was split from lives on
`main`; see `CLAUDE.md` before changing anything.

## Running it at an event

On the booth laptop, from a checkout of this branch:

```bash
npm install        # once
npm run booth      # build, then serve everything on http://localhost:3001
```

Open http://localhost:3001 in Chrome or Brave on the laptop. The booth is never
hosted anywhere else.

On startup the server opens a Cloudflare tunnel and gets a public https URL.
That is what the QR codes point at: guests scan on mobile data, not on the
venue Wi-Fi, so a LAN address is no use to them. If the tunnel cannot start the
booth still runs and falls back to the LAN address — taking photos matters more
than handing them out.

Photos are kept on the laptop, in the `data/` folder of the checkout (the
SQLite database plus a `photos/` folder of plain files the Gallery's "Open
folder" button reveals). Nothing is uploaded anywhere.

One password guards the booth: capture, gallery, settings and the phone remote.
Set it on the Environment tab in Settings, as `BOOTH_PASSWORD`; unset leaves the
booth open. Guests need no password: each photo link carries a random UUID, so
only someone handed the QR code or the link can open it.

The organiser's phone remote is at `<public URL>/remote`, and Settings shows a
QR code for it.

## Backgrounds and avatars

On the capture screen a guest picks an **avatar** — a face filter that
follows every face — and, once background removal is on, a **background** to
stand in. Settings > Background chooses how the room is taken away:

- **Green screen**: keyed by colour on the laptop's graphics chip. Capture the
  empty screen once with nobody in front of it ("Capture empty screen"); every
  pixel is then judged against its own spot, so shadows and uneven light key
  cleanly, and the key colour is set from it. Tune tolerance, edge softness and
  green cast with the live preview on the same card.
- **No green screen**: MediaPipe's multiclass segmenter finds the people. Best
  with a plain wall and guests near the camera. The **edge clean-up pass**
  re-cuts each photo with MODNet at the shutter for cleaner hair and edges, at
  the cost of a second or so per photo.

If an OpenRouter API key is set on the Environment tab (`OPENROUTER_API_KEY`),
guests can also **type a background** ("a beach at sunset") and an image model
draws it — Gemini 3.1 Flash Image by default, about US$0.10 each at 2K, three
tries per guest. Only the background is generated: the guests are cut out on the
laptop and drawn on top, so no model ever redraws a face. The guest's words are
checked against a short blocked-word list and wrapped in the booth's own prompt
(no people, no text) in `server/backgrounds.mjs`. Each picture is kept in
`data/backgrounds/` by its prompt, so the same words are only paid for once.
Without a key, guests see only the ready-made backgrounds.

Everything else runs on the laptop's CPU, offline. The models live in
`public/vision/` (MediaPipe face mesh and segmenter) and `public/matting/`
(MODNet); MediaPipe's runtime is copied there at build time. The backgrounds in
`public/backgrounds/` and avatars in `public/avatars/` are placeholder SVGs in
the format the final artwork should use; each avatar's anchor, size and lift are
set in `types/scene.ts`.

On the day: leave headroom above guests' heads, or hats and ears are cut off by
the frame. Faces are found best within a few metres of the camera; groups
standing further back are found by searching the picture in tiles.

## Settings the app keeps for itself

The password, the public URL, the OpenRouter key, the port and the storage
folder live in `.env` in the data folder, which the **Environment** tab in
Settings edits. The password, the key and the public URL take effect the moment
they are saved; ports and folders are read while the server starts, so those
rows say "restart to apply".

A checkout also reads the repository's own `.env`. Where both exist the
data-folder one wins, because it is the one the person at the booth can change.

## Development

```bash
npm run dev        # Vite dev server + Express, with hot reload
npm run booth      # build, then serve everything from Express on :3001
npm run lint
npm run test:run
```

- Frontend (dev): `http://localhost:5173`
- Everything (production): `http://localhost:3001`

The tunnel always starts — there is no way to turn it off, because it is the
only route a guest's phone has to the laptop. It retries a few times before
falling back to the LAN address.

Useful environment variables: `PORT`, `PUBLIC_URL` (use a fixed origin you
already have, instead of a quick tunnel), `STORAGE_DIR`, `PHOTO_TTL_DAYS`.

`npm run app` and `npm run package` still build the Electron desktop app, under
its own name (Open House Photo Booth) and with no updater, so it cannot pick up
the DSAC booth's releases.

## How it fits together

One SQLite file (via `node:sqlite`, hence Node 22+) holds photos, uploaded
frames, and every setting. Download links expire after the `linkTtlHours`
capture setting (default 168, i.e. 7 days; 0 means never), falling back to
`PHOTO_TTL_DAYS` when that setting has never been written. Expiry only retires
the guest's link — photos are kept until an operator deletes one from the
gallery, or until the gallery cleanup setting (off by default) does.

The only built-in frame is the doodle one, in `public/frames/` at 1921x1201
with a transparent cut-out the photo is drawn into. Its caption geometry is
measured off the artwork and lives in `types/frame.ts`. Other frames can be
uploaded on the Frames tab.

> After replacing anything in `public/`, run `npm run build`. Vite copies
> `public/` into `dist/` at build time and Express serves from `dist/`, so
> without a rebuild the app keeps serving the previous artwork.
