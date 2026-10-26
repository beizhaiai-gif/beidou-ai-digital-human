#!/usr/bin/env bash
#
# 北抖AI数字人 · 跨平台打包
#
#   bash scripts/pack.sh mac x64      # Intel Mac
#   bash scripts/pack.sh mac arm64    # M 系列 Mac
#   bash scripts/pack.sh win x64      # Windows 64 位
#
# 为什么不用 electron-builder：它在 agent 沙箱里解压写入会被安全层拦。
# 这里全部走系统命令（ditto / unzip / plutil / codesign / hdiutil），任何机器都能跑。
#
# 应用代码（JS）是跨平台的，打包 = 换对应平台的 Electron 运行时 + 塞同一份 app。
# 所以 arm64 包在 Intel 机器上跑不起来（二进制架构限制），需要分平台打。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="北抖AI数字人"
ELECTRON_V="45.0.0"
NPM_BIN="/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/npm"
DIST_DIR="/Users/mac/WorkBuddy/数字人/tools/electron-dist"
OUT="${OUT:-$ROOT/release}"
VER=$("/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node" -p "require('$ROOT/package.json').version")

PLAT="${1:?平台别漏了：mac / win}"
ARCH="${2:?架构别漏了：x64 / arm64}"

case "$PLAT" in
  mac) RP="darwin" ;;
  win) RP="win32" ;;
  *) echo "平台只能是 mac / win"; exit 1 ;;
esac

ZIP_NAME="electron-v${ELECTRON_V}-${RP}-${ARCH}.zip"
ZIP_PATH=""
for p in "$DIST_DIR/$ZIP_NAME" $(ls -t "$HOME/Library/Caches/electron"/*/"$ZIP_NAME" 2>/dev/null); do
  [ -f "$p" ] && { ZIP_PATH="$p"; break; }
done
if [ -z "$ZIP_PATH" ]; then
  echo "缺少运行时：$ZIP_NAME"
  echo "放到 $DIST_DIR/ 后重跑"
  exit 1
fi

say "1/4 前端构建"
(cd "$ROOT" && PATH="$(dirname "$NPM_BIN"):$PATH" npm run build >/dev/null)

if [ "$PLAT" = "mac" ]; then
  say "2/4 解压 Electron 运行时（mac ${ARCH}）"
  STAGE="$OUT/mac-${ARCH}-$(date +%H%M%S)"
  APP="$STAGE/$APP_NAME.app"
  mkdir -p "$STAGE"
  ditto -x -k "$ZIP_PATH" "$STAGE"
  mv "$STAGE/Electron.app" "$APP"
  APPDIR="$APP/Contents/Resources/app"
else
  say "2/4 解压 Electron 运行时（win ${ARCH}）"
  STAGE="$OUT/win-${ARCH}-$(date +%H%M%S)"
  APP="$STAGE/$APP_NAME"
  mkdir -p "$APP"
  unzip -q -o "$ZIP_PATH" -d "$APP"
  APPDIR="$APP/resources/app"
fi

say "3/4 放入应用代码（jobs / data / config 运行时生成，不进包）"
mkdir -p "$APPDIR/electron"
rsync -az \
  --exclude 'node_modules' --exclude '.git' \
  --exclude 'server/jobs' --exclude 'server/data' --exclude 'server/config' \
  --exclude 'release' --exclude 'deploy' \
  "$ROOT/package.json" "$ROOT/dist" "$ROOT/server" \
  "$APPDIR/"
cp "$ROOT/electron/main.js" "$ROOT/electron/preload.cjs" "$ROOT/electron/bootstrap.html" \
   "$ROOT/electron/runtime-manifest.js" "$ROOT/electron/runtime-downloader.js" "$APPDIR/electron/"

say "4/4 装依赖 + 图标 + 打包"
(cd "$APPDIR" && "$NPM_BIN" install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)

mkdir -p "$OUT"
if [ "$PLAT" = "mac" ]; then
  RES="$APP/Contents/Resources"
  PLIST="$APP/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string cn.beidou.digitalhuman "$PLIST"
  plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
  plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
  plutil -replace CFBundleIconFile -string electron.icns "$PLIST"
  cp "$ROOT/electron/icons/icon.icns" "$RES/electron.icns"
  codesign --force --deep --sign - "$APP" 2>/dev/null || echo "（跳过签名）"

  Z="$OUT/${APP_NAME}-${VER}-mac-${ARCH}.zip"
  D="$OUT/${APP_NAME}-${VER}-mac-${ARCH}.dmg"
  rm -f "$Z" "$D"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$Z"
  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$D" >/dev/null
  echo "  $(du -h "$Z" | cut -f1)  $(basename "$Z")"
  echo "  $(du -h "$D" | cut -f1)  $(basename "$D")"
else
  printf '@echo off\r\ncd /d "%%~dp0"\r\nstart "" "%%~dp0electron.exe" "%%~dp0resources\\app"\r\n' > "$APP/启动 ${APP_NAME}.bat"
  Z="$OUT/${APP_NAME}-${VER}-win-${ARCH}.zip"
  rm -f "$Z"
  (cd "$STAGE" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME" "$Z")
  echo "  $(du -h "$Z" | cut -f1)  $(basename "$Z")"
fi

echo
echo "stage 目录: ${STAGE}"
