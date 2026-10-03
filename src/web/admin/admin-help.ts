/// <reference lib="dom" />
/** 管理面板 · Tab4 说明(帮助):面板使用说明本体。
 *  内容依据 docs/admin-panel.md §3 Tab4 / §4.5 / §5.2-§5.4 / §11 摘编。 */
import { esc } from "./admin-dom.ts";
import { OVR_KEY, SAVE_KEY } from "./admin-dom.ts";

export function initHelp(rootEl: HTMLElement): void {
  rootEl.innerHTML = `
  <div class="card">
    <h3><span class="dot"></span>这个面板是什么 / 怎么打开</h3>
    <p class="small">本地管理工具:<b>存档管理</b>(改金币/等级/装备/任务…)+ <b>策划数值配置</b>(改平衡表任意叶子)+ <b>效果预览</b>(曲线对比)。
    与游戏同源、两个独立页面 —— 面板改表不会影响正在运行的游戏页,反之亦然。</p>
    <pre class="code">npm run dev
# 游戏本体   http://localhost:8614/
# 管理面板   http://localhost:8614/admin/</pre>
    <p class="small">面板仅本地使用:gh-pages 与 TapTap 包都不含此页;dev 桥(vite 插件)只在 dev server 存在,
    探测不到时「服务器文件」相关按钮自动禁用,只剩 localStorage / 文件导入导出路径。</p>
  </div>

  <div class="card">
    <h3><span class="dot"></span>日常操作</h3>
    <p class="small">· <b>改数值</b>:「数值覆盖」tab → 分类/搜索定位 → 改值 → 「效果预览」看曲线对比 → 「保存覆盖」
      (同时写 localStorage[Web 用] 与仓库根 overrides.json[CLI 用])→ <b>游戏页(dev)storage 事件即时热生效 / 重启 CLI 生效</b>。「一键恢复默认」随时回原版。</p>
    <p class="small">· <b>改存档</b>:先退出 CLI、关掉游戏页 → 「存档管理」选来源载入 → 编辑(红色 error 不清完不能写回)→
      写回(save.json 自动留 .bak 备份)或下载 JSON。</p>
    <p class="small">· <b>验证一切正常</b>:node --experimental-strip-types scripts/admin-smoke.ts &amp;&amp; npm test &amp;&amp;
      cmd //c "npm run build"(cmd.exe 原生 shell 用 cmd /c npm run build)&amp;&amp; bash scripts/parity.sh 180 全绿。</p>
  </div>

  <div class="card">
    <h3><span class="dot"></span>浏览器存档怎么取出来(localStorage 三条路径)</h3>
    <p class="small">游戏 Web 版存档在 localStorage["${esc(SAVE_KEY)}"]:</p>
    <p class="small">1. <b>同源直读(推荐,dev 场景)</b>:npm run dev 下游戏与面板同源 → 面板「读取本浏览器存档」一键取出,零手工。</p>
    <p class="small">2. <b>游戏内导出文件(任意场景)</b>:游戏「设置 → 存档 → 导出」下载 abyss-idle-save.json → 面板「导入文件」。
      编辑后「下载存档 JSON」→ 游戏设置页「导入」回灌(同一 migrateSave 迁移链)。<b>线上(gh-pages)存档只能走这条路</b>(跨源读不到 localStorage)。</p>
    <p class="small">3. <b>DevTools 手工复制(兜底)</b>:F12 → Application → Local Storage → 选中游戏源 → 键 ${esc(SAVE_KEY)} →
      复制整份 Value → 面板「粘贴 JSON」。适合游戏页打不开/云同步冲突排查。</p>
    <p class="small">云存档(Supabase)不在面板管辖:要编辑云端档,先在游戏内登录按同步提示用云端覆盖本地(新者胜),再走路径 1/2 取出。</p>
  </div>

  <div class="card">
    <h3><span class="dot"></span>覆盖生效范围(Python 端不生效,必须知情)</h3>
    <table class="cmp" style="text-align:left">
      <tr><th>宿主</th><th>是否加载覆盖</th><th>说明</th></tr>
      <tr><td>TS CLI(npm run cli)</td><td>✅ 仓库根 overrides.json</td><td>启动时读,下次启动生效</td></tr>
      <tr><td>TS Web(仅 dev 构建)</td><td>✅ localStorage["${esc(OVR_KEY)}"]</td><td>storage 事件热生效(无需刷新)</td></tr>
      <tr><td>Python CLI(py run.py)</td><td>❌ 不加载</td><td>abyss/ 是冻结的对拍基准,有意不动</td></tr>
      <tr><td>对拍(sim.ts / parity.sh)</td><td>❌ 不加载</td><td>覆盖与对拍彻底解耦,parity 恒绿</td></tr>
    </table>
    <p class="small">影响:TS 端调强 → 回 Python 端会突然变难 / 调弱 → Python 端打不动,是预期行为。存档本身兼容(存的是结果值,不存表引用)。</p>
    <p class="small">覆盖键的值 = serializeOverrideFile 输出原文(完整 {"version":1,"values":{…}});面板保存时自动按此格式写,手写裸 values 对象会导致
      Web 端覆盖静默不生效(parse 抛 OverrideFormatError 后按默认值运行,无报错)。</p>
  </div>

  <div class="card">
    <h3><span class="dot"></span>备份策略与文件清单</h3>
    <table class="cmp" style="text-align:left">
      <tr><th>文件</th><th>作用</th></tr>
      <tr><td>save.json(仓库根)</td><td>CLI 存档(CLI 与面板共用的真档)</td></tr>
      <tr><td>save.json.bak-* / overrides.json.bak-*</td><td>dev 桥写回前的自动备份(时间戳,可手工清理;面板「服务器备份」可一键载入)</td></tr>
      <tr><td>overrides.json(仓库根)</td><td>数值覆盖(TS CLI 读;删除或清空 values = 恢复默认)</td></tr>
      <tr><td>localStorage["${esc(SAVE_KEY)}"]</td><td>Web 游戏存档(面板写入前旧值备份到 ${esc(SAVE_KEY)}.bak-时间戳)</td></tr>
      <tr><td>localStorage["${esc(OVR_KEY)}"]</td><td>Web 游戏的数值覆盖(面板写;游戏**仅 dev 构建**读取,线上/TapTap 构建不认此键)</td></tr>
    </table>
    <p class="small">第三层:面板内存原件 —— 载入即保留原始 JSON,「放弃修改」随时整体回滚;每次写回前列出改动字段清单确认。</p>
  </div>

  <div class="card">
    <h3><span class="dot"></span>字段安全等级速查(校验表摘录)</h3>
    <p class="danger-note">⛔ error 级(阻断写回;不改掉写出去就是崩溃/丢数据档):version 缺失/非整数/&gt;7;gear_rules_21 ≠ true(载入即清空装备+背包);
      class_id 非 CLASSES 键;mode ∉ {push,farm};equip/bag/装备条目(slot/rarity 6 档/tier/plus/main_val/affixes)结构坏;
      quests[].type ∉ 悬赏 4 类或数值字段坏;relics 非数组、遗物条目 rarity/tier/effects 坏;level 非正整数;tower 形状坏。</p>
    <p class="small">⚠ warn 级(提示不阻断):loadout 含未知/他职业技能;skill_lv 键值越界;stats/settings 形状怪;
      zone/stage 越界;金币经验为负;seed 非整数;last_saved 非数字;bag/relic_bag 超容量;relics≠4 槽 / quests≠3 条;遗物 skill_id 不在池;name 非字符串。</p>
    <p class="small">🔒 危险字段(编辑器内默认锁定):version、gear_rules_21、seed —— 误改后果见编辑器红字说明。</p>
    <p class="small">ℹ 已知怪癖(不修复只标注):Python CLI 写过的档缺 relic_bag/relic_bag_lv(TS 宿主专属,载入时面板会提示);
      seed 只改未来随机流不坏档;last_saved 决定离线收益(封顶12h),面板不自动改写。</p>
  </div>

  <div class="card">
    <h3><span class="dot"></span>🔒 锁定行与 ⚠ 警示行(数值覆盖 tab)</h3>
    <p class="small">🔒 行(不提供输入框,与核心拒绝规则 R6 同一清单双保险):末段为 id/key/cls/stat/hook/op/type/metric/buff/kind/pct 的行、
      THEMES.*.mobs.* 行、SLOT_INNATE.*.0 行 —— 它们是被别处按键引用的标识或行为选择器,改了会崩溃或静默改变战斗行为。</p>
    <p class="small">⚠ 行(核心接受但后果需知,悬停看说明):RARITIES.*.affixes 与 RELIC_EFF_COUNT.*(改变 rng 调用序列,TS 与 Python 行为分歧);
      TOWER.relic_slots(运行时槽数硬编码 4,改表无效)。</p>
    <p class="small">不可覆盖的深耦合数值(协议级,须双端同改并过对拍):伤害公式与硬编码钳制、boss「灭世之击」、塔 boss 倍率、
      击杀回血 8%、升级回血 30%、离线 0.7 折算、自动换装 1.05 阈值、遗物槽位数 4。</p>
  </div>`;
}
