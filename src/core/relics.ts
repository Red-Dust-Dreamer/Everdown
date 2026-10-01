/** 遗物系统:生成 / 效果折算 / 装备管理(与 abyss/relics.py 一致;与主线装备完全独立) */
import { c, pad } from "./ansi.ts";
import { ACTIVE_DEF, RARITIES, RARITY_IDX, RELIC_EFF_COUNT, RELIC_EFF_DEF, RELIC_EFFECTS } from "./data.ts";
import { pyRound, rollRarity } from "./items.ts";
import type { PyRandom } from "./rng.ts";
import type { StatMod } from "./skills.ts";

/** 遗物名称池(按品质) */
export const RELIC_NAMES: string[][] = [
  ["碎裂石片", "锈蚀铜符"],
  ["打磨水晶", "符文残页"],
  ["秘银徽记", "元素核心"],
  ["龙裔圣物", "深渊之心"],
  ["星陨圣杯", "永恒之眼"],
  ["湮灭权柄", "创世碎片"],
];

export interface RelicEffect { id: string; val: number }

export class Relic {
  rarity: string;
  tier: number;              // 塔层数档(10/20/30...)
  effects: RelicEffect[];    // [{id, val}, ...]
  name: string;
  skillId: string | null;    // skill_lv_r 效果绑定的技能id(null=无)

  constructor(rarity: string, tier: number, effects: RelicEffect[],
              name: string | null = null, rng?: PyRandom, skillId: string | null = null) {
    this.rarity = rarity;
    this.tier = tier;
    this.effects = effects;
    this.skillId = skillId;
    this.name = name ?? this.genName(rng);
  }

  private genName(rng?: PyRandom): string {
    if (!rng) return "无名遗物";
    const rid = RARITY_IDX[this.rarity];
    return rng.choice(RELIC_NAMES[rid]);
  }

  effCount(): number {
    return RELIC_EFF_COUNT[RARITY_IDX[this.rarity]];
  }

  display(width = 0): string {
    const rid = RARITY_IDX[this.rarity];
    const tag = "◆".repeat(rid + 1);
    let sk = "";
    if (this.skillId) {
      const d = ACTIVE_DEF[this.skillId];
      if (d) sk = c(`·${d.name}`, d.color);
    }
    let s = c("[", "bright_black") + c(tag, RARITIES[rid].color) + c("]", "bright_black")
      + c(this.name, RARITIES[rid].color) + sk + c(` T${this.tier}`, "bright_black");
    if (width) s = pad(s, width);
    return s;
  }

  effectLines(): string[] {
    const lines: string[] = [];
    for (const e of this.effects) {
      const d = RELIC_EFF_DEF[e.id];
      if (e.id === "skill_lv_r" && this.skillId) {
        const sk = ACTIVE_DEF[this.skillId];
        lines.push(`  ◈ ${d.name}(${sk ? sk.name : "?"}) +${pyRound(e.val)}${d.unit}`);
      } else if (d.unit === "级") {
        lines.push(`  ◈ ${d.name} +${pyRound(e.val)}${d.unit}`);
      } else {
        lines.push(`  ◈ ${d.name} +${e.val.toFixed(1)}${d.unit}`);
      }
    }
    return lines;
  }

  toDict(): Record<string, any> {
    return {
      rarity: this.rarity, tier: this.tier,
      effects: this.effects.map(e => [e.id, pyRound(e.val * 100) / 100] as [string, number]),
      name: this.name,
      skill_id: this.skillId,
    };
  }

  static fromDict(d: any): Relic {
    return new Relic(d.rarity, d.tier,
      (d.effects as [string, number][]).map(a => ({ id: a[0], val: a[1] })), d.name,
      undefined, d.skill_id ?? null);
  }
}

/** 按塔层档位生成遗物(随机全部走传入 rng;loadout=当前装配主动技能列表,用于 skill_lv_r 绑定;
 *  luck 影响稀有度权重,与主线掉落同口径) */
export function rollRelic(tier: number, rng: PyRandom, minIdx = 0, loadout?: string[], luck = 0): Relic {
  const rid = rollRarity(rng, luck, minIdx, 0);
  const rar = RARITIES[rid];
  const nEff = RELIC_EFF_COUNT[rid];
  const pool = [...RELIC_EFFECTS];
  rng.shuffle(pool);
  const effects = pool.slice(0, nEff).map(e => ({ id: e.id, val: rng.uniform(e.lo, e.hi) }));
  const slr = effects.findIndex(e => e.id === "skill_lv_r");
  let skillId: string | null = null;
  if (slr >= 0 && loadout && loadout.length) {
    skillId = rng.choice(loadout);
  } else if (slr >= 0) {
    // 主动装配为空:skill_lv_r 无技能可绑,换成洗牌后紧随的未用词条(池 9 条 > 最多 3 效果,必存在),
    // 避免生成无声废词条
    const alt = pool[nEff];
    effects[slr] = { id: alt.id, val: rng.uniform(alt.lo, alt.hi) };
  }
  return new Relic(rar.key, tier, effects, null, rng, skillId);
}

/** 已装备遗物的效果 → 统一修饰器列表(数值型)。
 * skill_lv_r 由 effLv 特殊读取 relic.skillId,不进通用 mods;
 * 其余效果 id 与属性键同名(见 RELIC_EFFECTS),全部以 add 生效。 */
export function relicMods(relics: (Relic | null)[]): StatMod[] {
  const mods: StatMod[] = [];
  for (const r of relics) {
    if (!r) continue;
    for (const e of r.effects) {
      if (e.id === "skill_lv_r") continue;  // effLv 特殊处理
      mods.push({ stat: e.id, op: "add", v: e.val });
    }
  }
  return mods;
}
