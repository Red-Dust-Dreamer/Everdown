/** 管理面板核心链路冒烟测试(docs/admin-panel.md §8.1,固定验收命令):
 *
 *   node --experimental-strip-types scripts/admin-smoke.ts    # 退出码 0 判过
 *
 * 覆盖:A 覆盖文件的加载/应用/非法拒绝(§8.1 A1-A6,规则依据 §4.2/§4.3/§8.A);
 *      B 存档 读入→修改→校验→导出 往返(§8.1 B7-B11,规则依据 §5.2/§8.B)。
 * 纯内存运行:不读写仓库根 save.json / overrides.json,不写任何文件
 * (tick() 的自动存档在未 installSaveHooks 时为 no-op,game.ts save())。
 * 每条断言独立 PASS/FAIL 打印;任一 FAIL → 退出码 1;
 * 全过打印 [ADMIN-SMOKE PASS] n/n 退出 0。
 */
import {
  applyOverrides, listOverridableLeaves, OverrideFormatError, overrideDiff,
  parseOverrideFile, resetOverrides, serializeOverrideFile,
  type OverrideValues,
} from "../src/core/overrides.ts";
import {
  ACTIVE_SKILLS, AFFIXES, BAL, MAIN_ROLLS, MONSTERS, RARITIES, SLOT_INNATE,
  SLOTS, STAT_NAMES, THEMES, TOWER,
} from "../src/core/data.ts";
import { Game, migrateSave } from "../src/core/game.ts";
import { validateSaveDict, type SaveIssue } from "../src/core/savefile.ts";
import { rollItem } from "../src/core/items.ts";
import { PyRandom } from "../src/core/rng.ts";
import { coerceInput } from "../src/web/admin/admin-dom.ts";
import { isLockedPath, leafLabel } from "../src/web/admin/admin-meta.ts";

// ================================================================ 断言工具
let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: 期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}`);
  }
}
function deepEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}: 期望 ${b}, 实际 ${a}`);
}
/** 单条独立断言:抛错记 FAIL 不中断后续条目(§8.1「每条独立 PASS/FAIL」) */
function check(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
const errorsOf = (issues: SaveIssue[]): SaveIssue[] => issues.filter(i => i.level === "error");

// ================================================================ A. 覆盖机制
check("A1 listOverridableLeaves ≥400 且含四个关键路径", () => {
  const leaves = listOverridableLeaves();
  ok(Object.keys(leaves).length >= 400, `叶子数应 ≥400,实际 ${Object.keys(leaves).length}`);
  for (const p of ["BAL.hero_hp0", "RARITIES.5.weight", "ACTIVE_SKILLS.0.cd",
    "MONSTERS.slime.skill.cd"]) {
    ok(p in leaves, `应含叶子 ${p}`);
  }
});

check("A2 合法应用 3 项:applied 按入参序 / rejected 0 / 实读三处已变", () => {
  const r = applyOverrides({
    "BAL.hero_atk0": 1000, "RARITIES.5.weight": 1e9, "ACTIVE_SKILLS.0.cd": 1,
  });
  deepEq(r.applied, ["BAL.hero_atk0", "RARITIES.5.weight", "ACTIVE_SKILLS.0.cd"],
    "applied 应按入参序返回 3 条");
  eq(r.rejected.length, 0, "rejected 数");
  eq(BAL.hero_atk0, 1000, "BAL.hero_atk0 实读");
  eq(RARITIES[5]!.weight, 1e9, "RARITIES[5].weight 实读");
  eq(ACTIVE_SKILLS[0]!.cd, 1, "ACTIVE_SKILLS[0].cd 实读");
});

check("A3 引擎生效:recalcHero 攻击 = 1000×1.05(职业倍率)", () => {
  const g = new Game(7);
  g.classId = "warrior";
  g.recalcHero();
  eq(g.hero.atk, 1000 * 1.05, "hero.atk 应为覆盖值 × 战士 atk 倍率 1.05");
});

/** A4 单条非法注入:必须 rejected、reason 正确、且「零写入」
 *  (diff 快照不变 + 目标叶子实读不变,双重验证 §4.3「被拒条目零写入」)。 */
function expectReject(name: string, values: OverrideValues, expectedReason: string,
                      readLeaf?: () => unknown, leafExpect?: unknown): void {
  check(name, () => {
    const before = JSON.stringify(overrideDiff());
    const path = Object.keys(values)[0]!;
    const r = applyOverrides(values);
    eq(r.applied.length, 0, "applied 应为 0(单条注入)");
    eq(r.rejected.length, 1, "rejected 应为 1(单条注入)");
    eq(r.rejected[0]!.path, path, "拒绝路径应为注入路径");
    eq(r.rejected[0]!.reason, expectedReason, "拒绝 reason");
    eq(JSON.stringify(overrideDiff()), before, "被拒条目必须零写入(diff 不变)");
    if (readLeaf) eq(readLeaf(), leafExpect, "目标叶子实读应保持原值");
  });
}
// R1-R5(§4.3 规则表逐条;NaN 经 JSON.stringify 为 null,故走实读断言)
expectReject("A4 拒绝 R1:未知根 FOO.bar", { "FOO.bar": 1 }, "unknown root");
expectReject("A4 拒绝 R2:未知路径 BAL.no_such", { "BAL.no_such": 1 }, "path not found");
expectReject("A4 拒绝 R2:数组越界 RARITIES.99.weight", { "RARITIES.99.weight": 1 }, "path not found");
expectReject("A4 拒绝 R4:类型不符 hero_atk0=\"x\"", { "BAL.hero_atk0": "x" },
  "type mismatch", () => BAL.hero_atk0, 1000);
expectReject("A4 拒绝 R3:非叶 \"BAL\"", { "BAL": 1 }, "not a primitive leaf");
expectReject("A4 拒绝 R5:非有限数 NaN", { "BAL.hero_atk0": Number.NaN },
  "non-finite number", () => BAL.hero_atk0, 1000);
// R6 结构键五条(§8.1 A4 明列;RARITIES.*.key 是评审轮实测出的掉落即崩路径)
expectReject("A4 拒绝 R6①:AFFIXES.0.id", { "AFFIXES.0.id": "boom" },
  "locked structural key", () => AFFIXES[0]!.id, "atk");
expectReject("A4 拒绝 R6①:RARITIES.0.key(掉落即崩路径)", { "RARITIES.0.key": "x" },
  "locked structural key", () => RARITIES[0]!.key, "common");
expectReject("A4 拒绝 R6②:THEMES.0.mobs.0", { "THEMES.0.mobs.0": "dragon" },
  "locked structural key", () => THEMES[0]!.mobs[0], "slime");
expectReject("A4 拒绝 R6③:SLOT_INNATE.boots.0(元组下标 0 持属性键)", { "SLOT_INNATE.boots.0": "zzz" },
  "locked structural key", () => SLOT_INNATE.boots![0], "haste");
expectReject("A4 拒绝 R6①:ACTIVE_SKILLS.0.kind(类型合法的行为选择器)",
  { "ACTIVE_SKILLS.0.kind": "heal" },
  "locked structural key", () => ACTIVE_SKILLS[0]!.kind, "damage");

/** A5 单条:文件整体格式错误必须抛 OverrideFormatError(name 恒为,§8.A) */
function expectFormatError(name: string, text: string): void {
  check(name, () => {
    let threw: unknown = null;
    try {
      parseOverrideFile(text);
    } catch (err) {
      threw = err;
    }
    ok(threw instanceof OverrideFormatError,
      `应抛 OverrideFormatError(文本 ${JSON.stringify(text)})`);
    ok(threw instanceof Error && threw.name === "OverrideFormatError",
      `error.name 应恒为 "OverrideFormatError",实际 ${JSON.stringify((threw as Error)?.name)}`);
  });
}
expectFormatError("A5 parse:坏 JSON", "{no");
expectFormatError("A5 parse:顶层数组", "[1,2]");
expectFormatError("A5 parse:version 缺失", '{"values":{"BAL.hero_hp0":1}}');
expectFormatError("A5 parse:version=2", '{"version":2,"values":{}}');
expectFormatError("A5 parse:values 缺失", '{"version":1}');
expectFormatError("A5 parse:values 含嵌套对象", '{"version":1,"values":{"BAL.hero_hp0":{"x":1}}}');
expectFormatError("A5 parse:values 含空字符串键(§4.3)", '{"version":1,"values":{"":"1"}}');

check("A5 parse:§4.2 示例文件逐值解析", () => {
  const text = [
    "{",
    '  "version": 1,',
    '  "values": {',
    '    "BAL.hero_atk0": 20,',
    '    "BAL.loadout_unlock.2": 14,',
    '    "RARITIES.5.weight": 3,',
    '    "ACTIVE_SKILLS.12.cd": 4,',
    '    "MONSTERS.slime.skill.slow.0": 0.4',
    "  }",
    "}",
  ].join("\n");
  deepEq(parseOverrideFile(text), {
    "BAL.hero_atk0": 20,
    "BAL.loadout_unlock.2": 14,
    "RARITIES.5.weight": 3,
    "ACTIVE_SKILLS.12.cd": 4,
    "MONSTERS.slime.skill.slow.0": 0.4,
  }, "示例文件应解析出全部 5 条覆盖");
});

check("A5 parse:空 values → {} 且 apply applied=0", () => {
  const text = serializeOverrideFile({});
  ok(text.includes('"version": 1'), "序列化应为 {version:1, values:{}} 形态(2 空格缩进)");
  const v = parseOverrideFile(text);
  eq(Object.keys(v).length, 0, "空 values 应解析为 {}");
  const r = applyOverrides(v);
  eq(r.applied.length, 0, "applied 应为 0");
  eq(r.rejected.length, 0, "rejected 应为 0");
});

check("A6 残余零写入:A4/A5 全部注入后 diff 恰为 A2 的 3 项", () => {
  deepEq(overrideDiff(), {
    "BAL.hero_atk0": 1000, "RARITIES.5.weight": 1e9, "ACTIVE_SKILLS.0.cd": 1,
  }, "被拒/格式错误注入不得残留任何写入");
});

check("A6 reset:diff 清空且引擎回到基线(15×1.05)", () => {
  resetOverrides();
  eq(Object.keys(overrideDiff()).length, 0, "reset 后 diff 应为空");
  const g = new Game(7);
  g.classId = "warrior";
  g.recalcHero();
  eq(g.hero.atk, 15 * 1.05, "默认 hero_atk0=15 × 战士 1.05 = 15.75");
});

check("A6 serialize→parse→apply 往返复现 diff", () => {
  const r = applyOverrides({ "BAL.hero_atk0": 777, "TOWER.th0": 123.5 });
  eq(r.rejected.length, 0, "预置 2 项应全部应用");
  const d1 = overrideDiff();
  deepEq(d1, { "BAL.hero_atk0": 777, "TOWER.th0": 123.5 }, "diff 应恰为预置 2 项");
  const text = serializeOverrideFile(d1);
  resetOverrides();
  eq(Object.keys(overrideDiff()).length, 0, "reset 后 diff 应为空");
  applyOverrides(parseOverrideFile(text));
  deepEq(overrideDiff(), d1, "往返后 diff 应复现");
  resetOverrides();   // 收尾:B 组在默认数值环境下运行
  eq(BAL.hero_atk0, 15, "收尾实读:hero_atk0 已回默认");
  eq(TOWER.th0, 80, "收尾实读:TOWER.th0 已回默认");
});

// ================================================================ B. 存档往返
/** B 组共享:造档(数百 tick + 手工入包一件 roll 装备)→ toDict。
 *  view 不注入(battleTick 不读 view);save() 无 hooks 为 no-op → 纯内存。 */
function makeSaveDict(): Record<string, any> {
  const g = new Game(20260930);
  g.chooseClass("warrior");
  for (let i = 0; i < 800; i++) {
    g.tick(0.1);
    if (i % 50 === 0) g.events.length = 0;
  }
  g.bag.unshift(rollItem(12, new PyRandom(424242)));
  return g.toDict();
}

let base: Record<string, any> = {};
check("B7 造档(数百 tick + rollItem 入包)→ validateSaveDict 无 error", () => {
  base = makeSaveDict();
  ok(Array.isArray(base.bag) && base.bag.length >= 1, "bag 应至少含手工入包的 1 件");
  const errs = errorsOf(validateSaveDict(base));
  eq(errs.length, 0, `error 数应为 0,实际 ${JSON.stringify(errs)}`);
});

check("B8 migrateSave 幂等:连跑两次字典不变", () => {
  const m1 = migrateSave(JSON.parse(JSON.stringify(base)));
  const s1 = JSON.stringify(m1);
  const m2 = migrateSave(m1);
  eq(JSON.stringify(m2), s1, "第二次迁移不应改动字典");
});

let edited: Record<string, any> = {};
check("B9 修改 gold/level、bag 追加合法装备、quests[0] 进度→仍无 error", () => {
  edited = JSON.parse(JSON.stringify(migrateSave(base)));
  edited.gold = 9_999_999;
  edited.level = 20;
  edited.bag.push(rollItem(30, new PyRandom(777)).toDict());
  edited.quests[0].progress = edited.quests[0].target;
  const errs = errorsOf(validateSaveDict(edited));
  eq(errs.length, 0, `error 数应为 0,实际 ${JSON.stringify(errs)}`);
});

check("B10 JSON 往返:fromDict→toDict 关键字段逐项相等", () => {
  const d2 = Game.fromDict(JSON.parse(JSON.stringify(edited))).toDict();
  eq(d2.gold, edited.gold, "gold");
  eq(d2.level, edited.level, "level");
  eq(d2.zone, edited.zone, "zone");
  eq(d2.stage, edited.stage, "stage");
  eq(d2.bag.length, edited.bag.length, "bag.length");
  deepEq(d2.quests, edited.quests, "quests 应逐项相等");
  deepEq(d2.equip, edited.equip, "equip 应逐项相等");
});

/** B11 单条破坏注入:必须产出对应 error 字段(§8.B field 形如 "bag.3.affixes.1.0") */
function expectErrorField(name: string, mutate: (d: Record<string, any>) => void,
                          field: string): void {
  check(name, () => {
    const c = JSON.parse(JSON.stringify(edited));
    mutate(c);
    const errs = errorsOf(validateSaveDict(c));
    ok(errs.some(i => i.field === field),
      `应产出 error 字段 ${field},实际 ${JSON.stringify(errs)}`);
  });
}
expectErrorField("B11 注入:class_id=\"hacker\"", d => { d.class_id = "hacker"; }, "class_id");
expectErrorField("B11 注入:bag 条目 rarity=\"divine\"", d => { d.bag[0].rarity = "divine"; }, "bag.0.rarity");
expectErrorField("B11 注入:quests[0].type=\"yolo\"", d => { d.quests[0].type = "yolo"; }, "quests.0.type");
expectErrorField("B11 注入:gear_rules_21=false", d => { d.gear_rules_21 = false; }, "gear_rules_21");
expectErrorField("B11 注入:遗物 effects=[[\"nope\",1]]",
  d => { d.relics[0] = { rarity: "rare", tier: 10, effects: [["nope", 1]], name: "x", skill_id: null }; },
  "relics.0.effects.0.0");

// ================================================================ C. 低危修复回归(面板/校验器细节)
check("C1 coerceInput:清空/纯空白拒绝(null),不静默置 0", () => {
  eq(coerceInput("", 1), null, "空串应拒绝");
  eq(coerceInput("   ", 1.5), null, "纯空白应拒绝");
  eq(coerceInput(" 12 ", 1), 12, "带空白的合法数字应规整通过");
  eq(coerceInput("x", 1), null, "非法数字应拒绝");
  eq(coerceInput("true", false), true, "布尔分支不受影响");
});

check("C2 main_id 合法集从 MAIN_ROLLS 现读(校验器不再手写字面量)", () => {
  const stats = [...new Set(SLOTS.flatMap(s => MAIN_ROLLS[s.id].map(m => m.stat)))];
  ok(stats.includes("atk"), `现读集合应含 atk,实际 ${JSON.stringify(stats)}`);
  const okDict = JSON.parse(JSON.stringify(edited));
  okDict.bag[0].main_id = "atk";
  ok(!errorsOf(validateSaveDict(okDict)).some(i => i.field === "bag.0.main_id"),
    "atk 应仍判合法");
  const badDict = JSON.parse(JSON.stringify(edited));
  badDict.bag[0].main_id = "haste";
  ok(errorsOf(validateSaveDict(badDict)).some(i => i.field === "bag.0.main_id"),
    "不在 MAIN_ROLLS 的 stat 应报 error");
});

check("C3 锁定规则②含数字段校验:THEMES.x.mobs.y 不再误锁", () => {
  ok(isLockedPath("THEMES.0.mobs.1.hp"), "数字下标路径仍应锁定");
  ok(!isLockedPath("THEMES.x.mobs.y.hp"), "非数字段路径不应命中规则②");
});

check("C4 MAIN_ROLLS 标签显示 stat 中文名而非数组下标", () => {
  const st = MAIN_ROLLS.weapon[0].stat;
  const lbl = leafLabel("MAIN_ROLLS.weapon.0.base");
  ok(lbl.includes(STAT_NAMES[st] ?? st),
    `标签应含 stat 中文名「${STAT_NAMES[st] ?? st}」,实际 ${lbl}`);
  ok(!/·\d+·/.test(lbl), `标签不应含裸下标,实际 ${lbl}`);
});

// ================================================================ 汇总(退出码契约:全过 0 / 任一 FAIL 非 0)
const total = pass + fail;
if (fail > 0) {
  console.log(`[ADMIN-SMOKE FAIL] ${pass}/${total}`);
  process.exit(1);
}
console.log(`[ADMIN-SMOKE PASS] ${total}/${total}`);
process.exit(0);
