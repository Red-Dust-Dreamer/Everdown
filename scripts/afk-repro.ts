/** 诊断脚本:复现"挂机时主线一直推、打不过也推"。
 *  场景 = Web 真实行为:前 30 分钟玩家在线(autopilot 代打技能/装备),
 *  之后纯挂机 4 小时零操作 —— Web 端没有 autopilot 的智能切模式,
 *  mode 只能手动按 F,所以挂机期间模式不会被切回/切走(除自动挂机保护)。
 */
import { Game } from "../src/core/game.ts";
import { View } from "../src/core/view.ts";
import { autopilot } from "../src/core/host.ts";
import * as systems from "../src/core/systems.ts";

const TICK = 0.1;
const WARMUP_SEC = 30 * 60;   // 在线活跃期
const AFK_SEC = 4 * 3600;     // 纯挂机 4 小时
const seed = Number(process.argv[2] ?? 20260930);

const g = new Game(seed);
g.view = new View();
g.chooseClass("warrior");

const frontier = () => (g.zone - 1) * 10 + (g.stage - 1);
let maxFrontier = 0;
let modeWas: string = g.mode;
let lastMark = -1;
let tailK = 0, tailD = 0, tailT = 0;

const total = WARMUP_SEC + AFK_SEC;
for (let t = 0; t < total; t += TICK) {
  g.tick(TICK);
  g.events.length = 0;
  if (t < WARMUP_SEC) autopilot(g, false);
  if (t >= WARMUP_SEC - TICK && t < WARMUP_SEC) {
    if (g.mode !== "push") g.setMode("push");  // 挂机前玩家停在推进模式
    console.log(`=== 挂机开始:第${g.zone}区·${g.stage}层 Lv${g.level} DPS=${g.theoreticalDps() | 0} ===`);
    tailT = t;
  }
  if (g.mode !== modeWas) {
    console.log(`[挂机 ${((t - WARMUP_SEC) / 60) | 0} 分] 模式自动切换 ${modeWas}→${g.mode} @ 第${g.zone}区·${g.stage}层`);
    modeWas = g.mode;
  }
  maxFrontier = Math.max(maxFrontier, frontier());
  // 末 30 分钟胜负统计
  if (t >= total - 1800 - TICK && t < total - 1800) { tailK = g.stats.kills; tailD = g.stats.deaths; }
  const mark = Math.floor(t / 600);
  if (mark !== lastMark && t >= WARMUP_SEC) {
    lastMark = mark;
    console.log(`挂机 ${String(((t - WARMUP_SEC) / 60) | 0).padStart(3)} 分 │ 第${g.zone}区·第${g.stage}层 (${g.mode}) │ 累计死亡 ${g.stats.deaths} │ 连败 ${g.deathsRow}`);
  }
}

const k = g.stats.kills - tailK, d = g.stats.deaths - tailD;
console.log(`\n=== 挂机 4h 结束 ===`);
console.log(`位置:第${g.zone}区·第${g.stage}层 (mode=${g.mode}) │ 深度最深到过 tier=${maxFrontier} (当前 tier=${frontier()})`);
console.log(`挂机期死亡: ${g.stats.deaths} 次(在线 30 分钟结束时为基线),末 30 分钟: ${k} 击杀 / ${d} 死亡 → 胜率 ${(k / Math.max(1, k + d) * 100) | 0}%`);
console.log(`连续死亡计数 deathsRow 当前 = ${g.deathsRow}(自动挂机保护阈值 = 2,从未触发则说明被击杀重置)`);

// 再模拟"切后台 2 小时"的离线补算(systems.resolve),看主线是否继续前推
const z0 = g.zone, s0 = g.stage;
systems.resolve(g, 2 * 3600);
console.log(`\n=== 切后台 2h 离线补算 ===`);
console.log(`第${z0}区·${s0}层 → 第${g.zone}区·${g.stage}层 (mode=${g.mode})`);
// 补算后回到前台实时打 60 秒,看真实胜负
let deaths60 = 0, kills60 = 0;
const dk = g.stats.kills, dd = g.stats.deaths;
for (let t = 0; t < 60; t += TICK) { g.tick(TICK); g.events.length = 0; }
kills60 = g.stats.kills - dk; deaths60 = g.stats.deaths - dd;
console.log(`回前台实时 60 秒:${kills60} 击杀 / ${deaths60} 死亡 @ 第${g.zone}区·第${g.stage}层`);
