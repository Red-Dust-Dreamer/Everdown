/** 生成兑换码并注入 src/core/data.ts 的 REDEEM_CODES(哈希内嵌,源码不出现明文)。
 *  用法:node --experimental-strip-types scripts/gen_redeem.ts
 *  明文码打印到 stdout,由运营者记录(开发者后台/公告渠道发放)。 */
import * as fs from "node:fs";

const CODES: Array<{ code: string; label: string; gold?: number; stones?: number; keys?: number }> = [
  { code: "ABYSS2026", label: "上线礼包:◈10万 + ✦5 + 🔑1", gold: 100000, stones: 5, keys: 1 },
  { code: "DEEPDIVER", label: "深潜者礼包:✦3", stones: 3 },
  { code: "FIRSTBLOOD", label: "首杀礼包:◈2万", gold: 20000 },
];

/** FNV-1a 32bit(与 game.ts redeemCode 同一口径) */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const rows = CODES.map(c => {
  const h = fnv1a(c.code.trim().toUpperCase());
  const parts = [`hash: ${h}`, `label: "${c.label}"`];
  if (c.gold) parts.push(`gold: ${c.gold}`);
  if (c.stones) parts.push(`stones: ${c.stones}`);
  if (c.keys) parts.push(`keys: ${c.keys}`);
  return `  { ${parts.join(", ")} },`;
}).join("\n");

const dataPath = new URL("../src/core/data.ts", import.meta.url);
let src = fs.readFileSync(dataPath, "utf8");
const marker = /export const REDEEM_CODES: RedeemDef\[\] = .*$/m;
if (!marker.test(src)) { console.error("REDEEM_CODES 标记行未找到"); process.exit(1); }
src = src.replace(marker, `export const REDEEM_CODES: RedeemDef[] = [\n${rows}\n];   // 由 scripts/gen_redeem.ts 生成注入`);
fs.writeFileSync(dataPath, src, "utf8");

console.log("== 已注入 src/core/data.ts,明文码(仅此一次展示,请妥善保存):");
for (const c of CODES) console.log(`   ${c.code.padEnd(12)} → ${c.label}`);
