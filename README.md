# DSAC Photo Booth

A photo booth for Singapore Polytechnic DSAC events. Guests pose, spin for a
frame, and scan a QR code to get their photo. The organiser drives the shutter
from their phone.

## Running it at an event

Run **DSAC Photo Booth Setup.exe**. That is the whole setup — the machine needs
no Node, no npm install, and no terminal, because Electron brings its own
runtime and Chromium.

There is also a **portable** build: a single .exe that runs from anywhere,
including a USB stick, without installing. Photos and settings go to
`%APPDATA%\dsac-photo-booth` either way, so both builds keep their data between
launches.

On startup the app opens a Cloudflare tunnel and gets a public https URL. This
is what makes the booth work: guests scan on mobile data, not on the venue
Wi-Fi, so a LAN address is no use to them. If the tunnel cannot start the booth
still runs and falls back to the LAN address — taking photos matters more than
handing them out.

The organiser's phone remote is at `<public URL>/remote`, and Settings shows a
QR code for it.

If something misbehaves at an event, the startup log — including the public URL
and any tunnel error — is at `%APPDATA%\dsac-photo-booth\booth.log`.

## Building the .exe

```bash
npm run package
```

Both artefacts land in `release/`, about 112 MB each. Windows will warn that
the app is from an unidentified publisher, because it is unsigned; "More info"
then "Run anyway" gets past it. Removing that warning needs a code-signing
certificate.

If the build stops with `EBUSY ... unlink release\win-unpacked\resources\app.asar`,
something still holds the previous build open — usually a copy of the app that
is still running, sometimes the virus scanner. Close the app and delete
`release/`; if the delete is refused too, it clears on reboot.

## Development

```bash
npm run dev        # Vite dev server + Express, with hot reload
npm run app        # build, then run the desktop app unpackaged
npm run booth      # build, then serve everything from Express on :3001
npm run lint
npm run test:run
```

`run.bat` does the `booth` flow, for a machine that already has Node.

- Frontend (dev): `http://localhost:5173`
- Everything (production and desktop): `http://localhost:3001`

Useful environment variables: `PORT`, `PUBLIC_URL` (skip the tunnel and use a
fixed origin), `NO_TUNNEL=1`, `STORAGE_DIR`, `PHOTO_TTL_DAYS`.

## How it fits together

`electron/main.cjs` is a thin shell — it starts the same Express server the CLI
starts, then points a window at it. Nothing in the booth knows it is inside
Electron, so the CLI and the packaged app stay the same program.

One SQLite file (via `node:sqlite`, hence Node 22+) holds photos, uploaded
frames, and every setting. Download links expire after `PHOTO_TTL_DAYS`
(default 7), after which the photo and its QR are swept. No emails are
collected.

Frame artwork lives in `public/frames/` at 1921x1201, each with a transparent
cut-out the photo is drawn into — the frame wraps the photo rather than
covering it. Caption geometry is measured off the artwork and lives in
`types/frame.ts`.

> After replacing anything in `public/`, run `npm run build`. Vite copies
> `public/` into `dist/` at build time and Express serves from `dist/`, so
> without a rebuild the app keeps serving the previous artwork.

The download page also offers a LinkedIn share; LinkedIn's public share flow
shares a URL preview, and the guest copies the caption in themselves.
