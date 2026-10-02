# -*- coding: utf-8 -*-
"""外围系统:悬赏 / 成就 / 离线懒结算 resolve / 自动换装。

resolve() 是"服务器权威结算"的雏形(P0):把一段真实时长按期望值逐杀快进,
规则(推进/退层/掉落/任务/升级)与逐 tick 战斗共用同一套状态迁移函数。
它同时服务于:CLI 离线收益、未来的服务器懒结算(P3)。
"""
from .ansi import fmt
from .combat import mob_gold, mob_xp, spawn_monster
from .data import BAL, QUEST_TYPES, RARITY_IDX
from .items import roll_item
import math


# ---------------------------------------------------------------- 悬赏任务
def roll_quest(zone, rng=None):
    import random
    rng = rng or random
    qt = rng.choice(QUEST_TYPES)
    target = max(1, int(round(qt[2] * (qt[3] ** max(0, zone - 1)))))
    t = (zone - 1) * 10
    gold_base = BAL["gold0"] + BAL["gold_k"] * (t ** BAL["gold_p"])
    gold = int(gold_base * qt[4] * (1 + rng.uniform(0, 0.3)))
    return {"type": qt[0], "target": target, "progress": 0,
            "gold": gold, "stones": qt[5]}


def quest_desc(q):
    tpl = next(t[1] for t in QUEST_TYPES if t[0] == q["type"])
    return tpl.format(n=q["target"])


# ---------------------------------------------------------------- 成就
def altar_mods(altar_lv):
    """深渊祭坛等级 → 统一修饰器(与成就同管道:先 add 后 pct 再截断;与 TS 同构)"""
    from .data import ALTAR_LINES
    mods = []
    for line in ALTAR_LINES:
        lv = altar_lv.get(line[0], 0)
        if lv <= 0:
            continue
        mods.append({"stat": line[3], "op": line[4], "v": line[5] * lv})
    return mods


def achievement_mods(stats):
    """成就永久加成 → 统一修饰器结构 [{stat, op, v}]。

    与 Game.stat_mods(外部挂口)共用同一套应用规则(先 add 后 pct 再截断),
    成就是"派生修饰"(随统计指标惰性重算),外部来源走 stat_mods 持久化。
    """
    from .data import ACHIEVEMENTS
    mods = []
    for aid, name, metric, thresholds, stat, per in ACHIEVEMENTS:
        val = stats.get(metric, 0)
        tiers = sum(1 for t in thresholds if val >= t)
        if tiers <= 0:
            continue
        v = per * tiers
        # 攻击/生命/防御 → 百分比乘法;暴击/金币加成 → 直接加值(百分点)
        op = "add" if stat in ("crit", "goldfind") else "pct"
        mods.append({"stat": stat, "op": op, "v": v})
    return mods


def achievement_tiers(aid, val):
    from .data import ACHIEVEMENTS
    for a_id, name, metric, thresholds, stat, per in ACHIEVEMENTS:
        if a_id == aid:
            return sum(1 for t in thresholds if val >= t), len(thresholds)
    return 0, 0


# ---------------------------------------------------------------- 自动换装
def auto_equip_check(game, item):
    """新掉落物品若评分明显高于当前装备则自动穿上(设置开启时)"""
    if not game.settings.get("auto_equip", True):
        return
    cur = game.equip.get(item.slot)
    if cur is None or item.score() > cur.score() * 1.05:
        game.equip_item(item, silent_if_auto=True)


# ---------------------------------------------------------------- 懒结算
def _eff_lv(g, sid):
    from .skills import eff_lv
    return eff_lv(g, sid)


def _hero_dps(g, mob_def, mob_hp, boss_or_elite):
    """期望输出分解:总 DPS、平砍每刀期望伤害、有效血量。

    技能按装配折算:增益类按覆盖率(dur/cd)折进属性,伤害类摊进 DPS
    (含 skill_dmg 乘区);条件型被动(低血/暴击触发)不折算(轻微悲观,
    与 docs/05 校准口径一致)。返回 (dps_total, per_base_hit, eff_hp)。
    """
    h = g.hero
    atk_mult = swing_div = dmg_mult = 1.0
    skill_dps = 0.0
    eff_hp = mob_hp
    skill_mult = 1 + h.get("skill_dmg", 0) / 100.0

    from .data import ACTIVE_DEF
    for sid in g.loadout["active"]:
        d = ACTIVE_DEF.get(sid)
        if d is None:
            continue
        cd = max(0.5, d["cd"] * (1 - min(h.get("cd_reduce", 0) / 100.0, 0.4)))
        kind = d["kind"]
        v = d["base"] + d["per"] * (_eff_lv(g, sid) - 1)
        if kind in ("damage", "multi"):
            dmg_pct = v * d.get("hits", 1)
            if d.get("must_crit"):
                dmg_pct *= 1 + h["crit_dmg"] / 100.0
            elif d.get("vs_elite") and boss_or_elite:
                dmg_pct *= d["vs_elite"]
            skill_dps += g.hero["atk"] * dmg_pct / 100.0 / cd * skill_mult
        elif kind == "buff":
            cov = min(1.0, d["dur"] / cd)
            stat = d["stat"]
            if stat == "atk":
                atk_mult *= 1 + v / 100.0 * cov
            elif stat == "haste":
                swing_div *= 1 + v / 100.0 * cov
            elif stat in ("dmg", "all"):
                dmg_mult *= 1 + v / 100.0 * cov
            # crit 增益影响小,不折算(悲观侧)
        elif kind == "execute":
            if boss_or_elite:
                eff_hp = mob_hp * (1 - d["threshold"] / 100.0)
            else:
                skill_dps += g.hero["atk"] * d["base"] / 100.0 / cd * skill_mult
        # heal/shield 不折算击杀速度

    atk_eff = g.hero["atk"] * atk_mult
    swing = g.hero["interval"] / (1 + g.hero["haste"] / 100.0) / swing_div
    hit = atk_eff * atk_eff / (atk_eff + max(0.0, mob_def))
    critf = 1 + (g.hero["crit"] / 100.0) * (g.hero["crit_dmg"] / 100.0)
    per_base_hit = hit * critf
    dps = per_base_hit / swing * dmg_mult + skill_dps * dmg_mult
    return dps, per_base_hit, eff_hp


def _net_incoming(g, mob_atk, mob_interval, dps, skill=None):
    """怪物的净侵血速率(扣除吸血期望回复;护盾/治疗不折算,轻微悲观)。
    怪物专属技能按冷却折算期望 DPS 计入(与在线施放口径一致)。"""
    h = g.hero
    hit = mob_atk * mob_atk / (mob_atk + max(0.0, h["def"]))
    inc = hit / mob_interval
    inc *= 1 - min(h.get("dodge", 0), 40.0) / 100.0      # 闪避期望
    if skill:
        mult = skill.get("mult", 1.0) * skill.get("hits", 1)
        inc += mob_atk * mult * 0.7 / skill.get("cd", 10)  # 0.7: 减伤口径折算
    regen = dps * h["lifesteal"] / 100.0
    return inc - regen


def _roll_knives(rng, hp, hit, p_crit, crit_mul, cap=64):
    """掷出击杀所需刀数(保留刀级随机:每刀暴击/非暴击双峰)。

    与 tick 路径同分布——连续近似会在"临界一刀/两刀"区间
    系统性低估期望刀数(E[N] 对伤害分布是凸的)。
    """
    n, rem = 0, hp
    while rem > 0 and n < cap:
        n += 1
        d = hit * (crit_mul if rng.random() < p_crit else 1.0)
        rem -= d
    return n


def resolve(g, elapsed):
    """把 elapsed 秒真实时长按期望值逐杀快进,直接修改 g。

    与逐 tick 战斗共用:retreat_stage / _advance_zone_stage / gain_xp /
    add_item / quest_progress。近似的只有伤害掷点(取期望)与
    治疗覆盖(取半程),P3 验收口径:长时段误差 < 1%。
    """
    elapsed = min(max(0.0, elapsed), BAL["offline_cap_sec"])
    remaining = elapsed
    rep = {"sec": elapsed, "kills": 0, "deaths": 0, "gold": 0, "xp": 0,
           "items": [], "levels": 0, "zones": 0}
    lv0, zone0 = g.level, g.zone
    gold0, xp0 = g.gold, g.stats.get("gold_earned", 0)
    xp_gain_total = 0
    guard = int(elapsed / 0.3) + 32   # 死循环保险丝
    while remaining > 1e-6 and guard > 0:
        guard -= 1
        if g.respawn_timer > 0:
            dt = min(remaining, g.respawn_timer)
            g.respawn_timer -= dt
            remaining -= dt
            if g.respawn_timer <= 0:
                g.hero["hp"] = g.hero["max_hp"]
            continue
        mon = spawn_monster(g.zone, g.stage, g.rng)
        dps, per_base, eff_hp = _hero_dps(g, mon.def_, mon.hp, mon.boss or mon.elite)
        swing = g.hero["interval"] / (1 + g.hero["haste"] / 100.0)
        # 击杀耗时 = 掷出的刀数 × 攻击周期;瞬发技能按战斗时长预估总量后扣除
        if dps <= 0 or per_base <= 0:
            kill_t = 10 ** 9
        else:
            t_est = eff_hp / dps
            skill_dps = max(0.0, dps - per_base / swing)
            skill_total = skill_dps * t_est
            p_crit = min(1.0, g.hero["crit"] / 100.0)
            crit_mul = 1 + g.hero["crit_dmg"] / 100.0
            base_hit = per_base / (1 + p_crit * (crit_mul - 1))  # 非暴击刀伤
            knives = _roll_knives(g.rng, max(0.0, eff_hp - skill_total),
                                  base_hit, p_crit, crit_mul)
            kill_t = max(0.3, swing * max(1, knives))
        net = _net_incoming(g, mon.atk, mon.interval, dps, mon.skill)
        ttd = g.hero["hp"] / net if net > 0 else 1e9
        if kill_t > ttd:
            # 打不过:按存活时间死亡退层
            remaining -= ttd + BAL["respawn_sec"]
            g.hero["hp"] = 0.0
            g.respawn_timer = BAL["respawn_sec"]
            g.retreat_stage()
            rep["deaths"] += 1
            continue
        remaining -= kill_t
        # 这一杀的结算(规则与 tick 路径一致)
        g.hero["hp"] = max(1.0, min(g.hero["max_hp"],
                                    g.hero["hp"] - kill_t * net
                                    + g.hero["max_hp"] * 0.08))
        g.stats["kills"] += 1
        rep["kills"] += 1
        gold = mob_gold(mon.tier) * (1 + g.hero["goldfind"] / 100.0)
        if mon.boss:
            gold *= BAL["boss_gold"]
            g.stats["boss_kills"] += 1
            g.quest_progress("boss", 1)
            if g.rng.random() < BAL["boss_stone_chance"]:
                g.stones += BAL["boss_stone_amt"]
        elif mon.elite:
            gold *= BAL["elite_gold"]
        g.gold += int(gold)
        g.stats["gold_earned"] += int(gold)
        xp = int(mob_xp(mon.tier))
        xp_gain_total += xp
        g.gain_xp(xp)
        g.quest_progress("kill", 1)
        chance = BAL["elite_drop"] if mon.elite else BAL["drop_chance"]
        if mon.boss:
            chance = BAL["boss_drop"]
        if g.rng.random() < chance:
            item = roll_item(mon.tier, rng=g.rng, luck=g.hero.get("luck", 0.0),
                             min_idx=(2 if mon.boss else 0),
                             boost=(0.6 if mon.boss else (0.25 if mon.elite else 0.0)))
            if len(rep["items"]) < BAL["offline_item_cap"]:
                rep["items"].append(item)  # 报告展示截断;游戏内照常入包
            g.add_item(item)
            if RARITY_IDX[item.rarity] >= 2:
                g.quest_progress("loot", 1)
        g._advance_zone_stage()
    g.time += elapsed
    g.playtime += elapsed
    rep["gold"] = g.gold - gold0
    rep["xp"] = xp_gain_total
    rep["levels"] = g.level - lv0
    rep["zones"] = g.zone - zone0
    # 离线期间的日志不进弹窗,清空(报告已汇总)
    g.events.clear()
    return rep


def resolve_offline(g, dt_sec):
    """启动时离线结算入口:不足阈值返回 None,报告交给弹窗展示。"""
    if dt_sec < BAL["offline_min_sec"]:
        return None
    rep = resolve(g, dt_sec)
    if rep["kills"] <= 0 and rep["deaths"] <= 0 and rep["gold"] <= 0:
        return None
    return rep
