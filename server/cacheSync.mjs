import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Commits and pushes the booth's kept typed pictures, so every checkout of
 * the branch has them and the same words load at once on any laptop.
 *
 * Only `dir` is ever committed: whatever else is staged or changed in the
 * checkout is left exactly as it was. A push goes ahead only when every
 * unpushed commit is one of these, so the booth never publishes someone's
 * unfinished work for them. A push that fails (no network, the remote has
 * moved on) is tried again with the next picture, and when the booth starts.
 *
 * `kept()` is called after each new picture; it waits `delayMs` so a burst of
 * pictures goes up as one commit. `flush()` does the work now.
 */
export function createCacheSync({
  root, dir = 'cache', branch = 'open-house', delayMs = 30_000, log = console,
}) {
  let timer = null;
  let running = null;
  let again = false;
  let disabled = false;
  // Each problem is reported once, not once a picture, until a push succeeds.
  const said = new Set();
  const warnOnce = (key, message) => {
    if (said.has(key)) return;
    said.add(key);
    log.warn(message);
  };

  const git = (args, timeout = 60_000) => new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: root,
      timeout,
      windowsHide: true,
      // A push that wants a password fails, rather than wait for one nobody types.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout.trim())));
  });
  const lines = text => text.split('\n').map(l => l.trim()).filter(Boolean);

  async function commitNew() {
    if (!fs.existsSync(path.join(root, dir))) return;
    await git(['add', '--', dir]);
    const changed = lines(await git(['diff', '--cached', '--name-only', '--', dir]));
    if (!changed.length) return;
    // An avatar is a picture and the JSON saying where it goes: one picture.
    const n = new Set(changed.map(f => f.replace(/\.\w+$/, ''))).size;
    // With paths given, git commits only those, whatever else is staged.
    await git(['commit', '-m', `Keep ${n} typed picture${n === 1 ? '' : 's'} for the booth to reuse`, '--', dir]);
  }

  /** True when every commit not yet pushed only adds to `dir`. */
  async function onlyPictures(shas) {
    for (const sha of shas) {
      const parents = (await git(['rev-list', '--parents', '-n', '1', sha])).split(' ').length - 1;
      const files = lines(await git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]));
      if (parents !== 1 || files.some(f => !f.startsWith(`${dir}/`))) return false;
    }
    return true;
  }

  async function sync() {
    const current = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (current !== branch) {
      warnOnce('branch', `  Typed pictures are kept in ${dir}/ but not pushed: this checkout is on ${current}, not ${branch}.`);
      return;
    }
    await commitNew();

    let remote;
    let target;
    try {
      remote = await git(['config', `branch.${branch}.remote`]);
      target = await git(['config', `branch.${branch}.merge`]);
    } catch {
      warnOnce('upstream', `  Typed pictures are committed but not pushed: ${branch} has no branch to push to.`);
      return;
    }
    const ahead = lines(await git(['rev-list', '@{u}..HEAD']));
    if (!ahead.length) return;
    if (!(await onlyPictures(ahead))) {
      warnOnce('ahead', `  Typed pictures are committed but not pushed: ${branch} has other commits that are not pushed yet. Push them and the pictures go too.`);
      return;
    }
    await git(['push', remote, `HEAD:${target}`], 120_000);
    said.clear();
    log.log(`  Pushed typed pictures to ${remote} (${ahead.length} commit${ahead.length === 1 ? '' : 's'}).`);
  }

  function flush() {
    if (disabled) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        await sync();
      } catch (err) {
        if (err.code === 'ENOENT') {
          disabled = true;
          log.warn(`  git is not installed, so typed pictures are kept in ${dir}/ but not pushed.`);
        } else {
          const why = lines(String(err.stderr || err.message))[0] ?? 'unknown error';
          warnOnce('failed', `  Could not commit or push typed pictures; trying again with the next one. (${why})`);
        }
      } finally {
        running = null;
      }
      if (again) {
        again = false;
        await flush();
      }
    })();
    return running;
  }

  function kept() {
    if (disabled || timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delayMs);
    // A picture waiting to go up does not hold the booth open on the way out;
    // it is committed when the booth next starts.
    timer.unref?.();
  }

  return { kept, flush };
}
