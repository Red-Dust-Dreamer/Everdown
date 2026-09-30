# 06 · 多人与团队作战设计

> 建立日期:2026-09-30。背景:已确认游戏未来会引入多人玩法,核心形态为**团队作战**。
> 本文回答三件事:团队作战长什么样(玩法)、它对架构意味着什么(决策)、现有代码哪里要动(改造点)。
> 同样是规划:在 P2 开始前不实施,但 P0/P1 的代码决策已按本文对齐。

## 0. 一句话结论

**放置刷宝的多人不是实时同屏,而是"异步聚合":每个玩家照常单机挂机,伤害/贡献向服务器持有的共享实体(团队 Boss)聚合。** 这个形态与懒结算架构(resolve)天然契合,把实时同步的复杂度整个消掉了;但它同时宣判:**团队状态必须服务器持有 → 服务器权威(原方案 B)从"演进终点"升级为"团队玩法的硬前置"**,客户端权威阶段(方案 A)只能承载无共享收益的展示型社交。

## 1. 多人形态决策

| 形态 | 描述 | 同步需求 | 判定 |
|------|------|----------|------|
| **异步聚合**(团队副本/世界 Boss) | 队伍/全服成员各自挂机,伤害汇总扣共享 Boss 血条 | 无实时;REST + 时间戳 | ✅ **v1,本文主线** |
| 展示型社交(排行榜/公会/参观) | 看别人的角色/进度,无共享状态 | 只读 API | ✅ 随 P2/P3 顺带 |
| 实时组队(同屏共战) | 多人同一战斗现场,实时出手/仇恨 | WebSocket 房间 + 服务器 tick | ⏳ 远期可选(M2),放置玩家不依赖它 |
| 玩家交易/赠送 | 装备/货币流转 | 服务器权威 + 经济审计 | ❌ 暂缓:防作弊与通胀成本最高,收益不明确 |

**为什么异步聚合是对的:**
1. 放置游戏玩家的大多数时间不在线盯屏,"要求队友同时在线"与玩法内核矛盾;
2. 服务器成本:实时房间 = 常驻 tick × 房间数;异步聚合 = 复用单人懒结算,零增量常驻成本;
3. 团队感不来自同步操作,来自**共享目标 + 贡献可见 + 一起结算**("我睡着了也在帮队伍打 Boss")。

## 2. 玩法设计

### 2.1 队伍(Party)
- 规模 2~5 人;创建/邀请码加入/退出;离线成员保留席位(放置友好);
- **队伍加成**:每名成员为全队提供 +2% 攻击与生命(叠满 5 人 +8%)——鼓励固定队,且异步生效(结算时按队伍快照计算);
- 队伍有独立的小型贡献榜(周清)。

### 2.2 团队副本(Team Dungeon)——核心玩法
- 周常循环:每周一个主题 Boss(复用 THEMES 主题与 BOSS 名),血量 = 标准角色 DPS × 队伍人数 × 预期挑战时长(见 §7 数值);
- 每个成员用"派遣"机制参战:选择挂机时长(≤ 离线上限 12h),服务器用 **resolve_party** 结算该成员造成的伤害(沿用击杀回血/死亡/技能期望,规则与单人完全一致);
- Boss 血条全队共享实时可见(轮询即可);血量归零 → 结算窗口开启;
- **奖励按贡献分档**(不做竞拍/ROLL,放置玩家不想开会):
  - 贡献 ≥ 10%:完整掉落池(个人独立 roll,见 §2.4);
  - 贡献 < 10% 但 ≥ 1%:保底一抽;
  - 击杀时刻在线者额外"致命一击"纪念奖励(荣誉向)。
- 未击杀:按当周伤害比例发安慰奖,Boss 血量保留到周期结束(制造"下周接着打"的持续感)。

### 2.3 世界 Boss(全服)
- 团队副本机制的放大:血量按全服活跃角色数缩放,每 48h 一期;
- 个人伤害排行 + 公会伤害排行(双榜);
- 掉落同 §2.4,另加排行称号(纯荣誉,不加属性,防排行通胀)。

### 2.4 掉落与奖励原则
- **个人掉落(Personal Loot)**:每个达标成员独立 roll 自己的掉落,互不干扰、零分配争议——放置游戏的默认答案;
- 贡献只影响**档位**(能不能抽/抽几次),不影响 roll 运气本身;
- 团队装备池与单人池一致(同一 roll_item),新增团队副本专属掉率加成(相当于一个常驻 boss_drop 池),避免出现"团本装备把单机装备作废"或反之;
- 暂无玩家间交易,装备不可转让(防小号喂大号)。

### 2.5 协同技能(Team Skills)——异步也成立
- 技能系统引入 `target` 字段:`self` / `enemy` / `ally_lowest` / `party`;
- 现有技能映射:重击=enemy、治疗术=ally_lowest、战吼 **升级为 party**(全队攻击增益)、处决=enemy;
- 异步结算下的语义:resolve 按队伍快照计算——队友的增益以"结算时的队伍面板"进入你的期望 DPS(队伍加成同样如此),不做跨时序的实时联动;
- 新增 1~2 个纯辅助技能(如"坚守":按队友最高防御的 20% 提升自身防御),让"辅助型养成路线"成立——build 多样性的钩子。

## 3. 架构影响(本文最重要的部分)

### 3.1 服务器权威成为硬前置
- 团队 Boss 的血量、贡献、奖励是**共享状态**;任何客户端权威的实现都等于"谁都能改 Boss 血"(方案 A 的作弊面从'自欺'升级为'坑队友');
- 因此路线修订:**P3(服务器权威结算)必须先于任何有共享收益的团队玩法**;P2 账号阶段的多人内容仅限展示型(排行榜/参观)。

### 3.2 状态拆分:Hero 与 World 分离(P2.5,多人化的真正前置)
现状:`Game` 同时持有**角色状态**(equip/bag/skills/stats…,随账号走)与**世界状态**(zone/stage/monster/battle timers,战斗会话)。单人游戏二者合一没问题;多人要求:

```
HeroState   —— 玩家角色,可序列化,属于账号(现有 to_dict 的角色部分)
BattleState —— 一场战斗的会话状态(怪物、计时器、参战者列表)
PartyRaid   —— 服务器共享实体(Boss 血量、成员贡献、周期)
```

- 单人模式:玩家本地 = HeroState + 私有 BattleState(行为与现在完全一致,CLI/网页不变);
- 团队模式:BattleState/PartyRaid 由服务器持有,客户端只做表现;
- **拆分映射表**(P2.5 实施清单):

| 现在在 Game 上的字段 | 去向 |
|---------------------|------|
| gold/stones/level/xp/equip/bag/skills/skill_cd/stats/settings/quests/seed | HeroState |
| hero(含 hp/atk_timer) | HeroState(战斗位面,见下) |
| zone/stage/mode/farm_stage/stage_kills/deaths_row/monster/respawn_timer/buff_* | BattleState |
| ema_kill/last_spawn_time/last_death_time/time/playtime | BattleState(会话统计) |

- 拆分原则:**不改玩法、只改归属**;拆完后单人回归测试 = 全量 demo/sim 校准复跑(同 seed 逐行一致)。

### 3.3 战斗引擎:从 1v1 到 Nv1
- 伤害公式 `_dmg(atk, def)` 是"单攻击者 vs 单目标",天然支持多攻击者各自结算——**公式层零改动**;
- `battle_tick(game, dt)` 现在读单数 `game.hero` → 改为接受 `heroes: list[HeroState]`:外层循环攻击者,内层逻辑不变(团队本 v1 是 Nv1,暂无多目标/仇恨需求);
- 技能施放 `_cast_skills(game, dt, mon)` 同样参数化目标列表(`ally_lowest` 从 heroes 里选);
- 团队 tick 的演出(谁打了多少)通过既有事件队列输出,CLI/网页渲染层自行决定展示粒度。

### 3.4 resolve() 团队版
```python
def resolve_raid(hero: HeroState, raid: RaidState, window_sec: float) -> Contribution:
    """对共享 Boss 结算单个成员的伤害贡献。
    复用 _hero_dps/_roll_knives:Boss 血量视为无限,窗口时间内
    累积期望伤害(含死亡/复活惩罚循环);返回伤害总量与事件摘要。"""
```
- 单成员结算独立进行(无需全员同时在线);服务器在成员"派遣"时或周期结算时批量执行;
- 这是现有 resolve 的退化变体(怪物血量无限 → 循环只受时间约束),实现成本极低;
- 校准验收同 P0:单人 tick 模拟 vs resolve_raid 伤害偏差 < 5%。

### 3.5 表现层(CLI/网页)
- 战斗页双卡片布局保留给单人;新增 **团队页**:
  - Boss 大血条 + 主题名 + 剩余时间;
  - 成员贡献条(名字/伤害占比/在线状态);
  - 派遣按钮(选时长)与结算报告弹窗(复用离线弹窗样式);
- 网页版与 CLI 同步获得该页(共用 render 层,xterm.js 模式零额外成本)。

## 4. 数据模型增量(叠加在 docs/03 之上)

```sql
CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id),
    invite_code TEXT UNIQUE NOT NULL,      -- 6位邀请码,可重置
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE party_members (
    party_id UUID REFERENCES parties(id) ON DELETE CASCADE,
    character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (party_id, character_id)
);

CREATE TABLE raids (                       -- 团队副本周期实例
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope TEXT NOT NULL,                   -- 'party' | 'world'
    party_id UUID REFERENCES parties(id),  -- world 型为 NULL
    boss_key TEXT NOT NULL,                -- 主题/词缀变体
    boss_hp_max DOUBLE PRECISION NOT NULL,
    boss_hp DOUBLE PRECISION NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    settled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE raid_contributions (
    raid_id UUID REFERENCES raids(id) ON DELETE CASCADE,
    character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
    damage DOUBLE PRECISION NOT NULL DEFAULT 0,
    dispatched_sec INT NOT NULL DEFAULT 0, -- 累计派遣时长(封顶=离线上限)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (raid_id, character_id)
);
CREATE INDEX idx_raid_active ON raids(ends_at) WHERE NOT settled;
```

- 公会(guilds)是 parties 的超集(人数上限/权限层),v1 先不做——队伍已覆盖核心体验;
- 排行榜直接基于 raid_contributions 聚合,Redis ZSET 缓存(03 文档既有方案)。

## 5. API 增量

| Method | Path | 说明 |
|--------|------|------|
| POST | /party | 创建队伍(返回邀请码) |
| POST | /party/join | `{invite_code}` 加入 |
| POST | /party/leave | 退出 |
| GET  | /party | 队伍信息(成员/加成/当前副本) |
| GET  | /raid/current | 当前副本状态(Boss 血量/贡献榜/倒计时) |
| POST | /raid/dispatch | `{hours}` 派遣:服务器立即 resolve_raid 并累入贡献(≤12h) |
| POST | /raid/collect | 周期结束后领取奖励(服务器按贡献档位 roll 个人掉落) |

- 全部为幂等或显式动作型接口,无长连接;`/raid/dispatch` 的计算即一次 resolve(毫秒级),限流按 04 文档;
- 世界 Boss 复用同接口(`scope=world`,无 party_id),贡献榜换全服聚合。

## 6. 防作弊追加(叠加在 docs/04 之上)

- **伤害必须服务器结算**:dispatch 传入的只有时长,一切数值(装备/技能/期望 DPS)取自服务器侧 HeroState——客户端无任何上报通道;
- 派弃时长封顶 = 离线上限(12h),且受"派遣时间戳不倒挂"约束(同 04 §4);
- 贡献异常检测:单成员伤害 > 理论 DPS × 派遣时长 × 1.2 → 拒绝入账并审计(包络校验思路复用);
- 奖励 roll 全服务器侧,个人掉落结果不可申诉/不可重roll(防重放:collect 幂等,一周期一次)。

## 7. 数值考量

- Boss 血量公式:`Σ(队员标准DPS快照) × 人数 × 目标天数 × 日有效派遣时长系数`——首期目标"5 人队、每人每天派遣 8h、3 天击杀";
- 队伍加成(+8% 满员)计入标准 DPS 快照,避免"组队反而打不动";
- **团队伤害通胀**:5 人聚合 DPS ≈ 单人 ×5,但单人推层节奏以个人 DPS 校准——团本奖励强度对齐"同投入单人farm收益 × 1.3~1.5",让团本是"社交可选增益"而非"强制上班";
- 世界 Boss 血量用全服活跃度缩放,保证 48h 内击杀率在 60~80%(打不死也有安慰奖,避免挫败);
- 所有系数进 `BAL`(data.py)单独的 `RAID` 段,与单人平衡隔离,便于独立调参。

## 8. 阶段规划(并入 docs/05)

| 阶段 | 内容 | 前置 |
|------|------|------|
| **P2.5** | Hero/World 状态拆分(§3.2 映射表;纯重构,玩法零变化) | P0 ✅ |
| **P3** | 服务器权威结算(已有规划) | P2 |
| **M1 团队 v1** | 队伍 + 团队副本 + 派遣 + 个人掉落 + 贡献榜(本文 §2.1/2.2/2.4) | P3 |
| **M1.5** | 世界 Boss + 双榜 + 称号 | M1 |
| **M2(可选)** | 实时组队房间(WebSocket;演出层升级,规则层不变) | M1 且有真实需求 |
| 暂缓 | 公会体系 / 交易赠送 / PvP | 无限期,先验证 M1 留存 |

## 9. 本次(P0/P1)已为多人预留的对齐项

- 核心零 UI 依赖 + 事件输出 → 服务器聚合事件流无需剥离渲染;
- RNG 全播种 → 团队结算可复现、可审计;
- `resolve()` 与 tick 同规则 → resolve_raid 是退化变体而非新系统;
- 存档 per-character + version 迁移链 → HeroState 抽取即"存档的角色子集";
- 唯一的已知债务:combat.py 的单数 `game.hero` 与 `_cast_skills` 的目标硬编码——已列入 P2.5 清单,越早拆越便宜。
