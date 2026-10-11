/** 伤害统计面板(实时 DPS 表)数据层:解析核心 "dmg" 事件流并聚合。
 *
 * 纯表现层模块 —— 不 import Game、不碰存档;main.ts 在 drainEvents 里喂数据。
 * 事件契约见 Game.dmg():text = "src[!] value"(src 尾缀 ! = 本次暴击)。
 * 时间轴用游戏秒(g.time):×2/×3 提速下与面板理论 DPS 同口径,可比。
 *
 * 两层统计:
 * - 实时:近 WINDOW 秒滚动窗口(DPS / 承伤 / 输出构成占比);
 * - 累计:自面板重置以来的会话总量(总输出/承伤/治疗、实测暴击率、最高单击)。
 */
import { fmt, fmtTime } from "../core/ansi.ts";
import { ACTIVE_SKILLS } from "../core/data.ts";

const WINDOW = 10;    // 实时窗口(游戏秒)
const KEEP = 60;      // 样本保留(游戏秒):窗口外多留一段,重开面板仍有数据
const MIN_SPAN = 3;   // 统计初期防尖峰:DPS 分母下限

/** 非技能来源的固定显示名;技能来源(id 形如 w_exec)查 ACTIVE_SKILLS */
const SRC_NAMES: Record<string, string> = {
  atk: "⚔ 普攻",
  crit_extra: "⚡ 暴击追击",
  dot: "🔥 持续伤害",
  mob: "☠ 怪物普攻",
  mskill: "☄ 怪物技能",
  absorb: "🛡 护盾吸收",
  heal: "✚ 治疗",
};
const TAKEN = new Set(["mob", "mskill"]);             // 承伤侧(不计入输出)
const SUSTAIN = new Set(["heal", "absorb"]);          // 生存侧
/** 掷暴击判定的输出来源(dot/追击不掷,不计入实测暴击率) */
const NO_CRIT_ROLL = new Set(["crit_extra", "dot"]);

const SKILL_META = new Map(ACTIVE_SKILLS.map(s => [s.id, s] as const));

interface Sample { t: number; s: string; v: number }
interface Agg { tot: number; hits: number; crits: number; max: number }

export class DpsMeter {
  private samples: Sample[] = [];
  private agg: Record<string, Agg> = {};
  private t0 = 0;
  private lastT = -1;

  /** 喂一条 dmg 事件;t = 事件批次的游戏时间(drainEvents 时刻) */
  record(raw: string, t: number): void {
    const sp = raw.lastIndexOf(" ");
    if (sp < 0) return;
    const srcPart = raw.slice(0, sp);
    const v = +raw.slice(sp + 1);
    if (!Number.isFinite(v)) return;
    const crit = srcPart.endsWith("!");
    const src = crit ? srcPart.slice(0, -1) : srcPart;
    if (this.lastT < 0) this.t0 = t;
    this.lastT = t;
    this.samples.push({ t, s: src, v });
    while (this.samples.length && t - this.samples[0].t > KEEP) this.samples.shift();
    const a = this.agg[src] ?? (this.agg[src] = { tot: 0, hits: 0, crits: 0, max: 0 });
    a.tot += v;
    if (v > a.max) a.max = v;
    if (!TAKEN.has(src) && !SUSTAIN.has(src) && !NO_CRIT_ROLL.has(src)) {
      a.hits += 1;
      if (crit) a.crits += 1;
    }
  }

  reset(): void {
    this.samples.length = 0;
    this.agg = {};
    this.t0 = 0;
    this.lastT = -1;
  }

  /** 面板主体 HTML(main.ts 在面板打开时每渲染帧调用) */
  html(): string {
    if (this.lastT < 0)
      return `<div class="dmg-empty">战斗开始后这里会出现实时统计</div>`;
    const now = this.lastT;
    const from = now - WINDOW;

    // 滚动窗口聚合(样本按时间递增,倒扫到窗口外即停)
    const win = new Map<string, number>();
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.t < from) break;
      win.set(s.s, (win.get(s.s) ?? 0) + s.v);
    }
    let dealt = 0, taken = 0, heal = 0, absorb = 0;
    for (const [s, v] of win) {
      if (TAKEN.has(s)) taken += v;
      else if (s === "heal") heal += v;
      else if (s === "absorb") absorb += v;
      else dealt += v;
    }
    const span = Math.min(WINDOW, Math.max(MIN_SPAN, now - this.t0));
    const dps = dealt / span;

    // 输出构成:按窗口伤害降序;无输出时留提示
    const rows = [...win.entries()]
      .filter(([s, v]) => !TAKEN.has(s) && !SUSTAIN.has(s) && v > 0)
      .sort((a, b) => b[1] - a[1]);
    let rowsHtml = "";
    for (const [s, v] of rows) {
      const a = this.agg[s];
      const critPct = a && a.hits ? (a.crits / a.hits * 100).toFixed(1) : null;
      const tip = `命中 ${a?.hits ?? 0}` + (critPct === null ? "" : ` · 暴击 ${critPct}%`)
        + ` · 单次最高 ${fmt(a?.max ?? v)}`;
      rowsHtml +=
        `<div class="drow" title="${tip}"><span class="nm">${srcLabel(s)}</span>` +
        `<div class="dbar"><i style="width:${dealt > 0 ? Math.max(2, v / dealt * 100) : 0}%"></i></div>` +
        `<span class="ps">${fmt(v / span)}/s</span>` +
        `<b class="sh">${dealt > 0 ? (v / dealt * 100).toFixed(0) : 0}%</b></div>`;
    }
    if (!rowsHtml) rowsHtml = `<div class="dmg-empty">近 ${WINDOW} 秒没有输出</div>`;

    // 累计
    let cDealt = 0, cTaken = 0, cHeal = 0, cAbsorb = 0, hits = 0, crits = 0;
    let maxHit = 0, maxSrc = "";
    for (const [s, a] of Object.entries(this.agg)) {
      if (TAKEN.has(s)) cTaken += a.tot;
      else if (s === "heal") cHeal += a.tot;
      else if (s === "absorb") cAbsorb += a.tot;
      else {
        cDealt += a.tot;
        if (a.max > maxHit) { maxHit = a.max; maxSrc = s; }
      }
      hits += a.hits; crits += a.crits;
    }

    return (
      `<div class="dps-hero"><span class="k">输出 DPS · 近${WINDOW}秒</span>` +
      `<b>${fmt(dps)}</b></div>` +
      `<div class="dmg-sub"><span>承伤 <b>${fmt(taken / span)}</b>/s</span>` +
      `<span>治疗 <b>${fmt(heal / span)}</b>/s</span>` +
      (absorb > 0 ? `<span>护盾吸收 <b>${fmt(absorb / span)}</b>/s</span>` : "") + `</div>` +

      `<div class="dmg-sec">输出构成 · 近${WINDOW}秒</div>${rowsHtml}` +

      `<div class="dmg-sec">累计 · ${fmtTime(Math.max(0, now - this.t0))}</div>` +
      `<div class="stat-grid">` +
        kv("总输出", fmt(cDealt)) + kv("总承伤", fmt(cTaken)) +
        kv("总治疗", fmt(cHeal)) + kv("护盾吸收", fmt(cAbsorb)) +
        kv("实测暴击", hits ? (crits / hits * 100).toFixed(1) + "%" : "—") +
        kv("最高单击", maxHit ? fmt(maxHit) : "—") +
      `</div>` +
      (maxSrc ? `<div class="dmg-note">最高单击来源:${srcLabel(maxSrc)}</div>` : "")
    );
  }
}

/** 来源 → 展示名(技能带职业色;名字是静态数据,无需转义) */
function srcLabel(src: string): string {
  const fixed = SRC_NAMES[src];
  if (fixed) return fixed;
  const def = SKILL_META.get(src);
  return def ? `<span class="c-${def.color}">${def.icon} ${def.name}</span>` : src;
}

function kv(k: string, v: string): string {
  return `<div class="kv"><span class="k">${k}</span><b>${v}</b></div>`;
}
