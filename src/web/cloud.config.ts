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
// TapTap 构建(--mode taptap)整体禁用云账号:URL/Key 均不进产物
// (2.10.1 ICP 拒审对策:TapTap 产物零自建联网端点;TT_MODE 为编译期常量,死分支被消除)
const TT_BUILD: boolean = import.meta.env.MODE === "taptap";
export const CLOUD_URL: string = TT_BUILD ? "" : "https://lnwihkmqkpgiejxbdfek.supabase.co";
export const CLOUD_KEY: string = TT_BUILD ? "" : "sb_publishable_spBYBmSdFNDH6SSsZ56y6A_KZbQl3NH";

/** 云功能是否就绪(配置齐全才启用) */
export const CLOUD_READY = CLOUD_URL !== "" && CLOUD_KEY !== "";
