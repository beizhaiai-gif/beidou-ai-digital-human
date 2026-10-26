#!/usr/bin/env bash
#
# 北抖AI数字人 · 服务器首次装环境（只跑一次）
#
#   bash deploy/bootstrap.sh
#
# 目标系统：OpenCloudOS / CentOS / Rocky / AlmaLinux 8+（dnf）
# 干的事：node22 + ffmpeg + chrome + python venv(sherpa-onnx) + 目录
#
# 模型和渲染工程不在这里拉 —— 由 deploy/deploy.sh 从本机 rsync 上去，
# 保证线上和本机是同一份，不会出现「线上识别结果和本地不一样」。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/beizhai-workbench}"
NODE_VER="${NODE_VER:-22.22.2}"
PY="${APP_DIR}/.venv/bin/python"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

say "1/6 基础包"
if command -v dnf >/dev/null; then
  dnf install -y tar xz curl ca-certificates python3 python3-pip python3-devel \
    fontconfig freetype libnss3 libatk libatk-bridge libcups libdrm libxkbcommon \
    libXcomposite libXdamage libXrandr libgbm alsa-lib pango cairo >/dev/null
elif command -v apt-get >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y tar xz-utils curl ca-certificates \
    python3 python3-venv python3-pip fontconfig fonts-noto-cjk \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 >/dev/null
fi

say "2/6 Node ${NODE_VER}"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && NARCH=x64 || NARCH=arm64
  cd /tmp
  curl -fsSL "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NARCH}.tar.xz" -o node.tar.xz
  tar -xJf node.tar.xz -C /usr/local --strip-components=1 --no-same-owner
  rm -f node.tar.xz
fi
node -v

say "3/6 ffmpeg"
if ! command -v ffmpeg >/dev/null; then
  # 优先系统源（有 ffmpeg-free 也行）；没有就上静态包，不折腾编译
  dnf install -y ffmpeg-free >/dev/null 2>&1 || true
  if ! command -v ffmpeg >/dev/null; then
    cd /tmp
    curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ff.tar.xz
    mkdir -p /opt/ffmpeg && tar -xJf ff.tar.xz -C /opt/ffmpeg --strip-components=1
    ln -sf /opt/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
    ln -sf /opt/ffmpeg/ffprobe /usr/local/bin/ffprobe
    rm -f ff.tar.xz
  fi
fi
ffmpeg -version | head -1

say "4/6 Chromium（Remotion 截图用，国内机器下不了 Google 那包）"
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  dnf install -y chromium >/dev/null 2>&1 || apt-get install -y chromium >/dev/null 2>&1 || true
fi
CHROME_BIN=$(command -v chromium || command -v chromium-browser || true)
echo "chromium: ${CHROME_BIN:-未安装（Remotion 会自己下 headless shell，需要能访问 googleapis）}"

say "5/6 Python 环境（FireRed 字级时间戳）"
mkdir -p "$APP_DIR"
[ -d "$APP_DIR/.venv" ] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
# sherpa-onnx 跑的是 onnxruntime CPU 推理，不需要 torch
"$APP_DIR/.venv/bin/pip" install -q sherpa-onnx soundfile numpy zhconv pypinyin
"$PY" -c "import sherpa_onnx, soundfile, numpy; print('sherpa-onnx', sherpa_onnx.__version__)"

say "6/6 目录"
mkdir -p "$APP_DIR/server/jobs" "$APP_DIR/server/data" "$APP_DIR/vendor"
chown -R root:root "$APP_DIR" 2>/dev/null || true

cat <<EOF

装完了。接下来在本机跑 deploy/deploy.sh 推送代码、模型、渲染工程。

如果上面 chromium 显示「未安装」，在 .env 里加一行：
  REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
（或者先手动装一个 chromium，避免首次渲染去 Google 拉 150MB）

EOF
