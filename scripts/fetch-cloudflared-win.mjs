/**
 * Fetch the Windows build of cloudflared, for packaging.
 *
 * The npm `cloudflared` package downloads a binary for whatever machine ran
 * `npm install` — on a Mac that is a Mach-O arm64 file. electron-builder then
 * copies node_modules as it finds it, so a Windows .exe built here would ship
 * a macOS binary, the tunnel would never start, and every QR code would point
 * at a LAN address no guest can reach. Download the real Windows executable
 * and let electron-builder ship that instead.
 *
 * Cached: it is ~40 MB and does not change between builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.CLOUDFLARED_VERSION || '2026.7.3';
const URL_ = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`;

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'cloudflared.exe',
);

if (fs.existsSync(OUT) && fs.statSync(OUT).size > 1_000_000) {
  console.log(`  cloudflared.exe already present (${OUT})`);
  process.exit(0);
}

console.log(`  Downloading cloudflared ${VERSION} for Windows…`);
const res = await fetch(URL_);
if (!res.ok) {
  console.error(`  Could not download cloudflared: HTTP ${res.status} ${URL_}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(await res.arrayBuffer()));
console.log(`  Saved ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(0)} MB)`);
