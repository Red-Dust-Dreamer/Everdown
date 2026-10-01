# 07 · TypeScript 全量同构迁移(B 方案)

> 建立日期:2026-10-01。背景:P1(Pyodide 网页版)与 DOM 过渡客户端(`web/app`)落地后,
> 「网页与移动端各占一半」的产品定位使 Pyodide 路线的成本持续大于收益,确认**全量 TS 同构迁移**。
> 本文回答四件事:为什么迁(决策)、迁到哪(架构与目录映射)、怎么保证迁得对(RNG 与对拍工程)、
> 迁完怎么管(双实现维护纪律)。
> 注:本文的「B 方案」指**迁移方式**选型(续用 Python + Pyodide 为 A,全量 TS 同构为 B),
> 与 docs/01 的部署「方案 B(服务器权威)」名同实异,勿混淆——后者不受本文影响。

## 0. 一句话结论

**游戏核心从 Python 整体移植为 TypeScript(`src/core`,纯逻辑、平台 IO 经 saveHooks 注入),一套核心服务 Web / Node CLI / 未来服务器三个宿主;Python `abyss/` 冻结为对拍基准,靠「同 seed 逐位对拍 RNG + 同 seed 逐行对拍 sim」保证迁移零玩法漂移。** Pyodide 不再是任何正式宿主的运行时,`web/legacy`(xterm 版)与 `web/app`(DOM 过渡版)降级为可玩但不再投入的过渡产物。

## 1. 背景与决策

### 1.1 迁移动机:Pyodide 的持续税

| 税项 | 事实(本项目实测) |
|------|-------------------|
| 首载 | 本地 vendor 约 13MB(wasm 运行时 + stdlib),加载约 10 秒;CDN 路线在当前网络环境下不可用,只能背着 vendor 走 |
| 移动端内存 | 浏览器内拉起完整 CPython,低端机内存压力大——与「移动端占一半」的定位直接冲突 |
| 维护摩擦 | 核心模块清单(10 个文件写入虚拟 FS)、vendor 版本与缓存失效、**每个网页宿主一份 Python 桥接层**(`web/legacy/abyss_bridge.py`、`web/app/app_bridge.py`)——每加文件、每改宿主接口都要两边同步 |
| 能力天花板 | 正式客户端是移动端 DOM/触控:UI 必然用 JS 写(`web/app` 已如此),逻辑却隔着 Pyodide 桥调用 Python——为同一屏 UI 付两种语言的成本 |

关键判断:正式客户端必经 JS,这一步绕不开;而 Pyodide 桥只为「复用 Python 逻辑」存在。
客户端投入越大,上述税越重,且**永不清偿**。

### 1.2 选型:B 方案(全量 TS 同构)

| 维度 | A:续用 Python + Pyodide | B:全量 TS 同构(✅ 选定) |
|------|------------------------|--------------------------|
| 首载/内存 | ~13MB vendor、~10 秒;移动端压力大 | 普通 JS bundle(预期 1MB 内,含 243KB 子集字体),秒级;无运行时开销 |
| 宿主成本 | 每宿主一份桥接层 | 宿主只注入 saveHooks + 消费事件队列 |
| 移动端正式客户端 | JS 写 UI、隔桥调逻辑,双层成本 | JS 原生,DOM/触控直达 |
| 服务器侧(P3) | FastAPI 直接复用 Python | Node 直接复用 TS;或仍选 FastAPI(Python 基准在役时,见 §7) |
| 一次性成本 | 0 | 全量翻译 + 对拍工程(本文主线) |
| 主要风险 | 长期税持续累加 | 翻译漂移 → 用 RNG 逐位复刻 + sim 逐行对拍封死(§4/§5) |

决定性论证:**核心逻辑要么留在 Python(服务器侧有利),要么进 JS(客户端侧有利)。客户端的 JS 不可回避,服务器的 Python 可被 Node 替代——所以核心进 JS 是单向门里成本更低的一侧。**

## 2. 目标架构

```
              ┌─────────────────────────────────────────────────────────┐
              │        src/core —— TS 核心(纯逻辑,零平台依赖)             │
              │                                                         │
              │  data(静态数据/BAL)   items(含 pyRound)   skills        │
              │  combat(battleTick)   systems(quests/成就/resolve)      │
              │  game(状态机,存档 v4;平台 IO 经 saveHooks 注入)          │
              │  rng(MT19937,同 seed 与 CPython 逐位一致)               │
              │  host(按键分发 + autopilot,宿主无关)                    │
              │  ansi / render / view(100×30 画布与事件呈现,宿主无关)   │
              └────────┬──────────────────┬──────────────────┬──────────┘
                       │                  │                  │
                 saveHooks 注入       saveHooks 注入      saveHooks 注入
                 (localStorage)       (save.json 文件)    (数据库,P3)
                       ▼                  ▼                  ▼
              ┌─────────────────┐ ┌───────────────┐ ┌────────────────────┐
              │ src/web         │ │ src/cli.ts    │ │ server(P3,二选一)   │
              │ Vite+xterm.js   │ │ Node 终端宿主  │ │ Node(复用 TS 核心) │
              │ 正式客户端,      │ │ (= run.py)    │ │ 或 FastAPI(复用    │
              │ DOM/触控直达     │ │               │ │   Python 基准)     │
              └─────────────────┘ └───────────────┘ └────────────────────┘

对拍闭环(scripts/parity.sh):
  py run.py --sim <N> --seed <S>        ─┐
                                          ├─ diff 逐行 → 0 差异(档一,§5)
  node src/sim.ts --sim <N> --seed <S>   ─┘
  abyss/(Python,冻结)= 基准;src/sim.ts = 被检实现
```

- 核心唯一,宿主三个:宿主的全部职责 = 注入 `saveHooks`(write/readRaw)+ 驱动主循环 + 把 `render_frame` 输出投到屏幕(终端/xterm/DOM);
- `src/sim.ts` 独立于宿主:平衡模拟与 demo 自检,同时是对拍入口(与 `abyss/main.py` 的 `run_sim` 输出格式逐行对齐);
- Python `abyss/` 冻结:只修致命 bug,不加玩法(纪律见 §6)。

## 3. 目录映射(Python → TS)

| Python(abyss/) | TypeScript(src/) | 说明 |
|-----------------|-------------------|------|
| `data.py` | `core/data.ts` | 静态数据 + BAL,数值体系 2.0 原样等值翻译 |
| `items.py` | `core/items.ts` | 装备生成/评分/出售分解;**含 pyRound(银行家舍入,对拍关键,§4)** |
| `skills.py` | `core/skills.ts` | 职业技能池/钩子/期望折算 |
| `combat.py` | `core/combat.ts` | battleTick/spawnMonster/掉落 |
| `systems.py` | `core/systems.ts` | 悬赏/成就/自动换装/`resolve()` 懒结算 |
| `game.py` | `core/game.ts` | 状态机;存档 **v4 双边兼容**;IO 改为 `installSaveHooks()` 注入 |
| `ansi.py` | `core/ansi.ts` | 颜色/CJK 宽度对齐/格式化 |
| `render.py` | `core/render.ts` | 7 页 + 弹窗,100×30 画布 |
| `view.py` | `core/view.ts` | 事件消费呈现层 |
| `main.py` | `core/host.ts` + `src/cli.ts` + `src/sim.ts` | **一拆三**:平台无关按键分发 + autopilot(host.ts)/ Node 终端宿主壳(cli.ts)/ 平衡模拟与 demo(sim.ts,对拍入口) |
| `run.py` | `npm run cli` | 入口等价 |
| `random.Random`(标准库) | `core/rng.ts` | **新增**:MT19937 逐位兼容实现(§4) |
| — | `src/web/` | **新增宿主**:Vite + xterm.js(复用 legacy 的子集字体与交互) |
| — | `src/tests/` | **新增**:确定性回归(node:test,零新依赖) |
| — | `scripts/parity.sh` | **新增**:双实现逐行对拍工具 |
| `web/legacy/`、`web/app/` | 保留不动 | Pyodide 过渡产物,可玩、不再投入,由 src/web 承接后退役 |

## 4. RNG 对拍工程(MT19937 逐位兼容)

### 4.1 目标

存档 v2 起每角色带 seed,P0 的「同 seed sim 逐行一致」是既有资产。迁移必须保住更强的性质:
**同一 seed 下,TS `PyRandom` 与 CPython `random.Random` 每次调用返回同一个数**——即「同一份存档,同一份未来」。
这不是算法级兼容,是**实现级**兼容:同样的 `init_by_array`、同样的取位、同样的拒绝采样,缺一环就整条流错位。

### 4.2 语义对照(src/core/rng.ts)

| CPython | TS(PyRandom) | 要点 |
|---------|----------------|------|
| `Random(n)` / `seed(n)` | `new PyRandom(n)` | abs+floor 后按 **32 位小端字**拆 key → `init_by_array` |
| (内部)init_by_array | `initByArray()` | 先 `init_genrand(19650218)` 预填 624 字,再两轮混入 key(乘数 1664525 / 1566083941),结尾 `mt[0]=0x80000000` |
| `random()` | `random()` | genrand_res53:两个 32 位输出,`(a>>>5)×2²⁶ + (b>>>6)` 再除 2⁵³ |
| `getrandbits(k)`(k≤32) | `getrandbits(k)` | **取高 k 位**:`genrand() >>> (32-k)`;k=32 边界显式分支 |
| `_randbelow(n)` | `randbelow(n)` | k = n 的**位宽**(`n.bit_length()`),拒绝采样条件是 `r >= n`(不是 >) |
| `randrange(n)` / `choice(seq)` | `randrange` / `choice` | 均走 `_randbelow` |
| `uniform(a, b)` | `uniform` | `a + (b-a) × random()` |
| `shuffle(seq)` | `shuffle` | 尾起 Fisher-Yates,`j = _randbelow(i+1)` |
| `round(x)` | `pyRound`(items.ts) | **银行家舍入**:x.5 取偶;`Math.round` 恒向上,不可替代 |

### 4.3 已知坑(错一个就对不上,且大多「看起来还是很随机」)

| # | 坑 | 后果与对策 |
|---|-----|-----------|
| 1 | **32 位乘法精度**:init_genrand 与 init_by_array 的乘数(1812433253 / 1664525 / 1566083941)若用普通 `*`,乘积超 2⁵³ 丢精度 | 流悄悄错位;必须 `Math.imul`。加减(`+key[j]+j`、`-i`)留在 2⁵³ 内可先算再 `>>>0` 归一 |
| 2 | **init_genrand 易漏**:init_by_array 开头的 `init_genrand(19650218)` 预填与结尾 `mt[0]=0x80000000` | 常数漏写/写错 → 同 seed 输出全错但分布正常,肉眼无感;只有对拍能暴露 |
| 3 | **getrandbits 取高位不是低位** | 写成 `& ((1<<k)-1)` 得到另一条同样均匀的流,肉眼无感,对拍必挂;k=32 时移位量为 0,须防呆 |
| 4 | **符号扩展**:JS 位运算按有符号 32 位,`>>` 会符号扩展 | 统一 `>>>` / `>>> 0` 输出 uint32;tempering 里的 `(y<<7)&0x9d2c5680` 等同理靠 `>>>0` 收尾 |
| 5 | **round 语义**:CPython 银行家舍入(x.5 → 偶)vs `Math.round`(恒向 +∞) | 一切「取整数属性/费用/目标」处必须走 `pyRound`,否则词缀与费用长期漂移,且单点看永远「差不多」 |

### 4.4 对拍工具

`scripts/parity.sh <seconds> [seed]`:同 seed 分别跑 `py run.py --sim N` 与 `npm run sim N`,diff 逐行比对;
预期 0 差异(档一)。规划中,与 §5 验收配套落地。

## 5. 验收标准与当前状态

### 5.1 双档验收口径

| 档 | 标准 | 适用 |
|----|------|------|
| **档一(硬)** | 同 seed 下 sim 输出与 Python 基准**逐行一致**(至少覆盖 60 分钟与 4 小时两个窗口) | 迁移期默认门槛 |
| **档二(软)** | 关键字段一致(每分钟行的 Lv/区·层/击杀/死亡/金币/DPS)且数值偏差 < 1% | 仅当出现**不可消除的浮点尾差**时允许降档,且须记录成因 |

附加验收(沿用 P0 口径,复刻为 `src/tests`):demo 全过、7 页渲染 100×30 精确、按键冒烟全过;
**存档互操作**:save.json(v4)双向可读,Python 档在 TS 版直接续玩、反之亦然。

### 5.2 当前状态(2026-10-01,同日完成修复与集成)

| 项 | 状态 |
|----|------|
| `src/core` 11 文件(data/items/skills/combat/systems/game/ansi/render/view/rng/host) | ✅ 翻译完成 |
| `src/sim.ts`(平衡模拟 + demo,`npm run sim` / `npm run demo`) | ✅ 可跑通 |
| `PyRandom`(MT19937)+ `pyRound` | ✅ 与 CPython 逐位一致(混合序列单元对拍) |
| `saveHooks` 注入接口(game.ts) | ✅ CLI=文件 / Web=localStorage / 测试=内存 |
| package.json / tsconfig / vite.config(root=src/web,端口 8614) | ✅ 含 typecheck/parity/test 别名 |
| demo 自检 | ✅ PASS(早期 `skills.ts` 缺 `c` 导入已修) |
| **sim 对拍(档一:逐行一致)** | ✅ **达成**:600/1800 秒 × warrior/mage/ranger × seed 20260930/12345/777 全部 diff 为空 |
| `scripts/parity.sh` + state_dump 双版 | ✅ 就绪(结构键差异=0) |
| `src/cli.ts`(Node 宿主) | ✅ 就绪,`ABYSS_TEST_TICKS` 钩子过,交互链路(选职/重置/退出)过 |
| `src/web/`(Vite + xterm.js 正式版) | ✅ vite build 产物正常,浏览器实测:秒开、职业选择、存档 v4 互通 |
| `src/tests` 回归 | ✅ 8/8 全 PASS(无容差降级) |
| `npx tsc --noEmit` | ✅ 0 错误 |
| docs/README 索引补本文条目 | ✅ 已补 |

> 首轮对拍分叉的根因(供后来者参考):**`Item.mult()` 的稀有度倍率字段取错** ——
> Python 基准 `RARITIES[rid][3]` 取到的是词缀数(1~6)而非设计倍率(1.0~2.1,位于
> `[4]`,Python 全库从未引用,系原始索引笔误但已成既定行为)。TS 移植时"纠正"为
> 真倍率导致装备属性偏强 → haste/血量偏移 → 攻击计时错位 → 随机流整体错位。
> 修复以冻结基准为准(倍率字段保留为死数据文档)。**设计裁决待定**:若希望稀有度
> 倍率真正生效(普通→神话 ×1.0→×2.1),需两边同步改 + 重跑平衡 sim;在此之前
> 稀有度差异仅体现在词缀条数与固有属性档位。另两处小修:autopilot 槽满跳过条件、
> 处决未触发时的伤害取值(skill_val 而非 base)。

## 6. 双实现维护纪律

### 6.1 过渡期(现在 → Python 退役)

- **`abyss/` 冻结**:只修致命 bug,不加玩法、不改数值;新玩法一律先落 TS;
- **改玩法 = 两边同步改 + 对拍**:任何战斗/掉落/数值(BAL)改动,必须双边同改且 `parity.sh` 达档(一/二)+ `src/tests` 全绿,才可合入;
- 数值调参继续在 BAL 单点进行(docs/05 既有纪律),TS 侧 `data.ts` 等值跟随;
- 存档版本以 TS 侧推进,Python 侧同步 bump(冻结期格式不单独演进)。

### 6.2 TS 唯一真源与 Python 退役的触发条件

以下**全部满足**才宣布「TS 唯一真源」,`abyss/` 随即退役(移入 archive 或保留只读):

1. **三宿主验收**:Web 正式版 + Node CLI + sim 对拍全部达档一(或有记录在案的档二),并稳定保持 ≥ 2 个迭代周期零回归;
2. **Pyodide 宿主下线**:src/web 版上线并完成玩家迁移(存档导入导出通道实测通过),web/legacy、web/app 停止维护;
3. **P3 服务器实现已定**(docs/05 决策点):若选 Node,Python 无剩余宿主;若选 FastAPI,Python 以「服务器核心 + 对拍基准」身份保活,退役另行评估;
4. **快照回归建立**:固定 seed 的黄金输出(60 分钟 sim 逐行 + 若干存档快照)固化进 `src/tests`,对拍真值不再依赖 Python 可运行。

### 6.3 对拍口径的演化

- Python 在役:对拍 = **两个活实现互比**——既防翻译错,也防未来改动引入回归(强口径);
- Python 退役后:对拍 = **实现对比固定快照**——只防回归,不再防翻译错(翻译正确性是一次性资产,快照是长期资产);
- 宣布唯一真源后,「两边同步改」纪律(6.1)自动作废,玩法改动回归单边 + 快照绿。

## 7. 与 docs/01-06 的衔接

| 主题 | 影响 |
|------|------|
| docs/01 §3 客户端形态 | 「Pyodide + xterm.js」从 Phase 1 主路线降级为过渡产物(保留可玩);DOM 正式客户端的载体改为 TS 核心;§5 部署拓扑与 §6 monorepo 目标不变,目录由本文 §2/§3 的 src/ 布局落地(core/web/cli/tests ↔ src/core、src/web、src/cli.ts、src/tests) |
| docs/01 §4 三函数 | `resolve/apply_action/simulate_view` 实现语言改为 TS,语义与签名不变 |
| docs/05 P1 | Pyodide 版保留为「怀旧模式」;其后续演进(改进、移动端适配)**转由 TS Web 版承接**,不再投入 |
| docs/05 数值体系 2.0 | 平衡(多项式成长)原样沿用,BAL 等值翻译,调参纪律不变 |
| docs/05 P0 偏差注记 | 「目录级拆分推迟」的欠账由 TS 迁移一并结清——Python 侧不再拆 core/,拆分只在 TS 侧发生一次 |
| docs/02 / P2 账号、docs/04 防作弊 | 不受影响;客户端侧从 Python 桥换为 TS 核心,「不信任客户端」的设计原则不变 |
| docs/06 多人(P2.5/M1/M1.5/M2) | 不受影响;Hero/World 拆分映射表(06 §3.2)同样适用于 TS 侧,**应在 TS 唯一真源确定后只在 TS 侧做一次**,避免两边各拆一遍 |
| P3 服务器实现 | **二选一**:FastAPI(复用 Python 基准与既有 01/03 部署设计)或 Node(复用 TS 核心,零翻译成本);决策点仍按 docs/05(P3 启动时定);若 TS 唯一真源已宣布,倾向 Node |
