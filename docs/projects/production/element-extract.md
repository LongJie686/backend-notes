# 元素提取 v2 / v3

把服装商品图里的印花元素提取出来，输出干净的平面图案。整条工作流里最早上线、
使用量最大的服务，v2 与 v3 并行运行，每天各出图上百次。

- 本地：`D:\Aproject\工作流\元素提取\`（v2）、`D:\Aproject\工作流\元素提取_v3\`（v3）
- 仓库：`LongJie686/element-extract-workflow`（main 分支，私有）
- 线上：`extract.xingjilong.top/v2/`、`/v3/`，监控页 `/v2mon/`、`/v3mon/`

## 两个版本的区别

| | v2 | v3 |
|---|---|---|
| 提示词 | 固定 `FLAT_PRINT_PROMPT`（7216 字），纯代码工作流 | LLM 前置节点，gemini-3-flash 按图生成定制提示词 |
| 额外能力 | 无 | 袖长等布局规则 |
| pm2 / 端口 | `element_extract` / 7861 | `element_extract_v3` / 7862 |
| 部署目录 | `/opt/element_extract/` | `/opt/element_extract_v3/` |
| 并发 | `max_workers=20`，全局排队 100 | `max_workers=50`，全局排队 200 |
| 常驻内存 | 约 500M | 约 330M |

v3 是后续所有工作流项目的**代码母版**——`providers.py`（提交+轮询+兜底 + AIMD 上传闸门）、
`metrics.py`（active 账本）、`config.py` 被素材制作、上身图、视频生成、商品图平面化整体复制走。

## 技术栈

Python + Gradio 站点，`app.py` 是前台（仿星吉珑 UI），`element_extract.py` 是工作流核心，
`run.py` 是 CLI 单图测试入口，`webmon/` 是纯静态监控页。相关笔记：
[Python](/backend/python)、[LLM 概述](/ai-app/llm)、[图像处理](/data-analysis/image-processing)

## 链路

```
上传图 → (v3: LLM 生成定制提示词) → kie 生图提交(nsfw_checker=false)
      → 轮询(1-4 分钟) → 结果图 URL
```

主用 kie，toapis 兜底。每个 provider 失败重试 3 次，主链全败切兜底再试 3 次。
轮询时通过 `on_progress` 回调把 `in_progress 10%` 之类打到日志和界面。

## 成本基准（跨项目可复用）

单任务全链路约 **0.128 元**：

| 环节 | 成本 | 占比 |
|------|------|------|
| 品类识别 | 0.0018 元 | 1.4% |
| 提示词生成 | 0.0183 元 | 14.3% |
| 生图 | 0.108 元 | 84.3% |

LLM 换 gemini-3-pro 约 0.21 元（+63%），不划算。计费口径：LLM 按 `usage` token × toapis 单价，
生图按 kie 回传的 `creditsConsumed` × 0.036 元/credit。

**别用余额差值反推扣费**——toapis 限流按用户 ID 共享，余额会被其他调用干扰。
**费用单位是人民币元不是美元**，别见 `$` 就乘汇率（曾把 micu 成本放大 7.2 倍做错通道决策）。

## 踩过的坑

- **模型名**：toapis 端点 URL 叫 `gpt-image-2/official`（"official" 指官方渠道），
  但 body 里 `model` 必须填 `gpt-image-2`。填 `gpt-image-2-official` 会卡死 524，
  `gpt-image-1.5-official` 报 model_not_found(503)。
- **代理必须绕开**：Python requests 默认 `trust_env=True`，会自动读 Windows 注册表里的
  Clash 代理，上传大图经代理卡死。代码用 `NO_PROXY_FOR_API=true` 强制
  `proxies={'http':None,'https':None}` 直连。国内 API 客户端同理要 `trust_env=False`，
  走海外出口会被风控。
- **kie 后端偶发波动**：同一张图同一 prompt，时而 400 "content could not be processed"、
  时而 500、时而成功。是后端波动，不是 prompt 问题，靠重试 + 兜底扛。
- **kie key 只有一把**：提交和查询用同一把，不是两把。另一把 `sk-f0...` 是 toapis 的，
  在 kie 上直接 401。
- **监控页改动不用重启，后端改动要**：`webmon/index.html` 是 nginx alias 直托管的静态文件，
  改完即生效；但 `metrics.py` 加字段必须 `pm2 restart` 才产出。

## 运维

- 资源真瓶颈在上游 kie/toapis 限流，不是机器。并发调到 50 峰值内存约 1.5G，安全。
- 改 `max_workers` 必须同时改 `MAX_ACTIVE_TASKS`，否则单用户仍卡在旧值。
- 改服务器文件前先 `cp xxx xxx.bak_YYYYMMDD`。
- 数据备份：`backup_data.py` 统一备份元素提取 + 创意生图两服务，WAL 一致性快照 +
  `integrity_check` + 30 份轮转，每日 03:45 落 `/opt/element_extract_data/backups/`。

相关笔记：[监控告警](/engineering/monitoring)、[云服务器运维](/engineering/cloud-server-ops)
