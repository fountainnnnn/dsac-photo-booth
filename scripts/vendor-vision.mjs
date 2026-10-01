/**
 * Copy MediaPipe's wasm runtime into public/vision, for the build.
 *
 * Background segmentation and face tracking load it from there by URL. It is
 * about twelve megabytes, mostly one wasm file, from the pinned
 * @mediapipe/tasks-vision devDependency. Copied at build time rather than
 * committed, as with cloudflared: a binary that is reproducible from
 * package-lock.json does not need to live in the repository's history.
 *
 * The models are not in the npm package, so they are committed beside it.
 * onnxruntime-web, for the edge clean-up pass, needs no copying: Vite finds
 * its wasm through the bundle's own `new URL(..., import.meta.url)` and emits
 * it as an asset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUNTIMES = [
  {
    pkg: '@mediapipe/tasks-vision',
    to: 'vision',
    files: [
      'wasm/vision_wasm_internal.js',
      'wasm/vision_wasm_internal.wasm',
    ],
  },
];

let copied = 0;
for (const { pkg, to, files } of RUNTIMES) {
  const from = path.join(ROOT, 'node_modules', ...pkg.split('/'));
  if (!fs.existsSync(from)) {
    console.error(`vendor-vision: ${pkg} is not installed. Run \`npm install\`.`);
    process.exit(1);
  }
  for (const file of files) {
    const dest = path.join(ROOT, 'public', to, file.replace(/^dist\//, ''));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(from, file), dest);
    copied += 1;
  }
}
console.log(`vendor-vision: copied ${copied} runtime files into public/`);
