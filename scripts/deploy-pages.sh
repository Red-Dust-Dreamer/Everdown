#!/usr/bin/env bash
# 一键部署到 GitHub Pages(gh-pages orphan 分支,只含构建产物)
# 用法: bash scripts/deploy-pages.sh [仓库URL]   # 默认取 git remote origin
# 部署后在仓库网页 Settings → Pages → Branch 选 gh-pages(仅需一次)。
set -e
cd "$(dirname "$0")/.."

REMOTE="${1:-$(git remote get-url origin)}"
echo "== 构建(base=/Everdown/,输出 dist-gh/)"
rm -rf dist-gh src/web/dist-gh
# MSYS_NO_PATHCONV: 防 Git Bash 把 /Everdown/ 转成本地路径
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" VITE_BASE=/Everdown/ npx vite build --outDir dist-gh
rm -rf src/web/dist-gh/admin   # 管理面板仅本地,不进 gh-pages(锚点:构建之后、cd 之前)

echo "== 检查产物路径"
grep -o '/Everdown/assets/[a-zA-Z0-9_-]*\.js' src/web/dist-gh/index.html | head -2

echo "== 推送 gh-pages 分支 -> $REMOTE"
cd src/web/dist-gh
git init -q
git checkout -q -b gh-pages
git add -A
GIT_AUTHOR_NAME="deploy" GIT_AUTHOR_EMAIL="deploy@local" \
GIT_COMMITTER_NAME="deploy" GIT_COMMITTER_EMAIL="deploy@local" \
  git commit -qm "deploy $(date +%Y-%m-%d\ %H:%M:%S)"
git push -q -f "$REMOTE" gh-pages
echo "== 完成:请到仓库 Settings → Pages → Branch 选 gh-pages(首次设置,之后免管)"
