"""Scenes c05–c13 of the Open House film v2. JS is written as plain strings: `S_` becomes the scene id and `@name`
tokens are filled from keyword arguments (see J()). Geometry notes as in scenes_v2.py."""
from scenes_v2 import (STAGE_CSS, CURSOR, CURSOR_JS, HIDE, avatars, stage, bg_tile, bg_tile_centre, av_tile,
                       av_tile_centre, PROHIBIT, doodle)


def J(s, text, **kw):
    out = CURSOR_JS.replace("{s}", s) + text if "@cursor" in text else text
    out = out.replace("@cursor", "").replace("S_", s)
    for k, v in kw.items():
        out = out.replace("@" + k, str(v))
    return out


def typed(s, n):
    return f'<div id="{s}-w{n}" style="position:absolute;left:20px;top:0;height:84px;display:flex;align-items:center;opacity:0"><span id="{s}-t{n}"></span><i id="{s}-k{n}" class="caret" style="opacity:0"></i></div>'


TYPE_JS = """
      // Typing helper: wrapper n shows, its text types out with a caret that blinks after.
      const typeIn = (n, text, t, cps) => {
        tl.set($("S_-w" + n), { opacity: 1 }, t);
        const end = OH.type(tl, $("S_-t" + n), text, t, { cps });
        tl.set($("S_-k" + n), { opacity: 1 }, t);
        for (let k = 0; k < 4; k++) tl.set($("S_-k" + n), { opacity: k % 2 ? 1 : 0 }, end + 0.25 + k * 0.4);
        return end;
      };
      const typeOut = (n, t) => tl.set($("S_-w" + n), { opacity: 0 }, t);
"""

WATCH = """<div id="S_-watch" class="watch"><svg viewBox="0 0 200 200"><circle cx="100" cy="108" r="78" fill="#fff" stroke="#1b1a1f" stroke-width="10"/><rect x="84" y="8" width="32" height="22" rx="6" fill="#1b1a1f"/><circle id="S_-wr" cx="100" cy="108" r="60" fill="none" stroke="#ff4b3e" stroke-width="22" stroke-dasharray="377" stroke-dashoffset="377" transform="rotate(-90 100 108)"/><line id="S_-wh" x1="100" y1="108" x2="100" y2="56" stroke="#1b1a1f" stroke-width="10" stroke-linecap="round"/><circle cx="100" cy="108" r="9" fill="#1b1a1f"/></svg><span>about 5 s</span></div>"""
WATCH_CSS = """
.watch { position: absolute; left: 1000px; top: 380px; width: 200px; height: 250px; transform-origin: 50% 40%; z-index: 30; }
.watch svg { width: 200px; height: 200px; }
.watch span { position: absolute; left: 10px; top: 196px; width: 180px; height: 52px; line-height: 52px; border-radius: 26px; background: #fff; box-shadow: 0 0 0 5px #1b1a1f; text-align: center; font-size: 30px; font-weight: 900; color: #1b1a1f; white-space: nowrap; }
#S_-wh { transform-origin: 100px 108px; }
"""
WATCH_JS = """
      // The stopwatch: pops on, its ring fills and its hand sweeps (time compressed), pops off.
      const watch = (t, d) => {
        OH.pop(tl, $("S_-watch"), t, { dur: 0.45, rot: -20 });
        tl.fromTo($("S_-wr"), { strokeDashoffset: 377 }, { strokeDashoffset: 0, duration: d, ease: E.io, immediateRender: false }, t + 0.1);
        tl.fromTo($("S_-wh"), { rotation: 0 }, { rotation: 720, duration: d, ease: E.io, immediateRender: false }, t + 0.1);
        OH.unpop(tl, $("S_-watch"), t + d + 0.15);
      };
      tl.set($("S_-watch"), { opacity: 0 }, 0);
"""

HEAD_CSS = """
.hd { position: absolute; left: 110px; top: 92px; font-size: 112px; line-height: 120px; font-weight: 900; letter-spacing: -0.045em; white-space: nowrap; }
.hd.lt { color: #fff; -webkit-text-stroke: 10px #1b1a1f; paint-order: stroke fill; }
.hd .hi { color: #ffd23f; }
.sticker { position: absolute; padding: 0 36px; height: 84px; display: flex; align-items: center; gap: 18px; background: #fff; border-radius: 48px; box-shadow: 0 0 0 6px #1b1a1f, 8px 8px 0 6px #1b1a1f; font-size: 38px; font-weight: 900; letter-spacing: -0.02em; white-space: nowrap; color: #1b1a1f; z-index: 30; }
.tag { position: absolute; height: 72px; padding: 0 30px; display: flex; align-items: center; border-radius: 36px; background: #1b1a1f; color: #fff; font-size: 36px; font-weight: 900; letter-spacing: 0.04em; white-space: nowrap; z-index: 30; }
"""

SCENES2 = []

# ── c05 · type any place (unlimited; the AI draws only the place) ───────────────────────────────────────────────
s = "c05"
BG5 = [("b0", "assets/oh/backgrounds/neon.svg", True), ("b1", "assets/v2/undersea.svg", False),
       ("b2", "assets/v2/snow.svg", False), ("b3", "assets/v2/candy.svg", False)]
T5a = [("studio", "Studio", "assets/oh/backgrounds/studio.svg"), ("sunset", "Sunset", "assets/oh/backgrounds/sunset.svg"),
       ("space", "Space", "assets/oh/backgrounds/space.svg"), ("neon", "Neon", "assets/oh/backgrounds/neon.svg")]
yours = ('<div id="c05-t-yours" class="bt" style="left:40px;top:400px"><img src="assets/v2/undersea.svg" alt="">'
         '<img id="c05-y2" src="assets/v2/snow.svg" alt="" style="opacity:0"><img id="c05-y3" src="assets/v2/candy.svg" alt="" style="opacity:0">'
         '<span>Yours</span><i class="ring"></i></div>')
SCENES2.append(dict(id=s, name="type-a-place", dur=14.0, ground="#7a5cff", css=STAGE_CSS + HEAD_CSS + WATCH_CSS.replace("S_", s), html=f"""
      <div id="{s}-hd" class="hd lt">Or type <span class="hi">any</span> place.</div>
      <div id="{s}-hd2" class="hd lt">Type as many as you like.</div>
      {stage(s, BG5)}
      <div id="{s}-rail" class="rail">
        <p class="r-label" style="top:36px">Background</p>
        <div id="{s}-in" class="r-input" style="top:92px"><span id="{s}-ph" class="ph">Where do you want to be?</span>{typed(s, 1)}{typed(s, 2)}{typed(s, 3)}</div>
        <div id="{s}-btn" class="r-btn" style="top:196px;opacity:0.4"><span id="{s}-go">Make it</span><span id="{s}-busy" style="opacity:0">Making your background…</span><span id="{s}-go2" style="opacity:0">Make it</span></div>
        <p class="r-note" style="top:300px">What you type is sent to<br>an online image service.</p>
        <div id="{s}-g1" style="position:absolute;left:0;top:0;width:480px;height:738px">{"".join(bg_tile(s, k, bid, lb, src, k == 3) for k, (bid, lb, src) in enumerate(T5a))}</div>
        <div id="{s}-g2" style="position:absolute;left:0;top:0;width:480px;height:738px;opacity:0">{yours}{"".join(bg_tile(s + "x", k + 1, bid, lb, src) for k, (bid, lb, src) in enumerate(T5a[:3]))}</div>
      </div>
      {WATCH.replace("S_", s)}
      <div id="{s}-call" class="sticker" style="left:230px;top:962px">Your faces stay real. Only the place is drawn.</div>
      {CURSOR.format(s=s)}
""", js=J(s, "@cursor" + TYPE_JS + WATCH_JS + """
      // 0.00 — the strip clears; the screen settles from a little lift, the heading bounces up.
      tl.fromTo([$("S_-stage"), $("S_-rail")], { y: 50 }, { y: 0, duration: 0.6, ease: E.back }, 0.0);
      tl.set($("S_-hd2"), { opacity: 0 }, 0);
      OH.bounce(tl, $("S_-hd"), 0.25, { stagger: 0.035 });
      // 1.00 — click into the box (it takes an ink outline), type "under the sea".
      curIn(0.95); mv([1900, 1100], [1570, 396], 0.95, 0.5);
      tl.fromTo($("S_-in"), { boxShadow: "inset 0 0 0 3px #e6e4e9" }, { boxShadow: "inset 0 0 0 5px #17161a", duration: 0.12, immediateRender: false }, 1.47);
      tl.set($("S_-ph"), { opacity: 0 }, 1.6);
      const e1 = typeIn(1, "under the sea", 1.6, 14);
      tl.fromTo($("S_-btn"), { opacity: 0.4 }, { opacity: 1, duration: 0.15, immediateRender: false }, 1.65);
      // 2.75 — Make it: the button greys and reads "Making your background…" while the image is drawn (~5 s,
      // compressed here under a stopwatch).
      mv([1570, 396], [1570, 500], 2.45, 0.3);
      OH.press(tl, $("S_-btn"), 2.75);
      tl.fromTo($("S_-btn"), { opacity: 1 }, { opacity: 0.4, duration: 0.15, immediateRender: false }, 2.8);
      tl.set($("S_-go"), { opacity: 0 }, 2.8); tl.set($("S_-busy"), { opacity: 1 }, 2.8);
      watch(2.9, 2.0);
      tl.fromTo($("S_-crew"), { rotation: 0 }, { rotation: 0, duration: 0.01, immediateRender: false }, 2.9);
      // 5.10 — the sea opens out of the middle of the picture (sparkle); the guests hop; "Yours" is chosen.
      tl.set($("S_-b1"), { opacity: 1 }, 5.1);
      tl.fromTo($("S_-b1"), { clipPath: "circle(0px at 960px 540px)" }, { clipPath: "circle(1200px at 960px 540px)", duration: 0.7, ease: E.whip, immediateRender: false }, 5.1);
      tl.fromTo($("S_-crew"), { y: 0 }, { y: -80, duration: 0.2, ease: E.out, immediateRender: false }, 5.35);
      tl.fromTo($("S_-crew"), { y: -80 }, { y: 0, duration: 0.32, ease: E.drop, immediateRender: false }, 5.55);
      tl.set($("S_-busy"), { opacity: 0 }, 5.1); tl.set($("S_-go2"), { opacity: 1 }, 5.1);
      tl.fromTo($("S_-btn"), { opacity: 0.4 }, { opacity: 1, duration: 0.15, immediateRender: false }, 5.1);
      OH.unpop(tl, $("S_-g1"), 5.15, { dur: 0.2 });
      OH.pop(tl, $("S_-g2"), 5.3, { dur: 0.45, rot: 0 });
      // 5.90 — the callout: the guests are cut out on the laptop; only the place is drawn.
      OH.pop(tl, $("S_-call"), 5.9, { rot: -6 });
      OH.unpop(tl, $("S_-call"), 7.6);
      // 7.80 — new heading; then two more places in quick succession (typing and drawing sped up).
      OH.flyOut(tl, $("S_-hd"), 7.8);
      tl.set($("S_-hd2"), { opacity: 1 }, 8.1);
      OH.bounce(tl, $("S_-hd2"), 8.1, { stagger: 0.03 });
      const quick = (n, text, t, layer, tile, from, to) => {
        mv([1570, 500], [1570, 396], t, 0.25);
        typeOut(n - 1, t + 0.3);
        typeIn(n, text, t + 0.3, 34);
        const tb = t + 0.3 + text.length / 34 + 0.12;
        mv([1570, 396], [1570, 500], tb, 0.22);
        OH.press(tl, $("S_-btn"), tb + 0.22);
        tl.fromTo($("S_-btn"), { opacity: 1 }, { opacity: 0.4, duration: 0.1, immediateRender: false }, tb + 0.25);
        tl.fromTo($("S_-btn"), { opacity: 0.4 }, { opacity: 1, duration: 0.1, immediateRender: false }, tb + 0.85);
        const tr = tb + 0.85;
        tl.set($("S_-" + layer), { opacity: 1 }, tr);
        tl.fromTo($("S_-" + layer), { clipPath: from }, { clipPath: to, duration: 0.55, ease: E.whip, immediateRender: false }, tr);
        tl.fromTo($("S_-" + tile), { opacity: 0 }, { opacity: 1, duration: 0.2, immediateRender: false }, tr + 0.3);
        tl.fromTo($("S_-crew"), { scaleY: 1 }, { scaleY: 0.92, duration: 0.08, ease: E.in, transformOrigin: "960px 1080px", immediateRender: false }, tr + 0.2);
        tl.fromTo($("S_-crew"), { scaleY: 0.92 }, { scaleY: 1, duration: 0.4, ease: E.pop, transformOrigin: "960px 1080px", immediateRender: false }, tr + 0.28);
        return tr;
      };
      quick(2, "a snowy mountain", 8.7, "b2", "y2", "inset(0% 0% 100% 0%)", "inset(0% 0% 0% 0%)");
      quick(3, "a candy land", 10.55, "b3", "y3", "circle(0px at 150px 950px)", "circle(2300px at 150px 950px)");
      curOut(12.6);
      tl.fromTo($("S_-world"), { scale: 1 }, { scale: 1.04, duration: 14, ease: "none", immediateRender: false }, 0);
""")))

# ── c06 · avatars: one per part of the face; same part swaps ───────────────────────────────────────────────────────
s = "c06"
AVT = [("none", None), ("shades", "assets/oh/avatars/shades.svg"), ("party", "assets/oh/avatars/party-hat.svg"),
       ("cat", "assets/oh/avatars/cat-ears.svg"), ("crown", "assets/oh/avatars/crown.svg"), ("mous", "assets/oh/avatars/moustache.svg")]


def av_rail(s, tiles, extra=""):
    return f"""<div id="{s}-rail" class="rail">
        <p class="r-label" style="top:36px">Avatars</p>
        <p class="r-note" style="top:84px">Pick as many as you like,<br>one for each part of<br>the face.</p>
        <div id="{s}-in" class="r-input" style="top:212px"><span id="{s}-ph" class="ph">What do you want to wear?</span>{typed(s, 1)}{typed(s, 2)}</div>
        <div id="{s}-btn" class="r-btn" style="top:316px;opacity:0.4"><span id="{s}-go">Make it</span><span id="{s}-busy" style="opacity:0">Making your avatar…</span><span id="{s}-go2" style="opacity:0">Make it</span></div>
        {tiles}{extra}
      </div>"""


def av_grid(s, gid, items, on=(), hidden=False):
    tiles = "".join(av_tile(f"{s}{gid}", k, aid, src, aid in on, PROHIBIT if aid == "none" else None) for k, (aid, src) in enumerate(items))
    return f'<div id="{s}-{gid}" style="position:absolute;left:0;top:0;width:480px;height:738px{";opacity:0" if hidden else ""}">{tiles}</div>'


C = {k: av_tile_centre(i) for i, k in enumerate(["none", "shades", "party", "cat", "crown", "mous"])}
SCENES2.append(dict(id=s, name="avatars", dur=11.0, ground="#ffd23f", css=STAGE_CSS + HEAD_CSS, html=f"""
      <div id="{s}-hd" class="hd">Pile on the props.</div>
      <div id="{s}-hd2" class="hd">Same part? It swaps.</div>
      {stage(s, [("b0", "assets/v2/candy.svg", True)], crew_extra=avatars(s, "crown") + avatars(s, "party") + avatars(s, "shades") + avatars(s, "mous"))}
      {av_rail(s, av_grid(s, "g", AVT, on=("none",)))}
      <div id="{s}-tg1" class="tag" style="left:1010px;top:116px">HEAD</div>
      <div id="{s}-tg2" class="tag" style="left:1190px;top:116px">EYES</div>
      <div id="{s}-tg3" class="tag" style="left:1362px;top:116px">UPPER LIP</div>
      {CURSOR.format(s=s)}
""", js=J(s, "@cursor" + """
      const A = (k) => ["N", "R", "M"].map((f) => $("S_-" + k + "-" + f));
      ["crown", "party", "shades", "mous"].forEach((k) => tl.set(A(k), { opacity: 0 }, 0));
      tl.set([$("S_-hd2"), $("S_-tg1"), $("S_-tg2"), $("S_-tg3")], { opacity: 0 }, 0);
      tl.fromTo([$("S_-stage"), $("S_-rail")], { scale: 0.92 }, { scale: 1, duration: 0.6, ease: E.back }, 0.0);
      OH.bounce(tl, $("S_-hd"), 0.2, { stagger: 0.035 });
      const pick = (from, k, t) => {
        mv(from, @C[k], t - 0.45, 0.45);
        tl.fromTo($("S_g-r-" + k), { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.pop, immediateRender: false }, t);
      };
      curIn(0.9);
      // 1.40 — Crown: a crown drops onto every head, squashes, settles (head).
      tl.fromTo($("S_g-r-none"), { opacity: 1 }, { opacity: 0, duration: 0.08, immediateRender: false }, 1.4);
      mv([1900, 1100], @C.crown, 0.9, 0.5);
      tl.fromTo($("S_g-r-crown"), { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.pop, immediateRender: false }, 1.4);
      A("crown").forEach((el, i) => {
        const t = 1.45 + i * 0.08;
        tl.fromTo(el, { opacity: 0, y: -600, rotation: (i - 1) * 25 }, { opacity: 1, y: 0, rotation: 0, duration: 0.42, ease: E.drop, immediateRender: false }, t);
        tl.fromTo(el, { scaleX: 1, scaleY: 1 }, { scaleX: 1.25, scaleY: 0.75, duration: 0.07, ease: E.out, immediateRender: false }, t + 0.42);
        tl.fromTo(el, { scaleX: 1.25, scaleY: 0.75 }, { scaleX: 1, scaleY: 1, duration: 0.45, ease: E.pop, immediateRender: false }, t + 0.49);
      });
      OH.pop(tl, $("S_-tg1"), 1.9, { rot: -10 });
      // 3.00 — Shades: they fly in from the side and snap onto every pair of eyes (eyes).
      pick(@C.crown, "shades", 3.0);
      A("shades").forEach((el, i) => {
        const t = 3.05 + i * 0.07;
        tl.fromTo(el, { opacity: 0, x: -1500, rotation: -40 }, { opacity: 1, x: 0, rotation: 0, duration: 0.5, ease: E.whip, immediateRender: false }, t);
        tl.fromTo(el, { scaleX: 1 }, { scaleX: 0.82, duration: 0.06, ease: E.out, immediateRender: false }, t + 0.5);
        tl.fromTo(el, { scaleX: 0.82 }, { scaleX: 1, duration: 0.4, ease: E.pop, immediateRender: false }, t + 0.56);
      });
      OH.pop(tl, $("S_-tg2"), 3.5, { rot: 8 });
      // 4.50 — Moustache: boing (upper lip).
      pick(@C.shades, "mous", 4.5);
      OH.pop(tl, A("mous"), 4.55, { stagger: 0.07, rot: -30, dur: 0.55 });
      OH.pop(tl, $("S_-tg3"), 5.0, { rot: -6 });
      // 6.00 — new heading; Party hat replaces the crown (one avatar per part): crowns spin off, hats drop in.
      OH.unpop(tl, [$("S_-tg1"), $("S_-tg2"), $("S_-tg3")], 5.8);
      OH.flyOut(tl, $("S_-hd"), 6.0);
      tl.set($("S_-hd2"), { opacity: 1 }, 6.3);
      OH.bounce(tl, $("S_-hd2"), 6.3, { stagger: 0.035 });
      pick(@C.mous, "party", 6.9);
      tl.fromTo($("S_g-r-crown"), { opacity: 1 }, { opacity: 0, duration: 0.08, immediateRender: false }, 6.9);
      A("crown").forEach((el, i) => tl.fromTo(el, { y: 0, rotation: 0, opacity: 1 }, { y: -700, rotation: (i - 1) * 120 + 90, opacity: 0, duration: 0.5, ease: E.in, immediateRender: false }, 6.95 + i * 0.05));
      A("party").forEach((el, i) => {
        const t = 7.15 + i * 0.08;
        tl.fromTo(el, { opacity: 0, y: -600 }, { opacity: 1, y: 0, duration: 0.4, ease: E.drop, immediateRender: false }, t);
        tl.fromTo(el, { scaleX: 1, scaleY: 1 }, { scaleX: 1.2, scaleY: 0.8, duration: 0.07, ease: E.out, immediateRender: false }, t + 0.4);
        tl.fromTo(el, { scaleX: 1.2, scaleY: 0.8 }, { scaleX: 1, scaleY: 1, duration: 0.45, ease: E.pop, immediateRender: false }, t + 0.47);
      });
      tl.fromTo(cur, { x: @C.party[0], y: @C.party[1] }, { x: 1900, y: 1150, duration: 0.6, ease: E.in, immediateRender: false }, 8.2);
      // 8.60 — the three of them cheer: two hops.
      [8.6, 9.4].forEach((t) => {
        tl.fromTo($("S_-crew"), { y: 0 }, { y: -60, duration: 0.18, ease: E.out, immediateRender: false }, t);
        tl.fromTo($("S_-crew"), { y: -60 }, { y: 0, duration: 0.28, ease: E.drop, immediateRender: false }, t + 0.18);
      });
      tl.fromTo($("S_-world"), { scale: 1 }, { scale: 1.04, duration: 11, ease: "none", immediateRender: false }, 0);
""", C="C").replace("@C", "C").replace("const A = (k)", "const C = " + str({k: list(v) for k, v in C.items()}).replace("'", '"') + ";\n      const A = (k)")))

# ── c07 · type what to wear: a pirate hat; an animal becomes a face filter ──────────────────────────────────────
s = "c07"
G1 = AVT
G2 = [("none", None), ("pirate", "assets/v2/pirate-hat.svg"), ("shades", "assets/oh/avatars/shades.svg"),
      ("party", "assets/oh/avatars/party-hat.svg"), ("cat", "assets/oh/avatars/cat-ears.svg"), ("crown", "assets/oh/avatars/crown.svg")]
G3 = [("none", None), ("tiger", "assets/v2/tiger-ears.svg"), ("pirate", "assets/v2/pirate-hat.svg"),
      ("shades", "assets/oh/avatars/shades.svg"), ("party", "assets/oh/avatars/party-hat.svg"), ("cat", "assets/oh/avatars/cat-ears.svg")]
SCENES2.append(dict(id=s, name="type-an-avatar", dur=14.0, ground="#ff4b3e", css=STAGE_CSS + HEAD_CSS + WATCH_CSS.replace("S_", s), html=f"""
      <div id="{s}-hd" class="hd lt">Or type what to wear.</div>
      <div id="{s}-hd2" class="hd lt">Animals become filters.</div>
      {stage(s, [("b0", "assets/v2/candy.svg", True)], crew_extra=avatars(s, "party") + avatars(s, "pirate") + avatars(s, "tears") + avatars(s, "tface") + avatars(s, "shades") + avatars(s, "mous"))}
      {av_rail(s, av_grid(s, "g1", G1, on=("shades", "party", "mous")) + av_grid(s, "g2", G2, on=("pirate", "shades"), hidden=True) + av_grid(s, "g3", G3, on=("tiger",), hidden=True))}
      {WATCH.replace("S_", s)}
      <div id="{s}-call" class="sticker" style="left:220px;top:962px">Ears up top. Nose and whiskers on the face.</div>
      {CURSOR.format(s=s)}
""", js=J(s, "@cursor" + TYPE_JS + WATCH_JS + """
      const A = (k) => ["N", "R", "M"].map((f) => $("S_-" + k + "-" + f));
      ["pirate", "tears", "tface"].forEach((k) => tl.set(A(k), { opacity: 0 }, 0));
      tl.set([$("S_-hd2"), $("S_-call")], { opacity: 0 }, 0);
      OH.bounce(tl, $("S_-hd"), 0.15, { stagger: 0.03 });
      // 0.90 — click the box, type "a pirate hat", Make it → "Making your avatar…" under the stopwatch.
      curIn(0.85); mv([1900, 1100], [1570, 516], 0.85, 0.5);
      tl.fromTo($("S_-in"), { boxShadow: "inset 0 0 0 3px #e6e4e9" }, { boxShadow: "inset 0 0 0 5px #17161a", duration: 0.12, immediateRender: false }, 1.37);
      tl.set($("S_-ph"), { opacity: 0 }, 1.5);
      typeIn(1, "a pirate hat", 1.5, 15);
      tl.fromTo($("S_-btn"), { opacity: 0.4 }, { opacity: 1, duration: 0.15, immediateRender: false }, 1.55);
      mv([1570, 516], [1570, 620], 2.45, 0.3);
      OH.press(tl, $("S_-btn"), 2.75);
      tl.fromTo($("S_-btn"), { opacity: 1 }, { opacity: 0.4, duration: 0.15, immediateRender: false }, 2.8);
      tl.set($("S_-go"), { opacity: 0 }, 2.8); tl.set($("S_-busy"), { opacity: 1 }, 2.8);
      watch(2.9, 1.9);
      // 5.00 — the hat is ready: party hats pop off, pirate hats spin down onto every head; its tile is chosen.
      tl.set($("S_-busy"), { opacity: 0 }, 5.0); tl.set($("S_-go2"), { opacity: 1 }, 5.0);
      tl.fromTo($("S_-btn"), { opacity: 0.4 }, { opacity: 1, duration: 0.15, immediateRender: false }, 5.0);
      OH.unpop(tl, A("party"), 5.0, { stagger: 0.04 });
      A("pirate").forEach((el, i) => {
        const t = 5.15 + i * 0.08;
        tl.fromTo(el, { opacity: 0, y: -500, rotation: -200 }, { opacity: 1, y: 0, rotation: 0, duration: 0.5, ease: E.out, immediateRender: false }, t);
        tl.fromTo(el, { scaleX: 1, scaleY: 1 }, { scaleX: 1.2, scaleY: 0.8, duration: 0.07, ease: E.out, immediateRender: false }, t + 0.45);
        tl.fromTo(el, { scaleX: 1.2, scaleY: 0.8 }, { scaleX: 1, scaleY: 1, duration: 0.4, ease: E.pop, immediateRender: false }, t + 0.52);
      });
      OH.unpop(tl, $("S_-g1"), 5.0, { dur: 0.18 });
      tl.set($("S_-g2"), { opacity: 1 }, 5.15);
      OH.pop(tl, $("S_-g2"), 5.15, { rot: 0, dur: 0.4 });
      // 6.40 — new heading. "No avatars" clears them all (they pop off), then "a tiger".
      OH.flyOut(tl, $("S_-hd"), 6.3);
      tl.set($("S_-hd2"), { opacity: 1 }, 6.6);
      OH.bounce(tl, $("S_-hd2"), 6.6, { stagger: 0.03 });
      mv([1570, 620], @none, 6.6, 0.4);
      tl.fromTo([$("S_g2-r-pirate"), $("S_g2-r-shades")], { opacity: 1 }, { opacity: 0, duration: 0.08, immediateRender: false }, 7.0);
      tl.fromTo($("S_g2-r-none"), { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.pop, immediateRender: false }, 7.0);
      OH.unpop(tl, [...A("pirate"), ...A("shades"), ...A("mous")], 7.05, { stagger: 0.03 });
      mv(@none, [1570, 516], 7.6, 0.35);
      typeOut(1, 7.95);
      typeIn(2, "a tiger", 7.95, 18);
      mv([1570, 516], [1570, 620], 8.45, 0.25);
      OH.press(tl, $("S_-btn"), 8.7);
      tl.fromTo($("S_-btn"), { opacity: 1 }, { opacity: 0.4, duration: 0.1, immediateRender: false }, 8.72);
      tl.set($("S_-go2"), { opacity: 0 }, 8.72); tl.set($("S_-busy"), { opacity: 1 }, 8.72);
      watch(8.8, 1.0);
      // 10.00 — the tiger filter lands in pieces: ears drop onto heads, noses and whiskers stamp onto faces.
      tl.set($("S_-busy"), { opacity: 0 }, 10.0); tl.set($("S_-go2"), { opacity: 1 }, 10.0);
      tl.fromTo($("S_-btn"), { opacity: 0.4 }, { opacity: 1, duration: 0.15, immediateRender: false }, 10.0);
      A("tears").forEach((el, i) => {
        const t = 10.05 + i * 0.07;
        tl.fromTo(el, { opacity: 0, y: -400, scaleY: 1.5 }, { opacity: 1, y: 0, scaleY: 1, duration: 0.4, ease: E.out, immediateRender: false }, t);
      });
      A("tface").forEach((el, i) => {
        const t = 10.3 + i * 0.07;
        tl.fromTo(el, { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 0.9, duration: 0.18, ease: E.in, immediateRender: false }, t);
        tl.fromTo(el, { scale: 0.9 }, { scale: 1, duration: 0.35, ease: E.pop, immediateRender: false }, t + 0.18);
      });
      tl.set($("S_-g2"), { opacity: 0 }, 10.0);
      tl.set($("S_-g3"), { opacity: 1 }, 10.0);
      OH.pop(tl, $("S_-g3"), 10.0, { rot: 0, dur: 0.4 });
      OH.pop(tl, $("S_-call"), 10.9, { rot: 5 });
      curOut(11.0);
      // 12.20 — a roar: the crew leans in and springs back.
      tl.fromTo($("S_-crew"), { scale: 1 }, { scale: 1.08, duration: 0.15, ease: E.out, transformOrigin: "960px 700px", immediateRender: false }, 12.2);
      tl.fromTo($("S_-crew"), { scale: 1.08 }, { scale: 1, duration: 0.5, ease: E.pop, transformOrigin: "960px 700px", immediateRender: false }, 12.35);
      tl.fromTo($("S_-world"), { scale: 1 }, { scale: 1.04, duration: 14, ease: "none", immediateRender: false }, 0);
""", none=list(av_tile_centre(0)))))

# ── c08 · the group at the front only ───────────────────────────────────────────────────────────────────────────
s = "c08"
PASSER = ('<svg viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0;width:1920px;height:1080px"><g stroke="#1b1a1f" stroke-width="7" stroke-dasharray="{dash}">'
          '<g id="{id}a"><circle cx="0" cy="330" r="62" fill="#c9c4d6"/><path d="M-110 760 C-110 520 -60 440 0 430 C60 440 110 520 110 760Z" fill="#a9a2bd"/></g>'
          '<g id="{id}b"><circle cx="0" cy="350" r="58" fill="#d6cfbf"/><path d="M-100 760 C-100 530 -55 455 0 446 C55 455 100 530 100 760Z" fill="#b8ad97"/></g></g></svg>')
PEOPLE = ["Any", "1", "2", "3", "4", "5", "6"]
ppl = "".join(f'<div id="{s}-p{i}" class="pb" style="left:{40 + (i % 4) * 105}px;top:{96 + (i // 4) * 92}px">{n}</div>' for i, n in enumerate(PEOPLE))
SCENES2.append(dict(id=s, name="crew", dur=10.0, ground="#2fc59a", css=STAGE_CSS + HEAD_CSS + """
.rail.ppl { top: 481px; height: 300px; }
.pb { width: 85px; height: 72px; border-radius: 16px; box-shadow: inset 0 0 0 4px #e6e4e9; display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 700; color: #53515b; }
.pb.on { box-shadow: inset 0 0 0 5px #e1262f; color: #e1262f; }
.hd.sm { font-size: 84px; line-height: 120px; }
""", html=f"""
      <div id="{s}-hd" class="hd">Bring your crew.</div>
      <div id="{s}-hd2" class="hd sm">Anyone further back is left out.</div>
      {stage(s, [("b0", "assets/oh/backgrounds/space.svg", True)], extra='<div id="c08-pass" class="lay">' + PASSER.format(id="c08-x", dash="none") + '</div><div id="c08-ghost" class="lay" style="opacity:0">' + PASSER.format(id="c08-g", dash="14 14").replace('fill="#', 'fill-opacity="0.2" fill="#') + '</div>')}
      <div id="{s}-rail" class="rail ppl">
        <p class="r-label" style="top:36px">People</p>
        {ppl}
        <div id="{s}-on3" class="pb on" style="left:{40 + 3 * 105}px;top:96px;opacity:0">3</div>
      </div>
      <div id="{s}-badge" class="sticker" style="left:530px;top:962px">3 people in the photo</div>
      {CURSOR.format(s=s)}
""", js=J(s, "@cursor" + """
      tl.set([$("S_-hd2"), $("S_-badge")], { opacity: 0 }, 0);
      tl.fromTo([$("S_-stage"), $("S_-rail")], { x: -120 }, { x: 0, duration: 0.7, ease: E.back }, 0.0);
      OH.bounce(tl, $("S_-hd"), 0.2, { stagger: 0.035 });
      // Passers-by stroll across behind the group (far back, smaller).
      const walk = (id, x0, x1, t, d) => tl.fromTo($(id), { x: x0, y: 0 }, { x: x1, y: 0, duration: d, ease: "none", immediateRender: false }, t);
      walk("S_-xa", -300, 2300, 0, 5.5); walk("S_-xb", 2200, -300, 0, 6.5);
      // 2.10 — People: 3. The two at the back are cut away (they shrink into the background); a badge pops.
      curIn(1.2); mv([1900, 1100], [@px, @py], 1.2, 0.55);
      tl.fromTo($("S_-on3"), { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.pop, immediateRender: false }, 1.75);
      tl.fromTo($("S_-pass"), { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.85, duration: 0.35, ease: E.in, transformOrigin: "960px 400px", immediateRender: false }, 2.0);
      OH.pop(tl, $("S_-badge"), 2.2, { rot: -5 });
      curOut(2.6);
      // 3.60 — the rule, then a passer-by walks through again, only a dashed ghost: not in the photo.
      OH.flyOut(tl, $("S_-hd"), 3.5);
      tl.set($("S_-hd2"), { opacity: 1 }, 3.8);
      OH.bounce(tl, $("S_-hd2"), 3.8, { stagger: 0.025 });
      tl.set($("S_-ghost"), { opacity: 1 }, 4.3);
      walk("S_-ga", 2300, -300, 4.3, 4.2); walk("S_-gb", -400, 2300, 4.6, 4.6);
      // 6.40 — the crew squeezes together for the shot.
      tl.fromTo($("S_-crew"), { scaleX: 1 }, { scaleX: 0.94, duration: 0.25, ease: E.out, transformOrigin: "960px 1080px", immediateRender: false }, 6.4);
      tl.fromTo($("S_-crew"), { scaleX: 0.94 }, { scaleX: 1, duration: 0.5, ease: E.pop, transformOrigin: "960px 1080px", immediateRender: false }, 6.65);
      tl.fromTo($("S_-world"), { scale: 1 }, { scale: 1.04, duration: 10, ease: "none", immediateRender: false }, 0);
""", px=1330 + 40 + 3 * 105 + 42, py=481 + 96 + 36)))

# ── c09 · say cheese: the shutter, the booth's own 3·2·1, "Preparing your download…" ───────────────────────────
s = "c09"
SCENES2.append(dict(id=s, name="say-cheese", dur=9.0, ground="#1b1a1f", css=STAGE_CSS + HEAD_CSS + """
.rail.cap { top: 401px; height: 460px; }
.cap-t { left: 0; top: 40px; width: 480px; text-align: center; font-size: 40px; font-weight: 800; color: #17161a; }
.shut { left: 130px; top: 120px; width: 220px; height: 220px; border-radius: 50%; background: #e1262f; box-shadow: 0 0 0 12px #fff, 0 0 0 18px #e6e4e9, 0 18px 40px -10px rgba(225,38,47,0.6); display: flex; align-items: center; justify-content: center; transform-origin: 50% 50%; }
.cap-f { left: 0; top: 386px; width: 480px; text-align: center; font-size: 30px; color: #8b8993; white-space: nowrap; }
.cap-f b { color: #17161a; }
.timer { position: absolute; left: 1330px; top: 300px; height: 72px; padding: 0 30px; display: flex; align-items: center; gap: 14px; border-radius: 36px; background: #fff; box-shadow: 0 0 0 5px #1b1a1f; font-size: 34px; font-weight: 800; color: #17161a; }
.cd { position: absolute; left: 579px; top: 524px; width: 240px; height: 240px; border-radius: 50%; background: rgba(0,0,0,0.45); border: 3px solid rgba(255,255,255,0.25); z-index: 20; }
.cd span { position: absolute; left: 0; top: 0; width: 234px; height: 234px; display: flex; align-items: center; justify-content: center; font-size: 150px; font-weight: 500; color: #fff; }
.prep { position: absolute; left: 330px; top: 900px; height: 110px; padding: 0 48px; display: flex; align-items: center; gap: 22px; border-radius: 55px; background: #fff; box-shadow: 0 0 0 6px #1b1a1f, 10px 10px 0 6px #1b1a1f; font-size: 46px; font-weight: 800; white-space: nowrap; z-index: 25; }
.prep i { display: inline-block; width: 18px; height: 18px; border-radius: 50%; background: #1b1a1f; }
""", html=f"""
      <div id="{s}-hd" class="hd lt">Say cheese.</div>
      {stage(s, [("b0", "assets/v2/undersea.svg", True)], crew_extra=avatars(s, "crown") + avatars(s, "shades"))}
      <div id="{s}-timer" class="timer"><svg width="36" height="36" viewBox="0 0 256 256"><circle cx="128" cy="140" r="88" fill="none" stroke="#17161a" stroke-width="20"/><path d="M128 140 L128 92 M100 28 L156 28" stroke="#17161a" stroke-width="20" stroke-linecap="round"/></svg>3s</div>
      <div id="{s}-rail" class="rail cap">
        <p class="cap-t">Capture</p>
        <div id="{s}-shut" class="shut"><svg width="84" height="84" viewBox="0 0 256 256"><path fill="#fff" d="M208 56h-27.7l-13.6-20.4A8 8 0 0 0 160 32H96a8 8 0 0 0-6.7 3.6L75.7 56H48a24 24 0 0 0-24 24v112a24 24 0 0 0 24 24h160a24 24 0 0 0 24-24V80a24 24 0 0 0-24-24Zm-80 132a44 44 0 1 1 44-44 44 44 0 0 1-44 44Z"/></svg></div>
        <p class="cap-f">Frame: <b>Doodle</b></p>
      </div>
      <div id="{s}-cd" class="cd"><span id="{s}-n3">3</span><span id="{s}-n2">2</span><span id="{s}-n1">1</span></div>
      <div id="{s}-prep" class="prep">Preparing your download<i id="{s}-d1"></i><i id="{s}-d2"></i><i id="{s}-d3"></i></div>
      {CURSOR.format(s=s)}
""", js=J(s, "@cursor" + """
      tl.set([$("S_-cd"), $("S_-n3"), $("S_-n2"), $("S_-n1"), $("S_-prep")], { opacity: 0 }, 0);
      tl.fromTo([$("S_-stage"), $("S_-rail"), $("S_-timer")], { y: -80 }, { y: 0, duration: 0.7, ease: E.back }, 0.0);
      OH.bounce(tl, $("S_-hd"), 0.15, { stagger: 0.05 });
      // 1.40 — the big red shutter is clicked (countdown 3s, the default).
      curIn(0.8); mv([1900, 1100], [1570, 631], 0.8, 0.55);
      OH.press(tl, $("S_-shut"), 1.38);
      curOut(1.7);
      // 1.55 — 3 · 2 · 1 in the booth's dark disc (0.75 s a beat here); the crew winds up a little more each beat.
      tl.fromTo($("S_-cd"), { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.pop, immediateRender: false }, 1.55);
      ["3", "2", "1"].forEach((n, i) => {
        const t = 1.6 + i * 0.75, el = $("S_-n" + n);
        tl.fromTo(el, { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: E.snap, immediateRender: false }, t);
        tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.1, immediateRender: false }, t + 0.66);
        tl.fromTo($("S_-crew"), { scaleY: 1 - i * 0.02 }, { scaleY: 0.96 - i * 0.02, duration: 0.25, ease: E.out, transformOrigin: "960px 1080px", immediateRender: false }, t);
      });
      tl.fromTo($("S_-cd"), { opacity: 1 }, { opacity: 0, duration: 0.1, immediateRender: false }, 3.86);
      // 3.85 — snap: the crew springs up, the whole screen jolts like a shutter.
      tl.fromTo($("S_-crew"), { scaleY: 0.92, y: 0 }, { scaleY: 1, y: 0, duration: 0.5, ease: E.pop, transformOrigin: "960px 1080px", immediateRender: false }, 3.85);
      tl.fromTo($("S_-stage"), { scale: 1 }, { scale: 0.95, duration: 0.07, ease: E.in, immediateRender: false }, 3.85);
      tl.fromTo($("S_-stage"), { scale: 0.95 }, { scale: 1, duration: 0.45, ease: E.pop, immediateRender: false }, 3.92);
      // 4.40 — "Preparing your download…" with bouncing dots.
      OH.pop(tl, $("S_-prep"), 4.4, { rot: -4 });
      [1, 2, 3].forEach((k) => [0, 1].forEach((r) => {
        const t = 4.7 + r * 0.6 + k * 0.12;
        tl.fromTo($("S_-d" + k), { y: 0 }, { y: -18, duration: 0.15, ease: E.out, immediateRender: false }, t);
        tl.fromTo($("S_-d" + k), { y: -18 }, { y: 0, duration: 0.2, ease: E.drop, immediateRender: false }, t + 0.15);
      }));
      OH.unpop(tl, $("S_-prep"), 7.3);
      // 7.10 — the photo is thrown off to the right (whip, motion blur at speed); the QR screen catches it.
      tl.fromTo([$("S_-rail"), $("S_-timer"), $("S_-hd")], { opacity: 1 }, { opacity: 0, duration: 0.2, immediateRender: false }, 7.8);
      tl.fromTo($("S_-stage"), { x: 0, rotation: 0 }, { x: 2300, rotation: 18, duration: 0.9, ease: E.in, immediateRender: false }, 8.1);
      tl.fromTo($("S_-stage"), { filter: "blur(0px)" }, { filter: "blur(14px)", duration: 0.9, ease: E.in, immediateRender: false }, 8.1);
""")))

# ── c10 · the QR screen; a phone scans it ──────────────────────────────────────────────────────────────────────────
s = "c10"
SCENES2.append(dict(id=s, name="scan", dur=7.0, ground="#fff4e3", css="""
.qs { position: absolute; left: 180px; top: 130px; width: 1560px; height: 820px; border-radius: 36px; overflow: hidden; background: #f7f6f8; box-shadow: 0 0 0 6px #1b1a1f, 16px 16px 0 6px #1b1a1f; }
.qs-l { position: absolute; left: 0; top: 0; width: 1000px; height: 820px; background: #0b0a0c; }
.ph { position: absolute; left: 50px; top: 130px; width: 900px; height: 563px; border-radius: 20px; box-shadow: 0 24px 70px -16px rgba(0,0,0,0.6); }
.qs-r { position: absolute; left: 1000px; top: 0; width: 560px; height: 820px; box-shadow: inset 2px 0 0 #e6e4e9; }
.qs-r > * { position: absolute; }
.logo { left: 50px; top: 44px; height: 56px; }
.eb { left: 0; top: 150px; width: 560px; text-align: center; font-size: 28px; font-weight: 700; color: #5f5d68; white-space: nowrap; }
.ti { left: 0; top: 190px; width: 560px; text-align: center; font-size: 56px; font-weight: 800; letter-spacing: -0.02em; color: #17161a; white-space: nowrap; }
.ti i { font-style: normal; color: #e1262f; }
.qr { left: 120px; top: 290px; width: 320px; height: 320px; padding: 22px; background: #fff; border-radius: 24px; box-shadow: 0 10px 30px -10px rgba(11,10,12,0.25); }
.qr img { width: 276px; height: 276px; display: block; }
.ins { left: 0; top: 616px; width: 560px; text-align: center; font-size: 26px; line-height: 32px; color: #5f5d68; white-space: nowrap; }
.bt2 { top: 728px; width: 220px; height: 64px; border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; }
.phone { position: absolute; left: 1470px; top: 160px; width: 420px; height: 860px; border-radius: 64px; background: #1b1a1f; box-shadow: 12px 12px 0 rgba(27,26,31,0.25); transform-origin: 210px 430px; z-index: 30; }
.screen { position: absolute; left: 16px; top: 16px; width: 388px; height: 828px; border-radius: 50px; overflow: hidden; background: #2a2930; }
.screen .vq { position: absolute; left: 64px; top: 260px; width: 260px; height: 260px; background: #fff; padding: 16px; border-radius: 12px; }
.screen .vq img { width: 228px; height: 228px; display: block; }
.vf { position: absolute; width: 60px; height: 60px; border: 0 solid #ffd23f; }
.scan { position: absolute; left: 50px; top: 250px; width: 288px; height: 8px; border-radius: 4px; background: #ffd23f; }
.chip { position: absolute; left: 44px; top: 600px; width: 300px; height: 76px; border-radius: 38px; background: #ffd23f; display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 800; color: #1b1a1f; }
.white { position: absolute; left: 0; top: 0; width: 388px; height: 828px; background: #fff; opacity: 0; }
""", html=f"""
      <div id="{s}-qs" class="qs">
        <div class="qs-l"><img id="{s}-ph" class="ph" src="assets/v2/photo.png" alt=""></div>
        <div class="qs-r">
          <img class="logo" src="assets/oh/sp-dsac-logo.png" alt="">
          <p id="{s}-eb" class="eb">Your photo is ready</p>
          <p id="{s}-ti" class="ti">Scan to download<i>.</i></p>
          <div id="{s}-qr" class="qr"><img src="assets/oh/qr.svg" alt=""></div>
          <p class="ins">Opens a private download page.<br>Save it within 10 minutes: then<br>the photo is deleted from the booth.</p>
          <div class="bt2" style="left:50px;box-shadow:inset 0 0 0 3px #e6e4e9;color:#17161a">Retake</div>
          <div class="bt2" style="left:290px;background:#17161a;color:#fff">Done</div>
        </div>
      </div>
      <div id="{s}-phone" class="phone"><div class="screen">
        <div class="vq"><img src="assets/oh/qr.svg" alt=""></div>
        <i class="vf" style="left:40px;top:236px;border-top-width:8px;border-left-width:8px"></i><i class="vf" style="left:288px;top:236px;border-top-width:8px;border-right-width:8px"></i>
        <i class="vf" style="left:40px;top:484px;border-bottom-width:8px;border-left-width:8px"></i><i class="vf" style="left:288px;top:484px;border-bottom-width:8px;border-right-width:8px"></i>
        <i id="{s}-scan" class="scan"></i>
        <div id="{s}-chip" class="chip">Open link</div>
        <div id="{s}-white" class="white"></div>
      </div></div>
""", js=J(s, """
      tl.set([$("S_-chip"), $("S_-phone")], { opacity: 0 }, 0);
      // 0.00 — the photo whips in from the left (continuing c09's throw) and lands on the dark panel; the screen pops.
      tl.fromTo($("S_-qs"), { scale: 0.9 }, { scale: 1, duration: 0.5, ease: E.back }, 0.0);
      tl.fromTo($("S_-ph"), { x: -2000, rotation: -18, filter: "blur(14px)" }, { x: 0, rotation: 0, filter: "blur(0px)", duration: 0.75, ease: E.out }, 0.0);
      tl.fromTo($("S_-ph"), { scaleX: 1, scaleY: 1 }, { scaleX: 0.94, scaleY: 1.05, duration: 0.08, ease: E.out, immediateRender: false }, 0.5);
      tl.fromTo($("S_-ph"), { scaleX: 0.94, scaleY: 1.05 }, { scaleX: 1, scaleY: 1, duration: 0.4, ease: E.pop, immediateRender: false }, 0.58);
      OH.bounce(tl, $("S_-ti"), 0.5, { stagger: 0.03, y: 60 });
      tl.fromTo($("S_-qr"), { clipPath: "inset(0% 0% 100% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.6, ease: E.io }, 0.9);
      // 2.10 — a phone rises in front of the QR, its camera finds the code: the scan line sweeps, "Open link".
      tl.fromTo($("S_-qs"), { x: 0 }, { x: -220, duration: 0.7, ease: E.io, immediateRender: false }, 2.0);
      tl.fromTo($("S_-phone"), { opacity: 0, y: 900, rotation: 14 }, { opacity: 1, y: 0, rotation: -4, duration: 0.7, ease: E.out, immediateRender: false }, 2.1);
      [0, 1].forEach((k) => {
        tl.fromTo($("S_-scan"), { y: 0 }, { y: 270, duration: 0.45, ease: E.io, immediateRender: false }, 2.8 + k * 0.9);
        tl.fromTo($("S_-scan"), { y: 270 }, { y: 0, duration: 0.45, ease: E.io, immediateRender: false }, 3.25 + k * 0.9);
      });
      OH.pop(tl, $("S_-chip"), 3.9, { rot: -6 });
      tl.fromTo($("S_-chip"), { scale: 1 }, { scale: 0.9, duration: 0.07, ease: E.in, immediateRender: false }, 4.8);
      tl.fromTo($("S_-chip"), { scale: 0.9 }, { scale: 1, duration: 0.3, ease: E.pop, immediateRender: false }, 4.87);
      // 5.30 — the page opens white and the phone rushes at the camera until its screen fills the frame (→ c11).
      tl.fromTo($("S_-white"), { opacity: 0 }, { opacity: 1, duration: 0.25, immediateRender: false }, 5.3);
      tl.fromTo($("S_-phone"), { x: 0, y: 0, rotation: -4, scale: 1 }, { x: -720, y: 110, rotation: 0, scale: 5.6, duration: 1.4, ease: E.in, immediateRender: false }, 5.6);
""")))

# ── c11 · the phone: save it (the page has no caption section any more) ───────────────────────────────────────
s = "c11"
SCENES2.append(dict(id=s, name="phone", dur=7.0, ground="#59b6ff", css=HEAD_CSS + """
.phone { position: absolute; left: 720px; top: 30px; width: 480px; height: 1020px; border-radius: 70px; background: #1b1a1f; box-shadow: 14px 14px 0 rgba(27,26,31,0.3); transform-origin: 240px 510px; }
.screen { position: absolute; left: 16px; top: 16px; width: 448px; height: 988px; border-radius: 56px; overflow: hidden; background: #fff; color: #18181b; }
.screen > * { position: absolute; }
.bar { left: 0; top: 0; width: 448px; height: 80px; background: #f4f4f6; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 12px; font-size: 26px; color: #52525b; }
.band { left: 0; top: 80px; width: 448px; height: 300px; background: #0a0a0b; }
.band img { position: absolute; left: 14px; top: 16px; width: 420px; height: 263px; border-radius: 10px; }
.hdr { left: 0; top: 380px; width: 448px; height: 76px; border-bottom: 2px solid #e5e5e8; }
.hdr img { position: absolute; left: 22px; top: 16px; height: 44px; }
.eb { left: 22px; top: 488px; font-size: 26px; font-weight: 700; letter-spacing: 0.12em; color: #71717a; white-space: nowrap; }
.tt { left: 22px; top: 528px; font-size: 38px; font-weight: 800; letter-spacing: -0.02em; white-space: nowrap; }
.nt { left: 22px; top: 590px; font-size: 26px; line-height: 36px; color: #52525b; white-space: nowrap; }
.btn { left: 22px; top: 720px; width: 404px; height: 80px; border-radius: 14px; background: #18181b; color: #fff; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 28px; font-weight: 700; white-space: nowrap; transform-origin: 50% 50%; }
.ft { left: 0; top: 900px; width: 448px; height: 88px; border-top: 2px solid #ececee; padding: 24px 22px 0; font-size: 22px; color: #71717a; white-space: nowrap; }
.hd.r { left: 1020px; top: 380px; font-size: 150px; line-height: 160px; }
.sub { position: absolute; left: 1026px; top: 576px; font-size: 48px; line-height: 60px; font-weight: 800; color: #1b1a1f; white-space: nowrap; }
.finger { position: absolute; left: 0; top: 0; width: 84px; height: 84px; border-radius: 50%; background: rgba(27,26,31,0.18); border: 4px solid #fff; box-shadow: 0 0 0 3px #1b1a1f; opacity: 0; z-index: 40; transform-origin: 50% 50%; }
.ripple { position: absolute; left: 0; top: 0; width: 84px; height: 84px; border-radius: 50%; border: 5px solid #1b1a1f; opacity: 0; z-index: 39; transform-origin: 50% 50%; }
.cover { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: #fff; }
""", html=f"""
      <div id="{s}-phone" class="phone"><div class="screen">
        <div class="bar">trycloudflare.com</div>
        <div class="band"><img src="assets/v2/photo.png" alt=""></div>
        <div class="hdr"><img src="assets/oh/sp-dsac-logo.png" alt=""></div>
        <p class="eb">YOUR PHOTO</p>
        <p class="tt">Save your DSAC photo.</p>
        <p class="nt">Download your composed event<br>photo. Save it now: the booth<br>deletes it a few minutes after.</p>
        <div id="{s}-save" class="btn">⤓ Save photo</div>
        <p class="ft">Powered by SP Data Science and Analytics Centre</p>
      </div></div>
      <div id="{s}-h1" class="hd r">Save it.</div>
      <div id="{s}-h2" class="hd r">It’s yours.</div>
      <p id="{s}-s1" class="sub">Straight to your<br>camera roll.</p>
      <p id="{s}-s2" class="sub">No app. No sign-up.</p>
      <i id="{s}-rp" class="ripple"></i><i id="{s}-fg" class="finger"></i>
      <div id="{s}-cover" class="cover"></div>
""", js=J(s, """
      tl.set([$("S_-h1"), $("S_-h2"), $("S_-s1"), $("S_-s2")], { opacity: 0 }, 0);
      // 0.00 — continuing c10's rush: the frame is the phone's white page, which shrinks back into a phone.
      tl.fromTo($("S_-cover"), { opacity: 1 }, { opacity: 0, duration: 0.15, immediateRender: false }, 0.0);
      tl.fromTo($("S_-phone"), { scale: 5.6, x: 0 }, { scale: 1, x: 0, duration: 1.0, ease: E.out }, 0.0);
      // 1.00 — the phone slides left to make room for the words (speed-ramped glide).
      tl.fromTo($("S_-phone"), { x: 0, rotation: 0 }, { x: -420, rotation: -3, duration: 0.7, ease: E.whip, immediateRender: false }, 1.0);
      tl.set($("S_-h1"), { opacity: 1 }, 1.55); OH.bounce(tl, $("S_-h1"), 1.55, { stagger: 0.05 });
      tl.fromTo($("S_-s1"), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: E.back, immediateRender: false }, 1.95);
      // 2.30 — tap Save photo (phone moved −420: button centre ≈ (300 + 16 + 224, 30 + 16 + 760)).
      const F = $("S_-fg"), R = $("S_-rp");
      OH.tap(tl, F, R, [760, 1000], [540, 806], 2.3, { travel: 0.35 });
      tl.fromTo($("S_-save"), { scale: 1 }, { scale: 0.94, duration: 0.07, ease: E.in, immediateRender: false }, 2.65);
      tl.fromTo($("S_-save"), { scale: 0.94 }, { scale: 1, duration: 0.35, ease: E.pop, immediateRender: false }, 2.72);
      // 3.80 — the words swap: no app, no account, just the photo.
      OH.flyOut(tl, $("S_-h1"), 3.8);
      tl.fromTo($("S_-s1"), { opacity: 1 }, { opacity: 0, duration: 0.2, immediateRender: false }, 3.8);
      tl.set($("S_-h2"), { opacity: 1 }, 4.15); OH.bounce(tl, $("S_-h2"), 4.15, { stagger: 0.05 });
      tl.fromTo($("S_-s2"), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: E.back, immediateRender: false }, 4.6);
      OH.wobble(tl, $("S_-phone"), 4.8, 2.2, 3);
      tl.fromTo($("S_-world"), { scale: 1 }, { scale: 1.04, duration: 7, ease: "none", immediateRender: false }, 0);
""")))

# ── c12 · gone in ten minutes ─────────────────────────────────────────────────────────────────────────────────
s = "c12"
CONF = [(-1, -1), (1, -1), (-1, 1), (1, 1), (0, -1.3), (0, 1.3), (-1.3, 0), (1.3, 0), (-0.7, -1.2), (0.7, 1.2), (1.2, -0.6), (-1.2, 0.6)]
COLS = ["#ff4b3e", "#ffd23f", "#2fc59a", "#59b6ff", "#7a5cff", "#ff8fc1"]
SCENES2.append(dict(id=s, name="gone", dur=8.0, ground="#1b1a1f", css="""
.clk { position: absolute; left: 660px; top: 120px; width: 600px; height: 600px; }
.thumb { position: absolute; left: 790px; top: 250px; width: 340px; height: 340px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 8px #fff4e3; transform-origin: 50% 50%; }
.thumb img { position: absolute; left: -130px; top: 0; width: 544px; height: 340px; }
.mm { position: absolute; left: 0; top: 740px; width: 1920px; text-align: center; font-size: 120px; line-height: 120px; font-weight: 900; color: #ffd23f; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.ln { position: absolute; left: 0; top: 890px; width: 1920px; text-align: center; font-size: 76px; line-height: 90px; font-weight: 900; color: #fff4e3; letter-spacing: -0.03em; white-space: nowrap; }
.cf { position: absolute; left: 945px; top: 405px; width: 30px; height: 30px; border-radius: 6px; opacity: 0; }
""", html=f"""
      <svg id="{s}-clk" class="clk" viewBox="0 0 600 600"><circle cx="300" cy="300" r="270" fill="none" stroke="#3a3940" stroke-width="40"/><circle id="{s}-arc" cx="300" cy="300" r="270" fill="none" stroke="#ff4b3e" stroke-width="40" stroke-linecap="round" stroke-dasharray="1696" stroke-dashoffset="0" transform="rotate(-90 300 300)"/></svg>
      <div id="{s}-th" class="thumb"><img src="assets/v2/photo-sm.jpg" alt=""></div>
      {"".join(f'<i id="{s}-c{i}" class="cf" style="background:{COLS[i % 6]}"></i>' for i in range(len(CONF)))}
      <div id="{s}-mm" class="mm">10:00</div>
      <div id="{s}-l1" class="ln">Save it within 10 minutes…</div>
      <div id="{s}-l2" class="ln" style="top:480px;font-size:104px;line-height:120px">…then it’s deleted from the booth.</div>
""", js=J(s, """
      tl.set($("S_-l2"), { opacity: 0 }, 0);
      // 0.00 — the clock pops up with the photo in it; the first line bounces in.
      OH.pop(tl, [$("S_-clk"), $("S_-th")], 0.05, { stagger: 0.08, rot: -30 });
      OH.bounce(tl, $("S_-l1"), 0.35, { stagger: 0.025 });
      tl.fromTo($("S_-mm"), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.4, ease: E.back }, 0.3);
      // 1.00–3.60 — ten minutes run out on a ramp: it hangs at 10:00, then races to 0:00.
      const p = { s: 600 }, mm = $("S_-mm"), arc = $("S_-arc");
      const draw = () => { const v = Math.max(0, Math.round(p.s)); mm.textContent = Math.floor(v / 60) + ":" + String(v % 60).padStart(2, "0"); arc.setAttribute("stroke-dashoffset", String(1696 * (1 - p.s / 600))); };
      tl.fromTo(p, { s: 600 }, { s: 0, duration: 2.6, ease: OH.ramp([[0, 0], [0.25, 0.04], [1, 1]], [E.io, E.in]), onUpdate: draw, onStart: draw, immediateRender: false }, 1.0);
      // 3.65 — poof: the photo swells and vanishes; confetti flies out from where it was.
      tl.fromTo($("S_-th"), { scale: 1 }, { scale: 1.15, duration: 0.12, ease: E.out, immediateRender: false }, 3.6);
      tl.fromTo($("S_-th"), { scale: 1.15, opacity: 1 }, { scale: 0, opacity: 0, duration: 0.2, ease: E.in, immediateRender: false }, 3.72);
      @conf
      // 4.10 — the clock clears away and the second line takes the middle of the frame.
      OH.flyOut(tl, $("S_-l1"), 4.0);
      OH.unpop(tl, [$("S_-mm"), $("S_-clk")], 4.0, { stagger: 0.06 });
      tl.set($("S_-l2"), { opacity: 1 }, 4.35); OH.bounce(tl, $("S_-l2"), 4.35, { stagger: 0.025 });
      tl.fromTo($("S_-world"), { scale: 1 }, { scale: 1.05, duration: 8, ease: "none", immediateRender: false }, 0);
""", conf="\n      ".join(f'tl.fromTo($("{s}-c{i}"), {{ x: 0, y: 0, rotation: 0, opacity: 1, scale: 1 }}, {{ x: {dx * 360:.0f}, y: {dy * 300 + 180:.0f}, rotation: {(i % 2 * 2 - 1) * 300}, opacity: 0, scale: 0.6, duration: 0.9, ease: E.out, immediateRender: false }}, 3.78);' for i, (dx, dy) in enumerate(CONF)))))

# ── c13 · outro: come strike a pose ──────────────────────────────────────────────────────────────────────────────
s = "c13"
DD13 = [("star", "#ffd23f", 80, 360, 110, -10), ("hex", "#fff4e3", 1740, 380, 100, 12), ("spark", "#2fc59a", 1700, 620, 90, 0),
        ("dot", "#59b6ff", 140, 620, 70, 0), ("squig", "#1b1a1f", 300, 420, 90, 8), ("star", "#7a5cff", 1480, 440, 70, 18)]
SCENES2.append(dict(id=s, name="outro", dur=8.0, ground="#ff4b3e", css="""
.big { position: absolute; left: 0; top: 150px; width: 1920px; text-align: center; font-size: 190px; line-height: 200px; font-weight: 900; letter-spacing: -0.05em; color: #fff; -webkit-text-stroke: 12px #1b1a1f; paint-order: stroke fill; text-shadow: 10px 10px 0 #1b1a1f; white-space: nowrap; }
.pill { position: absolute; left: 0; top: 400px; width: 1920px; display: flex; justify-content: center; }
.pill span { height: 104px; padding: 0 54px; display: flex; align-items: center; border-radius: 52px; background: #ffd23f; box-shadow: 0 0 0 6px #1b1a1f, 10px 10px 0 6px #1b1a1f; font-size: 48px; font-weight: 900; color: #1b1a1f; white-space: nowrap; }
.crew { position: absolute; left: 360px; top: 560px; width: 1200px; height: 675px; transform-origin: 600px 675px; }
.crew img { position: absolute; left: 0; top: 0; width: 1200px; height: 675px; }
.crew .av { position: absolute; }
.logo { position: absolute; left: 610px; top: 380px; width: 700px; height: 320px; border-radius: 40px; background: #fff; box-shadow: 0 0 0 6px #1b1a1f, 14px 14px 0 6px #1b1a1f; display: flex; align-items: center; justify-content: center; }
.logo img { width: 560px; }
.dd { transform-origin: 50% 50%; }
""", html=f"""
      {"".join(doodle(s, i, *d) for i, d in enumerate(DD13))}
      <div id="{s}-big" class="big">Come strike a pose!</div>
      <div id="{s}-pill" class="pill"><span>Find the photo booth at Open House</span></div>
      <div id="{s}-crew" class="crew"><div style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(0.625);transform-origin:0 0"><img src="assets/v2/crew.svg" alt="" style="width:1920px;height:1080px">{avatars(s, "party")}</div></div>
      <div id="{s}-logo" class="logo"><img src="assets/oh/sp-dsac-logo.png" alt=""></div>
""", js=J(s, """
      tl.set($("S_-logo"), { opacity: 0 }, 0);
      // 0.00 — the line slams in; the pill springs up; the crew pops up from below in party hats; doodles burst.
      OH.slam(tl, $("S_-big"), 0.05, { from: 2.8, rot: -5, dur: 0.6 });
      tl.fromTo($("S_-pill"), { y: 200, opacity: 0, scaleY: 1.4 }, { y: 0, opacity: 1, scaleY: 1, duration: 0.55, ease: E.back }, 0.6);
      tl.fromTo($("S_-crew"), { y: 700 }, { y: 0, duration: 0.7, ease: E.back }, 0.9);
      const dd = Array.from(document.querySelectorAll('[data-composition-id="S_"] .dd'));
      OH.pop(tl, dd, 1.1, { stagger: 0.06 });
      dd.forEach((d, i) => tl.fromTo(d, { rotation: 0 }, { rotation: i % 2 ? 60 : -60, duration: 6, ease: "none", immediateRender: false }, 1.6));
      // 2.20 and 3.20 — the crew bounces to the beat; a wave runs through the line.
      [2.2, 3.2].forEach((t) => {
        tl.fromTo($("S_-crew"), { y: 0, scaleY: 1 }, { y: -50, scaleY: 1.04, duration: 0.18, ease: E.out, immediateRender: false }, t);
        tl.fromTo($("S_-crew"), { y: -50, scaleY: 1.04 }, { y: 0, scaleY: 1, duration: 0.3, ease: E.drop, immediateRender: false }, t + 0.18);
      });
      OH.split($("S_-big")).forEach((c, i) => {
        tl.fromTo(c, { y: 0 }, { y: -40, duration: 0.16, ease: E.out, immediateRender: false }, 2.6 + i * 0.03);
        tl.fromTo(c, { y: -40 }, { y: 0, duration: 0.4, ease: E.back, immediateRender: false }, 2.76 + i * 0.03);
      });
      // 4.60 — everything pops away except the logo, which pops in on its own sticker; 7.30 a plain fade.
      OH.unpop(tl, [$("S_-big"), $("S_-pill"), ...dd], 4.6, { stagger: 0.03 });
      tl.fromTo($("S_-crew"), { y: 0 }, { y: 800, duration: 0.5, ease: E.in, immediateRender: false }, 4.6);
      OH.pop(tl, $("S_-logo"), 5.0, { rot: -8, dur: 0.6 });
      tl.fromTo($("S_-logo"), { opacity: 1 }, { opacity: 0, duration: 0.6, ease: "none", immediateRender: false }, 7.3);
      tl.fromTo($("S_-ground"), { opacity: 1 }, { opacity: 0, duration: 0.6, ease: "none", immediateRender: false }, 7.3);
""")))
