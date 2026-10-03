/// <reference lib="dom" />
/** 管理面板 · 共享工具与常量(DOM/格式化/下载;面板侧自己写死的共享常量见此文件) */
import type { OverrideValue } from "../../core/overrides.ts";

/** localStorage 覆盖键(契约 §7.E:面板写、核心侧 main.ts 只读;
 *  值必须是 serializeOverrideFile() 的输出原文,不是裸 values 对象) */
export const OVR_KEY = "abyss_admin_overrides_v1";
/** localStorage 游戏存档键(与 src/web/main.ts:40 同名;写前备份到 <key>.bak-<ts>) */
export const SAVE_KEY = "abyss_save_v2";

/** 备份名时间戳:YYYYMMDD-HHMMSS(本地时间,契约 §7.E) */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}

/** 中文计数:万/亿/兆/京(与游戏 UI 同口径) */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0; n = Math.abs(n);
  for (const [div, suf] of [[1e16, "京"], [1e12, "兆"], [1e8, "亿"], [1e4, "万"]] as const) {
    if (n >= div) return (neg ? "-" : "") + (n / div).toFixed(2) + suf;
  }
  return (neg ? "-" : "") + (Number.isInteger(n) ? String(n) : +n.toFixed(2));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  let el = document.getElementById("admin-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "admin-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove("show"), 2600);
}

/** 触发浏览器下载(utf8 文本) */
export function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 深拷贝(存档字典均为 JSON 可序列化数据) */
export function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 顶层键级 diff:a/b 两个字典,返回变更键与两侧 JSON 摘要 */
export function topDiff(a: Record<string, any>, b: Record<string, any>):
  { key: string; before: string; after: string }[] {
  const out: { key: string; before: string; after: string }[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const ja = JSON.stringify(a[k]), jb = JSON.stringify(b[k]);
    if (ja !== jb) out.push({
      key: k,
      before: ja === undefined ? "(缺失)" : trunc(ja),
      after: jb === undefined ? "(缺失)" : trunc(jb),
    });
  }
  return out;
}
function trunc(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 按 OverrideValue 类型把输入控件值规整为目标类型(number 叶子必须产出有限数字) */
export function coerceInput(raw: string, like: OverrideValue): OverrideValue | null {
  if (typeof like === "number") {
    const t = raw.trim();
    if (t === "") return null;   // 清空/纯空白视为非法,不静默置 0(Number("")===0)
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }
  if (typeof like === "boolean") return raw === "true";
  return raw;
}

export function valTxt(v: unknown): string {
  if (typeof v === "number") return String(+v.toFixed(4));
  return String(v);
}
