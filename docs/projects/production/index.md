# 生产工作流

跑在腾讯云香港轻量（2 核 / 3.6G 内存 / 6Mbps，Ubuntu 22.04）上的一组线上服务，
统一走 `extract.xingjilong.top` 门户入口，pm2 托管进程，nginx 剥前缀反代。

## 服务索引

| 项目 | pm2 进程 | 端口 | 对外路径 | 形态 |
|------|---------|------|---------|------|
| [元素提取 v2/v3](/projects/production/element-extract) | `element_extract` / `element_extract_v3` | 7861 / 7862 | `/v2/` `/v3/` | Gradio |
| [创意生图](/projects/production/creative-imagegen) | `creative_imagegen` | 7863 | `/gen/` | Gradio |
| [素材制作工作流](/projects/production/material) | `material_workflow` + `material_web` | 7870 | `material.xingjilong.top` | FastAPI + 飞书 |
| [上身图工作流](/projects/production/tryon) | `tryon_workflow` + `tryon_web` | 7871 | `/tryon/` | FastAPI + 飞书 |
| [视频生成工作流](/projects/production/video) | `video_workflow` + `video_web` | 7872 | `/video/`、`video.xingjilong.top` | FastAPI + 飞书 |
| [商品图平面化](/projects/production/flatlay) | `flatlay` | 7873 | `/flatlay/` | FastAPI |
| [CrossSail 看板](/projects/production/crosssail) | `crosssail-api` | 3000 | 门户根域 | Express + SQLite |

## 共性设计

这七个服务不是各写各的，后来的项目大量复用前面的模块，形成了一套固定骨架：

- **双渠道兜底**：生图/生视频统一「kie 主用 + toapis 兜底」（视频生成工作流反过来，
  toapis 主用），每个渠道内部重试 2-3 次，全败才切另一家。
- **异步轮询**：上游全是异步任务模式，不支持流式。提交秒回 taskId，后台生成 1-4 分钟，
  客户端轮询。轮询超时必须**续查同一个 taskId**，不能重提——厂商已经扣过费了。
- **单写者状态机**：飞书多维表格的「操作列 / 状态列」分离，只有 worker 写状态列，
  避免人工改表和程序写入打架。配套孤儿恢复：worker 重启后把 `_inflight` 里的僵尸任务捞回来。
- **失败也入账**：只要上游扣了费，不管任务成没成，都要记进成本账本。
- **active 账本**：`metrics.py` 原子写 `metrics.json`（`.tmp` + `os.replace`），
  既供监控页每 5 秒拉取，也供 `safe_restart.sh` 判断服务是否空闲。

相关笔记：[AI 工作流工程化](/ai-app/ai-workflow-engineering)、
[FastAPI](/backend/fastapi)、[云服务器运维](/engineering/cloud-server-ops)、
[监控告警](/engineering/monitoring)

## 部署流程（所有项目通用）

```
本地改 → git 提交推送（LongJie686，全 PRIVATE）
       → git archive 打 tar + scp 到 /opt
       → 覆盖解包 → pm2 restart（用 ubuntu 身份，勿 sudo pm2）
```

服务器 `/opt/*` **全都不是 git 仓库**，靠 tar 覆盖更新。两个高频坑：

1. 改前端静态文件必须重新 scp，`pm2 restart` 不生效（静态文件不在进程内存里）。
2. pm2 进程名必须用下划线，横杠会 not found。

## 重启闸门（铁律）

重启前必须确认服务空闲。用服务器上的
`/opt/bin/safe_restart.sh <pm2名> <metrics.json路径> [最长等待秒数]`，
而不是裸 `pm2 restart`。

原因是 2026-08-04 踩过的坑：把「查 active」和「pm2 restart」写成两条命令，中间隔了近一分钟，
期间有用户提交新任务，重启把它打断了。**检查与动作之间留窗口等于没检查**——
闸门判断必须和重启在同一个条件里。生成类任务被打断 = 用户白等 + 费用白花。
