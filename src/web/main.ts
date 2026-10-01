// 深渊挂机 · Vite 网页宿主:TS 同构核心 + xterm.js,纯静态构建(无 Pyodide,秒开)。
// 行为对齐 web/legacy(P1 网页版)与 abyss/main.py(CLI):tick / key / frame / save。
/// <reference lib="dom" />

import type { KeyResult } from "../core/host.ts";

// ---------------------------------------------------------------- xterm UMD 全局
// index.html 以 <script src="/vendor/xterm/..."> 本地引入(不走 CDN)。
interface ITermOptions {
  fontFamily: string;
  fontSize: number;
  cursorBlink: boolean;
  cursorStyle: string;
  allowProposedApi: boolean;
  scrollback: number;
  convertEol: boolean;
}
interface ITerminal {
  readonly cols: number;
  readonly rows: number;
  options: { fontSize: number };
  open(parent: HTMLElement): void;
  loadAddon(addon: unknown): void;
  write(data: string): void;
  onData(cb: (data: string) => void): void;
}
interface IFitAddon {
  fit(): void;
}
declare global {
  interface Window {
    Terminal: new (options: ITermOptions) => ITerminal;
    FitAddon: { FitAddon: new () => IFitAddon };
    __abyss?: { state(): string };
  }
}

// ---------------------------------------------------------------- 常量 / 工具
const SAVE_KEY = "abyss_save_v2";
const TICK = 0.1;            // 游戏固定步长(秒),与 CLI 宿主一致
const MAX_STEPS = 10;        // 单帧最多补 10 步
const AUTOSAVE_MS = 10_000;  // 定期自动存档
const RESOLVE_MIN_SEC = 30;  // 页面离开超过该秒数才懒结算补算

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const toastEl = $("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

// ---------------------------------------------------------------- 启动
async function boot(): Promise<void> {
  // 核心是本地 TS,动态 import 即整个核心模块图;遮罩一闪即隐。
  const [{ installSaveHooks, Game, migrateSave }, { View },
         { renderFrame }, { handleKey }, systems] = await Promise.all([
    import("../core/game.ts"),
    import("../core/view.ts"),
    import("../core/render.ts"),
    import("../core/host.ts"),
    import("../core/systems.ts"),
  ]);

  // 存档 IO 注入:localStorage(与旧版网页 / web/app 共用同一存档键)
  installSaveHooks({
    write: (g) => localStorage.setItem(SAVE_KEY, JSON.stringify(g.toDict())),
    readRaw: () => localStorage.getItem(SAVE_KEY),
  });

  let g = Game.load();       // 读取存档(含离线结算)或开新档
  const view = new View();
  g.view = view;

  // ---------------- 终端
  const term = new window.Terminal({
    fontFamily: '"AbyssMono", monospace',
    fontSize: 16,
    cursorBlink: false,
    cursorStyle: "bar",
    allowProposedApi: true,
    scrollback: 0,
    convertEol: false,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($("term"));

  // ---------------- 自适应字号:小屏逐级降字号,塞下 100×30 画布为止
  // (触屏手机横屏 ~844×390 → 8~9px 可容纳;竖屏塞不下 → 提示横屏)
  const MIN_COLS = 100, MIN_ROWS = 30;
  const FONT_LADDER = [16, 14, 12, 11, 10, 9, 8];
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add("touch");
  const hintEl = $("viewport-hint");

  function fitFontSize(): void {
    try { fit.fit(); } catch { /* 容器未就绪 */ }
    if (term.cols >= MIN_COLS && term.rows >= MIN_ROWS) {
      hintEl.classList.remove("show");
      return;
    }
    for (const size of FONT_LADDER) {
      term.options.fontSize = size;
      try { fit.fit(); } catch { /* ignore */ }
      if (term.cols >= MIN_COLS && term.rows >= MIN_ROWS) {
        hintEl.classList.remove("show");
        return;
      }
    }
    hintEl.classList.add("show"); // 到 8px 仍放不下(竖屏)→ 提示横屏
  }
  fitFontSize();

  term.write("\x1b[2J\x1b[H\x1b[?25l\x1b[?7l");   // 清屏 + 藏光标 + 关自动换行
  $("loading").classList.add("hide");

  // ---------------- 帧循环:rAF 驱动渲染,游戏按 0.1s 步进(与 CLI 宿主一致)。
  // rAF 在页面隐藏时停摆 → 游戏冻结;回切时用 resolve() 懒结算补算离开期间,
  // 与"关闭页面再打开"的离线结算同一路径,后台时间不丢失。
  let running = true;
  let saveTimer: ReturnType<typeof setInterval> | undefined;
  let hiddenAt = 0;
  let last = performance.now();
  let acc = 0;

  function step(): void {
    if (!view.ui.paused) g.tick(TICK);   // 暂停时不 tick,游戏时钟随之冻结
    view.drain(g);
    view.tick(TICK);
  }

  function loop(now: number): void {
    if (!running) return;
    acc += Math.min(1000, now - last) / 1000;   // 秒
    last = now;
    if (acc > 1) acc = 0;                        // 挂起残余:丢弃
    let steps = 0;
    while (acc >= TICK && steps < MAX_STEPS) {   // 每 0.1s 推进一步
      step();
      acc -= TICK;
      steps += 1;
    }
    term.write("\x1b[H" + renderFrame(g, term.cols, term.rows) + "\x1b[0m");
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function shutdown(msg: string): void {
    running = false;
    if (saveTimer !== undefined) clearInterval(saveTimer);
    try { g.save(); } catch { /* 退出时的存档异常忽略 */ }
    term.write("\x1b[?25h\x1b[?7h\x1b[0m\n\r\n" + msg + "\r\n");
  }

  // ---------------- 键映射(与旧版一致)
  function mapKey(data: string): string {
    switch (data) {
      case "\x1b[A": return "up";
      case "\x1b[B": return "down";
      case "\x1b[D": return "left";
      case "\x1b[C": return "right";
      case "\r": case "\n": return "enter";
      case "\x1b": return "esc";
      case "\x03": return "quit";
    }
    return data.toLowerCase();
  }

  term.onData((data) => {
    if (!running) return;
    const key = mapKey(data);
    if (!key) return;
    const r: KeyResult = handleKey(g, key);
    if (r === false) {
      shutdown("已退出,存档已保存。刷新页面继续。");
    } else if (r === "reset") {
      localStorage.removeItem(SAVE_KEY);
      g = new Game();
      g.view = view;
      g.log("存档已重置,新的冒险开始。", "bright_red");
      term.write("\x1b[2J\x1b[H");
    }
  });

  // ---------------- 虚拟按键栏(触屏):直接复用 handleKey,与键盘同一入口
  function pressKey(key: string): void {
    if (!running) return;
    const r: KeyResult = handleKey(g, key);
    if (r === false) {
      shutdown("已退出,存档已保存。刷新页面继续。");
    } else if (r === "reset") {
      localStorage.removeItem(SAVE_KEY);
      g = new Game();
      g.view = view;
      g.log("存档已重置,新的冒险开始。", "bright_red");
      term.write("\x1b[2J\x1b[H");
    }
  }
  if (isTouch) {
    const pad = $("pad");
    const row1: [string, string, string][] = [
      ["1", "1", "k-num"], ["2", "2", "k-num"], ["3", "3", "k-num"],
      ["4", "4", "k-num"], ["5", "5", "k-num"], ["6", "6", "k-num"],
      ["7", "7", "k-num"], ["f", "F", "k-act"], ["p", "⏸", "k-sys"], ["h", "?", "k-sys"],
    ];
    const row2: [string, string, string][] = [
      ["up", "↑", "k-nav"], ["down", "↓", "k-nav"], ["left", "←", "k-nav"], ["right", "→", "k-nav"],
      ["e", "E装", "k-act"], ["u", "U升", "k-act"], ["x", "X售", "k-act"],
      ["d", "D解", "k-act"], ["a", "A清", "k-act"], ["r", "R铸", "k-act"], ["s", "S档", "k-sys"],
    ];
    for (const defs of [row1, row2]) {
      const row = document.createElement("div");
      row.className = "row";
      for (const [key, label, cls] of defs) {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.className = cls;
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          pressKey(key);
        });
        row.appendChild(btn);
      }
      pad.appendChild(row);
    }
  }

  // ---------------- 尺寸自适应(含字号重算)
  window.addEventListener("resize", () => {
    if (running) fitFontSize();
  });

  // ---------------- 存档:visibilitychange / pagehide / 定期
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      g.save();                                  // 离开即存档
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();                  // 重置计时,避免瞬间大积压
      acc = 0;
      if (away >= RESOLVE_MIN_SEC) {             // 补算离开期间(懒结算,resolve 内已按 12h 封顶)
        const rep = systems.resolve(g, away);
        g.toast(`页面离开 ${Math.trunc(away / 60)} 分:补算 ${rep.kills} 击杀 +${rep.gold} 金币`);
      }
      g.save();
    }
  });
  window.addEventListener("pagehide", () => {
    if (running) g.save();
  });
  saveTimer = setInterval(() => {
    if (running && !document.hidden) g.save();
  }, AUTOSAVE_MS);

  // ---------------- 调试钩子:控制台 __abyss.state() 验证游戏推进
  window.__abyss = {
    state: () => `t=${g.time | 0}s Lv${g.level} ${g.zone}区 kills=${g.stats.kills}`,
  };

  // ---------------- 顶栏按钮
  $("btn-save").onclick = () => {
    if (!running) { toast("游戏已退出,刷新页面继续"); return; }
    g.save();
    toast("已存档到浏览器");
  };

  $("btn-export").onclick = () => {
    const blob = new Blob([JSON.stringify(g.toDict())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "abyss-idle-save.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("存档已导出");
  };

  $("btn-import").onclick = () => $("file-input").click();
  $("file-input").onchange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files && input.files[0];
    if (!f) return;
    void f.text().then((txt) => {
      if (!running) return;
      try {
        const d = migrateSave(JSON.parse(txt) as Record<string, unknown>);
        g = Game.fromDict(d);            // 替换游戏实例并立即保存
        g.view = view;
        g.save();
        g.toast(`导入成功:Lv.${g.level} 第${g.zone}区·${g.stage}层`);
        term.write("\x1b[2J\x1b[H");
      } catch {
        toast("导入失败,格式不正确");
      }
    });
    input.value = "";
  };

  $("btn-reset").onclick = () => {
    if (!confirm("确定清空浏览器存档并重新开始?")) return;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  };

  // ---------------- PWA:注册 Service Worker(离线可玩/可安装)
  // 路径跟随 vite base(本地 / 或 GitHub Pages /Everdown/);dev(8614)跳过,
  // 避免缓存 vite 开发资产导致改动不生效。
  if (location.port !== "8614" && "serviceWorker" in navigator) {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";
    navigator.serviceWorker.register(base + "sw.js")
      .catch(() => { /* 离线壳降级:在线玩 */ });
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  toast("加载失败:" + String(err));
});
