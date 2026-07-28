import fs from 'node:fs';
import path from 'node:path';

/**
 * Local filesystem storage driver.
 *
 * - blobs: photo / QR bytes written as files under `baseDir`, keyed by a
 *   relative path (e.g. "photos/<token>.jpg", "qrs/<token>.png").
 * - records: token -> metadata, persisted as a single JSON file so download
 *   links survive server restarts.
 *
 * This shape maps cleanly onto a serverless host later: blobs -> R2/S3,
 * records -> KV / D1. Swapping drivers should require no changes in index.mjs.
 */
export function createLocalStorage(baseDir) {
  const recordsPath = path.join(baseDir, 'records.json');

  // Resolve a storage key to a path that can never escape baseDir.
  function keyToPath(key) {
    const resolved = path.resolve(baseDir, key);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return resolved;
  }

  function loadRecords() {
    if (!fs.existsSync(recordsPath)) return new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(recordsPath, 'utf-8'));
      return new Map(Object.entries(raw));
    } catch {
      return new Map();
    }
  }

  const records = loadRecords();

  function persist() {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(recordsPath, JSON.stringify(Object.fromEntries(records), null, 2));
  }

  return {
    baseDir,
    blobs: {
      put(key, buffer) {
        const filePath = keyToPath(key);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, buffer);
      },
      get(key) {
        const filePath = keyToPath(key);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
      },
      delete(key) {
        const filePath = keyToPath(key);
        if (fs.existsSync(filePath)) fs.rmSync(filePath);
      },
    },
    records: {
      put(token, record) { records.set(token, record); persist(); },
      get(token) { return records.get(token) ?? null; },
      list() { return [...records.values()]; },
      delete(token) { if (records.delete(token)) persist(); },
    },
  };
}
