#!/usr/bin/env bash
# 打 TapTap H5 小游戏包:相对路径构建 + 规范 zip(第一级唯一英文文件夹,内含 index.html)。
# 用法: bash scripts/package-taptap.sh
# 产物: abyss-idle-taptap-<版本>.zip(上传入口:开发者后台 → 游戏包管理 → 小游戏管理)
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
OUT="abyss-idle-taptap-${VERSION}.zip"

echo "== 构建(base=./,输出 dist-taptap/)"
rm -rf dist-taptap src/web/dist-taptap "$OUT"
# MSYS_NO_PATHCONV: 防 Git Bash 把 VITE_BASE 的路径参数转成本地盘符
# outDir 相对 vite root(src/web)解析,写成 ../../dist-taptap 落到项目根
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" VITE_BASE=./ npx vite build --mode taptap --outDir ../../dist-taptap
rm -rf dist-taptap/admin   # 管理面板仅本地,不进 TapTap 包(锚点:构建之后、grep 校验之前)
rm -f dist-taptap/assets/admin-*.js   # admin 入口的 JS chunk 一并剔除(只删目录会漏进包)

echo "== 校验:产物内不得残留根绝对路径(TapTap 托管在任意子路径)"
if grep -qE '(href|src)="/' dist-taptap/index.html; then
  echo "!! index.html 有绝对路径引用:" && grep -nE '(href|src)="/' dist-taptap/index.html && exit 1
fi
if grep -rqE 'url\("/' dist-taptap/assets/*.css; then
  echo "!! CSS 有绝对路径引用:" && grep -rnE 'url\("/' dist-taptap/assets/*.css && exit 1
fi

echo "== 组包:第一级唯一文件夹 abyssidle/(纯字母命名,稳妥过审)"
rm -rf dist-taptap-pkg && mkdir -p dist-taptap-pkg/abyssidle
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
