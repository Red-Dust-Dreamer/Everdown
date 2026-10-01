/** 战斗引擎(与 abyss/combat.py 语义一致,随机全部走 g.rng) */
import { fmt } from "./ansi.ts";
import { ACTIVE_DEF as ACTIVE_LOOKUP, ART, BAL, MONSTERS, RARITY_IDX, THEMES } from "./data.ts";
import { rollItem } from "./items.ts";
import * as S from "./skills.ts";
import type { Game } from "./game.ts";
import type { PyRandom } from "./rng.ts";
import type { Color } from "./ansi.ts";

export class Monster implements S.MonLike {
  name: string;
  art: string[];
  color: Color;
  hp: number;
  maxHp: number;
  atk: number;
  def_: number;
  interval: number;
  boss: boolean;
  elite: boolean;
  tier: number;
  atkTimer = 0;
  stunUntil = 0;
  markedPct = 0;
  markedUntil = 0;
  atkDownPct = 0;
  atkDownUntil = 0;
  defDownPct = 0;
  defDownUntil = 0;

  constructor(name: string, art: string[], color: Color, hp: number, atk: number,
              def_: number, interval: number, boss: boolean, elite: boolean, tier: number) {
    this.name = name; this.art = art; this.color = color;
    this.hp = this.maxHp = hp;
    this.atk = atk; this.def_ = def_; this.interval = interval;
    this.boss = boss; this.elite = elite; this.tier = tier;
  }
  hpPct(): number { return this.maxHp ? this.hp / this.maxHp : 0; }
}

export function zoneTheme(zone: number): [string, string[], string, Color] {
  const t = THEMES[(zone - 1) % THEMES.length];
  const cycle = Math.floor((zone - 1) / THEMES.length);
  const name = cycle > 0 ? `${t.name}·深度${cycle + 1}` : t.name;
  return [name, t.mobs, t.boss, t.color];
}

export function tierOf(zone: number, stage: number): number {
  return (zone - 1) * 10 + (stage - 1);
}

export function mobGold(tier: number): number {
  return BAL.gold0 + BAL.gold_k * Math.pow(tier, BAL.gold_p);
}

export function mobXp(tier: number): number {
  return BAL.xp0 + BAL.xp_k * Math.pow(tier, BAL.xp_p);
}

export function spawnMonster(zone: number, stage: number, rng: PyRandom): Monster {
  const tier = tierOf(zone, stage);
  const [themeName, pool, bossName, themeColor] = zoneTheme(zone);
  const boss = stage >= 10;
  const key = rng.choice(pool);
  const mob = MONSTERS[key];
  let hp = (BAL.mob_hp0 + BAL.mob_hp_k * Math.pow(tier, BAL.mob_hp_p)) * mob.power;
  let atk = (BAL.mob_atk0 + BAL.mob_atk_k * Math.pow(tier, BAL.mob_atk_p)) * mob.power;
  const dfn = BAL.mob_def0 + BAL.mob_def_k * Math.pow(tier, BAL.mob_def_p);
  let name = mob.name, color: Color = mob.color;
  let elite = false;
  let interval: number = BAL.mob_interval;
  if (boss) {
    name = bossName;
    hp *= BAL.boss_hp;
    atk *= BAL.boss_atk;
    color = "bright_yellow";
    interval = BAL.boss_interval;
  } else if (zone > 1 && rng.random() < BAL.elite_chance) {
    elite = true;
    hp *= BAL.elite_hp;
    atk *= BAL.elite_atk;
    color = "bright_green";
  }
  return new Monster(name, ART[key], color, hp, atk, dfn, interval, boss, elite, tier);
}

/** 平滑减伤:atk²/(atk+def) */
export function _dmg(atkVal: number, defVal: number): number {
  if (atkVal <= 0) return 0;
  return atkVal * atkVal / (atkVal + Math.max(0, defVal));
}

export function battleTick(g: Game, dt: number): void {
  const h = g.hero;
  const mon = g.monster;

  if (g.respawnTimer > 0) {
    g.respawnTimer -= dt;
    if (g.respawnTimer <= 0) {
      h.hp = h.max_hp;
      g.log("你重新站了起来,继续战斗!", "bright_yellow");
    }
    return;
  }
  if (h.hp <= 0) return;
  S.tickBuffs(g);
  if (!mon) return;

  castSkills(g, dt, mon);

  h.atk_timer += dt;
  const interval = h.interval / (1 + (h.haste + S.buffPct(g, "haste")) / 100);
  while (h.atk_timer >= interval) {
    h.atk_timer -= interval;
    heroAttack(g, mon);
  }

  if (mon.hp <= 0) {
    onMonsterKilled(g, mon);
    return;
  }

  if (mon.stunUntil > g.time) return;
  mon.atkTimer += dt;
  while (mon.atkTimer >= mon.interval) {
    mon.atkTimer -= mon.interval;
    monsterAttack(g, mon);
    if (h.hp <= 0) {
      onHeroDeath(g);
      return;
    }
  }
}

function heroAttack(g: Game, mon: Monster): void {
  const h = g.hero;
  const atk = S.atkNow(g);
  const pierce = Math.min((h.armor_pierce ?? 0) / 100, 0.5);
  let defv = mon.def_;
  if (mon.defDownUntil > g.time) defv *= 1 - mon.defDownPct / 100;
  defv *= 1 - pierce;
  let dmg = _dmg(atk, defv);
  const crit = g.rng.random() * 100 < h.crit;
  if (crit) {
    dmg *= 1 + h.crit_dmg / 100;
    g.stats.crit_hits = (g.stats.crit_hits ?? 0) + 1;
  }
  dmg *= S.dmgMultipliers(g, mon);
  mon.hp -= dmg;
  g.emit("anim", "hero_attack");
  g.emit("anim", "mob_flash");
  if (crit) {
    g.addFloater("暴击 -" + fmt(dmg), "bright_yellow");
    S.onCrit(g);
  } else {
    g.addFloater("-" + fmt(dmg), "white");
  }
  if (h.lifesteal > 0 && h.hp < h.max_hp) {
    h.hp = Math.min(h.max_hp, h.hp + dmg * h.lifesteal / 100);
  }
}

function castSkills(g: Game, dt: number, mon: Monster): void {
  const h = g.hero;
  const cdCut = 1 - Math.min((h.cd_reduce ?? 0) / 100, 0.4);
  for (const sid of g.loadout.active) {
    const d = ACTIVE_LOOKUP[sid];
    if (!d) continue;
    const cd = g.skillCd[sid] ?? 0;
    if (cd > 0) {
      g.skillCd[sid] = cd - dt;
      if (g.skillCd[sid] > 0) continue;
    }
    if (d.kind === "heal" && h.hp >= h.max_hp * 0.6) continue;
    S.castActive(g, d, mon);
    g.skillCd[sid] = d.cd * cdCut;
  }
}

function monsterAttack(g: Game, mon: Monster): void {
  const h = g.hero;
  const dodge = Math.min(h.dodge ?? 0, 40);
  if (dodge > 0 && g.rng.random() * 100 < dodge) {
    g.addFloater("闪避", "bright_cyan");
    return;
  }
  let atk = mon.atk;
  if (mon.atkDownUntil > g.time) atk *= 1 - mon.atkDownPct / 100;
  let raw = _dmg(atk, h.def);
  const shield = h.shield ?? 0;
  if (shield > 0) {
    const absorb = Math.min(shield, raw);
    h.shield = shield - absorb;
    raw -= absorb;
    if (absorb >= 1) g.addFloater("🛡-" + fmt(absorb), "bright_cyan");
  }
  if (raw <= 0) return;
  h.hp -= raw;
  g.addFloater("-" + fmt(raw), "red");
  g.emit("anim", "mob_attack");
  if (h.hp <= 0 && S.hookDef(g, "undying")) {
    const ready = h.undying_at ?? -999;
    if (g.time - ready >= BAL.undying_cd
        && g.rng.random() * 100 < S.hookVal(g, "undying")) {
      h.hp = 1;
      h.undying_at = g.time;
      g.addFloater("不屈!", "bright_yellow");
      g.log("不屈!你在致命一击下坚持了下来。", "bright_yellow");
    }
  }
  const d = S.hookDef(g, "on_hurt_dmg");
  if (d) S.addBuff(g, "dmg_pct", S.hookVal(g, "on_hurt_dmg"), d.dur ?? 4);
}

function onMonsterKilled(g: Game, mon: Monster): void {
  const h = g.hero;
  if (g.lastSpawnTime !== null) {
    const kt = Math.max(0.5, g.time - g.lastSpawnTime);
    g.emaKill = g.emaKill ? g.emaKill * 0.7 + kt * 0.3 : kt;
  }
  let gold = mobGold(mon.tier) * (1 + h.goldfind / 100);
  if (mon.boss) gold *= BAL.boss_gold;
  else if (mon.elite) gold *= BAL.elite_gold;

  g.stats.kills += 1;
  h.hp = Math.min(h.max_hp, h.hp + h.max_hp * 0.08);
  g.gold += Math.trunc(gold);
  g.stats.gold_earned += Math.trunc(gold);
  if (mon.boss) {
    g.stats.boss_kills += 1;
    if (g.rng.random() < BAL.boss_stone_chance) g.stones += BAL.boss_stone_amt;
  }
  g.gainXp(Math.trunc(mobXp(mon.tier) * (1 + (h.xp_pct ?? 0) / 100)));
  g.questProgress("kill", 1);
  if (mon.boss) g.questProgress("boss", 1);

  const d = S.hookDef(g, "on_kill_buff");
  if (d) S.addBuff(g, d.stat!, S.hookVal(g, "on_kill_buff"), d.dur ?? 4);

  let dropChance: number = BAL.drop_chance;
  if (mon.elite) dropChance = BAL.elite_drop;
  if (mon.boss) dropChance = BAL.boss_drop;
  if (g.rng.random() < dropChance) {
    const minIdx = mon.boss ? 2 : 0;
    const boost = mon.boss ? 0.6 : mon.elite ? 0.25 : 0;
    const item = rollItem(mon.tier, g.rng, h.goldfind, minIdx, boost);
    g.addItem(item);
    if (RARITY_IDX[item.rarity] >= 2) g.questProgress("loot", 1);
  }

  if (mon.boss) g.log(`♛ 击败头目 ${mon.name}!前进到新区域!`, "bright_yellow");
  g.monster = null;
  g.advanceStage();
}

function onHeroDeath(g: Game): void {
  g.hero.hp = 0;
  g.hero.shield = 0;
  g.respawnTimer = BAL.respawn_sec;
  g.log(`☠ 你被击败了…${Math.trunc(BAL.respawn_sec)} 秒后复活`, "bright_red");
  g.retreatStage();
  g.monster = null;
}
