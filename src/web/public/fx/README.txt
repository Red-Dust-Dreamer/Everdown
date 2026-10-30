fx/ 特效精灵素材来源与许可
========================================

whirlwind-orange.png / whirlwind.png
  来源: Pixor Library "Tornado"(https://pixor.art/library/elements/tornado)
  作者/站方: Pixor (pixor.art)
  许可: CC0 1.0 公有领域(https://creativecommons.org/publicdomain/zero/1.0/)
        —— 可商用、可修改、无需署名
  原始形态: 432×576 精灵表(72px 帧,8 视角 × 6 帧,共 48 帧)
  加工: 取正面视角第 1 行(row0)6 帧横条(432×72);
        whirlwind-orange.png 在此基础上做亮度→橙金色带映射(保留明暗结构与透明通道),
        映射锚点 (0,#000)→(70,#7A2808)→(140,#FF781E)→(200,#FFC882)→(255,#FFF0D2)
  用途: 战士技能"旋风斩"(w_whirl)引导期特效,80ms/帧,2.05s 生命周期
  原始文件下载于 2026-10-27;灰白原色版 = whirlwind.png(备用)

explode.png / lightning-magenta.png / meteor-red.png / spark.png / icicle-green.png
  来源: 同 Pixor Library(CC0 1.0 公有领域,可商用可修改无需署名)
    explosion    https://pixor.art/library/elements/explosion    (48px×8帧一击)
    lightning    https://pixor.art/library/elements/lightning    (96px×6帧一击)
    meteor       https://pixor.art/library/elements/meteor       (56px×6帧燃烧)
    spark-burst  https://pixor.art/library/elements/spark-burst  (48px×6帧一击)
    icicles      https://pixor.art/library/elements/icicles      (56px 单帧×8向)
  加工: 一律取正面视角(South,row0)横条帧带;
    lightning-magenta = 亮度→品红 LUT(深渊断罪 ult_w_judg)
    meteor-red        = 亮度→亮红 LUT(湮灭星陨 ult_m_stars)
    icicle-green      = 亮度→亮绿 LUT(万箭归宗 ult_r_rain)
    explode / spark   = 保留原生火色(处决 w_exec / 致命一击 w_fatal /
                         猎神之怒 r_god / 陨石术与星陨落地爆)
    whirlwind.png     = 灰白原色,风暴术(m_cata)旋风
  下载于 2026-10-28;映射锚点见会话内处理脚本,页内不再赘述

二期(同日,其余职业全量迁移):
  heal-aura(56px×8帧)   → aura-gold.png      金染(战吼 w_warcry)
  shield-bubble(64px×8) → shield-cyan.png    青染(护盾壁垒 w_wall)
                          shield-blue.png    蓝染(法力护盾 m_shield)
  fire-loop(48px×6)     → fire-loop.png      原生火色(火球术 m_fire/烈焰风暴 m_storm)
                          fire-loop-red.png  红染(狂暴 w_fury)
  steam-vent(48px×8)    → steam-vent.png     原生(毁灭怒吼 w_roar)
  magic-burst(48px×6)   → burst-cyan.png     青染(奥术飞弹/涌动 m_missile/m_surge)
  ice-spikes(48px 单帧) → ice-spikes.png     原生冰色(冰霜新星 m_nova/寒冰箭落点)
  icicles(56px 单帧)    → icicle.png         原生冰色(寒冰箭弹体)
  lightning(96px×6)     → lightning.png      原生黄白(闪电链 m_chain 落点)
  来源 URL 均为 https://pixor.art/library/elements/<元素名>,CC0 1.0。
  说明:魔法爆闪 magic-burst 官方表文件名不规则,有效直链为
        .../files/magic-burst/magic-burst-selout-48.png(带 pixor-library- 前缀的变体 404)。

许可总述: 本目录全部素材 CC0 1.0(https://creativecommons.org/publicdomain/zero/1.0/),
零侵权风险;Pixor 官方立场 "use them anywhere, sell your game, no credit needed",
本 README 仍留痕来源以尊重作者。
