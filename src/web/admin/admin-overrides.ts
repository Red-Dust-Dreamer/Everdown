/// <reference lib="dom" />
/** 管理面板 · Tab2 数值覆盖:浏览/搜索 listOverridableLeaves() 全部叶子 →
 *  草稿(纯数据对象,不碰运行中模块)→「保存覆盖」同时写
 *  localStorage["abyss_admin_overrides_v1"](值=serializeOverrideFile 输出原文,
 *  契约 §7.E 钉死,不是裸 values)+ dev 桥写仓库根 overrides.json(CLI 用)。
 *  🔒锁定行与核心 R6 同清单双保险;⚠警示行提示 rng 序列分歧等后果。 */
import {
  applyOverrides, listOverridableLeaves, OverrideFormatError, overrideDiff,
  parseOverrideFile, resetOverrides, serializeOverrideFile,
  type OverrideValue, type OverrideValues,
} from "../../core/overrides.ts";
import { OVR_KEY, coerceInput, download, esc, toast, valTxt } from "./admin-dom.ts";
import { bridgeGetFile, bridgeOnline, bridgePostFile } from "./admin-bridge.ts";
import { CATEGORIES, categoryOf, categoryName, isLockedPath, leafLabel, warnText } from "./admin-meta.ts";

/** 面板加载时的默认值快照(任何 apply 之前;预览只临时改表,不回写这里) */
const baseLeaves: Record<string, OverrideValue> = listOverridableLeaves();
const allPaths = Object.keys(baseLeaves).sort();

/** 草稿:仅记录用户改过的路径 */
let draft: OverrideValues = {};
/** 已保存覆盖快照(localStorage + 服务器文件;预览采样后按它恢复,导出供 Tab3) */
let saved: OverrideValues = {};

let root: HTMLElement;
let listBox: HTMLElement;
let searchBar: HTMLInputElement;
let curCat = "all";
let curSearch = "";
let serverCount: boolean | null = null;  // null=无/未知,true=有,false=格式坏

export function draftValues(): OverrideValues {
  const out: OverrideValues = {};
  for (const [p, v] of Object.entries(draft)) {
    const base = baseLeaves[p];
    if (base === undefined || base !== v) out[p] = v;   // = 默认值的条目不落盘
  }
  return out;
}

export function savedValues(): OverrideValues { return saved; }

/** 重建「已保存覆盖」快照:localStorage 为主,桥可用时并入仓库根 overrides.json */
export async function refreshSaved(): Promise<void> {
  saved = {};
  const t = localStorage.getItem(OVR_KEY);
  if (t !== null) {
    try { Object.assign(saved, parseOverrideFile(t)); }
    catch (e) {
      toast(`localStorage 覆盖键解析失败(${(e as Error).name}),已忽略:${(e as Error).message}`);
    }
  }
  if (bridgeOnline()) {
    try {
      const r = await bridgeGetFile("overrides.json");
      if (r.exists && r.content !== null) {
        try { Object.assign(saved, parseOverrideFile(r.content)); serverCount = true; }
        catch { serverCount = false; }
      } else serverCount = null;
    } catch { serverCount = null; }
  }
}

export function initOv(rootEl: HTMLElement, sidebar: HTMLElement): void {
  root = rootEl;
  rootEl.innerHTML = `
    <div class="card" id="ov-bar"></div>
    <div class="card grow" style="overflow:auto">
      <table class="ov-table">
        <thead><tr><th>分类</th><th>路径</th><th>中文名</th><th>默认值</th>
          <th>当前值(草稿)</th><th>状态</th></tr></thead>
        <tbody id="ov-rows"></tbody>
      </table>
    </div>`;
  listBox = rootEl.querySelector("#ov-rows")!;

  // 左侧分类树(面板侧元数据,12 类)
  const tree = document.createElement("div");
  tree.style.display = "flex";
  tree.style.flexDirection = "column";
  const mk = (id: string, name: string) => {
    const n = document.createElement("div");
    n.className = "nav-item" + (id === curCat ? " on" : "");
    n.dataset.cat = id;
    n.innerHTML = `<span class="ic">▸</span><span class="tx">${esc(name)}</span>`;
    n.addEventListener("click", () => {
      curCat = id;
      tree.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("on", (x as HTMLElement).dataset.cat === id));
      renderRows();
    });
    return n;
  };
  tree.appendChild(mk("all", "全部"));
  for (const c of CATEGORIES) tree.appendChild(mk(c.id, c.name));
  sidebar.appendChild(tree);
  thisModule.sideTree = tree;

  renderBar();
  bindList();
  renderRows();
  void refreshSaved().then(renderBar);
}

const thisModule = {
  sideTree: null as HTMLElement | null,
  onTabShow(): void { this.sideTree?.style.setProperty("display", "flex"); },
  onTabHide(): void { this.sideTree?.style.setProperty("display", "none"); },
};
export const ovTabHooks = thisModule;

// ---------------------------------------------------------------- 顶栏
function renderBar(): void {
  const bar = root.querySelector("#ov-bar")!;
  const changed = draftValues();
  const n = Object.keys(changed).length;   // changed 是普通 Record,.length 恒 undefined(debugState 同口径)
  const lsOn = localStorage.getItem(OVR_KEY) !== null;
  bar.innerHTML = `
    <h3><span class="dot"></span>数值覆盖(只对 TS CLI / TS Web 生效;Python 端不生效)
      <span class="badge ${n ? "" : "ok"}">已改 ${n} 项</span>
      <span class="badge ${lsOn ? "ok" : ""}">localStorage:${lsOn ? "有覆盖" : "无"}</span>
      <span class="badge">服务器 overrides.json:${serverCount === null ? "无/未知" : serverCount ? "有" : "格式坏!"}</span>
    </h3>
    <div class="row" style="margin:6px 0">
      <input type="text" id="ov-search" placeholder="搜索路径(如 hero_atk0)或中文名…" style="width:280px">
      <button class="btn sell-on" id="ov-save">保存覆盖</button>
      <button class="btn warn" id="ov-reset">一键恢复默认</button>
      <button class="btn" id="ov-import">导入 overrides.json</button>
      <input type="file" id="ov-import-input" accept=".json,application/json" style="display:none">
      <button class="btn" id="ov-export">导出 overrides.json</button>
      <button class="btn" id="ov-load-server">读取服务器覆盖</button>
      <button class="btn" id="ov-apply-now">在本面板预览应用(临时)</button>
    </div>
    <details id="ov-diff"><summary>覆盖文件内容预览(serializeOverrideFile,2 空格缩进)</summary>
      <pre class="code">${esc(serializeOverrideFile(changed))}</pre></details>
    <p class="muted small">🔒 行 = 结构键/行为选择器(核心 R6 同清单锁定,双保险);⚠ 行 = 核心接受但有后果(悬停看说明)。
      保存后:游戏页(dev)即时热生效、CLI 下次启动生效、Python 端不生效。</p>`;

  searchBar = bar.querySelector("#ov-search")!;
  searchBar.value = curSearch;
  searchBar.addEventListener("input", () => {
    curSearch = searchBar.value.trim().toLowerCase();
    renderRows();
  });
  bar.querySelector("#ov-save")!.addEventListener("click", saveOverrides);
  bar.querySelector("#ov-reset")!.addEventListener("click", resetAll);
  bar.querySelector("#ov-import")!.addEventListener("click", () =>
    (bar.querySelector("#ov-import-input") as HTMLInputElement).click());
  bar.querySelector("#ov-import-input")!.addEventListener("change", ev => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) f.text().then(importText, () => toast("文件读取失败"));
    (ev.target as HTMLInputElement).value = "";
  });
  bar.querySelector("#ov-export")!.addEventListener("click", () => {
    download("overrides.json", serializeOverrideFile(draftValues()));
    toast("已导出 overrides.json");
  });
  bar.querySelector("#ov-load-server")!.addEventListener("click", async () => {
    if (!bridgeOnline()) { toast("dev 桥不可用,无法读取仓库根 overrides.json"); return; }
    try {
      const r = await bridgeGetFile("overrides.json");
      if (!r.exists || r.content === null) { toast("仓库根没有 overrides.json"); return; }
      importText(r.content);
    } catch (e) { toast(`读取失败:${(e as Error).message}`); }
  });
  bar.querySelector("#ov-apply-now")!.addEventListener("click", () => {
    const vals = draftValues();
    if (!Object.keys(vals).length) { toast("草稿为空"); return; }
    const r = applyOverrides(vals);
    toast(`已在本面板模块实例临时应用 ${r.applied.length} 项(被拒 ${r.rejected.length} 项;预览 Tab 采样时会按协议自动恢复)`);
  });
}

// ---------------------------------------------------------------- 行渲染
function renderRows(): void {
  const rows: string[] = [];
  for (const p of allPaths) {
    if (curCat !== "all" && categoryOf(p) !== curCat) continue;
    if (curSearch) {
      const hay = `${p}\n${leafLabel(p)}`.toLowerCase();
      if (!hay.includes(curSearch)) continue;
    }
    const base = baseLeaves[p];
    const locked = isLockedPath(p);
    const warn = warnText(p);
    const cur = draft[p] ?? base;
    const changed = p in draft;
    let cell: string;
    if (locked) {
      cell = `<span class="lock">🔒 ${esc(valTxt(cur))}</span>`;
    } else if (typeof base === "boolean") {
      cell = `<select data-path="${esc(p)}" data-kind="bool">
        <option value="true"${cur === true ? " selected" : ""}>true</option>
        <option value="false"${cur === false ? " selected" : ""}>false</option></select>`;
    } else if (typeof base === "number") {
      cell = `<input type="number" step="any" data-path="${esc(p)}" data-kind="num" value="${esc(cur)}">`;
    } else {
      cell = `<input type="text" data-path="${esc(p)}" data-kind="str" value="${esc(cur)}">`;
    }
    const status = [
      changed ? `<span class="ov-changed">●改</span>` : "",
      changed && !locked ? `<button class="btn mini" data-undraft="${esc(p)}" title="撤销此行改动">⟲</button>` : "",
      warn ? `<span class="ov-warn" title="${esc(warn)}">⚠</span>` : "",
      locked ? `<span title="结构键/行为选择器,核心 R6 与面板双锁">🔒</span>` : "",
    ].join(" ");
    rows.push(`<tr>
      <td class="muted">${esc(categoryName(categoryOf(p)))}</td>
      <td class="path">${esc(p)}</td>
      <td>${esc(leafLabel(p))}</td>
      <td class="muted">${esc(valTxt(base))}</td>
      <td>${cell}</td>
      <td>${status}</td></tr>`);
  }
  listBox.innerHTML = rows.length ? rows.join("")
    : `<tr><td colspan="6" class="muted">没有匹配的叶子(搜索"${esc(curSearch)}")</td></tr>`;
}

// 草稿编辑:事件委托(输入控件由 renderRows 生成)
function bindList(): void {
  listBox.addEventListener("change", ev => {
    const t = ev.target as HTMLElement;
    const path = t.dataset?.path;
    if (!path) return;
    const base = baseLeaves[path];
    if (base === undefined) return;
    const rawVal = (t as HTMLInputElement).value;
    const v = coerceInput(rawVal, base);
    if (v === null) {
      toast(`${path}:不是合法的 ${typeof base} 值`);
      renderRows();
      return;
    }
    draft[path] = v;
    renderBar();
    renderRows();
  });
  listBox.addEventListener("click", ev => {
    const t = ev.target as HTMLElement;
    const path = t.dataset?.undraft;
    if (!path) return;
    delete draft[path];
    renderBar();
    renderRows();
  });
}

// ---------------------------------------------------------------- 保存/恢复/导入
async function saveOverrides(): Promise<void> {
  const vals = draftValues();
  const text = serializeOverrideFile(vals);          // ← 值 = serializeOverrideFile 输出原文(契约 §7.E)
  if (!Object.keys(vals).length && localStorage.getItem(OVR_KEY) === null) {
    toast("草稿为空(没有可保存的改动)");
    return;
  }
  // 先在面板实例上验证一遍:被拒条目(如未知路径)不会静默丢
  resetOverrides();
  const check = applyOverrides(vals);
  resetOverrides();
  if (check.rejected.length) {
    const msg = check.rejected.map(r => `${r.path}: ${r.reason}`).join("\n");
    if (!confirm(`有 ${check.rejected.length} 条会被核心拒绝(不会写入):\n${msg}\n\n仍保存其余 ${check.applied.length} 条?`)) return;
  }
  localStorage.setItem(OVR_KEY, text);
  let fileNote = "";
  if (bridgeOnline()) {
    try {
      const r = await bridgePostFile("overrides.json", text);
      fileNote = `;overrides.json 已写(${r.bytes} 字节${r.backup ? `,备份 ${r.backup}` : ""})`;
    } catch (e) { fileNote = `;overrides.json 写入失败:${(e as Error).message}`; }
  } else {
    fileNote = ";dev 桥不可用,overrides.json 未写(仅 localStorage)";
  }
  await refreshSaved();
  renderBar();
  toast(`已保存 ${Object.keys(vals).length} 项覆盖${fileNote}。游戏页(dev)已热生效;CLI 下次启动生效;Python 端不生效`);
}

async function resetAll(): Promise<void> {
  if (!confirm("一键恢复默认?\n\n· 清空面板草稿\n· 清除 localStorage 覆盖键\n· 服务器 overrides.json 写为空文件(等效删除)")) return;
  draft = {};
  localStorage.removeItem(OVR_KEY);
  resetOverrides();
  if (bridgeOnline()) {
    try {
      await bridgePostFile("overrides.json", serializeOverrideFile({}));
      toast("已恢复默认(草稿/localStorage/overrides.json 全清)");
    } catch (e) { toast(`localStorage 已清;overrides.json 写入失败:${(e as Error).message}`); }
  } else {
    toast("已恢复默认(localStorage 已清;dev 桥不可用,overrides.json 未动)");
  }
  await refreshSaved();
  renderBar();
  renderRows();
}

function importText(text: string): void {
  try {
    const vals = parseOverrideFile(text);
    draft = { ...vals };
    renderBar();
    renderRows();
    toast(`已导入 ${Object.keys(vals).length} 条覆盖到草稿(确认无误后点「保存覆盖」)`);
  } catch (e) {
    toast(e instanceof OverrideFormatError
      ? `覆盖文件格式错误:${e.message}(不导入)` : `导入失败:${(e as Error).message}`);
  }
}

// 面板启动:把已保存覆盖预填进草稿,便于在旧配置上继续调
export function bootstrapDraftFromSaved(): void {
  const merged: OverrideValues = { ...saved };
  for (const [p, v] of Object.entries(merged)) {
    if (baseLeaves[p] !== undefined && baseLeaves[p] !== v) draft[p] = v;
  }
  renderBar();
  renderRows();
}

// 供 diff 预览与外部诊断
export function debugState(): { base: number; draft: number; diff: OverrideValues } {
  return { base: allPaths.length, draft: Object.keys(draftValues()).length, diff: overrideDiff() };
}
