# -*- coding: utf-8 -*-
"""战斗引擎:怪物生成 / 自动战斗 / 技能施放(按装配)/ 被动钩子 / 掉落结算。

随机性约定:所有掷点走 game.rng(角色种子),保证同 seed 可复现;
表现层效果(飘字/互撞动画)通过事件发出,由宿主 View 消费。
"""
from .ansi import fmt
from .data import ART, BAL, MONSTERS, ACTIVE_DEF, THEMES
from .items import roll_item
from . import skills as S
import random as _random


class Monster:
    __slots__ = ("name", "art", "color", "hp", "max_hp", "atk", "def_", "interval",
                 "boss", "elite", "tier", "atk_timer", "stun_until",
                 "marked_pct", "marked_until",
                 "atk_down_pct", "atk_down_until", "def_down_pct", "def_down_until",
                 "skill", "skill_timer", "id")

    def __init__(self, name, art, color, hp, atk, def_, interval, boss, elite, tier,
                 skill=None, mid=""):
        self.name, self.art, self.color = name, art, color
        self.hp = self.max_hp = hp
        self.atk, self.def_, self.interval = atk, def_, interval
        self.boss, self.elite, self.tier = boss, elite, tier
        self.skill = skill or {}
        self.skill_timer = (self.skill.get("cd", 10) * 0.5)  # 半 CD 后首放
        self.atk_timer = 0.0
        self.stun_until = 0.0
        self.marked_pct = 0.0
        self.marked_until = 0.0
        self.atk_down_pct = 0.0
        self.atk_down_until = 0.0
        self.def_down_pct = 0.0
        self.def_down_until = 0.0
        self.id = mid   # 怪物图鉴 id(供 Web 宿主映射立绘;不参与任何计算)

    def hp_pct(self):
        return self.hp / self.max_hp if self.max_hp else 0.0


def zone_theme(zone):
    name, mobs, boss, color = THEMES[(zone - 1) % len(THEMES)]
    cycle = (zone - 1) // len(THEMES)
    if cycle > 0:
        name = "%s·%s" % (name, "深度" + str(cycle + 1))
    return name, mobs, boss, color


def tier_of(zone, stage):
    return (zone - 1) * 10 + (stage - 1)


def mob_gold(tier):
    return BAL["gold0"] + BAL["gold_k"] * (tier ** BAL["gold_p"])


def mob_xp(tier):
    return BAL["xp0"] + BAL["xp_k"] * (tier ** BAL["xp_p"])


def spawn_monster(zone, stage, rng=None, hero_gear_tier=None):
    rng = rng or _random
    tier = tier_of(zone, stage)
    theme_name, pool, boss_name, theme_color = zone_theme(zone)
    boss = stage >= 10
    key = rng.choice(pool)
    name, color, power, skill = MONSTERS[key]
    hp = (BAL["mob_hp0"] + BAL["mob_hp_k"] * (tier ** BAL["mob_hp_p"])) * power
    atk = (BAL["mob_atk0"] + BAL["mob_atk_k"] * (tier ** BAL["mob_atk_p"])) * power
    # 等级压制:怪物tier超过装备最高tier 100+,每差100 → 全属性×2(叠乘)
    if hero_gear_tier is not None:
        gap = tier - hero_gear_tier
        if gap > BAL["gear_gap_base"]:
            pressure = BAL["gear_gap_mult"] ** ((gap - BAL["gear_gap_base"]) / 100.0)
            hp *= pressure
            atk *= pressure
    dfn = BAL["mob_def0"] + BAL["mob_def_k"] * (tier ** BAL["mob_def_p"])
    elite = False
    interval = BAL["mob_interval"]
    if boss:
        # 头目:血厚、攻速减半(蓄力重击)——开局也可凭生存磨过
        name, hp, atk, color = boss_name, hp * BAL["boss_hp"], atk * BAL["boss_atk"], "bright_yellow"
        interval = BAL["boss_interval"]
        skill = dict(name="灭世之击", icon="☄", cd=12, mult=3.0, hits=1, stun=1.5)
    elif zone > 1 and rng.random() < BAL["elite_chance"]:  # 第1区不刷精英,保护开局
        elite = True
        hp *= BAL["elite_hp"]
        atk *= BAL["elite_atk"]
        color = "bright_green"
    return Monster(name, ART[key], color, hp, atk, dfn, interval, boss, elite, tier, skill, key)


# ---------------------------------------------------------------- 伤害公式
def _dmg(atk_val, def_val):
    """平滑减伤:atk²/(atk+def),永不归零、随成长同步缩放"""
    if atk_val <= 0:
        return 0.0
    return atk_val * atk_val / (atk_val + max(0.0, def_val))


def battle_tick(game, dt):
    """推进战斗一帧(dt 秒)。所有事件通过 game 的事件钩子落地。"""
    h = game.hero
    mon = game.monster

    # 复活倒计时
    if game.respawn_timer > 0:
        game.respawn_timer -= dt
        if game.respawn_timer <= 0:
            h["hp"] = h["max_hp"]
            game.log("你重新站了起来,继续战斗!", "bright_yellow")
        return
    if h["hp"] <= 0:
        return
    S.tick_buffs(game)
    if mon is None:
        return

    # 技能自动施放(按装配)
    _cast_skills(game, dt, mon)

    # 英雄攻击(含动态攻速buff;被眩晕时跳过)
    if h.get("stun_until", 0) > game.time:
        pass
    else:
        h["atk_timer"] += dt
        interval = h["interval"] / (1 + (h["haste"] + S.buff_pct(game, "haste")) / 100.0)
        if h.get("slow_until", 0) > game.time:
            # 减速拉长攻击间隔;钳制最多 ×4,防多来源叠出无限慢
            interval /= max(0.25, 1 - h.get("slow_pct", 0) / 100.0)
        while h["atk_timer"] >= interval:
            h["atk_timer"] -= interval
            _hero_attack(game, mon)

    if mon.hp <= 0:
        _on_monster_killed(game, mon)
        return

    # 怪物攻击(冻结/闪避/护盾/不屈)
    if mon.stun_until > game.time:
        return
    # 专属主动技能:冷却好了优先施放(代替该次普攻)
    if mon.skill:
        mon.skill_timer += dt
        if mon.skill_timer >= mon.skill.get("cd", 10):
            mon.skill_timer = 0.0
            _cast_monster_skill(game, mon)
            if h["hp"] <= 0:
                _on_hero_death(game)
                return
            return  # 技能回合不接普攻
    mon.atk_timer += dt
    while mon.atk_timer >= mon.interval:
        mon.atk_timer -= mon.interval
        _monster_attack(game, mon)
        if h["hp"] <= 0:
            _on_hero_death(game)
            return


def _hero_attack(game, mon):
    h = game.hero
    atk = S.atk_now(game)
    if h.get("atkdown_until", 0) > game.time:
        atk *= 1 - h.get("atkdown_pct", 0) / 100.0
    pierce = min(h.get("armor_pierce", 0) / 100.0, 0.5)
    defv = mon.def_
    if mon.def_down_until > game.time:
        defv *= 1 - mon.def_down_pct / 100.0
    defv *= 1 - pierce
    dmg = _dmg(atk, defv)
    crit = game.rng.random() * 100 < h["crit"]
    if crit:
        dmg *= 1 + h["crit_dmg"] / 100.0
        game.stats["crit_hits"] = game.stats.get("crit_hits", 0) + 1
    dmg *= S.dmg_multipliers(game, mon)
    mon.hp -= dmg
    game.emit("anim", "hero_attack")
    game.emit("anim", "mob_flash")
    if crit:
        game.add_floater("暴击 -" + fmt(dmg), "bright_yellow")
        S._on_crit(game)
        # 遗物:暴击追击
        ce = h.get("crit_extra", 0)
        if ce > 0 and game.rng.random() * 100 < ce:
            extra = _dmg(atk, mon.def_ * (1 - pierce))
            mon.hp -= extra
            game.add_floater("⚡追击 -" + fmt(extra), "bright_cyan")
    else:
        game.add_floater("-" + fmt(dmg), "white")
    if h["lifesteal"] > 0 and h["hp"] < h["max_hp"]:
        h["hp"] = min(h["max_hp"], h["hp"] + dmg * h["lifesteal"] / 100.0)


def _cast_monster_skill(game, mon):
    """怪物专属主动技能:多段伤害 + 附加效果(吸血/降防/降攻/眩晕)"""
    h = game.hero
    sk = mon.skill
    atk = mon.atk
    if mon.atk_down_until > game.time:
        pass  # 怪物自己不受 debuff
    total = 0.0
    # 英雄防御 debuff 生效于本次结算
    defv = h["def"]
    if h.get("defdown_until", 0) > game.time:
        defv *= 1 - h.get("defdown_pct", 0) / 100.0
    for _i in range(int(sk.get("hits", 1))):
        total += _dmg(atk * sk.get("mult", 1.0), defv)
    # 护盾吸收
    shield = h.get("shield", 0.0)
    if shield > 0:
        absorb = min(shield, total)
        h["shield"] = shield - absorb
        total -= absorb
    h["hp"] -= total
    game.add_floater("%s -%s" % (sk.get("icon", ""), fmt(total)), "bright_red")
    game.log("敌方 %s 施放了【%s】!" % (mon.name, sk.get("name", "技能")), "bright_red")
    if sk.get("lifesteal") and total > 0:
        mon.hp = min(mon.max_hp, mon.hp + total)
        game.add_floater("+" + fmt(total), "magenta")
    if sk.get("defdown"):
        pct_v, dur = sk["defdown"]
        h["defdown_pct"] = pct_v
        h["defdown_until"] = game.time + dur
    if sk.get("atkdown"):
        pct_v, dur = sk["atkdown"]
        h["atkdown_pct"] = pct_v
        h["atkdown_until"] = game.time + dur
    if sk.get("stun"):
        h["stun_until"] = game.time + sk["stun"]
        game.add_floater("⛔ 眩晕", "bright_red")
    if sk.get("slow"):
        pct_v, dur = sk["slow"]
        h["slow_pct"] = pct_v
        h["slow_until"] = game.time + dur
        game.add_floater("🐌 减速", "bright_red")
    # 不屈判定
    # 遗物:不死(独立判定,60s CD)
    if h["hp"] <= 0 and h.get("deathward", 0) > 0:
        dw_ready = h.get("deathward_at", -999.0)
        if game.time - dw_ready >= 60.0                 and game.rng.random() * 100 < h["deathward"]:
            h["hp"] = 1.0
            h["deathward_at"] = game.time
            game.add_floater("🛡不死!", "bright_cyan")
            game.log("遗物·不死!致命一击被挡下。", "bright_cyan")
    if h["hp"] <= 0 and S.hook_def(game, "undying"):
        ready = h.get("undying_at", -999.0)
        if game.time - ready >= BAL["undying_cd"]                 and game.rng.random() * 100 < S.hook_val(game, "undying"):
            h["hp"] = 1.0
            h["undying_at"] = game.time
            game.add_floater("不屈!", "bright_yellow")


def _cast_skills(game, dt, mon):
    h = game.hero
    cd_cut = 1 - min(h.get("cd_reduce", 0) / 100.0, 0.4)
    for sid in game.loadout["active"]:
        d = ACTIVE_DEF.get(sid)
        if d is None:
            continue
        cd = game.skill_cd.get(sid, 0.0)
        if cd > 0:
            game.skill_cd[sid] = cd - dt
            if game.skill_cd[sid] > 0:
                continue
        if d["kind"] == "heal" and h["hp"] >= h["max_hp"] * 0.6:
            continue  # 治疗只在缺血时施放
        S.cast_active(game, d, mon)
        game.skill_cd[sid] = d["cd"] * cd_cut


def _monster_attack(game, mon):
    h = game.hero
    # 闪避(疾风步)
    dodge = min(h.get("dodge", 0), 40.0)
    if dodge > 0 and game.rng.random() * 100 < dodge:
        game.add_floater("闪避", "bright_cyan")
        return
    atk = mon.atk
    if mon.atk_down_until > game.time:
        atk *= 1 - mon.atk_down_pct / 100.0
    defv = h["def"]
    if h.get("defdown_until", 0) > game.time:
        defv *= 1 - h.get("defdown_pct", 0) / 100.0
    raw = _dmg(atk, defv)
    # 护盾吸收
    shield = h.get("shield", 0.0)
    if shield > 0:
        absorb = min(shield, raw)
        h["shield"] = shield - absorb
        raw -= absorb
        if absorb >= 1:
            game.add_floater("🛡-" + fmt(absorb), "bright_cyan")
    if raw <= 0:
        return
    h["hp"] -= raw
    game.add_floater("-" + fmt(raw), "red")
    game.emit("anim", "mob_attack")
    # 不屈:致命伤概率保留1血(内置CD)
    # 遗物:不死(独立判定,60s CD)
    if h["hp"] <= 0 and h.get("deathward", 0) > 0:
        dw_ready = h.get("deathward_at", -999.0)
        if game.time - dw_ready >= 60.0                 and game.rng.random() * 100 < h["deathward"]:
            h["hp"] = 1.0
            h["deathward_at"] = game.time
            game.add_floater("🛡不死!", "bright_cyan")
            game.log("遗物·不死!致命一击被挡下。", "bright_cyan")
    if h["hp"] <= 0 and S.hook_def(game, "undying"):
        ready = h.get("undying_at", -999.0)
        if game.time - ready >= BAL["undying_cd"] \
                and game.rng.random() * 100 < S.hook_val(game, "undying"):
            h["hp"] = 1.0
            h["undying_at"] = game.time
            game.add_floater("不屈!", "bright_yellow")
            game.log("不屈!你在致命一击下坚持了下来。", "bright_yellow")
    # 复仇(受击增伤)
    d = S.hook_def(game, "on_hurt_dmg")
    if d:
        S.add_buff(game, "dmg", S.hook_val(game, "on_hurt_dmg"), d.get("dur", 4))


def _on_monster_killed(game, mon):
    h = game.hero
    # 击杀用时 EMA(用于统计展示)
    if game.last_spawn_time is not None:
        kt = max(0.5, game.time - game.last_spawn_time)
        game.ema_kill = game.ema_kill * 0.7 + kt * 0.3 if game.ema_kill else kt

    gold_mul = 1 + (h["goldfind"] + S.buff_pct(game, "gold")) / 100.0
    gold = mob_gold(mon.tier) * gold_mul
    if mon.boss:
        gold *= BAL["boss_gold"]
    elif mon.elite:
        gold *= BAL["elite_gold"]

    game.stats["kills"] += 1
    # 击杀回血(放置标配):回复 8% 最大生命
    game.hero["hp"] = min(game.hero["max_hp"],
                          game.hero["hp"] + game.hero["max_hp"] * 0.08)
    game.gold += int(gold)
    game.stats["gold_earned"] += int(gold)
    if mon.boss:
        game.stats["boss_kills"] += 1
        if game.rng.random() < BAL["boss_stone_chance"]:
            game.stones += BAL["boss_stone_amt"]
    game.gain_xp(int(mob_xp(mon.tier) * (1 + (h.get("xp_pct", 0)
        + S.buff_pct(game, "xp")) / 100.0)))
    game.quest_progress("kill", 1)
    if mon.boss:
        game.quest_progress("boss", 1)

    # 杀戮盛宴:击杀后增益(被动技能)
    d = S.hook_def(game, "on_kill_buff")
    if d:
        S.add_buff(game, d["stat"], S.hook_val(game, "on_kill_buff"), d.get("dur", 4))
    # 遗物:击杀回血 + 杀意攻速
    kh = h.get("kill_heal", 0)
    if kh > 0:
        game.hero["hp"] = min(game.hero["max_hp"],
                              game.hero["hp"] + game.hero["max_hp"] * kh / 100.0)
    ks = h.get("kill_haste", 0)
    if ks > 0:
        S.add_buff(game, "haste", ks, 4)

    # 掉落
    drop_chance = BAL["drop_chance"]
    if mon.elite:
        drop_chance = BAL["elite_drop"]
    if mon.boss:
        drop_chance = BAL["boss_drop"]
    if game.rng.random() < drop_chance:
        min_idx = 2 if mon.boss else 0
        boost = 0.6 if mon.boss else (0.25 if mon.elite else 0.0)
        item = roll_item(mon.tier, rng=game.rng, luck=h.get("luck", 0.0),
                         min_idx=min_idx, boost=boost, cls=game.class_id)
        game.add_item(item)
        from .data import RARITY_IDX
        if RARITY_IDX[item.rarity] >= 2:
            game.quest_progress("loot", 1)
        # 紫色(epic)或更好:发掉落光柱事件(宿主表现层用,纯视觉)
        if RARITY_IDX[item.rarity] >= 3:
            game.emit("anim", "loot:" + item.rarity)

    if game.in_tower:
        game.monster = mon  # 保留引用给 tower_exit 用
        game.tower_exit(won=True)
        return
    if mon.boss:
        game.log("♛ 击败头目 %s!前进到新区域!" % mon.name, "bright_yellow")
    game.monster = None
    game.advance_stage()


def _on_hero_death(game):
    game.hero["hp"] = 0
    game.hero["shield"] = 0.0
    game.respawn_timer = BAL["respawn_sec"]
    if game.in_tower:
        game.tower_exit(won=False)
        return
    game.log("☠ 你被击败了…%d 秒后复活" % int(BAL["respawn_sec"]), "bright_red")
    game.retreat_stage()
    game.monster = None
