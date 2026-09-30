# -*- coding: utf-8 -*-
"""View:CLI 宿主的呈现层。

核心(Game)只产出事件元组 (kind, text, color),由本层消费为:
日志环形缓冲 / 伤害飘字 / toast / 互撞动画计时器。
服务器宿主(P3)会把同一事件流聚合为 EventsSummary,而不是接 View。
"""
from collections import deque

LOG_CAP = 60
FLOATER_CAP = 5
FLOATER_TTL = 1.2
TOAST_TTL = 2.0
BUMP_TTL = 0.24              # 互撞动画时长:10Hz 逻辑下可见 2~3 帧
FLASH_TTL = 0.15


class View:
    def __init__(self):
        # 页面/选中/暂停等交互状态(不存档,宿主私有)
        self.ui = {"tab": 0, "bag_sel": 0, "forge_sel": 0, "skill_sel": 0,
                   "char_sel": 0, "paused": False, "help": False,
                   "confirm_reset": False, "quests_sel": 0}
        self.logbuf = deque(maxlen=LOG_CAP)
        self.floaters = []          # [{text, color, ttl}]
        self.toast = ""
        self.toast_ttl = 0.0
        self.hero_bump = 0.0        # 互撞动画:英雄卡片向右顶
        self.mob_bump = 0.0         # 怪物卡片向左顶
        self.mob_flash = 0.0        # 怪物受击高亮

    # ------------------------------------------------------------ 事件消费
    def drain(self, g):
        """把核心累积的事件搬进呈现层,清空核心队列。"""
        for kind, text, color in g.events:
            if kind == "log":
                self.logbuf.append((text, color))
            elif kind == "floater":
                self.floaters.append({"text": text, "color": color, "ttl": FLOATER_TTL})
                if len(self.floaters) > FLOATER_CAP:
                    self.floaters.pop(0)
            elif kind == "toast":
                self.toast = text
                self.toast_ttl = TOAST_TTL
            elif kind == "anim":
                if text == "hero_attack":
                    self.hero_bump = BUMP_TTL
                elif text == "mob_attack":
                    self.mob_bump = BUMP_TTL
                elif text == "mob_flash":
                    self.mob_flash = FLASH_TTL
        g.events.clear()

    # ------------------------------------------------------------ 帧推进
    def tick(self, dt):
        if self.toast_ttl > 0:
            self.toast_ttl -= dt
            if self.toast_ttl <= 0:
                self.toast = ""
        for f in self.floaters[:]:
            f["ttl"] -= dt
            if f["ttl"] <= 0:
                self.floaters.remove(f)
        if self.hero_bump > 0:
            self.hero_bump = max(0.0, self.hero_bump - dt)
        if self.mob_bump > 0:
            self.mob_bump = max(0.0, self.mob_bump - dt)
        if self.mob_flash > 0:
            self.mob_flash = max(0.0, self.mob_flash - dt)
