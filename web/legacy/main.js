// 深渊挂机 · 网页宿主(P1:xterm.js 怀旧模式)
// 结构与 CLI 宿主(abyss/main.py)一一对应:tick / key / frame / save。
// 优先使用本地 vendor 的 Pyodide(离线可玩、加载快);目录不存在时回退 CDN。
const VENDOR = "./vendor/pyodide/";
const CDN = "https://unpkg.com/pyodide@0.26.4/";
let PYODIDE_URL = VENDOR + "pyodide.mjs";
let PYODIDE_INDEX = VENDOR;
const MODULES = ["__init__", "ansi", "data", "items", "skills", "combat",
                 "systems", "view", "game", "render", "main"];

const $ = (id) => document.getElementById(id);
const loadingMsg = $("loading-msg");

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1800);
}

// ---------------------------------------------------------------- 终端
const term = new Terminal({
  fontFamily: '"AbyssMono", monospace',
  fontSize: 16,
  cursorBlink: false,
  cursorStyle: "bar",
  allowProposedApi: true,
  scrollback: 0,
  convertEol: false,
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($("term"));
try { fit.fit(); } catch (e) { /* 布局未稳定时忽略 */ }

// ---------------------------------------------------------------- 键映射
function mapKey(data) {
  switch (data) {
    case "\x1b[A": return "up";
    case "\x1b[B": return "down";
    case "\x1b[D": return "left";
    case "\x1b[C": return "right";
    case "\r": case "\n": return "enter";
    case "\x1b": return "esc";
    case "\x03": return "quit";
  }
  return data.length === 1 ? data.toLowerCase() : data.toLowerCase();
}

// ---------------------------------------------------------------- 启动
let py = null;          // pyodide 命名空间(bridge 函数代理)
let running = false;
let saveTimer = null;

async function loadCore(pyodide) {
  // 把 abyss 包写入 Pyodide 虚拟文件系统,再 import
  pyodide.FS.mkdirTree("/abyss");
  for (const m of MODULES) {
    const src = await (await fetch(`/abyss/${m}.py?v=4`)).text();
    pyodide.FS.writeFile(`/abyss/${m}.py`, src, { encoding: "utf8" });
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/')");
  const bridge = await (await fetch("abyss_bridge.py")).text();
  pyodide.runPython(bridge);
  // 逐个取出 bridge 暴露的函数代理
  py = {};
  for (const fn of ["boot", "frame", "tick", "key", "get_save",
                    "save_now", "import_save", "debug_state", "resolve_gap"]) {
    py[fn] = pyodide.globals.get(fn);
  }
}

async function main() {
  loadingMsg.textContent = "正在检测运行时…";
  // vendor 不可用时回退到 CDN
  try {
    const probe = await fetch(VENDOR + "pyodide.asm.wasm", { method: "HEAD" });
    if (!probe.ok) throw new Error("no vendor");
  } catch (e) {
    PYODIDE_URL = CDN + "pyodide.mjs";
    PYODIDE_INDEX = CDN;
  }
  loadingMsg.textContent = "正在加载 Python 运行时(首次约 10MB)…";
  const { loadPyodide } = await import(PYODIDE_URL);
  loadingMsg.textContent = "正在编织深渊…";
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
  await loadCore(pyodide);

  loadingMsg.textContent = "正在读取存档…";
  py.boot();
  fit.fit();

  term.write("\x1b[2J\x1b[?25l\x1b[?7l");   // 清屏 + 藏光标 + 关自动换行
  $("loading").classList.add("hide");
  running = true;

  // 帧循环:rAF 驱动渲染,游戏按 0.1s 步进(与 CLI 宿主一致)。
  // rAF 在页面隐藏时停摆 → 游戏冻结;回切时用 resolve() 懒结算补算离开期间,
  // 与"关闭页面再打开"的离线结算同一路径,后台时间不丢失。
  let last = performance.now();
  let acc = 0;
  let hiddenAt = 0;
  function loop(now) {
    if (!running) return;
    acc += Math.min(1000, now - last) / 1000;   // 秒
    last = now;
    if (acc > 1) acc = 0;                        // 挂起残余:丢弃
    let steps = 0;
    while (acc >= 0.1 && steps < 10) {           // 每 0.1s 推进一步
      py.tick(0.1);
      acc -= 0.1;
      steps += 1;
    }
    term.write(py.frame(term.cols, term.rows) + "\x1b[0m");
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      py.save_now();                             // 离开即存档
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();                  // 重置计时,避免瞬间大积压
      if (away >= 30) py.resolve_gap(away);      // 补算离开期间(懒结算)
      py.save_now();
    }
  });
  window.addEventListener("pagehide", () => py.save_now());
  // 定期自动存档
  saveTimer = setInterval(() => {
    if (!document.hidden) py.save_now();
  }, 10000);

  // 调试钩子:控制台可查 __abyss.state() 验证游戏在推进
  window.__abyss = {
    state: () => py.debug_state ? py.debug_state() : "n/a",
  };

  // 输入
  term.onData((data) => {
    const k = mapKey(data);
    if (!k) return;
    const keep = py.key(k);
    if (keep === false) shutdown("已退出,存档已保存。刷新页面继续。");
  });

  // 尺寸自适应
  window.addEventListener("resize", () => {
    fit.fit();
  });

  bindButtons();
}

function shutdown(msg) {
  running = false;
  clearInterval(saveTimer);
  try { py.save_now(); } catch (e) {}
  term.write("\x1b[?25h\x1b[?7h\x1b[0m\n\r\n" + msg + "\r\n");
}

// ---------------------------------------------------------------- 按钮
function bindButtons() {
  $("btn-save").onclick = () => { py.save_now(); toast("已存档到浏览器"); };
  $("btn-export").onclick = () => {
    const blob = new Blob([py.get_save()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "abyss-idle-save.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("存档已导出");
  };
  $("btn-import").onclick = () => $("file-input").click();
  $("file-input").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      const ok = py.import_save(txt);
      toast(ok ? "导入成功" : "导入失败,格式不正确");
      term.write("\x1b[2J");
    });
    e.target.value = "";
  };
  $("btn-reset").onclick = () => {
    if (!confirm("确定清空浏览器存档并重新开始?")) return;
    localStorage.removeItem("abyss_save_v2");
    location.reload();
  };
}

main().catch((e) => {
  loadingMsg.textContent = "加载失败:" + e + " (需要联网加载运行时,且必须通过 http:// 访问)";
  console.error(e);
});
