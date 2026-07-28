import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStorage } from './local.mjs';

/**
 * Storage seam. Every persistence call in the app goes through the object
 * returned here, so moving to another host is a matter of adding one driver
 * and switching STORAGE_DRIVER — no changes elsewhere.
 *
 * Driver contract:
 *   blobs.put(key, buffer)   -> void      // key e.g. "photos/<token>.jpg"
 *   blobs.get(key)           -> Buffer | null
 *   blobs.delete(key)        -> void
 *   records.put(token, rec)  -> void      // rec: { token, photoKey, qrKey, mimeType, createdAt, expiresAt }
 *   records.get(token)       -> rec | null
 *   records.list()           -> rec[]
 *   records.delete(token)    -> void
 *
 * To host on Cloudflare later, add an `r2` driver: blobs -> R2 bucket,
 * records -> KV or D1, then set STORAGE_DRIVER=r2.
 */
export function createStorage() {
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();

  switch (driver) {
    case 'local': {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const rootDir = path.join(__dirname, '..', '..');
      // STORAGE_DIR must point at a mounted volume on any host with an
      // ephemeral filesystem (Railway, Fly, Heroku). Without it a redeploy
      // wipes every photo and every download link 404s mid-event.
      const baseDir = process.env.STORAGE_DIR
        ? path.resolve(process.env.STORAGE_DIR)
        : rootDir;
      return createLocalStorage(baseDir);
    }
    // case 'r2': return createR2Storage({ bucket, kv });  // add adapter here
    default:
      throw new Error(`Unknown STORAGE_DRIVER: "${driver}" (expected "local")`);
  }
}
