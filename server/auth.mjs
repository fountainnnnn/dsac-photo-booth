import crypto from 'node:crypto';

/**
 * Two shared passwords, two scopes.
 *
 *  - `booth`    — the interface: capture, settings, gallery, and the phone
 *                 remote. Whoever runs the event enters it once per device.
 *  - `download` — a guest's photo. Entered on their phone after scanning the
 *                 QR, before the picture is shown; shown before download, not
 *                 after, because an image you can see is an image you can save.
 *
 * Each is seeded from .env (BOOTH_PASSWORD / DOWNLOAD_PASSWORD) and can be
 * overridden from Settings, which stores a salted hash in the database. A
 * scope with no password anywhere is simply open — otherwise handing someone
 * the .exe would lock them out of an app with no password to type.
 *
 * This is a gate, not real security: the app is a static bundle on a public
 * tunnel, and anyone determined can read it. It exists to keep passers-by out
 * of Settings and casual QR-forwarders away from photos, which is the actual
 * threat at an event.
 *
 * Sessions are random tokens in memory, handed out as cookies so that plain
 * <a href> downloads carry them without any client code. They die with the
 * server, which restarts per event anyway.
 */

const SCOPES = ['booth', 'download'];
const TOKEN_TTL_MS = { booth: 3 * 24 * 60 * 60 * 1000, download: 24 * 60 * 60 * 1000 };
const COOKIE = { booth: 'dsac_booth', download: 'dsac_dl' };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

function verifyAgainst(stored, password) {
  if (!stored?.salt || !stored?.hash) return false;
  const candidate = crypto.scryptSync(password, stored.salt, 32).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(stored.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function createAuth(kv) {
  // Env passwords are hashed once at boot so verification is uniform.
  const envHash = {
    booth: process.env.BOOTH_PASSWORD ? hashPassword(process.env.BOOTH_PASSWORD) : null,
    download: process.env.DOWNLOAD_PASSWORD ? hashPassword(process.env.DOWNLOAD_PASSWORD) : null,
  };

  const tokens = new Map(); // token -> { scope, expiresAt }

  const sweep = () => {
    const now = Date.now();
    for (const [t, v] of tokens) if (v.expiresAt < now) tokens.delete(t);
  };
  setInterval(sweep, 60 * 60 * 1000).unref?.();

  /** The active hash for a scope, and where it came from. */
  function resolve(scope) {
    const stored = kv.get(`password:${scope}`, null);
    if (stored?.hash) return { hash: stored, source: 'settings' };
    if (envHash[scope]) return { hash: envHash[scope], source: 'env' };
    return { hash: null, source: null };
  }

  function isAuthed(req, scope) {
    const { hash } = resolve(scope);
    if (!hash) return true; // no password anywhere -> the scope is open

    const cookies = parseCookies(req.headers.cookie);
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    for (const t of [cookies[COOKIE[scope]], bearer]) {
      const entry = t && tokens.get(t);
      if (entry && entry.scope === scope && entry.expiresAt > Date.now()) return true;
    }
    return false;
  }

  /** Pass when ANY of the scopes is open or satisfied. */
  const requireAuth = (...scopes) => (req, res, next) => {
    if (scopes.some(s => isAuthed(req, s))) return next();
    return res.status(401).json({ error: 'Password required', scopes });
  };

  function login(req, res) {
    const scope = String(req.body?.scope ?? '');
    const password = String(req.body?.password ?? '');
    if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'Unknown scope' });

    const { hash } = resolve(scope);
    if (!hash) return res.json({ ok: true }); // open scope; nothing to check

    if (!verifyAgainst(hash, password)) {
      // A beat of delay blunts brute force without a rate-limiter dependency.
      return setTimeout(() => res.status(401).json({ error: 'Wrong password' }), 400);
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const ttl = TOKEN_TTL_MS[scope];
    tokens.set(token, { scope, expiresAt: Date.now() + ttl });
    res.setHeader('Set-Cookie',
      `${COOKIE[scope]}=${token}; Path=/; Max-Age=${Math.floor(ttl / 1000)}; SameSite=Lax`);
    return res.json({ ok: true });
  }

  function status(req, res) {
    const out = {};
    for (const scope of SCOPES) {
      const { hash, source } = resolve(scope);
      out[scope] = { required: Boolean(hash), authed: isAuthed(req, scope), source };
    }
    res.json(out);
  }

  /**
   * Change or clear a password from Settings. A string sets it, null clears
   * the Settings override (falling back to .env, or to open), and a missing
   * key leaves that scope alone.
   */
  function updatePasswords(req, res) {
    for (const scope of SCOPES) {
      if (!(scope in (req.body ?? {}))) continue;
      const value = req.body[scope];
      if (value === null || value === '') {
        kv.set(`password:${scope}`, null);
      } else if (typeof value === 'string') {
        if (value.length < 4) {
          return res.status(400).json({ error: `The ${scope} password needs at least 4 characters` });
        }
        kv.set(`password:${scope}`, hashPassword(value));
      }
    }
    return status(req, res);
  }

  return { requireAuth, login, status, updatePasswords };
}
