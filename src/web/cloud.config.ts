/** 云账号配置(Supabase)。
 *
 * 接入步骤见 scripts/cloud-schema.sql 头部说明:
 *   1. supabase.com 建项目(免费档);
 *   2. SQL Editor 粘贴执行 scripts/cloud-schema.sql(建表 + RLS);
 *   3. 把下面的 URL 与 anon key 填上(anon key 公开安全,防线在 RLS);
 *   4. Authentication → URL Configuration:Site URL 填
 *      https://red-dust-dreamer.github.io/Everdown/
 *   5.(可选)Authentication → Providers 开 GitHub/Google OAuth。
 *
 * 两项任一为空 = 云功能整体禁用:设置页不显示账号区块,游戏完全本地。
 */
// 显式 string 类型:留空即禁用云功能的运行时判断,不被 TS 字面量收窄判死
export const CLOUD_URL: string = "https://lnwihkmqkpgiejxbdfek.supabase.co";
export const CLOUD_KEY: string = "sb_publishable_spBYBmSdFNDH6SSsZ56y6A_KZbQl3NH";

/** 云功能是否就绪(配置齐全才启用) */
export const CLOUD_READY = CLOUD_URL !== "" && CLOUD_KEY !== "";
