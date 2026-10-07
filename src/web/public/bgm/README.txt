深渊氛围 BGM(24s 无缝循环,11025Hz 单声道)

来源:scripts/gen_bgm.py 程序合成(正弦叠加+慢包络+噪声洗),固定种子可复现;
无第三方素材,不存在版权问题。重新生成:py -X utf8 scripts/gen_bgm.py
游戏侧:src/web/main.ts 经 WebAudio loop=true 循环播放,音量走总音量母线。
