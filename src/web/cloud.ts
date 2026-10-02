/** 云账号与存档同步(Supabase 托管;静态站直连,防线在 RLS 行级安全)。
 *
 * 设计要点:
 * - 未配置(CLOUD_READY=false)时所有 API 无害 no-op,游戏纯本地;
 * - 游客模式永远可用:登录与否不影响本地 localStorage 存档;
 * - 冲突策略沿用 docs/02:整体快照、不三方合并,按 last_saved 新者胜,覆盖前必经玩家确认;
 * - 上传走 debounce,跟随 autosave 节奏,不额外产生写放大。
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { CLOUD_READY, CLOUD_URL, CLOUD_KEY } from "./cloud.config.ts";

export interface CloudUser { email: string | null; name: string }
export interface CloudState {
  ready: boolean;
  user: CloudUser | null;
  syncing: boolean;
  lastSyncMs: number | null;    // 最近一次成功上传
  error: string | null;
}

let client: SupabaseClient | null = null;
let uid = "";   // 当前登录用户 id(applySession 维护)
const listeners = new Set<(s: CloudState) => void>();
export const cloudState: CloudState = {
  ready: CLOUD_READY, user: null, syncing: false, lastSyncMs: null, error: null,
};

function emit(): void {
  for (const fn of listeners) fn({ ...cloudState });
}
export function onCloudState(fn: (s: CloudState) => void): () => void {
  listeners.add(fn);
  fn({ ...cloudState });
  return () => listeners.delete(fn);
}

function sb(): SupabaseClient | null {
  if (!CLOUD_READY) return null;
  if (!client) client = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: true } });
  return client;
}

/** 启动:恢复会话 + 监听变化(OAuth 回跳也在 detectSessionInUrl 里自动处理) */
export async function initCloud(onLogin: () => void): Promise<void> {
  const c = sb();
  if (!c) return;
  const { data } = await c.auth.getSession();
  applySession(data.session);
  c.auth.onAuthStateChange((_event, session) => {
    const wasNull = cloudState.user === null;
    applySession(session);
    if (session && wasNull) onLogin();   // 登录瞬间触发同步流程
  });
}

function applySession(session: Session | null): void {
  if (session?.user) {
    const email = session.user.email ?? null;
    uid = session.user.id;
    cloudState.user = { email, name: (email ?? "玩家").split("@")[0] };
  } else {
    uid = "";
    cloudState.user = null;
  }
  cloudState.error = null;
  emit();
}

// ---------------------------------------------------------------- 认证动作
export async function signInEmail(email: string, password: string): Promise<string | null> {
  const c = sb();
  if (!c) return "云功能未配置";
  const { error } = await c.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signUpEmail(email: string, password: string): Promise<string | null> {
  const c = sb();
  if (!c) return "云功能未配置";
  const { error } = await c.auth.signUp({ email, password });
  // 项目若开启邮箱验证,Supabase 会返回"检查邮件"类提示而非错误,一并透传
  return error ? error.message : null;
}

export async function signInGitHub(): Promise<string | null> {
  const c = sb();
  if (!c) return "云功能未配置";
  const { error } = await c.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: location.origin + location.pathname },
  });
  return error ? error.message : null;
}

export async function signOutCloud(): Promise<void> {
  const c = sb();
  if (!c) return;
  await c.auth.signOut();
  cloudState.lastSyncMs = null;
  emit();
}

// ---------------------------------------------------------------- 存档同步
export interface RemoteSave { data: Record<string, unknown>; updatedAt: string }

/** 拉取云端存档;无返回 null */
export async function pullSave(): Promise<RemoteSave | null | string> {
  const c = sb();
  if (!c || !cloudState.user) return "未登录";
  const { data, error } = await c.from("saves")
    .select("data, updated_at").eq("user_id", uid).maybeSingle();
  if (error) return error.message;
  if (!data) return null;
  return { data: data.data as Record<string, unknown>, updatedAt: data.updated_at as string };
}

/** 上传本地存档(upsert 整份快照) */
export async function pushSave(dict: Record<string, unknown>): Promise<string | null> {
  const c = sb();
  if (!c || !cloudState.user) return "未登录";
  cloudState.syncing = true;
  emit();
  const { error } = await c.from("saves").upsert({
    user_id: uid,
    data: dict,
    updated_at: new Date().toISOString(),
  });
  cloudState.syncing = false;
  if (error) { cloudState.error = error.message; emit(); return error.message; }
  cloudState.lastSyncMs = Date.now();
  cloudState.error = null;
  emit();
  return null;
}
