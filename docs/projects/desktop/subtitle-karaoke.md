# 字幕高亮

给短视频加卡拉OK式逐词高亮字幕——说到哪个词哪个词亮。

- 本地：`D:\Aproject\字幕高亮\`（未入 git）
- 需求台账：`需求清单.md`
- Web 服务：`http://<内网 IP>:7860/`（局域网直连，门户中转页跳的就是这个），
  监控页 `/mon`

## 目录与链路

```
字幕高亮/
├── input/          输入素材（原片、参考片）
├── output/         成片
├── build/<片名>/   中间产物：audio.wav / words.json / groups.json / karaoke.ass / frames/
├── scripts/        工作流脚本（命令行与服务共用同一份）
└── server/         Web 服务：app.py / pipeline.py / store.py / static/
```

| 脚本 | 职责 |
|------|------|
| `run.ps1` | 主入口，串起全流程 |
| `asr.py` | faster-whisper 出**词级**时间戳 → `words.json` |
| `verify.py` | 换版核对：音频 md5/时长 + 逐词时间轴 diff |
| `smart_split.py` | 让 AI 按语义断句 → `groups.json`（带校验回退） |
| `make_ass.py` | `words.json` (+`groups.json`) → 卡拉OK `.ass` |
| `styles.py` | 六种风格预设，每个带大白话说明 |
| `style_match.py` | 大白话 → AI 判断风格（预设或自定义配色） |
| `gen_previews.py` | 用真实视频帧渲染各风格预览图 |
| `llm_client.py` | LLM 直连封装，端点/模型/单价/思考开关全从 `.env` 读 |

## 换版必须重新核对（踩过的坑）

别信「只改了画面/只改了字幕，时间轴不用换」。`verify.py` 逐词比对 `start`，
超过容差（默认 80ms）就强制重新生成。

实测案例：新版和旧版**总时长只差 46ms**，看起来完全可以复用，
但从第 55 个词开始整体偏移了 760ms——中间某处的停顿被剪掉了，后面全跟着漂。
只看总时长根本发现不了。

## 职责划分：确定性归代码，模糊判断归 LLM

- 断句、配色 → LLM
- 时间戳比对、容差判定 → 代码
- LLM 挂了或 key 缺失时**降级而不是报错**：断句回退机械均分，配色报错提示。

LLM 只直连项目专用 key（放项目根 `.env`），不转委派。
相关笔记：[LLM 概述](/ai-app/llm)、[Prompt 工程](/ai-app/llm-dev/lecture-2)

## 样式语义

配色方案必须带大白话说明，否则用户和程序对不上词。
典型歧义：用户说「红底」指的是**整行背景条**（`line_bg_hex`），
不是当前高亮词那一块的底色。

## 部署与鉴权

- 开机自启：计划任务「字幕高亮服务」（登录时触发 → `server/start.ps1`）
- 手动控制：`.\server\start.ps1 [-Status|-Restart]`。
  `-Restart` 会先查 `/api/metrics`，**有任务在跑会拒绝重启**。
- **服务无鉴权监听 0.0.0.0 是负责人 2026-07-29 拍板的**（图手机同 WiFi 直接传片），
  不要自作主张加鉴权。门户钉钉鉴权接不上的原因是 `cstoken` 按 origin 隔离。

ffmpeg 不用装系统级：`pip install imageio-ffmpeg`，
路径用 `imageio_ffmpeg.get_ffmpeg_exe()` 取。
