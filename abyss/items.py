# -*- coding: utf-8 -*-
"""装备:生成 / 属性计算 / 评分 / 命名 / 出售分解收益"""
import random

from .ansi import c, fmt
from .data import (AFFIX_DEF, AFFIX_SUFFIX, AFFIXES, BAL, RARITIES,
                   RARITY_IDX, RARITY_PREFIX, SLOTS, SLOT_IDX, SLOT_INNATE,
                   SLOT_MAIN_K, STAT_NAMES, CAPS)


def plus_bonus(plus):
    """强化等级 → 全属性加成(小数)。分段递减:0-10级/11-20级/21级起。"""
    return ((BAL["plus_pct_1"] * min(plus, 10)
             + BAL["plus_pct_2"] * max(0, min(plus, 20) - 10)
             + BAL["plus_pct_3"] * max(0, plus - 20)) / 100.0)


class Item:
    __slots__ = ("slot", "rarity", "tier", "plus", "main_val", "affixes", "name")

    def __init__(self, slot, rarity, tier, main_val, affixes, plus=0, name=None, rng=None):
        self.slot = slot          # weapon/helmet/...
        self.rarity = rarity      # common/.../mythic
        self.tier = tier          # 掉落时的怪物档位
        self.plus = plus          # 强化等级
        self.main_val = main_val  # 主属性基础值(未乘稀有度/强化)
        self.affixes = affixes    # [(id, 基础值), ...]
        self.name = name or self._gen_name(rng or random)

    # ------------------------------------------------ 命名
    def _gen_name(self, rng):
        rid = RARITY_IDX[self.rarity]
        slot_def = SLOTS[SLOT_IDX[self.slot]]
        base = rng.choice(slot_def[4])
        prefix = RARITY_PREFIX[rid]
        if self.affixes and rng.random() < 0.55:
            suffix = AFFIX_SUFFIX.get(self.affixes[0][0], "")
            return "%s%s·%s" % (prefix, base, suffix)
        return "%s%s" % (prefix, base)

    # ------------------------------------------------ 属性
    def mult(self):
        """稀有度 × 强化 总倍率。强化收益分段递减,质量乘数随强化自然饱和。"""
        rmul = RARITIES[RARITY_IDX[self.rarity]][3]
        return rmul * (1 + plus_bonus(self.plus))

    def stats(self):
        """最终属性 dict"""
        m = self.mult()
        out = {self._main_stat(): self.main_val * m}
        for aid, val in self.affixes:
            out[aid] = out.get(aid, 0) + val * m
        innate = SLOT_INNATE.get(self.slot)
        if innate:
            k, per = innate
            extra = per * RARITY_IDX[self.rarity] * (1 + plus_bonus(self.plus))
            out[k] = out.get(k, 0) + extra
        return out

    def _main_stat(self):
        return SLOTS[SLOT_IDX[self.slot]][2]

    def score(self):
        """装备评分(用于对比/自动换装)"""
        s = 0.0
        for k, v in self.stats().items():
            w = AFFIX_DEF[k][6] if k in AFFIX_DEF else 1.0
            if k == "hp":
                w = 0.085
            elif k == "atk":
                w = 1.0
            elif k == "def":
                w = 0.45
            s += v * w
        return s

    # ------------------------------------------------ 收益
    def sell_price(self):
        rid = RARITY_IDX[self.rarity]
        return int(round((5 + self.tier * 0.8 + self.plus * 4) * (1 + rid * 0.35)))

    def reforge_count(self):
        """当前品质可洗词条数:精良/稀有=1,史诗/传说=2,神话=3"""
        rid = RARITY_IDX[self.rarity]
        return min(len(self.affixes), BAL["reforge_slots"][rid])

    def reforge_affixes_with_luck(self, rng, luck_off=1.0):
        """洗 N 条词缀:重掷选中词条的值(基值区间不变,值域 ×luck_off),
        数值型词缀的成长部分(tier×k)保持。返回被洗的词条名列表。"""
        n = self.reforge_count()
        if n <= 0 or not self.affixes:
            return []
        indices = list(range(len(self.affixes)))
        rng.shuffle(indices)
        picked = indices[:n]
        for i in picked:
            aid = self.affixes[i][0]
            a = AFFIX_DEF[aid]
            val = rng.uniform(a[2], a[3] * luck_off) + a[4] * self.tier
            self.affixes[i] = (aid, val)
        return [AFFIX_DEF[self.affixes[i][0]][1] for i in picked]

    def dismantle(self):
        """分解 → (金币, 重铸石)"""
        rid = RARITY_IDX[self.rarity]
        stones = max(0, rid - 2) + (1 if self.plus >= 10 else 0)
        return self.sell_price() + int(self.tier * 0.4), stones

    def enhance_cost(self):
        """(基费 + 层数线性) × 强化等级多项式 —— 低斜率,长期可持续"""
        base = BAL["enhance_cost0"] + BAL["enhance_cost_t"] * self.tier
        mul = (1 + BAL["enhance_plus_a"] * self.plus
               + BAL["enhance_plus_b"] * self.plus ** 2)
        return int(round(base * mul))

    # ------------------------------------------------ 序列化
    def to_dict(self):
        return {"slot": self.slot, "rarity": self.rarity, "tier": self.tier,
                "plus": self.plus, "main_val": round(self.main_val, 2),
                "affixes": [(a, round(v, 2)) for a, v in self.affixes],
                "name": self.name}

    @classmethod
    def from_dict(cls, d):
        return cls(d["slot"], d["rarity"], d["tier"], d["main_val"],
                   [(a, v) for a, v in d["affixes"]], d.get("plus", 0), d["name"])

    # ------------------------------------------------ 显示
    def rarity_color(self):
        return RARITIES[RARITY_IDX[self.rarity]][2]

    def display(self, width=0, show_plus=True):
        rid = RARITY_IDX[self.rarity]
        tag = "★" * (rid + 1)
        plus = ("+%d" % self.plus) if (show_plus and self.plus) else ""
        s = c("[", "bright_black") + c(tag, self.rarity_color()) + c("]", "bright_black") \
            + c(self.name, self.rarity_color()) + (c(plus, "bright_yellow", bold=True) if plus else "")
        if width:
            from .ansi import pad
            s = pad(s, width)
        return s

    def stat_lines(self):
        """属性文本行(用于详情面板)"""
        lines = []
        mstat = self._main_stat()
        stats = self.stats()
        v = stats.get(mstat, 0)
        if mstat in ("haste", "crit", "crit_dmg", "goldfind", "lifesteal"):
            lines.append(c("主属性:", "bright_black") + " %s %s" % (STAT_NAMES[mstat], _pct(v)))
        else:
            lines.append(c("主属性:", "bright_black") + " %s %s" % (STAT_NAMES[mstat], fmt(v)))
        for aid, _ in self.affixes:
            v = stats.get(aid, 0)
            a = AFFIX_DEF[aid]
            if a[5]:  # 百分比
                lines.append(c("├ 词缀:", "bright_black") + " %s +%s" % (a[1], _pct(v)))
            else:
                lines.append(c("├ 词缀:", "bright_black") + " %s +%s" % (a[1], fmt(v)))
        innate = SLOT_INNATE.get(self.slot)
        if innate:
            k, per = innate
            extra = per * RARITY_IDX[self.rarity] * (1 + plus_bonus(self.plus))
            if k not in [a[0] for a in self.affixes]:
                lines.append(c("├ 固有:", "bright_black") + " %s +%s"
                             % (STAT_NAMES[k], _pct(extra)))
        return lines


def _pct(v):
    return ("%.1f" % v).rstrip("0").rstrip(".") + "%"


# ---------------------------------------------------------------- 生成
def roll_rarity(rng, luck=0.0, min_idx=0, boost=0.0):
    """按权重随机稀有度;luck 影响高档权重,boost 为整体档位提升"""
    weights = []
    for i, r in enumerate(RARITIES):
        w = r[5]
        if i >= 2:
            w *= (1 + luck / 100.0)
        if i >= 3:
            w *= (1 + boost)
        weights.append(max(0.0, w))
    total = sum(weights)
    x = rng.random() * total
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        if x <= acc:
            return max(i, min_idx)
    return max(0, min_idx)


def roll_item(tier, rng=None, luck=0.0, min_idx=0, boost=0.0):
    """按怪物档位 tier 生成一件装备(全部随机走传入的 rng)。

    数值体系 2.0:数值型主属性 = 基值 + 槽斜率×t^p(与怪物HP同阶);
    数值型词缀 = 区间随机 + 线性小步长;百分比型不随层数成长。
    """
    rng = rng or random
    slot_def = SLOTS[rng.randrange(len(SLOTS))]
    rid = roll_rarity(rng, luck, min_idx, boost)
    rar = RARITIES[rid]
    main_stat = slot_def[2]
    if main_stat in ("haste", "crit", "crit_dmg", "goldfind", "lifesteal"):
        main_val = slot_def[3] * rng.uniform(0.9, 1.1)
    else:
        k = SLOT_MAIN_K.get(slot_def[0], 1.0)
        main_val = (slot_def[3]
                    + k * (tier ** BAL["item_main_p"]) * rng.uniform(0.85, 1.15))
    n_affix = rar[3]
    pool = [a for a in AFFIXES]
    rng.shuffle(pool)
    affixes = []
    for a in pool[:n_affix]:
        lo, hi, k = a[2], a[3], a[4]
        val = rng.uniform(lo, hi) + k * tier
        affixes.append((a[0], val))
    return Item(slot_def[0], rar[0], tier, main_val, affixes, rng=rng)
