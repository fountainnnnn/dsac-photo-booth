/**
 * Everything the booth persists, ported from server/db.mjs to D1.
 *
 * The rules are the original's; only the runtime moved. Two differences are
 * worth knowing before reading further:
 *
 *  - Every method is async. node:sqlite was synchronous, so the Express routes
 *    could treat a read as free; here each one is a round trip and the callers
 *    have to await.
 *  - No bytes. Photo, QR and frame artwork live in the blob store (see
 *    worker/blobs.ts); these tables carry metadata only. That is why
 *    `sweepExpired` returns the tokens it removed instead of a count — the
 *    caller needs them to delete the matching blobs, which no longer disappear
 *    for free when the row does.
 */

export interface PhotoMeta {
  token: string;
  mime: string;
  createdAt: string;
  expiresAt: string;
}

export interface CustomFrame {
  id: string;
  label: string;
  mimeType: string;
  dateStamp: unknown | null;
  createdAt: string;
}

export interface FrameSettings {
  [id: string]: { enabled: boolean };
}

interface PhotoRow {
  token: string;
  mime: string;
  created_at: string;
  expires_at: string;
}

interface FrameRow {
  id: string;
  label: string;
  mime: string;
  date_stamp: string | null;
  created_at: string;
}

export function createDb(d1: D1Database) {
  const photos = {
    /**
     * Upsert rather than insert: a retried capture reuses its token, and the
     * booth would rather overwrite than fail halfway through a countdown.
     */
    async put({ token, mime, createdAt, expiresAt }: PhotoMeta): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO photos (token, mime, created_at, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(token) DO UPDATE SET
             mime = excluded.mime,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at`,
        )
        .bind(token, mime, createdAt, expiresAt)
        .run();
    },

    /**
     * Returns null for a missing or expired photo, dropping it on the way out.
     *
     * The delete-on-read matters because the sweep only runs every few hours:
     * without it a guest could follow a stale QR code and still be handed a
     * photo the retention promise says is gone. The blob is left to the caller,
     * which is the one holding the blob store.
     */
    async get(token: string): Promise<PhotoMeta | null> {
      const row = await d1
        .prepare('SELECT token, mime, created_at, expires_at FROM photos WHERE token = ?')
        .bind(token)
        .first<PhotoRow>();
      if (!row) return null;
      if (Date.now() > new Date(row.expires_at).getTime()) {
        await photos.delete(token);
        return null;
      }
      return {
        token: row.token,
        mime: row.mime,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    },

    async delete(token: string): Promise<void> {
      await d1.prepare('DELETE FROM photos WHERE token = ?').bind(token).run();
    },

    /**
     * Returns the tokens it deleted rather than a count. Selecting first and
     * deleting second is a wider window than the original's single DELETE, but
     * the alternative is orphaned blobs paying rent forever, and a photo that
     * lands in that window is one written milliseconds before its own expiry.
     */
    async sweepExpired(): Promise<string[]> {
      const now = new Date().toISOString();
      const { results } = await d1
        .prepare('SELECT token FROM photos WHERE expires_at < ?')
        .bind(now)
        .all<{ token: string }>();
      const tokens = (results ?? []).map(r => r.token);
      if (!tokens.length) return [];
      await d1.prepare('DELETE FROM photos WHERE expires_at < ?').bind(now).run();
      return tokens;
    },

    async count(): Promise<number> {
      const row = await d1
        .prepare('SELECT COUNT(*) AS n FROM photos')
        .first<{ n: number }>();
      return Number(row?.n ?? 0);
    },

    /** Newest first, metadata only — the gallery never needs the bytes. */
    async recent(limit = 60): Promise<PhotoMeta[]> {
      const { results } = await d1
        .prepare(
          'SELECT token, mime, created_at, expires_at FROM photos ORDER BY created_at DESC LIMIT ?',
        )
        .bind(limit)
        .all<PhotoRow>();
      return (results ?? []).map(r => ({
        token: r.token,
        mime: r.mime,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    },
  };

  const frames = {
    async listCustom(): Promise<CustomFrame[]> {
      const { results } = await d1
        .prepare(
          'SELECT id, label, mime, date_stamp, created_at FROM custom_frames ORDER BY created_at',
        )
        .all<FrameRow>();
      return (results ?? []).map(toFrame);
    },

    /**
     * The bytes are the route's problem now — it writes them to `frame/<id>`
     * once this hands back the id. Labels are clipped at 40 characters because
     * the picker is a row of chips and a long one wraps the whole strip.
     */
    async addCustom({
      label,
      mimeType,
      dateStamp,
    }: {
      label?: string;
      mimeType: string;
      dateStamp?: unknown;
    }): Promise<CustomFrame> {
      const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
      const createdAt = new Date().toISOString();
      const cleanLabel = (label || 'Custom frame').slice(0, 40);
      await d1
        .prepare(
          `INSERT INTO custom_frames (id, label, mime, date_stamp, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          cleanLabel,
          mimeType,
          dateStamp ? JSON.stringify(dateStamp) : null,
          createdAt,
        )
        .run();

      // New frames join the picker switched on.
      const settings = await frames.getSettings();
      settings[id] = { enabled: true };
      await frames.setSettings(settings);

      return { id, label: cleanLabel, mimeType, dateStamp: dateStamp ?? null, createdAt };
    },

    async updateCustom(
      id: string,
      patch: Record<string, unknown>,
    ): Promise<CustomFrame | null> {
      const row = await d1
        .prepare('SELECT id FROM custom_frames WHERE id = ?')
        .bind(id)
        .first<{ id: string }>();
      if (!row) return null;
      if (typeof patch.label === 'string') {
        await d1
          .prepare('UPDATE custom_frames SET label = ? WHERE id = ?')
          .bind(patch.label.slice(0, 40), id)
          .run();
      }
      // Presence, not truthiness: sending dateStamp: null is how the editor
      // clears a stamp, and that has to survive the round trip.
      if ('dateStamp' in patch) {
        await d1
          .prepare('UPDATE custom_frames SET date_stamp = ? WHERE id = ?')
          .bind(patch.dateStamp ? JSON.stringify(patch.dateStamp) : null, id)
          .run();
      }
      const updated = await d1
        .prepare(
          'SELECT id, label, mime, date_stamp, created_at FROM custom_frames WHERE id = ?',
        )
        .bind(id)
        .first<FrameRow>();
      return updated ? toFrame(updated) : null;
    },

    /**
     * Deleting the frame has to delete its settings entry too, or the picker
     * keeps a switch for artwork that no longer exists and the settings blob
     * grows a tail of dead ids across an event.
     */
    async removeCustom(id: string): Promise<boolean> {
      const result = await d1
        .prepare('DELETE FROM custom_frames WHERE id = ?')
        .bind(id)
        .run();
      if (!Number(result.meta?.changes ?? 0)) return false;
      const settings = await frames.getSettings();
      delete settings[id];
      await frames.setSettings(settings);
      return true;
    },

    getSettings(): Promise<FrameSettings> {
      return kv.get<FrameSettings>('frameSettings', {});
    },

    /**
     * Normalised on the way in: anything that is not an explicit `false` counts
     * as enabled, so a half-written client patch cannot silently hide a frame.
     */
    async setSettings(next: unknown): Promise<FrameSettings> {
      const clean: FrameSettings = {};
      for (const [id, v] of Object.entries((next ?? {}) as Record<string, unknown>)) {
        clean[id] = { enabled: (v as { enabled?: unknown } | null)?.enabled !== false };
      }
      await kv.set('frameSettings', clean);
      return clean;
    },
  };

  const kv = {
    /**
     * Unparseable text falls back rather than throwing. The values here are
     * settings; a corrupt row should cost the booth its preferences, not its
     * ability to start.
     */
    async get<T>(key: string, fallback: T): Promise<T> {
      const row = await d1
        .prepare('SELECT value FROM kv WHERE key = ?')
        .bind(key)
        .first<{ value: string }>();
      if (!row) return fallback;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return fallback;
      }
    },

    async set<T>(key: string, value: T): Promise<T> {
      await d1
        .prepare(
          `INSERT INTO kv (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .bind(key, JSON.stringify(value))
        .run();
      return value;
    },
  };

  return { photos, frames, kv };
}

export type Db = ReturnType<typeof createDb>;

function toFrame(r: FrameRow): CustomFrame {
  return {
    id: r.id,
    label: r.label,
    mimeType: r.mime,
    dateStamp: r.date_stamp ? safeParse(r.date_stamp) : null,
    createdAt: r.created_at,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
