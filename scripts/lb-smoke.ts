/** 排行榜语义校验集成冒烟(固定验收命令):
 *
 *   node --experimental-strip-types scripts/lb-smoke.ts    # 退出码 0 判过
 *
 * 覆盖:
 *   A 起 ECS 服务(临时 DB,固定端口 18471)→ healthz 就绪
 *   B 合法提交通过;七类"物理不可能"提交被拒:level/kills/zone/tower/power/playtime(首见墙钟)/
 *     playtime-delta(增量;用 sqlite 把首见与上次提交回溯 40 天后触发)
 *   C 双端托管块(LB_BOUNDS)逐字节一致 + worker.js 可作为 ESM 导入
 *   D main.ts 覆盖键读取位于 IS_DEV 门禁内;dist 生产包(若存在)不含覆盖键/热通道
 *   E save-sync(S14-S18):玩家存档上行通过、同样受包络约束、管理 token 读取/写回、独立限流
 *   F 周榜(S19-S21):平行于终身榜,提交双写,同周只升不降
 *   G 世界BOSS·周轮合力(S22-S24):/boss 首建轮与只升不降、伤害包络、scope=boss 独立限流;
 *     双端三表(含 arena_snaps)与端点逻辑静态断言、world_boss_dmg_cap_k 字样门禁
 *   H 异步切磋(S28-S30):快照上行合法/浅校验(4KB/形状)/power 包络/对手脱 uuid/
 *     scope=arena 独立限流;三处同步检查并入 S26(world-boss 同组断言)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const PORT = 18471;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.cwd();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface SubResp { status: number; error?: string; updated?: boolean }
async function post(body: Record<string, unknown>): Promise<SubResp> {
  const r = await fetch(`${BASE}/submit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, ...(await r.json() as SubResp) };
}
/** 提交基板:字段含义与客户端 lbSubmit 一致 */
function sub(over: Record<string, unknown>): Record<string, unknown> {
  return { board: "level", uuid: "smoke-uuid-0", name: "smoke", score: 3,
           kills: 50, playtime: 600, level: 3, max_zone: 2, max_tower: 0, ...over };
}

const tmp = mkdtempSync(join(tmpdir(), "lb-smoke-"));
const SYNC_TOKEN = "lb-smoke-admin-token";
const child = spawn(process.execPath, [join(ROOT, "server/leaderboard-ecs/server.cjs")], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "t.db"), ADMIN_TOKEN: SYNC_TOKEN },
  stdio: "ignore",
});

try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(250);
    try { up = (await fetch(`${BASE}/healthz`)).ok; } catch { /* 重试 */ }
  }
  ok(up, "服务 10 秒内未就绪(端口被占?)");

  await check("S1 合法提交通过(200 且无 error)", async () => {
    const r = await post(sub({ uuid: "smokeA0001" }));
    ok(r.status === 200 && !r.error, `期望 200 无 error,实际 ${r.status} ${r.error ?? ""}`);
  });

  await check("S2 level 超包络被拒(60 秒 Lv5000)", async () => {
    const r = await post(sub({ uuid: "smokeB0002", score: 5000, level: 5000, kills: 10, playtime: 60 }));
    ok(r.status === 400 && r.error === "implausible level", `实际 ${r.status} ${r.error}`);
  });

  await check("S3 kills 超包络被拒(300 秒 10 万杀)", async () => {
    const r = await post(sub({ uuid: "smokeC0003", score: 5, level: 5, kills: 100000, playtime: 300 }));
    ok(r.status === 400 && r.error === "implausible kills", `实际 ${r.status} ${r.error}`);
  });

  await check("S4 zone 超包络被拒(600 秒 9999 区)", async () => {
    const r = await post(sub({ uuid: "smokeD0004", board: "zone", score: 9999, max_zone: 9999, level: 5, kills: 100 }));
    ok(r.status === 400 && r.error === "implausible zone", `实际 ${r.status} ${r.error}`);
  });

  await check("S5 tower>kills 被拒(77 层仅 10 杀)", async () => {
    const r = await post(sub({ uuid: "smokeE0005", board: "tower", score: 77, max_tower: 77, kills: 10, level: 5 }));
    ok(r.status === 400 && r.error === "implausible tower", `实际 ${r.status} ${r.error}`);
  });

  await check("S6 power 超包络被拒(600 秒战力 5000 万)", async () => {
    const r = await post(sub({ uuid: "smokeF0006", board: "power", score: 50000000, level: 5, kills: 100 }));
    ok(r.status === 400 && r.error === "implausible power", `实际 ${r.status} ${r.error}`);
  });

  await check("S7 playtime 超首见墙钟被拒(新 uuid 2 亿秒)", async () => {
    const r = await post(sub({ uuid: "smokeG0007", score: 1, level: 1, kills: 0, playtime: 200000000 }));
    ok(r.status === 400 && r.error === "implausible playtime", `实际 ${r.status} ${r.error}`);
  });

  await check("S8 playtime 增量被拒(首见 40 天前 + 上次提交 1 小时前)", async () => {
    // delta 只在「上次提交比首见新得多」时才成为约束:首见回溯 40 天、上次提交保持
    // 1 小时前。age 允许 ≈ 3,500,400s,delta 允许 = 100,000 + 3,600 + 44,400 = 148,000s;
    // 提交 200,000s:过 age、超 delta → 命中 playtime-delta 而非 playtime。
    const db = new DatabaseSync(join(tmp, "t.db"));
    const now = Date.now();
    db.prepare("UPDATE first_seen SET ts = ? WHERE uuid = ?")
      .run(now - 40 * 86400_000, "smokeA0001");
    db.prepare("UPDATE entries SET updated_at = ?, playtime = ? WHERE uuid = ?")
      .run(now - 3600_000, 100000, "smokeA0001");
    db.close();
    const r = await post(sub({ uuid: "smokeA0001", kills: 51, playtime: 200000 }));
    ok(r.status === 400 && r.error === "implausible playtime-delta", `实际 ${r.status} ${r.error}`);
  });

  await check("S9 回归:墙钟内增量提交仍通过", async () => {
    const r = await post(sub({ uuid: "smokeA0001", kills: 60, playtime: 120000 }));
    ok(r.status === 200 && !r.error, `期望 200 无 error,实际 ${r.status} ${r.error ?? ""}`);
  });

  await check("S10 双端 LB_BOUNDS 托管块逐字节一致", async () => {
    const grab = (p: string): string => {
      const s = readFileSync(join(ROOT, p), "utf8");
      const b = s.indexOf("// ---- BEGIN LB-BOUNDS");
      const e = s.indexOf("// ---- END LB-BOUNDS ----", b);
      ok(b >= 0 && e > b, `${p} 无托管块`);
      return s.slice(b, e);
    };
    const a = grab("server/leaderboard-ecs/server.cjs");
    const c = grab("workers/leaderboard/worker.js");
    ok(a === c, "两端托管块不一致(只改了一端?重跑 npm run gen:lb)");
  });

  await check("S11 worker.js 可作为 ESM 导入(语法/结构)", async () => {
    const mod = await import(pathToFileURL(join(ROOT, "workers/leaderboard/worker.js")).href);
    ok(mod.default !== undefined && typeof mod.default.fetch === "function",
      "default.fetch 缺失");
  });

  await check("S12 main.ts DEV 门禁 + 面板热通道存在(漂移守卫)", async () => {
    const s = readFileSync(join(ROOT, "src/web/main.ts"), "utf8");
    ok(s.includes("import.meta.env.DEV"), "IS_DEV 应为裸 import.meta.env.DEV(define 精确替换)");
    const bootAt = s.indexOf("function boot");
    ok(bootAt >= 0, "找不到 boot()");
    const bootHead = s.slice(bootAt, s.indexOf("installSaveHooks", bootAt));
    ok(bootHead.includes("if (IS_DEV)") && bootHead.includes("OVR_KEY"),
      "boot 覆盖读取应位于 IS_DEV 门禁内");
    const li = s.indexOf('addEventListener("storage"');
    ok(li >= 0, "缺 storage 热通道监听");
    const region = s.slice(Math.max(0, li - 400), li + 2200);
    ok(region.includes("IS_DEV"), "storage 监听应在 IS_DEV 门禁内");
    ok(region.includes("OVR_KEY") && region.includes("SAVE_KEY"),
      "storage 监听应处理覆盖键与存档键");
  });

  await check("S13 dist 生产包不含覆盖键(tree-shake 验证,若已构建)", async () => {
    const dir = join(ROOT, "dist/assets");
    let names: string[] = [];
    try { names = readdirSync(dir).filter(n => n.startsWith("main-")); } catch { return; }
    ok(names.length > 0, "dist 存在但无 main-*.js(先跑 npm run build)");
    for (const n of names) {
      const s = readFileSync(join(dir, n), "utf8");
      ok(!s.includes("abyss_admin_overrides_v1"), `${n} 生产包含覆盖键:DEV 门禁被破坏`);
      ok(!s.includes("已热应用") && !s.includes("已热重载面板写入的存档"),
        `${n} 生产包含热通道代码:storage 监听未包进 IS_DEV`);
    }
  });

  // ---- E. save-sync:玩家存档周期上行 + 管理端读取/写回 ----
  const syncSave = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 7, gear_rules_21: true, playtime: 600, level: 3,
    stats: { kills: 50, max_zone: 2 }, tower: { max_floor: 0 }, ...over,
  });
  const syncPost = async (body: Record<string>, token = ""): Promise<Response> =>
    fetch(`${BASE}/save-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Admin-Token": token } : {}) },
      body: JSON.stringify(body),
    });
  const syncGet = async (qs: string): Promise<Record<string, any>> =>
    fetch(`${BASE}/save-sync${qs}`).then(r => r.json() as Promise<Record<string, any>>);

  await check("S14 玩家存档上行通过(200 且 ok)", async () => {
    const r = await syncPost({ uuid: "syncA00001", name: "同步君", save: syncSave() });
    const d = await r.json() as { ok?: boolean };
    ok(r.status === 200 && d.ok === true, `实际 ${r.status} ${JSON.stringify(d)}`);
  });

  await check("S15 上行同样受语义包络约束(60 秒 Lv5000 被拒)", async () => {
    const r = await syncPost({ uuid: "syncB00002",
      save: syncSave({ level: 5000, playtime: 60, stats: { kills: 10, max_zone: 1 } }) });
    const d = await r.json() as { error?: string };
    ok(r.status === 400 && d.error === "implausible level", `实际 ${r.status} ${d.error}`);
  });

  await check("S16 管理读取:无/错 token 403,对 token 可列表+单取", async () => {
    const none = await fetch(`${BASE}/save-sync`);
    ok(none.status === 403, `无 token 应 403,实际 ${none.status}`);
    const wrong = await fetch(`${BASE}/save-sync?token=wrong`);
    ok(wrong.status === 403, `错 token 应 403,实际 ${wrong.status}`);
    const list = await syncGet(`?token=${SYNC_TOKEN}`);
    ok(Array.isArray(list.saves) && list.saves.some((s: any) => s.uuid === "syncA00001"),
      `列表应含 syncA00001,实际 ${JSON.stringify(list).slice(0, 200)}`);
    const one = await syncGet(`?token=${SYNC_TOKEN}&uuid=syncA00001`);
    ok(one.save?.level === 3, "单取应返回 level=3 的整档");
  });

  await check("S17 管理写回:带 token 跳过包络(60 秒 Lv4000 可写且生效)", async () => {
    const r = await syncPost({ uuid: "syncA00001", save: syncSave({ level: 4000, playtime: 60 }) }, SYNC_TOKEN);
    const d = await r.json() as { ok?: boolean; error?: string };
    ok(r.status === 200 && d.ok === true, `实际 ${r.status} ${d.error}`);
    const one = await syncGet(`?token=${SYNC_TOKEN}&uuid=syncA00001`);
    ok(one.save?.level === 4000, "写回后单取应为新值 4000");
  });

  await check("S18 sync 独立限流:同 uuid 第 13 次上行 429", async () => {
    for (let i = 1; i <= 13; i++) {
      const r = await syncPost({ uuid: "syncC00003", save: syncSave({ playtime: 100 + i }) });
      if (r.status === 429) {
        ok(i === 13, `第 ${i} 次就 429(应 12 次/时)`);
        return;
      }
      ok(r.status === 200, `第 ${i} 次应 200,实际 ${r.status}`);
    }
    ok(false, "13 连发后仍未 429");
  });

  // ---- 周榜(F 组,2.3):平行于终身榜,提交双写,同周只升不降 ----
  interface BoardResp { board?: string; period?: string; error?: string;
    top?: Array<{ name: string; score: number; is_me?: boolean }>;
    you?: { rank: number; score: number } | null }
  const getBoard = async (qs: string): Promise<{ status: number; body: BoardResp }> => {
    const r = await fetch(`${BASE}/board?${qs}`);
    return { status: r.status, body: await r.json() as BoardResp };
  };

  await check("S19 周榜平行:提交后本周榜可见,终身榜同数据并存(双写)", async () => {
    const s = await post(sub({ uuid: "weekA00001", name: "周榜玩家", score: 7, level: 7 }));
    ok(s.status === 200 && !s.error, `提交失败 ${s.status} ${s.error ?? ""}`);
    const w = await getBoard("b=level&period=week&uuid=weekA00001");
    ok(w.status === 200 && w.body.period === "week", `period 字段应为 week:${w.body.period}`);
    ok((w.body.top ?? []).some(r => r.is_me && r.score === 7), "本周榜应含刚提交的玩家");
    const all = await getBoard("b=level&uuid=weekA00001");
    ok(all.body.period === "all", `缺省 period 应为 all,实际 ${all.body.period}`);
    ok((all.body.top ?? []).some(r => r.is_me), "终身榜同样可见(双写)");
  });

  await check("S20 周榜同周只升不降(低分不覆盖)", async () => {
    await post(sub({ uuid: "weekB00002", score: 9, level: 9 }));
    await post(sub({ uuid: "weekB00002", score: 3, level: 3 }));   // 降分提交
    const w = await getBoard("b=level&period=week&uuid=weekB00002");
    const me = (w.body.top ?? []).find(r => r.is_me);
    ok(me?.score === 9, `本周榜应保留高分 9,实际 ${me?.score}`);
  });

  await check("S21 周榜与终身榜互不污染(非法 period 回落 all)", async () => {
    const w1 = await getBoard("b=level&period=week");
    const a1 = await getBoard("b=level&period=all");
    ok(Array.isArray(w1.body.top) && Array.isArray(a1.body.top), "两榜均应返回数组");
    const bad = await getBoard("b=level&period=nonsense");
    ok(bad.body.period === "all", `非法 period 应回落 all,实际 ${bad.body.period}`);
  });

  // ---- G. 世界BOSS·周轮合力(S22 起为本批新增,S22-S24)----
  interface BossResp {
    round?: string; total_hp?: number; dealt?: number; killed?: boolean;
    my_dmg?: number; error?: string;
    prev?: { round: string; total_hp: number; my_dmg: number; killed: boolean } | null;
    top?: Array<{ name: string; dmg: number; is_me?: boolean }>;
  }
  const getBoss = async (qs: string): Promise<{ status: number; body: BossResp }> => {
    const r = await fetch(`${BASE}/boss?${qs}`);
    return { status: r.status, body: await r.json() as BossResp };
  };
  const bossHit = async (over: Record<string, unknown>):
      Promise<{ status: number; body: { ok?: boolean; error?: string; my_dmg?: number } }> => {
    const r = await fetch(`${BASE}/boss/hit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: "bossA00001", name: "挑战者",
        kills: 50, playtime: 600, level: 3, ...over }),
    });
    return { status: r.status, body: await r.json() as { ok?: boolean; error?: string; my_dmg?: number } };
  };

  await check("S22 世界BOSS:GET /boss 首次自动建轮(prev:null);hit 合法通过/更高覆盖/更低不降", async () => {
    const first = await getBoss("uuid=bossA00001");
    ok(first.status === 200 && !first.body.error, `首建轮应 200,实际 ${first.status} ${first.body.error ?? ""}`);
    ok(/^\d{4}-W\d+$/.test(first.body.round ?? ""), `轮号应为 ISO 周键,实际 ${first.body.round}`);
    ok(first.body.total_hp === 2_000_000, `首轮总血应为 200 万,实际 ${first.body.total_hp}`);
    ok(first.body.killed === false, "首轮未击杀");
    ok(first.body.prev === null, `首建轮 prev 应为 null,实际 ${JSON.stringify(first.body.prev)}`);
    ok(Array.isArray(first.body.top) && first.body.top.length === 0, "首建轮贡献榜为空");
    ok(first.body.my_dmg === 0, "首建轮我的伤害为 0");

    const h1 = await bossHit({ dmg: 1000 });
    ok(h1.status === 200 && h1.body.ok === true, `合法伤害应通过,实际 ${h1.status} ${h1.body.error ?? ""}`);
    ok(h1.body.my_dmg === 1000, `记账伤害 1000,实际 ${h1.body.my_dmg}`);
    const h2 = await bossHit({ dmg: 2000 });
    ok(h2.body.my_dmg === 2000, `更高伤害覆盖,实际 ${h2.body.my_dmg}`);
    const h3 = await bossHit({ dmg: 500 });
    ok(h3.body.my_dmg === 2000, `更低伤害不降(只升不降),实际 ${h3.body.my_dmg}`);
    const after = await getBoss("uuid=bossA00001");
    ok(after.body.my_dmg === 2000, `GET /boss 同步口径,实际 ${after.body.my_dmg}`);
    ok(after.body.dealt === 2000, `全服合计 = 去重后的个人最好,实际 ${after.body.dealt}`);
    ok((after.body.top ?? []).some(r => r.is_me && r.dmg === 2000), "贡献榜含本人(is_me,不回传 uuid)");
    // scope 独立:boss 3 连击后,同 uuid 的 /submit(scope 空)不受 boss 桶影响
    const board = await post(sub({ uuid: "bossA00001", name: "挑战者" }));
    ok(board.status === 200 && !board.error, `boss hit 不烧四榜限流额度,实际 ${board.status} ${board.error ?? ""}`);
  });

  await check("S23 世界BOSS:惰性轮次跨越(上轮结算 killed/新轮 ×1.6/×0.8 下限 50 万)", async () => {
    // 注入历史轮(直接写临时 DB,同 S8 手法):清空后把"最新轮"伪装成上周 →
    // 下一次 GET /boss 触发惰性结算 + 开新轮 + 旧数据懒清理
    const db = new DatabaseSync(join(tmp, "t.db"));
    const inject = (round: string, totalHp: number, dmg: number): void => {
      db.prepare("DELETE FROM boss_damage").run();
      db.prepare("DELETE FROM boss_rounds").run();
      const at = Date.now() - 7 * 86400_000;
      db.prepare("INSERT INTO boss_rounds (round, total_hp, killed, created_at) VALUES (?, ?, 0, ?)")
        .run(round, totalHp, at);
      db.prepare("INSERT INTO boss_damage (round, uuid, name, dmg, updated_at) VALUES (?, ?, '挑战者', ?, ?)")
        .run(round, "bossA00001", dmg, at);
    };

    // 场景一:上轮打穿(SUM ≥ total)→ 结算 killed=1,新轮 ×1.6(注入总量取下限之上,缩放可见)
    inject("2020-W1", 1_000_000, 1_500_000);
    let r = await getBoss("uuid=bossA00001");
    ok(r.body.prev?.round === "2020-W1", `跨越后 prev=上一轮,实际 ${JSON.stringify(r.body.prev)}`);
    ok(r.body.prev?.killed === true, "上轮 SUM≥total_hp 惰性结算为已击杀");
    ok(r.body.prev?.my_dmg === 1_500_000, `prev.my_dmg=上轮个人伤害,实际 ${r.body.prev?.my_dmg}`);
    ok(r.body.total_hp === 1_600_000, `击杀轮 → 新轮总血 ×1.6(100 万→160 万),实际 ${r.body.total_hp}`);
    ok(r.body.my_dmg === 0 && r.body.dealt === 0, "新轮个人/全服伤害清零起步");
    ok(r.body.killed === false, "新轮未击杀");

    // 场景二:上轮没打穿且缩放后低于下限(SUM 100 < total 60 万,×0.8=48 万)→ 下限 50 万
    inject("2020-W2", 600_000, 100);
    r = await getBoss("uuid=bossA00001");
    ok(r.body.prev?.killed === false, "上轮未打穿不结算击杀");
    ok(r.body.total_hp === 500_000, `未杀轮 ×0.8(48 万)触及下限 50 万,实际 ${r.body.total_hp}`);

    // 场景三:上轮没打穿但缩放后仍高于下限(×0.8=80 万)→ 精确 80 万
    inject("2020-W3", 1_000_000, 100);
    r = await getBoss("uuid=bossA00001");
    ok(r.body.total_hp === 800_000, `未杀轮 ×0.8 高于下限时精确缩放,实际 ${r.body.total_hp}`);
  });

  await check("S24 世界BOSS:伤害超 curveAt(power,playtime)×1200 返回 400(边界含等号)", async () => {
    // 从 server.cjs 的 LB_BOUNDS 托管块现读包络(数值变更重跑 gen:lb 后本断言自适应)
    const src = readFileSync(join(ROOT, "server/leaderboard-ecs/server.cjs"), "utf8");
    const at = src.indexOf("const LB_BOUNDS = {");
    ok(at >= 0, "server.cjs 缺 LB_BOUNDS 托管块");
    const end = src.indexOf("};", at);
    const LB = new Function(`"use strict"; return ${src.slice(at + "const LB_BOUNDS =".length, end + 1)}`)() as {
      curve: Array<{ t: number; power: number }>;
    };
    const cap600 = LB.curve[0].power * 1200;   // playtime=600s 恰在首锚点:包络 = power(600)×k
    const edge = await bossHit({ dmg: cap600, uuid: "bossE00005" });
    ok(edge.status === 200, `恰在包络(=cap)应通过,实际 ${edge.status} ${edge.body.error ?? ""}`);
    const over = await bossHit({ dmg: cap600 + 1, uuid: "bossE00005" });
    ok(over.status === 400 && over.body.error === "implausible dmg",
      `超包络(+1)应 400 implausible dmg,实际 ${over.status} ${over.body.error}`);
  });

  await check("S25 世界BOSS:boss scope 独立限流 13 连发 429", async () => {
    for (let i = 1; i <= 13; i++) {
      const r = await bossHit({ uuid: "bossR00009", dmg: 1000 + i });
      if (r.status === 429) {
        ok(i === 13, `第 ${i} 次就 429(应 12 次/时)`);
        return;
      }
      ok(r.status === 200, `第 ${i} 次应 200,实际 ${r.status} ${r.body.error ?? ""}`);
    }
    ok(false, "13 连发后仍未 429");
  });

  await check("S26 双端三段同构:server.cjs CREATE 段三表 / schema.sql 三表 / worker.js 端点与表名(无 DDL)", async () => {
    const srv = readFileSync(join(ROOT, "server/leaderboard-ecs/server.cjs"), "utf8");
    const wkr = readFileSync(join(ROOT, "workers/leaderboard/worker.js"), "utf8");
    const sql = readFileSync(join(ROOT, "workers/leaderboard/schema.sql"), "utf8");
    // ① server.cjs 内联 CREATE 段(db.exec 反引号块)含三表(boss 两表 + arena_snaps)
    const execAt = srv.indexOf("db.exec(`");
    ok(execAt >= 0, "server.cjs 缺 db.exec 内联建表段");
    const execBlock = srv.slice(execAt, srv.indexOf("`);", execAt));
    for (const t of ["boss_rounds", "boss_damage", "arena_snaps"]) {
      ok(execBlock.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `server.cjs CREATE 段缺表 ${t}`);
    }
    // ② schema.sql(D1 建表走它)同步含三表
    for (const t of ["boss_rounds", "boss_damage", "arena_snaps"]) {
      ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `schema.sql 缺表 ${t}`);
    }
    // ③ worker.js 断言端点逻辑存在(路由 + SQL 表名引用);不断言其含 DDL ——
    //    worker.js 无 DDL 是既定架构(D1 建表走 schema.sql 外部 execute),实测 CREATE TABLE 零命中。
    //    切磋(async-arena)与 world-boss 共用本组断言:两张 /arena 路由 + arena_snaps 表名引用。
    ok(wkr.includes('"/boss"'), 'worker.js 缺路由 "/boss"');
    ok(wkr.includes('"/boss/hit"'), 'worker.js 缺路由 "/boss/hit"');
    ok(wkr.includes('"/arena/snapshot"'), 'worker.js 缺路由 "/arena/snapshot"');
    ok(wkr.includes('"/arena/opponents"'), 'worker.js 缺路由 "/arena/opponents"');
    ok(wkr.includes("boss_rounds"), "worker.js SQL 缺 boss_rounds 表名引用");
    ok(wkr.includes("boss_damage"), "worker.js SQL 缺 boss_damage 表名引用");
    ok(wkr.includes("arena_snaps"), "worker.js SQL 缺 arena_snaps 表名引用");
    ok(!wkr.includes("CREATE TABLE"), "worker.js 不应出现 DDL(建表归 schema.sql)");
  });

  await check("S27 机器门禁:双端各含 world_boss_dmg_cap_k 字样(常量名互指,漂移即 FAIL)", async () => {
    const srv = readFileSync(join(ROOT, "server/leaderboard-ecs/server.cjs"), "utf8");
    const wkr = readFileSync(join(ROOT, "workers/leaderboard/worker.js"), "utf8");
    ok(srv.includes("world_boss_dmg_cap_k"), "server.cjs 缺 world_boss_dmg_cap_k(与 BAL 同名互指)");
    ok(wkr.includes("world_boss_dmg_cap_k"), "worker.js 缺 world_boss_dmg_cap_k(与 BAL 同名互指)");
  });

  // ---- H. 异步切磋(async-arena):快照上行 / 浅校验 / power 包络 / 对手脱敏 / scope=arena 限流 ----
  const snapPost = async (over: Record<string, unknown>):
      Promise<{ status: number; body: { ok?: boolean; error?: string } }> => {
    const r = await fetch(`${BASE}/arena/snapshot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: "arenaA00001", name: "切磋君",
        power: 1000, kills: 50, playtime: 600, level: 3,
        squad: { cls: "warrior", level: 3, title: "", atk: 25, hp: 260, def: 8,
          haste: 0, crit: 5, crit_dmg: 50, lifesteal: 0, dodge: 0, armor_pierce: 0,
          skill_dmg: 0, cd_reduce: 0, interval: 1.2, active: ["w_strike"],
          passive: ["pw_tough"], suits: [] }, ...over }),
    });
    return { status: r.status, body: await r.json() as { ok?: boolean; error?: string } };
  };

  await check("S28 切磋:快照上行合法通过;squad 超 4KB/深嵌套 400;power 超包络 400 implausible power", async () => {
    const good = await snapPost({});
    ok(good.status === 200 && good.body.ok === true,
      `合法快照应 200,实际 ${good.status} ${good.body.error ?? ""}`);
    const big = await snapPost({ squad: { pad: "x".repeat(4200) } });
    ok(big.status === 400 && big.body.error === "squad too large",
      `squad 超 4KB 应 400 squad too large,实际 ${big.status} ${big.body.error}`);
    const shape = await snapPost({ squad: { deep: { a: { b: { c: 1 } } } } });
    ok(shape.status === 400 && shape.body.error === "bad squad shape",
      `深嵌套应 400 bad squad shape,实际 ${shape.status} ${shape.body.error}`);
    const keys = await snapPost({ squad: Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`k${i}`, 1])) });
    ok(keys.status === 400 && keys.body.error === "bad squad shape",
      `顶层键数超限(25>24)应 400 bad squad shape,实际 ${keys.status} ${keys.body.error}`);
    const notObj = await snapPost({ squad: [1, 2, 3] });
    ok(notObj.status === 400 && notObj.body.error === "bad squad",
      `squad 非顶层对象应 400 bad squad,实际 ${notObj.status} ${notObj.body.error}`);
    const power = await snapPost({ uuid: "arenaB00002", power: 50_000_000 });
    ok(power.status === 400 && power.body.error === "implausible power",
      `600 秒战力 5000 万应 400 implausible power,实际 ${power.status} ${power.body.error}`);
  });

  await check("S29 切磋:GET /arena/opponents 不含 uuid 键(JSON 逐键断言)+ 邻域采样排除自己", async () => {
    await snapPost({ uuid: "arenaC00003", power: 1500, name: "邻域甲" });
    await snapPost({ uuid: "arenaD00004", power: 2800, name: "邻域乙" });
    const r = await fetch(`${BASE}/arena/opponents?uuid=arenaA00001&power=1000`);
    const d = await r.json() as { opponents?: Array<Record<string, unknown>>; error?: string };
    ok(r.status === 200 && !d.error && Array.isArray(d.opponents),
      `应 200 含 opponents 数组,实际 ${r.status} ${d.error ?? ""}`);
    ok((d.opponents ?? []).length > 0, "已上行他人快照,应至少返回 1 名对手");
    const names = (d.opponents ?? []).map(o => String(o.name));
    ok(!names.includes("切磋君"), `采样应排除自己(uuid!=?),实际 ${JSON.stringify(names)}`);
    for (const o of d.opponents ?? []) {
      for (const k of Object.keys(o)) {
        ok(k !== "uuid", `opponents 项出现 uuid 键「${k}」—— 防外泄逐键断言失败`);
      }
      ok(typeof o.name === "string" && typeof o.power === "number" && o.squad !== undefined,
        `对手项应含 name/power/squad,实际 ${JSON.stringify(o).slice(0, 120)}`);
    }
    const badUuid = await fetch(`${BASE}/arena/opponents?uuid=short&power=1000`);
    ok(badUuid.status === 400, `坏 uuid 应 400,实际 ${badUuid.status}`);
  });

  await check("S30 切磋:同 uuid 13 连发 snapshot 429(scope=arena,不烧四榜额度)", async () => {
    for (let i = 1; i <= 13; i++) {
      const r = await snapPost({ uuid: "arenaR00009", power: 1000 + i });
      if (r.status === 429) {
        ok(i === 13, `第 ${i} 次就 429(应 12 次/时)`);
        // scope 独立:arena 13 连发后同 uuid 的 /submit(scope 空)不受 arena 桶影响
        const board = await post(sub({ uuid: "arenaR00009", name: "切磋限流" }));
        ok(board.status === 200 && !board.error,
          `arena 上行不烧四榜额度,实际 ${board.status} ${board.error ?? ""}`);
        return;
      }
      ok(r.status === 200, `第 ${i} 次应 200,实际 ${r.status} ${r.body.error ?? ""}`);
    }
    ok(false, "13 连发后仍未 429");
  });
} catch (err) {
  fail++;
  console.log(`FAIL 启动: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  child.kill();
  // Windows 上子进程退出有延迟,等它放手后再清临时目录(重试兜底)
  await new Promise<void>(res => {
    if (child.exitCode !== null) return res();
    child.once("exit", () => res());
    setTimeout(res, 3000);
  });
  for (let i = 0; i < 3; i++) {
    try { rmSync(tmp, { recursive: true, force: true }); break; } catch { await sleep(300); }
  }
}

const total = pass + fail;
if (fail > 0) {
  console.log(`[LB-SMOKE FAIL] ${pass}/${total}`);
  process.exit(1);
}
console.log(`[LB-SMOKE PASS] ${total}/${total}`);
process.exit(0);
