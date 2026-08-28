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
