/** 异步切磋(2.7):阵容快照对战 —— 纯核心,无 DOM/网络,可回归。
 *
 * 玩家把裁剪阵容快照匿名上云(UI 层随 saveSyncPush 顺带 POST /arena/snapshot),
 * 拉取战力邻域对手(GET /arena/opponents)在本地模拟对战 —— 『打别人的 build』
 * 第一次成立,零实时零服务器算力。奖励刻意休闲化(仅称号,见 game.arenaResult):
 * 胜负是客户端本地结算,可伪造,信任模型与 power 榜同级 → 无 result 上报端点。
 *
 * 对战口径:逐 0.5s 回合 × 120 上限的期望对撞 —— 白字命中 atk²/(atk+def)
 * ×(1+skill_dmg/100) 走实战减伤式,装配主动技按 heroDps 覆盖率折算独立版
 * (lv=1 基础值查 ACTIVE_DEF:快照不存技能等级,装配差异仍真实影响胜负);
 * 被动技能不折算 —— 其数值加成已在快照面板值里(recalcHero 统一管道)。
 * 胜负术语统一:一方血空判负;120 回合未分:剩余血量百分比高者胜;
 * 恰好持平(含镜像对局 self vs self)判发起挑战方(攻方)胜 —— 自己挑战自己,判自己胜。
 */
import { ACTIVE_DEF, BAL, CLASSES, SUIT_DEF } from "./data.ts";
import { PyRandom } from "./rng.ts";
import type { Game } from "./game.ts";

/** 裁剪阵容快照:面板值 + 装配表 + 套装列表(序列化 <1KB,服务端浅校验不解释) */
export interface ArenaSquad {
  cls: string; level: number; title: string;
  atk: number; hp: number; def: number; haste: number; crit: number; crit_dmg: number;
  lifesteal: number; dodge: number; armor_pierce: number; skill_dmg: number;
  cd_reduce: number; interval: number;
  active: string[]; passive: string[]; suits: string[];
}

/** 从游戏状态裁剪快照(基础面板口径:不含临时 buff,与 power 榜一致) */
export function makeSquad(g: Game): ArenaSquad {
  const h = g.hero;
  const suits = new Set<string>();
  for (const it of Object.values(g.equip)) {
    if (it.suitId && SUIT_DEF[it.suitId]) suits.add(it.suitId);
  }
  return {
    cls: g.classId ?? "", level: g.level, title: g.title,
    atk: h.atk, hp: h.max_hp, def: h.def,
    haste: h.haste, crit: h.crit, crit_dmg: h.crit_dmg,
    lifesteal: h.lifesteal, dodge: h.dodge, armor_pierce: h.armor_pierce,
    skill_dmg: h.skill_dmg, cd_reduce: h.cd_reduce, interval: h.interval,
    active: [...g.loadout.active], passive: [...g.loadout.passive],   // 拷贝:快照不受后续装卸影响
    suits: [...suits],
  };
}

/** 服务端快照 → 本地阵容(防御式:坏值回落安全默认,快照来自匿名他人) */
export function parseSquad(raw: unknown): ArenaSquad {
  const o = (raw !== null && typeof raw === "object" && !Array.isArray(raw))
    ? raw as Record<string, unknown> : {};
  const num = (v: unknown, dflt: number): number =>
    (typeof v === "number" && Number.isFinite(v) && v >= 0) ? v : dflt;
  const strs = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string");
  return {
    cls: typeof o.cls === "string" ? o.cls : "",
    level: Math.max(1, Math.trunc(num(o.level, 1))),
    title: typeof o.title === "string" ? o.title : "",
    atk: num(o.atk, 1), hp: Math.max(1, num(o.hp, 1)), def: num(o.def, 0),
    haste: num(o.haste, 0), crit: Math.min(num(o.crit, 0), 100),
    crit_dmg: num(o.crit_dmg, 0), lifesteal: num(o.lifesteal, 0),
    dodge: Math.min(num(o.dodge, 0), 40), armor_pierce: Math.min(num(o.armor_pierce, 0), 50),
    skill_dmg: num(o.skill_dmg, 0), cd_reduce: Math.min(num(o.cd_reduce, 0), 40),
    interval: Math.max(0.05, num(o.interval, 1.1)),
    active: strs(o.active), passive: strs(o.passive), suits: strs(o.suits),
  };
}

/** 装配侧每秒期望输出折算(仿 systems.heroDps 的覆盖率折算,独立 ~30 行版:
 *  lv=1 基础值、吃快照面板,不依赖 Game;shield/heal 不折算 —— 期望对撞只算输出) */
function foldSquad(sq: ArenaSquad): { atkEff: number; swing: number; dmgMult: number; skillDps: number } {
  let atkMult = 1, swingDiv = 1, dmgMult = 1, skillDps = 0;
  const skillMult = 1 + sq.skill_dmg / 100;
  for (const sid of sq.active) {
    const d = ACTIVE_DEF[sid];
    if (!d) continue;   // 未知技能(异端快照)跳过
    const cd = Math.max(0.5, d.cd * (1 - Math.min(sq.cd_reduce / 100, 0.4)));
    const v = d.base;   // lv=1:快照不存技能等级,per×(1-1)=0
    if (d.kind === "damage" || d.kind === "multi") {
      let dmgPct = v * (d.hits ?? 1);
      if (d.dot_base) dmgPct += d.dot_base * ((d.dot_dur ?? 0) / (d.dot_tick ?? 0.5));
      if (d.must_crit) dmgPct *= 1 + sq.crit_dmg / 100;
      skillDps += sq.atk * dmgPct / 100 / cd * skillMult;
    } else if (d.kind === "buff") {
      const cov = Math.min(1, (d.dur ?? 0) / cd);
      if (d.stat === "atk") atkMult *= 1 + v / 100 * cov;
      else if (d.stat === "haste") swingDiv *= 1 + v / 100 * cov;
      else dmgMult *= 1 + v / 100 * cov;          // dmg_pct / all / crit 等点值统一按伤害乘区
    } else if (d.kind === "execute") {
      skillDps += sq.atk * d.base / 100 / cd * skillMult;   // 非头目口径(heroDps else 分支)
    }
  }
  return {
    atkEff: sq.atk * atkMult,
    swing: Math.max(0.05, sq.interval / (1 + sq.haste / 100) / swingDiv),
    dmgMult, skillDps,
  };
}

/** a 对 b 单回合伤害(roll=本回合共享暴击判定值;含吸血前的输出量) */
function turnDmg(a: ArenaSquad, fa: { atkEff: number; swing: number; dmgMult: number; skillDps: number },
                 b: ArenaSquad, roll: number): number {
  const pierce = Math.min(a.armor_pierce / 100, 0.5);          // 与 combat/skills 同 50% 封顶
  const defEff = Math.max(0, b.def) * (1 - pierce);
  const white = fa.atkEff * fa.atkEff / (fa.atkEff + defEff) / fa.swing * fa.dmgMult;
  const critMul = roll < a.crit / 100 ? 1 + a.crit_dmg / 100 : 1;   // 期望=1+crit×crit_dmg/100
  const out = (white * critMul + fa.skillDps * fa.dmgMult) * BAL.arena_turn_sec;
  return out * (1 - Math.min(b.dodge, 40) / 100);              // 闪避按期望折算入承伤
}

export interface ArenaResult {
  win: boolean;                 // 发起挑战方(攻方=me)是否胜
  reason: "ko" | "hp" | "tie";  // 击倒 / 血量百分比 / 平局判攻方
  rounds: number;               // 实际进行回合数(1..arena_max_rounds)
  meHpPct: number; foeHpPct: number;   // 剩余血量百分比(0..100,逐位确定)
  report: string[];             // 恰 5 条战斗播报
}

/** 本地模拟对战(独立 PyRandom,不消耗主 RNG 流,零主线污染)。
 *  同一回合双方共享一次暴击判定:镜像对局(self vs self)逐位对称 → 必然持平
 *  → 走『平局判发起挑战方胜』分支,自己是攻方即自己胜(镜像即校验自己 build 的镜子)。 */
export function arenaSimulate(me: ArenaSquad, foe: ArenaSquad, seed: number): ArenaResult {
  const rng = new PyRandom(seed);
  const fm = foldSquad(me), ff = foldSquad(foe);
  const meMax = Math.max(1, me.hp), foeMax = Math.max(1, foe.hp);
  let meHp = meMax, foeHp = foeMax, rounds = 0;
  const hist: [number, number][] = [];
  for (let r = 1; r <= BAL.arena_max_rounds; r++) {
    rounds = r;
    const roll = rng.random();
    const dMe = turnDmg(me, fm, foe, roll);
    const dFoe = turnDmg(foe, ff, me, roll);
    foeHp -= dMe;
    meHp = Math.min(meMax, meHp + dMe * me.lifesteal / 100);   // 吸血回血(封顶)
    meHp -= dFoe;
    foeHp = Math.min(foeMax, foeHp + dFoe * foe.lifesteal / 100);
    hist.push([meHp / meMax, foeHp / foeMax]);
    if (meHp <= 0 || foeHp <= 0) break;
  }
  let win: boolean, reason: "ko" | "hp" | "tie";
  if (foeHp <= 0 && meHp <= 0) { win = true; reason = "tie"; }        // 同时倒地:平局判攻方胜
  else if (foeHp <= 0) { win = true; reason = "ko"; }
  else if (meHp <= 0) { win = false; reason = "ko"; }
  else {
    win = meHp / meMax >= foeHp / foeMax;                              // 恰好持平也判攻方胜
    reason = meHp / meMax === foeHp / foeMax ? "tie" : "hp";
  }
  const clampPct = (v: number, max: number): number =>
    Math.max(0, Math.min(100, v / max * 100));
  const meHpPct = clampPct(meHp, meMax), foeHpPct = clampPct(foeHp, foeMax);
  const pct = (v: number): string => v.toFixed(1);
  const clsName = (c: string): string => CLASSES[c]?.name ?? c;
  const mark = (n: number): string => {
    const [a, b] = hist[Math.min(hist.length, Math.max(1, Math.round(n))) - 1]!;
    return `回合${Math.max(1, Math.round(n))}:我方 ${pct(Math.max(0, a) * 100)}% ↔ 对手 ${pct(Math.max(0, b) * 100)}%`;
  };
  const report = [
    `⚔ 开战:我方 Lv${me.level} ${clsName(me.cls)} vs 对手 Lv${foe.level} ${clsName(foe.cls)}`,
    mark(rounds * 0.25), mark(rounds * 0.5), mark(rounds * 0.75),
    `${win ? "🏆 第" : "💀 第"}${rounds}回合见分晓:挑战${win ? "成功" : "失败"}!` +
      `(我方 ${pct(meHpPct)}% / 对手 ${pct(foeHpPct)}%)`,
  ];
  return { win, reason, rounds, meHpPct, foeHpPct, report };
}

/** 挑战种子:Date.now() ^ FNV-1a(对手名) —— 每次挑战有变化,同一次点击内确定 */
export function arenaSeed(foeName: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < foeName.length; i++) {
    h ^= foeName.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (Date.now() ^ h) >>> 0;
}
