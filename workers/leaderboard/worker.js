// 深渊挂机 · 匿名排行榜 API(Cloudflare Workers + D1)
// 规则(2026-10-02 与用户确认):
//   - 三个榜:主线榜 zone(最远区域)/ 等级榜 level / 爬塔榜 tower(深渊塔最高层);
//     平局次序键 = 击杀数 → 先到者
//   - 每榜只保留 Top 50,匿名不落榜不留数据(落榜即删)
//   - 不在榜也返回估算名次(COUNT 比我高者 + 1)
//   - 防线:结构校验(数值范围/格式/自洽)+ 昵称过滤 + UUID 小时限流
//   - 战力榜(power)为预留枚举,战力系统上线后开放
const BOARDS = ["zone", "level", "tower"];
const TOP_N = 50;
const RATE_PER_HOUR = 12;               // 每 UUID 每小时提交上限
const NAME_MAX = 12;
// 基础敏感词(可按需扩充;命中则改用默认名)
const BAD_WORDS = ["外挂", "代练", "加群", "vx", "wechat", "http", "www", ".com", "fuck", "shit"];

const CORS = {
  "Access-Control-Allow-Origin": "*",   // 匿名只读榜单 + 无凭据提交,放开来源
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    let out, status = 200;
    try {
      if (url.pathname === "/board" && request.method === "GET") {
        out = await getBoard(env, url.searchParams);
      } else if (url.pathname === "/submit" && request.method === "POST") {
        const r = await submit(env, await request.json());
        out = r.body; status = r.status;
      } else {
        out = { error: "not found" }; status = 404;
      }
    } catch (e) {
      out = { error: String((e && e.message) || e) }; status = 400;
    }
    return new Response(JSON.stringify(out),
      { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  },
};

// ---------------------------------------------------------------- 校验
function intOrNull(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return (i >= lo && i <= hi) ? i : null;   // 越界视为非法,丢弃提交
}
const UUID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

function cleanName(raw) {
  let s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const low = s.toLowerCase();
  for (const w of BAD_WORDS) if (low.includes(w)) return "";
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX);
  return s;
}

async function checkRate(env, uuid) {
  const bucket = Math.floor(Date.now() / 3600_000);   // 小时桶
  const r = await env.DB.prepare(
    "INSERT INTO rate (key, bucket, n) VALUES (?, ?, 1) " +
    "ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(`${uuid}:${bucket}`, bucket).first();
  if (r && r.n === 1)   // 本 UUID 本小时首次提交:顺带清理过期桶
    await env.DB.prepare("DELETE FROM rate WHERE bucket < ?").bind(bucket - 2).run();
  return !r || r.n <= RATE_PER_HOUR;
}

// ---------------------------------------------------------------- 读榜
async function getBoard(env, params) {
  const board = params.get("b") ?? "";
  if (!BOARDS.includes(board)) return { error: "bad board" };
  const uuid = params.get("uuid") ?? "";
  const top = await env.DB.prepare(
    "SELECT uuid, name, score, kills, playtime, level, max_zone, updated_at " +
    "FROM entries WHERE board = ? " +
    "ORDER BY score DESC, kills DESC, updated_at ASC LIMIT ?"
  ).bind(board, TOP_N).all();
  const rows = (top.results ?? []).map(r => {
    const { uuid: rowUuid, ...rest } = r;
    return { ...rest, is_me: rowUuid === uuid };   // 只回传 is_me,不外泄他人 uuid
  });
  let you = null;
  if (UUID_RE.test(uuid)) {
    const mine = await fullRow(env, board, uuid);
    if (mine) {
      you = { rank: await rankOf(env, board, mine.score, mine.kills),
              inTop: true, score: mine.score, kills: mine.kills };
    }
  }
  return { board, top: rows, you };
}

// ---------------------------------------------------------------- 提交
async function submit(env, body) {
  const board = String(body.board ?? "");
  if (!BOARDS.includes(board)) return { body: { error: "bad board" }, status: 400 };
  const uuid = String(body.uuid ?? "");
  if (!UUID_RE.test(uuid)) return { body: { error: "bad uuid" }, status: 400 };

  // 结构校验:宽范围硬上限,拦"物理不可能"的离谱值(第一版;seed 重放复核为后续项)
  const score = intOrNull(body.score, 1, 100_000);
  const kills = intOrNull(body.kills, 0, 1_000_000_000);
  const playtime = intOrNull(body.playtime, 0, 3.2e10);        // ≤1000 年
  const level = intOrNull(body.level, 1, 5_000);
  const max_zone = intOrNull(body.max_zone, 1, 10_000);
  const max_tower = intOrNull(body.max_tower ?? 0, 0, 100_000);
  if ([score, kills, playtime, level, max_zone, max_tower].some(v => v === null))
    return { body: { error: "bad values" }, status: 400 };
  // 自洽:score 与对应主数据一致(tower 榜要求 max_tower ≥ 1,即已通至少一层)
  if ((board === "zone" && score !== max_zone) ||
      (board === "level" && score !== level) ||
      (board === "tower" && score !== max_tower))
    return { body: { error: "score mismatch" }, status: 400 };

  if (!(await checkRate(env, uuid)))
    return { body: { error: "rate limited" }, status: 429 };

  const name = cleanName(body.name) || `深渊行者#${uuid.slice(0, 4).toUpperCase()}`;
  const now = Date.now();

  // 榜内已有自己且新分更低:不覆盖(只升不降,防误提交掉分)
  const mine = await fullRow(env, board, uuid);
  if (mine && score < mine.score) {
    return { body: { rank: await rankOf(env, board, mine.score, mine.kills),
                     inTop: true, updated: false }, status: 200 };
  }

  // 是否够格进 Top50
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entries WHERE board = ?").bind(board).first();
  let qualified = (cnt?.n ?? 0) < TOP_N;
  if (!qualified) {
    const lowest = await env.DB.prepare(
      "SELECT score, kills FROM entries WHERE board = ? " +
      "ORDER BY score DESC, kills DESC, updated_at ASC LIMIT 1 OFFSET ?"
    ).bind(board, TOP_N - 1).first();
    qualified = score > lowest.score ||
                (score === lowest.score && kills > lowest.kills);
  }

  if (qualified) {
    await env.DB.prepare(
      "INSERT INTO entries (board, uuid, name, score, kills, playtime, level, max_zone, max_tower, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(board, uuid) DO UPDATE SET " +
      "name = excluded.name, score = excluded.score, kills = excluded.kills, " +
      "playtime = excluded.playtime, level = excluded.level, " +
      "max_zone = excluded.max_zone, max_tower = excluded.max_tower, updated_at = excluded.updated_at"
    ).bind(board, uuid, name, score, kills, playtime, level, max_zone, max_tower, now).run();
    // 裁剪:只留 Top50(落榜即删——匿名不留数据)
    await env.DB.prepare(
      "DELETE FROM entries WHERE board = ? AND rowid NOT IN (" +
      "  SELECT rowid FROM entries WHERE board = ? " +
      "  ORDER BY score DESC, kills DESC, updated_at ASC LIMIT ?)"
    ).bind(board, board, TOP_N).run();
  }

  const rank = await rankOf(env, board, score, kills);
  return { body: { rank, inTop: qualified && rank <= TOP_N, updated: qualified }, status: 200 };
}

async function fullRow(env, board, uuid) {
  return env.DB.prepare(
    "SELECT score, kills FROM entries WHERE board = ? AND uuid = ?"
  ).bind(board, uuid).first();
}
async function rankOf(env, board, score, kills) {
  const higher = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entries WHERE board = ? " +
    "AND (score > ? OR (score = ? AND kills > ?))"
  ).bind(board, score, score, kills).first();
  return (higher?.n ?? 0) + 1;
}
