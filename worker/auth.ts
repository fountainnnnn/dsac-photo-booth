import type { Context, MiddlewareHandler } from 'hono';
import type { createDb } from './db';
import type { Env } from './env';

/**
 * Two shared passwords, two scopes.
 *
 *  - `booth`    — the interface: capture, settings, gallery, and the phone
 *                 remote. Whoever runs the event enters it once per device.
 *  - `download` — a guest's photo. Entered on their phone after scanning the
 *                 QR, before the picture is shown; shown before download, not
 *                 after, because an image you can see is an image you can save.
 *
 * Each is seeded from the environment (BOOTH_PASSWORD / DOWNLOAD_PASSWORD) and
 * can be overridden from Settings, which stores a salted hash in the database.
 * A scope with no password anywhere is simply open — otherwise handing someone
 * the deployment would lock them out of an app with no password to type.
 *
 * This is a gate, not real security: the app is a static bundle on a public
 * URL, and anyone determined can read it. It exists to keep passers-by out of
 * Settings and casual QR-forwarders away from photos, which is the actual
 * threat at an event.
 *
 * Two things had to change in the port, and only two:
 *
 *  - scrypt is a `node:crypto` exclusive, so hashing is PBKDF2-SHA-256 over
 *    WebCrypto instead. Same shape stored (`{ salt, hash }`, both hex), same
 *    constant-time comparison of the derived bytes; only the KDF differs.
 *
 *  - sessions were a `Map`. Isolates share no memory, so a login handled by one
 *    of them would be invisible to every other — the token now lives in the D1
 *    `sessions` table. They are still random tokens handed out as cookies, so
 *    that plain <a href> downloads carry them without any client code, and they
 *    still expire on their own; the cron sweep just tidies the rows.
 */

export type Scope = 'booth' | 'download';

type Db = ReturnType<typeof createDb>;

interface StoredHash {
  salt: string;
  hash: string;
  /** Recorded so the cost can be raised later without invalidating old rows. */
  iterations?: number;
}

const SCOPES: Scope[] = ['booth', 'download'];
const TOKEN_TTL_MS: Record<Scope, number> = {
  booth: 3 * 24 * 60 * 60 * 1000,
  download: 24 * 60 * 60 * 1000,
};
const COOKIE: Record<Scope, string> = { booth: 'dsac_booth', download: 'dsac_dl' };

const PBKDF2_ITERATIONS = 150_000;
const KEY_BYTES = 32;

/** The delay served on a wrong password — brute force without a rate limiter. */
const WRONG_PASSWORD_DELAY_MS = 400;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derive(password: string, salt: string, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt) as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password: string): Promise<StoredHash> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const bytes = await derive(password, salt, PBKDF2_ITERATIONS);
  return { salt, hash: toHex(bytes), iterations: PBKDF2_ITERATIONS };
}

/**
 * Compare over the whole buffer regardless of where it first differs. There is
 * no `timingSafeEqual` here, so it is written out: no early return, one XOR
 * accumulator, length folded in at the end.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function verifyAgainst(stored: StoredHash | null, password: string): Promise<boolean> {
  if (!stored?.salt || !stored?.hash) return false;
  const candidate = await derive(password, stored.salt, stored.iterations ?? PBKDF2_ITERATIONS);
  return timingSafeEqual(candidate, fromHex(stored.hash));
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function isScope(value: unknown): value is Scope {
  return value === 'booth' || value === 'download';
}

export function createAuth(db: Db, env: Env) {
  /**
   * The env passwords are hashed on first use rather than at module load: a
   * Worker isolate has no boot step we can await, and PBKDF2 is async. The
   * promise is memoised, so the cost is paid once per isolate as before.
   */
  const envHash: Partial<Record<Scope, Promise<StoredHash> | null>> = {};

  function envHashFor(scope: Scope): Promise<StoredHash> | null {
    if (!(scope in envHash)) {
      const raw = scope === 'booth' ? env.BOOTH_PASSWORD : env.DOWNLOAD_PASSWORD;
      envHash[scope] = raw ? hashPassword(raw) : null;
    }
    return envHash[scope] ?? null;
  }

  /** The active hash for a scope, and where it came from. */
  async function resolve(scope: Scope): Promise<{ hash: StoredHash | null; source: string | null }> {
    const stored = await db.kv.get<StoredHash | null>(`password:${scope}`, null);
    if (stored?.hash) return { hash: stored, source: 'settings' };
    const seeded = envHashFor(scope);
    if (seeded) return { hash: await seeded, source: 'env' };
    return { hash: null, source: null };
  }

  async function tokenValid(token: string, scope: Scope): Promise<boolean> {
    const row = await env.DB
      .prepare('SELECT expires_at FROM sessions WHERE token = ?1 AND scope = ?2')
      .bind(token, scope)
      .first<{ expires_at: string }>();
    if (!row) return false;
    return Date.parse(row.expires_at) > Date.now();
  }

  async function isAuthed(c: Context, scope: Scope): Promise<boolean> {
    const { hash } = await resolve(scope);
    if (!hash) return true; // no password anywhere -> the scope is open

    const cookies = parseCookies(c.req.header('Cookie'));
    const bearer = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
    for (const t of [cookies[COOKIE[scope]], bearer]) {
      if (t && await tokenValid(t, scope)) return true;
    }
    return false;
  }

  /** Pass when ANY of the scopes is open or satisfied. */
  const requireAuth = (...scopes: Scope[]): MiddlewareHandler => async (c, next) => {
    for (const scope of scopes) {
      if (await isAuthed(c, scope)) return next();
    }
    return c.json({ error: 'Password required', scopes }, 401);
  };

  async function login(c: Context): Promise<Response> {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const scope = String(body?.scope ?? '');
    const password = String(body?.password ?? '');
    if (!isScope(scope)) return c.json({ error: 'Unknown scope' }, 400);

    const { hash } = await resolve(scope);
    if (!hash) return c.json({ ok: true }); // open scope; nothing to check

    if (!await verifyAgainst(hash, password)) {
      // A beat of delay blunts brute force without a rate-limiter dependency.
      await new Promise((r) => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
      return c.json({ error: 'Wrong password' }, 401);
    }

    const token = base64url(crypto.getRandomValues(new Uint8Array(24)));
    const ttl = TOKEN_TTL_MS[scope];
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    await env.DB
      .prepare('INSERT OR REPLACE INTO sessions (token, scope, expires_at) VALUES (?1, ?2, ?3)')
      .bind(token, scope, expiresAt)
      .run();

    // Secure is safe to add here and was not in the Express build: Workers is
    // always HTTPS, whereas the booth also ran on plain http://localhost.
    c.header(
      'Set-Cookie',
      `${COOKIE[scope]}=${token}; Path=/; Max-Age=${Math.floor(ttl / 1000)}; SameSite=Lax; Secure`,
    );
    return c.json({ ok: true });
  }

  async function statusBody(c: Context) {
    const out: Record<string, { required: boolean; authed: boolean; source: string | null }> = {};
    for (const scope of SCOPES) {
      const { hash, source } = await resolve(scope);
      out[scope] = { required: Boolean(hash), authed: await isAuthed(c, scope), source };
    }
    return out;
  }

  async function status(c: Context): Promise<Response> {
    return c.json(await statusBody(c));
  }

  /**
   * Change or clear a password from Settings. A string sets it, null clears
   * the Settings override (falling back to the environment, or to open), and a
   * missing key leaves that scope alone.
   */
  async function updatePasswords(c: Context): Promise<Response> {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    for (const scope of SCOPES) {
      if (!(scope in (body ?? {}))) continue;
      const value = body[scope];
      if (value === null || value === '') {
        await db.kv.set(`password:${scope}`, null);
      } else if (typeof value === 'string') {
        if (value.length < 4) {
          return c.json({ error: `The ${scope} password needs at least 4 characters` }, 400);
        }
        await db.kv.set(`password:${scope}`, await hashPassword(value));
      }
    }
    return status(c);
  }

  /**
   * Expired rows are already refused by `tokenValid`, so this is housekeeping
   * rather than enforcement — it stops a long-running event's table growing
   * without bound. Called from the cron trigger alongside the photo sweep.
   */
  async function sweepSessions(): Promise<void> {
    await env.DB
      .prepare('DELETE FROM sessions WHERE expires_at < ?1')
      .bind(new Date().toISOString())
      .run();
  }

  // `isAuthed` is exported as well as used by the middleware: routes that are
  // reachable by either scope sometimes need to know *which* one let the
  // request in. A guest holding a lapsed download link is turned away where
  // the operator, on the same URL, is not.
  return { requireAuth, isAuthed, login, status, updatePasswords, sweepSessions };
}

/** Node's `base64url` encoding, which Workers' btoa does not do on its own. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
