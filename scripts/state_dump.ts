/** TS 版状态转储(与 scripts/state_dump.py 对拍;字段名/键序以 Python 版为基准)。
 *
 * 用法:
 *   node --experimental-strip-types scripts/state_dump.ts                       # 30s 默认
 *   node --experimental-strip-types scripts/state_dump.ts --sim 30 --seed 20260930 --cls warrior
 *
 * 与 src/sim.ts runSim 同构:new Game(seed).chooseClass(cls),循环
 * g.tick(0.1) → g.events.length = 0 → autopilot(g, true)(autopilot 在 src/core/host.ts);
 * 循环中点强制 level=rebirth_min_level 并 rebirth() 一次(覆盖转生状态与重置语义,
 * scripts/state_dump.py 同规格)。
 * 输出 = g.toDict() + hero 摘要(保留 4 位小数),剔除 last_saved,
 * 键递归排序(对齐 Python json.dumps(sort_keys=True)),indent=2。
 * TS 侧 saveHooks 未注入,autosave 为空操作,不会写任何存档文件。
 */
import { Game } from "../src/core/game.ts";
import { autopilot } from "../src/core/host.ts";
import { BAL } from "../src/core/data.ts";

const TICK = 0.1;
const HERO_KEYS = ["hp", "atk", "def", "max_hp", "interval", "haste", "crit", "crit_dmg"] as const;

/** 与 Python round(v, 4) 对齐的 4 位小数(数值允许微小偏差,仅结构要求一致) */
function round4(v: number): number {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/** 递归按键排序,使 JSON.stringify 的键序与 Python sort_keys=True 一致 */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return v;
}

function buildDump(g: Game): Record<string, unknown> {
  const d: Record<string, unknown> = { ...g.toDict() };
  delete d.last_saved; // 宿主时间戳,非游戏状态
  const hero: Record<string, number> = {};
  for (const k of HERO_KEYS) hero[k] = round4(g.hero[k] ?? 0);
  d.hero = hero;
  // loadout / skill_lv 已含于 toDict(snake_case)
  return d as Record<string, unknown>;
}

// ---------------------------------------------------------------- CLI
const args = process.argv.slice(2);
function argVal(flag: string): number | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = parseFloat(args[i + 1]);
  return isNaN(v) ? null : v;
}

const seconds = argVal("--sim") ?? 30;
const seed = argVal("--seed") ?? 20260930;
const clsIdx = args.indexOf("--cls");
const cls = clsIdx >= 0 ? args[clsIdx + 1] : "warrior";

const g = new Game(seed);
g.chooseClass(cls);
const steps = Math.trunc(seconds / TICK);
const rebirthAt = Math.trunc(steps / 2);   // 中点强制转生一次(双端同规格)
for (let i = 0; i < steps; i++) {
  if (i === rebirthAt) {
    g.level = BAL.rebirth_min_level;   // 直接达成门槛(确定性,不吃随机)
    g.rebirth();
  }
  g.tick(TICK);
  g.events.length = 0;
  autopilot(g, true);
}

console.log(JSON.stringify(sortKeys(buildDump(g)), null, 2));
