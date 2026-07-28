import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { createStorage } from './storage/index.mjs';

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

const storage = createStorage();

// When a production build exists we serve it from this same process, so the
// kiosk and the phone download page share one origin (and one Railway service).
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SERVES_FRONTEND = fs.existsSync(path.join(DIST_DIR, 'index.html'));

function extForMime(mimeType) {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

function isExpired(record) {
  return Date.now() > new Date(record.expiresAt).getTime();
}

// Delete a record and its blobs from storage.
function purge(record) {
  if (record.photoKey) storage.blobs.delete(record.photoKey);
  if (record.qrKey) storage.blobs.delete(record.qrKey);
  storage.records.delete(record.token);
}

// Fetch a live record, transparently dropping (and 404-ing) expired ones.
function getLiveRecord(token) {
  const record = storage.records.get(token);
  if (!record) return null;
  if (isExpired(record)) {
    purge(record);
    return null;
  }
  return record;
}

// Sweep expired photos so storage does not grow without bound. On a serverless
// host this is replaced by an R2/bucket lifecycle rule.
function sweepExpired() {
  for (const record of storage.records.list()) {
    if (isExpired(record)) purge(record);
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
 * The origin baked into QR codes and share links. It must be reachable from a
 * phone on the venue's network, so it can never be "localhost".
 *
 * 1. PUBLIC_URL           — explicit override, wins everywhere.
 * 2. RAILWAY_PUBLIC_DOMAIN — injected by Railway; always https.
 * 3. LAN IP               — dev fallback. In production the API also serves the
 *                           frontend, so the port is the server's own; in dev
 *                           the browser is on Vite's port instead.
 */
function getPublicOrigin() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
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

app.post('/api/photos', upload.single('file'), validateImage, (_req, res) => {
  res.status(201).json({
    id: crypto.randomUUID(),
    url: '/api/photos/preview',
    createdAt: new Date().toISOString(),
  });
});

app.post('/api/photos/composed', upload.single('file'), validateImage, async (req, res, next) => {
  try {
    const token = crypto.randomUUID();
    const ext = extForMime(req.file.mimetype);
    const photoKey = `photos/${token}.${ext}`;
    const qrKey = `qrs/${token}.png`;
    const photoDownloadUrl = downloadUrl(token);

    const qrBuffer = await QRCode.toBuffer(photoDownloadUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#18181b', light: '#FFFFFF' },
    });

    storage.blobs.put(photoKey, req.file.buffer);
    storage.blobs.put(qrKey, qrBuffer);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + TTL_MS);
    storage.records.put(token, {
      token,
      photoKey,
      qrKey,
      mimeType: req.file.mimetype,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
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

app.get('/api/download/:token', (req, res) => {
  const photo = getLiveRecord(req.params.token);
  if (!photo) return res.status(404).json({ error: 'Photo not found or link has expired' });

  const buffer = storage.blobs.get(photo.photoKey);
  if (!buffer) return res.status(404).json({ error: 'Photo file missing' });

  const ext = `.${extForMime(photo.mimeType)}`;
  res.setHeader('Content-Type', photo.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="dsac-photo${ext}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.send(buffer);
});

app.get('/api/preview/:token', (req, res) => {
  const photo = getLiveRecord(req.params.token);
  if (!photo) return res.status(404).json({ error: 'Photo not found or link has expired' });

  const buffer = storage.blobs.get(photo.photoKey);
  if (!buffer) return res.status(404).json({ error: 'Photo file missing' });

  res.setHeader('Content-Type', photo.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(buffer);
});

app.get('/api/qr/:token', (req, res) => {
  const photo = getLiveRecord(req.params.token);
  if (!photo?.qrKey) return res.status(404).json({ error: 'QR code not found' });

  const buffer = storage.blobs.get(photo.qrKey);
  if (!buffer) return res.status(404).json({ error: 'QR file missing' });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(buffer);
});

app.get('/api/share/:token', (req, res) => {
  const photo = getLiveRecord(req.params.token);
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
  // Hashed assets are immutable; index.html must never be cached or the kiosk
  // will keep booting a stale build after a deploy.
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1y', etag: true }));

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
sweepExpired();
setInterval(sweepExpired, 6 * 60 * 60 * 1000).unref();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`DSAC Photo Booth API  ->  http://localhost:${port}`);
  console.log(`Public origin         ->  ${getPublicOrigin()}`);
  console.log(`Frontend              ->  ${SERVES_FRONTEND ? 'served from ./dist' : 'not built (run `npm run build`) — dev uses Vite'}`);
  console.log(`Storage dir           ->  ${storage.baseDir}`);
  console.log(`Photo retention       ->  ${PHOTO_TTL_DAYS} day(s), then auto-deleted`);
});

server.on('error', (err) => {
  console.error(err);
  process.exitCode = 1;
});
