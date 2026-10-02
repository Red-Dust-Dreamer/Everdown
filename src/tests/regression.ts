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
import { Relic, rollRelic } from "../core/relics.ts";
import { fmt, dwidth } from "../core/ansi.ts";
import { buffPct, atkNow } from "../core/skills.ts";
import { heroPower, powerWithEquip, powerWithRelic } from "../core/power.ts";
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
  g.equipRelicFromBag(0);                    // 4 槽全满:拒绝
  eq(g.relicBag.length, 1, "槽满拒绝装备");
  ok(toastTexts(g).some(t => t.includes("遗物槽已满")), "槽满 toast");

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
  ["9.遗物背包(容量/升级/收纳/存档)", testRelicBag],
  ["10.手动模式换装对比(装备/遗物)", testPendingSwap],
  ["11.存档防御+遗物roll修正(损坏/luck/空装配)", testSaveDefenseAndRelicRoll],
  ["12.战力系统(计算/预览还原/buff口径)", testPower],
  ["13.一键出售品质档(默认/档位0/2/5)", testSellJunk],
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
