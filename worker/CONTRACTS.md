# Worker module contracts

The Cloudflare port of `server/`. Each module below is written independently
against these signatures; `worker/index.ts` wires them together. Keep to the
signatures — they are what let the pieces compose without seeing each other.

The behaviour being ported is specified by the Express originals in `server/`,
whose comments explain *why* each rule exists. Read the original before
rewriting a piece of it; the reasoning still applies even though the runtime
does not.

## `worker/env.ts` (owned by index)

```ts
export interface Env {
  DB: D1Database;                              // metadata, settings, sessions
  PHOTOS?: R2Bucket;                           // photo/frame/QR bytes — absent until R2 is enabled
  REMOTE: DurableObjectNamespace<RemoteHub>;   // the kiosk <-> phone hub
  ASSETS: Fetcher;                             // the built SPA
  PUBLIC_URL?: string;
  PHOTO_TTL_DAYS?: string;
  BOOTH_PASSWORD?: string;                     // seed only, as in .env today
  DOWNLOAD_PASSWORD?: string;
}
```

## `worker/db.ts`

Ports `server/db.mjs`. Every method is async — that is the single biggest
difference from the synchronous `node:sqlite` original.

```ts
export interface PhotoMeta {
  token: string; mime: string; createdAt: string; expiresAt: string;
}
export interface CustomFrame {
  id: string; label: string; mimeType: string;
  dateStamp: unknown | null; createdAt: string;
}

export function createDb(d1: D1Database): {
  photos: {
    put(meta: PhotoMeta): Promise<void>;
    /** Null only when there is no such photo. Expiry is reported, not enforced. */
    get(token: string): Promise<PhotoMeta | null>;
    /** The row only — the caller drops `photo/<token>` from the blob store. */
    delete(token: string): Promise<void>;
    count(): Promise<number>;
    recent(limit?: number): Promise<PhotoMeta[]>;
  };
  frames: {
    listCustom(): Promise<CustomFrame[]>;
    addCustom(f: { label?: string; mimeType: string; dateStamp?: unknown }): Promise<CustomFrame>;
    updateCustom(id: string, patch: Record<string, unknown>): Promise<CustomFrame | null>;
    removeCustom(id: string): Promise<boolean>;
    getSettings(): Promise<Record<string, { enabled: boolean }>>;
    setSettings(next: unknown): Promise<Record<string, { enabled: boolean }>>;
  };
  kv: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<T>;
  };
};
```

Note `frames.addCustom` no longer takes bytes — those go to the blob store
under `frame/<id>`, written by the route.

## `worker/blobs.ts`

Photo bytes, frame artwork and QR PNGs.

R2 is the intended home, but the account has not enabled it yet, so this
abstracts over both and picks at runtime. Keys are `photo/<token>`,
`qr/<token>`, `frame/<id>`. Switching later is a config change, not a rewrite.

```ts
export interface BlobStore {
  put(key: string, bytes: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Which backend is live, for the health endpoint. */
  readonly kind: 'r2' | 'd1';
}

export function createBlobStore(env: Env): BlobStore;
```

## `worker/auth.ts`

Ports `server/auth.mjs`. Two scopes, `booth` and `download`; a scope with no
password anywhere is open. scrypt is Node-only, so hashing becomes PBKDF2 over
WebCrypto, and sessions move from a `Map` to D1 (isolates share no memory).

```ts
export type Scope = 'booth' | 'download';

export function createAuth(db: Db, env: Env): {
  requireAuth(...scopes: Scope[]): MiddlewareHandler;  // hono
  /** Which scope let a request in, for routes that treat guests differently. */
  isAuthed(c: Context, scope: Scope): Promise<boolean>;
  login(c: Context): Promise<Response>;
  status(c: Context): Promise<Response>;
  updatePasswords(c: Context): Promise<Response>;
  sweepSessions(): Promise<void>;                      // called from cron
};
```

## `worker/remote.ts`

Ports `server/remote.mjs` to a Durable Object. Module-level state cannot work
on Workers: a held poll in one isolate can never be woken by a POST that lands
in another, which is the whole reason this is a DO.

```ts
export class RemoteHub extends DurableObject<Env> {
  // Routed by index.ts via stub.fetch(), path preserved:
  //   GET  /poll?since=<n>&client=<id>   held up to 25s, returns { version, state, commands }
  //   GET  /state                        { state, version, listeners }
  //   POST /state                        merge patch, returns { state }
  //   POST /command                      { action, payload } -> { command }
  //   POST /reset                        { state }
}
```
