sfx/ 音效出处与许可见下;全部可免费商用、无需署名、无侵权风险。

A. CC0 公共领域素材(前 8 个)
   来自 "The Essential Retro Video Game Sound Effects Collection [512 sounds]"
   作者: Juhani Junkala (SubspaceAudio)
   许可:  Creative Commons CC0 1.0 Universal
   来源:  https://opengameart.org/content/512-sound-effects-8-bit-style
   统一处理: 去直流、峰值归一化至 0.85、首尾静音裁剪、3ms 淡入淡出(防咔哒声);
   部分长音效降采样至 22050Hz 控制体积。

B. 程序合成(后 8 个,2026-10-04)
   由仓库内脚本 scripts/gen_sfx.py 以固定随机种子生成(方/锯/三角/正弦/噪声
   + 音高滑移 + 单极低通 + ADSR 包络),22050Hz 16bit 单声道,峰值 0.85,3ms 淡入淡出。
   自研产物,不涉及任何第三方素材,无版权问题;风格对齐 A 组 8-bit 复古音。

文件                     来源                                                用途
attack-hit.wav    A: Weapons/Melee/sfx_wpn_punch1.wav                  普攻命中
skill-heavy.wav   A: Weapons/Cannon/sfx_wpn_cannon4.wav                技能·战士伤害(重轰)
skill-magic.wav   A: Weapons/Lasers/sfx_wpn_laser3.wav                技能·法师伤害(激光)
skill-arrow.wav   A: Weapons/Melee/sfx_wpn_sword3.wav                 技能·射手伤害(嗖声)
skill-burst.wav   A: Weapons/Machinegun/sfx_wpn_machinegun_loop7.wav  技能·多段连击
skill-buff.wav    A: General Sounds/Positive Sounds/sfx_sounds_powerup18.wav  技能·增益
skill-shield.wav  A: General Sounds/Positive Sounds/sfx_sounds_powerup16.wav  技能·护盾
skill-execute.wav A: Explosions/Medium Length/sfx_exp_medium6.wav     技能·处决
skill-fire.wav    B: 合成(噪声爆裂+低频方波重击)                    技能·火系(火球术/烈焰风暴)
skill-ice.wav     B: 合成(三角波下行琶音+高频闪烁)                  技能·冰系(寒冰箭/冰霜新星)
skill-zap.wav     B: 合成(方波振铃+嘶声)                             技能·电系(闪电链)
skill-roar.wav    B: 合成(低锯齿喉音+噪声底)                        技能·怒吼(毁灭怒吼)
skill-ult.wav     B: 合成(次低音下坠+爆炸+方波打击)                 技能·大招(致命一击/陨石/灾变/穿云/猎神)
skill-drain.wav   B: 合成(正弦下滑+颤音)                             技能·吸血(嗜血打击)
skill-mark.wav    B: 合成(方波双音叮)                                技能·印记(猎杀印记)
skill-dash.wav    B: 合成(噪声上扫嗖声)                              技能·位移(疾行)
