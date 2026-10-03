/** 快进生成演示存档(商店截图用):核心无头跑 N 小时,输出 toDict JSON。
 * 用法: node --experimental-strip-types scripts/mk_demo_save.ts [小时数,默认3]
 * 产物: store-assets/demo-save.json → 浏览器 localStorage['abyss_save_v2']
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Game } from "../src/core/game.ts";
import { View } from "../src/core/view.ts";
import { autopilot } from "../src/core/host.ts";

const hours = Number(process.argv[2] ?? 3);
const TICK = 0.1;

const g = new Game(20260930);
g.view = new View();
g.chooseClass("warrior");
const steps = Math.trunc(hours * 3600 / TICK);
for (let i = 0; i < steps; i++) {
  g.tick(TICK);
  g.events.length = 0;
  autopilot(g, true);
}

const out = path.resolve(import.meta.dirname!, "..", "store-assets", "demo-save.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(g.toDict()));
console.log(`快进 ${hours}h → Lv.${g.level} 第${g.zone}区·${g.stage}层 击杀${g.stats.kills} ` +
  `金币${Math.round(g.gold)} 背包${g.bag.length} 遗物${g.relics.filter(Boolean).length}`);
console.log("已写入", out);
