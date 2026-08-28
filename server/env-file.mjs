import fs from 'node:fs';
import path from 'node:path';

/**
 * The booth's settings that are not settings: ports, paths, passwords.
 *
 * These used to live only in a `.env` beside the source, or in a Cloudflare
 * secret. Neither survives the way the booth is actually run now — a packaged
 * .exe on a laptop, with no repository to edit and no deployment to hold
 * secrets. The file was simply unreachable: the archive does not contain one,
 * and nothing in the interface could write one.
 *
 * So the app keeps its own `.env` in the writable data folder and the Settings
 * page edits it. It is a real dotenv file in a real location, not a hidden
 * store: an operator can open it in Notepad, and a support call can ask them
 * to read it out.
 *
 * Values here win over one loaded from the source tree, because this is the
 * file the person standing at the booth can actually change.
 */

/** Parse dotenv text. Blank lines and `#` comments are skipped. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsAt = trimmed.indexOf('=');
    if (equalsAt <= 0) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }
  return out;
}

/** Read a dotenv file. A missing or unreadable one is an empty set, never a throw. */
export function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write the file, quoting anything whose value would not survive re-reading.
 *
 * A password with a leading space or a trailing `#` is the case that matters:
 * unquoted it parses back as something else, and the operator is locked out of
 * their own booth by a character they could not see.
 */
export function writeEnvFile(file, values) {
  const lines = [
    '# DSAC Photo Booth settings.',
    '#',
    '# Written by the Settings page. You can edit it by hand as well — the app',
    '# reads it at startup — but anything saved from Settings overwrites it.',
    '',
  ];

  for (const [key, value] of Object.entries(values)) {
    const raw = String(value ?? '');
    if (!raw) continue;
    const needsQuotes = raw !== raw.trim() || /["'#\s]/.test(raw);
    lines.push(`${key}=${needsQuotes ? JSON.stringify(raw) : raw}`);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

/**
 * The variables Settings offers, in the order they are shown.
 *
 * `restart` marks the ones read once while the server is starting. Saying so
 * in the interface is the whole point: a port typed into a box that silently
 * does nothing until the next launch is worse than no box at all.
 *
 * `secret` hides the value behind a reveal, exactly as the passwords card
 * already does — a booth screen is in public view at an event.
 */
export const ENV_FIELDS = [
  {
    key: 'BOOTH_PASSWORD',
    label: 'Booth password',
    help: 'Locks capture, gallery, settings and the phone remote. Empty leaves the booth open.',
    secret: true,
    restart: false,
  },
  {
    key: 'DOWNLOAD_PASSWORD',
    label: 'Photo password',
    help: 'Guests type this after scanning the QR, before their photo is shown. Empty means no gate.',
    secret: true,
    restart: false,
  },
  {
    key: 'PUBLIC_URL',
    label: 'Public URL',
    help: 'A fixed address to bake into QR codes instead of the Cloudflare tunnel. Leave empty to use the tunnel.',
    placeholder: 'https://booth.example.com',
    restart: false,
  },
  {
    key: 'PHOTO_TTL_DAYS',
    label: 'Default link validity (days)',
    help: 'Only used until Settings saves a link validity of its own; that one then wins.',
    placeholder: '7',
    restart: true,
  },
  {
    key: 'PORT',
    label: 'Server port',
    help: 'The port the booth serves on. Change it only if something else on the laptop already holds 3001.',
    placeholder: '3001',
    restart: true,
  },
  {
    key: 'STORAGE_DIR',
    label: 'Storage folder',
    help: 'Where the database and the photo archive live. This file itself stays where it is.',
    restart: true,
  },
  {
    key: 'CLOUDFLARED_PROTOCOL',
    label: 'Tunnel protocol',
    help: 'http2 gets through school and corporate networks that block QUIC. Change only if the tunnel will not start.',
    placeholder: 'http2',
    restart: true,
  },
];

const EDITABLE = new Set(ENV_FIELDS.map(f => f.key));

/** Drop anything not on the list: a save must not become a way to set PATH. */
export function pickEditable(values) {
  const out = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (EDITABLE.has(key)) out[key] = String(value ?? '').trim();
  }
  return out;
}

/**
 * Push saved values into `process.env`, so the parts of the booth that read it
 * live — the public origin, the passwords once reloaded — follow immediately.
 * An emptied value is deleted rather than set to '', because the code that
 * reads these treats empty and absent alike but only tests for absence.
 */
export function applyToProcessEnv(values) {
  for (const field of ENV_FIELDS) {
    const value = values[field.key];
    if (value) process.env[field.key] = value;
    else delete process.env[field.key];
  }
}
