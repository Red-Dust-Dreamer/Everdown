// 排行榜反作弊审计:拉 ECS 全量库,跑服务端同款包络 + 跨榜自洽 + 存档对账。
// 用法(两步):
//   1) ssh root@<ECS> "cd /opt/dev/Everdown/server/leaderboard-ecs && node --no-warnings -e '
//        const {DatabaseSync}=require(\"node:sqlite\");const db=new DatabaseSync(\"leaderboard.db\");
//        console.log(JSON.stringify({entries:db.prepare(\"SELECT * FROM entries\").all(),
//          weekly:db.prepare(\"SELECT * FROM entries_weekly\").all(),
//          boss:db.prepare(\"SELECT round,uuid,name,dmg,updated_at FROM boss_damage ORDER BY round,dmg DESC\").all(),
//          arena:db.prepare(\"SELECT uuid,name,power,updated_at FROM arena_snaps ORDER BY power DESC\").all(),
//          saves:db.prepare(\"SELECT uuid,name,level,kills,playtime,max_zone,max_tower,rebirths,bytes,updated_at FROM save_sync\").all(),
//          firstSeen:db.prepare(\"SELECT * FROM first_seen\").all()}))'" > lb-dump.json
//   2) node scripts/lb-audit.mjs lb-dump.json
// 判定口径与 worker.js implausible() 同源;LB_BOUNDS 从 worker.js 现读,包络重生成后自动跟随。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "workers/leaderboard/worker.js"), "utf8");
const m = /---- BEGIN LB-BOUNDS[\s\S]*?const LB_BOUNDS = ([\s\S]*?);\s*[\s\S]*?---- END LB-BOUNDS/.exec(workerSrc);
if (!m) throw new Error("worker.js 中未找到 LB-BOUNDS 托管块");
const LB_BOUNDS = eval(`(${m[1]})`);   // 字面量对象,源头是 gen:lb 生成的受控代码

function curveAt(metric, t) {
  const pts = LB_BOUNDS.curve;
  if (t <= pts[0].t) return pts[0][metric];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      return a[metric] + (b[metric] - a[metric]) * (t - a.t) / (b.t - a.t);
    }
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return b[metric] + (b[metric] - a[metric]) * (t - b.t) / (b.t - a.t);
}

const d = JSON.parse(readFileSync(process.argv[2] ?? "lb-dump.json", "utf8"));
const now = Date.now();
const fs = new Map(d.firstSeen.map(r => [r.uuid, r.ts]));
const issues = [];
const info = (uuid, tag, msg) => issues.push(
  `[${tag}] ${(d.saves.find(s => s.uuid === uuid) ?? d.entries.find(e => e.uuid === uuid))?.name ?? uuid.slice(0, 8)} (${uuid.slice(0, 8)}): ${msg}`);

// 1) 逐行包络(同 implausible 静态部分;服务端每天实时拦,这里抓的是历史存量漏网)
for (const e of d.entries) {
  const cap = met => curveAt(met, e.playtime);
  if (e.level > cap("level")) info(e.uuid, "CURVE", `${e.board}榜 level=${e.level} > 包络${cap("level").toFixed(0)} @pt=${e.playtime}`);
  if (e.kills > cap("kills")) info(e.uuid, "CURVE", `${e.board}榜 kills=${e.kills} > 包络${cap("kills").toFixed(0)}`);
  if (e.max_zone > cap("zone")) info(e.uuid, "CURVE", `${e.board}榜 zone=${e.max_zone} > 包络${cap("zone").toFixed(0)}`);
  if (e.max_tower > e.kills) info(e.uuid, "CURVE", `${e.board}榜 tower=${e.max_tower} > kills=${e.kills}`);
  if (e.board === "power" && e.score > cap("power")) info(e.uuid, "CURVE", `power榜 score=${e.score} > 包络${cap("power").toFixed(0)}`);
  if (e.board === "rebirth" && !(e.rebirths != null && e.score === Math.floor(e.rebirths)))
    info(e.uuid, "CURVE", `rebirth榜 score=${e.score} ≠ floor(rebirths=${e.rebirths})`);
  const seen = fs.get(e.uuid);
  const ageSec = seen != null ? (now - seen) / 1000 : LB_BOUNDS.initialAgeSec;
  if (e.playtime > ageSec + LB_BOUNDS.offlineGraceSec)
    info(e.uuid, "WALLCLOCK", `${e.board}榜 playtime=${(e.playtime / 3600).toFixed(1)}h > 首见至今${(ageSec / 3600).toFixed(1)}h+宽限`);
}

// 2) 跨榜自洽:同 uuid 更早的行 level 大幅高于最新行,且无转生世数增长佐证
const byUuid = new Map();
for (const e of d.entries) (byUuid.get(e.uuid) ?? byUuid.set(e.uuid, []).get(e.uuid)).push(e);
for (const [uuid, rows] of byUuid) {
  const latest = rows.reduce((a, b) => b.updated_at > a.updated_at ? b : a);
  for (const r of rows) {
    if (r === latest) continue;
    if (r.updated_at < latest.updated_at && r.level > latest.level + 5 &&
        !(r.rebirths != null && latest.rebirths != null && latest.rebirths > r.rebirths))
      info(uuid, "LEVEL-DOWN",
        `${r.board}榜(${new Date(r.updated_at).toISOString().slice(5, 16)}) level=${r.level} → 最新 level=${latest.level},rebirths ${r.rebirths ?? "?"}→${latest.rebirths ?? "?"}`);
  }
}

// 3) 存档对账:榜行更新更晚却比存档低(单调字段 kills/zone 不可能倒退)
for (const s of d.saves) {
  for (const r of byUuid.get(s.uuid) ?? []) {
    if (r.updated_at >= s.updated_at && r.kills + 50 < s.kills)
      info(s.uuid, "SYNC-CONFLICT", `${r.board}榜 kills=${r.kills} < 存档 kills=${s.kills} 且榜更新更晚`);
    if (r.updated_at >= s.updated_at && r.max_zone < s.max_zone - 2)
      info(s.uuid, "SYNC-CONFLICT", `${r.board}榜 zone=${r.max_zone} < 存档 zone=${s.max_zone} 且榜更新更晚`);
  }
  if (s.level > curveAt("level", s.playtime)) info(s.uuid, "CURVE", `存档 level=${s.level} > 包络${curveAt("level", s.playtime).toFixed(0)}`);
  if (s.max_zone > curveAt("zone", s.playtime)) info(s.uuid, "CURVE", `存档 zone=${s.max_zone} > 包络${curveAt("zone", s.playtime).toFixed(0)}`);
}

// 4) boss 伤害包络(power 包络 × cap_k;playtime 取同 uuid 已知最大值,宽向估计)
for (const b of d.boss ?? []) {
  const rows = byUuid.get(b.uuid) ?? [];
  const pt = rows.length ? Math.max(...rows.map(r => r.playtime))
    : (d.saves.find(s => s.uuid === b.uuid)?.playtime ?? 0);
  if (pt > 0 && b.dmg > curveAt("power", pt) * 1200)
    info(b.uuid, "BOSS", `dmg=${b.dmg} > power包络×1200=${(curveAt("power", pt) * 1200).toFixed(0)} @pt≈${(pt / 3600).toFixed(1)}h`);
}

// —— 玩家总览(人工复核用;按 zone 降序)——
console.log("=== 玩家总览(按最远区降序)===");
const players = [...byUuid.entries()].map(([uuid, rows]) => {
  const g = b => rows.find(r => r.board === b);
  const sv = d.saves.find(s => s.uuid === uuid);
  const z = g("zone");
  return {
    name: sv?.name ?? z?.name ?? "?",
    zone: z?.score, level: g("level")?.score, power: g("power")?.score,
    tower: g("tower")?.score, rebirth: g("rebirth")?.score, rbRaw: sv?.rebirths,
    kills: z?.kills, pt: (z?.playtime ?? 0) / 3600,
    seen: fs.has(uuid) ? `${((now - fs.get(uuid)) / 3600000).toFixed(0)}h` : "?",
  };
}).sort((a, b) => (b.zone ?? 0) - (a.zone ?? 0));
for (const p of players)
  console.log(`${p.name.padEnd(12)} zone=${String(p.zone ?? "-").padEnd(4)} lv=${String(p.level ?? "-").padEnd(4)} pow=${String(p.power ?? "-").padEnd(8)} tw=${String(p.tower ?? "-").padEnd(3)} reb=${String(p.rebirth ?? "-").padEnd(3)}(${p.rbRaw ?? "?"}) kills=${String(p.kills ?? "-").padEnd(7)} pt=${p.pt.toFixed(1)}h 首见:${p.seen}前`);

console.log(`\n=== 审计发现 ${issues.length} 条 ===`);
for (const i of issues) console.log(i);
if (!issues.length) console.log("(无违规;横向比例异常请对照总览人工复核)");
