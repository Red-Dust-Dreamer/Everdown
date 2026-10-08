/** 游戏静态数据 — 与 abyss/data.ts 数值逐项一致(对拍基准) */
import type { Color } from "./ansi.ts";

// ---------------------------------------------------------------- 稀有度
export interface RarityDef {
  key: string; name: string; color: Color; affixes: number; mainMul: number; weight: number;
}
export const RARITIES: RarityDef[] = [
  { key: "common", name: "普通", color: "bright_black", affixes: 1, mainMul: 1.0, weight: 58.0 },
  { key: "fine", name: "精良", color: "green", affixes: 2, mainMul: 1.12, weight: 25.5 },
  { key: "rare", name: "稀有", color: "bright_blue", affixes: 2, mainMul: 1.28, weight: 11.0 },
  { key: "epic", name: "史诗", color: "bright_magenta", affixes: 3, mainMul: 1.48, weight: 4.2 },
  { key: "legendary", name: "传说", color: "bright_yellow", affixes: 3, mainMul: 1.75, weight: 1.4 },
  { key: "mythic", name: "神话", color: "bright_red", affixes: 4, mainMul: 2.1, weight: 0.07 },
];
export const RARITY_IDX: Record<string, number> =
  Object.fromEntries(RARITIES.map((r, i) => [r.key, i]));
export const RARITY_PREFIX = ["破旧的", "精制的", "秘银", "龙裔", "星陨", "湮灭"];

// ---------------------------------------------------------------- 属性键
export type StatKey = "atk" | "def" | "hp" | "haste" | "crit" | "crit_dmg"
  | "lifesteal" | "goldfind" | "skill_lv" | "skill_dmg" | "cd_reduce"
  | "dodge" | "armor_pierce" | "xp_pct" | "dmg_pct" | "luck" | "all";
export const STAT_NAMES: Record<string, string> = {
  atk: "攻击", def: "防御", hp: "生命", haste: "攻速",
  crit: "暴击率", crit_dmg: "暴击伤害", lifesteal: "吸血",
  goldfind: "金币加成", dmg_pct: "伤害加成",
  skill_lv: "全技能等级", skill_dmg: "技能伤害", cd_reduce: "冷却缩减",
  dodge: "闪避", armor_pierce: "无视防御", xp_pct: "经验加成", luck: "幸运",
  // buff 键补充(buff 条/药剂显示用)
  gold: "金币", xp: "经验", all: "全属性",
};

// ---------------------------------------------------------------- 装备槽
export interface SlotDef {
  id: string; name: string; names: string[];
}
export const SLOTS: SlotDef[] = [
  { id: "weapon", name: "武器", names: ["利刃", "战刃", "重锤", "长枪", "巨剑"] },
  { id: "helmet", name: "头盔", names: ["头盔", "面甲", "兜帽", "战冠"] },
  { id: "armor", name: "护甲", names: ["胸甲", "鳞铠", "法袍", "重铠"] },
  { id: "boots", name: "鞋子", names: ["战靴", "疾行鞋", "踏云靴", "铁蹄"] },
  { id: "amulet", name: "项链", names: ["坠饰", "项链", "符珠", "龙牙链"] },
  { id: "ring", name: "戒指", names: ["戒指", "指环", "印记", "魔戒"] },
];
export const SLOT_NAMES: Record<string, string> = Object.fromEntries(SLOTS.map(s => [s.id, s.name]));
/**
 * 主属性候选表(数值体系 2.1):
 * 武器/项链/戒指 = 攻击力(饰品约为武器的 55%);
 * 头盔/护甲/鞋子 = 生命 或 防御 二选一(roll 时等概率)。
 * 数值型主属性 = base + k × tier^item_main_p
 */
export interface MainRoll { stat: StatKey; base: number; k: number }
export const MAIN_ROLLS: Record<string, MainRoll[]> = {
  weapon: [{ stat: "atk", base: 4.0, k: 2.2 }],
  helmet: [{ stat: "hp", base: 30.0, k: 14.0 }, { stat: "def", base: 3.0, k: 1.4 }],
  armor: [{ stat: "hp", base: 30.0, k: 14.0 }, { stat: "def", base: 3.0, k: 1.4 }],
  boots: [{ stat: "hp", base: 30.0, k: 14.0 }, { stat: "def", base: 3.0, k: 1.4 }],
  amulet: [{ stat: "atk", base: 2.2, k: 1.8 }],
  ring: [{ stat: "atk", base: 2.2, k: 1.8 }],
};
export const SLOT_INNATE: Record<string, [StatKey, number]> = {
  boots: ["haste", 2.5], amulet: ["crit_dmg", 6], ring: ["crit", 1.4],
};

// ---------------------------------------------------------------- 词缀池
export interface AffixDef {
  id: StatKey; name: string; lo: number; hi: number; k: number; pct: boolean; weight: number;
  /** 百分比词缀的稀有度分档步长:值 = rid×step + u(0,step) → 白 0~step,神话 5step~6step */
  step?: number;
}
export const AFFIXES: AffixDef[] = [
  { id: "atk", name: "攻击力", lo: 2.0, hi: 4.5, k: 0.05, pct: false, weight: 1.0 },
  { id: "def", name: "防御力", lo: 2.5, hi: 5.0, k: 0.06, pct: false, weight: 0.45 },
  { id: "hp", name: "生命值", lo: 18.0, hi: 38.0, k: 0.35, pct: false, weight: 0.085 },
  { id: "haste", name: "攻击速度", lo: 3.0, hi: 7.0, k: 0, pct: true, weight: 6.5, step: 3 },
  { id: "crit", name: "暴击率", lo: 2.0, hi: 4.5, k: 0, pct: true, weight: 9.0, step: 1.5 },
  { id: "crit_dmg", name: "暴击伤害", lo: 8.0, hi: 16.0, k: 0, pct: true, weight: 2.8, step: 10 },
  { id: "lifesteal", name: "吸血", lo: 1.0, hi: 2.5, k: 0, pct: true, weight: 7.0, step: 1 },
  { id: "goldfind", name: "金币加成", lo: 5.0, hi: 12.0, k: 0, pct: true, weight: 1.8, step: 6 },
  { id: "skill_lv", name: "全技能等级", lo: 1.0, hi: 1.0, k: 0, pct: false, weight: 11.0 },
  // ↑ 新掉落 roll 时随机绑定当前职业一个技能(主动/被动池),词缀名显示为技能名,
  //   只加该技能且不推过 skill_lv_max;name 仅作旧存档未绑定词条的回显(全技能聚合)
  { id: "luck", name: "幸运", lo: 2.0, hi: 5.0, k: 0, pct: true, weight: 5.0, step: 3 },
];
export const AFFIX_DEF: Record<string, AffixDef> = Object.fromEntries(AFFIXES.map(a => [a.id, a]));
export const AFFIX_SUFFIX: Record<string, string> = {
  atk: "蛮力", def: "坚壁", hp: "巨鲸", haste: "疾风",
  crit: "鹰眼", crit_dmg: "斩首", lifesteal: "嗜血",
  goldfind: "贪婪", skill_lv: "大师", luck: "天命",
};
export const CAPS: Partial<Record<StatKey, number>> = {
  haste: 150, crit: 75, lifesteal: 25, luck: 50,
  skill_dmg: 300, cd_reduce: 40, dodge: 40,
  armor_pierce: 50, xp_pct: 200,
};

// ---------------------------------------------------------------- 职业
export interface ClassDef {
  name: string; icon: string; color: Color; desc: string;
  base: { hp: number; atk: number; def: number };
  interval: number; crit0: number;
}
export const CLASSES: Record<string, ClassDef> = {
  warrior: {
    name: "战士", icon: "⚔", color: "bright_red",
    desc: "钢铁与怒火:生存极强,越战越勇,斩杀收头",
    base: { hp: 1.3, atk: 1.05, def: 1.35 }, interval: 1.2, crit0: 0,
  },
  mage: {
    name: "法师", icon: "✦", color: "bright_blue",
    desc: "元素与毁灭:普攻平庸,技能伤害爆炸",
    base: { hp: 1.05, atk: 1.1, def: 1.0 }, interval: 1.2, crit0: 0,
  },
  ranger: {
    name: "射手", icon: "➤", color: "bright_green",
    desc: "风与箭雨:攻速快、暴击高,连击风筝",
    base: { hp: 0.95, atk: 0.95, def: 0.9 }, interval: 0.8, crit0: 5.0,
  },
};

// ---------------------------------------------------------------- 主动技能池
export type ActiveKind = "damage" | "multi" | "buff" | "heal" | "shield" | "execute";
export interface ActiveSkill {
  id: string; cls: string; name: string; icon: string; unlock: number; cd: number;
  color: Color; kind: ActiveKind; base: number; per: number; desc: string;
  hits?: number; lifesteal?: number; def_down?: number; def_down_dur?: number;
  atk_down?: number; atk_down_dur?: number; freeze?: number; must_crit?: boolean;
  vs_elite?: number; mark?: number; mark_dur?: number;
  stat?: StatKey; dur?: number; threshold?: number;
}
export const ACTIVE_SKILLS: ActiveSkill[] = [
  // ---- 战士 ----
  { id: "w_strike", cls: "warrior", name: "重击", icon: "⚔", unlock: 1, cd: 8, color: "bright_yellow", kind: "damage", base: 260, per: 60, desc: "造成 {v}% 攻击力伤害" },
  { id: "w_whirl", cls: "warrior", name: "旋风斩", icon: "🌀", unlock: 5, cd: 5, color: "bright_yellow", kind: "damage", base: 165, per: 37, desc: "快频攻击:造成 {v}% 攻击力伤害" },
  { id: "w_warcry", cls: "warrior", name: "战吼", icon: "🔥", unlock: 8, cd: 24, color: "bright_red", kind: "buff", stat: "atk", base: 45, per: 8, dur: 8, desc: "8秒内攻击力 +{v}%" },
  { id: "w_taunt", cls: "warrior", name: "嘲讽打击", icon: "💢", unlock: 12, cd: 15, color: "bright_yellow", kind: "damage", base: 150, per: 35, atk_down: 15, atk_down_dur: 6, desc: "{v}% 伤害并降低敌人攻击 15%,持续6秒" },
  { id: "w_exec", cls: "warrior", name: "处决", icon: "☠", unlock: 16, cd: 30, color: "bright_magenta", kind: "execute", base: 500, per: 0, threshold: 20, desc: "生命低于20%的敌人直接斩杀(否则 {v}% 伤害)" },
  { id: "w_blood", cls: "warrior", name: "嗜血打击", icon: "🩸", unlock: 20, cd: 12, color: "bright_red", kind: "damage", base: 250, per: 55, lifesteal: 30, desc: "{v}% 伤害,并将伤害的 30% 转为自身生命" },
  { id: "w_wall", cls: "warrior", name: "护盾壁垒", icon: "🛡", unlock: 26, cd: 20, color: "bright_cyan", kind: "shield", base: 25, per: 2, desc: "获得 {v}% 最大生命的护盾" },
  { id: "w_fury", cls: "warrior", name: "狂暴", icon: "⚡", unlock: 32, cd: 30, color: "bright_red", kind: "buff", stat: "haste", base: 40, per: 4, dur: 10, desc: "10秒内攻速 +{v}%" },
  { id: "w_fatal", cls: "warrior", name: "致命一击", icon: "💥", unlock: 40, cd: 20, color: "bright_yellow", kind: "damage", base: 380, per: 72, must_crit: true, desc: "{v}% 伤害,必定暴击" },
  { id: "w_roar", cls: "warrior", name: "毁灭怒吼", icon: "🔥", unlock: 50, cd: 45, color: "bright_red", kind: "buff", stat: "all", base: 30, per: 3, dur: 12, desc: "12秒内全属性 +{v}%" },
  // ---- 法师 ----
  { id: "m_missile", cls: "mage", name: "奥术飞弹", icon: "✧", unlock: 1, cd: 6, color: "bright_blue", kind: "damage", base: 210, per: 50, desc: "射出奥术能量,造成 {v}% 攻击力伤害" },
  { id: "m_fire", cls: "mage", name: "火球术", icon: "🔥", unlock: 5, cd: 10, color: "bright_red", kind: "damage", base: 300, per: 70, desc: "投掷火球,造成 {v}% 攻击力伤害" },
  { id: "m_ice", cls: "mage", name: "寒冰箭", icon: "❄", unlock: 8, cd: 12, color: "bright_cyan", kind: "damage", base: 180, per: 45, atk_down: 25, atk_down_dur: 5, desc: "{v}% 伤害并降低敌人攻击 18%,持续5秒" },
  { id: "m_surge", cls: "mage", name: "奥术涌动", icon: "✦", unlock: 12, cd: 25, color: "bright_blue", kind: "buff", stat: "dmg_pct", base: 50, per: 5, dur: 8, desc: "8秒内造成的所有伤害 +{v}%" },
  { id: "m_chain", cls: "mage", name: "闪电链", icon: "⚡", unlock: 16, cd: 12, color: "bright_yellow", kind: "damage", base: 240, per: 60, vs_elite: 1.5, desc: "{v}% 伤害,对精英与头目 ×1.5" },
  { id: "m_storm", cls: "mage", name: "烈焰风暴", icon: "🌀", unlock: 20, cd: 15, color: "bright_red", kind: "damage", base: 330, per: 76, desc: "烈焰席卷,造成 {v}% 攻击力伤害" },
  { id: "m_nova", cls: "mage", name: "冰霜新星", icon: "❄", unlock: 26, cd: 35, color: "bright_cyan", kind: "damage", base: 150, per: 35, freeze: 3, desc: "{v}% 伤害并冻结敌人 3 秒" },
  { id: "m_shield", cls: "mage", name: "法力护盾", icon: "🛡", unlock: 32, cd: 22, color: "bright_blue", kind: "shield", base: 30, per: 2.5, desc: "获得 {v}% 最大生命的护盾" },
  { id: "m_meteor", cls: "mage", name: "陨石术", icon: "☄", unlock: 40, cd: 26, color: "bright_red", kind: "damage", base: 510, per: 100, desc: "召唤陨石,造成 {v}% 攻击力伤害" },
  { id: "m_cata", cls: "mage", name: "元素灾变", icon: "💥", unlock: 50, cd: 45, color: "bright_magenta", kind: "damage", base: 680, per: 122, must_crit: true, desc: "{v}% 伤害,必定暴击" },
  // ---- 射手 ----
  { id: "r_volley", cls: "ranger", name: "疾风连射", icon: "➤", unlock: 1, cd: 8, color: "bright_green", kind: "multi", base: 90, per: 20, hits: 3, desc: "连射3箭,每箭 {v}% 攻击力伤害" },
  { id: "r_pierce", cls: "ranger", name: "穿透箭", icon: "➤", unlock: 5, cd: 12, color: "bright_green", kind: "damage", base: 280, per: 65, def_down: 20, def_down_dur: 5, desc: "{v}% 伤害并降低敌人防御 20%,持续5秒" },
  { id: "r_mark", cls: "ranger", name: "猎杀印记", icon: "◎", unlock: 8, cd: 18, color: "bright_yellow", kind: "damage", base: 80, per: 20, mark: 25, mark_dur: 10, desc: "标记目标:10秒内对其伤害 +25%(附带 {v}% 伤害)" },
  { id: "r_back", cls: "ranger", name: "后跳射击", icon: "↩", unlock: 12, cd: 10, color: "bright_green", kind: "damage", base: 200, per: 45, lifesteal: 50, desc: "{v}% 伤害,并将伤害的 50% 转为自身生命" },
  { id: "r_rain", cls: "ranger", name: "箭雨", icon: "☔", unlock: 16, cd: 14, color: "bright_green", kind: "multi", base: 105, per: 22, hits: 5, desc: "箭雨覆盖:5连击,每箭 {v}% 攻击力伤害" },
  { id: "r_hawk", cls: "ranger", name: "鹰眼", icon: "👁", unlock: 24, cd: 25, color: "bright_yellow", kind: "buff", stat: "crit", base: 15, per: 1.5, dur: 10, desc: "10秒内暴击率 +{v} 点" },
  { id: "r_dash", cls: "ranger", name: "疾行", icon: "💨", unlock: 26, cd: 22, color: "bright_cyan", kind: "buff", stat: "haste", base: 50, per: 4, dur: 8, desc: "8秒内攻速 +{v}%" },
  { id: "r_deadly", cls: "ranger", name: "致命连射", icon: "💥", unlock: 32, cd: 25, color: "bright_red", kind: "multi", base: 160, per: 34, hits: 3, must_crit: true, desc: "3连击必暴击,每箭 {v}% 攻击力伤害" },
  { id: "r_sky", cls: "ranger", name: "穿云箭", icon: "✷", unlock: 40, cd: 28, color: "bright_yellow", kind: "damage", base: 560, per: 108, desc: "贯穿一切:造成 {v}% 攻击力伤害" },
  { id: "r_god", cls: "ranger", name: "猎神之怒", icon: "🌟", unlock: 50, cd: 45, color: "bright_green", kind: "buff", stat: "all", base: 25, per: 2.5, dur: 12, desc: "12秒内全属性 +{v}%" },
];
export const ACTIVE_DEF: Record<string, ActiveSkill> =
  Object.fromEntries(ACTIVE_SKILLS.map(s => [s.id, s]));

// ---------------------------------------------------------------- 被动技能池
export type HookName = "on_kill_buff" | "low_hp_dmg" | "undying" | "on_crit_haste"
  | "on_crit_dmg_next" | "on_hurt_dmg" | "boss_dmg" | "low_target_dmg";
export interface PassiveSkill {
  id: string; cls: string; name: string; unlock: number; desc: string;
  kind: "stat" | "hook";
  stat?: StatKey; op?: "add" | "pct"; base: number; per: number;
  hook?: HookName; dur?: number;
}
export const PASSIVE_SKILLS: PassiveSkill[] = [
  // ---- 战士 ----
  { id: "pw_tough", cls: "warrior", name: "坚韧", unlock: 1, kind: "stat", stat: "hp", op: "pct", base: 8, per: 0.8, desc: "生命 +{v}%" },
  { id: "pw_brute", cls: "warrior", name: "蛮力", unlock: 5, kind: "stat", stat: "atk", op: "pct", base: 8, per: 0.8, desc: "攻击 +{v}%" },
  { id: "pw_feast", cls: "warrior", name: "杀戮盛宴", unlock: 10, kind: "hook", hook: "on_kill_buff", stat: "atk", base: 10, per: 1, dur: 4, desc: "击杀后4秒内攻击 +{v}%" },
  { id: "pw_iron", cls: "warrior", name: "铁壁", unlock: 15, kind: "stat", stat: "def", op: "pct", base: 10, per: 1, desc: "防御 +{v}%" },
  { id: "pw_unyield", cls: "warrior", name: "不屈", unlock: 20, kind: "hook", hook: "undying", base: 25, per: 1.5, desc: "{v}% 概率免疫致命伤(60秒冷却)" },
  { id: "pw_will", cls: "warrior", name: "战意", unlock: 25, kind: "hook", hook: "low_hp_dmg", base: 30, per: 3, desc: "生命低于一半时伤害 +{v}%" },
  { id: "pw_hunt", cls: "warrior", name: "深渊猎手", unlock: 30, kind: "hook", hook: "boss_dmg", base: 15, per: 1.5, desc: "对精英与头目伤害 +{v}%" },
  { id: "pw_break", cls: "warrior", name: "破甲", unlock: 35, kind: "stat", stat: "armor_pierce", op: "add", base: 10, per: 1, desc: "攻击无视 {v}% 敌人防御" },
  { id: "pw_zerk", cls: "warrior", name: "狂战士", unlock: 45, kind: "hook", hook: "on_crit_haste", base: 20, per: 2, dur: 3, desc: "暴击后3秒攻速 +{v}%" },
  { id: "pw_phoenix", cls: "warrior", name: "不死战魂", unlock: 55, kind: "stat", stat: "all", op: "pct", base: 10, per: 1, desc: "全属性 +{v}%" },
  // ---- 法师 ----
  { id: "pm_affin", cls: "mage", name: "奥术亲和", unlock: 1, kind: "stat", stat: "skill_dmg", op: "add", base: 25, per: 1, desc: "主动技能伤害 +{v}%" },
  { id: "pm_prec", cls: "mage", name: "元素精准", unlock: 5, kind: "stat", stat: "crit", op: "add", base: 3, per: 0.3, desc: "暴击率 +{v} 点" },
  { id: "pm_frost", cls: "mage", name: "冰霜之体", unlock: 10, kind: "stat", stat: "hp", op: "pct", base: 6, per: 0.6, desc: "生命 +{v}%" },
  { id: "pm_sage", cls: "mage", name: "贤者洞察", unlock: 15, kind: "stat", stat: "xp_pct", op: "add", base: 10, per: 1, desc: "经验获取 +{v}%" },
  { id: "pm_torrent", cls: "mage", name: "法力洪流", unlock: 20, kind: "stat", stat: "atk", op: "pct", base: 8, per: 0.8, desc: "攻击 +{v}%" },
  { id: "pm_burn", cls: "mage", name: "燃烧殆尽", unlock: 25, kind: "hook", hook: "low_target_dmg", base: 20, per: 2, desc: "对血量低于30%的敌人伤害 +{v}%" },
  { id: "pm_bar", cls: "mage", name: "秘法屏障", unlock: 30, kind: "stat", stat: "def", op: "pct", base: 8, per: 0.8, desc: "防御 +{v}%" },
  { id: "pm_time", cls: "mage", name: "时间扭曲", unlock: 35, kind: "stat", stat: "cd_reduce", op: "add", base: 8, per: 0.6, desc: "技能冷却 -{v}%" },
  { id: "pm_destr", cls: "mage", name: "毁灭倾向", unlock: 45, kind: "stat", stat: "crit_dmg", op: "add", base: 30, per: 3, desc: "暴击伤害 +{v}%" },
  { id: "pm_arch", cls: "mage", name: "大法师", unlock: 55, kind: "stat", stat: "all", op: "pct", base: 10, per: 1, desc: "全属性 +{v}%" },
  // ---- 射手 ----
  { id: "pr_swift", cls: "ranger", name: "迅捷", unlock: 1, kind: "stat", stat: "haste", op: "add", base: 6, per: 0.6, desc: "攻速 +{v}%" },
  { id: "pr_eye", cls: "ranger", name: "鹰眼视觉", unlock: 5, kind: "stat", stat: "crit", op: "add", base: 3, per: 0.3, desc: "暴击率 +{v} 点" },
  { id: "pr_weak", cls: "ranger", name: "弱点洞察", unlock: 10, kind: "stat", stat: "crit_dmg", op: "add", base: 25, per: 2.5, desc: "暴击伤害 +{v}%" },
  { id: "pr_inst", cls: "ranger", name: "猎人本能", unlock: 15, kind: "hook", hook: "boss_dmg", base: 12, per: 1.2, desc: "对精英与头目伤害 +{v}%" },
  { id: "pr_wind", cls: "ranger", name: "疾风步", unlock: 20, kind: "stat", stat: "dodge", op: "add", base: 8, per: 0.8, desc: "{v}% 概率闪避攻击" },
  { id: "pr_chain", cls: "ranger", name: "连锁反应", unlock: 25, kind: "hook", hook: "on_crit_dmg_next", base: 30, per: 3, desc: "暴击后下次攻击伤害 +{v}%" },
  { id: "pr_avenge", cls: "ranger", name: "复仇", unlock: 30, kind: "hook", hook: "on_hurt_dmg", base: 15, per: 1.5, dur: 4, desc: "受击后4秒内伤害 +{v}%" },
  { id: "pr_chase", cls: "ranger", name: "无情追击", unlock: 35, kind: "hook", hook: "low_target_dmg", base: 18, per: 1.8, desc: "对血量低于40%的敌人伤害 +{v}%" },
  { id: "pr_master", cls: "ranger", name: "箭术大师", unlock: 45, kind: "stat", stat: "skill_dmg", op: "add", base: 8, per: 0.8, desc: "主动技能伤害 +{v}%" },
  { id: "pr_legend", cls: "ranger", name: "传奇猎手", unlock: 55, kind: "stat", stat: "all", op: "pct", base: 10, per: 1, desc: "全属性 +{v}%" },
];
export const PASSIVE_DEF: Record<string, PassiveSkill> =
  Object.fromEntries(PASSIVE_SKILLS.map(s => [s.id, s]));

// ---------------------------------------------------------------- 地图主题
export interface ThemeDef { name: string; mobs: string[]; boss: string; color: Color }
export const THEMES: ThemeDef[] = [
  { name: "幽暗森林", mobs: ["slime", "wolf", "goblin"], boss: "巨型史莱姆王", color: "green" },
  { name: "废弃矿坑", mobs: ["bat", "skeleton", "golem"], boss: "骷髅领主", color: "bright_black" },
  { name: "熔岩地狱", mobs: ["imp", "hound", "elemental"], boss: "炎魔男爵", color: "bright_red" },
  { name: "寒冰冻土", mobs: ["wolf", "golem", "elemental", "drake"], boss: "霜暴巨兽", color: "bright_cyan" },
  { name: "毒雾沼泽", mobs: ["mushroom", "spider", "snake"], boss: "沼泽蛛后", color: "green" },
  { name: "白骨王座", mobs: ["husk", "wight", "scarab"], boss: "白骨君王", color: "white" },
  { name: "腐沼墓地", mobs: ["slime", "skeleton", "bat"], boss: "亡灵大祭司", color: "magenta" },
  { name: "虚空裂隙", mobs: ["imp", "goblin", "hound", "eye"], boss: "虚空吞噬者", color: "bright_magenta" },
];

export interface MobSkill {
  name: string; icon: string; cd: number; mult: number; hits: number;
  lifesteal?: boolean; defdown?: [number, number]; atkdown?: [number, number];
  stun?: number; slow?: [number, number];
}
export interface MobDef { name: string; color: Color; power: number; skill: MobSkill }
export const MONSTERS: Record<string, MobDef> = {
  slime: { name: "史莱姆", color: "green", power: 1.0,
    skill: { name: "酸液喷吐", icon: "☣", cd: 10, mult: 1.2, hits: 1, slow: [0.35, 4] } },
  wolf: { name: "恐狼", color: "yellow", power: 1.05,
    skill: { name: "狂暴撕咬", icon: "🐍", cd: 8, mult: 0.6, hits: 3 } },
  goblin: { name: "哥布林", color: "bright_green", power: 0.95,
    skill: { name: "卑鄙飞刀", icon: "🔪", cd: 12, mult: 2.5, hits: 1 } },
  bat: { name: "吸血蝠", color: "magenta", power: 0.9,
    skill: { name: "血之盛宴", icon: "🩸", cd: 10, mult: 1.5, hits: 1, lifesteal: true } },
  skeleton: { name: "骷髅兵", color: "white", power: 1.05,
    skill: { name: "白骨之刺", icon: "🦴", cd: 12, mult: 2.0, hits: 1, atkdown: [0.2, 5] } },
  golem: { name: "石魔像", color: "bright_black", power: 1.15,
    skill: { name: "大地震颤", icon: "💢", cd: 15, mult: 1.3, hits: 1, stun: 1.2 } },
  imp: { name: "小恶魔", color: "bright_red", power: 1.05,
    skill: { name: "火焰投掷", icon: "🔥", cd: 9, mult: 2.2, hits: 1 } },
  hound: { name: "地狱犬", color: "red", power: 1.1,
    skill: { name: "三头撕咬", icon: "🐺", cd: 9, mult: 0.85, hits: 3 } },
  elemental: { name: "元素灵", color: "bright_cyan", power: 1.05,
    skill: { name: "元素风暴", icon: "⚡", cd: 14, mult: 2.8, hits: 1 } },
  // ---- 毒雾沼泽 / 白骨王座(CC0 立绘:public/mon/<id>.png) ----
  mushroom: { name: "毒蘑菇", color: "green", power: 0.95,
    skill: { name: "孢子毒云", icon: "☣", cd: 11, mult: 1.3, hits: 1, atkdown: [0.2, 5] } },
  spider: { name: "红背毒蛛", color: "red", power: 1.0,
    skill: { name: "缠丝连蛰", icon: "🕸", cd: 10, mult: 0.55, hits: 3, defdown: [0.25, 4], stun: 1.0 } },
  snake: { name: "黑曼巴蛇", color: "bright_black", power: 1.05,
    skill: { name: "毒牙速咬", icon: "🦷", cd: 9, mult: 0.7, hits: 3 } },
  husk: { name: "肿胀腐尸", color: "magenta", power: 0.95,
    skill: { name: "尸毒喷发", icon: "☠", cd: 11, mult: 1.6, hits: 1, atkdown: [0.2, 4] } },
  wight: { name: "白骨武士", color: "white", power: 1.15,
    skill: { name: "幽冥斩", icon: "⚔", cd: 10, mult: 2.3, hits: 1 } },
  scarab: { name: "噬骨甲虫", color: "yellow", power: 1.0,
    skill: { name: "甲群啃噬", icon: "🐜", cd: 9, mult: 0.45, hits: 4 } },
  // ---- 散怪:强化既有主题 ----
  drake: { name: "霜翼幼龙", color: "bright_cyan", power: 1.15,
    skill: { name: "寒霜吐息", icon: "❄", cd: 13, mult: 2.4, hits: 1, slow: [0.3, 5] } },
  eye: { name: "辉光邪眼", color: "bright_magenta", power: 1.1,
    skill: { name: "疯狂凝视", icon: "👁", cd: 12, mult: 1.9, hits: 1, stun: 1.0 } },
};

export const ART: Record<string, string[]> = {
  slime: ["   _____     ", "  /     \\    ", " |  > <  |   ", "  \\ __  /    ", "   \\___/     "],
  wolf: ["  /\\___/\\    ", " (  ω  )\\,,  ", "  |    | ||  ", " /|    |\\||  ", " ‾‾     ‾    "],
  goblin: ["   ,,,,      ", "  (o-o)      ", " <|  |>>     ", "  _| |_      ", "  /   \\      "],
  bat: [" __  __      ", "/  \\/  \\,_,  ", "\\_/\\_/\\ 'b, ", "  _||_       ", "             "],
  skeleton: ["   .-.       ", "  (o o)      ", "  |' '|      ", "  |   |      ", "  _/ \\_      "],
  golem: ["  [===]      ", "  |o°o|      ", " [|||]|]     ", "  |___|      ", " _/] [_\\     "],
  imp: ["  \\|/        ", " (>v<)       ", " </_\\>       ", "  | |        ", " _/ \\_       "],
  hound: [" ^   ^      ", " (◉ ω ◉)~,  ", "   /|\\       ", "  / | \\      ", "    ‾        "],
  elemental: ["   (  )      ", "  ( ◉ )     ", "   )  (      ", "  ( ⚡ )     ", "   \\  /      "],
  mushroom: ["    ____     ", "   / @@ \\    ", "   \\____/    ", "   _|  |_    ", "  /|    |\\    "],
  spider: ["  \\ _||_ /   ", "    (oo)     ", "   /##\\      ", "  //  \\\\     ", " _/    \\_    "],
  snake: ["    ____     ", "   / o \\     ", "   \\    \\,   ", "  < ~~  /    ", "   \\___/     "],
  husk: ["   .----.    ", "  ( x  x )   ", "  | ~~~~ |   ", " /|      |\\  ", "  _|____|_   "],
  wight: ["   [====]    ", "   |-o o|    ", "  <|    |>   ", "   |    |    ", "  _/    \\_   "],
  scarab: ["    ____     ", "   /o^^o\\    ", "  |@ @@ @|   ", "   \\====/    ", "  _/    \\_   "],
  drake: ["  \\  /\\  /   ", "   ( oo )    ", "  --/  \\--   ", "  /|    |\\   ", "   |____|    "],
  eye: ["   .----.    ", "  / ---- \\   ", " |  (OO)  |  ", "  \\ ---- /   ", "   \\____/    "],
};

// ---------------------------------------------------------------- 成就
export interface AchievementDef {
  id: string; name: string; metric: string; thresholds: number[];
  stat: string; per: number;
}
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "slayer", name: "深渊猎手", metric: "kills", thresholds: [100, 1000, 10000, 50000, 150000, 500000], stat: "atk", per: 4 },
  { id: "zonewalk", name: "开疆拓土", metric: "max_zone", thresholds: [3, 6, 10, 15, 25, 40, 60, 100], stat: "hp", per: 6 },
  { id: "smith", name: "锻造宗师", metric: "enhance_total", thresholds: [10, 50, 200, 600, 2000], stat: "def", per: 5 },
  { id: "boss", name: "弑主者", metric: "boss_kills", thresholds: [10, 50, 200, 800, 2400, 8000], stat: "crit", per: 2 },
  { id: "tycoon", name: "深渊富豪", metric: "gold_earned", thresholds: [1e4, 1e5, 1e6, 1e8, 1e10], stat: "goldfind", per: 5 },
  { id: "death", name: "不死鸟", metric: "deaths", thresholds: [1, 10, 50, 200, 800], stat: "hp", per: 3 },
  // ---- 2.3 第二梯队:终身统计已有数据、此前无人消费的六个新维度 ----
  { id: "rebirther", name: "轮回大师", metric: "rebirths", thresholds: [1, 5, 15, 40], stat: "atk", per: 4 },
  { id: "climber", name: "登塔者", metric: "max_floor", thresholds: [5, 15, 30, 50], stat: "def", per: 5 },
  { id: "bounty", name: "赏金猎人", metric: "quest_done", thresholds: [10, 50, 150, 400], stat: "goldfind", per: 5 },
  { id: "alchemist", name: "炼金术士", metric: "reforge_total", thresholds: [5, 25, 100, 300], stat: "hp", per: 3 },
  { id: "fatality", name: "致命一击", metric: "crit_hits", thresholds: [1000, 10000, 100000], stat: "crit", per: 2 },
  { id: "dweller", name: "深渊住民", metric: "playtime", thresholds: [3600, 21600, 86400, 432000], stat: "xp_pct", per: 2 },
];

// ---------------------------------------------------------------- 每日签到(2.3):7 日循环,断签重置
export interface SigninReward {
  icon: string; label: string;
  gold?: number; stones?: number; keys?: number; potion?: string;
}
/** 奖励量级刻意保守(远低于当日挂机收入):仪式感优先,不加速无墙曲线 */
export const SIGNIN_REWARDS: SigninReward[] = [
  { icon: "◈", label: "5,000 金币", gold: 5000 },
  { icon: "✦", label: "2 重铸石", stones: 2 },
  { icon: "◈", label: "15,000 金币", gold: 15000 },
  { icon: "🔑", label: "塔钥匙 ×2", keys: 2 },
  { icon: "◈", label: "50,000 金币", gold: 50000 },
  { icon: "✦", label: "5 重铸石", stones: 5 },
  { icon: "🧪", label: "力量药剂 ×1(免费)", potion: "might" },
];

// ---------------------------------------------------------------- 周常(2.3):ISO 周一 0 点重置
export interface WeeklyGoalDef {
  id: string; name: string; target: number;
  /** 计数口径(与 weeklyBump 调用点对应) */
  metric: "kills" | "boss" | "quests" | "zones" | "rebirths" | "enhance";
}
export const WEEKLY_GOALS: WeeklyGoalDef[] = [
  { id: "w_kill", name: "本周击杀 2000", target: 2000, metric: "kills" },
  { id: "w_boss", name: "本周头目 40", target: 40, metric: "boss" },
  { id: "w_quest", name: "本周悬赏 8", target: 8, metric: "quests" },
  { id: "w_zone", name: "本周推进 15 区", target: 15, metric: "zones" },
  { id: "w_reb", name: "本周转生 1 次", target: 1, metric: "rebirths" },
  { id: "w_enh", name: "本周强化 150 次", target: 150, metric: "enhance" },
];
/** 周宝箱:完成 3 项 ✦8;全 6 项 ✦20 + 称号「周征服者」 */
export const WEEKLY_CHEST = [
  { id: "chest3", need: 3, stones: 8, label: "完成 3 项" },
  { id: "chest6", need: 6, stones: 20, label: "全部完成", title: "t_week" },
];

// ---------------------------------------------------------------- 称号(2.3):转生世数 + 周常全勤
export interface TitleDef { id: string; name: string; cond: string; }
export const TITLES: TitleDef[] = [
  { id: "t_reb1", name: "轮回者", cond: "转生 1 次" },
  { id: "t_reb5", name: "深渊行者", cond: "转生 5 次" },
  { id: "t_reb15", name: "涅槃之焰", cond: "转生 15 次" },
  { id: "t_reb40", name: "万劫归一", cond: "转生 40 次" },
  { id: "t_week", name: "周征服者", cond: "周常全部完成" },
];

// ---------------------------------------------------------------- 兑换码(2.3):本地哈希校验,零后端
/** 单机游戏,防君子不防小人;码表哈希内嵌,声称记录进存档防重复 */
export interface RedeemDef {
  /** FNV-1a 32bit 哈希(码统一大写去空白) */
  hash: number; label: string;
  gold?: number; stones?: number; keys?: number;
}
export const REDEEM_CODES: RedeemDef[] = [
  { hash: 2332319329, label: "上线礼包:◈10万 + ✦5 + 🔑1", gold: 100000, stones: 5, keys: 1 },
  { hash: 3102457229, label: "深潜者礼包:✦3", stones: 3 },
  { hash: 456085019, label: "首杀礼包:◈2万", gold: 20000 },
];   // 由 scripts/gen_redeem.ts 生成注入

// ---------------------------------------------------------------- 悬赏任务
export interface QuestTypeDef {
  type: string; tpl: string; base: number; growth: number; goldK: number; stones: number;
}
export const QUEST_TYPES: QuestTypeDef[] = [
  { type: "kill", tpl: "击杀 {n} 只怪物", base: 20, growth: 1.15, goldK: 25, stones: 0 },
  { type: "boss", tpl: "击败 {n} 个头目", base: 2, growth: 1.1, goldK: 40, stones: 1 },
  { type: "loot", tpl: "获取 {n} 件稀有+装备", base: 3, growth: 1.12, goldK: 30, stones: 1 },
  { type: "enhance", tpl: "强化装备 {n} 次", base: 3, growth: 1.15, goldK: 35, stones: 1 },
];

// ---------------------------------------------------------------- 平衡常数
// ---------------------------------------------------------------- 深渊祭坛(金币→永久属性)
// 费用多项式无上限、每级收益恒定:收入增长被平方费用自然吞噬(金币长期黑洞)。
export interface AltarLine {
  id: string; name: string; icon: string;
  stat: string; op: "pct" | "add"; per: number;   // pct=百分比乘区 / add=点数
}
export const ALTAR_LINES: AltarLine[] = [
  { id: "power",  name: "力量祭坛", icon: "⚔", stat: "atk",      op: "pct", per: 0.4 },
  { id: "vigor",  name: "生命祭坛", icon: "❤", stat: "hp",       op: "pct", per: 1.0 },
  { id: "guard",  name: "守护祭坛", icon: "🛡", stat: "def",      op: "pct", per: 1.0 },
  { id: "edge",   name: "锋锐祭坛", icon: "🗡", stat: "crit_dmg", op: "add", per: 0.5 },
  { id: "swift",  name: "迅捷祭坛", icon: "💨", stat: "haste",    op: "add", per: 0.3 },
  { id: "greed",  name: "贪婪祭坛", icon: "◈", stat: "goldfind", op: "add", per: 0.5 },
];

// ---------------------------------------------------------------- 临时药剂(30 分钟增益,buff 管道)
export interface PotionDef {
  id: string; name: string; icon: string;
  buff: string;      // buff 键:atk=攻击 / xp=经验 / gold=金币
  pct: number; dur: number;   // 增幅% 与 秒
}
export const POTIONS: PotionDef[] = [
  { id: "might",   name: "力量药剂", icon: "🧪", buff: "atk",  pct: 20, dur: 1800 },
  { id: "wisdom",  name: "智慧药剂", icon: "⚗",  buff: "xp",   pct: 50, dur: 1800 },
  { id: "fortune", name: "贪婪药剂", icon: "💰", buff: "gold", pct: 30, dur: 1800 },
];

export const BAL = {
  hero_hp0: 120.0, hero_atk0: 15.0, hero_def0: 3.0,
  hero_interval: 1.1, hero_crit0: 5.0, hero_critdmg0: 50.0,
  hp_per_lv: 6.0, atk_per_lv: 1.2, def_per_lv: 0.5,
  xp_req0: 60.0, xp_req_p: 1.90,

  kills_per_stage: 3,

  // 怪物属性(2026-10-01 提升):装备等级落后 20~30 级将明显打不过
  mob_hp0: 50.0, mob_hp_k: 32.0, mob_hp_p: 1.28,
  mob_atk0: 6.8, mob_atk_k: 2.8, mob_atk_p: 1.05,
  mob_def0: 3.0, mob_def_k: 1.5, mob_def_p: 1.0,
  mob_interval: 1.6,
  boss_hp: 2.6, boss_atk: 1.15, boss_gold: 5.0, boss_interval: 3.2,
  elite_hp: 3.0, elite_atk: 1.3, elite_gold: 2.5,
  elite_chance: 0.10,
  // 等级压制:怪物tier超过装备最高tier 100以上,每差100 → 全属性×2(叠乘)
  gear_gap_base: 100, gear_gap_mult: 2.0,

  gold0: 6.0, gold_k: 3.0, gold_p: 0.85,
  xp0: 9.0, xp_k: 3.5, xp_p: 0.75,
  drop_chance: 0.16, elite_drop: 0.35,
  boss_drop: 1.0, boss_stone_chance: 0.6, boss_stone_amt: 2,

  item_main_p: 1.12,

  plus_pct_1: 8.0, plus_pct_2: 4.0, plus_pct_3: 1.5,
  enhance_cost0: 25.0, enhance_cost_t: 1.8,
  enhance_plus_a: 0.5, enhance_plus_b: 0.04,
  plus_max: 100,          // 装备强化等级上限
  reforge_stones: 3,
  // 重铸(洗脸)按品质决定洗词条数:精良/稀有=1,史诗/传说=2,神话=3
  reforge_slots: [1, 1, 1, 2, 2, 3],
  luck_reforge_k: 300,
  bag_size: 40,
  // 遗物背包:基础 40 格,升级容量翻倍(40→80→160→200 封顶);
  // 费用 1w 升 2 级、5w 升 3 级,此后每级 ×5
  relic_bag_base: 40,
  relic_bag_cap: 200,
  relic_bag_cost0: 10000,
  relic_bag_cost_k: 5.0,
  quest_daily_limit: 10,      // 每日完成悬赏上限(本地 0 点重置)
  altar_cost0: 200, altar_cost_lv: 80, altar_cost_lv2: 10, altar_cost_t: 3,
  potion_cost0: 10_000,        // 药剂初始价;每购买一次价格翻倍(30 分钟增益)
  potion_cost_cap: 1_000_000,  // 药剂单次购买价格上限
  tower_key_extra: 10,       // 每日可加购钥匙数(免费 3 把之外)
  tower_key_cost_k: 150,     // 第 n 把加购价格 = k × n × 击杀金
  bag_expand_step: 10,       // 背包每次扩容格数
  bag_expand_max: 100,       // 背包容量上限
  bag_expand_cost0: 30000,   // 扩容费用 = cost0×n + cost_k×n²(n=第几次)
  bag_expand_cost_k: 5000,
  quest_reroll_max: 3,       // 每日悬赏刷新次数
  quest_reroll_cost_k: 100,  // 第 n 次刷新价格 = k × (n+1) × 击杀金

  skill_cost0: 60.0, skill_cost_lv: 35.0, skill_cost_lv2: 6.0,
  skill_cost_t: 2.0,
  skill_lv_max: 10,        // 金币升级技能等级上限
  loadout_unlock: [1, 8, 16, 26],
  undying_cd: 60.0,

  offline_cap_sec: 12 * 3600,
  offline_min_sec: 60,
  offline_item_cap: 15,

  respawn_sec: 4.0,
  // 游戏倍速档位(等级门槛):1x 始终可用,Lv10 解锁 2x,Lv30 解锁 3x
  speed_unlock: [1, 10, 30],
  death_row_to_farm: 2,
  farm_stuck_row: 5,   // 挂机层位连续战败 N 次:视为层位过高,退 3 层止损

  // ---- 转生(2.2):重置本局成长,换永久倍率;成就/祭坛/遗物/塔记录终身保留 ----
  rebirth_min_level: 50,   // 转生门槛:英雄等级(×1速约 4h;开倍速专注玩约 2h,50 级大招转生前必体验)
  // ---- 方案B(2.3.1):转生收益按本世深度加权 ----
  // k = clamp(本世最远区 / rebirth_depth_ref, k_min, k_max);转生时 rebirths += k。
  // 锚点≈Lv50 门槛自然深度(踩线转=基准 +25%/+10%);封顶 4 倍防滚雪球。
  // 老档整数世数天然等值(k=1),零迁移。模拟:受阻才转 48h 达 4994 区(plain 2352/贪转卡 134)。
  rebirth_depth_ref: 130,  // 深度锚点:该前沿区转生 = 基准收益(k=1)
  rebirth_k_min: 0.25,     // 下限:极浅转生(挂机层被拖低时)保底 1/4 档
  rebirth_k_max: 4,        // 上限:520 区及以上固定 4 档(+100% 三围/+40% 金币经验)
  rebirth_stat_pct: 25,    // 每基准世:攻击/生命/防御 +25%(× k)
  rebirth_gain_pct: 10,    // 每基准世:金币加成/经验加成 +10%(× k;与 stat 同 k)

  // ---- 玩家自动化三开关(2.2.2):逐步放手,先强化→技能→祭坛 ----
  auto_enhance_lv: 20,     // 自动强化解锁等级
  auto_skill_lv: 30,       // 自动升技能解锁等级
  auto_altar_lv: 40,       // 自动献祭解锁等级

  // ---- 图鉴二期(2.3):每点亮一种怪的永久加成(攻/生命各按此系数 × 已点亮数) ----
  codex_per: 0.3,          // 每种 +0.3%;全 17 种 = 各 +5.1%(轻量,不扰动主线曲线)
} as const;

export const VIRTUAL_STATS = ["skill_dmg", "cd_reduce", "dodge", "armor_pierce", "xp_pct"] as const;

// ---------------------------------------------------------------- 遗物系统(爬塔副本)
export interface TowerDef {
  keys_per_day: number; keys_cap: number; relic_slots: number;
  th0: number; thk: number; thp: number;
  ta0: number; tak: number; tap: number;
  td0: number; tdk: number; tdp: number;
  boss_every: number;
  drop_gold_mult: number; new_height_stones: number;
}
export const TOWER: TowerDef = {
  keys_per_day: 3, keys_cap: 99, relic_slots: 4,
  th0: 80.0, thk: 45.0, thp: 1.18,
  ta0: 10.0, tak: 3.5, tap: 1.02,
  td0: 5.0, tdk: 2.0, tdp: 1.0,
  boss_every: 5,
  drop_gold_mult: 2.0, new_height_stones: 2,
};
/** 遗物效果池:(id, 名, lo, hi, 单位) */
export interface RelicEffDef { id: string; name: string; lo: number; hi: number; unit: string }
export const RELIC_EFFECTS: RelicEffDef[] = [
  { id: "skill_lv_r", name: "单技能等级", lo: 1.0, hi: 2.0, unit: "级" },  // 随机指定一个已装配主动技能
  { id: "cd_reduce", name: "冷却缩减", lo: 3.0, hi: 8.0, unit: "%" },
  { id: "skill_dmg", name: "技能伤害", lo: 5.0, hi: 15.0, unit: "%" },
  { id: "crit_extra", name: "暴击追击", lo: 5.0, hi: 15.0, unit: "%" },
  { id: "kill_heal", name: "击杀回血", lo: 2.0, hi: 6.0, unit: "%" },
  { id: "deathward", name: "不死", lo: 5.0, hi: 15.0, unit: "%" },
  { id: "boss_dmg_r", name: "猎首", lo: 5.0, hi: 15.0, unit: "%" },
  { id: "kill_haste", name: "杀意", lo: 5.0, hi: 15.0, unit: "%" },
  { id: "goldfind", name: "聚宝", lo: 5.0, hi: 15.0, unit: "%" },
];
export const RELIC_EFF_DEF: Record<string, RelicEffDef> =
  Object.fromEntries(RELIC_EFFECTS.map(e => [e.id, e]));
/** 各稀有度的遗物效果条数 */
export const RELIC_EFF_COUNT: number[] = [1, 1, 2, 2, 3, 3];
