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

      // On any host with an ephemeral filesystem (Railway, Fly, Heroku) this
      // must resolve to a mounted volume. Otherwise a redeploy wipes every
      // photo and QR codes already handed out at the event start 404-ing.
      //
      // RAILWAY_VOLUME_MOUNT_PATH is injected automatically once a volume is
      // attached, so attaching one is enough — there is no variable to forget.
      const mountPath = process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
      const baseDir = mountPath ? path.resolve(mountPath) : rootDir;

      if (!mountPath && process.env.RAILWAY_ENVIRONMENT) {
        console.warn(
          '[storage] Running on Railway with no volume attached — photos are ' +
          'written to the container filesystem and WILL be destroyed on the ' +
          'next redeploy. Attach a volume, or set STORAGE_DIR.',
        );
      }

      return createLocalStorage(baseDir);
    }
    // case 'r2': return createR2Storage({ bucket, kv });  // add adapter here
    default:
      throw new Error(`Unknown STORAGE_DRIVER: "${driver}" (expected "local")`);
  }
}
