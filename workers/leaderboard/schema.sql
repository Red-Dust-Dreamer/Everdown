-- 深渊挂机 · 排行榜 D1 表结构
-- 每榜仅存 Top50(提交时裁剪),匿名不留落榜数据;rate 表为 UUID 小时限流计数。
CREATE TABLE IF NOT EXISTS entries (
  board      TEXT    NOT NULL,          -- 'zone' | 'level' | 'tower'('power' 预留)
  uuid       TEXT    NOT NULL,          -- 客户端匿名 UUID(localStorage)
  name       TEXT    NOT NULL,          -- 昵称(服务端已过滤,≤12字)
  score      INTEGER NOT NULL,          -- zone=最远区域 / level=等级
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

CREATE TABLE IF NOT EXISTS rate (
  key    TEXT    NOT NULL PRIMARY KEY,  -- '{uuid}:{小时桶}'
  bucket INTEGER NOT NULL,
  n      INTEGER NOT NULL
);
