# -*- coding: utf-8 -*-
"""爬塔副本:独立怪物曲线 / 进层 / 结算 / 钥匙管理"""
import random

from .ansi import fmt
from .combat import Monster, _dmg, mob_gold
from .data import ART, MONSTERS, RARITY_IDX, THEMES, TOWER, BAL
from .relics import roll_relic


def tower_monster(floor, rng=None):
    """塔系怪物:独立曲线,每 boss_every 层一个头目"""
    rng = rng or random
    t = TOWER
    boss = floor % t["boss_every"] == 0
    # 从全局怪物池随机(视觉多样性)
    keys = list(MONSTERS.keys())
    key = rng.choice(keys)
    name, color, power = MONSTERS[key][0], MONSTERS[key][1], MONSTERS[key][2]

    hp = t["th0"] + t["thk"] * (floor ** t["thp"])
    atk = t["ta0"] + t["tak"] * (floor ** t["tap"])
    dfn = t["td0"] + t["tdk"] * (floor ** t["tdp"])
    interval = 1.6

    if boss:
        hp *= 3.0
        atk *= 1.3
        color = "bright_yellow"
        name = "塔·%s" % name

    return Monster(name, ART[key], color, hp, atk, dfn, interval, boss, False, floor, None, key)


def tower_relic_tier(floor):
    """1-10关 → tier 10, 11-20关 → tier 20 ..."""
    return ((floor - 1) // 10 + 1) * 10


def tower_gold(floor):
    """塔金币(相对主线同 tier 怪 × drop_gold_mult)"""
    t = tower_relic_tier(floor)
    return mob_gold(t) * TOWER["drop_gold_mult"]


def roll_tower_drop(floor, rng, luck=0.0, loadout=None):
    """塔掉落:必掉 1 件遗物,头目层保底稀有;luck 影响稀有度权重"""
    boss = floor % TOWER["boss_every"] == 0
    min_idx = 2 if boss else 0
    tier = tower_relic_tier(floor)
    return roll_relic(tier, rng=rng, min_idx=min_idx, loadout=loadout, luck=luck)


def refresh_keys(tower_state, now_ts):
    """每天刷新钥匙(可囤积,上限 keys_cap)。返回获得数。"""
    import datetime
    today = datetime.datetime.fromtimestamp(now_ts).date()
    last = tower_state.get("last_refresh")
    if last is None:
        tower_state["last_refresh"] = str(today)
        tower_state["keys"] = TOWER["keys_per_day"]
        return TOWER["keys_per_day"]
    last_date = datetime.date.fromisoformat(str(last))
    days = (today - last_date).days
    if days <= 0:
        return 0
    gained = min(days * TOWER["keys_per_day"], TOWER["keys_cap"] - tower_state.get("keys", 0))
    tower_state["keys"] = min(tower_state.get("keys", 0) + gained, TOWER["keys_cap"])
    tower_state["last_refresh"] = str(today)
    return gained
