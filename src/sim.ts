/** 平衡模拟/对拍:与 abyss/main.py run_sim 输出逐行一致 */
import { Game } from "./core/game.ts";
import { View } from "./core/view.ts";
import { autopilot } from "./core/host.ts";
import { fmt, fmtTime, c, pad } from "./core/ansi.ts";
import { renderFrame } from "./core/render.ts";

const TICK = 0.1;
const DEFAULT_SEED = 20260930;

export function runSim(seconds: number, verbose = true, seed = DEFAULT_SEED,
                       cls = "warrior"): number {
  const g = new Game(seed);
  g.view = new View();
  g.chooseClass(cls);
  const steps = Math.trunc(seconds / TICK);
  const marks = new Set<number>();
  for (let i = 0; i < steps; i++) {
    g.tick(TICK);
    g.events.length = 0;
    autopilot(g, true);
    const m = Math.trunc(g.time / 60);
    if (m && i % 100 === 0 && !marks.has(m)) {
      marks.add(m);
      if (verbose) {
        const line = "  " + pad(fmtTime(g.time), 6, "right")
          + " │ Lv" + pad(String(g.level), 3, "left")
          + ` │ 第${g.zone}区·${g.stage}层`
          + " │ 击杀" + pad(String(g.stats.kills), 6, "left")
          + " │ 死亡" + pad(String(g.stats.deaths), 4, "left")
          + ` │ 金币${fmt(g.gold)} │ DPS ${fmt(g.theoreticalDps())}`;
        console.log(line);
      }
    }
  }
  if (verbose) console.log();
  return 0;
}

export function runDemo(seconds = 30, seed = DEFAULT_SEED): number {
  const g = new Game(seed);
  const view = new View();
  g.view = view;
  const steps = Math.trunc(seconds / TICK);
  let tab = 0;
  for (let i = 0; i < steps; i++) {
    g.tick(TICK);
    view.drain(g);
    view.tick(TICK);
    if (i % 20 === 0) {
      view.ui.tab = tab % 7;
      tab++;
    }
    autopilot(g);
    if (i % 100 === 99) renderFrame(g, 100, 30);
  }
  renderFrame(g, 100, 30);
  for (let t = 0; t < 7; t++) {
    view.ui.tab = t;
    renderFrame(g, 100, 30);
  }
  view.ui.help = true;
  renderFrame(g, 100, 30);
  view.ui.help = false;
  g.pendingOffline = {
    sec: 3600, kills: 900, gold: 12345, xp: 8888,
    items: g.bag.slice(0, 4), deaths: 0, levels: 0, zones: 0,
  };
  renderFrame(g, 100, 30);
  console.log(c("[DEMO PASS]", "bright_green"));
  console.log(`  模拟时长 ${fmtTime(seconds)} │ Lv.${g.level} │ 第${g.zone}区·${g.stage}层 `
    + `│ 击杀 ${g.stats.kills} │ 头目 ${g.stats.boss_kills} │ 死亡 ${g.stats.deaths}`);
  return 0;
}

// ---------------------------------------------------------------- CLI
const args = process.argv.slice(2);
function argVal(flag: string): number | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = parseFloat(args[i + 1]);
  return isNaN(v) ? null : v;
}

const isMain = process.argv[1]?.replaceAll("\\", "/").endsWith("sim.ts");
if (isMain) {
  if (args.includes("--demo")) {
    process.exit(runDemo(argVal("--demo") ?? 30, argVal("--seed") ?? DEFAULT_SEED));
  }
  const simSec = argVal("--sim") ?? (args.includes("--sim") ? 1800 : null);
  if (simSec !== null) {
    const clsIdx = args.indexOf("--cls");
    const cls = clsIdx >= 0 ? args[clsIdx + 1] : "warrior";
    process.exit(runSim(simSec, true, argVal("--seed") ?? DEFAULT_SEED, cls));
  }
  console.log("用法: node --experimental-strip-types src/sim.ts --sim 600 --seed N --cls warrior|mage|ranger | --demo 60");
}
