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
  monster: { name: string; art: string[]; hp: number; max_hp: number; tier: number;
             boss: boolean; elite: boolean; atk: number; def: number; color: string } | null;
  buffs: { key: string; name: string; pct: number; remain: number }[];
  equip: Record<string, ItemUI>;
  bag: ItemUI[];
  bag_size: number;
  quests: { desc: string; progress: number; target: number; gold: number; stones: number }[];
  achievements: { id: string; name: string; val: number; tiers: number; total: number;
                  stat: string; per: number; bonus: number; next: number | null }[];
  loadout: { active: string[]; passive: string[] };
  loadout_slots: number; loadout_unlock: readonly number[];
  speed: number; max_speed: number; speed_unlock: readonly number[];
  skills: { active: SkillUI[]; passive: SkillUI[] };
  skill_cd: Record<string, number>;
  stats: Record<string, number>;
  settings: Record<string, unknown>;
  reforge_stones: number;
  pending_offline: { sec: number; kills: number; deaths: number; gold: number; xp: number;
                     levels: number; zones: number; items: ItemUI[] } | null;
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
    name: g.monster.name, art: g.monster.art, hp: g.monster.hp,
    max_hp: g.monster.maxHp, tier: g.monster.tier, boss: g.monster.boss,
    elite: g.monster.elite, atk: g.monster.atk, def: g.monster.def_,
    color: g.monster.color,
  } : null;

  const skills = g.classId ? {
    active: D.ACTIVE_SKILLS.filter(s => s.cls === g.classId).map(s => skillUI(g, s)),
    passive: D.PASSIVE_SKILLS.filter(s => s.cls === g.classId).map(s => skillUI(g, s)),
  } : { active: [], passive: [] };

  const quests = g.quests.map(q => ({
    desc: systems.questDesc(q), progress: Math.min(q.progress, q.target),
    target: q.target, gold: q.gold, stones: q.stones,
  }));

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
    loadout: { active: [...g.loadout.active], passive: [...g.loadout.passive] },
    loadout_slots: g.loadoutSlots(),
    loadout_unlock: D.BAL.loadout_unlock,
    speed: g.settings.speed ?? 1, max_speed: g.maxSpeed(),
    speed_unlock: D.BAL.speed_unlock,
    skills, skill_cd: g.skillCd,
    stats: { ...g.stats }, settings: { ...g.settings },
    reforge_stones: D.BAL.reforge_stones,
    pending_offline: po,
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
    case "auto_equip":
      g.settings.auto_equip = !g.settings.auto_equip;
      g.toast(g.settings.auto_equip ? "自动换装:开" : "自动换装:关");
      break;
    case "auto_sell":
      g.settings.auto_sell_idx = Math.max(-1, Math.min(4, Number(a)));
      g.toast("掉落自动出售已更新");
      break;
    case "dismiss_offline": g.pendingOffline = null; break;
    case "reset":
      localStorage.removeItem(SAVE_KEY);
      g = new Game();
      break;
  }
}

// ---------------------------------------------------------------- 事件流
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LOG_CAP = 60;

function drainEvents(): void {
  if (!g.events.length) return;
  const evs = g.events.splice(0, g.events.length);
  const logs: string[] = [];
  for (const [kind, rawText, color] of evs) {
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
    }
  }
  if (logs.length) {
    const body = $("log-body");
    body.insertAdjacentHTML("beforeend", logs.join(""));
    while (body.children.length > LOG_CAP) body.removeChild(body.firstChild!);
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

// ---------------------------------------------------------------- 渲染
let curTab = "battle";
let offlineShown = false;

function renderNow(): void {
  const st = buildState(g);
  renderTop(st);
  renderBattle(st);
  renderHeroPage(st);
  renderBag(st);
  renderForge(st);
  renderSkills(st);
  renderQuest(st);
  renderSettings(st);
  renderOverlays(st);
}

function renderTop(st: State): void {
  const theme = st.zone_name + (st.zone_cycle ? `·深度${st.zone_cycle}` : "");
  $("zone-chip").innerHTML =
    `<span>第${st.zone}区 · ${st.stage}层</span>` +
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
      kv("暴伤", "+" + pctTxt(h.crit_dmg)) + kv("吸血", pctTxt(h.lifesteal)) +
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
    const tag = mon.boss ? `<span class="tag boss">头目</span>`
              : mon.elite ? `<span class="tag elite">精英</span>` : "";
    const hpPctM = Math.max(0, mon.hp / mon.max_hp * 100);
    inner =
      `<div class="mon-name c-${mon.color}">${esc(mon.name)}${tag}` +
        `<span class="tier">T${mon.tier}</span></div>` +
      `<div class="mon-art">${esc(mon.art.join("\n"))}</div>` +
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
  $("quests-mini").innerHTML = `<h3><span class="dot"></span>悬赏任务</h3>` + q;
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
        `<button class="btn mini" data-cmd="reforge" data-a="${s}">重铸 ✦${st.reforge_stones}</button>` +
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
      kv("全技能等级", "+" + (h.skill_lv ?? 0)) + kv("理论 DPS", fmt(h.dps)) +
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
        `<button class="btn" data-cmd="reforge" data-a="${s}">✦ 重铸(${st.reforge_stones}石)</button>` +
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

  const pool = (list: SkillUI[], which: "active" | "passive"): string => list.map(s =>
    `<div class="sk-card${s.unlocked ? "" : " locked"}">` +
    `<div class="sk-ic">${s.icon}</div>` +
    `<div class="sk-body"><div class="nm">${esc(s.name)}` +
      `<span class="lv">Lv.${s.eff}${s.eff > s.lv ? `(含装备+${s.eff - s.lv})` : ""}</span>` +
      (s.equipped ? `<span class="eq">✓已装配</span>` : "") + `</div>` +
      `<div class="ds">${esc(s.desc)}</div>` +
      `<div class="cd">解锁 Lv.${s.unlock}${s.cd ? ` · 冷却 ${s.cd}s` : ""}${s.unlocked ? "" : "(未解锁)"}</div></div>` +
    (s.unlocked
      ? `<div class="sk-ops"><div class="cost">升级 ◈${fmt(s.cost)}</div>` +
        `<button class="btn mini" data-cmd="skill_up" data-a="${s.id}">升级</button>` +
        (s.equipped
          ? `<button class="btn mini" data-cmd="unequip_skill" data-a="${s.id}">卸下</button>`
          : `<button class="btn mini" data-cmd="equip_skill" data-a="${s.id}" data-b="${which}">装配</button>`) +
        `</div>`
      : "") + `</div>`).join("");
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
  $("quest-list").innerHTML = `<h3><span class="dot"></span>悬赏任务(完成后自动刷新)</h3>` + qs;

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
function renderSettings(st: State): void {
  if (!st.class_id) { $("settings-panel").innerHTML = ""; return; }
  const autoSellIdx = Number(st.settings.auto_sell_idx ?? -1);
  let opts = "";
  for (let i = -1; i <= 4; i++)
    opts += `<option value="${i}"${autoSellIdx === i ? " selected" : ""}>${AUTO_SELL_NAMES[i + 1]}</option>`;
  const s = st.stats;
  $("settings-panel").innerHTML =
    `<h3><span class="dot"></span>设置</h3>` +
    `<div class="set-row"><div class="lbl">自动换装<div class="d">新掉落评分高于当前 5% 时自动穿上</div></div>` +
      `<div class="toggle${st.settings.auto_equip ? " on" : ""}" data-cmd="auto_equip"></div></div>` +
    `<div class="set-row"><div class="lbl">掉落自动出售<div class="d">低稀有度装备掉落即折现</div></div>` +
      `<select class="sel" data-sel="auto_sell">${opts}</select></div>` +
    `<div class="set-row"><div class="lbl">战斗模式<div class="d">推进:击败敌人深入;挂机:停留指定层</div></div>` +
      `<button class="btn" data-cmd="mode">${st.mode === "push" ? "切换为挂机" : "切换为推进"}</button></div>` +
    (st.mode === "farm"
      ? `<div class="set-row"><div class="lbl">挂机层位<div class="d">当前 ${st.farm_stage} 层</div></div>` +
        `<div style="display:flex;gap:6px"><button class="btn" data-cmd="farm_stage" data-a="-1">− 1 层</button>` +
        `<button class="btn" data-cmd="farm_stage" data-a="1">+ 1 层</button></div></div>`
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
    `<p style="color:var(--dim);font-size:12px;margin-top:14px">快捷键:1-7 切页 · F 推进/挂机 · P 暂停 · S 存档</p>`;
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
}

// ---------------------------------------------------------------- 交互
let paused = false;

document.addEventListener("click", (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const nav = target.closest(".nav-item");
  if (nav) {
    const item = nav as HTMLElement;
    curTab = item.dataset.tab ?? curTab;
    document.querySelectorAll<HTMLElement>(".nav-item").forEach(n =>
      n.classList.toggle("on", n === item));
    document.querySelectorAll<HTMLElement>(".page").forEach(p =>
      p.classList.toggle("on", p.id === "page-" + curTab));
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
document.addEventListener("change", (e: Event) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-sel]");
  if (sel) { doCmd("auto_sell", sel.value); renderNow(); }
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
  const tabs = ["battle", "hero", "bag", "forge", "skill", "quest", "settings"];
  if (e.key >= "1" && e.key <= "7") {
    const item = document.querySelector(`.nav-item[data-tab="${tabs[+e.key - 1]}"]`) as HTMLElement | null;
    if (item) item.click();
  } else if (e.key === "f" || e.key === "F") { doCmd("mode"); renderNow(); }
  else if (e.key === "b" || e.key === "B") { doCmd("speed"); renderNow(); }
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

  // 调试钩子:控制台 __abyss.state() 验证游戏推进
  (window as unknown as { __abyss?: { state(): string } }).__abyss = {
    state: () => `t=${g.time | 0}s Lv${g.level} ${g.zone}区 kills=${g.stats.kills}`,
  };

  // PWA:注册 Service Worker(离线可玩/可安装)。
  // 路径跟随 vite base(本地 / 或 GitHub Pages 子路径);dev(8614)跳过,
  // 避免缓存 vite 开发资产导致改动不生效。
  if (location.port !== "8614" && "serviceWorker" in navigator) {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
    navigator.serviceWorker.register(base + "sw.js")
      .catch(() => { /* 离线壳降级:在线玩 */ });
  }
}

boot();
