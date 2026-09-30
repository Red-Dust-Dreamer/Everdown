# -*- coding: utf-8 -*-
"""深渊挂机 — 入口
用法:
    python run.py            开始游戏
    python run.py --demo     自检
    python run.py --sim 3600 平衡模拟
"""
import sys

from abyss.main import main

if __name__ == "__main__":
    sys.exit(main())
