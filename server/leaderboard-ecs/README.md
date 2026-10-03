# 排行榜 · 阿里云 ECS 部署

零依赖单文件服务(与 Cloudflare Worker 版逻辑逐行同构),数据存 `leaderboard.db`(SQLite),
备份 = 复制该文件。适用于 TapTap/国内直连场景。

**语义包络校验(2026-10-03 起)**:提交除结构校验外,还按 `LB_BOUNDS`(文件内托管块,
由 `npm run gen:lb` 以默认数值跑参考自动脚本生成)校验"进度是否物理可能"——
level/kills/max_zone/power ≤ 对应 playtime 的包络上限;塔层 ≤ 击杀数;playtime ≤ uuid
首见至今的墙钟 + 离线宽限(`BAL.offline_cap_sec`+1h),已有记录再卡增量。被拒返回
`400 {error:"implausible <字段>"}`。**改动 src/core 数值后必须重跑 `npm run gen:lb`
并重新上传本文件**,否则包络与游戏数值脱节(冒烟测试会拦双端托管块不一致)。

**存档周期上云 `/save-sync`(2026-10-03 起)**:玩家端(生产构建)每约 10 分钟及关页时
上传整份存档快照;每 uuid 只存最新一版(`save_sync` 表)。玩家上行走独立小时限流
(`{uuid}:sync:{小时桶}`,12 次/时)+ 同套语义包络;管理端读写需要 token:

```bash
# systemd 单元 [Service] 段加一行(Environment= 后面换成你自己的随机串,≥32 字符):
Environment=ADMIN_TOKEN=<你的管理token>
# 然后 daemon-reload + restart;不设置则管理端点返回 503,玩家上行不受影响
```

- `GET /save-sync?token=<t>` → 最近 200 名玩家摘要;`GET /save-sync?token=<t>&uuid=<u>` → 整份存档
- `POST /save-sync` + 头 `X-Admin-Token: <t>` = 管理写回(跳过包络/限流,可造测试值)
- 管理面板(本地 `npm run dev` → `/admin/`)「存档管理 → 远端玩家存档…」填端点与 token 即可列出/拉取/写回
- 用户数据收集范围见 `docs/privacy-policy.md`(TapTap 上架需声明)

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
