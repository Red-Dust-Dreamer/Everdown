# -*- coding: utf-8 -*-
"""跑 Python sim 指定秒数后,打印完整状态 JSON(供与 TS 版对拍状态)。

用法:
    py scripts/state_dump.py                      # 默认 30s / seed 20260930 / warrior
    py scripts/state_dump.py --sim 60 --seed 20260930 --cls warrior
    py scripts/state_dump.py --sim 60 > /tmp/state_py.json

与 abyss/main.py run_sim 完全同构:
    Game(seed).choose_class(cls)
    循环 int(sim/0.1) 次: g.tick(0.1) → g.events.clear() → _autopilot(g, sim=True)
注意:
    - monkey abyss.game.SAVE_PATH 到临时目录,避免 tick 内的 30s autosave
      覆盖项目根下的真实 save.json;
    - 输出为 g.to_dict() + hero 摘要(hp/atk/def/max_hp/interval/haste/crit/crit_dmg,
      保留 4 位小数);loadout / skill_lv 已含于 to_dict;
    - 剔除 last_saved(宿主墙钟时间戳,非游戏状态,两侧必然不同);
    - sort_keys + ensure_ascii=False + indent=2,键序即 TS 版(state_dump.ts)的基准。
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from abyss import game as game_mod  # noqa: E402
from abyss.game import Game         # noqa: E402
from abyss.main import _autopilot   # noqa: E402

TICK = 0.1
HERO_KEYS = ("hp", "atk", "def", "max_hp", "interval", "haste", "crit", "crit_dmg")


def build_dump(g):
    d = dict(g.to_dict())
    d.pop("last_saved", None)  # 宿主时间戳,非游戏状态
    d["hero"] = {k: round(float(g.hero.get(k, 0.0)), 4) for k in HERO_KEYS}
    # loadout / skill_lv 来自 to_dict,保持 snake_case 原样
    return d


def main(argv=None):
    ap = argparse.ArgumentParser(description="深渊挂机 — Python 状态转储(对拍用)")
    ap.add_argument("--sim", type=float, default=30.0, metavar="秒",
                    help="模拟时长(默认 30)")
    ap.add_argument("--seed", type=int, default=20260930, metavar="N",
                    help="随机种子(默认 20260930)")
    ap.add_argument("--cls", default="warrior", metavar="cls",
                    help="职业 warrior|mage|ranger(默认 warrior)")
    args = ap.parse_args(argv)

    # autosave 落临时文件,绝不触碰真实存档
    game_mod.SAVE_PATH = Path(tempfile.gettempdir()) / "abyss_state_dump_save.json"

    g = Game(seed=args.seed)
    g.choose_class(args.cls)
    for _ in range(int(args.sim / TICK)):
        g.tick(TICK)
        g.events.clear()
        _autopilot(g, sim=True)

    try:  # Windows 管道下强制 UTF-8,保证中文原样输出
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(json.dumps(build_dump(g), sort_keys=True, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
