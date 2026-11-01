#!/usr/bin/env node
// Open House film v2 assembler: film.json → index.html.
// Scenes play back to back (hard cuts). Every cut is hidden under a transition drawn on a layer above all scenes,
// timed on the root timeline: the cover closes over the outgoing scene, the cut happens while it is closed, and it
// opens on the incoming one. Music bed + sound effects at absolute times.
//
//   node tools/assemble.mjs              # whole film
//   node tools/assemble.mjs --only c03   # one scene (with its music span), for checks
//
// film.json: { music: {src, offset, volume, fadeIn, fadeOut}, scenes: [{ id, file, duration, sfx: [{file, at, vol, max}],
//   tx: { type, color, at:[x,y], dur } }] }  — `tx` is the transition INTO that scene (centred on its start).
// Types: iris (a 7-sided lens closing to a point and opening again), flash (white burst with rays), blob (a circle
//   of colour grows from a point and becomes the next ground), strip (a film strip whips up through the frame),
//   tiles (a grid of squares flips closed and open), stripes (diagonal bars sweep across), none (a match cut).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const cfg = JSON.parse(rd("film.json"));
const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1].split(",") : null; })();
const bin = (n) => (fs.existsSync(path.join(ROOT, ".bin", n)) ? path.join(ROOT, ".bin", n) : n);
const FF = bin("ffmpeg"), FP = bin("ffprobe");
const dur = (p) => parseFloat(execFileSync(FP, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(ROOT, p)]).toString());
const r3 = (x) => +(+x).toFixed(3);

// Absolute starts over the whole film (so --only keeps the music in sync).
const allStarts = []; let t = 0;
for (const s of cfg.scenes) { allStarts.push(r3(t)); t += s.duration; }
const fullTotal = r3(t);
const scenes = only ? cfg.scenes.filter((s) => only.includes(s.id)) : cfg.scenes;
const base = only ? allStarts[cfg.scenes.indexOf(scenes[0])] : 0;
const starts = []; t = 0;
for (const s of scenes) { starts.push(r3(t)); t += s.duration; }
const total = r3(t);

const clips = [], audio = [], layers = [], tw = [];
scenes.forEach((s, i) => {
  const st = starts[i];
  clips.push(`      <div id="el-${s.id}" class="scene" data-composition-id="${s.id}" data-composition-src="${s.file}" data-start="${st}" data-duration="${s.duration}" data-track-index="${i % 2}" data-width="1920" data-height="1080"></div>`);
  for (const [k, fx] of (s.sfx || []).entries()) {
    const f = [".mp3", ".wav"].map((e) => `assets/sfx/${fx.file}${e}`).find((p) => fs.existsSync(path.join(ROOT, p)));
    if (!f) throw new Error(`${s.id}: sound effect "${fx.file}" not found`);
    const d = Math.min(dur(f), fx.max ?? 3);
    audio.push(`      <audio id="sfx-${s.id}-${k}" src="${f}" data-start="${r3(st + fx.at)}" data-duration="${r3(d)}" data-track-index="${20 + (audio.length % 8)}" data-volume="${fx.vol ?? 0.3}"></audio>`);
  }
  const tx = s.tx;
  if (i === 0 || !tx || tx.type === "none") return;
  const id = `tx-${s.id}`, d = tx.dur ?? 0.7, c = tx.color ?? "#1b1a1f", [x, y] = tx.at ?? [960, 540];
  const a = r3(st - d / 2), mid = st; // closes over [a, st], opens over [st, st + d/2]
  const R = Math.ceil(Math.max(...[[0, 0], [1920, 0], [0, 1080], [1920, 1080]].map(([cx, cy]) => Math.hypot(cx - x, cy - y)))) + 40;
  if (tx.type === "iris") {
    // A heptagonal lens opening in an ink plate; blade edges drawn from each vertex. Closing rotates it a little.
    layers.push(`      <svg id="${id}" class="tx" viewBox="0 0 1920 1080" width="1920" height="1080" style="opacity:0"><defs><mask id="${id}-m"><rect width="1920" height="1080" fill="#fff"/><polygon id="${id}-hole" fill="#000"/></mask></defs><rect width="1920" height="1080" fill="${c}" mask="url(#${id}-m)"/><g id="${id}-blades" stroke="#fff" stroke-opacity="0.22" stroke-width="5" fill="none"></g></svg>`);
    tw.push(`(() => { const hole = document.getElementById("${id}-hole"), bl = document.getElementById("${id}-blades"), p = { k: 1 };
      for (let i = 0; i < 7; i++) bl.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "line"));
      const draw = () => { const r = ${R} * p.k, rot = (1 - p.k) * 1.1, pts = [];
        for (let i = 0; i < 7; i++) { const a = rot + i * 2 * Math.PI / 7; pts.push([${x} + r * Math.cos(a), ${y} + r * Math.sin(a)]); }
        hole.setAttribute("points", pts.map((q) => q.join(",")).join(" "));
        Array.from(bl.children).forEach((ln, i) => { const [px, py] = pts[i], a = rot + i * 2 * Math.PI / 7 + Math.PI / 2 + 0.45;
          ln.setAttribute("x1", px); ln.setAttribute("y1", py); ln.setAttribute("x2", px + 3000 * Math.cos(a)); ln.setAttribute("y2", py + 3000 * Math.sin(a)); }); };
      main.set("#${id}", { opacity: 1 }, ${a});
      main.fromTo(p, { k: 1 }, { k: 0, duration: ${r3(d / 2)}, ease: OH.E.in, onUpdate: draw, onStart: draw, immediateRender: false }, ${a});
      main.fromTo(p, { k: 0 }, { k: 1, duration: ${r3(d * 0.7)}, ease: OH.E.out, onUpdate: draw, immediateRender: false }, ${mid});
      main.set("#${id}", { opacity: 0 }, ${r3(mid + d * 0.7)}); })();`);
  } else if (tx.type === "flash") {
    // A white burst from a point: rays shoot out, the disc fills the frame, then the frame fades back in.
    const rays = Array.from({ length: 14 }, (_, k) => `<rect x="-14" y="-1500" width="28" height="1300" rx="14" fill="#fff" transform="rotate(${k * 360 / 14})"/>`).join("");
    layers.push(`      <svg id="${id}" class="tx" viewBox="0 0 1920 1080" width="1920" height="1080" style="opacity:0"><g transform="translate(${x} ${y})"><g id="${id}-rays">${rays}</g><circle id="${id}-disc" r="${R}" fill="#fff"/></g></svg>`);
    tw.push(`main.set("#${id}", { opacity: 1 }, ${a});
      main.fromTo("#${id}-rays", { scale: 0.1, rotation: -20, transformOrigin: "0px 0px" }, { scale: 1.4, rotation: 10, duration: ${r3(d / 2)}, ease: OH.E.out, immediateRender: false }, ${a});
      main.fromTo("#${id}-disc", { scale: 0, transformOrigin: "0px 0px" }, { scale: 1, duration: ${r3(d / 2)}, ease: OH.E.in, immediateRender: false }, ${a});
      main.set("#${id}-disc", { scale: 0 }, ${a});
      main.fromTo("#${id}", { opacity: 1 }, { opacity: 0, duration: ${r3(d * 0.6)}, ease: OH.E.out, immediateRender: false }, ${mid});
      main.set("#${id}", { opacity: 0 }, ${r3(mid + d * 0.6)});`);
  } else if (tx.type === "blob") {
    // A circle of the next scene's ground colour grows from a point until it is the ground; the cut happens under it.
    layers.push(`      <div id="${id}" class="tx" style="opacity:0;background:${c};clip-path:circle(0px at ${x}px ${y}px)"></div>`);
    tw.push(`main.set("#${id}", { opacity: 1 }, ${a});
      main.fromTo("#${id}", { clipPath: "circle(0px at ${x}px ${y}px)" }, { clipPath: "circle(${R}px at ${x}px ${y}px)", duration: ${r3(d / 2)}, ease: OH.E.whip, immediateRender: false }, ${a});
      main.set("#${id}", { opacity: 0 }, ${mid});`);
  } else if (tx.type === "strip") {
    // A film strip (ink with sprocket holes) whips up through the frame, covering it at the cut.
    const holes = Array.from({ length: 18 }, (_, k) => `<rect x="${40 + k * 108}" y="40" width="58" height="80" rx="12" fill="${tx.hole ?? "#fff4e3"}"/><rect x="${40 + k * 108}" y="${2400 - 120}" width="58" height="80" rx="12" fill="${tx.hole ?? "#fff4e3"}"/>`).join("");
    layers.push(`      <svg id="${id}" class="tx" viewBox="0 0 1920 2400" width="1920" height="2400" style="opacity:0;height:2400px"><rect width="1920" height="2400" fill="${c}"/>${holes}</svg>`);
    tw.push(`main.set("#${id}", { opacity: 1 }, ${a});
      main.fromTo("#${id}", { y: 1080, rotation: 4 }, { y: -660, rotation: 0, duration: ${r3(d / 2)}, ease: OH.E.in, immediateRender: false }, ${a});
      main.fromTo("#${id}", { y: -660 }, { y: -2500, rotation: -4, duration: ${r3(d / 2)}, ease: OH.E.out, immediateRender: false }, ${mid});
      main.set("#${id}", { opacity: 0 }, ${r3(mid + d / 2)});`);
  } else if (tx.type === "tiles") {
    // A 12×7 grid of squares grows closed diagonally from one corner, the cut, then shrinks away toward the other.
    const cells = []; for (let r = 0; r < 7; r++) for (let q = 0; q < 12; q++) cells.push(`<rect class="${id}-c" data-k="${q + r}" x="${q * 160}" y="${r * 160 - 20}" width="160" height="160" fill="${c}" style="transform-box:fill-box;transform-origin:50% 50%"/>`);
    layers.push(`      <svg id="${id}" class="tx" viewBox="0 0 1920 1080" width="1920" height="1080" style="opacity:0">${cells.join("")}</svg>`);
    tw.push(`main.set("#${id}", { opacity: 1 }, ${a});
      document.querySelectorAll(".${id}-c").forEach((el) => { const k = +el.dataset.k / 17;
        main.fromTo(el, { scale: 0, rotation: 45 }, { scale: 1.02, rotation: 0, duration: ${r3(d * 0.25)}, ease: OH.E.out, immediateRender: true }, ${a} + k * ${r3(d * 0.25)});
        main.fromTo(el, { scale: 1.02, rotation: 0 }, { scale: 0, rotation: -45, duration: ${r3(d * 0.25)}, ease: OH.E.in, immediateRender: false }, ${mid} + k * ${r3(d * 0.25)}); });
      main.set("#${id}", { opacity: 0 }, ${r3(mid + d / 2 + 0.02)});`);
  } else if (tx.type === "stripes") {
    // Five diagonal bars in the film's colours sweep across with a stagger, covering the cut.
    const cols = tx.colors ?? ["#ff4b3e", "#ffd23f", "#2fc59a", "#59b6ff", "#7a5cff"];
    const bars = cols.map((col, k) => `<div class="${id}-b" style="position:absolute;left:-400px;top:${-300 + k * 0}px;width:2800px;height:1700px;background:${col};transform:translateX(-3000px) skewX(-18deg)"></div>`).join("");
    layers.push(`      <div id="${id}" class="tx" style="opacity:0;overflow:hidden">${bars}</div>`);
    tw.push(`main.set("#${id}", { opacity: 1 }, ${a});
      document.querySelectorAll(".${id}-b").forEach((el, k) => {
        main.fromTo(el, { x: -3000 }, { x: 0, duration: ${r3(d / 2)}, ease: OH.E.in, immediateRender: false }, ${a} + k * 0.035 - 0.14);
        main.fromTo(el, { x: 0 }, { x: 3000, duration: ${r3(d / 2)}, ease: OH.E.out, immediateRender: false }, ${mid} + (4 - k) * 0.035); });
      main.set("#${id}", { opacity: 0 }, ${r3(mid + d / 2 + 0.2)});`);
  } else throw new Error(`${s.id}: unknown transition ${tx.type}`);
});

// Music: the span of the bed under this film (or under the --only part), faded at the film's ends only.
const m = cfg.music, cut = "assets/bgm/bed-cut.wav";
const fadeOutAt = r3(fullTotal - (m.fadeOut ?? 1.5) - base);
const af = [`afade=t=in:st=${base > 0 ? 0 : 0}:d=${base > 0 ? 0.05 : m.fadeIn ?? 0.3}`];
if (fadeOutAt < total) af.push(`afade=t=out:st=${Math.max(0, fadeOutAt)}:d=${m.fadeOut ?? 1.5}`);
execFileSync(FF, ["-y", "-v", "error", "-ss", String((m.offset ?? 0) + base), "-i", path.join(ROOT, m.src), "-t", String(total), "-af", af.join(","), path.join(ROOT, cut)]);

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" integrity="sha384-sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2" crossorigin="anonymous"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: #fff4e3; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #fff4e3; }
      .scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
      .tx { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; z-index: 100; pointer-events: none; }
${rd("assets/style/oh.css")}
    </style>
    <script>
${rd("assets/style/oh.js")}
    </script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${clips.join("\n")}
${layers.join("\n")}
      <audio id="el-bgm" src="${cut}" data-start="0" data-duration="${total}" data-track-index="10" data-volume="${m.volume ?? 0.8}"></audio>
${audio.join("\n")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const main = gsap.timeline({ paused: true });
      ${tw.join("\n      ")}
      main.set({}, {}, ${total});
      window.__timelines["main"] = main;
    </script>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log(`✓ index.html: ${scenes.length} scene(s), ${total}s${only ? ` (from ${base}s of ${fullTotal}s)` : ""}, ${layers.length} transitions, ${audio.length} sfx`);
console.log("  starts: " + scenes.map((s, i) => `${s.id}@${r3(starts[i] + base)}`).join(" "));
