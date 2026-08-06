/**
 * Google Apps Script — the booth's archive drop-box.
 *
 * Deploy this as a Web App and the booth posts each photo here just before it
 * sweeps it out of the gallery, so an event survives in Drive after the
 * booth's own copy is gone.
 *
 * WHY APPS SCRIPT, AND NOT A SERVICE ACCOUNT OR n8n
 *
 * The obvious route — a Google service account calling the Drive API — does
 * not work against a personal Gmail account. Files a service account creates
 * are owned by the service account, and a service account has no Drive storage
 * of its own, so every upload fails with "storage quota exceeded". That is a
 * property of Google's model, not of any particular tool: n8n's Drive node
 * hits the same wall. This script runs as YOU, writes into YOUR Drive against
 * YOUR quota, and needs no OAuth dance and nothing hosted.
 *
 * SETUP
 *
 *  1. Make (or pick) a Drive folder for the photos. Open it and copy the id
 *     out of the URL: drive.google.com/drive/folders/<THIS PART>
 *  2. script.google.com -> New project. Paste this file in, replacing what is
 *     there. Set FOLDER_ID and SHARED_SECRET below.
 *  3. Deploy -> New deployment -> type "Web app".
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     "Anyone" sounds alarming and is why SHARED_SECRET exists: the URL is
 *     unguessable and every request must carry the secret, so the door is
 *     locked even though the building is public. Google offers no other way to
 *     let a server call a script.
 *  4. Authorise it when asked (it will warn the app is unverified — it is
 *     yours, that is expected).
 *  5. Copy the deployment URL. Give it, and the secret, to the booth:
 *       npx wrangler secret put DRIVE_WEBHOOK_URL
 *       npx wrangler secret put DRIVE_WEBHOOK_SECRET
 *
 * Re-deploying after an edit: use Deploy -> Manage deployments -> edit the
 * existing one, or the URL changes and the booth stops being able to reach it.
 */

/** The Drive folder photos land in. */
const FOLDER_ID = 'PUT_YOUR_FOLDER_ID_HERE';

/** Anything but this is refused. Make it long and random. */
const SHARED_SECRET = 'PUT_A_LONG_RANDOM_STRING_HERE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (!body.secret || body.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'Bad secret' });
    }
    if (!body.dataBase64 || !body.name) {
      return json({ ok: false, error: 'Missing name or dataBase64' });
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);

    // Idempotent on purpose. The booth retries when it cannot confirm an
    // upload, and a retry must not leave two copies of the same photo.
    const existing = folder.getFilesByName(body.name);
    if (existing.hasNext()) {
      return json({ ok: true, id: existing.next().getId(), duplicate: true });
    }

    const blob = Utilities.newBlob(
      Utilities.base64Decode(body.dataBase64),
      body.mimeType || 'image/jpeg',
      body.name,
    );
    const file = folder.createFile(blob);

    return json({ ok: true, id: file.getId() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** A GET is a health check, so the booth can verify the URL before relying on it. */
function doGet() {
  return json({ ok: true, service: 'dsac-photo-booth drive archive' });
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
