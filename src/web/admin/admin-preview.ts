/// <reference lib="dom" />
/** 管理面板 · Tab3 效果预览。采样协议(docs/admin-panel.md §3 Tab3):
 *  reset → apply(被测 values) → 采样 → reset → 重新 apply(已保存覆盖),
 *  预览永不残留状态。同一采样函数跑两遍(默认值 vs 当前草稿),并排表格 +
 *  手写 SVG 双折线(无图表库依赖)。预览用 Game 不注入 saveHooks(save() no-op)。 */
import { applyOverrides, resetOverrides, type OverrideValues } from "../../core/overrides.ts";
import { Game } from "../../core/game.ts";
import { CLASSES } from "../../core/data.ts";
import { tierOf, mobGold, mobXp, spawnMonster } from "../../core/combat.ts";
import { towerMonster, towerGold } from "../../core/tower.ts";
import { PyRandom } from "../../core/rng.ts";
import { esc, fmt } from "./admin-dom.ts";
import { draftValues, savedValues } from "./admin-overrides.ts";

interface Row { x: number; label: string; vals: number[] }

type CurveId = "hero" | "xp" | "monster" | "tower";

const CURVES: { id: CurveId; name: string; metrics: string[]; note: string }[] = [
  { id: "hero", name: "英雄属性曲线(等级 1..N)", metrics: ["生命", "攻击", "防御"],
    note: "new Game(7) + 职业系数 + recalcHero()(无装备/无被动)" },
  { id: "xp", name: "升级经验曲线(xpReq)", metrics: ["升级经验"],
    note: "xp_req0 × level^xp_req_p,截断取整" },
  { id: "monster", name: "怪物曲线(区·层 → 属性/金币/经验)", metrics: ["生命", "攻击", "防御", "金币", "经验"],
    note: "spawnMonster 含随机怪选择与 power 系数(固定 PyRandom 种子的示例怪;第10层=头目)" },
  { id: "tower", name: "爬塔曲线(层 → 属性/金币)", metrics: ["生命", "攻击", "防御", "金币"],
    note: "towerMonster / towerGold(每 boss_every 层头目 ×3.0/×1.3)" },
];

let root: HTMLElement;
let resultBox: HTMLElement;
let curve: CurveId = "hero";
let metricIdx = 0;

export function initPreview(rootEl: HTMLElement): void {
  root = rootEl;
  rootEl.innerHTML = `
    <div class="card" id="pv-ctl"></div>
    <div class="card grow" style="overflow:auto" id="pv-out">
      <p class="muted small">选择曲线后点「生成对比」。采样协议:reset → apply(被测值) → 采样 → reset → 重新 apply(已保存覆盖),预览不残留状态。</p>
    </div>`;
  resultBox = rootEl.querySelector("#pv-out")!;
  renderCtl();
}

function renderCtl(): void {
  const ctl = root.querySelector("#pv-ctl")!;
  const clsOpts = Object.keys(CLASSES).map(k => `<option value="${esc(k)}"${k === curCls ? " selected" : ""}>${esc(k)} ${esc(CLASSES[k].name)}</option>`).join("");
  ctl.innerHTML = `
    <h3><span class="dot"></span>曲线与参数</h3>
    <div class="row">
      <select id="pv-curve">${CURVES.map(c => `<option value="${c.id}"${c.id === curve ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <span class="row small" id="pv-cls-box">职业 <select id="pv-cls">${clsOpts}</select></span>
      <span class="row small" id="pv-lv-box">最大等级 <input id="pv-maxlv" type="number" min="1" max="500" value="${maxLv}" style="width:70px"></span>
      <span class="row small" id="pv-zone-box" style="display:none">最大区 <input id="pv-maxzone" type="number" min="1" max="200" value="${maxZone}" style="width:70px">
        装备tier <input id="pv-geartier" type="number" min="0" value="${gearTier}" style="width:70px" title="等级压制:怪物tier-装备tier>100 起每差100全属性×2;留空=不压制"></span>
      <span class="row small" id="pv-floor-box" style="display:none">最大层 <input id="pv-maxfloor" type="number" min="1" max="2000" value="${maxFloor}" style="width:70px"></span>
      <button class="btn sell-on" id="pv-go">生成对比</button>
    </div>
    <p class="muted small" id="pv-note">${esc(CURVES.find(c => c.id === curve)!.note)}</p>`;
  const show = (id: string, on: boolean) => {
    const el = ctl.querySelector(id) as HTMLElement | null;
    if (el) el.style.display = on ? "" : "none";
  };
  show("#pv-cls-box", curve === "hero");
  show("#pv-lv-box", curve === "hero" || curve === "xp");
  show("#pv-zone-box", curve === "monster");
  show("#pv-floor-box", curve === "tower");
  ctl.querySelector("#pv-curve")!.addEventListener("change", ev => {
    curve = (ev.target as HTMLSelectElement).value as CurveId;
    metricIdx = 0;
    renderCtl();
  });
  const clsSel = ctl.querySelector("#pv-cls");
  if (clsSel) clsSel.addEventListener("change", ev => { curCls = (ev.target as HTMLSelectElement).value; });
  const bindNum = (id: string, set: (v: number) => void) => {
    const el = ctl.querySelector(id) as HTMLInputElement | null;
    if (el) el.addEventListener("change", () => {
      const v = Number(el.value);
      if (Number.isFinite(v) && v > 0) set(v);
      else el.value = "10";
    });
  };
  bindNum("#pv-maxlv", v => maxLv = Math.min(500, Math.trunc(v)));
  bindNum("#pv-maxzone", v => maxZone = Math.min(200, Math.trunc(v)));
  bindNum("#pv-maxfloor", v => maxFloor = Math.min(2000, Math.trunc(v)));
  const gt = ctl.querySelector("#pv-geartier") as HTMLInputElement | null;
  if (gt) gt.addEventListener("change", () => {
    gearTier = gt.value.trim() === "" ? null : (Number(gt.value) >= 0 ? Math.trunc(Number(gt.value)) : null);
    if (gearTier === null) gt.value = "";
  });
  ctl.querySelector("#pv-go")!.addEventListener("click", run);
}

let curCls = Object.keys(CLASSES)[0];
let maxLv = 60;
let maxZone = 8;
let maxFloor = 50;
let gearTier: number | null = null;

// ---------------------------------------------------------------- 协议
function runWith<T>(values: OverrideValues | null, fn: () => T): T {
  resetOverrides();
  if (values) applyOverrides(values);
  let out: T;
  try {
    out = fn();
  } finally {
    resetOverrides();
    applyOverrides(savedValues());     // 恢复成游戏当前会应用的已保存覆盖
  }
  return out;
}

// ---------------------------------------------------------------- 采样器
function sampleHero(): Row[] {
  const g = new Game(7);
  g.classId = curCls;
  const rows: Row[] = [];
  for (let lv = 1; lv <= maxLv; lv++) {
    g.level = lv;
    g.recalcHero();
    rows.push({ x: lv, label: `Lv.${lv}`, vals: [g.hero.max_hp, g.hero.atk, g.hero.def] });
  }
  return rows;
}

function sampleXp(): Row[] {
  const g = new Game(7);
  const rows: Row[] = [];
  for (let lv = 1; lv <= maxLv; lv++) {
    g.level = lv;
    rows.push({ x: lv, label: `Lv.${lv}`, vals: [g.xpReq()] });
  }
  return rows;
}

function sampleMonster(): Row[] {
  const rows: Row[] = [];
  for (let z = 1; z <= maxZone; z++) {
    for (let s = 1; s <= 10; s++) {
      const rng = new PyRandom(9000 + z * 16 + s);
      const m = spawnMonster(z, s, rng, gearTier ?? undefined);
      const t = tierOf(z, s);
      rows.push({ x: t, label: `${z}区${s}层`, vals: [m.maxHp, m.atk, m.def_, mobGold(t), mobXp(t)] });
    }
  }
  return rows;
}

function sampleTower(): Row[] {
  const rows: Row[] = [];
  for (let f = 1; f <= maxFloor; f++) {
    const m = towerMonster(f, new PyRandom(7000 + f));
    rows.push({ x: f, label: `${f}层${m.boss ? "(头目)" : ""}`, vals: [m.maxHp, m.atk, m.def_, towerGold(f)] });
  }
  return rows;
}

// ---------------------------------------------------------------- 渲染
function run(): void {
  const meta = CURVES.find(c => c.id === curve)!;
  const sampler = curve === "hero" ? sampleHero : curve === "xp" ? sampleXp
    : curve === "monster" ? sampleMonster : sampleTower;
  const def = runWith(null, sampler);
  const cur = runWith(draftValues(), sampler);
  if (metricIdx >= meta.metrics.length) metricIdx = 0;

  const tbl = `<table class="cmp"><tr><th>${curve === "monster" ? "tier" : curve === "tower" ? "层" : "等级"}</th>
    <th>点位</th>${meta.metrics.map((m, i) => `<th>${esc(m)}${i === metricIdx ? " ◆" : ""}<br><span style="font-weight:400">默认 | 草稿</span></th>`).join("")}</tr>` +
    def.map((r, i) => `<tr><td>${r.x}</td><td>${esc(r.label)}</td>${meta.metrics.map((_, j) =>
      `<td>${fmt(r.vals[j])} | ${fmt(cur[i]?.vals[j] ?? NaN)}</td>`).join("")}</tr>`).join("") + "</table>";

  resultBox.innerHTML = `
    <h3><span class="dot"></span>${esc(meta.name)} — 默认 vs 草稿
      <span class="badge">草稿 ${Object.keys(draftValues()).length} 项</span></h3>
    <p class="muted small">${esc(meta.note)}</p>
    <div class="row">
      <span class="small muted">折线指标:</span>
      <select id="pv-metric">${meta.metrics.map((m, i) => `<option value="${i}"${i === metricIdx ? " selected" : ""}>${esc(m)}</option>`).join("")}</select>
    </div>
    <div class="svg-wrap">${lineChart(def, cur, metricIdx, meta.metrics[metricIdx])}</div>
    <div class="legend"><span><i style="background:#7a7a8c"></i>默认值</span><span><i style="background:#ff6b6b"></i>当前草稿</span></div>
    <div style="margin-top:10px">${tbl}</div>`;
  resultBox.querySelector("#pv-metric")!.addEventListener("change", ev => {
    metricIdx = Number((ev.target as HTMLSelectElement).value);
    run();
  });
}

/** 手写 SVG 双折线(无依赖);x 按行序等距,y 自适应全序列范围 */
function lineChart(def: Row[], cur: Row[], mi: number, title: string): string {
  const W = 880, H = 300, PL = 70, PR = 16, PT = 26, PB = 34;
  const iw = W - PL - PR, ih = H - PT - PB;
  const n = Math.max(def.length, 1);
  let lo = Infinity, hi = -Infinity;
  for (const r of def) { lo = Math.min(lo, r.vals[mi]); hi = Math.max(hi, r.vals[mi]); }
  for (const r of cur) { lo = Math.min(lo, r.vals[mi]); hi = Math.max(hi, r.vals[mi]); }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi === lo) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const X = (i: number) => PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v: number) => PT + ih - ((v - lo) / (hi - lo)) * ih;
  const poly = (rows: Row[]) => rows.map((r, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(r.vals[mi]).toFixed(1)}`).join(" ");
  const ticks = 4;
  let g = "";
  for (let t = 0; t <= ticks; t++) {
    const v = lo + (hi - lo) * t / ticks;
    const y = Y(v).toFixed(1);
    g += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#26263a" stroke-width="1"/>` +
      `<text x="${PL - 6}" y="${+y + 4}" text-anchor="end" font-size="11" fill="#7a7a8c">${fmt(v)}</text>`;
  }
  const xt = Math.min(6, n);
  for (let t = 0; t < xt; t++) {
    const i = Math.round((n - 1) * t / (xt - 1 || 1));
    g += `<text x="${X(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#7a7a8c">${def[i]?.x ?? ""}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img">
    <text x="${PL}" y="16" font-size="12" fill="#c8c8d0">${esc(title)}</text>
    ${g}
    <path d="${poly(def)}" fill="none" stroke="#7a7a8c" stroke-width="1.6"/>
    <path d="${poly(cur)}" fill="none" stroke="#ff6b6b" stroke-width="1.6"/>
  </svg>`;
}
