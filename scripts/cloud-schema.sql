-- =====================================================================
-- 云存档表(Supabase)· 在 SQL Editor 里整段执行一次
--
-- 接入清单:
--   1. supabase.com 建项目(免费档即可,区域选 Singapore/US 均可);
--   2. 执行本文件;
--   3. Project Settings → API:把 Project URL 与 anon key 填进
--      src/web/cloud.config.ts(两项填齐后云功能自动启用);
--   4. Authentication → URL Configuration:
--        Site URL = https://red-dust-dreamer.github.io/Everdown/
--        Redirect URLs 加同地址( OAuth 回跳用);
--   5. 建议 Authentication → Providers → Email:
--        关闭 "Confirm email"(对齐 docs/02「邮箱不强制验证即可玩」);
--   6.(可选)开 GitHub OAuth:GitHub 建 OAuth App,
--      callback 用 Supabase 提供的回调地址,把 id/secret 填回控制台。
--
-- 安全:anon key 公开无妨——下方 RLS 保证每个登录用户只能读写自己那行。
-- =====================================================================

-- 存档表:一个用户一行,整份快照(放置游戏状态为整体快照,不做字段级合并)
create table if not exists saves (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    data       jsonb not null,
    updated_at timestamptz not null default now()
);

-- 行级安全:仅本人可读写自己的存档
alter table saves enable row level security;

drop policy if exists "saves own row" on saves;
create policy "saves own row"
  on saves
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- SQL Editor 建表不会自动授予 API 角色(否则 REST 报 permission denied)
grant select, insert, update, delete on public.saves to anon, authenticated;
