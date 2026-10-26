#!/usr/bin/env bash
#
# 北抖AI数字人 · Windows 打包（x64）
#
#   bash scripts/pack_win.sh
#
# 产物：release/北抖AI数字人-<版本>-win-x64.zip
# 解压后双击「启动 北抖AI数字人.bat」即可（会自动拉起后台服务）。
#
# 说明：图标需要 rcedit（Windows PE 资源编辑器）。没装就跳过图标，
# 程序照常能跑，只是 Windows 任务栏显示 Electron 默认图标。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="北抖AI数字人"
VER=$(/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node -p "require('$ROOT/package.json').version")
OUT="${OUT:-$ROOT/release}"
STAGE="$OUT/win-stage-$(date +%H%M%S)"
APP="$STAGE/$APP_NAME"
NPM_BIN="/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/npm"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

say "1/5 前端构建"
(cd "$ROOT" && PATH="$(dirname "$NPM_BIN"):$PATH" npm run build >/dev/null)

say "2/5 解压 Electron 运行时（win x64）"
mkdir -p "$APP"
CACHE_ZIP=$(ls -t /Users/mac/WorkBuddy/数字人/tools/electron-dist/electron-v*-win32-x64.zip 2>/dev/null | head -1 || true)
if [ -z "$CACHE_ZIP" ]; then
  echo "没找到 windows 版 electron zip"
  exit 1
fi
# 注意：zip 里可能有资源派生文件（__MACOSX），只取真正的内容
unzip -q -o "$CACHE_ZIP" -d "$APP"

say "3/5 放入应用代码"
mkdir -p "$APP/resources/app/electron"
rsync -az \
  --exclude 'node_modules' --exclude '.git' \
  --exclude 'server/jobs' --exclude 'server/data' --exclude 'server/config' \
  --exclude 'release' --exclude 'deploy' \
  "$ROOT/package.json" "$ROOT/dist" "$ROOT/server" \
  "$APP/resources/app/"
cp "$ROOT/electron/main.js" "$ROOT/electron/preload.cjs" "$APP/resources/app/electron/"

say "4/5 安装运行时依赖（express / cors）"
(cd "$APP/resources/app" && "$NPM_BIN" install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)

say "5/5 打包 zip"
ZIP="$OUT/${APP_NAME}-${VER}-win-x64.zip"
rm -f "$ZIP"
(cd "$STAGE" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME" "$ZIP")

echo
echo "完成："
ls -lh "$ZIP" | awk '{print "  " $5 "  " $9}'
echo "zip 内结构："
(cd "$STAGE" && find "$APP_NAME" -maxdepth 3 -not -path "*/node_modules/*" | head -12)
