#!/usr/bin/env bash
# 打 TapTap H5 小游戏包:相对路径构建 + 规范 zip(第一级唯一英文文件夹,内含 index.html)。
# 用法: bash scripts/package-taptap.sh
# 产物: abyss-idle-taptap-<版本>.zip(上传入口:开发者后台 → 游戏包管理 → 小游戏管理)
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
OUT="abyss-idle-taptap-${VERSION}.zip"
# TapTap 版排行榜 = 官方排行榜服务(tap.getLeaderboardManager,免 SDK;2026-11-08 起,
# 2.10.1 因自建联网被 ICP 拒审后整体切换)。五个榜单 ID 在开发者中心「游戏服务→游戏排行」
# 创建(降序/周榜/保留最高分),逗号序:主线,等级,爬塔,战力,转生。
TT_LB_IDS="${VITE_TT_LB_IDS:-}"
if [ -z "$TT_LB_IDS" ]; then
  TT_LB_IDS="unset-tt-board-ids"   # 本地预览用占位;正式出包必须传真实 ID(断言防呆)
  echo "!! 未设置 VITE_TT_LB_IDS(五榜 ID),使用占位——仅限本地预览,勿上传"
fi

echo "== 构建(base=./,TT_LB_IDS=$TT_LB_IDS,输出 dist-taptap/)"
rm -rf dist-taptap src/web/dist-taptap "$OUT"
# MSYS_NO_PATHCONV: 防 Git Bash 把 VITE_BASE 的路径参数转成本地盘符
# outDir 相对 vite root(src/web)解析,写成 ../../dist-taptap 落到项目根
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" VITE_BASE=./ VITE_TT_LB_IDS="$TT_LB_IDS" npx vite build --mode taptap --outDir ../../dist-taptap
rm -rf dist-taptap/admin   # 管理面板仅本地,不进 TapTap 包(锚点:构建之后、grep 校验之前)
rm -f dist-taptap/assets/admin-*.js   # admin 入口的 JS chunk 一并剔除(只删目录会漏进包)
rm -f dist-taptap/assets/cloud-*.js   # 云存档 chunk(Supabase):TT_MODE 下动态 import 被消除但 chunk 仍会被 rollup 产出,剔掉
rm -rf dist-taptap/vendor             # admin 控制台依赖(xterm 终端库),游戏本体不引用

echo "== 校验:产物内不得残留根绝对路径(TapTap 托管在任意子路径)"
if grep -qE '(href|src)="/' dist-taptap/index.html; then
  echo "!! index.html 有绝对路径引用:" && grep -nE '(href|src)="/' dist-taptap/index.html && exit 1
fi
if grep -rqE 'url\("/' dist-taptap/assets/*.css; then
  echo "!! CSS 有绝对路径引用:" && grep -rnE 'url\("/' dist-taptap/assets/*.css && exit 1
fi

echo "== 校验:五个榜单 ID 已注入产物(防 VITE_TT_LB_IDS 替换失效)"
if ! grep -qF -- "${TT_LB_IDS%%,*}" dist-taptap/assets/main-*.js; then
  echo "!! 构建产物 JS 里找不到榜单 ID ${TT_LB_IDS%%,*}(VITE_TT_LB_IDS 注入失效)" && exit 1
fi

echo "== 校验:纯度断言——产物内自建联网端点必须零残留(2026-11-08 ICP 拒审对策;"
echo "   TapTap 版仅允许官方 tap.* 排行榜,自建 LB/BOSS/切磋/存档/Supabase 全部不进包)"
PURITY_HITS=$(grep -roE '47\.118\.52\.5|47\.99\.151\.214|workers\.dev|supabase[a-z.]*' \
     dist-taptap/index.html dist-taptap/assets/*.js dist-taptap/assets/*.css 2>/dev/null | head -5 || true)
if [ -n "$PURITY_HITS" ]; then
  echo "$PURITY_HITS"
  echo "!! TapTap 产物检出自建联网端点残留(见上方命中),禁止出包" && exit 1
fi

echo "== 组包:第一级唯一文件夹 abyssidle/(纯字母命名,稳妥过审)"
# 清内层而非父目录:Windows 下父目录可能被进程占 cwd 删不掉,残留旧哈希会混进包
rm -rf dist-taptap-pkg/abyssidle && mkdir -p dist-taptap-pkg/abyssidle
cp -r dist-taptap/. dist-taptap-pkg/abyssidle/

py - "$OUT" <<'PYEOF'
import os, sys, zipfile
root = "dist-taptap-pkg"
out = sys.argv[1]
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dp, _, files in os.walk(root):
        for f in sorted(files):
            p = os.path.join(dp, f)
            z.write(p, os.path.relpath(p, root).replace(os.sep, "/"))  # zip 内统一正斜杠
            n += 1
print(f"== 完成: {out}({n} 个文件,{os.path.getsize(out)/1024/1024:.2f} MB)")
PYEOF
