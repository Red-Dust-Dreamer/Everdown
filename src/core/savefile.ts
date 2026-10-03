/** 存档字典校验(管理面板用;规则矩阵与代码行依据 = docs/admin-panel.md §5.2)。
 *
 * 纯函数:无副作用、不修改入参;枚举一律现读 data.ts 核心表(禁止手写字面量,
 * 防枚举漂移),SAVE_VERSION 现读 game.ts。error = 引擎崩溃/静默丢数据/破坏枚举
 * (阻断写回);warn = 引擎容错但体验/数据受影响(仅提示)。
 */
import { SAVE_VERSION } from "./game.ts";
import {
  ACTIVE_DEF, AFFIX_DEF, ALTAR_LINES, BAL, CLASSES, MAIN_ROLLS, PASSIVE_DEF,
  QUEST_TYPES, RARITY_IDX, RELIC_EFF_DEF, SLOTS,
} from "./data.ts";

export interface SaveIssue { field: string; level: "error" | "warn"; message: string }

/** main_id 合法集:从 MAIN_ROLLS 现读(文件头规则:禁止手写字面量,防枚举漂移) */
const MAIN_IDS: readonly string[] =
  [...new Set(SLOTS.flatMap(s => MAIN_ROLLS[s.id].map(m => m.stat)))];

// ================================================================ 工具
function isObj(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}
/** message 里的「现值」展示(undefined/null/对象/超长字符串都给出可读形式) */
function fmtVal(v: unknown): string {
  if (v === undefined) return "缺失";
  if (v === null) return "null";
  if (Array.isArray(v)) return "数组";
  if (typeof v === "object") return "对象";
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v);
  return String(v);
}
function issue(field: string, level: "error" | "warn", message: string): SaveIssue {
  return { field, level, message };
}

// ================================================================ 装备条目
/** 单件装备字典校验(where 为定位前缀,如 "bag.3" / "equip.weapon")。
 *  依据:Item.stats()/rarityColor()/statLines() 等对 slot/rarity/词缀零容错消费
 *  (items.ts:73,84,166-201),坏值即 TypeError。 */
export function validateItemDict(item: any, where: string): SaveIssue[] {
  const out: SaveIssue[] = [];
  if (!isObj(item)) {
    out.push(issue(where, "error", `装备条目必须是普通对象(当前 ${fmtVal(item)})`));
    return out;
  }
  if (typeof item.slot !== "string" || !SLOTS.some(s => s.id === item.slot)) {
    out.push(issue(`${where}.slot`, "error",
      `slot 必须是 SLOTS 中的装备槽 id(当前 ${fmtVal(item.slot)})`));
  }
  if (typeof item.rarity !== "string" || !Object.hasOwn(RARITY_IDX, item.rarity)) {
    out.push(issue(`${where}.rarity`, "error",
      `rarity 必须是 6 档稀有度 key 之一(当前 ${fmtVal(item.rarity)}),否则 RARITY_IDX 查不到即崩`));
  }
  if (!isInt(item.tier) || item.tier < 1) {
    out.push(issue(`${where}.tier`, "error", `tier 必须为 ≥1 的整数(当前 ${fmtVal(item.tier)})`));
  }
  if (!isInt(item.plus) || item.plus < 0) {
    out.push(issue(`${where}.plus`, "error", `plus 必须为 ≥0 的整数(当前 ${fmtVal(item.plus)})`));
  }
  if (!isFiniteNum(item.main_val)) {
    out.push(issue(`${where}.main_val`, "error", `main_val 必须为有限数字(当前 ${fmtVal(item.main_val)})`));
  }
  if (!Array.isArray(item.affixes)) {
    out.push(issue(`${where}.affixes`, "error", `affixes 必须是数组(当前 ${fmtVal(item.affixes)})`));
  } else {
    item.affixes.forEach((a: any, j: number) => {
      const f = `${where}.affixes.${j}`;
      if (!Array.isArray(a) || a.length !== 2) {
        out.push(issue(f, "error", `词条必须是 [词缀id, 数值] 二元组(当前 ${fmtVal(a)})`));
      } else {
        if (typeof a[0] !== "string" || !Object.hasOwn(AFFIX_DEF, a[0])) {
          out.push(issue(`${f}.0`, "error", `词缀 id 必须在 AFFIXES 池内(当前 ${fmtVal(a[0])})`));
        }
        if (!isFiniteNum(a[1])) {
          out.push(issue(`${f}.1`, "error", `词条数值必须为有限数字(当前 ${fmtVal(a[1])})`));
        }
      }
    });
  }
  if (item.main_id !== undefined && item.main_id !== null
      && !MAIN_IDS.includes(item.main_id)) {
    out.push(issue(`${where}.main_id`, "error",
      `main_id 只能为 ${MAIN_IDS.join("/")}(当前 ${fmtVal(item.main_id)}),否则主属性折算异常`));
  }
  if (item.name !== undefined && item.name !== null && typeof item.name !== "string") {
    out.push(issue(`${where}.name`, "warn", `name 应为字符串(当前 ${fmtVal(item.name)}),否则显示异常`));
  }
  return out;
}

// ================================================================ 遗物条目
/** 单件遗物字典校验(where 同上,如 "relics.2" / "relic_bag.5";空槽 null 合法)。
 *  依据:effectLines 的 RELIC_EFF_DEF[e.id].name 零容错(relics.ts:63-66)。 */
export function validateRelicDict(relic: any, where: string): SaveIssue[] {
  const out: SaveIssue[] = [];
  if (!isObj(relic)) {
    out.push(issue(where, "error", `遗物条目必须是普通对象,空槽应为 null(当前 ${fmtVal(relic)})`));
    return out;
  }
  if (typeof relic.rarity !== "string" || !Object.hasOwn(RARITY_IDX, relic.rarity)) {
    out.push(issue(`${where}.rarity`, "error",
      `rarity 必须是 6 档稀有度 key 之一(当前 ${fmtVal(relic.rarity)})`));
  }
  if (!isFiniteNum(relic.tier)) {
    out.push(issue(`${where}.tier`, "error", `tier 必须为有限数字(当前 ${fmtVal(relic.tier)})`));
  }
  if (!Array.isArray(relic.effects)) {
    out.push(issue(`${where}.effects`, "error", `effects 必须是数组(当前 ${fmtVal(relic.effects)})`));
  } else {
    relic.effects.forEach((e: any, j: number) => {
      const f = `${where}.effects.${j}`;
      if (!Array.isArray(e) || e.length !== 2) {
        out.push(issue(f, "error", `效果必须是 [效果id, 数值] 二元组(当前 ${fmtVal(e)})`));
      } else {
        if (typeof e[0] !== "string" || !Object.hasOwn(RELIC_EFF_DEF, e[0])) {
          out.push(issue(`${f}.0`, "error", `效果 id 必须在 RELIC_EFFECTS 池内(当前 ${fmtVal(e[0])})`));
        }
        if (!isFiniteNum(e[1])) {
          out.push(issue(`${f}.1`, "error", `效果数值必须为有限数字(当前 ${fmtVal(e[1])})`));
        }
      }
    });
  }
  if (relic.skill_id !== undefined && relic.skill_id !== null
      && (typeof relic.skill_id !== "string" || !Object.hasOwn(ACTIVE_DEF, relic.skill_id))) {
    out.push(issue(`${where}.skill_id`, "warn",
      `skill_id 不在主动技能池(当前 ${fmtVal(relic.skill_id)}),显示为 "?"`));
  }
  if (relic.name !== undefined && relic.name !== null && typeof relic.name !== "string") {
    out.push(issue(`${where}.name`, "warn", `name 应为字符串(当前 ${fmtVal(relic.name)}),否则显示异常`));
  }
  return out;
}

// ================================================================ 整档
/** 校验存档字典(v7 语义)。返回全部问题;无 error 即可写回。
 *  field 形如 "bag.3.affixes.1.0"、"quests.0.type"、"equip.weapon.rarity"。 */
export function validateSaveDict(d: Record<string, any>): SaveIssue[] {
  const out: SaveIssue[] = [];

  // ---- error:version / gear_rules_21 / class_id / mode / level ----
  if (!isInt(d.version) || d.version > SAVE_VERSION) {
    out.push(issue("version", "error",
      `version 须为 ≤${SAVE_VERSION} 的整数(当前 ${fmtVal(d.version)}),migrateSave 按版本改写`));
  } else if (d.version < SAVE_VERSION) {
    out.push(issue("version", "warn",
      `version=${d.version} < ${SAVE_VERSION}:载入将执行迁移(v<4 会重置职业/装配)`));
  }
  if (d.gear_rules_21 !== true) {
    out.push(issue("gear_rules_21", "error",
      `gear_rules_21 必须为 true(当前 ${fmtVal(d.gear_rules_21)}),否则载入即清空 equip+bag`));
  }
  if (d.class_id !== undefined && d.class_id !== null) {
    if (typeof d.class_id !== "string" || !Object.hasOwn(CLASSES, d.class_id)) {
      out.push(issue("class_id", "error",
        `class_id 须为 CLASSES 键之一(当前 ${fmtVal(d.class_id)}),否则技能校验全挂`));
    }
  } else {
    const kills = isObj(d.stats) && isFiniteNum(d.stats.kills) ? d.stats.kills : 0;
    const lv = isInt(d.level) ? d.level : 1;
    if (lv >= 10 || kills >= 100) {
      out.push(issue("class_id", "warn",
        `class_id 为空但进度较高(Lv.${lv}/击杀 ${kills}):未开局状态与进度矛盾`));
    }
  }
  if (d.mode !== "push" && d.mode !== "farm") {
    out.push(issue("mode", "error", `mode 须为 push/farm(当前 ${fmtVal(d.mode)}),否则静默回落 push`));
  }
  if (!isInt(d.level) || d.level < 1) {
    out.push(issue("level", "error", `level 须为 ≥1 的整数(当前 ${fmtVal(d.level)}),recalcHero 以其为乘区输入`));
  }

  // ---- error:equip / bag ----
  if (!isObj(d.equip)) {
    out.push(issue("equip", "error", `equip 必须是普通对象(当前 ${fmtVal(d.equip)}),fromDict 无容错`));
  } else {
    for (const k of Object.keys(d.equip)) {
      if (!SLOTS.some(s => s.id === k)) {
        out.push(issue(`equip.${k}`, "error", `equip 键须为 SLOTS id(当前 ${fmtVal(k)})`));
      }
      out.push(...validateItemDict(d.equip[k], `equip.${k}`));
    }
  }
  if (!Array.isArray(d.bag)) {
    out.push(issue("bag", "error", `bag 必须是数组(当前 ${fmtVal(d.bag)}),fromDict 无容错`));
  } else {
    d.bag.forEach((it: any, i: number) => out.push(...validateItemDict(it, `bag.${i}`)));
    const expLv = isInt(d.bag_exp_lv) && d.bag_exp_lv >= 0 ? d.bag_exp_lv : 0;
    const cap = Math.min(BAL.bag_size + BAL.bag_expand_step * expLv, BAL.bag_expand_max);
    if (d.bag.length > cap) {
      out.push(issue("bag", "warn", `背包 ${d.bag.length} 件超容量 ${cap}:新掉落将触发自动出售`));
    }
  }

  // ---- error:quests ----
  if (!Array.isArray(d.quests)) {
    out.push(issue("quests", "error", `quests 必须是数组(当前 ${fmtVal(d.quests)})`));
  } else {
    if (d.quests.length !== 3) {
      out.push(issue("quests", "warn", `quests 长度应为 3(当前 ${d.quests.length}),fromDict 会截断/补齐`));
    }
    d.quests.forEach((q: any, i: number) => {
      const f = `quests.${i}`;
      if (!isObj(q)) {
        out.push(issue(f, "error", `悬赏条目必须是普通对象(当前 ${fmtVal(q)})`));
        return;
      }
      if (typeof q.type !== "string" || !QUEST_TYPES.some(t => t.type === q.type)) {
        out.push(issue(`${f}.type`, "error",
          `type 须为 QUEST_TYPES 4 类之一(当前 ${fmtVal(q.type)}),否则 questDesc 的 find(...)!.tpl 崩`));
      }
      for (const k of ["target", "progress", "gold", "stones"]) {
        if (!isFiniteNum(q[k])) {
          out.push(issue(`${f}.${k}`, "error", `${k} 须为有限数字(当前 ${fmtVal(q[k])}),参与比较与发奖算术`));
        }
      }
    });
  }

  // ---- error:relics / relic_bag / tower ----
  if (!Array.isArray(d.relics)) {
    out.push(issue("relics", "error",
      `relics 必须是数组(当前 ${fmtVal(d.relics)}),形状坏 fromDict 整体重置 4 空槽 = 丢塔成果`));
  } else {
    if (d.relics.length !== 4) {
      out.push(issue("relics", "warn", `relics 长度应为 4(当前 ${d.relics.length}),fromDict 会截断/补齐`));
    }
    d.relics.forEach((r: any, i: number) => {
      if (r === null || r === undefined) return;   // 空槽合法
      out.push(...validateRelicDict(r, `relics.${i}`));
    });
  }
  if (d.relic_bag !== undefined) {
    if (!Array.isArray(d.relic_bag)) {
      out.push(issue("relic_bag", "error",
        `relic_bag 必须是数组(当前 ${fmtVal(d.relic_bag)}),非数组会被 fromDict 整体丢弃 = 丢遗物背包`));
    } else {
      d.relic_bag.forEach((r: any, i: number) => out.push(...validateRelicDict(r, `relic_bag.${i}`)));
      const lv = isInt(d.relic_bag_lv) && d.relic_bag_lv >= 1 ? d.relic_bag_lv : 1;
      const cap = Math.min(BAL.relic_bag_base * 2 ** (lv - 1), BAL.relic_bag_cap);
      if (d.relic_bag.length > cap) {
        out.push(issue("relic_bag", "warn", `遗物背包 ${d.relic_bag.length} 件超容量 ${cap}`));
      }
    }
  } else {
    out.push(issue("relic_bag", "warn",
      "缺 relic_bag/relic_bag_lv 键:此档可能被 Python 端写过,遗物背包已丢失为既有行为(方案 §5.5)"));
  }
  if (!isObj(d.tower) || !isFiniteNum(d.tower?.keys) || !isFiniteNum(d.tower?.max_floor)) {
    out.push(issue("tower", "error",
      `tower 须为 {keys:数字, max_floor:数字,…} 形状(当前 ${fmtVal(d.tower)}),形状坏整体回默认 = 丢进度`));
  }

  // ---- warn:loadout / skill_lv ----
  if (d.loadout !== undefined && !isObj(d.loadout)) {
    out.push(issue("loadout", "warn", `loadout 应为普通对象(当前 ${fmtVal(d.loadout)}),非对象会被重置为空装配`));
  } else if (isObj(d.loadout)) {
    for (const which of ["active", "passive"] as const) {
      const arr = d.loadout[which];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        out.push(issue(`loadout.${which}`, "warn", `loadout.${which} 应为数组(当前 ${fmtVal(arr)})`));
        continue;
      }
      arr.forEach((sid: any, i: number) => {
        const def = (which === "active" ? ACTIVE_DEF : PASSIVE_DEF)[sid as string];
        if (typeof sid !== "string" || !def) {
          out.push(issue(`loadout.${which}.${i}`, "warn",
            `未知技能 id(当前 ${fmtVal(sid)}),折算忽略、装配页异常`));
        } else if (typeof d.class_id === "string" && def.cls !== d.class_id) {
          out.push(issue(`loadout.${which}.${i}`, "warn",
            `技能 ${sid} 属于 ${def.cls},与本档职业不符,折算忽略、装配页异常`));
        }
      });
    }
  }
  if (d.skill_lv !== undefined) {
    if (!isObj(d.skill_lv)) {
      out.push(issue("skill_lv", "warn", `skill_lv 应为普通对象(当前 ${fmtVal(d.skill_lv)})`));
    } else {
      for (const [sid, lv] of Object.entries(d.skill_lv)) {
        if (!Object.hasOwn(ACTIVE_DEF, sid) && !Object.hasOwn(PASSIVE_DEF, sid)) {
          out.push(issue(`skill_lv.${sid}`, "warn", `键不在技能池(当前 ${fmtVal(sid)}),无效但无害`));
        }
        if (!isInt(lv) || lv < 1 || lv > BAL.skill_lv_max) {
          out.push(issue(`skill_lv.${sid}`, "warn",
            `值须为 1..${BAL.skill_lv_max} 的整数(当前 ${fmtVal(lv)}),无效但无害`));
        }
      }
    }
  }

  // ---- warn:stats / settings / stat_mods / altar_lv ----
  if (d.stats !== undefined && !isObj(d.stats)) {
    out.push(issue("stats", "warn", `stats 应为普通对象(当前 ${fmtVal(d.stats)}),非对象静默忽略`));
  }
  if (d.settings !== undefined && !isObj(d.settings)) {
    out.push(issue("settings", "warn", `settings 应为普通对象(当前 ${fmtVal(d.settings)}),非对象行为异常`));
  } else if (isObj(d.settings)) {
    const s = d.settings;
    if (s.auto_sell_idx !== undefined
        && !(isInt(s.auto_sell_idx) && s.auto_sell_idx >= -1 && s.auto_sell_idx <= 5)) {
      out.push(issue("settings.auto_sell_idx", "warn",
        `应 ∈ -1..5(当前 ${fmtVal(s.auto_sell_idx)}),超界静默失效`));
    }
    if (s.speed !== undefined && !(isInt(s.speed) && s.speed >= 1 && s.speed <= 3)) {
      out.push(issue("settings.speed", "warn", `应 ∈ 1..3(当前 ${fmtVal(s.speed)}),超界回落 1x`));
    }
  }
  if (d.stat_mods !== undefined && !Array.isArray(d.stat_mods)) {
    out.push(issue("stat_mods", "warn", `stat_mods 应为数组(当前 ${fmtVal(d.stat_mods)}),非数组静默忽略`));
  }
  if (d.altar_lv !== undefined) {
    if (!isObj(d.altar_lv)) {
      out.push(issue("altar_lv", "warn", `altar_lv 应为普通对象(当前 ${fmtVal(d.altar_lv)})`));
    } else {
      for (const k of Object.keys(d.altar_lv)) {
        if (!ALTAR_LINES.some(l => l.id === k)) {
          out.push(issue(`altar_lv.${k}`, "warn", `键不在 ALTAR_LINES(当前 ${fmtVal(k)}),静默忽略`));
        }
      }
    }
  }

  // ---- warn:进度越界 / 负数资源 / seed / last_saved / 日期 ----
  if (d.zone !== undefined && !(isInt(d.zone) && d.zone >= 1)) {
    out.push(issue("zone", "warn", `zone 应为 ≥1 的整数(当前 ${fmtVal(d.zone)}),下次推进时拉回`));
  }
  for (const k of ["stage", "farm_stage"] as const) {
    if (d[k] !== undefined && !(isInt(d[k]) && d[k] >= 1 && d[k] <= 10)) {
      out.push(issue(k, "warn", `${k} 应 ∈ 1..10(当前 ${fmtVal(d[k])}),下次推进/挂机调整时拉回`));
    }
  }
  for (const k of ["gold", "stones", "xp", "time", "playtime"] as const) {
    if (isFiniteNum(d[k]) && d[k] < 0) {
      out.push(issue(k, "warn", `${k} 为负(${d[k]}):数值合法但反直觉`));
    }
  }
  if (d.seed !== undefined && !isInt(d.seed)) {
    out.push(issue("seed", "warn", `seed 应为整数(当前 ${fmtVal(d.seed)}),行为未定义`));
  }
  if (d.last_saved !== undefined && !isFiniteNum(d.last_saved)) {
    out.push(issue("last_saved", "warn", `last_saved 应为数字(当前 ${fmtVal(d.last_saved)}),离线结算异常`));
  }
  if (typeof d.quest_daily_date === "string" && d.quest_daily_date !== ""
      && !/^\d{4}-\d{2}-\d{2}$/.test(d.quest_daily_date)) {
    out.push(issue("quest_daily_date", "warn",
      `应为 YYYY-MM-DD(当前 ${fmtVal(d.quest_daily_date)}),跨日重置行为未定义`));
  }
  return out;
}
