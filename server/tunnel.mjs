import { spawn } from 'node:child_process';

/**
 * A public URL for the booth, so QR codes work from any network.
 *
 * Guests scan on mobile data, not the venue Wi-Fi, so a LAN address is no use
 * to them. A quick Cloudflare tunnel gives the laptop a public https URL for
 * as long as the app runs.
 *
 * Failure is never fatal: if cloudflared is missing or the tunnel does not come
 * up, the booth still runs and falls back to the LAN address. Taking photos is
 * more important than handing them out.
 */

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const REGISTERED_PATTERN = /Registered tunnel connection/i;
const START_TIMEOUT_MS = 45_000;
/** Hand back the URL anyway if registration is slow but the URL exists. */
const REGISTER_GRACE_MS = 12_000;

/** cloudflared on PATH, else the bundled npm binary. */
async function resolveBinary() {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  try {
    const mod = await import('cloudflared');
    if (mod?.bin) return mod.bin;
  } catch { /* package not installed — fall through to PATH */ }
  return 'cloudflared';
}

export async function startTunnel(port) {
  const bin = await resolveBinary();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, [
        'tunnel',
        '--url', `http://localhost:${port}`,
        '--no-autoupdate',
        // cloudflared prefers QUIC over UDP 7844, which school and corporate
        // networks routinely block — the tunnel then reports a URL that only
        // ever answers "error 1033". HTTP/2 runs over ordinary TCP 443 and
        // gets through anywhere the web does.
        '--protocol', process.env.CLOUDFLARED_PROTOCOL || 'http2',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ url: null, stop: () => {}, error: err.message });
      return;
    }

    let settled = false;
    let url = null;
    let graceTimer = null;
    // Kept so a failure can explain itself instead of just saying "timed out".
    const recent = [];

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve(result);
    };

    const stop = () => { try { child.kill(); } catch { /* already gone */ } };

    /**
     * cloudflared prints the URL before it has actually connected, so waiting
     * only for that hands out a link that answers "error 1033". Wait for a
     * registered connection, with a grace period so a slow-but-working tunnel
     * is not thrown away.
     */
    const scan = (chunk) => {
      const text = String(chunk);
      for (const line of text.split('\n')) {
        if (line.trim()) recent.push(line.trim());
      }
      if (recent.length > 40) recent.splice(0, recent.length - 40);

      if (!url) {
        const match = text.match(URL_PATTERN);
        if (match) {
          url = match[0];
          graceTimer = setTimeout(() => finish({ url, stop, error: null }), REGISTER_GRACE_MS);
        }
      }
      if (url && REGISTERED_PATTERN.test(text)) finish({ url, stop, error: null });
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);

    child.on('error', (err) => {
      finish({
        url: null,
        stop: () => {},
        error: err.code === 'ENOENT'
          ? 'cloudflared not found. Install it, or run: npm install cloudflared'
          : err.message,
      });
    });

    child.on('exit', (code) => {
      const why = recent.filter(l => /ERR|error|failed/i.test(l)).slice(-2).join(' | ');
      finish({
        url: null,
        stop: () => {},
        error: `cloudflared exited (code ${code})${why ? ` — ${why}` : ''}`,
      });
    });

    const timer = setTimeout(() => {
      stop();
      const why = recent.filter(l => /ERR|error|failed|WARNING/i.test(l)).slice(-2).join(' | ');
      finish({
        url: null,
        stop: () => {},
        error: `timed out waiting for the tunnel${why ? ` — ${why}` : ''}`,
      });
    }, START_TIMEOUT_MS);

    // Once we have a URL the process must keep running; only tear it down with us.
    const cleanup = () => stop();
    process.once('exit', cleanup);
    process.once('SIGINT', () => { cleanup(); process.exit(0); });
    process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  });
}
