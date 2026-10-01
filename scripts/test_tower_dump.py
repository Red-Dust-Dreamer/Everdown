# -*- coding: utf-8 -*-
"""遗物/爬塔 RNG 对拍基准(scripts/test_tower.ts 第 8 节的 Python 对照)。
用法: py scripts/test_tower_dump.py  (输出与 TS 侧 diff 应逐行一致)
"""
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import random

from abyss.relics import relic_mods, roll_relic
from abyss.tower import refresh_keys, roll_tower_drop, tower_gold, tower_monster, tower_relic_tier

r6 = lambda v: f"{v:.6f}"

mon7 = tower_monster(7, random.Random(42))
print(f"MON 7 {mon7.name} {r6(mon7.hp)} {r6(mon7.atk)} {r6(mon7.def_)} {str(mon7.boss).lower()} {mon7.tier}")
mon5 = tower_monster(5, random.Random(42))
print(f"MON 5 {mon5.name} {r6(mon5.hp)} {r6(mon5.atk)} {r6(mon5.def_)} {str(mon5.boss).lower()} {mon5.tier}")
rr = roll_relic(10, random.Random(7), 0)
print(f"REL 10 0 {rr.rarity} {rr.name} " + " ".join(f"{a}:{r6(v)}" for a, v in rr.effects))
rr2 = roll_relic(20, random.Random(9), 2)
print(f"REL 20 2 {rr2.rarity} {rr2.name} " + " ".join(f"{a}:{r6(v)}" for a, v in rr2.effects))
td = roll_tower_drop(15, random.Random(31), 0)
print(f"DROP 15 {td.rarity} {td.tier} {td.name} " + " ".join(f"{a}:{r6(v)}" for a, v in td.effects))
print(f"TIER {tower_relic_tier(1)} {tower_relic_tier(10)} {tower_relic_tier(11)} {tower_relic_tier(37)}")
print(f"GOLD {r6(tower_gold(1))} {r6(tower_gold(15))}")
print("MODS " + " ".join(f"{m['stat']}:{m['op']}:{r6(m['v'])}" for m in relic_mods([td, None])))
