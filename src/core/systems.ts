/** 外围系统:悬赏 / 成就 / resolve 懒结算(与 abyss/systems.py 一致) */
import { BAL, QUEST_TYPES, RARITY_IDX, ACHIEVEMENTS, ACTIVE_DEF, ALTAR_LINES } from "./data.ts";
import { pyRound, rollItem } from "./items.ts";
import { mobGold, mobXp, spawnMonster, tierOf } from "./combat.ts";
import type { Game } from "./game.ts";
import type { PyRandom } from "./rng.ts";
import type { StatMod } from "./skills.ts";

// ---------------------------------------------------------------- 悬赏
export interface Quest { type: string; target: number; progress: number; gold: number; stones: number }

export function rollQuest(zone: number, rng: PyRandom): Quest {
  const qt = rng.choice(QUEST_TYPES);
  const target = Math.max(1, pyRound(qt.base * Math.pow(qt.growth, Math.max(0, zone - 1))));
  const t = (zone - 1) * 10;
  const goldBase = BAL.gold0 + BAL.gold_k * Math.pow(t, BAL.gold_p);
  const gold = Math.trunc(goldBase * qt.goldK * (1 + rng.uniform(0, 0.3)));
  return { type: qt.type, target, progress: 0, gold, stones: qt.stones };
}

export function questDesc(q: Quest): string {
  const tpl = QUEST_TYPES.find(t => t.type === q.type)!.tpl;
  return tpl.replace("{n}", String(q.target));
}

// ---------------------------------------------------------------- 成就
/** 深渊祭坛等级 → 统一修饰器(与成就同管道:先 add 后 pct 再截断) */
export function altarMods(altarLv: Record<string, number>): StatMod[] {
  const mods: StatMod[] = [];
  for (const line of ALTAR_LINES) {
    const lv = altarLv[line.id] ?? 0;
    if (lv <= 0) continue;
    mods.push({ stat: line.stat as never, op: line.op, v: line.per * lv });
  }
  return mods;
}

export function achievementMods(stats: Record<string, number>): StatMod[] {
  const mods: StatMod[] = [];
  for (const a of ACHIEVEMENTS) {
    const val = stats[a.metric] ?? 0;
    let tiers = 0;
    for (const t of a.thresholds) if (val >= t) tiers++;
    if (tiers <= 0) continue;
    const v = a.per * tiers;
    const op: "add" | "pct" = (a.stat === "crit" || a.stat === "goldfind") ? "add" : "pct";
    mods.push({ stat: a.stat, op, v });
  }
  return mods;
}

export function achievementTiers(aid: string, val: number): [number, number] {
  for (const a of ACHIEVEMENTS) {
    if (a.id === aid) {
      let n = 0;
      for (const t of a.thresholds) if (val >= t) n++;
      return [n, a.thresholds.length];
    }
  }
  return [0, 0];
}

// ---------------------------------------------------------------- 自动换装
export function autoEquipCheck(g: Game, item: any): boolean {
  if (!g.settings.auto_equip) return false;
  const cur = g.equip[item.slot];
  if (!cur || item.score() > cur.score() * 1.05) {
    g.equipItem(item, true);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- 懒结算
export function heroDps(g: Game, mobDef: number, mobHp: number, bossOrElite: boolean):
  [number, number, number] {
  const h = g.hero;
  let atkMult = 1, swingDiv = 1, dmgMult = 1;
  let skillDps = 0;
  let effHp = mobHp;
  const skillMult = 1 + (h.skill_dmg ?? 0) / 100;

  for (const sid of g.loadout.active) {
    const d = ACTIVE_DEF[sid];
    if (!d) continue;
    const cd = Math.max(0.5, d.cd * (1 - Math.min((h.cd_reduce ?? 0) / 100, 0.4)));
    const kind = d.kind;
    const v = d.base + (d.per ?? 0) * (effLvOf(g, sid) - 1);
    if (kind === "damage" || kind === "multi") {
      let dmgPct = v * (d.hits ?? 1);
      if (d.must_crit) dmgPct *= 1 + h.crit_dmg / 100;
      else if (d.vs_elite && bossOrElite) dmgPct *= d.vs_elite;
      skillDps += h.atk * dmgPct / 100 / cd * skillMult;
    } else if (kind === "buff") {
      const cov = Math.min(1, (d.dur ?? 0) / cd);
      const stat = d.stat;
      if (stat === "atk") atkMult *= 1 + v / 100 * cov;
      else if (stat === "haste") swingDiv *= 1 + v / 100 * cov;
      else if (stat === "dmg_pct" || stat === "all") dmgMult *= 1 + v / 100 * cov;
    } else if (kind === "execute") {
      if (bossOrElite) {
        effHp = mobHp * (1 - (d.threshold ?? 20) / 100);
      } else {
        skillDps += h.atk * d.base / 100 / cd * skillMult;
      }
    }
  }

  const atkEff = h.atk * atkMult;
  const swing = h.interval / (1 + h.haste / 100) / swingDiv;
  const hit = atkEff * atkEff / (atkEff + Math.max(0, mobDef));
  const critf = 1 + h.crit / 100 * h.crit_dmg / 100;
  const perBaseHit = hit * critf;
  const dps = perBaseHit / swing * dmgMult + skillDps * dmgMult;
  return [dps, perBaseHit, effHp];
}

function effLvOf(g: Game, sid: string): number {
  // 与 skills.effLv 相同(避免运行时循环依赖的本地副本语义)
  const equipBonus = Math.trunc(g.hero.skill_lv ?? 0);
  let relicLv = 0;
  for (const r of g.relics) {
    if (r && r.skillId === sid) {
      for (const e of r.effects) {
        if (e.id === "skill_lv_r") relicLv += Math.trunc(e.val);
      }
    }
  }
  return Math.max(1, g.skillLv[sid] ?? 1) + equipBonus + relicLv;
}

function netIncoming(g: Game, mobAtk: number, mobInterval: number, _dps: number,
                    skill?: { mult: number; hits?: number; cd: number } | null): number {
  const h = g.hero;
  let hit = mobAtk * mobAtk / (mobAtk + Math.max(0, h.def));
  let inc = hit / mobInterval;
  inc *= 1 - Math.min(h.dodge ?? 0, 40) / 100;
  if (skill) {
    const mult = skill.mult * (skill.hits ?? 1);
    inc += mobAtk * mult * 0.7 / skill.cd;  // 0.7: 减伤口径折算
  }
  const regen = _dps * h.lifesteal / 100;
  return inc - regen;
}

function rollKnives(rng: PyRandom, hp: number, hit: number, pCrit: number,
                    critMul: number, cap = 64): number {
  let n = 0, rem = hp;
  while (rem > 0 && n < cap) {
    n++;
    const d = hit * (rng.random() < pCrit ? critMul : 1);
    rem -= d;
  }
  return n;
}

export interface ResolveReport {
  sec: number; kills: number; deaths: number; gold: number; xp: number;
  items: any[]; levels: number; zones: number;
}

export function resolve(g: Game, elapsed: number): ResolveReport {
  elapsed = Math.min(Math.max(0, elapsed), BAL.offline_cap_sec);
  let remaining = elapsed;
  const rep: ResolveReport = {
    sec: elapsed, kills: 0, deaths: 0, gold: 0, xp: 0, items: [], levels: 0, zones: 0,
  };
  const lv0 = g.level, zone0 = g.zone;
  const gold0 = g.gold;
  let xpTotal = 0;
  // 药剂增益窗口:离线期间按经过时间自然消耗(与实时战斗同口径,喝了再挂后台不白喝)
  const buffWin = (stat: string): { pct: number; rem: number } => {
    const b = g.buffs[stat];
    return b && b.until > g.time ? { pct: b.pct, rem: b.until - g.time } : { pct: 0, rem: 0 };
  };
  const xpB = buffWin("xp"), goldB = buffWin("gold");
  let xpRem = xpB.rem, goldRem = goldB.rem;
  let guard = Math.trunc(elapsed / 0.3) + 32;
  while (remaining > 1e-6 && guard > 0) {
    guard--;
    if (g.respawnTimer > 0) {
      const dt = Math.min(remaining, g.respawnTimer);
      g.respawnTimer -= dt;
      remaining -= dt;
      if (g.respawnTimer <= 0) g.hero.hp = g.hero.max_hp;
      continue;
    }
    // 与实时 spawn 同口径:传入最高装备 tier,离线补算同样吃等级压制
    let eqT = 0;
    for (const it of Object.values(g.equip)) eqT = Math.max(eqT, it.tier);
    const mon = spawnMonster(g.zone, g.stage, g.rng, eqT);
    const [dps, perBase, effHp] = heroDps(g, mon.def_, mon.hp, mon.boss || mon.elite);
    const swing = g.hero.interval / (1 + g.hero.haste / 100);
    let killT: number;
    if (dps <= 0 || perBase <= 0) {
      killT = 1e9;
    } else {
      const tEst = effHp / dps;
      const skillDps = Math.max(0, dps - perBase / swing);
      const skillTotal = skillDps * tEst;
      const pCrit = Math.min(1, g.hero.crit / 100);
      const critMul = 1 + g.hero.crit_dmg / 100;
      const baseHit = perBase / (1 + pCrit * (critMul - 1));
      const knives = rollKnives(g.rng, Math.max(0, effHp - skillTotal), baseHit, pCrit, critMul);
      killT = Math.max(0.3, swing * Math.max(1, knives));
    }
    const net = netIncoming(g, mon.atk, mon.interval, dps, mon.skill);
    const ttd = net > 0 ? g.hero.hp / net : 1e9;
    if (killT > ttd) {
      // 打不过:按存活时间死亡。推进态走完整退层/自动挂机;
      // 挂机层位是离线下限,原地复活再战,不被补算模型的近似误差逐次磨低
      remaining -= ttd + BAL.respawn_sec;
      xpRem -= ttd + BAL.respawn_sec;
      goldRem -= ttd + BAL.respawn_sec;
      g.hero.hp = 0;
      g.respawnTimer = BAL.respawn_sec;
      if (g.mode === "push") g.retreatStage();
      else g.stats.deaths += 1;
      rep.deaths++;
      continue;
    }
    remaining -= killT;
    xpRem -= killT;
    goldRem -= killT;
    g.hero.hp = Math.max(1, Math.min(g.hero.max_hp,
      g.hero.hp - killT * net + g.hero.max_hp * 0.08));
    g.stats.kills += 1;
    rep.kills += 1;
    let gold = mobGold(mon.tier)
      * (1 + g.hero.goldfind / 100 + (goldRem > 0 ? goldB.pct : 0) / 100);
    if (mon.boss) {
      gold *= BAL.boss_gold;
      g.stats.boss_kills += 1;
      g.questProgress("boss", 1);
      if (g.rng.random() < BAL.boss_stone_chance) g.stones += BAL.boss_stone_amt;
    } else if (mon.elite) {
      gold *= BAL.elite_gold;
    }
    g.gold += Math.trunc(gold);
    g.stats.gold_earned += Math.trunc(gold);
    const xp = Math.trunc(mobXp(mon.tier)
      * (1 + (g.hero.xp_pct ?? 0) / 100 + (xpRem > 0 ? xpB.pct : 0) / 100));
    xpTotal += xp;
    g.gainXp(xp);
    g.questProgress("kill", 1);
    let chance: number = mon.elite ? BAL.elite_drop : BAL.drop_chance;
    if (mon.boss) chance = BAL.boss_drop;
    if (g.rng.random() < chance) {
      const item = rollItem(mon.tier, g.rng, g.hero.luck ?? 0,
        mon.boss ? 2 : 0, mon.boss ? 0.6 : mon.elite ? 0.25 : 0, g.classId);
      if (rep.items.length < BAL.offline_item_cap) rep.items.push(item);
      g.addItem(item);
      if (RARITY_IDX[item.rarity] >= 2) g.questProgress("loot", 1);
    }
    g.advanceZoneStage();
  }
  g.time += elapsed;
  g.playtime += elapsed;
  rep.gold = g.gold - gold0;
  rep.xp = xpTotal;
  rep.levels = g.level - lv0;
  rep.zones = g.zone - zone0;
  g.events.length = 0;
  return rep;
}

export function resolveOffline(g: Game, dtSec: number): ResolveReport | null {
  if (dtSec < BAL.offline_min_sec) return null;
  const rep = resolve(g, dtSec);
  if (rep.kills <= 0 && rep.deaths <= 0 && rep.gold <= 0) return null;
  return rep;
}
