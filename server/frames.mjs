import crypto from 'node:crypto';

/**
 * Frame catalogue: per-frame spin weights plus any frames uploaded through the
 * settings page.
 *
 * The built-in frames' artwork and date-stamp geometry live in the frontend
 * (types/frame.ts), because that is where they are measured and drawn. The
 * server deliberately stores only what an operator can change — weight and
 * enabled — so the two never disagree about geometry.
 *
 * Everything persists through the normal storage seam, so a mounted volume
 * covers it and no driver work is needed.
 */

const CONFIG_KEY = 'frames/config.json';

const EMPTY = { settings: {}, custom: [] };

function extForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  return 'jpg';
}

export function createFrameCatalogue(storage) {
  function read() {
    const buf = storage.blobs.get(CONFIG_KEY);
    if (!buf) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(buf.toString('utf-8'));
      return {
        settings: parsed.settings ?? {},
        custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      };
    } catch {
      // A corrupt config must not take the kiosk down; fall back to defaults.
      return structuredClone(EMPTY);
    }
  }

  function write(config) {
    storage.blobs.put(CONFIG_KEY, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
  }

  return {
    get() {
      return read();
    },

    /**
     * Merge in weight/enabled overrides. Accepts any id — built-in or custom —
     * so one save from the settings page covers the whole catalogue.
     */
    saveSettings(settings) {
      const config = read();
      for (const [id, value] of Object.entries(settings ?? {})) {
        const weight = Number(value?.weight);
        config.settings[id] = {
          weight: Number.isFinite(weight) ? Math.max(0, Math.min(100, weight)) : 1,
          enabled: value?.enabled !== false,
        };
      }
      write(config);
      return config;
    },

    addCustom({ buffer, mimeType, label, dateStamp }) {
      const config = read();
      const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
      const key = `frames/${id}.${extForMime(mimeType)}`;

      storage.blobs.put(key, buffer);
      config.custom.push({
        id,
        label: (label || 'Custom frame').slice(0, 40),
        key,
        mimeType,
        dateStamp: dateStamp ?? null,
        createdAt: new Date().toISOString(),
      });
      config.settings[id] = { weight: 1, enabled: true };
      write(config);
      return config.custom[config.custom.length - 1];
    },

    removeCustom(id) {
      const config = read();
      const index = config.custom.findIndex((f) => f.id === id);
      if (index < 0) return false;

      const [removed] = config.custom.splice(index, 1);
      if (removed.key) storage.blobs.delete(removed.key);
      delete config.settings[id];
      write(config);
      return true;
    },

    updateCustom(id, patch) {
      const config = read();
      const frame = config.custom.find((f) => f.id === id);
      if (!frame) return null;

      if (typeof patch.label === 'string') frame.label = patch.label.slice(0, 40);
      if ('dateStamp' in patch) frame.dateStamp = patch.dateStamp ?? null;
      write(config);
      return frame;
    },

    imageFor(id) {
      const frame = read().custom.find((f) => f.id === id);
      if (!frame) return null;
      const buffer = storage.blobs.get(frame.key);
      return buffer ? { buffer, mimeType: frame.mimeType } : null;
    },
  };
}
