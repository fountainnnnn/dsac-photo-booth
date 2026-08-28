const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * The booth as a desktop app.
 *
 * This is a thin shell: it runs the same Express server `npm start` runs, then
 * points a window at it. Nothing in the booth knows it is inside Electron, so
 * the CLI and the packaged .exe stay the same program.
 *
 * The point of packaging is that the booth laptop needs nothing installed — no
 * Node, no npm install, no terminal. Electron brings its own Node 24 (which is
 * where `node:sqlite` comes from) and its own Chromium.
 *
 * CommonJS on purpose. Electron will load an ESM entrypoint, but `whenReady()`
 * never resolves under one, so the app hangs before it opens a window. The
 * server is still ESM and is pulled in with a dynamic import below.
 */

const ROOT = path.join(__dirname, '..');
const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
const ORIGIN = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 20_000;

// Two booths on one port would fight over the same database, and the second
// would show nothing but EADDRINUSE. Hand focus to the first instead.
if (!app.requestSingleInstanceLock()) app.exit(0);

/**
 * Photos and settings need somewhere writable that survives an upgrade. Inside
 * the packaged app is neither, so point the database at the per-user data
 * directory before the server reads its config.
 */
process.env.STORAGE_DIR ??= path.join(app.getPath('userData'), 'data');

/**
 * cloudflared is a real executable, so it ships beside the app rather than
 * inside the asar archive — a path Windows cannot start a process from.
 *
 * It is also not the copy in node_modules: that one is built for whatever
 * machine ran `npm install`, so a build made on a Mac would carry a Mach-O
 * file here. electron-builder puts the Windows binary at resources/, and the
 * tunnel is pointed at it.
 */
if (app.isPackaged) {
  process.env.CLOUDFLARED_BIN ??= path.join(
    process.resourcesPath,
    process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared',
  );
}

let win = null;

/**
 * A packaged Windows app has no console, so the server's startup banner — the
 * public URL, the database path, why the tunnel failed — would vanish. Keep a
 * copy on disk; it is the only thing to go on when the booth misbehaves at an
 * event and there is no terminal to look at.
 */
function teeConsoleToLogFile() {
  if (!app.isPackaged) return null;
  const file = path.join(app.getPath('userData'), 'booth.log');
  let out;
  try {
    out = fs.createWriteStream(file, { flags: 'a' });
  } catch {
    return null; // logging is a convenience; never let it stop the booth
  }
  out.write(`\n===== started ${new Date().toISOString()} =====\n`);
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try { out.write(args.map(String).join(' ') + '\n'); } catch { /* disk full */ }
      original(...args);
    };
  }
  return file;
}

/**
 * Whether something else already holds the port.
 *
 * This has to be checked *before* starting our own server, because otherwise
 * the failure is silent and deeply confusing: our Express gets EADDRINUSE and
 * dies quietly, but the health check below still succeeds — answered by the
 * other server — so the window opens onto someone else's booth, showing their
 * settings and their (possibly dead) tunnel URL. Everything looks fine and
 * nothing works.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '0.0.0.0');
  });
}

/** Resolves once the server answers, so the window never opens on a dead port. */
async function waitForServer() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#101014',   // matches --stage, so there is no white flash
    autoHideMenuBar: true,
    title: 'DSAC Photo Booth',
    webPreferences: {
      // The page is ordinary web content served over http and has no business
      // reaching Node. These are already the defaults; say so explicitly.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.once('ready-to-show', () => { win.show(); win.maximize(); });

  // External links (the LinkedIn share) belong in the real browser, not in a
  // second kiosk window with no address bar and no way back.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`${ORIGIN}/capture`);
}

/**
 * A kiosk has nobody to click "Allow", and the camera is the whole app. Grant
 * media to our own origin, and refuse everything else outright.
 */
function allowCameraOnOurOriginOnly() {
  const allowed = new Set(['media', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, done) => {
    done(allowed.has(permission) && contents.getURL().startsWith(ORIGIN));
  });
  session.defaultSession.setPermissionCheckHandler((_c, permission, origin) => (
    allowed.has(permission) && origin.startsWith(ORIGIN)
  ));
}

/** Enough menu to run a booth: the two pages, fullscreen, reload, quit. */
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Booth',
    submenu: [
      { label: 'Capture', accelerator: 'CmdOrCtrl+1', click: () => win?.loadURL(`${ORIGIN}/capture`) },
      { label: 'Settings', accelerator: 'CmdOrCtrl+2', click: () => win?.loadURL(`${ORIGIN}/settings`) },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }]));
}

/**
 * Hand the Settings page a working "check for updates".
 *
 * Nothing is downloaded or installed without a click: `autoDownload` and
 * `autoInstallOnAppQuit` are both off. A booth is running in front of people,
 * and an update that restarted the app mid-event would be a worse bug than
 * whatever it was fixing.
 *
 * The updater and the Express server talk through server/updates.mjs, which
 * both sides import by the same path and therefore share. That is what keeps
 * Electron out of the server: run from a terminal, nothing calls
 * `configureUpdates`, the state stays `unsupported`, and the card hides.
 *
 * Failure here is never fatal. A booth on a school network that blocks GitHub
 * must still open and take photos.
 */
async function wireUpdates() {
  if (!app.isPackaged) return;

  let updates;
  let autoUpdater;
  try {
    updates = await import(pathToFileURL(path.join(ROOT, 'server', 'updates.mjs')).href);
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error(`  Updates unavailable: ${err.message}`);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // The .exe is unsigned, so there is no signature for the updater to verify.
  // Saying so is honest; the alternative is a silent failure at install time.
  autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

  autoUpdater.on('checking-for-update', () => updates.patchUpdateState({
    status: 'checking', error: null,
  }));
  autoUpdater.on('update-available', (info) => updates.patchUpdateState({
    status: 'available',
    availableVersion: info?.version ?? null,
    releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : null,
    checkedAt: new Date().toISOString(),
    error: null,
  }));
  autoUpdater.on('update-not-available', () => updates.patchUpdateState({
    status: 'current', availableVersion: null, checkedAt: new Date().toISOString(), error: null,
  }));
  autoUpdater.on('download-progress', (p) => updates.patchUpdateState({
    status: 'downloading', percent: Math.round(p?.percent ?? 0),
  }));
  autoUpdater.on('update-downloaded', () => updates.patchUpdateState({
    status: 'ready', percent: 100,
  }));
  autoUpdater.on('error', (err) => updates.patchUpdateState({
    status: 'error', error: err?.message ?? String(err),
  }));

  updates.configureUpdates({
    check: () => autoUpdater.checkForUpdates(),
    download: () => autoUpdater.downloadUpdate(),
    // The window is closed first so the installer is not fighting a live app
    // for its own files, which on Windows is how an update half-applies.
    install: async () => {
      updates.patchUpdateState({ status: 'ready' });
      setTimeout(() => autoUpdater.quitAndInstall(false, true), 250);
    },
  }, app.getVersion());

  // One check on launch, which is the moment an operator is setting up and can
  // actually act on the answer.
  autoUpdater.checkForUpdates().catch((err) => updates.patchUpdateState({
    status: 'error', error: err?.message ?? String(err),
  }));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  const logFile = teeConsoleToLogFile();
  allowCameraOnOurOriginOnly();
  installMenu();

  if (await portInUse(PORT)) {
    dialog.showErrorBox(
      'Port ' + PORT + ' is already in use',
      'Another program is already using port ' + PORT + ', so the booth cannot '
      + 'start its own server.\n\n'
      + 'That is usually a second copy of the booth, or `npm start` left running '
      + 'in a terminal. Close it and open the booth again.\n\n'
      + 'The booth stops here on purpose: if it carried on, this window would '
      + 'show the other program instead, and its QR codes would point at the '
      + 'wrong place.',
    );
    return app.exit(1);
  }

  // Starting the server is a side effect of importing it, exactly as `npm
  // start` does. Keeping it in this process means no stray node.exe survives
  // the window being closed.
  //
  // pathToFileURL, not the bare path: a Windows drive letter inside a dynamic
  // import() is parsed as a URL scheme and throws.
  await import(pathToFileURL(path.join(ROOT, 'server', 'index.mjs')).href);
  await wireUpdates();

  if (await waitForServer()) return createWindow();

  dialog.showErrorBox(
    'The booth could not start',
    `Nothing answered on port ${PORT} within ${BOOT_TIMEOUT_MS / 1000} seconds.\n\n`
    + 'The usual cause is another copy of the booth already running. '
    + 'Close it and try again.'
    + (logFile ? `\n\nDetails: ${logFile}` : ''),
  );
  app.exit(1);
});
