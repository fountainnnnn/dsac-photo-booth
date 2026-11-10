/* Open House film v2 — motion helpers (window.OH).
   The language: things are thrown, not faded. Speed ramps (slow → very fast → soft landing), overshoot and
   squash-and-stretch on every landing, staggered letters. Every helper adds seek-safe tweens to a paused timeline
   (fromTo / set only, no randomness, no clocks) and returns the time it ends. */
(function () {
  // cubic-bezier(x1, y1, x2, y2) as an ease; y may leave 0..1 for overshoot.
  function bez(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 10; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
      return sy(Math.min(1, Math.max(0, t)));
    };
  }
  // A time remap made of segments: [[t, v], …] through (0,0) … (1,1), each leg eased. Lets a move hold, then
  // whip, then glide — the "speed ramp".
  function ramp(points, eases) {
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      for (let i = 1; i < points.length; i++) {
        const [t0, v0] = points[i - 1], [t1, v1] = points[i];
        if (x <= t1) { const k = (x - t0) / (t1 - t0); return v0 + (v1 - v0) * (eases?.[i - 1] ?? E.io)(k); }
      }
      return 1;
    };
  }
  const E = {
    out: bez(0.16, 1, 0.3, 1),        // long soft landing
    in: bez(0.7, 0, 0.84, 0),         // gather speed and leave
    io: bez(0.65, 0, 0.35, 1),        // glide
    whip: bez(0.9, 0, 0.1, 1),        // speed ramp: crawl, blur past, crawl
    snap: bez(0.75, 0, 0.1, 1),       // hold a beat, then snap home
    back: bez(0.34, 1.56, 0.64, 1),   // overshoot and settle
    pop: bez(0.2, 2.1, 0.4, 1),       // big overshoot (stickers, buttons)
    drop: bez(0.55, 0, 1, 0.45),      // fall under gravity
    linear: (x) => x,
  };

  const q = (t) => (typeof t === "string" ? Array.from(document.querySelectorAll(t)) : Array.isArray(t) || t instanceof NodeList ? Array.from(t) : [t]);

  /** Split an element's text into .oh-ch spans (spaces kept; words wrapped so they never break). */
  function split(el) {
    if (el.__chars) return el.__chars;
    const text = el.textContent; el.textContent = "";
    const chars = [];
    text.split(/(\s+)/).forEach((part) => {
      if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(" ")); return; }
      const w = document.createElement("span"); w.className = "oh-word";
      for (const c of part) { const s = document.createElement("span"); s.className = "oh-ch"; s.textContent = c; w.appendChild(s); chars.push(s); }
      el.appendChild(w);
    });
    el.__chars = chars; return chars;
  }

  const OH = {
    E, bez, ramp, split,

    /** Letters jump up from below, stretch on the way, squash on landing, settle. o: {stagger, y, dur} */
    bounce(tl, el, at, o = {}) {
      const cs = split(el), st = o.stagger ?? 0.035, d = o.dur ?? 0.42, y = o.y ?? 140;
      cs.forEach((c, i) => {
        const t = at + i * st;
        tl.fromTo(c, { y, opacity: 0, scaleX: 0.7, scaleY: 1.45 }, { y: 0, opacity: 1, scaleX: 0.7, scaleY: 1.45, duration: d * 0.55, ease: E.out, immediateRender: i === 0 || o.hide !== false }, t);
        tl.fromTo(c, { scaleX: 0.7, scaleY: 1.45 }, { scaleX: 1.22, scaleY: 0.78, duration: d * 0.18, ease: E.out, immediateRender: false }, t + d * 0.42);
        tl.fromTo(c, { scaleX: 1.22, scaleY: 0.78 }, { scaleX: 1, scaleY: 1, duration: d * 0.6, ease: E.back, immediateRender: false }, t + d * 0.6);
      });
      return at + (cs.length - 1) * st + d * 1.2;
    },

    /** Letters fly off upward with a stretch (exit). */
    flyOut(tl, el, at, o = {}) {
      const cs = split(el), st = o.stagger ?? 0.018, d = o.dur ?? 0.32;
      cs.forEach((c, i) => {
        tl.fromTo(c, { y: 0, opacity: 1, scaleY: 1, scaleX: 1 }, { y: o.y ?? -160, opacity: 0, scaleY: 1.5, scaleX: 0.75, duration: d, ease: E.in, immediateRender: false }, at + i * st);
      });
      return at + (cs.length - 1) * st + d;
    },

    /** Whole element slams in from big (camera-close) to 1 with a hold-then-snap ramp, a squash and a settle. */
    slam(tl, el, at, o = {}) {
      const d = o.dur ?? 0.5, r = o.rot ?? -8;
      tl.fromTo(el, { scale: o.from ?? 3, rotation: r, opacity: 0 }, { scale: 0.92, rotation: 0, opacity: 1, duration: d * 0.6, ease: E.snap, immediateRender: o.immediate ?? true }, at);
      tl.fromTo(el, { scale: 0.92 }, { scale: 1, duration: d * 0.8, ease: E.back, immediateRender: false }, at + d * 0.6);
      return at + d * 1.4;
    },

    /** Sticker pop: scale from 0 with a big overshoot and a little spin. */
    pop(tl, els, at, o = {}) {
      const list = q(els), st = o.stagger ?? 0.06, d = o.dur ?? 0.5;
      list.forEach((el, i) => tl.fromTo(el, { scale: 0, rotation: o.rot ?? -14, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: d, ease: E.pop, immediateRender: o.immediate ?? true }, at + i * st));
      return at + (list.length - 1) * st + d;
    },

    /** Leave by shrinking to nothing (sticker unpop). */
    unpop(tl, els, at, o = {}) {
      const list = q(els), st = o.stagger ?? 0.04, d = o.dur ?? 0.28;
      list.forEach((el, i) => tl.fromTo(el, { scale: 1, opacity: 1 }, { scale: 0, opacity: 0, duration: d, ease: E.in, immediateRender: false }, at + i * st));
      return at + (list.length - 1) * st + d;
    },

    /** Move an element along x/y with a speed ramp (whip): it crawls, blurs past, settles. */
    whip(tl, el, from, to, at, d = 0.7, ease = E.whip) {
      tl.fromTo(el, { x: from[0], y: from[1] }, { x: to[0], y: to[1], duration: d, ease, immediateRender: false }, at);
      return at + d;
    },

    /** Typing with a caret, as a pure function of time. */
    type(tl, el, text, at, o = {}) {
      const cps = o.cps ?? 20, d = text.length / cps, p = { n: 0 };
      const draw = () => { el.textContent = text.slice(0, Math.round(p.n)); };
      tl.fromTo(p, { n: 0 }, { n: text.length, duration: d, ease: "none", onUpdate: draw, onStart: draw, immediateRender: false }, at);
      tl.set(p, { n: text.length, onComplete: draw }, at + d);
      return at + d;
    },

    /** A fingertip that comes down, taps (with a ripple) and lifts. pts in the element's parent coords (centres). */
    tap(tl, finger, ripple, from, to, at, o = {}) {
      const R = 42, g = (p) => ({ x: p[0] - R, y: p[1] - R });
      const travel = o.travel ?? 0.3, t = at + travel;
      tl.fromTo(finger, g(from), { ...g(to), duration: travel, ease: E.io, immediateRender: false }, at);
      if (o.enter !== false) tl.fromTo(finger, { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.22, ease: E.out, immediateRender: false }, at);
      tl.fromTo(finger, { scale: 1 }, { scale: 0.78, duration: 0.07, ease: E.in, immediateRender: false }, t);
      tl.fromTo(finger, { scale: 0.78 }, { scale: 1, duration: 0.2, ease: E.back, immediateRender: false }, t + 0.08);
      if (ripple) { tl.set(ripple, { x: to[0] - R, y: to[1] - R }, t); tl.fromTo(ripple, { scale: 0.8, opacity: 0.9 }, { scale: 2.2, opacity: 0, duration: 0.5, ease: E.out, immediateRender: false }, t + 0.02); }
      if (o.leave !== false) tl.fromTo(finger, { opacity: 1, scale: 1 }, { opacity: 0, scale: 1.3, duration: 0.2, ease: E.out, immediateRender: false }, t + (o.hold ?? 0.3));
      return t; // the moment of the tap
    },

    /** Button squish on press. */
    press(tl, el, at) {
      tl.fromTo(el, { scaleX: 1, scaleY: 1 }, { scaleX: 1.06, scaleY: 0.86, duration: 0.07, ease: E.in, immediateRender: false }, at);
      tl.fromTo(el, { scaleX: 1.06, scaleY: 0.86 }, { scaleX: 1, scaleY: 1, duration: 0.4, ease: E.pop, immediateRender: false }, at + 0.07);
      return at + 0.47;
    },

    /** Gentle idle wobble so nothing ever sits dead still (deterministic: a few fixed keyframes). */
    wobble(tl, el, at, d, amp = 2.5) {
      const n = Math.max(2, Math.round(d / 0.9)), step = d / n;
      for (let i = 0; i < n; i++) {
        const a = i % 2 === 0 ? amp : -amp, b = i % 2 === 0 ? -amp : amp;
        tl.fromTo(el, { rotation: i === 0 ? 0 : a }, { rotation: i === n - 1 ? 0 : b, duration: step, ease: E.io, immediateRender: false }, at + i * step);
      }
      return at + d;
    },
  };
  window.OH = OH;
})();
