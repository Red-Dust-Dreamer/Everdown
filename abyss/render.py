# -*- coding: utf-8 -*-
"""渲染层:100x30 固定画布,8 个标签页 + 弹窗"""
from .ansi import (RESET, c, pad, trunc, bar, fmt, fmt_time, dwidth)
from .combat import zone_theme, tier_of, mob_gold
from .data import (ACHIEVEMENTS, AFFIX_DEF, RARITIES, RARITY_IDX,
                   SLOTS, SLOT_NAMES, STAT_NAMES, BAL, TOWER)
from .systems import achievement_tiers, quest_desc

W, H = 100, 30
BODY_ROWS = H - 4          # 26
CARD_W = 46

TABS = ["战斗", "角色", "背包", "锻造", "技能", "悬赏·成就", "设置", "塔"]


# ================================================================ 通用小件
def _hp_color(pct):
    return "green" if pct > 0.5 else ("yellow" if pct > 0.25 else "red")


def _center(s, width):
    return pad(s, width, "center")


def _kv(label, value, lw=8, lcolor="bright_black", vcolor="white"):
    return c(label, lcolor) + " " + c(str(value), vcolor, bold=True)


# ================================================================ 头 / 尾
def _header(g):
    theme = zone_theme(g.zone)[0]
    mode = c("推进▶", "bright_yellow") if g.mode == "push" else c("挂机◎", "bright_cyan")
    spd = g.settings.get("speed", 1)
    if spd > 1:
        mode += c(" ×%d" % spd, "bright_green", bold=True)
    if g.mode == "farm":
        zone_txt = "第%d区·%d层" % (g.zone, g.stage)
    else:
        zone_txt = "第%d区·%d层" % (g.zone, g.stage)
    left = (c("⚔ 深渊挂机 ", "bright_red", bold=True)
            + c(zone_txt, "bright_white") + " " + theme + " " + mode)
    right = (c("Lv.%d" % g.level, "bright_cyan", bold=True)
             + c(" │ ", "bright_black")
             + c("◈", "bright_yellow") + c(fmt(g.gold), "bright_yellow")
             + c(" │ ", "bright_black")
             + c("✦", "bright_magenta") + c("%d" % g.stones, "bright_magenta")
             + c(" │ ", "bright_black")
             + c("⏱", "bright_black") + c(fmt_time(g.playtime), "bright_black"))
    gap = W - dwidth(left) - dwidth(right) - 2
    line = " " + left + (" " * max(1, gap)) + right + " "
    return pad(line, W)


def _tabs(g):
    parts = []
    for i, t in enumerate(TABS):
        label = " %d·%s " % (i + 1, t)
        if g.view.ui["tab"] == i:
            parts.append(c(label, "black", "bright_white", bold=True))
        else:
            parts.append(c(label, "bright_black"))
        parts.append(" ")
    row = " " + "".join(parts)
    return pad(trunc(row, W), W)


def _footer(g):
    v = g.view
    if v.toast:
        row = " " + c("» " + v.toast, "bright_green", bold=True)
    else:
        paused = c("‖ 已暂停 ", "bright_yellow") if v.ui["paused"] else ""
        autos = c("自动存档中…", "bright_black")
        row = " " + paused + autos
    return pad(trunc(row, W), W)


_HINTS = {
    0: "1-8 切页 │ F 模式 │ B 倍速 │ P 暂停 │ S 存档 │ H 帮助 │ Q 退出",
    1: "↑↓ 选择部位 │ U 强化 │ R 重铸 │ E 卸下 │ H 帮助",
    2: "↑↓ 选择 │ E 装备 │ D 分解 │ X 出售 │ A 一键出售普通/精良 │ H 帮助",
    3: "↑↓ 选择 │ U 强化(+8%主属性) │ R 重铸(3石) │ H 帮助",
    4: "↑↓ 选择 │ ←→ 装配区/主动池/被动池 │ E 装配/卸下 │ U 升级 │ H 帮助",
    5: "↑↓ 查看 │ 悬赏完成自动领取并刷新 │ H 帮助",
    6: "T 自动换装 │ J 自动出售档次 │ F 推进/挂机 │ ←→ 挂机层位 │ S 存档 │ R 重置 │ Q 退出",
    7: "Enter 爬塔 │ ↑↓ 选槽 │ E 卸遗物 │ H 帮助",
}


def _hints(g):
    return pad(" " + c(_HINTS.get(g.view.ui["tab"], ""), "bright_black"), W)


# ================================================================ 战斗页
def _bump_off(timer, ttl=0.24):
    """互撞动画位移:前半程 3 格,后半程 1 格,结束归位"""
    if timer <= 0:
        return 0
    return 3 if timer > ttl / 2 else 1


def _spinner(g):
    """"战斗中"流动指示:» 三态轮转,基于游戏时间(暂停时自然冻结)"""
    phase = int(g.time * 4) % 3
    frames = ["»  ", " » ", "  »"]
    return c(" 战斗中", "bright_black") + c(frames[phase], "bright_yellow", bold=True)


def _card(g, hero_side):
    """返回 8 行:名字 / 画x5 / 血条 / 数值。攻击时向对方顶一下(互撞)。"""
    v = g.view
    lines = []
    if hero_side:
        h = g.hero
        dead = g.respawn_timer > 0
        off = _bump_off(v.hero_bump)
        from .skills import class_of
        cls = class_of(g)
        name = (c(" %s %s " % (cls["icon"], cls["name"]), cls["color"], bold=True)
                + c("Lv.%d" % g.level, cls["color"]))
        if dead:
            name += c("  (复活中 %ds)" % int(g.respawn_timer + 0.999), "bright_red")
        lines.append(pad(name, CARD_W - off, "center") + " " * off)
        art_color = cls["color"] if not dead else "bright_black"
        for a in ["    /\\   ⌐■■¬ ", "   /  \\  |◔-◟|", "  | ⚔ | /|▂▂|\\ ",
                  "  |▂▂▂/  |▂▂▂| ", "  /▃▃ \\  ▂▂  ▂▂"]:
            lines.append(pad(c(a, art_color), CARD_W - off, "center") + " " * off)
        pct = h["hp"] / h["max_hp"] if h["max_hp"] else 0
        lines.append(pad(bar(h["hp"], h["max_hp"], 40, _hp_color(pct)),
                         CARD_W - off, "center") + " " * off)
        lines.append(pad(c("%s / %s" % (fmt(h["hp"]), fmt(h["max_hp"])), _hp_color(pct)),
                         CARD_W - off, "center") + " " * off)
        xp_line = c("EXP ", "bright_black") + bar(g.xp, g.xp_req(), 34, "cyan")
        lines.append(pad(xp_line, CARD_W - off, "center") + " " * off)
        return lines[:8]

    m = g.monster
    if m is None:
        lines.append(pad(c("( 敌人蓄势待发… )", "bright_black"), CARD_W, "center"))
        for _ in range(5):
            lines.append(" " * CARD_W)
        lines.append(pad(c("…", "bright_black"), CARD_W, "center"))
        lines.append(" " * CARD_W)
        return lines[:8]
    off = _bump_off(v.mob_bump)
    flash = v.mob_flash > 0
    tag = ""
    if m.boss:
        tag = c(" ♛ 塔主" if g.in_tower else " ♛ 头目", "bright_yellow", bold=True)
    elif m.elite:
        tag = c(" ★ 精英", "bright_green", bold=True)
    mname = m.name
    if g.in_tower and not mname.startswith("塔·"):
        mname = "塔·" + mname
    name = c(" %s " % mname, m.color, bold=(m.boss or flash)) + tag
    lines.append(" " * off + pad(name, CARD_W - off, "center"))
    for art_line in m.art:
        colored = c(art_line, m.color, bold=flash)
        lines.append(" " * off + pad(colored, CARD_W - off, "center"))
    pct = m.hp_pct()
    lines.append(" " * off + pad(bar(m.hp, m.max_hp, 40, _hp_color(pct)), CARD_W - off, "center"))
    lines.append(" " * off + pad(c("%s / %s  Lv.%d" % (fmt(m.hp), fmt(m.max_hp), m.tier),
                                   _hp_color(pct)), CARD_W - off, "center"))
    info = (c("攻击 ", "bright_black") + c(fmt(m.atk), "red")
            + c("  防御 ", "bright_black") + c(fmt(m.def_), "blue"))
    lines.append(" " * off + pad(info, CARD_W - off, "center"))
    return lines[:8]


def _tab_battle(g):
    rows = []
    v = g.view
    if g.in_tower:
        banner = (c("═", "bright_magenta") * 3
                  + c(" 深渊塔 · 第 %d 层 " % g.tower_floor_sel, "bright_magenta", bold=True)
                  + c("═", "bright_magenta") * 3)
    else:
        theme, mobs, boss, tcolor = zone_theme(g.zone)
        banner = c("═", tcolor) * 3 + c(" 第 %d 区 · 第 %d 层 · %s " % (g.zone, g.stage, theme),
                                        tcolor, bold=True) + c("═", tcolor) * 3
    rows.append(_center(banner, W - 14) + _spinner(g))

    hero_lines = _card(g, True)
    mon_lines = _card(g, False)
    clash = (v.hero_bump > 0 or v.mob_bump > 0)
    divider = c("✦", "bright_yellow", bold=True) if clash else c("│", "bright_black")
    for hl, ml in zip(hero_lines, mon_lines):
        rows.append(pad("  " + hl + " " + divider + " " + ml + " ", W))
    rows.append(" " * W)

    # 伤害飘字
    if g.view.floaters:
        fl = "  ".join(c(f["text"], f["color"], bold=True) for f in g.view.floaters[-5:])
        rows.append(_center(fl, W))
    else:
        rows.append(" " * W)

    # 技能条(装配中的主动技能)
    chips, cds = [], []
    from .data import ACTIVE_DEF
    from . import skills as _S
    n_slots = min(4, g.loadout_slots())
    for i in range(n_slots):
        sid = g.loadout["active"][i] if i < len(g.loadout["active"]) else None
        if not sid:
            chips.append(pad(c(" (空) ", "bright_black"), 23))
            cds.append(pad(c("技能页(5)装配", "bright_black"), 23))
            continue
        d = ACTIVE_DEF[sid]
        lv = _S.eff_lv(g, sid)
        left = g.skill_cd.get(sid, 0)
        if left > 0:
            chips.append(pad(c(" %s %s " % (d["icon"], d["name"]), "bright_black")
                             + c("%.1fs" % left, "yellow"), 23))
            cds.append(pad(c("冷却" + "░" * max(0, int(left / d["cd"] * 6)), "yellow"), 23))
        else:
            chips.append(pad(c(" %s %s " % (d["icon"], d["name"]), d["color"], bold=True)
                             + c("Lv.%d" % lv, d["color"]), 23))
            cds.append(pad(c("● 就绪", d["color"]), 23))
    while len(chips) < 4:
        chips.append(pad("", 23))
        cds.append(pad("", 23))
    rows.append(" " + " ".join(chips))
    rows.append(" " + " ".join(cds))
    rows[-2] = pad(rows[-2], W)
    rows[-1] = pad(rows[-1], W)

    # 英雄属性
    h = g.hero
    rows.append(pad("  " + _kv("攻击", fmt(h["atk"])) + "  " + _kv("防御", fmt(h["def"]))
                   + "  " + _kv("生命", fmt(h["max_hp"])) + "  "
                   + _kv("攻速", "+%.0f%%" % h["haste"]) + " ", W))
    rows.append(pad("  " + _kv("暴击", "%.0f%%" % h["crit"]) + "  "
                    + _kv("暴伤", "+%.0f%%" % h["crit_dmg"]) + "  "
                    + _kv("吸血", "%.1f%%" % h["lifesteal"]) + "  "
                    + _kv("金币", "+%.0f%%" % h["goldfind"]) + " ", W))

    dps = g.theoretical_dps()
    kt = g.ema_kill if g.ema_kill else 0
    t = tier_of(g.zone, g.stage)
    gph = mob_gold(t) * (1 + h["goldfind"] / 100.0) * 3600 / max(0.5, kt) if kt else 0
    rows.append(pad("  " + c("⚡ 理论DPS ", "bright_black") + c(fmt(dps), "bright_white", bold=True)
                    + c("   ⏱ 击杀用时 ", "bright_black") + c("~%.1fs" % (kt or 0), "bright_white")
                    + c("   ◈ 预计 ", "bright_black") + c(fmt(gph) + "/小时", "bright_yellow")
                    + " ", W))

    # 战斗记录(边框按 100 宽精确拼接)
    rows.append("  " + c("┌─ 战斗记录 " + "─" * 85 + "┐", "bright_black"))
    tail = list(g.view.logbuf)[-8:]
    while len(tail) < 8:
        tail.insert(0, ("", ""))
    for text, color in tail:
        rows.append("  " + c("│ ", "bright_black") + pad(trunc(c(text, color), 93), 93)
                    + c(" │", "bright_black"))
    rows.append("  " + c("└" + "─" * 96 + "┘", "bright_black"))

    while len(rows) < BODY_ROWS:
        rows.append(" " * W)
    return rows[:BODY_ROWS]


# ================================================================ 角色页
def _tab_char_layout(g):
    """角色页:左侧装备列表,右侧详情"""
    sel = g.view.ui["char_sel"]
    left_w, right_w = 50, 44
    left = []
    from .skills import class_of
    cls = class_of(g)
    left.append(" " + c("▌装备", "bright_white", bold=True)
                + c(" %s %s " % (cls["icon"], cls["name"]), cls["color"], bold=True)
                + c(" ↑↓ 选择部位", "bright_black"))
    for i, (slot, name, *_r) in enumerate(SLOTS):
        it = g.equip.get(slot)
        marker = c("▸", "bright_yellow") if i == sel else " "
        slot_name = pad(name, 4, "center")
        if it:
            body = it.display(width=36)
        else:
            body = c("(空)", "bright_black")
        line = " %s %s %s" % (marker, c(slot_name, "bright_white"), body)
        left.append(pad(trunc(line, left_w), left_w))
    left.append(" " + c("▌遗物", "bright_white", bold=True)
                + c(" 深渊塔掉落 · 自动装入空槽", "bright_black"))
    for i in range(4):
        r = g.relics[i] if i < len(g.relics) else None
        label = c("遗物%d:" % (i + 1), "bright_black")
        if r is None:
            body = c("(空)", "bright_black")
        else:
            body = r.display() + c(" · %d效果" % len(r.effects), "bright_black")
        left.append(pad(trunc("  %s %s" % (label, body), left_w), left_w))
    h = g.hero
    left.append(" " + c("▌属性总览", "bright_white", bold=True))
    left.append(pad("  " + "  ".join([_kv("攻击", fmt(h["atk"]), 4),
                                      _kv("防御", fmt(h["def"]), 4),
                                      _kv("生命", fmt(h["max_hp"]), 4)]), left_w))
    left.append(pad("  " + "  ".join([_kv("暴击", "%.0f%%" % h["crit"], 4),
                                      _kv("暴伤", "+%.0f%%" % h["crit_dmg"], 4),
                                      _kv("攻速", "+%.0f%%" % h["haste"], 4)]), left_w))
    left.append(pad("  " + "  ".join([_kv("吸血", "%.1f%%" % h["lifesteal"], 4),
                                      _kv("幸运", "+%.0f" % h.get("luck", 0), 4),
                                      _kv("评分", fmt(sum(i.score() for i in g.equip.values())), 4)]), left_w))
    while len(left) < BODY_ROWS:
        left.append(" " * left_w)

    right = []
    slot = SLOTS[sel][0]
    it = g.equip.get(slot)
    right.append(" " + c("▌详情", "bright_white", bold=True))
    if it:
        right.append(" " + it.display())
        right.append(" " + c("%s · Lv.%d · %s" % (SLOT_NAMES[slot], it.tier,
                                                  RARITIES[RARITY_IDX[it.rarity]][1]),
                              it.rarity_color()))
        right.append("")
        for ln in it.stat_lines():
            right.append(" " + trunc(ln, right_w - 2))
        right.append("")
        right.append(" " + c("评分 ", "bright_black") + c(fmt(it.score()), "bright_yellow", bold=True))
        right.append(" " + c("强化 ", "bright_black") + c("+%d" % it.plus, "bright_yellow")
                     + c("  (U 强化费用 %s)" % fmt(it.enhance_cost()), "bright_black"))
        rc = it.reforge_count()
        right.append(" " + c("洗练 ", "bright_black") + c("%d条/次" % rc, "bright_magenta")
                     + c("  (R 洗词条,幸运+%.0f提升值域)" % g.hero.get("luck", 0), "bright_black"))
        right.append(" " + c("出售 ", "bright_black") + c("%s 金币" % fmt(it.sell_price()), "bright_yellow"))
    else:
        right.append(" " + c("该部位没有装备,等待掉落…", "bright_black"))
    while len(right) < BODY_ROWS:
        right.append(" " * right_w)

    rows = []
    for l, r in zip(left, right):
        rows.append(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W))
    return rows


# ================================================================ 背包页
BAG_PAGE = 12

def _tab_bag(g):
    sel = g.view.ui["bag_sel"]
    page = sel // BAG_PAGE
    left_w, right_w = 52, 42
    left = []
    left.append(" " + c("▌背包", "bright_white", bold=True)
                + c(" %d/%d" % (len(g.bag), g.bag_cap()), "bright_black")
                + pad(c("第%d页" % (page + 1), "bright_black"), 10, "right"))
    start = page * BAG_PAGE
    items = g.bag[start:start + BAG_PAGE]
    for i in range(BAG_PAGE):
        idx = start + i
        if idx >= len(g.bag):
            left.append(" " * left_w)
            continue
        it = g.bag[idx]
        marker = c("▸", "bright_yellow") if idx == sel else " "
        line = " %s %s %s" % (marker, it.display(width=34), c(fmt(it.score()), "bright_black"))
        left.append(pad(trunc(line, left_w), left_w))

    right = []
    right.append(" " + c("▌详情 / 对比", "bright_white", bold=True))
    if g.bag:
        it = g.bag[sel]
        right.append(" " + it.display())
        right.append(" " + c("%s · Lv.%d · 评分%s" % (SLOT_NAMES[it.slot], it.tier, fmt(it.score())),
                              it.rarity_color()))
        right.append("")
        for ln in it.stat_lines()[:8]:
            right.append(" " + trunc(ln, right_w - 2))
        cur = g.equip.get(it.slot)
        right.append("")
        if cur:
            delta = it.score() - cur.score()
            arrow = c("▲ 优于当前 %s" % fmt(delta), "bright_green") if delta > 0 else \
                    c("▼ 劣于当前 %s" % fmt(-delta), "bright_red")
            lv_gap = it.tier - cur.tier
            lv_txt = (c("  Lv%+d" % lv_gap, "bright_green" if lv_gap > 0 else "bright_black")
                      if lv_gap else c("  同级", "bright_black"))
            right.append(" " + c("对比: ", "bright_black")
                         + c("Lv.%d " % cur.tier, "bright_black")
                         + c(cur.name, cur.rarity_color())
                         + c(" +%d" % cur.plus if cur.plus else "", "bright_yellow")
                         + lv_txt)
            right.append(" " + arrow + c("   (E 穿上)", "bright_black"))
        else:
            right.append(" " + c("该部位为空,直接穿上", "bright_green"))
        dgold, dstones = it.dismantle()
        right.append(" " + c("出售 ◈%s" % fmt(it.sell_price()), "bright_yellow")
                     + c("  │  分解 ◈" + fmt(dgold)
                         + ((" ✦%d" % dstones) if dstones else ""), "bright_black"))
    else:
        right.append(" " + c("背包空空如也,去刷怪吧。", "bright_black"))
    while len(right) < BODY_ROWS:
        right.append(" " * right_w)

    rows = []
    for i in range(BODY_ROWS):
        l = left[i] if i < len(left) else " " * left_w
        r = right[i] if i < len(right) else " " * right_w
        rows.append(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W))
    return rows


# ================================================================ 锻造页
def _tab_forge(g):
    sel = g.view.ui["forge_sel"]
    left_w, right_w = 50, 44
    left = []
    left.append(" " + c("▌锻造台", "bright_white", bold=True)
                + c("  ✦%d 重铸石" % g.stones, "bright_magenta"))
    for i, (slot, name, *_r) in enumerate(SLOTS):
        it = g.equip.get(slot)
        marker = c("▸", "bright_yellow") if i == sel else " "
        slot_name = pad(name, 4, "center")
        if it:
            plus = c("+%d" % it.plus, "bright_yellow") if it.plus else c(" +0", "bright_black")
            cost = fmt(it.enhance_cost())
            affordable = g.gold >= it.enhance_cost()
            cost_col = "bright_yellow" if affordable else "bright_black"
            line = " %s %s %s %s %s" % (marker, c(slot_name, "bright_white"),
                                        it.display(width=24), c(plus, "bright_yellow"),
                                        c("◈" + cost, cost_col))
        else:
            line = " %s %s %s" % (marker, c(slot_name, "bright_white"), c("(空)", "bright_black"))
        left.append(pad(trunc(line, left_w), left_w))
    left.append("")
    left.append(" " + c("U 强化:+8%/级(11级起+4%,21级起+2%)", "bright_black"))
    left.append(" " + c("R 洗练:3重铸石,按品质洗N条(精稀1/史传2/神3)", "bright_black"))
    left.append(" " + c("   幸运词缀提升掉落品质与洗出值上限", "bright_black"))
    while len(left) < BODY_ROWS:
        left.append(" " * left_w)

    right = []
    slot = SLOTS[sel][0]
    it = g.equip.get(slot)
    right.append(" " + c("▌强化预览", "bright_white", bold=True))
    if it:
        right.append(" " + it.display())
        right.append(" " + c("当前 +%d → +%d" % (it.plus, min(it.plus + 1, BAL["plus_max"])), "bright_yellow"))
        right.append("")
        cur_mult = it.mult()
        from .items import plus_bonus
        nxt_mult = RARITIES[RARITY_IDX[it.rarity]][3] * (1 + plus_bonus(it.plus + 1))
        for aid, base in [(it._main_stat(), it.main_val)] + it.affixes:
            a = AFFIX_DEF[aid]
            cv = base * cur_mult
            nv = base * nxt_mult
            if a[5]:
                right.append(" " + trunc(c("%s " % a[1], "bright_black")
                                         + c("%.1f%%" % cv, "white")
                                         + c(" → ", "bright_black")
                                         + c("+%.1f%%" % nv, "bright_green"), right_w - 2))
            else:
                right.append(" " + trunc(c("%s " % a[1], "bright_black")
                                         + c(fmt(cv), "white") + c(" → ", "bright_black")
                                         + c(fmt(nv), "bright_green"), right_w - 2))
        right.append("")
        right.append(" " + c("费用 ", "bright_black") + c("◈ " + fmt(it.enhance_cost()), "bright_yellow")
                     + c("  (持有 %s)" % fmt(g.gold), "bright_black"))
        if it.plus >= BAL["plus_max"]:
            right.append(" " + c("已达到强化上限!", "bright_red"))
    else:
        right.append(" " + c("该部位没有装备。", "bright_black"))
    while len(right) < BODY_ROWS:
        right.append(" " * right_w)

    rows = []
    for i in range(BODY_ROWS):
        l = left[i] if i < len(left) else " " * left_w
        r = right[i] if i < len(right) else " " * right_w
        rows.append(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W))
    return rows


# ================================================================ 技能页
def _skill_row(g, d, marker, width, zone_sel):
    from . import skills as S
    lv = S.eff_lv(g, d["id"])
    base_lv = g.skill_lv.get(d["id"], 1)
    locked = g.level < d["unlock"]
    if locked:
        body = c("%s 🔒 Lv.%d 解锁" % (d["name"], d["unlock"]), "bright_black")
    else:
        eq = "●" if d["id"] in g.loadout["active"] + g.loadout["passive"] else " "
        icon_part = c(" %s " % d["icon"], d["color"]) if "icon" in d else " "
        cd = ("CD%ds" % d["cd"]) if "cd" in d else "被动"
        body = (c(eq, "bright_green")
                + icon_part
                + c(d["name"], d.get("color", "white"), bold=zone_sel)
                + c(" Lv.%d" % lv, "bright_yellow")
                + c("  %s" % cd, "bright_black")
                + (c("(自+%d)" % base_lv, "bright_black") if base_lv > 1 else ""))
    return pad(trunc("%s %s" % (marker, body), width), width)


def _tab_skills(g):
    from . import skills as S
    from .data import ACTIVE_SKILLS, PASSIVE_SKILLS, ACTIVE_DEF, PASSIVE_DEF, BAL
    from .skills import skill_desc
    v = g.view
    ui = v.ui
    zone = ui.get("skill_zone", 1)      # 0装配区 1主动池 2被动池
    sel = ui.get("skill_sel", 0)
    slot = ui.get("skill_slot", 0)
    rows = []
    cls = S.class_of(g)
    rows.append(" " + c("▌技能", "bright_white", bold=True)
                + c(" · %s %s " % (cls["icon"], cls["name"]), cls["color"], bold=True)
                + c("  ←→ 切区 │ E 装配/卸下 │ U 升级", "bright_black"))

    # ---- 装配区(zone=0 可选中) ----
    def slot_row(idx, sid, label):
        mark = c("▸", "bright_yellow") if (zone == 0 and slot == idx) else " "
        if sid:
            d = ACTIVE_DEF.get(sid) or PASSIVE_DEF.get(sid)
            return _skill_row(g, d, "%s%s" % (mark, label), W - 2,
                              zone == 0 and slot == idx)
        n_unlock = g.loadout_slots()
        if idx < n_unlock:
            return pad(trunc("%s%s %s" % (mark, label, c("(空 — 在池中选技能装配)", "bright_black")), W - 2), W - 2)
        th = BAL["loadout_unlock"][idx] if idx < len(BAL["loadout_unlock"]) else 99
        return pad("%s%s %s" % (mark, label, c("🔒 Lv.%d" % th, "bright_black")), W - 2)

    rows.append(" " + c("── 装配 · 主动 ──", "bright_cyan"))
    for i in range(4):
        rows.append(" " + slot_row(i, g.loadout["active"][i] if i < len(g.loadout["active"]) else None, "%d." % (i + 1)))
    rows.append(" " + c("── 装配 · 被动 ──", "bright_magenta"))
    for i in range(4):
        rows.append(" " + slot_row(4 + i, g.loadout["passive"][i] if i < len(g.loadout["passive"]) else None, "%d." % (i + 1)))
    rows.append("")

    # ---- 池(zone=1 主动 / zone=2 被动) ----
    pool = [s for s in (ACTIVE_SKILLS if zone == 1 else PASSIVE_SKILLS)
            if s["cls"] == g.class_id]
    sel = max(0, min(sel, len(pool) - 1))
    title = "主动技能池" if zone == 1 else "被动技能池"
    rows.append(" " + c("▌%s" % title, "bright_white", bold=True)
                + c("  %d/10" % len([s for s in pool if g.level >= s["unlock"]]), "bright_black"))
    if pool:
        d = pool[sel]
        rows.append(" " + trunc(c("  ", "") + skill_desc(g, d), W - 2))
        cost = g.skill_cost(d["id"])
        afford = g.gold >= cost
        rows.append(" " + c("  升级 ◈" + fmt(cost), "bright_yellow" if afford else "bright_black")
                    + c("  [U]" if g.level >= d["unlock"] else "  [未解锁]", "bright_black"))
    rows.append("")
    for i, d in enumerate(pool):
        mark = c("▸", "bright_yellow") if (zone in (1, 2) and i == sel) else " "
        rows.append(" " + _skill_row(g, d, mark, W - 2, zone in (1, 2) and i == sel))
    while len(rows) < BODY_ROWS:
        rows.append(" " * W)
    return pad_rows(rows)


def pad_rows(rows):
    return [pad(trunc(r, W), W) for r in rows]


# ================================================================ 悬赏/成就
def _tab_quests(g):
    left_w, right_w = 46, 46
    left = []
    left.append(" " + c("▌悬赏任务(完成自动领取)", "bright_white", bold=True))
    left.append("")
    for q in g.quests:
        left.append("  " + c("◆ " + quest_desc(q), "bright_cyan"))
        left.append("    " + bar(q["progress"], q["target"], 26, "cyan")
                    + c(" %d/%d" % (min(q["progress"], q["target"]), q["target"]), "bright_black"))
        rw = c("◈" + fmt(q["gold"]), "bright_yellow")
        if q["stones"]:
            rw += c("  ✦%d" % q["stones"], "bright_magenta")
        left.append("    " + c("奖励 ", "bright_black") + rw)
        left.append("")
    left.append("  " + c("已完成悬赏:%d" % g.stats.get("quest_done", 0), "bright_black"))
    while len(left) < BODY_ROWS:
        left.append(" " * left_w)

    right = []
    right.append(" " + c("▌成就(永久加成,自动生效)", "bright_white", bold=True))
    right.append("")
    for aid, name, metric, thresholds, stat, per in ACHIEVEMENTS:
        val = g.stats.get(metric, 0)
        tiers, total = achievement_tiers(aid, val)
        stars = c("★" * tiers, "bright_yellow") + c("☆" * (total - tiers), "bright_black")
        nxt = next((t for t in thresholds if val < t), None)
        prog = c("%s/%s" % (fmt(val), fmt(nxt) if nxt else "MAX"), "bright_black")
        stat_name = STAT_NAMES.get(stat, stat)
        if stat == "crit":
            buff_txt = "暴击 +%d点" % (per * tiers)
        else:
            buff_txt = "%s +%d%%" % (stat_name, per * tiers)
        right.append("  " + c(name, "bright_white") + " " + stars + " " + prog)
        right.append("    " + c(buff_txt, "bright_green") if tiers else
                     "    " + c("未达成", "bright_black"))
    right.append("")
    right.append("  " + c("成就加成会随里程碑自动提升。", "bright_black"))
    while len(right) < BODY_ROWS:
        right.append(" " * right_w)

    rows = []
    for i in range(BODY_ROWS):
        l = left[i] if i < len(left) else " " * left_w
        r = right[i] if i < len(right) else " " * right_w
        rows.append(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W))
    return rows


# ================================================================ 设置页
def _tab_settings(g):
    rows = []
    s = g.settings
    rows.append("  " + c("▌设置", "bright_white", bold=True))
    rows.append("")
    auto_eq = c("开", "bright_green") if s.get("auto_equip") else c("关", "bright_red")
    rows.append("  " + c("▸ 自动换装  ", "bright_white") + auto_eq + c("   [T] 新掉落评分更高时自动穿上", "bright_black"))
    idx = s.get("auto_sell_idx", -1)
    names = ["关闭", "出售「普通」及以下", "出售「精良」及以下", "出售「稀有」及以下",
             "出售「史诗」及以下", "出售「传说」及以下"]
    rows.append("  " + c("▸ 掉落自动出售  ", "bright_white") + c(names[idx + 1], "bright_cyan")
                + c("   [J] 切换档次", "bright_black"))
    mode = c("推进模式 ▶", "bright_yellow") if g.mode == "push" else c("挂机模式 ◎", "bright_cyan")
    rows.append("  " + c("▸ 战斗模式  ", "bright_white") + mode + c("   [F] 切换", "bright_black"))
    farm = c("第 %d 层" % g.farm_stage, "bright_white")
    rows.append("  " + c("▸ 挂机层位  ", "bright_white") + farm + c("   [←→] 调整(仅挂机模式生效)", "bright_black"))
    spd = g.settings.get("speed", 1)
    spd_txt = c("×%d" % spd, "bright_green", bold=True) if spd > 1 else c("×1", "bright_black")
    nxt_th = next((th for th in BAL["speed_unlock"] if g.level < th), None)
    lock_txt = c("   (Lv%d 解锁下一档)" % nxt_th, "bright_black") if nxt_th else ""
    rows.append("  " + c("▸ 游戏速度  ", "bright_white") + spd_txt
                + c("   [B] 切换", "bright_black") + lock_txt)
    rows.append("")
    rows.append("  " + c("▸ 立即存档   [S]", "bright_white"))
    if g.view.ui["confirm_reset"]:
        rows.append("  " + c("▸ 确认清空全部进度?  [Y]确认 / [N]取消", "bright_red", bold=True))
    else:
        rows.append("  " + c("▸ 重置存档   [R]", "bright_red"))
    rows.append("  " + c("▸ 退出游戏(自动存档)   [Q]", "bright_white"))
    rows.append("")
    rows.append("  " + c("─" * 44, "bright_black"))
    rows.append("  " + c("击杀 %d · 头目 %d · 死亡 %d · 强化 %d · 重铸 %d" % (
        g.stats.get("kills", 0), g.stats.get("boss_kills", 0), g.stats.get("deaths", 0),
        g.stats.get("enhance_total", 0), g.stats.get("reforge_total", 0)), "bright_black"))
    rows.append("  " + c("累计金币 %s · 最深到达 第%d区" % (
        fmt(g.stats.get("gold_earned", 0)), g.stats.get("max_zone", 1)), "bright_black"))
    while len(rows) < BODY_ROWS:
        rows.append(" " * W)
    return pad_rows(rows)


# ================================================================ 塔页
def _tab_tower(g):
    """塔页:钥匙/最高层 / Enter 爬塔 / 遗物4槽"""
    ui = g.view.ui
    rows = []
    reach = g.tower["max_floor"] + 1           # 下一层(爬塔起点)
    slot_sel = ui.get("tower_sel", 0) % 4

    rows.append(" " + c("▌深渊塔", "bright_white", bold=True)
                + c(" │ ", "bright_black")
                + c("钥匙 ×%d" % g.tower["keys"], "bright_yellow", bold=True)
                + c(" │ ", "bright_black")
                + c("最高第%d层" % g.tower["max_floor"], "bright_cyan", bold=True)
                + c(" │ ", "bright_black")
                + c("Enter 爬塔(连胜连爬)", "bright_black")
                + (c(" │ 爬塔中·第%d层" % g.tower_floor_sel, "bright_magenta", bold=True)
                   if g.in_tower else ""))
    rows.append(" " + c("─" * 64, "bright_black"))
    rows.append("")

    boss = reach % TOWER["boss_every"] == 0
    rows.append(" " + c("[下一层] ", "bright_black")
                + c("第 %d 层" % reach, "bright_white", bold=True)
                + (c(" 头目!", "bright_yellow", bold=True) if boss else "")
                + c(" (每%d层一个头目)" % TOWER["boss_every"], "bright_black"))
    rows.append(" " + c("第1层 ", "bright_black")
                + bar(g.tower["max_floor"], max(reach, 1), 44, "cyan")
                + c(" 第%d层" % reach, "bright_black")
                + c("  ▸ 已爬到 第%d层" % g.tower["max_floor"], "bright_cyan", bold=True))
    rows.append("")

    rows.append(" " + c("▌遗物", "bright_white", bold=True)
                + c(" 通关必得 · 自动装入空槽", "bright_black")
                + c("  │  ↑↓ 选槽 E 卸下", "bright_black"))
    for i in range(4):
        r = g.relics[i] if i < len(g.relics) else None
        marker = c("▸", "bright_yellow") if i == slot_sel else " "
        label = c("遗物%d:" % (i + 1), "bright_black")
        if r is None:
            body = c("(空)", "bright_black")
        else:
            effs = "  ".join(ln.strip() for ln in r.effect_lines())
            body = r.display() + "  " + c(effs, "white")
        line = " %s %s %s" % (marker, label, body)
        rows.append(pad(trunc(line, W - 2), W - 2))

    rows.append("")
    rows.append(" " + c("▌规则", "bright_white", bold=True))
    rows.append("  " + c("· 每日 0 点刷新钥匙(每天 %d 把,可囤积,上限 %d)" % (
        TOWER["keys_per_day"], TOWER["keys_cap"]), "bright_black"))
    rows.append("  " + c("· 进塔消耗 1 把钥匙:胜利必得遗物与金币,战败仅耗钥匙", "bright_black"))
    rows.append("  " + c("· 首次到达新高度 +%d 重铸石;头目层遗物保底稀有" % TOWER["new_height_stones"],
                 "bright_black"))
    while len(rows) < BODY_ROWS:
        rows.append(" " * W)
    return pad_rows(rows)


# ================================================================ 弹窗
def _modal_class(g):
    """新档职业选择:三选一"""
    from .data import CLASSES
    rows = []
    rows.append(_center(c("⚔ 选择你的职业 ⚔", "bright_yellow", bold=True), W))
    rows.append("")
    keys = {"warrior": "1", "mage": "2", "ranger": "3"}
    for cid, cls in CLASSES.items():
        b = cls["base"]
        line = (c(" [%s] " % keys[cid], "bright_white", bold=True)
                + c("%s %s " % (cls["icon"], cls["name"]), cls["color"], bold=True)
                + c(" — " + cls["desc"], "white"))
        rows.append(_center(line, W))
        rows.append(_center(c("生命×%.2f  攻击×%.2f  防御×%.2f  攻速 %.1fs/刀" % (
            b["hp"], b["atk"], b["def"], cls["interval"]), "bright_black"), W))
        rows.append(_center(c("技能池:10 主动 + 10 被动,自选装配 4+4", "bright_black"), W))
        rows.append("")
    rows.append(_center(c("按 1 / 2 / 3 选择职业(自动装配初始技能)", "bright_cyan"), W))
    while len(rows) < BODY_ROWS:
        rows.append(" " * W)
    return pad_rows(rows)


def _modal_box(title, lines):
    """居中弹窗,占满 body 区域"""
    inner_w = 62
    out = []
    out.append(_center(c("┌" + "─" * (inner_w + 2) + "┐", "bright_white"), W))
    out.append(_center(c("│ ", "bright_white") + pad(c(title, "bright_yellow", bold=True), inner_w, "center")
                       + c(" │", "bright_white"), W))
    out.append(_center(c("├" + "─" * (inner_w + 2) + "┤", "bright_white"), W))
    body = lines[:BODY_ROWS - 5]
    for ln in body:
        out.append(_center(c("│ ", "bright_white") + pad(trunc(ln, inner_w), inner_w)
                           + c(" │", "bright_white"), W))
    while len(out) < BODY_ROWS - 1:
        out.append(_center(c("│ " + " " * inner_w + " │", "bright_white"), W))
    out.append(_center(c("└" + "─" * (inner_w + 2) + "┘", "bright_white"), W))
    return out[:BODY_ROWS]


def _modal_help(g):
    lines = [
        c("全局按键", "bright_cyan"),
        "  1-8  切换页面      P 暂停/继续      S 立即存档",
        "  H    帮助(本页)   Q 退出并自动存档",
        "",
        c("战斗页", "bright_cyan"),
        "  F    推进/挂机模式切换(挂机=停在当前层反复刷)",
        "",
        c("塔页(8)", "bright_cyan"),
        "  Enter 爬塔:从最高层+1 开始,连胜连爬(每层1把钥匙)",
        "  ↑↓ 选遗物槽  E 卸下 · 通关必得遗物,战败仅耗钥匙",
        "",
        c("背包页", "bright_cyan"),
        "  E 装备选中物品   D 分解(金币,史诗+额外重铸石)",
        "  X 出售   A 一键出售全部 普通/精良",
        "",
        c("锻造页/角色页", "bright_cyan"),
        "  U 花金币强化主属性(收益递减:8%/4%/2% 每级;词条不吃强化)",
        "  R 花 3 重铸石重掷词缀",
        "",
        c("技能页", "bright_cyan"),
        "  ←→ 切换 装配区/主动池/被动池  E 装配/卸下  U 花金币升级",
        "  每职业 10 主动 + 10 被动,自选装配 4+4(槽位随等级解锁)",
        "  装备词缀「全技能等级」可为装配技能提供额外等级",
        "",
        c("小提示", "bright_green"),
        "  · 卡关就切挂机模式刷装备和强化,再回来推进",
        "  · 头目必掉稀有+,精英掉率也更高",
        "  · 退出后再次启动会结算离线收益(最长12小时)",
    ]
    return _modal_box("按任意键关闭帮助 · H", lines)


def _modal_offline(g):
    r = g.pending_offline
    if not r:
        return None
    items = r.get("items", [])
    item_lines = [it.display() for it in items[:6]]
    if len(items) > 6:
        item_lines.append(c("…等共 %d 件" % len(items), "bright_black"))
    lines = [
        c("离开时长:", "bright_black") + c(fmt_time(r["sec"]), "bright_white", bold=True),
        c("预计击杀:", "bright_black") + c("%d 只" % r["kills"], "bright_white"),
        c("金币收益:", "bright_black") + c("◈ " + fmt(r["gold"]), "bright_yellow"),
        c("经验收益:", "bright_black") + c(fmt(r["xp"]), "bright_cyan"),
        c("装备掉落:", "bright_black") + (c("%d 件" % len(items), "bright_magenta") if items else c("无", "bright_black")),
    ] + ["  " + s for s in item_lines]
    lines.append("")
    lines.append(c("按任意键继续冒险", "bright_green", bold=True))
    return _modal_box("☾ 离线收益结算 ☽", lines)


# ================================================================ 主入口
def render_frame(g, term_w, term_h):
    if term_w < W or term_h < H:
        lines = [" "] * max(1, term_h)
        msg1 = c("请把终端窗口调大到至少 100×30", "bright_yellow", bold=True)
        msg2 = c("当前 %d×%d — 拖动窗口边缘即可调整" % (term_w, term_h), "bright_black")
        mid = term_h // 2
        if 0 <= mid - 1 < term_h:
            lines[mid - 1] = pad(msg1, term_w, "center")
        if 0 <= mid < term_h:
            lines[mid] = pad(msg2, term_w, "center")
        return "\r\n".join(lines)

    tab = g.view.ui["tab"]
    if g.class_id is None:
        body = _modal_class(g)
    elif g.pending_offline:
        body = _modal_offline(g)
    elif g.view.ui["help"]:
        body = _modal_help(g)
    elif tab == 0:
        body = _tab_battle(g)
    elif tab == 1:
        body = _tab_char_layout(g)
    elif tab == 2:
        body = _tab_bag(g)
    elif tab == 3:
        body = _tab_forge(g)
    elif tab == 4:
        body = _tab_skills(g)
    elif tab == 5:
        body = _tab_quests(g)
    elif tab == 7:
        body = _tab_tower(g)
    else:
        body = _tab_settings(g)

    while len(body) < BODY_ROWS:
        body.append(" " * W)
    body = [pad(trunc(r, W), W) for r in body[:BODY_ROWS]]
    frame = [_header(g), _tabs(g)] + body + [_footer(g), _hints(g)]

    top_pad = max(0, (term_h - H) // 2)
    left_pad = max(0, (term_w - W) // 2)
    out = [" " * term_w for _ in range(top_pad)]
    for ln in frame:
        out.append(" " * left_pad + ln + " " * (term_w - W - left_pad))
    while len(out) < term_h:
        out.append(" " * term_w)
    return "\r\n".join(out[:term_h])
