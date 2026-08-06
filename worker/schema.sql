-- The booth's D1 schema.
--
-- Ported from the SQLite schema in server/db.mjs, with one structural change:
-- the bytes are gone. On the single-file Node build it made sense to keep photo
-- and frame artwork in the database, because then the whole event was one file
-- to copy or delete. On Workers the durable store for bytes is R2 (or, until
-- the account has R2 switched on, the `blobs` table below), so these tables
-- carry metadata only and the bytes live under keys `photo/<token>`,
-- `qr/<token>` and `frame/<id>`.
--
-- Every statement is IF NOT EXISTS so re-applying the file against a live
-- database is a no-op rather than an error. D1 has no PRAGMA support, so the
-- original's journal_mode and foreign_keys pragmas are simply dropped; WAL is
-- not ours to choose here and we declare no foreign keys anyway.

CREATE TABLE IF NOT EXISTS photos (
  token      TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Kept from when a cron sweep ranged over expires_at. Nothing does now —
-- expiry retires a download link and never deletes a photo — but the index
-- costs little and dropping it would be a migration against live databases
-- for no gain.
CREATE INDEX IF NOT EXISTS photos_expires ON photos (expires_at);

CREATE TABLE IF NOT EXISTS custom_frames (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  mime       TEXT NOT NULL,
  date_stamp TEXT,
  created_at TEXT NOT NULL
);

-- Settings that are really just a JSON blob with a name: capture settings,
-- presets, frame enable/disable. Kept as text so the shapes can drift without
-- a migration.
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Sessions were a Map in the Node build. Isolates share no memory, so a login
-- handled by one of them has to be visible to all the others; that means a
-- table. The cron trigger sweeps these rows — they are the only thing it
-- deletes now that photo retention is manual.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Stopgap blob storage for development, used only while R2 is unavailable on
-- the account. D1 caps a row at roughly a megabyte or two, and a 4K capture
-- comfortably exceeds that, so writes here can and do fail. See worker/blobs.ts
-- — the failure is deliberately not swallowed. Once R2 is enabled this table
-- goes unused and can be dropped.
CREATE TABLE IF NOT EXISTS blobs (
  key          TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes        BLOB NOT NULL
);
