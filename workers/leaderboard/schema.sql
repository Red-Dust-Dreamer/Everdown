-- 深渊挂机 · 排行榜 D1 表结构
-- 每榜仅存 Top50(提交时裁剪),匿名不留落榜数据;rate 表为 UUID 小时限流计数。
CREATE TABLE IF NOT EXISTS entries (
  board      TEXT    NOT NULL,          -- 'zone' | 'level' | 'tower' | 'power'(战力榜,2026-10-02 开放)
  uuid       TEXT    NOT NULL,          -- 客户端匿名 UUID(localStorage)
  name       TEXT    NOT NULL,          -- 昵称(服务端已过滤,≤12字)
  score      INTEGER NOT NULL,          -- zone=最远区域 / level=等级 / power=综合战力
  kills      INTEGER NOT NULL DEFAULT 0,-- 平局次序键
  playtime   INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 1,
  max_zone   INTEGER NOT NULL DEFAULT 1,
  max_tower  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (board, uuid)
);
CREATE INDEX IF NOT EXISTS idx_board_rank
  ON entries(board, score DESC, kills DESC, updated_at ASC);

-- 周榜(2.3):每 uuid 每榜每周至多一行(跨周覆盖);终身榜仍在 entries
CREATE TABLE IF NOT EXISTS entries_weekly (
  board      TEXT    NOT NULL,
  uuid       TEXT    NOT NULL,
  week       TEXT    NOT NULL,           -- ISO 周标识,如 '2026-W41'(周一为界)
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  kills      INTEGER NOT NULL DEFAULT 0,
  playtime   INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 1,
  max_zone   INTEGER NOT NULL DEFAULT 1,
  max_tower  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (board, uuid)
);
CREATE INDEX IF NOT EXISTS idx_weekly_rank
  ON entries_weekly(week, board, score DESC, kills DESC);

CREATE TABLE IF NOT EXISTS rate (
  key    TEXT    NOT NULL PRIMARY KEY,  -- '{uuid}:{小时桶}'
  bucket INTEGER NOT NULL,
  n      INTEGER NOT NULL
);

-- uuid 首见时刻(语义包络:playtime ≤ 首见至今墙钟 + 离线宽限)
CREATE TABLE IF NOT EXISTS first_seen (
  uuid TEXT    NOT NULL PRIMARY KEY,
  ts   INTEGER NOT NULL
);

-- 存档周期上云(玩家端整份存档快照,每 uuid 仅存最新一版;/save-sync)
CREATE TABLE IF NOT EXISTS save_sync (
  uuid       TEXT    NOT NULL PRIMARY KEY,
  name       TEXT    NOT NULL,
  save_json  TEXT    NOT NULL,        -- 整份存档 JSON(≤60KB)
  playtime   INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 1,
  kills      INTEGER NOT NULL DEFAULT 0,
  max_zone   INTEGER NOT NULL DEFAULT 1,
  max_tower  INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
