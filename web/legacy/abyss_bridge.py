# -*- coding: utf-8 -*-
"""网页宿主桥接层:在 Pyodide 中运行,向 JS 暴露游戏接口。

职责仅限 IO 适配(localStorage 存档、帧输出、按键入口),
游戏逻辑全部来自 abyss/ 核心包——与 CLI 宿主共用同一份代码。
"""
import json
import time

from js import localStorage

from abyss import systems
from abyss.game import Game, migrate_save
from abyss.main import handle_key
from abyss.render import render_frame
from abyss.view import View

SAVE_KEY = "abyss_save_v2"

_g = None
_v = View()


def boot():
    """读取 localStorage 存档(含离线结算)或开新档,返回首帧所需状态标记。"""
    global _g
    raw = localStorage.getItem(SAVE_KEY)
    if raw:
        try:
            d = migrate_save(json.loads(str(raw)))
            g = Game.from_dict(d)
            dt = time.time() - d.get("last_saved", time.time())
            rep = systems.resolve_offline(g, dt)
            if rep:
                g.pending_offline = rep
        except Exception:
            g = Game()
            g.log("云档读取失败,已重新开始。", "bright_red")
    else:
        g = Game()
    g.view = _v
    _g = g
    return True


def frame(cols, rows):
    return render_frame(_g, int(cols), int(rows))


def tick(dt):
    """推进一帧;返回 False 表示玩家请求退出。"""
    r = True
    if not _v.ui["paused"]:
        steps = 0
        while dt >= 0.1 and steps < 10:
            _g.tick(0.1)
            dt -= 0.1
            steps += 1
    _v.drain(_g)
    _v.tick(0.1)
    return r


def key(k):
    """按键入口;返回 False 表示退出。"""
    return handle_key(_g, k) is not False


def get_save():
    return json.dumps(_g.to_dict(), ensure_ascii=False)


def save_now():
    localStorage.setItem(SAVE_KEY, get_save())
    return True


def debug_state():
    """调试钩子:网页控制台 __abyss.state() 验证游戏推进。"""
    return "t=%.0fs Lv%d %d区·%d层 kills=%d hp=%d/%d" % (
        _g.time, _g.level, _g.zone, _g.stage, _g.stats["kills"],
        int(_g.hero["hp"]), int(_g.hero["max_hp"]))


def resolve_gap(sec):
    """页面从后台恢复:用懒结算补算离开期间(与关页面重开的离线结算同一路径)。"""
    sec = min(max(0.0, sec), 12 * 3600)
    if sec < 30:
        return "0"
    rep = systems.resolve(_g, sec)
    _g.toast("页面离开 %d 分:补算 %d 击杀 +%d 金币" % (sec // 60, rep["kills"], rep["gold"]))
    return "%d|%d|%d" % (rep["kills"], rep["gold"], rep["levels"])


def import_save(json_text):
    """导入 CLI 存档(save.json 内容);成功返回 True 并在游戏内提示。"""
    global _g
    try:
        d = migrate_save(json.loads(json_text))
    except Exception:
        g2 = _g
        g2.toast("导入失败:存档格式不正确")
        return False
    g = Game.from_dict(d)
    g.view = _v
    _g = g
    save_now()
    g.toast("导入成功:Lv.%d 第%d区·%d层" % (g.level, g.zone, g.stage))
    return True
