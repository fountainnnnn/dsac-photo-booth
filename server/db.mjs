import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Everything the booth persists, in one SQLite file.
 *
 * Photo bytes live in the database rather than beside it so the whole event is
 * a single file to copy, back up, or delete. A day of shooting is on the order
 * of a hundred megabytes, which SQLite handles comfortably.
 *
 * node:sqlite ships with Node, so the local install stays dependency-free.
 */

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS photos (
    token      TEXT PRIMARY KEY,
    mime       TEXT NOT NULL,
    bytes      BLOB NOT NULL,
    qr         BLOB,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS photos_expires ON photos (expires_at);

  CREATE TABLE IF NOT EXISTS custom_frames (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    mime       TEXT NOT NULL,
    bytes      BLOB NOT NULL,
    date_stamp TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export function openDatabase(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'photo-booth.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const asBuffer = (v) => (v == null ? null : Buffer.from(v));

  const photos = {
    put({ token, mime, bytes, qr, createdAt, expiresAt }) {
      db.prepare(`
        INSERT INTO photos (token, mime, bytes, qr, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET
          mime = excluded.mime, bytes = excluded.bytes, qr = excluded.qr,
          created_at = excluded.created_at, expires_at = excluded.expires_at
      `).run(token, mime, bytes, qr ?? null, createdAt, expiresAt);
    },

    /**
     * Returns the row, expiry and all, or null only when there is no such photo.
     *
     * This used to delete an expired row on the way out and report it missing.
     * It no longer does: expiry now means the guest's download link has lapsed,
     * not that the picture is gone. The organiser's gallery still has to show
     * it, so the decision of what a lapsed link means belongs to the route —
     * which knows whether it is talking to a guest or to the booth — and this
     * layer just hands back the facts.
     */
    get(token) {
      const row = db.prepare('SELECT * FROM photos WHERE token = ?').get(token);
      if (!row) return null;
      return {
        token: row.token,
        mime: row.mime,
        bytes: asBuffer(row.bytes),
        qr: asBuffer(row.qr),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    },

    delete(token) {
      db.prepare('DELETE FROM photos WHERE token = ?').run(token);
    },

    /**
     * Tokens of every photo taken before `iso`, for the gallery sweep.
     *
     * Tokens only: the sweep has a row and an archive file to remove and needs
     * nothing else to find either. Oldest first, so a run cut short has at
     * least cleared the photos furthest past their span.
     */
    olderThan(iso) {
      return db.prepare(
        'SELECT token FROM photos WHERE created_at < ? ORDER BY created_at',
      ).all(iso).map(r => r.token);
    },

    count() {
      return Number(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n);
    },

    /**
     * Newest first, metadata only — the gallery never needs the bytes. Expiry
     * comes along because the gallery lists lapsed photos too and wants to
     * mark them, rather than pretending they were never taken.
     */
    recent(limit = 60) {
      return db.prepare(
        'SELECT token, mime, created_at, expires_at FROM photos ORDER BY created_at DESC LIMIT ?',
      ).all(limit).map(r => ({
        token: r.token,
        mime: r.mime,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    },
  };

  const frames = {
    listCustom() {
      return db.prepare(
        'SELECT id, label, mime, date_stamp, created_at FROM custom_frames ORDER BY created_at',
      ).all().map(r => ({
        id: r.id,
        label: r.label,
        mimeType: r.mime,
        dateStamp: r.date_stamp ? JSON.parse(r.date_stamp) : null,
        createdAt: r.created_at,
      }));
    },

    addCustom({ label, mimeType, bytes, dateStamp }) {
      const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
      const createdAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO custom_frames (id, label, mime, bytes, date_stamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        (label || 'Custom frame').slice(0, 40),
        mimeType,
        bytes,
        dateStamp ? JSON.stringify(dateStamp) : null,
        createdAt,
      );

      // New frames join the picker switched on.
      const settings = frames.getSettings();
      settings[id] = { enabled: true };
      frames.setSettings(settings);

      return { id, label, mimeType, dateStamp: dateStamp ?? null, createdAt };
    },

    updateCustom(id, patch) {
      const row = db.prepare('SELECT id FROM custom_frames WHERE id = ?').get(id);
      if (!row) return null;
      if (typeof patch.label === 'string') {
        db.prepare('UPDATE custom_frames SET label = ? WHERE id = ?')
          .run(patch.label.slice(0, 40), id);
      }
      if ('dateStamp' in patch) {
        db.prepare('UPDATE custom_frames SET date_stamp = ? WHERE id = ?')
          .run(patch.dateStamp ? JSON.stringify(patch.dateStamp) : null, id);
      }
      return frames.listCustom().find(f => f.id === id) ?? null;
    },

    removeCustom(id) {
      const { changes } = db.prepare('DELETE FROM custom_frames WHERE id = ?').run(id);
      if (!Number(changes ?? 0)) return false;
      const settings = frames.getSettings();
      delete settings[id];
      frames.setSettings(settings);
      return true;
    },

    image(id) {
      const row = db.prepare('SELECT mime, bytes FROM custom_frames WHERE id = ?').get(id);
      return row ? { mimeType: row.mime, buffer: asBuffer(row.bytes) } : null;
    },

    getSettings() {
      return kv.get('frameSettings', {});
    },

    setSettings(next) {
      const clean = {};
      for (const [id, v] of Object.entries(next ?? {})) {
        clean[id] = { enabled: v?.enabled !== false };
      }
      kv.set('frameSettings', clean);
      return clean;
    },
  };

  const kv = {
    get(key, fallback = null) {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      if (!row) return fallback;
      try { return JSON.parse(row.value); } catch { return fallback; }
    },
    set(key, value) {
      db.prepare(`
        INSERT INTO kv (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, JSON.stringify(value));
      return value;
    },
  };

  return { file, db, photos, frames, kv, close: () => db.close() };
}
