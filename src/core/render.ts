/** 渲染层:100×30 固定画布,8 个标签页 + 弹窗(与 abyss/render.py 逐行对齐) */
import { c, pad, trunc, bar, fmt, fmtTime, dwidth } from "./ansi.ts";
import type { Color } from "./ansi.ts";
import { zoneTheme, tierOf, mobGold } from "./combat.ts";
import {
  ACHIEVEMENTS, AFFIX_DEF, RARITIES, RARITY_IDX, SLOTS, SLOT_NAMES,
  STAT_NAMES, BAL, CLASSES, ACTIVE_SKILLS, PASSIVE_SKILLS, ACTIVE_DEF, PASSIVE_DEF, TOWER,
} from "./data.ts";
import { achievementTiers, questDesc } from "./systems.ts";
import { heroPower } from "./power.ts";
import { plusBonus } from "./items.ts";
import * as S from "./skills.ts";
import type { Game } from "./game.ts";
import type { Relic } from "./relics.ts";

export const W = 100, H = 30;
const BODY_ROWS = H - 4;
const CARD_W = 46;
const TABS = ["战斗", "角色", "背包", "锻造", "技能", "悬赏·成就", "设置", "塔"];

function hpCol(pct: number): Color {
  return pct > 0.5 ? "green" : pct > 0.25 ? "yellow" : "red";
}
const center = (s: string, w: number) => pad(s, w, "center");
function kv(label: string, value: string | number): string {
  return c(label, "bright_black") + " " + c(String(value), "white", "", true);
}
const padRows = (rows: string[]) => rows.map(r => pad(trunc(r, W), W));

// ================================================================ 头 / 尾
function header(g: Game): string {
  const theme = zoneTheme(g.zone)[0];
  let mode = g.mode === "push" ? c("推进▶", "bright_yellow") : c("挂机◎", "bright_cyan");
  const spd = g.settings.speed ?? 1;
  if (spd > 1) mode += c(` ×${spd}`, "bright_green", "", true);
  const zoneTxt = `第${g.zone}区·${g.stage}层`;
  const left = c("⚔ 深渊挂机 ", "bright_red", "", true) + c(zoneTxt, "bright_white")
    + " " + theme + " " + mode;
  const right = c(`Lv.${g.level}`, "bright_cyan", "", true)
    + c(" │ ", "bright_black")
    + c("◈", "bright_yellow") + c(fmt(g.gold), "bright_yellow")
    + c(" │ ", "bright_black")
    + c("✦", "bright_magenta") + c(String(g.stones), "bright_magenta")
    + c(" │ ", "bright_black")
    + c("⏱", "bright_black") + c(fmtTime(g.playtime), "bright_black");
  const gap = W - dwidth(left) - dwidth(right) - 2;
  return pad(" " + left + " ".repeat(Math.max(1, gap)) + right + " ", W);
}

function tabsRow(g: Game): string {
  const parts: string[] = [];
  for (let i = 0; i < TABS.length; i++) {
    const label = ` ${i + 1}·${TABS[i]} `;
    parts.push(g.view.ui.tab === i
      ? c(label, "black", "bright_white", true)
      : c(label, "bright_black"));
    parts.push(" ");
  }
  return pad(trunc(" " + parts.join(""), W), W);
}

function footer(g: Game): string {
  const v = g.view;
  let row: string;
  if (v.toast) {
    row = " " + c("» " + v.toast, "bright_green", "", true);
  } else {
    const paused = v.ui.paused ? c("‖ 已暂停 ", "bright_yellow") : "";
    row = " " + paused + c("自动存档中…", "bright_black");
  }
  return pad(trunc(row, W), W);
}

const HINTS: Record<number, string> = {
  0: "1-8 切页 │ F 模式 │ B 倍速 │ P 暂停 │ S 存档 │ H 帮助 │ Q 退出",
  1: "↑↓ 选择部位 │ U 强化 │ R 重铸 │ E 卸下 │ G 转生(Lv40) │ H 帮助",
  2: "↑↓ 选择 │ E 装备 │ D 分解 │ X 出售 │ A 一键出售普通/精良 │ H 帮助",
  3: "↑↓ 选择 │ U 强化(+8%主属性) │ R 重铸(3石) │ H 帮助",
  4: "↑↓ 选择 │ ←→ 装配区/主动池/被动池 │ E 装配/卸下 │ U 升级 │ H 帮助",
  5: "↑↓ 查看 │ 悬赏完成自动领取并刷新 │ H 帮助",
  6: "T 自动换装 │ J 自动出售档次 │ F 推进/挂机 │ ←→ 挂机层位 │ S 存档 │ R 重置 │ Q 退出",
  7: "Enter 爬塔 │ ↑↓ 选槽/背包 │ E 卸遗物·装备 │ D 分解 │ H 帮助",
};
const hintsRow = (g: Game) => pad(" " + c(HINTS[g.view.ui.tab] ?? "", "bright_black"), W);

// ================================================================ 战斗页
function bumpOff(timer: number, ttl = 0.24): number {
  if (timer <= 0) return 0;
  return timer > ttl / 2 ? 3 : 1;
}

function spinner(g: Game): string {
  const phase = Math.trunc(g.time * 4) % 3;
  const frames = ["»  ", " » ", "  »"];
  return c(" 战斗中", "bright_black") + c(frames[phase], "bright_yellow", "", true);
}

const HERO_ART = ["    /\\   ⌐■■¬ ", "   /  \\  |◔-◟|", "  | ⚔ | /|▂▂|\\ ",
  "  |▂▂▂/  |▂▂▂| ", "  /▃▃ \\  ▂▂  ▂▂"];

function card(g: Game, heroSide: boolean): string[] {
  const v = g.view;
  const lines: string[] = [];
  if (heroSide) {
    const h = g.hero;
    const dead = g.respawnTimer > 0;
    const off = bumpOff(v.heroBump);
    const cls = S.classOf(g);
    let name = c(` ${cls.icon} ${cls.name} `, cls.color, "", true)
      + c(`Lv.${g.level}`, cls.color);
    if (dead) name += c(`  (复活中 ${Math.trunc(g.respawnTimer + 0.999)}s)`, "bright_red");
    lines.push(pad(name, CARD_W - off, "center") + " ".repeat(off));
    const artColor = !dead ? cls.color : "bright_black" as Color;
    for (const a of HERO_ART) {
      lines.push(pad(c(a, artColor), CARD_W - off, "center") + " ".repeat(off));
    }
    const pct = h.max_hp ? h.hp / h.max_hp : 0;
    lines.push(pad(bar(h.hp, h.max_hp, 40, hpCol(pct)), CARD_W - off, "center") + " ".repeat(off));
    lines.push(pad(c(`${fmt(h.hp)} / ${fmt(h.max_hp)}`, hpCol(pct)), CARD_W - off, "center") + " ".repeat(off));
    lines.push(pad(c("EXP ", "bright_black") + bar(g.xp, g.xpReq(), 34, "cyan"),
      CARD_W - off, "center") + " ".repeat(off));
    return lines.slice(0, 8);
  }
  const m = g.monster;
  if (!m) {
    lines.push(pad(c("( 敌人蓄势待发… )", "bright_black"), CARD_W, "center"));
    for (let i = 0; i < 5; i++) lines.push(" ".repeat(CARD_W));
    lines.push(pad(c("…", "bright_black"), CARD_W, "center"));
    lines.push(" ".repeat(CARD_W));
    return lines.slice(0, 8);
  }
  const off = bumpOff(v.mobBump);
  const flash = v.mobFlash > 0;
  let tag = "";
  if (m.boss) tag = c(g.inTower ? " ♛ 塔主" : " ♛ 头目", "bright_yellow", "", true);
  else if (m.elite) tag = c(" ★ 精英", "bright_green", "", true);
  let mname = m.name;
  if (g.inTower && !mname.startsWith("塔·")) mname = "塔·" + mname;
  const name = c(` ${mname} `, m.color, "", m.boss || flash) + tag;
  lines.push(" ".repeat(off) + pad(name, CARD_W - off, "center"));
  for (const artLine of m.art) {
    lines.push(" ".repeat(off) + pad(c(artLine, m.color, "", flash), CARD_W - off, "center"));
  }
  const pct = m.hpPct();
  lines.push(" ".repeat(off) + pad(bar(m.hp, m.maxHp, 40, hpCol(pct)), CARD_W - off, "center"));
  lines.push(" ".repeat(off) + pad(c(`${fmt(m.hp)} / ${fmt(m.maxHp)}  Lv.${m.tier}`, hpCol(pct)),
    CARD_W - off, "center"));
  lines.push(" ".repeat(off) + pad(
    c("攻击 ", "bright_black") + c(fmt(m.atk), "red")
    + c("  防御 ", "bright_black") + c(fmt(m.def_), "blue"), CARD_W - off, "center"));
  return lines.slice(0, 8);
}

function tabBattle(g: Game): string[] {
  const rows: string[] = [];
  const v = g.view;
  let banner: string;
  if (g.inTower) {
    banner = c("═", "bright_magenta").repeat(3)
      + c(` 深渊塔 · 第 ${g.towerFloorSel} 层 `, "bright_magenta", "", true)
      + c("═", "bright_magenta").repeat(3);
  } else {
    const [theme, , , tcolor] = zoneTheme(g.zone);
    banner = c("═", tcolor).repeat(3)
      + c(` 第 ${g.zone} 区 · 第 ${g.stage} 层 · ${theme} `, tcolor, "", true)
      + c("═", tcolor).repeat(3);
  }
  rows.push(center(banner, W - 14) + spinner(g));

  const heroLines = card(g, true);
  const monLines = card(g, false);
  const clash = v.heroBump > 0 || v.mobBump > 0;
  const divider = clash ? c("✦", "bright_yellow", "", true) : c("│", "bright_black");
  for (let i = 0; i < Math.max(heroLines.length, monLines.length); i++) {
    const hl = heroLines[i] ?? " ".repeat(CARD_W);
    const ml = monLines[i] ?? " ".repeat(CARD_W);
    rows.push(pad("  " + hl + " " + divider + " " + ml + " ", W));
  }
  rows.push(" ".repeat(W));

  if (v.floaters.length) {
    const fl = v.floaters.slice(-5)
      .map((f: { text: string; color: string }) => c(f.text, f.color as Color, "", true)).join("  ");
    rows.push(center(fl, W));
  } else {
    rows.push(" ".repeat(W));
  }

  const chips: string[] = [], cds: string[] = [];
  const nSlots = Math.min(4, g.loadoutSlots());
  for (let i = 0; i < nSlots; i++) {
    const sid = i < g.loadout.active.length ? g.loadout.active[i] : null;
    if (!sid) {
      chips.push(pad(c(" (空) ", "bright_black"), 23));
      cds.push(pad(c("技能页(5)装配", "bright_black"), 23));
      continue;
    }
    const d = ACTIVE_DEF[sid];
    const lv = S.effLv(g, sid);
    const left = g.skillCd[sid] ?? 0;
    if (left > 0) {
      chips.push(pad(c(` ${d.icon} ${d.name} `, "bright_black") + c(`${left.toFixed(1)}s`, "yellow"), 23));
      cds.push(pad(c("冷却" + "░".repeat(Math.max(0, Math.trunc(left / d.cd * 6))), "yellow"), 23));
    } else {
      chips.push(pad(c(` ${d.icon} ${d.name} `, d.color, "", true) + c(`Lv.${lv}`, d.color), 23));
      cds.push(pad(c("● 就绪", d.color), 23));
    }
  }
  while (chips.length < 4) { chips.push(pad("", 23)); cds.push(pad("", 23)); }
  rows.push(" " + chips.join(" "));
  rows.push(" " + cds.join(" "));

  const h = g.hero;
  rows.push(pad("  " + kv("攻击", fmt(h.atk)) + "  " + kv("防御", fmt(h.def))
    + "  " + kv("生命", fmt(h.max_hp)) + "  " + kv("攻速", `+${h.haste.toFixed(0)}%`) + " ", W));
  rows.push(pad("  " + kv("暴击", `${h.crit.toFixed(0)}%`) + "  "
    + kv("暴伤", `+${h.crit_dmg.toFixed(0)}%`) + "  "
    + kv("吸血", `${h.lifesteal.toFixed(1)}%`) + "  "
    + kv("金币", `+${h.goldfind.toFixed(0)}%`) + " ", W));

  const dps = g.theoreticalDps();
  const kt = g.emaKill || 0;
  const t = tierOf(g.zone, g.stage);
  const gph = kt ? mobGold(t) * (1 + h.goldfind / 100) * 3600 / Math.max(0.5, kt) : 0;
  const pw = heroPower(g);
  // 战力并入本行(页面 26 行排满,不另起一行)
  rows.push(pad("  " + c("⚔ 战力 ", "bright_black") + c(fmt(pw.total), "bright_yellow", "", true)
    + c("  ⚡ 理论DPS ", "bright_black") + c(fmt(dps), "bright_white", "", true)
    + c("   ⏱ 击杀用时 ", "bright_black") + c(`~${(kt || 0).toFixed(1)}s`, "bright_white")
    + c("   ◈ 预计 ", "bright_black") + c(fmt(gph) + "/小时", "bright_yellow") + " ", W));

  rows.push("  " + c("┌─ 战斗记录 " + "─".repeat(85) + "┐", "bright_black"));
  const tail: [string, string][] = [...v.logbuf.slice(-8)];
  while (tail.length < 8) tail.unshift(["", ""]);
  for (const [text, color] of tail) {
    rows.push("  " + c("│ ", "bright_black") + pad(trunc(c(text, color as Color), 93), 93)
      + c(" │", "bright_black"));
  }
  rows.push("  " + c("└" + "─".repeat(96) + "┘", "bright_black"));

  while (rows.length < BODY_ROWS) rows.push(" ".repeat(W));
  return rows.slice(0, BODY_ROWS);
}

// ================================================================ 角色页
function tabChar(g: Game): string[] {
  const sel = g.view.ui.char_sel;
  const leftW = 50, rightW = 44;
  const left: string[] = [];
  const cls = S.classOf(g);
  left.push(" " + c("▌装备", "bright_white", "", true)
    + c(` ${cls.icon} ${cls.name} `, cls.color, "", true)
    + c(" ↑↓ 选择部位", "bright_black"));
  for (let i = 0; i < SLOTS.length; i++) {
    const { id: slot, name } = SLOTS[i];
    const it = g.equip[slot];
    const marker = i === sel ? c("▸", "bright_yellow") : " ";
    const slotName = pad(name, 4, "center");
    const body = it ? it.display(36) : c("(空)", "bright_black");
    const line = ` ${marker} ${c(slotName, "bright_white")} ${body}`;
    left.push(pad(trunc(line, leftW), leftW));
  }
  left.push(" " + c("▌遗物", "bright_white", "", true)
    + c(` 深渊塔掉落 · 背包 ${g.relicBag.length}/${g.relicBagCap()}`, "bright_black"));
  for (let i = 0; i < 4; i++) {
    const r: Relic | null = g.relics[i] ?? null;
    const label = c(`遗物${i + 1}:`, "bright_black");
    const body = r
      ? r.display() + c(` · ${r.effects.length}效果`, "bright_black")
      : c("(空)", "bright_black");
    left.push(pad(trunc(`  ${label} ${body}`, leftW), leftW));
  }
  const h = g.hero;
  left.push(" " + c("▌属性总览", "bright_white", "", true));
  const pw = heroPower(g);
  left.push(pad("  " + c("战力 ", "bright_black") + c(fmt(pw.total), "bright_yellow", "", true)
    + c(` (输出${fmt(pw.offense)}·生存${fmt(pw.defense)}·功能${fmt(pw.utility)})`, "bright_black"), leftW));
  left.push(pad("  " + [kv("攻击", fmt(h.atk)), kv("防御", fmt(h.def)), kv("生命", fmt(h.max_hp))].join("  "), leftW));
  left.push(pad("  " + [kv("暴击", `${h.crit.toFixed(0)}%`), kv("暴伤", `+${h.crit_dmg.toFixed(0)}%`),
    kv("攻速", `+${h.haste.toFixed(0)}%`)].join("  "), leftW));
  left.push(pad("  " + [kv("吸血", `${h.lifesteal.toFixed(1)}%`), kv("幸运", `+${(h.luck ?? 0).toFixed(0)}`),
    kv("评分", fmt(Object.values(g.equip).reduce((a, i) => a + i.score(), 0)))].join("  "), leftW));
  while (left.length < BODY_ROWS) left.push(" ".repeat(leftW));

  const right: string[] = [];
  const slot = SLOTS[sel].id;
  const it = g.equip[slot];
  right.push(" " + c("▌详情", "bright_white", "", true));
  if (it) {
    right.push(" " + it.display());
    right.push(" " + c(`${SLOT_NAMES[slot]} · Lv.${it.tier} · ${RARITIES[RARITY_IDX[it.rarity]].name}`,
      it.rarityColor()));
    right.push("");
    for (const ln of it.statLines()) right.push(" " + trunc(ln, rightW - 2));
    right.push("");
    right.push(" " + c("评分 ", "bright_black") + c(fmt(it.score()), "bright_yellow", "", true));
    right.push(" " + c("强化 ", "bright_black") + c(`+${it.plus}`, "bright_yellow")
      + c(`  (U 强化费用 ${fmt(it.enhanceCost())})`, "bright_black"));
    const rc = it.reforgeCount();
    right.push(" " + c("洗练 ", "bright_black") + c(`${rc}条/次`, "bright_magenta")
      + c(`  (R 洗词条,幸运+${(g.hero.luck ?? 0).toFixed(0)}提升值域)`, "bright_black"));
    right.push(" " + c("出售 ", "bright_black") + c(`${fmt(it.sellPrice())} 金币`, "bright_yellow"));
  } else {
    right.push(" " + c("该部位没有装备,等待掉落…", "bright_black"));
  }
  while (right.length < BODY_ROWS) right.push(" ".repeat(rightW));

  const rows: string[] = [];
  for (let i = 0; i < BODY_ROWS; i++) {
    const l = left[i] ?? " ".repeat(leftW);
    const r = right[i] ?? " ".repeat(rightW);
    rows.push(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W));
  }
  return rows;
}

// ================================================================ 背包页
const BAG_PAGE = 12;

function tabBag(g: Game): string[] {
  const sel = g.view.ui.bag_sel;
  const page = Math.trunc(sel / BAG_PAGE);
  const leftW = 52, rightW = 42;
  const left: string[] = [];
  left.push(" " + c("▌背包", "bright_white", "", true)
    + c(` ${g.bag.length}/${BAL.bag_size}`, "bright_black")
    + pad(c(`第${page + 1}页`, "bright_black"), 10, "right"));
  const start = page * BAG_PAGE;
  for (let i = 0; i < BAG_PAGE; i++) {
    const idx = start + i;
    if (idx >= g.bag.length) { left.push(" ".repeat(leftW)); continue; }
    const it = g.bag[idx];
    const marker = idx === sel ? c("▸", "bright_yellow") : " ";
    const line = ` ${marker} ${it.display(34)} ${c(fmt(it.score()), "bright_black")}`;
    left.push(pad(trunc(line, leftW), leftW));
  }

  const right: string[] = [];
  right.push(" " + c("▌详情 / 对比", "bright_white", "", true));
  if (g.bag.length) {
    const it = g.bag[Math.min(sel, g.bag.length - 1)];
    right.push(" " + it.display());
    right.push(" " + c(`${SLOT_NAMES[it.slot]} · Lv.${it.tier} · 评分${fmt(it.score())}`,
      it.rarityColor()));
    right.push("");
    for (const ln of it.statLines().slice(0, 8)) right.push(" " + trunc(ln, rightW - 2));
    const cur = g.equip[it.slot];
    right.push("");
    if (cur) {
      const delta = it.score() - cur.score();
      const arrow = delta > 0
        ? c(`▲ 优于当前 ${fmt(delta)}`, "bright_green")
        : c(`▼ 劣于当前 ${fmt(-delta)}`, "bright_red");
      const lvGap = it.tier - cur.tier;
      const lvTxt = lvGap
        ? c(`  Lv${lvGap > 0 ? "+" : ""}${lvGap}`, lvGap > 0 ? "bright_green" : "bright_black")
        : c("  同级", "bright_black");
      right.push(" " + c("对比: ", "bright_black") + c(`Lv.${cur.tier} `, "bright_black")
        + c(cur.name, cur.rarityColor())
        + (cur.plus ? c(` +${cur.plus}`, "bright_yellow") : "") + lvTxt);
      right.push(" " + arrow + c("   (E 穿上)", "bright_black"));
    } else {
      right.push(" " + c("该部位为空,直接穿上", "bright_green"));
    }
    const [dgold, dstones] = it.dismantle();
    right.push(" " + c(`出售 ◈${fmt(it.sellPrice())}`, "bright_yellow")
      + c("  │  分解 ◈" + fmt(dgold) + (dstones ? ` ✦${dstones}` : ""), "bright_black"));
  } else {
    right.push(" " + c("背包空空如也,去刷怪吧。", "bright_black"));
  }
  while (right.length < BODY_ROWS) right.push(" ".repeat(rightW));

  const rows: string[] = [];
  for (let i = 0; i < BODY_ROWS; i++) {
    const l = left[i] ?? " ".repeat(leftW);
    const r = right[i] ?? " ".repeat(rightW);
    rows.push(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W));
  }
  return rows;
}

// ================================================================ 锻造页
function tabForge(g: Game): string[] {
  const sel = g.view.ui.forge_sel;
  const leftW = 50, rightW = 44;
  const left: string[] = [];
  left.push(" " + c("▌锻造台", "bright_white", "", true)
    + c(`  ✦${g.stones} 重铸石`, "bright_magenta"));
  for (let i = 0; i < SLOTS.length; i++) {
    const { id: slot, name } = SLOTS[i];
    const it = g.equip[slot];
    const marker = i === sel ? c("▸", "bright_yellow") : " ";
    const slotName = pad(name, 4, "center");
    let line: string;
    if (it) {
      const plus = it.plus ? c(`+${it.plus}`, "bright_yellow") : c(" +0", "bright_black");
      const cost = fmt(it.enhanceCost());
      const costCol: Color = g.gold >= it.enhanceCost() ? "bright_yellow" : "bright_black";
      line = ` ${marker} ${c(slotName, "bright_white")} ${it.display(24)} `
        + c(`+${it.plus}`, "bright_yellow") + ` ${c("◈" + cost, costCol)}`;
    } else {
      line = ` ${marker} ${c(slotName, "bright_white")} ${c("(空)", "bright_black")}`;
    }
    left.push(pad(trunc(line, leftW), leftW));
  }
  left.push("");
  left.push(" " + c("U 强化:+8%/级(11级起+4%,21级起+2%)", "bright_black"));
  left.push(" " + c("R 洗练:3重铸石,按品质洗N条(精稀1/史传2/神3)", "bright_black"));
  left.push(" " + c("   幸运词缀提升掉落品质与洗出值上限", "bright_black"));
  while (left.length < BODY_ROWS) left.push(" ".repeat(leftW));

  const right: string[] = [];
  const slot = SLOTS[sel].id;
  const it = g.equip[slot];
  right.push(" " + c("▌强化预览", "bright_white", "", true));
  if (it) {
    right.push(" " + it.display());
    right.push(" " + c(`当前 +${it.plus} → +${Math.min(it.plus + 1, BAL.plus_max)}`, "bright_yellow"));
    right.push("");
    const curMult = it.mult();
    const nxtMult = RARITIES[RARITY_IDX[it.rarity]].affixes * (1 + plusBonus(it.plus + 1));
    const entries: [string, number][] = [[it.mainStat(), it.mainVal], ...it.affixes.map(a => [a.id, a.val] as [string, number])];
    for (const [aid, base] of entries) {
      const a = AFFIX_DEF[aid];
      const cv = base * curMult;
      const nv = base * nxtMult;
      if (a.pct) {
        right.push(" " + trunc(c(`${a.name} `, "bright_black") + c(`${cv.toFixed(1)}%`, "white")
          + c(" → ", "bright_black") + c(`+${nv.toFixed(1)}%`, "bright_green"), rightW - 2));
      } else {
        right.push(" " + trunc(c(`${a.name} `, "bright_black") + c(fmt(cv), "white")
          + c(" → ", "bright_black") + c(fmt(nv), "bright_green"), rightW - 2));
      }
    }
    right.push("");
    right.push(" " + c("费用 ", "bright_black") + c("◈ " + fmt(it.enhanceCost()), "bright_yellow")
      + c(`  (持有 ${fmt(g.gold)})`, "bright_black"));
    if (it.plus >= BAL.plus_max) right.push(" " + c("已达到强化上限!", "bright_red"));
  } else {
    right.push(" " + c("该部位没有装备。", "bright_black"));
  }
  while (right.length < BODY_ROWS) right.push(" ".repeat(rightW));

  const rows: string[] = [];
  for (let i = 0; i < BODY_ROWS; i++) {
    const l = left[i] ?? " ".repeat(leftW);
    const r = right[i] ?? " ".repeat(rightW);
    rows.push(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W));
  }
  return rows;
}

// ================================================================ 技能页
function skillRow(g: Game, d: any, marker: string, width: number, zoneSel: boolean): string {
  const lv = S.effLv(g, d.id);
  const baseLv = g.skillLv[d.id] ?? 1;
  const locked = g.level < d.unlock;
  let body: string;
  if (locked) {
    body = c(`${d.name} 🔒 Lv.${d.unlock} 解锁`, "bright_black");
  } else {
    const eq = [...g.loadout.active, ...g.loadout.passive].includes(d.id) ? "●" : " ";
    const iconPart = d.icon ? c(` ${d.icon} `, d.color) : " ";
    const cd = d.cd !== undefined ? `CD${d.cd}s` : "被动";
    body = c(eq, "bright_green") + iconPart
      + c(d.name, d.color ?? "white", "", zoneSel)
      + c(` Lv.${lv}`, "bright_yellow")
      + c(`  ${cd}`, "bright_black")
      + (baseLv > 1 ? c(`(自+${baseLv})`, "bright_black") : "");
  }
  return pad(trunc(`${marker} ${body}`, width), width);
}

function tabSkills(g: Game): string[] {
  const v = g.view, ui = v.ui;
  const zone = ui.skill_zone ?? 1;
  let sel = ui.skill_sel ?? 0;
  const slotIdx = ui.skill_slot ?? 0;
  const rows: string[] = [];
  const cls = S.classOf(g);
  rows.push(" " + c("▌技能", "bright_white", "", true)
    + c(` · ${cls.icon} ${cls.name} `, cls.color, "", true)
    + c("  ←→ 切区 │ E 装配/卸下 │ U 升级", "bright_black"));

  const slotRow = (idx: number, sid: string | null, label: string) => {
    const mark = (zone === 0 && slotIdx === idx) ? c("▸", "bright_yellow") : " ";
    if (sid) {
      const d = ACTIVE_DEF[sid] ?? PASSIVE_DEF[sid];
      return skillRow(g, d, mark + label, W - 2, zone === 0 && slotIdx === idx);
    }
    if (idx < g.loadoutSlots()) {
      return pad(trunc(`${mark}${label} ${c("(空 — 在池中选技能装配)", "bright_black")}`, W - 2), W - 2);
    }
    const th = idx < BAL.loadout_unlock.length ? BAL.loadout_unlock[idx] : 99;
    return pad(`${mark}${label} ${c(`🔒 Lv.${th}`, "bright_black")}`, W - 2);
  };

  rows.push(" " + c("── 装配 · 主动 ──", "bright_cyan"));
  for (let i = 0; i < 4; i++) {
    rows.push(" " + slotRow(i, i < g.loadout.active.length ? g.loadout.active[i] : null, `${i + 1}.`));
  }
  rows.push(" " + c("── 装配 · 被动 ──", "bright_magenta"));
  for (let i = 0; i < 4; i++) {
    rows.push(" " + slotRow(4 + i, i < g.loadout.passive.length ? g.loadout.passive[i] : null, `${i + 1}.`));
  }
  rows.push("");

  const pool = (zone === 1 ? ACTIVE_SKILLS : PASSIVE_SKILLS)
    .filter(s => s.cls === g.classId);
  sel = Math.max(0, Math.min(sel, pool.length - 1));
  const title = zone === 1 ? "主动技能池" : "被动技能池";
  rows.push(" " + c(`▌${title}`, "bright_white", "", true)
    + c(`  ${pool.filter(s => g.level >= s.unlock).length}/10`, "bright_black"));
  if (pool.length) {
    const d = pool[sel];
    rows.push(" " + trunc(S.skillDesc(g, d), W - 2));
    const cost = g.skillCost(d.id);
    const afford = g.gold >= cost;
    rows.push(" " + c("  升级 ◈" + fmt(cost), afford ? "bright_yellow" : "bright_black")
      + c(g.level >= d.unlock ? "  [U]" : "  [未解锁]", "bright_black"));
  }
  rows.push("");
  for (let i = 0; i < pool.length; i++) {
    const mark = (zone >= 1 && i === sel) ? c("▸", "bright_yellow") : " ";
    rows.push(" " + skillRow(g, pool[i], mark, W - 2, zone >= 1 && i === sel));
  }
  while (rows.length < BODY_ROWS) rows.push(" ".repeat(W));
  return padRows(rows);
}

// ================================================================ 悬赏/成就
function tabQuests(g: Game): string[] {
  const leftW = 46, rightW = 46;
  const left: string[] = [];
  left.push(" " + c("▌悬赏任务(完成自动领取)", "bright_white", "", true));
  left.push("");
  for (const q of g.quests) {
    left.push("  " + c("◆ " + questDesc(q), "bright_cyan"));
    left.push("    " + bar(q.progress, q.target, 26, "cyan")
      + c(` ${Math.min(q.progress, q.target)}/${q.target}`, "bright_black"));
    let rw = c("◈" + fmt(q.gold), "bright_yellow");
    if (q.stones) rw += c(`  ✦${q.stones}`, "bright_magenta");
    left.push("    " + c("奖励 ", "bright_black") + rw);
    left.push("");
  }
  left.push("  " + c(`已完成悬赏:${g.stats.quest_done ?? 0}`, "bright_black"));
  while (left.length < BODY_ROWS) left.push(" ".repeat(leftW));

  const right: string[] = [];
  right.push(" " + c("▌成就(永久加成,自动生效)", "bright_white", "", true));
  right.push("");
  for (const a of ACHIEVEMENTS) {
    const val = g.stats[a.metric] ?? 0;
    const [tiers, total] = achievementTiers(a.id, val);
    const stars = c("★".repeat(tiers), "bright_yellow") + c("☆".repeat(total - tiers), "bright_black");
    const nxt = a.thresholds.find(t => val < t);
    const prog = c(`${fmt(val)}/${nxt ? fmt(nxt) : "MAX"}`, "bright_black");
    const statName = STAT_NAMES[a.stat] ?? a.stat;
    const buffTxt = a.stat === "crit"
      ? `暴击 +${a.per * tiers}点`
      : `${statName} +${a.per * tiers}%`;
    right.push("  " + c(a.name, "bright_white") + " " + stars + " " + prog);
    right.push(tiers ? "    " + c(buffTxt, "bright_green") : "    " + c("未达成", "bright_black"));
  }
  right.push("");
  right.push("  " + c("成就加成会随里程碑自动提升。", "bright_black"));
  while (right.length < BODY_ROWS) right.push(" ".repeat(rightW));

  const rows: string[] = [];
  for (let i = 0; i < BODY_ROWS; i++) {
    const l = left[i] ?? " ".repeat(leftW);
    const r = right[i] ?? " ".repeat(rightW);
    rows.push(pad(trunc(" " + l + "  " + c("│", "bright_black") + " " + r + " ", W), W));
  }
  return rows;
}

// ================================================================ 设置页
function tabSettings(g: Game): string[] {
  const rows: string[] = [];
  const s = g.settings;
  rows.push("  " + c("▌设置", "bright_white", "", true));
  rows.push("");
  const autoEq = s.auto_equip ? c("开", "bright_green") : c("关", "bright_red");
  rows.push("  " + c("▸ 自动换装  ", "bright_white") + autoEq
    + c("   [T] 新掉落评分更高时自动穿上", "bright_black"));
  const idx = s.auto_sell_idx ?? -1;
  const names = ["关闭", "出售「普通」及以下", "出售「精良」及以下", "出售「稀有」及以下",
    "出售「史诗」及以下", "出售「传说」及以下"];
  rows.push("  " + c("▸ 掉落自动出售  ", "bright_white") + c(names[idx + 1], "bright_cyan")
    + c("   [J] 切换档次", "bright_black"));
  const mode = g.mode === "push" ? c("推进模式 ▶", "bright_yellow") : c("挂机模式 ◎", "bright_cyan");
  rows.push("  " + c("▸ 战斗模式  ", "bright_white") + mode + c("   [F] 切换", "bright_black"));
  rows.push("  " + c("▸ 挂机层位  ", "bright_white") + c(`第 ${g.farmStage} 层`, "bright_white")
    + c("   [←→] 调整(仅挂机模式生效)", "bright_black"));
  const spd = g.settings.speed ?? 1;
  const spdTxt = spd > 1 ? c(`×${spd}`, "bright_green", "", true) : c("×1", "bright_black");
  const nxtTh = (BAL.speed_unlock as readonly number[]).find(th => g.level < th);
  const lockTxt = nxtTh ? c(`   (Lv${nxtTh} 解锁下一档)`, "bright_black") : "";
  rows.push("  " + c("▸ 游戏速度  ", "bright_white") + spdTxt
    + c("   [B] 切换", "bright_black") + lockTxt);
  rows.push("");
  rows.push("  " + c("▸ 立即存档   [S]", "bright_white"));
  rows.push(g.view.ui.confirm_reset
    ? "  " + c("▸ 确认清空全部进度?  [Y]确认 / [N]取消", "bright_red", "", true)
    : "  " + c("▸ 重置存档   [R]", "bright_red"));
  rows.push("  " + c("▸ 退出游戏(自动存档)   [Q]", "bright_white"));
  rows.push("");
  rows.push("  " + c("─".repeat(44), "bright_black"));
  rows.push("  " + c(`击杀 ${g.stats.kills ?? 0} · 头目 ${g.stats.boss_kills ?? 0} · `
    + `死亡 ${g.stats.deaths ?? 0} · 强化 ${g.stats.enhance_total ?? 0} · 重铸 ${g.stats.reforge_total ?? 0}`,
    "bright_black"));
  rows.push("  " + c(`累计金币 ${fmt(g.stats.gold_earned ?? 0)} · 最深到达 第${g.stats.max_zone ?? 1}区`,
    "bright_black"));
  while (rows.length < BODY_ROWS) rows.push(" ".repeat(W));
  return padRows(rows);
}

// ================================================================ 塔页
function tabTower(g: Game): string[] {
  const ui = g.view.ui;
  const rows: string[] = [];
  const reach = g.tower.max_floor + 1;          // 下一层(爬塔起点)
  const bagShow = Math.min(g.relicBag.length, 4);          // 背包前 4 件可选(与 host.ts 一致)
  const selTotal = 4 + bagShow;
  const slotSel = (ui.tower_sel ?? 0) % selTotal;

  rows.push(" " + c("▌深渊塔", "bright_white", "", true)
    + c(" │ ", "bright_black")
    + c(`钥匙 ×${g.tower.keys}`, "bright_yellow", "", true)
    + c(" │ ", "bright_black")
    + c(`最高第${g.tower.max_floor}层`, "bright_cyan", "", true)
    + c(" │ ", "bright_black")
    + c("Enter 爬塔(连胜连爬)", "bright_black")
    + (g.inTower ? c(` │ 爬塔中·第${g.towerFloorSel}层`, "bright_magenta", "", true) : ""));
  rows.push(" " + c("─".repeat(64), "bright_black"));
  rows.push("");

  const boss = reach % TOWER.boss_every === 0;
  rows.push(" " + c("[下一层] ", "bright_black")
    + c(`第 ${reach} 层`, "bright_white", "", true)
    + (boss ? c(" 头目!", "bright_yellow", "", true) : "")
    + c(` (每${TOWER.boss_every}层一个头目)`, "bright_black"));
  rows.push(" " + c("第1层 ", "bright_black")
    + bar(g.tower.max_floor, Math.max(reach, 1), 44, "cyan")
    + c(` 第${reach}层`, "bright_black")
    + c(`  ▸ 已爬到 第${g.tower.max_floor}层`, "bright_cyan", "", true));
  rows.push("");

  rows.push(" " + c("▌遗物", "bright_white", "", true)
    + c(" 通关必得 · 空槽优先装满", "bright_black")
    + c("  │  ↑↓ 选槽/背包 E 卸下·装备 D 分解", "bright_black"));
  for (let i = 0; i < 4; i++) {
    const r: Relic | null = g.relics[i] ?? null;
    const marker = i === slotSel ? c("▸", "bright_yellow") : " ";
    const label = c(`遗物${i + 1}:`, "bright_black");
    const body = r
      ? r.display() + "  " + c(r.effectLines().map(ln => ln.trim()).join("  "), "white")
      : c("(空)", "bright_black");
    const line = ` ${marker} ${label} ${body}`;
    rows.push(pad(trunc(line, W - 2), W - 2));
  }

  // 遗物背包:满槽收纳 + U 扩容
  const cap = g.relicBagCap();
  const upCost = g.relicBagCost();
  rows.push(" " + c("▌遗物背包", "bright_white", "", true)
    + c(` ${g.relicBag.length}/${cap} 格 · 槽满掉落自动存入`, "bright_black")
    + c("  │  ", "bright_black")
    + (upCost !== null
      ? c(`U 扩容→${Math.min(cap * 2, BAL.relic_bag_cap)}格(◈${fmt(upCost)})`, "bright_cyan")
      : c("已满级", "bright_black")));
  for (let i = 0; i < bagShow; i++) {
    const r = g.relicBag[i];
    const marker = 4 + i === slotSel ? c("▸", "bright_yellow") : " ";
    const label = c(`背包${i + 1}:`, "bright_black");
    const line = ` ${marker} ${label} ` + r.display()
      + "  " + c(r.effectLines().map(ln => ln.trim()).join("  "), "white");
    rows.push(pad(trunc(line, W - 2), W - 2));
  }
  if (g.relicBag.length > bagShow) {
    rows.push(" " + c(`  …另有 ${g.relicBag.length - bagShow} 件(网页端可查看全部)`, "bright_black"));
  } else if (!g.relicBag.length) {
    rows.push(" " + c("  (空)卸下的遗物也会保存在这里", "bright_black"));
  }

  rows.push("");
  rows.push(" " + c("▌规则", "bright_white", "", true));
  rows.push("  " + c(`· 每日 0 点刷新钥匙(每天 ${TOWER.keys_per_day} 把,可囤积,上限 ${TOWER.keys_cap})`,
    "bright_black"));
  rows.push("  " + c("· Enter 从最高层+1 开始爬,连胜连爬,每层消耗 1 把钥匙", "bright_black"));
  rows.push("  " + c("· 通关必得遗物与金币,战败仅耗钥匙;分解背包遗物 +1 重铸石", "bright_black"));
  rows.push("  " + c(`· 首次到达新高度 +${TOWER.new_height_stones} 重铸石;头目层遗物保底稀有`,
    "bright_black"));
  while (rows.length < BODY_ROWS) rows.push(" ".repeat(W));
  return padRows(rows);
}

// ================================================================ 弹窗
function modalClass(): string[] {
  const rows: string[] = [];
  rows.push(center(c("⚔ 选择你的职业 ⚔", "bright_yellow", "", true), W));
  rows.push("");
  const keys: Record<string, string> = { warrior: "1", mage: "2", ranger: "3" };
  for (const [cid, cls] of Object.entries(CLASSES)) {
    const b = cls.base;
    rows.push(center(c(` [${keys[cid]}] `, "bright_white", "", true)
      + c(`${cls.icon} ${cls.name} `, cls.color, "", true) + c(" — " + cls.desc, "white"), W));
    rows.push(center(c(`生命×${b.hp.toFixed(2)}  攻击×${b.atk.toFixed(2)}  防御×${b.def.toFixed(2)}  攻速 ${cls.interval.toFixed(1)}s/刀`,
      "bright_black"), W));
    rows.push(center(c("技能池:10 主动 + 10 被动,自选装配 4+4", "bright_black"), W));
    rows.push("");
  }
  rows.push(center(c("按 1 / 2 / 3 选择职业(自动装配初始技能)", "bright_cyan"), W));
  while (rows.length < BODY_ROWS) rows.push(" ".repeat(W));
  return padRows(rows);
}

function modalBox(title: string, lines: string[]): string[] {
  const innerW = 62;
  const out: string[] = [];
  out.push(center(c("┌" + "─".repeat(innerW + 2) + "┐", "bright_white"), W));
  out.push(center(c("│ ", "bright_white") + pad(c(title, "bright_yellow", "", true), innerW, "center")
    + c(" │", "bright_white"), W));
  out.push(center(c("├" + "─".repeat(innerW + 2) + "┤", "bright_white"), W));
  for (const ln of lines.slice(0, BODY_ROWS - 5)) {
    out.push(center(c("│ ", "bright_white") + pad(trunc(ln, innerW), innerW) + c(" │", "bright_white"), W));
  }
  while (out.length < BODY_ROWS - 1) {
    out.push(center(c("│ " + " ".repeat(innerW) + " │", "bright_white"), W));
  }
  out.push(center(c("└" + "─".repeat(innerW + 2) + "┘", "bright_white"), W));
  return out.slice(0, BODY_ROWS);
}

function modalHelp(): string[] {
  const lines = [
    c("全局按键", "bright_cyan"),
    "  1-8  切换页面      P 暂停/继续      S 立即存档",
    "  H    帮助(本页)   Q 退出并自动存档",
    "",
    c("战斗页", "bright_cyan"),
    "  F    推进/挂机模式切换(挂机=停在当前层反复刷)",
    "",
    c("塔页(8)", "bright_cyan"),
    "  Enter 爬塔:从最高层+1 开始,连胜连爬(每层1把钥匙)",
    "  ↑↓ 选遗物槽/背包  E 卸下·装备  D 分解背包遗物(+1重铸石)",
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
  ];
  return modalBox("按任意键关闭帮助 · H", lines);
}

function modalOffline(g: Game): string[] | null {
  const r = g.pendingOffline;
  if (!r) return null;
  const items = r.items ?? [];
  const itemLines = items.slice(0, 6).map(it => it.display());
  if (items.length > 6) itemLines.push(c(`…等共 ${items.length} 件`, "bright_black"));
  const lines = [
    c("离开时长:", "bright_black") + c(fmtTime(r.sec), "bright_white", "", true),
    c("预计击杀:", "bright_black") + c(`${r.kills} 只`, "bright_white"),
    c("金币收益:", "bright_black") + c("◈ " + fmt(r.gold), "bright_yellow"),
    c("经验收益:", "bright_black") + c(fmt(r.xp), "bright_cyan"),
    c("装备掉落:", "bright_black") + (items.length ? c(`${items.length} 件`, "bright_magenta") : c("无", "bright_black")),
    ...itemLines.map(s => "  " + s),
    "",
    c("按任意键继续冒险", "bright_green", "", true),
  ];
  return modalBox("☾ 离线收益结算 ☽", lines);
}

function modalSwap(g: Game): string[] | null {
  const p = g.pendingSwap;
  if (!p) return null;
  const lines: string[] = [];
  if (p.kind === "item") {
    const cur = p.slot ? g.equip[p.slot] : undefined;
    lines.push(c("当前: ", "bright_black") + (cur
      ? cur.display() + c(`  (评分 ${fmt(cur.score())})`, "bright_yellow")
      : c("(空)", "bright_black")));
    for (const ln of cur ? cur.statLines() : []) lines.push("  " + trunc(ln, 60));
    lines.push(c("新的: ", "bright_black") + p.item!.display()
      + c(`  (评分 ${fmt(p.item!.score())})`, "bright_yellow"));
    for (const ln of p.item!.statLines()) lines.push("  " + trunc(ln, 60));
  } else {
    const old = g.relics[p.relicSlot ?? 0];
    lines.push(c(`当前(遗物${(p.relicSlot ?? 0) + 1}): `, "bright_black") + (old
      ? old.display() + c(` · ${old.effects.length}效果`, "bright_black")
      : c("(空)", "bright_black")));
    for (const ln of old ? old.effectLines() : []) lines.push("  " + trunc(ln, 60));
    lines.push(c("新的: ", "bright_black") + p.newRelic!.display()
      + c(` · ${p.newRelic!.effects.length}效果`, "bright_black"));
    for (const ln of p.newRelic!.effectLines()) lines.push("  " + trunc(ln, 60));
  }
  lines.push("");
  lines.push(c("E 换上新的    X 保留旧的", "bright_green", "", true));
  return modalBox(p.kind === "item" ? "⚔ 更强的装备掉落 — 用哪个?" : "◆ 更强的遗物 — 用哪个?", lines);
}

// ================================================================ 主入口
export function renderFrame(g: Game, termW: number, termH: number): string {
  if (termW < W || termH < H) {
    const lines: string[] = new Array(Math.max(1, termH)).fill(" ");
    const msg1 = c("请把终端窗口调大到至少 100×30", "bright_yellow", "", true);
    const msg2 = c(`当前 ${termW}×${termH} — 拖动窗口边缘即可调整`, "bright_black");
    const mid = Math.trunc(termH / 2);
    if (mid - 1 >= 0 && mid - 1 < termH) lines[mid - 1] = pad(msg1, termW, "center");
    if (mid >= 0 && mid < termH) lines[mid] = pad(msg2, termW, "center");
    return lines.join("\r\n");
  }

  const tab = g.view.ui.tab;
  let body: string[] | null;
  if (g.classId === null) body = modalClass();
  else if (g.pendingOffline) body = modalOffline(g)!;
  else if (g.pendingSwap) body = modalSwap(g)!;
  else if (g.view.ui.help) body = modalHelp();
  else if (tab === 0) body = tabBattle(g);
  else if (tab === 1) body = tabChar(g);
  else if (tab === 2) body = tabBag(g);
  else if (tab === 3) body = tabForge(g);
  else if (tab === 4) body = tabSkills(g);
  else if (tab === 5) body = tabQuests(g);
  else if (tab === 7) body = tabTower(g);
  else body = tabSettings(g);

  while (body.length < BODY_ROWS) body.push(" ".repeat(W));
  body = body.slice(0, BODY_ROWS).map(r => pad(trunc(r, W), W));
  const frame = [header(g), tabsRow(g), ...body, footer(g), hintsRow(g)];

  const topPad = Math.max(0, Math.trunc((termH - H) / 2));
  const leftPad = Math.max(0, Math.trunc((termW - W) / 2));
  const out: string[] = new Array(topPad).fill(" ".repeat(termW));
  for (const ln of frame) {
    out.push(" ".repeat(leftPad) + ln + " ".repeat(termW - W - leftPad));
  }
  while (out.length < termH) out.push(" ".repeat(termW));
  return out.slice(0, termH).join("\r\n");
}
