# -*- coding: utf-8 -*-
"""合成 8 个技能补充音效(22050Hz 16bit 单声道 WAV,峰值 0.85,3ms 淡入淡出)。

自研合成(方/锯/三角/正弦/噪声 + 音高滑移 + 单极低通 + 包络),无第三方素材,
不存在版权问题;风格对齐 public/sfx 现有 CC0 8-bit 音效(Juhani Junkala)。
输出:skill-fire / skill-ice / skill-zap / skill-roar / skill-ult /
      skill-drain / skill-mark / skill-dash
"""
import wave
import math
import random
import os

SR = 22050
NORM = 0.85
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "src", "web", "public", "sfx")

random.seed(20261004)   # 固定种子:产物可复现


def silence(sec):
    return [0.0] * int(SR * sec)


def noise(n):
    return [random.uniform(-1, 1) for _ in range(n)]


def osc(kind, n, f_fn, duty=0.5):
    """f_fn(t秒)->Hz;square 支持 duty。相位连续积分。"""
    out, ph = [], 0.0
    for i in range(n):
        t = i / SR
        f = max(20.0, f_fn(t))
        ph += f / SR
        p = ph % 1.0
        if kind == "sine":
            v = math.sin(2 * math.pi * p)
        elif kind == "square":
            v = 1.0 if p < duty else -1.0
        elif kind == "saw":
            v = 2.0 * p - 1.0
        else:  # triangle
            v = 4.0 * abs(p - 0.5) - 1.0
        out.append(v)
    return out


def lowpass(xs, a):
    """单极低通:a 越小越闷(截止 ≈ -ln(1-a)/2π·SR)。"""
    y = 0.0
    out = []
    for x in xs:
        y += a * (x - y)
        out.append(y)
    return out


def env(n, a_ms, d_ms, s_lvl, r_ms, s_until=None):
    """ADSR:a/d/r 毫秒; sustain 保持到 s_until(比例 0~1)再 release。"""
    na, nd, nr = int(SR * a_ms / 1000), int(SR * d_ms / 1000), int(SR * r_ms / 1000)
    su = int(n * (s_until if s_until is not None else 1.0)) - nr
    out = []
    for i in range(n):
        if i < na:
            g = i / max(1, na)
        elif i < na + nd:
            g = 1.0 - (1.0 - s_lvl) * (i - na) / max(1, nd)
        elif i < su:
            g = s_lvl
        elif i < n:
            k = (i - su) / max(1, n - su)
            g = s_lvl * (1.0 - k)
        else:
            g = 0.0
        out.append(g)
    return out


def mix(*layers):
    n = max(len(x) for x in layers)
    out = [0.0] * n
    for xs in layers:
        for i, v in enumerate(xs):
            out[i] += v
    return out


def mul(xs, ys):
    return [x * y for x, y in zip(xs, ys)]


def glide(f0, f1, sec, exp=True):
    k = math.log(f1 / f0) if exp else (f1 - f0)
    def fn(t):
        if t >= sec:
            return f1
        return f0 * math.exp(k * t / sec) if exp else f0 + k * t / sec
    return fn


def lfo(n, rate, depth):
    return [1.0 - depth * (0.5 - 0.5 * math.sin(2 * math.pi * rate * i / SR))
            for i in range(n)]


def seg_gain(n, segs):
    """按时间比例给分段增益 segs=[(until比例, gain), ...]。"""
    out = []
    for i in range(n):
        t = i / n
        g = segs[-1][1]
        for u, gv in segs:
            if t < u:
                g = gv
                break
        out.append(g)
    return out


def render(name, xs):
    peak = max(abs(v) for v in xs) or 1.0
    xs = [v * NORM / peak for v in xs]
    fade = int(SR * 0.003)
    for i in range(fade):
        xs[i] *= i / fade
        xs[-1 - i] *= i / fade
    data = b"".join(int(max(-32768, min(32767, round(v / NORM * 32767 * 0.85)))) .to_bytes(2, "little", signed=True) for v in xs)
    path = os.path.normpath(os.path.join(OUT, name + ".wav"))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)
    print(f"{name}.wav  {len(xs) / SR * 1000:.0f}ms  {os.path.getsize(path)}B")


# ---------------------------------------------------------------- 各音设计
def gen_fire():
    n = int(SR * 0.45)
    crk = mul(noise(n), env(n, 4, 160, 0.25, 260, 0.85))
    a = [0.9 - 0.82 * (i / n) for i in range(n)]        # 低通系数由亮转闷
    boom = lowpass(mul(crk, [1.0] * n), 0.0)[0:n]        # 占位保持长度
    boom = [0.0] * n
    y = 0.0
    for i, x in enumerate(crk):
        y += a[i] * (x - y)
        boom[i] = y
    thump = mul(osc("square", n, glide(200, 65, 0.22), duty=0.42),
                env(n, 3, 90, 0.12, 300, 0.7))
    return mix([1.3 * v for v in boom], [0.7 * v for v in thump])


def gen_ice():
    n = int(SR * 0.40)
    notes = [(1568, 0.0, 0.11), (1245, 0.10, 0.11), (932, 0.20, 0.16)]
    layers = []
    for f, at, dur in notes:
        s, e = int(at * SR), int((at + dur) * SR)
        seg = osc("triangle", e - s, lambda t, f=f: f)
        seg = mul(seg, env(e - s, 2, 60, 0.0, 120, 1.0))
        pad = [0.0] * s
        layers.append(pad + seg)
    spark = mul(lowpass(noise(n), 0.35), env(n, 10, 120, 0.0, 180, 0.4))
    layers.append([0.4 * v for v in spark])
    return mix(*layers)


def gen_zap():
    n = int(SR * 0.24)
    car = osc("square", n, glide(1500, 620, 0.24), duty=0.5)
    trem = lfo(n, 38, 0.85)
    jit = seg_gain(n, [(0.2, 0.4), (0.5, 1.0), (1.0, 0.55)])
    hiss = mul(lowpass(noise(n), 0.55), env(n, 2, 90, 0.1, 120, 0.6))
    body = mul(mul(mul(car, trem), jit), env(n, 2, 60, 0.18, 140, 0.8))
    return mix([1.0 * v for v in body], [0.5 * v for v in hiss])


def gen_roar():
    n = int(SR * 0.72)
    growl = osc("saw", n, glide(96, 52, 0.72))
    growl = mul(mul(growl, lfo(n, 11, 0.5)), env(n, 25, 200, 0.55, 420, 0.8))
    bed = mul(lowpass(noise(n), 0.12), env(n, 15, 300, 0.3, 380, 0.85))
    return mix([1.1 * lowpass(growl, 0.4)[i] for i in range(n)], [0.9 * v for v in bed])


def gen_ult():
    n = int(SR * 0.8)
    sub = mul(osc("sine", n, glide(380, 46, 0.7)), env(n, 4, 350, 0.25, 420, 0.8))
    expl = mul(lowpass(noise(n), 0.5), env(n, 2, 380, 0.18, 400, 0.7))
    aa = [0.5 - 0.44 * (i / n) for i in range(n)]
    expl2, y = [], 0.0
    for i, x in enumerate(expl):
        y += aa[i] * (x - y)
        expl2.append(y)
    hit = mul(osc("square", int(SR * 0.1), glide(660, 500, 0.1)),
              env(int(SR * 0.1), 1, 70, 0.0, 60, 1.0)) + [0.0] * (n - int(SR * 0.1))
    return mix([1.2 * v for v in sub], [1.0 * v for v in expl2], [0.5 * v for v in hit])


def gen_drain():
    n = int(SR * 0.42)
    body = osc("sine", n, glide(640, 170, 0.42))
    harm = [0.25 * v for v in osc("sine", n, glide(320, 85, 0.42))]
    trem = lfo(n, 9, 0.6)
    e = env(n, 8, 140, 0.35, 240, 0.8)
    return mix(mul(mul(body, trem), e), mul(mul(harm, trem), e))


def gen_mark():
    n = int(SR * 0.32)
    a_dur = int(SR * 0.09)
    note1 = mul(osc("square", a_dur, lambda t: 880), env(a_dur, 2, 50, 0.0, 60, 1.0))
    b_dur = n - a_dur
    note2 = mul(osc("square", b_dur, lambda t: 1318), env(b_dur, 2, 160, 0.0, 120, 1.0))
    return mix(note1 + note2, [0.3 * v for v in ([0.0] * a_dur +
            mul(osc("sine", b_dur, lambda t: 1318), env(b_dur, 2, 160, 0.0, 120, 1.0)))])


def gen_dash():
    n = int(SR * 0.28)
    whoosh = lowpass(noise(n), 0.08)
    whoosh2, y = [], 0.0
    for i, x in enumerate(whoosh):
        a = 0.06 + 0.5 * (i / n) ** 1.6          # 截止频率上扫
        y += a * (x - y)
        whoosh2.append(y)
    swell = env(n, 90, 60, 0.5, 90, 0.75)
    tone = mul(osc("triangle", n, glide(320, 940, 0.28)), env(n, 30, 80, 0.2, 150, 0.8))
    return mix([1.2 * mul(whoosh2, swell)[i] for i in range(n)], [0.35 * v for v in tone])


if __name__ == "__main__":
    render("skill-fire", gen_fire())
    render("skill-ice", gen_ice())
    render("skill-zap", gen_zap())
    render("skill-roar", gen_roar())
    render("skill-ult", gen_ult())
    render("skill-drain", gen_drain())
    render("skill-mark", gen_mark())
    render("skill-dash", gen_dash())
