# 本机服务

日常开发用的 Windows 11 台式机。这里只列常驻的后台服务和定时任务，不含普通桌面软件。
（2026-11-03 现场核对）

## 常驻服务

| 服务 | 端口 | 运行方式 | 作用 |
|------|------|---------|------|
| Hermes 网关 | 8642（WSL 内） | WSL Ubuntu-24.04 systemd `hermes-gateway.service` | 个人 AI 助手，接 QQ，对外提供 OpenAI 兼容接口 |
| 号池客户端隧道 | 8317 / 8318 / 8319 | `client_tunnel.py` 守护一条 `ssh -L` | 把本机端口映射到[内网服务器](/projects/infra/lan-server)的 Codex 号池 |
| Clash Verge | 7890 | 托盘程序（mihomo 内核） | 代理，规则分流；国内 AI / 钉钉 / 腾讯系直连 |
| ccs 代理守护 | 随机端口 | ccs 自带 proxy daemon | Claude Code 切换第三方模型档位 |
| opencli 守护 | 19825 | node daemon | 通过 Chrome 扩展带登录态操作网页 |
| browser-harness | — | Python daemon | CDP 9222 驱动浏览器做自动化 |
| Claude HUD | 17890 | pythonw | 自写悬浮球：会话状态监控 + 权限弹窗 |

### Hermes 为什么跑在 WSL

- 原先在另一台电脑上，2026-10 迁到本机 WSL。systemd 负责崩溃重启，Windows 侧只需让 WSL 别休眠。
- **WSL 保活**：计划任务 `hermes-wsl-autostart` 用 `conhost --headless` 起一个
  `wsl ... sleep infinity` 常驻进程。只要有它，WSL 就不会因为空闲被回收。
- 坑：反复手动调 `wsl` 做检查也会把 WSL 拉起来，造成「看起来一直活着」的假象，验证保活要看保活进程本身。
- 重启走空闲检查脚本，不直接 `systemctl restart`；运维细节见 [Hermes 运维](/ai-app/hermes-ops)。

## 定时任务（Windows 计划任务）

| 任务 | 作用 |
|------|------|
| `ClaudeMemoryReview` | 每天从近期 Claude Code 会话提取候选记忆，人工审核后入库 |
| `CreativeImagegenTrends`（+ Precheck / KeepAlive） | 创意生图的趋势采集：本机用带登录态的浏览器抓取，结果供线上使用 |
| `CrossSail-ClaudeUsage` | 采集本机 Claude 用量上报到 CrossSail 看板 |
| `LangBot-PanelTunnel` | 开机建立到内网服务器 LangBot 管理后台的隧道 |

这些任务都用 `wscript //B` 调 `.vbs` 启动，不弹黑窗口。

## 为什么这些留在本机不迁

迁内网服务器时明确保留在本机的：Hermes、记忆复盘、趋势采集、CrossSail 用量采集。
共同原因是**依赖本机独有的东西**——浏览器登录态、本机 Claude 会话数据、个人账号——
迁过去要么拿不到数据，要么得把个人凭据复制到公共机器上，得不偿失。
