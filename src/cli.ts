/** Node CLI 宿主:终端初始化 / 输入 / 主循环(行为对齐 abyss/main.py 的 run_interactive)。
 *
 * 核心零平台依赖:存档 IO 由 installSaveHooks 注入(文件版),按键分发走 host.handleKey。
 * 测试钩子:ABYSS_TEST_TICKS=N 时不同步真实时间,直接跑 N 个 tick 后输出一帧并退出。
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Game, installSaveHooks } from "./core/game.ts";
import { View } from "./core/view.ts";
import { renderFrame } from "./core/render.ts";
import { handleKey } from "./core/host.ts";
import { c } from "./core/ansi.ts";
import { applyOverrides, parseOverrideFile } from "./core/overrides.ts";

const TICK = 0.1;
const FRAME_MS = 100;          // 主循环节流:约 10fps
const MAX_CATCHUP = 10;        // 最多补 10 个固定步长(对齐 Python)
const SAVE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "save.json");
const OVR_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "overrides.json");

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DISABLE_WRAP = "\x1b[?7l";
const ENABLE_WRAP = "\x1b[?7h";
const CLEAR_SCREEN = "\x1b[2J";
const CURSOR_HOME = "\x1b[H";
const RESET = "\x1b[0m";
const FAREWELL = "已存档,再见!下次启动会结算离线收益。";

const out = process.stdout;

// ================================================================ 终端准备
/** Windows 下启用 VT 转义:spawn 一次 cmd.exe 会让控制台开启 ANSI 处理(Node 10+ 常用技巧)。 */
function enableVtMode(): void {
  if (process.platform === "win32") {
    try {
      spawnSync("cmd.exe", ["/c", ""], { stdio: "ignore" });
    } catch { /* 无法启用则按原样输出,Windows Terminal 下本就支持 */ }
  }
}

// ================================================================ 输入
/** 把原始字节流映射为符号名(对齐 abyss/main.py KeyReader._map):
 *  方向键 → up/down/left/right;\r → enter;\x1b → esc;\x03/\x04 → quit;其它单字符小写。 */
function mapChunk(s: string, queue: string[]): void {
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\x1b") {
      const seq = s.slice(i, i + 3);
      if (seq === "\x1b[A") { queue.push("up"); i += 3; }
      else if (seq === "\x1b[B") { queue.push("down"); i += 3; }
      else if (seq === "\x1b[D") { queue.push("left"); i += 3; }
      else if (seq === "\x1b[C") { queue.push("right"); i += 3; }
      else if (s[i + 1] === "[") { i += 3; } // 其它 CSI 序列:吞掉,不产生按键
      else { queue.push("esc"); i += 1; }
      continue;
    }
    if (ch === "\r" || ch === "\n") { queue.push("enter"); i += 1; continue; }
    if (ch === "\x03" || ch === "\x04") { queue.push("quit"); i += 1; continue; }
    queue.push(ch.toLowerCase());
    i += 1;
  }
}

// ================================================================ 数值覆盖
/** 启动时加载仓库根 overrides.json(docs/admin-panel.md §4.4):在第一次 Game.load()/
 *  new Game() 之前应用;applied/rejected 打 stderr(TUI 占用 stdout);文件格式非法
 *  (OverrideFormatError)时提示后按默认数值继续。对拍(sim.ts)不经过本入口。 */
function loadOverridesFile(): void {
  if (!fs.existsSync(OVR_PATH)) return;
  try {
    const result = applyOverrides(parseOverrideFile(fs.readFileSync(OVR_PATH, "utf8")));
    if (result.applied.length || result.rejected.length) {
      process.stderr.write(
        `[overrides] ${OVR_PATH}:应用 ${result.applied.length} 项,拒绝 ${result.rejected.length} 项\n`);
      for (const r of result.rejected) {
        process.stderr.write(`[overrides] 拒绝 ${r.path}(${r.reason})\n`);
      }
    }
  } catch (err) {
    process.stderr.write(
      `[overrides] overrides.json 解析失败:${err instanceof Error ? err.message : String(err)}\n` +
      "[overrides] 已忽略覆盖,按默认数值继续\n");
  }
}

// ================================================================ 交互主循环
function runInteractive(): void {
  loadOverridesFile();
  enableVtMode();
  installSaveHooks({
    write: g => fs.writeFileSync(SAVE_PATH, JSON.stringify(g.toDict()), "utf8"),
    readRaw: () => (fs.existsSync(SAVE_PATH) ? fs.readFileSync(SAVE_PATH, "utf8") : null),
  });

  out.write(HIDE_CURSOR + DISABLE_WRAP + CLEAR_SCREEN);

  let g = Game.load();
  g.towerRefreshKeys();   // 每日钥匙刷新(登录时一次,对齐 abyss/main.py)
  const view = new View();
  g.view = view;

  const keyQueue: string[] = [];
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf: Buffer) => mapChunk(buf.toString("utf8"), keyQueue));

  let running = true;
  const shutdown = (save = true): void => {
    if (!running) return;
    running = false;
    if (save) g.save();
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch { /* 忽略 */ } }
    process.stdin.pause();
    out.write(SHOW_CURSOR + ENABLE_WRAP + RESET + "\n");
    out.write(c(FAREWELL, "bright_cyan") + "\n");
    process.exit(0);
  };
  // 非 raw mode(如管道)下 Ctrl+C 走信号;raw mode 下已是 \x03 数据,不会触发
  process.on("SIGINT", () => shutdown());

  let last = performance.now();
  const loop = (): void => {
    if (!running) return;
    try {
      const now = performance.now();
      let realDt = (now - last) / 1000;
      last = now;

      while (keyQueue.length) {
        const result = handleKey(g, keyQueue.shift()!);
        if (result === "reset") {
          try { fs.rmSync(SAVE_PATH, { force: true }); } catch { /* 忽略 */ }
          g = new Game();
          g.view = view;
          g.log("存档已重置,新的冒险开始。", "bright_red");
          break;
        }
        if (result === false) { shutdown(); return; }
      }

      // 固定步长推进(暂停时不 tick,游戏时钟随之冻结)
      if (!view.ui.paused) {
        let steps = 0;
        while (realDt >= TICK && steps < MAX_CATCHUP) {
          g.tick(TICK);
          realDt -= TICK;
          steps += 1;
        }
        if (realDt < 0) realDt = 0;
      }

      view.drain(g);
      view.tick(0.1);

      const cols = out.columns ?? 120;
      const rows = out.rows ?? 30;
      out.write(CURSOR_HOME + renderFrame(g, cols, rows) + RESET);
    } catch (err) {
      shutdown();
      throw err;
    }
    setTimeout(loop, FRAME_MS);
  };
  loop();
}

// ================================================================ 测试钩子
/** ABYSS_TEST_TICKS=N:新档选职业(按键 1)、跑 N 个 tick、输出一帧后退出;不读写存档。
 *  ABYSS_TEST_KEYS=1:另走一次塔页按键流(8 切塔页 → enter 进塔),末帧切回塔页渲染,
 *  覆盖 tab=7 的键位分发与塔页/塔内战斗页渲染。 */
function runTestTicks(ticks: number): void {
  const g = new Game(20260930);
  const view = new View();
  g.view = view;
  handleKey(g, "1"); // 新档按键 1/2/3 选职业,这里走战士
  const towerTest = Number.parseInt(process.env.ABYSS_TEST_KEYS ?? "", 10) > 0;
  if (towerTest) {
    handleKey(g, "8");     // 切到塔页(tab=7)
    handleKey(g, "enter"); // 进塔:消耗 1 把钥匙,成功后自动切回战斗页
  }
  for (let i = 0; i < ticks; i++) {
    g.tick(TICK);
    view.drain(g);
    view.tick(TICK);
  }
  if (towerTest) handleKey(g, "8"); // 末帧渲染塔页(钥匙/选层/遗物区)
  out.write(renderFrame(g, 100, 30) + "\n");
}

// ================================================================ 入口
const testTicks = Number.parseInt(process.env.ABYSS_TEST_TICKS ?? "", 10);
if (Number.isFinite(testTicks) && testTicks > 0) {
  runTestTicks(testTicks);
} else {
  runInteractive();
}
