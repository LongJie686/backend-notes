# Hermes 运维笔记

> 基于 WSL 生产环境实际运行经验
> 最新更新: 2026-06-08

---

## 核心结论

1. systemd 自启是稳定运行的基石，否则 WSL 重启必漏 cron
2. MCP 服务器是核心基础设施，出问题先查进程是否存活
3. cron script 只能用 .py，这是硬约束
4. 三平台中只有飞书支持群聊，QQ/微信只能私聊

---

## 一、环境速览

| 项目 | 详情 |
|------|------|
| 运行环境 | WSL Ubuntu（NAT 模式） |
| 配置路径 | `~/.hermes/config.yaml` |
| 环境变量 | `~/.hermes/.env` |
| 日志目录 | `~/.hermes/logs/` |
| 当前模型 | deepseek-v4-pro |
| 当前 Gateway PID | 158（systemd 管理） |

---

## 二、Gateway 管理

### 服务状态

```bash
systemctl status hermes.service
# Active: active (running)
# Main PID: 158
# Tasks: 108
# Memory: ~983MB
```

### 服务配置

```
/etc/systemd/system/hermes.service
  → enabled（WSL 重启自动拉起）
  → Restart=on-failure
```

### 关键日志

| 日志文件 | 内容 | 大小 |
|---------|------|------|
| `gateway.log` | 平台连接/消息路由/cron 触发 | ~150KB |
| `agent.log` | LLM 调用/工具执行/会话 | ~3.8MB |
| `errors.log` | 错误栈+429/401 等 API 错误 | ~1.9MB |
| `mcp-stderr.log` | MCP 服务器 stderr | 需定期清理 |
| `gateway-exit-diag.log` | 启动/退出诊断（JSON） | ~16KB |
| `update.log` | 版本更新日志 | - |

### 手动重启

```bash
systemctl restart hermes.service
# 或 wsl 内: hermes gateway
```

---

## 三、MCP 服务器管理

### 当前运行的 MCP（6个）

| 服务器 | 命令 | 用途 |
|--------|------|------|
| filesystem | npx @modelcontextprotocol/server-filesystem /root /tmp | 文件操作 |
| memory | npx @modelcontextprotocol/server-memory | 知识图谱记忆 |
| puppeteer | npx @modelcontextprotocol/server-puppeteer | 浏览器自动化 |
| sqlite | uvx mcp-server-sqlite | SQLite 数据操作 |
| time | uvx mcp-server-time | 时间转换/时区 |
| rss-feeds | npx rss-feeds-mcp | RSS 订阅管理 |

### 排查流程

```
MCP 工具报错
→ 查进程: ps aux | grep mcp
→ 查 stderr: tail ~/.hermes/logs/mcp-stderr.log
→ 查 config: grep -A10 'server_name' ~/.hermes/config.yaml
```

### 历史教训

- `free-web-search` MCP 一直装不上（ModuleNotFoundError），已从配置删除
- Puppeteer 偶尔连接失败，通常重试后自动恢复
- MCP stderr 日志不会自动清理，手动 `truncate --size=0`

---

## 四、平台接入状态

| 平台 | 状态 | 群聊 | 说明 |
|------|------|------|------|
| QQ Bot | ✅ | ❌ | 生成式 markdown Bot 不能进群 |
| 飞书 | ✅ | ✅ | WebSocket 长连接，bot 名"自用" |
| 微信 | ✅ | ❌ | iLink Bot 身份不能进微信群 |

### QQ Bot 配置

- App ID: 1903242713
- 用户 OpenID: 5376F30176A62CF4505BD3C099FC35B9
- dm_policy: open, group_policy: open（虽配但无效）
- markdown_support: true

### 飞书配置

- App ID: cli_a925c130d6791bc9
- 用户: 龍傑
- 模式: WebSocket 长连接

### 微信配置

- 账号: 034e336c（iLink bot）
- Home channel: o9cq800FohdS_Lq2R8qws8kxHMYg@im.wechat

---

## 五、Cron 定时任务

### 硬约束

**script 字段只能用 `.py` 文件！**

原因：Hermes 内部用 `sys.executable`（Python 解释器）执行所有 cron script，`.sh` 会被当成 Python 代码执行导致 SyntaxError。

### 当前任务

| 任务 | 脚本 | 计划 | 状态 |
|------|------|------|------|
| 📕 小红书AI日报 | random_delay_publish.py | 19:00 | ⏸️ 暂停 |
| 📰 每日时政新闻 | politics-news-search.py | 23:00 | ✅ |
| 🤖 每日AI新闻 | ai-news-search.py | 23:00 | ✅ |
| 🎉 每日趣味新闻 | fun-news-search.py | 23:00 | ✅ |

### Cron 脚本 Python 环境

由 Hermes venv 的 Python 执行：
```
/root/.hermes/hermes-agent/venv/bin/python3 (3.11.15)
```

装依赖的正确方式：
```bash
/root/.hermes/hermes-agent/venv/bin/python3 -m ensurepip --upgrade
/root/.hermes/hermes-agent/venv/bin/pip3 install <package>
```

❌ 不要用 `pip --target`，会导致 C 扩展（如 lxml）安装不完整。

### 自愈机制

每次会话开始时，检查 cron 漏跑情况并自动补跑。

---

## 六、联网与代理

### 网络拓扑

```
Windows 主机 (WLAN: 10.129.37.118)
  ├── Clash 代理: 127.0.0.1:7890
  └── WSL (NAT 模式)
        ├── 网关: 172.21.112.1（动态获取）
        └── 代理: http://172.21.112.1:7890
```

### 代理自动配置

`~/.bashrc` 末尾动态代理脚本：
```bash
HOST_IP=$(ip route show default | awk '/default/ {print $3}')
export http_proxy="http://${HOST_IP}:7890"
export https_proxy="http://${HOST_IP}:7890"
```

这样 WSL 重启后 IP 变化也无需手动干预。

---

## 七、SSH 远程服务器管理

### 工具链

使用 `sshpass` 免交互 SSH 登录：

```bash
sshpass -p 'password' ssh -o StrictHostKeyChecking=no user@host 'command'
```

### 已接入服务器

| 主机 | IP | 系统 | 用户 | 密码 |
|------|------|------|------|------|
| hadoop105 | 192.168.10.105 | CentOS 7 | long | wylj99 |

家目录: /home/long，含 .jenkins/、.sdkman/、xlab-website/

### 监控命令模板

```bash
sshpass -p 'xxx' ssh user@host '
  tail -30 /var/log/messages
  dmesg | tail -30
  tail -15 /var/log/secure
  df -h / && free -h && uptime
'
```

---

## 八、小红书自动发布流水线

### 架构

```
cron 触发 → pipeline.py --max=2
  → 新闻采集（RSS + 搜索）
  → GLM-4-Flash AI改写
  → CogView 封面生成
  → 小红书 Docker 容器发布
```

### Docker 容器

```bash
cd /root/content-matrix && docker compose up -d
```

| 项目 | 值 |
|------|------|
| 端口 | 18060 |
| 共享内存 | --shm-size=512m |
| Cookie 持久化 | 目录挂载 + entrypoint 复制 |
| 封面格式 | JPEG，文件名必须 ASCII |

---

## 九、文档/表格集成

### 腾讯文档 API

| 项目 | 值 |
|------|------|
| client_id | 4840dde30f2949a08c7761567f5a7737 |
| open_id | d97d8a7af2cf4b30a60326b6b75b17cc |
| 凭证文件 | /tmp/qqdoc_creds.json（30天过期） |
| 写入 API | POST /openapi/spreadsheet/v3/files/{id}/batchUpdate |
| 测试表格 | 300000000$BAujLqDmgqau（加班考勤测试） |

写入格式：
```json
{
  "requests": [{
    "updateRange": {
      "range": {"sheetId": "xxx"},
      "data": [{"cellValue": {"text": "内容"}, "dataType": "DATA_TYPE_UNSPECIFIED"}]
    }
  }]
}
```

Headers: Access-Token + Client-Id + Open-Id

### 飞书表格（全自动备选）

已接通，无需 OAuth 浏览器授权，适合完全自动化场景。

---

## 十、记忆系统

### 三层架构

| 层 | 存储 | 用途 |
|------|------|------|
| 短期 | 会话上下文 | 当前对话 |
| 中期 | Memory entries | 环境事实/偏好/约定 |
| 长期 | Session search (FTS5) | 跨会话历史检索 |

### 记忆写入原则

- 用户偏好与纠正 > 环境事实 > 操作流程
- 7天内会过期的信息不要写入
- 记忆上限 10,000 字符，占比 ~50%

---

## 十一、常用排查命令

```bash
# Gateway 状态
systemctl status hermes
ps aux | grep hermes | grep -v grep

# Cron 任务
hermes cron list

# MCP 进程
ps aux | grep mcp

# 日志
tail -f ~/.hermes/logs/gateway.log
tail -50 ~/.hermes/logs/errors.log

# Docker 容器
docker ps --filter name=xiaohongshu
```

---

## 十二、常见问题

| 问题 | 根因 | 解决 |
|------|------|------|
| WSL 重启后 cron 不漏 | systemd 服务未 enbale | `systemctl enable hermes` |
| Cron bash 脚本报 SyntaxError | Hermes 用 Python 执行所有脚本 | 改用 .py |
| QQ/微信不能收群消息 | 平台限制，非配置问题 | 改用飞书群 |
| pip install 后 ImportError | 用 pip --target 导致 C 扩展缺失 | 用 venv pip install |
| free-web-search 启动失败 | 依赖未装 | 已从配置删除 |
| Gateway 平台连不上 | 账户 ID 冲突（PID 占用） | 先停旧进程 |
