# 排行榜 · 阿里云 ECS 部署

零依赖单文件服务(与 Cloudflare Worker 版逻辑逐行同构),数据存 `leaderboard.db`(SQLite),
备份 = 复制该文件。适用于 TapTap/国内直连场景。

## 1. 服务器准备

```bash
# Node ≥ 23.4(node:sqlite 稳定免 flag;Node 22 需加 --experimental-sqlite)
node -v
# 没有 node 就装一份(NodeSource,以 24.x 为例):
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
```

## 2. 上传与启动

```bash
# 本地上传(Windows Git Bash;<IP> 换成 ECS 公网 IP)
scp server/leaderboard-ecs/server.cjs root@<IP>:/opt/abyss-lb/

# 服务器上手动试跑:
cd /opt/abyss-lb && PORT=8787 node server.cjs
# 看到 [leaderboard] listening on :8787 即成功,Ctrl+C 停止
```

## 3. 阿里云安全组(控制台 → ECS → 安全组)

入方向添加规则:自定义 TCP **8787**,源 `0.0.0.0/0`。
验证(本机):`curl http://<IP>:8787/healthz` → `{"ok":true,...}`。

## 4. 常驻运行(systemd)

```bash
sudo tee /etc/systemd/system/abyss-lb.service <<'EOF'
[Unit]
Description=Abyss leaderboard (zero-dep)
After=network.target

[Service]
WorkingDirectory=/opt/abyss-lb
ExecStart=/usr/bin/node server.cjs
Environment=PORT=8787
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now abyss-lb
sudo systemctl status abyss-lb --no-pager
```

## 5. 客户端构建指向 ECS

```bash
VITE_LB_API=http://<IP>:8787 npx vite build --outDir dist-taptap
```

⚠️ 混合内容限制:**HTTPS 页面(github.io)不能请求 http:// 接口** —
Web 版继续用 workers.dev;ECS 端点给 APK/TapTap 构建(native WebView 无此限制)。
以后想 Web 也走 ECS:绑定已备案域名 + 免费证书(阿里云可签),改用 https。

## 6. 运维

- 数据:`/opt/abyss-lb/leaderboard.db`(定时 `cp` 即备份;SQLite 单文件)
- 日志:`journalctl -u abyss-lb -f`
- 升级:覆盖 server.cjs 后 `sudo systemctl restart abyss-lb`
- 免费试用到期:实例回收前把 leaderboard.db 下载下来,换机重传即可
