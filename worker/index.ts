import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import type { Env } from './env';
import { createDb } from './db';
import { createBlobStore } from './blobs';
import { createAuth } from './auth';

export { RemoteHub } from './remote';

/**
 * The booth, as a Cloudflare Worker.
 *
 * A port of server/index.mjs, route for route. The behaviour is specified over
 * there and its comments explain why each rule exists; this file says only
 * what had to change to live without a process, a filesystem or a port.
 *
 * Three things genuinely differ:
 *
 *  - There is no long-lived process, so the session sweep is a cron trigger and
 *    the remote hub is a Durable Object rather than module state.
 *  - There is no filesystem, so photo bytes go to a blob store and the
 *    organiser's local archive (and the button that opened it) cannot exist.
 *  - There is no tunnel. A Worker knows its own public hostname, so the whole
 *    dance of discovering an origin collapses to reading the request URL.
 */

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PRESETS = 20;
const MAX_PRESET_NAME = 40;

const DEFAULT_CAPTURE_SETTINGS = {
  timerSecs: 3,
  selectedFrameId: '',
  filters: { brightness: 100, contrast: 100, saturation: 100, hue: 0 },
  eventName: 'Transformation Made Possible',
  // Empty means whatever day the photo is taken. Set it only when the
  // booth runs on a different day from the event it is stamping.
  eventDate: '',
  cameraDeviceId: '',
  cropEnabled: false,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  // How long a guest's download link stays good for. 0 means it never lapses.
  // This is about the link only — the photo outlives it.
  linkTtlHours: 168,
  // How long the photo itself is kept, counted from when it was taken. 0 means
  // forever, which is what the booth did before this existed — an upgrade must
  // not start deleting an event. Deliberately unrelated to the link's life: a
  // link may die in an hour while the photo lives a month.
  galleryTtlHours: 0,
};

/**
 * A link that never lapses still needs a timestamp: `expires_at` is NOT NULL in
 * both stores, and making it nullable is a migration on two databases to
 * express something a date already can. So "never" is a date no event will
 * outlive, and every expiry check is an ordinary comparison.
 */
const NEVER_EXPIRES = '9999-12-31T23:59:59.999Z';

const hasExpired = (expiresAt: string) => Date.now() > new Date(expiresAt).getTime();

/**
 * The per-request wiring is stashed on the context rather than rebuilt in each
 * handler, so `Variables` carries its type and every `c` below stays checked.
 */
type Services = ReturnType<typeof services>;
type Ctx = { Bindings: Env; Variables: { svc: Services } };
type C = Context<Ctx>;

const app = new Hono<Ctx>();

app.use('/api/*', cors({ origin: (o) => o ?? '*', credentials: true }));

/**
 * The origin QR codes and the remote link are built from.
 *
 * The Express booth had to discover this — a tunnel URL if one came up, a LAN
 * address if not — because nothing else knew where it could be reached. A
 * Worker is reached at exactly the hostname the request arrived on, so the
 * request itself is the answer. PUBLIC_URL still wins, for a custom domain
 * fronting a workers.dev deployment.
 */
function origin(c: { req: { url: string }; env: Env }): string {
  if (c.env.PUBLIC_URL) return c.env.PUBLIC_URL.replace(/\/$/, '');
  return new URL(c.req.url).origin;
}

const downloadUrl = (c: C, token: string) =>
  `${origin(c)}/download/${encodeURIComponent(token)}`;
const sharePreviewUrl = (c: C, token: string) =>
  `${origin(c)}/api/share/${encodeURIComponent(token)}`;
const linkedInShareUrl = (c: C, token: string) =>
  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(sharePreviewUrl(c, token))}`;

/**
 * When a link handed out right now should stop working, read from the setting
 * as it stands at this moment rather than from a value fixed at deploy time.
 * An operator who shortens the window mid-event means the next photo, not the
 * next deployment. PHOTO_TTL_DAYS survives only as the fallback for a booth
 * whose settings have never been written.
 */
async function linkExpiresAt(c: C, createdAt: Date): Promise<string> {
  const days = Number.parseFloat(c.env.PHOTO_TTL_DAYS ?? '7');
  const fallbackHours = (Number.isFinite(days) ? days : 7) * 24;

  const stored = await svc(c).db.kv.get<Record<string, unknown>>('captureSettings', {});
  const hours = Number(stored?.linkTtlHours ?? fallbackHours);
  const usable = Number.isFinite(hours) && hours >= 0 ? hours : fallbackHours;
  if (usable === 0) return NEVER_EXPIRES;
  return new Date(createdAt.getTime() + usable * 60 * 60 * 1000).toISOString();
}

/**
 * A lapsed link is the guest's problem, never the operator's.
 *
 * The photo-serving routes admit two kinds of caller: the guest who scanned
 * the QR (download scope) and the operator paging through the gallery (booth
 * scope). The photo is kept either way — expiry only retires the link — so the
 * guest gets a plain 410 while the booth is waved through on the same URL.
 */
async function expiredForGuest(c: C, expiresAt: string): Promise<boolean> {
  if (!hasExpired(expiresAt)) return false;
  return !(await svc(c).auth.isAuthed(c, 'booth'));
}

const GONE = { error: 'This download link has expired. Ask the booth crew for a new one.' };

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The uploaded image, or a Response explaining why it is not usable. */
async function readImage(c: C): Promise<File | Response> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Missing required field: file' }, 400);
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return c.json({ error: `Unsupported file type: ${file.type}` }, 400);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB` }, 400);
  }
  return file;
}

/** Per-request wiring. Cheap — these are thin wrappers over bindings. */
function services(env: Env) {
  const db = createDb(env.DB);
  return { db, blobs: createBlobStore(env), auth: createAuth(db, env) };
}

app.use('/api/*', async (c, next) => {
  c.set('svc', services(c.env));
  await next();
});

const svc = (c: C): Services => c.get('svc');
const booth: MiddlewareHandler<Ctx> = (c, next) => svc(c).auth.requireAuth('booth')(c, next);

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (c) => c.json({
  ok: true,
  publicOrigin: origin(c),
  // Which blob backend is live is the one piece of runtime shape worth
  // exposing: it is the difference between "R2 is on" and "still on the D1
  // stopgap", and it is invisible from the outside otherwise.
  storage: svc(c).blobs.kind,
  // No filesystem and no desktop, so there is no folder to open. The gallery
  // hides its Open folder button when it sees this.
  localArchive: false,
}));

// ── Passwords ────────────────────────────────────────────────────────────────

app.get('/api/auth/status', (c) => svc(c).auth.status(c));
app.post('/api/auth/login', (c) => svc(c).auth.login(c));
app.put('/api/settings/passwords', booth, (c) => svc(c).auth.updatePasswords(c));
// Same booth gate as the PUT above, on purpose: reading the passwords back is
// no more privileged than replacing them.
app.get('/api/settings/passwords/reveal', booth, (c) => svc(c).auth.revealPasswords(c));

// ── Photos ───────────────────────────────────────────────────────────────────

app.post('/api/photos/composed', booth, async (c) => {
  const file = await readImage(c);
  if (file instanceof Response) return file;

  const { db, blobs } = svc(c);
  const token = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = await linkExpiresAt(c, createdAt);

  // Bytes first, then the row: a row without bytes is a broken photo, whereas
  // bytes without a row are merely storage nobody can reach.
  try {
    await blobs.put(`photo/${token}`, await file.arrayBuffer(), file.type);
  } catch (err) {
    // The D1 stopgap cannot hold a row much past a megabyte, which a 4K
    // capture clears easily. Say so plainly — a guest is standing at the
    // booth and "unexpected server error" tells the operator nothing.
    if (blobs.kind === 'd1') {
      return c.json({
        error: `This photo is ${(file.size / 1048576).toFixed(1)} MB, which is past what the temporary D1 storage can hold. Enable R2 to store photos at full size.`,
      }, 507);
    }
    throw err;
  }

  await db.photos.put({
    token,
    mime: file.type,
    createdAt: createdAt.toISOString(),
    expiresAt,
  });

  // Tell the organiser's phone the shot has landed, so it can offer a retake.
  const url = downloadUrl(c, token);
  await remoteFetch(c, 'POST', '/state', {
    phase: 'captured', countdown: null, photoToken: token, downloadUrl: url,
  });

  return c.json({
    token,
    downloadUrl: url,
    qrUrl: `${origin(c)}/api/qr/${encodeURIComponent(token)}`,
    linkedInShareUrl: linkedInShareUrl(c, token),
    expiresAt,
  }, 201);
});

/** Shared by the download and preview routes, which differ only in disposition. */
async function servePhoto(c: C, attach: boolean) {
  const { db, blobs } = svc(c);
  const token = c.req.param('token');
  const meta = await db.photos.get(token);
  if (!meta) return c.json({ error: 'Photo not found' }, 404);
  if (await expiredForGuest(c, meta.expiresAt)) return c.json(GONE, 410);

  const blob = await blobs.get(`photo/${token}`);
  if (!blob) return c.json({ error: 'Photo not found' }, 404);

  const ext = meta.mime === 'image/png' ? 'png' : meta.mime === 'image/webp' ? 'webp' : 'jpg';
  const headers: Record<string, string> = {
    'Content-Type': meta.mime,
    'Cache-Control': attach ? 'private, max-age=86400' : 'public, max-age=86400',
  };
  if (attach) headers['Content-Disposition'] = `attachment; filename="dsac-photo.${ext}"`;
  return new Response(blob.body as BodyInit, { headers });
}

app.get('/api/download/:token', ((c, next) => svc(c).auth.requireAuth('download', 'booth')(c, next)) as MiddlewareHandler<Ctx>,
  (c) => servePhoto(c, true));
app.get('/api/preview/:token', ((c, next) => svc(c).auth.requireAuth('download', 'booth')(c, next)) as MiddlewareHandler<Ctx>,
  (c) => servePhoto(c, false));

/**
 * The QR code, drawn on demand rather than stored.
 *
 * The Express booth rendered a PNG at capture time and kept it beside the
 * photo, because it had somewhere to put it. Here the code encodes a URL that
 * is derivable from the token alone, so storing it would be storing a pure
 * function of data we already have. SVG rather than PNG: it needs no Buffer,
 * which keeps this off Node compatibility shims, and an <img> renders it just
 * the same.
 */
app.get('/api/qr/:token', booth, async (c) => {
  const token = c.req.param('token');
  const meta = await svc(c).db.photos.get(token);
  if (!meta) return c.json({ error: 'QR code not found' }, 404);
  // The QR code *is* the link, so it lapses with it — though in practice the
  // booth gate means only an operator ever gets this far.
  if (await expiredForGuest(c, meta.expiresAt)) return c.json(GONE, 410);
  const svg = await QRCode.toString(downloadUrl(c, token), {
    type: 'svg', width: 512, margin: 2, color: { dark: '#18181b', light: '#FFFFFF' },
  });
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
});

/**
 * The whole event, newest first — lapsed links included.
 *
 * Nothing is filtered out here: a lapsed link does not remove a photo, so a
 * gallery that hid expired rows would be hiding pictures that still exist.
 * `expired` is the flag the UI marks them with. The limit is generous because
 * this is the only view of the event the operator has.
 */
app.get('/api/photos/recent', booth, async (c) => {
  const photos = await svc(c).db.photos.recent(200);
  return c.json({
    photos: photos.map(p => ({
      token: p.token,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      expired: hasExpired(p.expiresAt),
      src: `/api/preview/${encodeURIComponent(p.token)}`,
    })),
  });
});

/**
 * Delete one photo, for good — the row and the bytes beside it.
 *
 * Two callers want this: the operator's delete button below, and the cron
 * sweep at the bottom of this file. It lives in one function so the two can
 * never drift into deleting different halves of a photo.
 *
 * Row first, then the blob: a blob nobody has a row for is unreachable
 * storage, whereas a row whose blob is gone is a broken photo in the gallery.
 * The blob failing is therefore survivable and swallowed — the photo is
 * already unreachable, which is what was asked for.
 */
async function deletePhoto(
  { db, blobs }: Pick<Services, 'db' | 'blobs'>,
  token: string,
): Promise<void> {
  await db.photos.delete(token);
  await blobs.delete(`photo/${token}`).catch(() => { /* the row is gone; a stray blob is harmless */ });
}

app.delete('/api/photos/:token', booth, async (c) => {
  const token = c.req.param('token');
  const s = svc(c);
  if (!(await s.db.photos.get(token))) return c.json({ error: 'Photo not found' }, 404);

  await deletePhoto(s, token);
  return c.body(null, 204);
});

/**
 * There is no folder to open.
 *
 * On the booth laptop this spawned Finder or Explorer at the archive
 * directory. A Worker has no filesystem and no desktop, so the honest answer
 * is a refusal that says what to do instead, rather than a button that
 * silently does nothing.
 */
app.post('/api/gallery/open-folder', booth, (c) => c.json({
  error: 'This booth runs in the cloud, so there is no folder to open. Photos are in the gallery above, and each one can be saved from its full-screen view.',
}, 501));

// ── Remote control ───────────────────────────────────────────────────────────
// One hub, so one Durable Object instance: every kiosk and phone must land on
// the same object or a held poll would never see the other's command.

function remoteStub(c: C) {
  return c.env.REMOTE.get(c.env.REMOTE.idFromName('booth'));
}

async function remoteFetch(c: C, method: string, path: string, body?: unknown) {
  return remoteStub(c).fetch(`https://remote${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

app.get('/api/remote/poll', booth, async (c) => {
  const url = new URL(c.req.url);
  return remoteStub(c).fetch(`https://remote/poll${url.search}`);
});
app.get('/api/remote/state', booth, (c) => remoteFetch(c, 'GET', '/state'));
app.post('/api/remote/state', booth, async (c) =>
  remoteFetch(c, 'POST', '/state', await c.req.json().catch(() => null)));
/** The phone can only ask for these. The hub itself is not fussy, so the
 *  allow-list lives here exactly as it did in the Express router. */
const REMOTE_ACTIONS = new Set(['capture', 'cancel', 'retake', 'reset']);

app.post('/api/remote/command', booth, async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!REMOTE_ACTIONS.has(body?.action)) {
    return c.json({
      error: `Unknown action. Expected one of: ${[...REMOTE_ACTIONS].join(', ')}`,
    }, 400);
  }
  if (body.action === 'reset') return remoteFetch(c, 'POST', '/reset');
  return remoteFetch(c, 'POST', '/command', body);
});

// ── Capture settings ─────────────────────────────────────────────────────────

app.get('/api/settings/capture', booth, async (c) =>
  c.json({ settings: await svc(c).db.kv.get('captureSettings', DEFAULT_CAPTURE_SETTINGS) }));

app.put('/api/settings/capture', booth, async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const incoming = body?.settings ?? body;
  if (!incoming || typeof incoming !== 'object') {
    return c.json({ error: 'Expected a settings object' }, 400);
  }
  // Layer the stored settings between the defaults and the write, so a client
  // running an older bundle cannot wipe fields it has never heard of.
  const stored = await svc(c).db.kv.get('captureSettings', {} as Record<string, unknown>);
  const merged = { ...DEFAULT_CAPTURE_SETTINGS, ...stored, ...incoming };
  await svc(c).db.kv.set('captureSettings', merged);
  await remoteFetch(c, 'POST', '/command', { action: 'settings-changed', payload: { settings: merged } });
  return c.json({ settings: merged });
});

// ── Presets ──────────────────────────────────────────────────────────────────

app.get('/api/settings/presets', booth, async (c) =>
  c.json({ presets: await svc(c).db.kv.get('capturePresets', [] as unknown[]) }));

app.put('/api/settings/presets', booth, async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const incoming = body?.presets ?? body;
  if (!Array.isArray(incoming)) return c.json({ error: 'Expected a presets array' }, 400);

  const presets = incoming.slice(0, MAX_PRESETS).map((p: Record<string, unknown>) => ({
    id: String(p?.id ?? crypto.randomUUID()),
    name: String(p?.name ?? 'Preset').slice(0, MAX_PRESET_NAME),
    createdAt: String(p?.createdAt ?? new Date().toISOString()),
    settings: p?.settings && typeof p.settings === 'object' ? p.settings : {},
  }));
  await svc(c).db.kv.set('capturePresets', presets);
  return c.json({ presets });
});

// ── Frame catalogue ──────────────────────────────────────────────────────────

app.get('/api/frames', booth, async (c) => {
  const { db } = svc(c);
  const [settings, custom] = await Promise.all([db.frames.getSettings(), db.frames.listCustom()]);
  return c.json({
    settings,
    custom: custom.map(f => ({ ...f, src: `/api/frames/${encodeURIComponent(f.id)}/image` })),
  });
});

app.put('/api/frames/settings', booth, async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ error: 'Expected a settings object' }, 400);
  return c.json({ settings: await svc(c).db.frames.setSettings(body.settings ?? body) });
});

app.post('/api/frames', booth, async (c) => {
  const file = await readImage(c);
  if (file instanceof Response) return file;

  const form = await c.req.formData();
  let dateStamp: unknown = null;
  const raw = form.get('dateStamp');
  if (typeof raw === 'string' && raw) {
    try { dateStamp = JSON.parse(raw); } catch { dateStamp = null; }
  }

  const { db, blobs } = svc(c);
  const frame = await db.frames.addCustom({
    label: String(form.get('label') ?? '') || undefined,
    mimeType: file.type,
    dateStamp,
  });
  await blobs.put(`frame/${frame.id}`, await file.arrayBuffer(), file.type);

  return c.json({ ...frame, src: `/api/frames/${encodeURIComponent(frame.id)}/image` }, 201);
});

app.patch('/api/frames/:id', booth, async (c) => {
  const patch = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const frame = await svc(c).db.frames.updateCustom(c.req.param('id'), patch);
  return frame ? c.json(frame) : c.json({ error: 'Frame not found' }, 404);
});

app.delete('/api/frames/:id', booth, async (c) => {
  const id = c.req.param('id');
  const { db, blobs } = svc(c);
  if (!(await db.frames.removeCustom(id))) {
    return c.json({ error: 'Frame not found (built-in frames cannot be deleted)' }, 404);
  }
  await blobs.delete(`frame/${id}`).catch(() => { /* the row is gone; a stray blob is harmless */ });
  return c.body(null, 204);
});

app.get('/api/frames/:id/image', booth, async (c) => {
  const blob = await svc(c).blobs.get(`frame/${c.req.param('id')}`);
  if (!blob) return c.json({ error: 'Frame image not found' }, 404);
  return new Response(blob.body as BodyInit, {
    headers: { 'Content-Type': blob.contentType, 'Cache-Control': 'public, max-age=300' },
  });
});

// ── LinkedIn share preview ───────────────────────────────────────────────────

// Open to the world, because LinkedIn's crawler has no cookie to send. That
// makes every caller a guest unless they happen to be the operator, so the
// lapsed-link rule applies here as it does on the download itself.
app.get('/api/share/:token', async (c) => {
  const token = c.req.param('token');
  const meta = await svc(c).db.photos.get(token);
  if (!meta) return c.text('Photo not found', 404);
  if (await expiredForGuest(c, meta.expiresAt)) return c.text(GONE.error, 410);

  const title = 'My AI Learning Journey at SP DSAC';
  const description = 'A photo from the Singapore Polytechnic Data Science and Analytics Centre AI Learning Journey.';
  const imageHref = `${origin(c)}/api/preview/${encodeURIComponent(token)}`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageHref)}">
  <meta property="og:url" content="${escapeHtml(sharePreviewUrl(c, token))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(downloadUrl(c, token))}">
</head>
<body>
  <p><a href="${escapeHtml(downloadUrl(c, token))}">Open photo</a></p>
</body>
</html>`);
});

app.onError((err, c) => {
  console.error('Unhandled error', { message: err.message, stack: err.stack });
  return c.json({ error: 'Unexpected server error' }, 500);
});

// ── The SPA ──────────────────────────────────────────────────────────────────
// Everything that is not an API route is the front end. The Worker runs first
// (run_worker_first), so anything reaching here wants an asset — and any path
// the SPA routes itself must still come back as index.html.

app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);

  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;

  const url = new URL(c.req.url);
  url.pathname = '/';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

/**
 * The automatic half of retention: photos past `galleryTtlHours` go for good.
 *
 * Measured from each photo's `createdAt` — the moment the shutter went — and
 * never from its link expiry. Those are two clocks an operator sets separately
 * and on purpose: a link may lapse within the hour while the photo it pointed
 * at lives a month, or a photo may be swept while its link would still have
 * worked. Only `createdAt` is asked about here.
 *
 * Zero means keep forever, and zero is the default, so a booth nobody has
 * configured leaves this function having touched nothing.
 */
/**
 * Hand a photo to the Drive archive, and say whether it is safely there.
 *
 * Returns false only when an archive is configured and the upload did not
 * confirm. The sweep treats that as a reason to keep the photo: a Drive
 * outage should delay a deletion, never turn into one.
 *
 * When no archive is configured this returns true — the operator set a
 * retention window knowing there was nowhere else for the photos to go, and
 * second-guessing that would leave the gallery filling up regardless of the
 * setting.
 */
async function archiveToDrive(
  env: Env,
  s: Pick<Services, 'blobs'>,
  photo: { token: string; mime: string; createdAt: string },
): Promise<boolean> {
  const url = env.DRIVE_WEBHOOK_URL;
  const secret = env.DRIVE_WEBHOOK_SECRET;
  if (!url || !secret) return true; // no archive configured

  const blob = await s.blobs.get(`photo/${photo.token}`);
  if (!blob) return true; // nothing left to save; let the row go

  const bytes = blob.body instanceof ArrayBuffer
    ? new Uint8Array(blob.body)
    : new Uint8Array(await new Response(blob.body as ReadableStream).arrayBuffer());

  // Chunked so a multi-megabyte photo does not blow the argument limit that
  // spreading a whole array into String.fromCharCode would.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        name: archiveName(photo.token, photo.mime, new Date(photo.createdAt)),
        mimeType: photo.mime,
        dataBase64: btoa(binary),
      }),
    });
    // Apps Script answers 200 with an ok flag rather than an HTTP status, so
    // the body is the only trustworthy signal here.
    const out = await res.json().catch(() => null) as { ok?: boolean } | null;
    return Boolean(res.ok && out?.ok);
  } catch (err) {
    console.error('Drive archive failed', { token: photo.token, err });
    return false;
  }
}

/** Same shape the laptop booth writes to disk, so the two archives read alike. */
function archiveName(token: string, mime: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
    + `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return `dsac-${stamp}-${token.slice(0, 8)}.${ext}`;
}

async function sweepGallery(env: Env, s: Pick<Services, 'db' | 'blobs'>): Promise<void> {
  const stored = await s.db.kv.get<Record<string, unknown>>('captureSettings', {});
  const hours = Number(stored?.galleryTtlHours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return;

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const tokens = await s.db.photos.olderThan(cutoff);
  if (!tokens.length) return;

  // One photo at a time, each in its own try: a single wedged blob must not
  // abandon the rest of the run, or one bad object keeps every older photo
  // alive forever.
  let swept = 0;
  let held = 0;
  for (const token of tokens) {
    try {
      const meta = await s.db.photos.get(token);
      if (meta && !(await archiveToDrive(env, s, meta))) {
        held += 1;
        continue; // try again next hour rather than lose it
      }
      await deletePhoto(s, token);
      swept += 1;
    } catch (err) {
      console.error('Gallery sweep could not delete a photo', { token, err });
    }
  }
  console.log(
    `Gallery sweep removed ${swept} of ${tokens.length} photo(s) older than ${hours}h`
    + (held ? `; ${held} held back because the Drive archive did not confirm` : ''),
  );
}

export default {
  fetch: app.fetch,

  /**
   * Hourly housekeeping: dead sessions always, old photos only if asked.
   *
   * Sessions are rows nobody will ever ask for again — `tokenValid` already
   * refuses an expired one — so the table would otherwise grow without bound
   * across a long-running deployment.
   *
   * Photos are the careful half. This once deleted everything past its link
   * expiry, which meant losing an event to a clock nobody was watching; now it
   * deletes nothing unless an operator has set `galleryTtlHours`, and it reads
   * that setting on every run so a change takes effect within the hour.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = createDb(env.DB);
    const auth = createAuth(db, env);
    ctx.waitUntil(auth.sweepSessions());
    ctx.waitUntil(sweepGallery(env, { db, blobs: createBlobStore(env) }));
  },
} satisfies ExportedHandler<Env>;
