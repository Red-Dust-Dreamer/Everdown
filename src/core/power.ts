/** 战力系统:把英雄综合强度折算成一个可读数值(TS 独有展示层)。
 *
 * 不参与战斗结算 / RNG / 存档序列化 —— 纯派生量,随时可重算,不影响 Python 对拍。
 *
 * 口径(全部线性加权,数值随成长多项式增长,不引入指数):
 * - 输出分:对「标准假人」的估算总 DPS(普攻 + 装配技能,buff 技能按覆盖率折算),
 *   复用 systems.heroDps 的实战估算;假人 = 历史最远区域的头目层白怪
 *   (tier 不随回退 farming 下降,战力只涨不跌,适合横向对比与排行榜)。
 * - 生存分:有效生命 EHP × 0.08。伤害公式为 atk²/(atk+def),防御的边际减伤
 *   正好折成 EHP = hp ÷(假人攻击占比)÷(1-闪避)×(1+吸血折算)。
 * - 功能分:金币/经验/幸运小权重(战斗外收益,占比 <10%)。
 * - 临时 buff(药剂/技能):面板战力跟随生效(与面板 DPS 同口径,喝药看涨);
 *   排行榜与换装对比用无 buff 的基础口径,避免虚高。
 */
import { BAL, CAPS } from "./data.ts";
import { tierOf } from "./combat.ts";
import { heroDps } from "./systems.ts";
import { buffPct } from "./skills.ts";
import type { Game } from "./game.ts";
import type { Item } from "./items.ts";
import type { Relic } from "./relics.ts";

export interface PowerBreakdown {
  total: number;
  offense: number;   // 输出分(假人 DPS)
  defense: number;   // 生存分(EHP × 0.08)
  utility: number;   // 功能分(金币/经验/幸运)
}

/** 生存/功能权重(输出分 = DPS × 1,不配权重直接可读) */
const EHP_W = 0.08;
const LS_W = 0.5;
const UTIL = { goldfind: 2.0, xp_pct: 0.6, luck: 0.5 };

/** 标准假人属性(白怪,不含等级压制):历史最远 zone 的头目层 tier */
function dummyStats(g: Game): { atk: number; def: number; hp: number } {
  const t = tierOf(Math.max(1, g.stats.max_zone), 10);
  return {
    atk: BAL.mob_atk0 + BAL.mob_atk_k * Math.pow(t, BAL.mob_atk_p),
    def: BAL.mob_def0 + BAL.mob_def_k * Math.pow(t, BAL.mob_def_p),
    hp: BAL.mob_hp0 + BAL.mob_hp_k * Math.pow(t, BAL.mob_hp_p),
  };
}

export function heroPower(g: Game, withBuffs = true): PowerBreakdown {
  const h = g.hero;
  const dummy = dummyStats(g);

  // 输出:heroDps 基于基础面板;临时 buff 与面板 DPS 同口径地乘上去
  const [dps0] = heroDps(g, dummy.def, dummy.hp, false);
  let offense = Math.max(0, dps0);
  if (withBuffs) {
    const bAtk = (1 + buffPct(g, "atk") / 100) * (1 + buffPct(g, "all") / 100);
    const bHaste = 1 + buffPct(g, "haste") / 100;
    const bDmg = 1 + buffPct(g, "dmg_pct") / 100;
    offense *= bAtk * bHaste * bDmg;
  }

  // 生存:每击承受占比 = mobAtk/(mobAtk+def)(由 atk²/(atk+def) 反推)
  const hitShare = dummy.atk / (dummy.atk + Math.max(0, h.def));
  const dodge = Math.min(h.dodge ?? 0, CAPS.dodge ?? 40) / 100;
  const lsMul = 1 + Math.min(h.lifesteal ?? 0, CAPS.lifesteal ?? 25) / 100 * LS_W;
  const ehp = h.max_hp / Math.max(1e-9, hitShare) / Math.max(0.6, 1 - dodge) * lsMul;
  const defense = ehp * EHP_W;

  const utility = (h.goldfind ?? 0) * UTIL.goldfind
    + (h.xp_pct ?? 0) * UTIL.xp_pct + (h.luck ?? 0) * UTIL.luck;

  return {
    total: Math.round(offense + defense + utility),
    offense: Math.round(offense),
    defense: Math.round(defense),
    utility: Math.round(utility),
  };
}

// ---------------------------------------------------------------- 预览(换装对比)
/** 临时变更后算战力再原样恢复。recalcHero 会做 min(hp, max_hp) 截断,
 *  预览不该真伤/真奶玩家血量,进出各存一次 hp。 */
function scopedPower(g: Game, mutate: () => void, restore: () => void): PowerBreakdown {
  const savedHp = g.hero.hp;
  mutate();
  g.recalcHero();
  const p = heroPower(g, false);
  restore();
  g.recalcHero();
  g.hero.hp = Math.min(savedHp, g.hero.max_hp);
  return p;
}

/** 预览:把 slot 换成 item(null=卸下)后的基础战力(无临时 buff 口径) */
export function powerWithEquip(g: Game, slot: string, item: Item | null): PowerBreakdown {
  const old = g.equip[slot];
  return scopedPower(g,
    () => { if (item) g.equip[slot] = item; else delete g.equip[slot]; },
    () => { if (old) g.equip[slot] = old; else delete g.equip[slot]; });
}

/** 预览:把遗物槽 idx 换成 relic(null=空)后的基础战力 */
export function powerWithRelic(g: Game, idx: number, relic: Relic | null): PowerBreakdown {
  const old = g.relics[idx];
  return scopedPower(g,
    () => { g.relics[idx] = relic; },
    () => { g.relics[idx] = old; });
}
