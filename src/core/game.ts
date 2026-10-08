/** Game:无 UI 依赖的游戏状态机(与 abyss/game.py 语义一致,存档 v4 兼容)。
 *
 * 平台 IO(存档读写)由宿主在启动时注入 saveHooks —— CLI 用文件,网页用
 * localStorage,服务器(P3)用数据库;核心零平台依赖。
 */
import { c, fmt } from "./ansi.ts";
import { battleTick, spawnMonster, tierOf, mobGold } from "./combat.ts";
import type { Monster } from "./combat.ts";
import {
  ACTIVE_DEF, ACTIVE_SKILLS, ACHIEVEMENTS, BAL, CAPS, CLASSES, PASSIVE_DEF, PASSIVE_SKILLS,
  RARITIES, RARITY_IDX, REDEEM_CODES, SIGNIN_REWARDS, STAT_NAMES, TITLES,
  WEEKLY_CHEST, WEEKLY_GOALS, TOWER, ALTAR_LINES, POTIONS,
} from "./data.ts";
import { Item, rollItem } from "./items.ts";
import * as RL from "./relics.ts";
import { Relic } from "./relics.ts";
import * as TW from "./tower.ts";
import type { TowerState } from "./tower.ts";
import { PyRandom } from "./rng.ts";
import * as systems from "./systems.ts";
import * as S from "./skills.ts";

export const SAVE_VERSION = 8;

/** 本地日期键 YYYY-MM-DD(签到口径,按玩家本地时区) */
function todayKey(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
/** ISO 周标识(周一为一周之始):如 2026-W41(周常口径) */
function isoWeekKey(t: Date): string {
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));       // 本周四(ISO 定年口径)
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${week}`;
}
/** 称号 id → 显示名(未知 id 返回原值) */
function titleName(id: string): string {
  return TITLES.find(t => t.id === id)?.name ?? id;
}
export const EVENT_CAP = 2000;

/** 手动模式待确认换装:自动换装关闭时,更强掉落弹新旧对比由玩家定夺 */
export interface PendingSwap {
  kind: "item" | "relic";
  slot?: string;         // item:装备部位键
  item?: Item;           // item:新装备(已入背包,确认时按引用查找)
  relicSlot?: number;    // relic:建议对比/替换的遗物槽
  newRelic?: Relic;      // relic:新遗物(暂存,确认后入槽或入包)
}
const VIRTUAL_STATS = ["skill_dmg", "cd_reduce", "dodge", "armor_pierce", "xp_pct",
  "crit_extra", "kill_heal", "deathward",
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
  crit_extra: number; kill_heal: number;
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
  deathTier = -1;             // 最近一次战败发生地的 tier(推进超过它才算真新进度)
  autoFarm = false;           // 当前挂机是否为"受阻自动转入"(仅此状态会自动回推进)
  mode: "push" | "farm" = "push";
  farmStage = 1;
  equip: Record<string, Item> = {};
  bag: Item[] = [];
  classId: string | null = null;
  rebirths = 0;                 // 转生次数(终身累计;倍率在 recalcHero 生效)
  rebirthHinted = false;        // 本世是否已提示过转生解锁(瞬态,不序列化;转生时重置)
  loadout: Loadout = { active: [], passive: [] };
  skillLv: Record<string, number> = {};
  skillCd: Record<string, number> = {};
  buffs: Record<string, { pct: number; until: number }> = {};
  stats: Record<string, number> = {
    kills: 0, boss_kills: 0, deaths: 0, enhance_total: 0,
    gold_earned: 0, max_zone: 1, reforge_total: 0, quest_done: 0,
  };
  settings: Record<string, any> = { auto_equip: true, auto_sell_idx: -1 };
  /** 分怪击杀计数(图鉴用):monster id → 累计击杀;普通/精英/头目变体合并计 */
  monKills: Record<string, number> = {};
  /** 每日签到:7 日循环位置(0..6);断签(隔天未领)由 rollDaily 重置 */
  signinPos = 0;
  /** 最后领取日(本地日期 YYYY-MM-DD);""=从未 */
  signinLast = "";
  /** 当前 ISO 周标识(周一为界);变化时周常清零 */
  weekKey = "";
  /** 周常计数:metric → 本周值 */
  weekly: Record<string, number> = {};
  /** 已领周宝箱(chest3/chest6) */
  weeklyClaimed: string[] = [];
  /** 已获称号(id 列表,见 TITLES) */
  titles: string[] = [];
  /** 佩戴中称号 id;""=无 */
  title = "";
  /** 世系档案:每次转生记一条(最近在前,最多 50 条) */
  lineage: { cls: string; level: number; zone: number; kills: number; dur: number }[] = [];
  /** 本世开始的终身游玩时长(世系耗时统计) */
  runStartPlaytime = 0;
  /** 本世最远区域(方案B 转生深度权重用;转生时清 1) */
  runMaxZone = 1;
  /** 已兑换码(FNV 哈希,防重复) */
  redeemed: number[] = [];
  /** 自动化运行时(不序列化):分钟级汇总日志 + 上次 flush 时刻 */
  private autoSum = { enh: 0, skill: 0, altar: 0, at: 0 };
  /** 成就跨档基线(null=未建):会话内首检静默建基线,此后升档才发提示;不序列化,重载不补发 */
  private achBaseline: Record<string, number> | null = null;
  quests: systems.Quest[] = [];
  questDailyCount = 0;        // 今日已完成悬赏数(上限 BAL.quest_daily_limit)
  questRerollCount = 0;       // 今日悬赏刷新次数(上限 BAL.quest_reroll_max)
  towerKeysBought = 0;        // 今日已加购塔钥匙数(上限 BAL.tower_key_extra)
  altarLv: Record<string, number> = {};   // 深渊祭坛各线等级(金币→永久属性)
  potionBought: Record<string, number> = {};   // 药剂已购次数(价格翻倍阶梯,按种类独立)
  bagExpLv = 0;               // 背包扩容次数(每 +1 扩 BAL.bag_expand_step 格,至 bag_expand_max)
  questDailyDate = "";        // 本地日期 YYYY-MM-DD,跨日重置计数
  events: [string, string, string][] = [];
  statMods: { src: string; stat: string; op: "add" | "pct"; v: number }[] = [];
  view: any = null;          // 宿主挂载呈现层,核心不读写
  // ---- 遗物 & 塔 ----
  relics: (Relic | null)[] = [null, null, null, null];   // 4 槽
  relicBag: Relic[] = [];    // 遗物背包(4 槽满时收纳,可扩容)
  relicBagLv = 1;            // 背包容量等级(容量翻倍,封顶 BAL.relic_bag_cap)
  tower: TowerState = { keys: 3, max_floor: 0, last_refresh: null };
  towerFloorSel = 1;         // 爬塔中当前挑战的层(进塔固定为 max_floor+1)
  inTower = false;           // 当前在塔战斗中
  monster: Monster | null = null;
  respawnTimer = 0;
  lastSpawnTime: number | null = null;
  emaKill = 0;
  lastDeathTime = -999;
  pendingOffline: systems.ResolveReport | null = null;
  pendingSwap: PendingSwap | null = null;   // 手动模式换装对比(不序列化,存档时遗物兜底入包)
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

  // ================================================================ 转生
  /** 门槛:等级达标且不在塔中(战败/换装弹窗无碍,UI 层自行拦截) */
  canRebirth(): boolean {
    return this.classId !== null && !this.inTower && this.level >= BAL.rebirth_min_level;
  }

  /** 转生:重置本局成长(等级/装备/背包/金币/技能等级),保留永久元进度
   *  (成就/祭坛/遗物/塔记录/重铸石/背包容量),每次 +25% 三围与 +10% 金币经验;
   *  newClass 省略 = 保持当前职业,传新职业 id = 转生时换职业(职业锁的唯一出口)。 */
  rebirth(newClass?: string): void {
    if (!this.canRebirth()) {
      this.toast(this.inTower ? "塔中无法转生" : `转生需 Lv.${BAL.rebirth_min_level}`);
      return;
    }
    const cid = newClass && CLASSES[newClass] ? newClass : this.classId!;
    // 方案B:本世深度加权 k —— 踩线(≈130区)=基准 1 档,越深越多,封顶 4 档
    const depth = Math.max(1, this.runMaxZone);
    const k = Math.min(BAL.rebirth_k_max,
      Math.max(BAL.rebirth_k_min, depth / BAL.rebirth_depth_ref));
    const n = this.rebirths + k;
    // —— 世系档案:记下这一世(最近在前,封顶 50 条)+ 周常/称号 ——
    this.lineage.unshift({ cls: this.classId ?? "?", level: this.level,
      zone: this.runMaxZone, kills: this.stats.kills,
      dur: Math.max(0, Math.round(this.playtime - this.runStartPlaytime)) });
    if (this.lineage.length > 50) this.lineage.length = 50;
    this.runStartPlaytime = this.playtime;
    this.weeklyBump("rebirths", 1);
    for (const t of TITLES) {
      const th = t.cond.match(/转生 (\d+) 次/);
      if (th && Math.floor(n) >= Number(th[1]) && !this.titles.includes(t.id)) {
        this.titles.push(t.id);
        this.log(`👑 获得称号「${t.name}」(${t.cond})`, "bright_yellow");
      }
    }
    // —— 重置(本局成长)——
    this.level = 1;
    this.xp = 0;
    this.zone = 1;
    this.stage = 1;
    this.stageKills = 0;
    this.deathsRow = 0;
    this.deathTier = -1;
    this.mode = "push";
    this.autoFarm = false;
    this.farmStage = 1;
    this.gold = 0;
    this.equip = {};
    this.bag = [];
    this.skillLv = {};
    this.buffs = {};
    this.pendingSwap = null;
    this.monster = null;
    this.respawnTimer = 0;
    this.settings.speed = 1;
    // —— 保留(永久元进度):stones/altarLv/relics/relicBag/tower/bagExpLv/
    //    potionBought/stats(终身)/daily 计数;playtime 不重置(离线与包络都按终身时长计)
    this.rebirths = n;
    this.runMaxZone = 1;
    this.rebirthHinted = false;
    this.classId = cid;
    this.skillCd = {};
    for (const s of ACTIVE_SKILLS) this.skillCd[s.id] = 0;
    this.loadout = { active: [], passive: [] };
    for (const s of ACTIVE_SKILLS) {
      if (s.cls === cid && s.unlock <= 1) { this.loadout.active.push(s.id); break; }
    }
    for (const s of PASSIVE_SKILLS) {
      if (s.cls === cid && s.unlock <= 1) { this.loadout.passive.push(s.id); break; }
    }
    // 悬赏按新局重掷(目标随区域缩放,旧深区目标在新局无从完成)
    this.quests = [systems.rollQuest(1, this.rng), systems.rollQuest(1, this.rng),
      systems.rollQuest(1, this.rng)];
    this.recalcHero();
    this.hero.hp = this.hero.max_hp;
    const cls = CLASSES[cid];
    this.log(`♻ 转生!本世最远 ${depth} 区 → 收获 ×${k.toFixed(2)} 档;以 ${cls.name} 之名重生:` +
      `攻击/生命/防御 +${(BAL.rebirth_stat_pct * n).toFixed(1)}% · 金币/经验 +${(BAL.rebirth_gain_pct * n).toFixed(1)}%`,
      "bright_magenta");
    this.toast(`转生成功 · 收获 ×${k.toFixed(2)} 档`);
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
    // 统一修饰管道:成就 + 图鉴 + 祭坛 + 被动技能 + 遗物 + 外部挂口;先加后乘,再截断
    // 成就新维度的三个口径同步(终身统计已有数据,只是此前不进 stats 快照)
    this.stats.rebirths = this.rebirths;
    this.stats.max_floor = this.tower.max_floor;
    this.stats.playtime = Math.trunc(this.playtime);
    const mods = [
      ...systems.achievementMods(this.stats),
      ...systems.codexMods(this.monKills),
      ...systems.altarMods(this.altarLv),
      ...(this.classId ? S.passiveMods(this) : []),
      ...RL.relicMods(this.relics),
      ...this.statMods,
    ];
    for (const m of mods) if (m.op === "add") agg[m.stat] = (agg[m.stat] ?? 0) + m.v;
    for (const m of mods) if (m.op === "pct") agg[m.stat] = (agg[m.stat] ?? 0) * (1 + m.v / 100);
    // 转生倍率:三围乘区 + 金币/经验加成(加法叠加);在截断前生效,CAPS 仍兜底
    if (this.rebirths > 0) {
      const m = 1 + BAL.rebirth_stat_pct * this.rebirths / 100;
      agg.hp *= m;
      agg.atk *= m;
      agg.def *= m;
      agg.goldfind = (agg.goldfind ?? 0) + BAL.rebirth_gain_pct * this.rebirths;
      agg.xp_pct = (agg.xp_pct ?? 0) + BAL.rebirth_gain_pct * this.rebirths;
    }
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
      if (this.level >= BAL.rebirth_min_level && !this.rebirthHinted) {
        this.rebirthHinted = true;
        this.log("★ 转生已解锁(角色页)——卡墙时转生收益最大;转生可更换职业", "bright_magenta");
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
    if (this.bag.length >= this.bagCap()) {
      // 背包满仍允许自动换装:长挂机背包必然满,若不换装装备将永久冻结、深度停滞
      if (systems.autoEquipCheck(this, item)) return;
      const price = item.sellPrice();
      this.gold += price;
      this.stats.gold_earned += price;
      this.log(`背包已满,${item.display()} 自动出售 (+${fmt(price)})`, "bright_black");
      return;
    }
    if (this.settings.auto_equip) {
      systems.autoEquipCheck(this, item);
    } else if (!this.pendingSwap) {
      // 手动模式:更强掉落弹新旧对比(已有待确认时不重复弹)
      const cur = this.equip[item.slot];
      if (!cur || item.score() > cur.score()) {
        this.pendingSwap = { kind: "item", slot: item.slot, item };
      }
    }
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
      if (this.bag.length >= this.bagCap()) {
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
    if (this.bag.length >= this.bagCap()) { this.toast("背包已满"); return; }
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

  /** 一键出售背包中品质 ≤ maxRid 的装备(默认 1=普通+精良;CLI 键位沿用默认) */
  sellJunk(maxRid = 1): void {
    let n = 0, gold = 0;
    const keep: Item[] = [];
    for (const it of this.bag) {
      if (!it.locked && RARITY_IDX[it.rarity] <= maxRid) { gold += it.sellPrice(); n++; }
      else keep.push(it);
    }
    if (n) {
      this.bag = keep;
      this.gold += gold;
      this.stats.gold_earned += gold;
      this.log(`一键出售 ${n} 件 ≤${RARITIES[maxRid].name} (+${fmt(gold)} 金币)`, "bright_black");
      this.toast(`出售 ${n} 件 +${fmt(gold)}`);
    } else {
      this.toast("没有可出售的装备");
    }
  }

  /** 锁定/解锁背包装备:锁定件免于一键出售与批量分解(单件"分解"也会拦截) */
  toggleLock(idx: number): void {
    if (idx < 0 || idx >= this.bag.length) return;
    const it = this.bag[idx];
    it.locked = !it.locked;
    this.toast(it.locked ? `🔒 已锁定 ${it.name}(不出售/不分解)` : `🔓 已解锁 ${it.name}`);
  }

  /** 一键分解 ≤ 所选品质(跳过锁定件):金币略高于出售价,史诗+附重铸石 */
  dismantleJunk(maxRid = 3): void {
    let n = 0, gold = 0, stones = 0;
    const keep: Item[] = [];
    for (const it of this.bag) {
      if (!it.locked && RARITY_IDX[it.rarity] <= maxRid) {
        const [g, s] = it.dismantle();
        gold += g; stones += s; n++;
      } else keep.push(it);
    }
    if (n) {
      this.bag = keep;
      this.gold += gold;
      this.stones += stones;
      this.stats.gold_earned += gold;
      this.log(`一键分解 ${n} 件 ≤${RARITIES[maxRid].name} (+${fmt(gold)} 金币` +
        `${stones ? `, +${stones} 重铸石` : ""})`, "bright_magenta");
      this.toast(`分解 ${n} 件 +${fmt(gold)}金${stones ? `/${stones}石` : ""}`);
    } else {
      this.toast("没有可分解的装备(锁定件跳过)");
    }
  }

  dismantleItem(idx: number): void {
    if (idx >= 0 && idx < this.bag.length) {
      const it = this.bag[idx];
      if (it.locked) { this.toast("已锁定,先解锁再分解"); return; }
      this.bag.splice(idx, 1);
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
  enhance(slot: string, quiet = false): void {
    const it = this.equip[slot];
    if (!it) { if (!quiet) this.toast("该部位没有装备"); return; }
    if (it.plus >= BAL.plus_max) { if (!quiet) this.toast(`已达强化上限 +${BAL.plus_max}`); return; }
    const cost = it.enhanceCost();
    if (this.gold < cost) { if (!quiet) this.toast(`金币不足 (需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    it.plus += 1;
    this.stats.enhance_total += 1;
    this.weeklyBump("enhance", 1);   // 周常:本周强化次数
    this.questProgress("enhance", 1);
    this.recalcHero();
    if (!quiet) {
      this.log(`⚒ ${it.name} 强化至 +${it.plus}`, "bright_yellow");
      this.toast(`${it.name} +${it.plus}`);
    }
  }

  /** 十连强化:连续强化至多 n 次(钱不够/到上限即停),一次性汇报 */
  enhanceMulti(slot: string, times = 10): void {
    const it = this.equip[slot];
    if (!it) { this.toast("该部位没有装备"); return; }
    const plus0 = it.plus;
    let spent = 0, n = 0;
    while (n < times) {
      if (it.plus >= BAL.plus_max) break;
      const cost = it.enhanceCost();
      if (this.gold < cost) break;
      this.gold -= cost;
      it.plus += 1;
      spent += cost;
      n += 1;
      this.stats.enhance_total += 1;
      this.weeklyBump("enhance", 1);
      this.questProgress("enhance", 1);
    }
    if (n > 0) {
      this.recalcHero();
      this.log(`⚒ ${it.name} 强化至 +${it.plus}(十连 ×${n},共 ◈${fmt(spent)})`, "bright_yellow");
      this.toast(`${it.name} +${plus0}→+${it.plus}(×${n})`);
    } else {
      this.toast(it.plus >= BAL.plus_max ? "已达强化上限" : "金币不足");
    }
  }

  /** 背包容量 = 基础 + 扩容步长×次数(上限 bag_expand_max) */
  bagCap(): number {
    return Math.min(BAL.bag_size + BAL.bag_expand_step * this.bagExpLv, BAL.bag_expand_max);
  }
  /** 下一次扩容费用(多项式递增,不随深度缩水);已满返回 null */
  bagExpandCost(): number | null {
    if (this.bagCap() >= BAL.bag_expand_max) return null;
    const n = this.bagExpLv + 1;
    return Math.round(BAL.bag_expand_cost0 * n + BAL.bag_expand_cost_k * n * n);
  }
  buyBagSlots(): void {
    const cost = this.bagExpandCost();
    if (cost === null) { this.toast(`背包已达上限 ${BAL.bag_expand_max} 格`); return; }
    if (this.gold < cost) { this.toast(`金币不足 (需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.bagExpLv += 1;
    this.log(`🎒 背包扩容至 ${this.bagCap()} 格`, "bright_cyan");
    this.toast(`背包 ${this.bagCap()} 格`);
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

  skillUp(sid: string, quiet = false): void {
    const d = ACTIVE_DEF[sid] ?? PASSIVE_DEF[sid];
    if (!d || d.cls !== this.classId || this.level < d.unlock) {
      if (!quiet) this.toast("技能未解锁");
      return;
    }
    if ((this.skillLv[sid] ?? 1) >= BAL.skill_lv_max) {
      if (!quiet) this.toast(`已达上限 Lv.${BAL.skill_lv_max}`);
      return;
    }
    const cost = this.skillCost(sid);
    if (this.gold < cost) { if (!quiet) this.toast(`金币不足 (需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.skillLv[sid] = (this.skillLv[sid] ?? 1) + 1;
    this.recalcHero();
    if (!quiet) {
      this.log(`技能升级:${d.name} Lv.${this.skillLv[sid]}(有效 ${S.effLv(this, sid)})`,
        "bright_cyan");
      this.toast(`${d.name} Lv.${this.skillLv[sid]}`);
    }
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
    if (this.mode === "farm") {
      // 挂机态任意击杀即清零"卡层"计数:偶发胜负交替的层位是健康挂机位
      this.deathsRow = 0;
    }
    if (this.mode === "push") {
      if (this.stage >= 10) {
        this.zone += 1;
        this.stage = 1;
        this.stageKills = 0;
        // 只有推过死亡高水位才算真新进度并清零受阻计数;
        // "死→退层→杀满→推回原层"的原地震荡不再清零
        if (tierOf(this.zone, this.stage) > this.deathTier) this.deathsRow = 0;
        if (this.zone > this.stats.max_zone) {
          this.stats.max_zone = this.zone;
          this.runMaxZone = Math.max(this.runMaxZone, this.zone);   // 方案B:本世最远
          this.weeklyBump("zones", 1);   // 周常:本周推进新区数
        }
        this.toast(`进入第 ${this.zone} 区`);
      } else if (this.stageKills >= BAL.kills_per_stage) {
        this.stage += 1;
        this.stageKills = 0;
        if (tierOf(this.zone, this.stage) > this.deathTier) this.deathsRow = 0;
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
    this.deathTier = tierOf(this.zone, this.stage);   // 记在退层前:战败发生地
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
      // 挂机层位是锚点:偶发战败原地复活再战,不被逐次战败磨低;
      // 连续 N 败(一次都赢不了)才是层位过高,退 3 层止损
      if (this.deathsRow >= BAL.farm_stuck_row) {
        let safe = this.stage - 3;
        if (safe < 1 && this.zone > 1) {
          this.zone -= 1;
          safe += 7;
        }
        this.stage = Math.max(1, Math.min(10, safe));
        this.farmStage = this.stage;
        this.deathsRow = 0;
        this.log(`挂机层位连续战败,退至 第${this.zone}区·${this.stage}层`, "bright_cyan");
      }
    }
    if (this.deathsRow >= BAL.death_row_to_farm && this.mode === "push") {
      this.mode = "farm";
      this.autoFarm = true;
      let safe = this.stage - 3;
      if (safe < 1 && this.zone > 1) {
        this.zone -= 1;
        safe += 7;
      }
      this.stage = Math.max(1, Math.min(10, safe));
      this.farmStage = this.stage;
      this.log(`推进受阻(连续${BAL.death_row_to_farm}次战败未能深入),自动转入挂机模式` +
        `(第${this.zone}区·${this.stage}层);把攒下的金币花在强化/技能上,即可自动恢复推进。`,
        "bright_cyan");
    }
  }

  setMode(mode: "push" | "farm"): void {
    if (mode === "farm") {
      this.farmStage = this.stage;
      this.mode = "farm";
      this.autoFarm = false;   // 手动挂机:尊重玩家选择,不自动回推进
      this.log(`切换为挂机模式:停留在 第${this.zone}区·${this.stage}层`, "bright_cyan");
    } else {
      this.mode = "push";
      this.deathsRow = 0;      // 手动回推:受阻计数与死亡高水位重置,重整旗鼓
      this.deathTier = -1;
      this.autoFarm = false;
      this.log("切换为推进模式:击败敌人继续深入", "bright_cyan");
    }
    this.spawn();
  }

  /** 挂机自恢复:仅"受阻自动转入"的挂机会在 30 秒无死亡且装备追上层级
   *  (最高装备 tier ≥ 当前层 tier − 12)时自动回推进,挂机-推进形成闭环;
   *  手动选择的挂机层位不受影响。 */
  maybeAutoPush(): void {
    if (!this.autoFarm || this.mode !== "farm" || this.inTower) return;
    if (this.time - this.lastDeathTime <= 30) return;
    let eqT = 0;
    for (const it of Object.values(this.equip)) eqT = Math.max(eqT, it.tier);
    if (eqT >= tierOf(this.zone, this.stage) - 12) this.setMode("push");
  }

  setFarmStage(delta: number): void {
    this.farmStage = Math.min(10, Math.max(1, this.farmStage + delta));
    this.autoFarm = false;     // 手动调整挂机层位 = 接管该模式,停止自动回推
    if (this.mode === "farm") {
      this.stage = this.farmStage;
      this.spawn();
    }
    this.toast(`挂机层位:${this.farmStage}层`);
  }

  // ================================================================ 塔 & 遗物
  /** 爬塔:从最高层+1 开始爬,连胜连爬(每层 1 把钥匙),钥匙耗尽/战败/撤退时离塔 */
  towerEnter(): void {
    if (this.inTower) {
      this.toast("正在塔中");
      return;
    }
    if (this.tower.keys < 1) {
      this.toast("钥匙不足(每天送3把)");
      return;
    }
    const floor = this.tower.max_floor + 1;
    this.tower.keys -= 1;
    this.inTower = true;
    this.towerFloorSel = floor;
    const mon = TW.towerMonster(floor, this.rng);
    this.monster = mon;
    this.lastSpawnTime = this.time;
    this.log(`🔑 进入深渊塔·第${floor}层${mon.boss ? "(头目!)" : ""},胜利后连爬`, "bright_cyan");
  }

  /** 离开塔(胜利结算/战败退出/手动撤退);胜利且还有钥匙时继续爬下一层 */
  towerExit(won = false): void {
    if (!this.inTower) return;
    if (won) {
      const floor = this.towerFloorSel;
      // 金币
      const gold = TW.towerGold(floor) * (1 + this.hero.goldfind / 100);
      this.gold += Math.trunc(gold);
      this.stats.gold_earned += Math.trunc(gold);
      // 掉落遗物(必掉)
      const relic = TW.rollTowerDrop(floor, this.rng, this.hero.luck ?? 0, this.loadout.active);
      this.addRelic(relic);
      // 新高奖励
      if (floor > this.tower.max_floor) {
        this.tower.max_floor = floor;
        this.stones += TOWER.new_height_stones;
        this.log(`★ 新高度!第${floor}层 +${TOWER.new_height_stones}重铸石`, "bright_yellow");
      }
      this.log(`✔ 塔第${floor}层通关!获得 ${relic.display()}`, "bright_cyan");
      if (this.tower.keys >= 1) {
        // 连爬:钥匙逐层消耗,直到钥匙耗尽/战败/手动撤退
        this.tower.keys -= 1;
        this.towerFloorSel = floor + 1;
        const mon = TW.towerMonster(this.towerFloorSel, this.rng);
        this.monster = mon;
        this.lastSpawnTime = this.time;
        this.log(`🔑 继续爬塔·第${this.towerFloorSel}层${mon.boss ? "(头目!)" : ""}`, "bright_cyan");
        return;
      }
      this.inTower = false;
      this.monster = null;
      this.log("钥匙耗尽,离开深渊塔", "bright_cyan");
    } else {
      this.inTower = false;
      this.log(`✘ 塔第${this.towerFloorSel}层失败…钥匙已消耗`, "bright_red");
      this.monster = null;
      this.respawnTimer = BAL.respawn_sec;
    }
  }

  /** 遗物:优先装空槽;满槽时若强于效果最少的一件,弹新旧对比由玩家定夺;
   *  否则存入背包(有空位时);背包也满才替换效果最少的 */
  addRelic(relic: Relic): void {
    for (let i = 0; i < this.relics.length; i++) {
      if (this.relics[i] === null) {
        this.relics[i] = relic;
        this.recalcHero();
        this.log(`获得遗物 ${relic.display()}(装入槽${i + 1})`, "bright_magenta");
        return;
      }
    }
    // 满槽:找效果最少的一件(对比与兜底替换共用)
    let worstI = 0;
    let worstN = 99;
    for (let i = 0; i < this.relics.length; i++) {
      const r = this.relics[i];
      if (r && r.effects.length < worstN) {
        worstN = r.effects.length;
        worstI = i;
      }
    }
    if (!this.pendingSwap && relic.effects.length > worstN) {
      this.pendingSwap = { kind: "relic", relicSlot: worstI, newRelic: relic };
      return;
    }
    if (this.relicBag.length < this.relicBagCap()) {
      this.relicBag.push(relic);
      this.log(`获得遗物 ${relic.display()}(存入背包 ${this.relicBag.length}/${this.relicBagCap()})`,
        "bright_magenta");
      return;
    }
    // 背包也满:自动替换效果最少的(兜底,不丢新遗物)
    const old = this.relics[worstI]!;
    this.relics[worstI] = relic;
    this.recalcHero();
    this.log(`遗物 ${relic.display()} 替换 ${old.display()}`, "bright_magenta");
  }

  /** 强化继承手续费:把 +n 转到新件,按新件自身强化费用曲线的 50% 计
   *  (曲线与 Item.enhanceCost 同式:base × (1+a·k+b·k²),k=新件当前级位) */
  inheritCost(target: Item, n: number): number {
    const base = BAL.enhance_cost0 + BAL.enhance_cost_t * target.tier;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += base * (1 + BAL.enhance_plus_a * k + BAL.enhance_plus_b * k * k);
    }
    return Math.round(sum * 0.5);
  }

  /** 处理换装对比弹窗的选择(take=true 换上新的,false 保留旧的);
   *  inherit=true 时把旧件强化 +N 转移到新件(收新件费用曲线 50% 手续费,旧件清零) */
  resolveSwap(take: boolean, inherit = false): void {
    const p = this.pendingSwap;
    if (!p) return;
    this.pendingSwap = null;
    if (p.kind === "item") {
      if (take) {
        if (!this.bag.includes(p.item!)) { this.toast("新装备已不在背包"); return; }
        const old = p.slot ? this.equip[p.slot] : undefined;
        if (inherit && old && old.plus > 0 && p.item) {
          const n = Math.min(old.plus, BAL.plus_max);
          const fee = this.inheritCost(p.item, n);
          if (this.gold < fee) {
            this.toast(`金币不足,无法继承(需 ◈${fmt(fee)});按普通换装处理`);
          } else {
            this.gold -= fee;
            p.item.plus = n;
            old.plus = 0;
            this.log(`⚒ 强化继承:${p.item.name} 直接 +${n}(手续费 ◈${fmt(fee)},旧件清零)`,
              "bright_yellow");
            this.toast(`继承成功 +${n}(◈${fmt(fee)})`);
          }
        }
        this.equipItem(p.item!);
      }
      return;   // 保留:新装备留在背包
    }
    if (take) {
      if (this.relicBag.length >= this.relicBagCap()) {
        this.toast("遗物背包已满,无法替换(可先扩容)");
        return;
      }
      const old = this.relics[p.relicSlot!];
      this.relics[p.relicSlot!] = p.newRelic!;
      if (old) this.relicBag.push(old);
      this.recalcHero();
      this.log(old
        ? `遗物 ${p.newRelic!.display()} 替换 ${old.display()}(旧件存入背包)`
        : `遗物 ${p.newRelic!.display()} 装入槽${(p.relicSlot ?? 0) + 1}`, "bright_magenta");
    } else if (this.relicBag.length < this.relicBagCap()) {
      this.relicBag.push(p.newRelic!);
      this.log(`遗物 ${p.newRelic!.display()} 存入背包 ${this.relicBag.length}/${this.relicBagCap()}`,
        "bright_magenta");
    } else {
      // 保留但背包满:兜底替换效果最少的一件
      let worstI = 0;
      let worstN = 99;
      for (let i = 0; i < this.relics.length; i++) {
        const r = this.relics[i];
        if (r && r.effects.length < worstN) { worstN = r.effects.length; worstI = i; }
      }
      const old = this.relics[worstI]!;
      this.relics[worstI] = p.newRelic!;
      this.recalcHero();
      this.log(`遗物背包已满:${p.newRelic!.display()} 替换 ${old.display()}`, "bright_magenta");
    }
  }

  /** 遗物背包容量(等级翻倍,封顶 relic_bag_cap):Lv1=40 → 80 → 160 → 200 */
  relicBagCap(): number {
    return Math.min(BAL.relic_bag_base * 2 ** (this.relicBagLv - 1), BAL.relic_bag_cap);
  }

  /** 下一级扩容费用;已满级返回 null(1w/5w/25w,每级 ×5) */
  relicBagCost(): number | null {
    if (this.relicBagCap() >= BAL.relic_bag_cap) return null;
    return Math.trunc(BAL.relic_bag_cost0 * BAL.relic_bag_cost_k ** (this.relicBagLv - 1));
  }

  upgradeRelicBag(): void {
    const cost = this.relicBagCost();
    if (cost === null) {
      this.toast(`遗物背包已满级(${BAL.relic_bag_cap} 格)`);
      return;
    }
    if (this.gold < cost) {
      this.toast(`金币不足:扩容需 ${fmt(cost)}`);
      return;
    }
    this.gold -= cost;
    this.relicBagLv++;
    this.log(`🎒 遗物背包扩容:${this.relicBagCap()} 格( Lv.${this.relicBagLv})`, "bright_cyan");
  }

  /** 从背包装备遗物到空槽 */
  equipRelicFromBag(idx: number): void {
    const r = this.relicBag[idx];
    if (!r) return;
    let i = this.relics.indexOf(null);
    if (i < 0) {
      // 满槽:替换效果最少的一件,旧件回到背包(刚腾出的格子收纳)
      let worstN = 99;
      for (let k = 0; k < this.relics.length; k++) {
        const cur = this.relics[k];
        if (cur && cur.effects.length < worstN) { worstN = cur.effects.length; i = k; }
      }
      const old = this.relics[i]!;
      this.relics[i] = r;
      this.relicBag.splice(idx, 1);
      this.relicBag.push(old);
      this.recalcHero();
      this.log(`遗物 ${r.display()} 替换槽${i + 1}的 ${old.display()}`, "bright_magenta");
      return;
    }
    this.relicBag.splice(idx, 1);
    this.relics[i] = r;
    this.recalcHero();
    this.log(`遗物 ${r.display()} 从背包装入槽${i + 1}`, "bright_magenta");
  }

  /** 分解背包中的遗物:+1 重铸石(洗练石) */
  relicDismantle(idx: number): void {
    const r = this.relicBag[idx];
    if (!r) return;
    this.relicBag.splice(idx, 1);
    this.stones += 1;
    this.log(`分解遗物 ${r.display()} → +1 重铸石`, "bright_magenta");
    this.toast(`分解 ${r.name} +1✦`);
  }

  unequipRelic(idx: number): void {
    if (idx >= 0 && idx < 4 && this.relics[idx]) {
      if (this.relicBag.length >= this.relicBagCap()) {
        this.toast("遗物背包已满,无法卸下(可先扩容)");
        return;
      }
      const r = this.relics[idx]!;
      this.relics[idx] = null;
      this.relicBag.push(r);
      this.recalcHero();
      this.toast(`已卸下并存入背包(${this.relicBag.length}/${this.relicBagCap()})`);
    }
  }

  towerRefreshKeys(): void {
    const gained = TW.refreshKeys(this.tower, Date.now() / 1000);
    if (gained > 0) {
      this.log(`🔑 每日钥匙 +${gained}(现有 ${this.tower.keys})`, "bright_cyan");
    }
  }

  // ================================================================ 金币消耗(祭坛/药剂/钥匙/悬赏刷新)
  /** 成就跨档检测:对比 stats 与基线档位,升档发日志+toast。首检(新建/载入后)静默建基线 */
  checkAchTiers(): void {
    const base = this.achBaseline;
    const next: Record<string, number> = {};
    for (const a of ACHIEVEMENTS) {
      const val = this.stats[a.metric] ?? 0;
      let tiers = 0;
      for (const t of a.thresholds) if (val >= t) tiers++;
      next[a.id] = tiers;
      if (base !== null && tiers > (base[a.id] ?? 0)) {
        const statName = STAT_NAMES[a.stat] ?? a.stat;
        const bonus = a.per * tiers;
        const unit = a.stat === "crit" || a.stat === "goldfind" ? " 点" : "%";
        this.log(`🏆 成就「${a.name}」升至第 ${tiers}/${a.thresholds.length} 档:` +
          `${statName} 永久加成 +${bonus}${unit}`, "bright_yellow");
        this.toast(`🏆 ${a.name} 第 ${tiers} 档(${statName} +${bonus}${unit})`);
      }
    }
    this.achBaseline = next;
  }

  /** 玩家自动化(设置页三开关,Lv 逐步解锁):每秒一拍,各系统至多买一档,
   *  金币预留倍数防梭空;口径与开发机器人 autopilot(host.ts)一致——
   *  强化最弱部位(>2×费)、升已装配技能(>4×费)、买最便宜祭坛线(>4×费)。
   *  购买静默(防每秒刷屏),按分钟汇总一条日志 */
  private autoTick(): void {
    if (Math.trunc(this.time * 10) % 10 !== 0) return;   // 1 秒一拍
    if (!this.classId) return;
    if (this.settings.auto_enhance && this.level >= BAL.auto_enhance_lv) {
      const items = Object.values(this.equip);
      if (items.length) {
        const weakest = items.reduce((a, b) => (b.plus < a.plus ? b : a));
        if (weakest.plus < BAL.plus_max && this.gold > weakest.enhanceCost() * 2) {
          this.enhance(weakest.slot, true);
          this.autoSum.enh += 1;
        }
      }
    }
    if (this.settings.auto_skill && this.level >= BAL.auto_skill_lv && this.gold > 2000) {
      for (const sid of [...this.loadout.active, ...this.loadout.passive]) {
        if ((this.skillLv[sid] ?? 1) >= BAL.skill_lv_max) continue;
        if (this.gold > this.skillCost(sid) * 4) {
          this.skillUp(sid, true);
          this.autoSum.skill += 1;
          break;
        }
      }
    }
    if (this.settings.auto_altar && this.level >= BAL.auto_altar_lv) {
      const cheapest = ALTAR_LINES
        .map(l => ({ id: l.id, cost: this.altarCost(l.id) }))
        .sort((a, b) => a.cost - b.cost)[0];
      if (cheapest && this.gold > cheapest.cost * 4) {
        this.altarUp(cheapest.id, true);
        this.autoSum.altar += 1;
      }
    }
    // 分钟级汇总:让玩家知道金币去哪了,而不刷购买流水
    if (this.time - this.autoSum.at >= 60 && (this.autoSum.enh || this.autoSum.skill || this.autoSum.altar)) {
      const parts: string[] = [];
      if (this.autoSum.enh) parts.push(`强化×${this.autoSum.enh}`);
      if (this.autoSum.skill) parts.push(`技能×${this.autoSum.skill}`);
      if (this.autoSum.altar) parts.push(`献祭×${this.autoSum.altar}`);
      this.log(`🤖 自动化(近 1 分钟):${parts.join(" · ")}`, "dim");
      this.autoSum = { enh: 0, skill: 0, altar: 0, at: this.time };
    } else if (this.autoSum.at === 0) {
      this.autoSum.at = this.time;
    }
  }

  /** 祭坛单线下一级费用:多项式(基费 + 线性 + 平方 + 深度项),无等级上限;
   *  lvOffset 供"连买 n 次总费用"逐级求和(不动真实等级) */
  altarCost(lineId: string, lvOffset = 0): number {
    const lv = (this.altarLv[lineId] ?? 0) + lvOffset;
    const t = tierOf(this.zone, this.stage);
    return Math.round(BAL.altar_cost0 + BAL.altar_cost_lv * lv
      + BAL.altar_cost_lv2 * lv * lv + BAL.altar_cost_t * t);
  }
  /** 连买 n 次的精确总费用(逐级取整求和;UI 按钮展示用,n 为档位值) */
  altarCostN(lineId: string, n: number): number {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.altarCost(lineId, i);
    return sum;
  }
  /** MAX 档预估:当前金币约能连买几级。闭式(未逐级取整)+ 二分,与逐级购买误差 ≤1,
   *  仅展示用;实际购买走 altarUpMulti 逐级取整扣费 */
  altarMaxBuysApprox(lineId: string): number {
    const lv = this.altarLv[lineId] ?? 0;
    const t = tierOf(this.zone, this.stage);
    const a = BAL.altar_cost0 + BAL.altar_cost_lv * lv + BAL.altar_cost_lv2 * lv * lv + BAL.altar_cost_t * t;
    const b = BAL.altar_cost_lv + 2 * BAL.altar_cost_lv2 * lv;
    const c = BAL.altar_cost_lv2;
    const sum = (n: number): number =>
      a * n + b * n * (n - 1) / 2 + c * n * (n - 1) * (2 * n - 1) / 6;
    let lo = 0, hi = 1;
    while (sum(hi) <= this.gold) hi *= 2;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (sum(mid) <= this.gold) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  altarUp(lineId: string, quiet = false): void {
    const line = ALTAR_LINES.find(l => l.id === lineId);
    if (!line) { if (!quiet) this.toast("无此祭坛"); return; }
    const cost = this.altarCost(lineId);
    if (this.gold < cost) { if (!quiet) this.toast(`金币不足(需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.altarLv[lineId] = (this.altarLv[lineId] ?? 0) + 1;
    this.recalcHero();
    if (!quiet) {
      this.log(`🕯 ${line.name} Lv.${this.altarLv[lineId]}(+${line.per}${line.op === "pct" ? "%" : " 点"}${line.stat})`,
        "bright_magenta");
      this.toast(`${line.name} Lv.${this.altarLv[lineId]}`);
    }
  }

  /** 献祭 N 次:连升至多 n 级(金币不够自动停);times=Infinity 为 MAX 档(买到买不起为止,
   *  次数 O(√gold),常规金币量级下毫秒级)。×1 委托 altarUp 保持单次提示口径 */
  altarUpMulti(lineId: string, times = 10): void {
    if (times === 1) return this.altarUp(lineId);
    const line = ALTAR_LINES.find(l => l.id === lineId);
    if (!line) { this.toast("无此祭坛"); return; }
    let spent = 0, n = 0;
    while (n < times) {
      // 真实等级随购买递增,这里按"当前下一级"计价(偏移 0);offset 只给未发生购买的求和用
      const cost = this.altarCost(lineId);
      if (this.gold < cost) break;
      this.gold -= cost;
      this.altarLv[lineId] = (this.altarLv[lineId] ?? 0) + 1;
      spent += cost;
      n += 1;
    }
    if (n > 0) {
      this.recalcHero();
      this.log(`🕯 ${line.name} Lv.${this.altarLv[lineId]}(连祭 ×${n},共 ◈${fmt(spent)})`,
        "bright_magenta");
      this.toast(`${line.name} Lv.${this.altarLv[lineId]}(×${n})`);
    } else {
      this.toast(`金币不足(需要 ${fmt(this.altarCost(lineId))})`);
    }
  }

  /** 药剂价格:初始价 × 2^已购次数,单次封顶(每种药剂独立计价) */
  potionCost(pid: string): number {
    const n = this.potionBought[pid] ?? 0;
    return Math.round(Math.min(BAL.potion_cost0 * 2 ** n, BAL.potion_cost_cap));
  }
  usePotion(pid: string): void {
    const def = POTIONS.find(p => p.id === pid);
    if (!def) { this.toast("无此药剂"); return; }
    const cost = this.potionCost(pid);
    if (this.gold < cost) { this.toast(`金币不足(需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.potionBought[pid] = (this.potionBought[pid] ?? 0) + 1;
    S.addBuff(this, def.buff, def.pct, def.dur);
    this.log(`${def.icon} 饮下${def.name}:30 分钟内${def.buff === "atk" ? "攻击" : def.buff === "xp" ? "经验" : "金币"} +${def.pct}%`,
      "bright_green");
    this.toast(`${def.name} 已生效(30 分钟)`);
  }

  /** 塔钥匙加购:每日限 BAL.tower_key_extra 把,第 n 把价格 = k×n×击杀金 */
  towerKeyCost(): number | null {
    if (this.towerKeysBought >= BAL.tower_key_extra) return null;   // 今日已购满
    return Math.round(BAL.tower_key_cost_k * (this.towerKeysBought + 1)
      * mobGold(tierOf(this.zone, this.stage)));
  }
  buyTowerKey(): void {
    this.rollDaily();
    const cost = this.towerKeyCost();
    if (cost === null) { this.toast("今日钥匙已购满,明日再来"); return; }
    if (this.gold < cost) { this.toast(`金币不足(需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.towerKeysBought += 1;
    this.tower.keys += 1;
    this.log(`🔑 金币加购塔钥匙(现有 ${this.tower.keys})`, "bright_cyan");
    this.toast(`钥匙 +1(今日加购 ${this.towerKeysBought}/${BAL.tower_key_extra})`);
  }

  /** 悬赏刷新:每日限 BAL.quest_reroll_max 次,第 n 次价格 = k×(n+1)×击杀金 */
  questRerollCost(): number | null {
    if (this.questRerollCount >= BAL.quest_reroll_max) return null;  // 今日已刷满
    return Math.round(BAL.quest_reroll_cost_k * (this.questRerollCount + 1)
      * mobGold(tierOf(this.zone, this.stage)));
  }
  rerollQuests(): void {
    this.rollDaily();
    const cost = this.questRerollCost();
    if (cost === null) { this.toast("今日悬赏已刷满,明日再来"); return; }
    if (this.gold < cost) { this.toast(`金币不足(需要 ${fmt(cost)})`); return; }
    this.gold -= cost;
    this.questRerollCount += 1;
    for (const q of this.quests) Object.assign(q, systems.rollQuest(this.zone, this.rng));
    this.log(`🔄 悬赏已刷新(${this.questRerollCount}/${BAL.quest_reroll_max})`, "bright_cyan");
    this.toast("悬赏已刷新");
  }

  // ================================================================ 悬赏
  /** 每日悬赏:本地日期跨日重置计数;达 BAL.quest_daily_limit 后冻结进度(在途任务明日恢复)。 */
  rollDaily(): void {
    const t = new Date();
    const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    // 断签检测(独立于悬赏日期变化:上次领取不是昨天且已隔天 → 7 日进度重置)
    if (this.signinLast && this.signinLast !== d) {
      const dayStart = (dt: Date): number =>
        new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      const last = new Date(this.signinLast + "T00:00:00");
      const gap = Math.round((dayStart(t) - dayStart(last)) / 86400000);   // 日历日差
      if (gap > 1) {
        this.signinPos = 0;
        this.log("📅 连续签到中断,7 日进度从头开始", "dim");
      }
    }
    if (d !== this.questDailyDate) {
      this.questDailyDate = d;
      this.questDailyCount = 0;
      this.questRerollCount = 0;
      this.towerKeysBought = 0;
    }
    // ISO 周(周一为一周之始)变化 → 周常清零
    const wk = isoWeekKey(t);
    if (wk !== this.weekKey) {
      if (this.weekKey) this.log("📅 新的一周,周常目标已刷新", "bright_cyan");
      this.weekKey = wk;
      this.weekly = {};
      this.weeklyClaimed = [];
    }
  }

  /** 今日签到是否可领 */
  canSignin(): boolean {
    return this.classId !== null && this.signinLast !== todayKey();
  }
  /** 领今日签到:发当日位奖励,位置 +1(循环);同日重复领拒绝 */
  claimSignin(): void {
    this.rollDaily();
    if (!this.canSignin()) { this.toast("今日已领,明天再来"); return; }
    const r = SIGNIN_REWARDS[this.signinPos % SIGNIN_REWARDS.length]!;
    if (r.gold) { this.gold += r.gold; this.stats.gold_earned += r.gold; }
    if (r.stones) this.stones += r.stones;
    if (r.keys) this.tower.keys += r.keys;
    if (r.potion) {
      const def = POTIONS.find(p => p.id === r.potion);
      if (def) S.addBuff(this, def.buff, def.pct, def.dur);
    }
    this.signinLast = todayKey();
    const dayNo = this.signinPos + 1;
    this.signinPos = (this.signinPos + 1) % SIGNIN_REWARDS.length;
    this.recalcHero();
    this.log(`📅 签到 第 ${dayNo}/7 天:${r.icon} ${r.label}`, "bright_green");
    this.toast(`签到 +${r.label}`);
  }

  /** 周常计数入口(各系统打点;rollDaily 保证跨周即时清零) */
  weeklyBump(metric: string, n: number): void {
    this.rollDaily();
    this.weekly[metric] = (this.weekly[metric] ?? 0) + n;
  }
  /** 本周已完成的目标数 */
  weeklyDoneCount(): number {
    let n = 0;
    for (const g of WEEKLY_GOALS) if ((this.weekly[g.metric] ?? 0) >= g.target) n++;
    return n;
  }
  /** 领周宝箱(chest3/chest6) */
  claimWeeklyChest(id: string): void {
    this.rollDaily();
    const chest = WEEKLY_CHEST.find(c => c.id === id);
    if (!chest) return;
    if (this.weeklyClaimed.includes(id)) { this.toast("本周已领过"); return; }
    if (this.weeklyDoneCount() < chest.need) { this.toast(`还差 ${chest.need - this.weeklyDoneCount()} 项目标`); return; }
    this.weeklyClaimed.push(id);
    this.stones += chest.stones;
    if (chest.title && !this.titles.includes(chest.title)) this.titles.push(chest.title);
    this.log(`🎁 周常宝箱(${chest.label}):✦${chest.stones} 重铸石` +
      (chest.title ? ` + 称号「${titleName(chest.title)}」` : ""), "bright_green");
    this.toast(`周宝箱 ✦${chest.stones}${chest.title ? ` + 称号` : ""}`);
  }

  /** 佩戴/卸下称号 */
  setTitle(id: string): void {
    if (id && !this.titles.includes(id)) return;
    this.title = this.titles.includes(id) ? id : "";
  }

  /** 兑换码:FNV-1a 哈希比对;重复兑换拒绝 */
  redeemCode(raw: string): void {
    const code = raw.trim().toUpperCase();
    if (!code) { this.toast("请输入兑换码"); return; }
    let h = 0x811c9dc5;
    for (let i = 0; i < code.length; i++) {
      h ^= code.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const def = REDEEM_CODES.find(c => c.hash === h);
    if (!def) { this.toast("兑换码无效"); return; }
    if (this.redeemed.includes(h)) { this.toast("该码已兑换过"); return; }
    this.redeemed.push(h);
    if (def.gold) { this.gold += def.gold; this.stats.gold_earned += def.gold; }
    if (def.stones) this.stones += def.stones;
    if (def.keys) this.tower.keys += def.keys;
    this.log(`🎁 兑换成功:${def.label}`, "bright_green");
    this.toast(`已兑换:${def.label}`);
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
          this.weeklyBump("quests", 1);
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
    this.checkAchTiers();   // 成就跨档即时反馈(6×阈值比较,开销可忽略)
    this.autoTick();        // 玩家自动化三开关(内部 1 秒一拍)
    const speed = Math.min(this.settings.speed ?? 1, this.maxSpeed());
    for (let i = 0; i < speed; i++) {
      this.time += dt;
      this.playtime += dt;
      battleTick(this, dt);
      if (!this.monster && this.respawnTimer <= 0) this.spawn();
    }
    this.maybeAutoPush();
    this.autosaveAcc += dt;  // 自动存档按真实时间计
    if (this.autosaveAcc > 30) {
      this.autosaveAcc = 0;
      this.save();
    }
  }

  // ================================================================ 存档
  toDict(): Record<string, any> {
    return {
      version: SAVE_VERSION, gear_rules_21: true,
      seed: this.seed,
      time: this.time, playtime: this.playtime,
      gold: this.gold, stones: this.stones,
      level: this.level, xp: this.xp,
      zone: this.zone, stage: this.stage,
      stage_kills: this.stageKills, deaths_row: this.deathsRow,
      death_tier: this.deathTier, auto_farm: this.autoFarm,
      mode: this.mode, farm_stage: this.farmStage,
      class_id: this.classId,
      rebirths: this.rebirths,
      loadout: this.loadout,
      skill_lv: this.skillLv,
      equip: Object.fromEntries(Object.entries(this.equip).map(([k, v]) => [k, v.toDict()])),
      bag: this.bag.map(i => i.toDict()),
      stats: this.stats,
      mon_kills: this.monKills,
      settings: this.settings,
      signin_pos: this.signinPos,
      signin_last: this.signinLast,
      week_key: this.weekKey,
      weekly: this.weekly,
      weekly_claimed: this.weeklyClaimed,
      titles: this.titles,
      title: this.title,
      lineage: this.lineage,
      run_start_playtime: this.runStartPlaytime,
      run_max_zone: this.runMaxZone,
      redeemed: this.redeemed,
      stat_mods: this.statMods,
      quests: this.quests,
      quest_daily_count: this.questDailyCount,
      quest_daily_date: this.questDailyDate,
      quest_reroll_count: this.questRerollCount,
      tower_keys_bought: this.towerKeysBought,
      altar_lv: this.altarLv,
      potion_bought: this.potionBought,
      bag_exp_lv: this.bagExpLv,
      relics: this.relics.map(r => r ? r.toDict() : null),
      // pendingSwap 不序列化;待确认的新遗物并入存档背包,避免关页丢失
      relic_bag: (() => {
        const list = [...this.relicBag];
        const p = this.pendingSwap;
        if (p?.kind === "relic" && p.newRelic && list.length < this.relicBagCap()) {
          list.push(p.newRelic);
        }
        return list.map(r => r.toDict());
      })(),
      relic_bag_lv: this.relicBagLv,
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
    g.deathTier = d.death_tier ?? -1;
    g.autoFarm = d.auto_farm ?? false;
    g.mode = d.mode ?? "push";
    g.farmStage = d.farm_stage ?? 1;
    g.equip = Object.fromEntries(Object.entries(d.equip ?? {})
      .map(([k, v]) => [k, Item.fromDict(v as any)]));
    g.bag = (d.bag ?? []).map((i: any) => Item.fromDict(i));
    g.classId = d.class_id ?? null;
    g.rebirths = d.rebirths ?? 0;
    g.loadout = d.loadout ?? { active: [], passive: [] };
    g.skillLv = d.skill_lv ?? {};
    g.skillCd = {};
    for (const s of ACTIVE_SKILLS) g.skillCd[s.id] = 0;
    g.buffs = {};
    Object.assign(g.stats, d.stats ?? {});
    g.monKills = d.mon_kills ?? {};
    g.signinPos = d.signin_pos ?? 0;
    g.signinLast = d.signin_last ?? "";
    g.weekKey = d.week_key ?? "";
    g.weekly = d.weekly ?? {};
    g.weeklyClaimed = d.weekly_claimed ?? [];
    g.titles = d.titles ?? [];
    g.title = d.title ?? "";
    g.lineage = d.lineage ?? [];
    g.runStartPlaytime = d.run_start_playtime ?? 0;
    g.runMaxZone = d.run_max_zone ?? Math.max(1, g.zone);   // 旧档无字段:以当前区兜底
    g.redeemed = d.redeemed ?? [];
    Object.assign(g.settings, d.settings ?? {});
    g.statMods = d.stat_mods ?? [];
    // 防御:损坏的遗物条目跳过(槽位置空),坏 tower 字段回默认 — 与 Python 侧同口径,
    // 结构性损坏不再让 fromDict 在深处抛 TypeError
    const relicOrNull = (r: any): Relic | null => {
      if (!r || typeof r !== "object" || !Array.isArray(r.effects)) return null;
      try { return Relic.fromDict(r); } catch { return null; }
    };
    g.relics = (Array.isArray(d.relics) ? d.relics : [null, null, null, null])
      .slice(0, 4).map(relicOrNull);
    while (g.relics.length < 4) g.relics.push(null);
    g.relicBag = (Array.isArray(d.relic_bag) ? d.relic_bag : [])
      .map(relicOrNull).filter((r): r is Relic => r !== null);
    g.relicBagLv = d.relic_bag_lv ?? 1;
    const tw = d.tower;
    g.tower = (tw && typeof tw === "object" && typeof tw.keys === "number"
      && typeof tw.max_floor === "number")
      ? { keys: tw.keys, max_floor: tw.max_floor, last_refresh: tw.last_refresh ?? null }
      : { keys: 3, max_floor: 0, last_refresh: null };
    g.quests = d.quests ?? g.quests;
    g.questDailyCount = d.quest_daily_count ?? 0;
    g.questDailyDate = d.quest_daily_date ?? "";
    g.questRerollCount = d.quest_reroll_count ?? 0;
    g.towerKeysBought = d.tower_keys_bought ?? 0;
    g.altarLv = d.altar_lv ?? {};
    g.potionBought = d.potion_bought ?? {};
    g.bagExpLv = d.bag_exp_lv ?? 0;
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
  if (v < 6) {
    // v5 → v6:遗物背包(收纳满槽掉落,容量可升级)
    d.relic_bag = [];
    d.relic_bag_lv = 1;
    d.version = 6;
    v = 6;
  }
  if (v < 7) {
    d.version = 7;
  }
  if (v < 8) {
    // v7 → v8:转生系统(rebirths 终身计数,旧档默认 0,无破坏性变更)
    d.rebirths = d.rebirths ?? 0;
    d.version = 8;
  }
  // 装备规则 2.1(主属性候选表+词条数缩减):按标志位一次性清除旧装备,不保留。
  // 不用版本号判断——HMR 热更的旧页面会以新版本号续存旧装备,标志位幂等兜底。
  if (!d.gear_rules_21) {
    d.equip = {};
    d.bag = [];
    d.gear_rules_21 = true;
  }
  return d;
}
