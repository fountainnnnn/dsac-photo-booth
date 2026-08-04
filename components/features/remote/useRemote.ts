import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The live link between the kiosk and the organiser's phone.
 *
 * Long polling, not EventSource. SSE is the natural fit and works on
 * localhost, but nothing streams through a quick tunnel on a network that
 * blocks QUIC — cloudflared falls back to HTTP/2, which buffers streaming
 * bodies, and the phone sits there forever seeing nothing. A held request
 * returns a whole response, so it survives any proxy that can carry HTTP.
 *
 * Each poll reports the last version it saw and receives everything since, so
 * a dropped request costs nothing: the next one catches up.
 */

export type RemotePhase = 'idle' | 'counting' | 'captured';

export interface RemoteState {
  phase: RemotePhase;
  countdown: number | null;
  frameLabel: string | null;
  timer: number;
  streaming: boolean;
  photoToken: string | null;
  downloadUrl: string | null;
  updatedAt: string | null;
}

export type RemoteAction =
  | 'capture' | 'cancel' | 'retake'
  | 'settings-changed';

export interface RemoteCommand {
  version: number;
  action: RemoteAction;
  payload?: Record<string, unknown>;
  at: string;
}

const EMPTY_STATE: RemoteState = {
  phase: 'idle',
  countdown: null,
  frameLabel: null,
  timer: 0,
  streaming: false,
  photoToken: null,
  downloadUrl: null,
  updatedAt: null,
};

export interface UseRemoteOptions {
  onCommand?: (command: RemoteCommand) => void;
  enabled?: boolean;
}

export function useRemote({ onCommand, enabled = true }: UseRemoteOptions = {}) {
  const [state, setState] = useState<RemoteState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);

  // Held in refs so re-registering a handler never restarts the poll loop.
  const handlerRef = useRef(onCommand);
  handlerRef.current = onCommand;

  const clientIdRef = useRef<string>('');
  if (!clientIdRef.current) {
    clientIdRef.current = Math.random().toString(36).slice(2, 10);
  }

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    let since = 0;
    let initialised = false;
    const controller = new AbortController();

    const loop = async () => {
      while (alive) {
        const startedAt = Date.now();
        try {
          const res = await fetch(
            `/api/remote/poll?since=${since}&client=${clientIdRef.current}`,
            { signal: controller.signal, cache: 'no-store' },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json() as {
            version: number;
            state: RemoteState;
            commands: RemoteCommand[];
          };
          if (!alive) return;

          // A response without a usable version would leave `since` stuck, and
          // the loop would spin as fast as the network allows — hammering the
          // booth server. Treat it as a failure so the back-off applies.
          if (!Number.isFinite(data?.version)) throw new Error('Malformed poll response');

          setConnected(true);
          if (data.state) setState(data.state);
          // The first response is a state handshake. Commands in it pre-date
          // this component instance and must not be replayed after returning
          // from the QR/gallery/settings screen (especially an old capture).
          if (initialised) {
            for (const command of data.commands ?? []) handlerRef.current?.(command);
          }
          initialised = true;
          since = data.version;
        } catch (err) {
          if (!alive || (err as Error)?.name === 'AbortError') return;
          setConnected(false);
          await new Promise(r => setTimeout(r, 1500));
        }

        // Belt and braces: a server answering instantly for any reason must
        // still not turn this into a busy loop.
        const elapsed = Date.now() - startedAt;
        if (alive && elapsed < 250) {
          await new Promise(r => setTimeout(r, 250 - elapsed));
        }
      }
    };

    void loop();
    return () => { alive = false; controller.abort(); };
  }, [enabled]);

  /** Phone -> kiosk. */
  const send = useCallback(async (action: RemoteAction, payload?: Record<string, unknown>) => {
    await fetch('/api/remote/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    }).catch(() => { /* the phone retries by tapping again */ });
  }, []);

  /** Kiosk -> everyone. Partial patches are merged server-side. */
  const publish = useCallback(async (patch: Partial<RemoteState>) => {
    await fetch('/api/remote/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* best effort — the kiosk keeps working regardless */ });
  }, []);

  return { state, connected, send, publish };
}
