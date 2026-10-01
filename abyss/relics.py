# -*- coding: utf-8 -*-
"""遗物系统:生成 / 效果折算 / 装备管理(与主线装备完全独立)"""
import random

from .ansi import c, fmt
from .data import RARITIES, RARITY_IDX, RELIC_EFF_COUNT, RELIC_EFF_DEF, RELIC_EFFECTS

# 遗物名称池(按品质)
RELIC_NAMES = [
    ["碎裂石片", "锈蚀铜符"],
    ["打磨水晶", "符文残页"],
    ["秘银徽记", "元素核心"],
    ["龙裔圣物", "深渊之心"],
    ["星陨圣杯", "永恒之眼"],
    ["湮灭权柄", "创世碎片"],
]


class Relic:
    __slots__ = ("rarity", "tier", "effects", "name")

    def __init__(self, rarity, tier, effects, name=None, rng=None):
        self.rarity = rarity
        self.tier = tier          # 塔层数档(10/20/30...)
        self.effects = effects    # [(eff_id, val), ...]
        self.name = name or self._gen_name(rng or random)

    def _gen_name(self, rng):
        rid = RARITY_IDX[self.rarity]
        return rng.choice(RELIC_NAMES[rid])

    def eff_count(self):
        return RELIC_EFF_COUNT[RARITY_IDX[self.rarity]]

    def display(self, width=0):
        rid = RARITY_IDX[self.rarity]
        tag = "◆" * (rid + 1)
        s = c("[", "bright_black") + c(tag, RARITIES[rid][2]) + c("]", "bright_black") \
            + c(self.name, RARITIES[rid][2]) + c(" T%d" % self.tier, "bright_black")
        if width:
            from .ansi import pad
            s = pad(s, width)
        return s

    def effect_lines(self):
        lines = []
        for eid, val in self.effects:
            d = RELIC_EFF_DEF[eid]
            if d[4] == "级":
                lines.append("  ◈ %s +%s%s" % (d[1], ("%.0f" % val), d[4]))
            else:
                lines.append("  ◈ %s +%.1f%s" % (d[1], val, d[4]))
        return lines

    def to_dict(self):
        return {"rarity": self.rarity, "tier": self.tier,
                "effects": [(a, round(v, 2)) for a, v in self.effects],
                "name": self.name}

    @classmethod
    def from_dict(cls, d):
        return cls(d["rarity"], d["tier"],
                   [(a, v) for a, v in d["effects"]], d["name"])


def roll_relic(tier, rng=None, min_idx=0):
    """按塔层档位生成遗物"""
    from .items import roll_rarity
    rng = rng or random
    rid = roll_rarity(rng, 0, min_idx, 0)
    rar = RARITIES[rid]
    n_eff = RELIC_EFF_COUNT[rid]
    pool = [e for e in RELIC_EFFECTS]
    rng.shuffle(pool)
    effects = [(e[0], rng.uniform(e[2], e[3])) for e in pool[:n_eff]]
    return Relic(rar[0], tier, effects, rng=rng)


def relic_mods(relics):
    """已装备遗物的效果 → 统一修饰器列表(数值型)。
    触发型效果(crit_extra 等)由 combat 直接读 hero.xxx。"""
    from .data import CAPS
    mods = []
    for r in relics:
        if r is None:
            continue
        for eid, val in r.effects:
            if eid == "all_skill_lv":
                mods.append({"stat": "all_skill_lv", "op": "add", "v": val})
            elif eid == "cd_reduce":
                mods.append({"stat": "cd_reduce", "op": "add", "v": val})
            elif eid == "skill_dmg":
                mods.append({"stat": "skill_dmg", "op": "add", "v": val})
            elif eid == "crit_extra":
                mods.append({"stat": "crit_extra", "op": "add", "v": val})
            elif eid == "kill_heal":
                mods.append({"stat": "kill_heal", "op": "add", "v": val})
            elif eid == "deathward":
                mods.append({"stat": "deathward", "op": "add", "v": val})
            elif eid == "boss_dmg_r":
                mods.append({"stat": "boss_dmg_r", "op": "add", "v": val})
            elif eid == "kill_haste":
                mods.append({"stat": "kill_haste", "op": "add", "v": val})
            elif eid == "goldfind":
                mods.append({"stat": "goldfind", "op": "add", "v": val})
    return mods
