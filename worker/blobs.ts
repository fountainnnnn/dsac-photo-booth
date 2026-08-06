/**
 * Where the bytes live: photo captures, frame artwork and QR PNGs.
 *
 * In the Node build these sat in BLOB columns beside their metadata. R2 is the
 * intended home here, but the account has not had R2 enabled yet and the port
 * should not be blocked on a billing checkbox — so this picks a backend at
 * runtime and both halves speak the same four-method interface. Switching over
 * later is a binding in wrangler.jsonc, not a rewrite.
 *
 * Keys are `photo/<token>`, `qr/<token>` and `frame/<id>`.
 */

/**
 * Only the two bindings this module touches. The real Env lives in
 * worker/env.ts and satisfies this structurally.
 */
export interface BlobEnv {
  DB: D1Database;
  PHOTOS?: R2Bucket;
}

export interface BlobStore {
  put(key: string, bytes: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Which backend is live, for the health endpoint. */
  readonly kind: 'r2' | 'd1';
}

export function createBlobStore(env: BlobEnv): BlobStore {
  return env.PHOTOS ? r2Store(env.PHOTOS) : d1Store(env.DB);
}

function r2Store(bucket: R2Bucket): BlobStore {
  return {
    kind: 'r2',

    async put(key, bytes, contentType) {
      await bucket.put(key, toArrayBuffer(bytes), {
        httpMetadata: { contentType },
      });
    },

    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      // Streamed rather than buffered: a 4K capture is several megabytes and
      // there is no reason for it to pass through the isolate's heap.
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      };
    },

    async delete(key) {
      await bucket.delete(key);
    },
  };
}

/**
 * The stopgap. This is for development only, until R2 is enabled on the
 * account — it is not a backend to run an event on.
 *
 * D1 caps a single row at roughly one to two megabytes. A 4K photo routinely
 * exceeds that, so writes here will fail outright for full-size captures. That
 * failure is deliberately left to propagate: a booth that silently accepts a
 * photo it did not store is worse than one that says it could not, and the
 * route needs the error to tell the operator what happened.
 */
function d1Store(d1: D1Database): BlobStore {
  return {
    kind: 'd1',

    async put(key, bytes, contentType) {
      await d1
        .prepare(
          `INSERT INTO blobs (key, content_type, bytes) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             content_type = excluded.content_type,
             bytes = excluded.bytes`,
        )
        .bind(key, contentType, toArrayBuffer(bytes))
        .run();
    },

    async get(key) {
      const row = await d1
        .prepare('SELECT content_type, bytes FROM blobs WHERE key = ?')
        .bind(key)
        .first<{ content_type: string; bytes: ArrayBuffer | number[] | null }>();
      if (!row || row.bytes == null) return null;
      // D1 has handed BLOBs back as a plain array of byte values across
      // versions as well as as an ArrayBuffer, so accept both.
      const body = Array.isArray(row.bytes)
        ? toArrayBuffer(Uint8Array.from(row.bytes))
        : row.bytes;
      return { body, contentType: row.content_type };
    },

    async delete(key) {
      await d1.prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
    },
  };
}

/** D1 and R2 both want a plain ArrayBuffer, and a view may be a window onto a larger one. */
function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }
  return bytes;
}
