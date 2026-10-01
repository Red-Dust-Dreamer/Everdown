# -*- coding: utf-8 -*-
"""现代 Web UI 宿主桥接层(与 legacy/xterm 桥并列,二者共用 abyss 核心与存档键)。

职责仅限 IO 适配:localStorage 存档、全量快照序列化 state()、
事件队列导出 events()、指令分发 cmd()。游戏逻辑全部来自 abyss/ 核心包。
"""
import json
import math
import re
import time

from js import localStorage

from abyss import systems
from abyss import data as D
from abyss.game import Game, migrate_save
from abyss.items import plus_bonus
from abyss.skills import eff_lv, skill_val

SAVE_KEY = "abyss_save_v2"
PCT_STATS = ("haste", "crit", "crit_dmg", "goldfind", "lifesteal")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")   # 核心 display() 带 ANSI 色,DOM 层不需要

_g = None


def _fmtv(v):
    v = float(v)
    return ("%.0f" % v) if v >= 100 else (("%.1f" % v).rstrip("0").rstrip("."))


def _item_ui(it):
    """Item → 无 ANSI 的展示 dict(背包/装备/离线掉落共用)。"""
    rid = D.RARITY_IDX[it.rarity]
    slot_def = D.SLOTS[D.SLOT_IDX[it.slot]]
    mstat = slot_def[2]
    st = it.stats()
    affixes = []
    for aid, _ in it.affixes:
        a = D.AFFIX_DEF[aid]
        affixes.append({"name": a[1], "val": round(st.get(aid, 0), 1),
                        "pct": bool(a[5])})
    innate = None
    inn = D.SLOT_INNATE.get(it.slot)
    if inn:
        k, per = inn
        innate = {"name": D.STAT_NAMES[k],
                  "val": round(per * rid * (1 + plus_bonus(it.plus)), 1)}
    dgold, dstones = it.dismantle()
    pb = plus_bonus(it.plus)
    pb_next = plus_bonus(it.plus + 1) - pb
    return {
        "name": it.name, "rarity": it.rarity, "rid": rid,
        "rname": D.RARITY_NAMES_CN[rid], "rcolor": D.RARITIES[rid][2],
        "slot": it.slot, "slot_name": slot_def[1],
        "plus": it.plus, "tier": it.tier,
        "main": {"name": D.STAT_NAMES[mstat], "val": round(st.get(mstat, 0), 1),
                 "pct": mstat in PCT_STATS},
        "affixes": affixes, "innate": innate,
        "score": int(it.score()),
        "sell": it.sell_price(), "ecost": it.enhance_cost(),
        "dgold": dgold, "dstones": dstones,
        "pb": round(pb * 100, 1), "pb_next": round(pb_next * 100, 1),
    }


def _skill_ui(g, d):
    sid = d["id"]
    lv = g.skill_lv.get(sid, 1)
    el = eff_lv(g, sid)
    txt = d["desc"].replace("{v}", _fmtv(skill_val(d, el)))
    return {
        "id": sid, "name": d["name"], "icon": d.get("icon", "◆"),
        "kind": d.get("kind", ""), "unlock": d["unlock"],
        "cd": d.get("cd", 0), "color": d.get("color", ""),
        "lv": lv, "eff": el, "desc": txt,
        "cost": g.skill_cost(sid),
        "equipped": sid in g.loadout["active"] or sid in g.loadout["passive"],
        "unlocked": g.level >= d["unlock"],
    }


# ---------------------------------------------------------------- 启动 / 存档
def boot():
    """读 localStorage 存档(含离线结算)或开新档。"""
    global _g
    raw = localStorage.getItem(SAVE_KEY)
    if raw:
        try:
            d = migrate_save(json.loads(str(raw)))
            g = Game.from_dict(d)
            dt = time.time() - d.get("last_saved", time.time())
            rep = systems.resolve_offline(g, dt)
            if rep:
                g.pending_offline = rep
        except Exception:
            g = Game()
            g.log("存档读取失败,已重新开始。", "bright_red")
    else:
        g = Game()
    _g = g
    return True


def tick(dt):
    """按 0.1s 固定步长推进(与 CLI/legacy 宿主一致;暂停由 JS 宿主控制)。"""
    steps = 0
    while dt >= 0.1 and steps < 10:
        _g.tick(0.1)
        dt -= 0.1
        steps += 1
    return True


def get_save():
    return json.dumps(_g.to_dict(), ensure_ascii=False)


def save_now():
    localStorage.setItem(SAVE_KEY, get_save())
    return True


def import_save(json_text):
    global _g
    try:
        d = migrate_save(json.loads(json_text))
    except Exception:
        _g.toast("导入失败:存档格式不正确")
        return False
    g = Game.from_dict(d)
    _g = g
    save_now()
    g.toast("导入成功:Lv.%d 第%d区·%d层" % (g.level, g.zone, g.stage))
    return True


def resolve_gap(sec):
    """页面从后台恢复:懒结算补算离开期间(与离线结算同一路径)。"""
    sec = min(max(0.0, sec), 12 * 3600)
    if sec < 30:
        return "0"
    rep = systems.resolve(_g, sec)
    _g.toast("页面离开 %d 分:补算 %d 击杀 +%d 金币" % (
        sec // 60, rep["kills"], rep["gold"]))
    return "%d|%d|%d" % (rep["kills"], rep["gold"], rep["levels"])


def debug_state():
    return "t=%.0fs Lv%d %d区·%d层 kills=%d hp=%d/%d" % (
        _g.time, _g.level, _g.zone, _g.stage, _g.stats["kills"],
        int(_g.hero["hp"]), int(_g.hero["max_hp"]))


# ---------------------------------------------------------------- 快照 / 事件
def state():
    """全量状态快照(JSON 文本)。JS 宿主每帧解析渲染。"""
    g = _g
    h = g.hero
    cls = D.CLASSES.get(g.class_id) or {}
    theme = D.THEMES[(g.zone - 1) % len(D.THEMES)]
    cycle = (g.zone - 1) // len(D.THEMES) + 1

    dps = g.theoretical_dps()
    if not math.isfinite(dps):
        dps = 0.0
    hero = {"hp": h["hp"], "max_hp": h["max_hp"], "shield": h.get("shield", 0.0),
            "atk": h["atk"], "def": h["def"], "haste": h["haste"],
            "crit": h["crit"], "crit_dmg": h["crit_dmg"],
            "lifesteal": h["lifesteal"], "goldfind": h["goldfind"],
            "dodge": h.get("dodge", 0), "armor_pierce": h.get("armor_pierce", 0),
            "skill_dmg": h.get("skill_dmg", 0), "cd_reduce": h.get("cd_reduce", 0),
            "xp_pct": h.get("xp_pct", 0), "skill_lv": int(h.get("skill_lv", 0)),
            "interval": h["interval"], "dps": dps}

    mon = g.monster
    monster = None
    if mon is not None:
        monster = {"name": mon.name, "art": list(mon.art),
                   "hp": mon.hp, "max_hp": mon.max_hp, "tier": mon.tier,
                   "boss": mon.boss, "elite": mon.elite,
                   "atk": mon.atk, "def": mon.def_, "color": mon.color}

    skills = {"active": [], "passive": []}
    if g.class_id:
        for which, pool in (("active", D.ACTIVE_SKILLS), ("passive", D.PASSIVE_SKILLS)):
            skills[which] = [_skill_ui(g, s) for s in pool if s["cls"] == g.class_id]

    buffs = [{"key": k, "name": D.STAT_NAMES.get(k, k), "pct": b["pct"],
              "remain": round(max(0.0, b["until"] - g.time), 1)}
             for k, b in g.buffs.items() if b["until"] > g.time]

    quests = [{"desc": systems.quest_desc(q), "type": q["type"],
               "progress": min(q["progress"], q["target"]),
               "target": q["target"], "gold": q["gold"], "stones": q["stones"]}
              for q in g.quests]

    ach = []
    for aid, name, metric, ths, stat, per in D.ACHIEVEMENTS:
        val = g.stats.get(metric, 0)
        tiers = sum(1 for t in ths if val >= t)
        ach.append({"id": aid, "name": name, "val": int(val),
                    "tiers": tiers, "total": len(ths),
                    "stat": D.STAT_NAMES.get(stat, stat), "per": per,
                    "bonus": per * tiers,
                    "next": ths[tiers] if tiers < len(ths) else None})

    po = None
    if g.pending_offline:
        r = g.pending_offline
        po = {"sec": r.get("sec", 0), "kills": r.get("kills", 0),
              "deaths": r.get("deaths", 0), "gold": r.get("gold", 0),
              "xp": r.get("xp", 0), "levels": r.get("levels", 0),
              "zones": r.get("zones", 0),
              "items": [_item_ui(it) for it in r.get("items", [])]}

    out = {
        "class_id": g.class_id,
        "cls": {"name": cls.get("name", ""), "icon": cls.get("icon", ""),
                "desc": cls.get("desc", ""), "color": cls.get("color", "")},
        "level": g.level, "xp": g.xp, "xp_req": g.xp_req(),
        "gold": g.gold, "stones": g.stones,
        "playtime": g.playtime, "time": g.time,
        "zone": g.zone, "stage": g.stage,
        "stage_kills": g.stage_kills, "kills_per_stage": D.BAL["kills_per_stage"],
        "mode": g.mode, "farm_stage": g.farm_stage,
        "zone_name": theme[0], "zone_boss": theme[2],
        "zone_cycle": cycle if g.zone > len(D.THEMES) else 0,
        "respawn": g.respawn_timer, "ema_kill": g.ema_kill,
        "hero": hero, "monster": monster, "buffs": buffs,
        "equip": {s: _item_ui(it) for s, it in g.equip.items()},
        "bag": [_item_ui(it) for it in g.bag],
        "bag_size": D.BAL["bag_size"],
        "quests": quests, "achievements": ach,
        "loadout": {"active": list(g.loadout["active"]),
                    "passive": list(g.loadout["passive"])},
        "loadout_slots": g.loadout_slots(),
        "loadout_unlock": list(D.BAL["loadout_unlock"]),
        "skills": skills,
        "skill_cd": {sid: round(v, 1) for sid, v in g.skill_cd.items() if v > 0},
        "stats": dict(g.stats),
        "settings": dict(g.settings),
        "reforge_stones": D.BAL["reforge_stones"],
        "pending_offline": po,
        "hero_art": list(D.ART["hero"]),
    }
    return json.dumps(out, ensure_ascii=False)


def events():
    """导出并清空累积事件(日志/飘字/toast/动画)。文本剥离 ANSI 转义。"""
    out = [{"kind": k, "text": _ANSI.sub("", t), "color": c} for (k, t, c) in _g.events]
    _g.events.clear()
    return json.dumps(out, ensure_ascii=False)


# ---------------------------------------------------------------- 指令分发
def cmd(name, a=None, b=None):
    """UI 指令入口。a/b 为字符串参数(槽位/技能id/索引等)。"""
    global _g
    g = _g
    if name == "choose_class":
        if a in D.CLASSES:
            g.choose_class(a)
    elif name == "mode":
        g.set_mode("farm" if g.mode == "push" else "push")
    elif name == "farm_stage":
        g.set_farm_stage(1 if a == "1" else -1)
    elif name == "enhance":
        g.enhance(a)
    elif name == "reforge":
        g.reforge(a)
    elif name == "unequip":
        g.unequip(a)
    elif name == "equip":
        i = int(a)
        if 0 <= i < len(g.bag):
            g.equip_item(g.bag[i])
    elif name == "sell":
        g.sell_item(int(a))
    elif name == "dismantle":
        g.dismantle_item(int(a))
    elif name == "sell_junk":
        g.sell_junk()
    elif name == "equip_skill":
        g.equip_skill(a, b)
    elif name == "unequip_skill":
        g.unequip_skill(a)
    elif name == "skill_up":
        g.skill_up(a)
    elif name == "auto_equip":
        g.settings["auto_equip"] = not g.settings.get("auto_equip", True)
        g.toast("自动换装:开" if g.settings["auto_equip"] else "自动换装:关")
    elif name == "auto_sell":
        g.settings["auto_sell_idx"] = max(-1, min(4, int(a)))
        g.toast("掉落自动出售已更新")
    elif name == "dismiss_offline":
        g.pending_offline = None
    elif name == "reset":
        localStorage.removeItem(SAVE_KEY)
        _g = Game()
    return True
