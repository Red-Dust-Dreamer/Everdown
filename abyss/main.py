# -*- coding: utf-8 -*-
"""入口:终端初始化 / 输入 / 主循环 / 自检(demo)与平衡模拟(sim)

宿主结构:Game(核心,只产事件)+ View(呈现,消费事件)。
本文件是 CLI 宿主;网页宿主见 web/legacy。
"""
import argparse
import atexit
import shutil
import sys
import time
from pathlib import Path

from .ansi import (CLEAR_SCREEN, CURSOR_HOME, DISABLE_WRAP, ENABLE_WRAP,
                   HIDE_CURSOR, RESET, SHOW_CURSOR, c, enable_vt_mode, fmt, fmt_time)
from .data import SLOTS
from .game import Game
from .render import render_frame
from .view import View

TICK = 0.1
DEFAULT_SEED = 20260930


# ================================================================ 输入
class KeyReader:
    """非阻塞读键,统一映射为符号名"""

    def __init__(self):
        self.win = sys.platform == "win32"
        if not self.win:
            self._tty_setup()

    def _tty_setup(self):
        try:
            import termios
            import tty
            self.termios, self.tty = termios, tty
            self.fd = sys.stdin.fileno()
            self.old = termios.tcgetattr(self.fd)
            tty.setcbreak(self.fd)
            atexit.register(self._tty_restore)
        except Exception:
            self.fd = None

    def _tty_restore(self):
        if getattr(self, "fd", None) is not None:
            try:
                self.termios.tcsetattr(self.fd, self.termios.TCSADRAIN, self.old)
            except Exception:
                pass

    def get_key(self):
        """返回符号名('up'/'down'/'left'/'right'/'enter'/'esc'/单字符小写)或 None"""
        if self.win:
            import msvcrt
            if not msvcrt.kbhit():
                return None
            ch = msvcrt.getwch()
            if ch in ("\x00", "À", "\xe0"):
                code = msvcrt.getwch()
                return {"H": "up", "P": "down", "K": "left", "M": "right"}.get(code, "")
            return self._map(ch)
        else:
            import select
            r, _, _ = select.select([sys.stdin], [], [], 0)
            if not r:
                return None
            ch = sys.stdin.read(1)
            if ch == "\x1b":
                r2, _, _ = select.select([sys.stdin], [], [], 0.02)
                if r2 and sys.stdin.read(1) == "[":
                    c2 = sys.stdin.read(1)
                    return {"A": "up", "B": "down", "D": "left", "C": "right"}.get(c2, "")
                return "esc"
            return self._map(ch)

    @staticmethod
    def _map(ch):
        if ch in ("\r", "\n"):
            return "enter"
        if ch == "\x1b":
            return "esc"
        if ch == "\x03":  # Ctrl+C
            return "quit"
        return ch.lower() if len(ch) == 1 else ch.lower()


# ================================================================ 按键分发
def _clamp_bag_sel(g):
    v = g.view
    v.ui["bag_sel"] = min(v.ui["bag_sel"], max(0, len(g.bag) - 1))


def handle_key(g, key):
    """处理一个按键。返回 True 继续 / False 退出 / 'reset' 重置存档。"""
    if not key:
        return True
    v = g.view
    ui = v.ui

    # 职业选择(新档):1/2/3 三选一
    if g.class_id is None:
        cmap = {"1": "warrior", "2": "mage", "3": "ranger"}
        if key in cmap:
            g.choose_class(cmap[key])
        return True

    if g.pending_offline:
        g.pending_offline = None
        return True
    if ui["help"]:
        ui["help"] = False
        return True

    if key == "quit":
        return False
    if key == "p":
        ui["paused"] = not ui["paused"]
        g.toast("已暂停" if ui["paused"] else "继续")
        return True
    if key == "h":
        ui["help"] = True
        return True
    if key == "s":
        g.save()
        g.toast("已存档")
        return True
    if key == "q":
        return False
    if key in ("1", "2", "3", "4", "5", "6", "7"):
        ui["tab"] = int(key) - 1
        return True
    if key == "f" and ui["tab"] != 6:
        g.set_mode("farm" if g.mode == "push" else "push")
        return True

    tab = ui["tab"]
    if tab == 0:
        pass  # 战斗全自动
    elif tab == 1:  # 角色
        n = len(SLOTS)
        if key == "up":
            ui["char_sel"] = (ui["char_sel"] - 1) % n
        elif key == "down":
            ui["char_sel"] = (ui["char_sel"] + 1) % n
        elif key == "u":
            g.enhance(SLOTS[ui["char_sel"]][0])
        elif key == "r":
            g.reforge(SLOTS[ui["char_sel"]][0])
        elif key == "e":
            g.unequip(SLOTS[ui["char_sel"]][0])
    elif tab == 2:  # 背包
        if key == "up":
            ui["bag_sel"] = max(0, ui["bag_sel"] - 1)
        elif key == "down":
            ui["bag_sel"] = min(max(0, len(g.bag) - 1), ui["bag_sel"] + 1)
        elif key == "e":
            if g.bag:
                g.equip_item(g.bag[ui["bag_sel"]])
                _clamp_bag_sel(g)
        elif key == "x":
            g.sell_item(ui["bag_sel"])
            _clamp_bag_sel(g)
        elif key == "d":
            g.dismantle_item(ui["bag_sel"])
            _clamp_bag_sel(g)
        elif key == "a":
            g.sell_junk()
            _clamp_bag_sel(g)
    elif tab == 3:  # 锻造
        n = len(SLOTS)
        if key == "up":
            ui["forge_sel"] = (ui["forge_sel"] - 1) % n
        elif key == "down":
            ui["forge_sel"] = (ui["forge_sel"] + 1) % n
        elif key == "u":
            g.enhance(SLOTS[ui["forge_sel"]][0])
        elif key == "r":
            g.reforge(SLOTS[ui["forge_sel"]][0])
    elif tab == 4:  # 技能:0装配区 / 1主动池 / 2被动池
        from .data import ACTIVE_SKILLS, PASSIVE_SKILLS, ACTIVE_DEF, PASSIVE_DEF
        zone = ui.get("skill_zone", 1)
        sel = ui.get("skill_sel", 0)
        slot = ui.get("skill_slot", 0)
        pool = [s for s in (ACTIVE_SKILLS if zone == 1 else PASSIVE_SKILLS)
                if s["cls"] == g.class_id]
        if key in ("left", "right"):
            ui["skill_zone"] = (zone + (1 if key == "right" else -1)) % 3
            ui["skill_sel"] = 0
        elif key == "up":
            if zone == 0:
                ui["skill_slot"] = (slot - 1) % 8
            else:
                ui["skill_sel"] = max(0, sel - 1)
        elif key == "down":
            if zone == 0:
                ui["skill_slot"] = (slot + 1) % 8
            else:
                ui["skill_sel"] = min(max(0, len(pool) - 1), sel + 1)
        elif key == "e":
            if zone == 0:
                # 装配区:卸下选中槽位的技能
                lo = g.loadout["active"] if slot < 4 else g.loadout["passive"]
                idx = slot if slot < 4 else slot - 4
                if idx < len(lo):
                    g.unequip_skill(lo[idx])
            else:
                which = "active" if zone == 1 else "passive"
                if pool and g.level >= pool[sel]["unlock"]:
                    sid = pool[sel]["id"]
                    if sid in g.loadout[which]:
                        g.unequip_skill(sid)
                    else:
                        g.equip_skill(sid, which)
        elif key == "u":
            if zone == 0:
                lo = g.loadout["active"] if slot < 4 else g.loadout["passive"]
                idx = slot if slot < 4 else slot - 4
                if idx < len(lo):
                    g.skill_up(lo[idx])
            elif pool and g.level >= pool[sel]["unlock"]:
                g.skill_up(pool[sel]["id"])
    elif tab == 5:  # 悬赏/成就
        if key == "up":
            ui["quests_sel"] = max(0, ui["quests_sel"] - 1)
        elif key == "down":
            ui["quests_sel"] += 1
    elif tab == 6:  # 设置
        if key == "t":
            g.settings["auto_equip"] = not g.settings.get("auto_equip", True)
            g.toast("自动换装:开" if g.settings["auto_equip"] else "自动换装:关")
        elif key == "j":
            idx = g.settings.get("auto_sell_idx", -1)
            g.settings["auto_sell_idx"] = (idx + 1) % 6 - 1
            names = ["关闭", "出售「普通」及以下", "出售「精良」及以下", "出售「稀有」及以下",
                     "出售「史诗」及以下", "出售「传说」及以下"]
            g.toast("掉落自动出售:" + names[g.settings["auto_sell_idx"] + 1])
        elif key == "f":
            g.set_mode("farm" if g.mode == "push" else "push")
        elif key == "left":
            g.set_farm_stage(-1)
        elif key == "right":
            g.set_farm_stage(1)
        elif key == "r":
            ui["confirm_reset"] = True
        elif key == "n":
            ui["confirm_reset"] = False
        elif key == "y" and ui["confirm_reset"]:
            return "reset"
    return True


# ================================================================ 交互主循环
def run_interactive():
    enable_vt_mode()
    out = sys.stdout
    out.write(HIDE_CURSOR + DISABLE_WRAP + CLEAR_SCREEN)
    atexit.register(lambda: out.write(SHOW_CURSOR + ENABLE_WRAP + RESET))

    g = Game.load()
    view = View()
    g.view = view
    reader = KeyReader()
    last = time.perf_counter()
    try:
        while True:
            now = time.perf_counter()
            real_dt = now - last
            last = now

            while True:
                key = reader.get_key()
                if key is None:
                    break
                result = handle_key(g, key)
                if result == "reset":
                    from .game import SAVE_PATH
                    try:
                        SAVE_PATH.unlink()
                    except OSError:
                        pass
                    g = Game()
                    g.view = view
                    g.log("存档已重置,新的冒险开始。", "bright_red")
                    break
                if result is False:
                    raise SystemExit(0)

            # 固定步长推进(暂停时不 tick,游戏时钟随之冻结)
            if not view.ui["paused"]:
                steps = 0
                while real_dt >= TICK and steps < 10:
                    g.tick(TICK)
                    real_dt -= TICK
                    steps += 1
                if real_dt < 0:
                    real_dt = 0

            view.drain(g)
            view.tick(0.1)

            size = shutil.get_terminal_size(fallback=(120, 30))
            frame = render_frame(g, size.columns, size.lines)
            out.write(CURSOR_HOME + frame + "\x1b[0m")
            out.flush()
            time.sleep(0.033)
    except (SystemExit, KeyboardInterrupt):
        pass
    finally:
        g.save()
        out.write(SHOW_CURSOR + ENABLE_WRAP + RESET + "\n")
        out.flush()
        print(c("已存档,再见!下次启动会结算离线收益。", "bright_cyan"))


# ================================================================ 自检 / 模拟
def run_demo(seconds=30.0, seed=DEFAULT_SEED):
    """渲染+逻辑自检:轮询所有标签页渲染,模拟挂机玩家行为"""
    import tempfile
    from . import game as game_mod
    game_mod.SAVE_PATH = Path(tempfile.gettempdir()) / "abyss_demo_save.json"
    g = Game(seed=seed)
    view = View()
    g.view = view
    steps = int(seconds / TICK)
    tab = 0
    for i in range(steps):
        g.tick(TICK)
        view.drain(g)
        view.tick(TICK)
        if i % 20 == 0:  # 每2秒换一个页签,全部渲染一遍
            view.ui["tab"] = tab % 7
            tab += 1
        _autopilot(g)
        if i % 100 == 99:  # 每10秒渲染一帧,捕获渲染异常
            render_frame(g, 100, 30)
    render_frame(g, 100, 30)
    for t in range(7):
        view.ui["tab"] = t
        render_frame(g, 100, 30)
    view.ui["help"] = True
    render_frame(g, 100, 30)
    view.ui["help"] = False
    g.pending_offline = {"sec": 3600, "kills": 900, "gold": 12345, "xp": 8888,
                         "items": g.bag[:4], "applied": True}
    render_frame(g, 100, 30)
    # 存档往返
    g.save()
    g2 = Game.load()
    g2.view = view
    assert g2.level == g.level and g2.gold == g.gold and len(g2.bag) == len(g.bag)
    print(c("[DEMO PASS]", "bright_green"))
    _summary(g, seconds)
    return 0


def _autopilot(g, sim=False):
    """模拟挂机玩家:自动装配新技能、强化最低强化装备、升级技能;
    卡墙自动转挂机(游戏内置),刷一段时间无死亡再切回推进"""
    if g.class_id is None:
        g.choose_class("warrior")
        return
    if int(g.time * 10) % 50 != 0:
        return
    # 自动装配:新解锁的技能补进空槽(主动优先伤害/增益,被动优先数值)
    from .data import ACTIVE_SKILLS, PASSIVE_SKILLS
    for which, pool in (("active", ACTIVE_SKILLS), ("passive", PASSIVE_SKILLS)):
        for s in pool:
            if s["cls"] != g.class_id or g.level < s["unlock"]:
                continue
            if s["id"] in g.loadout[which]:
                continue
            if len(g.loadout[which]) < g.loadout_slots():
                g.equip_skill(s["id"], which)
                break
    # 装备强化
    if g.equip:
        slot_item = min(g.equip.values(), key=lambda it: it.plus)
        if g.gold > slot_item.enhance_cost() * 2:
            g.enhance(slot_item.slot)
    # 技能升级:金币充裕时轮转升已装配技能
    if g.gold > 2000:
        for sid in g.loadout["active"] + g.loadout["passive"]:
            if g.gold > g.skill_cost(sid) * 4:
                g.skill_up(sid)
                break
    if sim and g.mode == "farm" and (g.time - g.last_death_time) > 60:
        g.set_mode("push")


def run_sim(seconds=1800.0, verbose=True, seed=DEFAULT_SEED, cls="warrior"):
    """平衡模拟:无渲染,输出进度报告(同 seed 可复现)"""
    import tempfile
    from . import game as game_mod
    game_mod.SAVE_PATH = Path(tempfile.gettempdir()) / "abyss_sim_save.json"
    g = Game(seed=seed)
    g.choose_class(cls)
    steps = int(seconds / TICK)
    marks = {}
    for i in range(steps):
        g.tick(TICK)
        g.events.clear()
        _autopilot(g, sim=True)
        m = int(g.time) // 60
        if m and i % 100 == 0 and m not in marks:
            marks[m] = True
            if verbose:
                print("  %6s │ Lv%-3d │ 第%d区·%d层 │ 击杀%-6d │ 死亡%-4d │ 金币%s │ DPS %s" % (
                    fmt_time(g.time), g.level, g.zone, g.stage, g.stats["kills"],
                    g.stats["deaths"], fmt(g.gold), fmt(g.theoretical_dps())))
    if verbose:
        print()
    return 0


def _summary(g, seconds):
    print("  模拟时长 %s │ Lv.%d │ 第%d区·%d层 │ 击杀 %d │ 头目 %d │ 死亡 %d" % (
        fmt_time(seconds), g.level, g.zone, g.stage, g.stats["kills"],
        g.stats["boss_kills"], g.stats["deaths"]))
    print("  金币 %s │ 重铸石 %d │ 背包 %d 件 │ 装备评分 %s │ DPS %s" % (
        fmt(g.gold), g.stones, len(g.bag),
        fmt(sum(i.score() for i in g.equip.values())), fmt(g.theoretical_dps())))


def main(argv=None):
    ap = argparse.ArgumentParser(description="深渊挂机 — 终端放置刷宝游戏")
    ap.add_argument("--demo", nargs="?", type=float, const=30.0, metavar="秒",
                    help="自检模式:模拟运行并渲染全部界面")
    ap.add_argument("--sim", nargs="?", type=float, const=1800.0, metavar="秒",
                    help="平衡模拟:无渲染运行,输出进度报告")
    ap.add_argument("--seed", type=int, default=None, metavar="N",
                    help="随机种子(默认自检/模拟用固定种子,新游戏随机)")
    ap.add_argument("--new", action="store_true", help="忽略存档重新开始")
    args = ap.parse_args(argv)
    seed = args.seed if args.seed is not None else DEFAULT_SEED
    if args.demo is not None:
        return run_demo(args.demo, seed)
    if args.sim is not None:
        return run_sim(args.sim, seed=seed)
    if args.new:
        from .game import SAVE_PATH
        try:
            SAVE_PATH.unlink()
        except OSError:
            pass
    run_interactive()
    return 0


if __name__ == "__main__":
    sys.exit(main())
