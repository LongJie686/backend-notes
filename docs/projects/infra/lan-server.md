# 内网服务器

公司局域网里一台 i5-14400 / 32G / 无独显的台式机，2026-10-20 起改作常驻服务器，
承接从本机迁出的服务。没有公网 IP，对外全部经香港云服务器的反向隧道。
部署根目录 `D:\Aproject\`，每个服务独立子目录 + 独立 venv。（2026-11-03 现场核对）

## 服务索引

| 服务 | 端口 | 自启方式 | 对外 |
|------|------|---------|------|
| Codex 号池 | 8317 中转 / 8318 授权 / 8319 监控 | SYSTEM 任务 `CodexGatewaySupervisor` | 隧道到云 18317-18319 |
| 号池出口守卫 | — | SYSTEM 任务 `CodexGatewayEgressGuard` | — |
| 钉钉 AI 助手 · LangBot | 5300 后台 / 5400-5401 插件运行时 | `LangBot-DingTalk` | 钉钉 Stream（主动外连，无需入站） |
| 钉钉 AI 助手 · Synapse Runner | 18531 | `Synapse-DingTalk-Trial` | 仅本机 |
| 钉钉 AI 助手 · WebChat | 18540 / 局域网代理 18541 | `Synapse-WebChat` / `-LAN` | 云 `/assistant/`；局域网直连 18541 |
| 钉钉 AI 助手 · Embedding | 5310 | `Synapse-Embedding` | 仅本机 |
| 侵权资料同步 | — | `Synapse-Infringement-Sync` 定时 | — |
| [字幕高亮](/projects/desktop/subtitle-karaoke) | 7860 | `SubtitleHighlightService` | 局域网直连，门户中转页跳转 |
| 门户共享文件 | 18543 | `Portal-SharedFiles` | 隧道到云 18543 |

## Codex 号池

把多个 ChatGPT 订阅账号聚成一个 OpenAI 兼容端点，供本机 Claude Code / DSH、
云上创意对话等使用。核心是开源的 CLIProxyAPI，外面包了一层自写的 Python 服务：

- `supervisor.py`：守护 proxy / enroll / monitor / tunnel 四个子服务，挂了自动拉起。
- `enroll.py`（8318）：邀请链接 + 设备码授权页，新账号自助入池；授权并发上限 20。
- `monitor.py`（8319）：使用者、额度、用量监控页；额度按 5 小时 / 7 天窗口显示剩余与重置倒计时。
- `quota.py`：定时查各账号实时额度，并做**冷却对账**——上游提前重置额度时，
  主动清掉网关里残留的 429 冷却，避免「面板显示满额、调度却说无可用账号」。

排障要点：报 502/503 先看 `data/auth/logs/main.log` 的错误码。全账号 `server_is_overloaded`
是 OpenAI 上游过载，号池本身没问题；只有 401 / 429 / usage_limit 才是账号问题。

## 钉钉 AI 助手（Synapse）

企业内部公共助手：员工在钉钉单聊或群里 @ 机器人，基于公司持续更新的资料回答，支持图文。

- **底座用开源 LangBot**（v4.11），钉钉走 Stream 模式，服务主动连钉钉，内网机器也能收消息。
- **自研 Synapse Runner 作为 LangBot 插件**，负责多 Agent 编排、工具调用、模型调用账本与配额。
- **模型**：聊天/视觉走号池，号池异常时按「主渠道 2 次 → 备用渠道 1 次」兜底，
  首个片段输出后不再重放；嵌入用 `bge-small-zh-v1.5` 的 CPU ONNX 版，本机离线推理。
- **知识库**：只索引管理员指定的共享目录，定时增量同步；个人记忆与私人文件按用户隔离。
- **WebChat**：网页版入口，云门户 `/assistant/` 配了主备两个上游（18540 主、18544 备），
  `proxy_next_upstream` 自动切换。

## 运维约定

- **改动先双空闲**：间隔 12 秒两次确认没有进行中的请求，再重载对应子服务；只重载改动的那个，
  其他子服务 PID 不变。和云上的 [safe_restart 空闲闸门](/projects/production/)是同一原则。
- **只保存密钥路径**：SSH 私钥 owner 为 SYSTEM，仅 SYSTEM/Administrators 可读；
  `authorized_keys` 用 `permitopen` 限制隧道只能转发指定端口。
- 默认 SSH shell 是 cmd，复杂操作用 `powershell -NoProfile -Command -` 从 stdin 喂脚本
  （多行代码块后要多一个空行才会执行）。
