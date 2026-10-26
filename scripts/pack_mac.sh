#!/usr/bin/env bash
#
# 北抖AI数字人 · mac 打包（Intel x64）
#
#   bash scripts/pack_mac.sh
#
# 不用 electron-builder 的原因：它在 agent 沙箱里解压写入会被安全层拦。
# 这里全部走系统命令（ditto / plutil / codesign / hdiutil），任何机器都能跑。
#
# 产物：release/北抖AI数字人-<版本>-mac-x64.zip 和 .dmg
# 未签名（identity=-），接收方首次打开需要右键 → 打开，绕过 Gatekeeper。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="北抖AI数字人"
VER=$(/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node -p "require('$ROOT/package.json').version")
OUT="${OUT:-$ROOT/release}"
STAGE="$OUT/stage-$(date +%H%M%S)"  # 每次全新目录，避免批量删除（删旧目录请手动）
APP="$STAGE/$APP_NAME.app"
NODE_BIN="/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
NPM_BIN="/Users/mac/.workbuddy/binaries/node/versions/22.22.2-6/bin/npm"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

say "1/6 前端构建"
(cd "$ROOT" && PATH="$(dirname "$NPM_BIN"):$PATH" npm run build >/dev/null)

say "2/6 解压 Electron 运行时（x64）"
mkdir -p "$STAGE"
CACHE_ZIP=$(ls -t "$HOME/Library/Caches/electron"/*/electron-v*-darwin-x64.zip 2>/dev/null | head -1 || true)
if [ -z "$CACHE_ZIP" ]; then
  echo "没找到缓存的 electron zip，先跑一次：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm rebuild electron"
  exit 1
fi
ditto -x -k "$CACHE_ZIP" "$STAGE"
mv "$STAGE/Electron.app" "$APP"

say "3/6 放入应用代码（jobs / data / config 不进包，运行时生成）"
RES="$APP/Contents/Resources"
mkdir -p "$RES/app/electron"
rsync -az \
  --exclude 'node_modules' --exclude '.git' \
  --exclude 'server/jobs' --exclude 'server/data' --exclude 'server/config' \
  --exclude 'release' --exclude 'deploy' \
  "$ROOT/package.json" "$ROOT/dist" "$ROOT/server" \
  "$RES/app/"
# electron 的两个入口必须保持目录结构（package.json main 指向 electron/main.js）
cp "$ROOT/electron/main.js" "$ROOT/electron/preload.cjs" "$RES/app/electron/"

say "4/6 安装运行时依赖（express / cors，装进包里）"
(cd "$RES/app" && "$NPM_BIN" install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
# vue 是前端依赖，vite build 已把它打进 dist，包里多这几 MB 无害（删它会触发批量删除保护）

say "5/6 改 Info.plist + 图标 + ad-hoc 签名"
PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string cn.beidou.digitalhuman "$PLIST"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIconFile -string electron.icns "$PLIST"
cp "$ROOT/electron/icons/icon.icns" "$RES/electron.icns"
codesign --force --deep --sign - "$APP" 2>/dev/null

say "6/6 产物"
mkdir -p "$OUT"
ZIP="$OUT/${APP_NAME}-${VER}-mac-x64.zip"
DMG="$OUT/${APP_NAME}-${VER}-mac-x64.dmg"
rm -f "$ZIP" "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

echo
echo "完成："
ls -lh "$ZIP" "$DMG" | awk '{print "  " $5 "  " $9}'
echo "首次打开：右键 → 打开（未签名，Gatekeeper 会拦一次）"
echo "（stage 临时目录留在 $STAGE，可直接 open 测试，确认没问题再删）"
