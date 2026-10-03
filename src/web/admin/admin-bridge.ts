/// <reference lib="dom" />
/** 管理面板 · dev 桥客户端:探测 vite adminDevBridge() 插件(vite.config.ts,apply:"serve")。
 *  探测不到(vite preview / 线上产物 / 直接打开文件)时自动降级:
 *  服务器文件按钮禁用,仅保留 localStorage / 文件导入导出路径。 */
import { toast } from "./admin-dom.ts";

export interface BridgeFile { ok: boolean; exists: boolean; content: string | null }
export interface BridgeWrite { ok: boolean; bytes: number; backup: string | null }

let online = false;

export function bridgeOnline(): boolean { return online; }

export async function probeBridge(): Promise<boolean> {
  try {
    const r = await fetch("/__admin/health", { cache: "no-store" });
    const j = await r.json() as { bridge?: string };
    online = r.ok && j?.bridge === "v1";
  } catch {
    online = false;
  }
  const badge = document.getElementById("bridge-badge");
  if (badge) {
    badge.textContent = online ? "dev 桥:已连接" : "dev 桥:不可用(仅本地功能)";
    badge.classList.toggle("ok", online);
  }
  return online;
}

export async function bridgeGetFile(name: string): Promise<BridgeFile> {
  const r = await fetch(`/__admin/file?name=${encodeURIComponent(name)}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as BridgeFile;
}

export async function bridgeBackups(): Promise<string[]> {
  const r = await fetch("/__admin/backups", { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return (j.names ?? []) as string[];
}

export async function bridgePostFile(name: string, text: string): Promise<BridgeWrite> {
  const r = await fetch(`/__admin/file?name=${encodeURIComponent(name)}`, {
    method: "POST", body: text,
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as BridgeWrite;
}

/** 桥不可用时统一提示(调用方在按钮禁用之外的双保险) */
export function needBridge(): boolean {
  if (!online) {
    toast("dev 桥不可用:请用 npm run dev 打开面板(仅本地功能可用)");
    return false;
  }
  return true;
}
