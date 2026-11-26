// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db.mjs';

const opened = [];
afterEach(() => {
  for (const { store, dir } of opened.splice(0)) {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function open(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-db-'))) {
  const store = openDatabase(dir);
  opened.push({ store, dir });
  return store;
}

const NOW = '2026-11-25T10:00:00.000Z';
const minutes = (n) => new Date(Date.parse(NOW) + n * 60_000).toISOString();

function put(store, token, { taken = -20, expires = -10 } = {}) {
  store.photos.put({
    token, mime: 'image/jpeg', bytes: Buffer.from('x'), qr: null,
    createdAt: minutes(taken), expiresAt: minutes(expires),
  });
}

describe('kept photos', () => {
  it('starts every photo not kept', () => {
    const store = open();
    put(store, 'a');
    expect(store.photos.get('a').keptAt).toBeNull();
    expect(store.photos.kept()).toEqual([]);
  });

  it('records keeping and taking it back', () => {
    const store = open();
    put(store, 'a');
    expect(store.photos.setKept('a', NOW)).toBe(true);
    expect(store.photos.get('a').keptAt).toBe(NOW);
    expect(store.photos.recent()[0].keptAt).toBe(NOW);

    store.photos.setKept('a', null);
    expect(store.photos.get('a').keptAt).toBeNull();
  });

  it('says so when there is no such photo', () => {
    expect(open().photos.setKept('missing', NOW)).toBe(false);
  });

  it('lists kept photos oldest kept first, for the wall', () => {
    const store = open();
    put(store, 'a');
    put(store, 'b');
    put(store, 'c');
    store.photos.setKept('b', minutes(1));
    store.photos.setKept('a', minutes(2));
    expect(store.photos.kept().map(p => p.token)).toEqual(['b', 'a']);
  });

  it('never offers a kept photo to the sweep, however late it is', () => {
    const store = open();
    put(store, 'kept');
    put(store, 'lapsed');
    put(store, 'fresh', { taken: 0, expires: 10 });
    store.photos.setKept('kept', NOW);

    expect(store.photos.dueBy(NOW, minutes(-5))).toEqual(['lapsed']);
    // Older than the lifetime as set now: still not due once kept.
    expect(store.photos.dueBy(minutes(-60), minutes(60))).toEqual(['lapsed', 'fresh']);
  });

  it('adds the column to a booth whose photos table came before it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-db-'));
    const old = new DatabaseSync(path.join(dir, 'photo-booth.db'));
    old.exec(`CREATE TABLE photos (
      token TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, qr BLOB,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    old.prepare('INSERT INTO photos VALUES (?, ?, ?, ?, ?, ?)')
      .run('old', 'image/jpeg', Buffer.from('x'), null, minutes(-20), minutes(-10));
    old.close();

    const store = open(dir);
    expect(store.photos.get('old').keptAt).toBeNull();
    expect(store.photos.setKept('old', NOW)).toBe(true);
    expect(store.photos.kept().map(p => p.token)).toEqual(['old']);
  });
});
