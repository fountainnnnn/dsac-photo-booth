#!/usr/bin/env node
// Look at a rendered film the way a reviewer would, without playing it.
//
//   node tools/film-check.mjs renders/video.mp4
//
// Writes:
//   .film/sheet-NN.jpg   contact sheets, 4 frames a second, 24 frames (6s) per sheet
//   .film/cuts.jpg       every join from scenes.json: the frames around a cut, or a transition's start, middle and end
// Read the sheets yourself before delivering: grey flashes at cuts, a blank first frame, text that is still
// half-built when a scene cuts, off-centre compositions and anything that overlaps show up here.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const ROOT = process.cwd();
const video = process.argv[2];
if (!video || !fs.existsSync(video)) { console.error("usage: node tools/film-check.mjs <rendered.mp4>"); process.exit(2); }
const bin = (n) => (fs.existsSync(path.join(ROOT, ".bin", n)) ? path.join(ROOT, ".bin", n) : n);
const FF = bin("ffmpeg");
const CHROME = process.env.CHROME_PATH || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));

const FILM = path.join(ROOT, ".film");
fs.rmSync(FILM, { recursive: true, force: true });
fs.mkdirSync(path.join(FILM, "frames"), { recursive: true });
fs.mkdirSync(path.join(FILM, "cuts"), { recursive: true });

execFileSync(FF, ["-v", "error", "-i", video, "-vf", "fps=4,scale=480:-1", "-q:v", "4", path.join(FILM, "frames/f%04d.jpg")]);

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scenes.json"), "utf8"));
// Every join: a straight cut (frames either side) or a transition (its start, middle and end).
let t = 0;
cfg.scenes.forEach((s, i) => {
  if (i > 0) t -= s.in?.dur ?? 0;
  if (i > 0) {
    const d = s.in?.dur ?? 0;
    const at = d > 0 ? [["a", t - 0.02], ["b", t + d / 2], ["c", t + d + 0.02]] : [["a", t - 1 / 60], ["b", t + 1 / 60]];
    for (const [lab, x] of at) execFileSync(FF, ["-v", "error", "-y", "-ss", x.toFixed(4), "-i", video, "-frames:v", "1", "-vf", "scale=480:-1", path.join(FILM, "cuts", `${t.toFixed(1).padStart(5, "0")}-${s.id}-${lab}.jpg`)]);
  }
  t += s.duration;
});

const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--allow-file-access-from-files"] });
const shoot = async (cells, out, cols = 6) => {
  const html = `<html><body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},480px);gap:4px;width:${cols * 484 - 4}px">${cells.map(([src, lab]) => `<div style="position:relative"><img src="file://${src}" style="width:480px;display:block"><span style="position:absolute;left:4px;top:3px;font:bold 17px sans-serif;color:#f0f;background:rgba(0,0,0,.6);padding:0 5px">${lab}</span></div>`).join("")}</body></html>`;
  const f = path.join(FILM, "_s.html"); fs.writeFileSync(f, html);   // a file:// page may load file:// images
  const p = await b.newPage(); await p.setViewport({ width: cols * 484 - 4, height: 400 });
  await p.goto("file://" + f, { waitUntil: "networkidle0" });
  await p.screenshot({ path: out, type: "jpeg", quality: 80, fullPage: true }); await p.close();
};
const frames = fs.readdirSync(path.join(FILM, "frames")).filter((f) => f.endsWith(".jpg")).sort();
for (let i = 0; i * 24 < frames.length; i++) {
  const chunk = frames.slice(i * 24, i * 24 + 24).map((f, k) => [path.join(FILM, "frames", f), ((i * 24 + k) / 4).toFixed(2) + "s"]);
  await shoot(chunk, path.join(FILM, `sheet-${String(i + 1).padStart(2, "0")}.jpg`));
}
const cuts = fs.readdirSync(path.join(FILM, "cuts")).filter((f) => f.endsWith(".jpg")).sort();
if (cuts.length) await shoot(cuts.map((f) => [path.join(FILM, "cuts", f), f.replace(".jpg", "")]), path.join(FILM, "cuts.jpg"), 6);
await b.close();
console.log(`✓ ${Math.ceil(frames.length / 24)} sheets in .film/sheet-NN.jpg, cut pairs in .film/cuts.jpg`);
