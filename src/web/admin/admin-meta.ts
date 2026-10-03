/// <reference lib="dom" />
/** 管理面板 · 数值覆盖元数据:分类树 / 中文标签 / 🔒锁定行 / ⚠警示行。
 *  🔒清单与核心层 R6 双保险(docs/admin-panel.md §4.3):
 *   ① 末段 ∈ {id,key,cls,stat,hook,op,type,metric,buff,kind,pct}
 *   ② 路径前缀命中 THEMES.<n>.mobs.<i>
 *   ③ 根=SLOT_INNATE 且路径恰 3 段且末段==="0" */
import {
  ACHIEVEMENTS, AFFIXES, AFFIX_SUFFIX, ACTIVE_SKILLS, ALTAR_LINES, BAL, CAPS,
  CLASSES, MAIN_ROLLS, MONSTERS, PASSIVE_SKILLS, POTIONS, QUEST_TYPES, RARITIES,
  RARITY_PREFIX, RELIC_EFF_COUNT, RELIC_EFFECTS, SLOTS, SLOT_INNATE, STAT_NAMES,
  THEMES, TOWER,
} from "../../core/data.ts";

export const ROOTS: Record<string, unknown> = {
  BAL, RARITIES, RARITY_PREFIX, SLOTS, MAIN_ROLLS, SLOT_INNATE, AFFIXES,
  AFFIX_SUFFIX, CAPS, CLASSES, ACTIVE_SKILLS, PASSIVE_SKILLS, THEMES, MONSTERS,
  ACHIEVEMENTS, QUEST_TYPES, ALTAR_LINES, POTIONS, STAT_NAMES, TOWER,
  RELIC_EFFECTS, RELIC_EFF_COUNT,
};

// ---------------------------------------------------------------- 12 分类
export interface Category { id: string; name: string }
export const CATEGORIES: Category[] = [
  { id: "hero", name: "英雄成长" },
  { id: "combat", name: "战斗与怪物" },
  { id: "drop", name: "掉落与稀有度" },
  { id: "gear", name: "装备与词缀" },
  { id: "active", name: "主动技能" },
  { id: "passive", name: "被动技能" },
  { id: "class", name: "职业" },
  { id: "relic", name: "遗物与爬塔" },
  { id: "econ", name: "经济与消耗" },
  { id: "quest", name: "悬赏与成就" },
  { id: "altar", name: "祭坛与药剂" },
  { id: "misc", name: "解锁节奏与杂项" },
];

/** BAL 键 → 中文(数值表"中文名"列的主数据源) */
const BAL_LABELS: Record<string, string> = {
  hero_hp0: "英雄初始生命", hero_atk0: "英雄初始攻击", hero_def0: "英雄初始防御",
  hero_interval: "英雄攻击间隔", hero_crit0: "英雄初始暴击率", hero_critdmg0: "英雄初始暴伤",
  hp_per_lv: "每级生命成长", atk_per_lv: "每级攻击成长", def_per_lv: "每级防御成长",
  xp_req0: "升级经验基数", xp_req_p: "升级经验指数",
  kills_per_stage: "每层击杀数",
  mob_hp0: "怪物生命基数", mob_hp_k: "怪物生命系数", mob_hp_p: "怪物生命指数",
  mob_atk0: "怪物攻击基数", mob_atk_k: "怪物攻击系数", mob_atk_p: "怪物攻击指数",
  mob_def0: "怪物防御基数", mob_def_k: "怪物防御系数", mob_def_p: "怪物防御指数",
  mob_interval: "怪物攻击间隔",
  boss_hp: "头目生命倍率", boss_atk: "头目攻击倍率", boss_gold: "头目金币倍率",
  boss_interval: "头目攻击间隔",
  elite_hp: "精英生命倍率", elite_atk: "精英攻击倍率", elite_gold: "精英金币倍率",
  elite_chance: "精英出现概率",
  gear_gap_base: "等级压制门槛", gear_gap_mult: "等级压制倍率",
  gold0: "击杀金币基数", gold_k: "击杀金币系数", gold_p: "击杀金币指数",
  xp0: "击杀经验基数", xp_k: "击杀经验系数", xp_p: "击杀经验指数",
  drop_chance: "基础掉落率", elite_drop: "精英掉落率", boss_drop: "头目掉落率",
  boss_stone_chance: "头目掉石概率", boss_stone_amt: "头目掉石数量",
  item_main_p: "主属性成长指数",
  plus_pct_1: "强化加成段1", plus_pct_2: "强化加成段2", plus_pct_3: "强化加成段3",
  enhance_cost0: "强化费用基数", enhance_cost_t: "强化费用深度项",
  enhance_plus_a: "强化费用系数A", enhance_plus_b: "强化费用系数B",
  plus_max: "强化等级上限",
  reforge_stones: "重铸石费用",
  luck_reforge_k: "幸运重铸系数",
  bag_size: "背包基础容量",
  relic_bag_base: "遗物背包基数", relic_bag_cap: "遗物背包上限",
  relic_bag_cost0: "遗物背包费用基数", relic_bag_cost_k: "遗物背包费用倍率",
  quest_daily_limit: "每日悬赏上限",
  altar_cost0: "祭坛费用基数", altar_cost_lv: "祭坛费用线性项",
  altar_cost_lv2: "祭坛费用平方项", altar_cost_t: "祭坛费用深度项",
  potion_cost_k: "药剂价格系数",
  tower_key_extra: "每日可加购钥匙数", tower_key_cost_k: "钥匙价格系数",
  bag_expand_step: "背包扩容步长", bag_expand_max: "背包容量上限",
  bag_expand_cost0: "扩容费用基数", bag_expand_cost_k: "扩容费用系数",
  quest_reroll_max: "每日悬赏刷新次数", quest_reroll_cost_k: "刷新价格系数",
  skill_cost0: "技能升级费用基数", skill_cost_lv: "技能升级费用线性项",
  skill_cost_lv2: "技能升级费用平方项", skill_cost_t: "技能升级费用深度项",
  skill_lv_max: "金币技能等级上限",
  undying_cd: "不屈冷却秒数",
  offline_cap_sec: "离线收益上限秒", offline_min_sec: "离线结算最短秒",
  offline_item_cap: "离线掉落件数上限",
  respawn_sec: "复活等待秒数",
  death_row_to_farm: "连败转挂机次数",
};

/** 数组型 BAL 键 → 单元素标签(下标自动拼上) */
const BAL_ARR_LABELS: Record<string, string> = {
  loadout_unlock: "装配槽解锁等级", speed_unlock: "倍速解锁等级",
  reforge_slots: "各稀有度重铸条数",
};

/** 表内常见字段 → 中文 */
const FIELD_LABELS: Record<string, string> = {
  name: "名称", icon: "图标", color: "颜色", desc: "说明", tpl: "任务模板",
  weight: "权重", affixes: "词条数", mainMul: "主属性倍率", step: "分档步长",
  lo: "下限", hi: "上限", k: "斜率系数",
  cd: "冷却秒数", base: "基础值", per: "每级成长", dur: "持续秒数",
  unlock: "解锁等级", hits: "段数", mult: "伤害倍率", lifesteal: "吸血比例",
  def_down: "降防比例", def_down_dur: "降防持续", atk_down: "降攻比例",
  atk_down_dur: "降攻持续", freeze: "冻结秒数", must_crit: "必定暴击",
  vs_elite: "对精英倍率", mark: "标记增伤", mark_dur: "标记持续",
  threshold: "斩杀阈值", power: "强度系数", boss: "头目名",
  interval: "攻击间隔", crit0: "初始暴击率",
  hp: "生命", atk: "攻击", def: "防御",
  names: "名字池", mobs: "怪物池",
  keys_per_day: "每日钥匙数", keys_cap: "钥匙囤积上限", relic_slots: "遗物槽数",
  th0: "塔生命基数", thk: "塔生命系数", thp: "塔生命指数",
  ta0: "塔攻击基数", tak: "塔攻击系数", tap: "塔攻击指数",
  td0: "塔防御基数", tdk: "塔防御系数", tdp: "塔防御指数",
  boss_every: "头目层间隔", drop_gold_mult: "塔金币倍率", new_height_stones: "新高重铸石",
  unit: "单位", growth: "成长系数", goldK: "金币系数", stones: "重铸石奖励",
  pct: "百分比口径", buff: "buff 键", metric: "计量键", thresholds: "门槛",
  per_lv: "每级", base_n: "基数",
};

// ---------------------------------------------------------------- 锁定/警示
const LOCKED_KEYS = new Set(["id", "key", "cls", "stat", "hook", "op", "type",
  "metric", "buff", "kind", "pct"]);

/** 数组下标段(与核心 overrides.ts NUM_SEG 同款) */
const NUM_SEG = /^\d+$/;

/** 与核心 R6 逐字同清单(见文件头) */
export function isLockedPath(path: string): boolean {
  const segs = path.split(".");
  const last = segs[segs.length - 1];
  if (LOCKED_KEYS.has(last)) return true;                              // ①
  if (segs.length >= 4 && segs[0] === "THEMES" && NUM_SEG.test(segs[1])
      && segs[2] === "mobs" && NUM_SEG.test(segs[3])) return true;     // ②
  if (segs[0] === "SLOT_INNATE" && segs.length === 3 && last === "0") return true;  // ③
  return false;
}

/** ⚠ 警示行:核心接受但后果需知(docs/admin-panel.md §3 Tab2 / §10 R2) */
export function warnText(path: string): string | null {
  if (/^RARITIES\.\d+\.affixes$/.test(path))
    return "词条数改变 rng 调用序列:TS 端随机流与 Python 基准行为分歧,同 seed 不可复现基准局;追求对拍口径时不要改";
  if (/^RELIC_EFF_COUNT\.\d+$/.test(path))
    return "遗物效果条数改变 rng 调用次数:TS 与 Python 行为分歧(不影响 parity,对拍不加载覆盖)";
  if (path === "TOWER.relic_slots")
    return "运行时遗物槽位数硬编码 4(game.ts relics 数组),改此表项不生效";
  return null;
}

// ---------------------------------------------------------------- 分类
const CAT_BY_ROOT: Record<string, string> = {
  ACTIVE_SKILLS: "active", PASSIVE_SKILLS: "passive", CLASSES: "class",
  QUEST_TYPES: "quest", ACHIEVEMENTS: "quest", ALTAR_LINES: "altar", POTIONS: "altar",
  TOWER: "relic", RELIC_EFFECTS: "relic", RELIC_EFF_COUNT: "relic",
  RARITIES: "drop", RARITY_PREFIX: "drop", THEMES: "combat", MONSTERS: "combat",
  SLOTS: "gear", MAIN_ROLLS: "gear", SLOT_INNATE: "gear", AFFIXES: "gear",
  AFFIX_SUFFIX: "gear", CAPS: "gear", STAT_NAMES: "misc",
};

const CAT_BY_BAL: [RegExp, string][] = [
  [/^hero_|_per_lv$|^xp_req/, "hero"],
  [/^mob_|^boss_|^elite_|^gear_gap|^kills_per_stage/, "combat"],
  [/^drop_chance|^elite_drop|^boss_drop|^boss_stone/, "drop"],
  [/^item_main|^plus_|^enhance_|^reforge|^luck_reforge|^bag_size|^bag_expand/, "gear"],
  [/^relic_bag/, "relic"],
  [/^gold[0-9_]|^gold_k|^gold_p|^xp[0-9_]|^xp_k|^xp_p|^altar_|^potion_|^skill_cost|^skill_lv_max/, "econ"],
  [/^quest_/, "quest"],
  [/^loadout_unlock|^speed_unlock|^undying_cd|^offline_|^respawn_sec|^death_row/, "misc"],
];

export function categoryOf(path: string): string {
  const segs = path.split(".");
  if (segs[0] === "BAL") {
    const key = segs.length === 2 ? segs[1] : `${segs[1]}.*`;
    for (const [re, cat] of CAT_BY_BAL) if (re.test(key)) return cat;
    return "misc";
  }
  return CAT_BY_ROOT[segs[0]] ?? "misc";
}

export function categoryName(id: string): string {
  return CATEGORIES.find(c => c.id === id)?.name ?? id;
}

// ---------------------------------------------------------------- 中文标签
/** 沿数据树走路径,收集祖先的 name 字段(如技能名/怪物名/主题名) */
function ancestorNames(path: string): string[] {
  const segs = path.split(".");
  let node: unknown = ROOTS[segs[0]];
  const names: string[] = [];
  for (let i = 1; i < segs.length - 1 && node !== undefined && node !== null; i++) {
    node = (node as Record<string, any>)[segs[i]];
    if (node && typeof node === "object" && !Array.isArray(node)
      && typeof (node as any).name === "string") {
      names.push((node as any).name);
    }
  }
  return names;
}

export function leafLabel(path: string): string {
  const segs = path.split(".");
  const last = segs[segs.length - 1];
  if (segs[0] === "BAL") {
    if (segs.length === 2 && BAL_LABELS[segs[1]]) return BAL_LABELS[segs[1]];
    if (segs.length === 3 && BAL_ARR_LABELS[segs[1]])
      return `${BAL_ARR_LABELS[segs[1]]}[${segs[2]}]`;
  }
  if (segs[0] === "STAT_NAMES") return `属性名·${last}`;
  if (segs[0] === "CAPS") return `上限·${STAT_NAMES[last] ?? last}`;
  if (segs[0] === "AFFIX_SUFFIX") return `后缀·${last}`;
  if (segs[0] === "RARITY_PREFIX") return `稀有度前缀[${segs[1]}]`;
  if (segs[0] === "RELIC_EFF_COUNT") return `遗物效果条数[${segs[1]}档]`;
  if (segs[0] === "MAIN_ROLLS") {
    // MAIN_ROLLS.<slot>.<下标>.<字段>:stat 藏在表项里,须查表取名(segs[2] 是下标)
    const roll = (MAIN_ROLLS[segs[1]] ?? [])[Number(segs[2])];
    const st = typeof roll?.stat === "string" ? roll.stat : (segs[2] ?? "");
    const fld = segs.length >= 4 ? segs[3] : "";
    return `主属性roll·${segs[1]}·${STAT_NAMES[st] ?? st}·${FIELD_LABELS[fld] ?? fld}`;
  }
  const anc = ancestorNames(path);
  const fldLabel = FIELD_LABELS[last] ?? last;
  const idxLabel = /^\d+$/.test(last) ? `[${last}]` : fldLabel;
  return anc.length ? `${anc.join("·")}·${idxLabel}` : idxLabel;
}
