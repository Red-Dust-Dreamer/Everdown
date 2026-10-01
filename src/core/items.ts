/** 装备:生成 / 属性 / 评分 / 命名 / 出售分解(与 abyss/items.py 语义一致) */
import { c, fmt, pad } from "./ansi.ts";
import type { PyRandom } from "./rng.ts";
import {
  AFFIX_DEF, AFFIX_SUFFIX, AFFIXES, BAL, CAPS, RARITIES, RARITY_IDX,
  RARITY_PREFIX, SLOTS, SLOT_INNATE, SLOT_MAIN_K, STAT_NAMES,
} from "./data.ts";
import type { StatKey } from "./data.ts";

export const PCT_MAINS = ["haste", "crit", "crit_dmg", "goldfind", "lifesteal"];

export function plusBonus(plus: number): number {
  return (BAL.plus_pct_1 * Math.min(plus, 10)
    + BAL.plus_pct_2 * Math.max(0, Math.min(plus, 20) - 10)
    + BAL.plus_pct_3 * Math.max(0, plus - 20)) / 100;
}


/** CPython round():银行家舍入(对拍关键) */
export function pyRound(v: number): number {
  const f = Math.floor(v);
  const diff = v - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export interface AffixRoll { id: StatKey; val: number }

export class Item {
  slot: string;
  rarity: string;
  tier: number;
  plus: number;
  mainVal: number;
  affixes: AffixRoll[];
  name: string;

  constructor(slot: string, rarity: string, tier: number, mainVal: number,
              affixes: AffixRoll[], plus = 0, name: string | null = null,
              rng?: PyRandom) {
    this.slot = slot;
    this.rarity = rarity;
    this.tier = tier;
    this.plus = plus;
    this.mainVal = mainVal;
    this.affixes = affixes;
    this.name = name ?? this.genName(rng);
  }

  private genName(rng?: PyRandom): string {
    if (!rng) return "无名";
    const rid = RARITY_IDX[this.rarity];
    const slotDef = SLOTS.find(s => s.id === this.slot)!;
    const base = rng.choice(slotDef.names);
    const prefix = RARITY_PREFIX[rid];
    if (this.affixes.length && rng.random() < 0.55) {
      const suffix = AFFIX_SUFFIX[this.affixes[0].id] ?? "";
      return `${prefix}${base}·${suffix}`;
    }
    return `${prefix}${base}`;
  }

  mainStat(): StatKey {
    return SLOTS.find(s => s.id === this.slot)!.main;
  }

  mult(): number {
    // 对拍基准:Python mult() 用 RARITIES[rid][3](即词缀数)作稀有度倍率
    const rmul = RARITIES[RARITY_IDX[this.rarity]].affixes;
    return rmul * (1 + plusBonus(this.plus));
  }

  stats(): Record<string, number> {
    const m = this.mult();
    const out: Record<string, number> = { [this.mainStat()]: this.mainVal * m };
    for (const a of this.affixes) {
      out[a.id] = (out[a.id] ?? 0) + a.val * m;
    }
    const innate = SLOT_INNATE[this.slot];
    if (innate) {
      const [k, per] = innate;
      const rid = RARITY_IDX[this.rarity];
      const extra = per * rid * (1 + plusBonus(this.plus));
      out[k] = (out[k] ?? 0) + extra;
    }
    return out;
  }

  score(): number {
    let s = 0;
    for (const [k, v] of Object.entries(this.stats())) {
      let w: number;
      if (k === "hp") w = 0.085;
      else if (k === "atk") w = 1.0;
      else if (k === "def") w = 0.45;
      else w = AFFIX_DEF[k]?.weight ?? 1.0;
      s += v * w;
    }
    return s;
  }

  sellPrice(): number {
    const rid = RARITY_IDX[this.rarity];
    return pyRound((5 + this.tier * 0.8 + this.plus * 4) * (1 + rid * 0.35));
  }

  dismantle(): [number, number] {
    const rid = RARITY_IDX[this.rarity];
    const stones = Math.max(0, rid - 2) + (this.plus >= 10 ? 1 : 0);
    return [this.sellPrice() + Math.trunc(this.tier * 0.4), stones];
  }

  enhanceCost(): number {
    const base = BAL.enhance_cost0 + BAL.enhance_cost_t * this.tier;
    const mul = 1 + BAL.enhance_plus_a * this.plus + BAL.enhance_plus_b * this.plus ** 2;
    return pyRound(base * mul);
  }

  toDict() {
    return {
      slot: this.slot, rarity: this.rarity, tier: this.tier, plus: this.plus,
      main_val: round2(this.mainVal),
      affixes: this.affixes.map(a => [a.id, round2(a.val)] as [string, number]),
      name: this.name,
    };
  }

  static fromDict(d: any): Item {
    return new Item(d.slot, d.rarity, d.tier, d.main_val,
      d.affixes.map((a: any) => ({ id: a[0] as StatKey, val: a[1] })),
      d.plus ?? 0, d.name);
  }

  rarityColor() {
    return RARITIES[RARITY_IDX[this.rarity]].color;
  }

  display(width = 0): string {
    const rid = RARITY_IDX[this.rarity];
    const tag = "★".repeat(rid + 1);
    let s = c("[", "bright_black") + c(tag, this.rarityColor()) + c("]", "bright_black")
      + c(this.name, this.rarityColor())
      + (this.plus ? c(`+${this.plus}`, "bright_yellow", "", true) : "");
    if (width) s = pad(s, width);
    return s;
  }

  statLines(): string[] {
    const lines: string[] = [];
    const mstat = this.mainStat();
    const stats = this.stats();
    const v = stats[mstat] ?? 0;
    const isPct = PCT_MAINS.includes(mstat);
    lines.push(c("主属性:", "bright_black") + ` ${STAT_NAMES[mstat]} ${isPct ? pctStr(v) : fmt(v)}`);
    for (const a of this.affixes) {
      const def = AFFIX_DEF[a.id];
      const av = stats[a.id] ?? 0;
      lines.push(c("├ 词缀:", "bright_black")
        + ` ${def.name} +${def.pct ? pctStr(av) : fmt(av)}`);
    }
    const innate = SLOT_INNATE[this.slot];
    if (innate) {
      const [k, per] = innate;
      const rid = RARITY_IDX[this.rarity];
      const extra = per * rid * (1 + plusBonus(this.plus));
      if (!this.affixes.some(a => a.id === k)) {
        lines.push(c("├ 固有:", "bright_black") + ` ${STAT_NAMES[k]} +${pctStr(extra)}`);
      }
    }
    return lines;
  }
}

function pctStr(v: number): string {
  return String(parseFloat(v.toFixed(1))).replace(/\.0$/, "") + "%";
}

function round2(v: number): number {
  return pyRound(v * 100) / 100;
}

// ---------------------------------------------------------------- 生成
export function rollRarity(rng: PyRandom, luck = 0, minIdx = 0, boost = 0): number {
  const weights: number[] = [];
  for (let i = 0; i < RARITIES.length; i++) {
    let w = RARITIES[i].weight;
    if (i >= 2) w *= 1 + luck / 100;
    if (i >= 3) w *= 1 + boost;
    weights.push(Math.max(0, w));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const x = rng.random() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (x <= acc) return Math.max(i, minIdx);
  }
  return Math.max(0, minIdx);
}

export function rollItem(tier: number, rng: PyRandom, luck = 0, minIdx = 0, boost = 0): Item {
  const slotDef = SLOTS[rng.randrange(SLOTS.length)];
  const rid = rollRarity(rng, luck, minIdx, boost);
  const rar = RARITIES[rid];
  const mainStat = slotDef.main;
  let mainVal: number;
  if (PCT_MAINS.includes(mainStat)) {
    mainVal = slotDef.mainBase * rng.uniform(0.9, 1.1);
  } else {
    const k = SLOT_MAIN_K[slotDef.id] ?? 1.0;
    mainVal = slotDef.mainBase + k * Math.pow(tier, BAL.item_main_p) * rng.uniform(0.85, 1.15);
  }
  const nAffix = rar.affixes;
  const pool = [...AFFIXES];
  rng.shuffle(pool);
  const affixes: AffixRoll[] = [];
  for (const a of pool.slice(0, nAffix)) {
    affixes.push({ id: a.id, val: rng.uniform(a.lo, a.hi) + a.k * tier });
  }
  return new Item(slotDef.id, rar.key, tier, mainVal, affixes, 0, null, rng);
}

/** 词缀斜率修正的展示信息(与 CAPS 无关,评分权重在 AFFIXES 中) */
export const _unusedCaps = CAPS;
