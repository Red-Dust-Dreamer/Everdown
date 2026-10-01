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
import { Game, installSaveHooks, migrateSave, SAVE_VERSION } from "../core/game.ts";
import type { SaveHooks } from "../core/game.ts";
import { View } from "../core/view.ts";
import { handleKey } from "../core/host.ts";
import { renderFrame } from "../core/render.ts";
import { BAL, CLASSES } from "../core/data.ts";
import { pyRound, Item } from "../core/items.ts";
import { fmt, dwidth } from "../core/ansi.ts";
import type { ResolveReport } from "../core/systems.ts";

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
  eq(m.version, 4, "v3 迁移后版本应为 4");
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

  // 7 个 tab × 100×30,每行 dwidth == 100
  const g = newGame(56);
  g.chooseClass("ranger");
  for (let i = 0; i < 60; i++) g.tick(0.25); // 有战斗状态/日志/掉落
  g.view.drain(g);
  g.view.tick(0.1);
  // 造一些有内容的背包(渲染分支覆盖)
  const it = new Item("weapon", "rare", 3, 12.5, [{ id: "atk", val: 2.5 }]);
  g.bag.push(it);
  for (let tab = 0; tab < 7; tab++) {
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

// ================================================================ runner
const TESTS: [string, () => void][] = [
  ["1.RNG(MT19937 与 CPython 对拍)", testRng],
  ["2.职业选择(handleKey/chooseClass/recalc)", testClassChoose],
  ["3.技能装配/卸下/升级键位冒烟", testSkillKeys],
  ["4.存档 v4 往返 + v3 迁移", testSaveRoundtrip],
  ["5.stat_mods 挂口", testStatMods],
  ["6.resolve 离线结算", testResolveOffline],
  ["7.渲染尺寸(7 tab × 100 宽 + 弹窗)", testRenderSize],
  ["8.fmt/pyRound(银行家舍入)", testFmtPyRound],
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
