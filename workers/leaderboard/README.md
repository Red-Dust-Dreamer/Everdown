# 匿名排行榜 API(Cloudflare Workers + D1)

规则:主线榜(最远区域)+ 等级榜 + 爬塔榜(深渊塔最高层),每榜只存 **Top 50**,落榜即删;
不在榜返回估算名次(COUNT 比我高者 + 1);匿名设备 UUID,无需登录。
防线:结构校验(数值范围/自洽)+ 昵称过滤(≤12 字,敏感词替换默认名)+ 每 UUID 每小时 12 次限流 + 榜内降分不覆盖。
战力榜(power)为预留枚举,战力系统上线后在 worker.js 的 `BOARDS` 与前端 `LB_BOARDS` 各加一项即可。

## 部署(一次性,约 5 分钟)

```bash
cd workers/leaderboard
npx wrangler login          # 浏览器授权 Cloudflare 账号(免费版即可)
npx wrangler d1 create abyss-leaderboard
# 把输出的 database_id 填入 wrangler.toml(替换 local-dev)
npx wrangler d1 execute abyss-leaderboard --remote --file=schema.sql
npx wrangler deploy         # 输出 https://abyss-leaderboard.<你的子域>.workers.dev
```

然后把该地址填入 `src/web/main.ts` 顶部的 `LEADERBOARD_API`(去掉 TODO 注释),
`npm run build && bash scripts/deploy-pages.sh` 重新部署前端即生效。

## 本地测试

```bash
cd workers/leaderboard
npx wrangler d1 execute abyss-leaderboard --local --file=schema.sql
npx wrangler dev --port 8791
# 前端把 LEADERBOARD_API 临时指向 http://127.0.0.1:8791
```

## API

- `GET /board?b=zone|level|tower&uuid=<设备UUID>` → `{ top: [ {name,score,kills,playtime,level,max_zone,is_me} × ≤50 ], you: {rank,inTop,score,kills} | null }`
- `POST /submit` `{board,uuid,name,score,kills,playtime,level,max_zone}` → `{rank,inTop,updated}`;错误返回 4xx/429 + `{error}`
  - score 自洽:zone 榜 score=max_zone,level 榜 score=level,tower 榜 score=max_tower(≥1)
