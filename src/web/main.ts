// 深渊挂机 · 现代 Web UI 宿主(TS 同构核心,无 Pyodide 秒开;桌面+手机自适应)。
// 与 CLI / web/legacy / web/app 共用同一核心规则与 localStorage 存档键。
// 结构:Game.load() → setInterval 0.1s 步进 → buildState() 快照渲染
//      + g.events 事件流(日志/飘字/toast/动画)→ doCmd() 指令分发。
/// <reference lib="dom" />

import { Game, installSaveHooks, migrateSave } from "../core/game.ts";
import * as D from "../core/data.ts";
import * as systems from "../core/systems.ts";
import { effLv, skillVal } from "../core/skills.ts";
import { plusBonus, Item, PCT_MAINS } from "../core/items.ts";
import type { Relic } from "../core/relics.ts";
import confetti from "canvas-confetti";

const SAVE_KEY = "abyss_save_v2";
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
  gold: number; stones: number; playtime: number; time: number;
  zone: number; stage: number; stage_kills: number; kills_per_stage: number;
  mode: string; farm_stage: number;
  zone_name: string; zone_boss: string; zone_cycle: number;
  respawn: number; ema_kill: number;
  hero: Record<string, number>;
  monster: { id: string; name: string; art: string[]; hp: number; max_hp: number; tier: number;
             boss: boolean; elite: boolean; atk: number; def: number; color: string;
             skill?: string } | null;
  buffs: { key: string; name: string; pct: number; remain: number }[];
  equip: Record<string, ItemUI>;
  bag: ItemUI[];
  bag_size: number;
  quests: { desc: string; progress: number; target: number; gold: number; stones: number }[];
  quest_daily_count: number; quest_daily_limit: number;
  achievements: { id: string; name: string; val: number; tiers: number; total: number;
                  stat: string; per: number; bonus: number; next: number | null }[];
  loadout: { active: string[]; passive: string[] };
  loadout_slots: number; loadout_unlock: readonly number[];
  speed: number; max_speed: number; speed_unlock: readonly number[];
  skills: { active: SkillUI[]; passive: SkillUI[] };
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
  } | null;
}

// ---------------------------------------------------------------- 快照构建
function itemUI(it: Item): ItemUI {
  const rid = D.RARITY_IDX[it.rarity];
  const rar = D.RARITIES[rid];
  const mstat = it.mainStat();
  const st = it.stats();
  const affixes = it.affixes.map(a => {
    const def = D.AFFIX_DEF[a.id];
    return { name: def.name, val: Math.round((st[a.id] ?? 0) * 10) / 10, pct: def.pct };
  });
  let innate: { name: string; val: number } | null = null;
  const inn = D.SLOT_INNATE[it.slot];
  if (inn) {
    innate = { name: D.STAT_NAMES[inn[0]],
               val: Math.round(inn[1] * rid * (1 + plusBonus(it.plus)) * 10) / 10 };
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

function buildState(g: Game): State {
  const h = g.hero;
  const cls = g.classId && D.CLASSES[g.classId]
    ? D.CLASSES[g.classId] : { name: "", icon: "", desc: "", color: "" };
  const theme = D.THEMES[(g.zone - 1) % D.THEMES.length];
  const cycle = Math.floor((g.zone - 1) / D.THEMES.length) + 1;

  let dps = g.theoreticalDps();
  if (!Number.isFinite(dps)) dps = 0;
  const hero: Record<string, number> = { ...(h as unknown as Record<string, number>), dps };

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
  } : null;

  return {
    class_id: g.classId, cls,
    level: g.level, xp: g.xp, xp_req: g.xpReq(),
    gold: g.gold, stones: g.stones, playtime: g.playtime, time: g.time,
    zone: g.zone, stage: g.stage, stage_kills: g.stageKills,
    kills_per_stage: D.BAL.kills_per_stage,
    mode: g.mode, farm_stage: g.farmStage,
    zone_name: theme.name, zone_boss: theme.boss,
    zone_cycle: g.zone > D.THEMES.length ? cycle : 0,
    respawn: g.respawnTimer, ema_kill: g.emaKill,
    hero, monster, buffs,
    equip: Object.fromEntries(Object.entries(g.equip).map(([k, v]) => [k, itemUI(v)])),
    bag: g.bag.map(itemUI),
    bag_size: D.BAL.bag_size,
    quests, achievements,
    quest_daily_count: questDaily.count, quest_daily_limit: questDaily.limit,
    loadout: { active: [...g.loadout.active], passive: [...g.loadout.passive] },
    loadout_slots: g.loadoutSlots(),
    loadout_unlock: D.BAL.loadout_unlock,
    speed: g.settings.speed ?? 1, max_speed: g.maxSpeed(),
    speed_unlock: D.BAL.speed_unlock,
    skills, skill_cd: g.skillCd,
    tower: { keys: g.tower.keys, max_floor: g.tower.max_floor },
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
    case "choose_class": if (a) g.chooseClass(a); break;
    case "mode": g.setMode(g.mode === "push" ? "farm" : "push"); break;
    case "speed": g.cycleSpeed(); break;
    case "farm_stage": g.setFarmStage(a === "1" ? 1 : -1); break;
    case "enhance": if (a) g.enhance(a); break;
    case "reforge": if (a) g.reforge(a); break;
    case "unequip": if (a) g.unequip(a); break;
    case "equip": { const i = Number(a); if (i >= 0 && i < g.bag.length) g.equipItem(g.bag[i]); break; }
    case "sell": g.sellItem(Number(a)); break;
    case "dismantle": g.dismantleItem(Number(a)); break;
    case "sell_junk": g.sellJunk(); break;
    case "equip_skill": if (a) g.equipSkill(a, (b ?? "active") as "active" | "passive"); break;
    case "unequip_skill": if (a) g.unequipSkill(a); break;
    case "skill_up": if (a) g.skillUp(a); break;
    case "tower_sel": {
      const dir = a === "1" ? 1 : -1;
      g.towerFloorSel = Math.max(1, Math.min(g.tower.max_floor + 1, g.towerFloorSel + dir));
      break;
    }
    case "tower_enter": {
      g.towerEnter(Number(a ?? g.towerFloorSel));
      if (g.inTower) switchTab("battle");   // 进塔后切回战斗页看战斗
      break;
    }
    case "tower_exit": g.towerExit(false); break;   // 撤退:视作战败,仅耗钥匙
    case "unequip_relic": g.unequipRelic(Number(a)); break;
    case "relic_equip": g.equipRelicFromBag(Number(a)); break;
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
    case "reset":
      localStorage.removeItem(SAVE_KEY);
      g = new Game();
      break;
  }
}

// ---------------------------------------------------------------- 音效
// 战斗音效(CC0 复古音效,出处与许可见 public/sfx/README.txt):
// 普攻命中 + 技能按类型分音(伤害按职业、增益/护盾/处决/多段连击各自专属)。
// WebAudio 解码一次缓存播放;音调微变防重复感;开关存 localStorage(不进核心存档)。
const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
const SFX_KEY = "abyss_sfx";
const SFX_FILES = ["attack-hit", "skill-heavy", "skill-magic", "skill-arrow",
                   "skill-burst", "skill-buff", "skill-shield", "skill-execute"] as const;
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
};
let sfxOn = localStorage.getItem(SFX_KEY) !== "0";
let sfxCtx: AudioContext | null = null;
const sfxBufs = new Map<SfxKey, AudioBuffer>();
const sfxLastMs = new Map<SfxKey, number>();
const sfxPlays = new Map<SfxKey, number>();
const SKILL_DEF = new Map(D.ACTIVE_SKILLS.map(s => [s.id, s]));

/** 页面加载即建 context 并预解码全部音效(suspended 态可解码),首次交互只需 resume */
function initSfx(): void {
  if (sfxCtx || !sfxOn) return;
  const AC = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  sfxCtx = new AC();
  for (const key of SFX_FILES) {
    fetch(`${BASE_URL}sfx/${key}.wav`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`sfx ${r.status}`))))
      .then(b => sfxCtx!.decodeAudioData(b))
      .then(buf => sfxBufs.set(key, buf))
      .catch(() => { /* 单个音效缺失静默降级,游戏照常 */ });
  }
}
function ensureSfx(): void {
  if (sfxOn && sfxCtx?.state === "suspended") void sfxCtx.resume();
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
  src.connect(gain).connect(ctx.destination);
  src.start();
  sfxPlays.set(key, (sfxPlays.get(key) ?? 0) + 1);
}
/** 普攻命中(hero_attack);暴击更亮更响 */
function playAttackHit(crit = false): void {
  if (crit) { playSfx("attack-hit", true); return; }
  playSfx("attack-hit");
}
/** 技能施放(cast:<id>):伤害按职业,其余按类型 */
function playSkillCast(skillId: string): void {
  const def = SKILL_DEF.get(skillId);
  if (!def) return;
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
  return `on=${sfxOn} ready=${ready}/${SFX_FILES.length} ctx=${sfxCtx?.state ?? "none"} [${plays}]`;
}

initSfx();
// 浏览器自动播放策略:首次交互解锁(选职业的点击必然先于战斗事件)。
for (const ev of ["pointerdown", "keydown"] as const)
  document.addEventListener(ev, ensureSfx, { once: true });

// ---------------------------------------------------------------- 事件流
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LOG_CAP = 60;

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
        playAttackFx(undefined, crit);
        playAttackHit(crit);
      } else if (text.startsWith("cast:")) {
        playSkillCast(text.slice(5));
        playSkillFx(text.slice(5));
      }
      // skill_hit:技能伤害命中,仅闪白+飘字(mob_flash 已覆盖)
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

/** 职业·战士/法师/射手的普攻形态;crit 时放大提亮。命中点取怪物中心(无怪时舞台中心)。 */
function playAttackFx(cls0?: string, crit = false): void {
  const stage = document.getElementById("stage");
  const layer = document.getElementById("fx-layer");
  if (!stage || !layer) return;
  const cls = cls0 ?? g.classId;
  if (!cls) return;
  const sr = stage.getBoundingClientRect();
  const art = stage.querySelector<HTMLElement>(".mon-art");
  let hx: number, hy: number;
  if (art) {
    const ar = art.getBoundingClientRect();
    hx = ar.left + ar.width / 2 - sr.left;
    hy = ar.top + ar.height / 2 - sr.top;
  } else {
    hx = sr.width / 2;
    hy = sr.height * 0.42;
  }
  const c = crit ? " crit" : "";
  if (cls === "warrior") {
    fxSpawn("fx-slash" + c, hx, hy,
      { "--r": `${Math.floor(Math.random() * 70 - 55)}deg` });
  } else if (cls === "mage") {
    const dy = Math.floor(Math.random() * 28 - 14);
    fxSpawn("fx-bolt" + c, -34, hy + dy, { "--x": `${hx + 34}px` });
    fxSpawn("fx-burst" + c, hx, hy + dy).style.animationDelay = "160ms";
  } else if (cls === "ranger") {
    const dy = Math.floor(Math.random() * 22 - 11);
    fxSpawn("fx-arrow" + c, -40, hy + dy, { "--x": `${hx + 40}px` });
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
  const n = fx.n ?? 26;
  const scalar = fx.scalar ?? 1;
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
      fire({ x: 0.05, y: mon.y }, 25, 26, 85, Math.round(n * 0.8));
      fire(mon, 90, 70, 40, Math.round(n * 0.4));
      break;
    case "zip":
      fire({ x: 0, y: mon.y }, 12, 14, 110, n);
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

// ---------------------------------------------------------------- 渲染
let curTab = "battle";
let offlineShown = false;
let swapShown = false;

function renderNow(): void {
  const st = buildState(g);
  renderTop(st);
  renderBattle(st);
  renderHeroPage(st);
  renderBag(st);
  renderForge(st);
  renderSkills(st);
  renderQuest(st);
  renderTower(st);
  renderSettings(st);
  renderOverlays(st);
}

function renderTop(st: State): void {
  const theme = st.zone_name + (st.zone_cycle ? `·深度${st.zone_cycle}` : "");
  $("zone-chip").innerHTML = st.in_tower
    ? `<span>深渊塔 · 第${st.tower_floor_sel}层</span>` +
      `<span class="theme" style="color:#e06bff">塔层挑战中</span>`
    : `<span>第${st.zone}区 · ${st.stage}层</span>` +
      `<span class="theme" style="color:var(--dim)">${esc(theme)}</span>`;
  const modeBtn = $("mode-btn") as HTMLButtonElement;
  modeBtn.textContent = st.mode === "push" ? "推进▶" : "挂机◎";
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

function kv(k: string, v: string): string {
  return `<div class="kv"><span class="k">${k}</span><b>${v}</b></div>`;
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
  const h = st.hero;
  const hpPct = Math.max(0, Math.min(100, h.hp / h.max_hp * 100));
  const shield = h.shield ?? 0;
  const buffs = st.buffs.map(b =>
    `<span class="buff">${esc(b.name)} +${pctTxt(b.pct)} ${b.remain}s</span>`).join("");
  $("hero-card").innerHTML =
    `<h3><span class="dot"></span>英雄 · ${esc(st.cls.name)}</h3>` +
    `<div class="bar hero-hp lg"><div class="fill" style="width:${hpPct}%"></div>` +
    (shield > 0 ? `<i class="shield-mark" style="left:${hpPct}%;width:${Math.min(100 - hpPct, shield / h.max_hp * 100)}%"></i>` : "") +
    `<div class="num">${fmt(h.hp)} / ${fmt(h.max_hp)}` +
      (shield > 0 ? ` (🛡${fmt(shield)})` : "") + `</div></div>` +
    `<div class="stat-grid" style="margin-top:9px">` +
      kv("攻击", fmt(h.atk)) + kv("防御", fmt(h.def)) +
      kv("攻速", "+" + pctTxt(h.haste)) + kv("暴击", pctTxt(h.crit)) +
      kv("暴伤", "+" + pctTxt(h.crit_dmg)) + kv("幸运", "+" + fmt(h.luck ?? 0)) +
      kv("吸血", pctTxt(h.lifesteal)) +
      kv("DPS", fmt(h.dps)) +
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
  let slots = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    if (!it) {
      slots += `<div class="slot-card"><div class="slot-l"><div class="sl">${slotName(s)}</div>` +
        `<div class="nm eq-empty">— 空 —</div></div>` +
        `<div class="slot-m" style="color:var(--dim)">尚未装备</div></div>`;
      continue;
    }
    slots +=
      `<div class="slot-card"><div class="slot-l"><div class="sl">${slotName(s)} · 评分 ${fmt(it.score)}</div>` +
        `<div class="nm c-${it.rcolor}">${esc(it.name)}</div>` +
        `<div class="sub">+${it.plus} · 全属性${pctTxt(it.pb)}</div></div>` +
      `<div class="slot-m"><div>${itemMainLine(it)}</div>` +
        `<div class="af">${esc(itemAffixLine(it) || "无词缀")}</div></div>` +
      `<div class="slot-r">` +
        `<button class="btn mini" data-cmd="enhance" data-a="${s}">强化 ◈${fmt(it.ecost)}</button>` +
        `<button class="btn mini" data-cmd="reforge" data-a="${s}" title="按品质洗词条">洗✦${st.reforge_stones}</button>` +
        `<button class="btn mini" data-cmd="unequip" data-a="${s}">卸下</button>` +
      `</div></div>`;
  }
  const xpPct = Math.min(100, st.xp / st.xp_req * 100);
  $("hero-detail").innerHTML =
    `<h3><span class="dot"></span>${st.cls.icon} ${esc(st.cls.name)} · Lv.${st.level}</h3>` +
    `<div style="color:var(--dim);font-size:12.5px;margin:-6px 0 10px">${esc(st.cls.desc)}</div>` +
    `<div class="bar xp lg" style="margin-bottom:12px"><div class="fill" style="width:${xpPct}%"></div>` +
      `<div class="num">经验 ${fmt(st.xp)} / ${fmt(st.xp_req)}</div></div>` +
    `<div class="stat-grid wide" style="margin-bottom:14px">` +
      kv("生命", fmt(h.max_hp)) + kv("攻击", fmt(h.atk)) + kv("防御", fmt(h.def)) +
      kv("攻速", "+" + pctTxt(h.haste)) + kv("暴击率", pctTxt(h.crit)) +
      kv("暴击伤害", "+" + pctTxt(h.crit_dmg)) + kv("吸血", pctTxt(h.lifesteal)) +
      kv("金币加成", pctTxt(h.goldfind)) + kv("闪避", pctTxt(h.dodge ?? 0)) +
      kv("无视防御", pctTxt(h.armor_pierce ?? 0)) + kv("技能伤害", "+" + pctTxt(h.skill_dmg ?? 0)) +
      kv("冷却缩减", pctTxt(h.cd_reduce ?? 0)) + kv("经验加成", "+" + pctTxt(h.xp_pct ?? 0)) +
      kv("全技能等级", "+" + numTxt(h.skill_lv ?? 0)) + kv("理论 DPS", fmt(h.dps)) +
    `</div>` + slots;
}

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
        `<button class="btn mini" data-cmd="equip" data-a="${i}">装备</button>` +
        `<button class="btn mini" data-cmd="dismantle" data-a="${i}">分解◈${fmt(it.dgold)}${it.dstones ? "✦" + it.dstones : ""}</button>` +
        `<button class="btn mini" data-cmd="sell" data-a="${i}">出售</button>` +
      `</div></div>`;
  });
  $("bag-list").innerHTML =
    `<h3><span class="dot"></span>背包 · ${st.bag.length} / ${st.bag_size}` +
    `<span class="rt"><button class="btn" data-cmd="sell_junk">一键出售 普通/精良</button></span></h3>` +
    (cards ? `<div class="bag-grid">${cards}</div>`
           : `<div style="color:var(--dim);padding:30px;text-align:center">背包空空如也</div>`);
}

function renderForge(st: State): void {
  if (!st.class_id) { $("forge-list").innerHTML = ""; return; }
  let rows = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    if (!it) {
      rows += `<div class="slot-card"><div class="slot-l"><div class="sl">${slotName(s)}</div>` +
        `<div class="nm eq-empty">— 空 —</div></div>` +
        `<div class="slot-m" style="color:var(--dim)">击败怪物以获取装备</div></div>`;
      continue;
    }
    rows +=
      `<div class="slot-card"><div class="slot-l"><div class="sl">${slotName(s)} · 评分 ${fmt(it.score)}</div>` +
        `<div class="nm c-${it.rcolor}">${esc(it.name)} <span style="color:#5adfff">+${it.plus}</span></div>` +
        `<div class="sub">当前全属性 +${pctTxt(it.pb)},下一级 +${pctTxt(it.pb_next)}</div></div>` +
      `<div class="slot-m"><div>${itemMainLine(it)}</div>` +
        `<div class="af">${esc(itemAffixLine(it) || "无词缀")}</div></div>` +
      `<div class="slot-r">` +
        `<div class="cost">◈${fmt(it.ecost)}</div>` +
        `<button class="btn" data-cmd="enhance" data-a="${s}">⚒ 强化</button>` +
        `<button class="btn" data-cmd="reforge" data-a="${s}" title="按品质洗词条(幸运提升值域)">✦ 洗练(${st.reforge_stones}石)</button>` +
      `</div></div>`;
  }
  $("forge-list").innerHTML =
    `<h3><span class="dot"></span>锻造 · 强化费用随层数与等级上涨(软上限)</h3>` + rows;
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
          ? `<div class="cost" style="color:var(--dim)">基础已满 Lv.${D.BAL.skill_lv_max}·装备加成仍生效</div>`
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
    `<h3><span class="dot"></span>悬赏任务(完成后自动刷新)· 今日 ${st.quest_daily_count}/${st.quest_daily_limit}</h3>` +
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
  const reach = tw.max_floor + 1;
  const sel = Math.max(1, Math.min(st.tower_floor_sel, reach));
  const boss = sel % D.TOWER.boss_every === 0;
  const p = Math.min(100, sel / reach * 100);
  const nRelics = st.relics.filter(Boolean).length;

  let html =
    `<h3><span class="dot"></span>深渊塔 · 钥匙 ×${tw.keys}(每日 ${D.TOWER.keys_per_day} 把)` +
      `<span class="rt" style="color:var(--dim)">最高 第${tw.max_floor}层</span></h3>` +
    `<div class="stage-lbl" style="margin:2px 0 8px;flex-wrap:wrap;gap:8px"><span>` +
      `<button class="btn mini" data-cmd="tower_sel" data-a="-1">−</button>` +
      `<span class="mono" style="font-size:16px;font-weight:800;margin:0 8px">第 ${sel} 层</span>` +
      (boss ? `<span style="color:var(--gold);font-weight:700">头目!</span>` : "") +
      `<button class="btn mini" data-cmd="tower_sel" data-a="1">+</button>` +
      `<span style="color:var(--dim);margin-left:10px">最高可达 第${reach}层 · 每${D.TOWER.boss_every}层头目(保底稀有)</span>` +
    `</span><span class="act">` +
      (st.in_tower
        ? `<span style="color:#ff9c9c;font-weight:700">挑战中 · 第${st.tower_floor_sel}层</span>` +
          `<button class="btn warn" data-cmd="tower_exit">撤退(钥匙已消耗)</button>`
        : `<button class="btn" data-cmd="tower_enter" data-a="${sel}">⚔ 进入第${sel}层(消耗1钥匙)</button>`) +
    `</span></div>` +
    `<div class="bar q lg"><div class="fill" style="width:${p}%"></div>` +
      `<div class="num">第1层 → 第${reach}层 · 选中 第${sel}层</div></div>` +
    `<h3 style="margin-top:16px"><span class="dot"></span>遗物 · ${nRelics}/4 槽(通关必得,空槽优先装满)</h3>`;

  st.relics.forEach((r, i) => {
    if (!r) {
      html += `<div class="slot-card"><div class="slot-l"><div class="sl">遗物${i + 1}</div>` +
        `<div class="nm eq-empty">— 空 —</div></div>` +
        `<div class="slot-m" style="color:var(--dim)">通关塔层掉落遗物,自动装入空槽</div></div>`;
      return;
    }
    const effs = r.effects
      .map(e => `◈ ${e.name} +${e.unit === "级" ? Math.round(e.val) : pctTxt(e.val)}${e.unit}`)
      .join(" &nbsp; ");
    html += `<div class="slot-card"><div class="slot-l"><div class="sl">遗物${i + 1} · ${r.rname} T${r.tier}</div>` +
      `<div class="nm c-${r.rcolor}">${esc(r.name)}</div></div>` +
      `<div class="slot-m"><div class="af">${effs}</div></div>` +
      `<div class="slot-r"><button class="btn mini" data-cmd="unequip_relic" data-a="${i}">卸下</button></div></div>`;
  });

  // ---- 遗物背包(满槽收纳 + 容量升级) ----
  const nBag = st.relic_bag.length;
  const bagFull = nBag >= st.relic_bag_cap;
  const slotsFull = st.relics.every(Boolean);
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
        `<div class="slot-r"><button class="btn mini" data-cmd="relic_equip" data-a="${i}"` +
        `${slotsFull ? ` disabled title="遗物槽已满,请先卸下"` : ""}>装备</button></div></div>`;
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
    `<div class="set-row"><div class="lbl">战斗模式<div class="d">推进:击败敌人深入;挂机:停留指定层</div></div>` +
      `<button class="btn" data-cmd="mode">${st.mode === "push" ? "切换为挂机" : "切换为推进"}</button></div>` +
    (st.mode === "farm"
      ? `<div class="set-row"><div class="lbl">挂机层位<div class="d">当前 ${st.farm_stage} 层</div></div>` +
        `<div style="display:flex;gap:6px"><button class="btn" data-cmd="farm_stage" data-a="-1">− 1 层</button>` +
        `<button class="btn" data-cmd="farm_stage" data-a="1">+ 1 层</button></div></div>`
      : "") +
    `<div class="set-row"><div class="lbl">音效<div class="d">普通攻击命中音(复古 8-bit,CC0)</div></div>` +
      `<div class="toggle${sfxOn ? " on" : ""}" data-local="sfx"></div></div>` +
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
    `<p style="color:var(--dim);font-size:12px;margin-top:14px">快捷键:1-8 切页 · F 推进/挂机 · P 暂停 · S 存档</p>`;
}

function renderOverlays(st: State): void {
  const cs = $("class-select");
  if (!st.class_id && !cs.classList.contains("show")) {
    const cl: [string, string, string, string, string][] = [
      ["warrior", "⚔", "战士", "钢铁与怒火:生存极强,越战越勇,斩杀收头", "生命×1.30 · 攻击×1.05 · 防御×1.35"],
      ["mage", "✦", "法师", "元素与毁灭:普攻平庸,技能伤害爆炸", "生命×1.05 · 攻击×1.10 · 防御×1.00"],
      ["ranger", "➤", "射手", "风与箭雨:攻速快、暴击高,连击风筝", "生命×0.95 · 攻击×0.95 · 防御×0.90 · 初始暴击5%"],
    ];
    $("cls-grid").innerHTML = cl.map(c =>
      `<div class="cls-card" data-cmd="choose_class" data-a="${c[0]}">` +
      `<div class="ic">${c[1]}</div><div class="nm">${c[2]}</div>` +
      `<div class="ds">${c[3]}</div><div class="bs">${c[4]}</div></div>`).join("");
    cs.classList.add("show");
  } else if (st.class_id && cs.classList.contains("show")) {
    cs.classList.remove("show");
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

/** 换装对比弹窗:左边当前件,右边新掉落;装备按评分、遗物按效果条数供玩家判断 */
function renderSwapModal(p: NonNullable<State["pending_swap"]>): void {
  const isItem = p.kind === "item";
  $("swap-title").textContent = isItem ? "⚔ 发现更强的装备" : "◆ 获得更强的遗物";
  $("swap-sub").textContent = isItem
    ? `自动换装已关闭 — 「${p.slot_name}」的新掉落更强,用哪个?`
    : `遗物槽已满 — 新遗物效果更多,要替换「${p.slot_name}」吗?`;

  let cols: string;
  if (isItem) {
    const o = p.old_item, n = p.new_item;
    const itemCol = (it: ItemUI | null, tag: string, isNew: boolean) => {
      if (!it) {
        return `<div class="swap-col"><div class="sw-tag">${tag}</div>` +
          `<div class="nm eq-empty">— 空 —</div>` +
          `<div class="af" style="color:var(--dim)">当前部位没有装备</div></div>`;
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
        `</div></div>`;
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
        `<div class="af">${effs}</div></div>`;
    };
    cols = relicCol(o, "当前遗物", false) + relicCol(n, "新掉落", true);
  }
  $("swap-body").innerHTML = `<div class="swap-grid">${cols}</div>`;
}

// ---------------------------------------------------------------- 交互
let paused = false;

/** 塔 tab 与页面容器:index.html 保持 7 tab 静态结构,这里动态补第 8 个。 */
function ensureTowerDom(): void {
  if (document.querySelector('.nav-item[data-tab="tower"]')) return;
  const settingsNav = document.querySelector('.nav-item[data-tab="settings"]');
  const towerNav = document.createElement("div");
  towerNav.className = "nav-item";
  towerNav.dataset.tab = "tower";
  towerNav.innerHTML = `<span class="ic">🗼</span><span class="tx">塔</span><span class="kbd">8</span>`;
  settingsNav?.before(towerNav);
  const pageSettings = document.getElementById("page-settings");
  const towerPage = document.createElement("div");
  towerPage.className = "page";
  towerPage.id = "page-tower";
  towerPage.innerHTML = `<div class="card grow" id="tower-panel"></div>`;
  pageSettings?.before(towerPage);
}

function switchTab(name: string): void {
  curTab = name;
  document.querySelectorAll<HTMLElement>(".nav-item").forEach(n =>
    n.classList.toggle("on", n.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".page").forEach(p =>
    p.classList.toggle("on", p.id === "page-" + name));
}

document.addEventListener("click", (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const nav = target.closest(".nav-item");
  if (nav) {
    switchTab((nav as HTMLElement).dataset.tab ?? curTab);
    return;
  }
  const el = target.closest<HTMLElement>("[data-cmd]");
  if (el) { doCmd(el.dataset.cmd!, el.dataset.a ?? null, el.dataset.b ?? null); renderNow(); return; }
  const loc = target.closest<HTMLElement>("[data-local]");
  if (loc) localCmd(loc.dataset.local!);
});

function localCmd(name: string): void {
  if (name === "save") { g.save(); toast("已存档到浏览器"); }
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
  else if (name === "reset") {
    if (confirm("确定清空浏览器存档并重新开始?")) { doCmd("reset"); renderNow(); }
  }
}
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
  const tabs = ["battle", "hero", "bag", "forge", "skill", "quest", "tower", "settings"];
  if (e.key >= "1" && e.key <= "8") {
    const item = document.querySelector(`.nav-item[data-tab="${tabs[+e.key - 1]}"]`) as HTMLElement | null;
    if (item) item.click();
  } else if (e.key === "f" || e.key === "F") { doCmd("mode"); renderNow(); }
  else if (e.key === "b" || e.key === "B") { doCmd("speed"); renderNow(); }
  else if (e.key === "j" || e.key === "J") { doCmd("cycle_sell"); renderNow(); }
  else if (e.key === "p" || e.key === "P") togglePause();
  else if (e.key === "s" || e.key === "S") localCmd("save");
});

// ---------------------------------------------------------------- 启动
function boot(): void {
  installSaveHooks({
    write: (game) => localStorage.setItem(SAVE_KEY, JSON.stringify(game.toDict())),
    readRaw: () => localStorage.getItem(SAVE_KEY),
  });
  g = Game.load();   // 读档(含离线结算)或开新档
  g.towerRefreshKeys();   // 每日钥匙刷新(登录时一次)

  ensureTowerDom();   // 注入第 8 个「塔」tab 与页面容器
  $("loading").classList.add("hide");
  renderNow();

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
  setInterval(() => { if (!document.hidden) g.save(); }, AUTOSAVE_MS);

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

  // 调试钩子:__abyss.state() 验证推进;fx("warrior") 演示普攻特效与音效;
  // skillfx("m_meteor") 演示任意技能的粒子特效;sfxcast("w_exec") 演示技能音效;sfx() 查看音效状态
  (window as unknown as { __abyss?: { state(): string; fx(cls?: string, crit?: boolean): void;
                                         sfx(): string; skillfx(sid: string): void;
                                         sfxcast(sid: string): void;
                                         dbg(): string } }).__abyss = {
    state: () => `t=${g.time | 0}s Lv${g.level} ${g.zone}区 kills=${g.stats.kills}`,
    fx: (cls, crit) => { playAttackFx(cls, crit); playAttackHit(crit ?? false); },
    sfx: () => sfxDebug(),
    skillfx: (sid) => playSkillFx(sid),
    sfxcast: (sid) => playSkillCast(sid),
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
