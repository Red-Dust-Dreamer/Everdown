# -*- coding: utf-8 -*-
"""游戏静态数据:稀有度 / 装备槽 / 词缀 / 地图 / 怪物 / 技能 / 成就 / 悬赏 / 平衡常数"""

# ---------------------------------------------------------------- 稀有度
# (键, 名称, 颜色, 词缀数, 主属性系数, 基础掉落权重)
RARITIES = [
    ("common",    "普通", "bright_black",   1, 1.00, 55.0),
    ("fine",      "精良", "green",          2, 1.12, 25.0),
    ("rare",      "稀有", "bright_blue",    2, 1.28, 12.0),
    ("epic",      "史诗", "bright_magenta", 3, 1.48, 5.5),
    ("legendary", "传说", "bright_yellow",  3, 1.75, 2.0),
    ("mythic",    "神话", "bright_red",     4, 2.10, 0.5),
]
RARITY_IDX = {r[0]: i for i, r in enumerate(RARITIES)}
RARITY_NAMES_CN = ["普通", "精良", "稀有", "史诗", "传说", "神话"]

# 稀有度前缀(命名风味)
RARITY_PREFIX = ["破旧的", "精制的", "秘银", "龙裔", "星陨", "湮灭"]

# ---------------------------------------------------------------- 装备槽
# (槽id, 名称, [基础名池])
SLOTS = [
    ("weapon",  "武器", ["利刃", "战刃", "重锤", "长枪", "巨剑"]),
    ("helmet",  "头盔", ["头盔", "面甲", "兜帽", "战冠"]),
    ("armor",   "护甲", ["胸甲", "鳞铠", "法袍", "重铠"]),
    ("boots",   "鞋子", ["战靴", "疾行鞋", "踏云靴", "铁蹄"]),
    ("amulet",  "项链", ["坠饰", "项链", "符珠", "龙牙链"]),
    ("ring",    "戒指", ["戒指", "指环", "印记", "魔戒"]),
]
SLOT_IDX = {s[0]: i for i, s in enumerate(SLOTS)}
SLOT_NAMES = {s[0]: s[1] for s in SLOTS}

# 主属性候选表(数值体系 2.1,与 TS data.ts 严格一致):
# 武器/项链/戒指 = 攻击力(饰品约为武器的 55%);
# 头盔/护甲/鞋子 = 生命 或 防御 二选一(roll 时等概率)。
# 数值型主属性 = base + k × tier^item_main_p
MAIN_ROLLS = {
    "weapon": [("atk", 4.0, 2.2)],
    "helmet": [("hp", 30.0, 14.0), ("def", 3.0, 1.4)],
    "armor":  [("hp", 30.0, 14.0), ("def", 3.0, 1.4)],
    "boots":  [("hp", 30.0, 14.0), ("def", 3.0, 1.4)],
    "amulet": [("atk", 2.2, 1.8)],
    "ring":   [("atk", 2.2, 1.8)],
}

# 主属性说明(鞋子/项链/戒指带固有副属性)
SLOT_INNATE = {
    "boots": ("haste", 2.5),   # 每稀有度档 +2.5% 攻速
    "amulet": ("crit_dmg", 6),
    "ring":   ("crit", 1.4),
}

# ---------------------------------------------------------------- 词缀池
# (词缀id, 显示名, 基值下限, 基值上限, 线性斜率/每层, 是否百分比, 评分权重, 分档步长)
# 数值型词缀:值 = u(下限,上限) + 斜率×t(线性小步长,量级可控)
# 百分比词缀:值 = rid×step + u(0,step) 按稀有度分档(白 0~step → 神话 5step~6step),
#             不随层数成长也不吃倍率,稀有度差异直接体现在档位上
AFFIXES = [
    ("atk",       "攻击力",   2.0, 4.5, 0.05, False, 1.00, 0),
    ("def",       "防御力",   2.5, 5.0, 0.06, False, 0.45, 0),
    ("hp",        "生命值",  18.0, 38.0, 0.35, False, 0.085, 0),
    ("haste",     "攻击速度", 3.0, 7.0, 0.0,  True,  6.5, 3.0),
    ("crit",      "暴击率",   2.0, 4.5, 0.0,  True,  9.0, 1.5),
    ("crit_dmg",  "暴击伤害", 8.0, 16.0, 0.0, True,  2.8, 10.0),
    ("lifesteal", "吸血",     1.0, 2.5, 0.0,  True,  7.0, 1.0),
    ("goldfind",  "金币加成", 5.0, 12.0, 0.0, True,  1.8, 6.0),
    ("skill_lv",  "全技能等级", 0.3, 0.8, 0.0, False, 11.0, 0),
    ("luck",      "幸运",     2.0, 5.0, 0.0,  True,  5.0, 3.0),
]
AFFIX_DEF = {a[0]: a for a in AFFIXES}
STAT_NAMES = {
    "atk": "攻击", "def": "防御", "hp": "生命", "haste": "攻速",
    "crit": "暴击率", "crit_dmg": "暴击伤害", "lifesteal": "吸血",
    "goldfind": "金币加成", "dmg_pct": "伤害加成",
    "skill_lv": "全技能等级", "skill_dmg": "技能伤害", "cd_reduce": "冷却缩减",
    "dodge": "闪避", "armor_pierce": "无视防御", "xp_pct": "经验加成",
    "luck": "幸运",
    # buff 键补充(buff 条/药剂显示用)
    "gold": "金币", "xp": "经验", "all": "全属性",
}
# 百分比词缀上限(最终汇总时截断)
CAPS = {"haste": 150.0, "crit": 75.0, "lifesteal": 25.0, "luck": 200.0,
        "skill_dmg": 300.0, "cd_reduce": 40.0, "dodge": 40.0,
        "armor_pierce": 50.0, "xp_pct": 200.0}

# 词缀后缀(命名风味, 与词缀对应)
AFFIX_SUFFIX = {
    "atk": "蛮力", "def": "坚壁", "hp": "巨鲸", "haste": "疾风",
    "crit": "鹰眼", "crit_dmg": "斩首", "lifesteal": "嗜血",
    "goldfind": "贪婪", "skill_lv": "大师", "luck": "天命",
}

# ---------------------------------------------------------------- 职业
# base: 基础属性乘区;interval: 攻击间隔(秒);crit0: 初始暴击(点)
CLASSES = {
    "warrior": {
        "name": "战士", "icon": "⚔", "color": "bright_red",
        "desc": "钢铁与怒火:生存极强,越战越勇,斩杀收头",
        "base": {"hp": 1.30, "atk": 1.05, "def": 1.35},
        "interval": 1.2, "crit0": 0.0,
    },
    "mage": {
        "name": "法师", "icon": "✦", "color": "bright_blue",
        "desc": "元素与毁灭:普攻平庸,技能伤害爆炸",
        "base": {"hp": 1.05, "atk": 1.10, "def": 1.00},
        "interval": 1.2, "crit0": 0.0,
    },
    "ranger": {
        "name": "射手", "icon": "➤", "color": "bright_green",
        "desc": "风与箭雨:攻速快、暴击高,连击风筝",
        "base": {"hp": 0.95, "atk": 0.95, "def": 0.90},
        "interval": 0.8, "crit0": 5.0,
    },
}

# ---------------------------------------------------------------- 主动技能池
# 数据驱动:kind ∈ damage / multi / buff / heal / shield / execute
# damage/multi: base/per = 每级威力%(等级1 = base);
#   可选 lifesteal(伤害回血%)/def_down+def_down_dur(降防)/atk_down+atk_down_dur(降攻)/
#   freeze(眩晕秒)/must_crit/vs_elite(对精英头目倍率)
# buff: stat(atk/haste/crit/crit_dmg/all), base/per = 增幅%, dur 持续秒
# heal/shield: base/per = 最大生命%
# execute: threshold = 斩杀血线%, base = 非精英头目直接伤害%
ACTIVE_SKILLS = [
    # ---- 战士 ----
    dict(id="w_strike", cls="warrior", name="重击", icon="⚔", unlock=1, cd=8,
         color="bright_yellow", kind="damage", base=260, per=60,
         desc="造成 {v}% 攻击力伤害"),
    dict(id="w_whirl", cls="warrior", name="旋风斩", icon="🌀", unlock=5, cd=5,
         color="bright_yellow", kind="damage", base=170, per=40,
         desc="快频攻击:造成 {v}% 攻击力伤害"),
    dict(id="w_warcry", cls="warrior", name="战吼", icon="🔥", unlock=8, cd=24,
         color="bright_red", kind="buff", stat="atk", base=45, per=8, dur=8,
         desc="8秒内攻击力 +{v}%"),
    dict(id="w_taunt", cls="warrior", name="嘲讽打击", icon="💢", unlock=12, cd=15,
         color="bright_yellow", kind="damage", base=150, per=35,
         atk_down=15, atk_down_dur=6,
         desc="{v}% 伤害并降低敌人攻击 15%,持续6秒"),
    dict(id="w_exec", cls="warrior", name="处决", icon="☠", unlock=16, cd=30,
         color="bright_magenta", kind="execute", threshold=20, base=500,
         desc="生命低于20%的敌人直接斩杀(否则 {v}% 伤害)"),
    dict(id="w_blood", cls="warrior", name="嗜血打击", icon="🩸", unlock=20, cd=12,
         color="bright_red", kind="damage", base=250, per=55, lifesteal=30,
         desc="{v}% 伤害,并将伤害的 30% 转为自身生命"),
    dict(id="w_wall", cls="warrior", name="护盾壁垒", icon="🛡", unlock=26, cd=20,
         color="bright_cyan", kind="shield", base=25, per=2,
         desc="获得 {v}% 最大生命的护盾"),
    dict(id="w_fury", cls="warrior", name="狂暴", icon="⚡", unlock=32, cd=30,
         color="bright_red", kind="buff", stat="haste", base=40, per=4, dur=10,
         desc="10秒内攻速 +{v}%"),
    dict(id="w_fatal", cls="warrior", name="致命一击", icon="💥", unlock=40, cd=20,
         color="bright_yellow", kind="damage", base=500, per=90, must_crit=True,
         desc="{v}% 伤害,必定暴击"),
    dict(id="w_roar", cls="warrior", name="毁灭怒吼", icon="🔥", unlock=50, cd=45,
         color="bright_red", kind="buff", stat="all", base=30, per=3, dur=12,
         desc="12秒内全属性 +{v}%"),
    # ---- 法师 ----
    dict(id="m_missile", cls="mage", name="奥术飞弹", icon="✧", unlock=1, cd=6,
         color="bright_blue", kind="damage", base=220, per=55,
         desc="射出奥术能量,造成 {v}% 攻击力伤害"),
    dict(id="m_fire", cls="mage", name="火球术", icon="🔥", unlock=5, cd=10,
         color="bright_red", kind="damage", base=300, per=70,
         desc="投掷火球,造成 {v}% 攻击力伤害"),
    dict(id="m_ice", cls="mage", name="寒冰箭", icon="❄", unlock=8, cd=12,
         color="bright_cyan", kind="damage", base=180, per=45,
         atk_down=25, atk_down_dur=5,
         desc="{v}% 伤害并降低敌人攻击 18%,持续5秒"),
    dict(id="m_surge", cls="mage", name="奥术涌动", icon="✦", unlock=12, cd=25,
         color="bright_blue", kind="buff", stat="dmg", base=50, per=5, dur=8,
         desc="8秒内造成的所有伤害 +{v}%"),
    dict(id="m_chain", cls="mage", name="闪电链", icon="⚡", unlock=16, cd=12,
         color="bright_yellow", kind="damage", base=240, per=60, vs_elite=1.5,
         desc="{v}% 伤害,对精英与头目 ×1.5"),
    dict(id="m_storm", cls="mage", name="烈焰风暴", icon="🌀", unlock=20, cd=15,
         color="bright_red", kind="damage", base=420, per=95,
         desc="烈焰席卷,造成 {v}% 攻击力伤害"),
    dict(id="m_nova", cls="mage", name="冰霜新星", icon="❄", unlock=26, cd=35,
         color="bright_cyan", kind="damage", base=150, per=35, freeze=3,
         desc="{v}% 伤害并冻结敌人 3 秒"),
    dict(id="m_shield", cls="mage", name="法力护盾", icon="🛡", unlock=32, cd=22,
         color="bright_blue", kind="shield", base=30, per=2.5,
         desc="获得 {v}% 最大生命的护盾"),
    dict(id="m_meteor", cls="mage", name="陨石术", icon="☄", unlock=40, cd=26,
         color="bright_red", kind="damage", base=700, per=130,
         desc="召唤陨石,造成 {v}% 攻击力伤害"),
    dict(id="m_cata", cls="mage", name="元素灾变", icon="💥", unlock=50, cd=45,
         color="bright_magenta", kind="damage", base=1000, per=180, must_crit=True,
         desc="{v}% 伤害,必定暴击"),
    # ---- 射手 ----
    dict(id="r_volley", cls="ranger", name="疾风连射", icon="➤", unlock=1, cd=8,
         color="bright_green", kind="multi", base=90, per=20, hits=3,
         desc="连射3箭,每箭 {v}% 攻击力伤害"),
    dict(id="r_pierce", cls="ranger", name="穿透箭", icon="➤", unlock=5, cd=12,
         color="bright_green", kind="damage", base=280, per=65,
         def_down=20, def_down_dur=5,
         desc="{v}% 伤害并降低敌人防御 20%,持续5秒"),
    dict(id="r_mark", cls="ranger", name="猎杀印记", icon="◎", unlock=8, cd=18,
         color="bright_yellow", kind="damage", base=80, per=20, mark=25, mark_dur=10,
         desc="标记目标:10秒内对其伤害 +25%(附带 {v}% 伤害)"),
    dict(id="r_back", cls="ranger", name="后跳射击", icon="↩", unlock=12, cd=10,
         color="bright_green", kind="damage", base=200, per=45, lifesteal=50,
         desc="{v}% 伤害,并将伤害的 50% 转为自身生命"),
    dict(id="r_rain", cls="ranger", name="箭雨", icon="☔", unlock=16, cd=14,
         color="bright_green", kind="multi", base=110, per=25, hits=5,
         desc="箭雨覆盖:5连击,每箭 {v}% 攻击力伤害"),
    dict(id="r_hawk", cls="ranger", name="鹰眼", icon="👁", unlock=24, cd=25,
         color="bright_yellow", kind="buff", stat="crit", base=15, per=1.5, dur=10,
         desc="10秒内暴击率 +{v} 点"),
    dict(id="r_dash", cls="ranger", name="疾行", icon="💨", unlock=26, cd=22,
         color="bright_cyan", kind="buff", stat="haste", base=50, per=4, dur=8,
         desc="8秒内攻速 +{v}%"),
    dict(id="r_deadly", cls="ranger", name="致命连射", icon="💥", unlock=32, cd=25,
         color="bright_red", kind="multi", base=180, per=40, hits=3, must_crit=True,
         desc="3连击必暴击,每箭 {v}% 攻击力伤害"),
    dict(id="r_sky", cls="ranger", name="穿云箭", icon="✷", unlock=40, cd=28,
         color="bright_yellow", kind="damage", base=800, per=150,
         desc="贯穿一切:造成 {v}% 攻击力伤害"),
    dict(id="r_god", cls="ranger", name="猎神之怒", icon="🌟", unlock=50, cd=45,
         color="bright_green", kind="buff", stat="all", base=25, per=2.5, dur=12,
         desc="12秒内全属性 +{v}%"),
]

# ---------------------------------------------------------------- 被动技能池
# kind="stat": 常驻数值(stat/op/base/per),op=add 为点数(暴击等)/pct 为百分比乘区;
#             虚拟属性 skill_dmg(技能伤害%)/cd_reduce(冷却缩减%)/dodge(闪避%)/
#             armor_pierce(无视防御%)/xp_pct(经验%)同样走 stat
# kind="hook": 条件触发, hook ∈
#   on_kill_buff(击杀后 stat+X% 持续 dur)/ low_hp_dmg(自身血<50% 伤害+)/
#   undying(致命伤 X% 概率保留1血, 内置CD)/ armor_pierce → 已并入 stat
#   on_crit_haste(暴击后攻速+X% 3秒)/ on_crit_dmg_next(暴击后下次攻击+X%)/
#   on_hurt_dmg(受击后伤害+X% 4秒)/ dodge → 并入 stat
#   boss_dmg(对精英头目伤害+)/ low_target_dmg(目标血<40% 伤害+)
PASSIVE_SKILLS = [
    # ---- 战士 ----
    dict(id="pw_tough", cls="warrior", name="坚韧", unlock=1, kind="stat",
         stat="hp", op="pct", base=8, per=0.8, desc="生命 +{v}%"),
    dict(id="pw_brute", cls="warrior", name="蛮力", unlock=5, kind="stat",
         stat="atk", op="pct", base=8, per=0.8, desc="攻击 +{v}%"),
    dict(id="pw_feast", cls="warrior", name="杀戮盛宴", unlock=10, kind="hook",
         hook="on_kill_buff", stat="atk", base=10, per=1, dur=4,
         desc="击杀后4秒内攻击 +{v}%"),
    dict(id="pw_iron", cls="warrior", name="铁壁", unlock=15, kind="stat",
         stat="def", op="pct", base=10, per=1, desc="防御 +{v}%"),
    dict(id="pw_unyield", cls="warrior", name="不屈", unlock=20, kind="hook",
         hook="undying", base=25, per=1.5, desc="{v}% 概率免疫致命伤(60秒冷却)"),
    dict(id="pw_will", cls="warrior", name="战意", unlock=25, kind="hook",
         hook="low_hp_dmg", base=30, per=3, desc="生命低于一半时伤害 +{v}%"),
    dict(id="pw_hunt", cls="warrior", name="深渊猎手", unlock=30, kind="hook",
         hook="boss_dmg", base=15, per=1.5, desc="对精英与头目伤害 +{v}%"),
    dict(id="pw_break", cls="warrior", name="破甲", unlock=35, kind="stat",
         stat="armor_pierce", op="add", base=10, per=1, desc="攻击无视 {v}% 敌人防御"),
    dict(id="pw_zerk", cls="warrior", name="狂战士", unlock=45, kind="hook",
         hook="on_crit_haste", base=20, per=2, dur=3, desc="暴击后3秒攻速 +{v}%"),
    dict(id="pw_phoenix", cls="warrior", name="不死战魂", unlock=55, kind="stat",
         stat="all", op="pct", base=10, per=1, desc="全属性 +{v}%"),
    # ---- 法师 ----
    dict(id="pm_affin", cls="mage", name="奥术亲和", unlock=1, kind="stat",
         stat="skill_dmg", op="add", base=25, per=1, desc="主动技能伤害 +{v}%"),
    dict(id="pm_prec", cls="mage", name="元素精准", unlock=5, kind="stat",
         stat="crit", op="add", base=3, per=0.3, desc="暴击率 +{v} 点"),
    dict(id="pm_frost", cls="mage", name="冰霜之体", unlock=10, kind="stat",
         stat="hp", op="pct", base=6, per=0.6, desc="生命 +{v}%"),
    dict(id="pm_sage", cls="mage", name="贤者洞察", unlock=15, kind="stat",
         stat="xp_pct", op="add", base=10, per=1, desc="经验获取 +{v}%"),
    dict(id="pm_torrent", cls="mage", name="法力洪流", unlock=20, kind="stat",
         stat="atk", op="pct", base=8, per=0.8, desc="攻击 +{v}%"),
    dict(id="pm_burn", cls="mage", name="燃烧殆尽", unlock=25, kind="hook",
         hook="low_target_dmg", base=20, per=2, desc="对血量低于30%的敌人伤害 +{v}%"),
    dict(id="pm_bar", cls="mage", name="秘法屏障", unlock=30, kind="stat",
         stat="def", op="pct", base=8, per=0.8, desc="防御 +{v}%"),
    dict(id="pm_time", cls="mage", name="时间扭曲", unlock=35, kind="stat",
         stat="cd_reduce", op="add", base=8, per=0.6, desc="技能冷却 -{v}%"),
    dict(id="pm_destr", cls="mage", name="毁灭倾向", unlock=45, kind="stat",
         stat="crit_dmg", op="add", base=30, per=3, desc="暴击伤害 +{v}%"),
    dict(id="pm_arch", cls="mage", name="大法师", unlock=55, kind="stat",
         stat="all", op="pct", base=10, per=1, desc="全属性 +{v}%"),
    # ---- 射手 ----
    dict(id="pr_swift", cls="ranger", name="迅捷", unlock=1, kind="stat",
         stat="haste", op="add", base=6, per=0.6, desc="攻速 +{v}%"),
    dict(id="pr_eye", cls="ranger", name="鹰眼视觉", unlock=5, kind="stat",
         stat="crit", op="add", base=3, per=0.3, desc="暴击率 +{v} 点"),
    dict(id="pr_weak", cls="ranger", name="弱点洞察", unlock=10, kind="stat",
         stat="crit_dmg", op="add", base=25, per=2.5, desc="暴击伤害 +{v}%"),
    dict(id="pr_inst", cls="ranger", name="猎人本能", unlock=15, kind="hook",
         hook="boss_dmg", base=12, per=1.2, desc="对精英与头目伤害 +{v}%"),
    dict(id="pr_wind", cls="ranger", name="疾风步", unlock=20, kind="stat",
         stat="dodge", op="add", base=8, per=0.8, desc="{v}% 概率闪避攻击"),
    dict(id="pr_chain", cls="ranger", name="连锁反应", unlock=25, kind="hook",
         hook="on_crit_dmg_next", base=30, per=3, desc="暴击后下次攻击伤害 +{v}%"),
    dict(id="pr_avenge", cls="ranger", name="复仇", unlock=30, kind="hook",
         hook="on_hurt_dmg", base=15, per=1.5, dur=4, desc="受击后4秒内伤害 +{v}%"),
    dict(id="pr_chase", cls="ranger", name="无情追击", unlock=35, kind="hook",
         hook="low_target_dmg", base=18, per=1.8, desc="对血量低于40%的敌人伤害 +{v}%"),
    dict(id="pr_master", cls="ranger", name="箭术大师", unlock=45, kind="stat",
         stat="skill_dmg", op="add", base=8, per=0.8, desc="主动技能伤害 +{v}%"),
    dict(id="pr_legend", cls="ranger", name="传奇猎手", unlock=55, kind="stat",
         stat="all", op="pct", base=10, per=1, desc="全属性 +{v}%"),
]

ACTIVE_DEF = {s["id"]: s for s in ACTIVE_SKILLS}
PASSIVE_DEF = {s["id"]: s for s in PASSIVE_SKILLS}

# ---------------------------------------------------------------- 地图主题
THEMES = [
    ("幽暗森林", ["slime", "wolf", "goblin"], "巨型史莱姆王", "green"),
    ("废弃矿坑", ["bat", "skeleton", "golem"], "骷髅领主", "bright_black"),
    ("熔岩地狱", ["imp", "hound", "elemental"], "炎魔男爵", "bright_red"),
    ("寒冰冻土", ["wolf", "golem", "elemental", "drake"], "霜暴巨兽", "bright_cyan"),
    ("毒雾沼泽", ["mushroom", "spider", "snake"], "沼泽蛛后", "green"),
    ("白骨王座", ["husk", "wight", "scarab"], "白骨君王", "white"),
    ("腐沼墓地", ["slime", "skeleton", "bat"], "亡灵大祭司", "magenta"),
    ("虚空裂隙", ["imp", "goblin", "hound", "eye"], "虚空吞噬者", "bright_magenta"),
]
CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]

# (名称, 颜色, 属性系数, 专属主动技能)
# 技能: name/icon/cd(秒)/mult(每段伤害=攻击×mult)/hits(段数)/
#        lifesteal(伤害全额回复自身)/defdown=(降英雄防%,秒)/atkdown=(降英雄攻%,秒)/stun(眩晕英雄秒)
MONSTERS = {
    "slime":     ("史莱姆", "green", 1.0,
                  dict(name="酸液喷吐", icon="☣", cd=10, mult=1.2, hits=1, defdown=(0.30, 5))),
    "wolf":      ("恐狼", "yellow", 1.05,
                  dict(name="狂暴撕咬", icon="🐍", cd=8, mult=0.6, hits=3)),
    "goblin":    ("哥布林", "bright_green", 0.95,
                  dict(name="卑鄙飞刀", icon="🔪", cd=12, mult=2.5, hits=1)),
    "bat":       ("吸血蝠", "magenta", 0.9,
                  dict(name="血之盛宴", icon="🩸", cd=10, mult=1.5, hits=1, lifesteal=True)),
    "skeleton":  ("骷髅兵", "white", 1.05,
                  dict(name="白骨之刺", icon="🦴", cd=12, mult=2.0, hits=1, atkdown=(0.20, 5))),
    "golem":     ("石魔像", "bright_black", 1.15,
                  dict(name="大地震颤", icon="💢", cd=15, mult=1.3, hits=1, stun=1.2)),
    "imp":       ("小恶魔", "bright_red", 1.05,
                  dict(name="火焰投掷", icon="🔥", cd=9, mult=2.2, hits=1)),
    "hound":     ("地狱犬", "red", 1.1,
                  dict(name="三头撕咬", icon="🐺", cd=9, mult=0.85, hits=3)),
    "elemental": ("元素灵", "bright_cyan", 1.05,
                  dict(name="元素风暴", icon="⚡", cd=14, mult=2.8, hits=1)),
    # ---- 毒雾沼泽 / 白骨王座(CC0 立绘:public/mon/<id>.png) ----
    "mushroom": ("毒蘑菇", "green", 0.95,
                 dict(name="孢子毒云", icon="☣", cd=11, mult=1.3, hits=1, atkdown=(0.20, 5))),
    "spider":   ("红背毒蛛", "red", 1.0,
                 dict(name="缠丝连蛰", icon="🕸", cd=9, mult=0.55, hits=3, defdown=(0.25, 4))),
    "snake":    ("黑曼巴蛇", "bright_black", 1.05,
                 dict(name="毒牙速咬", icon="🦷", cd=9, mult=0.7, hits=3)),
    "husk":     ("肿胀腐尸", "magenta", 0.95,
                 dict(name="尸毒喷发", icon="☠", cd=11, mult=1.6, hits=1, atkdown=(0.20, 4))),
    "wight":    ("白骨武士", "white", 1.15,
                 dict(name="幽冥斩", icon="⚔", cd=10, mult=2.3, hits=1)),
    "scarab":   ("噬骨甲虫", "yellow", 1.0,
                 dict(name="甲群啃噬", icon="🐜", cd=9, mult=0.45, hits=4)),
    # ---- 散怪:强化既有主题 ----
    "drake":    ("霜翼幼龙", "bright_cyan", 1.15,
                 dict(name="寒霜吐息", icon="❄", cd=13, mult=2.4, hits=1, atkdown=(0.25, 5))),
    "eye":      ("辉光邪眼", "bright_magenta", 1.1,
                 dict(name="疯狂凝视", icon="👁", cd=12, mult=1.9, hits=1, stun=1.0)),
}

ART = {
    "hero": [
        r"    /\    ____ ",
        r"   /  \  |。o |",
        r"  | ⚔ | /|  |\ ",
        r"  |___/  |  |  ",
        r"  /  \  _|  |_ ",
    ],
    "slime": [
        r"   _____     ",
        r"  /     \    ",
        r" |  > <  |   ",
        r"  \ __  /    ",
        r"   \___/     ",
    ],
    "wolf": [
        r"  /\___/\    ",
        r" (  ω  )\,,  ",
        r"  |    | ||  ",
        r" /|    |\||  ",
        r" ‾‾     ‾    ",
    ],
    "goblin": [
        r"   ,,,,      ",
        r"  (o-o)      ",
        r" <|  |>>     ",
        r"  _| |_      ",
        r"  /   \      ",
    ],
    "bat": [
        r" __  __      ",
        r"/  \/  \,_,  ",
        r"\_/\_/\ 'b, ",
        r"  _||_       ",
        r"             ",
    ],
    "skeleton": [
        r"   .-.       ",
        r"  (o o)      ",
        r"  |' '|      ",
        r"  |   |      ",
        r"  _/ \_      ",
    ],
    "golem": [
        r"  [===]      ",
        r"  |o°o|      ",
        r" [|||]|]     ",
        r"  |___|      ",
        r" _/] [_\     ",
    ],
    "imp": [
        r"  \|/        ",
        r" (>v<)       ",
        r" </_\>       ",
        r"  | |        ",
        r" _/ \_       ",
    ],
    "hound": [
        r" ^   ^      ",
        r" (◉ ω ◉)~,  ",
        r"   /|\       ",
        r"  / | \      ",
        r"    ‾        ",
    ],
    "elemental": [
        r"   (  )      ",
        r"  ( ◉ )     ",
        r"   )  (      ",
        r"  ( ⚡ )     ",
        r"   \  /      ",
    ],
    "mushroom": [
        r"    ____     ",
        r"   / @@ \    ",
        r"   \____/    ",
        r"   _|  |_    ",
        r"  /|    |\    ",
    ],
    "spider": [
        r"  \ _||_ /   ",
        r"    (oo)     ",
        r"   /##\      ",
        r"  //  \\     ",
        r" _/    \_    ",
    ],
    "snake": [
        r"    ____     ",
        r"   / o \     ",
        r"   \    \,   ",
        r"  < ~~  /    ",
        r"   \___/     ",
    ],
    "husk": [
        r"   .----.    ",
        r"  ( x  x )   ",
        r"  | ~~~~ |   ",
        r" /|      |\  ",
        r"  _|____|_   ",
    ],
    "wight": [
        r"   [====]    ",
        r"   |-o o|    ",
        r"  <|    |>   ",
        r"   |    |    ",
        r"  _/    \_   ",
    ],
    "scarab": [
        r"    ____     ",
        r"   /o^^o\    ",
        r"  |@ @@ @|   ",
        r"   \====/    ",
        r"  _/    \_   ",
    ],
    "drake": [
        r"  \  /\  /   ",
        r"   ( oo )    ",
        r"  --/  \--   ",
        r"  /|    |\   ",
        r"   |____|    ",
    ],
    "eye": [
        r"   .----.    ",
        r"  / ---- \   ",
        r" |  (OO)  |  ",
        r"  \ ---- /   ",
        r"   \____/    ",
    ],
}
BOSS_CROWN = " ♛"

# (技能体系见下方 ACTIVE_SKILLS / PASSIVE_SKILLS:每职业 10 主动 + 10 被动,
#  从中自选装配 4+4,槽位随等级解锁,见 BAL["loadout_unlock"])

# ---------------------------------------------------------------- 成就
# (id, 名称, 指标, 阈值列表, 加成属性, 每档加成%)
ACHIEVEMENTS = [
    ("slayer",  "深渊猎手", "kills",       [100, 1000, 10000, 50000], "atk", 4),
    ("zonewalk", "开疆拓土", "max_zone",   [3, 6, 10, 15, 25],        "hp", 6),
    ("smith",   "锻造宗师", "enhance_total", [10, 50, 200, 600],      "def", 5),
    ("boss",    "弑主者",   "boss_kills",  [10, 50, 200, 800],        "crit", 2),
    ("tycoon",  "深渊富豪", "gold_earned", [1e4, 1e5, 1e6, 1e8],      "goldfind", 5),
    ("death",   "不死鸟",   "deaths",      [1, 10, 50, 200],          "hp", 3),
]
# 成就加成属性单位:crit 为百分点,其余为百分比;crit 每档 +2 点

# ---------------------------------------------------------------- 悬赏任务
# (类型, 描述模板, 目标基数, 目标成长, 金币系数, 重铸石)
QUEST_TYPES = [
    ("kill",   "击杀 {n} 只怪物",   20, 1.15, 25,  0),
    ("boss",   "击败 {n} 个头目",    2, 1.10, 40,  1),
    ("loot",   "获取 {n} 件稀有+装备", 3, 1.12, 30, 1),
    ("enhance", "强化装备 {n} 次",    3, 1.15, 35,  1),
]

# ---------------------------------------------------------------- 平衡常数
# 数值体系 2.0(2026-09-30):全部指数成长改为低斜率多项式/线性。
# 设计目标:数字长期保持可读(万级以内)、成长成型以小时计、
# 装备纵向与怪物同阶(质量差异决定进度,而非深度碾压)。
# ---------------------------------------------------------------- 深渊祭坛(金币→永久属性;与 TS 同构)
# (id, 名称, 图标, 属性, op, 每级收益)  op: pct=百分比乘区 / add=点数
ALTAR_LINES = [
    ("power",  "力量祭坛", "⚔", "atk",      "pct", 1.0),
    ("vigor",  "生命祭坛", "❤", "hp",       "pct", 2.0),
    ("guard",  "守护祭坛", "🛡", "def",      "pct", 2.0),
    ("edge",   "锋锐祭坛", "🗡", "crit_dmg", "add", 1.0),
    ("swift",  "迅捷祭坛", "💨", "haste",    "add", 0.5),
    ("greed",  "贪婪祭坛", "◈", "goldfind", "add", 1.5),
]

# ---------------------------------------------------------------- 临时药剂(30 分钟增益,buff 管道;与 TS 同构)
# (id, 名称, 图标, buff键, 增幅%, 持续秒)  buff: atk=攻击 / xp=经验 / gold=金币
POTIONS = [
    ("might",   "力量药剂", "🧪", "atk",  20, 1800),
    ("wisdom",  "智慧药剂", "⚗",  "xp",   50, 1800),
    ("fortune", "贪婪药剂", "💰", "gold", 30, 1800),
]

BAL = {
    # 英雄(线性,量级小;特殊属性出生自带,不随等级涨)
    "hero_hp0": 120.0, "hero_atk0": 15.0, "hero_def0": 3.0,
    "hero_interval": 1.1, "hero_crit0": 5.0, "hero_critdmg0": 50.0,
    "hp_per_lv": 6.0, "atk_per_lv": 1.2, "def_per_lv": 0.5,
    "xp_req0": 60.0, "xp_req_p": 1.90,     # 升级需求 = 60 × lv^1.90(成型以十小时计)

    # 推进
    "kills_per_stage": 3,     # 每层击杀数(第10层为头目,1只)

    # 怪物 (t = zone*10+stage-1;属性 = base + k × t^p)
    # 怪物属性(2026-10-01 提升):装备等级落后 20~30 级将明显打不过,
    # 必须刷当前深度等级的装备才能推进
    "mob_hp0": 50.0, "mob_hp_k": 32.0, "mob_hp_p": 1.28,
    "mob_atk0": 6.8, "mob_atk_k": 2.8, "mob_atk_p": 1.05,
    "mob_def0": 3.0, "mob_def_k": 1.5, "mob_def_p": 1.0,
    "mob_interval": 1.6,
    "boss_hp": 2.6, "boss_atk": 1.15, "boss_gold": 5.0, "boss_interval": 3.2,
    "elite_hp": 3.0, "elite_atk": 1.3, "elite_gold": 2.5,
    "elite_chance": 0.10,
    # 等级压制:怪物tier超过装备最高tier 100以上,每差100 → 全属性×2(叠乘)
    "gear_gap_base": 100, "gear_gap_mult": 2.0,

    # 奖励(近线性)
    "gold0": 6.0, "gold_k": 3.0, "gold_p": 0.85,
    "xp0": 9.0, "xp_k": 3.5, "xp_p": 0.75,   # 推进层经验收入下调(低基数+平幂)
    "drop_chance": 0.16, "elite_drop": 0.35,
    "boss_drop": 1.0, "boss_stone_chance": 0.6, "boss_stone_amt": 2,

    # 装备:数值型主属性 = 槽基值 + 槽斜率 × t^p;
    # 装备幂(1.12)刻意低于怪物HP幂(1.28):纵向差随深度缓慢拉开,
    # 推进越来越慢、由质量(稀有度/强化/成就)补差 → 有节奏的墙,成型以小时计
    "item_main_p": 1.12,

    # 强化收益分段递减(每级全属性加成):0-10级 / 11-20级 / 21级起
    # 递减让质量乘数自然饱和,进度墙回归;费用多项式继续上涨即软上限
    "plus_pct_1": 8.0, "plus_pct_2": 4.0, "plus_pct_3": 1.5,
    # 强化费 = (base + t×斜率) × (1 + 0.5×plus + 0.04×plus²):低斜率多项式,
    # 替代旧 1.30^plus 指数——金币投入长期可持续,成型感来自时间而非数值爆炸
    "enhance_cost0": 25.0, "enhance_cost_t": 1.8,
    "enhance_plus_a": 0.5, "enhance_plus_b": 0.04,
    "plus_max": 100,         # 装备强化等级上限
    "reforge_stones": 3,
    # 重铸(洗脸)按品质决定洗词条数:精良/稀有=1,史诗/传说=2,神话=3
    "reforge_slots": [1, 1, 1, 2, 2, 3],
    # 幸运影响洗脸与掉落:幸运+100 → 洗出值上限+33%、高品质掉率显著提升
    "luck_reforge_k": 300.0,
    "bag_size": 40,
    "quest_daily_limit": 10,  # 每日完成悬赏上限(本地 0 点重置;与 TS 主实现同构)
    "altar_cost0": 200, "altar_cost_lv": 80, "altar_cost_lv2": 10, "altar_cost_t": 3,
    "potion_cost_k": 300,        # 药剂价格 = k × 当前层击杀金(30 分钟)
    "tower_key_extra": 10,       # 每日可加购钥匙数(免费 3 把之外)
    "tower_key_cost_k": 150,     # 第 n 把加购价格 = k × n × 击杀金
    "bag_expand_step": 10,       # 背包每次扩容格数
    "bag_expand_max": 100,       # 背包容量上限
    "bag_expand_cost0": 30000,   # 扩容费用 = cost0×n + cost_k×n²(n=第几次)
    "bag_expand_cost_k": 5000,
    "quest_reroll_max": 3,       # 每日悬赏刷新次数
    "quest_reroll_cost_k": 100,  # 第 n 次刷新价格 = k × (n+1) × 击杀金

    # 技能升级费(线性+平方项:后期费用超线性上涨,等级自然收敛——
    # 防止"无限升技能"成为另一条无衰减的金币换DPS通道)
    "skill_cost0": 60.0, "skill_cost_lv": 35.0, "skill_cost_lv2": 6.0,
    "skill_cost_t": 2.0,
    "skill_lv_max": 10,        # 金币升级技能等级上限
    # 装配槽位:4 主动 + 4 被动,按等级依次解锁
    "loadout_unlock": [1, 8, 16, 26],
    "undying_cd": 60.0,         # 不屈被动的内置冷却

    # 离线
    "offline_cap_sec": 12 * 3600,
    "offline_min_sec": 60,
    "offline_item_cap": 15,

    # 常规
    "respawn_sec": 4.0,
    # 游戏倍速档位(等级门槛):1x 始终可用,Lv10 解锁 2x,Lv30 解锁 3x
    "speed_unlock": [1, 10, 30],
    "death_row_to_farm": 2,   # 连续死亡 N 次自动转挂机
}

# 数值型主属性的每槽斜率(t^item_main_p 的系数);百分比主属性无斜率
# (SLOT_MAIN_K 已并入 MAIN_ROLLS 的 k 列)

# ---------------------------------------------------------------- 遗物系统(爬塔副本)
TOWER = {
    "keys_per_day": 3, "keys_cap": 99, "relic_slots": 4,
    "th0": 80.0, "thk": 45.0, "thp": 1.18,
    "ta0": 10.0, "tak": 3.5, "tap": 1.02,
    "td0": 5.0, "tdk": 2.0, "tdp": 1.0,
    "boss_every": 5,
    "drop_gold_mult": 2.0, "new_height_stones": 2,
}
RELIC_EFFECTS = [
    ("skill_lv_r", "单技能等级", 1.0, 2.0, "级"),   # 随机指定一个已装配主动技能
    ("cd_reduce",    "冷却缩减",  3.0, 8.0, "%"),
    ("skill_dmg",    "技能伤害",  5.0, 15.0, "%"),
    ("crit_extra",   "暴击追击",  5.0, 15.0, "%"),
    ("kill_heal",    "击杀回血",  2.0, 6.0, "%"),
    ("deathward",    "不死",      5.0, 15.0, "%"),
    ("boss_dmg_r",   "猎首",      5.0, 15.0, "%"),
    ("kill_haste",   "杀意",      5.0, 15.0, "%"),
    ("goldfind",     "聚宝",      5.0, 15.0, "%"),
]
RELIC_EFF_DEF = {e[0]: e for e in RELIC_EFFECTS}
RELIC_EFF_COUNT = [1, 1, 2, 2, 3, 3]
