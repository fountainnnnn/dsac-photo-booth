#!/usr/bin/env node
// Assemble index.html from scenes.json: the scenes in order, the shared kit (fonts + kit.css + kit.js) inlined in
// <head>, the music bed trimmed and faded to the film's length, sound effects at absolute times, and the
// transitions between scenes.
//
//   node tools/build.mjs                 # the whole film
//   node tools/build.mjs --only s07,s08  # a partial film for a quick check
//
// Transitions. A scene may say how it arrives:
//   "in": { "type": "zoom-in" | "zoom-out" | "fade", "dur": 0.5 }       the default language (the X-film zooms)
//   "in": { "type": "iris", "dur": 0.65, "at": [1623, 565] }           open through a real dot (a full stop)
// It then starts `dur` before the previous scene ends (the two overlap), on the other track.
//   zoom-in:  the outgoing scene accelerates toward the camera and fades out quickly (gone by 45% of the join); the
//             incoming one takes over at that instant from a little smaller and decelerates into place — one
//             continuous push forward, never both on screen at once. zoom-out is the reverse (the old scene
//             recedes, the new one settles in from a little closer). "fade" is the same with a barely-there move.
//   iris:     the incoming scene opens through a circle that grows from `at` (start it on a real dot).
// No "in" is a straight cut (for a match cut, where the last frame of one scene equals the first of the next).
// No wipes and no whole-page slides: both were rejected in review.
// "drift" (scenes.json top level, default 0.02): every scene leans in by that much across its time, so the camera
// never sits dead still. Scenes carry no transition code of their own.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const cfg = JSON.parse(rd("scenes.json"));
const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1].split(",") : null; })();
if (only) cfg.scenes = cfg.scenes.filter((s) => only.includes(s.id));
// Local static binaries (tools/../.bin, linked by scaffold.mjs --link) or whatever is on PATH.
const bin = (n) => (fs.existsSync(path.join(ROOT, ".bin", n)) ? path.join(ROOT, ".bin", n) : n);
const FF = bin("ffmpeg"), FP = bin("ffprobe");
const dur = (p) => parseFloat(execFileSync(FP, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(ROOT, p)]).toString());

// Starts: each scene begins when the previous one ends, minus its transition's overlap.
const starts = [];
let t = 0;
cfg.scenes.forEach((s, i) => { if (i > 0) t -= s.in?.dur ?? 0; starts.push(+t.toFixed(3)); t += s.duration; });
const total = +t.toFixed(3);

const clips = [], audio = [], moves = [];
// Dark-stage scenes (class "on-stage" on the scene root). A join between two of them fades over the stage colour
// (#stage-ground under the scenes), never the white page, so it cannot flash white.
const dark = [];
cfg.scenes.forEach((s, i) => {
  const src = rd(s.file);
  // The root element's id (a tag attribute — not a [data-composition-id="…"] selector in the scene's CSS).
  const id = (src.match(/<[^>]*\sdata-composition-id="([^"]+)"/) || [])[1];
  if (id !== s.id) throw new Error(`${s.file}: root data-composition-id "${id}" must equal "${s.id}"`);
  dark.push(/\bon-stage\b/.test((src.match(/<[^>]*\sdata-composition-id="[^"]+"[^>]*>/) || [""])[0]));
  const st = starts[i];
  clips.push(`      <div id="el-${s.id}" class="scene" data-composition-id="${s.id}" data-composition-src="${s.file}" data-start="${st.toFixed(3)}" data-duration="${s.duration}" data-track-index="${i % 2}" data-width="1920" data-height="1080"></div>`);
  for (const [k, fx] of (s.sfx || []).entries()) {
    const f = [".mp3", ".wav"].map((e) => `assets/sfx/${fx.file}${e}`).find((p) => fs.existsSync(path.join(ROOT, p)));
    if (!f) throw new Error(`${s.id}: sound effect "${fx.file}" not found in assets/sfx (.mp3 or .wav)`);
    const d = Math.min(dur(f), fx.max ?? 3);
    audio.push(`      <audio id="sfx-${s.id}-${k}" src="${f}" data-start="${(st + fx.at).toFixed(3)}" data-duration="${d.toFixed(3)}" data-track-index="${20 + (audio.length % 6)}" data-volume="${fx.vol ?? 0.35}"></audio>`);
  }
  const drift = s.drift ?? cfg.drift ?? 0.02;
  if (drift) moves.push(`main.fromTo("#${s.id}-root", { scale: 1 }, { scale: ${1 + drift}, duration: ${s.duration}, ease: "none", immediateRender: false }, ${st});`);
  const tr = s.in;
  if (i > 0) moves.push(`main.set("#stage-ground", { opacity: ${dark[i - 1] && dark[i] ? 1 : 0} }, ${st});`);
  if (i > 0 && tr && tr.type && (tr.dur ?? 0) > 0) {
    const a = `#el-${cfg.scenes[i - 1].id}`, b = `#el-${s.id}`, d = tr.dur;
    const zoom = { "zoom-in": [1.08, 0.92], "zoom-out": [0.93, 1.08], "fade": [1.02, 0.985] }[tr.type];
    if (zoom) {
      const [outS, inS] = zoom, r = (x) => +x.toFixed(3);
      // One after the other, never both at once: the outgoing scene accelerates on its move and is gone by 45% of the
      // join; the incoming one takes over at that instant at full speed and decelerates into place. Speed peaks at the
      // hand-off, so it reads as one smooth camera move rather than two layers dissolving.
      const h = r(st + d * 0.45);
      moves.push(`main.fromTo("${a}", { scale: 1 }, { scale: ${outS}, duration: ${r(d * 0.6)}, ease: RK.E.in, immediateRender: false }, ${st});`);
      moves.push(`main.fromTo("${a}", { opacity: 1 }, { opacity: 0, duration: ${r(d * 0.45)}, ease: RK.E.in, immediateRender: false }, ${st});`);
      // Hidden from the first frame of the overlap: a scene is opaque (white) by default and would cover the outgoing one.
      moves.push(`main.set("${b}", { opacity: 0, scale: ${inS} }, ${st});`);
      moves.push(`main.fromTo("${b}", { scale: ${inS} }, { scale: 1, duration: ${r(d * 1.4)}, ease: RK.E.out, immediateRender: false }, ${h});`);
      moves.push(`main.fromTo("${b}", { opacity: 0 }, { opacity: 1, duration: ${r(d * 0.6)}, ease: RK.E.out, immediateRender: false }, ${h});`);
    } else if (tr.type === "iris") {
      const [x, y] = tr.at ?? [960, 540], r0 = tr.r0 ?? 6;
      const R = Math.ceil(Math.max(...[[0, 0], [1920, 0], [0, 1080], [1920, 1080]].map(([cx, cy]) => Math.hypot(cx - x, cy - y)))) + 4;
      moves.push(`main.fromTo("${b}", { clipPath: "circle(${r0}px at ${x}px ${y}px)" }, { clipPath: "circle(${R}px at ${x}px ${y}px)", duration: ${d}, ease: RK.E.in, immediateRender: false }, ${st});`);
      moves.push(`main.set("${b}", { clipPath: "none" }, ${+(st + d).toFixed(3)});`);
    } else throw new Error(`${s.id}: unknown transition "${tr.type}"`);
  }
});

// Music: trim + fade the bed to the film length.
const m = cfg.music;
const cut = "assets/bgm/bed-cut.wav";
execFileSync(FF, ["-y", "-v", "error", "-ss", String(m.offset ?? 0), "-i", path.join(ROOT, m.src), "-t", String(total),
  "-af", `afade=t=in:st=0:d=${m.fadeIn ?? 0.4},afade=t=out:st=${(total - (m.fadeOut ?? 2.5)).toFixed(2)}:d=${m.fadeOut ?? 2.5}`, path.join(ROOT, cut)]);

const fonts = fs.existsSync(path.join(ROOT, "assets/kit/fonts.css")) ? rd("assets/kit/fonts.css") : "";
const head = [fonts, rd("assets/kit/kit.css")].join("\n");
const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" integrity="sha384-sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2" crossorigin="anonymous"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: #fff; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #fff; }
      .scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
${head}
    </style>
    <script>
${rd("assets/kit/kit.js")}
    </script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
      <div id="stage-ground" style="position: absolute; inset: 0; background: var(--stage, #17171a); opacity: 0"></div>
${clips.join("\n")}
      <audio id="el-bgm" src="${cut}" data-start="0" data-duration="${total}" data-track-index="10" data-volume="${m.volume ?? 0.6}"></audio>
${audio.join("\n")}
    </div>
    <script>
      const main = gsap.timeline({ paused: true });
      ${moves.join("\n      ")}
      window.__timelines["main"] = main;
    </script>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log(`✓ index.html: ${cfg.scenes.length} scenes, ${total}s, ${moves.length ? moves.length + " transition tweens, " : ""}${audio.length} sfx, music ${cut}`);
console.log("  starts: " + cfg.scenes.map((s, i) => `${s.id}@${starts[i]}`).join(" "));
