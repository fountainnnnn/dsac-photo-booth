#!/usr/bin/env node
// Measure one-line headlines in the project's own font before putting them on screen.
//
//   node tools/measure.mjs 96 "Six apps just to talk to your customers." "Reyolk drafts the rest too."
//   node tools/measure.mjs 128 "Introducing Acme" --spacing -0.035 --weight 400
//
// Prints each line's rendered width and flags lines wider than 1600px (a 1920 frame keeps ~160px each side).
// Uses assets/kit/fonts.css (the brand @font-face rules) and the kit's --font family.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const spacing = parseFloat(opt("--spacing", "-0.032"));
const weight = opt("--weight", "400");
const px = parseFloat(args.shift());
if (!px || !args.length) { console.error('usage: node tools/measure.mjs <px> "line" ["line" …] [--spacing -0.032] [--weight 400]'); process.exit(2); }

const ROOT = process.cwd();
const fontsPath = path.join(ROOT, "assets/kit/fonts.css");
const fontsCss = fs.existsSync(fontsPath) ? fs.readFileSync(fontsPath, "utf8") : "";
const kitCss = fs.existsSync(path.join(ROOT, "assets/kit/kit.css")) ? fs.readFileSync(path.join(ROOT, "assets/kit/kit.css"), "utf8") : "";
const family = (kitCss.match(/--font:\s*([^;]+);/) || [, '"Helvetica Neue", Arial, sans-serif'])[1];
const CHROME = process.env.CHROME_PATH || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));

const file = path.join(ROOT, ".tmp-measure.html");
fs.writeFileSync(file, `<html><head><base href="file://${ROOT}/"><style>${fontsCss} body{font-family:${family}} span{white-space:nowrap}</style></head><body></body></html>`);
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--allow-file-access-from-files"] });
const p = await b.newPage();
await p.goto("file://" + file, { waitUntil: "networkidle0" });
await p.evaluate(() => document.fonts.ready);
for (const line of args) {
  // Fonts load only when text first uses them: load this weight and size before measuring, or the width is the fallback's.
  await p.evaluate((t, px, wt, fam) => document.fonts.load(`${wt} ${px}px ${fam}`, t), line, px, weight, family);
  const w = await p.evaluate((t, px, ls, wt) => { const s = document.createElement("span"); s.textContent = t; Object.assign(s.style, { fontSize: px + "px", letterSpacing: ls + "em", fontWeight: wt }); document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; }, line, px, spacing, weight);
  console.log(`${String(Math.round(w)).padStart(5)}px ${w > 1600 ? "✗ too wide for one line" : "✓"}  ${line}`);
}
await b.close();
fs.unlinkSync(file);
