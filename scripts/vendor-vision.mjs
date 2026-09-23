/**
 * Copy MediaPipe's face-detection runtime into public/vision, for the build.
 *
 * The runtime is about twelve megabytes, mostly one wasm file, and it comes
 * from the pinned @mediapipe/tasks-vision devDependency. Copied at build time
 * rather than committed, as with cloudflared: a binary that is reproducible
 * from package-lock.json does not need to live in the repository's history.
 *
 * Only the runtime is copied. The face model (blaze_face_short_range.tflite)
 * is not in the npm package, so it is committed beside tiledFaces.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
const TO = path.join(ROOT, 'public', 'vision');

const FILES = [
  ['vision_bundle.mjs', 'vision_bundle.mjs'],
  ['wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.js'],
  ['wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.wasm'],
];

if (!fs.existsSync(FROM)) {
  console.error('vendor-vision: @mediapipe/tasks-vision is not installed. Run `npm install`.');
  process.exit(1);
}

for (const [src, dest] of FILES) {
  const to = path.join(TO, dest);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(FROM, src), to);
}
console.log(`vendor-vision: copied ${FILES.length} files into public/vision`);
