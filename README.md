# DSAC Photo Booth

A local React photo booth app for DSAC events.

## Run

For public QR links that work off the venue network, copy `.env.example` to `.env` and set `PUBLIC_URL` first.

Double-click `run.bat`, or run:

```bat
run.bat
```

The app runs as a Vite React frontend with a small Express backend API.

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001/api/...`

## Development Commands

```bash
npm run dev
npm run lint
npm run test:run
npm run build
```

## Notes

Guests get their photo by scanning the on-screen QR code, which opens a private download page. Generated composed photos are stored in `photos/` and their QR images in `qrs/`, with a token index in `records.json`, so download links survive server restarts. Links expire after `PHOTO_TTL_DAYS` (default 7 days), after which the photo and QR are auto-deleted. No emails are collected.

The download page also offers a LinkedIn share; LinkedIn's public share flow shares a URL preview, and the user copies the suggested caption into LinkedIn themselves.
