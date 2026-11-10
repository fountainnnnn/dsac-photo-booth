/* Launch film — shared motion helpers (window.RK).
   Motion language: reveal = opacity 0→1 + a short rise + a light blur-in (3px), ~500ms, cubic-bezier(0, 0, 0.2, 1),
   siblings staggered 60–80ms; headlines build word by word; exits are a quick fade with a small push toward the
   camera (no blur, no drift), and the next line takes over just after — never both at once.
   Every helper adds seek-safe tweens to a PAUSED timeline and returns the end time.
   Rules: fromTo only, no repeat/yoyo, no randomness, no clocks. */
(function () {
  const q = (t) => (typeof t === "string" ? Array.from(document.querySelectorAll(t)) : t && t.length !== undefined && !(t instanceof Element) ? Array.from(t) : [t]);

  // cubic-bezier(x1, y1, x2, y2) as a GSAP ease function (Newton–Raphson on x, then y).
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
      t = Math.min(1, Math.max(0, t));
      return sy(t);
    };
  }

  const E = {
    out: bezier(0, 0, 0.2, 1),          // brand reveal: decelerate into place
    soft: bezier(0.16, 1, 0.3, 1),      // long, gentle settle (camera arrivals, big type)
    io: bezier(0.65, 0, 0.35, 1),       // camera moves, layout glides
    in: bezier(0.4, 0, 1, 1),           // exits: accelerate away
    fast: bezier(0.2, 0.8, 0.2, 1),     // quick UI state changes
    linear: "none",
  };

  const RK = {
    E, bezier,

    /** Reveal: rise + fade + come into focus. o: { y=18, blur=6, dur=0.6, stagger=0.07, ease } */
    rise(tl, targets, at, o = {}) {
      const els = q(targets), dur = o.dur ?? 0.6, st = o.stagger ?? 0.07;
      if (o.fade) {
        // Opaque fast, move slow: a white surface on the dark stage must not pass through a grey half-fade.
        tl.fromTo(els, { y: o.y ?? 18 }, { y: 0, duration: dur, ease: o.ease ?? E.out, stagger: st }, at);
        tl.fromTo(els, { opacity: 0 }, { opacity: 1, duration: o.fade, ease: E.out, stagger: st }, at);
        return at + dur + st * Math.max(0, els.length - 1);
      }
      const from = { y: o.y ?? 18, opacity: 0 }, to = { y: 0, opacity: 1, duration: dur, ease: o.ease ?? E.out, stagger: st };
      if ((o.blur ?? 3) > 0) { from.filter = `blur(${o.blur ?? 3}px)`; to.filter = "blur(0px)"; }
      tl.fromTo(els, from, to, at);
      return at + dur + st * Math.max(0, els.length - 1);
    },

    /** Scale-in (UI surfaces): barely-there scale, fade, focus. o: { from=0.965, blur=4, dur=0.55, stagger=0.07 } */
    pop(tl, targets, at, o = {}) {
      const els = q(targets), dur = o.dur ?? 0.55, st = o.stagger ?? 0.07;
      const from = { scale: o.from ?? 0.965, opacity: 0 }, to = { scale: 1, opacity: 1, duration: dur, ease: o.ease ?? E.out, stagger: st };
      if ((o.blur ?? 4) > 0) { from.filter = `blur(${o.blur ?? 4}px)`; to.filter = "blur(0px)"; }
      tl.fromTo(els, from, to, at);
      return at + dur + st * Math.max(0, els.length - 1);
    },

    /** Exit: a quick fade with a small push toward the camera (the X-film text fade): no blur, no drift.
        o: { dur=0.2, scale=1.04, y=0 } */
    out(tl, targets, at, o = {}) {
      const els = q(targets), dur = o.dur ?? 0.2;
      tl.fromTo(els, { opacity: 1, scale: 1, y: 0 }, { opacity: 0, scale: o.scale ?? 1.04, y: o.y ?? 0, duration: dur, ease: E.in, immediateRender: false }, at);
      return at + dur;
    },

    /** In-place swap: `from` lifts away (0.22s, accelerating) and `to` rises in from below as it clears
        (at +0.18), so two words never ghost through each other. With o.words, `to` builds word by word. */
    swap(tl, from, to, at, o = {}) {
      RK.out(tl, from, at, { dur: 0.18 });
      return o.words ? RK.words(tl, to, at + 0.14, o) : RK.rise(tl, to, at + 0.14, { y: o.y ?? 14, dur: o.dur ?? 0.5 });
    },

    /** Split an element's text into .rk-word spans (once), keeping inline children (e.g. .t-quiet spans)
        and their classes. Returns the word spans in reading order. */
    split(el) {
      if (el.__rkWords) return el.__rkWords;
      const words = [];
      const walk = (node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            const parts = child.textContent.split(/(\s+)/);
            const frag = document.createDocumentFragment();
            for (const p of parts) {
              if (!p) continue;
              if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); continue; }
              const s = document.createElement("span"); s.className = "rk-word"; s.textContent = p; frag.appendChild(s); words.push(s);
            }
            node.replaceChild(frag, child);
          } else if (child.nodeType === 1 && !child.classList.contains("rk-strike") && !child.classList.contains("rk-word")) {
            walk(child);
          }
        }
      };
      walk(el);
      el.__rkWords = words;
      return words;
    },

    /** Word-by-word build (the Muse/Linear headline): each word rises a little, fades and focuses.
        o: { stagger=0.075, y=16, blur=8, dur=0.55 } */
    words(tl, el, at, o = {}) {
      const ws = RK.split(el), st = o.stagger ?? 0.075, dur = o.dur ?? 0.5;
      tl.fromTo(el, { opacity: 1 }, { opacity: 1, duration: 0.01, immediateRender: false }, at);
      tl.fromTo(ws, { opacity: 0, y: o.y ?? 10, filter: `blur(${o.blur ?? 3}px)` },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: dur, ease: o.ease ?? E.out, stagger: st }, at);
      return at + dur + st * Math.max(0, ws.length - 1);
    },

    /** Instant visibility switch. */
    show(tl, targets, at) { tl.set(q(targets), { opacity: 1 }, at); return at; },
    hide(tl, targets, at) { tl.set(q(targets), { opacity: 0 }, at); return at; },

    /** Type text into el. o: { cps=26, caret: element|null }. Uses onUpdate (HyperFrames seeks with events on). */
    type(tl, el, text, at, o = {}) {
      const cps = o.cps ?? 26, dur = text.length / cps, caret = o.caret || null;
      const p = { n: 0 };
      const render = () => { el.textContent = text.slice(0, Math.round(p.n)); };
      tl.fromTo(p, { n: 0 }, { n: text.length, duration: dur, ease: "none", onUpdate: render, onStart: render }, at);
      tl.set({}, { onComplete: () => { el.textContent = text; } }, at + dur);
      if (caret) RK.blink(tl, caret, at, at + dur + (o.caretHold ?? 0.6));
      return at + dur;
    },

    /** Finite caret: solid while typing, blinks after. */
    blink(tl, caret, from, to, period = 0.9) {
      tl.set(caret, { opacity: 1 }, from);
      for (let t = from + period, on = false; t < to; t += period / 2, on = !on) tl.set(caret, { opacity: on ? 1 : 0 }, t);
      tl.set(caret, { opacity: 0 }, to);
      return to;
    },

    /** Count up a number. o: { dur=1.0, prefix="S$", decimals=2, from=0 } */
    count(tl, el, to, at, o = {}) {
      const dur = o.dur ?? 1.0, pre = o.prefix ?? "S$", dec = o.decimals ?? 2;
      const fmt = (v) => pre + v.toLocaleString("en-SG", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const p = { v: o.from ?? 0 };
      tl.fromTo(p, { v: o.from ?? 0 }, { v: to, duration: dur, ease: E.soft, onUpdate: () => { el.textContent = fmt(p.v); }, onStart: () => { el.textContent = fmt(p.v); } }, at);
      tl.set({}, { onComplete: () => { el.textContent = fmt(to); } }, at + dur);
      return at + dur;
    },

    /** Button press: a small compress, then settle. */
    press(tl, el, at) {
      tl.fromTo(el, { scale: 1 }, { scale: 0.955, duration: 0.11, ease: E.in, immediateRender: false }, at);
      tl.fromTo(el, { scale: 0.955 }, { scale: 1, duration: 0.45, ease: E.out, immediateRender: false }, at + 0.11);
      return at + 0.56;
    },

    /** Move a .rk-cursor from (x0,y0) to (x1,y1) (the arrow tip), easing in and out; optional click. */
    cursor(tl, el, x0, y0, x1, y1, at, o = {}) {
      const dur = o.dur ?? 0.9;
      tl.fromTo(el, { x: x0, y: y0, scale: 1 }, { x: x1, y: y1, duration: dur, ease: E.io, immediateRender: false }, at);
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: E.out, immediateRender: false }, at);
      if (o.click) {
        tl.fromTo(el, { scale: 1 }, { scale: 0.88, duration: 0.1, ease: E.in, immediateRender: false }, at + dur + 0.05);
        tl.fromTo(el, { scale: 0.88 }, { scale: 1, duration: 0.35, ease: E.out, immediateRender: false }, at + dur + 0.15);
      }
      return at + dur + (o.click ? 0.15 : 0);
    },

    /** Draw SVG strokes on (a stroke logo mark). */
    draw(tl, paths, at, o = {}) {
      const list = q(paths), dur = o.dur ?? 0.8, st = o.stagger ?? 0.22;
      list.forEach((p, i) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len} ${len}`;
        tl.fromTo(p, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: dur, ease: E.io }, at + i * st);
      });
      return at + dur + st * (list.length - 1);
    },

    /** Draw a .rk-strike line across text. */
    strike(tl, line, at, o = {}) {
      const dur = o.dur ?? 0.4;
      tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: dur, ease: E.out }, at);
      return at + dur;
    },

    /** Pop a .rk-check in. */
    check(tl, el, at) {
      tl.fromTo(el, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: E.soft }, at);
      return at + 0.45;
    },

    /** Camera move on a .rk-world: bring point (px,py) of the unscaled frame to the frame centre at `scale`. */
    push(tl, world, px, py, scale, at, o = {}) {
      const dur = o.dur ?? 1.1;
      tl.fromTo(world, { x: 0, y: 0, scale: 1 },
        { x: (960 - px) * scale, y: (540 - py) * scale, scale, duration: dur, ease: o.ease ?? E.io,
          transformOrigin: "960px 540px", immediateRender: false }, at);
      return at + dur;
    },
  };

  window.RK = RK;
})();
