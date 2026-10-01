import crypto from 'node:crypto';

/**
 * One shared password, for the interface: capture, settings, gallery, and the
 * phone remote. Whoever runs the event enters it once per device.
 *
 * Guests' photos have no password. A photo's link carries a random UUID, so
 * only someone handed the QR code or the link can open it.
 *
 * The password is seeded from .env (BOOTH_PASSWORD). A booth with no password
 * anywhere is simply open — otherwise handing someone the app would lock them
 * out of an interface with no password to type.
 *
 * This is a gate, not real security: the app is a static bundle on a public
 * tunnel, and anyone determined can read it. It exists to keep passers-by, and
 * guests who strip the path off their QR link, out of Settings and the
 * gallery, which is the actual threat at an event.
 *
 * Sessions are random tokens in memory, handed out as cookies so that plain
 * <a href> downloads carry them without any client code. They die with the
 * server, which restarts per event anyway.
 */

const SCOPES = ['booth'];
const TOKEN_TTL_MS = { booth: 3 * 24 * 60 * 60 * 1000 };
const COOKIE = { booth: 'open_house_booth' };

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
  // The plain env value, kept to know where the password came from.
  const envPlain = { booth: null };

  // Env passwords are hashed when they are read, so verification is uniform.
  const envHash = { booth: null };

  /**
   * Re-read the password from the environment.
   *
   * Called once on the way up, and again whenever Settings saves — the booth
   * is a laptop app now, so the person changing the password is standing at
   * the machine and should not have to restart it to be let back in.
   */
  function reloadFromEnv() {
    envPlain.booth = process.env.BOOTH_PASSWORD || null;
    envHash.booth = envPlain.booth ? hashPassword(envPlain.booth) : null;
  }

  reloadFromEnv();

  const tokens = new Map(); // token -> { scope, expiresAt }

  const sweep = () => {
    const now = Date.now();
    for (const [t, v] of tokens) if (v.expiresAt < now) tokens.delete(t);
  };
  setInterval(sweep, 60 * 60 * 1000).unref?.();

  /** The active hash for a scope, and where it came from. */
  /**
   * A password from the environment wins, and nothing in the app can move it.
   *
   * The order used to be the other way round, which quietly handed the booth
   * away: anyone already inside could set their own password from Settings and
   * shadow the one the administrator had deployed. Putting the environment
   * first means the deployment owns that scope.
   *
   * A scope with no environment password behaves as before, editable from
   * Settings, which is what an unattended laptop booth wants.
   */
  function resolve(scope) {
    if (envPlain[scope]) return { hash: envHash[scope], plain: envPlain[scope], source: 'env' };
    const stored = kv.get(`password:${scope}`, null);
    if (stored?.hash) return { hash: stored, plain: null, source: 'settings' };
    return { hash: null, plain: null, source: null };
  }

  /** Scopes the deployment owns, which Settings must not touch. */
  function isManagedByDeployment(scope) {
    return Boolean(envPlain[scope]);
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

  /** Drop the caller's token for a scope and clear its cookie. */
  function logout(req, res) {
    const scope = String(req.body?.scope ?? '');
    if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'Unknown scope' });

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE[scope]];
    if (token) tokens.delete(token);

    res.setHeader('Set-Cookie', `${COOKIE[scope]}=; Path=/; Max-Age=0; SameSite=Lax`);
    return res.json({ ok: true });
  }

  function status(req, res) {
    const out = {};
    for (const scope of SCOPES) {
      const { hash, plain, source } = resolve(scope);
      out[scope] = {
        required: Boolean(hash || plain),
        authed: isAuthed(req, scope),
        source,
        managed: isManagedByDeployment(scope),
      };
    }
    res.json(out);
  }

  // `isAuthed` is exported as well as used by the middleware: the photo routes
  // are open to guests but need to know whether the operator is asking. A
  // guest holding a lapsed download link is turned away where the operator,
  // on the same URL, is not.
  return { requireAuth, isAuthed, login, logout, status, reloadFromEnv };
}
