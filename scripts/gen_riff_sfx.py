"""Synthesise the two riff SFX with stdlib wave/struct/math. No samples.
Run: python3 scripts/gen_riff_sfx.py
"""
import math
import struct
import wave

RATE = 44100


def envelope(t, dur, attack=0.005, release=0.05):
    if t < attack:
        return t / attack
    if t > dur - release:
        return max(0.0, (dur - t) / release)
    return 1.0


def write(path, samples):
    with wave.open(path, "w") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 9000)) for s in samples))


def catch_blue():
    # bright two-note ascending chime: 660 -> 990 Hz
    out = []
    for freq, dur in [(660, 0.09), (990, 0.12)]:
        n = int(RATE * dur)
        for i in range(n):
            t = i / RATE
            out.append(math.sin(2 * math.pi * freq * t) * envelope(t, dur))
    return out


def hit_orange():
    # harsh downward sawtooth buzz: 420 -> 80 Hz
    dur = 0.28
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        freq = 420 - (420 - 80) * (t / dur)
        phase = (t * freq) % 1.0
        saw = 2.0 * phase - 1.0
        out.append(saw * envelope(t, dur))
    return out


write("public/assets/audio/catch_blue.wav", catch_blue())
write("public/assets/audio/hit_orange.wav", hit_orange())
print("wrote catch_blue.wav and hit_orange.wav")
