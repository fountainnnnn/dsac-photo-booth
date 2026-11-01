#!/usr/bin/env python3
"""Synthesise the two UI sounds a launch film needs, so nothing has to be licensed.

    python3 tools/sfx.py          # writes assets/sfx/click-soft.wav and assets/sfx/typing.wav

click-soft  a short, rounded tap for a button press (approve, send, publish, a swatch)
typing      ~1.2s of light key taps for text being typed into a field or composer

Use them only on UI actions, at low volume (0.1–0.16 in scenes.json). No whooshes, risers or impacts.
"""
import os
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
OUT = os.path.join(ROOT, "assets", "sfx")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)


def lp(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x))


def hp(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** 4), len(x))


def tap(n_ms=60, body_hz=1800, click_amt=0.5, decay=0.012):
    n = int(SR * n_ms / 1000); t = np.arange(n) / SR
    noise = hp(lp(rng.standard_normal(n), 7000), 900) * np.exp(-t / (decay * 0.35))
    body = np.sin(2 * np.pi * body_hz * t) * np.exp(-t / decay)
    return click_amt * noise + body


def norm(x, db=-6):
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (db / 20)


# click-soft: one rounded tap with a faint lower thump.
c = tap(90, 1500, 0.35, 0.016)
n = len(c); t = np.arange(n) / SR
c = c + 0.5 * np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.02)
c = np.concatenate([c, np.zeros(int(0.05 * SR))])
sf.write(os.path.join(OUT, "click-soft.wav"), np.stack([norm(c, -8)] * 2, 1).astype(np.float32), SR, subtype="PCM_16")

# typing: 16 taps at a human, uneven pace (55–110 ms apart), varied pitch and level.
total = int(1.3 * SR); y = np.zeros(total); pos = int(0.01 * SR)
for k in range(16):
    k_tap = tap(45, 1600 + 900 * rng.random(), 0.6, 0.008) * (0.55 + 0.45 * rng.random())
    end = min(total, pos + len(k_tap)); y[pos:end] += k_tap[: end - pos]
    pos += int(SR * (0.055 + 0.055 * rng.random()))
    if pos >= total:
        break
sf.write(os.path.join(OUT, "typing.wav"), np.stack([norm(y, -10)] * 2, 1).astype(np.float32), SR, subtype="PCM_16")
print("wrote assets/sfx/click-soft.wav, assets/sfx/typing.wav")
