# 03 · API 设计与数据模型

> 前提:方案 C 代码结构。Phase 2 落地 A 形态(仅 /auth + /save),Phase 3 扩展 /state /action 走向 B 形态。

## 1. API 总览

Base:`/api`,JSON only,认证走 `Authorization: Bearer <access_token>`。

### 认证

| Method | Path | 说明 |
|--------|------|------|
| POST | /auth/register | `{email, password, display_name?}` → 201 + 双令牌 |
| POST | /auth/login | `{email, password}` → 双令牌 |
| POST | /auth/refresh | `{refresh_token}` → 新双令牌(旋转) |
| POST | /auth/logout | 吊销当前 refresh_token |
| POST | /auth/logout-all | 吊销该账号全部会话 |
| POST  | /auth/password/forgot | `{email}` → 发送重置邮件(总是返回 200 防枚举) |
| POST  | /auth/password/reset  | `{token, new_password}` |
| GET  | /auth/oauth/{provider}/start | 302 到 OAuth 授权页 |
| GET  | /auth/oauth/{provider}/callback | OAuth 回跳 → 双令牌(或要求绑定) |

### 存档(A 形态,Phase 2)

| Method | Path | 说明 |
|--------|------|------|
| GET  | /save | 拉取云存档(含 `updated_at`、`version`) |
| PUT  | /save | 上传整份存档快照;`If-Match: <updated_at>` 乐观锁,落后返回 409 |

### 权威结算(B 形态,Phase 3)

| Method | Path | 说明 |
|--------|------|------|
| GET  | /state | **懒结算**:服务器以 `now - last_resolved_at` 快进,返回权威状态 + 事件摘要(掉落/升级/死亡聚合)。幂等。 |
| POST | /action | 玩家操作:`{type: enhance|reforge|equip|unequip|skill_up|sell|set_mode|set_farm_stage, payload}`。服务器先 resolve 再执行,返回新状态与操作结果。 |
| GET  | /leaderboard | 排行榜(最深区域 / 击杀数 / 评分),Redis ZSET 缓存 60s |

### 错误格式

```json
{ "error": { "code": "GOLD_NOT_ENOUGH", "message": "金币不足 (需要 1.2万)", "detail": {...} } }
```

错误码复用游戏内 toast 文案语义(`game.py` 中各 `self.toast(...)` 分支),保证 CLI 与 Web 行为一致。

## 2. 关键交互:懒结算时序

```
客户端                          服务器
  │ GET /state?t=now              │
  │──────────────────────────────►│ characters 行加锁(SELECT ... FOR UPDATE)
  │                               │ resolve(state, now - last_resolved_at, seed)
  │                               │ 写回新状态 + last_resolved_at = now
  │◄──────────────────────────────│ { state, events, server_time }
  │ (本地表现层继续逐 tick 演出)   │
  │ POST /action {enhance:weapon} │
  │──────────────────────────────►│ resolve → apply_action → 事务提交
  │◄──────────────────────────────│ { state, result: {cost, plus} }
```

- 表现层演出("这一小时打了多少刀")由客户端 `simulate_view` 自行生成,与权威结算解耦;
- 客户端时钟只用于 UI,永不参与结算。

## 3. 存档格式演进

现状:`game.py to_dict()` 产出 `save.json`,已有 `version: 1`。演进原则:

1. **云存档 = CLI 存档超集**:顶层增加 `server` 块,其余字段保持与 CLI 同构,使 CLI / Web 互导无损;

```jsonc
{
  "version": 2,
  "server": {                       // 新增,CLI 版忽略
    "character_id": "uuid",
    "user_id": "uuid",
    "created_at": "…", "updated_at": "…",
    "last_resolved_at": "…",        // Phase 3:服务器懒结算锚点
    "playtime_validated": 123456    // 服务器累计的结算时长(防客户端虚报)
  },
  "gold": 0, "stones": 0, "level": 1, "xp": 0,
  "zone": 1, "stage": 1, "stage_kills": 0, "deaths_row": 0,
  "mode": "push", "farm_stage": 1,
  "equip": { … }, "bag": [ … ],
  "skills": { … }, "stats": { … },
  "settings": { … }, "quests": [ … ],
  "hero_hp": 0, "ema_kill": 0
}
```

2. **迁移链**:`version` 单调递增,加载时逐版本升级(现有 `Game.load()` 已按缺省值兜底,升级函数挂在 `core/migrations.py`);
3. **字段即文档**:每次改存档结构必须同步 bump version + 写迁移函数,禁止"顺手改字段名"。

## 4. 数据库模型(存档侧)

```sql
CREATE TABLE characters (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot         SMALLINT NOT NULL DEFAULT 1,
    display_name TEXT NOT NULL DEFAULT '深渊行者',
    -- 权威快照(方案 B 时代将热点数值提升为列以做校验/排行,初期整块 JSONB)
    save         JSONB NOT NULL,
    save_version INT    NOT NULL,
    -- 冗余排行/校验列(由 resolve 维护,与 save 内值一致性由服务器保证)
    level        INT NOT NULL DEFAULT 1,
    max_zone     INT NOT NULL DEFAULT 1,
    kills        BIGINT NOT NULL DEFAULT 0,
    gear_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, slot)
);
CREATE INDEX idx_char_lb_zone ON characters(max_zone DESC, updated_at DESC);
```

- A 形态:`level/max_zone/kills/gear_score` 由 PUT /save 时从 JSON 提取刷新,仅作排行榜与校验用途;
- B 形态:`save` JSONB 仍是唯一事实源,列是投影;若性能成为瓶颈再把 gold/stones 等提升为列。

审计表(所有写操作留痕,防作弊回溯用):

```sql
CREATE TABLE audit_log (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID, character_id UUID,
    action     TEXT NOT NULL,            -- save_put / resolve / enhance / reset …
    summary    JSONB,                    -- 动作关键参数(等级/区域/金币变化摘要)
    ip         INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_char ON audit_log(character_id, created_at DESC);
```

保留 180 天,滚动归档到对象存储。

## 5. Redis 用途

| Key | 类型 | 用途 |
|-----|------|------|
| `rl:<scope>:<id>`(见 04 文档) | 计数器 | 速率限制 |
| `sess:rt:<sha256>` | string(TTL) | refresh token 快速吊销检查 |
| `lb:zone` / `lb:score` | ZSET | 排行榜,60s 重建 |
| `cache:state:<char_id>` | string(JSON, 5s) | 高频 GET /state 防抖 |

MVP 可以先不用 Redis:速率限制用进程内存字典,排行榜用 SQL 定时查询。Redis 列为 Phase 3 并入。
