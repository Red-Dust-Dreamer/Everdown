/** 技能引擎:主动施放(数据驱动)+ 被动数值聚合与钩子查询(与 abyss/skills.py 一致) */
import { c, fmt } from "./ansi.ts";
import { CLASSES, PASSIVE_DEF } from "./data.ts";
import type { ActiveSkill, PassiveSkill } from "./data.ts";
import { _dmg } from "./combat.ts";
import type { Game } from "./game.ts";


// ---------------------------------------------------------------- 等级与数值
export function classOf(g: Game) {
  return CLASSES[g.classId ?? ""] ?? CLASSES["warrior"];
}

export function equipSkillLv(g: Game): number {
  return Math.trunc(g.hero.skill_lv ?? 0);
}

export function effLv(g: Game, sid: string): number {
  // 技能有效等级 = 自身等级(1~10) + 装备词缀加成 + 遗物单技能加成
  let relicLv = 0;
  for (const r of g.relics) {
    if (r && r.skillId === sid) {
      for (const e of r.effects) {
        if (e.id === "skill_lv_r") relicLv += Math.trunc(e.val);
      }
    }
  }
  return Math.max(1, g.skillLv[sid] ?? 1) + equipSkillLv(g) + relicLv;
}

export function skillVal(def: { base: number; per?: number }, lv: number): number {
  return def.base + (def.per ?? 0) * (lv - 1);
}

function fmtVal(v: number): string {
  if (v >= 100) return String(Math.round(v));
  return String(parseFloat(v.toFixed(1))).replace(/\.0$/, "");
}

export function skillDesc(g: Game, def: ActiveSkill | PassiveSkill): string {
  const lv = effLv(g, def.id);
  const show = skillVal(def, lv);
  let txt = def.desc.replace("{v}", fmtVal(show));
  if (equipSkillLv(g) > 0) {
    txt += c(`(含装备+${equipSkillLv(g)})`, "bright_black");
  }
  return txt;
}

// ---------------------------------------------------------------- 数值被动
export interface StatMod { stat: string; op: "add" | "pct"; v: number }

export function passiveMods(g: Game): StatMod[] {
  const mods: StatMod[] = [];
  for (const sid of g.loadout.passive) {
    const d = PASSIVE_DEF[sid];
    if (!d || d.kind !== "stat") continue;
    const v = skillVal(d, effLv(g, sid));
    const stats = d.stat === "all" ? ["hp", "atk", "def"] : [d.stat!];
    for (const st of stats) mods.push({ stat: st, op: d.op!, v });
  }
  return mods;
}

export function hookDef(g: Game, hook: string): PassiveSkill | null {
  for (const sid of g.loadout.passive) {
    const d = PASSIVE_DEF[sid];
    if (d && d.kind === "hook" && d.hook === hook) return d;
  }
  return null;
}

export function hookVal(g: Game, hook: string): number {
  const d = hookDef(g, hook);
  return d ? skillVal(d, effLv(g, d.id)) : 0;
}

// ---------------------------------------------------------------- buff
export interface Buff { pct: number; until: number }

export function addBuff(g: Game, stat: string, pct: number, dur: number): void {
  const until = g.time + dur;
  const cur = g.buffs[stat];
  if (cur && cur.until > g.time && cur.pct >= pct) return;
  g.buffs[stat] = { pct, until };
}

export function buffPct(g: Game, stat: string): number {
  const b = g.buffs[stat];
  if (!b || b.until <= g.time) return 0;
  return b.pct;
}

export function tickBuffs(g: Game): void {
  for (const k of Object.keys(g.buffs)) {
    if (g.buffs[k].until <= g.time) delete g.buffs[k];
  }
}

// ---------------------------------------------------------------- 伤害乘区
export interface MonLike {
  hp: number; maxHp: number; boss: boolean; elite: boolean;
  hpPct(): number; markedPct: number; markedUntil: number;
}

export function dmgMultipliers(g: Game, mon: MonLike | null): number {
  let mult = 1.0;
  mult *= 1 + buffPct(g, "dmg_pct") / 100;
  if (g.hero.hp < g.hero.max_hp * 0.5) {
    mult *= 1 + hookVal(g, "low_hp_dmg") / 100;
  }
  if (mon) {
    if (mon.boss || mon.elite) {
      mult *= 1 + hookVal(g, "boss_dmg") / 100;
      if (mon.markedPct && mon.markedUntil > g.time) {
        mult *= 1 + mon.markedPct / 100;
      }
    }
    if (hookDef(g, "low_target_dmg") && mon.hpPct() < 0.4) {
      mult *= 1 + hookVal(g, "low_target_dmg") / 100;
    }
  }
  // 遗物:猎首(对头目/精英额外伤害)
  if (mon && (mon.boss || mon.elite)) {
    mult *= 1 + (g.hero.boss_dmg_r ?? 0) / 100;
  }
  if ((g.hero.next_hit_bonus ?? 0) > 0) {
    mult *= 1 + g.hero.next_hit_bonus / 100;
    g.hero.next_hit_bonus = 0;
  }
  return mult;
}

export function atkNow(g: Game): number {
  return g.hero.atk
    * (1 + buffPct(g, "atk") / 100)
    * (1 + buffPct(g, "all") / 100);
}

// ---------------------------------------------------------------- 主动施放
export function castActive(g: Game, sdef: ActiveSkill, mon: MonLike & {
  def_: number; atkDownPct: number; atkDownUntil: number;
  defDownPct: number; defDownUntil: number; stunUntil: number;
}): void {
  const lv = effLv(g, sdef.id);
  const kind = sdef.kind;
  if (kind === "damage" || kind === "multi") {
    let total = 0;
    for (let i = 0; i < (sdef.hits ?? 1); i++) {
      total += skillHit(g, mon, sdef, skillVal(sdef, lv));
    }
    if (sdef.lifesteal && total > 0) {
      const heal = total * sdef.lifesteal / 100;
      g.hero.hp = Math.min(g.hero.max_hp, g.hero.hp + heal);
      if (heal >= 1) g.addFloater("✚" + fmt(heal), "bright_green");
    }
    applyDebuffs(g, mon, sdef);
    if (sdef.freeze) {
      mon.stunUntil = g.time + sdef.freeze;
      g.addFloater("❄ 冻结", "bright_cyan");
    }
    if (sdef.mark) {
      mon.markedPct = sdef.mark;
      mon.markedUntil = g.time + (sdef.mark_dur ?? 0);
    }
  } else if (kind === "buff") {
    addBuff(g, sdef.stat!, skillVal(sdef, lv), sdef.dur!);
    g.emit("anim", "hero_attack");
    g.log(`${sdef.icon} ${sdef.name}!`, sdef.color);
  } else if (kind === "heal") {
    const heal = g.hero.max_hp * skillVal(sdef, lv) / 100;
    g.hero.hp = Math.min(g.hero.max_hp, g.hero.hp + heal);
    g.addFloater("✚" + fmt(heal), "bright_green");
  } else if (kind === "shield") {
    g.hero.shield = (g.hero.shield ?? 0) + g.hero.max_hp * skillVal(sdef, lv) / 100;
    g.addFloater("🛡" + fmt(g.hero.shield), "bright_cyan");
  } else if (kind === "execute") {
    if ((mon.boss || mon.elite) && mon.hpPct() < (sdef.threshold ?? 20) / 100) {
      mon.hp = 0;
      g.addFloater("☠ 处决!", "bright_magenta");
    } else {
      skillHit(g, mon, sdef, skillVal(sdef, lv));
      applyDebuffs(g, mon, sdef);
    }
  }
}

function skillHit(g: Game, mon: any, sdef: ActiveSkill, pct: number): number {
  const atk = atkNow(g);
  const pierce = Math.min((g.hero.armor_pierce ?? 0) / 100, 0.5);
  const defv = mon.def_ * (1 - pierce);
  let raw = _dmg(atk * pct / 100, defv);
  raw *= 1 + (g.hero.skill_dmg ?? 0) / 100;
  if (sdef.vs_elite && (mon.boss || mon.elite)) raw *= sdef.vs_elite;
  raw *= dmgMultipliers(g, mon);
  const crit = sdef.must_crit || g.rng.random() * 100 < g.hero.crit;
  if (crit) {
    raw *= 1 + g.hero.crit_dmg / 100;
    g.stats.crit_hits = (g.stats.crit_hits ?? 0) + 1;
    onCrit(g);
  }
  mon.hp -= raw;
  g.emit("anim", "hero_attack");
  g.emit("anim", "mob_flash");
  if (crit) {
    g.addFloater(`${sdef.icon} 暴击 -${fmt(raw)}`, "bright_yellow");
  } else {
    g.addFloater(`${sdef.icon} -${fmt(raw)}`, "white");
  }
  if (g.hero.lifesteal > 0 && g.hero.hp < g.hero.max_hp) {
    g.hero.hp = Math.min(g.hero.max_hp, g.hero.hp + raw * g.hero.lifesteal / 100);
  }
  return raw;
}

export function onCrit(g: Game): void {
  const d = hookDef(g, "on_crit_haste");
  if (d) addBuff(g, "haste", hookVal(g, "on_crit_haste"), d.dur ?? 3);
  if (hookDef(g, "on_crit_dmg_next")) {
    g.hero.next_hit_bonus = hookVal(g, "on_crit_dmg_next");
  }
}

function applyDebuffs(g: Game, mon: any, sdef: ActiveSkill): void {
  if (sdef.atk_down) {
    mon.atkDownPct = sdef.atk_down;
    mon.atkDownUntil = g.time + (sdef.atk_down_dur ?? 0);
  }
  if (sdef.def_down) {
    mon.defDownPct = sdef.def_down;
    mon.defDownUntil = g.time + (sdef.def_down_dur ?? 0);
  }
}

