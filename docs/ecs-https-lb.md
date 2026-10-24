# ECS 排行榜 HTTPS 前置(8788)运维手册

2026-10-15 部署。**为什么存在**:TapTap H5 小游戏托管页是 `https://`,页面内请求
`http://` 接口会被浏览器混合内容策略拦截;ECS 排行榜(server.cjs)裸跑 `http://IP:8787`
进不了 TapTap 容器。方案 = Let's Encrypt **IP 地址证书**(shortlived,约 6.7 天,
2026-01 GA)给裸 IP 上 TLS,nginx 8788 终结 TLS 后反代本机 8787——**网站版(http:8787
直连)与 TapTap 版(https:8788)打到同一个 server.cjs + 同一个 SQLite 库,数据天然一份**。

## 组件清单(ECS 47.99.151.214)

| 组件 | 位置 | 说明 |
|---|---|---|
| 证书 | `/etc/nginx/ssl/abyss-ip/{fullchain,key}.pem` | LE IP 证书(47.99.151.214,shortlived);acme.sh 签发记录在 `/root/.acme.sh/47.99.151.214_ecc/` |
| TLS 反代 | `/etc/nginx/conf.d/abyss-lb-tls.conf` | `listen 8788 ssl` → `proxy_pass http://127.0.0.1:8787` |
| ACME 验证 | `/etc/nginx/conf.d/abyss.conf`(location 块)+ `/var/www/acme` | HTTP-01 webroot,**勿删,续期依赖** |
| 防火墙 | `/etc/nftables.conf` | dport 集合 `{ 22, 80, 8787, 8788 }`;不要启用 firewalld(启动必超时) |
| 续期 | `/usr/local/bin/abyss-cert-renew.sh` + `abyss-cert-renew.timer`(daily) | **按证书实际剩余有效期判断**(剩 <3 天才续),不信任 acme.sh 的 shortlived 续期账本(acmesh-official/acme.sh#6633 显示 bug);续期成功自动 install-cert + reload nginx |
| 安全组 | 阿里云控制台 | 需放行 TCP **8788**(与 22/80/8787 并列);console 手工操作,CLI 未配凭证 |

## 例行检查

```bash
ssh ecs 'openssl x509 -enddate -noout -in /etc/nginx/ssl/abyss-ip/fullchain.pem'  # 剩余 >3 天即健康
ssh ecs 'systemctl list-timers abyss-cert-renew.timer --no-pager | head -3'
ssh ecs 'journalctl -u abyss-cert-renew.service -n 5 --no-pager'                  # 上次续期动作(应为 "skip" 或 renew 成功)
curl -s --max-time 8 https://47.99.151.214:8788/healthz                            # 端到端(大陆客户端视角)
```

## 故障排查

- **外部 curl 8788 超时,服务器本地 `curl -sk https://127.0.0.1:8788/healthz` 通** → 阿里云安全组没放行 8788(最常见);其次 nftables(`nft list chain inet filter input`)。
- **证书过期(TapTap 端排行榜整片失败,网站版 8787 不受影响)** → 看续期日志;手动补:`ssh ecs /usr/local/bin/abyss-cert-renew.sh`(脚本内部 `--force`,不到 3 天不会动)。游戏本体离线可玩,榜单断了不影响进程。
- **⚠️ 2026-10-24 实际事故与根因**:证书 10-22 过期两天才发现——timer 每日跑但 acme.sh 报 `'47.99.151.214' is not an issued domain, skipping` 空转。根因:**systemd 服务环境没有 `HOME`,acme.sh 找不到 `~/.acme.sh` 状态目录**(`HOME= acme.sh --list` 直接空表)。修复:续期脚本头部加 `export HOME=/root`。教训:例行检查除了看 timer active,**要看 journalctl 上次动作是不是真 renew/skip 而非报错**。
- **nginx -t 报证书文件缺失** → 证书从未安装或被清:`/root/.acme.sh/acme.sh --install-cert -d 47.99.151.214 --ecc --fullchain-file /etc/nginx/ssl/abyss-ip/fullchain.pem --key-file /etc/nginx/ssl/abyss-ip/key.pem --reloadcmd "systemctl reload nginx"`。
- 注意:从 ECS 自身 curl 公网 IP 的 8788 会超时(hairpin NAT 不支持),自测用 `127.0.0.1`。

## 换 IP / 换机器流程

IP 是写死在证书 SAN 和 TapTap 包端点里的,换 IP 意味着:服务器上重签(域名参数换新 IP)
→ `LB_API=https://新IP:8788 bash scripts/package-taptap.sh` 重新出包 → TapTap 后台传新
版本 → 安全组/nftables 照旧。SQLite 数据(`leaderboard.db`)随文件迁移即无损。

## 遗留监控建议(未实施)

`server.cjs /healthz` 尚不报告证书状态;可选增强:healthz 读 fullchain.pem 剩余天数一并
返回,管理面板或外部拨测据此告警。当前靠每日 timer + 例行检查。
