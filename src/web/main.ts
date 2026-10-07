// 深渊挂机 · 现代 Web UI 宿主(TS 同构核心,无 Pyodide 秒开;桌面+手机自适应)。
// 与 CLI / web/legacy / web/app 共用同一核心规则与 localStorage 存档键。
// 结构:Game.load() → setInterval 0.1s 步进 → buildState() 快照渲染
//      + g.events 事件流(日志/飘字/toast/动画)→ doCmd() 指令分发。
/// <reference lib="dom" />
/// <reference types="vite/client" />

import { Game, installSaveHooks, migrateSave } from "../core/game.ts";
import { applyOverrides, parseOverrideFile, resetOverrides } from "../core/overrides.ts";
import * as D from "../core/data.ts";
import * as systems from "../core/systems.ts";
import { effLv, skillVal, buffPct, atkNow } from "../core/skills.ts";
import { heroPower, powerWithEquip, powerWithRelic } from "../core/power.ts";
import type { PowerBreakdown } from "../core/power.ts";
import { plusBonus, Item, PCT_MAINS } from "../core/items.ts";
import type { Relic } from "../core/relics.ts";
import pkg from "../../package.json";
import confetti from "canvas-confetti";
import { CLOUD_READY } from "./cloud.config.ts";
import type { CloudState } from "./cloud.ts";

// —— 云模块懒加载 ——
// Supabase SDK 体积大(gzip 前 ~200KB+),只在真正用到时才拉取:
// 启动时本机存有会话令牌(登录过),或玩家点登录/云操作;游客首屏零成本。
// cloudState 是本地镜像,由 onCloudState 桥接更新,渲染层照常同步读取。
const cloudState: CloudState = { ready: CLOUD_READY, user: null, syncing: false,
                                 lastSyncMs: null, error: null };
let cloudMod: typeof import("./cloud.ts") | null = null;
async function ensureCloud(): Promise<typeof import("./cloud.ts") | null> {
  if (!CLOUD_READY) return null;
  if (!cloudMod) {
    try {
      cloudMod = await import("./cloud.ts");
      cloudMod.onCloudState(s => {
        Object.assign(cloudState, s);
        if (!document.hidden) renderNow();
      });
    } catch { return null; }
  }
  return cloudMod;
}

const SAVE_KEY = "abyss_save_v2";
/** 数值覆盖 localStorage 键(契约 §7.E:面板写、本页只读;与 admin-dom.ts OVR_KEY 同名) */
const OVR_KEY = "abyss_admin_overrides_v1";
const TICK = 0.1;
const MAX_STEPS = 10;
const AUTOSAVE_MS = 10_000;
const RESOLVE_MIN_SEC = 30;
const RENDER_MS = 200;

// ---------------------------------------------------------------- 工具
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}
function fmt(n: number): string {  // 中文计数:万/亿/兆/京(与核心 ansi.fmt 一致)
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0; n = Math.abs(n);
  for (const [div, suf] of [[1e16, "京"], [1e12, "兆"], [1e8, "亿"], [1e4, "万"]] as const) {
    if (n >= div) return (neg ? "-" : "") + (n / div).toFixed(2) + suf;
  }
  return (neg ? "-" : "") + (Number.isInteger(n) ? String(n) : n.toFixed(1));
}
function fmtTime(sec: number): string {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** buff 剩余时长:≥60 秒按分钟(1 位小数),不足 60 秒才用秒 */
function fmtBuffTime(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1).replace(/\.0$/, "")}分`;
  return `${Math.round(sec)}s`;
}
function pctTxt(v: number): string {
  v = Number(v) || 0;
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")) + "%";
}
function fmtv(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "");
}
/** 定点加成值显示:最多 2 位小数去尾零(词缀求和的浮点残差不上屏,如 1.8532439…→1.85) */
function numTxt(v: number, digits = 2): string {
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

const toastEl = $("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

// ---------------------------------------------------------------- UI 快照类型
interface ItemUI {
  name: string; rarity: string; rid: number; rname: string; rcolor: string;
  slot: string; slot_name: string; plus: number; tier: number;
  main: { name: string; val: number; pct: boolean };
  affixes: { name: string; val: number; pct: boolean }[];
  innate: { name: string; val: number } | null;
  score: number; sell: number; ecost: number; dgold: number; dstones: number;
  pb: number; pb_next: number;
}
interface SkillUI {
  id: string; name: string; icon: string; kind: string; unlock: number; cd: number;
  color: string; lv: number; eff: number; desc: string; cost: number;
  equipped: boolean; unlocked: boolean;
}
interface RelicUI {
  name: string; rarity: string; rid: number; rname: string; rcolor: string;
  tier: number; effects: { name: string; val: number; unit: string }[];
}
interface State {
  class_id: string | null;
  cls: { name: string; icon: string; desc: string; color: string };
  level: number; xp: number; xp_req: number;
  rebirths: number; can_rebirth: boolean; rebirth_min_level: number;
  gold: number; stones: number; playtime: number; time: number;
  zone: number; stage: number; stage_kills: number; kills_per_stage: number;
  mode: string; farm_stage: number;
  zone_name: string; zone_boss: string; zone_cycle: number;
  respawn: number; ema_kill: number;
  hero: Record<string, number>;
  power: PowerBreakdown | null;
  monster: { id: string; name: string; art: string[]; hp: number; max_hp: number; tier: number;
             boss: boolean; elite: boolean; atk: number; def: number; color: string;
             skill?: string } | null;
  buffs: { key: string; name: string; pct: number; remain: number }[];
  equip: Record<string, ItemUI>;
  bag: ItemUI[];
  bag_size: number;
  bag_cap: number; bag_expand_cost: number | null;
  quests: { desc: string; progress: number; target: number; gold: number; stones: number }[];
  quest_daily_count: number; quest_daily_limit: number;
  achievements: { id: string; name: string; val: number; tiers: number; total: number;
                  stat: string; per: number; bonus: number; next: number | null }[];
  loadout: { active: string[]; passive: string[] };
  loadout_slots: number; loadout_unlock: readonly number[];
  speed: number; max_speed: number; speed_unlock: readonly number[];
  skills: { active: SkillUI[]; passive: SkillUI[] };
  altar: { id: string; name: string; icon: string; stat: string; stat_name: string;
           op: string; per: number; lv: number; cost: number; bonus: number }[];
  potions: { id: string; name: string; icon: string; buff: string; pct: number;
             cost: number; remain: number }[];
  tower_key_cost: number | null; tower_keys_bought: number;
  quest_reroll_cost: number | null; quest_reroll_used: number;
  skill_cd: Record<string, number>;
  tower: { keys: number; max_floor: number };
  in_tower: boolean;
  tower_floor_sel: number;
  relics: (RelicUI | null)[];
  relic_bag: RelicUI[];
  relic_bag_cap: number;
  relic_bag_cost: number | null;   // 下一级扩容费用;null = 已满级
  stats: Record<string, number>;
  settings: Record<string, unknown>;
  reforge_stones: number; reforge_slots: readonly number[];
  pending_offline: { sec: number; kills: number; deaths: number; gold: number; xp: number;
                     levels: number; zones: number; items: ItemUI[] } | null;
  pending_swap: {
    kind: "item" | "relic";
    slot_name: string;
    old_item: ItemUI | null;
    new_item: ItemUI | null;
    old_relic: RelicUI | null;
    new_relic: RelicUI | null;
    power_delta: number | null;   // 换新后的战力变化(基础口径,无临时 buff)
  } | null;
}

// ---------------------------------------------------------------- 快照构建
function itemUI(it: Item): ItemUI {
  const rid = D.RARITY_IDX[it.rarity];
  const rar = D.RARITIES[rid];
  const mstat = it.mainStat();
  const st = it.stats();
  const affixes = it.affixes.map(a => {
    // 单技能词缀:词条名=绑定的技能名,整级显示(不进通用属性聚合)
    if (a.id === "skill_lv" && it.skillSid) {
      const nm = it.boundSkillName() ?? "单技能";
      return { name: nm, val: Math.trunc(a.val), pct: false };
    }
    const def = D.AFFIX_DEF[a.id];
    return { name: def.name, val: Math.round((st[a.id] ?? 0) * 10) / 10, pct: def.pct };
  });
  let innate: { name: string; val: number } | null = null;
  const inn = D.SLOT_INNATE[it.slot];
  if (inn) {
    innate = { name: D.STAT_NAMES[inn[0]],
               val: Math.round(inn[1] * rid * 10) / 10 };   // 固有不吃强化
  }
  const [dgold, dstones] = it.dismantle();
  const pb = plusBonus(it.plus);
  return {
    name: it.name, rarity: it.rarity, rid, rname: rar.name, rcolor: rar.color,
    slot: it.slot, slot_name: D.SLOT_NAMES[it.slot] ?? it.slot,
    plus: it.plus, tier: it.tier,
    main: { name: D.STAT_NAMES[mstat] ?? mstat,
            val: Math.round((st[mstat] ?? 0) * 10) / 10,
            pct: (PCT_MAINS as readonly string[]).includes(mstat) },
    affixes, innate,
    score: Math.trunc(it.score()), sell: it.sellPrice(),
    ecost: it.enhanceCost(), dgold, dstones,
    pb: Math.round(pb * 1000) / 10,
    pb_next: Math.round((plusBonus(it.plus + 1) - pb) * 1000) / 10,
  };
}

function skillUI(g: Game, def: D.ActiveSkill | D.PassiveSkill): SkillUI {
  const lv = g.skillLv[def.id] ?? 1;
  const el = effLv(g, def.id);
  const val = skillVal(def, el);
  const active = def as D.ActiveSkill;
  return {
    id: def.id, name: def.name,
    icon: active.icon ?? "◆",
    kind: active.kind ?? (def as D.PassiveSkill).kind ?? "",
    unlock: def.unlock, cd: active.cd ?? 0, color: active.color ?? "",
    lv, eff: el,
    desc: def.desc.replace("{v}", fmtv(val)),
    cost: g.skillCost(def.id),
    equipped: g.loadout.active.includes(def.id) || g.loadout.passive.includes(def.id),
    unlocked: g.level >= def.unlock,
  };
}

function relicUI(r: Relic): RelicUI {
  const rid = D.RARITY_IDX[r.rarity];
  const rar = D.RARITIES[rid];
  return {
    name: r.name, rarity: r.rarity, rid, rname: rar.name, rcolor: rar.color,
    tier: r.tier,
    effects: r.effects.map(e => {
      const def = D.RELIC_EFF_DEF[e.id];
      return { name: def.name, val: Math.round(e.val * 10) / 10, unit: def.unit };
    }),
  };
}

/** 换装对比战力差的单条缓存:src=待确认的新装备/新遗物引用(引用变=新对比) */
let swapDeltaCache: { src: object; delta: number } | null = null;

function buildState(g: Game): State {
  const h = g.hero;
  const cls = g.classId && D.CLASSES[g.classId]
    ? D.CLASSES[g.classId] : { name: "", icon: "", desc: "", color: "" };
  const theme = D.THEMES[(g.zone - 1) % D.THEMES.length];
  const cycle = Math.floor((g.zone - 1) / D.THEMES.length) + 1;

  let dps = g.theoreticalDps();
  if (!Number.isFinite(dps)) dps = 0;
  // 面板属性跟随生效中的 buff:攻击(atk/all)、攻速(haste)、DPS(含伤害加成)
  const bHaste = buffPct(g, "haste");
  dps = dps * (atkNow(g) / Math.max(1e-9, h.atk)) * (1 + bHaste / 100)
    * (1 + buffPct(g, "dmg_pct") / 100);
  const hero: Record<string, number> = { ...(h as unknown as Record<string, number>), dps,
    atk: atkNow(g), haste: h.haste + bHaste };

  const buffs = Object.entries(g.buffs)
    .filter(([, b]) => b.until > g.time)
    .map(([k, b]) => ({ key: k, name: D.STAT_NAMES[k] ?? k, pct: b.pct,
                        remain: Math.round(Math.max(0, b.until - g.time) * 10) / 10 }));

  const monster = g.monster ? {
    id: g.monster.id, name: g.monster.name, art: g.monster.art, hp: g.monster.hp,
    max_hp: g.monster.maxHp, tier: g.monster.tier, boss: g.monster.boss,
    elite: g.monster.elite, atk: g.monster.atk, def: g.monster.def_,
    color: g.monster.color,
    skill: g.monster.skill ? `${g.monster.skill.icon} ${g.monster.skill.name}` : undefined,
  } : null;

  const skills = g.classId ? {
    active: D.ACTIVE_SKILLS.filter(s => s.cls === g.classId).map(s => skillUI(g, s)),
    passive: D.PASSIVE_SKILLS.filter(s => s.cls === g.classId).map(s => skillUI(g, s)),
  } : { active: [], passive: [] };

  const quests = g.quests.map(q => ({
    desc: systems.questDesc(q), progress: Math.min(q.progress, q.target),
    target: q.target, gold: q.gold, stones: q.stones,
  }));
  g.rollDaily();   // 快照前跨日重置(UI 计数即时)
  const questDaily = { count: g.questDailyCount, limit: D.BAL.quest_daily_limit };

  const achievements = D.ACHIEVEMENTS.map(a => {
    const val = g.stats[a.metric] ?? 0;
    const tiers = a.thresholds.filter(t => val >= t).length;
    return { id: a.id, name: a.name, val: Math.trunc(val), tiers, total: a.thresholds.length,
             stat: D.STAT_NAMES[a.stat] ?? a.stat, per: a.per, bonus: a.per * tiers,
             next: tiers < a.thresholds.length ? a.thresholds[tiers] : null };
  });

  const po = g.pendingOffline ? {
    sec: g.pendingOffline.sec, kills: g.pendingOffline.kills,
    deaths: g.pendingOffline.deaths, gold: g.pendingOffline.gold, xp: g.pendingOffline.xp,
    levels: g.pendingOffline.levels, zones: g.pendingOffline.zones,
    items: g.pendingOffline.items.map((i: Item) => itemUI(i)),
  } : null;

  // 换装对比的战力差:预览要临时换装重算,按新件引用缓存(每帧 buildState 不重复算)
  let swapDelta: number | null = null;
  if (g.pendingSwap?.kind === "item" && g.pendingSwap.item && g.pendingSwap.slot) {
    if (swapDeltaCache?.src === g.pendingSwap.item) {
      swapDelta = swapDeltaCache.delta;
    } else {
      const after = powerWithEquip(g, g.pendingSwap.slot, g.pendingSwap.item);
      swapDelta = after.total - heroPower(g, false).total;
      swapDeltaCache = { src: g.pendingSwap.item, delta: swapDelta };
    }
  } else if (g.pendingSwap?.kind === "relic" && g.pendingSwap.newRelic
             && g.pendingSwap.relicSlot !== undefined) {
    if (swapDeltaCache?.src === g.pendingSwap.newRelic) {
      swapDelta = swapDeltaCache.delta;
    } else {
      const after = powerWithRelic(g, g.pendingSwap.relicSlot, g.pendingSwap.newRelic);
      swapDelta = after.total - heroPower(g, false).total;
      swapDeltaCache = { src: g.pendingSwap.newRelic, delta: swapDelta };
    }
  }

  const psw = g.pendingSwap ? {
    kind: g.pendingSwap.kind,
    slot_name: g.pendingSwap.kind === "item"
      ? (D.SLOT_NAMES[g.pendingSwap.slot ?? ""] ?? g.pendingSwap.slot ?? "")
      : `遗物${(g.pendingSwap.relicSlot ?? 0) + 1}`,
    old_item: g.pendingSwap.kind === "item" && g.pendingSwap.slot && g.equip[g.pendingSwap.slot]
      ? itemUI(g.equip[g.pendingSwap.slot]!) : null,
    new_item: g.pendingSwap.item ? itemUI(g.pendingSwap.item) : null,
    old_relic: g.pendingSwap.kind === "relic"
      ? (g.relics[g.pendingSwap.relicSlot ?? 0] ? relicUI(g.relics[g.pendingSwap.relicSlot ?? 0]!) : null)
      : null,
    new_relic: g.pendingSwap.newRelic ? relicUI(g.pendingSwap.newRelic) : null,
    power_delta: swapDelta,
  } : null;

  return {
    class_id: g.classId, cls,
    level: g.level, xp: g.xp, xp_req: g.xpReq(),
    rebirths: g.rebirths, can_rebirth: g.canRebirth(),
    rebirth_min_level: D.BAL.rebirth_min_level,
    gold: g.gold, stones: g.stones, playtime: g.playtime, time: g.time,
    zone: g.zone, stage: g.stage, stage_kills: g.stageKills,
    kills_per_stage: D.BAL.kills_per_stage,
    mode: g.mode, farm_stage: g.farmStage,
    zone_name: theme.name, zone_boss: theme.boss,
    zone_cycle: g.zone > D.THEMES.length ? cycle : 0,
    respawn: g.respawnTimer, ema_kill: g.emaKill,
    hero, monster, buffs,
    power: g.classId ? heroPower(g) : null,
    equip: Object.fromEntries(Object.entries(g.equip).map(([k, v]) => [k, itemUI(v)])),
    bag: g.bag.map(itemUI),
    bag_size: D.BAL.bag_size,
    bag_cap: g.bagCap(), bag_expand_cost: g.bagExpandCost(),
    quests, achievements,
    quest_daily_count: questDaily.count, quest_daily_limit: questDaily.limit,
    loadout: { active: [...g.loadout.active], passive: [...g.loadout.passive] },
    loadout_slots: g.loadoutSlots(),
    loadout_unlock: D.BAL.loadout_unlock,
    speed: g.settings.speed ?? 1, max_speed: g.maxSpeed(),
    speed_unlock: D.BAL.speed_unlock,
    skills, skill_cd: g.skillCd,
    tower: { keys: g.tower.keys, max_floor: g.tower.max_floor },
    altar: D.ALTAR_LINES.map(l => {
      const lv = g.altarLv[l.id] ?? 0;
      return { id: l.id, name: l.name, icon: l.icon, stat: l.stat,
               stat_name: D.STAT_NAMES[l.stat] ?? l.stat, op: l.op, per: l.per,
               lv, cost: g.altarCost(l.id), bonus: l.per * lv };
    }),
    potions: D.POTIONS.map(p => ({
      id: p.id, name: p.name, icon: p.icon, buff: p.buff, pct: p.pct,
      cost: g.potionCost(p.id),
      remain: Math.round(Math.max(0, (g.buffs[p.buff]?.until ?? 0) - g.time)),
    })),
    tower_key_cost: g.towerKeyCost(), tower_keys_bought: g.towerKeysBought,
    quest_reroll_cost: g.questRerollCost(), quest_reroll_used: g.questRerollCount,
    in_tower: g.inTower,
    tower_floor_sel: g.towerFloorSel,
    relics: g.relics.map(r => r ? relicUI(r) : null),
    relic_bag: g.relicBag.map(relicUI),
    relic_bag_cap: g.relicBagCap(),
    relic_bag_cost: g.relicBagCost(),
    stats: { ...g.stats }, settings: { ...g.settings },
    reforge_stones: D.BAL.reforge_stones, reforge_slots: D.BAL.reforge_slots,
    pending_offline: po,
    pending_swap: psw,
  };
}

// ---------------------------------------------------------------- 指令分发
let g: Game;

function doCmd(name: string, a: string | null = null, b: string | null = null): void {
  switch (name) {
    case "choose_class":
      if (rebirthPick) {   // 转生择业:选卡 = 以该职业转生
        rebirthPick = false;
        if (a) g.rebirth(a);
        break;
      }
      // 新档选职业后进入 3 步新手引导
      if (a) g.chooseClass(a);
      introStep = 1;
      break;
    case "mode": g.setMode(g.mode === "push" ? "farm" : "push"); break;
    case "speed": g.cycleSpeed(); break;
    case "farm_stage": g.setFarmStage(a === "1" ? 1 : -1); break;
    case "enhance": if (a) g.enhance(a); break;
    case "reforge": if (a) g.reforge(a); break;
    case "unequip": if (a) g.unequip(a); break;
    case "equip": { const i = Number(a); if (i >= 0 && i < g.bag.length) g.equipItem(g.bag[i]); break; }
    case "sell": g.sellItem(Number(a)); break;
    case "dismantle": g.dismantleItem(Number(a)); break;
    case "sell_junk": g.sellJunk(junkSellMax); break;
    case "junk_pick": {
      const i = Number(a);
      if (i >= 0 && i < D.RARITIES.length) junkSellMax = i;
      break;
    }
    case "equip_skill": if (a) g.equipSkill(a, (b ?? "active") as "active" | "passive"); break;
    case "unequip_skill": if (a) g.unequipSkill(a); break;
    case "skill_up": if (a) g.skillUp(a); break;
    case "tower_enter": {
      g.towerEnter();
      if (g.inTower) switchTab("battle");   // 进塔后切回战斗页看爬塔
      break;
    }
    case "tower_exit": g.towerExit(false); break;   // 撤退:视作战败,仅耗已用的钥匙
    case "altar_up": if (a) g.altarUp(a); break;
    case "altar_up_multi": if (a) g.altarUpMulti(a); break;
    case "potion": if (a) g.usePotion(a); break;
    case "tower_key": g.buyTowerKey(); break;
    case "quest_reroll": g.rerollQuests(); break;
    case "bag_expand": g.buyBagSlots(); break;
    case "enhance_multi": if (a) g.enhanceMulti(a); break;
    case "unequip_relic": g.unequipRelic(Number(a)); break;
    case "relic_equip": g.equipRelicFromBag(Number(a)); break;
    case "relic_dismantle": g.relicDismantle(Number(a)); break;
    case "gear_cmp_item": {
      const i = Number(a);
      if (i >= 0 && i < g.bag.length) gearView = { mode: "cmp-item", item: g.bag[i] };
      break;
    }
    case "gear_cmp_relic": {
      const i = Number(a);
      if (i >= 0 && i < g.relicBag.length) gearView = { mode: "cmp-relic", relic: g.relicBag[i] };
      break;
    }
    case "gear_take_item": {
      if (gearView?.mode === "cmp-item" && gearView.item && g.bag.includes(gearView.item)) {
        g.equipItem(gearView.item);
      }
      gearView = null;
      break;
    }
    case "gear_take_relic": {
      if (gearView?.mode === "cmp-relic" && gearView.relic) {
        const i = g.relicBag.indexOf(gearView.relic);
        if (i >= 0) g.equipRelicFromBag(i);
      }
      gearView = null;
      break;
    }
    case "gear_close": gearView = null; break;
    case "relic_bag_up": g.upgradeRelicBag(); break;
    case "auto_equip":
      g.settings.auto_equip = !g.settings.auto_equip;
      g.toast(g.settings.auto_equip ? "自动换装:开" : "自动换装:关");
      break;
    case "cycle_sell": {
      const idx = g.settings.auto_sell_idx ?? -1;
      g.settings.auto_sell_idx = (idx + 2) % 6 - 1;
      g.toast("掉落自动出售:" + autoSellStateText(g.settings.auto_sell_idx));
      break;
    }
    case "auto_sell":
      g.settings.auto_sell_idx = Math.max(-1, Math.min(4, Number(a)));
      g.toast("掉落自动出售:" + autoSellStateText(g.settings.auto_sell_idx));
      break;
    case "dismiss_offline": g.pendingOffline = null; break;
    case "swap_take": g.resolveSwap(true); break;
    case "swap_keep": g.resolveSwap(false); break;
    // —— 转生流程:角色页按钮 → 确认弹窗 → 择业(复用选职业卡,可保持原职业)——
    case "rebirth":
      rebirthAsk = true;
      break;
    case "rebirth_cancel":
      rebirthAsk = false;
      break;
    case "rebirth_go":
      rebirthAsk = false;
      rebirthPick = true;   // 复用 #class-select 择业(choose_class 分支拦截)
      break;
    case "rebirth_keep":
      rebirthPick = false;
      g.rebirth();
      break;
    case "intro_next":
      introStep = introStep === null ? null : introStep + 1;
      if (introStep !== null && introStep > INTRO_STEPS.length) introStep = null;
      break;
    case "cloud_login": showLoginModal(); break;
    case "cloud_logout":
      void ensureCloud().then(m => m && m.signOutCloud());
      toast("已退出云账号(本地存档保留)");
      break;
    case "cloud_push":
      void ensureCloud().then(async m => m && m.pushSave(g.toDict()))
        .then(err => toast(err ? "☁ 同步失败:" + err : "☁ 已上传云端"));
      break;
    case "reset":
      localStorage.removeItem(SAVE_KEY);
      g = new Game();
      break;
  }
}

// ---------------------------------------------------------------- 音效
// 战斗音效(出处与许可见 public/sfx/README.txt;前 8 个 CC0 素材、后 8 个程序合成):
// 普攻命中 + 技能分音:SFX_SKILL 表按技能配专属音(火/冰/雷/怒吼/大招/吸血/印记/位移),
// 未配置的回落到 类型/职业 默认分音。WebAudio 解码一次缓存播放;音调微变防重复感;
// 开关存 localStorage(不进核心存档)。
const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
const SFX_KEY = "abyss_sfx";
const BGM_KEY = "abyss_bgm";          // BGM 开关(独立于音效)
const VOL_KEY = "abyss_vol";          // 总音量 0-100(SFX+BGM 共用母线)
const SFX_FILES = ["attack-hit", "skill-heavy", "skill-magic", "skill-arrow",
                   "skill-burst", "skill-buff", "skill-shield", "skill-execute",
                   "skill-fire", "skill-ice", "skill-zap", "skill-roar",
                   "skill-ult", "skill-drain", "skill-mark", "skill-dash"] as const;
type SfxKey = typeof SFX_FILES[number];
const SFX_STYLE: Record<SfxKey, { gain: number; rateLo: number; rateHi: number; throttleMs: number }> = {
  "attack-hit":    { gain: 0.5,  rateLo: 0.92, rateHi: 1.08, throttleMs: 70 },
  "skill-heavy":   { gain: 0.55, rateLo: 0.97, rateHi: 1.03, throttleMs: 90 },
  "skill-magic":   { gain: 0.5,  rateLo: 0.94, rateHi: 1.06, throttleMs: 90 },
  "skill-arrow":   { gain: 0.5,  rateLo: 0.94, rateHi: 1.06, throttleMs: 90 },
  "skill-burst":   { gain: 0.55, rateLo: 0.96, rateHi: 1.04, throttleMs: 90 },
  "skill-buff":    { gain: 0.55, rateLo: 0.98, rateHi: 1.02, throttleMs: 120 },
  "skill-shield":  { gain: 0.55, rateLo: 0.98, rateHi: 1.02, throttleMs: 120 },
  "skill-execute": { gain: 0.6,  rateLo: 1.0,  rateHi: 1.0,  throttleMs: 150 },
  "skill-fire":    { gain: 0.82, rateLo: 0.93, rateHi: 1.05, throttleMs: 100 },
  "skill-ice":     { gain: 0.78, rateLo: 0.97, rateHi: 1.08, throttleMs: 100 },
  "skill-zap":     { gain: 0.8,  rateLo: 0.95, rateHi: 1.1,  throttleMs: 90 },
  "skill-roar":    { gain: 0.88, rateLo: 0.95, rateHi: 1.0,  throttleMs: 140 },
  "skill-ult":     { gain: 0.92, rateLo: 0.98, rateHi: 1.02, throttleMs: 160 },
  "skill-drain":   { gain: 0.78, rateLo: 0.9,  rateHi: 1.0,  throttleMs: 120 },
  "skill-mark":    { gain: 0.72, rateLo: 0.98, rateHi: 1.05, throttleMs: 120 },
  "skill-dash":    { gain: 0.72, rateLo: 0.95, rateHi: 1.1,  throttleMs: 120 },
};
let sfxOn = localStorage.getItem(SFX_KEY) !== "0";
let bgmOn = localStorage.getItem(BGM_KEY) !== "0";
let masterVol = Math.min(100, Math.max(0, Number(localStorage.getItem(VOL_KEY) ?? 70))) / 100;
let sfxCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;   // 母线:总音量(SFX 与 BGM 都经它)
let bgmGain: GainNode | null = null;
let bgmBuf: AudioBuffer | null = null;
let bgmSrc: AudioBufferSourceNode | null = null;
const sfxBufs = new Map<SfxKey, AudioBuffer>();
const sfxLastMs = new Map<SfxKey, number>();
const sfxPlays = new Map<SfxKey, number>();
const SKILL_DEF = new Map(D.ACTIVE_SKILLS.map(s => [s.id, s]));

/** 页面加载即建 context 并预解码全部音效(suspended 态可解码),首次交互只需 resume。
 *  同时建总音量母线(masterGain)并预取 BGM 循环;音效或 BGM 任一开启即建。 */
function initSfx(): void {
  if (sfxCtx || (!sfxOn && !bgmOn)) return;
  const AC = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  sfxCtx = new AC();
  masterGain = sfxCtx.createGain();
  masterGain.gain.value = volCurve(masterVol);
  masterGain.connect(sfxCtx.destination);
  bgmGain = sfxCtx.createGain();
  bgmGain.gain.value = 0.5;   // BGM 混音低于音效
  bgmGain.connect(masterGain);
  for (const key of SFX_FILES) {
    fetch(`${BASE_URL}sfx/${key}.wav`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`sfx ${r.status}`))))
      .then(b => sfxCtx!.decodeAudioData(b))
      .then(buf => sfxBufs.set(key, buf))
      .catch(() => { /* 单个音效缺失静默降级,游戏照常 */ });
  }
  fetch(`${BASE_URL}bgm/loop.wav`)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`bgm ${r.status}`))))
    .then(b => sfxCtx!.decodeAudioData(b))
    .then(buf => { bgmBuf = buf; startBgm(); })
    .catch(() => { /* BGM 缺失静默降级 */ });
}
/** 音量感知曲线:线性滑条 → 近似等响度增益 */
function volCurve(v: number): number {
  return Math.pow(Math.max(0, Math.min(1, v)), 1.6);
}
function ensureSfx(): void {
  if ((sfxOn || bgmOn) && sfxCtx?.state === "suspended") {
    void sfxCtx.resume().then(() => startBgm());
  }
  startBgm();
}
/** BGM:无缝循环(scripts/gen_bgm.py 合成的整循环 WAV);由首次交互解锁后启动 */
function startBgm(): void {
  if (!bgmOn || !bgmBuf || !sfxCtx || sfxCtx.state !== "running" || bgmSrc) return;
  bgmSrc = sfxCtx.createBufferSource();
  bgmSrc.buffer = bgmBuf;
  bgmSrc.loop = true;
  bgmSrc.connect(bgmGain!);
  bgmSrc.start();
}
function stopBgm(): void {
  if (!bgmSrc) return;
  try { bgmSrc.stop(); } catch { /* 已停止 */ }
  bgmSrc.disconnect();
  bgmSrc = null;
}
function toggleBgm(): void {
  bgmOn = !bgmOn;
  localStorage.setItem(BGM_KEY, bgmOn ? "1" : "0");
  if (bgmOn) { initSfx(); ensureSfx(); } else stopBgm();
  toast(bgmOn ? "音乐:开" : "音乐:关");
  renderNow();
}
/** 总音量(0-100):SFX 与 BGM 共用母线增益 */
function setMasterVol(pct: number): void {
  masterVol = Math.min(100, Math.max(0, pct)) / 100;
  localStorage.setItem(VOL_KEY, String(Math.round(masterVol * 100)));
  if (masterGain) masterGain.gain.value = volCurve(masterVol);
}
function playSfx(key: SfxKey, critBoost = false): void {
  if (!sfxOn) return;
  const buf = sfxBufs.get(key);
  const ctx = sfxCtx;
  if (!buf || !ctx || ctx.state !== "running") return;
  const st = SFX_STYLE[key];
  const now = performance.now();
  if (now - (sfxLastMs.get(key) ?? 0) < st.throttleMs) return;
  sfxLastMs.set(key, now);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const boost = critBoost ? 1.12 : 1;
  src.playbackRate.value = (st.rateLo + Math.random() * (st.rateHi - st.rateLo)) * boost;
  const gain = ctx.createGain();
  gain.gain.value = st.gain * (critBoost ? 1.25 : 1);
  src.connect(gain).connect(masterGain ?? ctx.destination);
  src.start();
  sfxPlays.set(key, (sfxPlays.get(key) ?? 0) + 1);
}
/** 普攻命中(hero_attack);暴击更亮更响 */
function playAttackHit(crit = false): void {
  if (crit) { playSfx("attack-hit", true); return; }
  playSfx("attack-hit");
}
/** 技能施放(cast:<id>):按技能映射表专属音,未配置的回落到 类型/职业 默认分音 */
const SFX_SKILL: Partial<Record<string, SfxKey>> = {
  // 战士
  w_blood: "skill-drain",   // 嗜血打击:吸血吞咽感
  w_fatal: "skill-ult",     // 致命一击(必暴)
  w_roar: "skill-roar",     // 毁灭怒吼(全属性大招)
  // 法师
  m_fire: "skill-fire",     // 火球术
  m_storm: "skill-fire",    // 烈焰风暴
  m_ice: "skill-ice",       // 寒冰箭
  m_nova: "skill-ice",      // 冰霜新星(冻结)
  m_chain: "skill-zap",     // 闪电链
  m_meteor: "skill-ult",    // 陨石术
  m_cata: "skill-ult",      // 元素灾变(必暴)
  // 射手
  r_mark: "skill-mark",     // 猎杀印记(标记提示音)
  r_dash: "skill-dash",     // 疾行(位移嗖声)
  r_sky: "skill-ult",       // 穿云箭
  r_god: "skill-ult",       // 猎神之怒(全属性大招)
};
/** 多段技(skill_hit 连发)的命中节拍窗口:窗口内每个 skill_hit 播小型命中闪(带技能主色) */
let multiHitUntil = 0;
let multiHitColor = "#a5ffbe";
function playSkillCast(skillId: string): void {
  const def = SKILL_DEF.get(skillId);
  if (!def) return;
  if (def.kind === "multi") {
    multiHitUntil = performance.now() + 1400;
    multiHitColor = (FX_COLORS[def.color] ?? FX_COLORS.white)[0];
  }
  const mapped = SFX_SKILL[skillId];
  if (mapped) { playSfx(mapped); return; }
  let key: SfxKey;
  if (def.kind === "execute") key = "skill-execute";
  else if (def.kind === "shield") key = "skill-shield";
  else if (def.kind === "buff") key = "skill-buff";
  else if (def.kind === "multi") key = "skill-burst";
  else if (def.cls === "warrior") key = "skill-heavy";
  else if (def.cls === "ranger") key = "skill-arrow";
  else key = "skill-magic";
  playSfx(key);
}
function toggleSfx(): void {
  sfxOn = !sfxOn;
  localStorage.setItem(SFX_KEY, sfxOn ? "1" : "0");
  if (sfxOn && !sfxCtx) initSfx();   // 趁点击手势建 context 并解锁
  ensureSfx();
  toast(sfxOn ? "音效:开" : "音效:关");
  renderNow();
}
function sfxDebug(): string {
  const ready = SFX_FILES.filter(k => sfxBufs.has(k)).length;
  const plays = [...sfxPlays.entries()].map(([k, n]) => `${k.split("-").pop()}:${n}`).join(" ") || "0";
  return `on=${sfxOn} ready=${ready}/${SFX_FILES.length} ctx=${sfxCtx?.state ?? "none"} ` +
    `bgm=${bgmOn ? (bgmSrc ? "playing" : bgmBuf ? "ready" : "missing") : "off"} ` +
    `vol=${Math.round(masterVol * 100)} [${plays}]`;
}

initSfx();
// 浏览器自动播放策略:首次交互解锁(选职业的点击必然先于战斗事件)。
for (const ev of ["pointerdown", "keydown"] as const)
  document.addEventListener(ev, ensureSfx, { once: true });

// ---------------------------------------------------------------- 事件流
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LOG_CAP = 100;   // 日志保留条数(近 100 条可回看)

function drainEvents(): void {
  if (!g.events.length) return;
  const evs = g.events.splice(0, g.events.length);
  const logs: string[] = [];
  for (let i = 0; i < evs.length; i++) {
    const [kind, rawText, color] = evs[i];
    const text = rawText.replace(ANSI_RE, "");
    if (kind === "log") {
      logs.push(`<div><span class="c-bright_black">${fmtTime(g.time)}</span> ` +
        spanColor(text, color) + "</div>");
    } else if (kind === "floater") {
      spawnFloater(text, color);
    } else if (kind === "toast") {
      toast(text);
    } else if (kind === "anim") {
      if (text === "mob_flash") flashMon();
      else if (text === "hero_attack") {
        // 技能伤害命中已改发 skill_hit(核心侧),不再与普攻音/特效重叠
        const crit = nextEvtIsCrit(evs, i);
        heroLunge(crit ? "crit" : "lunge");
        playAttackFx(undefined, crit);
        playAttackHit(crit);
      } else if (text.startsWith("cast:")) {
        const def = SKILL_DEF.get(text.slice(5));
        heroLunge("skill", def ? heroColorOf(def.color) : undefined);
        playSkillCast(text.slice(5));
        playSkillFx(text.slice(5));
      } else if (text === "mob_attack") {
        heroHurt();
      } else if (text === "skill_hit") {
        // 多段技每一下的命中节拍(单段技的施放特效已覆盖,不叠加大特效)
        if (performance.now() < multiHitUntil) {
          const p = monCenterPx();
          if (p) fxSpawn("fx-tick",
            p.x + Math.random() * 36 - 18, p.y + Math.random() * 36 - 18,
            { "--fx-c": multiHitColor });
        }
      } else if (text.startsWith("loot:")) {
        playLootBeam(text.slice(5));
      }
    }
  }
  if (logs.length) {
    const body = $("log-body");
    // 贴底跟随:用户没上翻(距底 <24px)时自动滚到最新,上翻阅读则不打扰
    const follow = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    body.insertAdjacentHTML("beforeend", logs.join(""));
    while (body.children.length > LOG_CAP) body.removeChild(body.firstChild!);
    if (follow) body.scrollTop = body.scrollHeight;
  }
}
function spanColor(text: string, color: string): string {
  return `<span class="c-${esc(color || "white")}">${esc(text)}</span>`;
}
function spawnFloater(text: string, color: string): void {
  const layer = $("floaters");
  if (layer.children.length > 10) layer.removeChild(layer.firstChild!);
  const el = document.createElement("div");
  el.className = "floater" + (color === "bright_yellow" ? " crit" :
                  color === "bright_green" ? " heal" : "");
  if (color && color !== "bright_yellow" && color !== "bright_green")
    el.classList.add("c-" + color);
  el.textContent = text;
  el.style.left = (20 + Math.random() * 50) + "%";
  el.style.top = (26 + Math.random() * 30) + "%";
  el.addEventListener("animationend", () => el.remove());
  layer.appendChild(el);
}
function flashMon(): void {
  const el = document.querySelector(".mon-art");
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 70);
}

// ---------------------------------------------------------------- 英雄模型
/** 英雄立绘开关(2026-10-05 决定暂下):false=隐藏模型,全部内容保留可随时恢复
 *  (资产/样式/动画与恢复步骤见 docs/models.md);攻击投射物从舞台内英雄侧
 *  锚点(约 13%,即立绘原位)发出,不再从屏幕外飞入。true=恢复立绘与全部动画。 */
const HERO_MODEL = false;
let heroClsCache = "";
function heroColorOf(color: string): string {
  return (FX_COLORS[color] ?? FX_COLORS.white)[0];
}
/** 同步英雄模型(职业徽记/立绘 hero/<class>.png/阵亡态);仅职业变化时才动 DOM */
function heroModelSync(st: State): void {
  if (!HERO_MODEL) return;
  const el = $("hero-art");
  if (!el) return;
  if (st.class_id && st.class_id !== heroClsCache) {
    heroClsCache = st.class_id;
    const img = el.querySelector("img") as HTMLImageElement;
    img.onerror = () => el.classList.remove("hasimg");
    img.onload = () => el.classList.add("hasimg");
    img.src = `${BASE_URL}hero/${st.class_id}.png`;
    (el.querySelector(".glyph") as HTMLElement).textContent = st.cls.icon;
    el.style.setProperty("--hero-c", heroColorOf(st.cls.color));
  }
  el.classList.toggle("dead", (st.respawn ?? 0) > 0);
}
/** 前冲打击:冲到怪物跟前命中再收回;lunge=普攻 crit=暴击 skill=技能(带技能主色)。
 *  模型关闭时跳过立绘动画,但保留命中一拍(bump-mon 怪物顶退)。 */
function heroLunge(kind: "lunge" | "crit" | "skill", color?: string): void {
  const stage = $("stage");
  setTimeout(() => {
    stage.classList.add("bump-mon");
    setTimeout(() => stage.classList.remove("bump-mon"), 130);
  }, kind === "skill" ? 240 : 190);
  if (!HERO_MODEL) return;
  const el = $("hero-art");
  if (!el || el.classList.contains("dead")) return;
  el.classList.remove("lunge", "crit", "skill", "hurt");
  void el.offsetWidth;   // 强制 reflow 以重触发动画
  if (color) el.style.setProperty("--hero-c", color);
  el.classList.add(kind);
}
/** 受击:后撤 + 泛红闪 */
function heroHurt(): void {
  if (!HERO_MODEL) return;
  const el = $("hero-art");
  if (!el) return;
  el.classList.remove("lunge", "crit", "skill");
  void el.offsetWidth;
  el.classList.add("hurt");
}

// ---------------------------------------------------------------- 普攻特效(每职业一套)
const FX_CAP = 24;

/** 生成一个自清理特效元素:动画播完即移除,超量裁最旧 */
function fxSpawn(cls: string, x: number, y: number, vars: Record<string, string> = {}): HTMLElement {
  const layer = $("fx-layer");
  while (layer.children.length >= FX_CAP) layer.removeChild(layer.firstChild!);
  const el = document.createElement("div");
  el.className = cls;
  el.style.left = x + "px";
  el.style.top = y + "px";
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.addEventListener("animationend", () => el.remove());
  layer.appendChild(el);
  return el;
}

/** 怪物中心(舞台内像素坐标;无怪时舞台中心偏上) */
function monCenterPx(): { x: number; y: number } | null {
  const stage = document.getElementById("stage");
  if (!stage) return null;
  const sr = stage.getBoundingClientRect();
  const art = stage.querySelector<HTMLElement>(".mon-art");
  if (art) {
    const ar = art.getBoundingClientRect();
    return { x: ar.left + ar.width / 2 - sr.left, y: ar.top + ar.height / 2 - sr.top };
  }
  return { x: sr.width / 2, y: sr.height * 0.42 };
}

/** 英雄侧发射锚点 x(舞台内像素):模型开着取立绘前沿,关着取立绘原位(舞台 13%) */
function heroMuzzleX(): number {
  const stage = document.getElementById("stage");
  if (!stage) return 60;
  if (HERO_MODEL) {
    const hero = document.getElementById("hero-art");
    if (hero) return hero.getBoundingClientRect().right - stage.getBoundingClientRect().left;
  }
  return stage.clientWidth * 0.13;
}
/** 英雄侧发射锚点(confetti 归一化 x) */
function heroMuzzleNorm(): number {
  const stage = document.getElementById("stage");
  return stage ? heroMuzzleX() / stage.clientWidth : 0.13;
}

/** 职业·战士/法师/射手的普攻形态;crit 时放大提亮。命中点取怪物中心(无怪时舞台中心)。 */
function playAttackFx(cls0?: string, crit = false): void {
  const layer = document.getElementById("fx-layer");
  const cls = cls0 ?? g.classId;
  if (!layer || !cls) return;
  const p = monCenterPx();
  if (!p) return;
  const { x: hx, y: hy } = p;
  const c = crit ? " crit" : "";
  if (cls === "warrior") {
    fxSpawn("fx-slash" + c, hx, hy,
      { "--r": `${Math.floor(Math.random() * 70 - 55)}deg` });
  } else if (cls === "mage") {
    const dy = Math.floor(Math.random() * 28 - 14);
    const x0 = heroMuzzleX();   // 从英雄侧锚点(舞台内)射向怪物,不再屏幕外飞入
    fxSpawn("fx-bolt" + c, x0, hy + dy, { "--x": `${hx - x0}px` });
    fxSpawn("fx-burst" + c, hx, hy + dy).style.animationDelay = "160ms";
  } else if (cls === "ranger") {
    const dy = Math.floor(Math.random() * 22 - 11);
    const x0 = heroMuzzleX();
    fxSpawn("fx-arrow" + c, x0, hy + dy, { "--x": `${hx - x0}px` });
    fxSpawn("fx-hit" + c, hx, hy + dy).style.animationDelay = "110ms";
  }
}

/** hero_attack 之后紧随的飘字是「暴击」→ 本次普攻按暴击呈现 */
function nextEvtIsCrit(evs: [string, string, string][], from: number): boolean {
  for (let j = from + 1; j < evs.length; j++) {
    const [k, t, c] = evs[j];
    if (k === "floater") return c === "bright_yellow" && t.startsWith("暴击");
    if (k !== "anim") return false;
  }
  return false;
}

// ---------------------------------------------------------------- 技能特效(canvas-confetti 开源粒子库,ISC/MIT)
// cast:<技能id> → 技能 icon 做粒子形状 + 技能色系 + SKILL_FX 模式表差异化发射。
// (技能伤害命中在核心侧发 skill_hit 而非 hero_attack,天然不与普攻特效重叠)

const fxBoom = confetti.create($("fx-canvas") as HTMLCanvasElement,
  { resize: true, useWorker: false, disableForReducedMotion: true });

const FX_COLORS: Record<string, string[]> = {
  bright_red: ["#ff6b6b", "#ff9c54", "#ffd9b0"],
  red: ["#e05a5a", "#c04545", "#f0b0a0"],
  bright_yellow: ["#ffd94a", "#ffb347", "#fff3c4"],
  yellow: ["#d9bd45", "#b59a30", "#f5ecc0"],
  bright_blue: ["#5adfff", "#4f8dff", "#dbeeff"],
  blue: ["#5a8fe0", "#4068c0", "#c8dcf5"],
  bright_green: ["#6bff8f", "#3fd66f", "#d2ffdf"],
  green: ["#55d97e", "#2fa856", "#c8f5d8"],
  bright_cyan: ["#7ff0ff", "#4fd8f0", "#e0fbff"],
  cyan: ["#55cce5", "#38a8c0", "#ccf0f8"],
  bright_magenta: ["#e06bff", "#b45aff", "#f2dcff"],
  magenta: ["#c050e0", "#9a38b8", "#ecc8f8"],
  white: ["#f2f2f7", "#c8c8d8", "#ffffff"],
  bright_black: ["#9a9ab2", "#6a6a84", "#d8d8e8"],
};

/** 技能 icon → 粒子形状(离屏渲染一次,缓存复用) */
const iconShapeCache = new Map<string, confetti.Shape[]>();
function iconShapes(icon: string): confetti.Shape[] {
  let s = iconShapeCache.get(icon);
  if (!s) {
    s = [confetti.shapeFromText({ text: icon, scalar: 2 })];
    iconShapeCache.set(icon, s);
  }
  return s;
}

type FxMode = "burst" | "ring" | "side" | "zip" | "rain" | "rise" | "multi" | "storm";
interface SkillFx {
  mode: FxMode; n?: number; scalar?: number; waves?: number;
  big?: boolean; frost?: boolean;
}

/** 30 技能逐一配置。burst=命中爆开 ring=环形冲击 side=左缘斜射 zip=高速直线
 *  rain=从天而降 rise=增益上升流 multi=连发波 storm=环爆+落雨;
 *  big=大招震屏,frost=冰冻覆盖。 */
const SKILL_FX: Record<string, SkillFx> = {
  // 战士
  w_strike: { mode: "burst", n: 30 },
  w_whirl: { mode: "ring", n: 42 },
  w_warcry: { mode: "rise", n: 34 },
  w_taunt: { mode: "burst", n: 20 },
  w_exec: { mode: "ring", n: 70, scalar: 1.5, big: true },
  w_blood: { mode: "burst", n: 30 },
  w_wall: { mode: "rise", n: 30 },
  w_fury: { mode: "rise", n: 26 },
  w_fatal: { mode: "burst", n: 55, scalar: 1.3, big: true },
  w_roar: { mode: "ring", n: 80, big: true },
  // 法师
  m_missile: { mode: "multi", n: 36, waves: 3 },
  m_fire: { mode: "burst", n: 40 },
  m_ice: { mode: "side", n: 30, frost: true },
  m_surge: { mode: "rise", n: 30 },
  m_chain: { mode: "zip", n: 20 },
  m_storm: { mode: "storm", n: 46 },
  m_nova: { mode: "ring", n: 50, frost: true },
  m_shield: { mode: "rise", n: 30 },
  m_meteor: { mode: "burst", n: 80, scalar: 1.8, big: true },
  m_cata: { mode: "storm", n: 70, scalar: 1.4, big: true },
  // 射手
  r_volley: { mode: "multi", n: 30, waves: 3 },
  r_pierce: { mode: "zip", n: 16 },
  r_mark: { mode: "burst", n: 14 },
  r_back: { mode: "burst", n: 18 },
  r_rain: { mode: "rain", n: 60, waves: 5 },
  r_hawk: { mode: "rise", n: 24 },
  r_dash: { mode: "zip", n: 22 },
  r_deadly: { mode: "multi", n: 40, waves: 3 },
  r_sky: { mode: "zip", n: 28, scalar: 1.5, big: true },
  r_god: { mode: "ring", n: 70, big: true },
};

/** 怪物中心(canvas-confetti 的 origin 相对 #fx-canvas 即舞台,取 0-1) */
function stageOrigin(): { x: number; y: number } {
  const stage = document.getElementById("stage");
  if (!stage) return { x: 0.5, y: 0.42 };
  const r = stage.getBoundingClientRect();
  const art = stage.querySelector<HTMLElement>(".mon-art");
  if (art) {
    const a = art.getBoundingClientRect();
    return {
      x: (a.left + a.width / 2 - r.left) / r.width,
      y: (a.top + a.height / 2 - r.top) / r.height,
    };
  }
  return { x: 0.5, y: 0.42 };
}

function playSkillFx(sid: string): void {
  const def = SKILL_DEF.get(sid);
  if (!def) return;
  const fx = SKILL_FX[sid] ?? { mode: "burst" as FxMode };
  const colors = FX_COLORS[def.color] ?? FX_COLORS.white;
  const shapes = iconShapes(def.icon);
  // 整体观感加强(2026-10-05 用户反馈"看不见"):粒子数 ×1.6、单个尺寸 ×1.25
  const n = Math.round((fx.n ?? 26) * 1.6);
  const scalar = (fx.scalar ?? 1) * 1.25;
  const mon = stageOrigin();
  const fire = (o: { x: number; y: number }, angle: number, spread: number,
                v: number, cnt: number, ticks = 230) =>
    fxBoom({ colors, shapes, scalar, particleCount: cnt, origin: o,
             angle, spread, startVelocity: v, ticks });

  switch (fx.mode) {
    case "burst":
      fire(mon, 90, 110, 55, n);
      break;
    case "ring":
      fire(mon, 90, 360, 42, n + 8);
      break;
    case "side":
      fire({ x: heroMuzzleNorm(), y: mon.y }, 25, 26, 85, Math.round(n * 0.8));
      fire(mon, 90, 70, 40, Math.round(n * 0.4));
      break;
    case "zip":
      fire({ x: heroMuzzleNorm(), y: mon.y }, 12, 14, 110, n);
      fire(mon, 90, 60, 30, 10);
      break;
    case "rain": {
      const waves = fx.waves ?? 3;
      const per = Math.max(8, Math.round(n / waves));
      for (let i = 0; i < waves; i++) {
        setTimeout(() => fxBoom({ colors, shapes, scalar: scalar * 0.8,
          particleCount: per,
          origin: { x: 0.2 + Math.random() * 0.6, y: Math.max(0.05, mon.y - 0.28) },
          angle: 270, spread: 26, startVelocity: 12, gravity: 1.6, ticks: 170 }), i * 110);
      }
      break;
    }
    case "rise":   // 增益/护盾:英雄方向(舞台左侧)自下而上飘散
      fxBoom({ colors, shapes, scalar: scalar * 0.9, particleCount: n,
        origin: { x: 0.14, y: 0.74 }, angle: 90, spread: 55,
        startVelocity: 38, gravity: 0.35, drift: 1.2, ticks: 330 });
      break;
    case "multi": {
      const waves = fx.waves ?? 3;
      for (let i = 0; i < waves; i++) {
        setTimeout(() => fire(mon, 90, 60, 70, Math.round(n / waves)), i * 95);
      }
      break;
    }
    case "storm":
      fire(mon, 90, 360, 55, n);
      for (let i = 0; i < 4; i++) {
        setTimeout(() => fxBoom({ colors, shapes, scalar, particleCount: 14,
          origin: { x: 0.2 + Math.random() * 0.6, y: 0.12 },
          angle: 270, spread: 20, startVelocity: 10, gravity: 1.4, ticks: 210 }), i * 100);
      }
      break;
  }
  const st = $("stage");
  if (fx.big) {
    st.classList.remove("shake");
    void st.offsetWidth;   // 重新触发动画
    st.classList.add("shake");
    setTimeout(() => st.classList.remove("shake"), 350);
  }
  if (fx.frost) {
    st.classList.add("frost");
    setTimeout(() => st.classList.remove("frost"), 1250);
  }
}

// ---------------------------------------------------------------- 掉落特效
// 紫色(epic)或更好品质掉落:细激光柱身+底部粗光座,装备粒从怪物尸体向两侧
// 抛物线爆出、落地驻留发光后消散(不在怪物模型上爆)。
// 事件由核心侧击杀掉落处发出(anim "loot:<rarity>",TS/Python 双端一致)。
const RARITY_HEX: Record<string, string> = {
  epic: "#c26bff",       // 史诗·紫
  legendary: "#ffd94a",  // 传说·金
  mythic: "#ff5a5a",     // 神话·红
};
function playLootBeam(rarity: string): void {
  const hex = RARITY_HEX[rarity];
  if (!hex) return;
  const p = monCenterPx();
  if (!p) return;
  fxSpawn("fx-beam", p.x, 0, { "--bx": hex, "--bh": Math.round(p.y + 40) + "px" });
  // 爆装备:左右交替抛出(品质越高越多),--dx/--dy 决定落点
  const n = { epic: 3, legendary: 4, mythic: 5 }[rarity] ?? 3;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const dx = side * (55 + Math.random() * 75);
    const dy = 55 + Math.random() * 55;
    fxSpawn("fx-drop", p.x, p.y, {
      "--bx": hex, "--dx": Math.round(dx) + "px", "--dy": Math.round(dy) + "px",
    }).style.animationDelay = i * 45 + "ms";
  }
}

// ---------------------------------------------------------------- 渲染
let curTab = "battle";
let offlineShown = false;
let swapShown = false;
// —— 转生流程 UI 态(不进存档):rebirthAsk=确认弹窗,rebirthPick=择业卡 ——
let rebirthAsk = false;
let rebirthPick = false;
// —— 新手引导(3 步,新档选完职业弹出;不进存档,一次性) ——
const INTRO_STEPS: [string, string, string][] = [
  ["⚔", "战斗全自动", "你无需任何操作:英雄会自动战斗、推层、打头目。你要做的是变强 —— 换更强的装备、升级技能。"],
  ["🎒", "掉落与换装", "怪物掉落的装备进入背包,点「装备▾」可对比战力后再换上(默认自动换装已开启,不用管也行)。"],
  ["🌙", "卡关就挂机", "打不过就切换挂机模式刷金币与装备;下线也有收益(离线最多结算 12 小时)。Lv40 后可「转生」换取永久强化。"],
];
let introStep: number | null = null;

function renderNow(): void {
  const st = buildState(g);
  renderTop(st);
  renderBattle(st);
  renderHeroPage(st);
  renderBag(st);
  renderSkills(st);
  renderQuest(st);
  renderTower(st);
  renderLeaderboard(st);
  renderAltar(st);
  renderSettings(st);
  renderOverlays(st);
  renderGearModal(st);
}

function renderTop(st: State): void {
  const theme = st.zone_name + (st.zone_cycle ? `·深度${st.zone_cycle}` : "");
  $("zone-chip").innerHTML = st.in_tower
    ? `<span>深渊塔 · 第${st.tower_floor_sel}层</span>` +
      `<span class="theme" style="color:#e06bff">塔层挑战中</span>`
    : `<span>第${st.zone}区 · ${st.stage}层</span>` +
      `<span class="theme" style="color:var(--dim)">${esc(theme)}</span>`;
  const speedBtn = $("speed-btn") as HTMLButtonElement;
  speedBtn.textContent = `×${st.speed}`;
  speedBtn.style.color = st.speed > 1 ? "var(--green)" : "";
  speedBtn.title = st.max_speed > st.speed
    ? `游戏速度 ×${st.speed}(下一档 Lv${st.speed_unlock[st.speed]}解锁)`
    : `游戏速度 ×${st.speed}(已满档)`;
  $("res-lv").innerHTML = `Lv.<span class="v">${st.level}</span>`;
  $("res-gold").innerHTML = `◈ <span class="v">${fmt(st.gold)}</span>`;
  $("res-stone").innerHTML = `✦ <span class="v">${fmt(st.stones)}</span>`;
  $("res-time").textContent = "⏱ " + fmtTime(st.playtime);
  const xpPct = Math.min(100, st.xp / st.xp_req * 100);
  $("res-lv").title = `经验 ${fmt(st.xp)} / ${fmt(st.xp_req)} (${xpPct.toFixed(1)}%)`;
}

function kv(k: string, v: string, cls = ""): string {
  return `<div class="kv"><span class="k">${k}</span><b${cls ? ` class="${cls}"` : ""}>${v}</b></div>`;
}
function slotName(s: string): string {
  return D.SLOT_NAMES[s] ?? s;
}
function itemMainLine(it: ItemUI): string {
  return it.main.name + " " + (it.main.pct ? pctTxt(it.main.val) : fmt(it.main.val));
}
function itemAffixLine(it: ItemUI): string {
  const parts = it.affixes.map(a => a.name + (a.pct ? pctTxt(a.val) : "+" + fmt(a.val)));
  if (it.innate) parts.push(it.innate.name + " " + pctTxt(it.innate.val) + "(固有)");
  return parts.join(" / ");
}

function renderBattle(st: State): void {
  if (!st.class_id) return;
  heroModelSync(st);
  const h = st.hero;
  const hpPct = Math.max(0, Math.min(100, h.hp / h.max_hp * 100));
  const shield = h.shield ?? 0;
  const buffs = st.buffs.map(b =>
    `<span class="buff">${esc(b.name)} +${pctTxt(b.pct)} ${fmtBuffTime(b.remain)}</span>`).join("");
  // 生效中的 buff 高亮对应属性(药剂/技能增益一眼可辨)
  const has = (k: string) => st.buffs.some(b => b.key === k);
  const atkUp = has("atk") || has("all");
  const hasteUp = has("haste");
  const dpsUp = atkUp || hasteUp || has("dmg_pct");
  $("hero-card").innerHTML =
    `<h3><span class="dot"></span>英雄 · ${esc(st.cls.name)}</h3>` +
    `<div class="bar hero-hp lg"><div class="fill" style="width:${hpPct}%"></div>` +
    (shield > 0 ? `<i class="shield-mark" style="left:${hpPct}%;width:${Math.min(100 - hpPct, shield / h.max_hp * 100)}%"></i>` : "") +
    `<div class="num">${fmt(h.hp)} / ${fmt(h.max_hp)}` +
      (shield > 0 ? ` (🛡${fmt(shield)})` : "") + `</div></div>` +
    `<div class="stat-grid" style="margin-top:9px">` +
      kv("战力", fmt(st.power?.total ?? 0), dpsUp ? "up" : "") +
      kv("攻击", fmt(h.atk), atkUp ? "up" : "") + kv("防御", fmt(h.def)) +
      kv("攻速", "+" + pctTxt(h.haste), hasteUp ? "up" : "") + kv("暴击", pctTxt(h.crit)) +
      kv("暴伤", "+" + pctTxt(h.crit_dmg)) + kv("幸运", "+" + fmt(h.luck ?? 0)) +
      kv("吸血", pctTxt(h.lifesteal)) +
      kv("DPS", fmt(h.dps), dpsUp ? "up" : "") +
      kv("击杀均时", st.ema_kill ? st.ema_kill.toFixed(1) + "s" : "—") +
    `</div>` + (buffs ? `<div class="buff-row">${buffs}</div>` : "");

  let eq = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    eq += `<div class="eq-row"><span class="eq-slot">${slotName(s)}</span>` +
      (it ? `<span class="eq-name c-${it.rcolor}">${esc(it.name)}</span>` +
           `<span class="eq-plus">+${it.plus}</span>`
         : `<span class="eq-name eq-empty">— 空 —</span>`) + `</div>`;
  }
  $("equip-mini").innerHTML = `<h3><span class="dot"></span>装备</h3>` + eq;

  if (st.in_tower) {
    // 塔副本模式:进度条改为 5 层一段(段末头目),信息与操作全换塔口径
    const floor = st.tower_floor_sel;
    const pos = ((floor - 1) % D.TOWER.boss_every) + 1;
    let td = "";
    for (let i = 1; i <= D.TOWER.boss_every; i++) {
      const cls = i < pos ? "done" : i === pos ? "cur" : "";
      td += `<div class="stage-dot ${cls}${i === D.TOWER.boss_every ? " boss" : ""}"></div>`;
    }
    const bossFloor = floor % D.TOWER.boss_every === 0;
    $("stage-track").innerHTML =
      `<div class="stage-track tower">${td}</div>` +
      `<div class="stage-lbl"><span>深渊塔 · 第 ${floor} 层` +
      (bossFloor ? ` <span style="color:var(--gold);font-weight:700">头目层!</span>` : "") +
      `<span style="color:var(--dim)"> · 1 怪/层 · 通关必得遗物</span></span>` +
      `<span class="act"><button class="btn mini warn" data-cmd="tower_exit">撤退(钥匙已消耗)</button>` +
      `</span></div>`;
  } else {
    let dots = "";
    for (let i = 1; i <= 10; i++) {
      const cls = i < st.stage ? "done" : i === st.stage ? "cur" : "";
      dots += `<div class="stage-dot ${cls}${i === 10 ? " boss" : ""}"></div>`;
    }
    const killsTxt = st.stage === 10
      ? "头目战(1只)" : `本层击杀 ${st.stage_kills} / ${st.kills_per_stage}`;
    $("stage-track").innerHTML =
      `<div class="stage-track">${dots}</div>` +
      `<div class="stage-lbl"><span>第 ${st.stage} / 10 层 · ${killsTxt}</span>` +
      `<span class="act"><span>♛ ${esc(st.zone_boss)}</span>` +
      (st.mode === "farm"
        ? `<button class="btn mini" data-cmd="farm_stage" data-a="-1">−</button>` +
          `<span class="mono">${st.farm_stage}</span>` +
          `<button class="btn mini" data-cmd="farm_stage" data-a="1">+</button>`
        : "") + `</span></div>`;
  }

  const mon = st.monster;
  let inner = "";
  if (st.respawn > 0) {
    inner = `<div class="respawn">☠ 你被击败了…${st.respawn.toFixed(1)} 秒后复活</div>`;
  } else if (mon) {
    const tag = mon.boss
              ? `<span class="tag boss">${st.in_tower ? "塔主" : "头目"}</span>`
              : mon.elite ? `<span class="tag elite">精英</span>` : "";
    const skTag = mon.skill ? `<span class="tier" style="color:#ff8888">${esc(mon.skill)}</span>` : "";
    const hpPctM = Math.max(0, mon.hp / mon.max_hp * 100);
    // 立绘:mon/<id>.png(头目用 -boss 变体),加载失败回退 ASCII 小画(CSS 控制)
    const size = mon.boss ? " boss" : mon.elite ? " elite" : "";
    const artHtml = mon.id
      ? `<img src="${BASE_URL}mon/${mon.id}${mon.boss ? "-boss" : ""}.png" alt="${esc(mon.name)}" draggable="false"` +
        ` onerror="this.closest('.mon-art').classList.add('imgfail')">` +
        `<pre class="ascii">${esc(mon.art.join("\n"))}</pre>`
      : `<pre class="ascii">${esc(mon.art.join("\n"))}</pre>`;
    inner =
      `<div class="mon-name c-${mon.color}">${esc(mon.name)}${tag}` +
        `<span class="tier">T${mon.tier}</span>${skTag}</div>` +
      `<div class="mon-art${mon.id ? " spr" : ""}${size}">${artHtml}</div>` +
      `<div style="width:min(320px,72vw)"><div class="bar hp lg"><div class="fill" style="width:${hpPctM}%"></div>` +
        `<div class="num">${fmt(Math.max(0, mon.hp))} / ${fmt(mon.max_hp)}</div></div></div>`;
  }
  $("stage-inner").innerHTML = inner;

  let sk = "";
  for (const sid of st.loadout.active) {
    const def = st.skills.active.find(s => s.id === sid);
    if (!def) continue;
    const cd = st.skill_cd[sid] ?? 0;
    const cdPct = cd > 0 ? Math.min(100, cd / def.cd * 100) : 0;
    sk += `<div class="skill ${cd > 0 ? "" : "ready"}" title="${esc(def.desc)}｜冷却 ${def.cd}s">` +
      `<span class="ic">${def.icon}</span><span class="nm">${esc(def.name)}</span>` +
      (cd > 0 ? `<div class="cdfill" style="height:${cdPct}%"></div>` +
        `<div class="cdov">${Math.ceil(cd)}</div>` : "") + `</div>`;
  }
  $("skillbar-card").innerHTML =
    `<h3><span class="dot"></span>技能 · 自动施放中</h3>` +
    (sk ? `<div id="skillbar">${sk}</div>`
        : `<span style="color:var(--dim)">技能页装配主动技能</span>`);

  let q = "";
  for (const quest of st.quests) {
    const p = Math.min(100, quest.progress / quest.target * 100);
    q += `<div class="q-row"><div class="t"><span>${esc(quest.desc)}</span>` +
      `<span class="rew">◈${fmt(quest.gold)}` +
      (quest.stones ? ` <span class="st">✦${quest.stones}</span>` : "") +
      `</span></div>` +
      `<div class="bar q"><div class="fill" style="width:${p}%"></div>` +
      `<div class="num" style="font-size:10px">${quest.progress} / ${quest.target}</div></div></div>`;
  }
  const dailyCap = st.quest_daily_count >= st.quest_daily_limit;
  $("quests-mini").innerHTML =
    `<h3><span class="dot"></span>悬赏任务 · 今日 ${st.quest_daily_count}/${st.quest_daily_limit}</h3>` +
    (dailyCap ? `<div style="color:var(--dim);font-size:12px;margin:-4px 0 8px">今日已达上限,在途进度冻结,明日 0 点恢复</div>` : "") + q;
}

function renderHeroPage(st: State): void {
  if (!st.class_id) { $("hero-detail").innerHTML = ""; return; }
  const h = st.hero;
  // 装备框:装备 6 槽,点击槽位弹详情(属性与强化/洗练/卸下);遗物在塔页更换
  let frame = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    frame += `<div class="gear-slot" data-gear="slot:${s}">` +
      `<div class="sl">${slotName(s)}</div>` +
      (it
        ? `<div class="nm c-${it.rcolor}">${esc(it.name)}${it.plus ? ` <span style="color:#5adfff">+${it.plus}</span>` : ""}</div>` +
          `<div class="sub">评分 ${fmt(it.score)} · 主属性${pctTxt(it.pb)}</div>`
        : `<div class="nm eq-empty">— 空 —</div><div class="sub">击败怪物获取</div>`) +
      `</div>`;
  }
  const xpPct = Math.min(100, st.xp / st.xp_req * 100);
  const pw = st.power;
  $("hero-detail").innerHTML =
    `<h3><span class="dot"></span>${st.cls.icon} ${esc(st.cls.name)} · Lv.${st.level}</h3>` +
    `<div style="color:var(--dim);font-size:12.5px;margin:-6px 0 10px">${esc(st.cls.desc)}</div>` +
    `<div class="bar xp lg" style="margin-bottom:12px"><div class="fill" style="width:${xpPct}%"></div>` +
      `<div class="num">经验 ${fmt(st.xp)} / ${fmt(st.xp_req)}</div></div>` +
    `<div class="stat-grid wide" style="margin-bottom:6px">` +
      kv("⚔ 战力", pw ? fmt(pw.total) : "—") +
      kv("生命", fmt(h.max_hp)) + kv("攻击", fmt(h.atk)) + kv("防御", fmt(h.def)) +
      kv("攻速", "+" + pctTxt(h.haste)) + kv("暴击率", pctTxt(h.crit)) +
      kv("暴击伤害", "+" + pctTxt(h.crit_dmg)) + kv("吸血", pctTxt(h.lifesteal)) +
      kv("金币加成", pctTxt(h.goldfind)) + kv("闪避", pctTxt(h.dodge ?? 0)) +
      kv("无视防御", pctTxt(h.armor_pierce ?? 0)) + kv("技能伤害", "+" + pctTxt(h.skill_dmg ?? 0)) +
      kv("冷却缩减", pctTxt(h.cd_reduce ?? 0)) + kv("经验加成", "+" + pctTxt(h.xp_pct ?? 0)) +
      kv("全技能等级", "+" + numTxt(h.skill_lv ?? 0)) + kv("理论 DPS", fmt(h.dps)) +
    `</div>` +
    (pw ? `<div style="color:var(--dim);font-size:11.5px;margin:0 0 12px">` +
      `战力构成:输出 ${fmt(pw.offense)} · 生存 ${fmt(pw.defense)} · 功能 ${fmt(pw.utility)}` +
      `(按第 ${Math.max(1, st.stats.max_zone)} 区假人折算,含生效增益)</div>` : "") +
    rebirthBlockHtml(st) +
    `<h3 style="margin-top:16px"><span class="dot"></span>装备框 · 点击槽位查看属性与操作</h3>` +
    `<div class="gear-frame">${frame}</div>`;
}

/** 转生块:当前加成 + 门槛进度 + 入口按钮(确认与择业在弹窗) */
function rebirthBlockHtml(st: State): string {
  const statPct = D.BAL.rebirth_stat_pct * st.rebirths;
  const gainPct = D.BAL.rebirth_gain_pct * st.rebirths;
  const nextStat = D.BAL.rebirth_stat_pct * (st.rebirths + 1);
  const nextGain = D.BAL.rebirth_gain_pct * (st.rebirths + 1);
  const lvLeft = Math.max(0, st.rebirth_min_level - st.level);
  return `<h3 style="margin-top:16px"><span class="dot"></span>♻ 转生 · 涅槃重生</h3>` +
    `<div class="rebirth-card${st.can_rebirth ? " ready" : ""}">` +
      `<div class="rb-info">` +
        `<span>转生 <b>${st.rebirths}</b> 世</span>` +
        `<span>攻击/生命/防御 <b>+${statPct}%</b></span>` +
        `<span>金币/经验 <b>+${gainPct}%</b></span>` +
      `</div>` +
      `<div class="rb-desc">重置本局成长(等级/装备/金币/技能等级),保留成就·祭坛·遗物·塔记录·背包容量;` +
      `下一次:+${nextStat}% 三围 · +${nextGain}% 金币经验${st.rebirths === 0 ? ",并可选新职业" : ",可再换职业"}` +
      `</div>` +
      (st.can_rebirth
        ? `<button class="btn big sell-on" data-cmd="rebirth">♻ 发起转生</button>`
        : `<button class="btn big" disabled title="等级达标后解锁">Lv.${st.rebirth_min_level} 解锁(还差 ${lvLeft} 级)</button>`) +
    `</div>`;
}

/** 一键出售的品质档(≤ 该档全卖);UI 会话级状态,默认精良(原「普通/精良」行为) */
let junkSellMax = 1;

function renderBag(st: State): void {
  if (!st.class_id) { $("bag-list").innerHTML = ""; return; }
  let cards = "";
  st.bag.forEach((it, i) => {
    cards +=
      `<div class="item r-${it.rarity}"><div class="gcd">◈${fmt(it.sell)}</div>` +
      `<div class="nm">${esc(it.name)}` + (it.plus ? ` <span style="color:#5adfff">+${it.plus}</span>` : "") + `</div>` +
      `<div class="sub">${it.slot_name} · ${it.rname} · ${it.affixes.length}词缀 · T${it.tier}</div>` +
      `<div class="lines">${esc(itemMainLine(it))}<br>${esc(itemAffixLine(it) || "")}</div>` +
      `<div class="ops">` +
        `<button class="btn mini" data-cmd="gear_cmp_item" data-a="${i}" title="对比当前装备后再决定">装备▾</button>` +
        `<button class="btn mini" data-cmd="dismantle" data-a="${i}">分解◈${fmt(it.dgold)}${it.dstones ? "✦" + it.dstones : ""}</button>` +
        `<button class="btn mini" data-cmd="sell" data-a="${i}">出售</button>` +
      `</div></div>`;
  });
  // 一键出售:品质选择行(卖出 ≤ 所选品质),按钮文字跟随所选档位
  const picks = D.RARITIES.map((r, i) =>
    `<button class="btn mini rq-btn${i === junkSellMax ? " on" : ""} c-${r.color}"
       data-cmd="junk_pick" data-a="${i}">${r.name}</button>`).join("");
  $("bag-list").innerHTML =
    `<h3><span class="dot"></span>背包 · ${st.bag.length} / ${st.bag_cap}` +
    `<span class="rt">` +
      (st.bag_expand_cost !== null
        ? `<button class="btn mini" data-cmd="bag_expand" title="金币扩容 +10 格">扩容 ◈${fmt(st.bag_expand_cost)}</button>`
        : `<span style="color:var(--dim);font-size:11px">背包已满级</span>`) +
      `<button class="btn" data-cmd="sell_junk">一键出售 ≤${D.RARITIES[junkSellMax].name}</button></span></h3>` +
    `<div class="sell-bar"><span class="lbl">出售品质</span>${picks}` +
      `<span class="hint">(卖出该品质及以下)</span></div>` +
    (cards ? `<div class="bag-grid">${cards}</div>`
           : `<div style="color:var(--dim);padding:30px;text-align:center">背包空空如也</div>`);
}


function renderSkills(st: State): void {
  if (!st.class_id) { $("loadout-card").innerHTML = ""; $("skill-pools").innerHTML = ""; return; }
  const nSlots = st.loadout_slots;
  const slotHtml = (which: "active" | "passive"): string => {
    let out = "";
    const list = st.loadout[which];
    const pool = st.skills[which];
    for (let i = 0; i < 4; i++) {
      const sid = list[i];
      const def = sid ? pool.find(s => s.id === sid) : undefined;
      if (i < nSlots) {
        out += `<div class="lo-slot${def ? "" : " locked"}"` +
          (def ? ` data-cmd="unequip_skill" data-a="${def.id}" title="点击卸下"` : "") + `>` +
          (def ? `<span class="ic">${def.icon}</span><span class="nm">${esc(def.name)}</span>`
               : `<span class="ic" style="opacity:.3">+</span>`) + `</div>`;
      } else {
        out += `<div class="lo-slot locked" data-lv="${st.loadout_unlock[i]}"></div>`;
      }
    }
    return out;
  };
  $("loadout-card").innerHTML =
    `<h3><span class="dot"></span>装配(主动与被动各 ${nSlots} 槽,点击已装配技能卸下)</h3>` +
    `<div class="loadout-row">` +
    `<div class="lo-col"><div class="t">主动技能</div><div class="lo-slots">${slotHtml("active")}</div></div>` +
    `<div class="lo-col"><div class="t">被动技能</div><div class="lo-slots">${slotHtml("passive")}</div></div>` +
    `</div>`;

  const pool = (list: SkillUI[], which: "active" | "passive"): string => list.map(s => {
    // 装备/遗物等级加成叠在基础等级上生效(有效等级可超上限,数值行按有效等级计算);
    // 金币升级上限(skill_lv_max)只看基础等级。主标签展示基础等级,装备加成作后缀。
    const maxed = s.lv >= D.BAL.skill_lv_max;
    const lvTxt = `Lv.${s.lv}${maxed ? " 满" : ""}` +
      (s.eff > s.lv ? `(装+${s.eff - s.lv})` : "");
    return `<div class="sk-card${s.unlocked ? "" : " locked"}">` +
    `<div class="sk-ic">${s.icon}</div>` +
    `<div class="sk-body"><div class="nm">${esc(s.name)}` +
      `<span class="lv">${lvTxt}</span>` +
      (s.equipped ? `<span class="eq">✓已装配</span>` : "") + `</div>` +
      `<div class="ds">${esc(s.desc)}</div>` +
      `<div class="cd">解锁 Lv.${s.unlock}${s.cd ? ` · 冷却 ${s.cd}s` : ""}${s.unlocked ? "" : "(未解锁)"}</div></div>` +
    (s.unlocked
      ? `<div class="sk-ops">` +
        (maxed
          ? `<div class="cost" style="color:var(--dim)">基础已满 Lv.${D.BAL.skill_lv_max}·装备/遗物单技能加成仍生效</div>`
          : `<div class="cost">升级 ◈${fmt(s.cost)}</div>` +
            `<button class="btn mini" data-cmd="skill_up" data-a="${s.id}">升级</button>`) +
        (s.equipped
          ? `<button class="btn mini" data-cmd="unequip_skill" data-a="${s.id}">卸下</button>`
          : `<button class="btn mini" data-cmd="equip_skill" data-a="${s.id}" data-b="${which}">装配</button>`) +
        `</div>`
      : "") + `</div>`;
  }).join("");
  $("skill-pools").innerHTML =
    `<div class="skill-pools"><div class="pool"><h4>✦ 主动技能池</h4>${pool(st.skills.active, "active")}</div>` +
    `<div class="pool"><h4>◈ 被动技能池</h4>${pool(st.skills.passive, "passive")}</div></div>`;
}

function renderQuest(st: State): void {
  if (!st.class_id) { $("quest-list").innerHTML = ""; $("ach-list").innerHTML = ""; return; }
  let qs = "";
  for (const q of st.quests) {
    const p = Math.min(100, q.progress / q.target * 100);
    qs += `<div class="q-row"><div class="t"><span>${esc(q.desc)}</span>` +
      `<span class="rew">◈${fmt(q.gold)}${q.stones ? ` <span class="st">✦${q.stones}</span>` : ""}</span></div>` +
      `<div class="bar q"><div class="fill" style="width:${p}%"></div>` +
      `<div class="num" style="font-size:10px">${q.progress} / ${q.target}</div></div></div>`;
  }
  const dailyCap2 = st.quest_daily_count >= st.quest_daily_limit;
  $("quest-list").innerHTML =
    `<h3><span class="dot"></span>悬赏任务(完成后自动刷新)· 今日 ${st.quest_daily_count}/${st.quest_daily_limit}` +
      `<span class="rt">` +
      (st.quest_reroll_cost !== null
        ? `<button class="btn mini" data-cmd="quest_reroll" title="金币刷新全部悬赏">刷新 ◈${fmt(st.quest_reroll_cost)}(${st.quest_reroll_used}/${D.BAL.quest_reroll_max})</button>`
        : `<span style="color:var(--dim);font-size:11px">今日刷新已满</span>`) +
      `</span></h3>` +
    (dailyCap2 ? `<div style="color:var(--dim);font-size:12px;margin:-4px 0 8px">今日悬赏已达上限(${st.quest_daily_limit}个):在途任务进度冻结,明日 0 点自动恢复</div>` : "") + qs;

  let ach = "";
  for (const a of st.achievements) {
    let pips = "";
    for (let i = 0; i < a.total; i++) pips += `<i class="${i < a.tiers ? "on" : ""}"></i>`;
    ach += `<div class="ach-row"><div class="ach-info"><div class="nm">${esc(a.name)}</div>` +
      `<div class="pr">当前 ${fmt(a.val)}` +
      (a.next !== null ? ` · 下一档 ${fmt(a.next)}` : " · 已满档") + `</div></div>` +
      `<div class="ach-pips">${pips}</div>` +
      `<div class="ach-bonus">${esc(a.stat)} +${a.stat.includes("点") ? a.bonus : pctTxt(a.bonus)}` +
      (a.next !== null ? ` <span class="nx">(每档+${a.per})</span>` : "") + `</div></div>`;
  }
  $("ach-list").innerHTML = `<h3><span class="dot"></span>成就(永久加成)</h3>` + ach;
}

const AUTO_SELL_NAMES = ["关闭", "出售「普通」及以下", "出售「精良」及以下",
                         "出售「稀有」及以下", "出售「史诗」及以下", "出售「传说」及以下"];
const AUTO_SELL_TIERS = ["普通", "精良", "稀有", "史诗", "传说"];
// 状态文案明确带 开/关 前缀,避免用户误读档位名"关闭"为操作按钮
function autoSellStateText(idx: number | null | undefined): string {
  const i = Number(idx ?? -1);
  return i < 0 ? "关(掉落保留)" : `开 · ${AUTO_SELL_NAMES[i + 1]}`;
}
function renderTower(st: State): void {
  const panel = $("tower-panel");
  if (!st.class_id) { panel.innerHTML = ""; return; }
  const tw = st.tower;
  const reach = tw.max_floor + 1;   // 下一层(爬塔起点)
  const boss = reach % D.TOWER.boss_every === 0;
  const p = Math.min(100, tw.max_floor / reach * 100);

  // 遗物 4 槽:塔页更换,点击弹详情(与角色页装备框同款交互)
  let relicFrame = "";
  st.relics.forEach((r, i) => {
    relicFrame += `<div class="gear-slot relic" data-gear="relic:${i}">` +
      `<div class="sl">遗物${i + 1}</div>` +
      (r
        ? `<div class="nm c-${r.rcolor}">${esc(r.name)}</div>` +
          `<div class="sub">${r.rname} T${r.tier} · ${r.effects.length}效果</div>`
        : `<div class="nm eq-empty">— 空 —</div><div class="sub">爬塔通关获取</div>`) +
      `</div>`;
  });

  let html =
    `<h3><span class="dot"></span>深渊塔 · 钥匙 ×${tw.keys}(每日 ${D.TOWER.keys_per_day} 把)` +
      `<span class="rt">` +
      (st.tower_key_cost !== null
        ? `<button class="btn mini" data-cmd="tower_key" title="金币加购(今日 ${st.tower_keys_bought}/${D.BAL.tower_key_extra})">加购 ◈${fmt(st.tower_key_cost)}</button>`
        : `<span style="color:var(--dim);font-size:11px">今日加购已满</span>`) +
      `<span style="color:var(--dim)">最高 第${tw.max_floor}层</span></span></h3>` +
    `<div class="stage-lbl" style="margin:2px 0 8px;flex-wrap:wrap;gap:8px"><span>` +
      `<span class="mono" style="font-size:16px;font-weight:800;margin:0 8px">下一层 第 ${reach} 层</span>` +
      (boss ? `<span style="color:var(--gold);font-weight:700">头目!</span>` : "") +
      `<span style="color:var(--dim);margin-left:10px">每${D.TOWER.boss_every}层头目(保底稀有)</span>` +
    `</span><span class="act">` +
      (st.in_tower
        ? `<span style="color:#ff9c9c;font-weight:700">爬塔中 · 第${st.tower_floor_sel}层</span>` +
          `<button class="btn warn" data-cmd="tower_exit">撤退(钥匙已消耗)</button>`
        : `<button class="btn" data-cmd="tower_enter">⚔ 从第${reach}层开始爬(每层1钥匙,连胜连爬)</button>`) +
    `</span></div>` +
    `<div class="bar q lg"><div class="fill" style="width:${p}%"></div>` +
      `<div class="num">第1层 → 第${tw.max_floor}层 · 下一层 第${reach}层</div></div>` +
    `<h3 style="margin-top:16px"><span class="dot"></span>遗物 · 4 槽(通关必得,空槽优先装满)` +
    `<span style="color:var(--dim);font-size:12px;font-weight:400;margin-left:8px">点击槽位查看详情</span></h3>` +
    `<div class="gear-frame">${relicFrame}</div>`;

  // ---- 遗物背包(换装对比/分解/扩容;满槽装备=替换效果最少的一件) ----
  const nBag = st.relic_bag.length;
  const bagFull = nBag >= st.relic_bag_cap;
  const upCost = st.relic_bag_cost;
  const nextCap = Math.min(st.relic_bag_cap * 2, D.BAL.relic_bag_cap);
  html += `<h3 style="margin-top:16px"><span class="dot"></span>遗物背包 · ${nBag}/${st.relic_bag_cap} 格` +
    `<span class="rt">${upCost !== null
      ? `<button class="btn mini" data-cmd="relic_bag_up" style="${st.gold < upCost ? "opacity:.55" : "border-color:#3a6a4a;color:#6bff8f"}">` +
          `扩容 ${nextCap} 格 · ◈${fmt(upCost)}${st.gold < upCost ? "(金币不足)" : ""}</button>`
      : `<span style="color:var(--dim)">已满级 ${st.relic_bag_cap} 格</span>`}</span></h3>`;
  if (!nBag) {
    html += `<div class="slot-card"><div class="slot-m" style="color:var(--dim)">` +
      (bagFull ? "背包已满:再掉落的遗物将自动替换装备中效果最少的一件"
               : "遗物槽满时,新掉落的遗物会存入背包;卸下的遗物也保存在这里") +
      `</div></div>`;
  } else {
    st.relic_bag.forEach((r, i) => {
      const effs = r.effects
        .map(e => `◈ ${e.name} +${e.unit === "级" ? Math.round(e.val) : pctTxt(e.val)}${e.unit}`)
        .join(" &nbsp; ");
      html += `<div class="slot-card"><div class="slot-l"><div class="sl">背包${i + 1} · ${r.rname} T${r.tier}</div>` +
        `<div class="nm c-${r.rcolor}">${esc(r.name)}</div></div>` +
        `<div class="slot-m"><div class="af">${effs}</div></div>` +
        `<div class="slot-r">` +
        `<button class="btn mini" data-cmd="gear_cmp_relic" data-a="${i}"` +
          ` title="对比目标槽后决定;4槽全满时替换效果最少的一件">装备▾</button>` +
        `<button class="btn mini" data-cmd="relic_dismantle" data-a="${i}" title="分解得 1 颗重铸石(洗练用)">分解✦1</button>` +
        `</div></div>`;
    });
  }
  panel.innerHTML = html;
}

function renderSettings(st: State): void {
  if (!st.class_id) { $("settings-panel").innerHTML = ""; return; }
  const autoSellIdx = Number(st.settings.auto_sell_idx ?? -1);
  const s = st.stats;
  $("settings-panel").innerHTML =
    `<h3><span class="dot"></span>设置</h3>` +
    `<div class="set-row"><div class="lbl">自动换装<div class="d">新掉落评分高于当前 5% 时自动穿上</div></div>` +
      `<div class="toggle${st.settings.auto_equip ? " on" : ""}" data-cmd="auto_equip"></div></div>` +
    `<div class="set-row"><div class="lbl">掉落自动出售<div class="d">低稀有度装备掉落即折现;点击循环切换档位</div></div>` +
      (autoSellIdx < 0
        ? `<button class="btn sell-off" data-cmd="cycle_sell" style="min-width:130px;text-align:center">已关闭</button>`
        : `<button class="btn sell-on" data-cmd="cycle_sell" style="min-width:130px;text-align:center">开 · 出售 ≤${AUTO_SELL_TIERS[autoSellIdx]}</button>`) + `</div>` +
    `<div class="set-row"><div class="lbl">战斗模式<div class="d">推进:击败敌人深入;挂机:停留指定层。受阻自动转挂机,装备跟上自动回推(手动挂机不切)</div></div>` +
      `<button class="btn" data-cmd="mode">${st.mode === "push" ? "切换为挂机" : "切换为推进"}</button></div>` +
    (st.mode === "farm"
      ? `<div class="set-row"><div class="lbl">挂机层位<div class="d">当前 ${st.farm_stage} 层</div></div>` +
        `<div style="display:flex;gap:6px"><button class="btn" data-cmd="farm_stage" data-a="-1">− 1 层</button>` +
        `<button class="btn" data-cmd="farm_stage" data-a="1">+ 1 层</button></div></div>`
      : "") +
    `<div class="set-row"><div class="lbl">音效<div class="d">攻击与技能音(复古 8-bit + 程序合成)</div></div>` +
      `<div class="toggle${sfxOn ? " on" : ""}" data-local="sfx"></div></div>` +
    `<div class="set-row"><div class="lbl">音乐<div class="d">深渊氛围循环(程序合成,可独立关闭)</div></div>` +
      `<div class="toggle${bgmOn ? " on" : ""}" data-local="bgm"></div></div>` +
    `<div class="set-row"><div class="lbl">总音量<div class="d">音效与音乐共用;0% = 全静音</div></div>` +
      `<input type="range" class="vol-slider" min="0" max="100" step="5" ` +
        `value="${Math.round(masterVol * 100)}" data-vol="master" ` +
        `title="总音量 ${Math.round(masterVol * 100)}%">` +
      `</div>` +
    (cloudState.ready
      ? `<div class="set-row"><div class="lbl">云账号<div class="d">登录后多设备存档漫游;不登录照常玩</div></div>` +
        `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px">` +
        (cloudState.user
          ? `<span class="cloud-chip${cloudState.error ? "" : "ok"}">${esc(cloudState.user.name)}` +
            `${cloudState.user.email ? `(${esc(cloudState.user.email)})` : ""} · ` +
            `${cloudState.syncing ? "同步中…" : cloudState.error ? "同步失败"
              : cloudState.lastSyncMs ? "已同步 " + new Date(cloudState.lastSyncMs).toLocaleTimeString()
              : "已登录"}</span>` +
            `<button class="btn" data-cmd="cloud_push">立即同步</button>` +
            `<button class="btn danger" data-cmd="cloud_logout">退出</button>`
          : `<button class="btn" data-cmd="cloud_login">登录 / 注册</button>`) +
        `</div></div>`
      : "") +
    `<div class="set-row"><div class="lbl">存档<div class="d">自动存档于浏览器(localStorage),离线收益自动结算</div></div>` +
      `<div style="display:flex;gap:6px;flex-wrap:wrap">` +
      `<button class="btn" data-local="save">手动存档</button>` +
      `<button class="btn" data-local="export">导出</button>` +
      `<button class="btn" data-local="import">导入</button>` +
      `<button class="btn danger" data-local="reset">重置</button></div></div>` +
    `<h3 style="margin-top:16px"><span class="dot"></span>统计</h3>` +
    `<div class="stats-grid">` +
      kv("总击杀", fmt(s.kills)) + kv("头目击杀", fmt(s.boss_kills)) +
      kv("死亡", fmt(s.deaths)) + kv("最远区域", String(s.max_zone)) +
      kv("强化次数", fmt(s.enhance_total)) + kv("重铸次数", fmt(s.reforge_total)) +
      kv("累计金币", fmt(s.gold_earned)) + kv("悬赏完成", fmt(s.quest_done)) +
      kv("暴击次数", fmt(s.crit_hits ?? 0)) + kv("游玩时长", fmtTime(st.playtime)) +
    `</div>` +
    `<p class="set-hint" style="color:var(--dim);font-size:12px;margin-top:14px">` +
      `<span class="kbd-hint">快捷键:1-8 切页 · 9 设置 · F 推进/挂机 · P 暂停 · S 存档 · M 音效 · </span>v${pkg.version}</p>`;
}

function renderOverlays(st: State): void {
  const cs = $("class-select");
  const wantCls = !st.class_id || rebirthPick;   // 新档选职业 / 转生择业共用
  if (wantCls && !cs.classList.contains("show")) {
    const cl: [string, string, string, string, string][] = [
      ["warrior", "⚔", "战士", "钢铁与怒火:生存极强,越战越勇,斩杀收头", "生命×1.30 · 攻击×1.05 · 防御×1.35"],
      ["mage", "✦", "法师", "元素与毁灭:普攻平庸,技能伤害爆炸", "生命×1.05 · 攻击×1.10 · 防御×1.00"],
      ["ranger", "➤", "射手", "风与箭雨:攻速快、暴击高,连击风筝", "生命×0.95 · 攻击×0.95 · 防御×0.90 · 初始暴击5%"],
    ];
    $("cls-grid").innerHTML = cl.map(c =>
      `<div class="cls-card" data-cmd="choose_class" data-a="${c[0]}">` +
      `<div class="ic">${c[1]}</div><div class="nm">${c[2]}</div>` +
      `<div class="ds">${c[3]}</div><div class="bs">${c[4]}</div></div>`).join("");
    ($("cls-sub") as HTMLElement).textContent = rebirthPick
      ? "选择下一世的职业(选卡转生;职业与技能池随之更换,遗物/成就/祭坛保留)"
      : "选择将决定你的技能池与成长方向(40 级后可通过转生更换)";
    const keep = $("cls-keep");
    keep.style.display = rebirthPick && st.class_id ? "" : "none";
    if (rebirthPick && st.class_id) {
      ($("cls-keep-btn") as HTMLElement).innerHTML = `保持 ${st.cls.icon} ${esc(st.cls.name)}`;
    }
    cs.classList.add("show");
  } else if (!wantCls && cs.classList.contains("show")) {
    cs.classList.remove("show");
  }

  // —— 转生确认弹窗(保留/重置清单;确认后进入择业)——
  $("rebirth-modal").classList.toggle("show", rebirthAsk);

  // —— 新手引导(3 步;新档选完职业弹出)——
  const im = $("intro-modal");
  const wantIntro = introStep !== null && introStep >= 1
    && introStep <= INTRO_STEPS.length && st.class_id !== null;
  im.classList.toggle("show", wantIntro);
  if (wantIntro) {
    const step = introStep!;
    const [ic, ti, ds] = INTRO_STEPS[step - 1];
    $("intro-dots").innerHTML = INTRO_STEPS.map((_, i) =>
      `<i class="${i < step ? "on" : ""}"></i>`).join("");
    $("intro-body").innerHTML =
      `<div class="intro-ic">${ic}</div><h2>${ti}</h2><p class="dim">${ds}</p>`;
    ($("intro-next") as HTMLElement).textContent =
      step >= INTRO_STEPS.length ? "开始冒险" : `下一步(${step}/${INTRO_STEPS.length})`;
  }

  const om = $("offline-modal");
  if (st.pending_offline && !offlineShown) {
    const r = st.pending_offline;
    const items = r.items.map(it =>
      `<span class="c-${it.rcolor}">${esc(it.name)}${it.plus ? " +" + it.plus : ""}</span>`).join("");
    $("offline-body").innerHTML =
      `<div class="off-row"><span>离开时长</span><b>${fmtTime(r.sec)}</b></div>` +
      `<div class="off-row"><span>击杀 / 死亡</span><b>${r.kills} / ${r.deaths}</b></div>` +
      `<div class="off-row"><span>金币</span><b>+${fmt(r.gold)}</b></div>` +
      `<div class="off-row"><span>经验</span><b>+${fmt(r.xp)}</b></div>` +
      `<div class="off-row"><span>升级 / 推进区域</span><b>+${r.levels} / +${r.zones}</b></div>` +
      (items ? `<div style="font-size:12px;color:var(--dim)">掉落(${r.items.length} 件)</div>` +
        `<div class="off-items">${items}</div>` : "");
    om.classList.add("show");
    offlineShown = true;
  } else if (!st.pending_offline && om.classList.contains("show")) {
    om.classList.remove("show");
    offlineShown = false;
  }

  const sm = $("swap-modal");
  if (st.pending_swap && !swapShown) {
    renderSwapModal(st.pending_swap);
    sm.classList.add("show");
    swapShown = true;
  } else if (!st.pending_swap && sm.classList.contains("show")) {
    sm.classList.remove("show");
    swapShown = false;
  }
}

/** 换装对比弹窗:左边当前件,右边新掉落;装备按评分、遗物按效果条数供玩家判断,
 *  并附「战力变化」——按实战折算(输出+生存+功能),比单件评分更能反映换装影响 */
function renderSwapModal(p: NonNullable<State["pending_swap"]>): void {
  const isItem = p.kind === "item";
  $("swap-title").textContent = isItem ? "⚔ 发现更强的装备" : "◆ 获得更强的遗物";
  $("swap-sub").textContent = isItem
    ? `自动换装已关闭 — 「${p.slot_name}」的新掉落更强,用哪个?`
    : `遗物槽已满 — 新遗物效果更多,要替换「${p.slot_name}」吗?`;
  const pd = p.power_delta;
  const powerLine = pd === null ? "" :
    `<div class="sw-pow">战力变化 ` +
    (pd >= 0
      ? `<span class="sw-up">+${fmt(pd)}</span>`
      : `<span style="color:#ff8a8a;font-weight:700">−${fmt(Math.abs(pd))}</span>`) +
    `</div>`;

  let cols: string;
  if (isItem) {
    const o = p.old_item, n = p.new_item;
    const itemCol = (it: ItemUI | null, tag: string, isNew: boolean) => {
      if (!it) {
        return `<div class="swap-col"><div class="sw-tag">${tag}</div>` +
          `<div class="nm eq-empty">— 空 —</div>` +
          `<div class="af" style="color:var(--dim)">当前部位没有装备</div>` +
          (isNew ? powerLine : "") + `</div>`;
      }
      const affixes = it.affixes.map(a =>
        `<div>◈ ${a.name} +${a.val}${a.pct ? "%" : ""}</div>`).join("");
      const innate = it.innate ? `<div>✦ ${it.innate.name} +${it.innate.val}</div>` : "";
      const delta = isNew && o ? Math.trunc(it.score - o.score) : 0;
      return `<div class="swap-col${isNew ? " new" : ""}"><div class="sw-tag">${tag}</div>` +
        `<div class="nm c-${it.rcolor}">${esc(it.name)}${it.plus ? ` +${it.plus}` : ""}</div>` +
        `<div class="sw-line">${it.slot_name} · ${it.rname} · Lv.${it.tier}</div>` +
        `<div class="af"><div>主属性 ${it.main.name} +${it.main.val}${it.main.pct ? "%" : ""}</div>${innate}${affixes}</div>` +
        `<div class="sw-score">评分 ${fmt(it.score)}` +
        (isNew && o ? ` <span class="sw-up">(新 ${delta >= 0 ? "+" : ""}${fmt(delta)})</span>` : "") +
        `</div>` + (isNew ? powerLine : "") + `</div>`;
    };
    cols = itemCol(o, "当前装备", false) + itemCol(n, "新掉落", true);
  } else {
    const o = p.old_relic, n = p.new_relic;
    const relicCol = (r: RelicUI | null, tag: string, isNew: boolean) => {
      if (!r) return `<div class="swap-col"><div class="sw-tag">${tag}</div>` +
        `<div class="nm eq-empty">— 空 —</div></div>`;
      const effs = r.effects
        .map(e => `<div>◈ ${e.name} +${e.unit === "级" ? Math.round(e.val) : pctTxt(e.val)}${e.unit}</div>`).join("");
      return `<div class="swap-col${isNew ? " new" : ""}"><div class="sw-tag">${tag}</div>` +
        `<div class="nm c-${r.rcolor}">${esc(r.name)}</div>` +
        `<div class="sw-line">${r.rname} · T${r.tier} · ${r.effects.length} 条效果</div>` +
        `<div class="af">${effs}</div>` + (isNew ? powerLine : "") + `</div>`;
    };
    cols = relicCol(o, "当前遗物", false) + relicCol(n, "新掉落", true);
  }
  $("swap-body").innerHTML = `<div class="swap-grid">${cols}</div>`;
}

// ---------------------------------------------------------------- 装备框详情 / 换装对比
type GearView = {
  mode: "slot" | "relic" | "cmp-item" | "cmp-relic";
  slot?: string;              // slot:装备部位
  idx?: number;               // relic:遗物槽位
  item?: Item;                // cmp-item:背包中的新装备(对象引用,防索引漂移)
  relic?: Relic;              // cmp-relic:背包中的新遗物
};
let gearView: GearView | null = null;
let gearDeltaCache: { src: object; delta: number } | null = null;

/** 装备详情单列(与换装对比同款卡片,含全部属性行) */
function gearItemCol(it: ItemUI, tag: string, extra = ""): string {
  const affixes = it.affixes.map(a =>
    `<div>◈ ${a.name} +${a.val}${a.pct ? "%" : ""}</div>`).join("");
  const innate = it.innate ? `<div>✦ ${it.innate.name} +${it.innate.val}%</div>` : "";
  return `<div class="swap-col${extra ? " " + extra : ""}">` +
    `<div class="sw-tag">${tag}</div>` +
    `<div class="nm c-${it.rcolor}">${esc(it.name)}${it.plus ? ` +${it.plus}` : ""}</div>` +
    `<div class="sw-line">${it.slot_name} · ${it.rname} · Lv.${it.tier}</div>` +
    `<div class="af"><div>主属性 ${it.main.name} +${it.main.val}${it.main.pct ? "%" : ""}</div>${innate}${affixes}</div>` +
    `<div class="sw-score">评分 ${fmt(it.score)} · 主属性+${pctTxt(it.pb)}</div>` +
    (extra === "new" ? "" : "") + `</div>`;
}

function gearRelicCol(r: RelicUI, tag: string, extra = ""): string {
  const effs = r.effects
    .map(e => `<div>◈ ${e.name} +${e.unit === "级" ? Math.round(e.val) : pctTxt(e.val)}${e.unit}</div>`).join("");
  return `<div class="swap-col${extra ? " " + extra : ""}">` +
    `<div class="sw-tag">${tag}</div>` +
    `<div class="nm c-${r.rcolor}">${esc(r.name)}</div>` +
    `<div class="sw-line">${r.rname} · T${r.tier} · ${r.effects.length} 条效果</div>` +
    `<div class="af">${effs}</div></div>`;
}

function powerDeltaLine(delta: number): string {
  return `<div class="sw-pow">战力变化 ` +
    (delta >= 0
      ? `<span class="sw-up">+${fmt(delta)}</span>`
      : `<span style="color:#ff8a8a;font-weight:700">−${fmt(Math.abs(delta))}</span>`) +
    `</div>`;
}

function renderGearModal(st: State): void {
  const m = $("gear-modal");
  if (!gearView || !st.class_id) { m.classList.remove("show"); return; }
  m.classList.add("show");
  const title = $("gear-title"), sub = $("gear-sub"), body = $("gear-body"), ops = $("gear-ops");
  const v = gearView;

  if (v.mode === "slot") {
    const s = v.slot!;
    const it = st.equip[s];
    title.textContent = `${slotName(s)} · 装备详情`;
    if (!it) {
      sub.textContent = "该部位尚未装备,击败怪物可获得掉落";
      body.innerHTML = `<div class="swap-grid"><div class="swap-col">` +
        `<div class="nm eq-empty">— 空 —</div></div></div>`;
      ops.innerHTML = "";
      return;
    }
    sub.textContent = "强化只提升主属性与固有;词缀靠洗练";
    body.innerHTML = `<div class="swap-grid">${gearItemCol(it, "当前装备")}</div>`;
    ops.innerHTML =
      `<button class="btn" data-cmd="enhance" data-a="${s}">强化 ◈${fmt(it.ecost)}</button>` +
      `<button class="btn" data-cmd="enhance_multi" data-a="${s}" title="连续强化10次(钱不够自动停)">⚒×10</button>` +
      `<button class="btn" data-cmd="reforge" data-a="${s}" title="按品质洗词条(幸运提升值域)">洗✦${st.reforge_stones}</button>` +
      `<button class="btn warn" data-cmd="unequip" data-a="${s}">卸下</button>`;
    return;
  }

  if (v.mode === "relic") {
    const r = st.relics[v.idx ?? 0];
    title.textContent = `遗物${(v.idx ?? 0) + 1} · 详情`;
    if (!r) {
      sub.textContent = "空槽:爬塔通关必得遗物,自动装入空槽";
      body.innerHTML = `<div class="swap-grid"><div class="swap-col">` +
        `<div class="nm eq-empty">— 空 —</div></div></div>`;
      ops.innerHTML = "";
      return;
    }
    sub.textContent = "遗物来自深渊塔,效果常驻生效";
    body.innerHTML = `<div class="swap-grid">${gearRelicCol(r, "当前遗物")}</div>`;
    ops.innerHTML = `<button class="btn warn" data-cmd="unequip_relic" data-a="${v.idx}">卸下</button>`;
    return;
  }

  if (v.mode === "cmp-item") {
    const newItem = v.item!;
    const live = g.bag.includes(newItem) ? newItem : null;   // 背包已变动(分解/售出)则失效
    if (!live) { gearView = null; m.classList.remove("show"); return; }
    const n = itemUI(live);
    const cur = st.equip[live.slot] ?? null;
    title.textContent = `⚔ 换装对比 · ${n.slot_name}`;
    sub.textContent = cur ? "对比当前装备与背包中的新装备,选择要用的" : "该部位为空,直接穿上";
    let delta: number;
    if (gearDeltaCache?.src === live) delta = gearDeltaCache.delta;
    else {
      const after = powerWithEquip(g, live.slot, live);
      delta = after.total - heroPower(g, false).total;
      gearDeltaCache = { src: live, delta };
    }
    const scoreLine = cur
      ? ` <span class="sw-up">(评分 ${Math.trunc(n.score - cur.score) >= 0 ? "+" : ""}${fmt(Math.trunc(n.score - cur.score))})</span>` : "";
    body.innerHTML = `<div class="swap-grid">` +
      (cur ? gearItemCol(cur, "当前装备") : `<div class="swap-col"><div class="sw-tag">当前装备</div><div class="nm eq-empty">— 空 —</div></div>`) +
      gearItemCol(n, "新的装备", "new") +
      `</div>` + powerDeltaLine(delta) +
      (cur ? `<div class="sw-score" style="text-align:center">新装备评分 ${fmt(n.score)}${scoreLine}</div>` : "");
    ops.innerHTML =
      `<button class="btn big sell-on" data-cmd="gear_take_item">✦ 换上新的</button>` +
      `<button class="btn big" data-cmd="gear_close">保留现在的</button>`;
    return;
  }

  // cmp-relic
  const newRelic = v.relic!;
  const liveIdx = g.relicBag.indexOf(newRelic);
  if (liveIdx < 0) { gearView = null; m.classList.remove("show"); return; }
  const n = relicUI(newRelic);
  let target = g.relics.findIndex(r => !r);
  if (target < 0) {
    let worstN = 99;
    g.relics.forEach((r, i) => {
      if (r && r.effects.length < worstN) { worstN = r.effects.length; target = i; }
    });
  }
  const cur = st.relics[target] ?? null;
  title.textContent = `◆ 装遗物对比 · 目标槽 遗物${target + 1}`;
  sub.textContent = cur
    ? "遗物槽全满:将替换效果最少的一件(旧件回到背包)"
    : `装入空槽 遗物${target + 1}`;
  let delta: number;
  if (gearDeltaCache?.src === newRelic) delta = gearDeltaCache.delta;
  else {
    const after = powerWithRelic(g, target, newRelic);
    delta = after.total - heroPower(g, false).total;
    gearDeltaCache = { src: newRelic, delta };
  }
  body.innerHTML = `<div class="swap-grid">` +
    (cur ? gearRelicCol(cur, "当前遗物") : `<div class="swap-col"><div class="sw-tag">当前遗物</div><div class="nm eq-empty">— 空 —</div></div>`) +
    gearRelicCol(n, "新的遗物", "new") +
    `</div>` + powerDeltaLine(delta);
  ops.innerHTML =
    `<button class="btn big sell-on" data-cmd="gear_take_relic">✦ 装上新的</button>` +
    `<button class="btn big" data-cmd="gear_close">保留现在的</button>`;
}

// ---------------------------------------------------------------- 交互
let paused = false;

/** 塔排行祭坛三个动态 tab:设置已移至顶栏齿轮,注入锚点改为链式(悬赏→塔→排行→祭坛)。 */
function ensureTowerDom(): void {
  if (document.querySelector('.nav-item[data-tab="tower"]')) return;
  const questNav = document.querySelector('.nav-item[data-tab="quest"]');
  const towerNav = document.createElement("div");
  towerNav.className = "nav-item";
  towerNav.dataset.tab = "tower";
  towerNav.innerHTML = `<span class="ic">🗼</span><span class="tx">塔</span><span class="kbd">6</span>`;
  questNav?.after(towerNav);
  const pageQuest = document.getElementById("page-quest");
  const towerPage = document.createElement("div");
  towerPage.className = "page";
  towerPage.id = "page-tower";
  towerPage.innerHTML = `<div class="card grow" id="tower-panel"></div>`;
  pageQuest?.after(towerPage);
}

function switchTab(name: string): void {
  curTab = name;
  document.querySelectorAll<HTMLElement>(".nav-item").forEach(n =>
    n.classList.toggle("on", n.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".page").forEach(p =>
    p.classList.toggle("on", p.id === "page-" + name));
  if (name === "leaderboard") void lbEnter();   // 进入排行榜页:拉榜 + 按需提交
}

document.addEventListener("click", (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.id === "gear-btn") { switchTab("settings"); return; }
  const nav = target.closest(".nav-item");
  if (nav) {
    switchTab((nav as HTMLElement).dataset.tab ?? curTab);
    return;
  }
  const gearEl = target.closest<HTMLElement>("[data-gear]");
  if (gearEl) {
    const [kind, val] = (gearEl.dataset.gear ?? "").split(":");
    gearView = kind === "slot" ? { mode: "slot", slot: val } : { mode: "relic", idx: Number(val) };
    renderNow();
    return;
  }
  const el = target.closest<HTMLElement>("[data-cmd]");
  if (el) { doCmd(el.dataset.cmd!, el.dataset.a ?? null, el.dataset.b ?? null); renderNow(); return; }
  const loc = target.closest<HTMLElement>("[data-local]");
  if (loc) localCmd(loc.dataset.local!);
});

function localCmd(name: string): void {
  if (name === "save") { g.save(); toast("已存档到浏览器"); cloudPushDebounced(); }
  else if (name === "pause") togglePause();
  else if (name === "export") {
    const blob = new Blob([JSON.stringify(g.toDict())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "abyss-idle-save.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("存档已导出");
  } else if (name === "import") ($("file-input") as HTMLInputElement).click();
  else if (name === "sfx") toggleSfx();
  else if (name === "bgm") toggleBgm();
  else if (name === "reset") {
    if (confirm("确定清空浏览器存档并重新开始?")) { doCmd("reset"); renderNow(); }
  }
}
// 总音量滑条:input 事件委托(设置页每次渲染重建 DOM,不能绑在元素上)
document.addEventListener("input", (e: Event) => {
  const el = (e.target as HTMLElement).closest<HTMLInputElement>("[data-vol]");
  if (el) setMasterVol(Number(el.value));
});
$("file-input").addEventListener("change", (e: Event) => {
  const input = e.target as HTMLInputElement;
  const f = input.files && input.files[0];
  if (!f) return;
  void f.text().then(txt => {
    try {
      const d = migrateSave(JSON.parse(txt) as Record<string, unknown>);
      g = Game.fromDict(d as Record<string, never>);
      g.save();
      g.toast(`导入成功:Lv.${g.level} 第${g.zone}区·${g.stage}层`);
    } catch { toast("导入失败,格式不正确"); }
    renderNow();
  });
  input.value = "";
});

function togglePause(): void {
  paused = !paused;
  document.body.classList.toggle("paused", paused);
  $("pause-btn").textContent = paused ? "继续" : "暂停";
  toast(paused ? "已暂停(游戏时钟冻结)" : "继续");
}
document.addEventListener("keydown", (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  if (t.tagName === "SELECT" || t.tagName === "INPUT") return;
  // ESC:关闭弹窗(换装对比/装备详情/转生确认与择业/新手引导)
  if (e.key === "Escape") {
    if (rebirthAsk) { rebirthAsk = false; renderNow(); return; }
    if (rebirthPick) { rebirthPick = false; renderNow(); return; }
    if (introStep !== null) { introStep = null; renderNow(); return; }
    const swapOpen = document.querySelector("#swap-modal")?.classList.contains("show");
    if (swapOpen) { g.resolveSwap(false); renderNow(); return; }
    if (document.querySelector("#gear-modal")?.classList.contains("show")) {
      gearView = null; renderNow(); return;
    }
  }
  const tabs = ["battle", "hero", "bag", "skill", "quest", "tower",
                 "leaderboard", "altar", "settings"];
  const idx = e.key >= "1" && e.key <= "9" ? +e.key - 1 : -1;
  if (idx >= 0) {
    const item = document.querySelector(`.nav-item[data-tab="${tabs[idx]}"]`) as HTMLElement | null;
    if (item) item.click();
    else if (tabs[idx]) switchTab(tabs[idx]);   // 设置无导航项(顶栏齿轮):直接切页
  } else if (e.key === "f" || e.key === "F") { doCmd("mode"); renderNow(); }
  else if (e.key === "b" || e.key === "B") { doCmd("speed"); renderNow(); }
  else if (e.key === "j" || e.key === "J") { doCmd("cycle_sell"); renderNow(); }
  else if (e.key === "p" || e.key === "P") togglePause();
  else if (e.key === "s" || e.key === "S") localCmd("save");
  else if (e.key === "m" || e.key === "M") { toggleSfx(); renderNow(); }
});

// ---------------------------------------------------------------- 启动
// ---------------------------------------------------------------- 云账号
let loginOpen = false;
function showLoginModal(): void {
  if (!cloudState.ready) { toast("云功能未配置(见 cloud.config.ts)"); return; }
  if (cloudState.user) return;
  loginOpen = true;
  ($("login-err") as HTMLElement).textContent = "";
  ($("login-email") as HTMLInputElement).value = "";
  ($("login-pass") as HTMLInputElement).value = "";
  $("login-modal").classList.add("show");
}
function hideLoginModal(): void {
  loginOpen = false;
  $("login-modal").classList.remove("show");
}

function setupLoginModal(): void {
  $("login-close").addEventListener("click", hideLoginModal);
  $("login-go").addEventListener("click", async () => {
    const email = ($("login-email") as HTMLInputElement).value.trim();
    const pass = ($("login-pass") as HTMLInputElement).value;
    if (!email || pass.length < 6) {
      ($("login-err") as HTMLElement).textContent = "请输入邮箱与至少 6 位密码";
      return;
    }
    const m = await ensureCloud();
    const err = m ? await m.signInEmail(email, pass) : "云功能未配置";
    if (err) { ($("login-err") as HTMLElement).textContent = err; return; }
    hideLoginModal();
  });
  $("login-reg").addEventListener("click", async () => {
    const email = ($("login-email") as HTMLInputElement).value.trim();
    const pass = ($("login-pass") as HTMLInputElement).value;
    if (!email || pass.length < 6) {
      ($("login-err") as HTMLElement).textContent = "请输入邮箱与至少 6 位密码";
      return;
    }
    const m = await ensureCloud();
    const err = m ? await m.signUpEmail(email, pass) : "云功能未配置";
    if (err) { ($("login-err") as HTMLElement).textContent = err; return; }
    // 项目关闭邮箱验证时直接进入会话;开启验证则提示查收邮件
    ($("login-err") as HTMLElement).textContent = cloudState.user
      ? "" : "注册成功:请到邮箱完成验证后再登录";
    if (cloudState.user) hideLoginModal();
  });
  $("login-gh").addEventListener("click", async () => {
    const m = await ensureCloud();
    const err = m ? await m.signInGitHub() : "云功能未配置";
    if (err) ($("login-err") as HTMLElement).textContent = err;
  });
}

/** 登录瞬间:拉云端比对 last_saved,新者胜(覆盖前确认,不自动合并) */
async function syncOnLogin(): Promise<void> {
  if (!cloudState.ready || !cloudState.user) return;
  const m = await ensureCloud();
  if (!m) return;
  const remote = await m.pullSave();
  if (typeof remote === "string") { toast("☁ 云存档拉取失败:" + remote); return; }
  const localRaw = localStorage.getItem(SAVE_KEY);
  const localLast = localRaw ? Number(JSON.parse(localRaw).last_saved ?? 0) : 0;
  const ts = (s: number) => new Date(s * 1000).toLocaleString();
  if (!remote) {
    if (!localRaw || !g.classId) { toast("☁ 已登录;开始冒险后自动上云"); return; }
    const err = await m.pushSave(g.toDict());
    toast(err ? "☁ 云上传失败:" + err : "☁ 云存档已创建");
    return;
  }
  const remoteLast = Number(remote.data.last_saved ?? 0);
  if (Math.abs(remoteLast - localLast) < 5) { toast("☁ 云端与本地一致"); return; }
  if (remoteLast > localLast &&
      confirm(`云端存档较新(${ts(remoteLast)})\n本地存档(${ts(localLast)})\n\n下载云端覆盖本地?` +
        `\n(取消 = 保留本地,稍后自动上传覆盖云端)`)) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(remote.data));
    location.reload();
    return;
  }
  const err2 = await m.pushSave(g.toDict());
  toast(err2 ? "☁ 云上传失败:" + err2 : "☁ 本地存档已上传云端");
}

let cloudPushTimer: ReturnType<typeof setTimeout> | undefined;
/** 跟随 autosave 的 debounce 上传(30s 合并写;未登录/未配置时 no-op) */
function cloudPushDebounced(): void {
  if (!cloudState.ready || !cloudState.user) return;
  if (cloudPushTimer !== undefined) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(async () => {
    cloudPushTimer = undefined;
    const m = await ensureCloud();
    if (!m) return;
    const err = await m.pushSave(g.toDict());
    if (err) toast("☁ 云同步失败:" + err);
  }, 30_000);
}

// ================================================================ 排行榜(匿名,无需登录)
// 主线榜(最远区域)+ 等级榜;服务端只存 Top50,落榜即删,不在榜返回估算名次。
// API:workers/leaderboard(Cloudflare Workers + D1),未配置 URL 时本页显示引导。
// 排行榜端点:默认 Cloudflare Worker(海外/HTTPS 网页版);
// 国内/TapTap APK 构建时注入 ECS 地址:VITE_LB_API=http://<IP>:8787 npx vite build
// (HTTPS 页面不能拉 http 接口——混合内容限制;APK 内 native WebView 无此限制)
const LEADERBOARD_API: string = (import.meta as unknown as {
  env?: Record<string, string | undefined> }).env?.VITE_LB_API
  ?? "https://abyss-leaderboard.a-red6108.workers.dev";
/** dev 构建标志:vite dev server 为 true,任何 vite build(含 taptap mode)为 false。
 *  数值覆盖键仅 dev 读取(boot),线上/TapTap 构建不认——防排行榜作弊面。
 *  用裸 import.meta.env.DEV(非类型断言形式)保证 vite define 精确替换。 */
const IS_DEV: boolean = import.meta.env.DEV;
const LB_BOARDS: Array<"zone" | "level" | "tower" | "power"> = ["zone", "level", "tower", "power"];
const LB_BOARD_NAMES: Record<"zone" | "level" | "tower" | "power", string> =
  { zone: "主线榜 · 最远区域", level: "等级榜", tower: "爬塔榜 · 深渊塔",
    power: "战力榜 · 综合强度" };

interface LbRow { name: string; score: number; kills: number; playtime: number;
                  level: number; max_zone: number; updated_at: number; is_me?: boolean }
interface LbData { board: string; top: LbRow[]; you: { rank: number; inTop: boolean;
                  score: number; kills: number } | null }

let lbBoard: "zone" | "level" | "tower" | "power" = "zone";
const lbData: Partial<Record<"zone" | "level" | "tower" | "power", LbData>> = {};
const lbErr: Partial<Record<"zone" | "level" | "tower" | "power", string>> = {};
let lbSubmitErr: string | null = null;  // 最近一次提交错误:常驻显示,不靠一闪而过的 toast
let lbBusy = false;
let lbEditing = false;        // 昵称编辑中:暂停本页重建,避免输入被打断

function lbUuid(): string {
  let u = localStorage.getItem("abyss_uuid") ?? "";
  if (!/^[a-zA-Z0-9_-]{8,40}$/.test(u)) {
    u = ((window.crypto && (window.crypto as Crypto).randomUUID)
      ? (window.crypto as Crypto).randomUUID!().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24);
    localStorage.setItem("abyss_uuid", u);
  }
  return u;
}
function lbMyName(): string {
  return localStorage.getItem("abyss_lbname") ?? `深渊行者#${lbUuid().slice(0, 4).toUpperCase()}`;
}

function ensureAltarDom(): void {
  if (document.querySelector('.nav-item[data-tab="altar"]')) return;
  const lbNav = document.querySelector('.nav-item[data-tab="leaderboard"]');
  const nav = document.createElement("div");
  nav.className = "nav-item";
  nav.dataset.tab = "altar";
  nav.innerHTML = `<span class="ic">🕯</span><span class="tx">祭坛</span><span class="kbd">8</span>`;
  lbNav?.after(nav);
  const pageLb = document.getElementById("page-leaderboard");
  const page = document.createElement("div");
  page.className = "page";
  page.id = "page-altar";
  page.innerHTML = `<div class="card" id="potions-card"></div>
                    <div class="card grow" id="altar-list"></div>`;
  pageLb?.after(page);
}

// ================================================================ 深渊祭坛(金币→永久属性)+ 药剂
function renderAltar(st: State): void {
  const potCard = $("potions-card"), list = $("altar-list");
  if (!potCard || !list) return;
  if (!st.class_id) { potCard.innerHTML = ""; list.innerHTML = ""; return; }

  // —— 药剂(30 分钟增益;显示价格与生效剩余)
  const buffName = (b: string) => b === "atk" ? "攻击" : b === "xp" ? "经验" : "金币";
  potCard.innerHTML =
    `<h3><span class="dot"></span>临时药剂 · 30 分钟</h3>` +
    `<div class="potion-row">` + st.potions.map(p =>
      `<button class="potion-btn" data-cmd="potion" data-a="${p.id}">
        <span class="ic">${p.icon}</span>
        <span class="nm">${p.name}</span>
        <span class="ds">${buffName(p.buff)} +${p.pct}%${p.remain > 0 ? ` · 剩${Math.ceil(p.remain / 60)}分` : ""}</span>
        <span class="cost">◈${fmt(p.cost)}</span>
      </button>`).join("") + `</div>`;

  // —— 祭坛 6 线
  list.innerHTML =
    `<h3><span class="dot"></span>深渊祭坛 · 金币献祭换永久加成(费用随等级平方上涨,无上限)</h3>` +
    st.altar.map(l => {
      const cur = l.op === "pct"
        ? `${l.stat_name} +${l.bonus.toFixed(1)}%`
        : `${l.stat_name} +${l.bonus.toFixed(1)}`;
      const next = l.op === "pct" ? `+${l.per}%` : `+${l.per}`;
      return `<div class="altar-row">
        <span class="ic">${l.icon}</span>
        <span class="nm">${l.name}</span>
        <span class="lv">Lv.${l.lv}</span>
        <span class="cur">${cur}</span>
        <span class="nx">(下一级 ${next})</span>
        <button class="btn mini" data-cmd="altar_up" data-a="${l.id}">献祭 ◈${fmt(l.cost)}</button>` +
        `<button class="btn mini" data-cmd="altar_up_multi" data-a="${l.id}" title="连续献祭10次(金币不够自动停)">献祭×10</button>` +
      `</div>`;
    }).join("");
}

function ensureLeaderboardDom(): void {
  if (document.querySelector('.nav-item[data-tab="leaderboard"]')) return;
  const towerNav = document.querySelector('.nav-item[data-tab="tower"]');
  const nav = document.createElement("div");
  nav.className = "nav-item";
  nav.dataset.tab = "leaderboard";
  nav.innerHTML = `<span class="ic">🏆</span><span class="tx">排行</span><span class="kbd">7</span>`;
  towerNav?.after(nav);
  const pageTower = document.getElementById("page-tower");
  const page = document.createElement("div");
  page.className = "page";
  page.id = "page-leaderboard";
  page.innerHTML = `<div class="card" id="lb-mine"></div>
                    <div class="card grow" id="lb-list"></div>`;
  pageTower?.after(page);
}

async function lbFetch(board: "zone" | "level" | "tower" | "power"): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${LEADERBOARD_API}/board?b=${board}&uuid=${encodeURIComponent(lbUuid())}`,
      { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return lbFail(board, `HTTP ${r.status}`);
    const d = (await r.json()) as LbData & { error?: string };
    if (d.error) return lbFail(board, d.error);
    lbData[board] = d;
    delete lbErr[board];
    return null;
  } catch { return lbFail(board, "网络错误"); }
}

/** 拉榜失败:记到常驻错误态(UI 显示失败原因 + 重试按钮,不再永远「加载中」) */
function lbFail(board: "zone" | "level" | "tower" | "power", msg: string): string {
  lbErr[board] = msg;
  return msg;
}

/** 提交各榜(匿名 UUID,四榜并行);成功后刷新数据。返回错误文本或 null。 */
async function lbSubmit(): Promise<string | null> {
  if (!LEADERBOARD_API) return "未配置";
  if (lbBusy) return null;
  lbBusy = true;
  try {
    const meta = { kills: g.stats.kills, playtime: Math.trunc(g.playtime),
                   level: g.level, max_zone: g.stats.max_zone,
                   max_tower: g.tower.max_floor };
    const basePower = heroPower(g, false).total;   // 排行榜口径:不含临时 buff
    // 四榜并行提交:最坏耗时 = 单榜超时 8s(串行曾是 4×8s)
    const errs = await Promise.all(LB_BOARDS.map(async b => {
      if (b === "tower" && meta.max_tower < 1) return null;   // 未通塔层不上塔榜
      const score = b === "zone" ? meta.max_zone
                  : b === "tower" ? meta.max_tower
                  : b === "power" ? basePower : meta.level;
      const body = JSON.stringify({
        board: b, uuid: lbUuid(), name: lbMyName(), score, ...meta,
      });
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(`${LEADERBOARD_API}/submit`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body, signal: ctl.signal });
        clearTimeout(t);
        const d = await r.json() as { error?: string; rank?: number };
        return d.error ?? null;
      } catch { return "网络错误"; }
    }));
    const err = errs.find(e => e) ?? null;
    if (err) return err;
    localStorage.setItem("abyss_lblast", String(Date.now()));
    await Promise.all([lbFetch("zone"), lbFetch("level"), lbFetch("power")]);
    return null;
  } catch { return "网络错误"; }
  finally { lbBusy = false; }
}

// ================================================================ 存档周期上云(匿名 save-sync)
// 每 10 分钟随自动存档节流上传整份存档 + 关页 sendBeacon 兜底;仅生产构建(线上/
// TapTap)——dev 会话不上传,避免污染远端数据。监控型上行:失败静默,不影响游戏。
// 收集范围与用途见 docs/privacy-policy.md(TapTap 隐私声明);服务端限流+语义包络。
let lastSyncPush = 0;
const SAVE_SYNC_MS = 10 * 60_000;
function saveSyncPush(beacon = false): void {
  if (IS_DEV || !LEADERBOARD_API || g.classId === null) return;   // dev/未开局不传
  const payload = JSON.stringify({ uuid: lbUuid(), name: lbMyName(), save: g.toDict() });
  lastSyncPush = Date.now();
  if (beacon && navigator.sendBeacon) {
    // text/plain:sendBeacon 走 no-cors,非简单 Content-Type 会预检失败;服务端不校验头
    navigator.sendBeacon(`${LEADERBOARD_API}/save-sync`,
      new Blob([payload], { type: "text/plain" }));
    return;
  }
  void fetch(`${LEADERBOARD_API}/save-sync`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
  }).catch(() => { /* 监控型上行:失败不打扰玩家 */ });
}

function renderLeaderboard(st: State): void {
  const mine = $("lb-mine"), list = $("lb-list");
  if (!mine || !list) return;
  if (!st.class_id) {
    // 无职业档:给出明确引导而不是静默空白(排行榜所有内容都依赖职业)
    mine.innerHTML = "";
    list.innerHTML =
      `<div style="color:var(--dim);padding:34px 10px;text-align:center;line-height:2">
       ⚔ 还没有选择职业<br>
       <span style="font-size:12px">选择职业后即可查看排行榜与提交上榜</span></div>`;
    return;
  }
  if (lbEditing) return;                     // 昵称编辑中不重建(防输入被打断)

  if (!LEADERBOARD_API) {
    mine.innerHTML = `<h3><span class="dot"></span>🏆 排行榜</h3>`;
    list.innerHTML = `<div style="color:var(--dim);padding:34px 10px;text-align:center;line-height:2">
      排行榜服务未配置<br>
      <span style="font-size:12px">部署 workers/leaderboard 后,将其地址填入<br>
      main.ts 的 LEADERBOARD_API 即可启用(匿名上榜,无需登录)</span></div>`;
    return;
  }

  const lastSub = Number(localStorage.getItem("abyss_lblast") ?? 0);
  const cooldown = Math.max(0, 10 * 60_000 - (Date.now() - lastSub));
  const d = lbData[lbBoard];
  const you = d?.you ?? null;

  // —— 我的卡:昵称 + 提交 + 我的排名
  const myScore = lbBoard === "zone" ? st.stats.max_zone
                : lbBoard === "tower" ? st.tower.max_floor
                : lbBoard === "power" ? (st.power ? heroPower(g, false).total : 0)
                : st.level;
  const myLabel = lbBoard === "zone" ? "当前最远区域"
                : lbBoard === "tower" ? (st.tower.max_floor > 0 ? "塔层" : "塔层(未挑战)")
                : lbBoard === "power" ? "当前战力(不含增益)"
                : "等级";
  const youLine = you
    ? (you.inTop
        ? `<span class="lb-rank-badge in">🏆 第 ${you.rank} 名</span>`
        : `<span class="lb-rank-badge">我的排名:约 #${you.rank}</span>`)
    : `<span class="lb-rank-badge off">未上榜 · 提交后显示估算名次</span>`;
  mine.innerHTML =
    `<h3><span class="dot"></span>🏆 排行榜 · ${lbMyName()}
      <span class="rt">
        <button class="btn mini" data-lb="rename">改名</button>
        <button class="btn mini" data-lb="submit">${lbBusy ? "提交中…" :
          cooldown > 0 ? `刷新(${Math.ceil(cooldown / 60_000)}分)` : "提交上榜"}</button>
      </span></h3>
    <div class="lb-me-row">
      <div><span class="k">${myLabel}</span>
        <b>${lbBoard === "power" ? fmt(myScore) : myScore}</b>
        <span class="k" style="margin-left:12px">击杀</span><b>${fmt(st.stats.kills)}</b></div>
      ${youLine}
    </div>` +
    (lbSubmitErr
      ? `<div class="lb-err">⚠ 上次提交失败:${esc(lbSubmitErr)} — 点「${cooldown > 0 ? "刷新" : "提交上榜"}」重试</div>`
      : "");

  // —— 榜单
  const segs = LB_BOARDS.map(b =>
    `<button class="btn mini ${b === lbBoard ? "on" : ""}" data-lb="board" data-a="${b}">${LB_BOARD_NAMES[b]}</button>`).join("");
  let rows = "";
  if (d) {
    rows = d.top.map((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      const sub = lbBoard === "zone"
        ? `Lv.${r.level} · 击杀 ${fmt(r.kills)}`
        : lbBoard === "tower"
        ? `${r.max_zone} 区 · Lv.${r.level}`
        : lbBoard === "power"
        ? `Lv.${r.level} · ${r.max_zone} 区 · 击杀 ${fmt(r.kills)}`
        : `${r.max_zone} 区 · 击杀 ${fmt(r.kills)}`;
      return `<div class="lb-row${r.is_me ? " me" : ""}">
        <span class="lb-no">${medal}</span>
        <span class="lb-name">${esc(r.name)}</span>
        <span class="lb-sub">${sub}</span>
        <b class="lb-score">${lbBoard === "power" ? fmt(r.score) : r.score}</b></div>`;
    }).join("");
    if (!rows) rows = `<div style="color:var(--dim);padding:26px;text-align:center">虚位以待——成为第一个上榜的深渊行者</div>`;
  } else if (lbErr[lbBoard]) {
    // 拉取失败:明确展示失败原因与重试入口,不再永远「加载中…」
    rows = `<div class="lb-fail">⚠ ${LB_BOARD_NAMES[lbBoard]}加载失败:${esc(lbErr[lbBoard]!)}` +
      `<br><button class="btn mini" data-lb="retry">重试</button></div>`;
  } else {
    rows = `<div style="color:var(--dim);padding:26px;text-align:center">加载中…</div>`;
  }
  list.innerHTML =
    `<h3><span class="dot"></span>${LB_BOARD_NAMES[lbBoard]}
      <span class="rt">${segs}</span></h3>${rows}
    <p style="color:var(--dim);font-size:11.5px;margin-top:10px">
      匿名提交(设备标识,无需登录);仅保留每榜前 50 名,落榜数据不保留。</p>`;
}

/** 进入排行榜页时自动拉取/按需提交(10 分钟节流) */
async function lbEnter(): Promise<void> {
  if (!LEADERBOARD_API) return;
  await lbFetch(lbBoard);
  const lastSub = Number(localStorage.getItem("abyss_lblast") ?? 0);
  if (Date.now() - lastSub > 10 * 60_000) {
    const err = await lbSubmit();
    lbSubmitErr = err && err !== "未配置" ? err : null;
    if (err && err !== "未配置" && err !== "rate limited") toast("排行榜提交失败:" + err);
    else if (err === "rate limited") toast("排行榜:提交太频繁,稍后再试");
  }
  if (!document.hidden) renderNow();
}

document.addEventListener("click", (e: MouseEvent) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-lb]");
  if (!el) return;
  const act = el.dataset.lb;
  if (act === "board") {
    lbBoard = (el.dataset.a === "level" ? "level" : el.dataset.a === "tower" ? "tower"
      : el.dataset.a === "power" ? "power" : "zone");
    void lbFetch(lbBoard).then(() => renderNow());
    renderNow();
  } else if (act === "retry") {
    void lbFetch(lbBoard).then(() => renderNow());
    renderNow();
  } else if (act === "submit") {
    void lbSubmit().then(err => {
      lbSubmitErr = err && err !== "未配置" ? err : null;
      if (err) toast(err === "rate limited" ? "提交太频繁,稍后再试" : "提交失败:" + err);
      else toast("已提交,排名已更新");
      renderNow();
    });
    renderNow();
  } else if (act === "rename") {
    lbEditing = true;
    const card = $("lb-mine");
    card.innerHTML = `<h3><span class="dot"></span>🏆 排行榜 · 修改昵称</h3>
      <div class="lb-me-row">
        <input id="lb-name-input" class="lb-input" maxlength="12" placeholder="昵称(≤12字)"
          value="${esc(localStorage.getItem("abyss_lbname") ?? "")}">
        <button class="btn mini" data-lb="rename-save">保存</button>
        <button class="btn mini" data-lb="rename-cancel">取消</button>
      </div>
      <p style="color:var(--dim);font-size:11.5px;margin-top:8px">留空则使用默认名;敏感词会被替换。</p>`;
    const input = document.getElementById("lb-name-input") as HTMLInputElement | null;
    input?.focus();
  } else if (act === "rename-save") {
    const input = document.getElementById("lb-name-input") as HTMLInputElement | null;
    if (input) localStorage.setItem("abyss_lbname", input.value.trim().slice(0, 12));
    lbEditing = false;
    renderNow();
  } else if (act === "rename-cancel") {
    lbEditing = false;
    renderNow();
  }
});
// 切到排行榜页时触发拉取(委托里 nav 分支之后仍会冒泡到这里?不会——nav 分支 return 了)
// 改在 switchTab 钩子:见下方对 switchTab 的包装。

function boot(): void {
  // 数值覆盖(管理面板写、游戏页只读,docs/admin-panel.md §4.4/§7.E):读 localStorage
  // 覆盖键,值 = serializeOverrideFile 输出原文(完整文件 JSON),用 parseOverrideFile
  // 解析后在一切游戏状态构造之前应用;失败仅 console.warn,按默认数值运行。
  // 仅 dev 构建读取:线上/TapTap 构建不认该键,堵"改 localStorage 即改数值"
  // 的排行榜作弊面(docs/admin-panel.md §10 R9)。
  if (IS_DEV) {
    try {
      const t = localStorage.getItem(OVR_KEY);
      if (t) {
        const r = applyOverrides(parseOverrideFile(t));
        if (r.applied.length) console.info(`[overrides] 已应用 ${r.applied.length} 项数值覆盖`);
        if (r.rejected.length) console.warn("[overrides] 已拒绝:", r.rejected);
      }
    } catch (err) {
      console.warn("[overrides] 覆盖加载失败,按默认数值运行:", err);
    }
  }
  installSaveHooks({
    write: (game) => localStorage.setItem(SAVE_KEY, JSON.stringify(game.toDict())),
    readRaw: () => localStorage.getItem(SAVE_KEY),
  });
  g = Game.load();   // 读档(含离线结算)或开新档

  // —— 面板热通道(仅 dev;storage 事件只在其他同源标签页写入时触发,正好是面板写)——
  // A 覆盖热生效:面板「保存覆盖」→ 实时应用(英雄侧字段下次 recalcHero 生效,怪物/
  //   技能参数下次生成/施放生效,docs/admin-panel.md §4.4);键被删除 → 恢复默认数值。
  // B 存档热重载:面板「写入本浏览器存档」→ 下一拍安全重载(面板写、游戏页自己读,
  //   不存在"写完被 10s 自动存档覆盖"的竞态)。
  if (IS_DEV) {
    let hotReloading = false;
    window.addEventListener("storage", (ev) => {
      if (ev.storageArea !== localStorage) return;
      if (ev.key === OVR_KEY) {
        try {
          if (ev.newValue === null) {
            resetOverrides();
            g.recalcHero();
            toast("数值已恢复默认");
          } else {
            const r = applyOverrides(parseOverrideFile(ev.newValue));
            g.recalcHero();
            toast(`已热应用 ${r.applied.length} 项数值覆盖` +
                  (r.rejected.length ? `(拒绝 ${r.rejected.length} 项)` : ""));
          }
        } catch (err) {
          console.warn("[overrides] 热应用失败,保持当前数值:", err);
        }
        return;
      }
      if (ev.key === SAVE_KEY && !hotReloading) {
        hotReloading = true;
        setTimeout(() => {
          hotReloading = false;
          try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return;
            g = Game.fromDict(migrateSave(JSON.parse(raw)));
            g.recalcHero();
            renderNow();
            toast("已热重载面板写入的存档");
          } catch (err) {
            console.warn("[save] 热重载失败,保持当前状态:", err);
          }
        }, 200);
      }
    });
  }
  g.towerRefreshKeys();   // 每日钥匙刷新(登录时一次)

  ensureTowerDom();   // 注入第 8 个「塔」tab 与页面容器
  ensureLeaderboardDom();   // 注入第 9 个「排行」tab 与页面容器
  ensureAltarDom();          // 注入第 10 个「祭坛」tab 与页面容器
  $("loading").classList.add("hide");
  renderNow();

  // 云账号:恢复会话 + 登录时同步;状态变化即时刷新设置页(未配置时全部 no-op)
  setupLoginModal();
  // 换装对比弹窗逃生通道:✕ 与点遮罩 = 稍后处理(物品留在背包),不再整屏锁死
  $("swap-close").addEventListener("click", () => { g.resolveSwap(false); renderNow(); });
  $("swap-modal").addEventListener("click", (e: Event) => {
    if (e.target === e.currentTarget) { g.resolveSwap(false); renderNow(); }
  });
  $("gear-modal").addEventListener("click", (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.id === "gear-close" || t.id === "gear-modal") { gearView = null; renderNow(); }
  });
  // 启动:仅当本机存有 Supabase 会话令牌(sb- 前缀,登录过)才加载 SDK 恢复会话;
  // 游客(绝大多数)首屏不为 ~200KB 的 SDK 买单。点登录时由 ensureCloud 按需加载。
  if (CLOUD_READY && Object.keys(localStorage).some(k => k.startsWith("sb-")))
    void ensureCloud().then(m => { if (m) void m.initCloud(syncOnLogin); });

  // 主循环:setInterval 驱动 0.1s 固定步进(与 CLI 一致)。
  // 页面隐藏时不步进(定时器被节流),回切时用 resolve() 懒结算补算。
  let last = performance.now();
  let hiddenAt = 0;
  setInterval(() => {
    if (paused || document.hidden) { last = performance.now(); return; }
    const now = performance.now();
    let acc = (now - last) / 1000;
    last = now;
    if (acc > 1) acc = 1;
    let steps = 0;
    while (acc >= TICK && steps < MAX_STEPS) {
      g.tick(TICK);
      acc -= TICK;
      steps += 1;
    }
    drainEvents();
  }, 100);
  setInterval(() => { if (!document.hidden) renderNow(); }, RENDER_MS);
  setInterval(() => { if (!document.hidden) { g.save(); cloudPushDebounced();
    if (Date.now() - lastSyncPush >= SAVE_SYNC_MS) saveSyncPush(); } }, AUTOSAVE_MS);
  addEventListener("pagehide", () => { if (Date.now() - lastSyncPush >= 60_000) saveSyncPush(true); });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      g.save();
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();
      if (away >= RESOLVE_MIN_SEC) {
        const rep = systems.resolve(g, away);
        g.toast(`页面离开 ${Math.trunc(away / 60)} 分:补算 ${rep.kills} 击杀 +${rep.gold} 金币`);
      }
      g.save();
      renderNow();
    }
  });
  window.addEventListener("pagehide", () => g.save());

  // 英雄模型:一次性动画结束后清类,让待机呼吸动画恢复
  $("hero-art").addEventListener("animationend", (e: AnimationEvent) => {
    if (e.animationName !== "hero-idle")
      $("hero-art").classList.remove("lunge", "crit", "skill", "hurt");
  });
  if (!HERO_MODEL) ($("hero-art") as HTMLElement).style.display = "none";

  // 调试钩子:__abyss.state() 验证推进;fx("warrior") 演示普攻特效与音效;
  // skillfx("m_meteor") 演示任意技能的粒子特效;sfxcast("w_exec") 演示技能音效;sfx() 查看音效状态;
  // lootbeam("epic") 演示掉落光柱
  (window as unknown as { __abyss?: { state(): string; fx(cls?: string, crit?: boolean): void;
                                         sfx(): string; skillfx(sid: string): void;
                                         sfxcast(sid: string): void;
                                         lootbeam(rarity: string): void;
                                         dbg(): string } }).__abyss = {
    state: () => `t=${g.time | 0}s Lv${g.level} ${g.zone}区 kills=${g.stats.kills}`,
    fx: (cls, crit) => { playAttackFx(cls, crit); playAttackHit(crit ?? false); },
    sfx: () => sfxDebug(),
    skillfx: (sid) => playSkillFx(sid),
    sfxcast: (sid) => playSkillCast(sid),
    lootbeam: (rarity) => playLootBeam(rarity),
    dbg: () => JSON.stringify({ auto_equip: g.settings.auto_equip,
      swap: g.pendingSwap ? `${g.pendingSwap.kind}:${g.pendingSwap.slot ?? g.pendingSwap.relicSlot}` : null,
      bagN: g.bag.length, equip: Object.keys(g.equip) }),
  };

  // PWA:注册 Service Worker(离线可玩/可安装)。
  // 路径跟随 vite base(本地 / 或 GitHub Pages 子路径);localhost 任意端口跳过
  // (vite dev 起在 8614 之外的端口也会命中,缓存优先会吞掉最新改动)。
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!isLocal && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(BASE_URL + "sw.js")
      .catch(() => { /* 离线壳降级:在线玩 */ });
  }
}

boot();
