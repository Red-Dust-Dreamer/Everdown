/** 战斗引擎(与 abyss/combat.py 语义一致,随机全部走 g.rng) */
import { fmt } from "./ansi.ts";
import { ACTIVE_DEF as ACTIVE_LOOKUP, ART, BAL, MONSTERS, RARITY_IDX, THEMES } from "./data.ts";
import type { MobSkill } from "./data.ts";
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
  dotPct = 0;        // 持续伤害(燃烧/流血/灼命):每跳% 攻击力
  dotUntil = 0;
  dotNextAt = 0;
  dotTick = 0.5;
  dotLifesteal = 0;
  dotIcon = "";
  dotLabel = "";
  skill: MobSkill | null;
  skillTimer: number;
  id: string;   // 怪物图鉴 id(供 Web 宿主映射立绘;不参与任何计算)

  constructor(name: string, art: string[], color: Color, hp: number, atk: number,
              def_: number, interval: number, boss: boolean, elite: boolean, tier: number,
              skill: MobSkill | null, id = "") {
    this.name = name; this.art = art; this.color = color;
    this.hp = this.maxHp = hp;
    this.atk = atk; this.def_ = def_; this.interval = interval;
    this.boss = boss; this.elite = elite; this.tier = tier;
    this.skill = skill;
    // 首放:普通/精英怪 2 秒(速刷时也能见到技能);boss 保持半 CD(战斗长必可见,提前徒增难度)
    this.skillTimer = skill ? (boss ? skill.cd * 0.5 : Math.min(skill.cd * 0.5, 2)) : 0;
    this.id = id;
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

export function spawnMonster(zone: number, stage: number, rng: PyRandom,
                             heroGearTier?: number): Monster {
  const tier = tierOf(zone, stage);
  const [themeName, pool, bossName, themeColor] = zoneTheme(zone);
  const boss = stage >= 10;
  const key = rng.choice(pool);
  const mob = MONSTERS[key];
  let hp = (BAL.mob_hp0 + BAL.mob_hp_k * Math.pow(tier, BAL.mob_hp_p)) * mob.power;
  let atk = (BAL.mob_atk0 + BAL.mob_atk_k * Math.pow(tier, BAL.mob_atk_p)) * mob.power;
  // 等级压制:怪物tier超过装备最高tier 100+,每差100 → 全属性×2(叠乘)
  if (heroGearTier !== undefined && tier - heroGearTier > BAL.gear_gap_base) {
    const pressure = Math.pow(BAL.gear_gap_mult,
      (tier - heroGearTier - BAL.gear_gap_base) / 100);
    hp *= pressure;
    atk *= pressure;
  }
  const dfn = BAL.mob_def0 + BAL.mob_def_k * Math.pow(tier, BAL.mob_def_p);
  let name = mob.name, color: Color = mob.color;
  let skill = mob.skill;
  let elite = false;
  let interval: number = BAL.mob_interval;
  if (boss) {
    name = bossName;
    hp *= BAL.boss_hp;
    atk *= BAL.boss_atk;
    color = "bright_yellow";
    interval = BAL.boss_interval;
    skill = { name: "灭世之击", icon: "☄", cd: 12, mult: 3.0, hits: 1, stun: 1.5 };
  } else if (zone > 1 && rng.random() < BAL.elite_chance) {
    elite = true;
    hp *= BAL.elite_hp;
    atk *= BAL.elite_atk;
    color = "bright_green";
  }
  return new Monster(name, ART[key], color, hp, atk, dfn, interval, boss, elite, tier, skill, key);
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
  if (h.hp <= 0) {
    // 死亡窗口内自动存档的档:重载后 hp=0 且复活计时是瞬态不入档,补上倒计时防永久卡死
    if (g.respawnTimer <= 0) g.respawnTimer = BAL.respawn_sec;
    return;
  }
  S.tickBuffs(g);
  // 终局一击(手动大招)CD 递减:与 castSkills 的『g.skillCd[sid] ?? 0』同范式 ——
  // ULTS 不进 skillCd 重建循环(constructor/fromDict 只铺 ACTIVE_SKILLS 键),
  // 未释放过时 ult 键不存在;条件写保证不写入 NaN,释放后才落键递减。
  // 放在 `if (!mon) return` 之前:换怪间隙 CD 照走(在线 tick 才走,
  // 离线 resolveOffline 不放大招 —— 手动特权)。注意:复活倒计时与死亡窗口
  // 已被上方 respawnTimer/hp<=0 两个提前 return 挡住,期间 CD 不递减
  // (与 castSkills 的技能 CD 同口径,更保守)。
  const ultDef = g.ultOf();
  if (ultDef) {
    const ucd = g.skillCd[ultDef.id] ?? 0;
    if (ucd > 0) g.skillCd[ultDef.id] = ucd - dt;
  }
  if (!mon) return;

  castSkills(g, dt, mon);

  if (g.burst) {
    // 引导攻击(旋风斩):独立节拍逐跳出手;期间不出手其他攻击(普攻也暂停)。
    // 与 dot 同理不吃控制;目标倒下不打断引导——只有英雄死亡才断(见 onHeroDeath),
    // 本拍让位给击杀结算,新怪顶上后剩余跳数继续
    while (g.burst && g.burst.nextAt <= g.time) {
      if (mon.hp <= 0) break;   // 目标已死:引导保留,待下方结算换目标后续跳
      g.burst.nextAt += g.burst.interval;
      S.skillHit(g, mon, ACTIVE_LOOKUP[g.burst.sid], g.burst.pct);
      g.burst.left -= 1;
      if (g.burst.left <= 0) g.burst = null;
    }
  } else if ((h.stun_until ?? 0) <= g.time) {
    h.atk_timer += dt;
    let interval = h.interval / (1 + (h.haste + S.buffPct(g, "haste")) / 100);
    if ((h.slow_until ?? 0) > g.time) {
      // 减速拉长攻击间隔;钳制最多 ×4,防多来源叠出无限慢
      interval /= Math.max(0.25, 1 - (h.slow_pct ?? 0) / 100);
    }
    while (h.atk_timer >= interval) {
      h.atk_timer -= interval;
      heroAttack(g, mon);
    }
  }

  // 持续伤害(燃烧/流血/灼命):独立节拍,不吃出手顺序与控制,冻结中也照烧
  while (mon.dotUntil > g.time && mon.dotNextAt <= g.time) {
    mon.dotNextAt += mon.dotTick;
    if (S.dotTickDamage(g, mon)) break;
  }

  if (mon.hp <= 0) {
    onMonsterKilled(g, mon);
    return;
  }

  if (mon.stunUntil > g.time) return;
  if (mon.skill) {
    mon.skillTimer += dt;
    if (mon.skillTimer >= mon.skill.cd) {
      mon.skillTimer = 0;
      castMonsterSkill(g, mon);
      if (h.hp <= 0) {
        onHeroDeath(g);
        return;
      }
      return;  // 技能回合不接普攻
    }
  }
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

function castMonsterSkill(g: Game, mon: Monster): void {
  const h = g.hero;
  const sk = mon.skill!;
  // Web 宿主按技能名播专属特效(mskill:<名字>);CLI 忽略 anim 事件,不参与计算
  g.emit("anim", "mskill:" + sk.name);
  let total = 0;
  let defv = h.def;
  if ((h.defdown_until ?? 0) > g.time) defv *= 1 - (h.defdown_pct ?? 0) / 100;
  for (let i = 0; i < (sk.hits ?? 1); i++) {
    total += _dmg(mon.atk * sk.mult, defv);
  }
  const shield = h.shield ?? 0;
  if (shield > 0) {
    const absorb = Math.min(shield, total);
    h.shield = shield - absorb;
    total -= absorb;
    if (absorb > 0) g.dmg("absorb", absorb);
  }
  h.hp -= total;
  g.dmg("mskill", total);
  g.addFloater(`${sk.icon} -${fmt(total)}`, "bright_red");
  g.log(`敌方 ${mon.name} 施放了【${sk.name}】!`, "bright_red");
  if (sk.lifesteal && total > 0) {
    mon.hp = Math.min(mon.maxHp, mon.hp + total);
    g.addFloater("+" + fmt(total), "magenta");
  }
  if (sk.defdown) {
    h.defdown_pct = sk.defdown[0];
    h.defdown_until = g.time + sk.defdown[1];
  }
  if (sk.atkdown) {
    h.atkdown_pct = sk.atkdown[0];
    h.atkdown_until = g.time + sk.atkdown[1];
  }
  if (sk.stun) {
    h.stun_until = g.time + sk.stun;
    g.addFloater("⛔ 眩晕", "bright_red");
  }
  if (sk.slow) {
    h.slow_pct = sk.slow[0];
    h.slow_until = g.time + sk.slow[1];
    g.addFloater("🐌 减速", "bright_red");
  }
  // 不屈判定
  // 遗物:不死(独立判定,60s CD)
  if (h.hp <= 0 && (h.deathward ?? 0) > 0) {
    const dwReady = h.deathward_at ?? -999;
    if (g.time - dwReady >= 60
        && g.rng.random() * 100 < h.deathward) {
      h.hp = 1;
      h.deathward_at = g.time;
      g.addFloater("🛡不死!", "bright_cyan");
      g.log("遗物·不死!致命一击被挡下。", "bright_cyan");
    }
  }
  if (h.hp <= 0 && S.hookDef(g, "undying")) {
    const ready = h.undying_at ?? -999;
    if (g.time - ready >= BAL.undying_cd
        && g.rng.random() * 100 < S.hookVal(g, "undying")) {
      h.hp = 1;
      h.undying_at = g.time;
      g.addFloater("不屈!", "bright_yellow");
    }
  }
}

function heroAttack(g: Game, mon: Monster): void {
  const h = g.hero;
  let atk = S.atkNow(g);
  if ((h.atkdown_until ?? 0) > g.time) atk *= 1 - (h.atkdown_pct ?? 0) / 100;
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
  g.dmg("atk", dmg, crit);
  g.emit("anim", "hero_attack");
  g.emit("anim", "mob_flash");
  if (crit) {
    g.addFloater("暴击 -" + fmt(dmg), "bright_yellow");
    S.onCrit(g);
    // 遗物:暴击追击
    const ce = h.crit_extra ?? 0;
    if (ce > 0 && g.rng.random() * 100 < ce) {
      const extra = _dmg(atk, mon.def_ * (1 - pierce));
      mon.hp -= extra;
      g.dmg("crit_extra", extra);
      g.addFloater("⚡追击 -" + fmt(extra), "bright_cyan");
    }
  } else {
    g.addFloater("-" + fmt(dmg), "white");
  }
  if (h.lifesteal > 0 && h.hp < h.max_hp) {
    const heal = Math.min(h.max_hp - h.hp, dmg * h.lifesteal / 100);
    h.hp += heal;
    if (heal > 0) g.dmg("heal", heal);
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
    // 引导期间不施放任何技能(冷却照走,引导结束后到期的下一拍补上)
    if (g.burst) continue;
    if (d.kind === "heal" && h.hp >= h.max_hp * 0.6) continue;
    S.castActive(g, d, mon);
    g.skillCd[sid] = d.cd * cdCut;
    break;   // 技能不能同时放:一拍只出手一个,同拍多个就绪按装配顺序排队下一拍补发
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
  let defv = h.def;
  if ((h.defdown_until ?? 0) > g.time) defv *= 1 - (h.defdown_pct ?? 0) / 100;
  let raw = _dmg(atk, defv);
  const shield = h.shield ?? 0;
  if (shield > 0) {
    const absorb = Math.min(shield, raw);
    h.shield = shield - absorb;
    raw -= absorb;
    if (absorb > 0) g.dmg("absorb", absorb);
    if (absorb >= 1) g.addFloater("🛡-" + fmt(absorb), "bright_cyan");
  }
  if (raw <= 0) return;
  h.hp -= raw;
  g.dmg("mob", raw);
  g.addFloater("-" + fmt(raw), "red");
  g.emit("anim", "mob_attack");
  // 不屈:致命伤概率保留1血(内置CD)
  // 遗物:不死(独立判定,60s CD)
  if (h.hp <= 0 && (h.deathward ?? 0) > 0) {
    const dwReady = h.deathward_at ?? -999;
    if (g.time - dwReady >= 60
        && g.rng.random() * 100 < h.deathward) {
      h.hp = 1;
      h.deathward_at = g.time;
      g.addFloater("🛡不死!", "bright_cyan");
      g.log("遗物·不死!致命一击被挡下。", "bright_cyan");
    }
  }
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
  g.emit("anim", "mon_die");   // 宿主死亡表现(白闪/烟尘消散;表现层用)
  if (g.lastSpawnTime !== null) {
    const kt = Math.max(0.5, g.time - g.lastSpawnTime);
    g.emaKill = g.emaKill ? g.emaKill * 0.7 + kt * 0.3 : kt;
  }
  let gold = mobGold(mon.tier) * (1 + (h.goldfind + S.buffPct(g, "gold")) / 100);
  if (mon.boss) gold *= BAL.boss_gold;
  else if (mon.elite) gold *= BAL.elite_gold;

  g.stats.kills += 1;
  g.monKills[mon.id] = (g.monKills[mon.id] ?? 0) + 1;   // 图鉴:分怪计数(普通/精英/头目合并)
  g.weeklyBump("kills", 1);                              // 周常:本周击杀
  h.hp = Math.min(h.max_hp, h.hp + h.max_hp * 0.08);
  g.gold += Math.trunc(gold);
  g.stats.gold_earned += Math.trunc(gold);
  if (mon.boss) {
    g.stats.boss_kills += 1;
    g.weeklyBump("boss", 1);                              // 周常:本周头目
    if (g.rng.random() < BAL.boss_stone_chance) g.stones += BAL.boss_stone_amt;
  }
  g.gainXp(Math.trunc(mobXp(mon.tier)
    * (1 + (h.xp_pct ?? 0) / 100 + S.buffPct(g, "xp") / 100)));
  g.questProgress("kill", 1);
  if (mon.boss) g.questProgress("boss", 1);

  const d = S.hookDef(g, "on_kill_buff");
  if (d) S.addBuff(g, d.stat!, S.hookVal(g, "on_kill_buff"), d.dur ?? 4);
  // 遗物:击杀回血 + 杀意攻速
  const kh = h.kill_heal ?? 0;
  if (kh > 0) {
    g.hero.hp = Math.min(g.hero.max_hp, g.hero.hp + g.hero.max_hp * kh / 100);
  }
  const ks = h.kill_haste ?? 0;
  if (ks > 0) S.addBuff(g, "haste", ks, 4);

  let dropChance: number = BAL.drop_chance;
  if (mon.elite) dropChance = BAL.elite_drop;
  if (mon.boss) dropChance = BAL.boss_drop;
  if (g.rng.random() < dropChance) {
    const minIdx = mon.boss ? 2 : 0;
    const boost = mon.boss ? 0.6 : mon.elite ? 0.25 : 0;
    const item = rollItem(mon.tier, g.rng, h.luck ?? 0, minIdx, boost, g.classId, g.zone);
    g.addItem(item);
    if (RARITY_IDX[item.rarity] >= 2) g.questProgress("loot", 1);
    // 紫色(epic)或更好:发掉落光柱事件(宿主表现层用,纯视觉)
    if (RARITY_IDX[item.rarity] >= 3) g.emit("anim", "loot:" + item.rarity);
  }

  if (g.inTower) {
    g.monster = mon;  // 保留引用给 towerExit 用
    g.towerExit(true);
    return;
  }
  if (mon.boss) g.log(`♛ 击败头目 ${mon.name}!前进到新区域!`, "bright_yellow");
  g.monster = null;
  g.advanceStage();
}

function onHeroDeath(g: Game): void {
  g.hero.hp = 0;
  g.hero.shield = 0;
  g.burst = null;   // 引导中断(旋风斩等)
  g.respawnTimer = BAL.respawn_sec;
  if (g.inTower) {
    g.towerExit(false);
    return;
  }
  g.log(`☠ 你被击败了…${Math.trunc(BAL.respawn_sec)} 秒后复活`, "bright_red");
  g.retreatStage();
  g.monster = null;
}
