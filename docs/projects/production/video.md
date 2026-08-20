# 视频生成工作流

同事在前台提交任务，接 seedance 2.5 生成视频，结果与提示词按提交人收进飞书多维表格子表。
2026-08-10 立项，**当日上线并验收通过**。

- 本地：`D:\Aproject\视频生成工作流\`
- 仓库：`LongJie686/video-workflow`（master 分支，私有）
- 双入口同一后端：`extract.xingjilong.top/video/`（门户首页第六张卡片指向这个）
  和子域 `video.xingjilong.top`
- 进程：`run.py`（worker，pm2 `video_workflow`）+ `webapp.py`（FastAPI 前台，pm2 `video_web`，7872）
- 白名单 11 人

建表用 `python setup_table.py`——在**素材制作工作流的同一个 base** 下新增一张「视频任务」子表，
只新建，不碰已有表。

## 渠道：toapis 主用 + kie 兜底

同一个上游模型，但两家的请求结构完全不同，差异全部收敛在 `providers.py` 的 `_payload` 里：

| | toapis | kie |
|---|---|---|
| 图片传参 | `image_with_roles: [{url, role}]` 结构 | `first_frame_url` / `reference_image_urls` 扁平字段 |

**加参数要两边都改**，这是最容易漏的地方。

## 成本（重要）

toapis 实测单价（2026-08-10 首测校准）：480p × 4 秒扣 0.39369 USD，
即 **0.0984 USD/秒**。此前按 kie 标价估算高估了 42%，别再用 kie 的价推 toapis。

| 档位 | 5 秒 | 30 秒 |
|------|------|-------|
| 480p | 3.54 元 | 21.26 元 |
| 720p | 7.97 元 | 47.82 元 |

720p **未实测**，是按 kie 档位比例（63/28）推算的，跑通一条真 720p 后要拿实测值替换
`TOAPIS_USD_RATES`。走 kie 时对方会回传 `creditsConsumed`，按真实扣费入账。

默认 480p 是负责人定的省钱档；时长不设业务上限，只按接口能力钳到 4~30 秒。
前台实时显示预计花费。查余额 `GET /v1/user/balance`，`remain_balance` 单位是 USD。

## 任务模式约束（不拦就白花钱）

- **给了首帧图，比例必须 `adaptive`**。上游原话："For first-frame or first-last-frame
  generation, the output ratio follows the first-frame"。指定别的值直接
  HTTP 400 `InvalidParameter.TaskTypeConstraint`。只有纯参考图模式才能自选比例。
- 首尾帧模式还要求 `duration=-1`。
- 首尾帧模式与参考图模式互斥。

文档警告非法组合可能「异步接受、稍后失败」——**那种情况钱照扣**，
所以这些校验必须在提交前拦住，不能等上游报错。

## 工艺红线（提示词硬追加）

`providers.CRAFT_SUFFIX` 在 `normalized()` 里追加到用户提示词尾部，用户改不掉：
DTG / 热转印平面印花、棉质或涤棉，禁刺绣 / 提花 / 编织 / 立体贴布，且要求逐帧保持。

这份文案与[上身图工作流](/projects/production/tryon)的 `llm_nodes.TRYON_CRAFT_SUFFIX`
**是同一份**（2026-07-17 定），改动两边要同步。开关是 `.env` 的 `CRAFT_SUFFIX`，默认开。

排查生成结果时注意：飞书表「提示词」列存的是用户原文，**实际发出去的比它多这一段**，
别以为表里那句就是全部。

## 架构

可靠性机制沿用[素材制作工作流](/projects/production/material)：
单写者状态列、孤儿恢复、失败扣费入账、轮询超时续查 taskId、防双实例锁。
相关笔记：[FastAPI](/backend/fastapi)、[AI 工作流工程化](/ai-app/ai-workflow-engineering)
