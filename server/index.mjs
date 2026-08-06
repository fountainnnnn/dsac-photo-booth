import cors from 'cors';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { openDatabase } from './db.mjs';
import { createAuth } from './auth.mjs';
import { createRemoteHub } from './remote.mjs';
import { startTunnel } from './tunnel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

function loadLocalEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsAt = trimmed.indexOf('=');
    if (equalsAt <= 0) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadLocalEnv();

const app = express();
const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT ?? '5173', 10);
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Generous, because captures are now sized from the camera rather than a
// fixed artboard: a 4K webcam writes a ~4600px JPEG, which 10 MB would reject
// and the guest would watch the upload fail after the shutter had already gone.
const MAX_BYTES = 64 * 1024 * 1024;
// How long a guest's download link stays live, when nothing in Settings says
// otherwise. It is only the fallback now: link validity is a capture setting
// (`linkTtlHours`), so an operator can change it mid-event without a restart.
// It has never meant "delete the photo" and no longer looks like it might.
const PHOTO_TTL_DAYS = Number.parseFloat(process.env.PHOTO_TTL_DAYS ?? '7');
const FALLBACK_TTL_HOURS = (Number.isFinite(PHOTO_TTL_DAYS) ? PHOTO_TTL_DAYS : 7) * 24;

/**
 * A link that never lapses still needs a timestamp: `expires_at` is NOT NULL in
 * both stores, and making it nullable is a migration on two databases to
 * express something a date already can. So "never" is a date no event will
 * outlive, and every expiry check is an ordinary comparison.
 */
const NEVER_EXPIRES = '9999-12-31T23:59:59.999Z';

const hasExpired = (expiresAt) => Date.now() > new Date(expiresAt).getTime();

// One SQLite file holds photos, uploaded frames, and every setting.
const DATA_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(ROOT_DIR, 'data');
const store = openDatabase(DATA_DIR);
const remote = createRemoteHub();

/**
 * The organiser's own copy of the event, as ordinary files.
 *
 * The database is the guest-facing side: rows there carry the QR link, which
 * lapses on its own. These files are the archive, and no clock touches them —
 * the whole point is that the folder still holds the event's photos after
 * every download link has expired. Only an explicit delete removes one, and
 * it removes both copies at once so the gallery and the folder cannot drift.
 */
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
// Booth password gates the interface; download password gates the photos.
const auth = createAuth(store.kv);
const booth = auth.requireAuth('booth');

// Discovered at boot when the tunnel comes up; QR codes read it live.
let tunnelOrigin = null;

// When a production build exists we serve it from this same process, so the
// kiosk and the phone download page share one origin (and one Railway service).
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SERVES_FRONTEND = fs.existsSync(path.join(DIST_DIR, 'index.html'));

function extForMime(mimeType) {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

/** Local wall-clock stamp, YYYYMMDD-HHmmss — the folder sorts by time. */
function fileStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * Write the archive copy. Never throws: a full disk or a locked folder must
 * not cost the guest their QR code, which is the part they are standing there
 * waiting for.
 */
function archivePhoto(token, mimeType, bytes, createdAt) {
  const name = `dsac-${fileStamp(createdAt)}-${token.slice(0, 8)}.${extForMime(mimeType)}`;
  try {
    fs.writeFileSync(path.join(PHOTOS_DIR, name), bytes);
  } catch (err) {
    console.error(`  Could not archive ${name}: ${err.message}`);
  }
}

function getLocalNetworkIP() {
  const nets = networkInterfaces();
  for (const addresses of Object.values(nets)) {
    if (!addresses) continue;
    for (const addr of addresses) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

/**
 * The origin baked into QR codes and the remote-control link. Guests and the
 * organiser scan on mobile data, not the venue Wi-Fi, so this can never be
 * localhost and a LAN address is only a last resort.
 *
 * 1. PUBLIC_URL      — explicit override, wins everywhere.
 * 2. Cloudflare tunnel — the normal case for the local app.
 * 3. LAN IP          — same-network fallback when no tunnel came up.
 */
function getPublicOrigin() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (tunnelOrigin) return tunnelOrigin;
  return `http://${getLocalNetworkIP()}:${SERVES_FRONTEND ? port : frontendPort}`;
}

function url(pathname) {
  return `${getPublicOrigin()}${pathname}`;
}

function downloadUrl(token) {
  return url(`/download/${encodeURIComponent(token)}`);
}

function qrUrl(token) {
  return url(`/api/qr/${encodeURIComponent(token)}`);
}

function sharePreviewUrl(token) {
  return url(`/api/share/${encodeURIComponent(token)}`);
}

function linkedInShareUrl(token) {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(sharePreviewUrl(token))}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

function validateImage(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'Missing required field: file' });

  if (!ACCEPTED_MIME.has(req.file.mimetype)) {
    return res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}` });
  }

  return next();
}

app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    publicOrigin: getPublicOrigin(),
    // Whether this booth keeps its own copy of the photos in a folder the
    // operator can open. True here and false on the hosted booth, which has
    // no filesystem — the gallery reads this rather than offering a button
    // that can only apologise.
    localArchive: true,
  });
});

// ── Passwords ────────────────────────────────────────────────────────────────
// See server/auth.mjs for the model. Status and login are open by necessity;
// changing passwords is itself booth-gated.

app.get('/api/auth/status', auth.status);
app.post('/api/auth/login', auth.login);
app.put('/api/settings/passwords', booth, auth.updatePasswords);

app.post('/api/photos', booth, upload.single('file'), validateImage, (_req, res) => {
  res.status(201).json({
    id: crypto.randomUUID(),
    url: '/api/photos/preview',
    createdAt: new Date().toISOString(),
  });
});

app.post('/api/photos/composed', booth, upload.single('file'), validateImage, async (req, res, next) => {
  try {
    const token = crypto.randomUUID();
    const photoDownloadUrl = downloadUrl(token);

    const qrBuffer = await QRCode.toBuffer(photoDownloadUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#18181b', light: '#FFFFFF' },
    });

    const createdAt = new Date();
    const expiresAt = linkExpiresAt(createdAt);
    store.photos.put({
      token,
      mime: req.file.mimetype,
      bytes: req.file.buffer,
      qr: qrBuffer,
      createdAt: createdAt.toISOString(),
      expiresAt,
    });

    // Second copy, on disk, outliving the row above.
    archivePhoto(token, req.file.mimetype, req.file.buffer, createdAt);

    // Tell the organiser's phone the shot has landed, so it can offer a retake.
    remote.setState({
      phase: 'captured',
      countdown: null,
      photoToken: token,
      downloadUrl: photoDownloadUrl,
    });

    res.status(201).json({
      token,
      downloadUrl: photoDownloadUrl,
      qrUrl: qrUrl(token),
      linkedInShareUrl: linkedInShareUrl(token),
      expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A lapsed link is the guest's problem, never the operator's.
 *
 * Both routes below admit two kinds of caller: the guest who scanned the QR
 * (download scope) and the operator paging through the gallery (booth scope).
 * The photo itself is kept either way — expiry only retires the link — so the
 * guest gets a plain 410 while the booth is waved through on the same URL.
 * Returns a truthy reason when the request must be refused.
 */
function expiredForGuest(req, photo) {
  if (!hasExpired(photo.expiresAt)) return false;
  return !auth.isAuthed(req, 'booth');
}

const GONE = { error: 'This download link has expired. Ask the booth crew for a new one.' };

app.get('/api/download/:token', auth.requireAuth('download', 'booth'), (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  if (expiredForGuest(req, photo)) return res.status(410).json(GONE);

  const ext = `.${extForMime(photo.mime)}`;
  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Content-Disposition', `attachment; filename="dsac-photo${ext}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.send(photo.bytes);
});

app.get('/api/preview/:token', auth.requireAuth('download', 'booth'), (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  if (expiredForGuest(req, photo)) return res.status(410).json(GONE);

  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(photo.bytes);
});

// The QR code *is* the link, so it lapses with it — though in practice the
// booth gate means only an operator ever gets this far.
app.get('/api/qr/:token', booth, (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo?.qr) return res.status(404).json({ error: 'QR code not found' });
  if (expiredForGuest(req, photo)) return res.status(410).json(GONE);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(photo.qr);
});

/**
 * The whole event, newest first — lapsed links included.
 *
 * Nothing is filtered out here: photos are kept until an operator deletes one
 * by hand, so a gallery that hid expired rows would be hiding pictures that
 * still exist. `expired` is the flag the UI marks them with. The limit is
 * generous because this is the only view of the event the operator has.
 */
app.get('/api/photos/recent', booth, (_req, res) => {
  res.json({
    photos: store.photos.recent(200).map(p => ({
      token: p.token,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      expired: hasExpired(p.expiresAt),
      src: `/api/preview/${encodeURIComponent(p.token)}`,
    })),
  });
});

/**
 * Delete one photo, for good — the row, and the archive file beside it.
 *
 * Retention is manual now, so this is the only thing that removes a picture.
 * The archive name embeds a capture timestamp we no longer have in hand, so
 * the file is found by scanning the folder for the token fragment the name
 * ends with. A booth's folder holds an event's worth of photos, not a
 * library's, so a readdir is cheaper than storing the name to avoid it.
 */
app.delete('/api/photos/:token', booth, (req, res) => {
  const { token } = req.params;
  if (!store.photos.get(token)) return res.status(404).json({ error: 'Photo not found' });

  store.photos.delete(token);

  const suffix = `-${token.slice(0, 8)}.`;
  try {
    for (const name of fs.readdirSync(PHOTOS_DIR)) {
      if (name.startsWith('dsac-') && name.includes(suffix)) {
        fs.rmSync(path.join(PHOTOS_DIR, name), { force: true });
      }
    }
  } catch (err) {
    // The row is gone, which is what the operator asked for; a stranded file
    // is a folder they can see and clean up themselves.
    console.error(`  Could not remove the archive copy of ${token}: ${err.message}`);
  }

  return res.status(204).end();
});

/**
 * Reveal the archive folder in the desktop's own file manager.
 *
 * This opens a window on the machine running the server — which is the kiosk
 * itself, sitting right in front of the organiser, so "open the folder" means
 * what it says. Detached and unwatched: the file manager outlives the request
 * and the booth never waits on it.
 */
app.post('/api/gallery/open-folder', booth, (_req, res) => {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });

  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'explorer'
    : 'xdg-open';

  try {
    const child = spawn(opener, [PHOTOS_DIR], { detached: true, stdio: 'ignore' });
    // explorer.exe exits non-zero even when it worked, so errors from the
    // child are not worth reporting; only a failure to launch at all is.
    child.on('error', err => console.error(`  Could not open ${PHOTOS_DIR}: ${err.message}`));
    child.unref();
  } catch (err) {
    return res.status(500).json({ error: `Could not open the folder: ${err.message}` });
  }

  return res.json({ ok: true, dir: PHOTOS_DIR });
});

// ── Remote control ───────────────────────────────────────────────────────────
// The organiser drives the shutter from their phone while standing away from
// the kiosk. See server/remote.mjs for why this is SSE rather than WebSockets.

app.get('/api/remote/poll', booth, async (req, res) => {
  const since = Number.parseInt(String(req.query.since ?? '0'), 10);
  const clientId = String(req.query.client ?? '');
  try {
    const payload = await remote.poll(since, clientId);
    // A held response must not be cached anywhere along the way.
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.json(payload);
  } catch {
    res.status(500).json({ error: 'Poll failed' });
  }
});

app.get('/api/remote/state', booth, (_req, res) => {
  res.json({
    state: remote.getState(),
    version: remote.currentVersion(),
    listeners: remote.clientCount(),
  });
});

app.post('/api/remote/state', booth, (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Expected a state object' });
  }
  return res.json({ state: remote.setState(req.body) });
});

const REMOTE_ACTIONS = new Set([
  'capture', 'cancel', 'retake', 'reset',
]);

app.post('/api/remote/command', booth, (req, res) => {
  const action = req.body?.action;
  if (!REMOTE_ACTIONS.has(action)) {
    return res.status(400).json({
      error: `Unknown action. Expected one of: ${[...REMOTE_ACTIONS].join(', ')}`,
    });
  }
  if (action === 'reset') return res.json({ state: remote.reset() });
  return res.json({ command: remote.command(action, req.body?.payload ?? {}) });
});

// ── Capture settings ─────────────────────────────────────────────────────────
// Timer and image adjustments live in Settings now, so the kiosk reads them
// from here rather than owning them.

const DEFAULT_CAPTURE_SETTINGS = {
  timerSecs: 3,
  selectedFrameId: '',
  filters: { brightness: 100, contrast: 100, saturation: 100, hue: 0 },
  eventName: 'Transformation Made Possible',
  // Empty means the browser's default camera. A booth with an external webcam
  // should point this at it — see the Camera card in Settings.
  cameraDeviceId: '',
  // Which part of the camera to photograph. Off means the whole scene; the
  // region is kept either way so switching back does not lose the framing.
  cropEnabled: false,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  // How long a guest's download link stays good for. 0 means it never lapses.
  // This is about the link only — the photo is kept until someone deletes it.
  linkTtlHours: 168,
};

/**
 * When a link handed out right now should stop working, read from the setting
 * as it stands at this moment rather than from whatever the process booted
 * with. An operator who shortens the window mid-event means the next photo,
 * not the next restart.
 */
function linkExpiresAt(createdAt) {
  const stored = store.kv.get('captureSettings', {});
  const hours = Number(stored?.linkTtlHours ?? FALLBACK_TTL_HOURS);
  const usable = Number.isFinite(hours) && hours >= 0 ? hours : FALLBACK_TTL_HOURS;
  if (usable === 0) return NEVER_EXPIRES;
  return new Date(createdAt.getTime() + usable * 60 * 60 * 1000).toISOString();
}

app.get('/api/settings/capture', booth, (_req, res) => {
  res.json({ settings: store.kv.get('captureSettings', DEFAULT_CAPTURE_SETTINGS) });
});

app.put('/api/settings/capture', booth, (req, res) => {
  const incoming = req.body?.settings ?? req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Expected a settings object' });
  }
  // Layer the stored settings between the defaults and the write. A client
  // running an older bundle sends the fields it knows about; without this, a
  // stale settings page (or a phone remote that has not been reloaded) would
  // silently wipe every field added since it loaded.
  const stored = store.kv.get('captureSettings', {});
  const merged = { ...DEFAULT_CAPTURE_SETTINGS, ...stored, ...incoming };
  store.kv.set('captureSettings', merged);
  // Nudge the kiosk so a settings change takes effect without a reload.
  remote.command('settings-changed', { settings: merged });
  return res.json({ settings: merged });
});

/**
 * Named capture presets — a whole camera setup saved under a name, so an
 * operator can flip between "morning booth" and "evening booth" without
 * rebuilding crop, look and countdown by hand.
 *
 * The settings blob is stored verbatim and never inspected here: whatever
 * fields capture settings grow, a preset carries them along for free.
 */
const MAX_PRESETS = 20;
const MAX_PRESET_NAME = 40;

app.get('/api/settings/presets', booth, (_req, res) => {
  res.json({ presets: store.kv.get('capturePresets', []) });
});

app.put('/api/settings/presets', booth, (req, res) => {
  const incoming = req.body?.presets ?? req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Expected a presets array' });
  }

  // Replace the whole list, like frame settings — the client always holds the
  // full set, so there is no partial update to reconcile.
  const presets = incoming.slice(0, MAX_PRESETS).map(p => ({
    id: String(p?.id ?? crypto.randomUUID()),
    name: String(p?.name ?? 'Preset').slice(0, MAX_PRESET_NAME),
    createdAt: String(p?.createdAt ?? new Date().toISOString()),
    settings: p?.settings && typeof p.settings === 'object' ? p.settings : {},
  }));

  store.kv.set('capturePresets', presets);
  return res.json({ presets });
});

// ── Frame catalogue ──────────────────────────────────────────────────────────

app.get('/api/frames', booth, (_req, res) => {
  res.json({
    settings: store.frames.getSettings(),
    custom: store.frames.listCustom().map(f => ({
      ...f,
      src: `/api/frames/${encodeURIComponent(f.id)}/image`,
    })),
  });
});

app.put('/api/frames/settings', booth, (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Expected a settings object' });
  }
  const settings = store.frames.setSettings(req.body.settings ?? req.body);
  return res.json({ settings });
});

app.post('/api/frames', booth, upload.single('file'), validateImage, (req, res, next) => {
  try {
    let dateStamp = null;
    if (req.body?.dateStamp) {
      try { dateStamp = JSON.parse(req.body.dateStamp); } catch { dateStamp = null; }
    }
    const frame = store.frames.addCustom({
      bytes: req.file.buffer,
      mimeType: req.file.mimetype,
      label: req.body?.label,
      dateStamp,
    });
    return res.status(201).json({
      ...frame,
      src: `/api/frames/${encodeURIComponent(frame.id)}/image`,
    });
  } catch (err) {
    return next(err);
  }
});

app.patch('/api/frames/:id', booth, (req, res) => {
  const frame = store.frames.updateCustom(req.params.id, req.body ?? {});
  if (!frame) return res.status(404).json({ error: 'Frame not found' });
  return res.json(frame);
});

app.delete('/api/frames/:id', booth, (req, res) => {
  if (!store.frames.removeCustom(req.params.id)) {
    return res.status(404).json({ error: 'Frame not found (built-in frames cannot be deleted)' });
  }
  return res.status(204).end();
});

app.get('/api/frames/:id/image', booth, (req, res) => {
  const image = store.frames.image(req.params.id);
  if (!image) return res.status(404).json({ error: 'Frame image not found' });

  res.setHeader('Content-Type', image.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.send(image.buffer);
});

// Open to the world, because LinkedIn's crawler has no cookie to send. That
// makes every caller a guest unless they happen to be the operator, so the
// lapsed-link rule applies here as it does on the download itself.
app.get('/api/share/:token', (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo) return res.status(404).send('Photo not found');
  if (expiredForGuest(req, photo)) return res.status(410).send(GONE.error);

  const safeTitle = 'My AI Learning Journey at SP DSAC';
  const safeDescription = 'A photo from the Singapore Polytechnic Data Science and Analytics Centre AI Learning Journey.';
  const imageHref = url(`/api/preview/${encodeURIComponent(req.params.token)}`);
  const pageHref = sharePreviewUrl(req.params.token);
  const downloadHref = downloadUrl(req.params.token);

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(safeTitle)}</title>
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(safeTitle)}">
  <meta property="og:description" content="${escapeHtml(safeDescription)}">
  <meta property="og:image" content="${escapeHtml(imageHref)}">
  <meta property="og:url" content="${escapeHtml(pageHref)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(downloadHref)}">
</head>
<body>
  <p><a href="${escapeHtml(downloadHref)}">Open photo</a></p>
</body>
</html>`);
});

// ── Frontend (production only) ───────────────────────────────────────────────
// Express 5 uses path-to-regexp v8, where a bare '*' route is a syntax error.
// Plain middleware sidesteps route parsing entirely and is version-proof.
if (SERVES_FRONTEND) {
  // Vite content-hashes everything under /assets, so those names change
  // whenever their contents do and they can be cached forever.
  app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), {
    index: false, maxAge: '1y', immutable: true,
  }));

  // Everything else in dist/ was copied from public/ and keeps its name when
  // its contents change — the frame artwork above all. Caching those for a
  // year meant replacing a frame did nothing for any browser that had already
  // loaded the old one: it kept compositing yesterday's caption for a year
  // without ever asking the server. Revalidate instead; an ETag match is a
  // 304 with no body, so it stays cheap on the booth's own machine.
  app.use(express.static(DIST_DIR, { index: false, maxAge: 0, etag: true }));

  // index.html must never be cached or the kiosk keeps booting a stale build.

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.use((err, _req, res, next) => {
  if (!err) return next();

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB` });
  }

  console.error(err);
  return res.status(500).json({ error: 'Unexpected server error' });
});

// There is no sweep any more. Expiry retires a guest's download link and does
// nothing else: photos stay until an operator deletes one from the gallery
// (DELETE /api/photos/:token). Losing an event's pictures to a clock nobody
// was watching cost more than the disk they sit on ever will.

const banner = (label, value) => console.log(`  ${label.padEnd(20)} ${value}`);

/**
 * Start the tunnel, retrying a couple of times before giving up.
 *
 * cloudflared's quick tunnels fail transiently often enough to matter now that
 * the booth has no other way to be reached — a single unlucky attempt at the
 * start of an event would otherwise leave every QR code pointing at a LAN
 * address no guest can reach.
 */
const TUNNEL_ATTEMPTS = 3;

async function openTunnelWithRetries(targetPort) {
  let last = null;
  for (let attempt = 1; attempt <= TUNNEL_ATTEMPTS; attempt++) {
    last = await startTunnel(targetPort);
    if (last.url) return last;
    if (attempt < TUNNEL_ATTEMPTS) {
      console.warn(`  Attempt ${attempt} failed (${last.error}); retrying…`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return last;
}

const server = app.listen(port, '0.0.0.0', async () => {
  console.log('\n  DSAC Photo Booth\n');
  banner('Local', `http://localhost:${SERVES_FRONTEND ? port : frontendPort}`);
  banner('Database', store.file);
  banner('Photos stored', `${store.photos.count()}`);
  banner('Photo folder', PHOTOS_DIR);
  banner('Link validity', `${FALLBACK_TTL_HOURS} hour(s) by default, set in Settings`);
  banner('Retention', 'manual — photos are kept until deleted');
  banner('Frontend', SERVES_FRONTEND ? 'served from ./dist' : 'dev server (Vite)');

  // The booth runs on a laptop now, with nothing hosting it. The tunnel is
  // the only way a guest's phone reaches it, so it always starts — there is
  // no "skip the tunnel" mode, because a booth without one cannot hand out a
  // single photo.
  if (process.env.PUBLIC_URL) {
    banner('Public URL', `${getPublicOrigin()}  (PUBLIC_URL)`);
  } else {
    console.log('\n  Opening a public tunnel…');
    const { url, error } = await openTunnelWithRetries(SERVES_FRONTEND ? port : frontendPort);
    if (url) {
      tunnelOrigin = url;
      console.log('');
      banner('Public URL', url);
      banner('Remote control', `${url}/remote`);
    } else {
      console.log('');
      console.error(`  No public tunnel (${error}).`);
      console.error('  QR codes will only work for phones on this same network.');
      console.error(`  Fell back to ${getPublicOrigin()}`);
    }
  }
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${port} is already in use — is the booth already running?\n`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
