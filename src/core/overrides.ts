/** 数值覆盖引擎(docs/admin-panel.md §4/§8.A):22 个 data.ts 根表的运行时叶子覆盖。
 *
 * 纯函数模块:不 import 任何 node:/浏览器 API,CLI / Web / 面板三宿主共用。
 * 原理:全部策划数值是 data.ts 的模块级对象/数组,消费点均在调用时读表 →
 * 不改 data.ts 一行、只变异导出对象的叶子属性即可全链路生效;
 * 模块加载时(任何 apply 之前)对全部叶子拍快照,resetOverrides 据此一键恢复默认。
 * 对拍解耦:本模块只提供纯函数,不自己读任何存储;sim.ts 与 abyss/(Python)
 * 均不加载覆盖(方案 §4.5),parity.sh 与 overrides.json 彻底无关。
 */
import {
  ACHIEVEMENTS, ACTIVE_SKILLS, AFFIXES, AFFIX_SUFFIX, ALTAR_LINES, BAL, CAPS,
  CLASSES, MAIN_ROLLS, MONSTERS, PASSIVE_SKILLS, POTIONS, QUEST_TYPES, RARITIES,
  RARITY_PREFIX, RELIC_EFF_COUNT, RELIC_EFFECTS, SLOTS, SLOT_INNATE, STAT_NAMES,
  THEMES, TOWER,
} from "./data.ts";

export type OverrideValue = number | string | boolean;
/** {"BAL.hero_hp0": 150, "RARITIES.5.weight": 30, "MONSTERS.slime.skill.cd": 8} */
export type OverrideValues = Record<string, OverrideValue>;

export interface OverrideRejection { path: string; reason: string }
export interface OverrideApplyResult {
  applied: string[];                 // 成功应用(并已写入活对象)的路径,按入参序
  rejected: OverrideRejection[];     // 被拒路径 + reason(R1-R6,见 applyOverrides)
}

/** 文件整体格式错误。name 恒为 "OverrideFormatError"。 */
export class OverrideFormatError extends Error {
  name = "OverrideFormatError";
}

// ================================================================ 注册表与快照
/** BAL 为 as const(类型只读、运行时可写),经 Writable 映射类型转换后入注册表 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** 注册表根 = data.ts 的 22 张策划数值表(方案 §4.1;引用即 data.ts 导出对象本体) */
const registry: Record<string, unknown> = {
  BAL: BAL as Writable<typeof BAL>,
  RARITIES, RARITY_PREFIX, SLOTS, MAIN_ROLLS, SLOT_INNATE, AFFIXES, AFFIX_SUFFIX,
  CAPS, CLASSES, ACTIVE_SKILLS, PASSIVE_SKILLS, THEMES, MONSTERS, ACHIEVEMENTS,
  QUEST_TYPES, ALTAR_LINES, POTIONS, STAT_NAMES, TOWER, RELIC_EFFECTS, RELIC_EFF_COUNT,
};

/** 模块加载时(任何 apply 之前)的默认值快照:路径 → 原始类型叶子当前值 */
const defaults: OverrideValues = {};

function collect(obj: unknown, prefix: string): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) collect(obj[i], `${prefix}.${i}`);
  } else if (obj !== null && typeof obj === "object") {
    for (const k of Object.keys(obj)) collect((obj as Record<string, unknown>)[k], `${prefix}.${k}`);
  } else if (typeof obj === "number" || typeof obj === "string" || typeof obj === "boolean") {
    defaults[prefix] = obj;
  }
}
for (const [name, obj] of Object.entries(registry)) collect(obj, name);

// ================================================================ 路径解析
const NUM_SEG = /^\d+$/;   // 数组下标:十进制字符串段

const NOT_FOUND = Symbol("override-path-not-found");
const NOT_LEAF = Symbol("override-not-a-leaf");
interface LeafRef { parent: any; key: string; current: OverrideValue }
type WalkResult = LeafRef | typeof NOT_FOUND | typeof NOT_LEAF;

/** 在容器(对象/数组)上走一段:命中返回值;数组只认 0..length-1 的十进制下标
 *  (length/原型链/越界一律视为不存在) */
function step(cur: unknown, seg: string): { found: true; value: unknown } | { found: false } {
  if (Array.isArray(cur)) {
    if (!NUM_SEG.test(seg)) return { found: false };
    const i = Number(seg);
    if (i >= cur.length) return { found: false };
    const v = cur[i];
    return v === undefined ? { found: false } : { found: true, value: v };
  }
  if (cur !== null && typeof cur === "object") {
    const o = cur as Record<string, unknown>;
    if (!Object.hasOwn(o, seg)) return { found: false };
    const v = o[seg];
    return v === undefined ? { found: false } : { found: true, value: v };
  }
  return { found: false };
}

/** 从根对象出发按段解析到叶子;返回可写引用或错误标记 */
function walk(rootObj: unknown, segs: string[]): WalkResult {
  let cur: unknown = rootObj;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const st = step(cur, seg);
    if (!st.found) return NOT_FOUND;
    if (i === segs.length - 1) {
      const v = st.value;
      if (v === null || typeof v === "object" || typeof v === "function") return NOT_LEAF;
      return { parent: cur, key: seg, current: v as OverrideValue };
    }
    cur = st.value;   // 中段必须是容器,否则下一步 step 自然返回 not found
  }
  return NOT_LEAF;    // segs 为空:路径即根自身(必是对象/数组)
}

// ================================================================ R6 锁定规则
/** 末段为这些键的叶子是被别处按键引用的标识/行为选择器(方案 §4.3 R6①) */
const LOCKED_KEYS: ReadonlySet<string> = new Set([
  "id", "key", "cls", "stat", "hook", "op", "type", "metric", "buff", "kind", "pct",
]);

/** R6 结构键判定(parts = 完整路径段,parts[0] 为根名):
 *  ① 末段 ∈ LOCKED_KEYS;
 *  ② 前缀命中 THEMES.<n>.mobs.<i>(值必须是 MONSTERS 键,否则 spawnMonster 直接崩);
 *  ③ 根=SLOT_INNATE 且路径恰 3 段且末段 === "0"(元组下标 0 持有 StatKey)。 */
function isLockedPath(parts: string[]): boolean {
  const last = parts[parts.length - 1]!;
  if (LOCKED_KEYS.has(last)) return true;
  if (parts.length >= 4 && parts[0] === "THEMES"
      && NUM_SEG.test(parts[1]!) && parts[2] === "mobs" && NUM_SEG.test(parts[3]!)) return true;
  if (parts.length === 3 && parts[0] === "SLOT_INNATE" && parts[2] === "0") return true;
  return false;
}

// ================================================================ API 实现
/** 解析并严格校验覆盖文件文本 → values 映射。规则见方案 §4.3(parse 层)。 */
export function parseOverrideFile(text: string): OverrideValues {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    throw new OverrideFormatError("覆盖文件不是合法 JSON");
  }
  if (d === null || typeof d !== "object" || Array.isArray(d)) {
    throw new OverrideFormatError("覆盖文件顶层必须是普通对象 {version, values}");
  }
  const top = d as Record<string, unknown>;
  if (top.version !== 1) {
    throw new OverrideFormatError(`version 缺失或不为 1(当前 ${JSON.stringify(top.version)})`);
  }
  const values = top.values;
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new OverrideFormatError("values 缺失或非普通对象");
  }
  const out: OverrideValues = {};
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    if (k === "") throw new OverrideFormatError("values 含空字符串键");
    const t = typeof v;
    if (t !== "number" && t !== "string" && t !== "boolean") {
      throw new OverrideFormatError(`values["${k}"] 不是原始类型(number/string/boolean)`);
    }
    if (t === "number" && !Number.isFinite(v as number)) {
      throw new OverrideFormatError(`values["${k}"] 非有限数字`);
    }
    out[k] = v as OverrideValue;
  }
  return out;
}

/** 逐条应用;合法条目立即写入 data.ts 活对象(对全部已 import 方即时生效);
 *  非法条目记入 rejected 且零写入。幂等,可重复调用。 */
export function applyOverrides(values: OverrideValues): OverrideApplyResult {
  const applied: string[] = [];
  const rejected: OverrideRejection[] = [];
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    const root = parts[0]!;
    // R1 根名不在注册表
    if (!Object.hasOwn(registry, root)) {
      rejected.push({ path, reason: "unknown root" });
      continue;
    }
    const w = walk(registry[root], parts.slice(1));
    // R2 路径任一段不存在(含数组下标越界)
    if (w === NOT_FOUND) { rejected.push({ path, reason: "path not found" }); continue; }
    // R3 最终目标不是原始类型叶子(是对象/数组)
    if (w === NOT_LEAF) { rejected.push({ path, reason: "not a primitive leaf" }); continue; }
    // R4 新值 typeof ≠ 现值 typeof
    if (typeof value !== typeof w.current) { rejected.push({ path, reason: "type mismatch" }); continue; }
    // R5 number 值非 Number.isFinite
    if (typeof value === "number" && !Number.isFinite(value)) {
      rejected.push({ path, reason: "non-finite number" });
      continue;
    }
    // R6 结构键/行为选择器(三条子规则,见 isLockedPath)
    if (isLockedPath(parts)) { rejected.push({ path, reason: "locked structural key" }); continue; }
    w.parent[w.key] = value;
    applied.push(path);
  }
  return { applied, rejected };
}

/** 一键恢复默认:把 22 个根的全部叶子写回模块加载时的快照。 */
export function resetOverrides(): void {
  for (const [path, value] of Object.entries(defaults)) {
    const parts = path.split(".");
    const w = walk(registry[parts[0]!], parts.slice(1));
    if (w !== NOT_FOUND && w !== NOT_LEAF) w.parent[w.key] = value;
  }
}

/** 当前值 ≠ 默认值 的叶子(面板「已改 N 项」与保存文件的内容来源)。 */
export function overrideDiff(): OverrideValues {
  const out: OverrideValues = {};
  for (const [path, def] of Object.entries(defaults)) {
    const parts = path.split(".");
    const w = walk(registry[parts[0]!], parts.slice(1));
    if (w === NOT_FOUND || w === NOT_LEAF) continue;
    if (w.current !== def) out[path] = w.current;
  }
  return out;
}

/** 全部可覆盖叶子的当前值(扁平路径表,面板浏览/搜索数据源)。 */
export function listOverridableLeaves(): Record<string, OverrideValue> {
  const out: Record<string, OverrideValue> = {};
  for (const path of Object.keys(defaults)) {
    const parts = path.split(".");
    const w = walk(registry[parts[0]!], parts.slice(1));
    out[path] = w === NOT_FOUND || w === NOT_LEAF ? defaults[path]! : w.current;
  }
  return out;
}

/** 序列化为覆盖文件文本(JSON 2 空格缩进,{"version":1,"values":{...}})。 */
export function serializeOverrideFile(values: OverrideValues): string {
  return JSON.stringify({ version: 1, values }, null, 2);
}
