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

## Settings the app keeps for itself

The password, the public URL, the port and the storage folder live in `.env` in
the data folder, which the **Environment** tab in Settings edits. The password
and the public URL take effect the moment they are saved; ports and folders are
read while the server starts, so those rows say "restart to apply".

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
