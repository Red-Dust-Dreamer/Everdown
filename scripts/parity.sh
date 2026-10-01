#!/usr/bin/env bash
# =====================================================================
# parity.sh — Python(abyss/,基准)与 TS(src/)双实现 sim 输出对拍
#
# 用法:
#   scripts/parity.sh <秒> [seed] [cls]
#   scripts/parity.sh            # 默认 600 / 20260930 / warrior
#   scripts/parity.sh 60 warrior # seed 可省略(cls 直接作第 2 参)
#
# 说明:
#   - Python 侧: py run.py --sim <秒> --seed <N>(--cls 未暴露,固定走默认 warrior)
#   - TS 侧:    node --experimental-strip-types src/sim.ts --sim <秒> --seed <N> --cls <cls>
#   - 两边 stdout 统一去掉 CR(tr -d '\r')后存 /tmp/parity_py.txt、/tmp/parity_ts.txt
#   - TS 的 ExperimentalWarning(stderr)被丢弃;运行失败时会把 stderr 打出来
#
# 判定(退出码):
#   0  PARITY OK(逐行一致)
#   1  PARITY SOFT-OK(关键字段一致,数值字段有偏差)
#   2  PARITY FAIL(关键字段也不一致,或任一侧运行失败)
# =====================================================================
set -o pipefail
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_OUT=/tmp/parity_py.txt
TS_OUT=/tmp/parity_ts.txt
PY_ERR=/tmp/parity_py.err
TS_ERR=/tmp/parity_ts.err
PY_KEYS=/tmp/parity_py.keys
TS_KEYS=/tmp/parity_ts.keys

SEC="${1:-600}"
SEED="${2:-20260930}"
CLS="${3:-warrior}"
# 宽容解析:第 2 参不是数字时视为 cls(即 `parity.sh 60 warrior` 这种省略 seed 的写法)
if [[ ! "$SEED" =~ ^[0-9]+$ ]]; then
  CLS="$SEED"
  SEED=20260930
fi

echo "== 对拍参数: 秒=$SEC seed=$SEED cls=$CLS"
echo "   (Python run.py --sim 未暴露 --cls,固定默认 warrior)"

# ---------------------------------------------------------------- 运行两侧
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

echo "== 运行 Python sim -> $PY_OUT"
if ! py "$ROOT/run.py" --sim "$SEC" --seed "$SEED" 2>"$PY_ERR" | tr -d '\r' > "$PY_OUT"; then
  echo "[Python sim 运行失败] stderr:"
  cat "$PY_ERR"
  echo "PARITY FAIL"
  exit 2
fi

echo "== 运行 TS sim -> $TS_OUT"
if ! node --experimental-strip-types "$ROOT/src/sim.ts" \
      --sim "$SEC" --seed "$SEED" --cls "$CLS" 2>"$TS_ERR" | tr -d '\r' > "$TS_OUT"; then
  echo "[TS sim 运行失败] stderr:"
  cat "$TS_ERR"
  echo "PARITY FAIL"
  exit 2
fi

PY_LINES=$(grep -c '│' "$PY_OUT" || true)
TS_LINES=$(grep -c '│' "$TS_OUT" || true)
echo "== 逐分钟进度行: Python=$PY_LINES TS=$TS_LINES"

# ---------------------------------------------------------------- 1) 逐行一致
if diff -q "$PY_OUT" "$TS_OUT" >/dev/null; then
  echo "PARITY OK(逐行一致)"
  if [[ "$PY_LINES" -eq 0 ]]; then
    echo "  注意: 秒数过短,本次没有任何逐分钟进度行参与比较(结论为空转一致)"
  fi
  exit 0
fi

# ---------------------------------------------------------------- 2) 不一致:先看逐行 diff
echo
echo "== 逐行 diff(前 10 处):"
diff "$PY_OUT" "$TS_OUT" | head -10

# ---------------------------------------------------------------- 3) 宽松比较:关键字段
# 逐分钟行格式: "  01:00 │ Lv2 │ 第1区·5层 │ 击杀12 │ 死亡0 │ 金币61 │ DPS 29"
# 关键字段 = 时间/Lv/区/层/击杀/死亡;金币与 DPS 忽略。
parse_keys() {
  awk -F'│' 'NF>=7 {
    t=$1;  gsub(/[[:space:]]/, "", t);
    lv=$2; gsub(/[^0-9]/, "", lv);
    z3=$3; sub(/^[^0-9]*/, "", z3);     # 去掉前导非数字,避免 split 产生空首元素
    split(z3, zs, /[^0-9]+/);           # 第X区·Y层 -> zs[1]=区 zs[2]=层
    k=$4; gsub(/[^0-9]/, "", k);
    d=$5; gsub(/[^0-9]/, "", d);
    print t, lv, zs[1], zs[2], k, d;
  }' "$1"
}
parse_keys "$PY_OUT" > "$PY_KEYS"
parse_keys "$TS_OUT" > "$TS_KEYS"

echo
echo "== 宽松比较(关键字段: 时间/Lv/区/层/击杀/死亡;忽略 金币/DPS)"
echo "   解析到关键字段行: Python=$(wc -l < "$PY_KEYS") TS=$(wc -l < "$TS_KEYS")"

if [[ ! -s "$PY_KEYS" && ! -s "$TS_KEYS" ]]; then
  echo "PARITY FAIL(两侧均无逐分钟行可供宽松比较,且逐行输出不一致)"
  exit 2
fi

if diff -q "$PY_KEYS" "$TS_KEYS" >/dev/null; then
  # 关键字段全部一致 → 数值字段(金币/DPS)偏差
  NUM_DIFF=$(paste -d'\t' <(grep '│' "$PY_OUT") <(grep '│' "$TS_OUT") \
             | awk -F'\t' '$1!=$2' | wc -l)
  echo "PARITY SOFT-OK(关键字段一致,数值字段有偏差)"
  echo "   关键字段一致行数: $(wc -l < "$PY_KEYS");金币/DPS 有偏差的行数: $NUM_DIFF"
  echo "   偏差行摘要(前 3 行,PY vs TS):"
  paste -d'\t' <(grep '│' "$PY_OUT") <(grep '│' "$TS_OUT") \
    | awk -F'\t' '$1!=$2 {print "    PY |" $1; print "    TS |" $2; n++; if (n>=3) exit}' \
    | sed 's/│/ | /g'
  exit 1
fi

echo "   关键字段 diff(前 10 处):"
diff "$PY_KEYS" "$TS_KEYS" | head -10
echo
echo "PARITY FAIL"
exit 2
