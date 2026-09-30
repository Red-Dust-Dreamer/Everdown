# -*- coding: utf-8 -*-
"""ANSI 颜色 / 宽度对齐 / 进度条 / 数值格式化 等终端渲染原语(纯 stdlib)"""
import re
import sys

RESET = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
INVERT = "\x1b[7m"
HIDE_CURSOR = "\x1b[?25l"
SHOW_CURSOR = "\x1b[?25h"
DISABLE_WRAP = "\x1b[?7l"
ENABLE_WRAP = "\x1b[?7h"
CLEAR_SCREEN = "\x1b[2J"
CURSOR_HOME = "\x1b[H"

# 前景色表
_FG = {
    "black": 30, "red": 31, "green": 32, "yellow": 33,
    "blue": 34, "magenta": 35, "cyan": 36, "white": 37,
    "bright_black": 90, "bright_red": 91, "bright_green": 92,
    "bright_yellow": 93, "bright_blue": 94, "bright_magenta": 95,
    "bright_cyan": 96, "bright_white": 97,
}
_BG = {k: v + 10 for k, v in _FG.items()}

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def c(text, fg=None, bg=None, bold=False, dim=False):
    """给文本上色"""
    parts = []
    if bold:
        parts.append(BOLD)
    if dim:
        parts.append(DIM)
    if fg and fg in _FG:
        parts.append("\x1b[%dm" % _FG[fg])
    if bg and bg in _BG:
        parts.append("\x1b[%dm" % _BG[bg])
    if not parts:
        return str(text)
    return "".join(parts) + str(text) + RESET


def strip_ansi(s):
    return _ANSI_RE.sub("", s)


def _char_width(ch):
    o = ord(ch)
    if (0x1100 <= o <= 0x115F or 0x2E80 <= o <= 0xA4CF
            or 0xAC00 <= o <= 0xD7A3 or 0xF900 <= o <= 0xFAFF
            or 0xFE10 <= o <= 0xFE19 or 0xFE30 <= o <= 0xFE6F
            or 0xFF00 <= o <= 0xFF60 or 0xFFE0 <= o <= 0xFFE6):
        return 2
    return 1


def dwidth(s):
    """显示宽度:中日韩字符按 2 格计"""
    return sum(_char_width(ch) for ch in strip_ansi(s))


def pad(s, width, align="left"):
    """按显示宽度补齐(已含 ANSI 颜色的字符串也安全)"""
    gap = width - dwidth(s)
    if gap <= 0:
        return s
    if align == "right":
        return " " * gap + s
    if align == "center":
        left = gap // 2
        return " " * left + s + " " * (gap - left)
    return s + " " * gap


def trunc(s, width):
    """按显示宽度截断(保留其中的 ANSI 颜色序列)"""
    out, w, in_esc = "", 0, False
    for ch in s:
        if ch == "\x1b":
            in_esc = True
            out += ch
            continue
        if in_esc:
            out += ch
            if ch.isalpha():
                in_esc = False
            continue
        cw = _char_width(ch)
        if w + cw > width:
            break
        out += ch
        w += cw
    if in_esc:
        out += RESET
    return out


def bar(cur, mx, width, color="green", fill="█", empty="░"):
    """血条/经验条:cur/mx 比例"""
    if mx <= 0:
        mx = 1
    cur = max(0, min(cur, mx))
    filled = int(round(width * cur / mx))
    inner = c(fill * filled, color, bold=True) + c(empty * (width - filled), "bright_black")
    return inner


def pct(x):
    return "%d%%" % round(x * 100)


def fmt(n):
    """中文计数单位:万 / 亿 / 兆 / 京"""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return str(n)
    neg = n < 0
    n = abs(n)
    for div, suf in ((1e16, "京"), (1e12, "兆"), (1e8, "亿"), (1e4, "万")):
        if n >= div:
            s = ("%.2f" % (n / div)).rstrip("0").rstrip(".")
            return ("-" if neg else "") + s + suf
    return ("-" if neg else "") + "%d" % round(n)


def fmt_time(sec):
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return "%d:%02d:%02d" % (h, m, s)
    return "%02d:%02d" % (m, s)


def enable_vt_mode():
    """Windows 下开启 ANSI 转义支持 + UTF-8 输出,返回是否成功"""
    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)
            mode = ctypes.c_uint32()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                kernel32.SetConsoleMode(
                    handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        except Exception:
            pass
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
