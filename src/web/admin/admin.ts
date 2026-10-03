/// <reference lib="dom" />
/** 管理面板入口(Vite MPA 第二入口,src/web/admin/index.html → ./admin.ts)。
 *  四 tab:存档管理 / 数值覆盖 / 效果预览 / 说明。只 import 契约白名单内的核心面。 */
import { probeBridge } from "./admin-bridge.ts";
import { initSave } from "./admin-save.ts";
import { bootstrapDraftFromSaved, initOv, ovTabHooks, refreshSaved } from "./admin-overrides.ts";
import { initPreview } from "./admin-preview.ts";
import { initHelp } from "./admin-help.ts";

const TABS = ["save", "ov", "pv", "help"] as const;
type Tab = typeof TABS[number];

let curTab: Tab = "save";

function switchTab(t: Tab): void {
  curTab = t;
  for (const name of TABS) {
    const page = document.getElementById(`page-${name}`);
    if (page) page.classList.toggle("on", name === t);
    const btn = document.querySelector(`#admin-tabs [data-tab="${name}"]`);
    if (btn) btn.classList.toggle("mode-btn", name === t);
  }
  if (t === "ov") ovTabHooks.onTabShow(); else ovTabHooks.onTabHide();
}

function boot(): void {
  const content = document.getElementById("admin-content");
  const side = document.getElementById("admin-side");
  if (!content || !side) throw new Error("admin shell missing #admin-content/#admin-side");

  initSave(document.getElementById("page-save")!);
  initOv(document.getElementById("page-ov")!, side);
  initPreview(document.getElementById("page-pv")!);
  initHelp(document.getElementById("page-help")!);

  for (const name of TABS) {
    const btn = document.querySelector(`#admin-tabs [data-tab="${name}"]`);
    btn?.addEventListener("click", () => switchTab(name));
  }
  switchTab("save");

  // dev 桥探测 → 重建「已保存覆盖」快照(localStorage + 仓库根 overrides.json)
  // → 把已保存覆盖预填进草稿,便于在旧配置上继续调
  void probeBridge().then(async () => {
    await refreshSaved();
    bootstrapDraftFromSaved();
  });
}

boot();
