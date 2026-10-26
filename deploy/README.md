# 上线部署

三条命令搞定：装环境 → 推代码 → 签证书。

## 0. 机器要求（别省）

| 项 | 最低 | 说明 |
|---|---|---|
| 内存 | **8GB** | FireRed 时间戳峰值 2.4GB，Remotion 渲染峰值 4–6GB。4GB 会 OOM |
| CPU | 4 核 | 2 核渲一条 123 秒 1080p 要约 20 分钟，4 核 6–8 分钟 |
| 磁盘 | 40GB | 环境 2GB + 每条成片约 210MB（原片 155 + host 43 + 成片 47） |
| 系统 | OpenCloudOS / CentOS / Rocky 8+ 或 Ubuntu 22+ | |

## 1. 装环境（服务器上，只跑一次）

```bash
scp -r deploy root@<IP>:/tmp/
ssh root@<IP> 'bash /tmp/deploy/bootstrap.sh'
```

装的东西：Node 22、ffmpeg、chromium、Python venv（sherpa-onnx 三件套）。

## 2. 推代码（本机）

```bash
# 第一次要带渲染运行时（714MB）和模型（740MB）
SYNC_RUNTIME=1 HOST=root@<IP> bash deploy/deploy.sh

# 之后改代码只推改动，几十秒
HOST=root@<IP> bash deploy/deploy.sh
```

模型单独推一次（脚本没包这一步，因为路径在 root 家目录）：

```bash
rsync -az ~/.cache/koubo/ root@<IP>:/root/.cache/koubo/
```

## 3. 域名 + HTTPS（服务器上）

```bash
sed 's/__DOMAIN__/dh.example.com/g' /opt/beizhai-workbench/deploy/nginx.conf \
  > /etc/nginx/conf.d/beizhai.conf
nginx -t && systemctl reload nginx
certbot --nginx -d dh.example.com      # 自动改配置 + 续期
```

DNS 先把域名 A 记录指到服务器 IP，再签证书。

## 4. 首次登录

服务器上没有 admin.json，第一次打开会要求初始化。用脚本设（不要用默认密码上线）：

```bash
ssh root@<IP> 'cd /opt/beizhai-workbench && \
  /usr/local/bin/node server/scripts/set_admin.mjs <用户名> <新密码>'
```

## 5. 验证清单

```bash
curl -s https://<域名>/api/health            # {"ok":true,...}
ssh root@<IP> 'journalctl -u beizhai-workbench -n 50'
```

- [ ] 登录能进，刷新不掉
- [ ] 上传一个 100MB+ 视频不报 413
- [ ] 跑一条完整链路，出片能下载、能播
- [ ] 「历史作品」有记录，「改分镜」能打开
- [ ] 改一张卡重渲，2–8 分钟后成片更新

## 已知的坑

**Remotion 首次渲染要下 chromium**（~150MB，来自 storage.googleapis.com）。
国内机器大概率连不上，所以 bootstrap 装了系统 chromium。
如果仍然报 `Failed to download chrome-headless-shell`，在 `/etc/systemd/system/beizhai-workbench.service` 的 `[Service]` 里加：

```
Environment=REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
```

然后 `systemctl daemon-reload && systemctl restart beizhai-workbench`。

**字体**：卡片中文全靠系统字体，Ubuntu 要装 `fonts-noto-cjk`（bootstrap 已含），
不装的话所有卡片文字会变成方块。

**内存**：一条片子在渲的时候别同时跑第二条。代码里有串行队列（`enqueue`），
但那是进程内锁，多实例部署会失效。
