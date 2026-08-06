import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * The bridge between the kiosk and the organiser's phone.
 *
 * The organiser stands away from the laptop, so the phone drives the shutter
 * and the kiosk reports back what it is doing.
 *
 * This is long polling, not server-sent events. SSE was the obvious choice and
 * works perfectly on localhost, but it does not survive the tunnel: quick
 * tunnels fall back to cloudflared's HTTP/2 transport on any network that
 * blocks QUIC (UDP 7844) — which venue and campus Wi-Fi routinely does — and
 * that transport buffers streaming bodies, so not one event ever arrives. A
 * held request returns a complete response, so it passes through anything that
 * can carry ordinary HTTP.
 *
 * Everything is versioned. A client sends the last version it saw and gets back
 * whatever has happened since, so a dropped connection loses nothing: the next
 * poll simply catches up.
 *
 * On Node this was a module-level closure. That cannot work on Workers, and the
 * reason is exactly the mechanism above: a poll held open in one isolate can
 * never be woken by a POST that lands in another, and there is no way to say
 * which isolate a request will reach. A Durable Object is the one place where
 * "everything for this hub happens in the same object" is guaranteed, which is
 * what makes the waiters array below correct rather than wishful.
 */

const HOLD_MS = 25_000;
const COMMAND_HISTORY = 50;
const CLIENT_CUTOFF_MS = 60_000;

export interface RemoteState {
  phase: 'idle' | 'counting' | 'captured';
  countdown: number | null;
  frameLabel: string | null;
  timer: number;
  streaming: boolean;
  photoToken: string | null;
  downloadUrl: string | null;
  updatedAt: string | null;
}

export interface RemoteCommand {
  version: number;
  action: string;
  payload: Record<string, unknown>;
  at: string;
}

const IDLE_STATE: RemoteState = {
  phase: 'idle',        // idle | counting | captured
  countdown: null,      // seconds remaining while counting
  frameLabel: null,     // the frame the operator selected, if any
  timer: 0,             // configured delay in seconds
  streaming: false,     // is the kiosk camera live
  photoToken: null,     // set once a photo is saved
  downloadUrl: null,
  updatedAt: null,
};

export class RemoteHub extends DurableObject<Env> {
  // Deliberately instance fields, never `ctx.storage`. The state describes what
  // is happening right now — a countdown, a live camera — so surviving a
  // restart would be meaningless, and a stale phase read back from disk would
  // be worse than none. A Durable Object can be evicted when idle; when that
  // happens this resets to idle, which is precisely what a server restart did
  // in the Node build. Nothing here is worth a write.
  private version = 1;
  private state: RemoteState = { ...IDLE_STATE, updatedAt: new Date().toISOString() };
  private commands: RemoteCommand[] = [];
  private waiters: Array<() => void> = [];
  private lastSeen = new Map<string, number>();

  private bump(): number {
    this.version += 1;
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
    return this.version;
  }

  private snapshot(since: number) {
    return {
      version: this.version,
      state: this.state,
      commands: this.commands.filter((c) => c.version > since),
    };
  }

  /**
   * Hold the request until something changes, then answer. Returns at once if
   * the caller is already behind.
   */
  private async poll(since: number, clientId: string) {
    if (clientId) this.lastSeen.set(clientId, Date.now());

    if (!Number.isFinite(since) || since < 0 || since >= this.version) {
      // Nothing new yet — wait for a change, or time out and report no-op.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, HOLD_MS);
        this.waiters.push(finish);
      });
    }
    return this.snapshot(Number.isFinite(since) ? since : 0);
  }

  /** The kiosk reporting what it is doing. Merged, so partial updates work. */
  private setState(patch: Partial<RemoteState>): RemoteState {
    const next = { ...this.state, ...patch };
    // Skip no-op writes so idle polls are not woken for nothing.
    const changed = Object.keys(patch).some(
      (k) => this.state[k as keyof RemoteState] !== next[k as keyof RemoteState],
    );
    if (!changed) return this.state;

    this.state = { ...next, updatedAt: new Date().toISOString() };
    this.bump();
    return this.state;
  }

  /** The phone pressing a button. Queued for the kiosk to pick up. */
  private command(action: string, payload: Record<string, unknown> = {}): RemoteCommand {
    const message: RemoteCommand = {
      version: this.version + 1,
      action,
      payload,
      at: new Date().toISOString(),
    };
    this.commands.push(message);
    if (this.commands.length > COMMAND_HISTORY) {
      this.commands = this.commands.slice(-COMMAND_HISTORY);
    }
    this.bump();
    return message;
  }

  private reset(): RemoteState {
    this.state = { ...IDLE_STATE, timer: this.state.timer, updatedAt: new Date().toISOString() };
    this.bump();
    return this.state;
  }

  /** Roughly how many clients polled recently — used to show "phone connected". */
  private clientCount(): number {
    const cutoff = Date.now() - CLIENT_CUTOFF_MS;
    for (const [id, at] of this.lastSeen) if (at < cutoff) this.lastSeen.delete(id);
    return this.lastSeen.size;
  }

  /**
   * Routed here by index.ts with the path preserved, so the wire format the
   * React client already speaks (components/features/remote/useRemote.ts) is
   * untouched. RPC methods would be the house default, but a held poll is a
   * response with headers on it — `Cache-Control` in particular — and that is a
   * `fetch` shape, so the whole surface stays HTTP for consistency.
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/poll') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
      const clientId = String(url.searchParams.get('client') ?? '');
      try {
        const payload = await this.poll(since, clientId);
        // A held response must not be cached anywhere along the way.
        return Response.json(payload, {
          headers: { 'Cache-Control': 'no-store, no-transform' },
        });
      } catch {
        return Response.json({ error: 'Poll failed' }, { status: 500 });
      }
    }

    if (request.method === 'GET' && path === '/state') {
      return Response.json({
        state: this.state,
        version: this.version,
        listeners: this.clientCount(),
      });
    }

    if (request.method === 'POST' && path === '/state') {
      const patch = await readJson(request);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return Response.json({ error: 'Expected a state object' }, { status: 400 });
      }
      return Response.json({ state: this.setState(patch as Partial<RemoteState>) });
    }

    if (request.method === 'POST' && path === '/command') {
      const body = (await readJson(request)) as { action?: unknown; payload?: unknown } | null;
      const action = typeof body?.action === 'string' ? body.action : '';
      if (!action) return Response.json({ error: 'Expected an action' }, { status: 400 });
      // `reset` arrived as a command in the Express build and is kept as one
      // here, answering with { state } exactly as it did — a phone that has not
      // been reloaded still sends it that way.
      if (action === 'reset') return Response.json({ state: this.reset() });
      const payload = (body?.payload ?? {}) as Record<string, unknown>;
      return Response.json({ command: this.command(action, payload) });
    }

    if (request.method === 'POST' && path === '/reset') {
      return Response.json({ state: this.reset() });
    }

    return Response.json({ error: 'Unknown remote route' }, { status: 404 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
