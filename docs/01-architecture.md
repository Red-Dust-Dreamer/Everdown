# 01 · 目标架构与选型

## 1. 放置游戏的特殊性

放置刷宝的本质是:

```
state(t2) = resolve(state(t1), t2 - t1)
```

玩家"在线看着刷"只是对这一函数的逐帧可视化。因此在线版架构的核心问题只有一个:

> **谁来执行 `resolve`?客户端(可作弊、省服务器)还是服务器(可信、花算力)?**

当前 CLI 实现是 0.1s 固定步长的实时模拟(`Game.tick` → `battle_tick`),带逐击随机与浮字事件。它适合"有人在看",不适合"服务器对几千个离线角色批量结算"。所以无论选哪个方案,都需要一个**结算模式的战斗内核**(见 §4)。

## 2. 三个候选方案

### 方案 A:客户端权威 + 云存档

```
浏览器(全部游戏逻辑,TS 或 Pyodide)
   │  登录后 PUT /save 上传整份存档
   ▼
服务器:账号 + 存档桶(不运行游戏逻辑)
```

- 优点:服务器成本 ≈ 静态资源 + 一张表;离线可玩(PWA);上线最快。
- 缺点:存档可伪造(改内存再上传即可),排行榜/经济不可信。
- 定位:**Phase 2 的形态**。对单机放置而言"自欺欺人式作弊"伤害有限,可接受窗口期。

### 方案 B:服务器权威 + 纯表现层客户端

```
浏览器(只渲染:动画/飘字/UI,可本地预测)
   │  GET /state?since=… → 服务器按时间戳懒结算并返回权威状态
   │  POST /action (强化/重铸/技能升级…) → 服务器执行并扣费
   ▼
FastAPI 服务器(复用 Python 核心,战斗为懒结算)
   ▼
PostgreSQL(角色 JSONB) + Redis(缓存/会话/限流)
```

- 优点:防作弊、排行榜可信、未来可加多人玩法(公会/好友/赠送)。
- 缺点:服务器承担结算算力;"实时打击感"依赖客户端预测或 WebSocket 推流。
- 定位:**最终形态,Phase 3+**。

### 方案 C:混合(同构核心,双端部署)

游戏核心编译/打包为同一份逻辑的两个运行时:Python(服务器)+ 浏览器版(核心经 Pyodide 跑在客户端或转译 TS)。上线初期 A 形态部署,客户端表现层调用本地核心;服务器同时保留同一核心做"合理性校验"(见 04 文档)。随规模收紧为 B。

**结论:按 C 的代码结构、A→B 的部署顺序演进。** 理由:账号系统上线时玩家少,不值得为权威结算付服务器成本;但代码若不按 B 设计,Phase 3 将是重写而不是收紧。

> **多人修订(2026-09-30,见 [06-multiplayer-team.md](06-multiplayer-team.md))**:
> 团队作战(异步聚合形态)确认进入规划后,方案 A 的适用窗口收窄——**任何有共享收益的多人玩法(团队副本/世界 Boss)都要求服务器持有共享状态,方案 B 成为硬前置**。方案 A 阶段(Phase 2)仅承载单机云存档与展示型社交(排行榜/参观);团队玩法整体排在 P3 之后(路线见 05 文档 M1/M2)。

## 3. 客户端形态选择

| 形态 | 工作量 | 体验上限 | 用途 |
|------|--------|----------|------|
| **Pyodide + xterm.js** | 极低(零重写) | 保留 100×30 终端美学;移动端差 | Phase 1 单机网页版、官方"怀旧模式" |
| DOM 网格(把 `render.py` 的分栏布局映射为 CSS Grid) | 中 | 可加鼠标/触控/动画 | Phase 2 起的主客户端 |
| Canvas/PixiJS 重制 | 高 | 粒子/骨骼动画/移动端手势 | 远期,玩法验证成功后 |

**Pyodide 路线要点**(Phase 1):
- 现有 `abyss/` 核心是纯 stdlib,Pyodide 可直接跑;把 `render_frame()` 输出的 ANSI 帧写入 xterm.js 实例即可,键盘事件转发 `handle_key()`。
- 需打包等宽 CJK 字体(推荐 Sarasa Mono SC 子集化,或 CDN:cdn.jsdelivr.net 的 sarasa 字体);
- 存档写 localStorage(键名 `abyss_idle_save_v1`,与现有 `save.json` 同构);
- 首包体积约 6-10MB(wasm),对放置游戏受众可接受;必要时核心去 UI 化后体积更小。

## 4. 结算模式的战斗内核(技术预研)

服务器权威的核心改造:把"逐 tick 战斗"抽象为三个纯函数,输入输出均为可序列化状态:

```python
# 伪代码,Phase 0/3 实施
def resolve(state: StateCore, elapsed_sec: float, rng_seed: int) -> tuple[StateCore, EventsSummary]
    """快进 elapsed_sec:击杀数、掉落、金币、经验、死亡退层、技能升级(可选自动策略)。
    EventsSummary 只保留聚合结果(掉落列表、等级变化、死亡次数),不保留逐击浮字。"""

def apply_action(state: StateCore, action: Action) -> tuple[StateCore, ActionResult]
    """强化/重铸/装备/购买等玩家操作,服务器执行并校验资源。"""

def simulate_view(state: StateCore, rng_seed: int) -> Frame
    """客户端表现层用:从当前状态起逐 tick 模拟出动画帧(不产生权威结果)。"""
```

- 快进的正确做法不是循环跑 0.1s tick(一小时 = 36000 次),而是**解析解 + 期望值掉落 + 按区段分层结算**:每只怪物的击杀耗时由双方属性闭式推出(现有 `_dmg` 公式 `atk²/(atk+def)` 可解析求期望击杀时间),掉落按二项分布抽样,死亡退层逻辑复用 `retreat_stage` 规则。
- 现有 `systems.compute_offline()` 已是这个思路的雏形(EMA 击杀时长 × 时长 → 收益),Phase 0 将其升级为精确版并让 CLI 离线结算与服务器结算共用。
- RNG:改为 `random.Random(character_seed)`,种子在角色创建时生成并存档,保证同一状态 + 同一时长 → 同一结果(可测试、可审计)。

## 5. 部署拓扑(目标态)

```
Cloudflare(缓存静态资源 / DDoS 防护)
        │
   ┌────┴─────────────┐
   │  Fly.io / Render │   FastAPI(Python 3.12,复用 abyss 核心)
   │  2×small 实例     │   - /auth JWT 签发
   └────┬─────────────┘   - /state 懒结算(CPU 密集,加进程池)
        │                 - /action 权威操作
   ┌────┴────┐   ┌──────┐
   │ Neon/   │   │ Redis│  会话/限流/排行榜 ZSET
   │ Supabase│   └──────┘
   │ Postgres│
   └─────────┘
前端静态资源:Cloudflare Pages / GitHub Pages
```

- 规模预估:放置游戏单请求结算 < 10ms(解析解),small 实例支撑数千日活。
- WebSocket 仅在"实时帧推送(xterm.js 怀旧模式)"或聊天需要时开启,主客户端轮询/操作时同步即可(放置游戏对实时性不敏感,30s 同步间隔足够)。

## 6. 目录结构演进(目标 monorepo)

```
abyss-idle/
├── core/            # 纯游戏核心:从 abyss/{data,items,combat,systems} 演化,零 IO、零 UI
│   └── statecore.py # Phase 0 产物:无 UI 的状态机
├── server/          # FastAPI:auth / state / action / leaderboard
├── web/             # 前端:xterm.js 怀旧版(Phase 1)→ DOM 正式版(Phase 2)
├── cli/             # 现有 CLI(render/ansi/main 归入此层,吃 core)
├── docs/
└── tests/           # 核心确定性回归:同 seed 同输入必同输出
```
