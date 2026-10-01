import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Backgrounds made from what a guest types, through OpenRouter.
 *
 * Only the background is generated. The guests themselves are cut out of the
 * camera on the laptop and drawn on top, so an image model never redraws a
 * face. The guest's text never reaches the model as it was typed either: it is
 * trimmed, checked against a short list of words, and wrapped in a prompt this
 * file owns (see `buildPrompt`).
 *
 * OpenRouter's images endpoint, with Gemini 3.1 Flash Image by default: about
 * US$0.10 a background at 2K, the size the doodle frame's window needs. A
 * failed or refused generation is not billed. Each picture is kept on disk by
 * its prompt, so a second guest asking for "a beach" costs nothing.
 *
 * Without an API key nothing here runs and the capture screen does not offer
 * typing at all.
 */

export const DEFAULT_MODEL = 'google/gemini-3.1-flash-image';
const ENDPOINT = 'https://openrouter.ai/api/v1/images';
const RESOLUTION = '2K';
const ASPECT_RATIO = '16:9';
/** Long enough for a slow generation, short enough that a guest is not stranded. */
const TIMEOUT_MS = 90_000;
/** What a guest may type. A place, not an essay. */
export const MAX_TEXT = 120;

/**
 * A guard against a runaway, not a per-guest limit (the capture screen keeps
 * that). An event booth does not make more than this in an hour by hand.
 */
const MAX_PER_HOUR = 120;

/**
 * Words that end the request before anything is sent. Deliberately short:
 * the model has safety filters of its own, and a long list mostly blocks the
 * innocent ("a shooting star"). Matched as whole words.
 */
const BLOCKED = [
  'nude', 'naked', 'nsfw', 'sex', 'sexy', 'porn', 'gore', 'bloody',
  'corpse', 'kill', 'murder', 'gun', 'guns', 'weapon', 'bomb', 'drugs',
  'cocaine', 'nazi', 'swastika', 'suicide',
];

export class BackgroundError extends Error {
  /**
   * @param {'not-configured'|'empty'|'blocked'|'busy'|'refused'|'failed'} code
   * @param {string} message what the capture screen can show a guest
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Collapse whitespace and cap the length. */
export function cleanText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** The blocked word found in the text, or null. */
export function blockedWord(text) {
  const words = cleanText(text).toLowerCase().split(/[^a-z]+/);
  return BLOCKED.find(w => words.includes(w)) ?? null;
}

/**
 * The prompt the model actually gets. The guest's words describe the place;
 * everything else — no people, no text, room in the middle for the guests to
 * stand in — is ours, so typing cannot talk the model out of it.
 */
export function buildPrompt(text) {
  return [
    'A background for a photo booth, seen at eye level as if standing in the place itself:',
    `"${cleanText(text).replace(/"/g, "'")}".`,
    'No people and no animals in the foreground, no text, no logos, no watermarks.',
    'Leave the lower middle of the picture open, so people can stand in front of it.',
    'Photorealistic unless the description asks for a style. Soft, even light.',
  ].join(' ');
}

/** The request body for OpenRouter's images endpoint. */
export function requestBody(text, model = DEFAULT_MODEL) {
  return {
    model,
    prompt: buildPrompt(text),
    n: 1,
    resolution: RESOLUTION,
    aspect_ratio: ASPECT_RATIO,
  };
}

/** The image in OpenRouter's answer, or null when it sent none back. */
export function imageFrom(json) {
  const item = json?.data?.[0];
  if (!item?.b64_json) return null;
  return {
    mime: typeof item.media_type === 'string' ? item.media_type : 'image/png',
    bytes: Buffer.from(item.b64_json, 'base64'),
  };
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

/**
 * The generator, bound to a folder for its cache. `fetchImpl` is for tests.
 */
export function createBackgrounds(dir, { fetchImpl = fetch } = {}) {
  const recent = [];

  function key(text, model) {
    const norm = cleanText(text).toLowerCase();
    return crypto.createHash('sha256').update(`${model}|${RESOLUTION}|${ASPECT_RATIO}|${norm}`).digest('hex').slice(0, 24);
  }

  function cached(id) {
    for (const [ext, mime] of Object.entries(MIME)) {
      const file = path.join(dir, `${id}.${ext}`);
      if (fs.existsSync(file)) return { mime, bytes: fs.readFileSync(file) };
    }
    return null;
  }

  /**
   * A background for `text`. Throws BackgroundError with a code the route
   * turns into a status, and a message the guest can be shown.
   */
  async function generate(text, { apiKey, model = DEFAULT_MODEL }) {
    if (!apiKey) {
      throw new BackgroundError('not-configured', 'Typed backgrounds are not set up on this booth.');
    }
    const clean = cleanText(text);
    if (!clean) throw new BackgroundError('empty', 'Type a place first.');
    if (blockedWord(clean)) {
      throw new BackgroundError('blocked', 'Let’s pick somewhere else — try another place.');
    }

    const id = key(clean, model);
    const hit = cached(id);
    if (hit) return { ...hit, cached: true };

    const hourAgo = Date.now() - 60 * 60 * 1000;
    while (recent.length && recent[0] < hourAgo) recent.shift();
    if (recent.length >= MAX_PER_HOUR) {
      throw new BackgroundError('busy', 'The booth has made a lot of backgrounds this hour. Pick one of ours for now.');
    }
    recent.push(Date.now());

    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Open House Photo Booth',
        },
        body: JSON.stringify(requestBody(clean, model)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`  Background generation could not reach OpenRouter: ${err.message}`);
      throw new BackgroundError('failed', 'Could not reach the image service. Pick one of ours for now.');
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = json?.error?.message ?? `HTTP ${res.status}`;
      // What the operator should do about it, for the two failures that are
      // theirs to fix. OpenRouter words a wrong key as a missing header.
      const hint = res.status === 401 ? ' — check OPENROUTER_API_KEY on the Environment tab'
        : res.status === 402 ? ' — the OpenRouter account is out of credit'
        : '';
      console.error(`  Background generation failed (${res.status}): ${detail}${hint}`);
      // A refusal on content is the guest's to fix; anything else is ours.
      if (res.status === 400 || res.status === 403) {
        throw new BackgroundError('refused', 'The image service would not make that one. Try another place.');
      }
      throw new BackgroundError('failed', 'The image service is not answering. Pick one of ours for now.');
    }

    const image = imageFrom(json);
    if (!image) {
      throw new BackgroundError('refused', 'The image service would not make that one. Try another place.');
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.${EXT[image.mime] ?? 'png'}`), image.bytes);
    } catch (err) {
      // The guest still gets their background; only the reuse is lost.
      console.error(`  Could not keep generated background: ${err.message}`);
    }
    return { ...image, cached: false };
  }

  return { generate };
}
