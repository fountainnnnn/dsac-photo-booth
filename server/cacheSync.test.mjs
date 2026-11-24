// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCacheSync } from './cacheSync.mjs';

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (root, file, text = 'x') => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

/** A checkout of `open-house`, pushed once to a remote of its own. */
function checkout() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-sync-'));
  dirs.push(base);
  const remote = path.join(base, 'remote.git');
  const root = path.join(base, 'work');
  git(base, 'init', '--bare', '-q', remote);
  git(base, 'clone', '-q', remote, root);
  git(root, 'config', 'user.name', 'Booth');
  git(root, 'config', 'user.email', 'booth@example.com');
  git(root, 'checkout', '-q', '-b', 'open-house');
  write(root, 'README.md', 'booth');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'Start');
  git(root, 'push', '-q', '-u', 'origin', 'open-house');
  const log = { log: vi.fn(), warn: vi.fn() };
  return { root, remote, log, sync: createCacheSync({ root, log }) };
}

const pushed = remote => git(remote, 'log', '--format=%s', 'open-house').split('\n');
const filesIn = (remote, ref = 'open-house') => git(remote, 'ls-tree', '-r', '--name-only', ref).split('\n');

describe('createCacheSync', () => {
  it('commits only the new pictures and pushes them, leaving other work alone', async () => {
    const { root, remote, sync } = checkout();
    write(root, 'cache/backgrounds/v9/aaa.jpg');
    write(root, 'cache/avatars/v5/bbb.jpg');
    write(root, 'cache/avatars/v5/bbb.json', '{}');
    // Someone's work in progress: one file staged, one only edited.
    write(root, 'staged.txt');
    git(root, 'add', 'staged.txt');
    write(root, 'README.md', 'edited');

    await sync.flush();

    expect(pushed(remote)[0]).toBe('Keep 2 typed pictures for the booth to reuse');
    expect(filesIn(remote)).toEqual(expect.arrayContaining([
      'cache/backgrounds/v9/aaa.jpg', 'cache/avatars/v5/bbb.jpg', 'cache/avatars/v5/bbb.json',
    ]));
    expect(filesIn(remote)).not.toContain('staged.txt');
    // (Trimmed, so the first line's leading space is gone.)
    expect(git(root, 'status', '--porcelain')).toBe('M README.md\nA  staged.txt');
  });

  it('does nothing when there is nothing new', async () => {
    const { remote, sync } = checkout();
    await sync.flush();
    expect(pushed(remote)).toEqual(['Start']);
  });

  it('holds back the push while someone else\'s commits are waiting to go', async () => {
    const { root, remote, log, sync } = checkout();
    write(root, 'code.txt');
    git(root, 'add', 'code.txt');
    git(root, 'commit', '-q', '-m', 'Unfinished work');
    write(root, 'cache/backgrounds/v9/ccc.jpg');

    await sync.flush();

    expect(pushed(remote)).toEqual(['Start']);
    expect(git(root, 'log', '-1', '--format=%s')).toBe('Keep 1 typed picture for the booth to reuse');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not pushed yet'));
  });

  it('pushes what an earlier run committed but could not send', async () => {
    const { root, remote, sync } = checkout();
    write(root, 'cache/backgrounds/v9/ddd.jpg');
    git(root, 'add', 'cache');
    git(root, 'commit', '-q', '-m', 'Keep 1 typed picture for the booth to reuse');

    await sync.flush();

    expect(filesIn(remote)).toContain('cache/backgrounds/v9/ddd.jpg');
  });

  it('leaves another branch alone', async () => {
    const { root, remote, log, sync } = checkout();
    git(root, 'checkout', '-q', '-b', 'feature');
    write(root, 'cache/backgrounds/v9/eee.jpg');

    await sync.flush();

    expect(git(root, 'log', '-1', '--format=%s')).toBe('Start');
    expect(pushed(remote)).toEqual(['Start']);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not open-house'));
  });
});
