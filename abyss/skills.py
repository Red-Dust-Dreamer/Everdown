# -*- coding: utf-8 -*-
"""技能引擎:主动施放(数据驱动)+ 被动数值聚合与钩子查询。

主动技能定义见 data.ACTIVE_SKILLS,六种 kind 共用一套施放函数;
被动技能见 data.PASSIVE_SKILLS:kind=stat 进 recalc 数值管道,
kind=hook 由 combat 在相应时机调用本模块的查询函数。
"""
from .ansi import c, fmt

# ---------------------------------------------------------------- 等级与数值


def class_of(g):
    """当前职业定义(未选择时回退战士,仅用于渲染默认值)"""
    from .data import CLASSES
    return CLASSES.get(g.class_id) or CLASSES["warrior"]


def equip_skill_lv(g):
    """装备词缀提供的全技能等级加成(向下取整)。

    词缀已在 recalc_hero 聚合进 hero['skill_lv'](虚拟属性管道),
    这里直接读缓存——本函数在每次伤害计算的热路径上,不可重算装备。
    """
    return int(g.hero.get("skill_lv", 0))


def eff_lv(g, sid):
    """技能有效等级 = 自身等级(1~10) + 装备词缀加成 + 遗物单技能加成"""
    relic_lv = 0
    for r in g.relics:
        if r and r.skill_id == sid:
            for eid, val in r.effects:
                if eid == "skill_lv_r":
                    relic_lv += int(val)
    return max(1, g.skill_lv.get(sid, 1)) + equip_skill_lv(g) + relic_lv


def skill_val(defn, lv):
    return defn["base"] + defn.get("per", 0) * (lv - 1)


def _fmt_val(v):
    if v >= 100:
        return "%.0f" % v
    return ("%.1f" % v).rstrip("0").rstrip(".")


def skill_desc(g, defn):
    from .data import PASSIVE_DEF
    lv = eff_lv(g, defn["id"])
    show_lv = skill_val(defn, lv)
    txt = defn["desc"].format(v=_fmt_val(show_lv))
    if equip_skill_lv(g) > 0:
        txt += c("(含装备+%d)" % equip_skill_lv(g), "bright_black")
    return txt


# ---------------------------------------------------------------- 数值被动 → recalc 管道
def passive_mods(g):
    """装配中的数值被动(kind=stat)→ 统一修饰器列表。

    stat='all' 展开为 hp/atk/def 三条 pct;虚拟属性(skill_dmg 等)以 add 生效,
    由 recalc 汇总进 hero 派生键。与 stat_mods(外部挂口)、成就同管道。
    """
    from .data import PASSIVE_DEF
    mods = []
    for sid in g.loadout["passive"]:
        d = PASSIVE_DEF.get(sid)
        if not d or d["kind"] != "stat":
            continue
        v = skill_val(d, eff_lv(g, sid))
        stats = ["hp", "atk", "def"] if d["stat"] == "all" else [d["stat"]]
        for st in stats:
            mods.append({"stat": st, "op": d["op"], "v": v})
    return mods


def hook_val(g, hook):
    """查询装配中某钩子被动的当前值;未装配返回 0"""
    d = hook_def(g, hook)
    return skill_val(d, eff_lv(g, d["id"])) if d else 0.0


def hook_def(g, hook):
    from .data import PASSIVE_DEF
    for sid in g.loadout["passive"]:
        d = PASSIVE_DEF.get(sid)
        if d and d["kind"] == "hook" and d["hook"] == hook:
            return d
    return None


# ---------------------------------------------------------------- buff 管理
def add_buff(g, stat, pct, dur):
    """动态增益(主动buff/被动触发buff):同属性取最大,异属性共存"""
    until = g.time + dur
    cur = g.buffs.get(stat)
    if cur and cur["until"] > g.time and cur["pct"] > pct:   # 同值续时(药剂重饮)
        return
    g.buffs[stat] = {"pct": pct, "until": until}


def buff_pct(g, stat):
    b = g.buffs.get(stat)
    if not b or b["until"] <= g.time:
        return 0.0
    return b["pct"]


def tick_buffs(g):
    for k in [k for k, b in g.buffs.items() if b["until"] <= g.time]:
        del g.buffs[k]


# ---------------------------------------------------------------- 伤害乘区
def dmg_multipliers(g, mon):
    """普攻/技能的通用伤害乘区(暴击之外)"""
    mult = 1.0
    mult *= 1 + buff_pct(g, "dmg") / 100.0            # 奥术涌动等伤害buff
    # 战意:自身生命低于一半时增伤
    if g.hero["hp"] < g.hero["max_hp"] * 0.5:
        mult *= 1 + hook_val(g, "low_hp_dmg") / 100.0
    if mon is not None:
        if mon.boss or mon.elite:
            mult *= 1 + hook_val(g, "boss_dmg") / 100.0
            m = getattr(mon, "marked_pct", 0)
            if m and getattr(mon, "marked_until", 0) > g.time:
                mult *= 1 + m / 100.0
        d = hook_def(g, "low_target_dmg")
        if d and mon.hp_pct() < 0.40:
            mult *= 1 + hook_val(g, "low_target_dmg") / 100.0
    # 遗物:猎首(对头目/精英额外伤害)
    if mon is not None and (mon.boss or mon.elite):
        mult *= 1 + (g.hero.get("boss_dmg_r", 0)) / 100.0
    if g.hero.get("next_hit_bonus", 0) > 0:            # 连锁反应
        mult *= 1 + g.hero["next_hit_bonus"] / 100.0
        g.hero["next_hit_bonus"] = 0.0
    return mult


def atk_now(g):
    """当前有效攻击(含 atk/all buff)"""
    return g.hero["atk"] * (1 + buff_pct(g, "atk") / 100.0) \
        * (1 + buff_pct(g, "all") / 100.0)


# ---------------------------------------------------------------- 主动施放
def cast_active(g, sdef, mon):
    """施放主动技能(mon 为 None 时仅执行增益/回复类)。"""
    g.emit("anim", "cast:" + sdef["id"])
    lv = eff_lv(g, sdef["id"])
    kind = sdef["kind"]
    if kind in ("damage", "multi"):
        total = 0.0
        for _ in range(sdef.get("hits", 1)):
            total += _skill_hit(g, mon, sdef, skill_val(sdef, lv))
        if sdef.get("lifesteal") and total > 0:
            heal = total * sdef["lifesteal"] / 100.0
            g.hero["hp"] = min(g.hero["max_hp"], g.hero["hp"] + heal)
            if heal >= 1:
                g.add_floater("✚" + fmt(heal), "bright_green")
        _apply_debuffs(g, mon, sdef)
        if sdef.get("freeze"):
            mon.stun_until = g.time + sdef["freeze"]
            g.add_floater("❄ 冻结", "bright_cyan")
        if sdef.get("mark"):
            mon.marked_pct = float(sdef["mark"])
            mon.marked_until = g.time + sdef["mark_dur"]
    elif kind == "buff":
        add_buff(g, sdef["stat"], skill_val(sdef, lv), sdef["dur"])
        g.log("%s %s!" % (sdef["icon"], sdef["name"]), sdef["color"])
    elif kind == "heal":
        heal = g.hero["max_hp"] * skill_val(sdef, lv) / 100.0
        g.hero["hp"] = min(g.hero["max_hp"], g.hero["hp"] + heal)
        g.add_floater("✚" + fmt(heal), "bright_green")
    elif kind == "shield":
        g.hero["shield"] = g.hero.get("shield", 0) \
            + g.hero["max_hp"] * skill_val(sdef, lv) / 100.0
        g.add_floater("🛡" + fmt(g.hero["shield"]), "bright_cyan")
    elif kind == "execute":
        if (mon.boss or mon.elite) and mon.hp_pct() < sdef["threshold"] / 100.0:
            mon.hp = 0
            g.add_floater("☠ 处决!", "bright_magenta")
        else:
            _skill_hit(g, mon, sdef, skill_val(sdef, lv))
            _apply_debuffs(g, mon, sdef)


def _skill_hit(g, mon, sdef, pct):
    """单次技能伤害:技能伤害乘区 + 暴击 + 通用乘区 + 无视防御"""
    from .combat import _dmg
    atk = atk_now(g)
    pierce = min(g.hero.get("armor_pierce", 0) / 100.0, 0.5)
    defv = mon.def_ * (1 - pierce)
    raw = _dmg(atk * pct / 100.0, defv)
    raw *= 1 + g.hero.get("skill_dmg", 0) / 100.0
    if sdef.get("vs_elite") and (mon.boss or mon.elite):
        raw *= sdef["vs_elite"]
    raw *= dmg_multipliers(g, mon)
    crit = sdef.get("must_crit", False) or g.rng.random() * 100 < g.hero["crit"]
    if crit:
        raw *= 1 + g.hero["crit_dmg"] / 100.0
        g.stats["crit_hits"] = g.stats.get("crit_hits", 0) + 1
        _on_crit(g)
    mon.hp -= raw
    g.emit("anim", "skill_hit")  # 与普攻 hero_attack 区分:宿主可分别配特效/音效
    g.emit("anim", "mob_flash")
    if crit:
        g.add_floater("%s 暴击 -%s" % (sdef["icon"], fmt(raw)), "bright_yellow")
    else:
        g.add_floater("%s -%s" % (sdef["icon"], fmt(raw)), "white")
    if g.hero["lifesteal"] > 0 and g.hero["hp"] < g.hero["max_hp"]:
        g.hero["hp"] = min(g.hero["max_hp"],
                           g.hero["hp"] + raw * g.hero["lifesteal"] / 100.0)
    return raw


def _on_crit(g):
    """暴击后的被动触发(狂战士/连锁反应)"""
    d = hook_def(g, "on_crit_haste")
    if d:
        add_buff(g, "haste", hook_val(g, "on_crit_haste"), d.get("dur", 3))
    if hook_def(g, "on_crit_dmg_next"):
        g.hero["next_hit_bonus"] = hook_val(g, "on_crit_dmg_next")


def _apply_debuffs(g, mon, sdef):
    if sdef.get("atk_down"):
        mon.atk_down_pct = sdef["atk_down"]
        mon.atk_down_until = g.time + sdef["atk_down_dur"]
    if sdef.get("def_down"):
        mon.def_down_pct = sdef["def_down"]
        mon.def_down_until = g.time + sdef["def_down_dur"]
