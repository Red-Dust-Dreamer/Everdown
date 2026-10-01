/** 平台无关宿主逻辑:按键分发 + autopilot(与 abyss/main.py 一致) */
import { ACTIVE_SKILLS, PASSIVE_SKILLS, ACTIVE_DEF, SLOTS } from "./data.ts";
import type { ActiveSkill } from "./data.ts";
import type { Game } from "./game.ts";

export type KeyResult = true | false | "reset";

function clampBagSel(g: Game): void {
  g.view.ui.bag_sel = Math.min(g.view.ui.bag_sel, Math.max(0, g.bag.length - 1));
}

export function handleKey(g: Game, key: string): KeyResult {
  if (!key) return true;
  const v = g.view;
  const ui = v.ui;

  // 职业选择(新档)
  if (g.classId === null) {
    const cmap: Record<string, string> = { "1": "warrior", "2": "mage", "3": "ranger" };
    if (cmap[key]) g.chooseClass(cmap[key]);
    return true;
  }

  if (g.pendingOffline) {
    g.pendingOffline = null;
    return true;
  }
  if (ui.help) {
    ui.help = false;
    return true;
  }
  if (key === "quit") return false;
  if (key === "p") {
    ui.paused = !ui.paused;
    g.toast(ui.paused ? "已暂停" : "继续");
    return true;
  }
  if (key === "h") { ui.help = true; return true; }
  if (key === "s") { g.save(); g.toast("已存档"); return true; }
  if (key === "q") return false;
  if (key >= "1" && key <= "7") {
    ui.tab = parseInt(key) - 1;
    return true;
  }
  if (key === "f" && ui.tab !== 6) {
    g.setMode(g.mode === "push" ? "farm" : "push");
    return true;
  }
  if (key === "b") {
    g.cycleSpeed();
    return true;
  }

  const tab = ui.tab;
  if (tab === 0) {
    // 战斗全自动
  } else if (tab === 1) {
    const n = SLOTS.length;
    if (key === "up") ui.char_sel = (ui.char_sel - 1 + n) % n;
    else if (key === "down") ui.char_sel = (ui.char_sel + 1) % n;
    else if (key === "u") g.enhance(SLOTS[ui.char_sel].id);
    else if (key === "r") g.reforge(SLOTS[ui.char_sel].id);
    else if (key === "e") g.unequip(SLOTS[ui.char_sel].id);
  } else if (tab === 2) {
    if (key === "up") ui.bag_sel = Math.max(0, ui.bag_sel - 1);
    else if (key === "down") ui.bag_sel = Math.min(Math.max(0, g.bag.length - 1), ui.bag_sel + 1);
    else if (key === "e") {
      if (g.bag.length) {
        g.equipItem(g.bag[ui.bag_sel]);
        clampBagSel(g);
      }
    } else if (key === "x") { g.sellItem(ui.bag_sel); clampBagSel(g); }
    else if (key === "d") { g.dismantleItem(ui.bag_sel); clampBagSel(g); }
    else if (key === "a") { g.sellJunk(); clampBagSel(g); }
  } else if (tab === 3) {
    const n = SLOTS.length;
    if (key === "up") ui.forge_sel = (ui.forge_sel - 1 + n) % n;
    else if (key === "down") ui.forge_sel = (ui.forge_sel + 1) % n;
    else if (key === "u") g.enhance(SLOTS[ui.forge_sel].id);
    else if (key === "r") g.reforge(SLOTS[ui.forge_sel].id);
  } else if (tab === 4) {
    const zone = ui.skill_zone ?? 1;
    let sel = ui.skill_sel ?? 0;
    const slot = ui.skill_slot ?? 0;
    const pool = (zone === 1 ? ACTIVE_SKILLS : PASSIVE_SKILLS)
      .filter(s => s.cls === g.classId);
    if (key === "left" || key === "right") {
      ui.skill_zone = (zone + (key === "right" ? 1 : 2)) % 3;
      ui.skill_sel = 0;
    } else if (key === "up") {
      if (zone === 0) ui.skill_slot = (slot - 1 + 8) % 8;
      else ui.skill_sel = Math.max(0, sel - 1);
    } else if (key === "down") {
      if (zone === 0) ui.skill_slot = (slot + 1) % 8;
      else ui.skill_sel = Math.min(Math.max(0, pool.length - 1), sel + 1);
    } else if (key === "e") {
      if (zone === 0) {
        const lo = slot < 4 ? g.loadout.active : g.loadout.passive;
        const idx = slot < 4 ? slot : slot - 4;
        if (idx < lo.length) g.unequipSkill(lo[idx]);
      } else {
        const which = zone === 1 ? "active" : "passive";
        if (pool.length && g.level >= pool[sel].unlock) {
          const sid = pool[sel].id;
          if (g.loadout[which].includes(sid)) g.unequipSkill(sid);
          else g.equipSkill(sid, which);
        }
      }
    } else if (key === "u") {
      if (zone === 0) {
        const lo = slot < 4 ? g.loadout.active : g.loadout.passive;
        const idx = slot < 4 ? slot : slot - 4;
        if (idx < lo.length) g.skillUp(lo[idx]);
      } else if (pool.length && g.level >= pool[sel].unlock) {
        g.skillUp(pool[sel].id);
      }
    }
  } else if (tab === 5) {
    if (key === "up") ui.quests_sel = Math.max(0, ui.quests_sel - 1);
    else if (key === "down") ui.quests_sel += 1;
  } else if (tab === 6) {
    if (key === "t") {
      g.settings.auto_equip = !g.settings.auto_equip;
      g.toast(g.settings.auto_equip ? "自动换装:开" : "自动换装:关");
    } else if (key === "j") {
      const idx = g.settings.auto_sell_idx ?? -1;
      g.settings.auto_sell_idx = (idx + 1) % 6 - 1;
      const names = ["关闭", "出售「普通」及以下", "出售「精良」及以下", "出售「稀有」及以下",
        "出售「史诗」及以下", "出售「传说」及以下"];
      g.toast("掉落自动出售:" + names[g.settings.auto_sell_idx + 1]);
    } else if (key === "f") {
      g.setMode(g.mode === "push" ? "farm" : "push");
    } else if (key === "left") g.setFarmStage(-1);
    else if (key === "right") g.setFarmStage(1);
    else if (key === "r") ui.confirm_reset = true;
    else if (key === "n") ui.confirm_reset = false;
    else if (key === "y" && ui.confirm_reset) return "reset";
  }
  return true;
}

// ---------------------------------------------------------------- autopilot
export function autopilot(g: Game, sim = false): void {
  if (g.classId === null) {
    g.chooseClass("warrior");
    return;
  }
  if (Math.trunc(g.time * 10) % 50 !== 0) return;
  // 自动装配:主动=伤害Top3+生存Top1(槽满时第4槽可被生存替换),被动=stat/hook 顺序
  const kinds = ["damage", "multi", "execute"];
  for (const [which, pool] of [["active", ACTIVE_SKILLS], ["passive", PASSIVE_SKILLS]] as const) {
    if (g.loadout[which].length >= g.loadoutSlots()) continue; // 主动/被动槽满都跳过(与 Python 一致)
    const unlocked = pool.filter(s => s.cls === g.classId && g.level >= s.unlock);
    if (which === "active") {
      const lo = g.loadout.active;
      const dmg = unlocked
        .filter((s): s is ActiveSkill => kinds.includes(s.kind))
        .sort((a, b) => -(a.base * (a.hits ?? 1) / a.cd - b.base * (b.hits ?? 1) / b.cd));
      const surv = unlocked.filter(s => ["shield", "heal", "buff"].includes(s.kind));
      if (surv.length && !lo.includes(surv[0].id)) {
        if (lo.length >= g.loadoutSlots() && lo.length) {
          const last = ACTIVE_DEF[lo[lo.length - 1]];
          if (last && kinds.includes(last.kind)) g.unequipSkill(lo[lo.length - 1]);
        }
        if (lo.length < g.loadoutSlots()) g.equipSkill(surv[0].id, "active");
      } else if (lo.length < g.loadoutSlots()) {
        const cands = dmg.slice(0, 4).filter(s => !lo.includes(s.id));
        if (cands.length) g.equipSkill(cands[0].id, "active");
      }
    } else {
      const cands = unlocked
        .filter(s => (s.kind === "stat" || s.kind === "hook") && !g.loadout.passive.includes(s.id));
      if (cands.length && g.loadout.passive.length < g.loadoutSlots()) {
        g.equipSkill(cands[0].id, "passive");
      }
    }
  }
  // 背包维护:快满就按评分清 lowest(防止新掉落被"背包已满自动出售")
  if (g.bag.length > 30) {
    g.bag.sort((a, b) => a.score() - b.score());
    const nDrop = g.bag.length - 20;
    for (const it of g.bag.slice(0, nDrop)) {
      g.gold += it.sellPrice();
      g.stats.gold_earned += it.sellPrice();
    }
    g.bag = g.bag.slice(nDrop);
  }
  // 装备替换:tier 明显更高(≥30)就换(autopilot 专用,弥补评分策略盲区)
  for (const it of [...g.bag]) {
    const cur = g.equip[it.slot];
    if (!cur || it.tier >= cur.tier + 30) g.equipItem(it);
  }
  if (Object.keys(g.equip).length) {
    const items = Object.values(g.equip);
    const slotItem = items.reduce((a, b) => (b.plus < a.plus ? b : a));
    if (g.gold > slotItem.enhanceCost() * 2) g.enhance(slotItem.slot);
  }
  if (g.gold > 2000) {
    for (const sid of [...g.loadout.active, ...g.loadout.passive]) {
      if (g.gold > g.skillCost(sid) * 4) {
        g.skillUp(sid);
        break;
      }
    }
  }
  if (sim && g.mode === "farm" && g.time - g.lastDeathTime > 30) {
    // 装备等级接近当前层才回推进(门槛:装备tier >= 层tier - 12)
    let eqT = 0;
    for (const it of Object.values(g.equip)) eqT = Math.max(eqT, it.tier);
    const curT = g.zone * 10 + g.stage - 1;
    if (eqT >= curT - 12) g.setMode("push");
  }
}
