/** 装备:生成 / 属性 / 评分 / 命名 / 出售分解(与 abyss/items.py 语义一致) */
import { c, fmt, pad } from "./ansi.ts";
import type { PyRandom } from "./rng.ts";
import {
  ACTIVE_DEF, ACTIVE_SKILLS, AFFIX_DEF, AFFIX_SUFFIX, AFFIXES, BAL, CAPS,
  PASSIVE_DEF, PASSIVE_SKILLS, RARITIES, RARITY_IDX, RARITY_PREFIX, SLOTS,
  SLOT_INNATE, MAIN_ROLLS, STAT_NAMES,
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
  /** roll 定的主属性(防具槽生命/防御二选一);null=旧存档,回落 LEGACY_MAIN */
  mainId: StatKey | null;
  /** skill_lv 词缀绑定的技能 id(roll 时随机,主动/被动);null=旧档未绑定,保持全技能聚合 */
  skillSid: string | null = null;

  constructor(slot: string, rarity: string, tier: number, mainVal: number,
              affixes: AffixRoll[], plus = 0, name: string | null = null,
              rng?: PyRandom, mainId: StatKey | null = null,
              skillSid: string | null = null) {
    this.slot = slot;
    this.rarity = rarity;
    this.tier = tier;
    this.plus = plus;
    this.mainVal = mainVal;
    this.affixes = affixes;
    this.name = name ?? this.genName(rng);
    this.mainId = mainId;
    this.skillSid = skillSid;
  }

  /** 绑定技能名(skill_lv 词缀显示用);未绑定返回 null */
  boundSkillName(): string | null {
    if (!this.skillSid) return null;
    return ACTIVE_DEF[this.skillSid]?.name ?? PASSIVE_DEF[this.skillSid]?.name ?? null;
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
    return this.mainId ?? "atk";
  }

  mult(): number {
    // 稀有度倍率用 mainMul(1.00~2.10);旧实现误用词缀数(1~6),蓝色×3/神话×6 导致数值爆炸(已修)
    const rmul = RARITIES[RARITY_IDX[this.rarity]].mainMul;
    return rmul * (1 + plusBonus(this.plus));
  }

  stats(): Record<string, number> {
    // 强化只提主属性与固有(基础数值),词条不吃强化——多词条逐级放大膨胀过快
    const rmul = RARITIES[RARITY_IDX[this.rarity]].mainMul;
    const m = this.mult();   // 主属性用:稀有度 × 强化
    const out: Record<string, number> = { [this.mainStat()]: this.mainVal * m };
    for (const a of this.affixes) {
      // 绑定技能的单技能词缀不进通用聚合(effLv 按 skillSid 单独生效)
      if (a.id === "skill_lv" && this.skillSid) continue;
      // 百分比词缀保持 roll 值;数值词缀只吃稀有度倍率(均不吃强化)
      const pct = AFFIX_DEF[a.id]?.pct;
      out[a.id] = (out[a.id] ?? 0) + a.val * (pct ? 1 : rmul);
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

  reforgeCount(): number {
    const rid = RARITY_IDX[this.rarity];
    return Math.min(this.affixes.length, BAL.reforge_slots[rid]);
  }

  reforgeAffixesWithLuck(rng: any, luckOff = 1.0): string[] {
    const n = this.reforgeCount();
    if (n <= 0 || !this.affixes.length) return [];
    const rid = RARITY_IDX[this.rarity];
    const indices = this.affixes.map((_, i) => i);
    rng.shuffle(indices);
    const picked = indices.slice(0, n);
    for (const i of picked) {
      const aid = this.affixes[i].id;
      const a = AFFIX_DEF[aid];
      // 百分比词缀维持稀有度分档(档位基数不变,随机宽度受 luck 放大)
      const val = a.pct
        ? rid * (a.step ?? 5) + rng.uniform(0, (a.step ?? 5) * luckOff)
        : rng.uniform(a.lo, a.hi * luckOff) + a.k * this.tier;
      this.affixes[i] = { id: aid, val };
    }
    return picked.map(i => AFFIX_DEF[this.affixes[i].id].name);
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
      ...(this.mainId ? { main_id: this.mainId } : {}),
      ...(this.skillSid ? { skill_sid: this.skillSid } : {}),
    };
  }

  static fromDict(d: any): Item {
    return new Item(d.slot, d.rarity, d.tier, d.main_val,
      d.affixes.map((a: any) => ({ id: a[0] as StatKey, val: a[1] })),
      d.plus ?? 0, d.name, undefined, d.main_id ?? null, d.skill_sid ?? null);
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
      // 绑定技能的单技能词缀:词条名=技能名,整级显示
      if (a.id === "skill_lv" && this.skillSid) {
        const nm = this.boundSkillName() ?? "技能";
        lines.push(c("├ 词缀:", "bright_black") + ` ${nm} +${Math.trunc(a.val)}级`);
        continue;
      }
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

export function rollItem(tier: number, rng: PyRandom, luck = 0, minIdx = 0, boost = 0,
                         cls: string | null = null): Item {
  const slotDef = SLOTS[rng.randrange(SLOTS.length)];
  const rid = rollRarity(rng, luck, minIdx, boost);
  const rar = RARITIES[rid];
  // 主属性按槽位候选表 roll(防具槽生命/防御二选一);rng 调用顺序与 python 严格一致
  const pick = MAIN_ROLLS[slotDef.id][rng.randrange(MAIN_ROLLS[slotDef.id].length)];
  let mainVal: number;
  if (PCT_MAINS.includes(pick.stat)) {
    mainVal = pick.base * rng.uniform(0.9, 1.1);
  } else {
    mainVal = pick.base + pick.k * Math.pow(tier, BAL.item_main_p) * rng.uniform(0.85, 1.15);
  }
  const nAffix = rar.affixes;
  const pool = [...AFFIXES];
  rng.shuffle(pool);
  const affixes: AffixRoll[] = [];
  for (const a of pool.slice(0, nAffix)) {
    // 百分比词缀按稀有度分档:白 0~step、精良 step~2step……神话 5step~6step
    // (crit_dmg step=10 → 白0~10/绿10~20/蓝20~30/紫30~40/金40~50/神50~60)
    const val = a.pct
      ? rid * (a.step ?? 5) + rng.uniform(0, a.step ?? 5)
      : rng.uniform(a.lo, a.hi) + a.k * tier;
    affixes.push({ id: a.id, val });
  }
  // 单技能词缀:随机绑定当前职业一个技能(主动+被动池);rng 消耗与 python 严格一致
  let skillSid: string | null = null;
  if (affixes.some(a => a.id === "skill_lv")) {
    const sidPool = [...ACTIVE_SKILLS, ...PASSIVE_SKILLS]
      .filter(s => s.cls === cls).map(s => s.id);
    skillSid = sidPool.length ? rng.choice(sidPool) : null;
  }
  return new Item(slotDef.id, rar.key, tier, mainVal, affixes, 0, null, rng, pick.stat, skillSid);
}

/** 词缀斜率修正的展示信息(与 CAPS 无关,评分权重在 AFFIXES 中) */
export const _unusedCaps = CAPS;
