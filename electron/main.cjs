const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
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
 * cloudflared is a real executable, so it is unpacked out of the asar archive.
 * The npm package resolves its own binary relative to its module directory,
 * which is the copy still *inside* the archive — a path Windows cannot start a
 * process from. Point the tunnel at the unpacked file instead.
 */
if (app.isPackaged) {
  process.env.CLOUDFLARED_BIN ??= path.join(
    process.resourcesPath, 'app.asar.unpacked',
    'node_modules', 'cloudflared', 'bin',
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

  // Starting the server is a side effect of importing it, exactly as `npm
  // start` does. Keeping it in this process means no stray node.exe survives
  // the window being closed.
  //
  // pathToFileURL, not the bare path: a Windows drive letter inside a dynamic
  // import() is parsed as a URL scheme and throws.
  await import(pathToFileURL(path.join(ROOT, 'server', 'index.mjs')).href);

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
