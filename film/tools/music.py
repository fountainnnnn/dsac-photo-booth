#!/usr/bin/env python3
"""Synthesise a launch film's music bed, built to the edit.

    python3 tools/music.py            # writes scenes.json music.src (48 kHz stereo WAV)

120 BPM, 4/4 (beat 0.5 s, bar 2.0 s), G major, a four-bar loop | Gmaj7 | Em9 | Cmaj7 | D6/9 |.
Sections come from scenes.json music.sections, so the arrangement follows the cut:
  "shaker": "s02"                                  a light shaker from this scene until the drop (optional)
  "drop":   "s05"  or {"scene": "s05", "at": 0}    the groove eases in with the product (keep it on an even second)
  "break":  {"scene": "s10", "from": 0.5, "to": 2.5}  drums and bass drop out, back on the downbeat (optional)
  "outro":  {"scene": "s15", "at": 2.0}            drums stop, the last chord rings out and fades (the end logo)
  intro 0 → drop is a soft pad + plucked arpeggio whose filter opens. "bpm" (default 120) sets the grid.
No whooshes, risers or impacts: the only transients are the drum kit, mixed under the picture.
"""
import json, os
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
cfg = json.load(open(os.path.join(ROOT, "scenes.json")))
MUS = cfg.get("music", {})
BPM = float(MUS.get("bpm", 120))
BEAT = 60.0 / BPM
BAR = 4 * BEAT

starts, t = {}, 0.0
for i, s in enumerate(cfg["scenes"]):
    if i > 0:
        t -= (s.get("in") or {}).get("dur", 0)      # transitions overlap the scenes they join (build.mjs)
    starts[s["id"]] = t
    t += s["duration"]
TOTAL = t


def anchor(spec, key="at", default=0.0):
    """A section time: "sNN" (scene start) or {"scene": "sNN", "at": seconds into it}. None when absent or when
    the scene is not in the cut yet (the section is then skipped)."""
    if spec is None:
        return None
    sid = spec if isinstance(spec, str) else spec.get("scene")
    if sid not in starts:
        print(f"note: music section scene {sid!r} is not in scenes.json; skipping it")
        return None
    return starts[sid] + (0.0 if isinstance(spec, str) else float(spec.get(key, default)))


SEC = MUS.get("sections", {})
DROP = anchor(SEC.get("drop"))
if DROP is None:
    DROP = round(TOTAL * 0.25 / BAR) * BAR          # a quarter in, on a bar line
BREAK_A, BREAK_B = anchor(SEC.get("break"), "from", 0.0), anchor(SEC.get("break"), "to", 2 * BAR)
if BREAK_A is None or BREAK_B is None:
    BREAK_A = BREAK_B = TOTAL + 10                   # no break
OUTRO = anchor(SEC.get("outro"))
if OUTRO is None:
    OUTRO = max(DROP + BAR, TOTAL - 2.5)
PILE = anchor(SEC.get("shaker"))
if PILE is None:
    PILE = DROP                                      # no shaker
# The bar grid is anchored on the drop, so the groove always arrives on a downbeat whatever the scene lengths.
# Put the break's end and the outro on bars too (a whole number of 2.0s bars from the drop at 120 BPM).
G0 = DROP % BAR

N = int(np.ceil((TOTAL + 0.5) * SR))
tt = np.arange(N) / SR


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def onepole_lp(x, fc):
    """One-pole low-pass; fc may be an array (time-varying)."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    # vectorised in blocks of constant coefficient for speed
    blk = 256
    for i in range(0, len(x), blk):
        ai = a[i]
        seg = x[i:i + blk]
        out = np.empty_like(seg)
        for j in range(len(seg)):
            acc = (1 - ai) * seg[j] + ai * acc
            out[j] = acc
        y[i:i + blk] = out
    return y


def lp_fft(x, fc):
    """Static brick-ish low-pass via FFT with a smooth roll-off (fast)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1.0 / np.sqrt(1 + (f / fc) ** 4)
    return np.fft.irfft(X * H, len(x))


def hp_fft(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1.0 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** 4)
    return np.fft.irfft(X * H, len(x))


def bp_fft(x, lo, hi):
    return hp_fft(lp_fft(x, hi), lo)


def env_adsr(n, a, d, s, r, hold):
    """ADSR in samples: attack a, decay d to level s, hold, release r (seconds)."""
    A, D, H, R = int(a * SR), int(d * SR), int(hold * SR), int(r * SR)
    e = np.concatenate([np.linspace(0, 1, max(A, 1), endpoint=False), np.linspace(1, s, max(D, 1), endpoint=False),
                        np.full(max(H, 0), s), np.linspace(s, 0, max(R, 1))])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def saw(f, t):
    # band-limited-ish saw: sum of harmonics up to 8 kHz
    out = np.zeros_like(t)
    k = 1
    while k * f < 8000 and k <= 40:
        out += ((-1) ** (k + 1)) * np.sin(2 * np.pi * k * f * t) / k ** 1.7   # softer than a raw saw
        k += 1
    return out * (2 / np.pi)


def reverb_ir(seconds=2.4, decay=3.2, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    envl = np.exp(-decay * np.arange(n) / SR)
    irL = rng.standard_normal(n) * envl
    irR = rng.standard_normal(n) * envl
    irL = lp_fft(irL, 6000); irR = lp_fft(irR, 6000)
    irL[:int(0.012 * SR)] = 0; irR[:int(0.017 * SR)] = 0      # pre-delay
    return irL / np.sqrt(np.sum(irL ** 2)), irR / np.sqrt(np.sum(irR ** 2))


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    nfft = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:len(x)]
    return y


# ── harmony ──────────────────────────────────────────────────────────────
CHORDS = [  # (pad voicing MIDI, bass MIDI, arp tones MIDI) — pad and arp sit high and airy; the bass owns the bottom
    ([67, 71, 74, 78], 43, [79, 83, 86, 90]),   # Gmaj7
    ([64, 67, 71, 78], 40, [76, 79, 83, 86]),   # Em9 (no 7th in pad)
    ([67, 71, 72, 76], 36, [72, 76, 79, 83]),   # Cmaj7
    ([66, 69, 71, 76], 38, [74, 78, 81, 83]),   # D6/9
]


def chord_at(time):
    return CHORDS[int(np.floor((time - G0) / BAR)) % 4]


# ── buses ────────────────────────────────────────────────────────────────
padL = np.zeros(N); padR = np.zeros(N)
plk = np.zeros(N)
bass = np.zeros(N)
kick = np.zeros(N)
clap = np.zeros(N)
hats = np.zeros(N)
shak = np.zeros(N)

# Pad: one chord per bar, soft attack, detuned saws, spread L/R.
nbars = int(np.ceil(TOTAL / BAR)) + 2
for b in range(-1, nbars):
    t0 = G0 + b * BAR
    if t0 + BAR <= 0:
        continue
    if t0 >= TOTAL + 0.1:
        break
    voices, _, _ = CHORDS[b % 4]
    last = t0 + BAR >= OUTRO                               # the final chord rings out
    ts = max(0.0, t0)                                      # a bar that began before the film starts at 0
    dur = (TOTAL - ts + 0.3) if last else (t0 + BAR + 0.6 - ts)
    n = int(dur * SR); i0 = int(ts * SR); i1 = min(N, i0 + n); n = i1 - i0
    tl = np.arange(n) / SR
    e = env_adsr(n, 0.45, 0.6, 0.8, 1.2 if last else 0.6, dur - 1.6)
    for m in voices:
        f = hz(m)
        padL[i0:i1] += e * 0.5 * (saw(f * 2 ** (-7 / 1200), tl) + 0.6 * np.sin(2 * np.pi * f * tl))
        padR[i0:i1] += e * 0.5 * (saw(f * 2 ** (+7 / 1200), tl) + 0.6 * np.sin(2 * np.pi * f * tl + 0.7))
    if last:
        break

# Pluck: 8th-note arpeggio, up-down, from bar 1.
ARP = [0, 1, 2, 3, 2, 1, 2, 3]
step = BEAT / 2
for k in range(-int(np.ceil(G0 / step)), int(TOTAL / step) + 2):
    t0 = G0 + k * step
    if t0 < 2.0 or t0 >= min(TOTAL, OUTRO + BAR):
        continue
    _, _, tones = chord_at(t0)
    m = tones[ARP[k % 8]]
    n = int(0.6 * SR); i0 = int(t0 * SR); i1 = min(N, i0 + n); n = i1 - i0
    tl = np.arange(n) / SR
    f = hz(m)
    e = np.exp(-tl / 0.16)
    tone = np.sin(2 * np.pi * f * tl) + 0.35 * np.sin(2 * np.pi * 2 * f * tl) * np.exp(-tl / 0.05) + 0.15 * np.sin(2 * np.pi * 3 * f * tl) * np.exp(-tl / 0.03)
    vel = 0.9 if k % 2 == 0 else 0.65
    plk[i0:i1] += tone * e * vel

# Drums + bass (only in the groove sections).
def in_groove(time):
    return (DROP <= time < BREAK_A) or (BREAK_B <= time < OUTRO)

rng = np.random.default_rng(3)
nbeats = int(TOTAL / BEAT) + 2
KB = -int(np.ceil(G0 / BEAT))                             # first beat index at or after 0 on the drop's grid
for k in range(KB, nbeats):
    t0 = G0 + k * BEAT
    if t0 < 0:
        continue
    if t0 >= TOTAL:
        break
    i0 = int(t0 * SR)
    beat_in_bar = k % 4
    if in_groove(t0):
        # kick: pitch-swept sine, short and round (never a boom)
        n = int(0.32 * SR); i1 = min(N, i0 + n); n = i1 - i0; tl = np.arange(n) / SR
        fsweep = 48 + 110 * np.exp(-tl / 0.03)
        ph = 2 * np.pi * np.cumsum(fsweep) / SR
        kick[i0:i1] += np.sin(ph) * np.exp(-tl / 0.11) + 0.08 * rng.standard_normal(n) * np.exp(-tl / 0.004)
        # clap on 2 and 4
        if beat_in_bar in (1, 3):
            n = int(0.25 * SR); i1 = min(N, i0 + n); n = i1 - i0; tl = np.arange(n) / SR
            burst = np.zeros(n)
            for off in (0.0, 0.011, 0.022):
                j = int(off * SR)
                burst[j:] += rng.standard_normal(n - j) * np.exp(-(tl[: n - j]) / 0.018)
            burst += rng.standard_normal(n) * np.exp(-tl / 0.12) * 0.35
            clap[i0:i1] += burst
        # bass: 8th notes on the root with a short gap (pumping feel)
        _, root, _ = chord_at(t0)
        for half in (0, 1):
            ts = t0 + half * step
            j0 = int(ts * SR); n = int(step * 0.92 * SR); j1 = min(N, j0 + n); n = j1 - j0; tl = np.arange(n) / SR
            f = hz(root)
            e = np.minimum(1, tl / 0.008) * np.exp(-tl / 0.35)
            bass[j0:j1] += e * (np.sin(2 * np.pi * f * tl) + 0.12 * np.sin(2 * np.pi * 2 * f * tl))
    # hats: off-beat 8ths in the groove
    if in_groove(t0 + step):
        j0 = int((t0 + step) * SR); n = int(0.06 * SR); j1 = min(N, j0 + n); n = j1 - j0; tl = np.arange(n) / SR
        hats[j0:j1] += rng.standard_normal(n) * np.exp(-tl / 0.012)
    # shaker: soft 16ths from the pile-up until the drop, rising gently
    if PILE <= t0 < DROP:
        for s16 in range(2):
            ts = t0 + s16 * step
            j0 = int(ts * SR); n = int(0.05 * SR); j1 = min(N, j0 + n); n = j1 - j0; tl = np.arange(n) / SR
            ramp = 0.35 + 0.65 * (ts - PILE) / max(1e-3, DROP - PILE)
            shak[j0:j1] += rng.standard_normal(n) * np.exp(-tl / 0.02) * ramp * (1.0 if s16 == 1 else 0.6)

# ── processing ───────────────────────────────────────────────────────────
# Pad filter opens through the intro (dark → bright), then stays open; dips under the break.
cut = np.full(N, 3200.0)
intro = tt < DROP
cut[intro] = 1400 + 2600 * (tt[intro] / max(DROP, 1e-3)) ** 1.6
brk = (tt >= BREAK_A) & (tt < BREAK_B)
cut[brk] = 1500
padL = onepole_lp(padL, cut); padR = onepole_lp(padR, cut)
padL = hp_fft(padL, 260); padR = hp_fft(padR, 260)
plk = lp_fft(plk, 5200)
hats = hp_fft(hats, 7000)
shak = bp_fft(shak, 5000, 12000)
clap = bp_fft(clap, 900, 6000)
kick = lp_fft(kick, 4000)
bass = lp_fft(bass, 900)

# Sidechain: the pad and bass breathe with the kick in the groove.
duck = np.ones(N)
for k in range(KB, nbeats):
    t0 = G0 + k * BEAT
    if t0 < 0:
        continue
    if in_groove(t0):
        i0 = int(t0 * SR); n = int(0.4 * SR); i1 = min(N, i0 + n); tl = np.arange(i1 - i0) / SR
        duck[i0:i1] = np.minimum(duck[i0:i1], 1 - 0.38 * np.exp(-tl / 0.09))
padL *= duck; padR *= duck; bass *= 0.55 + 0.45 * duck

# Pluck delay (dotted 8th, ping-pong) and a shared reverb.
d = int(0.75 * BEAT * SR)
plkL = plk.copy(); plkR = plk * 0.9
for i, g in enumerate([0.38, 0.26, 0.17, 0.11], start=1):
    src = np.pad(plk, (d * i, 0))[:N] * g
    if i % 2:
        plkR += src
    else:
        plkL += src

irL, irR = reverb_ir()
send = hp_fft(0.55 * (padL + padR) / 2 + 0.45 * plk + 0.5 * clap, 300)
revL = convolve(send, irL) * 0.22
revR = convolve(send, irR) * 0.22

# The groove eases in rather than dropping: drums and bass ramp up over the first bar after the product appears,
# and over one beat when they come back after the break (no "bass drop").
ramp = np.ones(N)
def ease_in(t0, length, start):
    if t0 >= TOTAL:                                  # section not in this cut
        return
    i0, i1 = int(t0 * SR), min(N, int((t0 + length) * SR))
    x = np.linspace(0, 1, i1 - i0)
    ramp[i0:i1] = start + (1 - start) * (x * x * (3 - 2 * x))
ease_in(DROP, BAR, 0.35)
ease_in(BREAK_B, BEAT * 2, 0.55)
kick *= ramp; bass *= ramp; clap *= ramp; hats *= ramp

# Mix (levels chosen so the bed sits under the picture; the kit never spikes).
L = 0.11 * padL + 0.06 * plkL + 0.22 * bass + 0.32 * kick + 0.10 * clap + 0.06 * hats + 0.03 * shak + revL
R = 0.11 * padR + 0.06 * plkR + 0.22 * bass + 0.32 * kick + 0.10 * clap + 0.06 * hats * 0.85 + 0.03 * shak * 1.2 + revR

# The intro sits well under the groove (~9 dB, as in the reference), then the product arrives with the drop.
ig = np.where(tt < DROP, 0.55, 1.0)
ig = np.convolve(ig, np.ones(int(0.05 * SR)) / int(0.05 * SR), mode="same")   # no click at the switch
L *= ig; R *= ig

# Fades: quick fade-in, long fade from the outro to the end.
fi = int(0.25 * SR)
L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
fo0 = int((OUTRO + 1.0) * SR)
if fo0 < N:
    ramp = np.linspace(1, 0, N - fo0) ** 1.5
    L[fo0:] *= ramp; R[fo0:] *= ramp

# Gentle bus glue: soft saturation, then normalise to -1 dBFS peak.
st = np.stack([L, R], 1)
st = np.tanh(st * 1.15) / 1.15
st = st / np.max(np.abs(st)) * 10 ** (-1 / 20)
st = st[: int(TOTAL * SR)]
out = os.path.join(ROOT, MUS.get("src", "assets/bgm/bed.wav"))
os.makedirs(os.path.dirname(out), exist_ok=True)
sf.write(out, st.astype(np.float32), SR, subtype="PCM_24")
rms = 20 * np.log10(np.sqrt(np.mean(st ** 2)) + 1e-12)
print(f"wrote {out}: {TOTAL:.2f}s, grid from {G0:.2f}s, drop {DROP:.2f}s, break {BREAK_A:.2f}-{BREAK_B:.2f}s, outro {OUTRO:.2f}s, rms {rms:.1f} dBFS")
