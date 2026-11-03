# 辅助电脑

局域网里一台闲置台式机改的常驻服务器，承接从办公电脑迁出的内部服务。
没有公网 IP，需要对外的经线上服务器的反向隧道（见[总览](/projects/infra/)）。
每个服务一个子目录 + 独立 venv，开机由计划任务拉起。

## 服务一览

| 服务 | 形态 | 对外方式 |
|------|------|---------|
| [自建模型网关](/projects/infra/model-gateway) | 开源 CLIProxyAPI + 自写守护/监控 | 办公电脑走正向隧道；线上服务走反向隧道 |
| [钉钉 AI 助手](/projects/infra/dingtalk-assistant) | LangBot + 自研 Runner 插件 + 本地 Embedding | 钉钉 Stream（主动外连）；网页版经门户 |
| [字幕高亮](/projects/desktop/subtitle-karaoke) | Python Web 服务 | 局域网直连，门户中转页跳转 |
| 门户共享文件 | Python Web 服务 | 经门户 |

模型网关和钉钉 AI 助手各有独立笔记，见上表链接。网页版助手在门户配了主备两个上游，
nginx `proxy_next_upstream` 自动切换。

## 运维约定

- **改动前双空闲确认**，和线上的 [safe_restart 空闲闸门](/projects/production/)同一原则。
- **只保存密钥路径**：隧道私钥只给系统账户可读；`authorized_keys` 用 `permitopen`
  限定隧道只能转发指定端口。
- 远程默认 shell 是 cmd，复杂操作用 `powershell -NoProfile -Command -` 从 stdin 喂脚本
  （多行代码块后要多一个空行才会执行）。
