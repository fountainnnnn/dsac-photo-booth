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
 * State is deliberately in memory. It describes what is happening right now, so
 * surviving a restart would be meaningless — and a stale phase read back from
 * disk would be worse than none.
 */

const HOLD_MS = 25_000;
const COMMAND_HISTORY = 50;

const IDLE_STATE = {
  phase: 'idle',        // idle | counting | captured
  countdown: null,      // seconds remaining while counting
  frameLabel: null,     // the frame won on the wheel, if any
  timer: 0,             // configured delay in seconds
  streaming: false,     // is the kiosk camera live
  photoToken: null,     // set once a photo is saved
  downloadUrl: null,
  // Mirrors the wheel so the phone can drive it: the organiser is holding the
  // remote, not standing at the laptop, so opening the wheel is no use unless
  // they can spin it too.
  wheelOpen: false,
  wheelSpinning: false,
  wheelResult: null,    // frame label once it lands
  updatedAt: null,
};

export function createRemoteHub() {
  let version = 1;
  let state = { ...IDLE_STATE, updatedAt: new Date().toISOString() };
  let commands = [];              // { version, action, payload, at }
  let waiters = [];               // resolvers for polls currently held open
  let lastSeen = new Map();       // client id -> timestamp, for a rough count

  function bump() {
    version += 1;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
    return version;
  }

  function snapshot(since) {
    return {
      version,
      state,
      commands: commands.filter(c => c.version > since),
    };
  }

  return {
    /**
     * Hold the request until something changes, then answer. Returns at once if
     * the caller is already behind.
     */
    async poll(since, clientId) {
      if (clientId) lastSeen.set(clientId, Date.now());

      if (!Number.isFinite(since) || since < 0 || since >= version) {
        // Nothing new yet — wait for a change, or time out and report no-op.
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          waiters.push(finish);
          setTimeout(finish, HOLD_MS);
        });
      }
      return snapshot(Number.isFinite(since) ? since : 0);
    },

    /** The kiosk reporting what it is doing. Merged, so partial updates work. */
    setState(patch) {
      const next = { ...state, ...patch };
      // Skip no-op writes so idle polls are not woken for nothing.
      const changed = Object.keys(patch).some(k => state[k] !== next[k]);
      if (!changed) return state;

      state = { ...next, updatedAt: new Date().toISOString() };
      bump();
      return state;
    },

    getState() {
      return state;
    },

    /** The phone pressing a button. Queued for the kiosk to pick up. */
    command(action, payload = {}) {
      const message = { version: version + 1, action, payload, at: new Date().toISOString() };
      commands.push(message);
      if (commands.length > COMMAND_HISTORY) {
        commands = commands.slice(-COMMAND_HISTORY);
      }
      bump();
      return message;
    },

    reset() {
      state = { ...IDLE_STATE, timer: state.timer, updatedAt: new Date().toISOString() };
      bump();
      return state;
    },

    /** Roughly how many clients polled recently — used to show "phone connected". */
    clientCount() {
      const cutoff = Date.now() - 60_000;
      for (const [id, at] of lastSeen) if (at < cutoff) lastSeen.delete(id);
      return lastSeen.size;
    },

    currentVersion() {
      return version;
    },
  };
}
