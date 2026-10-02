// 深渊挂机 · 匿名排行榜 API —— 阿里云 ECS 版(零依赖,Node ≥ 23.4 自带 node:sqlite)
// 与 workers/leaderboard/worker.js 逻辑逐行同构:四榜/Top50/小时限流/只升不降/
// 估算名次/昵称过滤/结构校验;数据存同目录 leaderboard.db(备份 = 复制该文件)。
//
// 部署(阿里云 ECS):
//   1. 安全组放行自定义 TCP 端口 8787(入方向,源 0.0.0.0/0)
//   2. 安装 Node ≥ 23.4(22 需 --experimental-sqlite);scp 本文件上服务器
//   3. 启动: PORT=8787 node server.js   (常驻用 systemd 或 nohup,见 README)
//   4. 客户端构建: VITE_LB_API=http://<公网IP>:8787 npx vite build
//      (注意:HTTPS 页面(如 github.io)不能拉 http 接口——Web 版继续用 workers.dev,
//       本端点给 APK/TapTap 构建(native WebView 无混合内容限制)或后续配域名+证书用)
//
// 健康检查: GET /healthz → {ok:true, boards:4}

"use strict";
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || __dirname + "/leaderboard.db";

// ---------------------------------------------------------------- 规则(与 worker.js 同)
const BOARDS = ["zone", "level", "tower", "power"];
const TOP_N = 50;
const RATE_PER_HOUR = 12;
const NAME_MAX = 12;
const SCORE_MAX = { power: 100_000_000, default: 100_000 };
const BAD_WORDS = ["外挂", "代练", "加群", "vx", "wechat", "http", "www", ".com", "fuck", "shit"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---------------------------------------------------------------- 数据库
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  board TEXT NOT NULL, uuid TEXT NOT NULL,
  name TEXT NOT NULL, score INTEGER NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0, playtime INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1, max_zone INTEGER NOT NULL DEFAULT 1,
  max_tower INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY (board, uuid)
);
CREATE INDEX IF NOT EXISTS idx_entries_rank ON entries(board, score DESC, kills DESC);
CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, n INTEGER NOT NULL
);
`);

// ---------------------------------------------------------------- 校验(与 worker.js 同)
function intOrNull(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return (i >= lo && i <= hi) ? i : null;
}
const UUID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

function cleanName(raw) {
  let s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const low = s.toLowerCase();
  for (const w of BAD_WORDS) if (low.includes(w)) return "";
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX);
  return s;
}

function checkRate(uuid) {
  const bucket = Math.floor(Date.now() / 3600_000);
  const r = db.prepare(
    "INSERT INTO rate (key, bucket, n) VALUES (?, ?, 1) " +
    "ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n"
  ).get(`${uuid}:${bucket}`, bucket);
  if (r && r.n === 1)
    db.prepare("DELETE FROM rate WHERE bucket < ?").run(bucket - 2);
  return !r || r.n <= RATE_PER_HOUR;
}

// ---------------------------------------------------------------- 读榜(与 worker.js 同)
function getBoard(params) {
  const board = params.get("b") ?? "";
  if (!BOARDS.includes(board)) return { body: { error: "bad board" }, status: 400 };
  const uuid = params.get("uuid") ?? "";
  const top = db.prepare(
    "SELECT uuid, name, score, kills, playtime, level, max_zone, updated_at " +
    "FROM entries WHERE board = ? " +
    "ORDER BY score DESC, kills DESC, updated_at ASC LIMIT ?"
  ).all(board, TOP_N);
  const rows = top.map(r => {
    const { uuid: rowUuid, ...rest } = r;
    return { ...rest, is_me: rowUuid === uuid };   // 只回传 is_me,不外泄他人 uuid
  });
  let you = null;
  if (UUID_RE.test(uuid)) {
    const mine = fullRow(board, uuid);
    if (mine) {
      you = { rank: rankOf(board, mine.score, mine.kills),
              inTop: true, score: mine.score, kills: mine.kills };
    }
  }
  return { body: { board, top: rows, you }, status: 200 };
}

// ---------------------------------------------------------------- 提交(与 worker.js 同)
function submit(body) {
  const board = String(body.board ?? "");
  if (!BOARDS.includes(board)) return { body: { error: "bad board" }, status: 400 };
  const uuid = String(body.uuid ?? "");
  if (!UUID_RE.test(uuid)) return { body: { error: "bad uuid" }, status: 400 };

  const score = intOrNull(body.score, 1, board === "power" ? SCORE_MAX.power : SCORE_MAX.default);
  const kills = intOrNull(body.kills, 0, 1_000_000_000);
  const playtime = intOrNull(body.playtime, 0, 3.2e10);
  const level = intOrNull(body.level, 1, 5_000);
  const max_zone = intOrNull(body.max_zone, 1, 10_000);
  const max_tower = intOrNull(body.max_tower ?? 0, 0, 100_000);
  if ([score, kills, playtime, level, max_zone, max_tower].some(v => v === null))
    return { body: { error: "bad values" }, status: 400 };
  if ((board === "zone" && score !== max_zone) ||
      (board === "level" && score !== level) ||
      (board === "tower" && score !== max_tower))
    return { body: { error: "score mismatch" }, status: 400 };

  if (!checkRate(uuid))
    return { body: { error: "rate limited" }, status: 429 };

  const name = cleanName(body.name) || `深渊行者#${uuid.slice(0, 4).toUpperCase()}`;
  const now = Date.now();

  const mine = fullRow(board, uuid);
  if (mine && score < mine.score) {
    return { body: { rank: rankOf(board, mine.score, mine.kills),
                     inTop: true, updated: false }, status: 200 };
  }

  const cnt = db.prepare(
    "SELECT COUNT(*) AS n FROM entries WHERE board = ?").get(board);
  let qualified = (cnt?.n ?? 0) < TOP_N;
  if (!qualified) {
    const lowest = db.prepare(
      "SELECT score, kills FROM entries WHERE board = ? " +
      "ORDER BY score DESC, kills DESC, updated_at ASC LIMIT 1 OFFSET ?"
    ).get(board, TOP_N - 1);
    qualified = score > lowest.score ||
                (score === lowest.score && kills > lowest.kills);
  }

  if (qualified) {
    db.prepare(
      "INSERT INTO entries (board, uuid, name, score, kills, playtime, level, max_zone, max_tower, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(board, uuid) DO UPDATE SET " +
      "name = excluded.name, score = excluded.score, kills = excluded.kills, " +
      "playtime = excluded.playtime, level = excluded.level, " +
      "max_zone = excluded.max_zone, max_tower = excluded.max_tower, updated_at = excluded.updated_at"
    ).run(board, uuid, name, score, kills, playtime, level, max_zone, max_tower, now);
    db.prepare(
      "DELETE FROM entries WHERE board = ? AND rowid NOT IN (" +
      "  SELECT rowid FROM entries WHERE board = ? " +
      "  ORDER BY score DESC, kills DESC, updated_at ASC LIMIT ?)"
    ).run(board, board, TOP_N);
  }

  const rank = rankOf(board, score, kills);
  return { body: { rank, inTop: qualified && rank <= TOP_N, updated: qualified }, status: 200 };
}

function fullRow(board, uuid) {
  return db.prepare(
    "SELECT score, kills FROM entries WHERE board = ? AND uuid = ?"
  ).get(board, uuid) || null;
}
function rankOf(board, score, kills) {
  const higher = db.prepare(
    "SELECT COUNT(*) AS n FROM entries WHERE board = ? " +
    "AND (score > ? OR (score = ? AND kills > ?))"
  ).get(board, score, score, kills);
  return (higher?.n ?? 0) + 1;
}

// ---------------------------------------------------------------- HTTP
const server = http.createServer((req, res) => {
  const json = (out, status) => res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(out));
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/healthz" && req.method === "GET")
      return json({ ok: true, boards: BOARDS.length, uptime: Math.round(process.uptime()) }, 200);
    if (url.pathname === "/board" && req.method === "GET") {
      const r = getBoard(url.searchParams);
      return json(r.body, r.status);
    }
    if (url.pathname === "/submit" && req.method === "POST") {
      let buf = "";
      req.on("data", c => { buf += c; if (buf.length > 64 * 1024) req.destroy(); });   // 64KB 上限
      req.on("end", () => {
        try { const r = submit(JSON.parse(buf || "{}")); json(r.body, r.status); }
        catch (e) { json({ error: String((e && e.message) || e) }, 400); }
      });
      return;
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 400);
  }
});
server.listen(PORT, () => console.log(`[leaderboard] listening on :${PORT} (db=${DB_PATH})`));
