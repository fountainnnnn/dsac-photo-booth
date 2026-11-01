"""Scene definitions for the Open House film v2 (written out by tools/gen.py).
Each scene: id, name, dur, ground, css (one rule per line, scoped automatically), html, js (timeline body).
Geometry is absolute 1920x1080 px. Shared booth geometry:
  Stage (the capture screen's camera + Doodle frame) 1180x738 at (110, 262); its photo window (types/frame.ts:
  x .07132 y .13249 w .8558 h .76998) is (84, 98) 1010x568 inside it = (194, 360) on screen; the camera artboard is
  1920x1080 at 0.526, so guest and avatar positions are artboard px (assets/v2/crew.svg notes).
  Rail (the capture screen's right-hand column) 480 wide at (1330, 262), 40 padding → content 1370–1770.
"""

HIDE = ' style="opacity:0"'

STAGE_CSS = """
.stage { position: absolute; left: 110px; top: 262px; width: 1180px; height: 738px; border-radius: 30px; overflow: hidden; background: #fff; box-shadow: 0 0 0 6px #1b1a1f, 16px 16px 0 6px #1b1a1f; transform-origin: 50% 60%; }
.cam { position: absolute; left: 84px; top: 98px; width: 1010px; height: 568px; overflow: hidden; background: #d8d4cc; }
.art { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform: scale(0.526); transform-origin: 0 0; }
.art .lay { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
.art .lay > img.full { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
.av { position: absolute; }
.frm { position: absolute; left: 0; top: 0; width: 1180px; height: 738px; }
.rail { position: absolute; left: 1330px; top: 262px; width: 480px; height: 738px; border-radius: 30px; overflow: hidden; background: #fff; box-shadow: 0 0 0 6px #1b1a1f, 16px 16px 0 6px #1b1a1f; transform-origin: 50% 50%; }
.rail > * { position: absolute; }
.r-label { left: 40px; font-size: 32px; line-height: 40px; font-weight: 700; color: #53515b; white-space: nowrap; }
.r-note { left: 40px; font-size: 28px; line-height: 36px; color: #5f5d68; white-space: nowrap; }
.r-input { left: 40px; width: 400px; height: 84px; padding: 0 20px; display: flex; align-items: center; border-radius: 22px; box-shadow: inset 0 0 0 3px #e6e4e9; font-size: 28px; white-space: nowrap; background: #fff; color: #17161a; }
.r-input .ph { color: #7d7b86; }
.r-btn { left: 40px; width: 400px; height: 84px; border-radius: 22px; background: #17161a; color: #fff; font-size: 30px; font-weight: 700; transform-origin: 50% 50%; }
.r-btn > span { position: absolute; left: 0; top: 0; width: 400px; height: 84px; display: flex; align-items: center; justify-content: center; white-space: nowrap; }
.caret { display: inline-block; width: 3px; height: 34px; margin-left: 2px; background: #17161a; border-radius: 2px; vertical-align: middle; }
.bt { position: absolute; width: 190px; height: 146px; border-radius: 22px; overflow: hidden; background: #fff; }
.bt img { position: absolute; left: 5px; top: 5px; width: 180px; height: 101px; border-radius: 16px; object-fit: cover; }
.bt span { position: absolute; left: 0; top: 106px; width: 190px; height: 40px; font-size: 28px; line-height: 40px; font-weight: 700; text-align: center; color: #53515b; white-space: nowrap; }
.at { position: absolute; width: 120px; height: 120px; border-radius: 22px; background: #fff; display: flex; align-items: center; justify-content: center; padding: 16px; }
.at img { max-width: 100%; max-height: 100%; object-fit: contain; }
.ring { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 6px solid #e1262f; border-radius: 22px; }
.cur { position: absolute; left: -5px; top: -3px; width: 52px; height: 72px; z-index: 60; transform-origin: 5px 3px; filter: drop-shadow(4px 5px 0 rgba(27,26,31,0.35)); }
.bub { position: absolute; padding: 0 40px; height: 100px; display: flex; align-items: center; background: #fff; border-radius: 50px; box-shadow: 0 0 0 6px #1b1a1f, 8px 8px 0 6px #1b1a1f; font-size: 52px; font-weight: 900; letter-spacing: -0.02em; white-space: nowrap; transform-origin: 20% 100%; }
"""

CURSOR = '<svg id="{s}-cur" class="cur" viewBox="0 0 32 44"><path d="M3 2 28 24 17 25 23 40 17 43 11 27 3 34Z" fill="#fff" stroke="#1b1a1f" stroke-width="2.6" stroke-linejoin="round"/></svg>'

CURSOR_JS = """
      const cur = $("{s}-cur");
      tl.set(cur, { opacity: 0 }, 0);
      const mv = (a, b, t, d = 0.45, click = true) => {
        tl.fromTo(cur, { x: a[0], y: a[1] }, { x: b[0], y: b[1], duration: d, ease: E.io, immediateRender: false }, t);
        if (click) { tl.fromTo(cur, { scale: 1 }, { scale: 0.78, duration: 0.07, ease: E.in, immediateRender: false }, t + d);
          tl.fromTo(cur, { scale: 0.78 }, { scale: 1, duration: 0.3, ease: E.back, immediateRender: false }, t + d + 0.08); }
        return t + d;
      };
      const curIn = (t) => tl.fromTo(cur, { opacity: 0 }, { opacity: 1, duration: 0.15, immediateRender: false }, t);
      const curOut = (t) => tl.fromTo(cur, { opacity: 1 }, { opacity: 0, duration: 0.2, immediateRender: false }, t);
"""

# Avatar art: (src, width, height, anchor, lift px, pivot x, pivot y) in camera-artboard px (from types/scene.ts sizes
# against an outer-eye span of ~104 px on these faces).
FACES = {"N": dict(eye=(560, 486), fh=(560, 404), lip=(560, 550), nose=(560, 520)),
         "R": dict(eye=(960, 452), fh=(960, 368), lip=(960, 526), nose=(960, 496)),
         "M": dict(eye=(1360, 492), fh=(1360, 412), lip=(1360, 554), nose=(1360, 526))}
AV = {
    "crown": ("assets/oh/avatars/crown.svg", 156, 104, "fh", -10, 0.5, 0.95),
    "shades": ("assets/oh/avatars/shades.svg", 182, 68, "eye", 0, 0.5, 0.42),
    "mous": ("assets/oh/avatars/moustache.svg", 88, 32, "lip", 0, 0.5, 0.4),
    "party": ("assets/oh/avatars/party-hat.svg", 114, 148, "fh", -16, 0.5, 1.0),
    "cat": ("assets/oh/avatars/cat-ears.svg", 229, 101, "fh", -10, 0.5, 0.85),
    "pirate": ("assets/v2/pirate-hat.svg", 230, 126, "fh", -18, 0.5, 0.9),
    "tears": ("assets/v2/tiger-ears.svg", 260, 99, "fh", -30, 0.5, 0.9),
    "tface": ("assets/v2/tiger-face.svg", 270, 169, "nose", 0, 0.5, 0.39),
}


def avatars(s, kind, faces="NRM"):
    """One <img> per face, ids {s}-{kind}-{N|R|M}, transform-origin at the pivot (so pops land on the face)."""
    src, w, h, anc, lift, px, py = AV[kind]
    out = []
    for f in faces:
        ax, ay = FACES[f][anc]
        ay += lift
        out.append(f'<img id="{s}-{kind}-{f}" class="av" src="{src}" alt="" style="left:{ax - w * px:.0f}px;top:{ay - h * py:.0f}px;width:{w}px;height:{h}px;transform-origin:{px * 100:.0f}% {py * 100:.0f}%">')
    return "".join(out)


def stage(s, bgs, extra="", crew_extra=""):
    """The capture screen's stage: background layers (list of (id, src, visible)), the crew with avatars, the frame."""
    layers = "".join(f'<div id="{s}-{bid}" class="lay"{"" if vis else HIDE}><img class="full" src="{src}" alt=""></div>' for bid, src, vis in bgs)
    return (f'<div id="{s}-stage" class="stage"><div class="cam"><div class="art">{layers}{extra}'
            f'<div id="{s}-crew" class="lay"><img class="full" src="assets/v2/crew.svg" alt="">{crew_extra}</div></div></div>'
            f'<img class="frm" src="assets/oh/frame-doodle.png" alt=""></div>')


def bg_tile(s, k, bid, label, src, on=False):
    x, y = 40 + (k % 2) * 210, 400 + (k // 2) * 160
    return (f'<div id="{s}-t-{bid}" class="bt" style="left:{x}px;top:{y}px"><img src="{src}" alt=""><span>{label}</span>'
            f'<i id="{s}-r-{bid}" class="ring"{"" if on else HIDE}></i></div>')


def bg_tile_centre(k):
    return (1330 + 40 + (k % 2) * 210 + 95, 262 + 400 + (k // 2) * 160 + 55)


def av_tile(s, k, aid, src, on=False, icon=None):
    x, y = 40 + (k % 3) * 140, 432 + (k // 3) * 140
    inner = icon or f'<img src="{src}" alt="">'
    return (f'<div id="{s}-t-{aid}" class="at" style="left:{x}px;top:{y}px">{inner}'
            f'<i id="{s}-r-{aid}" class="ring"{"" if on else HIDE}></i></div>')


def av_tile_centre(k):
    return (1330 + 40 + (k % 3) * 140 + 60, 262 + 432 + (k // 3) * 140 + 60)


PROHIBIT = '<svg viewBox="0 0 256 256" width="56" height="56"><circle cx="128" cy="128" r="96" fill="none" stroke="#a3a1ab" stroke-width="18"/><path d="M60 60 196 196" stroke="#a3a1ab" stroke-width="18" stroke-linecap="round"/></svg>'

DOODLES = {
    "star": '<svg viewBox="0 0 100 100"><path d="M50 6 61 38 95 38 67 58 78 92 50 71 22 92 33 58 5 38 39 38Z" fill="{c}" stroke="#1b1a1f" stroke-width="6" stroke-linejoin="round"/></svg>',
    "hex": '<svg viewBox="0 0 100 100"><path d="M50 6 89 28 89 72 50 94 11 72 11 28Z" fill="{c}" stroke="#1b1a1f" stroke-width="6" stroke-linejoin="round"/></svg>',
    "squig": '<svg viewBox="0 0 160 60"><path d="M8 40 C28 6 48 6 58 30 C68 54 88 54 98 30 C108 6 128 6 152 30" fill="none" stroke="{c}" stroke-width="12" stroke-linecap="round"/></svg>',
    "dot": '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="{c}" stroke="#1b1a1f" stroke-width="6"/></svg>',
    "spark": '<svg viewBox="0 0 100 100"><path d="M50 4 C54 40 60 46 96 50 C60 54 54 60 50 96 C46 60 40 54 4 50 C40 46 46 40 50 4Z" fill="{c}" stroke="#1b1a1f" stroke-width="5" stroke-linejoin="round"/></svg>',
}


def doodle(s, i, kind, c, x, y, size, rot=0):
    w = size * (1.6 if kind == "squig" else 1)
    h = size * (0.6 if kind == "squig" else 1)
    return f'<div id="{s}-d{i}" class="dd" style="position:absolute;left:{x}px;top:{y}px;width:{w:.0f}px;height:{h:.0f}px;transform:rotate({rot}deg)">{DOODLES[kind].format(c=c)}</div>'


SCENES = []

# ── c01 · cold open: a viewfinder, the booth's own 3·2·1, "SAY CHEESE!" ─────────────────────────────────────────────
s = "c01"
SCENES.append(dict(id=s, name="cold-open", dur=7.0, ground="#1b1a1f", css="""
.br { position: absolute; width: 150px; height: 150px; border: 0 solid #fff4e3; }
.num { position: absolute; left: 0; top: 300px; width: 1920px; text-align: center; font-size: 460px; line-height: 460px; font-weight: 900; color: #fff4e3; letter-spacing: -0.04em; transform-origin: 960px 230px; }
.rng { position: absolute; left: 760px; top: 340px; width: 400px; height: 400px; border-radius: 50%; border: 14px solid #ffd23f; opacity: 0; }
.rec { position: absolute; left: 560px; top: 300px; display: flex; align-items: center; gap: 16px; font-size: 40px; font-weight: 800; color: #fff4e3; letter-spacing: 0.08em; }
.rec i { width: 30px; height: 30px; border-radius: 50%; background: #ff4b3e; }
.say { position: absolute; left: 0; top: 420px; width: 1920px; text-align: center; font-size: 240px; line-height: 240px; font-weight: 900; letter-spacing: -0.045em; color: #ffd23f; }
""", html=f"""
      <div id="{s}-tl" class="br" style="left:510px;top:250px;border-top-width:16px;border-left-width:16px;border-top-left-radius:26px"></div>
      <div id="{s}-tr" class="br" style="left:1260px;top:250px;border-top-width:16px;border-right-width:16px;border-top-right-radius:26px"></div>
      <div id="{s}-bl" class="br" style="left:510px;top:680px;border-bottom-width:16px;border-left-width:16px;border-bottom-left-radius:26px"></div>
      <div id="{s}-brr" class="br" style="left:1260px;top:680px;border-bottom-width:16px;border-right-width:16px;border-bottom-right-radius:26px"></div>
      <div id="{s}-rec" class="rec"><i id="{s}-dot"></i>REC</div>
      <div id="{s}-r3" class="rng"></div><div id="{s}-r2" class="rng"></div><div id="{s}-r1" class="rng"></div>
      <div id="{s}-n3" class="num">3</div><div id="{s}-n2" class="num">2</div><div id="{s}-n1" class="num">1</div>
      <div id="{s}-say" class="say">SAY CHEESE!</div>
""", js=f"""
      const B = [["{s}-tl", -420, -260], ["{s}-tr", 420, -260], ["{s}-bl", -420, 260], ["{s}-brr", 420, 260]];
      // 0.00 — the viewfinder snaps in from the frame's corners (already moving on frame 0).
      B.forEach(([id, dx, dy], i) => tl.fromTo($(id), {{ x: dx, y: dy, rotation: i % 2 ? 12 : -12 }}, {{ x: 0, y: 0, rotation: 0, duration: 0.7, ease: E.snap }}, 0));
      // REC blinks.
      for (let k = 0; k < 6; k++) tl.set($("{s}-dot"), {{ opacity: k % 2 ? 1 : 0.15 }}, 0.5 + k * 0.5);
      // 0.55 · 1.45 · 2.35 — the countdown slams in, one number per beat, a ring bursts off each; the viewfinder flinches.
      ["3", "2", "1"].forEach((n, i) => {{
        const t = 0.55 + i * 0.9, el = $("{s}-n" + n);
        OH.slam(tl, el, t, {{ from: 2.6, rot: i % 2 ? 8 : -8, dur: 0.42 }});
        tl.fromTo(el, {{ scale: 1, opacity: 1 }}, {{ scale: 0, opacity: 0, duration: 0.2, ease: E.in, immediateRender: false }}, t + 0.66);
        tl.fromTo($("{s}-r" + n), {{ scale: 0.3, opacity: 1 }}, {{ scale: 2.4, opacity: 0, duration: 0.7, ease: E.out, immediateRender: false }}, t + 0.18);
        B.forEach(([id, dx, dy]) => {{
          tl.fromTo($(id), {{ x: 0, y: 0 }}, {{ x: -dx * 0.06, y: -dy * 0.06, duration: 0.1, ease: E.in, immediateRender: false }}, t + 0.18);
          tl.fromTo($(id), {{ x: -dx * 0.06, y: -dy * 0.06 }}, {{ x: 0, y: 0, duration: 0.4, ease: E.back, immediateRender: false }}, t + 0.28);
        }});
      }});
      // 3.30 — the viewfinder throws open wide and "SAY CHEESE!" bounces up letter by letter.
      B.forEach(([id, dx, dy]) => tl.fromTo($(id), {{ x: 0, y: 0 }}, {{ x: dx * 0.62, y: dy * 0.55, duration: 0.5, ease: E.snap, immediateRender: false }}, 3.2));
      tl.fromTo($("{s}-rec"), {{ x: 0, y: 0 }}, {{ x: -260, y: -140, duration: 0.5, ease: E.snap, immediateRender: false }}, 3.2);
      OH.bounce(tl, $("{s}-say"), 3.35, {{ stagger: 0.045, dur: 0.5 }});
      // 4.90 — a wave runs through the letters.
      OH.split($("{s}-say")).forEach((c, i) => {{
        tl.fromTo(c, {{ y: 0 }}, {{ y: -46, duration: 0.18, ease: E.out, immediateRender: false }}, 4.9 + i * 0.04);
        tl.fromTo(c, {{ y: -46 }}, {{ y: 0, duration: 0.4, ease: E.back, immediateRender: false }}, 5.08 + i * 0.04);
      }});
      // 6.00 — the whole frame rushes at the camera as the lens closes (iris at 7.0).
      tl.fromTo($("{s}-world"), {{ scale: 1 }}, {{ scale: 1.35, duration: 1.0, ease: E.in, immediateRender: false }}, 6.0);
"""))

# ── c02 · title: OPEN HOUSE / PHOTO BOOTH ──────────────────────────────────────────────────────────────────────────────
s = "c02"
DD2 = [("star", "#ff4b3e", 190, 150, 130, -12), ("hex", "#12817b", 1600, 120, 120, 8), ("squig", "#1b1a1f", 1500, 820, 110, -10),
       ("dot", "#59b6ff", 260, 760, 90, 0), ("spark", "#fff4e3", 1730, 720, 110, 0), ("hex", "#ff8fc1", 110, 470, 80, 20),
       ("star", "#2fc59a", 1420, 110, 80, 14), ("spark", "#7a5cff", 470, 120, 80, 0)]
SCENES.append(dict(id=s, name="title", dur=7.0, ground="#ffd23f", css="""
.t1 { position: absolute; left: 0; top: 250px; width: 1920px; text-align: center; font-size: 250px; line-height: 250px; font-weight: 900; letter-spacing: -0.05em; color: #ff4b3e; text-shadow: 10px 10px 0 #1b1a1f; transform-origin: 960px 125px; }
.t2 { position: absolute; left: 0; top: 520px; width: 1920px; text-align: center; font-size: 250px; line-height: 250px; font-weight: 900; letter-spacing: -0.05em; color: #fff; -webkit-text-stroke: 14px #1b1a1f; paint-order: stroke fill; text-shadow: 10px 10px 0 #1b1a1f; transform-origin: 960px 125px; }
.by { position: absolute; left: 0; top: 858px; width: 1920px; display: flex; justify-content: center; }
.by span { height: 84px; padding: 0 44px; display: flex; align-items: center; border-radius: 42px; background: #1b1a1f; color: #fff4e3; font-size: 38px; font-weight: 800; white-space: nowrap; }
.dd { transform-origin: 50% 50%; }
""", html=f"""
      <div id="{s}-t1" class="t1">OPEN HOUSE</div>
      <div id="{s}-t2" class="t2">PHOTO BOOTH</div>
      <div id="{s}-by" class="by"><span>by SP Data Science &amp; Analytics Centre</span></div>
      {"".join(doodle(s, i, *d) for i, d in enumerate(DD2))}
""", js=f"""
      // 0.05 / 0.40 — both lines slam down from the camera (hold, then snap) while the lens opens.
      OH.slam(tl, $("{s}-t1"), 0.05, {{ from: 3.2, rot: -7, dur: 0.6 }});
      OH.slam(tl, $("{s}-t2"), 0.4, {{ from: 3.2, rot: 6, dur: 0.6 }});
      // 0.95 — doodles pop around them, then keep turning slowly.
      const dd = Array.from(document.querySelectorAll('[data-composition-id="{s}"] .dd'));
      OH.pop(tl, dd, 0.95, {{ stagger: 0.06, dur: 0.5 }});
      dd.forEach((d, i) => tl.fromTo(d, {{ rotation: 0 }}, {{ rotation: i % 2 ? 50 : -50, duration: 5, ease: "none", immediateRender: false }}, 1.5));
      // 1.70 — the credit line springs up from below.
      tl.fromTo($("{s}-by"), {{ y: 220, scaleY: 1.4, opacity: 0 }}, {{ y: 0, scaleY: 1, opacity: 1, duration: 0.55, ease: E.back }}, 1.7);
      // 2.60 / 3.30 — a wave runs through each line.
      [["{s}-t1", 2.6], ["{s}-t2", 3.3]].forEach(([id, t]) => OH.split($(id)).forEach((c, i) => {{
        tl.fromTo(c, {{ y: 0, scaleY: 1 }}, {{ y: -60, scaleY: 1.12, duration: 0.18, ease: E.out, immediateRender: false }}, t + i * 0.035);
        tl.fromTo(c, {{ y: -60, scaleY: 1.12 }}, {{ y: 0, scaleY: 1, duration: 0.45, ease: E.back, immediateRender: false }}, t + 0.18 + i * 0.035);
      }}));
      // 4.80 — the title squashes and springs (a beat on the music), then drifts toward the stripes.
      [["{s}-t1"], ["{s}-t2"]].forEach(([id], k) => {{
        tl.fromTo($(id), {{ scaleX: 1, scaleY: 1 }}, {{ scaleX: 1.06, scaleY: 0.86, duration: 0.1, ease: E.in, immediateRender: false }}, 4.8 + k * 0.08);
        tl.fromTo($(id), {{ scaleX: 1.06, scaleY: 0.86 }}, {{ scaleX: 1, scaleY: 1, duration: 0.5, ease: E.pop, immediateRender: false }}, 4.9 + k * 0.08);
      }});
      tl.fromTo($("{s}-world"), {{ scale: 1 }}, {{ scale: 1.06, duration: 7, ease: "none", immediateRender: false }}, 0);
"""))

# ── c03 · how it works: four cards drop in ──────────────────────────────────────────────────────────────────────────
s = "c03"
ICONS = [
    '<svg viewBox="0 0 160 120"><rect x="6" y="6" width="148" height="108" rx="16" fill="#59b6ff" stroke="#1b1a1f" stroke-width="7"/><circle cx="118" cy="38" r="14" fill="#ffd23f" stroke="#1b1a1f" stroke-width="6"/><path d="M10 100 L58 48 L90 82 L108 64 L150 104 L150 108 L10 108Z" fill="#2fc59a" stroke="#1b1a1f" stroke-width="7" stroke-linejoin="round"/></svg>',
    '<svg viewBox="0 0 160 120"><path d="M14 104 L22 22 L58 62 L80 10 L102 62 L138 22 L146 104Z" fill="#ffd23f" stroke="#1b1a1f" stroke-width="7" stroke-linejoin="round"/><circle cx="80" cy="74" r="10" fill="#ff4b3e" stroke="#1b1a1f" stroke-width="5"/></svg>',
    '<svg viewBox="0 0 160 120"><rect x="8" y="24" width="144" height="90" rx="18" fill="#1b1a1f"/><rect x="50" y="8" width="60" height="26" rx="8" fill="#1b1a1f"/><circle cx="80" cy="68" r="30" fill="#fff4e3" stroke="#ff4b3e" stroke-width="10"/><circle cx="130" cy="44" r="7" fill="#ffd23f"/></svg>',
    '<svg viewBox="0 0 160 120"><rect x="44" y="4" width="72" height="112" rx="14" fill="#fff" stroke="#1b1a1f" stroke-width="7"/><g fill="#1b1a1f"><rect x="56" y="22" width="18" height="18"/><rect x="86" y="22" width="18" height="18"/><rect x="56" y="52" width="18" height="18"/><rect x="80" y="48" width="8" height="8"/><rect x="94" y="58" width="10" height="10"/><rect x="70" y="76" width="22" height="8"/></g><rect x="64" y="96" width="32" height="8" rx="4" fill="#ff4b3e"/></svg>',
]
CARDS = [("1", "#ff4b3e", "Pick a<br>place"), ("2", "#ffd23f", "Wear<br>something silly"), ("3", "#2fc59a", "Strike<br>a pose"), ("4", "#59b6ff", "Scan it,<br>take it home")]
SCENES.append(dict(id=s, name="how", dur=10.0, ground="#fff4e3", css="""
.hd { position: absolute; left: 0; top: 96px; width: 1920px; text-align: center; font-size: 104px; line-height: 110px; font-weight: 900; letter-spacing: -0.04em; color: #1b1a1f; }
.cd { position: absolute; top: 330px; width: 380px; height: 500px; background: #fff; border-radius: 40px; box-shadow: 0 0 0 6px #1b1a1f, 14px 14px 0 6px #1b1a1f; transform-origin: 50% 100%; }
.cd .n { position: absolute; left: 140px; top: 36px; width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 60px; font-weight: 900; color: #1b1a1f; box-shadow: 0 0 0 6px #1b1a1f; }
.cd .ic { position: absolute; left: 90px; top: 170px; width: 200px; height: 150px; transform-origin: 50% 50%; }
.cd .lb { position: absolute; left: 0; top: 352px; width: 380px; text-align: center; font-size: 46px; line-height: 52px; font-weight: 800; letter-spacing: -0.02em; white-space: nowrap; }
.path { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
""", html=f"""
      <div id="{s}-hd" class="hd">Here’s the deal.</div>
      <svg id="{s}-path" class="path" viewBox="0 0 1920 1080"><path d="M300 900 C500 1000 700 860 960 940 C1220 1020 1420 880 1620 940" fill="none" stroke="#1b1a1f" stroke-width="8" stroke-dasharray="4 26" stroke-linecap="round"/></svg>
      {"".join(f'<div id="{s}-c{i}" class="cd" style="left:{130 + i * 430}px"><div class="n" style="background:{c}">{n}</div><div id="{s}-i{i}" class="ic">{ICONS[i]}</div><div class="lb">{lb}</div></div>' for i, (n, c, lb) in enumerate(CARDS))}
""", js=f"""
      // 0.00 — the heading bounces in as the stripes clear.
      OH.bounce(tl, $("{s}-hd"), 0.05, {{ stagger: 0.03 }});
      // 0.50 + 0.30 i — each card falls in under gravity, squashes on landing, springs back.
      const rot = [-9, 7, -6, 8];
      [0, 1, 2, 3].forEach((i) => {{
        const c = $("{s}-c" + i), t = 0.5 + i * 0.3;
        tl.fromTo(c, {{ y: -1000, rotation: rot[i] * 2 }}, {{ y: 0, rotation: rot[i] * 0.3, duration: 0.5, ease: E.drop }}, t);
        tl.fromTo(c, {{ scaleX: 1, scaleY: 1 }}, {{ scaleX: 1.12, scaleY: 0.84, duration: 0.08, ease: E.out, immediateRender: false }}, t + 0.5);
        tl.fromTo(c, {{ scaleX: 1.12, scaleY: 0.84, rotation: rot[i] * 0.3 }}, {{ scaleX: 1, scaleY: 1, rotation: rot[i] * 0.15, duration: 0.5, ease: E.back, immediateRender: false }}, t + 0.58);
      }});
      // 1.90 — the dotted trail draws under them, left to right.
      tl.fromTo($("{s}-path"), {{ clipPath: "inset(0 100% 0 0)" }}, {{ clipPath: "inset(0 0% 0 0)", duration: 1.1, ease: E.io }}, 1.9);
      // 3.10 and 6.00 — a hop runs along the row, each icon spinning once on the way up.
      [3.1, 6.0].forEach((t0) => [0, 1, 2, 3].forEach((i) => {{
        const c = $("{s}-c" + i), ic = $("{s}-i" + i), t = t0 + i * 0.22;
        tl.fromTo(c, {{ y: 0 }}, {{ y: -60, duration: 0.2, ease: E.out, immediateRender: false }}, t);
        tl.fromTo(c, {{ y: -60 }}, {{ y: 0, duration: 0.3, ease: E.drop, immediateRender: false }}, t + 0.2);
        tl.fromTo(c, {{ scaleX: 1, scaleY: 1 }}, {{ scaleX: 1.08, scaleY: 0.9, duration: 0.07, ease: E.out, immediateRender: false }}, t + 0.5);
        tl.fromTo(c, {{ scaleX: 1.08, scaleY: 0.9 }}, {{ scaleX: 1, scaleY: 1, duration: 0.35, ease: E.back, immediateRender: false }}, t + 0.57);
        tl.fromTo(ic, {{ rotation: 0 }}, {{ rotation: 360, duration: 0.55, ease: E.io, immediateRender: false }}, t);
      }}));
      // 7.90 — card 1 swells; the sky pours out of it (blob into c04 from its centre).
      tl.fromTo($("{s}-c0"), {{ scale: 1 }}, {{ scale: 1.14, duration: 0.6, ease: E.back, immediateRender: false }}, 8.8);
      tl.fromTo($("{s}-world"), {{ scale: 1 }}, {{ scale: 1.04, duration: 10, ease: "none", immediateRender: false }}, 0);
"""))

# ── c04 · pick a place: the four ready-made backgrounds ────────────────────────────────────────────────────────────
s = "c04"
BG4 = [("b0", "assets/oh/backgrounds/studio.svg", True), ("b1", "assets/oh/backgrounds/sunset.svg", False),
       ("b2", "assets/oh/backgrounds/space.svg", False), ("b3", "assets/oh/backgrounds/neon.svg", False)]
T4 = [("studio", "Studio", "assets/oh/backgrounds/studio.svg"), ("sunset", "Sunset", "assets/oh/backgrounds/sunset.svg"),
      ("space", "Space", "assets/oh/backgrounds/space.svg"), ("neon", "Neon", "assets/oh/backgrounds/neon.svg")]
SCENES.append(dict(id=s, name="places", dur=8.0, ground="#59b6ff", css=STAGE_CSS + """
.hd { position: absolute; left: 110px; top: 92px; font-size: 112px; line-height: 120px; font-weight: 900; letter-spacing: -0.045em; color: #1b1a1f; white-space: nowrap; }
.nm { position: absolute; left: 0; top: 0; width: 340px; height: 100px; line-height: 100px; text-align: center; opacity: 0; }
.hd2 { position: absolute; left: 110px; top: 92px; font-size: 112px; line-height: 120px; font-weight: 900; letter-spacing: -0.045em; color: #fff; -webkit-text-stroke: 10px #1b1a1f; paint-order: stroke fill; white-space: nowrap; }
""", html=f"""
      <div id="{s}-hd" class="hd">Pick a place.</div>
      {stage(s, BG4)}
      <div id="{s}-rail" class="rail">
        <p class="r-label" style="top:36px">Background</p>
        <div class="r-input" style="top:92px"><span class="ph">Where do you want to be?</span></div>
        <div class="r-btn" style="top:196px;opacity:0.4"><span>Make it</span></div>
        <p class="r-note" style="top:300px">What you type is sent to<br>an online image service.</p>
        {"".join(bg_tile(s, k, bid, lb, src, k == 0) for k, (bid, lb, src) in enumerate(T4))}
      </div>
      <div id="{s}-bub" class="bub" style="left:930px;top:196px;width:340px;padding:0"><span id="{s}-nb1" class="nm">Sunset!</span><span id="{s}-nb2" class="nm">Space!</span><span id="{s}-nb3" class="nm">Neon!</span></div>
      <div id="{s}-hd2" class="hd2">Four, ready to go.</div>
      {CURSOR.format(s=s)}
""", js=CURSOR_JS.replace("{s}", s) + f"""
      // 0.05 — the booth screen is thrown up into frame and the rail slides in after it (speed-ramped: fast, then a
      // long soft landing, a little tilt left over).
      tl.fromTo($("{s}-stage"), {{ y: 900, rotation: -10 }}, {{ y: 0, rotation: -1.5, duration: 0.9, ease: E.out }}, 0.05);
      tl.fromTo($("{s}-rail"), {{ x: 760, rotation: 12 }}, {{ x: 0, rotation: 1.5, duration: 0.9, ease: E.out }}, 0.25);
      OH.bounce(tl, $("{s}-hd"), 0.45, {{ stagger: 0.04 }});
      tl.set($("{s}-bub"), {{ opacity: 0 }}, 0);
      // Clicks: Sunset 2.0 · Space 3.2 · Neon 4.4. Each new place deals in from the right like a card
      // (crawl, whip, settle), the guests hop, the name pops in a speech bubble.
      const T = {{ studio: {bg_tile_centre(0)}, sunset: {bg_tile_centre(1)}, space: {bg_tile_centre(2)}, neon: {bg_tile_centre(3)} }};
      curIn(1.45);
      mv([1900, 1120], T.sunset, 1.45, 0.55);
      mv(T.sunset, T.space, 2.75, 0.45);
      mv(T.space, T.neon, 3.95, 0.45);
      tl.fromTo(cur, {{ x: T.neon[0], y: T.neon[1] }}, {{ x: 1900, y: 1150, duration: 0.6, ease: E.in, immediateRender: false }}, 5.0);
      const seq = [["sunset", "b1", 2.0, "nb1"], ["space", "b2", 3.2, "nb2"], ["neon", "b3", 4.4, "nb3"]];
      let prev = "studio", prevB = "b0";
      seq.forEach(([tid, bid, t, label]) => {{
        tl.fromTo($("{s}-r-" + prev), {{ opacity: 1 }}, {{ opacity: 0, duration: 0.08, immediateRender: false }}, t);
        tl.fromTo($("{s}-r-" + tid), {{ opacity: 0, scale: 0.8 }}, {{ opacity: 1, scale: 1, duration: 0.35, ease: E.pop, immediateRender: false }}, t);
        tl.set($("{s}-" + bid), {{ opacity: 1 }}, t + 0.02);
        tl.fromTo($("{s}-" + bid), {{ x: 1920, rotation: 6 }}, {{ x: 0, rotation: 0, duration: 0.5, ease: E.whip, immediateRender: false }}, t + 0.02);
        tl.fromTo($("{s}-" + prevB), {{ x: 0, scale: 1 }}, {{ x: -700, scale: 0.9, duration: 0.5, ease: E.whip, immediateRender: false }}, t + 0.02);
        tl.fromTo($("{s}-crew"), {{ y: 0 }}, {{ y: -70, duration: 0.18, ease: E.out, immediateRender: false }}, t + 0.3);
        tl.fromTo($("{s}-crew"), {{ y: -70 }}, {{ y: 0, duration: 0.3, ease: E.drop, immediateRender: false }}, t + 0.48);
        tl.set($("{s}-" + label), {{ opacity: 1 }}, t + 0.25); tl.set($("{s}-" + label), {{ opacity: 0 }}, t + 1.2);
        tl.fromTo($("{s}-bub"), {{ opacity: 0, scale: 0.2, rotation: -16 }}, {{ opacity: 1, scale: 1, rotation: -4, duration: 0.45, ease: E.pop, immediateRender: false }}, t + 0.25);
        tl.fromTo($("{s}-bub"), {{ opacity: 1, scale: 1 }}, {{ opacity: 0, scale: 0.6, duration: 0.18, ease: E.in, immediateRender: false }}, t + 0.98);
        prev = tid; prevB = bid;
      }});
      // 5.60 — the headline swaps: its letters fly off, the next line bounces up in the same place.
      OH.flyOut(tl, $("{s}-hd"), 5.6);
      OH.bounce(tl, $("{s}-hd2"), 5.95, {{ stagger: 0.035 }});
      tl.fromTo($("{s}-world"), {{ scale: 1 }}, {{ scale: 1.05, duration: 8, ease: "none", immediateRender: false }}, 0);
"""))
