import cors from 'cors';
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
const MAX_BYTES = 10 * 1024 * 1024;
// How long a download link stays live before it is swept away.
const PHOTO_TTL_DAYS = Number.parseFloat(process.env.PHOTO_TTL_DAYS ?? '7');
const TTL_MS = PHOTO_TTL_DAYS * 24 * 60 * 60 * 1000;

// One SQLite file holds photos, uploaded frames, and every setting.
const DATA_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(ROOT_DIR, 'data');
const store = openDatabase(DATA_DIR);
const remote = createRemoteHub();
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
    const expiresAt = new Date(createdAt.getTime() + TTL_MS);
    store.photos.put({
      token,
      mime: req.file.mimetype,
      bytes: req.file.buffer,
      qr: qrBuffer,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

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
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/download/:token', auth.requireAuth('download', 'booth'), (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo) return res.status(404).json({ error: 'Photo not found or link has expired' });

  const ext = `.${extForMime(photo.mime)}`;
  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Content-Disposition', `attachment; filename="dsac-photo${ext}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.send(photo.bytes);
});

app.get('/api/preview/:token', auth.requireAuth('download', 'booth'), (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo) return res.status(404).json({ error: 'Photo not found or link has expired' });

  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(photo.bytes);
});

app.get('/api/qr/:token', booth, (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo?.qr) return res.status(404).json({ error: 'QR code not found' });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(photo.qr);
});

app.get('/api/photos/recent', booth, (_req, res) => {
  res.json({
    photos: store.photos.recent(60).map(p => ({
      token: p.token,
      createdAt: p.createdAt,
      src: `/api/preview/${encodeURIComponent(p.token)}`,
    })),
  });
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
  // Which part of the camera to photograph. Off means the whole scene; the
  // region is kept either way so switching back does not lose the framing.
  cropEnabled: false,
  crop: { x: 0, y: 0, w: 1, h: 1 },
};

app.get('/api/settings/capture', booth, (_req, res) => {
  res.json({ settings: store.kv.get('captureSettings', DEFAULT_CAPTURE_SETTINGS) });
});

app.put('/api/settings/capture', booth, (req, res) => {
  const incoming = req.body?.settings ?? req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Expected a settings object' });
  }
  const merged = { ...DEFAULT_CAPTURE_SETTINGS, ...incoming };
  store.kv.set('captureSettings', merged);
  // Nudge the kiosk so a settings change takes effect without a reload.
  remote.command('settings-changed', { settings: merged });
  return res.json({ settings: merged });
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

app.get('/api/share/:token', (req, res) => {
  const photo = store.photos.get(req.params.token);
  if (!photo) return res.status(404).send('Photo not found');

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

// Drop anything already past its TTL on boot, then keep sweeping periodically.
store.photos.sweepExpired();
setInterval(() => store.photos.sweepExpired(), 6 * 60 * 60 * 1000).unref();

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
  banner('Retention', `${PHOTO_TTL_DAYS} day(s)`);
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
