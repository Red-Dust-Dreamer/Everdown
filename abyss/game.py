# -*- coding: utf-8 -*-
"""Game:无 UI 依赖的游戏状态机(P0 核心)。

约定:
- 一切呈现输出(日志/飘字/toast/动画)通过 events 队列发出,
  由宿主消费:CLI 挂 View(drain),服务器(P3)聚合为 EventsSummary;
- 一切随机性走 self.rng(角色创建时播种并随存档保存)→ 同 seed 同结果;
- 宿主可把 View 挂到 self.view,但核心代码不读不写它。
"""
import json
import random
import time
from pathlib import Path

from .ansi import c, fmt
from .combat import battle_tick, spawn_monster, tier_of
from .data import (ACTIVE_DEF, ACTIVE_SKILLS, BAL, CAPS, CLASSES, PASSIVE_DEF, TOWER,
                   PASSIVE_SKILLS, RARITY_IDX, SLOTS)
from .items import Item, roll_item
from . import systems
from . import skills as S
from . import relics as RL
from . import tower as TW

SAVE_PATH = Path(__file__).resolve().parent.parent / "save.json"
SAVE_VERSION = 5
EVENT_CAP = 2000
VIRTUAL_STATS = ("skill_dmg", "cd_reduce", "dodge", "armor_pierce", "xp_pct",
                 "all_skill_lv", "crit_extra", "kill_heal", "deathward",
                 "boss_dmg_r", "kill_haste")


class Game:
    def __init__(self, seed=None, rng=None):
        """rng:可选注入的 random.Random 兼容实例(审计/对拍用),默认行为不变"""
        self.seed = seed if seed is not None else random.SystemRandom().randrange(2 ** 31)
        self.rng = rng or random.Random(self.seed)
        self.time = 0.0            # 游戏内秒
        self.playtime = 0.0
        self.gold = 0
        self.stones = 0            # 重铸石
        self.level = 1
        self.xp = 0
        self.zone = 1
        self.stage = 1
        self.stage_kills = 0
        self.deaths_row = 0
        self.mode = "push"         # push / farm
        self.farm_stage = 1
        self.equip = {}            # slot -> Item
        self.bag = []              # [Item] 最新在前
        # ---- 职业与技能 ----
        self.class_id = None                    # 待选择(渲染层弹职业选择)
        self.loadout = {"active": [], "passive": []}   # 各至多4个已装配技能id
        self.skill_lv = {}                      # 技能id -> 自主升级等级
        self.skill_cd = {s["id"]: 0.0 for s in ACTIVE_SKILLS}
        self.buffs = {}            # {stat: {pct, until}} 动态增益(瞬态)
        self.stats = {"kills": 0, "boss_kills": 0, "deaths": 0,
                      "enhance_total": 0, "gold_earned": 0, "max_zone": 1,
                      "reforge_total": 0, "quest_done": 0}
        self.settings = {"auto_equip": True, "auto_sell_idx": -1}
        self.quests = []
        self.quest_daily_count = 0   # 今日已完成悬赏数(上限 BAL["quest_daily_limit"])
        self.quest_daily_date = ""   # 本地日期 %Y-%m-%d,跨日重置计数
        self.events = []           # [(kind, text, color)] 宿主 drain
        self.view = None           # CLI 宿主挂载,核心不读写
        # 特殊属性修饰器(统一挂口):任何渠道想给属性,调 add_stat_mod 即可,
        # recalc_hero 统一应用。成就走 systems.achievement_mods 派生,
        # 被动技能走 skills.passive_mods 派生,不占此列表;
        # 未来属性丹/悬赏奖励/公会buff等外部来源用这里。
        self.stat_mods = []        # [{src, stat, op('add'|'pct'), v}]
        # ---- 遗物 & 塔 ----
        self.relics = [None, None, None, None]   # 4 槽
        self.tower = {"keys": 3, "max_floor": 0, "last_refresh": None}
        self.tower_floor_sel = 1                  # UI:当前选中要打的层
        self.in_tower = False                     # 当前在塔战斗中
        self.monster = None        # 瞬态:不存档,加载后重生
        self.respawn_timer = 0.0
        self.last_spawn_time = None
        self.ema_kill = 0.0
        self.last_death_time = -999.0
        self.pending_offline = None
        self.autosave_acc = 0.0
        self.hero = {}
        self.recalc_hero()
        self.hero["hp"] = self.hero["max_hp"]
        self.log("欢迎来到深渊。先选择你的职业。", "bright_cyan")
        self.quests = [systems.roll_quest(1, self.rng) for _ in range(3)]

    # ================================================================ 事件
    def emit(self, kind, text, color=""):
        if len(self.events) < EVENT_CAP:
            self.events.append((kind, text, color))

    def log(self, text, color="white"):
        self.emit("log", text, color)

    def toast(self, text):
        self.emit("toast", text)

    def add_floater(self, text, color):
        self.emit("floater", text, color)

    # ================================================================ 属性修饰器(挂口)
    def add_stat_mod(self, src, stat, op, v):
        """注册属性修饰:op='add' 直接加值(百分比属性=百分点);op='pct' 乘 (1+v/100)。
        同 src 同 stat 重复注册为替换。来源示例:'potion:123' / 'quest:45' / 'guild:buff_x'。
        应用顺序:先全体 add,后全体 pct,再上 CAPS 截断。"""
        for m in self.stat_mods:
            if m["src"] == src and m["stat"] == stat:
                m["op"], m["v"] = op, v
                self.recalc_hero()
                return
        self.stat_mods.append({"src": src, "stat": stat, "op": op, "v": v})
        self.recalc_hero()

    def remove_stat_mod(self, src, stat=None):
        """移除某来源的修饰(stat 为 None 时移除该来源全部)"""
        n = len(self.stat_mods)
        self.stat_mods = [m for m in self.stat_mods
                          if not (m["src"] == src and (stat is None or m["stat"] == stat))]
        if len(self.stat_mods) != n:
            self.recalc_hero()

    # ================================================================ 职业/装配
    def choose_class(self, cid):
        """选择职业(新档必经;自动装配该职业的初始技能)"""
        if cid not in CLASSES:
            return
        self.class_id = cid
        cls = CLASSES[cid]
        self.loadout = {"active": [], "passive": []}
        for s in ACTIVE_SKILLS:
            if s["cls"] == cid and s["unlock"] <= 1:
                self.loadout["active"].append(s["id"])
                break
        for s in PASSIVE_SKILLS:
            if s["cls"] == cid and s["unlock"] <= 1:
                self.loadout["passive"].append(s["id"])
                break
        self.recalc_hero()
        self.hero["hp"] = self.hero["max_hp"]
        self.log("你成为了 %s%s%s —— %s" % (cls["color"] and "", cls["name"], "", cls["desc"]),
                 cls["color"])
        self.log("按 H 查看按键说明;技能页(5)可更换装配与升级技能。", "bright_black")
        self.spawn()

    def loadout_slots(self):
        """当前解锁的装配槽位数(主动/被动同阶)"""
        n = 0
        for th in BAL["loadout_unlock"]:
            if self.level >= th:
                n += 1
        return n

    def _skill_defs(self, which):
        pool = ACTIVE_SKILLS if which == "active" else PASSIVE_SKILLS
        return [s for s in pool if s["cls"] == self.class_id]

    def skills_available(self, which):
        """当前可选(职业匹配且已达解锁等级)的技能定义列表"""
        return [s for s in self._skill_defs(which) if self.level >= s["unlock"]]

    def equip_skill(self, sid, which):
        """装配技能(同类槽满则替换最早装配的)"""
        pool = ACTIVE_DEF if which == "active" else PASSIVE_DEF
        d = pool.get(sid)
        if d is None or d["cls"] != self.class_id or self.level < d["unlock"]:
            self.toast("技能未解锁")
            return
        lo = self.loadout[which]
        if sid in lo:
            self.toast("已装配")
            return
        if len(lo) >= self.loadout_slots():
            self.toast("装配槽未解锁(Lv.%d)" % BAL["loadout_unlock"][len(lo)])
            return
        lo.append(sid)
        self.skill_cd[sid] = 0.0
        self.recalc_hero()
        self.toast("已装配 %s" % d["name"])

    def unequip_skill(self, sid):
        for which in ("active", "passive"):
            if sid in self.loadout[which]:
                self.loadout[which].remove(sid)
                self.recalc_hero()
                self.toast("已卸下")

    # ================================================================ 英雄
    def recalc_hero(self):
        b = BAL
        cls = CLASSES.get(self.class_id) or CLASSES["warrior"]
        cb = cls["base"]
        base_hp = (b["hero_hp0"] + b["hp_per_lv"] * (self.level - 1)) * cb["hp"]
        base_atk = (b["hero_atk0"] + b["atk_per_lv"] * (self.level - 1)) * cb["atk"]
        base_def = (b["hero_def0"] + b["def_per_lv"] * (self.level - 1)) * cb["def"]
        agg = {"hp": base_hp, "atk": base_atk, "def": base_def,
               "haste": 0.0, "crit": b["hero_crit0"] + cls["crit0"],
               "crit_dmg": b["hero_critdmg0"],
               "lifesteal": 0.0, "goldfind": 0.0}
        for k in VIRTUAL_STATS:
            agg[k] = 0.0
        for it in self.equip.values():
            for k, v in it.stats().items():
                agg[k] = agg.get(k, 0) + v
        # 统一修饰管道:成就 + 被动技能 + 遗物 + 外部挂口;先加后乘,再截断
        mods = (systems.achievement_mods(self.stats)
                + (S.passive_mods(self) if self.class_id else [])
                + RL.relic_mods(self.relics)
                + self.stat_mods)
        for m in mods:
            if m["op"] == "add":
                agg[m["stat"]] = agg.get(m["stat"], 0) + m["v"]
        for m in mods:
            if m["op"] == "pct":
                agg[m["stat"]] = agg.get(m["stat"], 0) * (1 + m["v"] / 100.0)
        for k, cap in CAPS.items():
            if k in agg:
                agg[k] = min(agg[k], cap)
        old_hp = self.hero.get("hp")
        old_timer = self.hero.get("atk_timer", 0.0)
        old_shield = self.hero.get("shield", 0.0)
        self.hero = dict(agg)
        self.hero["interval"] = cls["interval"]
        self.hero["atk_timer"] = old_timer
        self.hero["shield"] = old_shield
        self.hero["undying_at"] = self.hero.get("undying_at", -999.0)
        self.hero["next_hit_bonus"] = self.hero.get("next_hit_bonus", 0.0)
        self.hero["max_hp"] = agg["hp"]
        if old_hp is None:
            self.hero["hp"] = agg["hp"]
        else:
            self.hero["hp"] = min(old_hp, agg["hp"])

    def xp_req(self):
        return int(BAL["xp_req0"] * (self.level ** BAL["xp_req_p"]))

    def gain_xp(self, n):
        self.xp += n
        leveled = False
        while self.xp >= self.xp_req():
            self.xp -= self.xp_req()
            self.level += 1
            leveled = True
        if leveled:
            before = self.hero.get("max_hp", 1)
            self.recalc_hero()
            heal = self.hero["max_hp"] * 0.3
            self.hero["hp"] = min(self.hero["max_hp"], self.hero["hp"] + heal)
            self.log("⇧ 升级!Lv.%d  (+%d 生命)" % (self.level, int(self.hero["max_hp"] - before)),
                     "bright_yellow")
            self.toast("升级 → Lv.%d" % self.level)
            # 新技能/新装配槽提示
            for which, pool in (("active", ACTIVE_SKILLS), ("passive", PASSIVE_SKILLS)):
                for s in pool:
                    if s["cls"] == self.class_id and s["unlock"] == self.level:
                        self.log("★ 技能可解锁:%s(技能页装配)" % s["name"], "bright_cyan")
            if self.level in BAL["loadout_unlock"]:
                self.log("★ 装配槽 +1(技能页可装配更多技能)", "bright_cyan")
            if self.level in BAL["speed_unlock"][1:]:
                tier = BAL["speed_unlock"].index(self.level) + 1
                self.log("★ 解锁 ×%d 倍速!按 B 切换" % tier, "bright_cyan")

    # ================================================================ 背包/装备
    def add_item(self, item):
        rid = RARITY_IDX[item.rarity]
        auto_sell = self.settings.get("auto_sell_idx", -1)
        if auto_sell >= 0 and rid <= auto_sell:
            price = item.sell_price()
            self.gold += price
            self.stats["gold_earned"] += price
            self.log("自动出售 %s (+%s 金币)" % (item.display(), fmt(price)), "bright_black")
            return
        if len(self.bag) >= BAL["bag_size"]:
            price = item.sell_price()
            self.gold += price
            self.stats["gold_earned"] += price
            self.log("背包已满,%s 自动出售 (+%s)" % (item.display(), fmt(price)), "bright_black")
            return
        systems.auto_equip_check(self, item)
        if item not in self.equip.values():
            self.bag.insert(0, item)
            self.log("掉落 %s%s" % (item.display(), c(" Lv.%d" % item.tier, "bright_black")),
                     item.rarity_color())

    def equip_item(self, item, silent_if_auto=False):
        """穿上 bag 或新掉落的 item"""
        old = self.equip.get(item.slot)
        self.equip[item.slot] = item
        if item in self.bag:
            self.bag.remove(item)
        if old is not None:
            if len(self.bag) >= BAL["bag_size"]:
                price = old.sell_price()
                self.gold += price
                self.stats["gold_earned"] += price
                self.log("背包已满,%s 自动出售" % old.display(), "bright_black")
            else:
                self.bag.insert(0, old)
        self.recalc_hero()
        if not silent_if_auto:
            self.log("装备 %s" % item.display(), item.rarity_color())
            self.toast("已装备 %s" % item.name)
        else:
            self.log("自动换装 %s" % item.display(), item.rarity_color())

    def unequip(self, slot):
        it = self.equip.get(slot)
        if it is None:
            self.toast("该部位没有装备")
            return
        if len(self.bag) >= BAL["bag_size"]:
            self.toast("背包已满")
            return
        del self.equip[slot]
        self.bag.insert(0, it)
        self.recalc_hero()
        self.log("卸下 %s" % it.display(), "bright_black")

    def sell_item(self, idx):
        if 0 <= idx < len(self.bag):
            it = self.bag.pop(idx)
            price = it.sell_price()
            self.gold += price
            self.stats["gold_earned"] += price
            self.log("出售 %s (+%s 金币)" % (it.display(), fmt(price)), "bright_black")
            self.toast("+%s 金币" % fmt(price))

    def sell_junk(self):
        n, gold = 0, 0
        keep = []
        for it in self.bag:
            if RARITY_IDX[it.rarity] < 2:
                gold += it.sell_price()
                n += 1
            else:
                keep.append(it)
        if n:
            self.bag = keep
            self.gold += gold
            self.stats["gold_earned"] += gold
            self.log("一键出售 %d 件 普通/精良 (+%s 金币)" % (n, fmt(gold)), "bright_black")
            self.toast("出售 %d 件 +%s" % (n, fmt(gold)))
        else:
            self.toast("没有可出售的杂物")

    def dismantle_item(self, idx):
        if 0 <= idx < len(self.bag):
            it = self.bag.pop(idx)
            gold, stones = it.dismantle()
            self.gold += gold
            self.stones += stones
            self.stats["gold_earned"] += gold
            self.log("分解 %s (+%s 金币%s)" % (
                it.display(), fmt(gold),
                (", +%d 重铸石" % stones) if stones else ""), "bright_magenta")
            self.toast("分解获得 %s金币%s" % (fmt(gold), ("/%d石" % stones) if stones else ""))

    # ================================================================ 锻造
    def enhance(self, slot):
        it = self.equip.get(slot)
        if it is None:
            self.toast("该部位没有装备")
            return
        if it.plus >= BAL["plus_max"]:
            self.toast("已达强化上限 +%d" % BAL["plus_max"])
            return
        cost = it.enhance_cost()
        if self.gold < cost:
            self.toast("金币不足 (需要 %s)" % fmt(cost))
            return
        self.gold -= cost
        it.plus += 1
        self.stats["enhance_total"] += 1
        self.quest_progress("enhance", 1)
        self.recalc_hero()
        self.log("⚒ %s 强化至 +%d" % (it.name, it.plus), "bright_yellow")
        self.toast("%s +%d" % (it.name, it.plus))

    def reforge(self, slot):
        """洗脸:按品质洗 N 条词缀(精良/稀有1、史诗/传说2、神话3),
        幸运值提升洗出词条的值上限。主属性与品质保留。"""
        it = self.equip.get(slot)
        if it is None:
            self.toast("该部位没有装备")
            return
        n = it.reforge_count()
        if n <= 0 or not it.affixes:
            self.toast("该装备没有可洗词条")
            return
        cost = BAL["reforge_stones"]
        if self.stones < cost:
            self.toast("重铸石不足 (需要 %d)" % cost)
            return
        self.stones -= cost
        self.stats["reforge_total"] += 1
        # 幸运折算:值域上限 × (1 + luck/300)
        luck = self.hero.get("luck", 0.0)
        luck_off = 1 + luck / BAL["luck_reforge_k"]
        picked = it.reforge_affixes_with_luck(self.rng, luck_off)
        self.recalc_hero()
        self.log("✦ %s 洗练 %d 条:%s" % (it.display(), len(picked), "、".join(picked)),
                 "bright_magenta")
        self.toast("洗出:%s" % "、".join(picked))


    # ================================================================ 技能
    def skill_cost(self, sid):
        """升级费用按技能自身等级(线性+平方,等级自然收敛)"""
        lv = self.skill_lv.get(sid, 1)
        t = tier_of(self.zone, self.stage)
        return int(BAL["skill_cost0"] + BAL["skill_cost_lv"] * lv
                   + BAL["skill_cost_lv2"] * lv * lv
                   + BAL["skill_cost_t"] * t)

    def skill_up(self, sid):
        pool = ACTIVE_DEF if sid in ACTIVE_DEF else PASSIVE_DEF
        d = pool.get(sid)
        if d is None or d["cls"] != self.class_id or self.level < d["unlock"]:
            self.toast("技能未解锁")
            return
        if self.skill_lv.get(sid, 1) >= BAL["skill_lv_max"]:
            self.toast("已达上限 Lv.%d" % BAL["skill_lv_max"])
            return
        cost = self.skill_cost(sid)
        if self.gold < cost:
            self.toast("金币不足 (需要 %s)" % fmt(cost))
            return
        self.gold -= cost
        self.skill_lv[sid] = self.skill_lv.get(sid, 1) + 1
        self.recalc_hero()
        self.log("技能升级:%s Lv.%d(有效 %d)" % (
            d["name"], self.skill_lv[sid], S.eff_lv(self, sid)), "bright_cyan")
        self.toast("%s Lv.%d" % (d["name"], self.skill_lv[sid]))

    # ================================================================ 推进
    def spawn(self):
        eq_t = max((it.tier for it in self.equip.values()), default=0)
        self.monster = spawn_monster(self.zone, self.stage, self.rng, eq_t)
        self.last_spawn_time = self.time

    def _advance_zone_stage(self):
        """击杀成功后的推进状态迁移(纯状态,不生成怪物;resolve 共用)。"""
        self.stage_kills += 1
        self.deaths_row = 0
        if self.mode == "push":
            if self.stage >= 10:  # 头目已死,进入新区域
                self.zone += 1
                self.stage = 1
                self.stage_kills = 0
                self.stats["max_zone"] = max(self.stats["max_zone"], self.zone)
                self.toast("进入第 %d 区" % self.zone)
            elif self.stage_kills >= BAL["kills_per_stage"]:
                self.stage += 1
                self.stage_kills = 0

    def advance_stage(self):
        self._advance_zone_stage()
        self.spawn()

    def retreat_stage(self):
        """英雄死亡后的退层;连续死亡自动转挂机防止死亡循环"""
        self.stats["deaths"] += 1
        self.deaths_row += 1
        self.last_death_time = self.time
        if self.mode == "push":
            self.stage = max(1, self.stage - 1)
            if self.stage == 1 and self.zone > 1:
                self.zone -= 1
                self.stage = 10
        else:  # 挂机模式也退层,避免在打不过的层死锁
            self.stage = max(1, self.stage - 1)
            if self.stage == 1 and self.zone > 1:
                self.zone -= 1
                self.stage = 10
            self.farm_stage = self.stage
        if self.deaths_row >= BAL["death_row_to_farm"] and self.mode == "push":
            self.mode = "farm"
            # 退到低3层的安全层挂机,避免原地反复战败
            safe = self.stage - 3
            if safe < 1 and self.zone > 1:
                self.zone -= 1
                safe += 7
            self.stage = max(1, min(10, safe))
            self.farm_stage = self.stage
            self.log("连续战败,已自动切换为挂机模式(第%d区·%d层)。提升装备后按 F 继续推进。" % (
                self.zone, self.stage), "bright_cyan")

    def set_mode(self, mode):
        if mode == "farm":
            self.farm_stage = self.stage
            self.mode = "farm"
            self.log("切换为挂机模式:停留在 第%d区·%d层" % (self.zone, self.stage), "bright_cyan")
        else:
            self.mode = "push"
            self.log("切换为推进模式:击败敌人继续深入", "bright_cyan")
        self.spawn()

    def set_farm_stage(self, delta):
        self.farm_stage = min(10, max(1, self.farm_stage + delta))
        if self.mode == "farm":
            self.stage = self.farm_stage
            self.spawn()
        self.toast("挂机层位:%d层" % self.farm_stage)

    # ================================================================ 塔 & 遗物
    def tower_enter(self, floor):
        """进入塔层:消耗 1 把钥匙,切换到塔战斗"""
        if self.in_tower:
            self.toast("正在塔中")
            return
        if floor < 1:
            return
        if self.tower["keys"] < 1:
            self.toast("钥匙不足(每天送3把)")
            return
        # 新高才限层?不限,可选任意 ≤ max_floor+1 的层
        if floor > self.tower["max_floor"] + 1:
            self.toast("需先通过第 %d 层" % self.tower["max_floor"])
            return
        self.tower["keys"] -= 1
        self.in_tower = True
        self.tower_floor_sel = floor
        self.monster = TW.tower_monster(floor, self.rng)
        self.last_spawn_time = self.time
        self.log("🔑 进入深渊塔·第%d层%s" % (floor, "(头目!)" if self.monster.boss else ""),
                 "bright_cyan")

    def tower_exit(self, won=False):
        """离开塔(胜利结算或战败退出)"""
        if not self.in_tower:
            return
        self.in_tower = False
        if won:
            floor = self.tower_floor_sel
            mon = self.monster
            # 金币
            gold = TW.tower_gold(floor) * (1 + self.hero["goldfind"] / 100.0)
            self.gold += int(gold)
            self.stats["gold_earned"] += int(gold)
            # 掉落遗物(必掉)
            relic = TW.roll_tower_drop(floor, self.rng, luck=self.hero.get("luck", 0),
                                       loadout=self.loadout["active"])
            self.add_relic(relic)
            # 新高奖励
            if floor > self.tower["max_floor"]:
                self.tower["max_floor"] = floor
                self.stones += TOWER["new_height_stones"]
                self.log("★ 新高度!第%d层 +%d重铸石" % (floor, TOWER["new_height_stones"]),
                         "bright_yellow")
            self.log("✔ 塔第%d层通关!获得 %s" % (floor, relic.display()), "bright_cyan")
            self.monster = None
        else:
            self.log("✘ 塔第%d层失败…钥匙已消耗" % self.tower_floor_sel, "bright_red")
            self.monster = None
            self.respawn_timer = BAL["respawn_sec"]

    def add_relic(self, relic):
        """遗物:优先装空槽,满了自动替换最差(或进背包式列表?)——简化:优先装空槽,满则提示"""
        for i, r in enumerate(self.relics):
            if r is None:
                self.relics[i] = relic
                self.recalc_hero()
                self.log("获得遗物 %s(装入槽%d)" % (relic.display(), i + 1),
                         relic.rarity_color() if hasattr(relic, 'rarity_color') else "bright_magenta")
                return
        # 满槽:自动替换效果最少的
        worst_i = 0
        worst_n = 99
        for i, r in enumerate(self.relics):
            if r and len(r.effects) < worst_n:
                worst_n = len(r.effects)
                worst_i = i
        old = self.relics[worst_i]
        self.relics[worst_i] = relic
        self.recalc_hero()
        self.log("遗物 %s 替换 %s" % (relic.display(), old.display()), "bright_magenta")

    def unequip_relic(self, idx):
        if 0 <= idx < 4 and self.relics[idx]:
            self.relics[idx] = None
            self.recalc_hero()
            self.toast("卸下遗物%d" % (idx + 1))

    def tower_refresh_keys(self):
        gained = TW.refresh_keys(self.tower, __import__('time').time())
        if gained > 0:
            self.log("🔑 每日钥匙 +%d(现有 %d)" % (gained, self.tower["keys"]), "bright_cyan")

    # ================================================================ 悬赏
    def roll_daily(self):
        """每日悬赏:本地日期跨日重置计数(与 TS 主实现同构,保持对拍)。"""
        d = time.strftime("%Y-%m-%d")
        if d != self.quest_daily_date:
            self.quest_daily_date = d
            self.quest_daily_count = 0

    def quest_progress(self, qtype, n):
        self.roll_daily()
        for q in self.quests:
            if self.quest_daily_count >= BAL["quest_daily_limit"]:
                break   # 今日已达上限:后续槽位进度冻结(明日恢复)
            if q["type"] == qtype and q["progress"] < q["target"]:
                q["progress"] += n
                if q["progress"] >= q["target"]:
                    self.gold += q["gold"]
                    self.stones += q["stones"]
                    self.stats["gold_earned"] += q["gold"]
                    self.stats["quest_done"] += 1
                    self.log("✔ 完成悬赏「%s」 +%s金币 +%d重铸石" % (
                        systems.quest_desc(q), fmt(q["gold"]), q["stones"]), "bright_cyan")
                    self.quest_daily_count += 1
                    if self.quest_daily_count == BAL["quest_daily_limit"]:
                        self.log("今日悬赏已达上限(%d个),明日刷新。" % BAL["quest_daily_limit"],
                                 "bright_black")
                    new = systems.roll_quest(self.zone, self.rng)
                    q.clear()
                    q.update(new)

    # ================================================================ 杂项
    def theoretical_dps(self):
        h = self.hero
        interval = h["interval"] / (1 + h["haste"] / 100.0)
        crit_mult = 1 + (h["crit"] / 100.0) * (h["crit_dmg"] / 100.0)
        return h["atk"] / interval * crit_mult

    # ================================================================ 倍速
    def max_speed(self):
        """当前等级可用的最高倍速档(Lv1=×1,Lv10=×2,Lv30=×3)"""
        n = 1
        for i, th in enumerate(BAL["speed_unlock"]):
            if self.level >= th:
                n = i + 1
        return n

    def cycle_speed(self):
        """B 键:在已解锁档位间循环 1→2→3→1"""
        cur = self.settings.get("speed", 1)
        nxt = cur + 1
        if nxt > self.max_speed():
            nxt = 1
        self.settings["speed"] = nxt
        self.toast("游戏速度 ×%d" % nxt)
        return nxt

    def tick(self, dt):
        """推进一帧(dt 秒 × speed 倍速,核心内实现:三宿主一致)。
        暂停由宿主控制:暂停时宿主不调用本方法。"""
        self.roll_daily()   # 跨日即时解冻悬赏(无 RNG 消耗,不影响对拍)
        speed = min(self.settings.get("speed", 1), self.max_speed())
        for _ in range(speed):
            self.time += dt
            self.playtime += dt
            battle_tick(self, dt)
            if self.monster is None and self.respawn_timer <= 0:
                self.spawn()
        self.autosave_acc += dt  # 自动存档按真实时间计
        if self.autosave_acc > 30:
            self.autosave_acc = 0
            self.save()

    # ================================================================ 存档
    def to_dict(self):
        return {
            "version": SAVE_VERSION,
            "seed": self.seed,
            "time": self.time, "playtime": self.playtime,
            "gold": self.gold, "stones": self.stones,
            "level": self.level, "xp": self.xp,
            "zone": self.zone, "stage": self.stage,
            "stage_kills": self.stage_kills, "deaths_row": self.deaths_row,
            "mode": self.mode, "farm_stage": self.farm_stage,
            "class_id": self.class_id,
            "loadout": self.loadout,
            "skill_lv": self.skill_lv,
            "equip": {s: it.to_dict() for s, it in self.equip.items()},
            "bag": [it.to_dict() for it in self.bag],
            "stats": self.stats,
            "settings": self.settings,
            "stat_mods": self.stat_mods,
            "quests": self.quests,
            "quest_daily_count": self.quest_daily_count,
            "quest_daily_date": self.quest_daily_date,
            "relics": [r.to_dict() if r else None for r in self.relics],
            "tower": self.tower,
            "hero_hp": self.hero.get("hp"),
            "ema_kill": self.ema_kill,
            "last_saved": time.time(),
        }

    def save(self, path=None):
        p = Path(path) if path else SAVE_PATH
        try:
            p.write_text(json.dumps(self.to_dict(), ensure_ascii=False), encoding="utf-8")
        except OSError as e:
            self.log("存档失败: %s" % e, "bright_red")

    @classmethod
    def from_dict(cls, d):
        """从已解析的存档 dict 重建(网页宿主与 load() 共用)。"""
        g = cls(seed=d.get("seed"))
        g.time = d.get("time", 0)
        g.playtime = d.get("playtime", 0)
        g.gold = d.get("gold", 0)
        g.stones = d.get("stones", 0)
        g.level = d.get("level", 1)
        g.xp = d.get("xp", 0)
        g.zone = d.get("zone", 1)
        g.stage = d.get("stage", 1)
        g.stage_kills = d.get("stage_kills", 0)
        g.deaths_row = d.get("deaths_row", 0)
        g.mode = d.get("mode", "push")
        g.farm_stage = d.get("farm_stage", 1)
        g.equip = {s: Item.from_dict(v) for s, v in d.get("equip", {}).items()}
        g.bag = [Item.from_dict(v) for v in d.get("bag", [])]
        g.class_id = d.get("class_id")
        g.loadout = d.get("loadout") or {"active": [], "passive": []}
        g.skill_lv = d.get("skill_lv") or {}
        g.skill_cd = {s["id"]: 0.0 for s in ACTIVE_SKILLS}
        g.buffs = {}
        g.stats.update(d.get("stats", {}))
        g.settings.update(d.get("settings", {}))
        g.stat_mods = d.get("stat_mods") or []
        g.relics = [RL.Relic.from_dict(r) if r else None for r in d.get("relics", [None]*4)]
        g.tower = d.get("tower") or {"keys": 3, "max_floor": 0, "last_refresh": None}
        g.quests = d.get("quests") or g.quests
        g.quest_daily_count = d.get("quest_daily_count", 0)
        g.quest_daily_date = d.get("quest_daily_date", "")
        g.ema_kill = d.get("ema_kill", 0.0)
        g.recalc_hero()
        g.hero["hp"] = min(d.get("hero_hp") or g.hero["max_hp"], g.hero["max_hp"])
        g.events.clear()
        g.log("存档已读取: Lv.%d · 第%d区·%d层" % (g.level, g.zone, g.stage), "bright_cyan")
        if g.class_id:
            g.spawn()
        return g

    @classmethod
    def load(cls, path=None):
        p = Path(path) if path else SAVE_PATH
        if not p.exists():
            return cls()
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            g = cls()
            g.log("存档损坏,已重新开始。", "bright_red")
            return g
        d = migrate_save(d)
        g = cls.from_dict(d)
        # 离线收益(精确懒结算)
        dt = time.time() - d.get("last_saved", time.time())
        report = systems.resolve_offline(g, dt)
        if report:
            g.pending_offline = report
        return g


# ---------------------------------------------------------------- 迁移链
def migrate_save(d):
    """存档版本升级:逐版本应用,字段即文档(见 docs/03)。"""
    v = d.get("version", 1)
    if v < 2:
        # v1 → v2:引入角色种子,保证模拟可复现
        d.setdefault("seed", random.SystemRandom().randrange(2 ** 31))
        d["version"] = 2
        v = 2
    if v < 3:
        # v2 → v3:数值体系 2.0(多项式成长)。
        d["stat_mods"] = []
        d["version"] = 3
        v = 3
    if v < 4:
        # v3 → v4:职业与技能体系。旧通用技能映射为战士系:
        # strike→重击 / warcry→战吼 / execute→处决,等级迁移;职业默认战士。
        old = d.pop("skills", {}) or {}
        d["class_id"] = "warrior"
        mapping = {"strike": "w_strike", "warcry": "w_warcry", "execute": "w_exec"}
        loadout = {"active": ["w_strike"], "passive": ["pw_tough"]}
        skill_lv = {}
        for old_id, lv in old.items():
            new_id = mapping.get(old_id)
            if new_id:
                skill_lv[new_id] = max(1, int(lv))
        d["loadout"] = loadout
        d["skill_lv"] = skill_lv
        d["version"] = 4
        v = 4
    if v < 5:
        d["relics"] = [None]*4
        d["tower"] = {"keys": 3, "max_floor": 0, "last_refresh": None}
        d["version"] = 5
    return d
