#!/usr/bin/env bash
#
# 北抖AI数字人 · 打「运行环境包」（供客户端首次启动下载）
#
#   bash scripts/pack-runtime.sh mac-x64      # Intel Mac
#   bash scripts/pack-runtime.sh mac-arm64    # 必须在 Apple Silicon 机器上跑（node_modules 含平台二进制）
#   bash scripts/pack-runtime.sh win-x64      # 必须在 Windows 机器上跑
#
# 产出 runtime-dist/<平台>/：
#   ffmpeg-<平台>.tar.gz   ffmpeg + ffprobe（解压到 runtime 根）
#   python-<平台>.tar.gz   base python + site-packages 合并成 python/（解压到 runtime 根）
#   talkcraft.tar.gz       video-talkcraft 整个目录（含 Remotion engine，解压到 runtime 根）
#   firered.tar.gz         FireRed 模型（跨平台，解压到 ~/.cache/koubo）
#
# 关键点（venv 可移植性）：venv 的 bin/python 是三段符号链接 + pyvenv.cfg 写死本机绝对路径，
# 直接打包会断。这里改成「base python（自包含，只依赖系统库 + @rpath/libpython）+
# venv 的 site-packages 合并进 base 的 lib/pythonX.Y/site-packages」，目标机上直接
# runtime/python/bin/python 就能跑，不需要 venv 机制，也不需要重写 pyvenv.cfg。
set -euo pipefail

PLAT="${1:-mac-x64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/runtime-dist/$PLAT}"
PYV="3.13.12"
PYMM="3.13"   # site-packages 目录用主次版本号（python3.13），不是完整版本 3.13.12

BASE_PY="$HOME/.workbuddy/binaries/python/versions/$PYV"
VENV_SP="$HOME/.workbuddy/binaries/python/envs/default/lib/python$PYMM/site-packages"
BIN_DIR="$HOME/.workbuddy/bin"
TK="$HOME/WorkBuddy/数字人/tools/video-talkcraft"
MODEL_DIR="sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25"
MODEL="$HOME/.cache/koubo/$MODEL_DIR"

log() { printf '[pack-runtime] %s\n' "$*"; }

# 前置校验：缺一个就早退，别打半套包
for p in "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe" "$BASE_PY/bin/python" "$VENV_SP/sherpa_onnx" "$TK/scripts/timestamps_cpu.py" "$MODEL/model.int8.onnx"; do
  [ -e "$p" ] || { echo "缺少: $p"; exit 1; }
done

mkdir -p "$OUT"
log "平台=$PLAT  输出=$OUT"

log "1/4 ffmpeg + ffprobe"
tar -czf "$OUT/ffmpeg-$PLAT.tar.gz" -C "$BIN_DIR" ffmpeg ffprobe

log "2/4 python（base python + site-packages 合并）"
STAGE="$OUT/.stage-python"
rm -rf "$STAGE" 2>/dev/null || true
mkdir -p "$STAGE"
cp -R "$BASE_PY" "$STAGE/python"
mkdir -p "$STAGE/python/lib/python$PYMM/site-packages"
rsync -a "$VENV_SP/" "$STAGE/python/lib/python$PYMM/site-packages/"
tar -czf "$OUT/python-$PLAT.tar.gz" -C "$STAGE" python
rm -rf "$STAGE" 2>/dev/null || true

log "3/4 video-talkcraft（含 Remotion engine）"
tar -czf "$OUT/talkcraft.tar.gz" -C "$(dirname "$TK")" "$(basename "$TK")"

log "4/4 FireRed 模型"
tar -czf "$OUT/firered.tar.gz" -C "$(dirname "$MODEL")" "$MODEL_DIR"

log "完成："
ls -lh "$OUT" | awk 'NR>1{print "  "$5"  "$9}'
echo
echo "上传到对象存储/服务器后，把客户端 BEIDOU_RUNTIME_BASE 指向该目录即可。"
