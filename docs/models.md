# 模型内容存档(英雄立绘 / 怪物立绘)

> 2026-10-05 决定:**英雄立绘暂下**(舞台留白,攻击投射物从舞台内英雄侧锚点发出),
> 全部模型内容保留在仓库,一个开关即可恢复或继续开发。怪物立绘正常使用,未受影响。

## 一、英雄模型(当前:关闭,`HERO_MODEL = false`)

### 内容清单(全部在位)

| 内容 | 位置 |
|---|---|
| 开关 | `src/web/main.ts` 搜索 `HERO_MODEL`(常量,默认 `false`) |
| DOM 挂点 | `src/web/index.html` `<div id="hero-art">`(舞台内 `#stage` 下) |
| 立绘资产 | `src/web/public/hero/{warrior,mage,ranger}.png` + `README.txt`(出处/许可) |
| 样式与动画 | `src/web/style.css` `#hero-art` 块:待机呼吸 `hero-idle`、前冲 `hero-lunge`(lunge/crit/skill 三档)、受击 `hurt`、阵亡灰化 `dead` |
| 渲染/动画代码 | `src/web/main.ts`:`heroModelSync()`(按职业换立绘)、`heroLunge()`(前冲打击 + 怪物顶退 bump-mon)、`heroHurt()` |
| SW 预缓存 | `src/web/public/sw.js` SHELL 含 `./hero/*.png` |

### 恢复步骤(1 分钟)

`src/web/main.ts` 把 `const HERO_MODEL = false` 改为 `true` 即可:
- 元素重新显示,职业立绘/待机/前冲/受击全部自动恢复;
- 攻击投射物(法师飞弹/射手箭矢)与技能 side/zip 粒子自动改为从**立绘前沿**发出
  (`heroMuzzleX()` 已按开关分流),无需其它改动。

### 关闭时的替代行为

- `#hero-art` `display:none`;`heroModelSync/heroHurt` 直接返回;
- `heroLunge` 跳过立绘动画,但保留命中一拍(怪物顶退 `bump-mon`);
- 投射物从舞台内 13%(立绘原位)锚点发出,不再从屏幕外飞入。

## 二、怪物模型(当前:正常使用)

| 内容 | 位置 |
|---|---|
| 立绘资产 | `src/web/public/mon/*.png`(含 -boss 变体)+ `README.txt`(DCSS CC0 出处) |
| 渲染分支 | `src/web/main.ts` `renderBattle()`:`mon.id` 存在走立绘 `.mon-art.spr`,加载失败回退 ASCII(`.imgfail`) |
| 样式 | `src/web/style.css` `.mon-art` 块(普通/精英/头目三档尺寸) |
| 特效锚点 | `monCenterPx()` / `stageOrigin()`:技能、掉落光柱、装备粒都以怪物中心为锚 |

## 三、以后要加新模型的快速路径

1. 资产放 `src/web/public/<目录>/<id>.png`(CC0/自绘,README.txt 记出处);
2. sw.js SHELL 加预缓存行;
3. 渲染:仿 `heroModelSync`(仅变化时动 DOM)+ CSS 一块定位/动画;
4. 交互锚点统一走 `heroMuzzleX()` / `monCenterPx()`,特效自动对齐。
