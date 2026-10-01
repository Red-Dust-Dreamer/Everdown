/** Game:无 UI 依赖的游戏状态机(与 abyss/game.py 语义一致,存档 v4 兼容)。
 *
 * 平台 IO(存档读写)由宿主在启动时注入 saveHooks —— CLI 用文件,网页用
 * localStorage,服务器(P3)用数据库;核心零平台依赖。
 */
import { c, fmt } from "./ansi.ts";
import { battleTick, spawnMonster, tierOf } from "./combat.ts";
import type { Monster } from "./combat.ts";
import {
  ACTIVE_DEF, ACTIVE_SKILLS, BAL, CAPS, CLASSES, PASSIVE_DEF, PASSIVE_SKILLS,
  RARITY_IDX, TOWER,
} from "./data.ts";
import { Item, rollItem } from "./items.ts";
import * as RL from "./relics.ts";
import { Relic } from "./relics.ts";
import * as TW from "./tower.ts";
import type { TowerState } from "./tower.ts";
import { PyRandom } from "./rng.ts";
import * as systems from "./systems.ts";
import * as S from "./skills.ts";

export const SAVE_VERSION = 5;
export const EVENT_CAP = 2000;
const VIRTUAL_STATS = ["skill_dmg", "cd_reduce", "dodge", "armor_pierce", "xp_pct",
  "all_skill_lv", "crit_extra", "kill_heal", "deathward",
  "boss_dmg_r", "kill_haste"];

export type Loadout = { active: string[]; passive: string[] };

/** 宿主注入的存档 IO;未注入时 save() 为空操作、load() 返回 null(新档) */
export interface SaveHooks {
  write(g: Game): void;
  readRaw(): string | null;
}
export let saveHooks: SaveHooks | null = null;
export function installSaveHooks(h: SaveHooks): void { saveHooks = h; }

export interface HeroStats {
  hp: number; atk: number; def: number; haste: number; crit: number; crit_dmg: number;
  lifesteal: number; goldfind: number;
  skill_lv: number; skill_dmg: number; cd_reduce: number; dodge: number;
  armor_pierce: number; xp_pct: number;
  all_skill_lv: number; crit_extra: number; kill_heal: number;
  deathward: number; boss_dmg_r: number; kill_haste: number;
  interval: number; atk_timer: number; max_hp: number;
  shield: number; undying_at: number; next_hit_bonus: number;
  [k: string]: number;
}

export class Game {
  seed: number;
  rng: PyRandom;
  time = 0;
  playtime = 0;
  gold = 0;
  stones = 0;
  level = 1;
  xp = 0;
  zone = 1;
  stage = 1;
  stageKills = 0;
  deathsRow = 0;
  mode: "push" | "farm" = "push";
  farmStage = 1;
  equip: Record<string, Item> = {};
  bag: Item[] = [];
  classId: string | null = null;
  loadout: Loadout = { active: [], passive: [] };
  skillLv: Record<string, number> = {};
  skillCd: Record<string, number> = {};
  buffs: Record<string, { pct: number; until: number }> = {};
  stats: Record<string, number> = {
    kills: 0, boss_kills: 0, deaths: 0, enhance_total: 0,
    gold_earned: 0, max_zone: 1, reforge_total: 0, quest_done: 0,
  };
  settings: Record<string, any> = { auto_equip: true, auto_sell_idx: -1 };
  quests: systems.Quest[] = [];
  questDailyCount = 0;        // 今日已完成悬赏数(上限 BAL.quest_daily_limit)
  questDailyDate = "";        // 本地日期 YYYY-MM-DD,跨日重置计数
  events: [string, string, string][] = [];
  statMods: { src: string; stat: string; op: "add" | "pct"; v: number }[] = [];
  view: any = null;          // 宿主挂载呈现层,核心不读写
  // ---- 遗物 & 塔 ----
  relics: (Relic | null)[] = [null, null, null, null];   // 4 槽
  tower: TowerState = { keys: 3, max_floor: 0, last_refresh: null };
  towerFloorSel = 1;         // UI:当前选中要打的层
  inTower = false;           // 当前在塔战斗中
  monster: Monster | null = null;
  respawnTimer = 0;
  lastSpawnTime: number | null = null;
  emaKill = 0;
  lastDeathTime = -999;
  pendingOffline: systems.ResolveReport | null = null;
  autosaveAcc = 0;
  hero!: HeroStats;

  constructor(seed?: number, rng?: PyRandom) {
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = rng ?? new PyRandom(this.seed);
    for (const s of ACTIVE_SKILLS) this.skillCd[s.id] = 0;
    this.recalcHero();
    this.hero.hp = this.hero.max_hp;
    this.log("欢迎来到深渊。先选择你的职业。", "bright_cyan");
    this.quests = [systems.rollQuest(1, this.rng), systems.rollQuest(1, this.rng),
      systems.rollQuest(1, this.rng)];
  }

  // ================================================================ 事件
  emit(kind: string, text: string, color = ""): void {
    if (this.events.length < EVENT_CAP) this.events.push([kind, text, color]);
  }
  log(text: string, color = "white"): void { this.emit("log", text, color); }
  toast(text: string): void { this.emit("toast", text); }
  addFloater(text: string, color: string): void { this.emit("floater", text, color); }

  // ================================================================ 修饰器挂口
  addStatMod(src: string, stat: string, op: "add" | "pct", v: number): void {
    const m = this.statMods.find(m => m.src === src && m.stat === stat);
    if (m) { m.op = op; m.v = v; }
    else this.statMods.push({ src, stat, op, v });
    this.recalcHero();
  }
  removeStatMod(src: string, stat?: string): void {
    const n = this.statMods.length;
    this.statMods = this.statMods.filter(m =>
      !(m.src === src && (stat === undefined || m.stat === stat)));
    if (this.statMods.length !== n) this.recalcHero();
  }

  // ================================================================ 职业/装配
  chooseClass(cid: string): void {
    if (!CLASSES[cid]) return;
    this.classId = cid;
    this.loadout = { active: [], passive: [] };
    for (const s of ACTIVE_SKILLS) {
      if (s.cls === cid && s.unlock <= 1) { this.loadout.active.push(s.id); break; }
    }
    for (const s of PASSIVE_SKILLS) {
      if (s.cls === cid && s.unlock <= 1) { this.loadout.passive.push(s.id); break; }
    }
    this.recalcHero();
    this.hero.hp = this.hero.max_hp;
    const cls = CLASSES[cid];
    this.log(`你成为了 ${cls.name} —— ${cls.desc}`, cls.color);
    this.log("按 H 查看按键说明;技能页(5)可更换装配与升级技能。", "bright_black");
    this.spawn();
  }

  loadoutSlots(): number {
    let n = 0;
    for (const th of BAL.loadout_unlock) if (this.level >= th) n++;
    return n;
  }

  equipSkill(sid: string, which: "active" | "passive"): void {
    const d = (which === "active" ? ACTIVE_DEF : PASSIVE_DEF)[sid];
    if (!d || d.cls !== this.classId || this.level < d.unlock) {
      this.toast("技能未解锁");
      return;
    }
    const lo = this.loadout[which];
    if (lo.includes(sid)) { this.toast("已装配"); return; }
    if (lo.length >= this.loadoutSlots()) {
      this.toast(`装配槽未解锁(Lv.${BAL.loadout_unlock[lo.length]})`);
      return;
    }
    lo.push(sid);
    this.skillCd[sid] = 0;
    this.recalcHero();
    this.toast(`已装配 ${d.name}`);
  }

  unequipSkill(sid: string): void {
    for (const which of ["active", "passive"] as const) {
      const i = this.loadout[which].indexOf(sid);
      if (i >= 0) {
        this.loadout[which].splice(i, 1);
        this.recalcHero();
        this.toast("已卸下");
      }
    }
  }

  // ================================================================ 英雄
  recalcHero(): void {
    const b = BAL;
    const cls = CLASSES[this.classId ?? ""] ?? CLASSES["warrior"];
    const cb = cls.base;
    const agg: Record<string, number> = {
      hp: (b.hero_hp0 + b.hp_per_lv * (this.level - 1)) * cb.hp,
      atk: (b.hero_atk0 + b.atk_per_lv * (this.level - 1)) * cb.atk,
      def: (b.hero_def0 + b.def_per_lv * (this.level - 1)) * cb.def,
      haste: 0, crit: b.hero_crit0 + cls.crit0, crit_dmg: b.hero_critdmg0,
      lifesteal: 0, goldfind: 0,
    };
    for (const k of VIRTUAL_STATS) agg[k] = 0;
    for (const it of Object.values(this.equip)) {
      for (const [k, v] of Object.entries(it.stats())) {
        agg[k] = (agg[k] ?? 0) + v;
      }
    }
    // 统一修饰管道:成就 + 被动技能 + 遗物 + 外部挂口;先加后乘,再截断
    const mods = [
      ...systems.achievementMods(this.stats),
      ...(this.classId ? S.passiveMods(this) : []),
      ...RL.relicMods(this.relics),
      ...this.statMods,
    ];
    for (const m of mods) if (m.op === "add") agg[m.stat] = (agg[m.stat] ?? 0) + m.v;
    for (const m of mods) if (m.op === "pct") agg[m.stat] = (agg[m.stat] ?? 0) * (1 + m.v / 100);
    for (const [k, cap] of Object.entries(CAPS)) {
      if (k in agg) agg[k] = Math.min(agg[k], cap as number);
    }
    const oldHp = this.hero?.hp;
    const oldTimer = this.hero?.atk_timer ?? 0;
    const oldShield = this.hero?.shield ?? 0;
    const oldUndying = this.hero?.undying_at ?? -999;
    const oldNext = this.hero?.next_hit_bonus ?? 0;
    this.hero = agg as HeroStats;
    this.hero.interval = cls.interval;
    this.hero.atk_timer = oldTimer;
    this.hero.shield = oldShield;
    this.hero.undying_at = oldUndying;
    this.hero.next_hit_bonus = oldNext;
    this.hero.max_hp = agg.hp;
    this.hero.hp = oldHp === undefined ? agg.hp : Math.min(oldHp, agg.hp);
  }

  xpReq(): number {
    return Math.trunc(BAL.xp_req0 * Math.pow(this.level, BAL.xp_req_p));
  }

  gainXp(n: number): void {
    this.xp += n;
    let leveled = false;
    while (this.xp >= this.xpReq()) {
      this.xp -= this.xpReq();
      this.level++;
      leveled = true;
    }
    if (leveled) {
      const before = this.hero?.max_hp ?? 1;
      this.recalcHero();
      const heal = this.hero.max_hp * 0.3;
      this.hero.hp = Math.min(this.hero.max_hp, this.hero.hp + heal);
      this.log(`⇧ 升级!Lv.${this.level}  (+${Math.trunc(this.hero.max_hp - before)} 生命)`,
        "bright_yellow");
      this.toast(`升级 → Lv.${this.level}`);
      for (const which of ["active", "passive"] as const) {
        const pool = which === "active" ? ACTIVE_SKILLS : PASSIVE_SKILLS;
        for (const s of pool) {
          if (s.cls === this.classId && s.unlock === this.level) {
            this.log(`★ 技能可解锁:${s.name}(技能页装配)`, "bright_cyan");
          }
        }
      }
      if ((BAL.loadout_unlock as readonly number[]).includes(this.level)) {
        this.log("★ 装配槽 +1(技能页可装配更多技能)", "bright_cyan");
      }
      if (this.level > 1 && (BAL.speed_unlock as readonly number[]).includes(this.level)) {
        const tier = (BAL.speed_unlock as readonly number[]).indexOf(this.level) + 1;
        this.log(`★ 解锁 ×${tier} 倍速!按 B 切换`, "bright_cyan");
      }
    }
  }

  // ================================================================ 背包
  addItem(item: Item): void {
    const rid = RARITY_IDX[item.rarity];
    const autoSell = this.settings.auto_sell_idx ?? -1;
    if (autoSell >= 0 && rid <= autoSell) {
      const price = item.sellPrice();
      this.gold += price;
      this.stats.gold_earned += price;
      this.log(`自动出售 ${item.display()} (+${fmt(price)} 金币)`, "bright_black");
      return;
    }
    if (this.bag.length >= BAL.bag_size) {
      const price = item.sellPrice();
      this.gold += price;
      this.stats.gold_earned += price;
      this.log(`背包已满,${item.display()} 自动出售 (+${fmt(price)})`, "bright_black");
      return;
    }
    systems.autoEquipCheck(this, item);
    if (!Object.values(this.equip).includes(item)) {
      this.bag.unshift(item);
      this.log(`掉落 ${item.display()}${c(` Lv.${item.tier}`, "bright_black")}`,
        item.rarityColor());
    }
  }

  equipItem(item: Item, silentIfAuto = false): void {
    const old = this.equip[item.slot];
    this.equip[item.slot] = item;
    const bi = this.bag.indexOf(item);
    if (bi >= 0) this.bag.splice(bi, 1);
    if (old) {
      if (this.bag.length >= BAL.bag_size) {
        const price = old.sellPrice();
        this.gold += price;
        this.stats.gold_earned += price;
        this.log(`背包已满,${old.display()} 自动出售`, "bright_black");
      } else {
        this.bag.unshift(old);
      }
    }
    this.recalcHero();
    if (!silentIfAuto) {
      this.log(`装备 ${item.display()}`, item.rarityColor());
      this.toast(`已装备 ${item.name}`);
    } else {
      this.log(`自动换装 ${item.display()}`, item.rarityColor());
    }
  }

  unequip(slot: string): void {
    const it = this.equip[slot];
    if (!it) { this.toast("该部位没有装备"); return; }
    if (this.bag.length >= BAL.bag_size) { this.toast("背包已满"); return; }
    delete this.equip[slot];
    this.bag.unshift(it);
    this.recalcHero();
    this.log(`卸下 ${it.display()}`, "bright_black");
  }

  sellItem(idx: number): void {
    if (idx >= 0 && idx < this.bag.length) {
      const it = this.bag.splice(idx, 1)[0];
      const price = it.sellPrice();
      this.gold += price;
      this.stats.gold_earned += price;
      this.log(`出售 ${it.display()} (+${fmt(price)} 金币)`, "bright_black");
      this.toast(`+${fmt(price)} 金币`);
    }
  }

  sellJunk(): void {
    let n = 0, gold = 0;
    const keep: Item[] = [];
    for (const it of this.bag) {
      if (RARITY_IDX[it.rarity] < 2) { gold += it.sellPrice(); n++; }
      else keep.push(it);
    }
    if (n) {
      this.bag = keep;
      this.gold += gold;
      this.stats.gold_earned += gold;
      this.log(`一键出售 ${n} 件 普通/精良 (+${fmt(gold)} 金币)`, "bright_black");
      this.toast(`出售 ${n} 件 +${fmt(gold)}`);
    } else {
      this.toast("没有可出售的杂物");
    }
  }

  dismantleItem(idx: number): void {
    if (idx >= 0 && idx < this.bag.length) {
      const it = this.bag.splice(idx, 1)[0];
      const [gold, stones] = it.dismantle();
      this.gold += gold;
      this.stones += stones;
      this.stats.gold_earned += gold;
      this.log(`分解 ${it.display()} (+${fmt(gold)} 金币${stones ? `, +${stones} 重铸石` : ""})`,
        "bright_magenta");
      this.toast(`分解获得 ${fmt(gold)}金币${stones ? `/${stones}石` : ""}`);
    }
  }

  // ================================================================ 锻造
  enhance(slot: string): void {
    const it = this.equip[slot];
    if (!it) { this.toast("该部位没有装备"); return; }
    if (it.plus >= BAL.plus_max) { this.toast(`已达强化上限 +${BAL.plus_max}`); return; }
    const cost = it.enhanceCost();
    if (this.gold < cost) { this.toast(`金币不足 (需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    it.plus += 1;
    this.stats.enhance_total += 1;
    this.questProgress("enhance", 1);
    this.recalcHero();
    this.log(`⚒ ${it.name} 强化至 +${it.plus}`, "bright_yellow");
    this.toast(`${it.name} +${it.plus}`);
  }

  reforge(slot: string): void {
    const it = this.equip[slot];
    if (!it) { this.toast("该部位没有装备"); return; }
    const n = it.reforgeCount();
    if (n <= 0 || !it.affixes.length) { this.toast("该装备没有可洗词条"); return; }
    const cost = BAL.reforge_stones;
    if (this.stones < cost) {
      this.toast(`重铸石不足 (需要 ${cost})`);
      return;
    }
    this.stones -= cost;
    this.stats.reforge_total += 1;
    const luck = this.hero.luck ?? 0;
    const luckOff = 1 + luck / BAL.luck_reforge_k;
    const picked = it.reforgeAffixesWithLuck(this.rng, luckOff);
    this.recalcHero();
    this.log(`✦ ${it.display()} 洗练 ${picked.length} 条:${picked.join("、")}`,
      "bright_magenta");
    this.toast(`洗出:${picked.join("、")}`);
  }

  // ================================================================ 技能
  skillCost(sid: string): number {
    const lv = this.skillLv[sid] ?? 1;
    const t = tierOf(this.zone, this.stage);
    return Math.trunc(BAL.skill_cost0 + BAL.skill_cost_lv * lv
      + BAL.skill_cost_lv2 * lv * lv + BAL.skill_cost_t * t);
  }

  skillUp(sid: string): void {
    const d = ACTIVE_DEF[sid] ?? PASSIVE_DEF[sid];
    if (!d || d.cls !== this.classId || this.level < d.unlock) {
      this.toast("技能未解锁");
      return;
    }
    const cost = this.skillCost(sid);
    if (this.gold < cost) { this.toast(`金币不足 (需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.skillLv[sid] = (this.skillLv[sid] ?? 1) + 1;
    this.recalcHero();
    this.log(`技能升级:${d.name} Lv.${this.skillLv[sid]}(有效 ${S.effLv(this, sid)})`,
      "bright_cyan");
    this.toast(`${d.name} Lv.${this.skillLv[sid]}`);
  }

  // ================================================================ 推进
  spawn(): void {
    let eqT = 0;
    for (const it of Object.values(this.equip)) eqT = Math.max(eqT, it.tier);
    this.monster = spawnMonster(this.zone, this.stage, this.rng, eqT);
    this.lastSpawnTime = this.time;
  }

  advanceZoneStage(): void {
    this.stageKills += 1;
    this.deathsRow = 0;
    if (this.mode === "push") {
      if (this.stage >= 10) {
        this.zone += 1;
        this.stage = 1;
        this.stageKills = 0;
        this.stats.max_zone = Math.max(this.stats.max_zone, this.zone);
        this.toast(`进入第 ${this.zone} 区`);
      } else if (this.stageKills >= BAL.kills_per_stage) {
        this.stage += 1;
        this.stageKills = 0;
      }
    }
  }

  advanceStage(): void {
    this.advanceZoneStage();
    this.spawn();
  }

  retreatStage(): void {
    this.stats.deaths += 1;
    this.deathsRow += 1;
    this.lastDeathTime = this.time;
    const backOne = () => {
      this.stage = Math.max(1, this.stage - 1);
      if (this.stage === 1 && this.zone > 1) {
        this.zone -= 1;
        this.stage = 10;
      }
    };
    if (this.mode === "push") {
      backOne();
    } else {
      backOne();
      this.farmStage = this.stage;
    }
    if (this.deathsRow >= BAL.death_row_to_farm && this.mode === "push") {
      this.mode = "farm";
      let safe = this.stage - 3;
      if (safe < 1 && this.zone > 1) {
        this.zone -= 1;
        safe += 7;
      }
      this.stage = Math.max(1, Math.min(10, safe));
      this.farmStage = this.stage;
      this.log(`连续战败,已自动切换为挂机模式(第${this.zone}区·${this.stage}层)。提升装备后按 F 继续推进。`,
        "bright_cyan");
    }
  }

  setMode(mode: "push" | "farm"): void {
    if (mode === "farm") {
      this.farmStage = this.stage;
      this.mode = "farm";
      this.log(`切换为挂机模式:停留在 第${this.zone}区·${this.stage}层`, "bright_cyan");
    } else {
      this.mode = "push";
      this.log("切换为推进模式:击败敌人继续深入", "bright_cyan");
    }
    this.spawn();
  }

  setFarmStage(delta: number): void {
    this.farmStage = Math.min(10, Math.max(1, this.farmStage + delta));
    if (this.mode === "farm") {
      this.stage = this.farmStage;
      this.spawn();
    }
    this.toast(`挂机层位:${this.farmStage}层`);
  }

  // ================================================================ 塔 & 遗物
  /** 进入塔层:消耗 1 把钥匙,切换到塔战斗 */
  towerEnter(floor: number): void {
    if (this.inTower) {
      this.toast("正在塔中");
      return;
    }
    if (floor < 1) return;
    if (this.tower.keys < 1) {
      this.toast("钥匙不足(每天送3把)");
      return;
    }
    // 新高才限层?不限,可选任意 ≤ max_floor+1 的层
    if (floor > this.tower.max_floor + 1) {
      this.toast(`需先通过第 ${this.tower.max_floor} 层`);
      return;
    }
    this.tower.keys -= 1;
    this.inTower = true;
    this.towerFloorSel = floor;
    const mon = TW.towerMonster(floor, this.rng);
    this.monster = mon;
    this.lastSpawnTime = this.time;
    this.log(`🔑 进入深渊塔·第${floor}层${mon.boss ? "(头目!)" : ""}`, "bright_cyan");
  }

  /** 离开塔(胜利结算或战败退出) */
  towerExit(won = false): void {
    if (!this.inTower) return;
    this.inTower = false;
    if (won) {
      const floor = this.towerFloorSel;
      // 金币
      const gold = TW.towerGold(floor) * (1 + this.hero.goldfind / 100);
      this.gold += Math.trunc(gold);
      this.stats.gold_earned += Math.trunc(gold);
      // 掉落遗物(必掉)
      const relic = TW.rollTowerDrop(floor, this.rng, this.hero.luck ?? 0);
      this.addRelic(relic);
      // 新高奖励
      if (floor > this.tower.max_floor) {
        this.tower.max_floor = floor;
        this.stones += TOWER.new_height_stones;
        this.log(`★ 新高度!第${floor}层 +${TOWER.new_height_stones}重铸石`, "bright_yellow");
      }
      this.log(`✔ 塔第${floor}层通关!获得 ${relic.display()}`, "bright_cyan");
      this.monster = null;
    } else {
      this.log(`✘ 塔第${this.towerFloorSel}层失败…钥匙已消耗`, "bright_red");
      this.monster = null;
      this.respawnTimer = BAL.respawn_sec;
    }
  }

  /** 遗物:优先装空槽,满了自动替换效果最少的 */
  addRelic(relic: Relic): void {
    for (let i = 0; i < this.relics.length; i++) {
      if (this.relics[i] === null) {
        this.relics[i] = relic;
        this.recalcHero();
        this.log(`获得遗物 ${relic.display()}(装入槽${i + 1})`, "bright_magenta");
        return;
      }
    }
    // 满槽:自动替换效果最少的
    let worstI = 0;
    let worstN = 99;
    for (let i = 0; i < this.relics.length; i++) {
      const r = this.relics[i];
      if (r && r.effects.length < worstN) {
        worstN = r.effects.length;
        worstI = i;
      }
    }
    const old = this.relics[worstI]!;
    this.relics[worstI] = relic;
    this.recalcHero();
    this.log(`遗物 ${relic.display()} 替换 ${old.display()}`, "bright_magenta");
  }

  unequipRelic(idx: number): void {
    if (idx >= 0 && idx < 4 && this.relics[idx]) {
      this.relics[idx] = null;
      this.recalcHero();
      this.toast(`卸下遗物${idx + 1}`);
    }
  }

  towerRefreshKeys(): void {
    const gained = TW.refreshKeys(this.tower, Date.now() / 1000);
    if (gained > 0) {
      this.log(`🔑 每日钥匙 +${gained}(现有 ${this.tower.keys})`, "bright_cyan");
    }
  }

  // ================================================================ 悬赏
  /** 每日悬赏:本地日期跨日重置计数;达 BAL.quest_daily_limit 后冻结进度(在途任务明日恢复)。 */
  rollDaily(): void {
    const t = new Date();
    const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    if (d !== this.questDailyDate) {
      this.questDailyDate = d;
      this.questDailyCount = 0;
    }
  }

  questProgress(qtype: string, n: number): void {
    this.rollDaily();
    for (const q of this.quests) {
      if (this.questDailyCount >= BAL.quest_daily_limit) break;  // 今日已达上限:后续槽位冻结
      if (q.type === qtype && q.progress < q.target) {
        q.progress += n;
        if (q.progress >= q.target) {
          this.gold += q.gold;
          this.stones += q.stones;
          this.stats.gold_earned += q.gold;
          this.stats.quest_done += 1;
          this.log(`✔ 完成悬赏「${systems.questDesc(q)}」 +${fmt(q.gold)}金币 +${q.stones}重铸石`,
            "bright_cyan");
          this.questDailyCount += 1;
          if (this.questDailyCount === BAL.quest_daily_limit)
            this.log(`今日悬赏已达上限(${BAL.quest_daily_limit}个),明日刷新。`, "bright_black");
          Object.assign(q, systems.rollQuest(this.zone, this.rng));
        }
      }
    }
  }

  // ================================================================ 杂项
  theoreticalDps(): number {
    const h = this.hero;
    const interval = h.interval / (1 + h.haste / 100);
    const critMult = 1 + h.crit / 100 * h.crit_dmg / 100;
    return h.atk / interval * critMult;
  }

  // ================================================================ 倍速
  maxSpeed(): number {
    let n = 1;
    for (let i = 0; i < BAL.speed_unlock.length; i++) {
      if (this.level >= BAL.speed_unlock[i]) n = i + 1;
    }
    return n;
  }

  cycleSpeed(): number {
    const cur = this.settings.speed ?? 1;
    const nxt = cur + 1 > this.maxSpeed() ? 1 : cur + 1;
    this.settings.speed = nxt;
    this.toast(`游戏速度 ×${nxt}`);
    return nxt;
  }

  tick(dt: number): void {
    this.rollDaily();   // 跨日即时解冻悬赏(无 RNG 消耗,不影响对拍)
    const speed = Math.min(this.settings.speed ?? 1, this.maxSpeed());
    for (let i = 0; i < speed; i++) {
      this.time += dt;
      this.playtime += dt;
      battleTick(this, dt);
      if (!this.monster && this.respawnTimer <= 0) this.spawn();
    }
    this.autosaveAcc += dt;  // 自动存档按真实时间计
    if (this.autosaveAcc > 30) {
      this.autosaveAcc = 0;
      this.save();
    }
  }

  // ================================================================ 存档
  toDict(): Record<string, any> {
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      time: this.time, playtime: this.playtime,
      gold: this.gold, stones: this.stones,
      level: this.level, xp: this.xp,
      zone: this.zone, stage: this.stage,
      stage_kills: this.stageKills, deaths_row: this.deathsRow,
      mode: this.mode, farm_stage: this.farmStage,
      class_id: this.classId,
      loadout: this.loadout,
      skill_lv: this.skillLv,
      equip: Object.fromEntries(Object.entries(this.equip).map(([k, v]) => [k, v.toDict()])),
      bag: this.bag.map(i => i.toDict()),
      stats: this.stats,
      settings: this.settings,
      stat_mods: this.statMods,
      quests: this.quests,
      quest_daily_count: this.questDailyCount,
      quest_daily_date: this.questDailyDate,
      relics: this.relics.map(r => r ? r.toDict() : null),
      tower: this.tower,
      hero_hp: this.hero.hp,
      ema_kill: this.emaKill,
      last_saved: Date.now() / 1000,
    };
  }

  save(): void {
    saveHooks?.write(this);
  }

  static fromDict(d: Record<string, any>): Game {
    const g = new Game(d.seed);
    g.time = d.time ?? 0;
    g.playtime = d.playtime ?? 0;
    g.gold = d.gold ?? 0;
    g.stones = d.stones ?? 0;
    g.level = d.level ?? 1;
    g.xp = d.xp ?? 0;
    g.zone = d.zone ?? 1;
    g.stage = d.stage ?? 1;
    g.stageKills = d.stage_kills ?? 0;
    g.deathsRow = d.deaths_row ?? 0;
    g.mode = d.mode ?? "push";
    g.farmStage = d.farm_stage ?? 1;
    g.equip = Object.fromEntries(Object.entries(d.equip ?? {})
      .map(([k, v]) => [k, Item.fromDict(v as any)]));
    g.bag = (d.bag ?? []).map((i: any) => Item.fromDict(i));
    g.classId = d.class_id ?? null;
    g.loadout = d.loadout ?? { active: [], passive: [] };
    g.skillLv = d.skill_lv ?? {};
    g.skillCd = {};
    for (const s of ACTIVE_SKILLS) g.skillCd[s.id] = 0;
    g.buffs = {};
    Object.assign(g.stats, d.stats ?? {});
    Object.assign(g.settings, d.settings ?? {});
    g.statMods = d.stat_mods ?? [];
    g.relics = (d.relics ?? [null, null, null, null])
      .map((r: any) => r ? Relic.fromDict(r) : null);
    g.tower = d.tower ?? { keys: 3, max_floor: 0, last_refresh: null };
    g.quests = d.quests ?? g.quests;
    g.questDailyCount = d.quest_daily_count ?? 0;
    g.questDailyDate = d.quest_daily_date ?? "";
    g.emaKill = d.ema_kill ?? 0;
    g.recalcHero();
    g.hero.hp = Math.min(d.hero_hp ?? g.hero.max_hp, g.hero.max_hp);
    g.events.length = 0;
    g.log(`存档已读取: Lv.${g.level} · 第${g.zone}区·${g.stage}层`, "bright_cyan");
    if (g.classId) g.spawn();
    return g;
  }

  static load(): Game {
    const raw = saveHooks?.readRaw();
    if (!raw) return new Game();
    let d: Record<string, any>;
    try {
      d = JSON.parse(raw);
    } catch {
      const g = new Game();
      g.log("存档损坏,已重新开始。", "bright_red");
      return g;
    }
    d = migrateSave(d);
    const g = Game.fromDict(d);
    const dt = Date.now() / 1000 - (d.last_saved ?? Date.now() / 1000);
    const rep = systems.resolveOffline(g, dt);
    if (rep) g.pendingOffline = rep;
    return g;
  }
}

// ---------------------------------------------------------------- 迁移链
export function migrateSave(d: Record<string, any>): Record<string, any> {
  let v = d.version ?? 1;
  if (v < 2) {
    if (d.seed === undefined) d.seed = Math.floor(Math.random() * 2 ** 31);
    d.version = 2;
    v = 2;
  }
  if (v < 3) {
    d.stat_mods = [];
    d.version = 3;
    v = 3;
  }
  if (v < 4) {
    const old = d.skills ?? {};
    d.class_id = "warrior";
    const mapping: Record<string, string> = {
      strike: "w_strike", warcry: "w_warcry", execute: "w_exec",
    };
    d.loadout = { active: ["w_strike"], passive: ["pw_tough"] };
    const skillLv: Record<string, number> = {};
    for (const [oldId, lv] of Object.entries(old)) {
      const newId = mapping[oldId];
      if (newId) skillLv[newId] = Math.max(1, Math.trunc(lv as number));
    }
    d.skill_lv = skillLv;
    d.version = 4;
    v = 4;
  }
  if (v < 5) {
    // v4 → v5:遗物与爬塔系统
    d.relics = [null, null, null, null];
    d.tower = { keys: 3, max_floor: 0, last_refresh: null };
    d.version = 5;
  }
  return d;
}
