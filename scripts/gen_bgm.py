# -*- coding: utf-8 -*-
"""合成深渊氛围 BGM 循环(11025Hz 16bit 单声道 WAV,峰值 0.6,整循环无缝)。

自研合成(正弦叠加 + 慢包络 + 单极低通 + 噪声洗),无第三方素材,不存在版权问题;
风格对齐 gen_sfx.py(峰值略低,给音效让出动态余量)。
输出:src/web/public/bgm/loop.wav(游戏经 WebAudio loop=true 无缝循环)

无缝循环原理(循环时长 L=24s):
  - 全程连续声部(低音持续音、高频微光)频率量化到 1/L 的整数倍频
    (f = round(f*L)/L),保证每个正弦在循环点相位归零,无爆音;
  - 分段和弦(4 段 × 6s,和声进行 i-VI-III-VII)每段 1.5s 淡入淡出,
    段边界振幅为零,相位不连续被零振幅掩盖;
  - 噪声洗用 sin² 全程包络(首尾为零)。
"""
import wave
import math
import random
import os
import struct

SR = 11025
LOOP = 24.0            # 循环时长(秒);SEG × 4
SEG = 6.0              # 每个和弦段时长
NORM = 0.6             # 峰值归一(BGM 低于音效的 0.85)
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "web", "public", "bgm")

random.seed(20261007)   # 固定种子:噪声洗可复现

# D 自然小调,和声进行 i(Dm) - VI(Bb) - III(F) - VII(C),每段 6s
# 每和弦 [低音, 低八度支撑, 三音, 五音](Hz,等律;分段内允许失谐)
CHORDS = [
    ("Dm", [73.42, 146.83, 174.61, 220.00]),
    ("Bb", [58.27, 116.54, 174.61, 233.08]),
    ("F",  [87.31, 174.61, 220.00, 261.63]),
    ("C",  [65.41, 130.81, 164.81, 196.00]),
]
SUB = 73.42            # 持续低音(D2,全程)
SHIM = 587.33          # 高频微光(D5,全程,极轻)
FADE = 1.5             # 和弦段淡入淡出(秒)


def qf(f):
    """量化到 1/LOOP 整数倍频:保证整循环整数周期(连续声部无缝的关键)"""
    return round(f * LOOP) / LOOP


def lowpass(xs, a):
    y = 0.0
    out = []
    for x in xs:
        y += a * (x - y)
        out.append(y)
    return out


n = int(SR * LOOP)

# ---- 1) 持续低音:量化频率正弦 + 微失谐副弦(相位在循环点归零,零失谐保证无缝)----
sub_f = qf(SUB)
mix = [math.sin(2 * math.pi * sub_f * i / SR) * 0.30 for i in range(n)]

# ---- 2) 高频微光:量化频率 + sin² 全程包络(极轻,给混音加"空气感")----
shim_f = qf(SHIM)
for i in range(n):
    t = i / SR
    env = math.sin(math.pi * t / LOOP) ** 2
    mix[i] += math.sin(2 * math.pi * shim_f * i / SR) * 0.022 * env

# ---- 3) 和弦垫:每段 4 音(主音 + 失谐副本制造缓慢拍频),段内零点包络 ----
seg_n = int(SR * SEG)
fade_n = int(SR * FADE)
for si, (_name, freqs) in enumerate(CHORDS):
    start = si * seg_n
    # 预生成该段每音的相位(失谐副本 +0.12%,段内自由;包络归零掩盖段界相位差)
    phases = []
    for f in freqs:
        det = f * 1.0012
        phases.append((f, det))
    for j in range(seg_n):
        t = j / SR
        # 包络:1.5s 淡入 - 平台 - 1.5s 淡出(段首尾为零)
        if j < fade_n:
            env = j / fade_n
        elif j >= seg_n - fade_n:
            env = (seg_n - j) / fade_n
        else:
            env = 1.0
        env = env * env   # 平方:更柔的进入
        v = 0.0
        for f, det in phases:
            v += (math.sin(2 * math.pi * f * t) + math.sin(2 * math.pi * det * t)) * 0.055
        mix[start + j] += v * env

# ---- 4) 噪声洗:极轻低通噪声,sin² 全程包络(深渊的"风")----
wash = [random.uniform(-1, 1) for _ in range(n)]
wash = lowpass(wash, 0.045)   # 截止约 3.2kHz @11025Hz,暗色风声
wmax = max(abs(x) for x in wash) or 1.0
for i in range(n):
    t = i / SR
    env = math.sin(math.pi * t / LOOP) ** 2
    mix[i] += wash[i] / wmax * 0.05 * env

# ---- 5) 总线:轻低通去数字毛刺,归一化,16bit WAV ----
mix = lowpass(mix, 0.55)
peak = max(abs(x) for x in mix) or 1.0
scale = NORM / peak
frames = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x * scale)) * 32767)) for x in mix)

os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, "loop.wav")
with wave.open(path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(frames)

size_kb = os.path.getsize(path) / 1024
print("OK %s (%.0f KB, %ds loop @%dHz mono)" % (path, size_kb, LOOP, SR))
