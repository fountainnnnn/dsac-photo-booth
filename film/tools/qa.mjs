#!/usr/bin/env node
// Layout + motion QA for one or more scenes, run in real Chrome at 1920x1080.
//
//   node tools/qa.mjs s07                 # QA report (exit 1 on errors)
//   node tools/qa.mjs s07 --shots 0.5     # + PNG every 0.5s and .qa/s07/sheet.jpg contact sheet
//   node tools/qa.mjs s07 --at 1.2,3.4    # + PNGs at exact times
//   node tools/qa.mjs all                 # every scene in scenes.json
//
// The scene is mounted the way HyperFrames mounts it (template contents inside a 1920x1080 host,
// kit CSS/JS + fonts + GSAP in the page head), its timeline is seeked every 0.1s WITH callbacks,
// clip windows (data-start/data-duration) are honoured, and each sample is measured.
//
// Errors (must be zero):
//   overlap-text   two visible text blocks intersect
//   overlap-box    two visible surfaces (cards, bubbles, tiles, chips, buttons…) intersect
//   text-on-box    text intersects a surface it does not live inside
//   clipped        visible text is cut by the frame edge
//   tiny           visible text renders under 26px
//   off-centre     settled content is off the vertical centre line (scenes with data-qa-center; data-qa-center-from
//                  skips an opening where a left-aligned block is still being written)
//   blank          nothing visible for more than 0.3s
//   dead-hold      nothing moves or changes for longer than the scene's allowed hold
// Warnings: unsafe (inside the 80px edge margin), small (26–30px).
//
// Opt-outs, only for deliberate design: data-qa-allow-overlap on a container whose children may
// overlap each other (a stacked pile); data-qa-ignore on decoration (cursor, bloom, connector lines).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scenes.json"), "utf8"));
const want = args[0] || "all";
const scenes = want === "all" ? cfg.scenes : cfg.scenes.filter((s) => want.split(",").includes(s.id));
if (!scenes.length) { console.error(`no scene "${want}" in scenes.json`); process.exit(2); }

// The brand font's @font-face rules (optional): assets/kit/fonts.css, with url()s relative to the project root.
const FONTS = path.join(ROOT, "assets/kit/fonts.css");
const fontsCss = fs.existsSync(FONTS) ? fs.readFileSync(FONTS, "utf8") : "";
const kitCss = fs.readFileSync(path.join(ROOT, "assets/kit/kit.css"), "utf8");
const kitJs = fs.readFileSync(path.join(ROOT, "assets/kit/kit.js"), "utf8");
const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

function harness(scene) {
  const src = fs.readFileSync(path.join(ROOT, scene.file), "utf8");
  const m = src.match(/<template>([\s\S]*)<\/template>/);
  if (!m) throw new Error(`${scene.file}: no <template>`);
  return `<!doctype html><html><head><meta charset="utf-8"><base href="file://${ROOT}/">
<script src="${GSAP}"></script>
<style>${fontsCss}\n*{margin:0;padding:0;box-sizing:border-box}\n${kitCss}\nhtml,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
#hf-host{position:relative;width:1920px;height:1080px;overflow:hidden;background:#fff}</style>
<script>window.__timelines={};</script><script>${kitJs}</script></head>
<body><div id="hf-host">${m[1]}</div></body></html>`;
}

// ── in-page measurement ──────────────────────────────────────────────────
function measure() {
  const host = document.getElementById("hf-host");
  const SURF = ".rk-card,.rk-window,.rk-notif,.rk-tile,.rk-bubble,.rk-composer,.rk-btn,.rk-chip,.rk-avatar,.rk-send,.rk-check,[data-qa=box]";
  const items = [];
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n !== host; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= parseFloat(cs.opacity); } return o; };
  const label = (el) => (el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList.length ? "." + [...el.classList].join(".") : ""));
  for (const el of host.querySelectorAll("*")) {
    if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName)) continue;
    if (el.closest("[data-qa-ignore]")) continue;
    const textNodes = [...el.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
    const isSurf = el.matches(SURF);
    const isImg = el.tagName === "IMG";
    if (!textNodes.length && !isSurf && !isImg) continue;
    // An unpainted wrapper marked data-qa="box" is not a surface: it must not count for centring/overlap.
    if (!textNodes.length && !isImg && el.matches("[data-qa=box]") && !/^(svg|SVG)$/.test(el.tagName)) {
      const cs = getComputedStyle(el);
      const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
      if (!painted) continue;
    }
    const op = opacityOf(el);
    if (op < 0.12) continue;
    let box;
    if (textNodes.length) {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const t of textNodes) { const r = document.createRange(); r.selectNodeContents(t); for (const q of r.getClientRects()) { if (q.width < 1) continue; x1 = Math.min(x1, q.left); y1 = Math.min(y1, q.top); x2 = Math.max(x2, q.right); y2 = Math.max(y2, q.bottom); } }
      if (x2 < x1) continue;
      box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      // Line boxes are ~1.2em tall; tight display leading makes neighbouring lines' boxes touch. Compare the
      // glyph band (cap-height region, ~0.78em centred) so stacked lines never count as overlapping.
      const fsPx = parseFloat(getComputedStyle(el).fontSize) * (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1);
      box.lines = []; for (const t of textNodes) { const r = document.createRange(); r.selectNodeContents(t); for (const q of r.getClientRects()) if (q.width >= 1) { const band = Math.min(q.height, 0.78 * fsPx); box.lines.push({ x: q.left, y: q.top + (q.height - band) / 2, w: q.width, h: band }); } }
    } else { const r = el.getBoundingClientRect(); box = { x: r.left, y: r.top, w: r.width, h: r.height }; }
    if (box.w < 2 || box.h < 2) continue;
    const r = el.getBoundingClientRect();
    const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
    const fs = parseFloat(getComputedStyle(el).fontSize) * scale;
    items.push({ el, kind: textNodes.length ? "text" : isImg ? "img" : "box", surf: isSurf, box, op, fs,
      name: label(el), text: textNodes.map((t) => t.textContent.trim()).join(" ").slice(0, 48),
      allow: el.parentElement ? el.parentElement.closest("[data-qa-allow-overlap]") : null });
  }
  const hostR = host.getBoundingClientRect();
  for (const it of items) { it.box.x -= hostR.left; it.box.y -= hostR.top; for (const l of it.box.lines || []) { l.x -= hostR.left; l.y -= hostR.top; } }
  const interLines = (a, b) => { const la = a.box.lines || [a.box], lb = b.box.lines || [b.box]; let s = 0; for (const x of la) for (const y of lb) s += inter(x, y); return s; };
  const inter = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; };
  const related = (a, b) => a.el.contains(b.el) || b.el.contains(a.el);
  const sameAllow = (a, b) => a.allow && a.allow === b.allow;
  const issues = [];
  const texts = items.filter((i) => i.kind === "text");
  const surfs = items.filter((i) => i.surf && i.op > 0.45);
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]; if (related(a, b) || sameAllow(a, b)) continue;
    if (a.op < 0.45 || b.op < 0.45) continue;   // a soft cross-fade: one side is still arriving or leaving
    const ov = interLines(a, b); if (ov > Math.max(120, 0.06 * Math.min(a.box.w * a.box.h, b.box.w * b.box.h))) issues.push(["error", "overlap-text", `"${a.text}" × "${b.text}"`]);
  }
  for (let i = 0; i < surfs.length; i++) for (let j = i + 1; j < surfs.length; j++) {
    const a = surfs[i], b = surfs[j]; if (related(a, b) || sameAllow(a, b)) continue;
    const ov = inter(a.box, b.box); if (ov > 0.03 * Math.min(a.box.w * a.box.h, b.box.w * b.box.h)) issues.push(["error", "overlap-box", `${a.name} × ${b.name}`]);
  }
  const CONTAINERS = ".rk-card,.rk-window,.rk-notif,.rk-composer,.rk-bubble,[data-qa=box]";
  for (const it of items) {
    if (it.op < 0.45 || it.el.closest("[data-qa-free]")) continue;   // data-qa-free: deliberately detaches from its container
    const host = it.el.parentElement && it.el.parentElement.closest(CONTAINERS); if (!host) continue;
    const hb = host.getBoundingClientRect(), b = it.box, hx = hb.left - hostR.left, hy = hb.top - hostR.top;
    const out = Math.max(hx - b.x, hy - b.y, b.x + b.w - (hx + hb.width), b.y + b.h - (hy + hb.height));
    if (out > 3) issues.push(["error", "spill", `${it.text ? '"' + it.text + '"' : it.name} sticks ${Math.round(out)}px out of ${host.id ? "#" + host.id : host.className.split(" ")[0]}`]);
  }
  for (const t of texts) for (const s of surfs) {
    if (s.el.contains(t.el) || t.el.contains(s.el) || sameAllow(t, s)) continue;
    const ov = inter(t.box, s.box); if (ov > 0.08 * t.box.w * t.box.h) issues.push(["error", "text-on-box", `"${t.text}" on ${s.name}`]);
  }
  const camMoved = (el) => { const c = el.closest("[data-qa-camera]"); if (!c) return false; const tf = getComputedStyle(c).transform; return tf && tf !== "none" && tf !== "matrix(1, 0, 0, 1, 0, 0)"; };
  for (const t of texts) {
    if (camMoved(t.el)) { if (t.op > 0.5 && t.fs < 26) issues.push(["error", "tiny", `"${t.text}" ${t.fs.toFixed(1)}px`]); continue; }
    const b = t.box, inside = b.x >= -1 && b.y >= -1 && b.x + b.w <= 1921 && b.y + b.h <= 1081;
    const offscreen = b.x + b.w < 0 || b.y + b.h < 0 || b.x > 1920 || b.y > 1080;
    if (!inside && !offscreen) issues.push(["error", "clipped", `"${t.text}"`]);
    else if (inside && (b.x < 80 || b.y < 50 || b.x + b.w > 1840 || b.y + b.h > 1030)) issues.push(["warn", "unsafe", `"${t.text}"`]);
    if (t.op > 0.5 && !offscreen) { if (t.fs < 26) issues.push(["error", "tiny", `"${t.text}" ${t.fs.toFixed(1)}px`]); else if (t.fs < 30) issues.push(["warn", "small", `"${t.text}" ${t.fs.toFixed(1)}px`]); }
  }
  const vis = items.filter((i) => i.op > 0.5 && (i.kind === "text" || i.surf || i.kind === "img"));
  let u = null; for (const i of vis) { const b = i.box; if (b.x + b.w < 0 || b.x > 1920 || b.y + b.h < 0 || b.y > 1080) continue; u = u ? { x1: Math.min(u.x1, b.x), y1: Math.min(u.y1, b.y), x2: Math.max(u.x2, b.x + b.w), y2: Math.max(u.y2, b.y + b.h) } : { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }; }
  const sig = items.map((i) => `${i.name}|${i.text}|${Math.round(i.box.x)},${Math.round(i.box.y)},${Math.round(i.box.w)},${Math.round(i.box.h)}|${i.op.toFixed(2)}`).join(";");
  return { issues, union: u, count: vis.length, sig, maxFs: Math.max(0, ...texts.map((t) => t.fs)) };
}

// ── driver ───────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars", "--force-device-scale-factor=1"] });
let failed = false;
for (const scene of scenes) {
  const outDir = path.join(ROOT, ".qa", scene.id); fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(ROOT, ".qa", `${scene.id}.html`); fs.writeFileSync(file, harness(scene));
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto("file://" + file, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.waitForFunction((id) => !!window.__timelines[id], { timeout: 8000 }, scene.id).then(() => true, () => false);
  if (!ok) { console.log(`✗ ${scene.id}: timeline "${scene.id}" never registered. ${pageErrors.join(" | ")}`); failed = true; await page.close(); continue; }
  const meta = await page.evaluate(() => { const r = document.querySelector("#hf-host [data-composition-id]"); return { center: r?.dataset.qaCenter || "", centerFrom: parseFloat(r?.dataset.qaCenterFrom || "0"), hold: parseFloat(r?.dataset.qaHold || "1.6"), endHold: parseFloat(r?.dataset.qaEndhold || "0") }; });
  await page.exposeFunction("__noop", () => {});
  await page.evaluate(`window.__measure = ${measure.toString()}`);
  const D = scene.duration, step = 0.1, times = [];
  for (let t = 0; t <= D - 0.049; t += step) times.push(+t.toFixed(2));
  const shotStep = opt("--shots") ? parseFloat(opt("--shots")) : 0;
  const shotAt = new Set((opt("--at") || "").split(",").filter(Boolean).map((x) => (+x).toFixed(2)));
  if (shotStep) for (let t = 0; t <= D - 0.049; t += shotStep) shotAt.add((+t.toFixed(2)).toFixed(2));
  for (const t of shotAt) if (!times.includes(+t)) times.push(+t);
  times.sort((a, b) => a - b);
  const samples = [], shots = [];
  for (const t of times) {
    const res = await page.evaluate((id, t) => {
      const tl = window.__timelines[id]; tl.seek(t, false);
      for (const el of document.querySelectorAll("#hf-host [data-start]")) {
        const s = parseFloat(el.dataset.start || "0"), d = parseFloat(el.dataset.duration || "1e9");
        el.style.visibility = t >= s && t < s + d ? "" : "hidden";
      }
      return window.__measure();
    }, scene.id, t);
    samples.push({ t, ...res });
    if (process.env.QA_DEBUG) console.log(t, JSON.stringify(res.union), res.count);
    if (shotAt.has(t.toFixed(2))) { const p = path.join(outDir, `t-${t.toFixed(2)}.png`); await page.screenshot({ path: p }); shots.push({ t, p }); }
  }
  // aggregate
  const agg = new Map();
  const add = (sev, type, msg, t) => { const k = `${sev}|${type}|${msg}`; const a = agg.get(k) || { sev, type, msg, times: [] }; a.times.push(t); agg.set(k, a); };
  for (const s of samples) for (const [sev, type, msg] of s.issues) add(sev, type, msg, s.t);
  // off-centre (settled ≥0.5s)
  if (meta.center) { let run = []; const flush = () => { if (run.length >= 5) add("error", "off-centre", `content centre ${run[0].dx > 0 ? "+" : ""}${run[0].dx}px from x=960`, run[0].t); run = []; };
    for (const s of samples) { if (s.t < meta.centerFrom) continue; if (!s.union) { flush(); continue; } const dx = Math.round((s.union.x1 + s.union.x2) / 2 - 960); if (Math.abs(dx) > 28) run.push({ t: s.t, dx }); else flush(); } flush(); }
  // blank + dead-hold
  // The scene's last `next.in.dur` seconds play while build.mjs pushes it off screen, so they are never a hold.
  const next = cfg.scenes[cfg.scenes.findIndex((x) => x.id === scene.id) + 1];
  const moveFrom = D - (next?.in?.dur ?? 0);
  let blank = [], hold = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.t >= moveFrom - 1e-6) break;
    // During the incoming transition the previous scene still shows, so blank frames there are not counted.
    if (s.count === 0 && s.t > Math.max(0.15, scene.in?.dur ?? 0)) blank.push(s.t);
    else { if (blank.length >= 4) add("error", "blank", `nothing visible ${blank[0]}–${blank.at(-1)}s`, blank[0]); blank = []; }
    if (s.sig === hold[0].sig) hold.push(s); else { const len = hold.at(-1).t - hold[0].t; const isEnd = meta.endHold && hold.at(-1).t >= D - 0.2; if (len > meta.hold + 0.05 && !isEnd) add("error", "dead-hold", `static ${hold[0].t}–${hold.at(-1).t}s (${len.toFixed(1)}s > ${meta.hold}s)`, hold[0].t); hold = [s]; }
  }
  if (blank.length >= 4) add("error", "blank", `nothing visible ${blank[0]}–${blank.at(-1)}s`, blank[0]);
  { const len = hold.at(-1).t - hold[0].t; const allowed = meta.endHold || meta.hold; if (len > allowed + 0.05) add("error", "dead-hold", `static ${hold[0].t}–${hold.at(-1).t}s at end (${len.toFixed(1)}s > ${allowed}s)`, hold[0].t); }
  if (pageErrors.length) add("error", "js-error", pageErrors.join(" | ").slice(0, 200), 0);
  const list = [...agg.values()];
  const errs = list.filter((a) => a.sev === "error"), warns = list.filter((a) => a.sev === "warn");
  const fmtT = (ts) => (ts.length > 3 ? `${ts[0]}–${ts.at(-1)}s (${ts.length} samples)` : ts.join(", ") + "s");
  console.log(`${errs.length ? "✗" : "✓"} ${scene.id} (${scene.file}, ${D}s): ${errs.length} error(s), ${warns.length} warning(s)`);
  for (const a of errs) console.log(`   ERROR ${a.type}: ${a.msg} @ ${fmtT(a.times)}`);
  for (const a of warns.slice(0, 12)) console.log(`   warn  ${a.type}: ${a.msg} @ ${fmtT(a.times)}`);
  if (warns.length > 12) console.log(`   … ${warns.length - 12} more warnings`);
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ scene: scene.id, errors: errs, warnings: warns }, null, 2));
  if (errs.length) failed = true;
  // contact sheet
  if (shots.length) {
    const cols = 4, W = 480, H = 270;
    const html = `<html><body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${W}px);gap:4px;width:${cols * W + (cols - 1) * 4}px">${shots.map((s) => `<div style="position:relative;width:${W}px;height:${H}px"><img src="file://${s.p}" style="width:${W}px;height:${H}px;display:block"><span style="position:absolute;left:6px;top:4px;font:bold 18px sans-serif;color:#e0f;background:rgba(0,0,0,.55);padding:1px 6px">${s.t.toFixed(2)}s</span></div>`).join("")}</body></html>`;
    const sp = path.join(outDir, "sheet.html"); fs.writeFileSync(sp, html);
    const p2 = await browser.newPage(); const rows = Math.ceil(shots.length / cols);
    await p2.setViewport({ width: cols * W + (cols - 1) * 4, height: rows * H + (rows - 1) * 4 });
    await p2.goto("file://" + sp, { waitUntil: "networkidle0" });
    await p2.screenshot({ path: path.join(outDir, "sheet.jpg"), type: "jpeg", quality: 82, fullPage: true });
    await p2.close();
    console.log(`   sheet: .qa/${scene.id}/sheet.jpg (${shots.length} shots)`);
  }
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
