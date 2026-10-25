/** TS 核心回归测试(纯 TS,无测试框架,断言 + console 输出)。
 *
 * 运行:node --experimental-strip-types src/tests/regression.ts
 *
 * 期望值来源:CPython 3.12 random.Random(MT19937)逐位对拍(2026-09 生成),
 * 参考移植历史回归项:RNG / 职业选择 / 技能键位 / 存档 v4 往返与 v3 迁移 /
 * stat_mods 挂口 / resolve 离线 / 渲染尺寸 / fmt & pyRound。
 *
 * 约定:每个测试项一个独立函数;失败抛错,由 runner 捕获打印明确信息,
 * 并置 exit code 1;全部通过输出 [ALL PASS]。
 * 对拍敏感的数值断言默认精确相等;若因已知核心分歧失败,允许改为 ±5%
 * 容差比较并标注 '对拍待修'(见 close() 调用处的注释)。
 */
import { PyRandom } from "../core/rng.ts";
import { Game, installSaveHooks, migrateSave, SAVE_VERSION, suitMods, currentWeekKey } from "../core/game.ts";
import type { SaveHooks } from "../core/game.ts";
import { View } from "../core/view.ts";
import { handleKey } from "../core/host.ts";
import { renderFrame } from "../core/render.ts";
import { BAL, CLASSES, ACHIEVEMENTS, MONSTERS, ART, ACTIVE_DEF, ACTIVE_SKILLS, RARITY_IDX, TOWER, SUITS, SUIT_DEF, THEMES, ULTS, ULT_DEF, STAT_NAMES, VIRTUAL_STATS, TITLES } from "../core/data.ts";
import type { ActiveSkill } from "../core/data.ts";
import { Monster, battleTick, tierOf, mobGold, _dmg, spawnMonster } from "../core/combat.ts";
import { towerMonster, refreshKeys, towerGold } from "../core/tower.ts";
import type { TowerState } from "../core/tower.ts";
import { castActive, skillDesc, dotVal } from "../core/skills.ts";
import { pyRound, Item, rollItem } from "../core/items.ts";
import { Relic, rollRelic } from "../core/relics.ts";
import { fmt, dwidth } from "../core/ansi.ts";
import { buffPct, atkNow, skillVal, effLv, dmgMultipliers } from "../core/skills.ts";
import { heroPower, powerWithEquip, powerWithRelic } from "../core/power.ts";
import type { ResolveReport } from "../core/systems.ts";
import { resolve, resolveOffline, rollQuest, heroDps } from "../core/systems.ts";
import { validateSaveDict } from "../core/savefile.ts";
import { makeSquad, parseSquad, arenaSimulate } from "../core/arena.ts";

// ================================================================ 断言工具
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: 期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}`);
  }
}
/** 数值近似(默认相对容差 1e-9 用于同公式浮点重算;
 *  对拍敏感项若因核心已知分歧失败,可改传 0.05 并在调用处标注 '对拍待修') */
function close(actual: number, expected: number, msg: string, tol = 1e-9): void {
  if (!(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)))) {
    throw new Error(`${msg}: 期望 ~${expected}, 实际 ${actual} (容差 ${tol})`);
  }
}
function eqNumArr(actual: number[], expected: number[], msg: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${msg}: 长度 期望 ${expected.length}, 实际 ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${msg}[${i}]: 期望 ${expected[i]}, 实际 ${actual[i]}`);
    }
  }
}
function eqStrArr(actual: string[], expected: string[], msg: string): void {
  if (actual.join(",") !== expected.join(",")) {
    throw new Error(`${msg}: 期望 [${expected.join(",")}], 实际 [${actual.join(",")}]`);
  }
}
/** 内存存档钩子:闭包持有 raw 字符串 */
function memHooks(): { raw: string } {
  const mem = { raw: "" };
  const hooks: SaveHooks = {
    write: (g: Game) => { mem.raw = JSON.stringify(g.toDict()); },
    readRaw: () => (mem.raw === "" ? null : mem.raw),
  };
  installSaveHooks(hooks);
  return mem;
}
function newGame(seed: number): Game {
  const g = new Game(seed);
  g.view = new View();
  return g;
}
function toastTexts(g: Game): string[] {
  return g.events.filter(e => e[0] === "toast").map(e => e[1]);
}

// ================================================================ 1. RNG
// 期望值由 CPython 3.12 random.Random 同 seed 生成(逐位一致)
const RNG_EXPECT: Record<number, {
  random5: number[]; randrange100: number[]; uniform25: number[];
  shuffle18: number[]; choice: string[];
}> = {
  20260930: {
    random5: [0.46278633479390463, 0.6305367777476237, 0.2223250469179695,
      0.30762479185941827, 0.5019525491658974],
    randrange100: [59, 51, 80],
    uniform25: [3.388359004381714, 3.891610333242871],
    shuffle18: [1, 5, 7, 3, 2, 6, 4, 8],
    choice: ["d", "d", "b"],
  },
  42: {
    random5: [0.6394267984578837, 0.025010755222666936, 0.27502931836911926,
      0.22321073814882275, 0.7364712141640124],
    randrange100: [81, 14, 3],
    uniform25: [3.9182803953736514, 2.0750322656680007],
    shuffle18: [4, 5, 7, 8, 3, 6, 1, 2],
    choice: ["a", "a", "c"],
  },
};

function testRng(): void {
  for (const seed of [20260930, 42]) {
    const exp = RNG_EXPECT[seed];
    const tag = `RNG seed=${seed}`;

    let r = new PyRandom(seed);
    const rnd: number[] = [];
    for (let i = 0; i < exp.random5.length; i++) rnd.push(r.random());
    eqNumArr(rnd, exp.random5, `${tag} random()`);

    r = new PyRandom(seed);
    const rr: number[] = [];
    for (let i = 0; i < exp.randrange100.length; i++) rr.push(r.randrange(100));
    eqNumArr(rr, exp.randrange100, `${tag} randrange(100)`);

    r = new PyRandom(seed);
    const uu: number[] = [];
    for (let i = 0; i < exp.uniform25.length; i++) uu.push(r.uniform(2, 5));
    eqNumArr(uu, exp.uniform25, `${tag} uniform(2,5)`);

    r = new PyRandom(seed);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    r.shuffle(arr);
    eqNumArr(arr, exp.shuffle18, `${tag} shuffle([1..8])`);

    r = new PyRandom(seed);
    const pool = ["a", "b", "c", "d", "e"];
    const picks: string[] = [];
    for (let i = 0; i < exp.choice.length; i++) picks.push(r.choice(pool));
    eqStrArr(picks, exp.choice, `${tag} choice`);
  }
}

// ================================================================ 2. 职业选择
function testClassChoose(): void {
  const g = newGame(7);
  eq(g.classId, null, "新档 classId 应为 null");
  const r = handleKey(g, "2");
  eq(r, true, "handleKey('2') 应返回 true");
  eq(g.classId, "mage", "handleKey('2') 后 classId 应为 mage");
  eq(g.loadout.active[0], "m_missile", "mage 初始主动技能应为 m_missile");
  eq(g.loadout.passive[0], "pm_affin", "mage 初始被动技能应为 pm_affin");

  // 三职业 chooseClass 后 recalc:hp/atk/def = BAL 基础值 × CLASSES.base
  // (职业初始被动参与 recalc:warrior 的 pw_tough 使 hp +8%)
  const expectPassive: Record<string, string> = {
    warrior: "pw_tough", mage: "pm_affin", ranger: "pr_swift",
  };
  for (const cid of ["warrior", "mage", "ranger"]) {
    const g2 = newGame(7);
    g2.chooseClass(cid);
    const cb = CLASSES[cid].base;
    let expHp = (BAL.hero_hp0 + BAL.hp_per_lv * (g2.level - 1)) * cb.hp;
    const expAtk = (BAL.hero_atk0 + BAL.atk_per_lv * (g2.level - 1)) * cb.atk;
    const expDef = (BAL.hero_def0 + BAL.def_per_lv * (g2.level - 1)) * cb.def;
    if (cid === "warrior") expHp *= 1.08; // pw_tough Lv1: 生命 +8%(pct)
    close(g2.hero.max_hp, expHp, `${cid} recalc max_hp`, 1e-9);
    close(g2.hero.atk, expAtk, `${cid} recalc atk`, 1e-9);
    close(g2.hero.def, expDef, `${cid} recalc def`, 1e-9);
    close(g2.hero.hp, g2.hero.max_hp, `${cid} chooseClass 后 hp 应满`, 1e-9);
    eq(g2.loadout.passive[0], expectPassive[cid], `${cid} 初始被动`);
    ok(g2.monster !== null, `${cid} chooseClass 后应已刷怪`);
  }
}

// ================================================================ 3. 技能键位冒烟
function testSkillKeys(): void {
  const g = newGame(99);
  handleKey(g, "3");
  eq(g.classId, "ranger", "handleKey('3') 应选择 ranger");
  // 跑一段战斗,保证有怪物/金币/日志状态
  for (let i = 0; i < 40; i++) g.tick(0.25);
  eq(g.view.ui.tab, 0, "初始 tab 应为 0");
  handleKey(g, "5");
  eq(g.view.ui.tab, 4, "handleKey('5') 应切到技能页(tab=4)");

  // 各键冒烟:不抛异常
  for (const key of ["left", "right", "left", "up", "up", "down", "down", "up",
    "e", "u", "left", "e", "u", "right", "down", "e"]) {
    handleKey(g, key); // 任何异常直接使本测试失败
  }

  // 装配槽满 toast:level=10 → 槽位 2(阈值 1/8),装满后再装应 toast 且不入列
  g.level = 10;
  g.loadout = { active: ["r_volley"], passive: ["pr_swift"] };
  g.recalcHero();
  g.events.length = 0;
  g.equipSkill("r_pierce", "active"); // unlock 5 ≤ 10,槽未满 → 成功
  ok(g.loadout.active.includes("r_pierce"), "r_pierce 应装配成功");
  ok(!toastTexts(g).some(t => t.includes("装配槽未解锁")), "首次装配不应提示槽未解锁");
  g.events.length = 0;
  g.equipSkill("r_mark", "active"); // unlock 8 ≤ 10,但槽满(2/2)
  ok(!g.loadout.active.includes("r_mark"), "槽满时 r_mark 不应入列");
  ok(toastTexts(g).some(t => t.includes("装配槽未解锁")), "槽满应 toast「装配槽未解锁」");

  // 卸下
  g.events.length = 0;
  g.unequipSkill("r_pierce");
  ok(!g.loadout.active.includes("r_pierce"), "卸下后 r_pierce 应移出装配");
  ok(toastTexts(g).some(t => t.includes("已卸下")), "卸下应 toast「已卸下」");

  // 升级:扣金币、等级 +1
  g.gold = 5000;
  const lvBefore = g.skillLv["r_volley"] ?? 1;
  const cost = g.skillCost("r_volley");
  ok(cost > 0, "技能升级费用应 > 0");
  g.skillUp("r_volley");
  eq(g.skillLv["r_volley"] ?? 1, lvBefore + 1, "skillUp 后等级应 +1");
  eq(g.gold, 5000 - cost, "skillUp 应精确扣费");
}

// ================================================================ 4. 存档 v4 往返 + v3 迁移
function testSaveRoundtrip(): void {
  const mem = memHooks();

  const g = newGame(11);
  g.chooseClass("warrior");
  g.gold = 1234;
  g.stones = 7;
  g.level = 5;
  g.xp = 10;
  g.skillLv["w_strike"] = 3;
  g.save();
  ok(mem.raw !== "", "save() 后内存存档应为非空");

  const d = JSON.parse(mem.raw);
  eq(d.version, SAVE_VERSION, "存档版本应为 v4");

  const g2 = Game.load();
  eq(g2.classId, "warrior", "往返后 classId");
  eq(g2.loadout.active[0], "w_strike", "往返后 loadout.active[0]");
  ok(g2.loadout.passive.includes("pw_tough"), "往返后 loadout.passive 应含 pw_tough");
  eq(g2.skillLv["w_strike"], 3, "往返后 skill_lv.w_strike");
  eq(g2.gold, 1234, "往返后 gold");
  eq(g2.stones, 7, "往返后 stones");
  eq(g2.level, 5, "往返后 level");
  eq(g2.seed, 11, "往返后 seed");
  eq(g2.pendingOffline, null, "刚存档即读取不应有离线结算");

  // 旧档 v3 迁移:skills:{strike:12, warcry:5} → warrior / w_strike=12 / pw_tough
  const v3 = {
    version: 3, seed: 5, gold: 100, stones: 0, level: 4, xp: 0,
    zone: 2, stage: 3, stage_kills: 0, deaths_row: 0, mode: "push", farm_stage: 1,
    skills: { strike: 12, warcry: 5, unknown_skill: 9 },
    equip: {}, bag: [], stats: {}, settings: {},
  };
  const m = migrateSave(JSON.parse(JSON.stringify(v3)));
  eq(m.version, SAVE_VERSION, "v3 迁移后应一路迁到最新版本");
  eq(m.class_id, "warrior", "v3 迁移后应为 warrior");
  eq(m.skill_lv["w_strike"], 12, "v3 迁移 strike:12 → w_strike=12");
  eq(m.skill_lv["w_warcry"], 5, "v3 迁移 warcry:5 → w_warcry=5");
  ok(!("unknown_skill" in m.skill_lv), "v3 未知技能不应进入 skill_lv");
  ok(Array.isArray(m.loadout.active) && m.loadout.active[0] === "w_strike",
    "v3 迁移 loadout.active[0] 应为 w_strike");
  ok(Array.isArray(m.loadout.passive) && m.loadout.passive.includes("pw_tough"),
    "v3 迁移 loadout.passive 应含 pw_tough");

  // 迁移后的档可直接 Game.load()
  mem.raw = JSON.stringify(m);
  const g3 = Game.load();
  eq(g3.classId, "warrior", "v3 迁移档 load 后 classId");
  eq(g3.skillLv["w_strike"], 12, "v3 迁移档 load 后 w_strike=12");
  eq(g3.gold, 100, "v3 迁移档 load 后 gold");
}

// ================================================================ 5. stat_mods 挂口
function testStatMods(): void {
  memHooks();
  const g = newGame(21);
  g.chooseClass("mage"); // mage 初始被动是 skill_dmg,haste 基准为 0
  const baseHaste = g.hero.haste;
  eq(baseHaste, 0, "mage 初始 haste 应为 0");

  g.addStatMod("t:1", "haste", "add", 10);
  eq(g.hero.haste, 10, "addStatMod(+10) 应立即生效");
  eq(g.statMods.length, 1, "应恰好挂 1 条修饰器");

  g.addStatMod("t:1", "haste", "add", 20); // 同 src 同 stat → 替换而非叠加
  eq(g.hero.haste, 20, "同 src 替换后 haste 应为 20");
  eq(g.statMods.length, 1, "同 src 替换后修饰器仍应只有 1 条");

  g.removeStatMod("t:1", "haste");
  eq(g.hero.haste, 0, "removeStatMod 后应恢复基准");
  eq(g.statMods.length, 0, "removeStatMod 后修饰器应清空");

  // 存档往返保留
  g.addStatMod("t:1", "haste", "add", 20);
  g.save();
  const g2 = Game.load();
  eq(g2.statMods.length, 1, "往返后 stat_mods 应保留 1 条");
  eq(g2.statMods[0].src, "t:1", "往返后 stat_mods.src");
  eq(g2.statMods[0].stat, "haste", "往返后 stat_mods.stat");
  eq(g2.statMods[0].v, 20, "往返后 stat_mods.v");
  eq(g2.hero.haste, 20, "往返后修饰器应参与 recalc 生效");
  g2.removeStatMod("t:1");
  eq(g2.hero.haste, 0, "往返后 remove 仍应恢复基准");
}

// ================================================================ 6. resolve 离线
function testResolveOffline(): void {
  const mem = memHooks();
  const g = newGame(33);
  g.chooseClass("warrior");
  for (let i = 0; i < 240; i++) g.tick(0.25); // 真跑 60 秒战斗
  g.save();
  ok(mem.raw !== "", "60 秒后应已可存档");
  ok(g.stats.kills > 0, "60 秒战斗应至少有击杀");

  // 伪造 last_saved = 2 小时前
  const d = JSON.parse(mem.raw);
  d.last_saved = Date.now() / 1000 - 7200;
  mem.raw = JSON.stringify(d);

  const g2 = Game.load();
  ok(g2.pendingOffline !== null, "离线 2 小时读取后 pendingOffline 应非空");
  const rep: ResolveReport = g2.pendingOffline!;
  ok(Number.isFinite(rep.kills) && rep.kills > 0, `离线击杀应 > 0(实际 ${rep.kills})`);
  ok(Number.isFinite(rep.deaths) && rep.deaths < 200,
    `离线死亡应有限且 < 200(实际 ${rep.deaths})`);
  ok(Number.isFinite(rep.gold) && rep.gold >= 0, `离线金币应 >= 0(实际 ${rep.gold})`);
  ok(rep.sec <= BAL.offline_cap_sec + 1, "离线时长不应超过 12 小时上限");
}

// ================================================================ 7. 渲染尺寸
function checkFrame(frame: string, ctx: string): void {
  const lines = frame.split("\r\n");
  eq(lines.length, 30, `${ctx}: 应输出 30 行`);
  for (let i = 0; i < lines.length; i++) {
    const w = dwidth(lines[i]);
    if (w !== 100) {
      throw new Error(`${ctx}: 第 ${i} 行显示宽度应为 100, 实际 ${w}:「${lines[i]}」`);
    }
  }
}

function testRenderSize(): void {
  memHooks();
  // classId null(职业选择弹窗)不异常
  const g0 = newGame(55);
  checkFrame(renderFrame(g0, 100, 30), "classId=null 职业弹窗");

  // 8 个 tab × 100×30,每行 dwidth == 100(2.4.3 起塔页 tab=7 纳入,不再依赖手动冒烟)
  const g = newGame(56);
  g.chooseClass("ranger");
  for (let i = 0; i < 60; i++) g.tick(0.25); // 有战斗状态/日志/掉落
  g.view.drain(g);
  g.view.tick(0.1);
  // 造一些有内容的背包(渲染分支覆盖)
  const it = new Item("weapon", "rare", 3, 12.5, [{ id: "atk", val: 2.5 }]);
  g.bag.push(it);
  for (let tab = 0; tab < 8; tab++) {
    g.view.ui.tab = tab;
    checkFrame(renderFrame(g, 100, 30), `tab=${tab}`);
  }

  // 帮助弹窗
  g.view.ui.tab = 0;
  g.view.ui.help = true;
  checkFrame(renderFrame(g, 100, 30), "帮助弹窗");
  g.view.ui.help = false;

  // 离线结算弹窗
  g.pendingOffline = {
    sec: 3600, kills: 120, deaths: 2, gold: 800, xp: 3000,
    items: [new Item("helmet", "epic", 5, 30, [{ id: "hp", val: 20 }])],
    levels: 3, zones: 1,
  };
  checkFrame(renderFrame(g, 100, 30), "离线弹窗");
  g.pendingOffline = null;
}

// ================================================================ 8. fmt / pyRound
function testFmtPyRound(): void {
  eq(fmt(12345), "1.23万", "fmt(12345)");
  eq(fmt(123456789), "1.23亿", "fmt(123456789)");
  eq(fmt(999), "999", "fmt(999) 应为原样整数");
  // 银行家舍入
  eq(pyRound(2.5), 2, "pyRound(2.5) 应为 2(银行家舍入)");
  eq(pyRound(3.5), 4, "pyRound(3.5) 应为 4(银行家舍入)");
  eq(pyRound(0.5), 0, "pyRound(0.5) 应为 0");
  eq(pyRound(1.5), 2, "pyRound(1.5) 应为 2");
  eq(pyRound(2.4), 2, "pyRound(2.4) 应为 2");
  eq(pyRound(2.6), 3, "pyRound(2.6) 应为 3");
}

// ================================================================ 9. 遗物背包
function testRelicBag(): void {
  const mk = (n: number) => new Relic("rare", 10, [{ id: "atk", val: n }], `测${n}`);

  // ---- 容量曲线与升级费用:40 → 80 → 160 → 200 封顶;1w/5w/25w(每级 ×5) ----
  const g = newGame(77);
  g.chooseClass("warrior");
  eq(g.relicBagCap(), 40, "Lv1 容量 40");
  eq(g.relicBagCost(), 10000, "Lv1→2 费用 1w");
  g.gold = 0;
  g.upgradeRelicBag();                       // 金币不足:不动
  eq(g.relicBagLv, 1, "金币不足不升级");
  g.gold = 1000000;
  g.upgradeRelicBag();
  eq(g.relicBagLv, 2, "升到 Lv2");
  eq(g.gold, 990000, "扣 1w");
  eq(g.relicBagCap(), 80, "Lv2 容量 80");
  eq(g.relicBagCost(), 50000, "Lv2→3 费用 5w");
  g.upgradeRelicBag();                       // 99w ≥ 5w
  eq(g.relicBagCap(), 160, "Lv3 容量 160");
  g.upgradeRelicBag();                       // 94w ≥ 25w
  eq(g.relicBagCap(), 200, "Lv4 容量封顶 200");
  eq(g.relicBagCost(), null, "满级后费用 null");
  g.upgradeRelicBag();
  eq(g.relicBagLv, 4, "等级封顶 4");

  // ---- 满槽掉落进背包;卸下存背包;背包装备回空槽 ----
  for (let i = 0; i < 4; i++) g.relics[i] = mk(i + 1);
  g.recalcHero();
  const r5 = mk(5);
  g.addRelic(r5);
  eq(g.relicBag.length, 1, "满槽掉落存入背包");
  eq(g.relicBag[0], r5, "背包首件即新遗物");
  g.unequipRelic(0);
  eq(g.relics[0], null, "卸下后槽空");
  eq(g.relicBag.length, 2, "卸下存入背包");
  g.equipRelicFromBag(0);
  eq(g.relics[0], r5, "背包装备回空槽");
  eq(g.relicBag.length, 1, "装备后移出背包");
  g.equipRelicFromBag(0);                    // 4 槽全满:替换效果最少的一件(并列取首个)
  eq(g.relicBag.length, 1, "槽满装备:一进一出背包数不变");
  eq(g.relicBag[0], r5, "槽满装备:被替换旧件回背包");
  ok(g.relics.some(r => r && r.name === "测1"), "槽满装备:新件入槽");

  // ---- 新档:背包满时卸下被拒;槽+背包全满时替换效果最少的 ----
  const g2 = newGame(88);
  g2.chooseClass("mage");
  const cap1 = g2.relicBagCap();             // 40
  for (let i = 0; i < 4; i++) g2.relics[i] = mk(i + 1);
  for (let i = 0; i < cap1; i++) g2.relicBag.push(mk(100 + i));
  g2.recalcHero();
  g2.unequipRelic(0);
  ok(g2.relics[0] !== null, "背包满拒绝卸下:槽上遗物保留");
  eq(g2.relicBag.length, cap1, "背包满拒绝卸下:背包不超容");
  const old0 = g2.relics[0];
  g2.addRelic(mk(999));
  eq(g2.relicBag.length, cap1, "背包满:不进背包");
  ok(g2.relics.some(r => r && r.name === "测999"), "背包满:替换装入");
  ok(!g2.relics.includes(old0), "背包满:被替换者移除");

  // ---- 存档往返 + v5→v6 迁移 ----
  const mem = memHooks();
  g.relicBag.push(mk(6));
  g.save();
  const g3 = Game.fromDict(JSON.parse(mem.raw));
  eq(g3.relicBagLv, g.relicBagLv, "往返:背包等级");
  eq(g3.relicBag.length, g.relicBag.length, "往返:背包容器数");
  eq(g3.relicBag[0].name, g.relicBag[0].name, "往返:背包遗物内容");
  const d5: Record<string, any> = { version: 5, seed: 1 };
  const d6 = migrateSave(d5);
  eq(d6.version, SAVE_VERSION, "v5 迁移应一路迁到最新版本");
  eq(d6.relic_bag.length, 0, "v6 默认空背包");
  eq(d6.relic_bag_lv, 1, "v6 默认 Lv1");
}

// ================================================================ 10. 手动模式换装对比
function testPendingSwap(): void {
  // ---- 装备:自动换装关 → 更强掉落弹对比;确认换上 / 保留 ----
  const g = newGame(91);
  g.chooseClass("warrior");
  g.settings.auto_equip = false;
  const weak = new Item("weapon", "common", 5, 10, [{ id: "atk", val: 1 }]);
  g.equip.weapon = weak;
  g.recalcHero();
  const strong = new Item("weapon", "rare", 5, 30, [{ id: "atk", val: 5 }]);
  g.addItem(strong);
  ok(g.pendingSwap !== null && g.pendingSwap.kind === "item", "手动模式更强掉落触发对比");
  g.resolveSwap(true);
  eq(g.equip.weapon, strong, "确认后换上新的");
  ok(g.bag.includes(weak), "旧装备入背包");
  eq(g.pendingSwap, null, "处理后清空");

  const stronger = new Item("weapon", "epic", 5, 40, [{ id: "atk", val: 8 }]);
  g.addItem(stronger);
  ok(g.pendingSwap !== null, "再次更强触发");
  g.resolveSwap(false);
  eq(g.equip.weapon, strong, "保留:不换");
  ok(g.bag.includes(stronger), "保留:新装备留在背包");

  // 弱于当前:不弹
  const weaker = new Item("weapon", "fine", 5, 12, [{ id: "atk", val: 1 }]);
  g.addItem(weaker);
  eq(g.pendingSwap, null, "不强于当前不弹");

  // ---- 自动模式:不弹,直接按 5% 规则换 ----
  g.settings.auto_equip = true;
  const auto = new Item("weapon", "legendary", 5, 50, [{ id: "atk", val: 9 }]);
  g.addItem(auto);
  eq(g.pendingSwap, null, "自动模式不弹对比");
  eq(g.equip.weapon, auto, "自动模式直接换上");

  // ---- 遗物:满槽更强 → 对比;换上(旧入遗物背包)/ 保留(新入包) ----
  const g2 = newGame(92);
  g2.chooseClass("mage");
  const mk = (n: number, ne: number) => new Relic("rare", 10,
    Array.from({ length: ne }, (_, i) => ({ id: "goldfind", val: 5 + i })), `R${n}`);
  for (let i = 0; i < 4; i++) g2.relics[i] = mk(i, 1);
  g2.recalcHero();
  const better = mk(9, 3);
  g2.addRelic(better);
  ok(g2.pendingSwap !== null && g2.pendingSwap.kind === "relic", "遗物满槽更强触发对比");
  eq(g2.relicBag.length, 0, "待确认遗物不先入包");
  g2.resolveSwap(true);
  ok(g2.relics.includes(better), "确认后新遗物入槽");
  eq(g2.relicBag.length, 1, "旧遗物存入遗物背包");

  // 不强于最弱件(效果数不多于):直接入包,不弹
  const same = mk(10, 1);
  g2.addRelic(same);
  eq(g2.pendingSwap, null, "不强于最弱件不弹");
  ok(g2.relicBag.includes(same), "直接入包");

  // 再触发一次,选保留
  const best = mk(11, 3);
  g2.addRelic(best);
  ok(g2.pendingSwap !== null, "更强遗物触发");
  g2.resolveSwap(false);
  ok(g2.relicBag.includes(best), "保留:新遗物入包");
  ok(!g2.relics.includes(best), "保留:不入槽");

  // ---- 存档兜底:待确认遗物不因关页丢失 ----
  const mem = memHooks();
  const p2 = mk(12, 3);
  g2.addRelic(p2);
  ok(g2.pendingSwap !== null, "触发待确认");
  g2.save();
  const d = JSON.parse(mem.raw);
  ok((d.relic_bag as any[]).some(r => r.name === "R12"), "存档把待确认遗物并入背包");
}

// ================================================================ 11. 存档防御 + 遗物 roll 修正
function testSaveDefenseAndRelicRoll(): void {
  // ---- 损坏的 relics/tower/relic_bag 字段:不抛异常,坏条目置空/剔除 ----
  const valid = { rarity: "rare", tier: 10, effects: [["goldfind", 6]], name: "验证件", skill_id: null };
  const g = Game.fromDict({
    version: SAVE_VERSION, seed: 3, class_id: "warrior",
    equip: {}, bag: [], skill_lv: {}, loadout: { active: ["w_strike"], passive: [] },
    relics: [valid, "碎片", 3, null],
    relic_bag: [valid, "垃圾", 42],
    tower: "坏数据",
    hero_hp: 0,
  });
  eq(g.relics.length, 4, "遗物槽保持 4 格");
  ok(g.relics[0] !== null && g.relics[0].name === "验证件", "合法遗物保留");
  eq(g.relics[1], null, "字符串条目置空");
  eq(g.relics[2], null, "数字条目置空");
  eq(g.relics[3], null, "null 保持");
  eq(g.relicBag.length, 1, "背包坏条目剔除");
  eq(g.relicBag[0].name, "验证件", "背包合法条目保留");
  eq(g.tower.keys, 3, "坏 tower 回默认钥匙 3");
  eq(g.tower.max_floor, 0, "坏 tower 回默认 0 层");
  eq(g.hero.hp, 0, "hero_hp=0 应保留(仅 null 回满)");

  // ---- 空装配:roll 不再产出未绑定的 skill_lv_r 废词条 ----
  const rng = new PyRandom(20261002);
  for (let i = 0; i < 200; i++) {
    const r = rollRelic(10, rng, 0, []);
    for (const e of r.effects) {
      ok(e.id !== "skill_lv_r", `空装配不应出现 skill_lv_r(第 ${i} 次:` +
        `${r.effects.map(x => x.id).join(",")})`);
    }
  }
  // 有装配时仍正常绑定
  const rng2 = new PyRandom(20261002);
  let bound = 0;
  for (let i = 0; i < 200; i++) {
    const r = rollRelic(10, rng2, 0, ["w_strike", "w_exec"]);
    for (const e of r.effects) {
      if (e.id === "skill_lv_r") { bound++; ok(r.skillId !== null, "有装配时 skill_lv_r 必绑定"); }
    }
  }
  ok(bound > 0, "200 次内应出现 skill_lv_r 绑定案例(池含该词条)");

  // ---- luck 接入:巨量幸运下稀有度显著上移 ----
  const rng3 = new PyRandom(20261002);
  for (let i = 0; i < 30; i++) {
    const r = rollRelic(10, rng3, 0, ["w_strike"], 1e7);
    const rid = ["common", "fine", "rare", "epic", "legendary", "mythic"].indexOf(r.rarity);
    ok(rid >= 2, `luck=1e7 时稀有度应 ≥ 稀有(实际 ${r.rarity})`);
  }

  // ---- 药剂:力量药剂走 atk 键(旧 dmg 键无人消费,属死 buff) ----
  const g4 = newGame(93);
  g4.chooseClass("warrior");
  g4.gold = 10_000_000;
  const baseAtk = g4.hero.atk;
  g4.usePotion("might");
  eq(buffPct(g4, "atk"), 20, "力量药剂挂 atk buff");
  eq(buffPct(g4, "dmg"), 0, "旧 dmg 键不再使用");
  close(atkNow(g4), baseAtk * 1.2, "atkNow 含药剂加成");
  g4.usePotion("wisdom");
  eq(buffPct(g4, "xp"), 50, "智慧药剂挂 xp buff");
  g4.usePotion("fortune");
  eq(buffPct(g4, "gold"), 30, "贪婪药剂挂 gold buff");
}

// ================================================================ 12. 战力系统
function testPower(): void {
  memHooks();
  const g = newGame(94);
  // 未选职业:默认面板可算不崩,分项非负
  const p0 = heroPower(g);
  ok(p0.total > 0 && p0.offense > 0 && p0.defense > 0 && p0.utility >= 0,
    `新档战力为正(实际 ${p0.total})`);
  eq(heroPower(g).total, p0.total, "战力计算确定性(两次一致)");

  g.chooseClass("warrior");
  const p1 = heroPower(g);

  // 装备预览:换武器战力上升,且预览完全还原(血量/装备/背包/战力)
  const it = new Item("weapon", "rare", 5, 30, [{ id: "atk", val: 4 }], 0, "测试之刃", undefined, "atk");
  const hpBefore = g.hero.hp;
  const bagBefore = g.bag.length;
  const pEquip = powerWithEquip(g, "weapon", it);
  ok(pEquip.total > p1.total, "预览换上武器战力上升");
  eq(g.hero.hp, hpBefore, "预览不改变当前血量");
  eq(g.equip.weapon, undefined, "预览不留装备在身上");
  eq(g.bag.length, bagBefore, "预览不动背包");
  eq(heroPower(g).total, p1.total, "预览后战力还原");

  g.equipItem(it);
  const p2 = heroPower(g);
  ok(p2.total > p1.total, "真装备后战力上升");
  const pUneq = powerWithEquip(g, "weapon", null);
  ok(pUneq.total < p2.total, "预览卸下战力下降");
  eq(heroPower(g).total, p2.total, "卸下预览后还原");

  // 遗物预览:cd_reduce 必进技能 DPS(装配的 w_strike),装上必改变战力,卸下还原
  const relic = new Relic("rare", 10, [{ id: "cd_reduce", val: 8 }], "测试遗物");
  const pRelic = powerWithRelic(g, 0, relic);
  ok(pRelic.total > p2.total, "预览装 cd_reduce 遗物战力上升");
  eq(heroPower(g).total, p2.total, "遗物预览后还原");
  g.relics[0] = relic;
  g.recalcHero();
  ok(heroPower(g).total > p2.total, "遗物真装备战力上升");
  g.relics[0] = null;
  g.recalcHero();
  eq(heroPower(g).total, p2.total, "卸下遗物战力还原");

  // buff 口径:药剂增益抬高"当前战力",基础口径(排行榜/对比用)不受影响
  g.buffs.atk = { pct: 20, until: g.time + 60 };
  ok(heroPower(g, true).total > p2.total, "atk buff 提升当前战力");
  eq(heroPower(g, false).total, p2.total, "基础口径不受临时 buff 影响");
  delete g.buffs.atk;

  // 强化/升级单调性:金币到位强化武器,战力不降
  const p3 = heroPower(g);
  g.gold = 1e9;
  g.enhance("weapon");
  ok(heroPower(g).total > p3.total, "强化后战力上升");

  // 存档往返不序列化战力(纯派生):toDict 无 power 字段
  ok(!("power" in g.toDict()), "存档不含战力字段");
}

// ================================================================ 13. 一键出售品质档
function testSellJunk(): void {
  memHooks();
  const g = newGame(95);
  g.chooseClass("warrior");
  const mk = (rarity: string) =>
    new Item("weapon", rarity, 5, 30, [{ id: "atk", val: 4 }]);
  // 六种品质各一件入包
  for (const r of ["common", "fine", "rare", "epic", "legendary", "mythic"]) {
    g.bag.push(mk(r));
  }
  // 默认(无参):卖普通+精良 —— CLI 键位行为不变
  let gold0 = g.gold;
  g.sellJunk();
  eq(g.bag.length, 4, "默认一键出售剩稀有+");
  eq(g.bag.every(it => ["rare", "epic", "legendary", "mythic"].includes(it.rarity)), true,
    "默认只卖普通/精良");
  ok(g.gold > gold0, "出售获得金币");

  // 档位 2(≤稀有):再卖稀有
  gold0 = g.gold;
  const rarePrice = g.bag.find(it => it.rarity === "rare")!.sellPrice();
  g.sellJunk(2);
  eq(g.bag.map(it => it.rarity).join(","), "epic,legendary,mythic", "≤稀有档卖出稀有");
  eq(g.gold - gold0, rarePrice, "金币增量 = 卖出件售价");

  // 档位 0(仅普通):背包无普通时不动
  g.sellJunk(0);
  eq(g.bag.length, 3, "无普通件时档位0不卖");

  // 满档 5(≤神话):清空
  g.sellJunk(5);
  eq(g.bag.length, 0, "≤神话档清空背包");
}

// ================================================================ 14. 怪物技能 debuff(减速/眩晕)
function testMobSkillDebuff(): void {
  const mem = memHooks();
  const g = newGame(96);
  g.chooseClass("warrior");
  const h = g.hero;

  // 工具:构造低攻高血怪(atk=0 不伤英雄),数英雄攻击事件次数
  const mkMon = (skill: any): Monster =>
    new Monster("测试傀儡", ["  ", "  "], "green", 1e9, 0, 0, 999, false, false, 1, skill, "slime");
  const heroHits = (sec: number): number =>
    g.events.filter(e => e[0] === "anim" && e[1] === "hero_attack").length;

  // ---- 首放时机:普通/精英怪最多 2 秒(速刷也可见),boss 保持半 CD ----
  const anySkill = { name: "x", icon: "x", cd: 10, mult: 1, hits: 1 } as any;
  eq(new Monster("普", [" "], "green", 1, 1, 0, 1, false, false, 1, anySkill, "slime").skillTimer,
    2, "普通怪技能首放 min(半CD,2s)=2s(cd10)");
  eq(new Monster("首", [" "], "green", 1, 1, 0, 1, true, false, 1, anySkill, "slime").skillTimer,
    5, "boss 技能首放保持半 CD=5s(cd10)");
  eq(new Monster("精", [" "], "green", 1, 1, 0, 1, false, true, 1, anySkill, "slime").skillTimer,
    2, "精英怪同普通怪 2s 首放");

  // ---- 施放即上 debuff:slow → slow_pct/slow_until;stun → stun_until ----
  g.monster = mkMon({ name: "酸液", icon: "x", cd: 10, mult: 1, hits: 1, slow: [0.35, 4] });
  (g.monster as Monster).skillTimer = 10;
  battleTick(g, 0.05);
  ok((h.slow_until ?? 0) > g.time, "酸液施放后英雄被减速");
  close(h.slow_pct ?? 0, 0.35, "减速幅度 35%");
  eq(h.stun_until ?? 0, 0, "减速技能不附带眩晕");

  g.monster = mkMon({ name: "缠丝", icon: "x", cd: 10, mult: 1, hits: 1, stun: 1.0 });
  (g.monster as Monster).skillTimer = 10;
  battleTick(g, 0.05);
  ok((h.stun_until ?? 0) > g.time, "缠丝施放后英雄被眩晕");

  // ---- 行为:眩晕期间不出手;减速期间攻击频率按 (1-pct) 下降 ----
  const fresh = () => { g.events.length = 0; g.monster = mkMon(null); };
  const run = (sec: number) => { for (let t = 0; t < sec; t += 0.05) battleTick(g, 0.05); };

  fresh();
  h.stun_until = g.time + 100;
  run(5);
  eq(heroHits(5), 0, "眩晕期间英雄不攻击");
  h.stun_until = 0;

  fresh();
  run(10);
  const n0 = heroHits(10);
  ok(n0 >= 8, `基准 10 秒出手次数充足(实际 ${n0})`);

  fresh();
  h.slow_pct = 40; h.slow_until = g.time + 100;
  run(10);
  const n1 = heroHits(10);
  ok(n1 > 0 && n1 <= Math.ceil(n0 * 0.6), `减速 40% 后攻击次数约为基准 6 成(基准 ${n0},实际 ${n1})`);

  // ---- 存档口径:debuff 为运行时字段,不进存档 ----
  h.slow_pct = 40; h.slow_until = g.time + 100; h.stun_until = g.time + 5;
  g.save();
  const g2 = Game.fromDict(JSON.parse(mem.raw));
  ok(!("slow_until" in g2.hero) || (g2.hero.slow_until ?? 0) <= g2.time,
    "重载存档后减速不残留");
  ok((g2.hero.stun_until ?? 0) <= g2.time, "重载存档后眩晕不残留");
}

// ================================================================ 22. 持续伤害技能(燃烧/流血/灼命)
function testDotSkills(): void {
  const g = newGame(1024);
  g.chooseClass("mage");
  const h = g.hero;

  // 傀儡怪:血厚不还手(隔离开普攻,只看 dot)
  const mkMon = (): Monster =>
    new Monster("傀儡", ["  "], "green", 1e9, 0, 0, 9999, false, false, 1, null, "slime");
  const isolate = () => {   // 清空主动装配+英雄长眩晕:纯 dot 结算,无普攻/技能干扰
    g.loadout.active = [];
    h.stun_until = g.time + 100;
    g.monster = mkMon();
  };

  // ---- 施放即挂 dot:字段/数值/时长 ----
  isolate();
  const storm = ACTIVE_DEF["m_storm"];
  castActive(g, storm, g.monster!);
  const mon = g.monster as Monster;
  ok(mon.dotUntil > g.time, "烈焰风暴施放后挂上燃烧");
  eq(mon.dotPct, dotVal(storm, 1), "燃烧每跳% = dot_base(lv1)");
  ok(mon.dotIcon === "🔥" && mon.dotLabel === "燃烧", "燃烧图标/标签");

  // ---- 跳伤结算:0.5s 一跳,1.55s 内恰 3 跳,数值 = atk×dot%×技能增伤 ----
  h.hp = h.max_hp;
  const hp0 = mon.hp;
  const atk0 = atkNow(g);
  for (let t = 0; t < 1.55; t += 0.05) { g.time += 0.05; battleTick(g, 0.05); }
  close(hp0 - mon.hp, atk0 * mon.dotPct / 100 * 3 * (1 + (h.skill_dmg ?? 0) / 100),
    "1.55s 内 3 跳燃烧总伤 = atk×dot%×3×(1+技能增伤)", 1e-6);   // 大血量减法有 ULP 量化

  // ---- dot 打死怪:击杀走正常结算 ----
  g.monster = mkMon();
  (g.monster as Monster).hp = atkNow(g) * 0.2;   // 一跳内必死(每跳约 atk×30%)
  (g.monster as Monster).dotPct = mon.dotPct;
  (g.monster as Monster).dotUntil = g.time + 5;
  (g.monster as Monster).dotNextAt = g.time + 0.5;
  (g.monster as Monster).dotTick = 0.5;
  for (let t = 0; t < 1.2 && g.monster; t += 0.05) { g.time += 0.05; battleTick(g, 0.05); }
  ok(g.monster === null || (g.monster as Monster).hp <= 0 || g.stats.kills > 0,
    "dot 伤害可击杀(傀儡被烧死)");

  // ---- 流血吸血:每跳回血 ----
  isolate();
  const blood = ACTIVE_DEF["w_blood"];
  castActive(g, blood, g.monster!);   // 借用傀儡直接挂流血(职业字段不影响结算)
  const mon2 = g.monster as Monster;
  ok(mon2.dotLifesteal === 30, "嗜血流血带 30% 吸血");
  h.hp = 1;
  const hp1 = mon2.hp;
  for (let t = 0; t < 0.55; t += 0.05) { g.time += 0.05; battleTick(g, 0.05); }
  ok(h.hp > 1, "流血跳伤按 30% 回血");
  ok(mon2.hp < hp1, "流血在掉血");

  // ---- 描述占位符:{d} 已替换、无残留 ----
  const desc = skillDesc(g, storm);
  ok(!desc.includes("{d}") && !desc.includes("{v}"), "描述占位符全部替换");
  ok(desc.includes("燃烧"), "烈焰风暴描述含燃烧");
}

// ================================================================ 15. 转生(门槛/重置/保留/倍率/存档 v8)
function testRebirth(): void {
  const mem = memHooks();
  const g = newGame(77);
  g.chooseClass("warrior");
  ok(!g.canRebirth(), "Lv40 以下不应可转生");
  g.rebirth();
  eq(g.rebirths, 0, "未达门槛 rebirth() 应被拒");

  // 堆一批跨"重置/保留"两侧的进度(深度压到锚点 130 区 → 方案B k=1,等值旧口径)
  g.level = BAL.rebirth_min_level;         // 直接达标(确定性)
  g.zone = BAL.rebirth_depth_ref;
  g.runMaxZone = BAL.rebirth_depth_ref;
  g.gold = 98765;
  g.stones = 13;
  g.skillLv["w_strike"] = 5;
  g.altarLv["power"] = 4;
  g.stats.kills = 500;
  g.stats.max_zone = 9;
  g.tower.max_floor = 12;
  g.bagExpLv = 2;
  g.bag.push(new Item("weapon", "fine", 30, 10, [{ id: "atk", val: 5 }]));
  g.recalcHero();
  ok(g.canRebirth(), "Lv40 应可转生");

  g.rebirth("mage");   // 转生 + 换职业(职业锁的唯一出口)
  eq(g.rebirths, 1, "转生后 rebirths=1");
  eq(g.classId, "mage", "转生可换职业");
  eq(g.level, 1, "等级重置为 1");
  eq(g.zone, 1, "区域重置为第 1 区");
  eq(g.gold, 0, "金币重置");
  eq(Object.keys(g.equip).length, 0, "装备清空");
  eq(g.bag.length, 0, "背包清空");
  eq(g.skillLv["w_strike"] ?? 1, 1, "技能等级重置");
  eq(g.stones, 13, "重铸石保留");
  eq(g.altarLv["power"], 4, "祭坛等级保留");
  eq(g.stats.kills, 500, "终身击杀保留(排行榜包络依赖)");
  eq(g.stats.max_zone, 9, "终身最远区域保留");
  eq(g.tower.max_floor, 12, "塔最高层保留");
  eq(g.bagExpLv, 2, "背包容量等级保留");
  ok(g.loadout.active.length > 0 && g.loadout.active[0].startsWith("m_"),
    "loadout 按新职业(mage)重建");
  // 倍率:干净档(无成就/祭坛干扰)Lv1 mage 转生后 = 基础 × (1+25%)
  const gClean = newGame(78);
  gClean.chooseClass("mage");
  const cleanBase = gClean.hero.atk;
  gClean.rebirths = 1;
  gClean.recalcHero();
  const rebAch = ACHIEVEMENTS.find(a => a.id === "rebirther")!;
  close(gClean.hero.atk,
    cleanBase * (1 + BAL.rebirth_stat_pct / 100) * (1 + rebAch.per / 100),
    "转生倍率应作用于三围(+25%;1 次转生另触发轮回大师第 1 档)");
  ok(g.hero.goldfind >= BAL.rebirth_gain_pct, "转生金币加成生效");
  ok(g.hero.xp_pct >= BAL.rebirth_gain_pct, "转生经验加成生效");

  // 塔中不可转生
  g.level = BAL.rebirth_min_level;
  g.inTower = true;
  ok(!g.canRebirth(), "塔中不可转生");
  g.inTower = false;

  // 存档往返:rebirths 进档、重载后倍率仍生效(用干净档口径)
  gClean.save();
  const dClean = JSON.parse(mem.raw);
  eq(dClean.rebirths, 1, "to_dict 应含 rebirths");
  const gReload = Game.fromDict(dClean);
  eq(gReload.rebirths, 1, "往返后 rebirths");
  close(gReload.hero.atk, gClean.hero.atk, "往返后转生倍率仍生效");
  eq(dClean.version, SAVE_VERSION, "存档版本应为最新(v9)");

  // v7 → 最新迁移:无 rebirths 字段的旧档默认 0(v8 层),无魂晶/天赋字段默认 0(v9 层)
  const v7 = { ...dClean, version: 7 } as Record<string, unknown>;
  delete v7.rebirths;
  delete v7.essence;
  delete v7.talents;
  const m = migrateSave(v7);
  eq(m.version, SAVE_VERSION, "v7 迁移应一路迁到最新");
  eq(m.rebirths, 0, "v7 旧档 rebirths 默认 0");
  eq(m.essence, 0, "v8 旧档 essence 默认 0");
  ok(typeof m.talents === "object" && Object.keys(m.talents).length === 0,
    "v8 旧档 talents 默认空表");
}

// ================================================================ 23. 引导攻击(旋风斩:多跳/期间停其他攻击/断引)
function testBurstSkill(): void {
  const g = newGame(2048);
  g.chooseClass("warrior");
  const h = g.hero;
  h.crit = 0;   // 关暴击,伤害断言确定性化

  // 傀儡怪:血厚不还手(隔离观察引导跳伤)
  const mkMon = (): Monster =>
    new Monster("傀儡", ["  "], "green", 1e9, 0, 0, 9999, false, false, 1, null, "slime");
  g.loadout.active = ["w_whirl", "w_strike"];   // 重击在列:验证引导期间不放其他技能
  g.monster = mkMon();

  // ---- 施放登记引导,不立即结算 ----
  const whirl = ACTIVE_DEF["w_whirl"];
  castActive(g, whirl, g.monster!);
  ok(g.burst !== null, "旋风斩登记引导状态");
  const burst = g.burst!;
  eq(burst.left, 6, "待发 6 跳");
  close(burst.interval, 1 / 3, "每 1/3s 一跳(2 秒打满)", 1e-9);
  eq(burst.pct, skillVal(whirl, 1), "每跳% = lv1 技能值");

  // ---- 引导期间:无普攻、无其他技能掺入,跳伤按节拍落 ----
  g.events.length = 0;
  const mon = g.monster as Monster;
  const hp0 = mon.hp;
  const atk0 = atkNow(g);
  const perHit = atk0 * burst.pct / 100 * (1 + (h.skill_dmg ?? 0) / 100);
  for (let t = 0; t < 1.05; t += 0.05) { g.time += 0.05; battleTick(g, 0.05); }
  eq(g.events.filter(e => e[0] === "anim" && e[1] === "hero_attack").length, 0,
    "引导期间不普攻");
  close(hp0 - mon.hp, perHit * 3, "1.05s 恰 3 跳(重击 260% 未掺入)", 1e-6);

  // ---- 2.0s 打满 6 跳,引导结束 ----
  for (let t = 0; t < 0.95; t += 0.05) { g.time += 0.05; battleTick(g, 0.05); }
  eq(g.burst, null, "6 跳打满引导结束");
  close(hp0 - mon.hp, perHit * 6, "引导总伤 = 每跳×6", 1e-6);

  // ---- 引导结束后:普攻恢复 ----
  g.skillCd["w_whirl"] = 999;   // 直接 castActive 不走 castSkills,手动补 CD(真实流程 5s CD > 2s 引导,无连引导问题)
  for (let t = 0; t < 2.0; t += 0.05) { g.time += 0.05; battleTick(g, 0.05); }
  ok(g.events.some(e => e[0] === "anim" && e[1] === "hero_attack"), "引导结束后普攻恢复");

  // ---- 目标中途死亡:引导不中断,剩余跳数转到新目标身上打完 ----
  g.monster = mkMon();
  (g.monster as Monster).hp = perHit * 0.5;   // 第一跳必死
  castActive(g, whirl, g.monster!);
  ok(g.burst !== null, "二次施放重新登记引导");
  const kills0 = g.stats.kills;
  let replaced = false;
  for (let t = 0; t < 2.05 && g.burst; t += 0.05) {
    g.time += 0.05; battleTick(g, 0.05);
    if (!replaced && g.stats.kills > kills0) {
      // 击杀结算完成(真怪已顶上):换回 0 防傀儡,隔离观察后续跳伤
      g.monster = mkMon();
      replaced = true;
    }
  }
  eq(g.stats.kills, kills0 + 1, "引导跳伤击杀走正常结算");
  ok(g.burst === null, "剩余 5 跳在新目标身上打满,引导才结束");
  const mon3 = g.monster as Monster;
  close(mon3.maxHp - mon3.hp, perHit * 5, "新目标恰好吃满剩余 5 跳", 1e-6);
}

// ================================================================ 24. 技能顺序施放(一拍只放一个,按装配顺序排队)
function testSkillOrder(): void {
  const g = newGame(2049);
  g.chooseClass("warrior");
  g.monster = new Monster("傀儡", ["  "], "green", 1e9, 0, 0, 9999, false, false, 1, null, "slime");
  g.loadout.active = ["w_strike", "w_warcry"];   // 两个瞬发同时就绪
  const casts = () => g.events
    .filter(e => e[0] === "anim" && String(e[1]).startsWith("cast:"))
    .map(e => String(e[1]));
  g.events.length = 0;

  g.time += 0.05; battleTick(g, 0.05);
  eq(casts().length, 1, "一拍只放一个技能");
  eq(casts()[0], "cast:w_strike", "同拍多个就绪:先放装配位靠前的");

  g.time += 0.05; battleTick(g, 0.05);
  eq(casts().length, 2, "下一拍补发第二个");
  eq(casts()[1], "cast:w_warcry", "排队顺序 = 装配顺序");
}

// ================================================================ 25. 死亡窗口存档兜底(hp=0 无复活计时 → 补倒计时复活)
function testDeathSaveRevive(): void {
  const g = newGame(2050);
  g.chooseClass("warrior");
  const h = g.hero;
  h.hp = 0;                 // 模拟死亡瞬间被自动存档、重载后的状态
  g.respawnTimer = 0;       // 复活计时是瞬态,不入档
  battleTick(g, 0.1);
  ok(g.respawnTimer > 0, "hp=0 且无复活计时:自动补上复活倒计时(防永久卡死)");
  for (let t = 0; t < BAL.respawn_sec; t += 0.1) { g.time += 0.1; battleTick(g, 0.1); }
  eq(h.hp, h.max_hp, "倒计时走完满血复活");
}

// ================================================================ 26. 三职业引导技能(法/射吟唱登记与节拍)
function testChannelSkills(): void {
  const g = newGame(2051);
  const mkMon = (): Monster =>
    new Monster("傀儡", ["  "], "green", 1e9, 0, 0, 9999, false, false, 1, null, "slime");
  const cases = [
    ["mage", "m_fire", 3, 1.5],
    ["mage", "m_meteor", 4, 2],
    ["ranger", "r_rain", 5, 2.5],
  ] as const;
  for (const [cls, sid, hits, channel] of cases) {
    g.classId = cls;   // 直接切职业字段:只验登记,不重置装配
    g.monster = mkMon();
    const def = ACTIVE_DEF[sid];
    castActive(g, def, g.monster!);
    ok(g.burst !== null, `${cls} ${sid} 登记引导(不立即结算)`);
    const b = g.burst!;
    eq(b.left, hits, `${sid} 待发 ${hits} 跳`);
    eq(b.interval, channel / hits, `${sid} 每跳间隔 = 吟唱时长/跳数`);
    g.burst = null;   // 清场验下一个
  }
  // 数值锚:吟唱总额含引导溢价(阻塞普攻的机会成本),略高于同级瞬发
  eq(ACTIVE_DEF["m_fire"].base * 3, 330, "火球吟唱总额 330%(原瞬发 300%)");
  eq(ACTIVE_DEF["m_meteor"].base * 4, 520, "陨石吟唱总额 520%(原瞬发 510%)");
  eq(ACTIVE_DEF["r_rain"].base * 5, 550, "箭雨总额 550%(原 525%)");
  for (const [, sid] of cases) {
    const d = ACTIVE_DEF[sid];
    ok((d.channel ?? 0) < d.cd, `${sid} 冷却(${d.cd}s)须长于吟唱(${d.channel}s),否则普攻永不恢复`);
  }
}

// ================================================================ 27. 未选职业世界冻结(幽灵战士不打工)
function testPreClassFrozen(): void {
  const g = newGame(2052);   // 不 chooseClass
  for (let t = 0; t < 20; t += 0.1) g.tick(0.1);
  eq(g.playtime, 0, "未选职业 playtime 不累计");
  eq(g.monster, null, "未选职业不刷怪");
  eq(g.stats.kills, 0, "未选职业无击杀");
  eq(g.level, 1, "未选职业不升级");
  eq(g.gold, 0, "未选职业无金币");
  eq(g.bag.length, 0, "未选职业无掉落");
  eq(g.time, 0, "未选职业游戏时钟冻结");
  const rep = resolveOffline(g, 7200);
  eq(rep, null, "未选职业离线补算不结算(resolve 零报告被吞)");
  // 选完职业立刻恢复运转
  g.chooseClass("warrior");
  for (let t = 0; t < 3; t += 0.1) g.tick(0.1);
  ok(g.monster !== null, "选完职业正常刷怪");
  ok(g.playtime > 0, "选完职业时钟走动");
}

// ================================================================ 32. 悬赏目标封顶(深区不爆指数)
function testQuestTargetCap(): void {
  // 同种子下 rng 消费序列一致,各区能 roll 到的目标集合只差指数项,可确定性比较
  const rollMax = (zone: number, seed = 42): number => {
    const r = new PyRandom(seed);
    let mx = 0;
    for (let i = 0; i < 60; i++) mx = Math.max(mx, rollQuest(zone, r).target);
    return mx;
  };
  const m31 = rollMax(31);
  eq(rollMax(150), m31, "150 区目标 = 31 区目标(指数已封顶)");
  eq(rollMax(999), m31, "999 区目标同样封顶");
  ok(rollMax(20) < m31, "20 区目标低于封顶值(30 区前原曲线保留)");
  ok(m31 <= 1400, "封顶量级合理(击杀类 20×1.15^30 ≈ 1324)");
  // 旧档钳制:修复前滚出的天文目标在读档(migrateSave)时收敛到封顶值
  const old = {
    version: SAVE_VERSION,
    quests: [
      { type: "kill", target: 46264934053, progress: 318, gold: 1, stones: 0 },
      { type: "enhance", target: 11004598648575, progress: 145, gold: 1, stones: 0 },
      { type: "loot", target: 200000000000, progress: 5, gold: 1, stones: 0 },
    ],
  };
  const m = migrateSave(old);
  const qs = m.quests as Array<{ target: number; progress: number }>;
  ok(qs[0].target <= 1400, "旧档天文击杀目标读档即钳到封顶");
  ok(qs[1].target <= 250, "旧档天文强化目标读档即钳到封顶");
  ok(qs[2].target <= 100, "旧档天文拾取目标读档即钳到封顶");
  ok(qs[0].progress <= qs[0].target, "进度钳在目标内");
}

// ================================================================ 16. 祭坛批量(×N 精确扣费 / MAX 至不足 / ×1 委托 / 预估 ±1)
function testAltarBatch(): void {
  const g = newGame(426242);
  g.chooseClass("warrior");
  const line = "power";
  const c = (i: number): number => g.altarCost(line, i);

  // altarCostN = 逐级求和;偏移查询不动真实等级
  g.altarLv[line] = 3;
  eq(g.altarCostN(line, 4), c(0) + c(1) + c(2) + c(3), "连买 4 次总费用 = 逐级求和");
  eq(g.altarLv[line], 3, "偏移/求和查询不改真实等级");

  // ×N:精确按显示总额扣费、升级 N 级
  g.gold = 1_000_000;
  const gold0 = g.gold, lv0 = g.altarLv[line] ?? 0;
  const total4 = g.altarCostN(line, 4);
  g.altarUpMulti(line, 4);
  eq(g.altarLv[line], lv0 + 4, "×4 应升 4 级");
  eq(g.gold, gold0 - total4, "×4 扣费 = 展示总额");

  // MAX:买到"下一级买不起"为止,且与闭式预估误差 ≤1
  g.gold = 5000;
  const approx = g.altarMaxBuysApprox(line);
  g.altarUpMulti(line, Infinity);
  ok(g.gold < g.altarCost(line), "MAX 后应停在买不起处");
  eq(g.altarLv[line], lv0 + 4 + approx, "MAX 购买级数 = 逐级真实口径(预估精确)");
  const approx2 = g.altarMaxBuysApprox(line);
  ok(approx2 <= 1, "MAX 后剩余金币最多再买 1 级(预估与实买差 ≤1)");
  g.gold = 1;   // 连第一级都买不起
  g.altarUpMulti(line, Infinity);
  eq(g.altarLv[line], lv0 + 4 + approx, "金币不足时 MAX 不动等级");

  // ×1 委托 altarUp:与单次结果一致
  const g1 = newGame(426243), g2 = newGame(426244);
  g1.chooseClass("warrior"); g2.chooseClass("warrior");
  g1.gold = g2.gold = 500_000;
  g1.altarUpMulti("vigor", 1);
  g2.altarUp("vigor");
  eq(g1.altarLv["vigor"], g2.altarLv["vigor"], "×1 与单次等价(等级)");
  eq(g1.gold, g2.gold, "×1 与单次等价(扣费)");
}

// ================================================================ 17. 成就跨档反馈(基线静默/跨档提示/不重复/重载静默)
function testAchFeedback(): void {
  const g = newGame(426245);
  g.chooseClass("warrior");
  ok(toastTexts(g).length === 0, "未跨档前无成就提示");
  g.stats.kills = 99;
  g.checkAchTiers();                       // 首检:静默建基线(kills<100,0 档)
  ok(toastTexts(g).length === 0, "首检建基线不发");
  g.stats.kills = 100;                     // 跨第 1 档(100)
  g.checkAchTiers();
  ok(toastTexts(g).some(t => t.includes("深渊猎手") && t.includes("第 1 档")), "跨档发 toast");
  g.stats.kills = 150;                     // 同档内增长
  g.checkAchTiers();
  eq(toastTexts(g).filter(t => t.includes("深渊猎手")).length, 1, "同档不重复发");
  g.stats.kills = 1000;                    // 跨第 2 档(1000)
  g.checkAchTiers();
  eq(toastTexts(g).filter(t => t.includes("深渊猎手")).length, 2, "跨新档再发");
  // 存档往返后重载:首检重建基线,历史档不补发
  const g2 = Game.fromDict(g.toDict());
  g2.checkAchTiers();
  eq(toastTexts(g2).length, 0, "重载后基线重建静默");
}

// ================================================================ 18. 自动化三开关 / 装备锁定 / 批量分解 / 分怪图鉴
function testAutoLockCodex(): void {
  const g = newGame(426246);
  g.chooseClass("warrior");
  const w = new Item("weapon", "fine", 30, 10, [{ id: "atk", val: 5 }]);
  const a = new Item("armor", "fine", 30, 10, [{ id: "hp", val: 30 }]);
  g.bag.push(w, a);
  g.equipItem(w);
  g.equipItem(a);

  // —— 门槛之下不动作
  g.settings.auto_enhance = true;
  g.settings.auto_skill = true;
  g.settings.auto_altar = true;
  g.level = 10;                       // < auto_enhance_lv(20)
  g.gold = 1_000_000;
  for (let i = 0; i < 20; i++) g.tick(0.1);
  eq(g.stats.enhance_total, 0, "Lv10 时自动强化不动作(等级门槛)");
  ok(Object.values(g.skillLv).every(v => v <= 1), "Lv10 时自动技能不动作");
  eq(Object.values(g.altarLv).reduce((x, y) => x + y, 0), 0, "Lv10 时自动献祭不动作");

  // —— 门槛之上:开始工作且购买静默(不逐次 toast)
  g.level = 45;
  g.events.length = 0;
  for (let i = 0; i < 30; i++) g.tick(0.1);   // 3 秒 = 3 拍
  ok(g.stats.enhance_total > 0, "自动强化开始工作");
  ok(Object.values(g.skillLv).some(v => v > 1), "自动升技能开始工作");
  ok(Object.values(g.altarLv).some(v => v > 0), "自动献祭开始工作");
  ok(!toastTexts(g).some(t => t.includes("Lv.") || t.includes("祭坛")),
    "自动化购买静默(汇总日志,不逐次 toast)");

  // —— 装备锁定:三个销毁/出售通道全跳过
  const keep = new Item("weapon", "common", 10, 5, [{ id: "atk", val: 2 }]);
  g.bag.push(keep);
  g.toggleLock(g.bag.indexOf(keep));
  ok(keep.locked, "toggleLock 上锁");
  g.sellJunk(5);                                     // 全品质一键出售
  ok(g.bag.includes(keep), "锁定件不被一键出售");
  g.dismantleJunk(5);                                // 全品质批量分解
  ok(g.bag.includes(keep), "锁定件不被批量分解");
  g.dismantleItem(g.bag.indexOf(keep));
  ok(g.bag.includes(keep), "锁定件不被单件分解");
  g.toggleLock(g.bag.indexOf(keep));
  g.dismantleItem(g.bag.indexOf(keep));
  ok(!g.bag.includes(keep), "解锁后可正常分解");

  // —— 批量分解:史诗+出重铸石,数额与逐件一致
  const epic = new Item("weapon", "epic", 40, 12, [{ id: "atk", val: 8 }], 10);
  g.bag.push(epic);
  const stones0 = g.stones;
  g.dismantleJunk(3);                                // ≤史诗
  eq(g.stones - stones0, 2, "史诗+10 分解出 2 颗重铸石(rid-2=1 + plus≥10=1)");

  // —— 锁定状态序列化:往返保真;未锁定不写字段(省字节)
  const li = new Item("weapon", "rare", 20, 8, [{ id: "atk", val: 3 }]);
  li.locked = true;
  ok(Item.fromDict(li.toDict()).locked, "锁定状态存档往返保真");
  ok(!("locked" in new Item("weapon", "common", 1, 1, []).toDict()), "未锁定不序列化 locked");

  // —— 分怪图鉴:击杀计数 + 存档往返
  const g2 = newGame(426247);
  g2.chooseClass("warrior");
  let guard = 0;
  while (g2.stats.kills === 0 && guard++ < 800) g2.tick(0.1);
  ok(g2.stats.kills > 0, "战斗击杀发生");
  const ids = Object.keys(g2.monKills);
  eq(ids.length, 1, "分怪计数记录了首杀怪物 id");
  eq(g2.monKills[ids[0] ?? ""], 1, "该怪计数 =1");
  const d2 = JSON.parse(JSON.stringify(g2.toDict()));
  ok((d2.mon_kills ?? {})[ids[0] ?? ""] === 1, "mon_kills 进存档");
  eq(Game.fromDict(d2).monKills[ids[0] ?? ""], 1, "mon_kills 往返保真");
  eq(Game.fromDict({ ...d2, mon_kills: undefined }).monKills[ids[0] ?? ""], undefined,
    "旧档无 mon_kills 字段容错(空对象)");
}

// ================================================================ 19. 签到/周常/世系/称号/兑换码
function testSigninWeekly(): void {
  const dayKey = (off: number): string => {
    const d = new Date(Date.now() + off * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const g = newGame(426248);
  g.chooseClass("warrior");

  // —— 签到:领取/防重/进度推进/断签重置 ——
  ok(g.canSignin(), "新档今日可领");
  const gold0 = g.gold;
  g.claimSignin();
  ok(!g.canSignin(), "领后当日不可再领");
  eq(g.gold - gold0, 5000, "第 1 天奖励 5000 金到账");
  g.claimSignin();
  eq(g.gold - gold0, 5000, "重复领取被拒");
  // 伪造"昨天领过"(pos 已是 1):今天可领第 2 天(2 重铸石)
  g.signinLast = dayKey(-1);
  const stones0 = g.stones;
  ok(g.canSignin(), "隔一天签到进度保留");
  g.claimSignin();
  eq(g.stones - stones0, 2, "第 2 天奖励 2 重铸石(连续签到推进)");
  eq(g.signinPos, 2, "进度推进到第 3 天");
  // 断签(3 天前):rollDaily 重置
  g.signinLast = dayKey(-3);
  g.rollDaily();
  eq(g.signinPos, 0, "断签后 7 日进度重置");
  // 第 7 天:药剂奖励(buff 生效)
  g.signinPos = 6;
  g.signinLast = dayKey(-1);
  g.claimSignin();
  ok((g.buffs.atk ?? g.buffs.dmg_pct) !== undefined || Object.keys(g.buffs).length > 0,
    "第 7 天药剂 buff 生效");
  eq(g.signinPos, 0, "领完第 7 天循环回第 1 天");

  // —— 周常:打点/计数/宝箱/称号/周重置 ——
  g.weeklyBump("kills", 2000);
  g.weeklyBump("boss", 40);
  eq(g.weeklyDoneCount(), 2, "完成 2 项目标");
  g.claimWeeklyChest("chest3");
  ok(!g.weeklyClaimed.includes("chest3"), "未达 3 项不可领 chest3");
  g.weeklyBump("quests", 8);
  const st1 = g.stones;
  g.claimWeeklyChest("chest3");
  eq(g.stones - st1, 8, "chest3 发 8 重铸石");
  g.claimWeeklyChest("chest3");
  eq(g.stones - st1, 8, "重复领被拒");
  g.weeklyBump("zones", 15);
  g.weeklyBump("rebirths", 1);
  g.weeklyBump("enhance", 150);
  eq(g.weeklyDoneCount(), 6, "全部 6 项完成");
  g.claimWeeklyChest("chest6");
  eq(g.stones - st1, 8 + 20, "chest6 发 20 重铸石");
  ok(g.titles.includes("t_week"), "周常全勤得称号「周征服者」");
  // 周重置
  g.weekKey = "2000-W1";
  g.rollDaily();
  eq(g.weeklyDoneCount(), 0, "跨周清零");
  eq(g.weeklyClaimed.length, 0, "宝箱领取态清零");

  // —— 兑换码:发放/防重/无效码 ——
  const gold1 = g.gold, stones1 = g.stones, keys1 = g.tower.keys;
  g.redeemCode("  abyss2026  ");   // 大小写与空白容错
  eq(g.gold - gold1, 100000, "上线礼包 10 万金");
  eq(g.stones - stones1, 5, "上线礼包 5 重铸石");
  eq(g.tower.keys - keys1, 1, "上线礼包 1 塔钥匙");
  g.redeemCode("ABYSS2026");
  eq(g.gold - gold1, 100000, "重复兑换被拒");
  g.redeemCode("NOT-A-CODE");
  eq(g.redeemed.length, 1, "无效码不入账");

  // —— 世系 + 称号(经真实转生;深度=锚点 → k=1)——
  g.level = BAL.rebirth_min_level;
  g.zone = BAL.rebirth_depth_ref;
  g.runMaxZone = BAL.rebirth_depth_ref;
  const killsBefore = g.stats.kills;
  g.rebirth("mage");
  eq(g.lineage.length, 1, "转生记入世系");
  eq(g.lineage[0]!.cls, "warrior", "世系记录旧职业");
  eq(g.lineage[0]!.kills, killsBefore, "世系记录终身击杀");
  ok(g.titles.includes("t_reb1"), "首次转生得称号「轮回者」");
  g.setTitle("t_reb1");
  eq(g.title, "t_reb1", "佩戴称号");
  g.setTitle("");
  eq(g.title, "", "卸下称号");

  // —— 存档往返 ——
  g.signinPos = 3;
  g.weeklyBump("kills", 5);
  const d = JSON.parse(JSON.stringify(g.toDict()));
  const g2 = Game.fromDict(d);
  eq(g2.signinPos, 3, "往返:签到进度");
  eq(g2.weekly.kills, 5, "往返:周常计数");
  eq(g2.lineage.length, 1, "往返:世系");
  eq(g2.redeemed.length, 1, "往返:兑换记录");
  ok(g2.titles.includes("t_week"), "往返:称号");
  eq(Game.fromDict({ ...d, signin_pos: undefined, weekly: undefined }).signinPos, 0,
    "旧档无新字段容错(默认值)");
}

// ================================================================ 20. 强化继承 / 图鉴二期加成 / 成就新维度
function testInheritCodex(): void {
  const g = newGame(426249);
  g.chooseClass("warrior");
  // —— 继承:费用精确、+N 转移、旧件清零、金币不足回退 ——
  const old = new Item("weapon", "rare", 20, 8, [{ id: "atk", val: 3 }], 5);
  const nu = new Item("weapon", "epic", 40, 12, [{ id: "atk", val: 8 }]);
  g.equip.weapon = old;
  g.bag.push(nu);
  g.gold = 10_000_000;
  const fee = g.inheritCost(nu, 5);
  ok(fee > 0, "继承费为正");
  g.pendingSwap = { kind: "item", slot: "weapon", item: nu };
  const goldA = g.gold;
  g.resolveSwap(true, true);
  eq(nu.plus, 5, "新件继承 +5");
  eq(old.plus, 0, "旧件清零");
  eq(g.gold, goldA - fee, "实扣 = inheritCost(新件曲线 50%)");
  ok(g.equip.weapon === nu, "新件已装备");
  // 金币不足:回退为普通换装(不继承)
  const g2 = newGame(426250);
  g2.chooseClass("warrior");
  const old2 = new Item("weapon", "rare", 20, 8, [{ id: "atk", val: 3 }], 3);
  const nu2 = new Item("weapon", "epic", 40, 12, [{ id: "atk", val: 8 }]);
  g2.equip.weapon = old2;
  g2.bag.push(nu2);
  g2.gold = 0;
  g2.pendingSwap = { kind: "item", slot: "weapon", item: nu2 };
  g2.resolveSwap(true, true);
  eq(nu2.plus, 0, "金币不足不继承");
  ok(g2.equip.weapon === nu2, "但仍完成普通换装");

  // —— 图鉴二期:每种已点亮怪攻/生命 +codex_per% ——
  const g3 = newGame(426251);
  g3.chooseClass("warrior");
  const atk0 = g3.hero.atk;
  g3.monKills.slime = 1;
  g3.recalcHero();
  close(g3.hero.atk, atk0 * (1 + BAL.codex_per / 100), "点亮 1 种:+0.3% 攻");
  for (const id of Object.keys(MONSTERS)) g3.monKills[id] = 1;
  g3.recalcHero();
  close(g3.hero.atk, atk0 * (1 + BAL.codex_per * Object.keys(MONSTERS).length / 100),
    "全图鉴:17 种 +5.1% 攻");

  // —— 成就新维度:stats 口径同步 + 跨档提示 ——
  g3.level = 50;
  g3.rebirths = 1;
  g3.tower.max_floor = 5;
  g3.playtime = 3600;
  g3.recalcHero();
  eq(g3.stats.rebirths, 1, "stats.rebirths 同步");
  eq(g3.stats.max_floor, 5, "stats.max_floor 同步");
  eq(g3.stats.playtime, 3600, "stats.playtime 同步");
  g3.checkAchTiers();   // 建基线
  g3.rebirths = 5;
  g3.recalcHero();
  g3.checkAchTiers();
  ok(toastTexts(g3).some(t => t.includes("轮回大师")), "轮回大师跨档发提示");
}

// ================================================================ 21. 方案B:转生深度加权
function testRebirthDepth(): void {
  const mk = (zone: number): Game => {
    const g = newGame(426252);
    g.chooseClass("warrior");
    g.level = BAL.rebirth_min_level;
    g.zone = zone;
    g.runMaxZone = zone;
    return g;
  };
  // 锚点:130 区 = k=1(与旧固定 +25% 等值,老档零迁移的根据)
  {
    const g = mk(BAL.rebirth_depth_ref);
    g.rebirth();
    eq(g.rebirths, 1, "锚点深度 k=1");
    eq(g.runMaxZone, 1, "转生后本世最远重置");
    eq(g.zone, 1, "转生后区域重置");
  }
  // 深度加倍 → k 加倍;封顶 4;极浅保底 0.25
  {
    const g = mk(BAL.rebirth_depth_ref * 2);
    g.rebirth();
    eq(g.rebirths, 2, "深度×2 → k=2");
    g.level = BAL.rebirth_min_level;
    g.zone = BAL.rebirth_depth_ref * 10;
    g.runMaxZone = BAL.rebirth_depth_ref * 10;
    g.rebirth();
    eq(g.rebirths, 2 + BAL.rebirth_k_max, "超封顶深度 → k=4");
    const g2 = mk(10);
    g2.rebirth();
    eq(g2.rebirths, BAL.rebirth_k_min, "极浅转生保底 k=0.25(比旧口径 -94%)");
  }
  // 倍率口径:三围按加权世数 ×25%(k=2 → +50%)
  {
    const g = mk(BAL.rebirth_depth_ref * 2);
    const base = newGame(426253);
    base.chooseClass("warrior");
    const baseAtk = base.hero.atk;
    g.rebirth();
    const rebAch = ACHIEVEMENTS.find(a => a.id === "rebirther")!;
    close(g.hero.atk, baseAtk * (1 + BAL.rebirth_stat_pct * 2 / 100) * (1 + rebAch.per / 100),
      "k=2 → 三围 +50%(另含轮回大师第 1 档)");
    ok(g.hero.goldfind >= BAL.rebirth_gain_pct * 2, "k=2 → 金币加成 +20%");
  }
  // 老档整数世数天然等值:rebirths=2 的旧档重载后倍率仍是 +50%
  {
    const g = mk(BAL.rebirth_depth_ref);
    g.rebirth();
    g.level = BAL.rebirth_min_level;
    g.zone = BAL.rebirth_depth_ref;
    g.runMaxZone = BAL.rebirth_depth_ref;
    g.rebirth();
    eq(g.rebirths, 2, "两次锚点转生 → 加权 2.0");
    const d = JSON.parse(JSON.stringify(g.toDict()));
    const g2 = Game.fromDict(d);
    eq(g2.rebirths, 2, "加权世数存档往返保真");
    eq(g2.runMaxZone, 1, "本世最远往返保真");
    close(g2.hero.atk, g.hero.atk, "往返后倍率一致(老档等值)");
  }
}

// ================================================================ 28. 深渊天赋(魂晶/消费/门槛/特殊节点/存档 v9)
function testTalents(): void {
  const mem = memHooks();
  const g = newGame(426260);
  g.chooseClass("warrior");

  // —— 转生发放魂晶:锚点 k=1 → round(1×5)=5;极浅保底 1 ——
  g.level = BAL.rebirth_min_level;
  g.zone = BAL.rebirth_depth_ref;
  g.runMaxZone = BAL.rebirth_depth_ref;
  g.rebirth();
  eq(g.rebirths, 1, "锚点转生 k=1");
  eq(g.essence, 5, "锚点转生发放 5 魂晶");
  eq(g.lifetimeEssence, 5, "终身获得累计");
  eq(g.stats.essence_total, 5, "stats.essence_total 口径同步(recalcHero)");
  ok(toastTexts(g).some(t => t.includes("魂晶")), "转生 toast 提及魂晶");
  const gs = newGame(426259);
  gs.chooseClass("mage");
  gs.level = BAL.rebirth_min_level;
  gs.zone = 10;
  gs.runMaxZone = 10;
  gs.rebirth();
  eq(gs.essence, 1, "极浅转生(k=0.25)保底 1 魂晶");

  // —— 消费:门槛拦截 / 魂晶不足拦截 / 精确扣费 / 修饰器生效 ——
  ok(g.talentGated("t_critdmg"), "t_critdmg 需 5 世,当前 1 世被门槛拦住");
  ok(!g.talentGated("t_atk"), "t_atk 1 世即可购买");
  const atk0 = g.hero.atk;
  g.talentUp("t_atk");
  eq(g.talentLevel("t_atk"), 1, "购买后 Lv1");
  eq(g.essence, 3, "扣费 2(费用 = cost0 + step×0)");
  close(g.hero.atk, atk0 * 1.025, "t_atk Lv1:攻击 +2.5% 进修饰管道");
  g.talentUp("t_atk");                 // 第二级费用 4 > 3:拒绝
  eq(g.talentLevel("t_atk"), 1, "魂晶不足不升级");
  eq(g.essence, 3, "拒绝购买不扣费");
  g.essence = 100;
  g.talentUp("t_atk");
  eq(g.essence, 96, "第二级费用 4");
  g.essence = 10000;
  g.rebirths = 200;                    // 越过全部门槛
  for (let i = 0; i < 20; i++) g.talentUp("t_atk");
  eq(g.talentLevel("t_atk"), 10, "可升至满级 10");
  eq(g.talentCost("t_atk"), null, "满级后费用 null");
  g.recalcHero();
  eq(g.stats.talent_total, 10, "stats.talent_total 同步");

  // —— 特殊节点:离线上限(时之沙)与转生起始区(轮回足迹)——
  g.talents.t_offline = 0;
  eq(g.offlineCapSec(), BAL.offline_cap_sec, "无天赋时离线上限 = 基础 12h");
  g.talents.t_offline = 3;
  eq(g.offlineCapSec(), BAL.offline_cap_sec + 3 * 3600, "时之沙 Lv3:+3h");
  g.talents.t_start = 2;
  g.level = BAL.rebirth_min_level;
  g.zone = BAL.rebirth_depth_ref;
  g.runMaxZone = BAL.rebirth_depth_ref;
  g.rebirth();
  eq(g.zone, 5, "轮回足迹 Lv2:第 5 区起步");
  eq(g.runMaxZone, 5, "本世最远随起步区初始化");

  // —— 存档往返 + v8→v9 迁移 + 未知节点防御 ——
  g.essence = 7;
  g.lifetimeEssence = 12;
  g.talents = { t_atk: 3, t_forge: 1, bad_node: 9 };
  g.save();
  const d = JSON.parse(mem.raw);
  eq(d.essence, 7, "essence 进存档");
  eq(d.talents.t_atk, 3, "talents 进存档");
  eq(d.talents.bad_node, 9, "未知节点原样在档(载入时剔除)");
  const g2 = Game.fromDict(d);
  eq(g2.essence, 7, "往返 essence");
  eq(g2.lifetimeEssence, 12, "往返 lifetime_essence");
  eq(g2.talentLevel("t_atk"), 3, "往返天赋等级");
  eq(g2.talentLevel("bad_node"), 0, "未知节点载入时剔除");
  eq(g2.talentLevel("t_forge"), 1, "锻造解锁节点往返保真");
  const v8 = { ...d, version: 8 } as Record<string, unknown>;
  delete v8.essence;
  delete v8.talents;
  delete v8.lifetime_essence;
  const m9 = migrateSave(v8);
  eq(m9.version, SAVE_VERSION, "v8 起步链式迁移至当前版本(v8→v9→v10)");
  ok(m9.boss && m9.boss.last_round === "" && Array.isArray(m9.boss.claimed),
    "v8 旧档同链补世界BOSS 默认(v10 段)");
  eq(m9.essence, 0, "v8 旧档魂晶默认 0");
  ok(typeof m9.talents === "object" && Object.keys(m9.talents).length === 0,
    "v8 旧档天赋默认空表");
}

// ================================================================ 29. 定向锻造(解锁门槛/费用/必带词缀/自动出售豁免)
function testForge(): void {
  const g = newGame(426262);
  g.chooseClass("warrior");
  g.gold = 1e12;
  g.stones = 1000;
  ok(!g.canForge(), "未购「深渊锻造台」:不可锻造");
  g.craft("weapon", "crit");
  eq(g.stats.crafted ?? 0, 0, "未解锁时 craft 无效果");
  eq(g.bag.length + Object.keys(g.equip).length, 0, "未解锁不出装备");

  g.talents.t_forge = 1;
  ok(g.canForge(), "购入天赋节点后可锻造");
  g.zone = 30;
  g.stage = 5;
  const cost = g.forgeCost();
  eq(cost.tier, tierOf(30, 5), "tier 与当前区域档同源");
  ok(cost.gold > 0, "金币费为正");
  ok(cost.stones >= BAL.forge_stones0, "重铸石费含基础费");
  g.settings.auto_sell_idx = 4;        // 自动出售 ≤传说:锻造件必须豁免
  const gold0 = g.gold, st0 = g.stones;
  g.craft("ring", "crit");
  eq(g.stats.crafted, 1, "锻造计数 +1");
  eq(g.gold, gold0 - cost.gold, "金币精确扣费");
  eq(g.stones, st0 - cost.stones, "重铸石精确扣费");
  eq(g.stats.sold_total ?? 0, 0, "锻造件不被自动出售折现");
  const it = g.equip.ring ?? g.bag.find(i => i.slot === "ring");
  ok(it !== undefined, "锻造产出进游戏(自动换装或入背包)");
  ok(it.affixes.some(a => a.id === "crit"), "必带所选词缀(暴击率)");
  ok(RARITY_IDX[it.rarity] >= BAL.forge_min_rid, "稀有度保底稀有+");
  eq(it.tier, cost.tier, "产物 tier = 当前区域档");

  // —— 拒绝路径:背包满 / 石头不足 ——
  g.equip = {};
  g.bag = [];
  for (let i = 0; i < g.bagCap(); i++) g.bag.push(new Item("weapon", "common", 5, 5, [{ id: "atk", val: 1 }]));
  const cGold = g.gold, cStones = g.stones;
  g.craft("ring", "crit");
  eq(g.stats.crafted, 1, "背包满拒绝锻造");
  eq(g.gold, cGold, "拒绝时不扣金币");
  g.bag = [];
  g.stones = cost.stones - 1;
  g.craft("ring", "crit");
  eq(g.stats.crafted, 1, "重铸石不足拒绝锻造");
  g.stones = 1000;
  g.craft("ring", "no_such_affix");
  eq(g.stats.crafted, 1, "非法词缀 id 拒绝");
}

// ================================================================ 30. 塔怪技能(2.4:爬塔不再是纯普攻对拼)
function testTowerSkills(): void {
  const rng = new PyRandom(426263);
  let seen = new Set<string>();
  for (const floor of [1, 2, 3, 5, 10, 23, 25]) {
    const mon = towerMonster(floor, rng);
    ok(mon.skill !== null, `塔第${floor}层怪带技能(${mon.skill?.name})`);
    if (mon.skill) seen.add(mon.skill.name);
    eq(mon.boss, floor % 5 === 0, `第${floor}层头目判定不变`);
  }
  ok(seen.size >= 2, `多楼层技能有变化(实际 ${seen.size} 种)`);
}

// ================================================================ 31. 成就第三梯队(经济打点/新维度跨档)
function testAchThirdWave(): void {
  const g = newGame(426264);
  g.chooseClass("warrior");
  // —— 经济打点:出售 / 分解 / 签到 ——
  for (const r of ["common", "fine"]) g.bag.push(new Item("weapon", r, 5, 10, [{ id: "atk", val: 1 }]));
  g.sellJunk(1);
  eq(g.stats.sold_total, 2, "一键出售 2 件计入 sold_total");
  g.bag.push(new Item("weapon", "epic", 5, 10, [{ id: "atk", val: 1 }]));
  g.dismantleJunk(5);
  eq(g.stats.dismantled, 1, "批量分解计入 dismantled");
  eq(g.stones >= 1, true, "史诗分解出重铸石(老口径不变)");
  g.claimSignin();
  eq(g.stats.signin_total, 1, "签到计入 signin_total");
  // —— 派生口径:talent_total / essence_total 由 recalcHero 同步 ——
  g.talents.t_atk = 5;
  g.lifetimeEssence = 100;
  g.recalcHero();
  eq(g.stats.talent_total, 5, "talent_total 同步");
  eq(g.stats.essence_total, 100, "essence_total 同步");
  // —— 新维度跨档提示(成就管道;先回零建基线,再单调上涨)——
  g.lifetimeEssence = 0;
  g.recalcHero();
  g.checkAchTiers();                   // 建基线(talent_total=5 → 第 1 档)
  g.talents.t_hp = 15;                 // talent_total 20 → 第 2 档
  g.recalcHero();
  g.checkAchTiers();
  ok(toastTexts(g).some(t => t.includes("天赋觉醒") && t.includes("第 2 档")),
    "天赋觉醒跨档发提示");
  g.lifetimeEssence = 25;              // 魂晶收藏家第 1 档
  g.recalcHero();
  g.checkAchTiers();
  ok(toastTexts(g).some(t => t.includes("魂晶收藏家")), "魂晶收藏家跨档发提示");
}

// ================================================================ 33. 怪物技能特效事件(mskill:<名字>)
function testMobSkillFxEvent(): void {
  const g = newGame(426265);
  g.chooseClass("warrior");
  // 直喂一只史莱姆(酸液喷吐):血防极端化,一拍内互不击杀,只验证事件链
  const sk = MONSTERS.slime.skill;
  const mon = new Monster("史莱姆", ["  "], "green", 1e9, 1, 0, 1, false, false, 1, sk, "slime");
  g.monster = mon;
  mon.skillTimer = sk.cd;             // 到点,本拍必放
  battleTick(g, 0.05);
  ok(g.events.some(e => e[0] === "anim" && e[1] === "mskill:" + sk.name),
    `怪技施放发 mskill 事件(${sk.name})`);
  eq(g.events.filter(e => e[0] === "anim" && e[1].startsWith("mskill:")).length, 1,
    "单次施放仅一条 mskill 事件");
  // 塔怪同路径:技能名原样透传(towerMonster 携带 mob.skill)
  const tmon = towerMonster(6, new PyRandom(7));
  g.monster = tmon;
  g.events.length = 0;
  tmon.skillTimer = tmon.skill!.cd;
  battleTick(g, 0.05);
  ok(g.events.some(e => e[0] === "anim" && e[1] === "mskill:" + tmon.skill!.name),
    `塔怪走同一路径(${tmon.skill!.name})`);
  // 击杀发 mon_die(死亡表现事件,恰好一次):攒满攻速计时强制本拍出手
  g.events.length = 0;
  (g.monster as Monster).hp = 1;
  (g.monster as Monster).atk = 0;      // 塔怪技能可能已打晕/打残英雄:清状态强制本拍出手
  g.hero.hp = g.hero.max_hp;
  g.hero.stun_until = 0;
  g.hero.atk_timer = g.hero.interval;   // 恰好一刀(999 会一拍数百刀,事件队列打满把 mon_die 挤掉)
  const kills0 = g.stats.kills;
  battleTick(g, 0.05);
  eq(g.events.filter(e => e[0] === "anim" && e[1] === "mon_die").length, 1,
    "击杀恰发一次 mon_die");
  ok(g.stats.kills === kills0 + 1, "击杀计数随之+1");
}

// ================================================================ 34. 断签重置幂等(防「连续签到中断」日志刷屏)
function testSigninStreakIdempotent(): void {
  const g = newGame(426266);
  g.chooseClass("warrior");
  g.claimSignin();
  eq(g.signinPos, 1, "领签后 pos=1");
  // 上次领取拨回远古日期(隔天)→ 断签;rollDaily 每次击杀/悬赏打点都会调,
  // 重置必须幂等:只重置一次、只提示一次(pos=0 后不再重复)
  g.signinLast = "2020-01-01";
  g.events.length = 0;
  g.rollDaily();
  g.rollDaily();
  g.rollDaily();
  const breaks = g.events.filter(e => e[0] === "log" && e[1].includes("连续签到中断")).length;
  eq(breaks, 1, "断签重置仅提示一次(不刷屏)");
  eq(g.signinPos, 0, "7 日进度重置");
  // 同日正常补领不受影响
  g.claimSignin();
  eq(g.signinPos, 1, "重置后可重新领签");
}

// ================================================================ 35. 塔内会话进存档(刷新/关页续战,已扣钥匙的层不作废)
function testTowerSessionSave(): void {
  /** 遗物总数口径:4 槽 + 背包 + 待确认对比(toDict 存档时并入背包,这里同口径合计) */
  const relicTotal = (g: Game): number =>
    g.relics.filter(Boolean).length + g.relicBag.length
    + (g.pendingSwap?.kind === "relic" && g.pendingSwap.newRelic ? 1 : 0);

  // ---- ① 进塔 → toDict/fromDict 往返:会话位/层号/钥匙/本层怪全恢复 ----
  const g = newGame(426267);
  g.chooseClass("warrior");
  g.tower.keys = 5;
  g.tower.max_floor = 4;
  g.towerEnter();                          // 默认进 max_floor+1 = 第5层(头目层)
  eq(g.towerFloorSel, 5, "进塔基线:第5层");
  // 击杀路径守卫:last_refresh 预置今日日期串,让击杀链 weeklyBump/questProgress →
  // rollDaily 触发的钥匙刷新成为同日 no-op;必须在 toDict 之前 —— 恢复出的 g2 也要带
  const t = new Date();
  g.tower.last_refresh =
    `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const d = JSON.parse(JSON.stringify(g.toDict()));
  eq(d.tower.in_tower, true, "存档写入 tower.in_tower=true");
  eq(d.tower.floor_sel, 5, "存档写入 tower.floor_sel=5");
  const g2 = Game.fromDict(d);
  eq(g2.inTower, true, "往返后仍在塔中");
  eq(g2.towerFloorSel, 5, "往返后塔层=5");
  eq(g2.tower.keys, g.tower.keys, "往返后钥匙一致");
  ok(g2.monster !== null, "载入后直接重开本层怪(不落主线 spawn)");
  eq(g2.monster!.tier, 5, "本层怪 tier=5");
  eq(g2.monster!.boss, true, "第5层是头目层");

  // ---- ② 载入续战可用:推至击杀 → towerExit(true) 自动结算并连爬 ----
  const relics0 = relicTotal(g2);
  g2.monster!.hp = 0.001;                  // 直喂濒死(参考 test33 手法),一拍内击杀
  battleTick(g2, 0.05);
  eq(g2.towerFloorSel, 6, "击杀后钥匙足够自动连爬第6层");
  eq(g2.inTower, true, "连爬后仍在塔中");
  ok(g2.monster !== null && g2.monster.tier === 6, "连爬已刷出第6层怪");
  eq(relicTotal(g2), relics0 + 1, "胜层必掉 1 遗物(4槽+背包+pendingSwap)");
  // 注:此处不断言 stones/gold 总量 —— 第5层是头目层,boss_stone 抽签(combat.ts)
  // 是干扰源,经济总量口径由 testTowerEconomy 统一锁定

  // ---- ③ 旧档兼容:无会话字段默认塔外;tower 整体坏数据回默认 ----
  const old = Game.fromDict({ seed: 7, tower: { keys: 5, max_floor: 7 } });
  eq(old.inTower, false, "旧档无 in_tower 默认塔外");
  eq(old.towerFloorSel, 8, "旧档无 floor_sel 回 max_floor+1");
  const bad = Game.fromDict({ seed: 7, tower: "坏数据" });
  eq(bad.inTower, false, "坏 tower 整体默认后塔外");
  eq(bad.tower.keys, 3, "坏 tower 回默认钥匙 3");
  eq(bad.tower.max_floor, 0, "坏 tower 回默认 0 层");
  // floor_sel 有限但离谱的值(非整数/越上界)也回默认层,不再喂给 towerMonster 生成畸高层怪
  const frac = Game.fromDict({ seed: 7, tower: { keys: 5, max_floor: 7, in_tower: true, floor_sel: 5.5 } });
  eq(frac.towerFloorSel, 8, "floor_sel 非整数(5.5)回 max_floor+1");
  const huge = Game.fromDict({ seed: 7, tower: { keys: 5, max_floor: 7, in_tower: true, floor_sel: 1e9 } });
  eq(huge.towerFloorSel, 8, "floor_sel 越上界(1e9)回 max_floor+1");
  // web tower_enter 坏参(data-a="abc" → Number()=NaN)由 towerEnter 校验拒绝,
  // 不静默回退成默认层进塔扣钥 —— main.ts 依赖此契约,原样透传
  const gn = Game.fromDict({ seed: 7, tower: { keys: 5, max_floor: 7 } });
  gn.towerEnter(NaN);
  eq(gn.inTower, false, "NaN 层号被拒绝(不静默进塔)");
  eq(gn.tower.keys, 5, "NaN 层号不扣钥匙");

  // ---- ④ 塔内离线不结算:主线补算模型会推 zone/stage,破坏塔内会话语义 ----
  const zone0 = g2.zone, floor0 = g2.towerFloorSel;
  const rep = resolve(g2, 3600);
  eq(rep.kills, 0, "塔内离线 kills=0");
  eq(rep.deaths, 0, "塔内离线 deaths=0");
  eq(rep.gold, 0, "塔内离线 gold=0");
  eq(g2.zone, zone0, "塔内离线 zone 不变");
  eq(g2.towerFloorSel, floor0, "塔内离线塔层不变");
  eq(resolveOffline(g2, 3600), null, "塔内离线不弹结算报告");
}

// ================================================================ 36. 每日免费钥匙(跨日打点发放 + 首刷补足不砸囤积)
function testTowerDailyKeys(): void {
  const mkTower = (keys: number, last_refresh: string | null): TowerState =>
    ({ keys, max_floor: 0, last_refresh, in_tower: false, floor_sel: 1 });
  const ts = Date.now() / 1000;   // 显式传参:同一段内两次调用传同一 ts,日差恒定,无午夜竞态

  // ---- ① 首刷:0 → 3;同 ts 再调返回 0(同日幂等) ----
  const t1 = mkTower(0, null);
  eq(refreshKeys(t1, ts), 3, "首刷 keys=0 补到 3");
  eq(t1.keys, 3, "首刷后 keys=3");
  eq(refreshKeys(t1, ts), 0, "同日再刷返回 0(幂等)");
  eq(t1.keys, 3, "幂等刷新不动 keys");

  // ---- ② 修复点:囤积钥匙不被首刷砸回 3(last_refresh 为空 ≠ keys 为 0) ----
  const t2 = mkTower(50, null);
  eq(refreshKeys(t2, ts), 0, "keys 已超日额,首刷补足 0");
  eq(t2.keys, 50, "囤积 50 把不因首刷减少");

  // ---- ③ 跨日补发按封顶(keys_cap=99)钳制 ----
  const t3a = mkTower(0, "2020-01-01");
  eq(refreshKeys(t3a, ts), 99, "远古日期一次补满 99(封顶)");
  eq(t3a.keys, 99, "补发后 keys=99");
  const t3b = mkTower(97, "2020-01-01");
  eq(refreshKeys(t3b, ts), 2, "97 → 99 只补差额 2");
  const t3c = mkTower(99, "2020-01-01");
  eq(refreshKeys(t3c, ts), 0, "已满额补 0");

  // ---- ④ rollDaily 联动:跨日打点即发放,与加购额度同拍清零 ----
  const g = newGame(426268);
  g.chooseClass("warrior");
  g.questDailyDate = "2020-01-01";
  g.tower.last_refresh = "2020-01-01";
  g.towerKeysBought = 7;
  g.tower.keys = 0;
  g.rollDaily();
  eq(g.towerKeysBought, 0, "跨日加购计数清零");
  eq(g.tower.keys, 99, "跨日补发免费钥匙(封顶)");
  g.rollDaily();
  eq(g.tower.keys, 99, "同日再打点不重复发放");

  // ---- ⑤ 击杀路径联动(活文档断言,不带守卫,钉死本项引入的行为): ----
  // 全新游戏不 tick,questDailyDate=""、last_refresh=null;进塔(keys 1→0)后首杀,
  // 击杀链 weeklyBump/questProgress → rollDaily 会在 towerExit 判定前补发当日免费
  // 钥匙,连爬因此继续。账目:1 −1 进塔 +3 首杀补发 −1 连爬 = 2。
  // (验收原文写 keys===3,漏计了连爬扣 1;以实跑为准 —— inTower=true 与 floor=2
  // 恰是"补发使连爬继续"的直接证据:若无补发,钥尽离塔 inTower=false。)
  // 生产不可达该联动:tick 内 rollDaily 先于 battleTick,登录路径也先刷新;
  // 仅测试直喂手法可触发。其余塔测试凡击杀段必须预置 last_refresh=今日(见 test35/37/38)。
  const g2 = newGame(426269);
  g2.chooseClass("warrior");
  eq(g2.questDailyDate, "", "全新游戏未打过日打点");
  g2.tower.keys = 1;
  g2.towerEnter();
  eq(g2.tower.keys, 0, "进塔扣 1 把");
  g2.monster!.hp = 0.001;
  battleTick(g2, 0.05);
  eq(g2.tower.keys, 2, "首杀补发 +3 后连爬 −1(账目 1−1+3−1)");
  eq(g2.inTower, true, "补发使连爬继续(未钥尽离场)");
  eq(g2.towerFloorSel, 2, "已爬上第2层");
}

// ================================================================ 37. 选层重打已通层(卡墙换稳定收益/低层遗物复刷)
function testTowerRefloor(): void {
  /** 遗物总数口径与 test35 相同:4 槽 + 背包 + 待确认对比 */
  const relicTotal = (g: Game): number =>
    g.relics.filter(Boolean).length + g.relicBag.length
    + (g.pendingSwap?.kind === "relic" && g.pendingSwap.newRelic ? 1 : 0);
  const today = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();

  const g = newGame(426270);
  g.chooseClass("warrior");
  g.tower.keys = 5;
  g.tower.max_floor = 9;
  g.tower.last_refresh = today;   // 击杀路径守卫:同日幂等,rollDaily 补钥不干扰钥匙账

  // ---- ① 无参默认 max_floor+1(现行为回归不变) ----
  g.towerEnter();
  eq(g.towerFloorSel, 10, "无参进塔仍是 max_floor+1 = 第10层");
  g.towerExit(false);             // 撤退离场,继续下一组
  g.respawnTimer = 0;

  // ---- ② 选层进塔:第5层(头目层,仅状态断言;boss_stone 抽签通道锁定归 test38) ----
  g.towerEnter(5);
  eq(g.tower.keys, 3, "进塔扣 1 钥匙(5-1-1)");
  eq(g.inTower, true, "选层进塔成功");
  eq(g.towerFloorSel, 5, "所选层=5");
  eq(g.monster!.tier, 5, "第5层怪 tier=5");
  eq(g.monster!.boss, true, "第5层是头目层");
  g.towerExit(false);
  g.respawnTimer = 0;

  // ---- ③ 越界/非整数拒绝:keys/inTower 不变(无击杀段) ----
  g.towerEnter(0);
  g.towerEnter(11);
  g.towerEnter(9.5);
  eq(g.tower.keys, 3, "非法层数不扣钥匙");
  eq(g.inTower, false, "非法层数不进塔");
  ok(toastTexts(g).some(t => t.includes("1~10")), "越界给出范围提示");

  // ---- ④ 重打结算(非头目层 6,双重排除抽签:6≤9 无新高石,6%5≠0 无 boss_stone)----
  const stones0 = g.stones, gold0 = g.gold, relics0 = relicTotal(g);
  g.towerEnter(6);
  g.monster!.hp = 1;
  battleTick(g, 0.05);
  ok(g.towerFloorSel === 7 && g.inTower, "击杀重打层后照常连爬第7层");
  eq(g.tower.max_floor, 9, "重打层通关不涨 max_floor");
  eq(g.stones - stones0, 0, "重打已通层不发新高石(也无其他石来源)");
  ok(g.gold > gold0, "重打层金币照发");
  eq(relicTotal(g), relics0 + 1, "重打层通关必掉遗物");

  // ---- ⑤ CLI:←→ 会话选层 + 塔页渲染含选层提示 ----
  g.view.ui.tab = 7;
  g.view.ui.tower_floor_pick = undefined;    // 会话默认:max_floor+1
  handleKey(g, "left");
  eq(g.view.ui.tower_floor_pick, 9, "← 从默认 10 退到 9(可重打)");
  handleKey(g, "left"); handleKey(g, "left"); handleKey(g, "left"); handleKey(g, "left");
  handleKey(g, "left"); handleKey(g, "left"); handleKey(g, "left"); handleKey(g, "left");
  handleKey(g, "left"); handleKey(g, "left"); handleKey(g, "left"); handleKey(g, "left");
  eq(g.view.ui.tower_floor_pick, 1, "连按 ← 夹取下界 1");
  handleKey(g, "left");
  eq(g.view.ui.tower_floor_pick, 1, "越下界不再下移");
  g.view.ui.tower_floor_pick = undefined;
  handleKey(g, "right");
  eq(g.view.ui.tower_floor_pick, 10, "→ 从默认 10 起不再上移(夹取上界 max_floor+1)");
  const frame = renderFrame(g, 100, 30);
  ok(frame.includes("重打"), "塔页渲染含选层重打提示");
  ok(frame.includes("第 10 层"), "塔页显示所选层");
}

// ================================================================ 38. 每10层首通里程碑宝箱(重铸石)
function testTowerMilestone(): void {
  // ---- ⑥ 参数存在性(新数值只进 TOWER,防魔法数散落) ----
  eq(TOWER.milestone_every, 10, "TOWER.milestone_every=10");
  ok(TOWER.milestone_stones > 0, "TOWER.milestone_stones>0");

  const today = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();
  const logsOf = (g: Game): string[] => g.events.filter(e => e[0] === "log").map(e => e[1]);
  /** 直喂濒死并推一拍到击杀(进塔后装桩,击杀后由调用方撤桩) */
  const killTowerMob = (g: Game): void => { g.monster!.hp = 0.001; battleTick(g, 0.05); };

  // ---- ① 9→10 首达里程碑(第10层是头目层;boss_stone 抽签用实例桩显式定不中:口径B) ----
  const g = newGame(426271);
  g.chooseClass("warrior");
  g.tower.keys = 5;
  g.tower.max_floor = 9;
  g.tower.last_refresh = today;      // 击杀路径守卫:rollDaily 补钥 no-op(见 notes 口径)
  g.towerEnter();                    // 默认进第10层(头目)
  const s0 = g.stones;
  (g.rng as any).random = () => 0.999;   // 实例桩遮蔽原型:0.999≥chance,抽签/掉落判定全不中
  killTowerMob(g);
  delete (g.rng as any).random;           // 断言前撤桩恢复原型
  eq(g.stones - s0, TOWER.new_height_stones + TOWER.milestone_stones,
    "9→10 首达恰 +新高+里程碑(boss_stone 抽签桩定不中)");
  ok(logsOf(g).some(t => t.includes("里程碑") && t.includes("第10层")), "里程碑日志(第10层)");
  ok(logsOf(g).some(t => t.includes("新高度")), "新高度日志同拍发出");
  eq(g.tower.max_floor, 10, "max_floor=10");

  // ---- ② 同局 10→11(11%5≠0 天然无抽签,撤桩真 rng):仅 +新高,同档无里程碑 ----
  const s1 = g.stones;
  g.events.length = 0;
  // 同局第二次击杀:w_strike 已进 CD(①里放过),把普攻节拍顶到差一拍出手,
  // 本拍恰一次 heroAttack 击杀(0.001 血),不受技能 CD/怪物先手时序影响
  g.hero.atk_timer = g.hero.interval / (1 + g.hero.haste / 100) - 0.05;
  killTowerMob(g);                   // 已自动连爬至第11层
  eq(g.towerFloorSel, 12, "②击杀已生效并连爬至12(防漏杀假阳性)");
  eq(g.stones - s1, TOWER.new_height_stones, "10→11 仅 +新高");
  ok(!logsOf(g).some(t => t.includes("里程碑")), "10~19 同档不再发里程碑");
  eq(g.tower.max_floor, 11, "max_floor=11");

  // ---- ③ 重打第10层胜(桩 0.999):无新高/无里程碑/抽签不中 → 石增量恰 0 ----
  const g3 = newGame(426272);
  g3.chooseClass("warrior");
  g3.tower.keys = 2;
  g3.tower.max_floor = 10;
  g3.tower.last_refresh = today;
  g3.towerEnter(10);                 // 选层重打(test37 能力)
  g3.events.length = 0;
  const s3 = g3.stones;
  (g3.rng as any).random = () => 0.999;
  killTowerMob(g3);
  delete (g3.rng as any).random;
  eq(g3.stones - s3, 0, "重打已通层无任何石(新高/里程碑/抽签三重排除)");
  ok(!logsOf(g3).some(t => t.includes("里程碑") || t.includes("新高度")),
    "重打无里程碑/新高度日志(max_floor 单调 ⇒ 天然一次性)");

  // ---- ④ 19→20 胜(桩 0.999):跨下一档再发(跨档可重复、同档不重复) ----
  const g4 = newGame(426273);
  g4.chooseClass("warrior");
  g4.tower.keys = 2;
  g4.tower.max_floor = 19;
  g4.tower.last_refresh = today;
  g4.towerEnter();                   // 第20层(头目)
  const s4 = g4.stones;
  (g4.rng as any).random = () => 0.999;
  killTowerMob(g4);
  delete (g4.rng as any).random;
  eq(g4.stones - s4, TOWER.new_height_stones + TOWER.milestone_stones, "19→20 再发一份里程碑");

  // ---- ⑤ 抽签干扰显式量化:同 9→10 桩 () => 0.0 定抽签必中(把干扰源写进断言) ----
  const g5 = newGame(426274);
  g5.chooseClass("warrior");
  g5.tower.keys = 2;
  g5.tower.max_floor = 9;
  g5.tower.last_refresh = today;
  g5.towerEnter();
  const s5 = g5.stones;
  (g5.rng as any).random = () => 0.0;
  killTowerMob(g5);
  delete (g5.rng as any).random;
  eq(g5.stones - s5, TOWER.new_height_stones + TOWER.milestone_stones + BAL.boss_stone_amt,
    "9→10 抽签必中恰 +新高+里程碑+boss_stone_amt");

  // ---- UI:塔页渲染含「里程碑」(下一里程碑行,由 max_floor 本地算得,不进快照) ----
  g5.view.ui.tab = 7;
  ok(renderFrame(g5, 100, 30).includes("里程碑"), "塔页渲染含下一里程碑提示");
  ok(renderFrame(g5, 100, 30).includes("第20层"), "下一里程碑指向第20层(max_floor=10)");
}

// ================================================================ 39. 塔经济全链路(钥匙账/双轨收益/加购限购/跨日/禁转生 + 重打头目层 boss 通道口径锁定)
function testTowerEconomy(): void {
  const today = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();
  /** 遗物总数口径与 test35 相同:4 槽 + 背包 + 待确认对比 */
  const relicTotal = (g: Game): number =>
    g.relics.filter(Boolean).length + g.relicBag.length
    + (g.pendingSwap?.kind === "relic" && g.pendingSwap.newRelic ? 1 : 0);

  // ---- ① 扣钥 / 钥尽拒绝且状态不变 ----
  const g = newGame(426275);
  g.chooseClass("warrior");
  g.tower.last_refresh = today;         // 击杀路径守卫:rollDaily 补钥 no-op(见 notes 口径)
  g.tower.keys = 0;
  g.towerEnter();
  eq(g.tower.keys, 0, "钥尽拒绝不扣钥匙");
  eq(g.inTower, false, "钥尽不进塔");
  ok(toastTexts(g).some(t => t.includes("钥匙不足")), "钥尽有提示");
  g.tower.keys = 1;
  g.towerEnter();
  eq(g.tower.keys, 0, "进塔扣 1 钥匙");

  // ---- ③ 战败/撤退口径:钥匙不退、按复活计时、塔败不走 retreatStage ----
  const deaths0 = g.stats.deaths, zone0 = g.zone, stage0 = g.stage;
  g.towerExit(false);
  eq(g.tower.keys, 0, "离场钥匙不退(已消耗)");
  eq(g.respawnTimer, BAL.respawn_sec, "撤退/战败按复活计时");
  eq(g.stats.deaths, deaths0, "塔败不计 deaths(combat 塔分支不走 retreatStage)");
  eq(g.zone, zone0, "塔败不动 zone");
  eq(g.stage, stage0, "塔败不动 stage");
  g.respawnTimer = 0;

  // ---- ② 胜利且有钥自动连爬;胜利后钥尽自动离场 ----
  const g2 = newGame(426276);
  g2.chooseClass("warrior");
  g2.tower.keys = 2;
  g2.tower.last_refresh = today;
  g2.towerEnter();                       // 第1层(max_floor=0)
  g2.monster!.hp = 0.001;
  battleTick(g2, 0.05);
  ok(g2.inTower && g2.towerFloorSel === 2 && g2.monster !== null, "胜利且有钥自动扣钥进下一层");
  eq(g2.tower.keys, 0, "连爬再扣 1(2−1进塔−1连爬)");
  g2.hero.atk_timer = g2.hero.interval / (1 + g2.hero.haste / 100) - 0.05;   // 技能进CD,顶普攻差一拍
  g2.monster!.hp = 0.001;
  battleTick(g2, 0.05);
  eq(g2.inTower, false, "胜利后钥尽自动离场");
  eq(g2.monster, null, "离场清怪");

  // ---- ④ 塔内胜利双轨(第1层非头目,无 boss_stone 抽签;桩 0.999 定掉落不中,防自动换装中途改 goldfind) ----
  const g4 = newGame(426277);
  g4.chooseClass("warrior");
  g4.tower.keys = 1;
  g4.tower.last_refresh = today;
  const gf = 1 + (g4.hero.goldfind + buffPct(g4, "gold")) / 100;
  const gold0 = g4.gold, stones0 = g4.stones, kills0 = g4.stats.kills, relics0 = relicTotal(g4);
  g4.towerEnter();                       // 第1层
  (g4.rng as any).random = () => 0.999;
  g4.monster!.hp = 0.001;
  battleTick(g4, 0.05);
  delete (g4.rng as any).random;
  eq(g4.gold - gold0, Math.trunc(mobGold(1) * gf) + Math.trunc(towerGold(1) * gf),
    "胜利双轨金精确:trunc(mobGold(1)×gf) + trunc(towerGold(1)×gf)");
  eq(g4.stats.kills - kills0, 1, "stats.kills +1");
  eq(relicTotal(g4), relics0 + 1, "通关必掉遗物 +1");
  eq(g4.tower.max_floor, 1, "max_floor 0→1");
  eq(g4.stones - stones0, TOWER.new_height_stones, "第1层恰 +new_height_stones(无其他石源)");

  // ---- ⑤ 加购:第 n 把价 / 限购 / 跨日清零恢复 ----
  const g5 = newGame(426278);
  g5.chooseClass("warrior");
  g5.gold = 1e12;
  g5.tower.last_refresh = today;
  g5.questDailyDate = today;
  const price = (n: number) => Math.round(BAL.tower_key_cost_k * n * mobGold(tierOf(g5.zone, g5.stage)));
  for (let n = 1; n <= BAL.tower_key_extra; n++) {
    eq(g5.towerKeyCost(), price(n), `第${n}把价 = round(k×n×击杀金)`);
    g5.buyTowerKey();
  }
  eq(g5.towerKeyCost(), null, "购满 BAL.tower_key_extra 后 cost=null");
  eq(g5.towerKeysBought, BAL.tower_key_extra, "加购计数到位");
  eq(g5.tower.keys, 3 + BAL.tower_key_extra, "免费3 + 加购10 把");
  g5.questDailyDate = "2020-01-01";      // 拨回远古:buyTowerKey 内部先 rollDaily 重置计数
  g5.buyTowerKey();
  eq(g5.towerKeysBought, 1, "跨日计数清零恢复可购");
  eq(g5.towerKeyCost(), price(2), "重购从第 2 把价续");

  // ---- ⑥ 塔中禁转生 ----
  const g6 = newGame(426279);
  g6.chooseClass("warrior");
  g6.level = BAL.rebirth_min_level;
  eq(g6.canRebirth(), true, "塔外达标可转(对照)");
  g6.tower.keys = 1;
  g6.tower.last_refresh = today;
  g6.towerEnter();
  eq(g6.canRebirth(), false, "塔中禁转生");

  // ---- 重打头目层 boss 通道口径锁定(documenting,现行口径:选层重打不切断既有 boss 收益链) ----
  // 预置高目标 boss 悬赏并替换全部任务:隔离 kill/loot 悬赏完成发石的干扰
  const setupBoss = (seed: number): Game => {
    const gb = newGame(seed);
    gb.chooseClass("warrior");
    gb.tower.keys = 1;
    gb.tower.max_floor = 9;
    gb.tower.last_refresh = today;
    gb.quests = [{ type: "boss", target: 999999, progress: 0, gold: 1, stones: 0 }];
    gb.towerEnter(5);                    // 重打第5层(头目)
    return gb;
  };
  // a. 桩 0.0:抽签必中 —— 重打层无新高石/无里程碑,boss_stone 是唯一额外石源
  const gb = setupBoss(426280);
  const sB = gb.stones, bkB = gb.stats.boss_kills, wB = gb.weekly.boss ?? 0;
  (gb.rng as any).random = () => 0.0;
  gb.monster!.hp = 0.001;
  battleTick(gb, 0.05);
  delete (gb.rng as any).random;
  eq(gb.stones - sB, BAL.boss_stone_amt, "重打头目层掷中 boss_stone(唯一额外石源)");
  eq(gb.stats.boss_kills - bkB, 1, "boss_kills +1");
  eq((gb.weekly.boss ?? 0) - wB, 1, "周常 boss +1");
  eq(gb.quests[0].progress, 1, "boss 悬赏推进 +1");
  // b. 桩 0.999:抽签不中,其余通道照推 —— 证明抽签是该通道唯一变量
  const gb2 = setupBoss(426281);
  const sB2 = gb2.stones, bkB2 = gb2.stats.boss_kills;
  (gb2.rng as any).random = () => 0.999;
  gb2.monster!.hp = 0.001;
  battleTick(gb2, 0.05);
  delete (gb2.rng as any).random;
  eq(gb2.stones - sB2, 0, "抽签不中 → 石增量恰 0");
  eq(gb2.stats.boss_kills - bkB2, 1, "boss_kills 仍 +1(通道与抽签解耦)");
}

// ================================================================ 40. 深渊套装(表值锚/掉落判定/2-4件加成/存档往返)
/** 白板套装件:主值 0 / 无词缀 / common(固有 per×rid=0)→ 自身零属性,只携带套装标记 */
function suitPiece(slot: string, suitId: string | null): Item {
  return new Item(slot, "common", 1, 0, [], 0, "白板件", undefined, null, null, suitId);
}

function testGearSuitsCore(): void {
  // ---- ① SUITS 8 套数值与设计表逐项 eq(表驱动断言,防实现时改数值)
  eq(SUITS.length, 8, "SUITS 恰 8 套");
  eq(SUITS.length, THEMES.length, "SUITS 与 THEMES 等长(逐索引对齐)");
  const EXPECT: [string, string, string, "add" | "pct", number, string, "add" | "pct", number][] = [
    ["s0", "荆棘之誓", "hp", "pct", 8, "kill_heal", "add", 3],
    ["s1", "掘金者", "goldfind", "add", 8, "luck", "add", 6],
    ["s2", "焚天", "atk", "pct", 6, "crit_extra", "add", 10],
    ["s3", "霜寒", "def", "pct", 8, "dodge", "add", 5],
    ["s4", "淬毒", "lifesteal", "add", 4, "skill_dmg", "add", 15],
    ["s5", "白骨军团", "hp", "pct", 8, "deathward", "add", 8],
    ["s6", "食腐", "atk", "pct", 6, "kill_haste", "add", 10],
    ["s7", "虚空漫步", "crit_dmg", "add", 15, "armor_pierce", "add", 10],
  ];
  for (let i = 0; i < EXPECT.length; i++) {
    const s = SUITS[i]!;
    const [id, name, s2, o2, v2, s4, o4, v4] = EXPECT[i]!;
    eq(s.id, id, `SUITS[${i}].id`);
    eq(s.name, name, `SUITS[${i}].name`);
    eq(s.themeIdx, i, `SUITS[${i}].themeIdx 与 THEMES 逐索引对齐`);
    eq(s.bonus2.stat, s2, `${id} bonus2.stat`);
    eq(s.bonus2.op, o2, `${id} bonus2.op`);
    eq(s.bonus2.v, v2, `${id} bonus2.v`);
    eq(s.bonus4.stat, s4, `${id} bonus4.stat`);
    eq(s.bonus4.op, o4, `${id} bonus4.op`);
    eq(s.bonus4.v, v4, `${id} bonus4.v`);
    eq(SUIT_DEF[id], s, `SUIT_DEF 索引指向同一定义`);
  }
  eq(BAL.suit_drop_chance, 0.10, "BAL.suit_drop_chance = 0.10");
  // 效果键必须都有中文名:套装文案(suitEffText)直查 STAT_NAMES,缺键=裸键名(crit_extra
  // 这类)漏给玩家 —— 2026-10 实测焚天/食腐 4 件曾裸键漏出,此处表驱动兜死
  for (const s of SUITS) {
    ok(STAT_NAMES[s.bonus2.stat] !== undefined, `${s.id} bonus2 键「${s.bonus2.stat}」有中文名`);
    ok(STAT_NAMES[s.bonus4.stat] !== undefined, `${s.id} bonus4 键「${s.bonus4.stat}」有中文名`);
  }
  for (const k of VIRTUAL_STATS) {
    ok(STAT_NAMES[k] !== undefined, `虚拟属性「${k}」有中文名`);
  }

  // ---- ② 固定种子下 suitId 判定确定(zone=2 → 掉落判定走表全 s1)
  const rollSuits = (zone: number, seed: number): string[] => {
    const rng = new PyRandom(seed);
    const out: string[] = [];
    for (let i = 0; i < 500; i++) {
      const it = rollItem(10, rng, 0, 0, 0, "warrior", zone);
      if (it.suitId) out.push(it.suitId);
    }
    return out;
  };
  const s1a = rollSuits(2, 426300), s1b = rollSuits(2, 426300);
  eqStrArr(s1a, s1b, "同种子同参两次 roll 的套装命中序列一致(判定确定)");
  ok(s1a.length > 10, `500 次 roll 应命中多件套装(实际 ${s1a.length},掉率 10%)`);
  ok(s1a.every(x => x === "s1"), `zone=2(废弃矿坑)套装件全为 s1(实际 ${s1a.join(",")})`);
  const zone1 = rollSuits(1, 426300);
  ok(zone1.length > 0 && zone1.every(x => x === "s0"), "zone=1(幽暗森林)全为 s0");
  const zone9 = rollSuits(9, 426300);
  ok(zone9.length > 0 && zone9.every(x => x === "s0"), "zone=9(幽暗森林·深度2,≡1 mod 8)轮换回 s0");
  // zone 缺省(admin-save 5 参造件路径)→ 永不产出套装,普通件不锁定
  const rngNoZone = new PyRandom(426300);
  let suitCnt = 0;
  for (let i = 0; i < 500; i++) {
    const it = rollItem(10, rngNoZone, 0, 0, 0, "warrior");
    if (it.suitId) suitCnt++;
    else eq(it.locked, false, "无套装标记的件不锁定");
  }
  eq(suitCnt, 0, "zone 缺省不产出套装件");
  // 命中套装不掉锁:🔒 只属玩家手动;套装保护由 protectedSuit 独立判定(见 41 组)
  const rngL = new PyRandom(426300);
  let first: Item | null = null;
  for (let i = 0; i < 500 && !first; i++) {
    const it = rollItem(10, rngL, 0, 0, 0, "warrior", 2);
    if (it.suitId) first = it;
  }
  ok(first !== null && !first.locked, "套装件掉落不锁定(保护与玩家锁定解耦)");

  // ---- ③ 凑 2/4 件 hero 属性变化与 SUITS 表逐项 eq(全 8 套表驱动;未选职业=纯净基线)
  // 槽位用 weapon/helmet/armor/amulet:common+主值0 → 零自身属性(boots/ring 有固有,避开)
  const readStat = (game: Game, stat: string): number =>
    stat === "hp" ? game.hero.max_hp : (game.hero[stat] ?? 0);   // hp 看上限:recalc 对当前血取 min(旧,新)
  const assertSuit = (game: Game, def2: { stat: string; op: string; v: number },
                      base2: number, tag: string): void => {
    if (def2.op === "pct") {
      close(readStat(game, def2.stat), base2 * (1 + def2.v / 100), tag);
    } else {
      eq(readStat(game, def2.stat), base2 + def2.v, tag);
    }
  };
  for (let i = 0; i < SUITS.length; i++) {
    const def = SUITS[i]!;
    const g = new Game(426301 + i);   // 未选职业:被动/成就/图鉴/祭坛/天赋/遗物全空
    const base2 = readStat(g, def.bonus2.stat);
    const base4 = readStat(g, def.bonus4.stat);
    g.equip = { weapon: suitPiece("weapon", def.id), helmet: suitPiece("helmet", def.id) };
    g.recalcHero();
    assertSuit(g, def.bonus2, base2, `${def.id} 2件生效`);
    g.equip = {
      weapon: suitPiece("weapon", def.id), helmet: suitPiece("helmet", def.id),
      armor: suitPiece("armor", def.id), amulet: suitPiece("amulet", def.id),
    };
    g.recalcHero();
    assertSuit(g, def.bonus2, base2, `${def.id} 4件时 bonus2 仍在`);
    assertSuit(g, def.bonus4, base4, `${def.id} 4件生效`);
  }
  // suitMods 直测:同套跨槽计数 / 混套 / 单件 / 未知 id 防御
  const m4 = suitMods({
    weapon: suitPiece("weapon", "s0"), helmet: suitPiece("helmet", "s0"),
    armor: suitPiece("armor", "s0"), amulet: suitPiece("amulet", "s0"),
  });
  eq(m4.length, 2, "4 件同套 → 2 条 mods");
  eq(m4[0]!.stat, SUITS[0]!.bonus2.stat, "mods[0] = bonus2.stat");
  eq(m4[0]!.op, SUITS[0]!.bonus2.op, "mods[0] = bonus2.op");
  eq(m4[0]!.v, SUITS[0]!.bonus2.v, "mods[0] = bonus2.v");
  eq(m4[1]!.stat, SUITS[0]!.bonus4.stat, "mods[1] = bonus4.stat");
  eq(m4[1]!.v, SUITS[0]!.bonus4.v, "mods[1] = bonus4.v");
  const mix = suitMods({
    weapon: suitPiece("weapon", "s0"), helmet: suitPiece("helmet", "s0"),
    armor: suitPiece("armor", "s3"), amulet: suitPiece("amulet", "s3"),
  });
  eq(mix.length, 2, "2+2 两套各给 bonus2(无 bonus4)");
  eq(suitMods({ weapon: suitPiece("weapon", "s0") }).length, 0, "单件无加成");
  eq(suitMods({ weapon: suitPiece("weapon", "nonsense") }).length, 0, "未知 suitId 跳过(防御手改存档)");

  // ---- ④ 换装掉至 3 件:bonus4 立即消失、bonus2 保留;再降 1 件全消(recalcHero 重算)
  {
    const g = new Game(426315);
    const baseDef = g.hero.def;
    g.equip = {
      weapon: suitPiece("weapon", "s3"), helmet: suitPiece("helmet", "s3"),
      armor: suitPiece("armor", "s3"), amulet: suitPiece("amulet", "s3"),
    };
    g.recalcHero();
    eq(g.hero.dodge, 5, "4 件霜寒:dodge+5");
    close(g.hero.def, baseDef * 1.08, "4 件霜寒:def+8%");
    g.equipItem(suitPiece("amulet", null));      // 换掉一件 → 3 件
    eq(g.hero.dodge, 0, "掉至 3 件:bonus4 立即消失(equipItem 内 recalcHero)");
    close(g.hero.def, baseDef * 1.08, "掉至 3 件:bonus2 保留");
    g.unequip("weapon");                         // → 2 件
    close(g.hero.def, baseDef * 1.08, "掉至 2 件:bonus2 仍在");
    g.unequip("armor");                          // → 1 件
    close(g.hero.def, baseDef, "掉至 1 件:bonus2 也消失");
    eq(g.hero.dodge, 0, "1 件无任何套装加成");
  }

  // ---- ⑤ Item 往返 toDict/fromDict:suitId 保真;旧档无字段 → null;无套装不序列化
  const it = suitPiece("ring", "s1");
  it.locked = true;
  const d = it.toDict();
  eq(d.suit_id, "s1", "toDict 条件序列化 suit_id");
  eq(d.locked, true, "锁定随套装件一并序列化");
  const rt = Item.fromDict(d);
  eq(rt.suitId, "s1", "往返保真 suitId");
  eq(rt.locked, true, "往返保真 locked");
  ok(!("suit_id" in suitPiece("helmet", null).toDict()), "无套装不序列化 suit_id(省字节)");
  eq(Item.fromDict({ ...d, suit_id: undefined }).suitId, null, "旧档无 suit_id 字段 → null 兜底");
}

// ================================================================ 41. 深渊套装(折现防护:腾位/无可让位兜底/档位豁免/配额清理)
function testGearSuitsSalvageGuard(): void {
  // ---- ① 背包满 + auto_equip 开 + auto_sell_idx=2:未凑齐套装件不被折现,腾位卖可让位最低 score 件
  const g = newGame(426310);
  g.chooseClass("warrior");
  g.settings.auto_equip = true;
  g.settings.auto_sell_idx = 2;
  for (let i = 0; i < g.bagCap(); i++) {   // 直推背包:不经 addItem(否则先被档位出售)
    g.bag.push(new Item("weapon", "common", 5, 1 + i, [{ id: "atk", val: 1 }], 0, `填${i}`));
  }
  eq(g.bag.length, g.bagCap(), "背包预填满");
  // 不上锁:rid=0 ≤ idx=2 自动档位也命中,防护只来自 protectedNewSuit(未凑齐通道)
  const suit = new Item("ring", "common", 5, 5, [], 0, "矿坑套装件", undefined, "atk", null, "s1");
  ok(!suit.locked, "①前提:套装件到手不带锁");
  const gold0 = g.gold;
  const lowest = g.bag.reduce((a, b) => (b.score() < a.score() ? b : a));
  const lowPrice = lowest.sellPrice();
  g.addItem(suit);
  ok(g.bag.includes(suit), "①套装件不被折现,仍在 g.bag");
  eq(g.bag.length, g.bagCap(), "①腾位后背包一进一出仍满");
  ok(!g.bag.includes(lowest), "①被腾位出售的是未锁最低 score 件");
  eq(g.gold - gold0, lowPrice, "①腾位出售金 = 最低件售价");
  eq(g.stats.sold_total ?? 0, 1, "①腾位计入出售数");

  // ---- ② 全锁背包(手动锁):无可让位兜底折现该套装件,log 含「被迫折现」
  const g2 = newGame(426311);
  g2.chooseClass("warrior");
  for (let i = 0; i < g2.bagCap(); i++) {
    const locked = new Item("weapon", "common", 5, 2, [], 0, `锁${i}`);
    locked.locked = true;
    g2.bag.push(locked);
  }
  const piece2 = new Item("ring", "common", 5, 5, [], 0, "被迫件", undefined, "atk", null, "s3");
  const gold2 = g2.gold;
  g2.addItem(piece2);
  ok(!g2.bag.includes(piece2), "②全锁背包:套装件兜底折现,不入包");
  eq(g2.bag.length, g2.bagCap(), "②背包不动(仍 40 件全锁)");
  eq(g2.gold - gold2, piece2.sellPrice(), "②折现金 = 套装件售价");
  ok(g2.events.some(e => e[0] === "log" && e[1].includes("被迫折现")),
    "②log 含「背包无可让位…被迫折现」");

  // ---- ③ auto_sell_idx≥套装件品质时未凑齐套装件不被自动档位出售(保护与 🔒 解耦后的回归锁)
  const g3 = newGame(426312);
  g3.chooseClass("warrior");
  g3.settings.auto_sell_idx = 5;            // 全品质自动出售
  const suitLow = new Item("ring", "common", 5, 5, [], 0, "档位套装件", undefined, "atk", null, "s0");
  g3.addItem(suitLow);
  ok(g3.bag.includes(suitLow), "③未凑齐套装件不被自动档位出售(rid=0 ≤ idx=5 也不卖)");
  eq(g3.stats.sold_total ?? 0, 0, "③零自动出售");
  const plain = new Item("ring", "common", 5, 5, [], 0, "普通件", undefined, "atk");
  g3.addItem(plain);
  ok(!g3.bag.includes(plain), "③对照:普通同品质件仍被档位出售");
  eq(g3.stats.sold_total ?? 0, 1, "③对照出售计数 +1");

  // ---- ④ 凑齐 4 件后:第 5 件回归普通件(自动档位正常出售),前 4 件仍豁免
  const g4 = newGame(426313);
  g4.chooseClass("warrior");
  g4.settings.auto_sell_idx = 5;
  for (let i = 0; i < 4; i++) {             // 直推 4 件同套(不经 addItem 防出售干扰)
    g4.bag.push(new Item("ring", "common", 5, 5, [], 0, `套${i}`, undefined, "atk", null, "s2"));
  }
  eq(g4.suitTotal("s2"), 4, "④前提:同套 4 件在包");
  ok(g4.protectedSuit(g4.bag[0]!), "④凑齐中第 4 件仍受保护(≤4)");
  const fifth = new Item("ring", "common", 5, 5, [], 0, "第5件", undefined, "atk", null, "s2");
  ok(!g4.protectedNewSuit(fifth), "④第 5 件不再受保护(suitTotal+1=5 >4)");
  const gold4 = g4.gold;
  g4.addItem(fifth);
  ok(!g4.bag.includes(fifth), "④第 5 件被自动档位出售(凑齐后回归普通)");
  eq(g4.gold - gold4, fifth.sellPrice(), "④第 5 件折现金正确");
  eq(g4.bag.filter(it => it.suitId === "s2").length, 4, "④前 4 件原封不动");

  // ---- ⑤ 一键出售配额:同套 6 件全品质在档,一键出售只清 2 件(每套保底剩 4)
  const g5 = newGame(426314);
  g5.chooseClass("warrior");
  for (let i = 0; i < 6; i++) {
    g5.bag.push(new Item("ring", "common", 5, 5, [], 0, `六件套${i}`, undefined, "atk", null, "s4"));
  }
  g5.sellJunk(5);
  eq(g5.bag.filter(it => it.suitId === "s4").length, 4, "⑤六件套一键出售后剩 4 件(配额=6-4)");
}

// ================================================================ 42. 深渊套装(换装守卫:手动必弹/自动静默/不顶待确认)
function testGearSuitsSwapGuard(): void {
  // ---- 手动模式:套装件绕过 score 门槛必弹对比(评分远低于当前也弹)
  const g = newGame(426320);
  g.chooseClass("warrior");
  g.settings.auto_equip = false;
  const strong = new Item("weapon", "epic", 30, 100, [{ id: "atk", val: 20 }], 0, "现役", undefined, "atk");
  g.equip.weapon = strong;
  g.recalcHero();
  const weakSuit = new Item("weapon", "common", 5, 1, [], 0, "套装弱件", undefined, "atk", null, "s2");
  ok(weakSuit.score() < strong.score(), "前提:套装件评分确实更低(证明绕过了 score 门槛)");
  g.addItem(weakSuit);
  ok(g.pendingSwap !== null && g.pendingSwap.kind === "item", "手动模式套装件必弹对比");
  eq(g.pendingSwap?.item, weakSuit, "对比对象即该套装件(引用)");
  eq(g.pendingSwap?.slot, "weapon", "对比槽位正确");
  ok(g.bag.includes(weakSuit), "套装件已入包等待定夺");
  g.resolveSwap(true);
  eq(g.equip.weapon, weakSuit, "确认后换上套装件");

  // ---- 守卫边界(!pendingSwap):占用期间套装件静默入包,不顶掉已有待确认项
  const g2 = newGame(426321);
  g2.chooseClass("warrior");
  g2.settings.auto_equip = false;
  const pending0 = new Item("helmet", "rare", 10, 50, [], 0, "待确认甲", undefined, "hp");
  g2.addItem(pending0);                       // 头盔位空 → 先弹一个普通对比
  ok(g2.pendingSwap !== null && g2.pendingSwap.item === pending0, "先有一件待确认");
  const drop1 = new Item("boots", "common", 5, 2, [], 0, "守卫套装件", undefined, "hp", null, "s6");
  drop1.locked = true;
  g2.addItem(drop1);
  eq(g2.pendingSwap?.item, pending0, "守卫占用期间套装件不顶掉已有待确认项");
  ok(g2.bag.includes(drop1), "守卫占用期间套装件静默入包");
  g2.resolveSwap(false);                      // 处理完
  eq(g2.pendingSwap, null, "处理完清空");
  const drop2 = new Item("ring", "common", 5, 2, [], 0, "再掉一件", undefined, "atk", null, "s6");
  drop2.locked = true;
  g2.addItem(drop2);
  eq(g2.pendingSwap?.item, drop2, "处理完后下一次套装件掉落再弹");

  // ---- 自动模式:套装件静默入包不走 autoEquipCheck(评分更高也不自动穿上)
  const g3 = newGame(426322);
  g3.chooseClass("warrior");
  g3.settings.auto_equip = true;
  const cur = new Item("weapon", "common", 5, 1, [], 0, "旧件", undefined, "atk");
  g3.equip.weapon = cur;
  g3.recalcHero();
  const strongSuit = new Item("weapon", "mythic", 40, 999, [{ id: "atk", val: 50 }], 0,
    "神话套装件", undefined, "atk", null, "s2");
  strongSuit.locked = true;
  ok(strongSuit.score() > cur.score() * 1.05, "前提:评分高出 5% 门槛(autoEquipCheck 本会换上)");
  g3.addItem(strongSuit);
  eq(g3.equip.weapon, cur, "自动模式套装件不走 autoEquipCheck:不自动换上");
  ok(g3.bag.includes(strongSuit), "自动模式套装件静默入包");
  eq(g3.pendingSwap, null, "自动模式不弹对比");

  // ---- 自动模式:已穿套装件不被普通掉落自动顶掉(防挂机静默拆散 2/4 件套)
  const g4 = newGame(426323);
  g4.chooseClass("warrior");
  g4.settings.auto_equip = true;
  const wornSuit = new Item("weapon", "common", 5, 1, [], 0, "已穿套装件", undefined, "atk", null, "s2");
  wornSuit.locked = true;
  g4.equip.weapon = wornSuit;
  g4.recalcHero();
  const strongNorm = new Item("weapon", "mythic", 40, 999, [{ id: "atk", val: 50 }], 0,
    "高分普件", undefined, "atk");
  ok(strongNorm.score() > wornSuit.score() * 1.05, "前提:普件评分高出门槛(无防护本会自动换上)");
  g4.addItem(strongNorm);
  eq(g4.equip.weapon, wornSuit, "已穿套装件不被自动换装顶掉");
  ok(g4.bag.includes(strongNorm), "高分普件静默入包待手动定夺");
  // 对照:穿的是普通件时自动换装照常(防护只针对套装件,自动模式体验不变)
  g4.equip.weapon = new Item("weapon", "common", 5, 1, [], 0, "已穿普件", undefined, "atk");
  g4.recalcHero();
  const strongerNorm = new Item("weapon", "mythic", 40, 999, [{ id: "atk", val: 50 }], 0,
    "更高分普件", undefined, "atk");
  g4.addItem(strongerNorm);
  eq(g4.equip.weapon, strongerNorm, "普通件之间自动换装照常");
}

// ================================================================ 43. 深渊套装(分区特产/塔中口径/旧档v9/管理校验)
function testGearSuitsZoneTowerMigrate(): void {
  const stubDrop = (g: Game): void => { (g.rng as any).random = () => 0.0; };
  const unstub = (g: Game): void => { delete (g.rng as any).random; };
  const today = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();

  // ---- 分区特产:战斗链路真掉落(桩 0.0 → 掉落判定与套装判定必中),主题按区走表
  const dropSuitIn = (zone: number): string => {
    const g = newGame(426330 + zone);
    g.chooseClass("warrior");               // zone=1 刷怪(非精英,drop_chance 口径稳定)
    g.zone = zone;                          // 击杀前切区:rollItem 读 g.zone 定主题
    g.stage = 3;
    g.monster!.hp = 0.001;
    stubDrop(g);
    battleTick(g, 0.05);                    // 一拍内击杀 → onMonsterKilled → rollItem
    unstub(g);
    const suit = [...Object.values(g.equip), ...g.bag].find(it => it.suitId);
    return suit?.suitId ?? "";
  };
  eq(dropSuitIn(1), "s0", "第1区(幽暗森林,≡1 mod 8)挂机掉落可观察到 s0 套装件");
  eq(dropSuitIn(2), "s1", "第2区(废弃矿坑)掉 s1 套——不同区特产不同套装");
  eq(dropSuitIn(9), "s0", "第9区(幽暗森林·深度2)主题轮换回 s0");

  // ---- 塔中击杀:同样走 rollItem;套装主题按进塔前 g.zone、tier 按塔层(预期行为锁定)
  const gt = newGame(426339);
  gt.chooseClass("warrior");
  gt.zone = 2;                              // 进塔前在矿坑
  gt.tower.keys = 1;
  gt.tower.max_floor = 4;
  gt.tower.last_refresh = today;            // 击杀路径守卫:rollDaily 补钥 no-op
  gt.towerEnter();                          // 默认第5层
  eq(gt.inTower, true, "进塔成功");
  gt.monster!.hp = 0.001;
  stubDrop(gt);
  battleTick(gt, 0.05);
  unstub(gt);
  const tSuit = [...Object.values(gt.equip), ...gt.bag].find(it => it.suitId);
  ok(tSuit !== undefined, "塔中击杀同样掉套装件");
  eq(tSuit?.suitId ?? "", "s1", "塔中套装主题按进塔前 g.zone(矿坑→s1,非 bug 为预期)");
  eq(tSuit?.tier ?? 0, 5, "塔中套装件 tier 按塔层(第5层)");

  // ---- 旧档 v9(条目无 suit_id、档无 boss/arena 字段)migrateSave+fromDict 开局正常
  const legacy = newGame(426340);
  legacy.chooseClass("warrior");
  legacy.equip.weapon = new Item("weapon", "rare", 20, 50, [{ id: "atk", val: 5 }], 3,
    "旧世武器", undefined, "atk");
  legacy.bag.push(new Item("helmet", "fine", 20, 30, [{ id: "hp", val: 20 }], 0, "旧世头盔", undefined, "hp"));
  legacy.recalcHero();
  const d = JSON.parse(JSON.stringify(legacy.toDict()));
  // 模拟 v9 旧档:手工降版并剥掉 v10 起的世界BOSS/切磋战绩字段(套档迁移自身不挂版本号;
  // 本组只验套装迁移面,世界BOSS/切磋的 v10 段见第 51/55 组)
  d.version = 9;
  delete d.boss;
  delete d.arena;
  eq(d.version, 9, "旧档版本 v9(手工降版模拟)");
  ok(d.bag.every((x: any) => !("suit_id" in x)), "旧档 bag 条目无 suit_id 字段");
  ok(Object.values(d.equip).every((x: any) => !("suit_id" in x)), "旧档 equip 条目无 suit_id 字段");
  ok(!("boss" in d) && !("arena" in d), "旧档无 d.boss/d.arena 字段");
  const m = migrateSave(d);
  eq(m.version, SAVE_VERSION, "migrateSave 迁至当前版本(套装字段不挂版本号)");
  ok(m.boss && m.boss.last_round === "" && Array.isArray(m.boss.claimed),
    "v9 → v10 段补 boss 默认零状态");
  const gl = Game.fromDict(m);
  ok(gl.equip.weapon !== undefined, "旧档已穿装备保留(开局正常)");
  eq(gl.equip.weapon!.suitId, null, "旧档已穿装备 suitId 全 null");
  ok(gl.bag.every(it => it.suitId === null), "旧档背包装备 suitId 全 null");
  eq(gl.bag.length, 1, "旧档背包保真");

  // ---- 管理面板校验:suit_id='nonsense' 报 error(现读 SUIT_DEF 枚举);合法档零 error
  const bad = JSON.parse(JSON.stringify(legacy.toDict()));
  bad.bag[0].suit_id = "nonsense";
  const issues = validateSaveDict(bad);
  ok(issues.some(x => x.field === "bag.0.suit_id" && x.level === "error"),
    "suit_id='nonsense' 报 error 级");
  const goodIssues = validateSaveDict(legacy.toDict());
  eq(goodIssues.filter(x => x.level === "error").length, 0, "合法新档零 error");
  const good2 = JSON.parse(JSON.stringify(legacy.toDict()));
  good2.bag[0].suit_id = "s1";
  ok(!validateSaveDict(good2).some(x => x.field === "bag.0.suit_id"), "合法 suit_id='s1' 不报");

  // ---- v10 → v11:「掉落即锁」开发期存档的套装件系统锁一次性清洗
  // 场景:套装件带 locked=true(旧版系统锁)+ 玩家手动锁的普通件 + 玩家手动锁的套装件
  const locky = newGame(426341);
  locky.chooseClass("warrior");
  const sysLockSuit = new Item("ring", "common", 5, 5, [], 0, "系统锁套装件", undefined, "atk", null, "s1");
  sysLockSuit.locked = true;                 // 旧版"掉落即锁"的痕迹
  const manualLockPlain = new Item("ring", "common", 5, 5, [], 0, "手动锁普通件", undefined, "atk");
  manualLockPlain.locked = true;             // 玩家显式锁定,必须保留
  locky.bag.push(sysLockSuit, manualLockPlain);
  const d10 = JSON.parse(JSON.stringify(locky.toDict()));
  eq(d10.version, SAVE_VERSION, "新产档即当前版本(不触发迁移)");
  d10.version = 10;                          // 手工降版模拟 v10 旧档
  const m11 = migrateSave(d10);
  eq(m11.version, SAVE_VERSION, "v10 → v11 迁移完成");
  const g11 = Game.fromDict(m11);
  const suit11 = g11.bag.find(it => it.name === "系统锁套装件")!;
  const plain11 = g11.bag.find(it => it.name === "手动锁普通件")!;
  eq(suit11.locked, false, "v11 清洗:套装件的系统锁被移除(可正常分解)");
  eq(plain11.locked, true, "v11 清洗:普通件上的玩家手动锁保留");
  // 清洗后单件分解直接放行(此前被「已锁定」挡死,即"套装装备分解不了"的报障)
  const idx = g11.bag.indexOf(suit11);
  const stones0 = g11.stones;
  g11.dismantleItem(idx);
  ok(!g11.bag.includes(suit11), "清洗后套装件可单件分解");
  ok(g11.stones >= stones0, "分解入账(金币/石头)");
}

// ================================================================ 终局一击(职业手动大招)
/** 独立重算一次大招总伤(与 skills.ts skillHit 逐式对拍):
 *  同种子 RNG 按同顺序消费(非 must_crit 每 hit 掷一次暴击判定),
 *  乘区顺序 = atkNow → _dmg(atk*pct/100, def*(1-pierce)) → skill_dmg → vs_elite
 *  → dmgMultipliers → 暴击 ×(1+crit_dmg/100)。 */
function ultExpectedTotal(g: Game, def: ActiveSkill, mon: Monster, seed: number): number {
  const rng = new PyRandom(seed);   // 与 castUlt 前重置的 g.rng 同种子同消耗序列
  const pct = skillVal(def, effLv(g, def.id));
  let total = 0;
  for (let i = 0; i < (def.hits ?? 1); i++) {
    const atk = atkNow(g);
    const pierce = Math.min((g.hero.armor_pierce ?? 0) / 100, 0.5);
    let raw = _dmg(atk * pct / 100, mon.def_ * (1 - pierce));
    raw *= 1 + (g.hero.skill_dmg ?? 0) / 100;
    if (def.vs_elite && (mon.boss || mon.elite)) raw *= def.vs_elite;
    raw *= dmgMultipliers(g, mon);
    const crit = def.must_crit || rng.random() * 100 < g.hero.crit;
    if (crit) raw *= 1 + g.hero.crit_dmg / 100;
    total += raw;
  }
  return total;
}

/** 表锚 + 三职业 castUlt 伤害总额与 ULTS 表逐项 close(1e-9)对拍 */
function testUltTableDamage(): void {
  // ---- 表锚:3 条,每职业恰 1 条,Lv35 / CD 90 / per 0(倍率不吃等级成长)
  eq(ULTS.length, 3, "ULTS 共 3 条");
  for (const cls of ["warrior", "mage", "ranger"]) {
    eq(ULTS.filter(u => u.cls === cls).length, 1, `${cls} 恰 1 个大招`);
  }
  for (const u of ULTS) {
    eq(u.unlock, 35, `${u.id} Lv35 解锁`);
    eq(u.cd, 90, `${u.id} CD 90s`);
    eq(u.per, 0, `${u.id} per=0(不吃等级成长)`);
    eq(u.kind, "damage", `${u.id} kind=damage`);
    eq(ULT_DEF[u.id], u, `${u.id} 进 ULT_DEF 索引`);
  }
  // 不进主动技能池:不自动施放(castSkills 只扫 loadout.active)、不可装配/升级
  ok(ACTIVE_SKILLS.every(s => !s.id.startsWith("ult_")), "ULTS 不在 ACTIVE_SKILLS");
  ok(!Object.hasOwn(ACTIVE_DEF, "ult_w_judg"), "ULTS 不在 ACTIVE_DEF");

  // ---- 三职业结算对拍:castUlt 总掉血 vs 独立重算(close 1e-9,同公式浮点)
  let casts = 0;
  for (const cls of ["warrior", "mage", "ranger"]) {
    const seed = 777;
    const g = newGame(seed);
    g.chooseClass(cls);
    g.level = 40;
    g.recalcHero();
    const ult = g.ultOf()!;
    ok(ult && ult.cls === cls, `${cls} ultOf 返回本职业大招`);
    const mon = g.monster as Monster;
    ok(mon !== null, `${cls} 场上有怪`);
    const crit0 = g.stats.crit_hits ?? 0;
    g.rng = new PyRandom(seed);                       // 消除此前 spawn 等消耗
    const expected = ultExpectedTotal(g, ult, mon, seed);
    const hp0 = mon.hp;
    g.castUlt();
    const dealt = hp0 - mon.hp;
    close(dealt, expected, `${cls}(${ult.id}) 大招总伤与表逐项对拍`, 1e-9);
    // CD 90(无 cd_reduce → cdCut=1)写入不入档的 skillCd
    close(g.skillCd[ult.id] ?? -1, 90, `${cls} 释放后 CD=90`);
    // 附加效果逐项:warrior 必暴(暴击计数 +hits 且无附加状态)/ mage 冻结 2s / ranger 破甲 30% 5s
    if (cls === "warrior") {
      eq(g.stats.crit_hits - crit0, ult.hits ?? 1, "深渊断罪必暴(每 hit 计暴击)");
      eq(mon.defDownPct, 0, "战士无破甲");
    } else if (cls === "mage") {
      eq(mon.stunUntil, g.time + 2, "湮灭星陨冻结 2 秒");
    } else {
      eq(mon.defDownPct, 30, "万箭归宗破甲 30%");
      close(mon.defDownUntil, g.time + 5, "破甲持续 5 秒");
    }
    // 表倍率锚:总伤 ≈ hits × base% × atk 的量级(乘区防呆,量级对不上即公式漂移)
    const approx = (ult.hits ?? 1) * (ult.base / 100) * atkNow(g);
    ok(dealt > 0 && dealt < approx * 3, `${cls} 总伤在表倍率量级内`);
    casts += 1;
  }
  eq(casts, 3, "三职业各对拍一次");
}

/** 门槛与拒绝:Lv34 拒 / 引导中拒 / 无怪拒 / CD 未到无副作用(eq)/ Lv35 升级日志 */
function testUltGates(): void {
  const g = newGame(1001);
  g.chooseClass("warrior");
  g.level = 34;
  g.recalcHero();
  const ult = g.ultOf()!;
  const mon = g.monster as Monster;

  // ---- Lv34 拒绝:无伤害、不落 CD 键
  const hp0 = mon.hp;
  g.castUlt();
  eq(mon.hp, hp0, "Lv34 castUlt 无伤害");
  ok(!(ult.id in g.skillCd), "Lv34 不落 CD 键");
  ok(toastTexts(g).some(t => t.includes("解锁")), "Lv34 拒绝有提示");

  // ---- g.burst 引导中拒绝
  g.level = 40;
  g.recalcHero();
  g.burst = { sid: "w_whirl", left: 6, interval: 1 / 3, nextAt: g.time + 1, pct: 45 };
  const hp1 = mon.hp;
  g.castUlt();
  eq(mon.hp, hp1, "引导中 castUlt 无伤害");
  ok(!(ult.id in g.skillCd), "引导中不落 CD 键");
  g.burst = null;

  // ---- 无 monster 拒绝
  g.monster = null;
  g.castUlt();
  ok(!(ult.id in g.skillCd), "无怪不落 CD 键");
  ok(toastTexts(g).some(t => t.includes("目标")), "无怪拒绝有提示");
  g.spawn();

  // ---- CD 未到:伤害与 CD 均不变(精确 eq)
  g.castUlt();
  close(g.skillCd[ult.id] ?? -1, 90, "首次释放 CD=90");
  // as unknown:上面 g.monster = null 的赋值让 TS 收窄了类型,spawn() 后以宽口径读回
  const hp2 = (g.monster as unknown as Monster).hp;
  const cd2 = g.skillCd[ult.id]!;
  g.castUlt();
  eq((g.monster as unknown as Monster).hp, hp2, "CD 中再次 castUlt 伤害不变");
  eq(g.skillCd[ult.id], cd2, "CD 中再次 castUlt CD 不变");

  // ---- Lv35 升级日志(按钮出现由 buildState.ult.unlocked(level>=35) 驱动,此处断言其判定源)
  const g35 = newGame(1002);
  g35.chooseClass("warrior");
  g35.level = 34;
  g35.recalcHero();
  g35.gainXp(g35.xpReq());                     // 恰升到 35
  eq(g35.level, 35, "恰好升到 35");
  ok(g35.events.some(e => e[0] === "log" && e[1].includes("终局一击解锁")),
    "35 级升级日志提示大招解锁");
  const g34 = newGame(1003);
  g34.chooseClass("warrior");
  g34.level = 33;
  g34.recalcHero();
  g34.gainXp(g34.xpReq());                     // 恰升到 34
  eq(g34.level, 34, "恰好升到 34");
  ok(!g34.events.some(e => e[0] === "log" && e[1].includes("终局一击")),
    "34 级无大招提示(无按钮)");
}

/** B1 生命周期:新档 undefined 路径直接可放 / 重载(toDict→fromDict)立即再放 / 全链路无 NaN */
function testUltLifecycle(): void {
  // ---- 新档未释放过:skillCd 无 ult 键(ULTS 不进重建循环,模拟 undefined 路径)
  const g = newGame(2001);
  g.chooseClass("warrior");
  ok(!("ult_w_judg" in g.skillCd), "新档 skillCd 无 ult 键(undefined 路径)");
  g.level = 40;
  g.recalcHero();
  const hp0 = (g.monster as Monster).hp;
  g.castUlt();                                 // ?? 0 兜底 → undefined 视为就绪
  ok((g.monster as Monster).hp < hp0, "新档未释放过 castUlt 直接成功(怪物掉血)");
  eq(g.skillCd["ult_w_judg"], 90, "释放后 CD 键落地为 90");

  // ---- 重载:释放进入 CD 后 toDict/fromDict,castUlt 立即再次成功(重载清 CD 同口径)
  const mem = memHooks();
  g.save();
  const d = JSON.parse(mem.raw);
  ok(!JSON.stringify(d).includes("ult_w_judg"), "存档不含大招痕迹(零新增存档字段)");
  const g2 = Game.fromDict(d);
  ok(!("ult_w_judg" in g2.skillCd), "重载后 skillCd 无 ult 键(重建只铺 ACTIVE_SKILLS)");
  const hp2 = (g2.monster as Monster).hp;
  g2.castUlt();
  ok((g2.monster as Monster).hp < hp2, "重载后 castUlt 立即再次成功(怪物掉血)");
  eq(g2.skillCd["ult_w_judg"], 90, "重载后再放 CD=90(非仅清零)");

  // ---- 完整链路无 NaN 锁死:未释放→递减数拍(键不落)→释放→递减到位→再释放
  const g3 = newGame(2002);
  g3.chooseClass("warrior");
  g3.level = 40;
  g3.recalcHero();
  g3.monster = null;                           // 停表战斗:battleTick 只走 buff/CD 递减(确定性)
  for (let i = 0; i < 5; i++) battleTick(g3, 0.1);
  ok(!("ult_w_judg" in g3.skillCd), "未释放时递减不落键(条件写不产生 NaN)");
  ok(Number.isFinite(g3.skillCd["ult_w_judg"] ?? 0), "未释放键 NaN 兜底断言成立");
  g3.spawn();
  g3.castUlt();
  eq(g3.skillCd["ult_w_judg"], 90, "链路:释放 CD=90");
  g3.monster = null;
  for (let i = 0; i < 10; i++) battleTick(g3, 0.1);
  close(g3.skillCd["ult_w_judg"] ?? -1, 89, "递减 10×0.1s");
  for (let i = 0; i < 895; i++) battleTick(g3, 0.1);   // 远超 90s:递减在首次过零即停
  const cdEnd = g3.skillCd["ult_w_judg"] ?? 0;
  ok(cdEnd <= 0, "CD 递减到位(≤0 即可再次释放)");
  ok(cdEnd > -1, "递减停在首次过零(不无限下探)");
  ok(Number.isFinite(cdEnd), "全程无 NaN");
  g3.spawn();
  const hp3 = (g3.monster as unknown as Monster).hp;   // 同上:spawn 后宽口径读回
  g3.castUlt();
  ok((g3.monster as unknown as Monster).hp < hp3, "CD 到位后再次释放成功");
  eq(g3.skillCd["ult_w_judg"], 90, "再次释放 CD 重置 90");
}

/** cd_reduce 缩短(时间扭曲)/ 特效与伤害事件 / 统计计数 / 塔中可用 */
function testUltCdEvents(): void {
  // ---- CD 受 cd_reduce:法师装配时间扭曲(+8%)→ 90×0.92
  const g = newGame(3001);
  g.chooseClass("mage");
  g.level = 40;
  g.recalcHero();
  g.equipSkill("pm_time", "passive");          // Lv35 解锁,40 级可装
  g.recalcHero();
  close(g.hero.cd_reduce, 8, "时间扭曲 Lv1 = +8 冷却缩减");
  g.castUlt();
  close(g.skillCd["ult_m_stars"] ?? -1, 90 * (1 - 8 / 100), "CD 受 cd_reduce 缩短");

  // ---- 生效率封顶 40%(与 castSkills 同式)
  g.skillCd["ult_m_stars"] = 0;
  g.hero.cd_reduce = 50;                       // 超 CAPS(40)→ 仍按 40% 生效率
  g.castUlt();
  close(g.skillCd["ult_m_stars"] ?? -1, 90 * 0.6, "cd_reduce 生效率封顶 40%");

  // ---- 表现事件:cast:ult_xxx 特效 + dmg 来源 + 飘字 + 统计计数
  ok(g.events.some(e => e[0] === "anim" && e[1] === "cast:ult_m_stars"),
    "cast:ult_m_stars 特效事件");
  ok(g.events.some(e => e[0] === "dmg" && e[1].startsWith("ult_m_stars")),
    "dmg 事件以 ult_m_stars 为来源(dps-meter 零改动可统计)");
  ok(g.events.some(e => e[0] === "floater" && e[1].includes("☄")),
    "大招伤害飘字");
  eq(g.stats.ult_casts, 2, "stats.ult_casts 计数(开放式 stats 键)");

  // ---- 塔中可用(关键时刻翻盘含塔战)
  const gt = newGame(3002);
  gt.chooseClass("ranger");
  gt.level = 40;
  gt.recalcHero();
  gt.towerEnter();
  ok(gt.inTower && gt.monster !== null, "进塔有怪");
  const hpT = (gt.monster as Monster).hp;
  gt.castUlt();
  ok((gt.monster as Monster).hp < hpT, "塔中 castUlt 可用");
  eq(gt.skillCd["ult_r_rain"], 90, "塔中释放同样进 CD");
  // stats.ult_casts 入档往返(Object.assign 天然兼容,重载保留)
  const mem = memHooks();
  gt.save();
  const gt2 = Game.fromDict(JSON.parse(mem.raw));
  eq(gt2.stats.ult_casts, 1, "ult_casts 统计入档往返");
}

// ================================================================ 48-51. 世界BOSS·周轮合力
/** 伤害折算:固定种子 close 对拍(heroDps×30×uniform(0.9,1.1))、边界、次数封顶与只升不降 */
function testWorldBossDamage(): void {
  // —— 固定种子对拍:孪生 rng 预测 bossChallenge 将吃到的 uniform ——
  const gA = newGame(426301);
  gA.chooseClass("warrior");
  gA.level = 20;
  gA.recalcHero();
  const gB = newGame(426301);      // 同 seed 同构造:chooseClass 不吃 RNG,两边 rng 状态一致
  gB.chooseClass("warrior");
  const u = gB.rng.uniform(BAL.world_boss_var_lo, BAL.world_boss_var_hi);
  const [dps] = heroDps(gA, BAL.world_boss_def, 1e12, true);
  const dmg = gA.bossChallenge();
  ok(dmg !== null, "开局后挑战应成功");
  close(dps, heroDps(gA, BAL.world_boss_def, 1e12, true)[0], "heroDps 纯函数(重复调用同值)");
  close(dmg!, Math.max(1, Math.round(dps * BAL.world_boss_cast_sec * u)),
    "固定种子折算 = heroDps×30s×uniform(0.9,1.1)");

  // —— 浮动边界:折算值/(heroDps×30) ∈ [0.9, 1.1] ——
  const ratio = dmg! / (dps * BAL.world_boss_cast_sec);
  ok(ratio >= BAL.world_boss_var_lo - 1e-9 && ratio <= BAL.world_boss_var_hi + 1e-9,
    `折算比例应在 [${BAL.world_boss_var_lo}, ${BAL.world_boss_var_hi}] 内,实际 ${ratio}`);

  // —— 拒绝路径:未选职业 → null,只 toast 无副作用 ——
  const g0 = newGame(426302);
  eq(g0.bossChallenge(), null, "未选职业挑战被拒");
  ok(toastTexts(g0).some(t => t.includes("先选择职业")), "拒绝路径 toast 引导选职业");

  // —— 次数 3/轮封顶:每次 200 后才记账(bossHitAccept),第 4 次被拒 ——
  eq(gA.boss.attempts, 0, "挑战成功但未记账前次数仍 0(200 才消耗)");
  const bests: number[] = [];
  for (let i = 0; i < BAL.world_boss_attempts; i++) {
    const d = gA.bossChallenge();
    ok(d !== null, `第 ${i + 1} 次挑战成功`);
    gA.bossHitAccept(d!);
    bests.push(d!);
  }
  eq(gA.boss.attempts, BAL.world_boss_attempts, `次数记账至 ${BAL.world_boss_attempts}/${BAL.world_boss_attempts}`);
  eq(gA.boss.my_best, Math.max(...bests), "本轮最好成绩 = 三次中最大(只升不降)");
  eq(gA.bossChallenge(), null, "次数用完后第 4 次挑战被拒");
  ok(toastTexts(gA).some(t => t.includes("次数已用完")), "封顶 toast 提示下轮刷新");
  // 未上传(非 200)不烧次数:拒绝路径后 attempts 不变
  eq(gA.boss.attempts, BAL.world_boss_attempts, "拒绝路径无次数副作用");
  // my_best 不降:更低的伤害上传成功也不回退
  const lower = Math.max(1, Math.min(...bests) - 1);
  gA.bossHitAccept(lower);
  eq(gA.boss.my_best, Math.max(...bests), "更低伤害记账后 my_best 不降");
  eq(gA.boss.attempts, BAL.world_boss_attempts, "记账封顶不再上探");
}

/** 奖励档位:参与/≥1%/≥5%/击杀轮逐档 eq + bossClaim 同轮重复领取被拒(claimed 幂等) */
function testWorldBossRewards(): void {
  const g = newGame(426303);
  g.chooseClass("warrior");
  const goldTier = Math.round(mobGold(tierOf(g.zone, g.stage)) * BAL.world_boss_gold_k);
  // 档位金币随当前区计价:断言用的期望值与 bossClaim 同式现算(锚定 zone/stage 不变)

  // —— bossClaimTiers 逐档 eq(边界取等号:恰 1%/恰 5% 均入档) ——
  eq(g.bossClaimTiers({ total_hp: 1e9, my_dmg: 5e6, killed: false }).gold, goldTier,
    "参与(0.5%):金币档");
  eq(g.bossClaimTiers({ total_hp: 1e9, my_dmg: 5e6, killed: false }).stones, 0, "参与档无重铸石");
  eq(g.bossClaimTiers({ total_hp: 1e9, my_dmg: 1e7, killed: false }).stones,
    BAL.world_boss_stones_pct, "恰 1%:入 ≥1% 档(边界含等号)");
  eq(g.bossClaimTiers({ total_hp: 1e9, my_dmg: 4.99e7, killed: false }).keys, 0, "4.99% 无塔钥匙");
  eq(g.bossClaimTiers({ total_hp: 1e9, my_dmg: 5e7, killed: false }).keys, 1,
    "恰 5%:入 ≥5% 档(边界含等号)");
  const tk = g.bossClaimTiers({ total_hp: 1e9, my_dmg: 5e7, killed: true });
  eq(tk.stones, BAL.world_boss_stones_pct + BAL.world_boss_stones_kill,
    "击杀轮:击杀档与贡献档叠加");
  eq(g.bossClaimTiers({ total_hp: 1e9, my_dmg: 0, killed: true }).gold, 0, "未参与:全 0(击杀也不发)");

  // —— bossClaim 全链路:资源精确入账(参与档 / 击杀+≥5% 档) ——
  const snap = (): [number, number, number] => [g.gold, g.stones, g.tower.keys];
  const delta = (before: [number, number, number]): [number, number, number] =>
    [g.gold - before[0], g.stones - before[1], g.tower.keys - before[2]];

  let s = snap();
  g.bossClaim({ round: "2026-W40", total_hp: 1e9, my_dmg: 5e6, killed: false });
  let dlt = delta(s);
  eqNumArr(dlt, [goldTier, 0, 0], "参与档精确发金币");
  eq(g.boss.claimed.includes("2026-W40"), true, "领取后 claimed 记轮");

  s = snap();
  g.bossClaim({ round: "2026-W41", total_hp: 1e9, my_dmg: 5e7, killed: true });
  dlt = delta(s);
  eqNumArr(dlt, [goldTier, BAL.world_boss_stones_pct + BAL.world_boss_stones_kill, 1],
    "≥5%+击杀轮:金币+重铸石(叠加)+塔钥匙");

  // —— 幂等:同轮重复领取被拒,资源零变化 ——
  s = snap();
  g.bossClaim({ round: "2026-W41", total_hp: 1e9, my_dmg: 5e7, killed: true });
  eqNumArr(delta(s), [0, 0, 0], "同轮重复领取不发任何资源");
  ok(toastTexts(g).some(t => t.includes("已领取")), "重复领取 toast 明示已领");
  eq(g.boss.claimed.filter(r => r === "2026-W41").length, 1, "claimed 不重复记轮");

  // —— 未参与:拒绝发奖 ——
  s = snap();
  g.bossClaim({ round: "2026-W42", total_hp: 1e9, my_dmg: 0, killed: false });
  eqNumArr(delta(s), [0, 0, 0], "未参与(my_dmg=0)无奖励");
  eq(g.boss.claimed.includes("2026-W42"), false, "被拒不入 claimed");
}

/** 轮次切换:getBossSync 新轮号≠last_round 时 attempts/my_best 清零且 claimed 保留;
 *  红点纯本地判定;claimed 滚动裁剪按年/周数值序 */
function testWorldBossRounds(): void {
  const g = newGame(426304);
  g.chooseClass("warrior");

  // —— 首同步:不轮切换(返回 false),但同样建立 last_round ——
  g.boss.attempts = 2;
  g.boss.my_best = 777;
  eq(g.getBossSync("2026-W43"), false, "首同步(空 last_round)不算跨轮切换");
  eq(g.boss.last_round, "2026-W43", "last_round 建立为新轮");
  eq(g.boss.attempts, 0, "首同步清零次数");
  eq(g.boss.my_best, 0, "首同步清零最好成绩");

  // —— 同轮重复同步:无副作用 ——
  g.boss.attempts = 2;
  g.boss.my_best = 777;
  eq(g.getBossSync("2026-W43"), false, "同轮同步返回 false");
  eq(g.boss.attempts, 2, "同轮同步不动次数");
  eq(g.boss.my_best, 777, "同轮同步不动最好成绩");
  eq(g.getBossSync(""), false, "空轮号被忽略");
  eq(g.boss.last_round, "2026-W43", "空轮号不覆盖 last_round");

  // —— 跨轮:attempts/my_best 清零、claimed 保留 ——
  g.boss.claimed = ["2026-W41", "2026-W42"];
  eq(g.getBossSync("2026-W44"), true, "跨轮同步返回 true");
  eq(g.boss.attempts, 0, "跨轮清零次数");
  eq(g.boss.my_best, 0, "跨轮清零最好成绩");
  eq(g.boss.last_round, "2026-W44", "last_round 更新为新轮");
  eqStrArr(g.boss.claimed, ["2026-W41", "2026-W42"], "claimed 跨轮保留(历史幂等记录)");

  // —— 红点纯本地判定:上轮参与过未领 → 有轮号;同步进当前轮/已领 → 消失 ——
  const g2 = newGame(426305);
  g2.chooseClass("warrior");
  eq(g2.bossPendingClaim(), null, "从未同步(last_round 空)无红点");
  g2.getBossSync("1970-W1");          // 停在旧轮(≠当前周键)
  g2.boss.my_best = 100;
  eq(g2.bossPendingClaim(), "1970-W1", "上轮参与过未领 → 红点轮号");
  g2.getBossSync(currentWeekKey());   // 同步进当前轮:my_best 清零,红点消失(页内仍有领取入口)
  eq(g2.bossPendingClaim(), null, "同步进当前轮红点即消");
  g2.getBossSync("1970-W2");
  g2.boss.my_best = 100;
  g2.bossClaim({ round: "1970-W2", total_hp: 1e6, my_dmg: 100, killed: false });
  eq(g2.bossPendingClaim(), null, "已领取后无红点");

  // —— claimed 滚动裁剪:按 (年, 周数值) 排序保留最近 8 轮 ——
  // "2026-W10" 字典序排在 "2026-W2" 前(周数未补零):按数值序应保留 W3..W10、裁掉 W2;
  // 若误用字典序会把 W9 裁掉 —— 本断言即防该回归
  const g3 = newGame(426306);
  g3.chooseClass("warrior");
  g3.boss.claimed = ["2026-W2", "2026-W3", "2026-W4", "2026-W5", "2026-W6",
    "2026-W7", "2026-W8", "2026-W9", "2026-W10"];
  g3.getBossSync("2026-W44");
  eq(g3.boss.claimed.length, BAL.world_boss_claim_keep, `裁剪至最近 ${BAL.world_boss_claim_keep} 轮`);
  eq(g3.boss.claimed.includes("2026-W2"), false, "最旧一轮(W2)被裁");
  eq(g3.boss.claimed.includes("2026-W9"), true, "数值序裁剪:W9 保留(字典序会误裁)");
  eq(g3.boss.claimed.includes("2026-W10"), true, "最新一轮(W10)保留");
}

/** 存档 v10:旧档 v9 迁移 boss 默认 / fromDict 防御坏条目 / validateSaveDict 规则 / 往返保真 */
function testWorldBossSave(): void {
  const mem = memHooks();
  const g = newGame(426307);
  g.chooseClass("warrior");
  g.getBossSync("2026-W43");
  g.bossHitAccept(123456);
  g.bossClaim({ round: "2026-W42", total_hp: 1e6, my_dmg: 2e4, killed: false });

  // —— 往返保真 ——
  g.save();
  const d = JSON.parse(mem.raw);
  eq(d.version, SAVE_VERSION, `toDict 写新版本号 v${SAVE_VERSION}`);
  eq(d.boss.last_round, "2026-W43", "boss.last_round 入档");
  eq(d.boss.my_best, 123456, "boss.my_best 入档");
  eq(d.boss.attempts, 1, "boss.attempts 入档");
  eqStrArr(d.boss.claimed, ["2026-W42"], "boss.claimed 入档");
  const g2 = Game.fromDict(d);
  eq(g2.boss.last_round, "2026-W43", "往返 last_round");
  eq(g2.boss.my_best, 123456, "往返 my_best");
  eq(g2.boss.attempts, 1, "往返 attempts");
  eqStrArr(g2.boss.claimed, ["2026-W42"], "往返 claimed");

  // —— v9 旧档迁移:补 boss 默认零状态,无破坏 ——
  const v9 = JSON.parse(JSON.stringify(d));
  v9.version = 9;
  delete v9.boss;
  const m10 = migrateSave(v9);
  eq(m10.version, SAVE_VERSION, "v9 迁移一路到当前版本(v10 boss 段 + 后续版本段)");
  ok(m10.boss && m10.boss.last_round === "" && m10.boss.my_best === 0
    && m10.boss.attempts === 0 && Array.isArray(m10.boss.claimed) && m10.boss.claimed.length === 0,
    "v9 旧档补 boss 默认零状态");
  // 已是 v10 且有 boss 数据:迁移不改写(幂等)
  const again = migrateSave(JSON.parse(JSON.stringify(d)));
  eq(again.boss.my_best, 123456, "v10 档迁移不覆盖既有 boss 状态");

  // —— fromDict 防御:坏形状回默认、坏条目过滤、越界钳制 ——
  const bad = JSON.parse(JSON.stringify(d));
  bad.boss = { last_round: 123, my_best: -5, attempts: 99, claimed: ["2026-W1", 42, null] };
  const g3 = Game.fromDict(bad);
  eq(g3.boss.last_round, "", "非字符串 last_round 回空");
  eq(g3.boss.my_best, 0, "负 my_best 回 0");
  eq(g3.boss.attempts, BAL.world_boss_attempts, "attempts 越界钳至 0..3");
  eqStrArr(g3.boss.claimed, ["2026-W1"], "claimed 坏条目过滤");
  const worse = JSON.parse(JSON.stringify(d));
  worse.boss = [1, 2, 3];
  eq(Game.fromDict(worse).boss.last_round, "", "boss 非对象整体回默认");

  // —— validateSaveDict:d.boss 规则(合法无告警,非法逐字段 warn) ——
  const issues = validateSaveDict(d);
  eq(issues.filter(i => i.field.startsWith("boss")).length, 0, "合法 boss 无告警");
  const vi = validateSaveDict({ ...d, boss: { last_round: 7, attempts: 5, my_best: -1,
    claimed: ["2026-W1", 3] } });
  const fields = vi.filter(i => i.field.startsWith("boss")).map(i => i.field);
  ok(fields.includes("boss.last_round"), "last_round 非字符串告警");
  ok(fields.includes("boss.attempts"), "attempts 越界(>3)告警");
  ok(fields.includes("boss.my_best"), "my_best 负数告警");
  ok(fields.includes("boss.claimed.1"), "claimed 非字符串条目告警");
  ok(validateSaveDict({ ...d, boss: "x" }).some(i => i.field === "boss"),
    "boss 非对象整体告警");
}

// ================================================================ 异步切磋(2.7)
function testArenaSquad(): void {
  const g = newGame(426401);
  g.chooseClass("mage");
  g.level = 40;
  g.recalcHero();                      // 解锁装配槽(loadout_unlock 4 槽)
  g.equipSkill("m_missile", "active");
  g.equipSkill("m_fire", "active");
  g.equipSkill("pm_affin", "passive");
  // 穿一件套装标记装备(直接打 suitId,确定;suits 字段依赖 gear-suits 的 SUIT_DEF 口径)
  const it = rollItem(10, g.rng, 0, 0, 0, "mage", 1);
  it.suitId = "s2";                    // 焚天
  g.equip[it.slot] = it;
  g.recalcHero();

  // —— makeSquad 快照字段完整:eq 逐键(面板值 + 装配表 + 套装列表) ——
  const sq = makeSquad(g);
  eq(sq.cls, "mage", "快照 cls");
  eq(sq.level, g.level, "快照 level");
  eq(sq.title, g.title, "快照 title");
  eq(sq.atk, g.hero.atk, "快照 atk(基础面板口径)");
  eq(sq.hp, g.hero.max_hp, "快照 hp=max_hp");
  eq(sq.def, g.hero.def, "快照 def");
  eq(sq.haste, g.hero.haste, "快照 haste");
  eq(sq.crit, g.hero.crit, "快照 crit");
  eq(sq.crit_dmg, g.hero.crit_dmg, "快照 crit_dmg");
  eq(sq.lifesteal, g.hero.lifesteal, "快照 lifesteal");
  eq(sq.dodge, g.hero.dodge, "快照 dodge");
  eq(sq.armor_pierce, g.hero.armor_pierce, "快照 armor_pierce");
  eq(sq.skill_dmg, g.hero.skill_dmg, "快照 skill_dmg");
  eq(sq.cd_reduce, g.hero.cd_reduce, "快照 cd_reduce");
  eq(sq.interval, g.hero.interval, "快照 interval");
  eqStrArr(sq.active, ["m_missile", "m_fire"], "快照 active 与 loadout 双向一致");
  eqStrArr(sq.passive, ["pm_affin"], "快照 passive 与 loadout 双向一致");
  eqStrArr(sq.suits, ["s2"], "快照 suits 列表(已穿套装)");

  // —— 拷贝语义:卸下技能后旧快照不变,重新取反映当前装配(loadout 双向) ——
  g.unequipSkill("m_fire");
  ok(sq.active.includes("m_fire"), "快照是拷贝:装卸后旧快照不受影响");
  const sq2 = makeSquad(g);
  ok(!sq2.active.includes("m_fire"), "重新取快照反映当前装配");
  eqStrArr(makeSquad(newGame(426411)).suits, [], "无套装装备时 suits 为空");

  // —— 序列化体积在服务端 4KB 浅校验上限内 ——
  const json = JSON.stringify(sq);
  ok(json.length <= 4096, `快照序列化 ≤4KB(实际 ${json.length})`);

  // —— parseSquad:合法快照 JSON 往返逐字段还原 ——
  const ps = parseSquad(JSON.parse(json));
  eq(ps.cls, sq.cls, "parseSquad cls 还原");
  eq(ps.level, sq.level, "parseSquad level 还原");
  eq(ps.atk, sq.atk, "parseSquad atk 还原");
  eq(ps.hp, sq.hp, "parseSquad hp 还原");
  eq(ps.interval, sq.interval, "parseSquad interval 还原");
  eqStrArr(ps.active, sq.active, "parseSquad active 还原");
  eqStrArr(ps.suits, sq.suits, "parseSquad suits 还原");

  // —— parseSquad 防御:匿名他人快照的坏值回落安全默认(含上限钳制) ——
  const pd = parseSquad({ atk: -5, hp: 0, crit: 900, dodge: 99, armor_pierce: 88,
    cd_reduce: 70, interval: -1, level: 0, active: [1, "m_fire"] });
  eq(pd.atk, 1, "负 atk 回默认 1");
  eq(pd.hp, 1, "hp=0 钳 1");
  eq(pd.crit, 100, "crit 超限钳 100");
  eq(pd.dodge, 40, "dodge 超限钳 40(CAPS)");
  eq(pd.armor_pierce, 50, "armor_pierce 超限钳 50");
  eq(pd.cd_reduce, 40, "cd_reduce 超限钳 40");
  eq(pd.interval, 1.1, "负 interval 回默认 1.1");
  eq(pd.level, 1, "level=0 钳 1");
  eqStrArr(pd.active, ["m_fire"], "active 非字符串条目过滤");
  const pn = parseSquad(null);
  eq(pn.cls, "", "null 快照回默认 cls");
  eq(pn.atk, 1, "null 快照回默认 atk");
  eqStrArr(pn.active, [], "null 快照回默认 active");
}

function testArenaSim(): void {
  const g1 = newGame(426402);
  g1.chooseClass("warrior");
  g1.level = 30;
  g1.recalcHero();
  g1.equipSkill("w_strike", "active");
  g1.equipSkill("w_warcry", "active");     // buff 技能也进折算(覆盖率乘区)
  g1.equipSkill("pw_tough", "passive");
  const g2 = newGame(426403);
  g2.chooseClass("ranger");
  g2.level = 30;
  g2.recalcHero();
  g2.equipSkill("r_volley", "active");
  g2.equipSkill("pr_swift", "passive");
  const me = makeSquad(g1), foe = makeSquad(g2);

  // —— 固定 seed 三次运行:胜负与剩余血量逐位 eq(确定性) ——
  const r1 = arenaSimulate(me, foe, 20261024);
  const r2 = arenaSimulate(me, foe, 20261024);
  const r3 = arenaSimulate(me, foe, 20261024);
  eq(r1.win, r2.win, "三次运行胜负一致");
  eq(r2.win, r3.win, "三次运行胜负一致(2-3)");
  eq(r1.meHpPct, r2.meHpPct, "剩余血量逐位 eq(me)");
  eq(r1.meHpPct, r3.meHpPct, "剩余血量逐位 eq(me,1-3)");
  eq(r1.foeHpPct, r2.foeHpPct, "剩余血量逐位 eq(foe)");
  eq(r1.rounds, r2.rounds, "回合成数一致");
  eq(r1.reason, r2.reason, "胜负原因一致");
  eqStrArr(r1.report, r2.report, "战斗播报逐字一致");
  eq(r1.report.length, 5, "播报恰 5 条");
  ok(r1.rounds >= 1 && r1.rounds <= BAL.arena_max_rounds, `回合法(实际 ${r1.rounds})`);

  // —— 多个 seed 结构合法(血量百分比有界;win 与 meHpPct>foeHpPct 同向) ——
  for (const s of [1, 2, 3, 999, 777777]) {
    const r = arenaSimulate(me, foe, s);
    ok(r.meHpPct >= 0 && r.meHpPct <= 100 && r.foeHpPct >= 0 && r.foeHpPct <= 100,
      `seed=${s} 血量百分比在 0..100`);
    if (r.reason === "hp") {
      eq(r.win, r.meHpPct >= r.foeHpPct, `seed=${s} 血量判定方向`);
    }
  }

  // —— 平局判发起挑战方胜:镜像对局 self vs self,自己是攻方 → 判自己胜 ——
  for (const [sq, seed] of [[me, 426402], [foe, 777], [makeSquad(g1), 31337]] as const) {
    const mirror = arenaSimulate(sq, sq, seed);
    ok(mirror.win === true, `镜像对局判挑战方(自己)胜(seed=${seed})`);
    eq(mirror.reason, "tie", `镜像对局必然持平(seed=${seed})`);
    eq(mirror.meHpPct, mirror.foeHpPct, "镜像对局双方血量逐位相同");
  }

  // —— 装配差异真实影响胜负:面板碾压方必胜、反向挑战必负 ——
  const strong = { ...makeSquad(g1), atk: g1.hero.atk * 1000, hp: g1.hero.max_hp * 10 };
  ok(arenaSimulate(strong, foe, 12345).win === true, "面板碾压方挑战获胜");
  ok(arenaSimulate(foe, strong, 12345).win === false, "反向挑战(自己面板弱)则负");
}

function testArenaRecord(): void {
  const g = newGame(426404);
  g.chooseClass("warrior");
  eq(g.arena.wins, 0, "新档 0 胜");
  eq(g.arena.losses, 0, "新档 0 负");
  const gold0 = g.gold;

  for (let i = 0; i < 5; i++) g.arenaResult(false);
  eq(g.arena.losses, 5, "5 次负计入 losses");
  eq(g.arena.wins, 0, "负不计入 wins");

  for (let i = 1; i <= 9; i++) g.arenaResult(true);
  eq(g.arena.wins, 9, "9 胜计数");
  ok(!g.titles.includes("t_arena10"), "9 胜未到门槛不发称号");
  eq(toastTexts(g).length, 0, "未达门槛无称号 toast");

  g.arenaResult(true);   // 第 10 胜:达门槛
  eq(g.arena.wins, 10, "10 胜计数");
  ok(g.titles.includes("t_arena10"), "10 胜发 t_arena10");
  ok(toastTexts(g).some(t => t.includes("切磋者")), "发称号 toast(切磋者)");

  for (let i = 11; i <= 50; i++) g.arenaResult(true);   // 推到 50 胜
  eq(g.arena.wins, 50, "50 胜计数");
  eq(g.arena.losses, 5, "losses 不受胜场影响");
  ok(g.titles.includes("t_arena50"), "50 胜发 t_arena50");
  ok(toastTexts(g).some(t => t.includes("角斗士")), "发称号 toast(角斗士)");
  eq(g.titles.filter(t => t === "t_arena10").length, 1, "t_arena10 不重复发");
  eq(g.titles.filter(t => t === "t_arena50").length, 1, "t_arena50 不重复发");
  eq(g.gold, gold0, "称号无属性/资源奖励(gold 不变)");

  // TITLES 纯枚举追加:两条新称号有中文名,佩戴合法(setTitle 只认已拥有)
  eq(TITLES.find(t => t.id === "t_arena10")?.name, "切磋者", "TITLES 追加 t_arena10");
  eq(TITLES.find(t => t.id === "t_arena50")?.name, "角斗士", "TITLES 追加 t_arena50");
  g.setTitle("t_arena50");
  eq(g.title, "t_arena50", "切磋称号可佩戴");
  const g2 = newGame(426414);
  g2.chooseClass("mage");
  g2.setTitle("t_arena10");   // 未拥有 → 不佩戴
  eq(g2.title, "", "未拥有的切磋称号不可佩戴");
}

function testArenaSave(): void {
  const mem = memHooks();
  const g = newGame(426405);
  g.chooseClass("mage");
  g.arenaResult(true);
  g.arenaResult(true);
  g.arenaResult(false);

  // —— 往返保真 ——
  g.save();
  const d = JSON.parse(mem.raw);
  eq(d.version, SAVE_VERSION, `toDict 写版本号 v${SAVE_VERSION}`);
  eq(d.arena.wins, 2, "wins 入档");
  eq(d.arena.losses, 1, "losses 入档");
  const g2 = Game.fromDict(d);
  eq(g2.arena.wins, 2, "往返 wins 保真");
  eq(g2.arena.losses, 1, "往返 losses 保真");

  // —— 旧档(无 d.arena)迁移:v9 → v10 补默认 0/0;fromDict 载入 0 胜 0 负 ——
  const v9 = JSON.parse(JSON.stringify(d));
  v9.version = 9;
  delete v9.arena;
  const m = migrateSave(v9);
  eq(m.version, SAVE_VERSION, "v9 迁移一路到当前版本(v10 arena 段 + 后续版本段)");
  ok(m.arena && m.arena.wins === 0 && m.arena.losses === 0, "旧档补 arena 默认 0 胜 0 负");
  const g3 = Game.fromDict(JSON.parse(JSON.stringify(v9)));
  eq(g3.arena.wins, 0, "无 d.arena 载入 0 胜");
  eq(g3.arena.losses, 0, "无 d.arena 载入 0 负");
  // 已是 v10 且有战绩:迁移不改写(幂等)
  eq(migrateSave(JSON.parse(JSON.stringify(d))).arena.wins, 2, "v10 档迁移不覆盖既有战绩");

  // —— fromDict 防御:负数/坏值钳 0,非对象整体回默认 ——
  const bad = JSON.parse(JSON.stringify(d));
  bad.arena = { wins: -3, losses: "x" };
  const g4 = Game.fromDict(bad);
  eq(g4.arena.wins, 0, "负 wins 钳 0");
  eq(g4.arena.losses, 0, "坏 losses 回 0");
  const worse = JSON.parse(JSON.stringify(d));
  worse.arena = [1, 2];
  eq(Game.fromDict(worse).arena.wins, 0, "arena 非对象整体回默认");
  eq(Game.fromDict(worse).arena.losses, 0, "arena 非对象整体回默认(losses)");

  // —— validateSaveDict:d.arena 规则(合法无告警,非法逐字段 warn) ——
  eq(validateSaveDict(d).filter(i => i.field.startsWith("arena")).length, 0, "合法 arena 无告警");
  const vi = validateSaveDict({ ...d, arena: { wins: -1, losses: 2.5 } });
  const fields = vi.filter(i => i.field.startsWith("arena")).map(i => i.field);
  ok(fields.includes("arena.wins"), "负 wins 告警");
  ok(fields.includes("arena.losses"), "非整数 losses 告警");
  ok(validateSaveDict({ ...d, arena: "x" }).some(i => i.field === "arena"),
    "arena 非对象整体告警");
}

// ================================================================ 33. 扩展怪物 20 种完整性
function testExtendedMonsters(): void {
  const EXT = ["treant", "boar", "rat", "kobold", "crystal", "maggot", "salamander",
    "obsidian", "yeti", "wisp", "leech", "toad", "mirecrab", "ghoul", "banshee",
    "bonehawk", "ghast", "crawler", "voidling", "shard"];
  eq(EXT.length, 20, "扩展怪清单恰 20 种");
  eq(Object.keys(MONSTERS).length, 37, "图鉴总量 17+20=37");

  for (const id of EXT) {
    const m = MONSTERS[id];
    ok(!!m, `扩展怪 ${id} 已定义`);
    const a = ART[id];
    ok(Array.isArray(a) && a.length === 5 && a.every(r => r.trim().length > 0),
      `扩展怪 ${id} ART 为 5 行非空`);
    const sk = m.skill;
    ok(sk.cd >= 8 && sk.cd <= 15 && sk.mult > 0 && sk.hits >= 1 && sk.mult * sk.hits <= 2.8,
      `扩展怪 ${id} 技能数值在既有梯度(cd/mult/hits)`);
    ok(m.power >= 0.9 && m.power <= 1.15,
      `扩展怪 ${id} power 在既有梯度`);
  }
  // 控制类(stun)新怪恰 2 只,防止误加导致区区被控
  eq(EXT.filter(id => MONSTERS[id]!.skill.stun).length, 2, "扩展怪带眩晕的恰 2 种(treant/banshee)");

  // 每区池扩充且成员完整;全池并集覆盖全部 37 怪(图鉴可达)
  let union = new Set<string>();
  for (const t of THEMES) {
    ok(t.mobs.length >= 5, `${t.name} 池已扩充(≥5)`);
    for (const id of t.mobs) {
      ok(!!MONSTERS[id] && !!ART[id], `${t.name} 池成员 ${id} 在 MONSTERS+ART`);
      union.add(id);
    }
  }
  eq(union.size, Object.keys(MONSTERS).length, "各区池并集 = 全部怪物(图鉴全可达)");

  // spawn 冒烟:每区都能 spawn 扩展怪不崩(rng 消耗无断言,只验证查表路径)
  const g = new Game(97);
  g.chooseClass("warrior");
  for (let z = 1; z <= 8; z++) {
    for (let i = 0; i < 60; i++) {
      const m = spawnMonster(z, (i % 10) + 1, g.rng);
      ok(m.hp > 0 && m.maxHp > 0 && !!m.art && m.art.length === 5, `zone${z} spawn 正常`);
    }
  }
}

const TESTS: [string, () => void][] = [
  ["1.RNG(MT19937 与 CPython 对拍)", testRng],
  ["2.职业选择(handleKey/chooseClass/recalc)", testClassChoose],
  ["3.技能装配/卸下/升级键位冒烟", testSkillKeys],
  ["4.存档 v4 往返 + v3 迁移", testSaveRoundtrip],
  ["5.stat_mods 挂口", testStatMods],
  ["6.resolve 离线结算", testResolveOffline],
  ["7.渲染尺寸(7 tab × 100 宽 + 弹窗)", testRenderSize],
  ["8.fmt/pyRound(银行家舍入)", testFmtPyRound],
  ["9.遗物背包(容量/升级/收纳/存档)", testRelicBag],
  ["10.手动模式换装对比(装备/遗物)", testPendingSwap],
  ["11.存档防御+遗物roll修正(损坏/luck/空装配)", testSaveDefenseAndRelicRoll],
  ["12.战力系统(计算/预览还原/buff口径)", testPower],
  ["13.一键出售品质档(默认/档位0/2/5)", testSellJunk],
  ["14.怪物技能debuff(减速/眩晕/存档口径)", testMobSkillDebuff],
  ["15.转生(门槛/重置/保留/倍率/存档v8)", testRebirth],
  ["16.祭坛批量(×N精确扣费/MAX至不足/×1委托/预估)", testAltarBatch],
  ["17.成就跨档反馈(基线/跨档/去重/重载静默)", testAchFeedback],
  ["18.自动化开关/装备锁定/批量分解/分怪图鉴", testAutoLockCodex],
  ["19.签到/周常/世系/称号/兑换码", testSigninWeekly],
  ["20.强化继承/图鉴二期加成/成就新维度", testInheritCodex],
  ["21.方案B 转生深度加权(锚点/封顶/保底/等值迁移)", testRebirthDepth],
  ["22.持续伤害技能(燃烧跳伤/吸血/击杀/描述)", testDotSkills],
  ["23.引导攻击(旋风斩多跳/停普攻/跨怪续转)", testBurstSkill],
  ["24.技能顺序施放(一拍一个/装配顺序排队)", testSkillOrder],
  ["25.死亡窗口存档兜底(hp0补复活倒计时)", testDeathSaveRevive],
  ["26.三职业引导技能(法/射吟唱登记/节拍/数值锚)", testChannelSkills],
  ["27.未选职业世界冻结(幽灵战士不打工)", testPreClassFrozen],
  ["28.深渊天赋(魂晶/消费/门槛/特殊节点/存档v9)", testTalents],
  ["29.定向锻造(解锁/费用/必带词缀/自动出售豁免)", testForge],
  ["30.塔怪技能(每层变数)", testTowerSkills],
  ["31.成就第三梯队(经济打点/新维度跨档)", testAchThirdWave],
  ["32.悬赏目标封顶(深区不爆指数)", testQuestTargetCap],
  ["33.扩展怪物20种(定义/ART/池/梯度/spawn)", testExtendedMonsters],
  ["33.怪物技能特效事件(mskill:<名字>)", testMobSkillFxEvent],
  ["34.断签重置幂等(防日志刷屏)", testSigninStreakIdempotent],
  ["35.塔内会话进存档(刷新续战/离线不结算)", testTowerSessionSave],
  ["36.每日免费钥匙(跨日打点发放/首刷补足)", testTowerDailyKeys],
  ["37.选层重打已通层(默认不变/UI选层/结算口径)", testTowerRefloor],
  ["38.每10层首通里程碑宝箱(重铸石)", testTowerMilestone],
  ["39.塔经济全链路(钥匙账/加购/禁转生/boss通道锁定)", testTowerEconomy],
  ["40.深渊套装(表值锚/掉落判定/2-4件加成/存档往返)", testGearSuitsCore],
  ["41.深渊套装(折现防护:腾位/兜底/档位豁免/凑齐回归/配额)", testGearSuitsSalvageGuard],
  ["42.深渊套装(换装守卫:手动必弹/自动静默/不顶待确认)", testGearSuitsSwapGuard],
  ["43.深渊套装(分区特产/塔中口径/旧档v9/管理校验)", testGearSuitsZoneTowerMigrate],
  ["44.终局一击(表锚/三职业结算对拍1e-9)", testUltTableDamage],
  ["45.终局一击(门槛拒绝/Lv35提示/CD未到无副作用)", testUltGates],
  ["46.终局一击(B1生命周期:新档undefined/重载即放/无NaN)", testUltLifecycle],
  ["47.终局一击(cd_reduce缩短/特效伤害事件/统计计数)", testUltCdEvents],
  ["48.世界BOSS(伤害折算:固定种子close/浮动边界/拒绝路径)", testWorldBossDamage],
  ["49.世界BOSS(奖励档位:参与/≥1%/≥5%/击杀轮逐档eq+同轮重复领取被拒)", testWorldBossRewards],
  ["50.世界BOSS(轮切换:getBossSync清零attempts与my_best/claimed保留/红点本地判定/裁剪数值序)", testWorldBossRounds],
  ["51.世界BOSS(存档v10:旧档v9迁移默认/fromDict防御/validateSaveDict规则/往返保真)", testWorldBossSave],
  ["52.异步切磋(快照:makeSquad字段eq逐键/loadout双向/suits列表/parseSquad防御)", testArenaSquad],
  ["53.异步切磋(对战:固定seed三次逐位eq/平局判攻方/镜像自己胜/面板差驱动)", testArenaSim],
  ["54.异步切磋(战绩计数/称号阈值10胜50胜/不重复发/无资源奖励)", testArenaRecord],
  ["55.异步切磋(存档:旧档v9补默认0胜0负/往返保真/fromDict防御/validateSaveDict规则)", testArenaSave],
];

let failed = 0;
for (const [name, fn] of TESTS) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${(e as Error).message}`);
  }
}
if (failed > 0) {
  console.log(`[FAILED] ${failed}/${TESTS.length} 项未通过`);
  process.exitCode = 1;
} else {
  console.log(`[ALL PASS] ${TESTS.length}/${TESTS.length}`);
}
