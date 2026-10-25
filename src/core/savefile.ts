/** 存档字典校验(管理面板用;规则矩阵与代码行依据 = docs/admin-panel.md §5.2)。
 *
 * 纯函数:无副作用、不修改入参;枚举一律现读 data.ts 核心表(禁止手写字面量,
 * 防枚举漂移),SAVE_VERSION 现读 game.ts。error = 引擎崩溃/静默丢数据/破坏枚举
 * (阻断写回);warn = 引擎容错但体验/数据受影响(仅提示)。
 */
import { SAVE_VERSION } from "./game.ts";
import {
  ACTIVE_DEF, AFFIX_DEF, ALTAR_LINES, BAL, CLASSES, MAIN_ROLLS, MONSTERS,
  PASSIVE_DEF, QUEST_TYPES, RARITY_IDX, REDEEM_CODES, RELIC_EFF_DEF,
  SIGNIN_REWARDS, SLOTS, SUIT_DEF, TITLES, WEEKLY_CHEST, WEEKLY_GOALS,
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
  // 2.3:装备附带技能 / 锁定标记(items.ts toDict 条件序列化)
  if (item.skill_sid !== undefined && item.skill_sid !== null
      && (typeof item.skill_sid !== "string"
          || (!Object.hasOwn(ACTIVE_DEF, item.skill_sid) && !Object.hasOwn(PASSIVE_DEF, item.skill_sid)))) {
    out.push(issue(`${where}.skill_sid`, "warn",
      `skill_sid 不在技能池(当前 ${fmtVal(item.skill_sid)}),技能折算/显示忽略`));
  }
  // 2.5:深渊套装标记 —— 非 null 必须在 SUIT_DEF 键集内(枚举现读 data.ts 表),
  // 违规即 error:suitMods/suitDef 对未知 id 只能静默跳过 = 套装加成静默丢失
  if (item.suit_id !== undefined && item.suit_id !== null
      && (typeof item.suit_id !== "string" || !Object.hasOwn(SUIT_DEF, item.suit_id))) {
    out.push(issue(`${where}.suit_id`, "error",
      `suit_id 必须是 SUITS 中的套装 id(当前 ${fmtVal(item.suit_id)}),否则套装加成静默丢失`));
  }
  if (item.locked !== undefined && typeof item.locked !== "boolean") {
    out.push(issue(`${where}.locked`, "warn",
      `locked 应为布尔(当前 ${fmtVal(item.locked)}),锁定/批量分解判定异常`));
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
  if (d.rebirths !== undefined && !(isInt(d.rebirths) && d.rebirths >= 0)) {
    out.push(issue("rebirths", "warn",
      `rebirths 应为 ≥0 的整数(当前 ${fmtVal(d.rebirths)}),非法值回落 0 = 丢转生加成`));
  }

  // ---- warn:2.2-2.3 批次新字段(签到/周常/称号/世系/兑换/图鉴/自动化) ----
  if (d.signin_pos !== undefined && !isInt(d.signin_pos)) {
    out.push(issue("signin_pos", "warn",
      `signin_pos 应为整数(当前 ${fmtVal(d.signin_pos)}),引擎按周期取模,非法值回落 0`));
  }
  if (d.signin_last !== undefined && d.signin_last !== null && typeof d.signin_last !== "string") {
    out.push(issue("signin_last", "warn", `signin_last 应为字符串日期(当前 ${fmtVal(d.signin_last)})`));
  }
  if (d.week_key !== undefined && d.week_key !== null && typeof d.week_key !== "string") {
    out.push(issue("week_key", "warn", `week_key 应为字符串(当前 ${fmtVal(d.week_key)}),异常则周进度重置`));
  }
  if (d.weekly !== undefined && !isObj(d.weekly)) {
    out.push(issue("weekly", "warn", `weekly 应为普通对象(当前 ${fmtVal(d.weekly)})`));
  } else if (isObj(d.weekly)) {
    for (const [gid, prog] of Object.entries(d.weekly)) {
      if (!WEEKLY_GOALS.some(g => g.id === gid)) {
        out.push(issue(`weekly.${gid}`, "warn", `键不在 WEEKLY_GOALS(当前 ${fmtVal(gid)}),显示忽略`));
      }
      if (!isFiniteNum(prog) || prog < 0) {
        out.push(issue(`weekly.${gid}`, "warn", `进度应为 ≥0 数字(当前 ${fmtVal(prog)})`));
      }
    }
  }
  if (d.weekly_claimed !== undefined) {
    if (!Array.isArray(d.weekly_claimed)) {
      out.push(issue("weekly_claimed", "warn", `weekly_claimed 应为数组(当前 ${fmtVal(d.weekly_claimed)})`));
    } else {
      for (const cid of d.weekly_claimed) {
        if (!WEEKLY_CHEST.some(c => c.id === cid)) {
          out.push(issue("weekly_claimed", "warn", `宝箱 id 不在 WEEKLY_CHEST(当前 ${fmtVal(cid)})`));
        }
      }
    }
  }
  if (d.titles !== undefined) {
    if (!Array.isArray(d.titles)) {
      out.push(issue("titles", "warn", `titles 应为数组(当前 ${fmtVal(d.titles)})`));
    } else {
      for (const tid of d.titles) {
        if (!TITLES.some(t => t.id === tid)) {
          out.push(issue("titles", "warn", `称号 id 不在 TITLES(当前 ${fmtVal(tid)}),显示为原值`));
        }
      }
    }
  }
  if (d.title !== undefined && d.title !== null && d.title !== ""
      && !TITLES.some(t => t.id === d.title)) {
    out.push(issue("title", "warn", `当前称号 id 不在 TITLES(当前 ${fmtVal(d.title)})`));
  }
  if (d.lineage !== undefined) {
    if (!Array.isArray(d.lineage)) {
      out.push(issue("lineage", "warn", `lineage 应为数组(当前 ${fmtVal(d.lineage)}),非数组静默忽略`));
    } else {
      d.lineage.forEach((e: any, i: number) => {
        if (!isObj(e)) {
          out.push(issue(`lineage.${i}`, "warn", `世系条目应为普通对象(当前 ${fmtVal(e)})`));
          return;
        }
        if (typeof e.cls !== "string") {
          out.push(issue(`lineage.${i}.cls`, "warn", `cls 应为字符串("?" 合法;当前 ${fmtVal(e.cls)})`));
        }
        for (const k of ["level", "zone", "kills", "dur"] as const) {
          if (!isFiniteNum(e[k])) {
            out.push(issue(`lineage.${i}.${k}`, "warn", `${k} 应为数字(当前 ${fmtVal(e[k])})`));
          }
        }
      });
      if (d.lineage.length > 50) {
        out.push(issue("lineage", "warn", `世系 ${d.lineage.length} 条超 50,引擎只保留前 50`));
      }
    }
  }
  if (d.run_start_playtime !== undefined && !isFiniteNum(d.run_start_playtime)) {
    out.push(issue("run_start_playtime", "warn", `应为数字(当前 ${fmtVal(d.run_start_playtime)})`));
  }
  if (d.run_max_zone !== undefined && !(isInt(d.run_max_zone) && d.run_max_zone >= 1)) {
    out.push(issue("run_max_zone", "warn",
      `应为 ≥1 整数(当前 ${fmtVal(d.run_max_zone)}),转生深度加权 k 的输入`));
  }
  if (d.redeemed !== undefined) {
    if (!Array.isArray(d.redeemed)) {
      out.push(issue("redeemed", "warn", `redeemed 应为数组(当前 ${fmtVal(d.redeemed)})`));
    } else {
      const hashes = new Set(REDEEM_CODES.map(c => c.hash));
      for (const h of d.redeemed) {
        if (!isInt(h) || !hashes.has(h)) {
          out.push(issue("redeemed", "warn", `兑换哈希不在 REDEEM_CODES(当前 ${fmtVal(h)})`));
        }
      }
    }
  }
  if (d.mon_kills !== undefined) {
    if (!isObj(d.mon_kills)) {
      out.push(issue("mon_kills", "warn", `mon_kills 应为普通对象(当前 ${fmtVal(d.mon_kills)})`));
    } else {
      for (const [mid, n] of Object.entries(d.mon_kills)) {
        if (!Object.hasOwn(MONSTERS, mid)) {
          out.push(issue(`mon_kills.${mid}`, "warn", `键不在 MONSTERS(当前 ${fmtVal(mid)}),图鉴不显示`));
        }
        if (!isInt(n) || n < 0) {
          out.push(issue(`mon_kills.${mid}`, "warn", `击杀数应为 ≥0 整数(当前 ${fmtVal(n)})`));
        }
      }
    }
  }
  if (d.death_tier !== undefined && !isFiniteNum(d.death_tier)) {
    out.push(issue("death_tier", "warn", `death_tier 应为数字(-1=无;当前 ${fmtVal(d.death_tier)})`));
  }
  if (d.auto_farm !== undefined && typeof d.auto_farm !== "boolean") {
    out.push(issue("auto_farm", "warn", `auto_farm 应为布尔(当前 ${fmtVal(d.auto_farm)}),异常回落 false`));
  }

  // ---- warn:世界BOSS·周轮合力(2.6)本地轮次状态(fromDict 全防御,坏值回落默认) ----
  if (d.boss !== undefined) {
    if (!isObj(d.boss)) {
      out.push(issue("boss", "warn",
        `boss 应为普通对象(当前 ${fmtVal(d.boss)}),非对象回落默认 = 丢 claimed 领取记录`));
    } else {
      if (d.boss.last_round !== undefined && d.boss.last_round !== null
          && typeof d.boss.last_round !== "string") {
        out.push(issue("boss.last_round", "warn",
          `last_round 应为字符串轮号(当前 ${fmtVal(d.boss.last_round)}),非法值回 ""`));
      }
      if (d.boss.attempts !== undefined
          && !(isInt(d.boss.attempts) && d.boss.attempts >= 0
               && d.boss.attempts <= BAL.world_boss_attempts)) {
        out.push(issue("boss.attempts", "warn",
          `attempts 应 ∈ 0..${BAL.world_boss_attempts}(当前 ${fmtVal(d.boss.attempts)}),载入时钳制`));
      }
      if (d.boss.my_best !== undefined && !(isFiniteNum(d.boss.my_best) && d.boss.my_best >= 0)) {
        out.push(issue("boss.my_best", "warn",
          `my_best 应为 ≥0 数字(当前 ${fmtVal(d.boss.my_best)}),非法值回 0`));
      }
      if (d.boss.claimed !== undefined) {
        if (!Array.isArray(d.boss.claimed)) {
          out.push(issue("boss.claimed", "warn",
            `claimed 应为字符串数组(当前 ${fmtVal(d.boss.claimed)}),非数组回空`));
        } else {
          d.boss.claimed.forEach((r: any, i: number) => {
            if (typeof r !== "string") {
              out.push(issue(`boss.claimed.${i}`, "warn",
                `轮号应为字符串(当前 ${fmtVal(r)}),载入时过滤`));
            }
          });
          if (d.boss.claimed.length > BAL.world_boss_claim_keep) {
            out.push(issue("boss.claimed", "warn",
              `已领 ${d.boss.claimed.length} 轮超保留上限 ${BAL.world_boss_claim_keep},下次同步裁剪`));
          }
        }
      }
    }
  }

  // ---- warn:异步切磋(2.7)本地战绩(fromDict 全防御,负数/非整数钳 0) ----
  if (d.arena !== undefined) {
    if (!isObj(d.arena)) {
      out.push(issue("arena", "warn",
        `arena 应为普通对象(当前 ${fmtVal(d.arena)}),非对象回落默认 = 丢战绩计数`));
    } else {
      if (d.arena.wins !== undefined && !(isInt(d.arena.wins) && d.arena.wins >= 0)) {
        out.push(issue("arena.wins", "warn",
          `wins 应为 ≥0 整数(当前 ${fmtVal(d.arena.wins)}),载入时钳 0`));
      }
      if (d.arena.losses !== undefined && !(isInt(d.arena.losses) && d.arena.losses >= 0)) {
        out.push(issue("arena.losses", "warn",
          `losses 应为 ≥0 整数(当前 ${fmtVal(d.arena.losses)}),载入时钳 0`));
      }
    }
  }
  return out;
}
