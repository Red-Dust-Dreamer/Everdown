# -*- coding: utf-8 -*-
"""装备:生成 / 属性计算 / 评分 / 命名 / 出售分解收益"""
import random

from .ansi import c, fmt
from .data import (ACTIVE_DEF, ACTIVE_SKILLS, AFFIX_DEF, AFFIX_SUFFIX, AFFIXES,
                   BAL, PASSIVE_DEF, PASSIVE_SKILLS, RARITIES,
                   RARITY_IDX, RARITY_PREFIX, SLOTS, SLOT_IDX, SLOT_INNATE,
                   MAIN_ROLLS, STAT_NAMES, CAPS)


def plus_bonus(plus):
    """强化等级 → 全属性加成(小数)。分段递减:0-10级/11-20级/21级起。"""
    return ((BAL["plus_pct_1"] * min(plus, 10)
             + BAL["plus_pct_2"] * max(0, min(plus, 20) - 10)
             + BAL["plus_pct_3"] * max(0, plus - 20)) / 100.0)


class Item:
    __slots__ = ("slot", "rarity", "tier", "plus", "main_val", "affixes", "name",
                 "main_id", "skill_sid")

    def __init__(self, slot, rarity, tier, main_val, affixes, plus=0, name=None, rng=None,
                 main_id=None, skill_sid=None):
        self.slot = slot          # weapon/helmet/...
        self.rarity = rarity      # common/.../mythic
        self.tier = tier          # 掉落时的怪物档位
        self.plus = plus          # 强化等级
        self.main_val = main_val  # 主属性基础值(未乘稀有度/强化)
        self.affixes = affixes    # [(id, 基础值), ...]
        self.name = name or self._gen_name(rng or random)
        self.main_id = main_id   # roll 定的主属性;None=旧存档,回落 LEGACY_MAIN
        self.skill_sid = skill_sid  # skill_lv 词缀绑定的技能;None=旧档,保持全技能聚合

    def bound_skill_name(self):
        """绑定技能名(skill_lv 词缀显示用);未绑定返回 None"""
        if not self.skill_sid:
            return None
        d = ACTIVE_DEF.get(self.skill_sid) or PASSIVE_DEF.get(self.skill_sid)
        return d["name"] if d else None

    # ------------------------------------------------ 命名
    def _gen_name(self, rng):
        rid = RARITY_IDX[self.rarity]
        slot_def = SLOTS[SLOT_IDX[self.slot]]
        base = rng.choice(slot_def[2])
        prefix = RARITY_PREFIX[rid]
        if self.affixes and rng.random() < 0.55:
            suffix = AFFIX_SUFFIX.get(self.affixes[0][0], "")
            return "%s%s·%s" % (prefix, base, suffix)
        return "%s%s" % (prefix, base)

    # ------------------------------------------------ 属性
    def mult(self):
        """稀有度 × 强化 总倍率(主属性与数值词缀用)。
        稀有度倍率取系数列 [4](1.00~2.10);旧实现误取词缀数 [3](1~6),
        蓝色×3/神话×6 导致数值爆炸——已与 TS 主实现同步修正。"""
        rmul = RARITIES[RARITY_IDX[self.rarity]][4]
        return rmul * (1 + plus_bonus(self.plus))

    def stats(self):
        """最终属性 dict。
        强化只提主属性与固有(基础数值),词条不吃强化——多词条逐级放大膨胀过快;
        百分比词缀保持 roll 值,数值词缀只吃稀有度倍率。"""
        rmul = RARITIES[RARITY_IDX[self.rarity]][4]
        m = self.mult()   # 主属性用:稀有度 × 强化
        out = {self._main_stat(): self.main_val * m}
        for aid, val in self.affixes:
            # 绑定技能的单技能词缀不进通用聚合(eff_lv 按 skill_sid 单独生效)
            if aid == "skill_lv" and self.skill_sid:
                continue
            pct = AFFIX_DEF[aid][5]
            out[aid] = out.get(aid, 0) + val * (1 if pct else rmul)
        innate = SLOT_INNATE.get(self.slot)
        if innate:
            k, per = innate
            extra = per * RARITY_IDX[self.rarity]   # 固有也不吃强化:强化只作用于主属性
            out[k] = out.get(k, 0) + extra
        return out

    def _main_stat(self):
        return self.main_id or "atk"

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
        """洗 N 条词缀:重掷选中词条的值。
        百分比词缀维持稀有度分档(档位基数不变,随机宽度 ×luck_off),
        数值型词缀的值域 ×luck_off、tier×k 成长部分保持。返回被洗的词条名列表。"""
        n = self.reforge_count()
        if n <= 0 or not self.affixes:
            return []
        rid = RARITY_IDX[self.rarity]
        indices = list(range(len(self.affixes)))
        rng.shuffle(indices)
        picked = indices[:n]
        for i in picked:
            aid = self.affixes[i][0]
            a = AFFIX_DEF[aid]
            if a[5]:
                step = a[7]
                val = rid * step + rng.uniform(0, step * luck_off)
            else:
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
        d = {"slot": self.slot, "rarity": self.rarity, "tier": self.tier,
             "plus": self.plus, "main_val": round(self.main_val, 2),
             "affixes": [(a, round(v, 2)) for a, v in self.affixes],
             "name": self.name}
        if self.main_id:
            d["main_id"] = self.main_id
        if self.skill_sid:
            d["skill_sid"] = self.skill_sid
        return d

    @classmethod
    def from_dict(cls, d):
        return cls(d["slot"], d["rarity"], d["tier"], d["main_val"],
                   [(a, v) for a, v in d["affixes"]], d.get("plus", 0), d["name"],
                   main_id=d.get("main_id"), skill_sid=d.get("skill_sid"))

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
            # 绑定技能的单技能词缀:词条名=技能名,整级显示
            if aid == "skill_lv" and self.skill_sid:
                nm = self.bound_skill_name() or "技能"
                lines.append(c("├ 词缀:", "bright_black")
                             + " %s +%d级" % (nm, int([v for i, v in self.affixes if i == aid][0])))
                continue
            v = stats.get(aid, 0)
            a = AFFIX_DEF[aid]
            if a[5]:  # 百分比
                lines.append(c("├ 词缀:", "bright_black") + " %s +%s" % (a[1], _pct(v)))
            else:
                lines.append(c("├ 词缀:", "bright_black") + " %s +%s" % (a[1], fmt(v)))
        innate = SLOT_INNATE.get(self.slot)
        if innate:
            k, per = innate
            extra = per * RARITY_IDX[self.rarity]   # 固有不吃强化,与 stats() 同口径
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


def roll_item(tier, rng=None, luck=0.0, min_idx=0, boost=0.0, cls=None):
    """按怪物档位 tier 生成一件装备(全部随机走传入的 rng)。

    数值体系 2.0:数值型主属性 = 基值 + 槽斜率×t^p(与怪物HP同阶);
    数值型词缀 = 区间随机 + 线性小步长;百分比型不随层数成长。
    """
    rng = rng or random
    slot_def = SLOTS[rng.randrange(len(SLOTS))]
    rid = roll_rarity(rng, luck, min_idx, boost)
    rar = RARITIES[rid]
    # 主属性按槽位候选表 roll(防具槽生命/防御二选一);rng 调用顺序与 TS 严格一致
    stat, base, k = MAIN_ROLLS[slot_def[0]][rng.randrange(len(MAIN_ROLLS[slot_def[0]]))]
    if stat in ("haste", "crit", "crit_dmg", "goldfind", "lifesteal"):
        main_val = base * rng.uniform(0.9, 1.1)
    else:
        main_val = base + k * (tier ** BAL["item_main_p"]) * rng.uniform(0.85, 1.15)
    main_stat = stat
    n_affix = rar[3]
    pool = [a for a in AFFIXES]
    rng.shuffle(pool)
    affixes = []
    for a in pool[:n_affix]:
        # 百分比词缀按稀有度分档:白 0~step、精良 step~2step……神话 5step~6step
        # (crit_dmg step=10 → 白0~10/绿10~20/蓝20~30/紫30~40/金40~50/神50~60)
        if a[5]:
            step = a[7]
            val = rid * step + rng.uniform(0, step)
        else:
            val = rng.uniform(a[2], a[3]) + a[4] * tier
        affixes.append((a[0], val))
    # 单技能词缀:随机绑定当前职业一个技能(主动+被动池);rng 消耗与 TS 严格一致
    skill_sid = None
    if any(aid == "skill_lv" for aid, _ in affixes):
        sid_pool = [s["id"] for s in ACTIVE_SKILLS + PASSIVE_SKILLS if s["cls"] == cls]
        if sid_pool:
            skill_sid = rng.choice(sid_pool)
    return Item(slot_def[0], rar[0], tier, main_val, affixes, rng=rng,
                main_id=stat, skill_sid=skill_sid)
