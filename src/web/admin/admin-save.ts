/// <reference lib="dom" />
/** 管理面板 · Tab1 存档管理:四来源载入 → migrateSave(diff 可见)→ 分组编辑
 *  → validateSaveDict 实时校验(error 阻断写回)→ 四出口(下载/写服务器/写
 *  localStorage/放弃修改)。核心表只读渲染,存档以纯字典进出。 */
import { validateSaveDict, type SaveIssue } from "../../core/savefile.ts";
import { Game, migrateSave, SAVE_VERSION } from "../../core/game.ts";
import {
  ACTIVE_SKILLS, AFFIXES, ALTAR_LINES, CLASSES, MAIN_ROLLS, PASSIVE_SKILLS,
  QUEST_TYPES, RARITIES, RELIC_EFFECTS, SLOTS, STAT_NAMES,
} from "../../core/data.ts";
import { rollItem } from "../../core/items.ts";
import { SAVE_KEY, deepCopy, download, esc, fmt, stamp, toast, topDiff } from "./admin-dom.ts";
import { applyOverrides, resetOverrides } from "../../core/overrides.ts";
import { savedValues } from "./admin-overrides.ts";
import { bridgeBackups, bridgeGetFile, bridgeOnline, bridgePostFile, needBridge } from "./admin-bridge.ts";

// ---------------------------------------------------------------- 状态
let raw: string | null = null;                 // 载入原件(放弃修改 = 回滚到这里)
let d: Record<string, any> | null = null;      // 编辑中(恒为迁移后 v7 字典)
let base: Record<string, any> | null = null;   // 迁移后基线(改动清单对照)
let source = "";
let issues: SaveIssue[] = [];
let dangerUnlocked = false;
let valTimer: ReturnType<typeof setTimeout> | undefined;

const RARITY_KEYS = RARITIES.map(r => r.key);
const SLOT_IDS = SLOTS.map(s => s.id);
const AFFIX_IDS = AFFIXES.map(a => a.id);
const RELIC_EFF_IDS = RELIC_EFFECTS.map(e => e.id);
const QUEST_TYPE_IDS = QUEST_TYPES.map(q => q.type);
const MAIN_STATS = [...new Set(SLOTS.flatMap(s => MAIN_ROLLS[s.id].map(m => m.stat)))];
const ACTIVE_IDS = ACTIVE_SKILLS.map(s => ({ id: s.id, label: `${s.name}(${s.cls})` }));
const PASSIVE_IDS = PASSIVE_SKILLS.map(s => ({ id: s.id, label: `${s.name}(${s.cls})` }));

let root: HTMLElement;
let editorBox: HTMLElement;
let overviewBox: HTMLElement;
let issuesBox: HTMLElement;
let changedBox: HTMLElement;
let opsBox: HTMLElement;
let migrateBox: HTMLElement;
let pasteArea: HTMLTextAreaElement | null = null;

export function initSave(rootEl: HTMLElement): void {
  root = rootEl;
  rootEl.innerHTML = `
    <div class="card" id="save-warn"><span class="danger-note">⚠ 操作顺序:写回 save.json 前先退出 CLI。写 localStorage 无需关游戏页——开着的游戏页(dev)会自动热重载面板写入(storage 热通道)。面板不自动改写 last_saved。</span></div>
    <div class="card" id="save-load"></div>
    <div class="card" id="save-migrate" style="display:none"></div>
    <div class="card" id="save-overview" style="display:none"></div>
    <div class="card" id="save-editor" style="display:none"></div>
    <div class="card" id="save-issues"></div>
    <div class="card" id="save-changed" style="display:none"></div>
    <div class="card" id="save-ops" style="display:none"></div>
    <div class="card" id="save-backups"></div>`;
  editorBox = rootEl.querySelector("#save-editor")!;
  overviewBox = rootEl.querySelector("#save-overview")!;
  issuesBox = rootEl.querySelector("#save-issues")!;
  changedBox = rootEl.querySelector("#save-changed")!;
  opsBox = rootEl.querySelector("#save-ops")!;
  migrateBox = rootEl.querySelector("#save-migrate")!;
  renderLoadCard();
  renderBackupsCard();
  refreshIssues();
}

// ---------------------------------------------------------------- 载入
function renderLoadCard(): void {
  const box = root.querySelector("#save-load")!;
  box.innerHTML = `<h3><span class="dot"></span>载入存档(四选一)</h3>
    <div class="row">
      <button class="btn" id="ld-server">读取服务器存档(dev 桥)</button>
      <button class="btn" id="ld-local">读取本浏览器存档</button>
      <button class="btn" id="ld-file">导入文件</button>
      <input type="file" id="ld-file-input" accept=".json,application/json" style="display:none">
      <button class="btn" id="ld-paste">粘贴 JSON</button>
      <button class="btn" id="ld-remote">远端玩家存档…</button>
    </div>
    <div id="remote-zone" style="display:none;margin-top:8px">
      <div class="row">
        <input type="text" id="remote-ep" placeholder="端点(默认 Cloudflare Worker)" style="flex:2">
        <input type="password" id="remote-token" placeholder="管理 token(X-Admin-Token)" style="flex:1">
      </div>
      <div class="row" style="margin-top:6px">
        <input type="text" id="remote-uuid" placeholder="玩家 uuid(留空=列最近 200 名)" style="flex:2">
        <button class="btn" id="remote-list">列出最近</button>
        <button class="btn" id="remote-fetch">按 uuid 拉取</button>
      </div>
      <div id="remote-list-box" class="small" style="margin-top:6px"></div>
    </div>
    <div id="paste-zone" style="display:none;margin-top:8px">
      <textarea placeholder='F12 → Application → Local Storage → 复制 abyss_save_v2 的整份 Value 粘贴到这里'></textarea>
      <div class="row" style="margin-top:6px">
        <button class="btn sell-on" id="paste-go">载入粘贴内容</button>
        <span class="muted small">适合线上存档跨源 / 游戏页已打不开的场景</span>
      </div>
    </div>
    <p class="muted small" style="margin-top:8px" id="load-status">${d ? `已载入(${source})` : "尚未载入存档"}</p>`;
  box.querySelector("#ld-server")!.addEventListener("click", loadFromServer);
  box.querySelector("#ld-local")!.addEventListener("click", loadFromLocal);
  box.querySelector("#ld-file")!.addEventListener("click", () =>
    (box.querySelector("#ld-file-input") as HTMLInputElement).click());
  box.querySelector("#ld-file-input")!.addEventListener("change", ev => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) f.text().then(loadText, () => toast("文件读取失败"));
    (ev.target as HTMLInputElement).value = "";
  });
  box.querySelector("#ld-paste")!.addEventListener("click", () => {
    const z = box.querySelector("#paste-zone") as HTMLElement;
    z.style.display = z.style.display === "none" ? "block" : "none";
    pasteArea = z.querySelector("textarea");
  });
  const rz = box.querySelector("#remote-zone") as HTMLElement;
  (rz.querySelector("#remote-ep") as HTMLInputElement).value = syncCfg().endpoint;
  (rz.querySelector("#remote-token") as HTMLInputElement).value = syncCfg().token;
  box.querySelector("#ld-remote")!.addEventListener("click", () => {
    rz.style.display = rz.style.display === "none" ? "block" : "none";
  });
  box.querySelector("#remote-list")!.addEventListener("click", () => void remoteList());
  box.querySelector("#remote-fetch")!.addEventListener("click", () => {
    const u = (rz.querySelector("#remote-uuid") as HTMLInputElement).value.trim();
    if (!u) { toast("请输入玩家 uuid"); return; }
    void remoteFetch(u);
  });
  box.querySelector("#paste-go")!.addEventListener("click", () => {
    if (pasteArea && pasteArea.value.trim()) loadText(pasteArea.value.trim());
    else toast("请先粘贴 JSON 文本");
  });
}

async function loadFromServer(): Promise<void> {
  if (!needBridge()) return;
  try {
    const r = await bridgeGetFile("save.json");
    if (!r.exists || r.content === null) { toast("仓库根没有 save.json(CLI 还没存过档)"); return; }
    loadText(r.content, "服务器 save.json");
  } catch (e) { toast(`读取失败:${(e as Error).message}`); }
}

function loadFromLocal(): void {
  const t = localStorage.getItem(SAVE_KEY);
  if (!t) { toast(`本浏览器没有 "${SAVE_KEY}" 存档(游戏页在本源玩过才有)`); return; }
  loadText(t, "本浏览器 localStorage");
}

// ---------------------------------------------------------------- 远端玩家存档(/save-sync)
// 玩家端每 10 分钟自动上行整档(生产构建);此处为管理端:列出/单取/写回(需 token)。
const SYNC_CFG_KEY = "abyss_admin_sync_cfg";
const SYNC_DEFAULT_EP = "https://abyss-leaderboard.a-red6108.workers.dev";
let remoteUuid = "";    // 非空 = 当前编辑的是远端档(写回出口可见)
let remoteName = "";

function syncCfg(): { endpoint: string; token: string } {
  try {
    return { endpoint: SYNC_DEFAULT_EP, token: "",
      ...JSON.parse(localStorage.getItem(SYNC_CFG_KEY) ?? "{}") };
  } catch { return { endpoint: SYNC_DEFAULT_EP, token: "" }; }
}
function readSyncCfg(): { endpoint: string; token: string } {
  const rz = root.querySelector("#remote-zone");
  const c = rz
    ? {
        endpoint: (rz.querySelector("#remote-ep") as HTMLInputElement).value.trim() || SYNC_DEFAULT_EP,
        token: (rz.querySelector("#remote-token") as HTMLInputElement).value.trim(),
      }
    : syncCfg();
  localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(c));   // 记住,下次自动填
  return c;
}

interface SyncRow { uuid: string; name: string; level: number; playtime: number;
                    kills: number; max_zone: number; max_tower: number;
                    bytes: number; updated_at: number }

async function remoteList(): Promise<void> {
  const c = readSyncCfg();
  const box = root.querySelector("#remote-list-box") as HTMLElement;
  box.innerHTML = `<span class="muted">读取中…</span>`;
  try {
    const r = await fetch(`${c.endpoint}/save-sync?token=${encodeURIComponent(c.token)}`);
    const d = await r.json() as { error?: string; saves?: SyncRow[] };
    if (!r.ok || d.error) { box.innerHTML = `<span class="danger-note">${esc(d.error ?? `HTTP ${r.status}`)}</span>`; return; }
    if (!d.saves?.length) { box.innerHTML = `<span class="muted">服务器还没有任何玩家存档</span>`; return; }
    box.innerHTML = `<table class="cmp"><tr><th>载入</th><th>uuid</th><th>昵称</th><th>Lv</th><th>时长</th><th>更新</th></tr>` +
      d.saves.map(s => `<tr><td><button class="btn mini" data-uuid="${esc(s.uuid)}" data-name="${esc(s.name)}">载入</button></td>` +
        `<td>${esc(s.uuid.slice(0, 10))}…</td><td>${esc(s.name)}</td><td>${esc(s.level)}</td>` +
        `<td>${esc(fmt(s.playtime))}s</td><td>${esc(new Date(s.updated_at).toLocaleString())}</td></tr>`).join("") +
      `</table><p class="muted small">${d.saves.length} 名玩家(按最近更新排序,至多 200)</p>`;
    box.querySelectorAll("button[data-uuid]").forEach(b =>
      b.addEventListener("click", () => void remoteFetch(b.getAttribute("data-uuid")!,
        b.getAttribute("data-name") ?? "")));
  } catch (e) { box.innerHTML = `<span class="danger-note">请求失败:${esc((e as Error).message)}</span>`; }
}

async function remoteFetch(uuid: string, name = ""): Promise<void> {
  const c = readSyncCfg();
  try {
    const r = await fetch(`${c.endpoint}/save-sync?token=${encodeURIComponent(c.token)}&uuid=${encodeURIComponent(uuid)}`);
    const d = await r.json() as { error?: string; save?: Record<string, unknown> };
    if (!r.ok || d.error || !d.save) { toast(`拉取失败:${d.error ?? `HTTP ${r.status}`}`); return; }
    remoteName = name;
    loadText(JSON.stringify(d.save), `远端玩家 ${uuid.slice(0, 8)}…`, uuid);
  } catch (e) { toast(`请求失败:${(e as Error).message}`); }
}

/** 管理写回:带 X-Admin-Token,跳过服务端包络/限流(可造测试值) */
async function writeRemote(): Promise<void> {
  if (!guard() || !remoteUuid) return;
  const c = readSyncCfg();
  if (!c.token) { toast("请先在「远端玩家存档」表单里填管理 token"); return; }
  const diff = topDiff(base!, d!);
  if (!confirm(`写回远端玩家 ${remoteUuid} 的存档?\n\n改动 ${diff.length} 个顶层字段:${diff.map(x => x.key).join(", ") || "(无)"}\n\n管理写回跳过服务端包络校验;玩家下次上传会覆盖此版本。`)) return;
  try {
    const r = await fetch(`${c.endpoint}/save-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": c.token },
      body: JSON.stringify({ uuid: remoteUuid, name: remoteName, save: d }),
    });
    const out = await r.json() as { ok?: boolean; error?: string };
    if (!r.ok || out.error) { toast(`写回失败:${out.error ?? `HTTP ${r.status}`}`); return; }
    toast(`已写回远端玩家存档(${out.ok ? "ok" : r.status})`);
  } catch (e) { toast(`请求失败:${(e as Error).message}`); }
}

/** 载入入口:JSON.parse 失败即拒绝(面板比游戏本体更保守,不开新档)。
 *  remoteId 非空 = 远端档:置 remoteUuid,「写回远端」出口可见。 */
function loadText(text: string, src = "文件导入", remoteId = ""): void {
  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("顶层不是 JSON 对象");
  } catch (e) {
    toast(`不是合法存档 JSON:${(e as Error).message}`);
    return;
  }
  raw = text;
  source = src;
  remoteUuid = remoteId;
  const pythonNote = !("relic_bag" in parsed) || !("relic_bag_lv" in parsed);
  const before = deepCopy(parsed);
  const migrated = migrateSave(parsed);
  d = migrated;
  base = deepCopy(migrated);
  dangerUnlocked = false;
  const diff = topDiff(before, deepCopy(migrated));
  migrateBox.style.display = "block";
  let html = `<h3><span class="dot"></span>迁移报告(migrateSave,当前 SAVE_VERSION=${SAVE_VERSION})</h3>`;
  if (diff.length === 0) {
    html += `<p class="small">无迁移改动(已是 v${SAVE_VERSION} 结构)。</p>`;
  } else {
    html += `<p class="small">迁移改动了 ${diff.length} 个顶层字段(v&lt;4 的迁移会重置职业/装配,属破坏性步骤,请知悉后进编辑器):</p>
      <table class="cmp"><tr><th>字段</th><th>迁移前</th><th>迁移后</th></tr>` +
      diff.map(x => `<tr><td>${esc(x.key)}</td><td>${esc(x.before)}</td><td>${esc(x.after)}</td></tr>`).join("") +
      `</table>`;
  }
  if (pythonNote)
    html += `<p class="small" style="color:#ffb84a">⚠ 此档缺少 relic_bag / relic_bag_lv:被 Python CLI 写过,遗物背包丢失是既有行为(abyss/game.py 不读写这两键)。</p>`;
  migrateBox.innerHTML = html;
  overviewBox.style.display = "block";
  editorBox.style.display = "block";
  opsBox.style.display = "block";
  changedBox.style.display = "block";
  renderOverview();
  renderEditor();
  refreshIssues();
  renderChanged();
  const st = root.querySelector("#load-status");
  if (st) st.textContent = `已载入(${source})`;
  toast(`存档已载入:${source}`);
}

// ---------------------------------------------------------------- 概览
function renderOverview(): void {
  if (!d) return;
  const clsName = d.class_id ? (CLASSES[d.class_id]?.name ?? String(d.class_id)) : "未选择";
  const hours = Math.floor((d.playtime ?? 0) / 3600);
  const mins = Math.floor(((d.playtime ?? 0) % 3600) / 60);
  overviewBox.innerHTML = `<h3><span class="dot"></span>概览</h3>
    <div class="row small">
      <span class="badge">职业:${esc(clsName)}</span>
      <span class="badge">等级:${esc(d.level)}</span>
      <span class="badge ok">金币:${fmt(Number(d.gold) || 0)}</span>
      <span class="badge">重铸石:${esc(d.stones)}</span>
      <span class="badge">进度:第${esc(d.zone)}区·${esc(d.stage)}层</span>
      <span class="badge">模式:${esc(d.mode)}</span>
      <span class="badge">游玩:${hours}小时${mins}分</span>
      <span class="badge">存档版本:${esc(d.version)}</span>
      <span class="badge">seed:${esc(d.seed)}</span>
      <span class="badge">last_saved:${d.last_saved ? new Date(Number(d.last_saved) * 1000).toLocaleString() : "—"}</span>
    </div>`;
}

// ---------------------------------------------------------------- 编辑器
function renderEditor(): void {
  if (!d) return;
  editorBox.innerHTML = "";
  editorBox.appendChild(group("基础资源", gBasic()));
  editorBox.appendChild(group("进度", gProgress()));
  editorBox.appendChild(group("职业与技能", gClass()));
  editorBox.appendChild(group("装备与背包", gEquipBag()));
  editorBox.appendChild(group("遗物与塔", gRelicTower()));
  editorBox.appendChild(group("悬赏", gQuests()));
  editorBox.appendChild(group("统计与成长", gStats()));
  editorBox.appendChild(group("设置", gSettings()));
  editorBox.appendChild(dangerGroup());
}

function group(title: string, ...kids: (Node | null)[]): HTMLElement {
  const g = document.createElement("div");
  g.className = "grp";
  const h = document.createElement("h4");
  h.textContent = title;
  g.appendChild(h);
  for (const k of kids) if (k) g.appendChild(k);
  return g;
}

function fldRow(label: string, input: HTMLElement, field: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "fld";
  const lab = document.createElement("label");
  lab.textContent = label;
  row.appendChild(lab);
  input.setAttribute("data-field", field);
  row.appendChild(input);
  return row;
}

function numInput(get: () => number, set: (v: number) => void, opts: { int?: boolean } = {}): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "number";
  i.step = opts.int ? "1" : "any";
  i.value = String(get() ?? 0);
  i.addEventListener("change", () => {
    const v = Number(i.value);
    if (!Number.isFinite(v)) { i.value = String(get() ?? 0); return; }
    set(opts.int ? Math.trunc(v) : v);
    onEdit();
  });
  return i;
}

function txtInput(get: () => string, set: (v: string) => void, maxLen = 200): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "text"; i.maxLength = maxLen;
  i.value = String(get() ?? "");
  i.addEventListener("change", () => { set(i.value); onEdit(); });
  return i;
}

function selInput(options: { value: string; label: string }[], get: () => string, set: (v: string) => void): HTMLSelectElement {
  const s = document.createElement("select");
  for (const o of options) {
    const op = document.createElement("option");
    op.value = o.value; op.textContent = o.label;
    s.appendChild(op);
  }
  s.value = get();
  if (s.value !== get()) { // 当前值不在选项里:补一个带 ⚠ 的原值项,保证可见可改
    const op = document.createElement("option");
    op.value = get(); op.textContent = `${get()}(未知值)`;
    s.appendChild(op); s.value = get();
  }
  s.addEventListener("change", () => { set(s.value); onEdit(); });
  return s;
}

function gBasic(): HTMLElement {
  const box = document.createElement("div");
  box.appendChild(fldRow("gold 金币", numInput(() => d!.gold, v => d!.gold = v, { int: true }), "gold"));
  box.appendChild(fldRow("stones 重铸石", numInput(() => d!.stones, v => d!.stones = v, { int: true }), "stones"));
  box.appendChild(fldRow("level 等级", numInput(() => d!.level, v => d!.level = v, { int: true }), "level"));
  box.appendChild(fldRow("xp 当前经验", numInput(() => d!.xp, v => d!.xp = v), "xp"));
  box.appendChild(fldRow("hero_hp 当前生命", numInput(() => d!.hero_hp, v => d!.hero_hp = v), "hero_hp"));
  box.appendChild(fldRow("time 游戏时间(秒)", numInput(() => d!.time, v => d!.time = v), "time"));
  box.appendChild(fldRow("playtime 游玩时长(秒)", numInput(() => d!.playtime, v => d!.playtime = v), "playtime"));
  return box;
}

function gProgress(): HTMLElement {
  const box = document.createElement("div");
  box.appendChild(fldRow("zone 区", numInput(() => d!.zone, v => d!.zone = v, { int: true }), "zone"));
  box.appendChild(fldRow("stage 层", numInput(() => d!.stage, v => d!.stage = v, { int: true }), "stage"));
  box.appendChild(fldRow("stage_kills 层内击杀", numInput(() => d!.stage_kills, v => d!.stage_kills = v, { int: true }), "stage_kills"));
  // mode 是引擎字面量枚举 "push"|"farm"(核心无独立表,见 game.ts mode 类型)
  box.appendChild(fldRow("mode 模式", selInput(
    [{ value: "push", label: "push 推进" }, { value: "farm", label: "farm 挂机" }],
    () => String(d!.mode ?? "push"), v => d!.mode = v), "mode"));
  box.appendChild(fldRow("farm_stage 挂机层", numInput(() => d!.farm_stage, v => d!.farm_stage = v, { int: true }), "farm_stage"));
  box.appendChild(fldRow("deaths_row 连败数", numInput(() => d!.deaths_row, v => d!.deaths_row = v, { int: true }), "deaths_row"));
  box.appendChild(fldRow("ema_kill 击杀时长均值", numInput(() => d!.ema_kill, v => d!.ema_kill = v), "ema_kill"));
  return box;
}

function gClass(): HTMLElement {
  const box = document.createElement("div");
  const clsOpts = [{ value: "", label: "(未选择)" },
    ...Object.keys(CLASSES).map(k => ({ value: k, label: `${k} ${CLASSES[k].name}` }))];
  box.appendChild(fldRow("class_id 职业", selInput(clsOpts,
    () => String(d!.class_id ?? ""), v => d!.class_id = v === "" ? null : v), "class_id"));

  // loadout:主动/被动技能多选(选项一律现读核心技能表)
  const wrap = document.createElement("div");
  wrap.className = "fld";
  const lab = document.createElement("label");
  lab.textContent = "loadout 装配";
  wrap.appendChild(lab);
  for (const which of ["active", "passive"] as const) {
    const col = document.createElement("div");
    col.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:6px 8px;min-width:230px";
    const t = document.createElement("div");
    t.className = "muted small";
    t.textContent = which === "active" ? "主动(ACTIVE_SKILLS)" : "被动(PASSIVE_SKILLS)";
    col.appendChild(t);
    const pool = which === "active" ? ACTIVE_IDS : PASSIVE_IDS;
    const arr = () => d!.loadout[which] as string[];
    for (const s of pool) {
      const lbl = document.createElement("label");
      lbl.className = "small";
      lbl.style.cssText = "display:block;margin:1px 0;cursor:pointer";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = arr().includes(s.id);
      cb.setAttribute("data-field", `loadout.${which}.${s.id}`);
      cb.addEventListener("change", () => {
        const list = d!.loadout[which] as string[];
        const i = list.indexOf(s.id);
        if (cb.checked && i < 0) list.push(s.id);
        if (!cb.checked && i >= 0) list.splice(i, 1);
        onEdit();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(" " + s.label));
      col.appendChild(lbl);
    }
    wrap.appendChild(col);
  }
  box.appendChild(wrap);
  box.appendChild(kvGroup("skill_lv 技能等级", d!.skill_lv,
    [...ACTIVE_IDS, ...PASSIVE_IDS].map(s => s.id), "skill_lv", true));
  return box;
}

function gEquipBag(): HTMLElement {
  const box = document.createElement("div");
  const eq = document.createElement("div");
  eq.setAttribute("data-field", "equip");
  for (const slot of SLOT_IDS) {
    const holder = document.createElement("div");
    holder.style.marginBottom = "6px";
    holder.setAttribute("data-field", `equip.${slot}`);
    const head = document.createElement("div");
    head.className = "small muted";
    head.textContent = `${slot} ${SLOTS.find(s => s.id === slot)!.name}`;
    holder.appendChild(head);
    if (d!.equip?.[slot]) {
      holder.appendChild(itemEditor(d!.equip[slot], `equip.${slot}`));
      const rm = document.createElement("button");
      rm.className = "btn mini danger";
      rm.textContent = "卸下此槽(置空)";
      rm.addEventListener("click", () => {
        if (!confirm(`置空 ${slot} 槽?`)) return;
        delete d!.equip[slot];
        renderEditor(); onEdit();
      });
      holder.appendChild(rm);
    } else {
      const empty = document.createElement("span");
      empty.className = "muted small";
      empty.textContent = "(空)";
      holder.appendChild(empty);
    }
    eq.appendChild(holder);
  }
  box.appendChild(group("equip 已装备(6 槽)", eq));

  const bagBox = document.createElement("div");
  const hint = document.createElement("p");
  hint.className = "muted small";
  hint.textContent = `bag 条目列表(当前 ${(d!.bag ?? []).length} 件;index 0 = 最新掉落,新掉落 unshift 到队首);写回时整体按当前顺序序列化`;
  bagBox.appendChild(hint);
  (d!.bag as any[]).forEach((item, i) => {
    const row = document.createElement("div");
    row.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:6px;margin:4px 0";
    row.setAttribute("data-field", `bag.${i}`);
    const head = document.createElement("div");
    head.className = "small muted";
    head.textContent = `bag[${i}]`;
    row.appendChild(head);
    row.appendChild(itemEditor(item, `bag.${i}`));
    const del = document.createElement("button");
    del.className = "btn mini danger";
    del.textContent = "删除此条目";
    del.addEventListener("click", () => {
      if (!confirm(`删除 bag[${i}](装备 ${(item as any)?.name ?? "?"})?此操作不可在面板内撤销(可用「放弃修改」整体回滚)。`)) return;
      d!.bag.splice(i, 1);
      renderEditor(); onEdit();
    });
    row.appendChild(del);
    bagBox.appendChild(row);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "btn mini";
  addBtn.textContent = "+ 添加一件合法示例装备(rollItem,默认数值 roll)";
  addBtn.addEventListener("click", () => {
    // 示例装备按默认数值 roll(隔离预览/临时应用留下的表状态)
    resetOverrides();
    let it: ReturnType<typeof rollItem> | null = null;
    try {
      const g = new Game(Math.floor(Math.random() * 2 ** 31));
      const tier = Math.max(1, (d!.level ?? 1) + Math.floor(Math.random() * 3));
      it = rollItem(tier, g.rng, 0, 0, 0);
    } finally {
      resetOverrides();
      applyOverrides(savedValues());
    }
    if (!it) return;
    d!.bag.unshift(it.toDict());
    renderEditor(); onEdit();
    toast(`已添加示例装备:${it.name}(tier ${it.tier})到 bag[0]`);
  });
  bagBox.appendChild(addBtn);
  box.appendChild(group("bag 背包", bagBox));
  box.appendChild(fldRow("bag_exp_lv 背包扩容次数", numInput(
    () => d!.bag_exp_lv, v => d!.bag_exp_lv = v, { int: true }), "bag_exp_lv"));
  return box;
}

/** 单件装备字典编辑器(枚举下拉全部现读核心表) */
function itemEditor(item: any, where: string): HTMLElement {
  const box = document.createElement("div");
  const r1 = document.createElement("div");
  r1.className = "row";
  r1.appendChild(labeled("slot", selInput(SLOT_IDS.map(s => ({ value: s, label: s })), () => item.slot, v => item.slot = v)));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.slot`);
  r1.appendChild(labeled("rarity", selInput(RARITIES.map((r, i) => ({ value: r.key, label: `${i} ${r.name}` })), () => item.rarity, v => item.rarity = v)));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.rarity`);
  r1.appendChild(labeled("tier", numInput(() => item.tier, v => item.tier = v, { int: true })));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.tier`);
  r1.appendChild(labeled("plus", numInput(() => item.plus ?? 0, v => item.plus = v, { int: true })));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.plus`);
  box.appendChild(r1);
  const r2 = document.createElement("div");
  r2.className = "row";
  r2.appendChild(labeled("main_val", numInput(() => item.main_val, v => item.main_val = v)));
  r2.children[r2.children.length - 1].setAttribute("data-field", `${where}.main_val`);
  const mainOpts = [{ value: "", label: "main_id:无(回落atk)" },
    ...MAIN_STATS.map(s => ({ value: s, label: `main_id:${s}` }))];
  r2.appendChild(labeled("", selInput(mainOpts, () => item.main_id ?? "", v => {
    if (v === "") delete item.main_id; else item.main_id = v;
  })));
  r2.children[r2.children.length - 1].setAttribute("data-field", `${where}.main_id`);
  r2.appendChild(labeled("name", txtInput(() => item.name ?? "", v => item.name = v)));
  r2.children[r2.children.length - 1].setAttribute("data-field", `${where}.name`);
  box.appendChild(r2);

  const afBox = document.createElement("div");
  afBox.setAttribute("data-field", `${where}.affixes`);
  (item.affixes as [string, number][]).forEach((pair, i) => {
    const row = document.createElement("div");
    row.className = "kv-row";
    const idSel = selInput(AFFIX_IDS.map(a => ({ value: a, label: a })), () => pair[0], v => pair[0] = v);
    idSel.setAttribute("data-field", `${where}.affixes.${i}.0`);
    row.appendChild(idSel);
    const val = numInput(() => pair[1], v => pair[1] = v);
    val.setAttribute("data-field", `${where}.affixes.${i}.1`);
    row.appendChild(val);
    const del = document.createElement("button");
    del.className = "btn mini danger";
    del.textContent = "删词条";
    del.addEventListener("click", () => {
      item.affixes.splice(i, 1);
      renderEditor(); onEdit();
    });
    row.appendChild(del);
    afBox.appendChild(row);
  });
  const addAf = document.createElement("button");
  addAf.className = "btn mini";
  addAf.textContent = "+ 词条";
  addAf.addEventListener("click", () => {
    item.affixes.push([AFFIX_IDS[0], 1]);
    renderEditor(); onEdit();
  });
  afBox.appendChild(addAf);
  box.appendChild(afBox);
  return box;
}

/** 单件遗物字典编辑器 */
function relicEditor(relic: any, where: string): HTMLElement {
  const box = document.createElement("div");
  const r1 = document.createElement("div");
  r1.className = "row";
  r1.appendChild(labeled("rarity", selInput(RARITIES.map((r, i) => ({ value: r.key, label: `${i} ${r.name}` })), () => relic.rarity, v => relic.rarity = v)));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.rarity`);
  r1.appendChild(labeled("tier", numInput(() => relic.tier, v => relic.tier = v, { int: true })));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.tier`);
  r1.appendChild(labeled("name", txtInput(() => relic.name ?? "", v => relic.name = v)));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.name`);
  const skOpts = [{ value: "", label: "skill_id:无" },
    ...ACTIVE_SKILLS.map(s => ({ value: s.id, label: `skill:${s.name}` }))];
  r1.appendChild(labeled("", selInput(skOpts, () => relic.skill_id ?? "", v => {
    if (v === "") relic.skill_id = null; else relic.skill_id = v;
  })));
  r1.children[r1.children.length - 1].setAttribute("data-field", `${where}.skill_id`);
  box.appendChild(r1);

  const efBox = document.createElement("div");
  efBox.setAttribute("data-field", `${where}.effects`);
  (relic.effects as [string, number][]).forEach((pair, i) => {
    const row = document.createElement("div");
    row.className = "kv-row";
    const idSel = selInput(RELIC_EFF_IDS.map(e => ({ value: e, label: e })), () => pair[0], v => pair[0] = v);
    idSel.setAttribute("data-field", `${where}.effects.${i}.0`);
    row.appendChild(idSel);
    const val = numInput(() => pair[1], v => pair[1] = v);
    val.setAttribute("data-field", `${where}.effects.${i}.1`);
    row.appendChild(val);
    const del = document.createElement("button");
    del.className = "btn mini danger";
    del.textContent = "删效果";
    del.addEventListener("click", () => {
      relic.effects.splice(i, 1);
      renderEditor(); onEdit();
    });
    row.appendChild(del);
    efBox.appendChild(row);
  });
  const addEf = document.createElement("button");
  addEf.className = "btn mini";
  addEf.textContent = "+ 效果";
  addEf.addEventListener("click", () => {
    relic.effects.push([RELIC_EFF_IDS[0], 1]);
    renderEditor(); onEdit();
  });
  efBox.appendChild(addEf);
  box.appendChild(efBox);
  return box;
}

function labeled(text: string, input: HTMLElement): HTMLElement {
  const s = document.createElement("span");
  s.className = "row small";
  if (text) {
    const l = document.createElement("span");
    l.className = "muted";
    l.textContent = text + " ";
    s.appendChild(l);
  }
  s.appendChild(input);
  return s;
}

function gRelicTower(): HTMLElement {
  // Python 端写过的档缺 relic_bag/relic_bag_lv(abyss/game.py v5→v6 跳过,§5.5 既有行为,
  // migrateSave 对 v7 零改动):渲染前按引擎 fromDict 同口径补默认,否则 forEach 抛错
  // 中断整个 renderEditor(遗物之后的分组/实时校验/改动清单/写回全不渲染)。
  // 补键会进写回字典并在改动清单可见,与 migrateSave v6 步骤等价;游戏 fromDict 本就容错。
  if (!Array.isArray(d!.relic_bag)) d!.relic_bag = [];
  if (!Number.isInteger(d!.relic_bag_lv)) d!.relic_bag_lv = 1;
  const box = document.createElement("div");
  const rel = document.createElement("div");
  for (let i = 0; i < 4; i++) {
    const holder = document.createElement("div");
    holder.style.marginBottom = "6px";
    holder.setAttribute("data-field", `relics.${i}`);
    const head = document.createElement("div");
    head.className = "small muted";
    head.textContent = `relics[${i}]`;
    holder.appendChild(head);
    const r = d!.relics?.[i];
    if (r) {
      holder.appendChild(relicEditor(r, `relics.${i}`));
      const rm = document.createElement("button");
      rm.className = "btn mini danger";
      rm.textContent = "置空此槽";
      rm.addEventListener("click", () => {
        if (!confirm(`置空遗物槽 ${i}?`)) return;
        d!.relics[i] = null;
        renderEditor(); onEdit();
      });
      holder.appendChild(rm);
    } else {
      const empty = document.createElement("span");
      empty.className = "muted small";
      empty.textContent = "(空)";
      holder.appendChild(empty);
    }
    rel.appendChild(holder);
  }
  box.appendChild(group("relics 遗物(4 槽)", rel));

  const rb = document.createElement("div");
  (d!.relic_bag as any[]).forEach((r, i) => {
    const row = document.createElement("div");
    row.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:6px;margin:4px 0";
    row.setAttribute("data-field", `relic_bag.${i}`);
    const head = document.createElement("div");
    head.className = "small muted";
    head.textContent = `relic_bag[${i}]`;
    row.appendChild(head);
    row.appendChild(relicEditor(r, `relic_bag.${i}`));
    const del = document.createElement("button");
    del.className = "btn mini danger";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      if (!confirm(`删除 relic_bag[${i}]?`)) return;
      d!.relic_bag.splice(i, 1);
      renderEditor(); onEdit();
    });
    row.appendChild(del);
    rb.appendChild(row);
  });
  const addRel = document.createElement("button");
  addRel.className = "btn mini";
  addRel.textContent = "+ 添加空遗物";
  addRel.addEventListener("click", () => {
    d!.relic_bag.push({ rarity: RARITY_KEYS[0], tier: 10, effects: [[RELIC_EFF_IDS[0], 3]], name: "面板造遗物", skill_id: null });
    renderEditor(); onEdit();
  });
  rb.appendChild(addRel);
  box.appendChild(group("relic_bag 遗物背包", rb));
  box.appendChild(fldRow("relic_bag_lv 背包容量等级", numInput(
    () => d!.relic_bag_lv, v => d!.relic_bag_lv = v, { int: true }), "relic_bag_lv"));

  const tw = d!.tower ?? (d!.tower = { keys: 3, max_floor: 0, last_refresh: null });
  const twBox = document.createElement("div");
  twBox.appendChild(fldRow("tower.keys 钥匙数", numInput(() => tw.keys, v => tw.keys = v, { int: true }), "tower.keys"));
  twBox.appendChild(fldRow("tower.max_floor 最高层", numInput(() => tw.max_floor, v => tw.max_floor = v, { int: true }), "tower.max_floor"));
  twBox.appendChild(fldRow("tower.last_refresh 刷新日期", txtInput(() => tw.last_refresh ?? "", v => tw.last_refresh = v || null, 10), "tower.last_refresh"));
  box.appendChild(group("tower 爬塔", twBox));
  return box;
}

function gQuests(): HTMLElement {
  const box = document.createElement("div");
  (d!.quests as any[]).forEach((q, i) => {
    const g = document.createElement("div");
    g.className = "grp";
    g.setAttribute("data-field", `quests.${i}`);
    g.appendChild(fldRow(`quests[${i}].type 类型`, selInput(
      QUEST_TYPE_IDS.map(t => ({ value: t, label: t })), () => q.type, v => q.type = v), `quests.${i}.type`));
    g.appendChild(fldRow("target 目标", numInput(() => q.target, v => q.target = v, { int: true }), `quests.${i}.target`));
    g.appendChild(fldRow("progress 进度", numInput(() => q.progress, v => q.progress = v, { int: true }), `quests.${i}.progress`));
    g.appendChild(fldRow("gold 金币奖励", numInput(() => q.gold, v => q.gold = v, { int: true }), `quests.${i}.gold`));
    g.appendChild(fldRow("stones 石头奖励", numInput(() => q.stones, v => q.stones = v, { int: true }), `quests.${i}.stones`));
    box.appendChild(g);
  });
  box.appendChild(fldRow("quest_daily_count 今日完成数", numInput(
    () => d!.quest_daily_count, v => d!.quest_daily_count = v, { int: true }), "quest_daily_count"));
  box.appendChild(fldRow("quest_daily_date 日期(YYYY-MM-DD)", txtInput(
    () => d!.quest_daily_date ?? "", v => d!.quest_daily_date = v, 10), "quest_daily_date"));
  box.appendChild(fldRow("quest_reroll_count 今日刷新数", numInput(
    () => d!.quest_reroll_count, v => d!.quest_reroll_count = v, { int: true }), "quest_reroll_count"));
  box.appendChild(fldRow("tower_keys_bought 今日加购钥匙", numInput(
    () => d!.tower_keys_bought, v => d!.tower_keys_bought = v, { int: true }), "tower_keys_bought"));
  return box;
}

function gStats(): HTMLElement {
  const box = document.createElement("div");
  const note = document.createElement("p");
  note.className = "small";
  note.style.color = "#ffb84a";
  note.textContent = "⚠ stats 同时是成就计量:改大 kills/gold_earned 等会直接触发成就永久属性加成";
  box.appendChild(note);
  const known = [...new Set([
    ...Object.keys(d!.stats ?? {}),
    "kills", "boss_kills", "deaths", "enhance_total", "gold_earned", "max_zone",
    "reforge_total", "quest_done", "crit_hits",
  ])];
  box.appendChild(kvGroup("stats 统计", d!.stats, known, "stats", true, true));
  const altarIds = ALTAR_LINES.map(l => l.id);
  box.appendChild(kvGroup("altar_lv 祭坛等级", d!.altar_lv, altarIds, "altar_lv", true));

  const smBox = document.createElement("div");
  smBox.setAttribute("data-field", "stat_mods");
  ((d!.stat_mods ?? []) as any[]).forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "kv-row";
    row.setAttribute("data-field", `stat_mods.${i}`);
    const src = txtInput(() => m.src, v => m.src = v, 60);
    row.appendChild(src);
    const statOpts = Object.keys(STAT_NAMES).map(k => ({ value: k, label: k }));
    row.appendChild(selInput(statOpts, () => m.stat, v => m.stat = v));
    row.appendChild(selInput([{ value: "add", label: "add" }, { value: "pct", label: "pct" }], () => m.op, v => m.op = v));
    row.appendChild(numInput(() => m.v, v => m.v = v));
    const del = document.createElement("button");
    del.className = "btn mini danger";
    del.textContent = "删";
    del.addEventListener("click", () => { d!.stat_mods.splice(i, 1); renderEditor(); onEdit(); });
    row.appendChild(del);
    smBox.appendChild(row);
  });
  const addSm = document.createElement("button");
  addSm.className = "btn mini";
  addSm.textContent = "+ stat_mod";
  addSm.addEventListener("click", () => {
    d!.stat_mods.push({ src: "panel", stat: Object.keys(STAT_NAMES)[0], op: "add", v: 0 });
    renderEditor(); onEdit();
  });
  smBox.appendChild(addSm);
  box.appendChild(group("stat_mods 外部修饰器", smBox));
  return box;
}

/** 键值表编辑器(可选:危险确认、键下拉建议) */
function kvGroup(title: string, obj: Record<string, any>, keyOptions: string[],
                 fieldBase: string, numeric = true, confirmEdit = false): HTMLElement {
  const g = document.createElement("div");
  g.className = "grp";
  g.setAttribute("data-field", fieldBase);
  const h = document.createElement("h4");
  h.textContent = title;
  g.appendChild(h);
  for (const k of Object.keys(obj)) {
    const row = document.createElement("div");
    row.className = "kv-row";
    row.setAttribute("data-field", `${fieldBase}.${k}`);
    const kl = document.createElement("span");
    kl.className = "small";
    kl.textContent = k;
    kl.style.minWidth = "120px";
    kl.style.display = "inline-block";
    row.appendChild(kl);
    const old = structuredClone(obj[k]);
    const inp = numInput(() => obj[k], v => obj[k] = v, { int: numeric && Number.isInteger(old) });
    inp.setAttribute("data-field", `${fieldBase}.${k}`);
    if (confirmEdit) {
      inp.addEventListener("change", () => {
        if (!confirm(`确认修改 ${fieldBase}.${k}:${old} → ${obj[k]}?`)) {
          obj[k] = old;
          inp.value = String(old);
        }
        onEdit();
      }, { capture: true });
    }
    row.appendChild(inp);
    const del = document.createElement("button");
    del.className = "btn mini danger";
    del.textContent = "删键";
    del.addEventListener("click", () => {
      if (!confirm(`删除 ${fieldBase}.${k}?`)) return;
      delete obj[k];
      renderEditor(); onEdit();
    });
    row.appendChild(del);
    g.appendChild(row);
  }
  const addRow = document.createElement("div");
  addRow.className = "kv-row";
  const keyIn = document.createElement("input");
  keyIn.type = "text";
  keyIn.placeholder = "新键名";
  if (keyOptions.length) {
    const dlId = `${fieldBase}-keys`;
    document.getElementById(dlId)?.remove();   // 移除上次渲染的同名 datalist,防同 id 无限累积
    const dl = document.createElement("datalist");
    dl.id = dlId;
    for (const k of keyOptions) {
      const o = document.createElement("option");
      o.value = k;
      dl.appendChild(o);
    }
    document.getElementById("app")!.appendChild(dl);
    keyIn.setAttribute("list", dlId);
  }
  const addBtn = document.createElement("button");
  addBtn.className = "btn mini";
  addBtn.textContent = "+ 键";
  addBtn.addEventListener("click", () => {
    const k = keyIn.value.trim();
    if (!k) { toast("请输入键名"); return; }
    if (k in obj) { toast("键已存在"); return; }
    obj[k] = 0;
    renderEditor(); onEdit();
  });
  addRow.appendChild(keyIn);
  addRow.appendChild(addBtn);
  g.appendChild(addRow);
  return g;
}

function gSettings(): HTMLElement {
  const box = document.createElement("div");
  const ae = document.createElement("input");
  ae.type = "checkbox";
  ae.checked = !!d!.settings?.auto_equip;
  ae.setAttribute("data-field", "settings.auto_equip");
  ae.addEventListener("change", () => { d!.settings.auto_equip = ae.checked; onEdit(); });
  box.appendChild(fldRow("settings.auto_equip 自动换装", ae, "settings.auto_equip"));
  box.appendChild(fldRow("settings.auto_sell_idx 自动出售档(-1关/0..5)", numInput(
    () => d!.settings?.auto_sell_idx ?? -1, v => d!.settings.auto_sell_idx = v, { int: true }), "settings.auto_sell_idx"));
  box.appendChild(fldRow("settings.speed 倍速(1..3)", numInput(
    () => d!.settings?.speed ?? 1, v => d!.settings.speed = v, { int: true }), "settings.speed"));
  return box;
}

function dangerGroup(): HTMLElement {
  const g = document.createElement("div");
  g.className = "grp";
  g.style.borderColor = "#5c2a2a";
  const h = document.createElement("h4");
  h.style.color = "#ff8a8a";
  h.textContent = "危险字段(默认锁定)";
  g.appendChild(h);
  const note = document.createElement("p");
  note.className = "danger-note";
  note.textContent = "version:错值直接触发错误迁移链;gear_rules_21:≠true 时载入即清空 equip+bag;" +
    "seed:改后随机流全部重置(不坏档,但后续随机结果全变)。";
  g.appendChild(note);
  const unlock = document.createElement("button");
  unlock.className = "btn mini warn";
  unlock.textContent = dangerUnlocked ? "已解锁(点击重新锁定)" : "解锁危险字段";
  unlock.addEventListener("click", () => {
    dangerUnlocked = !dangerUnlocked;
    renderEditor();
  });
  g.appendChild(unlock);
  if (dangerUnlocked) {
    g.appendChild(fldRow("version 存档版本", numInput(
      () => d!.version, v => d!.version = v, { int: true }), "version"));
    const gr = document.createElement("input");
    gr.type = "checkbox";
    gr.checked = d!.gear_rules_21 !== false;
    gr.setAttribute("data-field", "gear_rules_21");
    gr.addEventListener("change", () => { d!.gear_rules_21 = gr.checked; onEdit(); });
    g.appendChild(fldRow("gear_rules_21 装备规则2.1标志", gr, "gear_rules_21"));
    g.appendChild(fldRow("seed 随机种子", numInput(
      () => d!.seed, v => d!.seed = v, { int: true }), "seed"));
  } else {
    const locked = document.createElement("p");
    locked.className = "muted small";
    locked.textContent = `version=${esc(d!.version)} / gear_rules_21=${esc(d!.gear_rules_21)} / seed=${esc(d!.seed)}(只读)`;
    g.appendChild(locked);
  }
  const ls = document.createElement("p");
  ls.className = "muted small";
  ls.textContent = `last_saved = ${d!.last_saved ?? "—"}(面板不自动改写,离线收益按它结算,封顶12h)`;
  g.appendChild(ls);
  return g;
}

// ---------------------------------------------------------------- 校验
function onEdit(): void {
  if (valTimer !== undefined) clearTimeout(valTimer);
  valTimer = setTimeout(() => { refreshIssues(); renderChanged(); }, 150);
}

function refreshIssues(): void {
  if (d) {
    try { issues = validateSaveDict(d); }
    catch (e) { issues = [{ field: "(面板)", level: "error", message: `校验器异常:${(e as Error).message}` }]; }
  } else issues = [];
  const errs = issues.filter(i => i.level === "error");
  const warns = issues.filter(i => i.level === "warn");
  issuesBox.innerHTML = `<h3><span class="dot"></span>实时校验(validateSaveDict)
      <span class="badge ${errs.length ? "err" : "ok"}">${errs.length ? `${errs.length} 个 error(阻断写回)` : "无 error"}</span>
      <span class="badge">${warns.length} 个 warn</span></h3>` +
    (issues.length ? issues.map(i =>
      `<span class="issue ${i.level}" data-locate="${esc(i.field)}">${i.level === "error" ? "⛔" : "⚠"} <b>${esc(i.field)}</b> — ${esc(i.message)}</span>`).join("")
      : `<p class="muted small">${d ? "未发现问题" : "载入存档后开始校验"}</p>`);
  issuesBox.querySelectorAll("[data-locate]").forEach(n => {
    n.addEventListener("click", () => {
      const f = (n as HTMLElement).dataset.locate!;
      let probe = f;
      while (probe) {
        const el = editorBox.querySelector(`[data-field="${CSS.escape(probe)}"]`);
        if (el) {
          (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
          (el as HTMLElement).style.outline = "2px solid var(--gold)";
          setTimeout(() => ((el as HTMLElement).style.outline = ""), 1600);
          return;
        }
        const cut = probe.lastIndexOf(".");
        probe = cut > 0 ? probe.slice(0, cut) : "";
      }
      toast(`未找到 ${f} 的编辑控件(可展开对应分组查看)`);
    });
  });
}

function hasError(): boolean { return issues.some(i => i.level === "error"); }

function renderChanged(): void {
  if (!d || !base) return;
  const diff = topDiff(base, d);
  changedBox.style.display = "block";
  changedBox.innerHTML = `<h3><span class="dot"></span>本次改动(${diff.length} 个顶层字段)</h3>` +
    (diff.length ? `<table class="cmp"><tr><th>字段</th><th>载入时</th><th>现在</th></tr>` +
      diff.map(x => `<tr><td>${esc(x.key)}</td><td>${esc(x.before)}</td><td>${esc(x.after)}</td></tr>`).join("") + "</table>"
      : `<p class="muted small">尚无改动</p>`);
  renderOps();
}

function renderOps(): void {
  if (!d) return;
  const disable = hasError();
  opsBox.innerHTML = `<h3><span class="dot"></span>写回与导出(四出口${remoteUuid ? " + 远端" : ""})</h3>
    <div class="row">
      <button class="btn" id="op-download" ${disable ? "disabled" : ""}>下载存档 JSON</button>
      <button class="btn" id="op-server" ${disable ? "disabled" : ""}>写回服务器 save.json(自动备份)</button>
      <button class="btn" id="op-local" ${disable ? "disabled" : ""}>写入本浏览器存档</button>
      ${remoteUuid ? `<button class="btn" id="op-remote" ${disable ? "disabled" : ""}>写回远端玩家存档(需 token)</button>` : ""}
      <button class="btn warn" id="op-revert">放弃修改(回滚到载入原件)</button>
    </div>
    <p class="muted small">写回格式 = JSON.stringify(紧凑),与游戏 toDict 一致;未编辑字段保持原键序。</p>`;
  opsBox.querySelector("#op-download")!.addEventListener("click", () => {
    if (guard()) download(`abyss-idle-save-编辑-${stamp()}.json`, JSON.stringify(d));
  });
  opsBox.querySelector("#op-server")!.addEventListener("click", writeServer);
  opsBox.querySelector("#op-local")!.addEventListener("click", writeLocal);
  opsBox.querySelector("#op-remote")?.addEventListener("click", () => void writeRemote());
  opsBox.querySelector("#op-revert")!.addEventListener("click", () => {
    if (!raw) { toast("没有可回滚的原件"); return; }
    if (!confirm("放弃全部修改,回滚到载入时的原件?")) return;
    loadText(raw, source + "(回滚)", remoteUuid);
  });
}

function guard(): boolean {
  if (!d) { toast("尚未载入存档"); return false; }
  refreshIssues();
  if (hasError()) { toast("存在 error,先修复再写回"); return false; }
  return true;
}

async function writeServer(): Promise<void> {
  if (!guard() || !needBridge()) return;
  const diff = topDiff(base!, d!);
  if (!confirm(`写回仓库根 save.json?\n\n改动 ${diff.length} 个顶层字段:${diff.map(x => x.key).join(", ") || "(无)"}\n\n请确认 CLI 已退出(否则退出时会被覆盖)。写前自动留 .bak 备份。`)) return;
  try {
    const r = await bridgePostFile("save.json", JSON.stringify(d));
    toast(`已写回 save.json(${r.bytes} 字节${r.backup ? `,备份 ${r.backup}` : ""})`);
    renderBackupsCard();
  } catch (e) { toast(`写回失败:${(e as Error).message}`); }
}

function writeLocal(): void {
  if (!guard()) return;
  const diff = topDiff(base!, d!);
  if (!confirm(`写入 localStorage["${SAVE_KEY}"]?\n\n改动 ${diff.length} 个顶层字段:${diff.map(x => x.key).join(", ") || "(无)"}\n\n旧值将备份到 ${SAVE_KEY}.bak-<ts>。开着的游戏页(dev)会自动热重载本次写入。`)) return;
  const old = localStorage.getItem(SAVE_KEY);
  if (old !== null) localStorage.setItem(`${SAVE_KEY}.bak-${stamp()}`, old);
  localStorage.setItem(SAVE_KEY, JSON.stringify(d));
  toast(`已写入本浏览器存档(备份 ${old !== null ? "已留" : "无旧值"}),游戏页将热重载`);
}

// ---------------------------------------------------------------- 备份列表
async function renderBackupsCard(): Promise<void> {
  const box = root.querySelector("#save-backups")!;
  if (!bridgeOnline()) {
    box.innerHTML = `<h3><span class="dot"></span>服务器备份</h3><p class="muted small">dev 桥不可用:npm run dev 下可查看/一键载入 save.json 与 overrides.json 的时间戳备份。</p>`;
    return;
  }
  box.innerHTML = `<h3><span class="dot"></span>服务器备份(仓库根 *.bak-*,倒序至多 50)</h3><div class="bak-list muted small">读取中…</div>`;
  try {
    const names = await bridgeBackups();
    const list = box.querySelector(".bak-list")!;
    if (!names.length) {
      list.className = "muted small";
      list.textContent = "暂无备份文件";
      return;
    }
    list.className = "bak-list";
    list.innerHTML = "";
    for (const n of names) {
      const row = document.createElement("div");
      row.className = "row";
      const tag = document.createElement("span");
      tag.className = "small";
      tag.textContent = n;
      row.appendChild(tag);
      const load = document.createElement("button");
      load.className = "btn mini";
      load.textContent = "载入(只读恢复点)";
      load.addEventListener("click", async () => {
        try {
          const r = await bridgeGetFile(n);
          if (r.exists && r.content !== null) loadText(r.content, `备份 ${n}`);
        } catch (e) { toast(`读取备份失败:${(e as Error).message}`); }
      });
      row.appendChild(load);
      list.appendChild(row);
    }
  } catch (e) {
    box.innerHTML = `<h3><span class="dot"></span>服务器备份</h3><p class="muted small">读取失败:${esc((e as Error).message)}</p>`;
  }
}
