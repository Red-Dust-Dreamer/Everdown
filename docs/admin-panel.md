# 深渊放置 · 本地管理面板(存档管理 + 策划数值配置)

> 建立日期:2026-10-03
> 状态:**实施级方案**(面板形态与接口契约已定稿,交两名实现者并行落地)
> 面向读者:仓库主人(使用说明)+ 实现者(契约与验收)
> 硬约束回顾:①无覆盖文件时游戏输出与现状逐位一致,`scripts/parity.sh 180` 退出码恒 0;②冒烟测试固定 `scripts/admin-smoke.ts`;③不新增 npm 依赖;④生产构建必须通过——**Git Bash/MSYS 下验收命令为 `cmd //c "npm run build"`**(双斜杠防 MSYS 把 `/c` 转成盘符路径;`cmd /c npm run build` 在 Git Bash 下会启动交互式 cmd 后 EOF 退出、退出码 0 但**构建根本没跑**=假绿,本方案设计时亲历),cmd.exe 原生 shell 下按约束字面用 `cmd /c npm run build`。

---

## 1. 面板形态与启动方式(工程调查结论)

**形态:Vite MPA 第二入口 —— `src/web/admin/` 下的独立页面。**

理由(对照四候选方案):

| 候选 | 结论 | 依据 |
|------|------|------|
| A. 游戏内动态 tab | 不采用 | 复用 `ensureTowerDom` 范式成本最低,但管理面板和游戏页生命周期耦合:面板要 reset/apply 核心数值表,同页会污染正在运行的游戏实例 |
| **B. `src/web` 下 MPA 页** | **采用** | 本工程 `root=src/web`(vite.config.ts:7),dev server 对嵌套 html 零配置伺服;build 只需加一行 `rollupOptions.input`;`src/web/admin/*.ts` 自动落入 `tsc` 的 `include: src/**/*.ts`(tsconfig.json:14)类型门禁 |
| C. 独立目录独立 vite root | 不采用 | 双配置双产物聚合,`deploy-pages.sh`/`package-taptap.sh` 两个部署脚本都要改两处,仅独立发布场景才值 |
| D. 纯静态 HTML+原生 JS | 不采用 | 零类型检查零构建校验,且无法 import 核心模块做效果预览 |

**启动方式:**

```bash
npm run dev            # vite dev(root=src/web,端口 8614)
# 浏览器打开 http://localhost:8614/admin/   ← 管理面板
# 浏览器打开 http://localhost:8614/         ← 游戏本体(与面板同源,可互读 localStorage)
```

**dev 专用文件桥:** `vite.config.ts` 内新增 `adminDevBridge()` 插件(`apply: "serve"`,仅 dev server 生效),把仓库根 `save.json` / `overrides.json` 通过 HTTP 白名单端点暴露给面板读写,并在每次写回前自动做时间戳备份。面板探测不到桥时(如 `vite preview`、构建产物直接打开)自动降级:服务器文件按钮禁用,仅保留 localStorage / 文件导入导出路径。

**样式与交互:** 面板页 `<link>` 复用 `src/web/style.css`,沿用 `--bg/--panel/--red/--gold` CSS 变量与 `.card/.btn/.nav-item` 词汇,innerHTML 模板 + `data-cmd` 事件委托,与游戏 UI 同一视觉语言(工程惯例见 web/mockup 设计稿流程)。

**部署隔离:** 管理面板仅本地使用,不进线上产物 —— `deploy-pages.sh` 与 `package-taptap.sh` 在构建后各加一行删除 admin 产物目录(见 §7 文件清单)。本地 `dist/admin/` 会随 build 产出,属正常,不影响任何现有路径。

---

## 2. 总体架构

```
                     ┌────────────────────────────────────────────┐
                     │  src/web/admin/  (MPA 第二入口,面板侧)      │
                     │  存档管理 │ 数值覆盖 │ 效果预览 │ 说明        │
                     └──────┬──────────────────────┬───────────────┘
        只读渲染/编辑草稿     │                      │ 写回(POST)
   ┌────────────────────────┴──────────┐   ┌───────┴────────────────┐
   │ 核心模块(不改动):                  │   │ vite dev 插件           │
   │  game.ts / data.ts / combat.ts …   │   │ adminDevBridge()       │
   └──────────────┬─────────────────────┘   │ 仓库根 save.json       │
                  │ 新增 API(核心侧)         │ 仓库根 overrides.json  │
   ┌──────────────┴─────────────────────┐   │ (写前自动 .bak-<ts>)   │
   │ src/core/overrides.ts(新)          │   └────────────────────────┘
   │  覆盖注册表/应用/拒绝/快照恢复        │
   │ src/core/savefile.ts(新)           │   localStorage(同源):
   │  存档字典校验(错误/警告分级)         │    abyss_save_v2        ← 游戏存档(游戏自己写)
   └──────────────┬─────────────────────┘    abyss_admin_overrides_v1 ← 数值覆盖(面板写)
                  │ 应用时机(宿主注入,各 ~10 行)
        ┌─────────┴──────────┬──────────────────────┐
        │ src/cli.ts         │ src/web/main.ts       │ sim.ts / abyss/(Python)
        │ 启动读仓库根        │ boot() 读 localStorage │ 【不加载覆盖】→ 对拍解耦
        │ overrides.json     │ abyss_admin_overrides_v1│
        └────────────────────┴──────────────────────┘
```

两个关键机制(均已在本仓库实测验证,见 §9):

1. **运行时属性覆盖**:全部策划数值是 `src/core/data.ts` 的模块级 `const` 对象/数组(`BAL` 为 `as const`,data.ts:413——类型只读但运行时可写),所有消费点(combat/items/skills/tower/systems/render/main)都是在**调用时**读 `BAL.xxx` / 表属性,没有任何模块级快照或 `Object.freeze`(grep 核实)。因此「不改 data.ts 一行、只变异导出对象的叶子属性」即可全链路生效;模块加载时对全部叶子拍快照即可一键恢复默认。探针实测:`BAL.hero_atk0=1000` 后 `recalcHero` 输出 15.75→1050;`RARITIES[5].weight=1e9` 后 200 次抽样 mythic 200/200,恢复后 0/200;`ACTIVE_SKILLS[0].cd` 同理。
2. **覆盖与对拍解耦**:`overrides.ts` 只提供纯函数,**不自己读任何存储**;由 `cli.ts` / `main.ts` 两个宿主入口显式调用。对拍走的 `src/sim.ts` 与 Python `abyss/` 均不经过这两个入口 → 无论仓库里是否存在 overrides.json,`parity.sh` 的两侧输出不变。

---

## 3. 页面与功能清单

面板四个 tab(顶部导航,风格同游戏 `.nav-item`):

### Tab 1 存档管理
- **载入来源(四选一)**:
  1. 「读取服务器存档」:经 dev 桥读仓库根 `save.json`(CLI 存档所在,src/cli.ts:20-21);
  2. 「读取本浏览器存档」:同源直读 `localStorage["abyss_save_v2"]`(src/web/main.ts:40)——dev 面板与 dev 游戏同源,一键取出;
  3. 「导入文件」:选择 `save.json` 或浏览器导出的 `abyss-idle-save.json`;
  4. 「粘贴 JSON」:textarea(线上版存档跨源时,DevTools 复制值粘贴,见 §6.4)。
- **载入后处理**:保留原始 JSON 为「原件」;自动执行 `migrateSave`(src/core/game.ts:1062)并展示迁移改动了哪些顶层字段(旧版本迁移有破坏性步骤,必须可见);进入编辑器的恒为迁移后的 v7 字典。
- **概览卡片**:职业/等级/金币/重铸石/第几区几层/模式/游玩时长/存档版本/seed/last_saved。
- **分组字段编辑器**(37 个顶层字段按语义分组):
  - 基础资源:gold/stones/level/xp/time/playtime
  - 进度:zone/stage/stage_kills/mode/farm_stage/deaths_row
  - 职业与技能:class_id(下拉,**选项一律 import CLASSES 键现读:warrior/mage/ranger**——禁止手写字面量,防枚举漂移)、loadout(技能 id 多选)、skill_lv(键值表)
  - 装备与背包:equip(6 槽子编辑器)、bag(条目列表:增删/排序提示 index 0 = 最新掉落)
  - 遗物与塔:relics(4 槽)、relic_bag、relic_bag_lv、tower、bag_exp_lv
  - 悬赏:quests(3 条:类型下拉 + target/progress/gold/stones)、quest_daily_* 、quest_reroll_count、tower_keys_bought
  - 统计与成长:stats(键值表,标注「同时是成就计量,改大=永久属性加成」)、altar_lv、stat_mods
  - 设置:settings(auto_equip/auto_sell_idx/speed)
  - 危险字段(折叠区,红字说明):version、gear_rules_21、seed —— 默认锁定只读,点「解锁」才能改(误改后果见字段注释)。
  - 条目级子编辑器:装备条目 = slot 下拉 + rarity 下拉(6 档)+ tier/plus/main_val 数字 + affixes 词条行([id 下拉, val 数字],可增删)+ name;遗物条目 = rarity + tier + effects 行([效果 id 下拉, val])+ skill_id 下拉。所有枚举下拉的选项来自核心表(面板 import data.ts),与 `Item.fromDict` 的无容错消费对齐(src/core/items.ts:160-164)。
- **实时校验面板**:每次编辑后调用核心 `validateSaveDict`;**error 阻断写回/导出**,warn 只提示;错误列表可点击定位到对应编辑控件。危险操作(删除 bag 条目、改 stats)二次确认。
- **备份与写回(四个出口)**:
  1. 「下载存档 JSON」:生成浏览器下载(文件名 `abyss-idle-save-编辑-<ts>.json`),可在游戏「设置→导入」回灌(main.ts:1559-1573 同一迁移链);
  2. 「写回服务器 save.json」:dev 桥 POST,写前自动备份 `save.json.bak-YYYYMMDD-HHMMSS`;备份列表可查看/一键载入(只读恢复点);
  3. 「写入本浏览器存档」:写 `localStorage["abyss_save_v2"]`,写前把旧值存 `abyss_save_v2.bak-<ts>`;开着的游戏页(dev)经 storage 热通道自动重载本次写入,无需关闭/刷新游戏页;
  5. 「远端玩家存档…」:管理端入口(2026-10-03 起)——填端点(默认 Cloudflare Worker)与管理 token,「列出最近」拉最近 200 名玩家摘要或按 uuid 单取,选中载入即走同一编辑器;此时写回区多出「写回远端玩家存档」出口(带 `X-Admin-Token` 头,跳过服务端包络/限流)。玩家端上行 = 生产构建每约 10 分钟 + 关页 beacon 的 `POST /save-sync`(docs/privacy-policy.md);
  4. 「放弃修改」:回滚到载入时的原件。
- **操作顺序提示**(页面顶部常驻):写回文件前先退出 CLI;写 localStorage 前先关游戏页。

### Tab 2 数值覆盖
- **左侧分类树**(面板侧元数据,12 类):英雄成长 / 战斗与怪物 / 掉落与稀有度 / 装备与词缀 / 主动技能 / 被动技能 / 职业 / 遗物与爬塔 / 经济与消耗 / 悬赏与成就 / 祭坛与药剂 / 解锁节奏与杂项。
- **搜索框**:按路径(如 `hero_atk0`)或中文名(面板元数据提供,含表内 name 字段)过滤全部叶子。
- **数值表**(数据源 = 核心 `listOverridableLeaves()`):每行 = 分类 | 路径 | 中文名 | 默认值 | 当前值输入框 | 改动标记 | 提示标记。
  - 🔒 **锁定行**(结构键/行为选择器):末段为 `id`/`key`/`cls`/`stat`/`hook`/`op`/`type`/`metric`/`buff`/`kind`/`pct` 的行、`THEMES.*.mobs.*` 行、`SLOT_INNATE.*.0` 行,不提供输入框(与核心层 R6 同一清单,双保险,见 §4.3);
  - ⚠ **警示行**(核心接受但后果需知):`RARITIES.*.affixes`、`RELIC_EFF_COUNT.*`(改变 rng 调用次数,TS 与 Python 行为分歧)、`TOWER.relic_slots`(运行时槽位数硬编码 4,改表无效)等,行尾警示气泡说明;
  - 编辑即时进「草稿」(纯数据对象,不碰运行中模块)。
- **顶部操作条**:
  - 已改 N 项 | 与默认 diff 预览;
  - 「保存覆盖」:草稿序列化后**同时**写 `localStorage["abyss_admin_overrides_v1"]`(Web 游戏用,但**仅 dev 构建的游戏页会读取**,§4.4/§10 R10)+ dev 桥写仓库根 `overrides.json`(CLI 用);写入经 storage 热通道即时生效(游戏页 dev 构建实时应用,见 §4.4),提示「游戏页已热生效;CLI 下次启动生效;Python 端不生效」;
  - 「一键恢复默认」:清空草稿 + 写空覆盖文件(`{"version":1,"values":{}}`,等效于删除)+ 清 localStorage 覆盖键;
  - 「导入/导出 overrides.json」:文件来回(手工分享配置用)。

### Tab 3 效果预览
- **采样协议**(核心保证可逆):`reset → apply(被测 values) → 采样 → reset → 重新 apply(已保存覆盖)`,预览永远不残留状态。
- **曲线选择**:英雄属性曲线(max_hp/atk/def vs 等级,1..N,用 `new Game(seed)` + `classId` + `level` + `recalcHero()`,src/core/game.ts:201-244)、升级经验曲线(`xpReq()`,game.ts:246-248)、怪物属性曲线(hp/atk/def/金币/经验 vs 区·层,用 `spawnMonster`/`mobGold`/`mobXp`/`tierOf`,src/core/combat.ts:56-103)、爬塔曲线(`towerMonster`/`towerGold`,src/core/tower.ts:18-51)。
- **双份对比**:同一采样函数跑两遍(默认值 vs 当前草稿),并排表格 + 手写 SVG 双折线(无图表库依赖);怪物曲线用固定 `PyRandom` 种子的示例怪,标注「含随机怪选择与 power 系数」。
- **可控参数**:职业、等级/区域范围、(怪物曲线)装备 tier(等级压制项)。

### Tab 4 说明(帮助)
- localStorage 存档取出导入的三种路径(§6.4);
- 覆盖生效范围表(§5.4)与 Python 端不生效说明;
- 备份策略与文件清单;
- 字段安全等级速查(§6.2 校验表摘录)。

---

## 4. 数值覆盖机制(核心设计)

### 4.1 可覆盖范围(注册表 22 个根,全部来自 `src/core/data.ts`)

`BAL, RARITIES, RARITY_PREFIX, SLOTS, MAIN_ROLLS, SLOT_INNATE, AFFIXES, AFFIX_SUFFIX, CAPS, CLASSES, ACTIVE_SKILLS, PASSIVE_SKILLS, THEMES, MONSTERS, ACHIEVEMENTS, QUEST_TYPES, ALTAR_LINES, POTIONS, STAT_NAMES, TOWER, RELIC_EFFECTS, RELIC_EFF_COUNT`

**不入注册表**(结构性/派生,覆盖它们没有正确语义):`RARITY_IDX / AFFIX_DEF / ACTIVE_DEF / PASSIVE_DEF / RELIC_EFF_DEF / SLOT_NAMES`(运行时派生映射,改源头数组即可)、`ART`(纯显示)、`VIRTUAL_STATS`(与 game.ts:33-35 内部清单双写耦合)。

**不可覆盖的数值(深耦合,写死在 TS/Python 双端多处,面板不开放)**:伤害公式 `atk²/(atk+def)` 与硬编码钳制(穿甲≤50%/闪避≤40%/CD≤40%/deathward 60s)、boss 技能「灭世之击」、塔 boss ×3.0/×1.3、击杀回血 8%、升级回血 30%、离线 0.7 折算、自动换装 1.05 阈值、遗物槽位数 4。要改这些 = 改协议,须双端同改并过对拍,超出本面板边界(风险 R5)。

### 4.2 覆盖文件格式(仓库根 `overrides.json`,与 localStorage 覆盖键同构)

```json
{
  "version": 1,
  "values": {
    "BAL.hero_atk0": 20,
    "BAL.loadout_unlock.2": 14,
    "RARITIES.5.weight": 3,
    "ACTIVE_SKILLS.12.cd": 4,
    "MONSTERS.slime.skill.slow.0": 0.4
  }
}
```

- **路径语法**:`根名` + `.` 分隔的属性段;数组下标用十进制字符串段(`RARITIES.5.weight`、`BAL.loadout_unlock.2`);`Record` 用键段(`MONSTERS.slime`、`MAIN_ROLLS.weapon.0.base`)。
- **值类型**:有限 number / string / boolean,必须与被覆盖叶子的当前类型一致。
- 序列化统一 2 空格缩进(便于手工编辑与 git diff)。

### 4.3 应用与拒绝规则(核心侧 `src/core/overrides.ts`)

模块加载时:对 22 个根做深度遍历,把**每个原始类型叶子**(number/string/boolean)的路径与当前值拍进 `defaults` 快照(数组的对象元素、嵌套对象、元组都走同一遍历;不含任何对象/数组本身的路径)。

`applyOverrides(values)` 逐条判定,**单条被拒不影响其它条,且被拒条目零写入**:

| 规则 | 判定 | reason 字符串 |
|------|------|---------------|
| R1 | 根名不在注册表 | `unknown root` |
| R2 | 路径任一段在当前层级不存在(含数组下标越界) | `path not found` |
| R3 | 最终目标不是原始类型叶子(是对象/数组) | `not a primitive leaf` |
| R4 | 新值 `typeof` ≠ 现值 `typeof` | `type mismatch` |
| R5 | number 值非 `Number.isFinite` | `non-finite number` |
| R6 | ①末段 ∈ 结构键集 `{id, key, cls, stat, hook, op, type, metric, buff, kind, pct}`;②路径前缀命中 `THEMES.<n>.mobs.<i>`;③根为 `SLOT_INNATE`、路径恰 3 段且末段为 `0`(即 `SLOT_INNATE.<slot>.0`,元组下标 0 持有 StatKey) | `locked structural key` |

R6 依据(每条都有实证或消费点支撑):这些叶子是**被别处按键引用的标识或行为选择器**——`AFFIX_DEF` 由 `AFFIXES[].id` 派生、存档物品词条引用词缀 id、`QUEST_TYPES[].type` 被存档 quests 引用、`THEMES[].mobs` 的值必须是 `MONSTERS` 键否则 `spawnMonster` 在 combat.ts:74-75 直接崩。`RARITIES[].key` 是评审轮补上的高危项(2026-10-03 实测复现):`RARITY_IDX` 在模块加载时由原 key 派生(data.ts:16-17),改名 `RARITIES[0].key` 后 roll 出的装备 `rarity="renamed_common"`,下一次 `score()/recalcHero()` 走 `RARITIES[RARITY_IDX[rarity]].mainMul`(items.ts:73)即抛 `TypeError: Cannot read properties of undefined (reading 'mainMul')`——游戏在下一次掉落/换装时崩溃。`SLOT_INNATE.<slot>.0` 持有属性键(data.ts:62-64),改成未知键会被 `Item.stats()` 静默聚合进英雄属性(items.ts:86-92 + game.ts:213-216,不崩但与锁语义不符);按「末段匹配」永远锁不到元组下标,故用前缀规则③。`kind` 与 `pct` 是终审轮补上的**行为选择器**(不崩但静默改变战斗行为):`castActive` 按 `kind` 逐分支(skills.ts:147-185)——改成未知串技能静默 no-op,把伤害技改成 `buff` 会走 `addBuff(g, sdef.stat!, ...)` 而该技能无 `stat` 字段即写入 undefined 键(skills.ts:81-86、167-168);`passiveMods`/`hookDef` 按 `kind` 过滤(skills.ts:57、68);`AFFIXES[].pct` 决定词缀吃倍率×强化还是只吃强化(items.ts:83-84)、重铸与 roll 的数值口径(items.ts:130-132、252-254)。`key`/`kind`/`pct` 字段在 data.ts 中仅上述表存在(TOWER 的 `keys_per_day/keys_cap`、STAT_NAMES 的 `dmg_pct/xp_pct` 键名不同,均无误伤)。数值本身(权重/范围/倍率/base/per/cd/dur/费用)全部可覆盖。

`parseOverrideFile(text)` 对**文件整体**严格校验,任一不符抛 `OverrideFormatError`(宿主捕获后按默认值继续):JSON 解析失败 / 顶层非普通对象 / `version` 缺失或不为 `1` / `values` 缺失或非普通对象 / `values` 含非原始类型值或空字符串键。

### 4.4 生效路径与时机

| 宿主 | 覆盖来源 | 应用时机(均在第一次 `Game.load()`/`new Game()` 之前) |
|------|----------|--------------------------------------------------------|
| TS CLI(`npm run cli`) | 仓库根 `overrides.json` | `runInteractive()` 开头(src/cli.ts,existsSync 短路,不存在零开销);应用/拒绝信息打 stderr(TUI 占用 stdout) |
| Web(**仅 dev 构建**;线上/TapTap 构建不读取) | `localStorage["abyss_admin_overrides_v1"]` | `boot()` 开头、`installSaveHooks` 之前(src/web/main.ts,`IS_DEV` 门禁:堵"改 localStorage 即改数值"的排行榜作弊面,§10 R10);parse 失败 console.warn 后按默认值运行 |
| Python CLI(`py run.py`)、对拍(`sim.ts` / parity.sh) | **不加载** | —— |

已应用后改值的生效方式:英雄侧字段(成长/职业/装备表)在下次 `recalcHero()`(装备/等级/修饰器变化即触发,或读档)生效;怪物/掉落/技能参数在下次生成/施放时生效。**dev 构建的游戏页经 storage 热通道即时接收面板写入**(面板与游戏页是两个文档,但同源 localStorage 的 storage 事件只在对方标签页写入时触发,正好构成面板→游戏页的单向信号:覆盖键写入→实时应用并 `recalcHero()`,键删除→恢复默认,存档键写入→下一拍安全热重载);线上/TapTap 构建无此监听,行为不变。

### 4.5 Python 侧不消费覆盖的论证(硬约束 1 的决策)

**决策:abyss/(Python)不加载覆盖。** 理由:

1. `abyss/` 是**冻结的对拍基准**(docs/07-typescript-port.md:"Python abyss/ 冻结为对拍基准",数值体系原样等值翻译)。往 `abyss/game.py`/`run.py` 加覆盖加载逻辑 = 动冻结代码,基准本身失去意义。
2. 对拍绿的两个前提是「TS sim 不加载覆盖」与「Python 不加载覆盖」。只做 TS 侧即可让 `parity.sh` 与覆盖文件**彻底解耦**——实测当前基线 `bash scripts/parity.sh 180` 退出码 0(本方案设计时验证),实现后要求在**存在 overrides.json 的状态下**再跑一次仍为 0(§9 验证第 5/6 项)。
3. 若双端都消费,「覆盖语义等价」会变成新的对拍失败面(两套 apply 实现、两套拒绝规则、两套快照恢复),收益仅是 Python CLI 也能玩改数值版——而游戏的主要宿主(TS CLI/Web)已全覆盖。

**影响(必须知情)**:覆盖只对 TS 端生效。用 `py run.py` 续玩同一 save.json 时按**默认数值**进行;存档本身兼容(存档存的是结果值:金币、装备词条数值,不存表引用),但「TS 端调强→回 Python 端会突然变难 / TS 端调弱→Python 端打不动」的体验跳变是预期行为。风险与缓解见 §10 R1。

### 4.6 默认行为零改变的构造性保证

1. `src/core/data.ts` 及全部引擎文件**一字节不改**;
2. 无覆盖文件时:CLI 的 `existsSync` 为 false 直接跳过;Web 的 `localStorage.getItem` 为 null 直接跳过——两条路径都是宿主入口处的独立 if 块,核心模块加载路径与现在完全一致;
3. `overrides.ts` 自身仅被「宿主入口 + 面板 + 冒烟测试」import,`sim.ts` 不 import 它 → 对拍二进制路径不变;
4. 快照恢复 `resetOverrides()` 保证面板预览的临时应用不残留(探针已实证恢复到基线)。

---

## 5. 存档管理方案

### 5.1 数据流

```
原始输入(save.json / localStorage / 文件 / 粘贴)
  → JSON.parse(失败即拒绝载入并提示,不开新档——注意:游戏本体坏档是开新档,面板必须更保守)
  → 保留原件(内存 + 可下载备份)
  → migrateSave(展示迁移 diff)
  → 编辑器(结构化编辑,草稿即字典本身)
  → validateSaveDict 实时校验(error 阻断写回)
  → 导出/写回(四出口,见 §3 Tab1)
```

写回 `save.json` 的序列化格式 = `JSON.stringify(dict)`(紧凑,与游戏 `toDict` 写出一致,src/cli.ts:72);键序沿用解析后的插入序 → 未编辑字段的往返逐字节一致。面板对 `last_saved` 字段**不自动改写**:保留原值(由玩家决定是否伪造离线);写回时列出「本次改动的字段清单」供确认。

### 5.2 校验规则表(`src/core/savefile.ts`,错误/警告两级)

**error(阻断写回;依据:引擎崩溃 / 静默丢数据 / 破坏枚举)**

| 检查 | 依据(消费点) |
|------|----------------|
| `version` 缺失/非整数,或 > SAVE_VERSION(7) | migrateSave(game.ts:1062)按版本改写 |
| `gear_rules_21` ≠ true | 载入即清空 equip+bag(game.ts:1108-1112) |
| `class_id` 非 null 且 ∉ CLASSES 键 | recalcHero 回落战士但技能校验全挂(game.ts:203,487-490) |
| `mode` ∉ {push, farm} | 静默回落 push |
| `equip` 非普通对象 / 键 ∉ SLOTS id;`bag` 非数组 | fromDict 无容错(game.ts:996-998) |
| 装备条目:`slot` ∉ SLOTS;`rarity` ∉ 6 档;`tier/plus/main_val` 非有限数字(plus≥0 整数,tier≥1 整数);`affixes` 非数组或元素非 `[合法词缀id, 有限数字]`;`main_id` 存在时 ∉ {atk,hp,def} | `Item.stats()/rarityColor()/statLines()` 无容错崩溃(items.ts:73,84,166-201) |
| `quests[].type` ∉ QUEST_TYPES 4 类 | `questDesc` 的 `find(...)!.tpl` 崩(systems.ts:21-24) |
| `quests[].target/progress/gold/stones` 非有限数字 | 比较与发奖算术 |
| `relics` 非数组(形状坏 → fromDict 整体重置 4 空槽 = 丢塔成果) | game.ts:1014-1016 |
| 遗物条目:`rarity` ∉ 6 档;`tier` 非有限数字;`effects` 非数组或元素非 `[合法效果id, 有限数字]` | `effectLines` 的 `RELIC_EFF_DEF[e.id].name` 崩(relics.ts:63-66) |
| `level` 非正整数 | recalcHero 以 level 为乘区输入(game.ts:206) |
| `tower` 非 `{keys:数字, max_floor:数字, …}` 形状 | 形状坏整体回默认(game.ts:1020-1024)= 丢进度 |

**warn(提示不阻断;引擎容错但体验/数据受影响)**

| 检查 | 说明 |
|------|------|
| `version` < 7 | 载入将执行迁移(v<4 会重置职业/装配,game.ts:1074-1089)——面板载入时已自动迁移,此项针对「粘贴未迁移 JSON」 |
| `loadout.active/passive` 含未知技能 id / 他职业技能 id | 折算忽略、装配页异常 |
| `skill_lv` 键 ∉ 技能池;值 ∉ 1..skill_lv_max(整数) | 无效但无害 |
| `stats`/`settings`/`stat_mods`/`altar_lv` 非普通对象/数组;`auto_sell_idx` ∉ -1..5;`speed` ∉ 1..3;altar 键非法 | 静默忽略或行为异常 |
| `zone/stage/farm_stage` 越界(stage/farm_stage ∉ 1..10) | 下次推进/挂机调整时拉回 |
| `gold/stones/xp/time/playtime` 为负 | 数值合法但反直觉 |
| `seed` 非整数;`last_saved` 非数字;`quest_daily_date` 非 YYYY-MM-DD | 行为未定义/离线结算异常 |
| `bag` 超容量 / `relic_bag` 超容量 | 不报错,新掉落触发自动出售 |
| `relics` 长度 ≠ 4 / `quests` 长度 ≠ 3 | fromDict 截断/补齐 |
| 遗物 `skill_id` ∉ 主动技能池;物品 `name` 非字符串 | 显示异常 |
| `class_id` 为 null 但 level/进度很高 | 未开局状态与进度矛盾(仅提示) |

### 5.3 备份策略(三层)

1. **dev 桥写前自动备份**:POST `save.json`/`overrides.json` 前先复制为 `<name>.bak-YYYYMMDD-HHMMSS`(仓库根,已加入 .gitignore);面板「备份列表」可查看并一键载入任一备份(只读恢复点);备份文件过多时手工清理(文档说明)。
2. **面板内存原件**:载入即保留原始 JSON,「放弃修改」随时回滚;每次写回前列出改动字段清单确认。
3. **localStorage 写前备份**:写 `abyss_save_v2` 前旧值存 `abyss_save_v2.bak-<ts>`。

### 5.4 浏览器 localStorage 存档如何取出导入(需求明示项)

游戏 Web 版存档在 `localStorage["abyss_save_v2"]`(键名 src/web/main.ts:40;同键也被 web/app 与 web/legacy 共用,同源互导)。三条取出路径:

1. **同源直读(推荐,dev 场景)**:`npm run dev` 下游戏与面板同源(localhost:8614)→ 面板「读取本浏览器存档」一键取出,零手工。
2. **游戏内导出文件(任意场景)**:游戏「设置 → 存档 → 导出」下载 `abyss-idle-save.json`(main.ts:1545-1552)→ 面板「导入文件」选中它。编辑后「下载存档 JSON」→ 游戏设置页「导入」回灌(走同一 migrateSave,main.ts:1559-1573)。**线上(gh-pages)存档只能走这条路**(跨源读不到 localStorage)。
3. **DevTools 手工复制(兜底)**:F12 → Application → Local Storage → 选中游戏源 → 键 `abyss_save_v2` → 复制 Value(整份 JSON 文本)→ 面板「粘贴 JSON」载入。适合游戏页已打不开/云同步冲突排查等场景。

云存档(Supabase `saves` 表)不在面板管辖:如需把云端档取下来编辑,在游戏内登录后按同步提示用云端覆盖本地(新者胜逻辑,main.ts:1657-1684),再走路径 1/2 取出。

### 5.5 已知存档怪癖(面板要标注,不修复)

- **Python CLI 续存丢遗物背包**:`relic_bag/relic_bag_lv` 是 TS 宿主专属,`abyss/game.py` 不读不写(其注释自述);用 `py run.py` 续玩同一 save.json 再存,遗物背包内容会消失(样例 save.json 即无这两个键)。面板载入时若发现字典缺这两个键,提示「此档被 Python 端写过,遗物背包已丢失为既有行为」。
- **seed 改动**:改 seed 只改未来随机流不坏档(RNG 从 seed 重播,rng.ts),但所有后续随机结果改变。
- **离线结算**:`last_saved` 决定离线收益(封顶 12h,systems.ts:246-251),面板不自动改写它。

---

## 6. 文件改动清单(含唯一归属)

### 核心侧(实现者甲,唯一归属)

| # | 文件 | 动作 | 内容 |
|---|------|------|------|
| 1 | `src/core/overrides.ts` | 新增(~150 行) | 覆盖注册表 + parse/apply/reset/diff/list/serialize(§8.A 契约) |
| 2 | `src/core/savefile.ts` | 新增(~200 行) | validateSaveDict / validateItemDict / validateRelicDict(§8.B 契约) |
| 3 | `src/cli.ts` | 修改(+~12 行) | `runInteractive()` 开头加载仓库根 overrides.json(§4.4) |
| 4 | `src/web/main.ts` | 修改(+~9 行) | `boot()` 开头加载 localStorage 覆盖键(§4.4) |
| 5 | `scripts/admin-smoke.ts` | 新增(~250 行) | 冒烟测试(§9.1),不写任何文件 |
| 6 | `.gitignore` | 修改(+4 行) | `overrides.json`、`overrides.json.bak-*`、`save.json.bak-*`、注释 |

### 面板侧(实现者乙,唯一归属)

| # | 文件 | 动作 | 内容 |
|---|------|------|------|
| 7 | `src/web/admin/index.html` | 新增 | 面板壳:`<link href="../style.css">` + 自有微调 `<style>` + `#app` 容器 + `./admin.ts` 模块入口;标题「深渊放置 · 本地管理面板」 |
| 8 | `src/web/admin/admin.ts`(及同目录 `admin-*.ts` 拆分,拆法自由) | 新增(合计 ~900-1300 行) | 四个 tab 全部 UI 与交互;只准 import §8.D 列出的核心 API |
| 9 | `vite.config.ts` | 修改(+~70 行) | ① `build.rollupOptions.input` 增加 admin 第二入口(绝对路径 via `fileURLToPath(new URL(...))`);② `adminDevBridge()` 插件(`apply:"serve"`,§8.C 契约) |
| 10 | `scripts/deploy-pages.sh` | 修改(+1 行) | **锚点:第 12 行 `npx vite build` 之后、第 18 行 `cd src/web/dist-gh` 之前**插入 `rm -rf src/web/dist-gh/admin`(硬底线:必须在第 21 行 `git add -A` 之前,否则 admin 页进 gh-pages) |
| 11 | `scripts/package-taptap.sh` | 修改(+1 行) | **锚点:第 15 行 `npx vite build` 之后、第 17-18 行 grep 校验之前**插入 `rm -rf dist-taptap/admin`(硬底线:必须在第 27 行 `cp -r dist-taptap/.` 之前,否则 admin 页进 TapTap zip——正是 R7 要防的结果) |

### 已完成(架构侧,本文档)

| 12 | `docs/admin-panel.md` | 本方案 |
| 13 | `docs/README.md` | 索引表加一行 |

**共享文件:无。** 两侧文件集互不相交;`vite.config.ts` 归面板侧、`main.ts`/`cli.ts` 归核心侧、`.gitignore` 归核心侧,均唯一归属。两侧唯一的耦合面是 §8 的 API 契约(核心侧实现、面板侧消费)。

---

## 7. 两位实现者的接口契约(零沟通并行)

### A. 核心侧:`src/core/overrides.ts` 导出(面板侧按此消费,签名逐字为准)

```ts
export type OverrideValue = number | string | boolean;
/** {"BAL.hero_hp0": 150, "RARITIES.5.weight": 30, "MONSTERS.slime.skill.cd": 8} */
export type OverrideValues = Record<string, OverrideValue>;

export interface OverrideRejection { path: string; reason: string }
export interface OverrideApplyResult {
  applied: string[];                 // 成功应用(并已写入活对象)的路径,按入参序
  rejected: OverrideRejection[];     // 被拒路径 + reason(§4.3 R1-R6 的 reason 字符串)
}

/** 文件整体格式错误。name 恒为 "OverrideFormatError"。 */
export class OverrideFormatError extends Error {}

/** 解析并严格校验覆盖文件文本 → values 映射。规则见 §4.3(parse 层)。 */
export function parseOverrideFile(text: string): OverrideValues;

/** 逐条应用;合法条目立即写入 data.ts 活对象(对全部已 import 方即时生效);
 *  非法条目记入 rejected 且零写入。幂等,可重复调用。 */
export function applyOverrides(values: OverrideValues): OverrideApplyResult;

/** 一键恢复默认:把 22 个根的全部叶子写回模块加载时的快照。 */
export function resetOverrides(): void;

/** 当前值 ≠ 默认值 的叶子(面板「已改 N 项」与保存文件的内容来源)。 */
export function overrideDiff(): OverrideValues;

/** 全部可覆盖叶子的当前值(扁平路径表,面板浏览/搜索数据源;规模 ~500 条)。 */
export function listOverridableLeaves(): Record<string, OverrideValue>;

/** 序列化为覆盖文件文本(JSON 2 空格缩进,{"version":1,"values":{...}})。 */
export function serializeOverrideFile(values: OverrideValues): string;
```

实现要点(核心侧必须遵守):注册表根清单 = §4.1 的 22 个;快照在**模块加载时**(任何 apply 之前)建立;`BAL` 是 `as const`,写入需经 `Writable` 映射类型转换(`type Writable<T> = { -readonly [K in keyof T]: T[K] }`,运行时本就可写);本模块**不得** import 任何 node:/浏览器 API(纯函数,双宿主可用);R6 锁定规则硬编码为模块内常量:**末段 ∈ {id, key, cls, stat, hook, op, type, metric, buff, kind, pct} ∨ 路径前缀命中 `THEMES.<n>.mobs.<i>` ∨ (根=SLOT_INNATE ∧ 路径恰 3 段 ∧ 末段==="0")**,三者 reason 均为 `locked structural key`。

### B. 核心侧:`src/core/savefile.ts` 导出

```ts
export interface SaveIssue { field: string; level: "error" | "warn"; message: string }

/** 校验迁移后的存档字典(v7 语义)。返回全部问题;无 error 即可写回。
 *  field 形如 "bag.3.affixes.1.0"、"quests.0.type"、"equip.weapon.rarity"。 */
export function validateSaveDict(d: Record<string, any>): SaveIssue[];

/** 单件装备字典校验(where 为定位前缀,如 "bag.3" / "equip.weapon")。 */
export function validateItemDict(item: any, where: string): SaveIssue[];

/** 单件遗物字典校验(where 同上,如 "relics.2" / "relic_bag.5")。 */
export function validateRelicDict(relic: any, where: string): SaveIssue[];
```

实现要点:枚举一律从 `data.ts` 现读(`CLASSES`/`SLOTS`/`RARITY_IDX`/`AFFIX_DEF`/`RELIC_EFF_DEF`/`QUEST_TYPES`/`ACTIVE_DEF`/`PASSIVE_DEF`/`ALTAR_LINES`);`SAVE_VERSION` 从 `game.ts` import;规则矩阵 = §5.2(error/warn 分级逐条实现,message 中文、含现值);纯函数无副作用、不修改入参。

### C. 面板侧:`vite.config.ts` 的 `adminDevBridge()` 插件(核心侧无关,但 CLI/文档引用其行为)

HTTP 端点(全部 JSON 响应;仓库根 = `fileURLToPath(new URL(".", import.meta.url))`):

| 方法+路径 | 行为 |
|-----------|------|
| `GET /__admin/health` | `{ok:true, bridge:"v1"}`(面板探测 dev 桥是否存在) |
| `GET /__admin/file?name=save.json` | `{ok, exists, content}`;不存在 `{ok:true, exists:false, content:null}` |
| `GET /__admin/file?name=overrides.json` | 同上 |
| `GET /__admin/file?name=save.json.bak-20261003-141230` | 备份读取;name 须匹配 `^save\.json\.bak-\d{8}-\d{6}$` 或 `^overrides\.json\.bak-\d{8}-\d{6}$` |
| `GET /__admin/backups` | `{ok, names:[...]}`,仓库根 `*.bak-*` 按名倒序,至多 50 |
| `POST /__admin/file?name=<save.json\|overrides.json>` | body=原始文本(utf8,上限 32MB);目标已存在则先复制为 `<name>.bak-YYYYMMDD-HHMMSS` 再写入;返回 `{ok, bytes, backup}` |
| 其它 | 400 `{ok:false, error:"..."}` |

约束:`apply:"serve"`(dev only,build/preview 不注册);name 白名单外一律 400(无路径穿越面);不新增任何 npm 依赖(vite 插件 API + node:fs/path/url)。

`rollupOptions.input` 用绝对路径:`{ main: fileURLToPath(new URL("./src/web/index.html", import.meta.url)), admin: fileURLToPath(new URL("./src/web/admin/index.html", import.meta.url)) }`,其余配置(base/publicDir/outDir/port)不动。

### D. 面板侧允许 import 的核心面(白名单,此外不得 import 核心/宿主其它模块)

```ts
import { parseOverrideFile, applyOverrides, resetOverrides, overrideDiff,
         listOverridableLeaves, serializeOverrideFile, OverrideFormatError,
         type OverrideValue, type OverrideValues, type OverrideApplyResult,
         type OverrideRejection } from "../../core/overrides.ts";
import { validateSaveDict, validateItemDict, validateRelicDict,
         type SaveIssue } from "../../core/savefile.ts";
import { Game, migrateSave, SAVE_VERSION } from "../../core/game.ts";
import { BAL, RARITIES, RARITY_PREFIX, SLOTS, MAIN_ROLLS, SLOT_INNATE, AFFIXES,
         AFFIX_SUFFIX, CAPS, CLASSES, ACTIVE_SKILLS, PASSIVE_SKILLS, THEMES,
         MONSTERS, ACHIEVEMENTS, QUEST_TYPES, ALTAR_LINES, POTIONS, STAT_NAMES,
         TOWER, RELIC_EFFECTS, RELIC_EFF_COUNT } from "../../core/data.ts";   // 只读渲染
import { tierOf, mobGold, mobXp, spawnMonster } from "../../core/combat.ts";  // 预览采样
import { towerMonster, towerGold } from "../../core/tower.ts";                // 预览采样
import { PyRandom } from "../../core/rng.ts";                                 // 预览采样
import { rollItem } from "../../core/items.ts";                               // 可选:生成合法示例装备
```

面板承诺:对核心表对象**只读**(渲染枚举/中文名);对运行时数值的全部变异只经 `applyOverrides/resetOverrides`;存档写字典但不调 `installSaveHooks`、不构造会自动保存的 Game(预览用的 Game 不注入 hooks,`save()` 为 no-op,game.ts:978-980 安全);**全部枚举下拉选项一律 import 核心表现读(如 class_id 取 CLASSES 键 warrior/mage/ranger),禁止手写字面量**。

**DOM 类型前提(面板侧每个 admin-*.ts 文件头必须带):**

```ts
/// <reference lib="dom" />
```

背景(2026-10-03 实测):tsconfig 的 `lib: ["ES2022"]`、`types: ["node"]` 不含 DOM;现状是 `src/web/main.ts:5` 的 `/// <reference lib="dom" />` 在起作用——三斜线 lib 引用是**程序级**的,实测在 `src/web/admin/` 下新建**不带**该行的文件(使用 `document/localStorage`)跑 `npm run typecheck` 也能通过。但这是对 main.ts 的隐式依赖(main.ts 若重构删掉该行,admin 页类型全体报错),因此契约仍要求每个 admin-*.ts 自带这一行,自包含、零沟通。

### E. 共享常量(两侧字面一致,写死各自文件,不新增共享文件)

| 常量 | 值 | 出现在 |
|------|----|--------|
| localStorage 覆盖键 | `"abyss_admin_overrides_v1"` | admin 页(面板侧**写**)+ main.ts(核心侧**只读**) |
| **localStorage 覆盖键的值格式** | **= `serializeOverrideFile(values)` 的输出原文**(即完整文件 JSON `{"version":1,"values":{...}}`,2 空格缩进;**不是**裸 values 对象) | 面板侧写入时必须用 `serializeOverrideFile`;核心侧 main.ts 用 `parseOverrideFile` 解析,失败 console.warn 后按默认值运行 |
| 覆盖文件当前版本 | `1` | overrides.ts(`parse`/`serialize`) |
| 备份文件名模式 | `<name>.bak-YYYYMMDD-HHMMSS`(本地时间) | vite.config.ts(面板侧)与文档 |

> 值格式是零沟通关键(终审轮补):该键面板侧写、核心侧读,横跨两位实现者。若面板侧写 `JSON.stringify(values)`(裸对象,缺 `version`),核心侧 `parseOverrideFile` 必抛 `OverrideFormatError` 并按 §4.4 静默回落默认值——Web 端覆盖永远不生效且无任何报错。故钉死:**值 = serializeOverrideFile 输出原文**。

### F. 并行顺序

核心侧与面板侧无文件交集、无构建顺序依赖,可同时开工。汇合点仅两处:① 面板侧在核心侧合并前进度不受影响(核心 API 未就绪时先以本地 stub 占位,合并时删除);② 汇合后统一跑 §9 全部门禁。

---

## 8. 验证方案

### 8.1 冒烟测试 `scripts/admin-smoke.ts`(核心侧实现,固定命令)

```bash
node --experimental-strip-types scripts/admin-smoke.ts    # 退出码 0 判过
```

纯内存运行(不读写仓库根 save.json/overrides.json,不写任何文件)。断言分组(每条独立 PASS/FAIL 打印,任一 FAIL → 退出码 1;全过打印 `[ADMIN-SMOKE PASS] n/n` 退出 0):

**A. 覆盖加载/应用/非法拒绝**
1. `listOverridableLeaves()` ≥ 400 条,含 `BAL.hero_hp0`、`RARITIES.5.weight`、`ACTIVE_SKILLS.0.cd`、`MONSTERS.slime.skill.cd`;
2. 合法应用:`applyOverrides({"BAL.hero_atk0":1000,"RARITIES.5.weight":1e9,"ACTIVE_SKILLS.0.cd":1})` → applied 3 / rejected 0,实读三处已变;
3. 引擎生效:`new Game(7)` + `classId="warrior"` + `recalcHero()` → `hero.atk === 1000*1.05`;
4. 非法拒绝(逐条独立注入并验证「零写入」):未知根 `FOO.bar`、未知路径 `BAL.no_such`、数组越界 `RARITIES.99.weight`、类型不符 `"BAL.hero_atk0":"x"`、非叶 `"BAL":1`、非有限数 `{path:Number.NaN}`、结构键五条——`"AFFIXES.0.id":"boom"`、`"RARITIES.0.key":"x"`、`"THEMES.0.mobs.0":"dragon"`、`"SLOT_INNATE.boots.0":"zzz"`、`"ACTIVE_SKILLS.0.kind":"heal"`(类型合法的行为选择器,终审轮补锁项)→ 各自 rejected 且 reason 正确(均 `locked structural key`;`RARITIES.*.key` 是评审轮实测出的掉落即崩路径,必须断言);
5. `parseOverrideFile`:坏 JSON / 顶层数组 / version 缺失 / version=2 / values 缺失 / values 含嵌套对象 → 均抛 `OverrideFormatError`;空 values `{}` → 返回 `{}` 且 apply applied=0;
6. 恢复与往返:`resetOverrides()` 后 `overrideDiff()=={}` 且引擎重算回到基线;`serializeOverrideFile(overrideDiff())` → `parseOverrideFile` → `applyOverrides` → diff 复现。

**B. 存档 读入→修改→校验→导出 往返**
7. 造档:`new Game(20260930)` + `chooseClass("warrior")` + 数百 tick + 造一件 `rollItem` 入 bag → `toDict()`;`validateSaveDict` 无 error;
8. `migrateSave` 幂等:连跑两次字典不变;
9. 修改:gold/level、bag 追加合法装备、quests[0].progress=target → 再校验仍无 error;
10. 往返:`JSON.stringify(编辑档)` → `JSON.parse` → `Game.fromDict` → `toDict`,关键字段(gold/level/zone/stage/bag.length/quests/equip)逐项相等;
11. 破坏注入(每条独立):`class_id="hacker"`、bag 条目 `rarity="divine"`、`quests[0].type="yolo"`、`gear_rules_21=false`、遗物 `effects=[["nope",1]]` → `validateSaveDict` 各自产出对应 error。

### 8.2 全量门禁(汇合后必跑,当前基线全部实测通过)

| # | 命令 | 通过标准 | 基线(本方案设计时实测) |
|---|------|----------|--------------------------|
| 1 | `node --experimental-strip-types scripts/admin-smoke.ts` | 退出码 0 | 新增(实现后) |
| 2 | `npm test` | 13/13 ALL PASS | ✅ 已实测 13/13 |
| 3 | `npm run typecheck` | 0 错误(含 admin 页) | ✅ 已实测通过 |
| 4 | Git Bash:`cmd //c "npm run build"`(cmd.exe 原生:`cmd /c npm run build`) | 退出码 0 **且日志出现 vite build 模块统计**;`dist/admin/index.html` 产出 | ✅ 已实测通过(单入口,62 模块) |
| 5 | `bash scripts/parity.sh 180` | 退出码 0(无覆盖文件) | ✅ 已实测 PARITY OK |
| 6 | 造一份 overrides.json 后再跑 `bash scripts/parity.sh 180` | **仍退出码 0**(覆盖/对拍解耦的直接证明) | 实现后验证 |
| 7 | 手动:`npm run dev` → `/admin/` 走通 载入→改→校验→写回 save.json → CLI 读档确认;`npm run cli` 确认覆盖生效与拒绝提示 | 人工 | 实现后验证 |

---

## 9. 设计验证记录(本方案定稿前实测)

- `npm test` → 13/13 `[ALL PASS]`(含存档往返/迁移/防御/遗物背包四组专项);
- `npm run typecheck` → 通过;
- `bash scripts/parity.sh 180` → `PARITY OK(逐行一致)` 退出码 0(约束 1 的基线锚点);
- `cmd //c "npm run build"` → 退出码 0,dist 单入口 62 模块。**注意假绿陷阱(终审轮确认,本方案设计时亲历)**:在 Git Bash/MSYS 下按硬约束字面跑 `cmd /c npm run build`,`/c` 被路径转换,cmd 以交互模式启动读到 EOF 即退出——只打印 Windows banner、退出码 0,**构建完全没有执行**;必须用 `cmd //c "npm run build"`(或换 cmd.exe 原生 shell)。故全文验收命令统一为后者;
- 运行时覆盖探针(node --experimental-strip-types 直接驱动核心模块):`BAL.hero_atk0 15→1000` 使 `recalcHero` 攻击 15.75→1050(理论值 1000×1.05 吻合);`RARITIES[5].weight→1e9` 使 200 次抽样 mythic 200/200,恢复后 0/200;技能表参数变异生效;全量恢复后引擎回到基线。探针还两次实证了「恢复必须基于模块加载时的全量快照,手工逐项回填不可靠」——已作为 §8.A 的 resetOverrides 设计依据。
- **评审轮复现(2026-10-03,驱动方式同上)**:
  - 改名 `RARITIES[0].key` 后循环 roll 至命中该档,`score()` 与装备该件后的 `recalcHero()` 均抛 `TypeError: Cannot read properties of undefined (reading 'mainMul')`(items.ts:73 经 RARITY_IDX 查不到)——证实 R6 必须锁 `key`,游戏在下一次掉落/换装即崩;
  - `SLOT_INNATE.boots[0]` 改未知属性键:`recalcHero()` 不崩(静默聚合路径在 items.ts:86-92 + game.ts:213-216)——不崩但违反锁语义,按前缀规则锁 `SLOT_INNATE.<slot>.0`;
  - DOM 类型实验:`src/web/admin/` 下新建**不带** `/// <reference lib="dom" />` 的文件(使用 document/localStorage),`npm run typecheck` 退出 0——证明 main.ts:5 的程序级 lib 引用对整个编译生效;契约仍要求 admin-*.ts 各自加该行(自包含,见 §7.D)。实验后已删除探针文件并复跑 typecheck 确认基线干净。

---

## 10. 风险与规避

| # | 风险 | 影响 | 规避 |
|---|------|------|------|
| R1 | **覆盖只对 TS 端生效**(CLI/Web);Python CLI 不消费 | `py run.py` 续玩同一存档按默认数值,与 TS 端体验跳变;存档兼容(结果值不引用表) | 文档 + 面板保存覆盖时的成功提示里明示「Python 端不生效」;这是有意决策(§4.5),不是遗漏 |
| R2 | 覆盖改变 rng 调用序列的参数(如 `RARITIES.*.affixes` 条数、`RELIC_EFF_COUNT`) | TS 端随机流与 Python 基准行为分歧(**不影响 parity**:sim 不加载覆盖);同 seed 不可复现基准局 | 面板在这些路径挂 ⚠ 警示;文档写明「追求对拍口径时不要改这些项」 |
| R3 | 手工编辑 overrides.json 绕过面板注入「类型合法但语义非法」的字符串 | 已由核心 R6 结构键锁封死**全部已实证/已识别的崩溃、污染与行为漂移面**:末段键 {id, key, cls, stat, hook, op, type, metric, buff, kind, pct} + 前缀锁 `THEMES.*.mobs.*` + 元组键位锁 `SLOT_INNATE.*.0`(`RARITIES.*.key` 是评审轮实测出的「下一次掉落即 TypeError」路径;`kind`/`pct` 是终审轮补上的行为选择器,不锁会静默改变战斗行为)。**残余面仅纯显示文案键**(name/color/icon/desc/tpl/unit/boss/RARITY_PREFIX)——只影响显示,不崩也不改行为 | R6 黑名单 + 面板 🔒 行(同一清单)双保险;冒烟 A4 对五类结构键各断言一条 |
| R4 | 游戏页与面板并发写 localStorage / save.json | 游戏页 10s 自动存档覆盖面板写入;CLI 运行中写 save.json 被退出时覆盖 | 面板写回前强提示「先关游戏页/退 CLI」;dev 桥与 localStorage 双侧自动备份可恢复 |
| R5 | 深耦合数值(伤害公式/硬编码钳制/塔 boss 倍率等)不可覆盖 | 策划「全量数值」诉求覆盖约 90%(全部表型 + BAL 常量);剩余为协议级 | 明确划界(§4.1);要改须双端同改并过对拍,不走本面板 |
| R6 | vite.config.ts 改动影响既有构建路径 | 理论上 input 变更会改变产物布局(admin 独立 chunk,主入口 hash 可能变化) | 门禁 4(build)+ 门禁 5/6(parity)+ 部署脚本试跑;base/publicDir/outDir/port 均不动 |
| R7 | 管理页意外进入线上产物 | gh-pages / TapTap 包出现无鉴权管理页(虽只操作本地数据,但徒增审查面) | 两个部署脚本已加删除行且**插入锚点已钉死到行号**(§6 #10/#11:pages 在构建:12 之后、`cd`:18 之前;taptap 在构建:15 之后、grep 校验:17 之前,硬底线在 `cp`:27 之前)——删除行放错位置(如脚本末尾)会正好让 admin 进包,评审轮已专项标注;未来新增部署脚本时须记得排除 |
| R8 | dev 桥无鉴权 | 任何能访问本机 8614 端口的进程可读写 save.json/overrides.json | dev server 默认只绑 localhost;`apply:"serve"` 保证不进任何线上构建;面板定位为本地工具,与需求一致 |
| R9 | npm 依赖 | **零新增**(面板手写 DOM+SVG;dev 桥用 vite 插件 API) | 无需缓解;若未来引入图表库等须重新评审 |
| R10 | 线上构建读取 localStorage 覆盖键 = 排行榜作弊面(玩家 DevTools 写该键即改数值,成绩不可辨) | 该路径曾对全部构建生效 | `boot()` 读取已加 `import.meta.env.DEV` 门禁:线上/TapTap 构建恒不读取(生产包整段被 tree-shake);另在排行榜两端(ECS/Worker)加语义包络校验做服务端二次兜底(`scripts/gen-lb-bounds.ts` 生成包络,server.cjs / worker.js 同构校验) |
| R10 | 旧档迁移的破坏性(v<4 重置职业/装配) | 用户在面板载入老档直接看到被改写 | 载入时 migrateSave 前后 diff 展示,改动字段清单确认后进编辑器 |
| R11 | 存档写字典遗漏 fromDict 的容错默认语义 | 面板校验规则与引擎容错口径不一致(过度严格阻断合法档 / 过松放行崩溃档) | 校验规则逐条对照 fromDict/migrateSave 消费点编写(§5.2 附代码行依据);冒烟 B11 破坏注入兜底 |

---

## 11. 使用说明(仓库主人速查)

### 日常操作

```bash
npm run dev                              # 一次起服
# 游戏本体   http://localhost:8614/
# 管理面板   http://localhost:8614/admin/
```

- **改数值**:面板「数值覆盖」tab → 分类/搜索定位 → 改值 → 「效果预览」看曲线对比 → 「保存覆盖」(同时写 localStorage[Web 用] 与仓库根 overrides.json[CLI 用])→ 游戏页(dev)storage 热通道即时生效 / 重启 CLI 生效。「一键恢复默认」随时回到原版数值。
- **改存档**:先退出 CLI、关掉游戏页 → 面板「存档管理」→ 选来源载入 → 编辑(红色 error 不清完不能写回)→ 写回(save.json 自动留备份)或下载 JSON。
- **取浏览器存档**:同源(dev)直接「读取本浏览器存档」;线上档用游戏内「导出」下载文件再导入面板;兜底 DevTools 复制 `abyss_save_v2` 值粘贴。
- **验证一切正常**:`node --experimental-strip-types scripts/admin-smoke.ts` && `npm test` && `cmd //c "npm run build"`(cmd.exe 原生 shell 用 `cmd /c npm run build`) && `bash scripts/parity.sh 180` 全绿。

### 文件位置速查

| 文件 | 作用 |
|------|------|
| `save.json`(仓库根) | CLI 存档(CLI 与面板共用的真档) |
| `save.json.bak-*` / `overrides.json.bak-*` | 面板写回前的自动备份(可手工清理) |
| `overrides.json`(仓库根) | 数值覆盖(TS CLI 读;删除或清空 values = 恢复默认) |
| `localStorage.abyss_save_v2` | Web 游戏存档 |
| `localStorage.abyss_admin_overrides_v1` | Web 游戏的数值覆盖 |

### 覆盖生效范围(再强调)

TS CLI ✅ / TS Web(dev 与构建版)✅ / Python CLI ❌ / 对拍基准 ❌(有意解耦,保证 `parity.sh` 恒绿)。
