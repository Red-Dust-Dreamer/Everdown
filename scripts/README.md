# scripts/ — Python / TS 双实现对拍工具

> **⚠ 已归档(2026-10)**:Python 镜像与对拍工具链已移至 `archive/python-mirror` 分支
> (parity.sh / state_dump.* / test_tower_dump.py 随行)。本文件以下内容为归档时的
> 历史流程记录,仅作参考;现有门禁见 README「开发」节。其余工具(gen-lb-bounds /
> admin-smoke / lb-smoke / gen_sfx / gen_bgm)仍在用。

Python(`abyss/`,基准)与 TS(`src/`)双实现并存,本目录固化对拍流程。
所有工具**只读**游戏代码,绝不触碰项目根下的 `save.json`
(`state_dump.py` 把 autosave 的 `SAVE_PATH` monkey 到临时目录;TS 侧不注入
saveHooks,`save()` 为空操作)。

## 1. parity.sh — sim 输出逐行对拍

```bash
scripts/parity.sh <秒> [seed] [cls]   # 默认 600 / 20260930 / warrior
scripts/parity.sh 60 warrior          # seed 可省略(cls 直接作第 2 参)
```

流程:

1. Python 侧:`py run.py --sim <秒> --seed <N>`
   (run.py 的 `--sim` 未暴露 `--cls`,固定走默认 warrior;mage/ranger 对拍请用
   state_dump);
2. TS 侧:`node --experimental-strip-types src/sim.ts --sim <秒> --seed <N> --cls <cls>`
   (stderr 的 ExperimentalWarning 被丢弃,运行失败时才回显 stderr);
3. 两边 stdout 去除 CR(`tr -d '\r'`)后存
   `/tmp/parity_py.txt`、`/tmp/parity_ts.txt`,先逐行 diff;
4. 不一致时退一步做宽松比较:逐分钟行(含 `│` 分隔的进度行)里比较
   **时间 / Lv / 区 / 层 / 击杀 / 死亡** 6 个关键字段,忽略 金币 / DPS。

退出码与结论:

| 退出码 | 结论 |
| --- | --- |
| 0 | `PARITY OK(逐行一致)` |
| 1 | `PARITY SOFT-OK(关键字段一致,数值字段有偏差)` + 偏差行摘要 |
| 2 | `PARITY FAIL`(关键字段也不一致,或任一侧 sim 运行失败) |

注意:秒数过短(< ~110s)时两侧都不产出任何逐分钟进度行,此时"逐行一致"是
空转一致,脚本会明确提示;建议对拍用 ≥ 300s。

## 2. state_dump.py / state_dump.ts — 状态级对拍

跑指定秒数 sim 后,把完整游戏状态打成同一结构的 JSON(stdout),供逐字段
diff。两侧循环完全同构:

```
Game(seed).choose_class(cls)
循环 int(秒/0.1) 次:
    tick(0.1) → events 清空 → autopilot(sim=true)   # Python: abyss.main._autopilot
                                                       # TS:     src/core/host.ts autopilot
```

```bash
py scripts/state_dump.py  --sim 30 --seed 20260930 --cls warrior > /tmp/state_py.json
node --experimental-strip-types scripts/state_dump.ts \
     --sim 30 --seed 20260930 --cls warrior > /tmp/state_ts.json
diff /tmp/state_py.json /tmp/state_ts.json
```

输出结构(两侧字段集与键序完全一致,`sort_keys` + `indent=2` +
`ensure_ascii=False`):

- `g.to_dict()` 全量(snake_case:gold/level/zone/stage/equip/bag/quests/
  loadout/skill_lv/…;已剔除 `last_saved` 宿主时间戳);
- 附加 `hero` 摘要:`hp/atk/def/max_hp/interval/haste/crit/crit_dmg`,
  保留 4 位小数。

用法要点:

- `--sim`(默认 30)、`--seed`(默认 20260930)、`--cls`(warrior|mage|ranger,
  默认 warrior)三个参数两侧一致;
- 结构 diff(键集)必须零差异;数值差异即双实现行为分歧的定位线索
  (典型:`hero.*` 派生属性、`ema_kill`、金币/DPS 类字段);
- 长时间跑(`--sim > 30`)时 Python 侧的周期性 autosave 落在
  `$TMP/abyss_state_dump_save.json`,与真实存档无关。

## 3. 推荐工作流

1. `scripts/parity.sh 600` 看结论:OK → 收工;SOFT-OK → 数值公式有出入;
   FAIL → 行为分歧;
2. FAIL / SOFT-OK 后,缩小秒数 + 换 seed 复现,再用 state_dump 双版 diff,
   找到第一个不一致的字段向下定位(装备/技能 → hero 派生 → 战斗 tick);
3. 修复后重跑 parity.sh 直至退出码 0。

## 9. gen_sfx.py — 技能音效程序合成(可选工具)

```bash
python scripts/gen_sfx.py    # 重新生成 8 个合成技能音到 src/web/public/sfx/
```

固定随机种子,产物可复现;覆盖 public/sfx 时须 bump sw.js 的 VERSION 强刷缓存。
背景与许可说明见 src/web/public/sfx/README.txt 的 B 组注记。
