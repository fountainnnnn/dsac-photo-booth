/**
 * New versions, without reinstalling by hand.
 *
 * The booth ships as a packaged .exe, so a fix used to mean sending someone a
 * 113 MB file and trusting they replaced the right one. The installed app now
 * asks GitHub whether a newer release exists and offers to fetch it.
 *
 * Nothing happens on its own. A booth is a live thing at an event, and an
 * update that installed itself would restart the app with a queue of guests in
 * front of it — so this only ever reports, and the operator presses the
 * button. Between events that is a five-second job in Settings; during one,
 * ignoring it costs nothing.
 *
 * The Electron side owns the actual updater (see electron/main.cjs). This
 * module is only the state it publishes and the actions the Settings page can
 * ask for, which is what keeps the Express server free of any Electron import
 * — run from a terminal, `supported` is false and the card does not appear.
 */

/**
 * @typedef {'unsupported'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'error'} UpdateStatus
 */

const state = {
  /** False outside the packaged app: a checkout updates with git, not this. */
  supported: false,
  status: /** @type {UpdateStatus} */ ('unsupported'),
  currentVersion: null,
  availableVersion: null,
  releaseNotes: null,
  /** 0-100 while downloading. */
  percent: 0,
  error: null,
  /** Set once a check has run, so the card can say "checked just now". */
  checkedAt: null,
};

/** Filled in by the Electron side; each returns a promise and may throw. */
let actions = null;

export function configureUpdates(impl, currentVersion) {
  actions = impl;
  state.supported = true;
  state.status = 'idle';
  state.currentVersion = currentVersion;
}

export function patchUpdateState(patch) {
  Object.assign(state, patch);
}

export function getUpdateState() {
  return { ...state };
}

/**
 * Where each action leaves the state the instant it is asked for, before
 * anything has actually happened.
 *
 * This is not decoration. The card only polls for progress while the status
 * says something is moving, so a reply that still said 'available' would stop
 * it watching the very download it just started.
 */
const OPTIMISTIC = {
  check: { status: 'checking', error: null },
  download: { status: 'downloading', percent: 0, error: null },
  install: { status: 'ready', error: null },
};

/**
 * Run one of the three things the operator can ask for, and reply at once.
 *
 * Deliberately not awaited. `downloadUpdate()` settles only when the whole
 * 113 MB has arrived, so awaiting it held the request open for the entire
 * download — the button appeared to do nothing while the file was in fact
 * coming down, which is worse than an error. Progress reaches the card through
 * the updater's own events instead.
 *
 * Errors are recorded on the state rather than thrown at the caller: the card
 * shows the last failure, and a booth that cannot reach GitHub — a school
 * network, an event with no wifi — must carry on working regardless.
 */
export function runUpdateAction(name) {
  if (!actions) return { ok: false, error: 'Updates are only available in the installed app.' };

  const action = actions[name];
  if (!action) return { ok: false, error: `Unknown update action: ${name}` };

  patchUpdateState(OPTIMISTIC[name] ?? {});

  Promise.resolve().then(action).catch((err) => {
    patchUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return { ok: true };
}
