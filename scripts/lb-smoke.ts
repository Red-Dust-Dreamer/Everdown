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
