# 上身图工作流

上身图 → 分镜列表图 → 视频的三段式生成流程，飞书多维表格状态机 + Anycross 驱动，
中间有两处人工确认闸口。这个项目定型了后续素材制作、视频生成两个工作流的整套可靠性机制。

- 本地：`D:\Aproject\上身图工作流\`
- 仓库：`LongJie686/tryon-workflow`（master 分支，私有）
- 线上：`extract.xingjilong.top/tryon/`，pm2 `tryon_workflow`（worker）+ `tryon_web`（FastAPI 前台 7871）
- 需求台账：`.claude\需求清单.md`（本项目需求唯一来源）

## 任务输入与状态机

**唯一硬性必填是产品图**，其余全部由 LLM 自动兜底（识别品类、风格、人群，选模特场景）。
严禁泛泛输出或反过来要求用户补充信息。

附件第一张必须是产品图，这是硬约束。图库功能因此被砍掉——
混入参考图会顶掉第一张产品图的位置，与硬约束直接冲突。

任务标题为空时自动生成「上身图任务 月日-时分」。

**已知误判**：worker 按 `_inflight` 集合判断僵尸任务，人工手改状态列会触发「服务重启」误报。

## 提示词与工艺硬规则

- 禁脑补：禁营销话术（配送时效、折扣）、禁品牌与官方字样、禁捐款、禁中文字幕和对话。
- `CRAFT_SUFFIX` 硬追加在提示词尾部且用户改不掉，内容与
  [视频生成工作流](/projects/production/video)是同一份，改动要同步。
- 视觉上可以适度美化，但不得超出实际工艺能做到的范围。
- **LLM 输出一律当不可信输入校验**：key 必须存在、颜色必须是合法 `#RRGGBB`。
  语义归模型，硬约束归程序。相关笔记：[LLM 概述](/ai-app/llm)

## 视频生成（seedance2 定版）

用火山方舟 Seedance 2.0 图生视频，模型 `doubao-seedance-2-0-260128`。

- **必须在控制台单独开通**，否则报 `ModelNotOpen` 404。fast 版是 `-fast-260128`，无 `generate_audio`。
- 异步任务流：`POST /contents/generations/tasks` 创建 → `GET .../tasks/{id}` 轮询 status
  → 取 `content.video_url`（**24 小时过期，须及时下载**）。
- 首帧图本地 png 转 base64 data uri；duration 4-15 秒，小于 4 报 `InvalidParameter`。
- `ratio` / `duration` / `resolution` / `watermark` / `task_type` 放 body 顶层。
  `camera_fixed`（固定机位）与运镜指令冲突。
- 多图参考：content 传多图，`role: "reference_image"`，顺序是场景 → 角色 → 道具，
  用 `@图片N` 引用，`task_type: "i2v"`。

价格：720p 竖屏 9:16 约 2.64 元/4 秒镜（24 镜约 60 元，每镜约 4 分钟），
1080p 约 5.2 元/4 秒镜，运动幅度大约 6 倍成本。

运动提示词 = 分镜 camera + env_motion + 「单镜头连续画面，禁止分屏/宫格/拼图」。
1080p 固定机位也要写「极缓慢推近」，否则出片有 PPT 感。

## 视频播放（通用方案，值得复用）

页内播放必须自建端点，走 `/api/tasks/{id}/play` 代理飞书附件流并**透传 Range**。
三个必踩的点：

1. `src` 要带 `#t=0.1` 才会渲染首帧，否则是黑的。
2. 源没变**绝不重建 video 元素**，否则每次渲染都重新加载。
3. 飞书直链带 `Content-Disposition: attachment`，浏览器拒播，
   要先 fetch 成 blob 再喂给 video。

相关笔记：[WebSocket](/backend/websocket)、[FastAPI](/backend/fastapi)

## 前台与鉴权

- 登录只走门户钉X互认。`/tryon/admin` 与 `/tryon/api/metrics` 套网关级
  `_cs_auth_admin` + 应用内 `is_admin` 双层隔离。
- 本地联调用 `WEB_ALLOW_GUEST=true`；接门户时硬校验禁止开启。
- 列表只显示有交付附件的任务（上身图/分镜表/视频三者之一）；
  运行中、待确认、失败态例外；脚本方案不算产物。
- 管理员视角按提交人分组折叠，折叠状态存 localStorage。
- 通知默认只弹自己提交的，管理员额外收全员「失败」。

## 已知漂移

本机 `.env` 用的是飞书应用 A + 旧 base，服务器上的 `tryon_workflow` 已经切到应用 B + 现役 base。
**本地跑会写进废弃表格**。

## 部署注意

- 入库前排除 `示例/`（61MB），漏排会让 `.git` 涨到 55MB。
- 前端一律用相对路径，nginx 是剥前缀反代。
- 服务器 2 核无 GPU、3.6G 内存，还同时跑着 element_extract_v3、crosssail-api 等，
  新服务上线前要评估资源。**成片下载是真瓶颈**（19MB 成片下载 50 秒并占满全站带宽）。

相关笔记：[云服务器运维](/engineering/cloud-server-ops)、[高可用架构](/architecture/lecture-4)
