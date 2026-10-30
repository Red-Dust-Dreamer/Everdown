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
  | "dodge" | "armor_pierce" | "xp_pct" | "dmg_pct" | "luck" | "all"
  | "boss_dmg_r" | "kill_heal" | "deathward";
export const STAT_NAMES: Record<string, string> = {
  atk: "攻击", def: "防御", hp: "生命", haste: "攻速",
  crit: "暴击率", crit_dmg: "暴击伤害", lifesteal: "吸血",
  goldfind: "金币加成", dmg_pct: "伤害加成",
  skill_lv: "全技能等级", skill_dmg: "技能伤害", cd_reduce: "冷却缩减",
  dodge: "闪避", armor_pierce: "无视防御", xp_pct: "经验加成", luck: "幸运",
  boss_dmg_r: "猎首", kill_heal: "击杀回血", deathward: "不死",
  // VIRTUAL_STATS 补全:套装效果文案(suitEffText)直查本表,缺键=裸键名漏给玩家;
  // 命名与 RELIC_EFFECTS 同键条目一致(暴击追击/杀意)
  crit_extra: "暴击追击", kill_haste: "杀意",
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
    // hp 0.95→1.05(留存诊断建议4):ranger 真实流失 83%、模拟零操作死亡最多——
    // 削 1 区墙(建议1)主要救 warrior 形态,这里救 ranger 的高频死亡形态
    base: { hp: 1.05, atk: 0.95, def: 0.9 }, interval: 0.8, crit0: 5.0,
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
  // 持续伤害(燃烧/流血/灼命):瞬间小伤害 + 挂 dot;
  // 每跳% = dot_base + dot_per*(lv-1),持续 dot_dur 秒、每 dot_tick 秒一跳;
  // dot_lifesteal=每跳伤害按%回血(嗜血);dot_icon/dot_label=表现层徽章与飘字
  dot_base?: number; dot_per?: number; dot_dur?: number; dot_tick?: number;
  dot_lifesteal?: number; dot_icon?: string; dot_label?: string;
  // 引导攻击(旋风斩):channel 秒内均匀打满 hits 跳,每跳 {v}%;
  // 引导期间英雄不出手其他攻击(普攻与其他技能都暂停,冷却照走)
  channel?: number;
}
export const ACTIVE_SKILLS: ActiveSkill[] = [
  // ---- 战士 ----
  { id: "w_strike", cls: "warrior", name: "重击", icon: "⚔", unlock: 1, cd: 8, color: "bright_yellow", kind: "damage", base: 260, per: 60, desc: "造成 {v}% 攻击力伤害" },
  { id: "w_whirl", cls: "warrior", name: "旋风斩", icon: "🌀", unlock: 5, cd: 5, color: "bright_yellow", kind: "damage", base: 45, per: 10, hits: 6, channel: 2, desc: "旋风引导:2 秒内连续攻击 6 次,每次 {v}% 攻击力伤害;期间不进行其他攻击,目标倒下也不中断" },
  { id: "w_warcry", cls: "warrior", name: "战吼", icon: "🔥", unlock: 8, cd: 24, color: "bright_red", kind: "buff", stat: "atk", base: 45, per: 8, dur: 8, desc: "8秒内攻击力 +{v}%" },
  { id: "w_taunt", cls: "warrior", name: "嘲讽打击", icon: "💢", unlock: 12, cd: 15, color: "bright_yellow", kind: "damage", base: 150, per: 35, atk_down: 15, atk_down_dur: 6, desc: "{v}% 伤害并降低敌人攻击 15%,持续6秒" },
  { id: "w_exec", cls: "warrior", name: "处决", icon: "☠", unlock: 16, cd: 30, color: "bright_magenta", kind: "execute", base: 500, per: 0, threshold: 20, desc: "生命低于20%的敌人直接斩杀(否则 {v}% 伤害)" },
  { id: "w_blood", cls: "warrior", name: "嗜血打击", icon: "🩸", unlock: 20, cd: 12, color: "bright_red", kind: "damage", base: 80, per: 18, lifesteal: 30, dot_base: 22, dot_per: 4, dot_dur: 5, dot_tick: 0.5, dot_lifesteal: 30, dot_icon: "🩸", dot_label: "流血", desc: "{v}% 伤害并撕裂:流血 5 秒,每 0.5 秒 {d}%,全部伤害的 30% 转为自身生命" },
  { id: "w_wall", cls: "warrior", name: "护盾壁垒", icon: "🛡", unlock: 26, cd: 20, color: "bright_cyan", kind: "shield", base: 25, per: 2, desc: "获得 {v}% 最大生命的护盾" },
  { id: "w_fury", cls: "warrior", name: "狂暴", icon: "⚡", unlock: 32, cd: 30, color: "bright_red", kind: "buff", stat: "haste", base: 40, per: 4, dur: 10, desc: "10秒内攻速 +{v}%" },
  { id: "w_fatal", cls: "warrior", name: "致命一击", icon: "💥", unlock: 40, cd: 20, color: "bright_yellow", kind: "damage", base: 380, per: 72, must_crit: true, desc: "{v}% 伤害,必定暴击" },
  { id: "w_roar", cls: "warrior", name: "毁灭怒吼", icon: "🔥", unlock: 50, cd: 45, color: "bright_red", kind: "buff", stat: "all", base: 30, per: 3, dur: 12, desc: "12秒内全属性 +{v}%" },
  // ---- 法师 ----
  { id: "m_missile", cls: "mage", name: "奥术飞弹", icon: "✧", unlock: 1, cd: 6, color: "bright_blue", kind: "damage", base: 235, per: 55, desc: "射出奥术能量,造成 {v}% 攻击力伤害" },
  { id: "m_fire", cls: "mage", name: "火球术", icon: "🔥", unlock: 5, cd: 10, color: "bright_red", kind: "damage", base: 110, per: 24, hits: 3, channel: 1.5, desc: "聚气吟唱:1.5 秒连发 3 枚火球,每枚 {v}% 攻击力伤害;期间不进行其他攻击,目标倒下也不中断" },
  { id: "m_ice", cls: "mage", name: "寒冰箭", icon: "❄", unlock: 8, cd: 12, color: "bright_cyan", kind: "damage", base: 180, per: 45, atk_down: 25, atk_down_dur: 5, desc: "{v}% 伤害并降低敌人攻击 18%,持续5秒" },
  { id: "m_surge", cls: "mage", name: "奥术涌动", icon: "✦", unlock: 12, cd: 25, color: "bright_blue", kind: "buff", stat: "dmg_pct", base: 50, per: 5, dur: 8, desc: "8秒内造成的所有伤害 +{v}%" },
  { id: "m_chain", cls: "mage", name: "闪电链", icon: "⚡", unlock: 16, cd: 12, color: "bright_yellow", kind: "damage", base: 240, per: 60, vs_elite: 1.65, desc: "{v}% 伤害,对精英与头目 ×1.65" },
  { id: "m_storm", cls: "mage", name: "烈焰风暴", icon: "🌀", unlock: 20, cd: 15, color: "bright_red", kind: "damage", base: 90, per: 22, dot_base: 24, dot_per: 5, dot_dur: 6, dot_tick: 0.5, dot_icon: "🔥", dot_label: "燃烧", desc: "烈焰席卷:{v}% 伤害并点燃,燃烧 6 秒,每 0.5 秒 {d}%" },
  { id: "m_nova", cls: "mage", name: "冰霜新星", icon: "❄", unlock: 26, cd: 35, color: "bright_cyan", kind: "damage", base: 150, per: 35, freeze: 3, desc: "{v}% 伤害并冻结敌人 3 秒" },
  { id: "m_shield", cls: "mage", name: "法力护盾", icon: "🛡", unlock: 32, cd: 22, color: "bright_blue", kind: "shield", base: 30, per: 2.5, desc: "获得 {v}% 最大生命的护盾" },
  { id: "m_meteor", cls: "mage", name: "陨石术", icon: "☄", unlock: 40, cd: 26, color: "bright_red", kind: "damage", base: 130, per: 25, hits: 4, channel: 2, desc: "陨石吟唱:2 秒内 4 段陨石相继坠落,每段 {v}% 攻击力伤害;期间不进行其他攻击,目标倒下也不中断" },
  { id: "m_cata", cls: "mage", name: "元素灾变", icon: "💥", unlock: 50, cd: 45, color: "bright_magenta", kind: "damage", base: 680, per: 122, must_crit: true, desc: "{v}% 伤害,必定暴击" },
  // ---- 射手 ----
  { id: "r_volley", cls: "ranger", name: "疾风连射", icon: "➤", unlock: 1, cd: 8, color: "bright_green", kind: "multi", base: 90, per: 20, hits: 3, desc: "连射3箭,每箭 {v}% 攻击力伤害" },
  { id: "r_pierce", cls: "ranger", name: "穿透箭", icon: "➤", unlock: 5, cd: 12, color: "bright_green", kind: "damage", base: 280, per: 65, def_down: 20, def_down_dur: 5, desc: "{v}% 伤害并降低敌人防御 20%,持续5秒" },
  { id: "r_mark", cls: "ranger", name: "猎杀印记", icon: "◎", unlock: 8, cd: 18, color: "bright_yellow", kind: "damage", base: 50, per: 12, mark: 25, mark_dur: 10, dot_base: 14, dot_per: 3, dot_dur: 8, dot_tick: 0.5, dot_icon: "◎", dot_label: "灼命", desc: "灼命印记:灼烧 8 秒,每 0.5 秒 {d}%,期间对其伤害 +25%,附带 {v}% 伤害" },
  { id: "r_back", cls: "ranger", name: "后跳射击", icon: "↩", unlock: 12, cd: 10, color: "bright_green", kind: "damage", base: 200, per: 45, lifesteal: 50, desc: "{v}% 伤害,并将伤害的 50% 转为自身生命" },
  { id: "r_rain", cls: "ranger", name: "箭雨", icon: "☔", unlock: 16, cd: 14, color: "bright_green", kind: "multi", base: 110, per: 23, hits: 5, channel: 2.5, desc: "箭雨覆盖:2.5 秒内连落 5 箭,每箭 {v}% 攻击力伤害;期间不进行其他攻击,目标倒下也不中断" },
  { id: "r_hawk", cls: "ranger", name: "鹰眼", icon: "👁", unlock: 24, cd: 25, color: "bright_yellow", kind: "buff", stat: "crit", base: 15, per: 1.5, dur: 10, desc: "10秒内暴击率 +{v} 点" },
  { id: "r_dash", cls: "ranger", name: "疾行", icon: "💨", unlock: 26, cd: 22, color: "bright_cyan", kind: "buff", stat: "haste", base: 50, per: 4, dur: 8, desc: "8秒内攻速 +{v}%" },
  { id: "r_deadly", cls: "ranger", name: "致命连射", icon: "💥", unlock: 32, cd: 25, color: "bright_red", kind: "multi", base: 160, per: 34, hits: 3, must_crit: true, desc: "3连击必暴击,每箭 {v}% 攻击力伤害" },
  { id: "r_sky", cls: "ranger", name: "穿云箭", icon: "✷", unlock: 40, cd: 28, color: "bright_yellow", kind: "damage", base: 560, per: 108, desc: "贯穿一切:造成 {v}% 攻击力伤害" },
  { id: "r_god", cls: "ranger", name: "猎神之怒", icon: "🌟", unlock: 50, cd: 45, color: "bright_green", kind: "buff", stat: "all", base: 25, per: 2.5, dur: 12, desc: "12秒内全属性 +{v}%" },
];
export const ACTIVE_DEF: Record<string, ActiveSkill> =
  Object.fromEntries(ACTIVE_SKILLS.map(s => [s.id, s]));

// ---------------------------------------------------------------- 终局一击(职业手动大招)
// 每职业 1 个手动终极技:长 CD 高倍率,由玩家在关键时刻点按(战斗页大招槽 / 键盘 Q)
// —— 推层卡头目斩杀线、挂机暴毙边缘翻盘。
// 刻意不进 ACTIVE_SKILLS / loadout:不进自动轮放队列(castSkills 只扫 loadout.active)、
// 不可装配/升级(skillUp 只认 ACTIVE_DEF+PASSIVE_DEF)、不吃离线折算(离线走普攻口径
// heroDps)—— 手动是它唯一的资格。
// 结算零新代码:形状即 ActiveSkill,castActive/skillHit 对 damage/hits/must_crit/
// freeze/def_down 全支持;倍率不吃等级成长(per 恒 0,成长由面板 atk 承担),
// 吃 skill_dmg / crit 全乘区与 effLv 的全技能词缀聚合(skillVal 对 per=0 恒为 base)。
// 收益标定 ≈0.15×atk/s(90s 一轮)≈ 手动党总输出 +10-15%。
// CD 90s 走不入档的 g.skillCd(与全部技能同口径,重载清零;门槛用 ?? 0 兜底,
// 详见 game.ts castUlt 与 combat.ts battleTick 的递减处)。
export const ULTS: ActiveSkill[] = [
  { id: "ult_w_judg", cls: "warrior", name: "深渊断罪", icon: "⚡", unlock: 35, cd: 90,
    color: "bright_magenta", kind: "damage", base: 1200, per: 0, must_crit: true,
    desc: "凝聚深渊之力斩下 {v}% 攻击力伤害,必定暴击" },
  { id: "ult_m_stars", cls: "mage", name: "湮灭星陨", icon: "☄", unlock: 35, cd: 90,
    color: "bright_red", kind: "damage", base: 300, per: 0, hits: 5, freeze: 2,
    desc: "召唤 5 枚湮灭星辰坠落,每枚 {v}% 攻击力伤害并冻结敌人 2 秒" },
  { id: "ult_r_rain", cls: "ranger", name: "万箭归宗", icon: "☔", unlock: 35, cd: 90,
    color: "bright_green", kind: "damage", base: 160, per: 0, hits: 8,
    def_down: 30, def_down_dur: 5,
    desc: "八箭齐发贯穿一切,每箭 {v}% 攻击力伤害并降低敌人防御 30%,持续5秒" },
];
export const ULT_DEF: Record<string, ActiveSkill> =
  Object.fromEntries(ULTS.map(s => [s.id, s]));

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
  { name: "幽暗森林", mobs: ["slime", "wolf", "goblin", "treant", "boar"], boss: "巨型史莱姆王", color: "green" },
  { name: "废弃矿坑", mobs: ["bat", "skeleton", "golem", "rat", "kobold", "crystal"], boss: "骷髅领主", color: "bright_black" },
  { name: "熔岩地狱", mobs: ["imp", "hound", "elemental", "maggot", "salamander", "obsidian"], boss: "炎魔男爵", color: "bright_red" },
  { name: "寒冰冻土", mobs: ["wolf", "golem", "elemental", "drake", "yeti", "wisp"], boss: "霜暴巨兽", color: "bright_cyan" },
  { name: "毒雾沼泽", mobs: ["mushroom", "spider", "snake", "leech", "toad", "mirecrab"], boss: "沼泽蛛后", color: "green" },
  { name: "白骨王座", mobs: ["husk", "wight", "scarab", "ghoul", "banshee", "bonehawk"], boss: "白骨君王", color: "white" },
  { name: "腐沼墓地", mobs: ["slime", "skeleton", "bat", "ghast", "crawler"], boss: "亡灵大祭司", color: "magenta" },
  { name: "虚空裂隙", mobs: ["imp", "goblin", "hound", "eye", "voidling", "shard"], boss: "虚空吞噬者", color: "bright_magenta" },
];

// ---------------------------------------------------------------- 深渊套装(2.5→2.9):塔层特产装备
// 套装获取渠道 2.9 收拢进塔:每 10 层一段(floor 1-10 → SUITS[0],依序循环),塔内击杀
// 必掉 1 件该段套装、按「该套该 tier 未覆盖部位」定向补缺,覆盖满 4 部位即该段毕业、
// 回归普通掉落 —— 收集从碰运气变稳定推进,野外背包不再被套装件堆积(保护逻辑仍保留)。
// 开局选职业送 2 件荆棘之誓(武器+护甲),剩余部位指向塔,第一分钟建立收集目标。
// themeIdx 保留为主题风味溯源(套装命名),不再参与掉落判定。
// 效果键走 recalcHero 统一修饰管道(stat 为 string,agg 已预置 0):crit_extra/kill_haste 等
// 是 VIRTUAL_STATS 键、不在 StatKey 联合内 —— 不为此扩 StatKey/CAPS。
// 4 件效果值对照系(锚定实现时的数值依据):
//   kill_heal 3=遗物同键 2-6 下限 / crit_extra 10=遗物 5-15 中位 / skill_dmg 15=遗物上限 5-15 /
//   deathward 8=遗物 5-15 中档 / kill_haste 10=遗物 5-15 中位 / dodge 5=t_dodge 满级 5 点不超 /
//   luck 6=词缀蓝档下限(rid=2,step=3 → 2×3+u(0,3)=6-9)/ armor_pierce 10=破甲被动 1 级整
//   (pw_break base:10;CAPS 50,占 20%)/ crit_dmg 15=词缀绿档 10-20 中位。
// 2 件对照:hp/def 8%≈t_hp/t_def 每 3%×2.7 级 / atk 6%≈t_atk 2.4 级 / goldfind 8=绿档 5-12
//   中位 / lifesteal 4=词缀一条 roll / crit_dmg 15=绿档中位。
export interface SuitBonus { stat: string; op: "add" | "pct"; v: number }
export interface SuitDef {
  id: string; name: string; icon: string; themeIdx: number;
  bonus2: SuitBonus; bonus4: SuitBonus;
}
export const SUITS: SuitDef[] = [
  { id: "s0", name: "荆棘之誓", icon: "🌿", themeIdx: 0,
    bonus2: { stat: "hp", op: "pct", v: 8 }, bonus4: { stat: "kill_heal", op: "add", v: 3 } },
  { id: "s1", name: "掘金者", icon: "⛏", themeIdx: 1,
    bonus2: { stat: "goldfind", op: "add", v: 8 }, bonus4: { stat: "luck", op: "add", v: 6 } },
  { id: "s2", name: "焚天", icon: "🔥", themeIdx: 2,
    bonus2: { stat: "atk", op: "pct", v: 6 }, bonus4: { stat: "crit_extra", op: "add", v: 10 } },
  { id: "s3", name: "霜寒", icon: "❄", themeIdx: 3,
    bonus2: { stat: "def", op: "pct", v: 8 }, bonus4: { stat: "dodge", op: "add", v: 5 } },
  { id: "s4", name: "淬毒", icon: "☣", themeIdx: 4,
    bonus2: { stat: "lifesteal", op: "add", v: 4 }, bonus4: { stat: "skill_dmg", op: "add", v: 15 } },
  { id: "s5", name: "白骨军团", icon: "🦴", themeIdx: 5,
    bonus2: { stat: "hp", op: "pct", v: 8 }, bonus4: { stat: "deathward", op: "add", v: 8 } },
  { id: "s6", name: "食腐", icon: "🧟", themeIdx: 6,
    bonus2: { stat: "atk", op: "pct", v: 6 }, bonus4: { stat: "kill_haste", op: "add", v: 10 } },
  { id: "s7", name: "虚空漫步", icon: "🌌", themeIdx: 7,
    bonus2: { stat: "crit_dmg", op: "add", v: 15 }, bonus4: { stat: "armor_pierce", op: "add", v: 10 } },
];
export const SUIT_DEF: Record<string, SuitDef> =
  Object.fromEntries(SUITS.map(s => [s.id, s]));

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
  // ---- 扩展怪物 20 种(各区池补强;立绘为程序合成,见 scripts/make_mon_art.py) ----
  // 幽暗森林
  treant: { name: "枯树人", color: "green", power: 1.0,
    skill: { name: "根须缠绕", icon: "🌿", cd: 12, mult: 1.0, hits: 1, stun: 0.8 } },
  boar: { name: "獠牙野猪", color: "yellow", power: 1.05,
    skill: { name: "蛮力冲撞", icon: "🪓", cd: 11, mult: 1.9, hits: 1 } },
  // 废弃矿坑
  rat: { name: "噬金鼠", color: "bright_black", power: 0.9,
    skill: { name: "疫病啃咬", icon: "🦠", cd: 9, mult: 0.6, hits: 2, atkdown: [0.2, 4] } },
  kobold: { name: "矿工狗头人", color: "bright_red", power: 1.0,
    skill: { name: "炸药桶", icon: "💣", cd: 12, mult: 2.2, hits: 1 } },
  crystal: { name: "活体晶簇", color: "bright_cyan", power: 1.05,
    skill: { name: "晶刺迸射", icon: "💠", cd: 10, mult: 0.6, hits: 3, defdown: [0.25, 4] } },
  // 熔岩地狱
  maggot: { name: "熔浆幼虫", color: "red", power: 0.95,
    skill: { name: "熔壳蜕吸", icon: "🕯", cd: 10, mult: 1.3, hits: 1, lifesteal: true } },
  salamander: { name: "火蜥蜴", color: "bright_red", power: 1.05,
    skill: { name: "灼热尾击", icon: "🦎", cd: 10, mult: 1.9, hits: 1, atkdown: [0.25, 4] } },
  obsidian: { name: "黑曜石魔", color: "bright_black", power: 1.15,
    skill: { name: "碎晶爆裂", icon: "🪨", cd: 13, mult: 2.5, hits: 1 } },
  // 寒冰冻土
  yeti: { name: "雪原巨怪", color: "white", power: 1.15,
    skill: { name: "冰魄重锤", icon: "🔨", cd: 12, mult: 1.6, hits: 1, slow: [0.3, 4] } },
  wisp: { name: "寒冰魂火", color: "bright_cyan", power: 0.9,
    skill: { name: "魂火侵体", icon: "🔥", cd: 9, mult: 1.0, hits: 1, slow: [0.35, 5] } },
  // 毒雾沼泽
  leech: { name: "巨蛭", color: "magenta", power: 1.0,
    skill: { name: "嗜血抽吸", icon: "💉", cd: 10, mult: 1.4, hits: 1, lifesteal: true } },
  toad: { name: "沼泽蟾蜍", color: "green", power: 0.95,
    skill: { name: "毒涎喷吐", icon: "💦", cd: 10, mult: 1.1, hits: 1, slow: [0.3, 4] } },
  mirecrab: { name: "泥沼蟹", color: "yellow", power: 1.1,
    skill: { name: "断钳夹击", icon: "🦀", cd: 11, mult: 0.9, hits: 2, defdown: [0.25, 4] } },
  // 白骨王座
  ghoul: { name: "食尸鬼", color: "bright_green", power: 1.0,
    skill: { name: "腐爪撕扯", icon: "🧟", cd: 10, mult: 0.55, hits: 3, lifesteal: true } },
  banshee: { name: "报丧女妖", color: "bright_magenta", power: 1.05,
    skill: { name: "恸哭", icon: "📢", cd: 12, mult: 1.2, hits: 1, stun: 1.0 } },
  bonehawk: { name: "骨翼鹰", color: "white", power: 0.95,
    skill: { name: "俯冲撕裂", icon: "🪶", cd: 9, mult: 0.75, hits: 2 } },
  // 腐沼墓地
  ghast: { name: "腐臭浮灵", color: "magenta", power: 1.0,
    skill: { name: "瘴气弥漫", icon: "☁", cd: 11, mult: 1.1, hits: 1, atkdown: [0.25, 5] } },
  crawler: { name: "六肢行者", color: "bright_black", power: 1.05,
    skill: { name: "麻痹之触", icon: "✋", cd: 10, mult: 1.3, hits: 1, slow: [0.35, 4] } },
  // 虚空裂隙
  voidling: { name: "虚空幼体", color: "bright_magenta", power: 1.0,
    skill: { name: "相位撕咬", icon: "🌀", cd: 9, mult: 0.6, hits: 3 } },
  shard: { name: "裂隙棱晶", color: "bright_cyan", power: 1.15,
    skill: { name: "空间撕裂", icon: "🔮", cd: 13, mult: 2.2, hits: 1, defdown: [0.3, 4] } },
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
  // ---- 扩展怪物 20 种 ----
  treant: ["  \\ ,,, /    ", "   (o o)     ", "   |###|     ", "  /|   |\\    ", " _/ |___| \\_ "],
  boar: ["   ____      ", "  (o __)     ", "   \\/|#|     ", "    ||       ", "   _/\\_      "],
  rat: ["  ~  ~~      ", "  (o o)>     ", "   \\ - /     ", "   /   \\     ", "  _/   \\_    "],
  kobold: ["   ,,,,      ", "  (^ ^)      ", "  <#  #>     ", "   |  |      ", "  _/  \\_     "],
  crystal: ["     /\\      ", "    /oo\\     ", "    \\  /     ", "   /|##|\\    ", "  /_|__|_\\   "],
  maggot: ["   ____      ", "  (o  o)     ", "  ( ~~~ )    ", "   \\____/    ", "    _/\\_     "],
  salamander: ["  /\\  /      ", " (o )(       ", "  \\/#\\      ", "    ||       ", "   _/\\_      "],
  obsidian: ["    /^^\\     ", "   |o  o|    ", "   | /`\\|    ", "   |    |    ", "  _/____\\_   "],
  yeti: ["   /^^^^\\    ", "  ( o  o )   ", "  ( \\__/ )   ", "   |    |    ", "  _/    \\_   "],
  wisp: ["     .       ", "    ( )      ", "   ( o )     ", "    ( )      ", "     .       "],
  leech: ["    ~~~      ", "   (o  )     ", "   (~~ o)    ", "    \\ ~      ", "     \\_      "],
  toad: ["    ____     ", "   (@  @)    ", "   ( ~~ )    ", "  /|    |\\   ", " _/|    |\\_  "],
  mirecrab: ["  \\    /     ", " (o/  \\o)    ", "  | ~~ |     ", " /|    |\\    ", "_/ |    | \\_ "],
  ghoul: ["    __       ", "   (o o)     ", "   / v  \\    ", "  |  ##  |   ", "   _|  |_    "],
  banshee: ["    ~~~      ", "   (o  o)    ", "   ( ~~ )    ", "    \\ ~ /    ", "     \\|/     "],
  bonehawk: [" \\      /    ", " \\(o  o)/    ", "  \\/\\ /     ", "    /\\       ", "   _/\\_      "],
  ghast: ["    ~~~~     ", "   (o  o)    ", "  ~(    )~   ", "   ( ~~ )    ", "    ~  ~     "],
  crawler: ["    ____     ", "   (o  o)    ", " //|##|\\\\   ", "    |  |     ", "   _/  \\_    "],
  voidling: ["    .--.     ", "   ( o  )    ", "  (  ~~  )   ", "   (    )    ", "    `--'     "],
  shard: ["     /\\      ", "    /  \\     ", "   | o* |    ", "   |    |    ", "  _/____\\_   "],
};

// ---------------------------------------------------------------- 成就
export interface AchievementDef {
  id: string; name: string; metric: string; thresholds: number[];
  stat: string; per: number;
}
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "slayer", name: "深渊猎手", metric: "kills", thresholds: [100, 1000, 10000, 50000, 150000, 500000, 2000000], stat: "atk", per: 4 },
  { id: "zonewalk", name: "开疆拓土", metric: "max_zone", thresholds: [3, 6, 10, 15, 25, 40, 60, 100, 150, 250], stat: "hp", per: 6 },
  { id: "smith", name: "锻造宗师", metric: "enhance_total", thresholds: [10, 50, 200, 600, 2000, 8000], stat: "def", per: 5 },
  { id: "boss", name: "弑主者", metric: "boss_kills", thresholds: [10, 50, 200, 800, 2400, 8000, 24000], stat: "crit", per: 2 },
  { id: "tycoon", name: "深渊富豪", metric: "gold_earned", thresholds: [1e4, 1e5, 1e6, 1e8, 1e10, 1e12], stat: "goldfind", per: 5 },
  { id: "death", name: "不死鸟", metric: "deaths", thresholds: [1, 10, 50, 200, 800], stat: "hp", per: 3 },
  // ---- 2.3 第二梯队:终身统计已有数据、此前无人消费的六个新维度 ----
  { id: "rebirther", name: "轮回大师", metric: "rebirths", thresholds: [1, 5, 15, 40, 100, 200], stat: "atk", per: 4 },
  { id: "climber", name: "登塔者", metric: "max_floor", thresholds: [5, 15, 30, 50, 80, 120], stat: "def", per: 5 },
  { id: "bounty", name: "赏金猎人", metric: "quest_done", thresholds: [10, 50, 150, 400, 1200], stat: "goldfind", per: 5 },
  { id: "alchemist", name: "炼金术士", metric: "reforge_total", thresholds: [5, 25, 100, 300, 1000], stat: "hp", per: 3 },
  { id: "fatality", name: "致命一击", metric: "crit_hits", thresholds: [1000, 10000, 100000, 500000], stat: "crit", per: 2 },
  { id: "dweller", name: "深渊住民", metric: "playtime", thresholds: [3600, 21600, 86400, 432000, 1296000], stat: "xp_pct", per: 2 },
  // ---- 2.4 第三梯队:经济循环与转生深度(新统计口径,见 game.ts 打点) ----
  { id: "scavenger", name: "拾荒者", metric: "sold_total", thresholds: [100, 1000, 10000, 50000], stat: "goldfind", per: 3 },
  { id: "crusher", name: "粉碎机", metric: "dismantled", thresholds: [25, 200, 1200, 5000], stat: "hp", per: 3 },
  { id: "chronicler", name: "编年史家", metric: "signin_total", thresholds: [7, 30, 100, 365], stat: "xp_pct", per: 2 },
  { id: "forger", name: "深渊锻造师", metric: "crafted", thresholds: [5, 30, 120, 500], stat: "atk", per: 3 },
  { id: "awakened", name: "天赋觉醒", metric: "talent_total", thresholds: [5, 20, 50, 100], stat: "def", per: 3 },
  { id: "soulkeeper", name: "魂晶收藏家", metric: "essence_total", thresholds: [25, 100, 400, 1500], stat: "atk", per: 2 },
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
  // 2.7 异步切磋:纯枚举追加,旧档 titles 数组天然兼容
  { id: "t_arena10", name: "切磋者", cond: "切磋 10 胜" },
  { id: "t_arena50", name: "角斗士", cond: "切磋 50 胜" },
];

/** 切磋称号门槛(胜场 → TITLES id;game.arenaResult 按此发放,只发一次) */
export const ARENA_TITLES: { wins: number; id: string }[] = [
  { wins: 10, id: "t_arena10" },
  { wins: 50, id: "t_arena50" },
];

// ---------------------------------------------------------------- 深渊天赋(2.4):转生货币「魂晶」的消费端
// 魂晶 = 转生时按收获档位 k 发放(round(k × rebirth_essence_base),至少 1);
// 天赋永久生效、转生不重置;节点按转生世数(floor(rebirths))分档解锁 ——
// 转得越多,树越深,给每一世新的可规划目标(转生消费端)。
export interface TalentDef {
  id: string;
  branch: "war" | "guard" | "abyss";   // 征伐 / 坚忍 / 深渊
  name: string; icon: string;
  maxLv: number;
  cost0: number; costStep: number;     // 升下一级费用 = cost0 + costStep × 当前级
  reqRebirth: number;                  // 解锁门槛:转生世数(floor(rebirths))
  kind: "stat" | "special";
  stat?: StatKey; op?: "add" | "pct"; per?: number;   // stat:走统一修饰管道
  special?: "start_zone" | "offline_cap" | "forge";   // 特殊节点,消费点见 game.ts
  /** 每级效果描述(数值已内联;当前合计由 UI 按 per×lv 现算) */
  desc: string;
  /** 特殊节点的每级数值(start_zone:+2 起始区/级;offline_cap:+1h/级) */
  perSpecial?: number;
}
export const TALENT_BRANCHES: { id: TalentDef["branch"]; name: string; icon: string; blurb: string }[] = [
  { id: "war", name: "征伐", icon: "⚔", blurb: "输出与猎杀" },
  { id: "guard", name: "坚忍", icon: "🛡", blurb: "生存与续航" },
  { id: "abyss", name: "深渊", icon: "✧", blurb: "资源与轮回" },
];
export const TALENTS: TalentDef[] = [
  // ---- 征伐 ----
  { id: "t_atk", branch: "war", name: "利刃精粹", icon: "⚔", maxLv: 10, cost0: 2, costStep: 2,
    reqRebirth: 1, kind: "stat", stat: "atk", op: "pct", per: 2.5, desc: "每级攻击 +2.5%" },
  { id: "t_crit", branch: "war", name: "猎杀直觉", icon: "🎯", maxLv: 5, cost0: 4, costStep: 3,
    reqRebirth: 2, kind: "stat", stat: "crit", op: "add", per: 0.8, desc: "每级暴击率 +0.8 点" },
  { id: "t_critdmg", branch: "war", name: "灭杀狂怒", icon: "💥", maxLv: 5, cost0: 8, costStep: 4,
    reqRebirth: 5, kind: "stat", stat: "crit_dmg", op: "add", per: 6, desc: "每级暴击伤害 +6%" },
  { id: "t_skill", branch: "war", name: "奥术共鸣", icon: "✦", maxLv: 10, cost0: 6, costStep: 3,
    reqRebirth: 8, kind: "stat", stat: "skill_dmg", op: "add", per: 5, desc: "每级技能伤害 +5%" },
  { id: "t_hunt", branch: "war", name: "深渊猎杀", icon: "☠", maxLv: 5, cost0: 10, costStep: 5,
    reqRebirth: 12, kind: "stat", stat: "boss_dmg_r", op: "add", per: 4, desc: "每级对精英与头目伤害 +4%" },
  // ---- 坚忍 ----
  { id: "t_hp", branch: "guard", name: "生命精粹", icon: "❤", maxLv: 10, cost0: 2, costStep: 2,
    reqRebirth: 1, kind: "stat", stat: "hp", op: "pct", per: 3, desc: "每级生命 +3%" },
  { id: "t_def", branch: "guard", name: "铁壁精粹", icon: "🛡", maxLv: 10, cost0: 2, costStep: 2,
    reqRebirth: 1, kind: "stat", stat: "def", op: "pct", per: 3, desc: "每级防御 +3%" },
  { id: "t_dodge", branch: "guard", name: "影步", icon: "💨", maxLv: 5, cost0: 4, costStep: 3,
    reqRebirth: 3, kind: "stat", stat: "dodge", op: "add", per: 1, desc: "每级闪避 +1 点" },
  { id: "t_ward", branch: "guard", name: "不死意志", icon: "🔮", maxLv: 5, cost0: 6, costStep: 3,
    reqRebirth: 6, kind: "stat", stat: "deathward", op: "add", per: 3, desc: "每级不死 +3%(致命伤概率保留 1 血,60s 冷却)" },
  { id: "t_regen", branch: "guard", name: "收割回响", icon: "🩸", maxLv: 5, cost0: 8, costStep: 4,
    reqRebirth: 10, kind: "stat", stat: "kill_heal", op: "add", per: 1, desc: "每级击杀回血 +1%(按最大生命)" },
  // ---- 深渊 ----
  { id: "t_gold", branch: "abyss", name: "深渊财脉", icon: "◈", maxLv: 10, cost0: 3, costStep: 2,
    reqRebirth: 1, kind: "stat", stat: "goldfind", op: "add", per: 2, desc: "每级金币加成 +2 点" },
  { id: "t_xp", branch: "abyss", name: "智慧沉淀", icon: "📖", maxLv: 10, cost0: 3, costStep: 2,
    reqRebirth: 1, kind: "stat", stat: "xp_pct", op: "add", per: 2, desc: "每级经验加成 +2%" },
  { id: "t_luck", branch: "abyss", name: "天命眷顾", icon: "🍀", maxLv: 5, cost0: 5, costStep: 3,
    reqRebirth: 3, kind: "stat", stat: "luck", op: "add", per: 1, desc: "每级幸运 +1 点(高稀有度掉落)" },
  { id: "t_forge", branch: "abyss", name: "深渊锻造台", icon: "⚒", maxLv: 1, cost0: 12, costStep: 0,
    reqRebirth: 3, kind: "special", special: "forge",
    desc: "解锁定向锻造:花费金币+重铸石,指定部位与一条必带词缀,稀有度保底稀有+" },
  { id: "t_start", branch: "abyss", name: "轮回足迹", icon: "👣", maxLv: 5, cost0: 8, costStep: 6,
    reqRebirth: 5, kind: "special", special: "start_zone", perSpecial: 2,
    desc: "每级转生起始区 +2(跳过已碾过的浅层)" },
  { id: "t_offline", branch: "abyss", name: "时之沙", icon: "⏳", maxLv: 5, cost0: 10, costStep: 5,
    reqRebirth: 8, kind: "special", special: "offline_cap", perSpecial: 3600,
    desc: "每级离线收益上限 +1 小时" },
];
export const TALENT_DEF: Record<string, TalentDef> =
  Object.fromEntries(TALENTS.map(t => [t.id, t]));

// ---------------------------------------------------------------- 星火(2.9):局内升级点数消费端
// 星火 = 每升 1 级得 1 点(BAL.spark_per_lv),局内手动消费,转生熄灭
// (spark/sparkTalents 随 rebirth 重置)—— 补深渊天赋「转生后才存在」的前期空窗:
// 第一世即可用的主动乘区,补的正是前期成长感来源。
// 与深渊天赋双表双字段彻底隔离(essence/talents 永久,spark/sparkTalents 局内,
// 互不读写):加成同走 recalcHero 的 mods 管道叠加但独立记账,CAPS 末端统一截断,
// 无双计;成就口径不加星火 metric(stats.talent_total 只算深渊天赋)。
// 数值锚定:满配 +16%攻/+20%血/+20%防 ≈ 永久 t_atk/t_hp/t_def 满级(25/30/30)的
// 0.64-0.8 倍;crit/skill_dmg/xp_pct/haste 满配占 CAPS 3.2%/10%/10%/8%,
// 全树总容量 149 点(踩线 50 级转生 = 49 点,点亮 33%)。
export interface SparkDef {
  id: string;
  branch: "blaze" | "ward" | "star";   // 燎原 / 薪壁 / 星轨
  name: string; icon: string;
  maxLv: number;
  cost0: number; costStep: number;     // 升下一级费用 = cost0 + costStep × 当前级
  kind: "stat";                        // 全 stat 节点,无 special / 无解锁门槛
  stat: StatKey; op: "add" | "pct"; per: number;   // 走统一修饰管道
  /** 每级效果描述(数值已内联;当前合计由 UI 按 per×lv 现算) */
  desc: string;
}
export const SPARK_BRANCHES: { id: SparkDef["branch"]; name: string; icon: string; blurb: string }[] = [
  { id: "blaze", name: "燎原", icon: "🔥", blurb: "锋锐与杀意" },
  { id: "ward", name: "薪壁", icon: "🛡", blurb: "血肉与壁垒" },
  { id: "star", name: "星轨", icon: "⭑", blurb: "拾荒与疾行" },
];
export const SPARKS: SparkDef[] = [
  // ---- 燎原 ----
  { id: "s_atk", branch: "blaze", name: "锋芒", icon: "⚔", maxLv: 4, cost0: 1, costStep: 2,
    kind: "stat", stat: "atk", op: "pct", per: 4, desc: "每级攻击 +4%" },
  { id: "s_crit", branch: "blaze", name: "灼目", icon: "🎯", maxLv: 3, cost0: 1, costStep: 3,
    kind: "stat", stat: "crit", op: "add", per: 0.8, desc: "每级暴击率 +0.8 点" },
  { id: "s_skill", branch: "blaze", name: "星核", icon: "✦", maxLv: 3, cost0: 2, costStep: 4,
    kind: "stat", stat: "skill_dmg", op: "add", per: 10, desc: "每级技能伤害 +10%" },
  // ---- 薪壁 ----
  { id: "s_hp", branch: "ward", name: "薪血", icon: "❤", maxLv: 4, cost0: 1, costStep: 2,
    kind: "stat", stat: "hp", op: "pct", per: 5, desc: "每级生命 +5%" },
  { id: "s_def", branch: "ward", name: "灰壁", icon: "🛡", maxLv: 4, cost0: 1, costStep: 2,
    kind: "stat", stat: "def", op: "pct", per: 5, desc: "每级防御 +5%" },
  { id: "s_regen", branch: "ward", name: "烬暖", icon: "🩸", maxLv: 3, cost0: 1, costStep: 3,
    kind: "stat", stat: "kill_heal", op: "add", per: 1.2, desc: "每级击杀回血 +1.2%(按最大生命)" },
  // ---- 星轨 ----
  { id: "s_gold", branch: "star", name: "拾薪", icon: "◈", maxLv: 3, cost0: 2, costStep: 3,
    kind: "stat", stat: "goldfind", op: "add", per: 5, desc: "每级金币加成 +5 点" },
  { id: "s_xp", branch: "star", name: "启明", icon: "📖", maxLv: 4, cost0: 2, costStep: 3,
    kind: "stat", stat: "xp_pct", op: "add", per: 5, desc: "每级经验加成 +5%" },
  { id: "s_haste", branch: "star", name: "迅燃", icon: "💨", maxLv: 3, cost0: 2, costStep: 4,
    kind: "stat", stat: "haste", op: "add", per: 4, desc: "每级攻击速度 +4 点" },
];
export const SPARK_DEF: Record<string, SparkDef> =
  Object.fromEntries(SPARKS.map(s => [s.id, s]));

// ---------------------------------------------------------------- 职业天赋链(2.10):星火池的第二消费端
// 拓扑:每职业 1 条链 = 入口×1(无前置,maxLv3)+ 三支各 5 节点(支内逐级前置,
// 第 k+1 节点需第 k 节点满级;tier 字段推导,无显式 req);入口点亮 ≥1 级即解锁三支。
// 节点 id 规则 `<cls前缀><支字母><序号>`:w0 入口 / wa1..wa5 / wb1.. / wc1..(m_*、r_* 同构)。
// 与星火树共用同一 spark 池:星火树=通用速效(31 级/149 点) / 职业链=职业特化+终身里程碑
// (69 级/369 点,吸收 Lv200 局 199 点 > 149 的溢出)—— 局内永远买不完两个,分配即决策。
// 里程碑口径(分层):链级 chainTalents 是局内状态,随转生清零(与星火同熄);
// chainBought[职业] 是终身累计已购级数(转生不清,参照 lifetimeEssence 范式),
// BAL.chain_milestones=[50,100,200] 三档各解锁 1 条特别天赋(永久被动,解锁态是
// chainBought≥need 的派生态 → 无解锁标志字段,重载零漂移;仅当前职业=归属职业时生效)。
// 生效路径:全部 stat 走 recalcHero 统一 mods 管道 → 在线/离线/战力/切磋四路自动生效;
// 仅在线键(armor_pierce/boss_dmg_r/kill_heal/deathward/crit_extra/kill_haste 离线
// heroDps 不读)刻意压在每支最多 1 个且不在支主干,文案明示而非依赖。
// 数值依据(费用贪婪全投链实算:49 点/局≈18 级、99≈30、199≈47):
//   容量 69 级/369 点 = 星火树 31 级/149 点的 ≈2.5 倍;里程碑 50/100/200 对应
//   踩线局 3 局 / Lv100 局 5 局 / 长局 8 局(新手曲线)——梯度对齐 1-3 区不动缓曲线
//   (1-3 区 Lv≈5-15 → 星火≤14 → 至多入口+2-3 个支首级,不碾压前期)。
//   满配职业主属性 +27~42% ≈ 魂晶天赋满级同量级(t_atk 满 +25%),但单局最多持 47/69 级
//   且与星火树共享预算,局内实际 ≈ 满配×⅔,无双计、CAPS 末端截断兜底。
//   CAPS 余量逐键:haste 链满 +39(ranger)/150、dodge +13.5/40、lifesteal +5/25、
//   crit +5/75、armor_pierce +25/50、cd_reduce +7.5/40、xp_pct +32/200、luck +5/50;
//   crit_dmg/kill_heal/deathward 无上限键;skill_dmg 受 CAPS 300 封顶(链满 +84,占 28%)。
//   费用骨架全职业统一:入口[2,2]max3=12 点;支内 n1[1,1]max4=10 / n2[2,1]max5=20 /
//   n3[2,2]max5=30 / n4[3,2]max5=35 / n5[5,3]max3=24;单支 22 级/119 点。
export interface ChainNodeDef {
  id: string;                     // w0 入口 / wa1..wa5 / wb1.. / wc1..(m_*、r_* 同构)
  cls: string;                    // 归属职业(warrior/mage/ranger;消费端按 cls 拦截)
  branch: "a" | "b" | "c";        // 支字母(入口 tier=0 不参与门控,占位 "a")
  tier: number;                   // 0=入口(无前置) / 1..5 支内序(tier≥2 需同支前一节点满级)
  name: string; icon: string;
  maxLv: number;
  cost0: number; costStep: number;   // 升下一级费用 = cost0 + costStep × 当前级(sparkCost 同款)
  kind: "stat";                   // 全 stat 节点;多属性多效果只出现在特别天赋(effects 数组)
  stat: StatKey | (typeof VIRTUAL_STATS)[number]; op: "add" | "pct"; per: number;
  desc: string;
}
/** 三支标题(UI 分栏遍历;顺序 = a/b/c) */
export const CLASS_CHAIN_BRANCHES: Record<string,
  { id: "a" | "b" | "c"; name: string; icon: string; blurb: string }[]> = {
  warrior: [
    { id: "a", name: "利刃", icon: "⚔", blurb: "锋锐与斩杀" },
    { id: "b", name: "坚壁", icon: "🛡", blurb: "血肉与壁垒" },
    { id: "c", name: "嗜血", icon: "🩸", blurb: "战意与狂怒" },
  ],
  mage: [
    { id: "a", name: "灾变", icon: "☄", blurb: "元素与毁灭" },
    { id: "b", name: "秘法", icon: "🛡", blurb: "生存与洞悉" },
    { id: "c", name: "星火", icon: "⭑", blurb: "拾荒与疾行" },
  ],
  ranger: [
    { id: "a", name: "连射", icon: "🏹", blurb: "攻速与暴击" },
    { id: "b", name: "风筝", icon: "💨", blurb: "走位与闪避" },
    { id: "c", name: "猎杀", icon: "🎯", blurb: "猎首与拾荒" },
  ],
};
export const CLASS_CHAINS: ChainNodeDef[] = [
  // ---- 战士 ⚔「不灭战魂」:钢铁与怒火,三围最硬 + 斩杀收头 ----
  { id: "w0", cls: "warrior", branch: "a", tier: 0, name: "战魂燃烧", icon: "❤",
    maxLv: 3, cost0: 2, costStep: 2, kind: "stat", stat: "hp", op: "pct", per: 3,
    desc: "每级生命 +3%;点亮后解锁三条支线" },
  // 利刃
  { id: "wa1", cls: "warrior", branch: "a", tier: 1, name: "蛮击", icon: "⚔",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "atk", op: "pct", per: 3,
    desc: "每级攻击 +3%" },
  { id: "wa2", cls: "warrior", branch: "a", tier: 2, name: "破甲", icon: "🗡",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "armor_pierce", op: "add", per: 5,
    desc: "每级无视防御 +5 点(仅在线与切磋结算)" },
  { id: "wa3", cls: "warrior", branch: "a", tier: 3, name: "斩铁", icon: "🪓",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "crit_dmg", op: "add", per: 8,
    desc: "每级暴击伤害 +8 点" },
  { id: "wa4", cls: "warrior", branch: "a", tier: 4, name: "猎首", icon: "💀",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "boss_dmg_r", op: "add", per: 4,
    desc: "每级对精英与头目伤害 +4%(仅在线技能命中)" },
  { id: "wa5", cls: "warrior", branch: "a", tier: 5, name: "处决者", icon: "⚡",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "atk", op: "pct", per: 5,
    desc: "每级攻击 +5%" },
  // 坚壁
  { id: "wb1", cls: "warrior", branch: "b", tier: 1, name: "铁躯", icon: "🛡",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "def", op: "pct", per: 3,
    desc: "每级防御 +3%" },
  { id: "wb2", cls: "warrior", branch: "b", tier: 2, name: "巨鲸", icon: "🐋",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "hp", op: "pct", per: 4,
    desc: "每级生命 +4%" },
  { id: "wb3", cls: "warrior", branch: "b", tier: 3, name: "影步", icon: "👟",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "dodge", op: "add", per: 1,
    desc: "每级闪避 +1 点" },
  { id: "wb4", cls: "warrior", branch: "b", tier: 4, name: "不屈", icon: "🧱",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "deathward", op: "add", per: 3,
    desc: "每级不死 +3 点(仅在线战斗)" },
  { id: "wb5", cls: "warrior", branch: "b", tier: 5, name: "堡垒", icon: "🏰",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "def", op: "pct", per: 6,
    desc: "每级防御 +6%" },
  // 嗜血
  { id: "wc1", cls: "warrior", branch: "c", tier: 1, name: "汲血", icon: "🩸",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "lifesteal", op: "add", per: 1,
    desc: "每级吸血 +1 点" },
  { id: "wc2", cls: "warrior", branch: "c", tier: 2, name: "血宴", icon: "🍷",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "kill_heal", op: "add", per: 1,
    desc: "每级击杀回血 +1%(仅在线战斗;离线为固定 8% 近似)" },
  { id: "wc3", cls: "warrior", branch: "c", tier: 3, name: "狂怒", icon: "😡",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "haste", op: "add", per: 3,
    desc: "每级攻击速度 +3 点" },
  { id: "wc4", cls: "warrior", branch: "c", tier: 4, name: "战意", icon: "🎯",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "crit", op: "add", per: 1,
    desc: "每级暴击率 +1 点" },
  { id: "wc5", cls: "warrior", branch: "c", tier: 5, name: "血怒", icon: "🔥",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "atk", op: "pct", per: 5,
    desc: "每级攻击 +5%" },
  // ---- 法师 ✦「奥数星图」:元素与毁灭,普攻平庸技能伤害爆炸 ----
  { id: "m0", cls: "mage", branch: "a", tier: 0, name: "奥数回响", icon: "✦",
    maxLv: 3, cost0: 2, costStep: 2, kind: "stat", stat: "skill_dmg", op: "add", per: 8,
    desc: "每级技能伤害 +8%;点亮后解锁三条支线" },
  // 灾变
  { id: "ma1", cls: "mage", branch: "a", tier: 1, name: "燎原", icon: "🔥",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "skill_dmg", op: "add", per: 6,
    desc: "每级技能伤害 +6%" },
  { id: "ma2", cls: "mage", branch: "a", tier: 2, name: "湮灭", icon: "💥",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "crit_dmg", op: "add", per: 10,
    desc: "每级暴击伤害 +10 点" },
  { id: "ma3", cls: "mage", branch: "a", tier: 3, name: "精准", icon: "🎯",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "crit", op: "add", per: 1,
    desc: "每级暴击率 +1 点" },
  { id: "ma4", cls: "mage", branch: "a", tier: 4, name: "汇聚", icon: "⏳",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "cd_reduce", op: "add", per: 1.5,
    desc: "每级冷却缩减 +1.5 点" },
  { id: "ma5", cls: "mage", branch: "a", tier: 5, name: "灾变", icon: "☄",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "skill_dmg", op: "add", per: 12,
    desc: "每级技能伤害 +12%" },
  // 秘法
  { id: "mb1", cls: "mage", branch: "b", tier: 1, name: "法袍", icon: "🧥",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "def", op: "pct", per: 3,
    desc: "每级防御 +3%" },
  { id: "mb2", cls: "mage", branch: "b", tier: 2, name: "冰甲", icon: "❄",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "hp", op: "pct", per: 4,
    desc: "每级生命 +4%" },
  { id: "mb3", cls: "mage", branch: "b", tier: 3, name: "寒盾", icon: "🛡",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "dodge", op: "add", per: 1,
    desc: "每级闪避 +1 点" },
  { id: "mb4", cls: "mage", branch: "b", tier: 4, name: "洞悉", icon: "👁",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "xp_pct", op: "add", per: 4,
    desc: "每级经验加成 +4%" },
  { id: "mb5", cls: "mage", branch: "b", tier: 5, name: "大法师", icon: "🧙",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "hp", op: "pct", per: 6,
    desc: "每级生命 +6%" },
  // 星火
  { id: "mc1", cls: "mage", branch: "c", tier: 1, name: "贤者", icon: "📖",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "xp_pct", op: "add", per: 3,
    desc: "每级经验加成 +3%" },
  { id: "mc2", cls: "mage", branch: "c", tier: 2, name: "财脉", icon: "◈",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "goldfind", op: "add", per: 4,
    desc: "每级金币加成 +4 点" },
  { id: "mc3", cls: "mage", branch: "c", tier: 3, name: "疾咏", icon: "💨",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "haste", op: "add", per: 3,
    desc: "每级攻击速度 +3 点" },
  { id: "mc4", cls: "mage", branch: "c", tier: 4, name: "天命", icon: "🍀",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "luck", op: "add", per: 1,
    desc: "每级幸运 +1 点" },
  { id: "mc5", cls: "mage", branch: "c", tier: 5, name: "星陨", icon: "🌠",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "atk", op: "pct", per: 4,
    desc: "每级攻击 +4%" },
  // ---- 射手 ➤「风羽连弩」:风与箭雨,攻速快暴击高连击风筝 ----
  { id: "r0", cls: "ranger", branch: "a", tier: 0, name: "风之呼吸", icon: "💨",
    maxLv: 3, cost0: 2, costStep: 2, kind: "stat", stat: "haste", op: "add", per: 4,
    desc: "每级攻击速度 +4 点;点亮后解锁三条支线" },
  // 连射
  { id: "ra1", cls: "ranger", branch: "a", tier: 1, name: "迅捷", icon: "🏹",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "haste", op: "add", per: 3,
    desc: "每级攻击速度 +3 点" },
  { id: "ra2", cls: "ranger", branch: "a", tier: 2, name: "鹰眼", icon: "🦅",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "crit", op: "add", per: 1,
    desc: "每级暴击率 +1 点" },
  { id: "ra3", cls: "ranger", branch: "a", tier: 3, name: "致命", icon: "☠",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "crit_dmg", op: "add", per: 8,
    desc: "每级暴击伤害 +8 点" },
  { id: "ra4", cls: "ranger", branch: "a", tier: 4, name: "连锁", icon: "⛓",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "crit_extra", op: "add", per: 4,
    desc: "每级暴击追击 +4%(仅在线战斗)" },
  { id: "ra5", cls: "ranger", branch: "a", tier: 5, name: "箭雨", icon: "🌧",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "haste", op: "add", per: 5,
    desc: "每级攻击速度 +5 点" },
  // 风筝
  { id: "rb1", cls: "ranger", branch: "b", tier: 1, name: "风衣", icon: "🧥",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "def", op: "pct", per: 3,
    desc: "每级防御 +3%" },
  { id: "rb2", cls: "ranger", branch: "b", tier: 2, name: "猎体", icon: "❤",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "hp", op: "pct", per: 4,
    desc: "每级生命 +4%" },
  { id: "rb3", cls: "ranger", branch: "b", tier: 3, name: "疾走", icon: "👟",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "dodge", op: "add", per: 1.5,
    desc: "每级闪避 +1.5 点" },
  { id: "rb4", cls: "ranger", branch: "b", tier: 4, name: "汲血", icon: "🩸",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "lifesteal", op: "add", per: 1,
    desc: "每级吸血 +1 点" },
  { id: "rb5", cls: "ranger", branch: "b", tier: 5, name: "风灵", icon: "🌬",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "dodge", op: "add", per: 2,
    desc: "每级闪避 +2 点" },
  // 猎杀
  { id: "rc1", cls: "ranger", branch: "c", tier: 1, name: "利刃", icon: "🗡",
    maxLv: 4, cost0: 1, costStep: 1, kind: "stat", stat: "atk", op: "pct", per: 3,
    desc: "每级攻击 +3%" },
  { id: "rc2", cls: "ranger", branch: "c", tier: 2, name: "猎首", icon: "💀",
    maxLv: 5, cost0: 2, costStep: 1, kind: "stat", stat: "boss_dmg_r", op: "add", per: 4,
    desc: "每级对精英与头目伤害 +4%(仅在线技能命中)" },
  { id: "rc3", cls: "ranger", branch: "c", tier: 3, name: "杀意", icon: "😤",
    maxLv: 5, cost0: 2, costStep: 2, kind: "stat", stat: "kill_haste", op: "add", per: 3,
    desc: "每级杀意 +3 点(击杀提速,仅在线战斗)" },
  { id: "rc4", cls: "ranger", branch: "c", tier: 4, name: "拾荒", icon: "◈",
    maxLv: 5, cost0: 3, costStep: 2, kind: "stat", stat: "goldfind", op: "add", per: 4,
    desc: "每级金币加成 +4 点" },
  { id: "rc5", cls: "ranger", branch: "c", tier: 5, name: "猎神", icon: "🎯",
    maxLv: 3, cost0: 5, costStep: 3, kind: "stat", stat: "atk", op: "pct", per: 5,
    desc: "每级攻击 +5%" },
];
export const CHAIN_DEF: Record<string, ChainNodeDef> =
  Object.fromEntries(CLASS_CHAINS.map(n => [n.id, n]));

/** 特别天赋:里程碑(终身累计已购该职业链级数)点亮「✵天赋点」后手动选择的一次性被动。
 *  天赋点 = 特殊技能点,有限:每跨一档(50/100/200)仅得 1 枚,终身每职业至多 3 枚;
 *  T1/T2 档各 2 候选选 1、T3 档为该职业终极唯一 —— 一次点亮终身定型,不可多点、
 *  不可改选(转生不清、无解锁回退);选择态入档 chainPicked,
 *  仅当前职业=归属职业时经 chainSpecialMods 进 mods 管道。
 *  强度锚:T1 ≈ 单条永久天赋满级线的 0.2-0.6×、T3 全套 ≈ +10-20% 主属性+资源,
 *  一次性有界解锁(与转生无界乘区不同),远小于反作弊包络 ×4 SLACK。 */
export interface ChainSpecialDef {
  id: string; cls: string;
  need: number;                   // BAL.chain_milestones 档位(50/100/200);同档候选 2+2+1
  name: string; icon: string;
  effects: { stat: ChainNodeDef["stat"]; op: "add" | "pct"; v: number }[];
  desc: string;
}
export const CLASS_CHAIN_SPECIALS: ChainSpecialDef[] = [
  { id: "sp_w1", cls: "warrior", need: 50, name: "百战之躯", icon: "🛡",
    effects: [
      { stat: "def", op: "pct", v: 6 }, { stat: "hp", op: "pct", v: 6 },
      { stat: "kill_heal", op: "add", v: 2 },
    ],
    desc: "防御 +6% · 生命 +6% · 击杀回血 +2 点(仅在线战斗)" },
  { id: "sp_w1b", cls: "warrior", need: 50, name: "嗜战", icon: "🩸",
    effects: [
      { stat: "atk", op: "pct", v: 4 }, { stat: "haste", op: "add", v: 4 },
      { stat: "lifesteal", op: "add", v: 2 },
    ],
    desc: "攻击 +4% · 攻击速度 +4 点 · 吸血 +2 点" },
  { id: "sp_w2", cls: "warrior", need: 100, name: "怒火燎原", icon: "⚔",
    effects: [
      { stat: "atk", op: "pct", v: 8 }, { stat: "crit_dmg", op: "add", v: 15 },
      { stat: "armor_pierce", op: "add", v: 5 },
    ],
    desc: "攻击 +8% · 暴击伤害 +15 点 · 无视防御 +5 点(仅在线与切磋)" },
  { id: "sp_w2b", cls: "warrior", need: 100, name: "不动如山", icon: "🏰",
    effects: [
      { stat: "hp", op: "pct", v: 8 }, { stat: "dodge", op: "add", v: 3 },
      { stat: "deathward", op: "add", v: 3 },
    ],
    desc: "生命 +8% · 闪避 +3 点 · 不死 +3 点(仅在线)" },
  { id: "sp_w3", cls: "warrior", need: 200, name: "不灭战魂", icon: "🔥",
    effects: [
      { stat: "atk", op: "pct", v: 10 }, { stat: "hp", op: "pct", v: 10 },
      { stat: "deathward", op: "add", v: 5 }, { stat: "goldfind", op: "add", v: 10 },
    ],
    desc: "攻击 +10% · 生命 +10% · 不死 +5 点(仅在线)· 金币加成 +10 点" },
  { id: "sp_m1", cls: "mage", need: 50, name: "元素亲和", icon: "✦",
    effects: [
      { stat: "skill_dmg", op: "add", v: 15 }, { stat: "xp_pct", op: "add", v: 5 },
    ],
    desc: "技能伤害 +15% · 经验加成 +5%" },
  { id: "sp_m1b", cls: "mage", need: 50, name: "咒盾", icon: "🛡",
    effects: [
      { stat: "def", op: "pct", v: 5 }, { stat: "hp", op: "pct", v: 5 },
      { stat: "cd_reduce", op: "add", v: 2 },
    ],
    desc: "防御 +5% · 生命 +5% · 冷却缩减 +2 点" },
  { id: "sp_m2", cls: "mage", need: 100, name: "时间扭曲", icon: "⏳",
    effects: [
      { stat: "cd_reduce", op: "add", v: 4 }, { stat: "crit", op: "add", v: 3 },
      { stat: "xp_pct", op: "add", v: 8 },
    ],
    desc: "冷却缩减 +4 点 · 暴击率 +3 点 · 经验加成 +8%" },
  { id: "sp_m2b", cls: "mage", need: 100, name: "焚天", icon: "🔥",
    effects: [
      { stat: "skill_dmg", op: "add", v: 20 }, { stat: "crit_dmg", op: "add", v: 10 },
      { stat: "goldfind", op: "add", v: 5 },
    ],
    desc: "技能伤害 +20% · 暴击伤害 +10 点 · 金币加成 +5 点" },
  { id: "sp_m3", cls: "mage", need: 200, name: "湮灭星陨", icon: "☄",
    effects: [
      { stat: "skill_dmg", op: "add", v: 30 }, { stat: "crit_dmg", op: "add", v: 20 },
      { stat: "atk", op: "pct", v: 8 }, { stat: "goldfind", op: "add", v: 10 },
    ],
    desc: "技能伤害 +30% · 暴击伤害 +20 点 · 攻击 +8% · 金币加成 +10 点" },
  { id: "sp_r1", cls: "ranger", need: 50, name: "疾风之魂", icon: "💨",
    effects: [
      { stat: "haste", op: "add", v: 6 }, { stat: "dodge", op: "add", v: 3 },
    ],
    desc: "攻击速度 +6 点 · 闪避 +3 点" },
  { id: "sp_r1b", cls: "ranger", need: 50, name: "猎首烙印", icon: "💀",
    effects: [
      { stat: "boss_dmg_r", op: "add", v: 6 }, { stat: "atk", op: "pct", v: 3 },
    ],
    desc: "对精英与头目伤害 +6%(仅在线技能命中)· 攻击 +3%" },
  { id: "sp_r2", cls: "ranger", need: 100, name: "鹰眼猎杀", icon: "🎯",
    effects: [
      { stat: "crit", op: "add", v: 4 }, { stat: "crit_dmg", op: "add", v: 15 },
      { stat: "luck", op: "add", v: 3 },
    ],
    desc: "暴击率 +4 点 · 暴击伤害 +15 点 · 幸运 +3 点" },
  { id: "sp_r2b", cls: "ranger", need: 100, name: "疾影", icon: "💨",
    effects: [
      { stat: "haste", op: "add", v: 5 }, { stat: "dodge", op: "add", v: 2 },
      { stat: "kill_haste", op: "add", v: 5 },
    ],
    desc: "攻击速度 +5 点 · 闪避 +2 点 · 杀意 +5 点(击杀提速,仅在线)" },
  { id: "sp_r3", cls: "ranger", need: 200, name: "万箭归宗", icon: "☔",
    effects: [
      { stat: "atk", op: "pct", v: 8 }, { stat: "haste", op: "add", v: 8 },
      { stat: "crit_extra", op: "add", v: 8 }, { stat: "goldfind", op: "add", v: 10 },
    ],
    desc: "攻击 +8% · 攻击速度 +8 点 · 暴击追击 +8%(仅在线)· 金币加成 +10 点" },
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
  { hash: 179156654, label: "VIP礼包:◈30万 + ✦6 + 🔑2", gold: 300000, stones: 6, keys: 2 },
  { hash: 3586404200, label: "VIP礼包:◈30万 + ✦6 + 🔑2", gold: 300000, stones: 6, keys: 2 },
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
  // 达到型任务(留存诊断建议2):progress 语义为「已达到」,不做累计
  { type: "level", tpl: "升到 Lv.{n}", base: 3, growth: 1.12, goldK: 20, stones: 0 },
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
  // 前期缓曲线(2026-10-25 留存诊断建议1,实验依据 out/retention-report.md):
  // zone≤mob_hp_early_max_zone 的怪血指数 1.28→1.14,真实内核对照实验零操作 15min
  // 站稳 2 区 4/9→9/9、warrior 0/3→3/3、med 576s 过首个 boss;zone4+ 不变,深层
  // 长线零影响。主线与离线推演共用 spawnMonster 自动一致;塔不走此曲线。
  mob_hp_p_early: 1.14, mob_hp_early_max_zone: 3,
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
  // 游戏倍速档位(等级门槛):1x 始终可用,Lv5 解锁 2x,Lv30 解锁 3x
  // (留存诊断建议3:2x 从 Lv10 提前到 Lv5——Lv5 实测 8-11 分钟可达,Lv10 要 40min+;
  //  留存 4/4 行为签名是 speed 2-3x,把自动化体验提前到首个会话内)
  speed_unlock: [1, 5, 30],
  death_row_to_farm: 2,
  // 挂机掉落保底(留存诊断建议5):挂机模式下掉落 tier 下限 = floor(等级/除数)。
  // 结构性卡点:掉落按怪物 tier 生成,锚在 1 区只掉 T0,40min/1600 杀也攒不出过关
  // 装备;保底让长挂玩家至少攒出 T3-T4,推图模式不参与(保持 RNG 体验)
  farm_drop_tier_div: 3,
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

  // ---- 深渊天赋(2.4):魂晶经济与定向锻造 ----
  rebirth_essence_base: 5,   // 转生魂晶 = round(k × base),至少 1;锚点1档=5,封顶4档=20
  // ---- 星火(2.9):局内升级点数经济(表驱动;50 级踩线转生 = 49 点) ----
  spark_per_lv: 1,           // 每升 1 级得点(开局 level=1 不给点;转生熄灭)
  forge_gold_k: 200,         // 定向锻造金币费 = 击杀金(当前区域档) × k
  forge_stones0: 4,          // 重铸石基础费
  forge_stones_t: 80,        // 每满 tier/80 加 1 颗
  forge_stones_cap: 25,      // 重铸石费封顶(深层不再失控)
  forge_min_rid: 2,          // 锻造稀有度保底:稀有+
  forge_rarity_boost: 0.5,   // 高稀有度权重增益(介于精英 0.25 与头目 0.6 之间)
  // (2.9 套装掉率 suit_drop_chance 已删:渠道收拢进塔,必掉+定向补缺,无概率参数)

  // ---- 玩家自动化三开关(2.2.2):逐步放手,先强化→技能→祭坛 ----
  auto_enhance_lv: 20,     // 自动强化解锁等级
  auto_skill_lv: 30,       // 自动升技能解锁等级
  auto_altar_lv: 40,       // 自动献祭解锁等级

  // ---- 图鉴二期(2.3):每点亮一种怪的永久加成(攻/生命各按此系数 × 已点亮数) ----
  codex_per: 0.15,         // 每种 +0.15%;全 37 种 = 各 +5.55%(扩怪前 17 种 +5.1%,维持轻量不扰动主线)

  // ---- 世界BOSS·周轮合力(2.6):异步轮次 + 纯拉模式,伤害只升不降聚合总血池 ----
  world_boss_cast_sec: 30,     // 客户端折算时长:dmg = heroDps × 30s × uniform(0.9,1.1)
  world_boss_var_lo: 0.9,      // 折算浮动下界
  world_boss_var_hi: 1.1,      // 折算浮动上界
  world_boss_def: 2000,        // 折算假人防御(固定值;perBase 分量与真实差异 ≤ 约 3×)
  world_boss_attempts: 3,      // 每轮挑战次数上限(纯本地记账,服务端靠包络+限流兜底)
  world_boss_gold_k: 50,       // 参与档金币 = 当前区击杀金 × 50(≈10 分钟挂机收入,与签到同保守哲学)
  world_boss_stones_pct: 2,    // ≥1% 贡献档:重铸石
  world_boss_stones_kill: 2,   // 上轮全服击杀档:重铸石(可与贡献档叠加)
  world_boss_claim_keep: 8,    // claimed 幂等记录滚动保留轮数(防存档膨胀)
  // 服务端伤害包络系数(server.cjs/worker.js 的 world_boss_dmg_cap_k 同名常量互指,
  // scripts/lb-smoke.ts G 组 readFileSync 断言双端各含该字样,漂移即 FAIL)。
  // 包络余量:折算 ≤33s 等效输出,实际等效上界 ≈100s,对 1200s 额度余量约 10×;
  // 调 world_boss_cast_sec 或 DPS 口径时,保持额度/cast_sec 比值 ≥5×。
  world_boss_dmg_cap_k: 1200,

  // ---- 异步切磋(2.7):阵容快照对战 —— 回合制期望对撞,奖励仅称号
  arena_turn_sec: 0.5,        // 每回合等效输出秒数(120 回合 = 60s 等效战斗)
  arena_max_rounds: 120,      // 回合上限;未分胜负按剩余血量百分比判,持平判攻方胜

  // ---- 职业天赋链(2.10):里程碑档位(终身累计已购该职业链级数,表驱动照 speed_unlock 范式)
  chain_milestones: [50, 100, 200],   // 逐档 +1 枚✵天赋点(特殊技能点,有限):T1/T2 各 2 选 1、T3 终极 1 条,一次定型
} as const;

export const VIRTUAL_STATS = ["skill_dmg", "cd_reduce", "dodge", "armor_pierce", "xp_pct",
  "crit_extra", "kill_heal", "deathward", "boss_dmg_r", "kill_haste"] as const;

// ---------------------------------------------------------------- 遗物系统(爬塔副本)
export interface TowerDef {
  keys_per_day: number; keys_cap: number; relic_slots: number;
  th0: number; thk: number; thp: number;
  ta0: number; tak: number; tap: number;
  td0: number; tdk: number; tdp: number;
  boss_every: number;
  drop_gold_mult: number; new_height_stones: number;
  /** 里程碑间隔:首次到达每 milestone_every 层整数位(10/20/30…)额外发宝箱 */
  milestone_every: number;
  /** 里程碑宝箱的重铸石份数 */
  milestone_stones: number;
}
export const TOWER: TowerDef = {
  keys_per_day: 3, keys_cap: 99, relic_slots: 4,
  th0: 80.0, thk: 45.0, thp: 1.18,
  ta0: 10.0, tak: 3.5, tap: 1.02,
  td0: 5.0, tdk: 2.0, tdp: 1.0,
  boss_every: 5,
  drop_gold_mult: 2.0, new_height_stones: 2,
  milestone_every: 10, milestone_stones: 20,
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
