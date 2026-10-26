#!/usr/bin/env bash
#
# 本机 → 服务器（增量同步，不删服务器上的东西）
#
#   HOST=root@1.2.3.4 bash deploy/deploy.sh
#
# 三条铁律（都是踩过的）：
#   1. rsync **绝不带 --delete**。服务器上 jobs/ 里是用户成片，删一次就没了。
#   2. .env / data / node_modules 不同步 —— 那是每台机器自己的。
#   3. 模型和渲染工程单独一条，量大且不用每次都传（改了代码只传代码）。
set -euo pipefail

HOST="${HOST:?用法：HOST=root@1.2.3.4 bash deploy/deploy.sh}"
APP_DIR="${APP_DIR:-/opt/beizhai-workbench}"
LOCAL="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o BatchMode=yes $HOST"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

say "0/4 探活"
$SSH 'command -v node && node -v && command -v ffmpeg >/dev/null && echo ffmpeg-ok' \
  || { echo "服务器环境没装好，先跑 deploy/bootstrap.sh"; exit 1; }

say "1/4 代码（不含 jobs / data / .env / node_modules）"
# 注意：不带任何 --delete / --delete-excluded。服务器上多出来的文件留着，
# 顶多是没用的旧文件；但 delete 类参数会连 jobs/ 里的成片一起删，得不偿失。
rsync -az \
  --exclude 'server/jobs/' \
  --exclude 'server/data/' \
  --exclude 'node_modules/' \
  --exclude 'server/talkcraft/node_modules' \
  --exclude 'deploy/' \
  --exclude '.env' --exclude '.env.local' \
  --exclude '.git/' \
  --exclude 'server/config/admin.json' \
  --exclude 'server/config/sessions.json' \
  "$LOCAL/" "$HOST:$APP_DIR/"

say "2/4 前端构建产物"
# dist 是本机 build 好的，服务器不装 devDependencies，也就不在服务器跑 vite
rsync -az "$LOCAL/dist/" "$HOST:$APP_DIR/dist/" 2>/dev/null || echo "（dist 不存在，先在本地 npm run build）"

say "3/4 渲染工程运行时（714MB，只在第一次或升级 Remotion 时传）"
if [ "${SYNC_RUNTIME:-0}" = "1" ]; then
  # .remotion 是 mac 版 chromium，传上去也没用，Linux 第一次渲染会自己下
  rsync -az --exclude '.remotion/' \
    "$LOCAL/../tools/video-talkcraft/" "$HOST:$APP_DIR/vendor/video-talkcraft/"
  $SSH "mkdir -p $APP_DIR/server/talkcraft && \
        rm -rf $APP_DIR/server/talkcraft/node_modules && \
        ln -s $APP_DIR/vendor/video-talkcraft/runtime/node_modules $APP_DIR/server/talkcraft/node_modules"
else
  echo "跳过（需要时加 SYNC_RUNTIME=1）"
fi

say "4/4 重启"
$SSH "cat > /etc/systemd/system/beizhai-workbench.service <<'UNIT'
[Unit]
Description=Beizhai Workbench (digital human)
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/node server/index.js
Restart=always
RestartSec=3
# 渲染 + ASR 都是内存大户，脏页早点吐出来
Environment=NODE_ENV=production
Environment=PY_BIN=$APP_DIR/.venv/bin/python
Environment=FFMPEG_BIN=/usr/local/bin/ffmpeg
Environment=FFPROBE_BIN=/usr/local/bin/ffprobe
Environment=TALK_CRAFT_HOME=$APP_DIR/vendor/video-talkcraft
Environment=NODE_BIN=/usr/local/bin/node
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now beizhai-workbench && sleep 2 && systemctl is-active beizhai-workbench"

echo
echo "完成。线上：https://${DOMAIN:-<域名>}"
echo "看日志：ssh $HOST 'journalctl -u beizhai-workbench -f'"
