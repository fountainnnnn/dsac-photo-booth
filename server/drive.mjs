/**
 * Archiving swept photos to the operator's own Google Drive.
 *
 * A port of what the hosted booth did, now that the booth runs on a laptop.
 * The shape is deliberately unchanged: mint an access token once per sweep,
 * upload each photo, and let the caller delete only what Drive confirmed.
 *
 * An OAuth refresh token rather than a service account, because a service
 * account owns the files it creates and has no Drive storage of its own —
 * every upload into a personal Drive fails with "storage quota exceeded".
 * Uploading as the operator sidesteps that: the files are theirs, on their
 * quota, in a folder they already own.
 *
 * All four settings absent means no archive, and the sweep simply deletes.
 */

/** The four values, read live so the Environment tab applies without a restart. */
function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
    folder: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
  };
}

/** Whether an archive is set up at all. Nothing here runs unless it is. */
export function driveConfigured() {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.refreshToken && c.folder);
}

/**
 * A Drive access token, minted from the operator's refresh token.
 *
 * Access tokens last an hour and the sweep runs hourly, so caching one would
 * be a coin flip on whether it is still good. Minting per sweep costs one
 * request against a job that is already uploading megabytes.
 */
export async function driveAccessToken() {
  const { clientId, clientSecret, refreshToken } = config();
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      // A revoked or rotated token lands here. Say so loudly: from this point
      // the sweep holds every photo rather than delete one it cannot save.
      console.error(`  Drive token refresh failed (${res.status}). Photos will be kept, not swept.`);
      return null;
    }
    const out = await res.json();
    return out?.access_token ?? null;
  } catch (err) {
    console.error(`  Drive token refresh threw: ${err.message}`);
    return null;
  }
}

/**
 * Put one photo in the operator's Drive, and say whether it is safely there.
 *
 * Returns false only when an archive is configured and the upload did not
 * confirm. The sweep treats that as a reason to keep the photo: a Drive
 * outage should delay a deletion, never turn into one.
 */
export async function archiveToDrive({ name, mime, bytes }, accessToken) {
  const { folder } = config();
  if (!driveConfigured()) return true;  // no archive configured
  if (!accessToken) return false;       // configured but unreachable
  if (!bytes?.length) {
    // A photo whose bytes are missing is a fault to investigate, never a photo
    // we are free to destroy.
    console.error(`  Refusing to sweep ${name}: no bytes to archive.`);
    return false;
  }

  try {
    // Skip anything already there. The sweep retries whatever it could not
    // confirm, and a retry must not leave two copies of the same photo.
    const q = encodeURIComponent(`name='${name}' and '${folder}' in parents and trashed=false`);
    const found = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (found.ok) {
      const list = await found.json();
      if (list?.files?.length) return true;
    }

    // Multipart: one part of metadata, one of bytes, in a single request.
    const boundary = `dsac-boundary-${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name, parents: [folder] });
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`
      + `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([head, Buffer.from(bytes), tail]);

    // Drive rate-limits a burst — a sweep clearing a backlog will trip it, and
    // it answers 403 or 429 rather than anything more specific. Backing off
    // and retrying turns that into a slower sweep instead of a held photo.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      if (res.ok) return true;
      if (res.status !== 403 && res.status !== 429 && res.status < 500) {
        console.error(`  Drive rejected ${name} (${res.status}). Keeping the photo.`);
        return false;
      }
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    console.error(`  Drive still rate-limited after retries for ${name}. Keeping the photo.`);
    return false;
  } catch (err) {
    console.error(`  Drive upload threw for ${name}: ${err.message}`);
    return false;
  }
}

// ── Connecting ───────────────────────────────────────────────────────────────
//
// Google shows a refresh token exactly once, at the moment consent is granted,
// and never again — not in the console, not through any API. That is why one
// cannot be recovered from an old deployment, and why an operator asked to
// "just paste the token" has to go and mint one first.
//
// So the booth mints it. It sends the operator to Google, catches the redirect
// on its own port, and writes the token straight into the settings file. The
// token is never shown, copied or retyped, which removes the step most likely
// to go wrong.

/**
 * Full Drive access, not the narrower `drive.file`.
 *
 * `drive.file` only reaches files the app itself created, and the archive
 * uploads into a folder the operator made by hand — the API answers "File not
 * found" for a parent it cannot see. The hosted booth uploaded into exactly
 * such a folder, so this is the scope that matches what already worked.
 */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

/** Single-use nonces, so only a redirect this booth started is honoured. */
const pending = new Set();

export function driveRedirectUri(port) {
  return `http://localhost:${port}/api/drive/callback`;
}

/**
 * Where to send the operator to approve the booth.
 *
 * `access_type=offline` with `prompt=consent` is what asks for a refresh token
 * at all, and asks again even for an account that has approved this client
 * before — without it a second connect returns an access token only, and the
 * booth would come back from a successful-looking consent with nothing to save.
 */
export function driveAuthUrl(port) {
  const { clientId } = config();
  if (!clientId) return null;

  const state = crypto.randomUUID();
  pending.add(state);
  // A stale nonce must not accumulate if the operator abandons the consent.
  setTimeout(() => pending.delete(state), 10 * 60 * 1000).unref?.();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(port),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Whether a redirect carries a nonce this booth issued, and burn it. */
export function claimState(state) {
  if (!state || !pending.has(state)) return false;
  pending.delete(state);
  return true;
}

/**
 * Trade the one-time code for a refresh token.
 *
 * Returns the token, or an error string fit to show an operator — this runs in
 * a browser tab they are watching, so "invalid_client" alone would leave them
 * with nowhere to go.
 */
export async function exchangeCode(code, port) {
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret) return { error: 'Client ID and secret must be saved first.' };

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: driveRedirectUri(port),
        grant_type: 'authorization_code',
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: `Google refused the exchange: ${out?.error_description ?? out?.error ?? res.status}` };
    }
    if (!out?.refresh_token) {
      // Consent succeeded but Google withheld the durable half.
      return {
        error: 'Google returned no refresh token. Remove the booth at '
          + 'myaccount.google.com/permissions and connect again.',
      };
    }
    return { refreshToken: out.refresh_token };
  } catch (err) {
    return { error: `Could not reach Google: ${err.message}` };
  }
}
