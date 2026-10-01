/** 遗物 + 爬塔系统的快速冒烟测试(不进 tsconfig,由 node --experimental-strip-types 运行)。
 *
 *   node --experimental-strip-types scripts/test_tower.ts
 *
 * 覆盖:towerEnter 消耗钥匙 / battleTick 打死塔怪 → towerExit(true) 掉遗物 /
 * 存档 roundtrip(v5)/ 迁移 v4→v5 / 头目层保底稀有 / 战败退出 / addRelic 替换 /
 * refreshKeys / 以及与 Python 相同 seed 的 RNG 逐值对拍输出。
 */
import { Game, SAVE_VERSION, migrateSave } from "../src/core/game.ts";
import { battleTick } from "../src/core/combat.ts";
import { RARITY_IDX } from "../src/core/data.ts";
import { Relic, rollRelic, relicMods } from "../src/core/relics.ts";
import { refreshKeys, rollTowerDrop, towerGold, towerMonster, towerRelicTier } from "../src/core/tower.ts";
import { PyRandom } from "../src/core/rng.ts";
import { stripAnsi } from "../src/core/ansi.ts";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { pass++; console.log(`  ok: ${msg}`); }
  else { fail++; console.log(`  FAIL: ${msg}`); }
}

// ================================================================ 1) 进塔消耗钥匙
console.log("== 1) towerEnter:消耗钥匙并生成塔怪");
const g = new Game(42);
g.chooseClass("warrior");
ok(g.tower.keys === 3, `初始钥匙 3 (got ${g.tower.keys})`);
g.towerEnter(1);
ok(g.tower.keys === 2, `进入第1层后钥匙 3→2 (got ${g.tower.keys})`);
ok(g.inTower === true, "inTower = true");
ok(g.monster !== null, "monster 非 null");
ok(g.monster!.boss === false && !g.monster!.name.startsWith("塔·"), "第1层非头目");
ok(g.towerFloorSel === 1, "towerFloorSel = 1");
g.towerEnter(2);  // 在塔中 → 拒绝
ok(g.inTower && g.tower.keys === 2, "塔中重复进入被拒绝");

// ================================================================ 2) 打死塔怪 → 结算
console.log("== 2) battleTick 打死塔怪 → towerExit(true) 掉遗物");
let it = 0;
for (; g.inTower && it < 3000; it++) {
  g.tick(0.1);
  g.events.length = 0;
}
ok(!g.inTower, `战斗结束退出塔 (${it} ticks, game.time=${g.time.toFixed(1)}s)`);
ok(g.relics[0] !== null, `relics[0] 非 null:${g.relics[0] ? stripAnsi(g.relics[0].display()) : "null"}`);
if (g.relics[0]) {
  for (const line of g.relics[0].effectLines()) console.log("     " + stripAnsi(line));
  for (const e of g.relics[0].effects) {
    ok((g.hero[e.id] ?? -1) > 0, `遗物效果已折算进 hero.${e.id} = ${(g.hero[e.id] ?? -1).toFixed(2)}`);
  }
}
ok(g.tower.max_floor === 1, `maxFloor = 1 (got ${g.tower.max_floor})`);
ok(g.gold > 0, `获得金币 ${g.gold}`);
ok(g.stones === 2, `新高奖励 +2 重铸石 (got ${g.stones})`);

// 层数限制:未通过第 1 层前不能跳层
{
  const g2 = new Game(43);
  g2.chooseClass("warrior");
  g2.towerEnter(2);
  ok(g2.tower.keys === 3 && !g2.inTower, "max_floor=0 时不能直接进第 2 层");
}

// ================================================================ 3) 头目层保底稀有 + 秒杀结算
console.log("== 3) 头目层(第5层)min_idx=2 保底稀有");
const gb = new Game(44);
gb.chooseClass("warrior");
gb.tower.max_floor = 4;
gb.towerEnter(5);
ok(gb.monster !== null && gb.monster.boss === true, "第5层为头目");
ok(gb.monster!.name.startsWith("塔·"), `头目名带前缀:${gb.monster!.name}`);
gb.monster!.hp = 0;               // 直接把血打到 0,用 battleTick 触发击杀结算
battleTick(gb, 0.1);
ok(!gb.inTower, "击杀头目后退出塔");
ok(gb.relics[0] !== null && RARITY_IDX[gb.relics[0]!.rarity] >= 2,
  `头目掉落 ≥ 稀有 (${gb.relics[0]?.rarity})`);
ok(gb.tower.max_floor === 5, `maxFloor = 5 (got ${gb.tower.max_floor})`);

// ================================================================ 4) 战败退出
console.log("== 4) 塔内战败 → towerExit(false)");
const gd = new Game(45);
gd.chooseClass("warrior");
gd.tower.max_floor = 19;
gd.towerEnter(20);
ok(gd.inTower, "进入第20层(高强度)");
let dit = 0;
for (; gd.inTower && dit < 3000; dit++) {
  gd.tick(0.1);
  gd.events.length = 0;
}
ok(!gd.inTower, `战败退出塔 (${dit} ticks)`);
ok(gd.relics.every(r => r === null), "战败不掉遗物");
ok(gd.tower.max_floor === 19, "max_floor 不变");
ok(gd.respawnTimer > 0, `复活倒计时 ${gd.respawnTimer}`);
ok(gd.stats.deaths === 0, "塔内战败不走 retreatStage → deaths 不计(与 Python 一致)");

// ================================================================ 5) 存档 roundtrip (v5)
console.log("== 5) 存档 roundtrip(SAVE_VERSION 5)");
const d = g.toDict();
ok(d.version === 5, `toDict.version = ${d.version} (SAVE_VERSION=${SAVE_VERSION})`);
ok(Array.isArray(d.relics) && d.relics.length === 4 && d.relics[0] !== null,
  "存档含 relics 数组(槽0 非空)");
ok(d.tower && d.tower.keys === 2 && d.tower.max_floor === 1,
  `存档含 tower (keys=${d.tower?.keys}, max_floor=${d.tower?.max_floor})`);
const g3 = Game.fromDict(d);
ok(g3.relics[0] !== null
  && JSON.stringify(g3.relics[0]!.toDict()) === JSON.stringify(g.relics[0]!.toDict()),
  "读档后 relics[0] 完全一致");
ok(g3.tower.keys === g.tower.keys && g3.tower.max_floor === g.tower.max_floor
  && g3.tower.last_refresh === g.tower.last_refresh, "读档后 tower 状态一致");
ok((g3.hero[g3.relics[0]!.effects[0].id] ?? 0) > 0, "读档后遗物效果重新折算进 hero");

// 迁移 v4 → v5
const d4 = JSON.parse(JSON.stringify(d));
delete d4.relics;
delete d4.tower;
d4.version = 4;
const d5 = migrateSave(d4);
ok(d5.version === 5 && Array.isArray(d5.relics) && d5.relics.every((r: any) => r === null)
  && d5.tower.keys === 3 && d5.tower.max_floor === 0, "v4 → v5 迁移补齐 relics/tower");

// ================================================================ 6) addRelic 满槽替换 / 卸下
console.log("== 6) addRelic 满槽替换效果最少 + unequipRelic");
const gr = new Game(46);
gr.chooseClass("warrior");
const mk = (n: number, cnt: number, name: string) =>
  new Relic("rare", 10, Array.from({ length: cnt }, (_, i) =>
    ({ id: ["goldfind", "skill_dmg", "crit_extra"][i], val: 5 + n + i })), name);
gr.addRelic(mk(1, 3, "A"));
gr.addRelic(mk(2, 3, "B"));
gr.addRelic(mk(3, 1, "C"));   // 只有 1 条效果 → 最差
gr.addRelic(mk(4, 3, "D"));
ok(gr.relics.every(r => r !== null), "4 槽装满");
const fifth = mk(5, 2, "E");
gr.addRelic(fifth);
ok(gr.relics[2] === fifth, "第5件替换效果最少的槽3");
ok(gr.relics.map(r => r!.name).join(",") === "A,B,E,D", `槽序 A,B,E,D (got ${gr.relics.map(r => r!.name)})`);
const gfBefore = gr.hero.goldfind;
gr.unequipRelic(0);
ok(gr.relics[0] === null && gr.hero.goldfind < gfBefore, "unequipRelic(0) 生效且属性回落");

// ================================================================ 7) refreshKeys
console.log("== 7) refreshKeys 每日刷新");
const TS0 = 1760000000;  // 固定时间戳,与 Python 对拍
const st = { keys: 0, max_floor: 0, last_refresh: null as string | null };
ok(refreshKeys(st, TS0) === 3 && st.keys === 3, "首次刷新 → 3 把");
ok(refreshKeys(st, TS0 + 3600) === 0, "同日再刷 → 0");
ok(refreshKeys(st, TS0 + 86400 * 2) === 6 && st.keys === 9, "隔 2 天 → +6(可囤积)");
const cap = { keys: 99, max_floor: 0, last_refresh: "2020-01-01" };
ok(refreshKeys(cap, TS0) === 0 && cap.keys === 99, "已满 99 → 不超发(首刷分支才会重置为 3)");

// ================================================================ 8) 与 Python 同 seed 的 RNG 对拍数据
console.log("== 8) RNG 对拍数据(与 scripts/test_tower_dump.py 输出 diff)");
const r6 = (v: number) => v.toFixed(6);
const m7 = towerMonster(7, new PyRandom(42));
console.log(`MON 7 ${m7.name} ${r6(m7.hp)} ${r6(m7.atk)} ${r6(m7.def_)} ${m7.boss} ${m7.tier}`);
const m5 = towerMonster(5, new PyRandom(42));
console.log(`MON 5 ${m5.name} ${r6(m5.hp)} ${r6(m5.atk)} ${r6(m5.def_)} ${m5.boss} ${m5.tier}`);
const rr = rollRelic(10, new PyRandom(7), 0);
console.log(`REL 10 0 ${rr.rarity} ${rr.name} ${rr.effects.map(e => `${e.id}:${r6(e.val)}`).join(" ")}`);
const rr2 = rollRelic(20, new PyRandom(9), 2);
console.log(`REL 20 2 ${rr2.rarity} ${rr2.name} ${rr2.effects.map(e => `${e.id}:${r6(e.val)}`).join(" ")}`);
const td = rollTowerDrop(15, new PyRandom(31), 0);
console.log(`DROP 15 ${td.rarity} ${td.tier} ${td.name} ${td.effects.map(e => `${e.id}:${r6(e.val)}`).join(" ")}`);
console.log(`TIER ${towerRelicTier(1)} ${towerRelicTier(10)} ${towerRelicTier(11)} ${towerRelicTier(37)}`);
console.log(`GOLD ${r6(towerGold(1))} ${r6(towerGold(15))}`);
console.log(`MODS ${relicMods([td, null]).map(m => `${m.stat}:${m.op}:${r6(m.v)}`).join(" ")}`);

console.log(`\n==== 结果: ${pass} 通过, ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
