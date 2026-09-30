# 02 · 账号与登录系统设计

> 范围:注册、登录、凭据、会话、找回、第三方登录、多角色、合规。实施于 Phase 2。

## 1. 需求边界

- 一个账号 = 一个邮箱 + N 个角色(MVP 取 1,字段预留 `character_slot`);
- 存档漫游:任何设备登录后拉取云存档;
- 冲突策略:服务器 `updated_at` 新者胜;客户端本地存档落后时提示覆盖(不做三方合并,放置游戏状态是整体快照);
- 不做的(MVP):邮箱验证强制、手机号、2FA、社交关系。均为后续增量。

## 2. 注册 / 登录方式

| 方式 | MVP | 说明 |
|------|-----|------|
| 邮箱 + 密码 | ✅ | 自建,argon2id 哈希,不存明文 |
| OAuth:GitHub | ✅ | 开发者受众,接入成本最低 |
| OAuth:Google | ✅(海外) | 需配置 OAuth2 consent |
| OAuth:微信 / QQ | ⏳ Phase 4 | 面向国内运营时再做(涉及开放平台企业资质) |
| 手机号 + 短信 | ❌ 暂不 | 成本高、实名链条敏感,见 §6 |

**邮箱不强制验证即可玩**(降低流失),但未验证邮箱不能:改密码、绑 OAuth、恢复账号。验证邮件走 Resend/SendGrid 免费档。

## 3. 密码与凭据存储

- 哈希:**argon2id**(`argon2-cffi`),参数:m=64MB, t=3, p=1(OWASP 2024 推荐);
- 禁止密码:user 表只存 `password_hash`,任何接口不回显;
- 登录失败:同账号 5 次/15 分钟锁定,同 IP 20 次/小时限流(04 文档详述);
- 找回密码:一次性 token(随机 32 字节,SHA-256 存库,15 分钟过期,用过即焚),邮件链接形式。

## 4. 会话:JWT 双令牌

```
POST /api/auth/login
  → { access_token(JWT, 15min), refresh_token(opaque, 30d, 存库可吊销) }
```

- access_token 载荷:`{ sub: user_id, iat, exp }`,**不含角色数据**;签名 HS256 起步(单实例),多实例后换 RS256/EdDSA 或统一密钥分发;
- refresh_token:服务端存哈希 + 设备指纹(UA 摘要),支持"登出所有设备";
- 所有业务接口只认 `Authorization: Bearer <access_token>`;
- 为什么不用纯服务器 session:MVP 单实例 session 最简单,但计划里明确要多端漫游与未来 WebSocket,JWT 免去会话黏连,成本可接受。

## 5. 数据模型(账号侧)

```sql
-- users:账号主体
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT UNIQUE,                -- OAuth-only 用户可为 NULL
    password_hash TEXT,                          -- argon2id;OAuth-only 为 NULL
    display_name  TEXT NOT NULL,                 -- 默认 = email 前缀
    email_verified_at TIMZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    status        SMALLINT NOT NULL DEFAULT 1    -- 1正常 2锁定 3注销
);

-- oauth_identities:第三方身份(一个 user 可绑多个)
CREATE TABLE oauth_identities (
    provider    TEXT NOT NULL,                   -- github / google / wechat
    provider_uid TEXT NOT NULL,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_uid)
);

-- refresh_tokens:可吊销会话
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,                   -- SHA-256(明文 token)
    device_hint TEXT,                            -- UA 摘要,用于"管理在线设备"
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- password_resets / email_verifications:一次性 token 表(结构同 refresh_tokens,省略)
```

角色表 `characters`(存档侧)见 [03-api-and-data.md](03-api-and-data.md)。

**绑定流程**:OAuth 首次登录无账号 → 询问"绑定已有邮箱账号 or 新建";绑定需输入密码验证所有权。防止邮箱被抢注:注册时若邮箱未验证,OAuth 同邮箱不自动合并,必须显式绑定。

## 6. 合规红线(重要,先想清楚再动工)

面向**中国大陆公众**运营的"通过网络提供的在线游戏服务",需要:

1. **ICP 备案**(域名 + 服务器均在境内时);
2. **网络游戏版号**(新闻出版署审批)——个人开发者短期内无法取得;无版号运营属违法;
3. **实名认证 + 防沉迷**(接公安/运营商实名接口,未成年人限时充值);
4. **个人信息保护法**合规(隐私政策、最小化收集、可注销)。

**本项目的默认选择:海外托管**(Fly.io/Render + Neon,域名免备案),用户协议注明"非面向中国大陆运营"。这样账号系统只需满足通用隐私合规(GDPR 基线):
- 隐私政策页 + 注册勾选;
- 只收集:邮箱、加密凭据、游戏进度、登录 IP(安全审计,保留 90 天);
- 提供"导出我的数据"与"注销账号"接口(删除 = 软删 30 天后物理清除);
- 若未来确要国内运营,需以公司主体重走备案/版号流程,并把实名/防沉迷列为 Phase 前置条件——**这属于商业决策,不属于本技术规划**。

## 7. 多角色与存档迁移(从 CLI 到云)

- CLI 本地 `save.json` → Web 首次登录提供"导入本地存档"入口(Phase 1 的 Pyodide 版可直接读 localStorage;CLI 玩家手动上传文件);
- 导入校验:走 04 文档的合理性校验(等级/区域/金币 vs 时长的包络检查),超出包络拒绝并提示;
- 一个账号 MVP 1 个角色;存档槽扩展时按 `characters.user_id + slot` 唯一。
