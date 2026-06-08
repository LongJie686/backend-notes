# Hermes：会学习的 AI Agent

> 技术分享 | 2026-06-07

---

## 一、为什么要花时间了解它

我们日常用 Claude Code、Codex 写代码，效率已经不错了。  
那 Hermes 解决什么问题？一句话：

> **Claude Code 记不住你，Hermes 会。**

---

## 二、三个工具的定位差异

| 维度 | Claude Code | Codex (OpenAI) | Hermes |
|------|------------|----------------|--------|
| 核心定位 | 编码助手 CLI | 编码助手 CLI | 通用自主 Agent |
| 记忆 | 单会话，关掉就清 | 单会话，关掉就清 | 跨会话持久记忆 + 学习闭环 |
| 执行环境 | 本地 | 本地 | 本地 / VPS / Docker / Modal / SSH |
| 不在电脑旁能用吗 | 不能 | 不能 | 能（Telegram / Slack / 微信等） |
| 定时任务 | 不支持 | 不支持 | 内置 cron 调度 |
| 技术栈 | TypeScript | TypeScript | Python |
| 面向场景 | 写/审/重构代码 | 写/审/重构代码 | 跨会话任务 + 自动化 + 研究 |

**结论：** Claude Code 是"开发期的 IDE 副驾"，Hermes 是"长期驻留的自主助手"。两者不是竞争关系，是互补的。

---

## 三、Hermes vs OpenClaw——为什么要迁移

OpenClaw 是更早出现的同类工具（个人 AI 助手 + 多平台 Gateway），Hermes 针对它的短板做了系统性升级：

### 3.1 学习闭环（核心差距）

OpenClaw 没有学习机制，每次对话结束就结束了。  
Hermes 有三层学习：

```
完成复杂任务后
  → 自动生成 Skill（技能脚本）
      → 下次执行时自动调用该 Skill
          → 执行中自动改进 Skill
              → 沉淀为可搜索的历史记忆
```

举例：你第一次让 Hermes 帮你拉取 MySQL 慢查询日志、分析并生成报告。  
它完成后会把这个"工作流"存为一个 Skill。下次你说"老样子"，它直接执行，不需要重新解释。

### 3.2 模型灵活性

OpenClaw 的主要赞助方是 OpenAI，默认走 GPT，换模型摩擦大。  
Hermes 一条命令切换模型，不改代码：

```bash
hermes model          # 交互式选择 provider / model
# 支持：Nous Portal、OpenRouter（200+ 模型）、OpenAI、Claude、Kimi、GLM、本地 Ollama 等
```

### 3.3 运行环境

OpenClaw 以 Gateway 守护进程为主，强依赖你的本地机器（或一台 always-on 服务器）。  
Hermes 支持 Serverless 后端（Modal / Daytona），**不用时自动休眠，几乎不花钱**，用时秒唤醒。

### 3.4 子 Agent 并行

Hermes 支持派生隔离子 Agent 并行处理多个任务，子任务结果汇总回主 Agent。  
OpenClaw 是单线程对话模型，没有这个能力。

### 3.5 迁移无痛

Hermes 直接提供迁移命令，OpenClaw 的配置、记忆、Skills、API Key 一键导入：

```bash
hermes claw migrate
```

---

## 四、Hermes 适合哪些场景

### 场景 A：长期项目的"记忆伙伴"

你在做一个 3 个月的微服务重构项目：

- 第 1 周：和 Hermes 讨论分层架构、定了接口规范
- 第 3 周：Hermes 还记得之前定的规范，新接口设计自动对照
- 第 8 周：回顾早期决策，Hermes 主动搜索历史对话提供上下文

Claude Code 每次都要重新粘贴背景，Hermes 是真的"知道你在做什么"。

### 场景 B：下班后的自动化值班

在 VPS 上运行 Hermes，配置 cron：

```
每天 08:00 → 拉取昨日服务告警日志 → 分析 → 发 Telegram 摘要
每周一 09:00 → 汇总上周 API 错误趋势 → 发 Slack
```

你不在电脑旁，Hermes 已经在工作了。

### 场景 C：研究与知识沉淀

读一篇新的论文/技术博客，和 Hermes 讨论要点，它把关键结论存入记忆。  
三个月后你问："我们之前讨论过 Raft 选举超时的取舍吗？"  
Hermes 会搜索历史会话告诉你。

### 场景 D：多模型对比实验

同一个 Prompt，快速切换 Claude / Kimi / GLM 对比输出质量，不换代码，不换工具。  
适合做 LLM 选型的团队。

---

## 五、案例：用 Hermes 自动化后端日常值班

### 背景

团队后端服务运行在三台服务器上，每天早上 QA 同学需要手动看前一天的错误日志，整理报告发到群里。

**现有流程：**

```
QA 登录服务器 → 翻 /var/log → 人工筛选 ERROR → 写摘要 → 发群 → 30 分钟
```

### 引入 Hermes 后

**一次性配置（约 20 分钟）：**

```bash
# 1. 安装（Windows PowerShell）
iex (irm https://hermes-agent.nousresearch.com/install.ps1)

# 2. 配置模型（选 Kimi 或 Claude，按团队情况）
hermes model

# 3. 配置 Telegram bot（发报告用）
hermes gateway setup

# 4. 设置定时任务
hermes cron add "每天早上8点" "SSH 到 app01/app02/app03，抓取昨日 ERROR 日志，
  统计各服务报错频率，找出 Top 3 异常，生成摘要，通过 Telegram 发给 #backend-ops 群"
```

**之后每天自动执行，示例输出：**

```
[2026-06-07 08:00] 昨日后端服务日志摘要

app01 (api-gateway):   ERROR x 12
  - ConnectionTimeoutException: 9 次（集中在 03:00-04:00）
  - NullPointerException: 3 次（UserService.getById）

app02 (order-service):  ERROR x 3
  - 均为 DB deadlock，已自动重试成功

app03 (notify-service): ERROR x 0（健康）

建议：app01 凌晨超时疑似下游 DB 压力，建议排查定时任务。
```

### 效果对比

| 指标 | 原来 | Hermes |
|------|------|--------|
| 耗时 | 30 分钟/天 | 0 分钟（全自动） |
| 一致性 | 依赖 QA 当天状态 | 每天格式相同 |
| 历史趋势 | 需手动翻记录 | Hermes 自动对比昨天/上周 |
| 扩展新服务 | 重新写脚本 | 更新 cron 描述即可 |

### 关键点

这个场景 **Claude Code 做不到**：
- Claude Code 是交互式工具，需要人在旁边
- 没有 cron 调度能力
- 无法跨会话记住"昨天的基线是多少"

这个场景 **OpenClaw 也很难做到**：
- 没有学习闭环，每次需要重新描述任务
- 运行在本地，电脑关机就停了

---

## 六、安装与上手

### 6.1 安装

**Linux / macOS / WSL2：**

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc
```

**Windows（原生 PowerShell，无需 WSL）：**

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

安装脚本会自动处理：Python 3.11、Node.js、ripgrep、ffmpeg，以及一个独立的 MinGit（不影响系统 Git）。

### 6.2 首次配置

```bash
hermes setup          # 全向导：模型、平台、技能一起配
# 或分步来：
hermes model          # 选模型（DeepSeek / Kimi / Claude / GLM 等）
hermes gateway setup  # 配消息平台（微信 / QQ / Telegram / 飞书）
```

**推荐：用 Nous Portal 一个账号覆盖所有 API**

```bash
hermes setup --portal   # OAuth 登录，自动配模型 + 工具 Gateway
```

### 6.3 后台常驻（systemd，Linux/WSL）

```bash
# 安装为系统服务，开机自动启动
sudo systemctl enable hermes
sudo systemctl start hermes

# 查看状态
systemctl status hermes
```

### 6.4 从 OpenClaw 迁移

```bash
hermes claw migrate   # 自动导入配置、记忆、Skills、API Key
```

### 6.5 常用命令速查

```bash
hermes                # 打开交互式 CLI
hermes model          # 切换模型
hermes gateway        # 启动消息 Gateway（微信/QQ/Telegram）
hermes cron add "..."  # 添加定时任务（自然语言描述）
hermes skills         # 查看/管理技能库
hermes update         # 更新到最新版
hermes doctor         # 诊断配置问题
```

### 6.6 要不要现在就用？

**继续用 Claude Code** 如果：主要工作是写代码、审 PR、调试，在 IDE 里完成闭环。

**考虑引入 Hermes** 如果：
- 有重复性的日常信息收集/整理任务
- 需要 AI 助手跨时间记住项目决策
- 想在手机/Telegram 上也能和助手交互
- 团队做多模型选型对比
- 想把某个 AI 工作流"固化"成技能，让它自动执行

上手成本：安装 + 基础配置约 30 分钟，配第一个 cron 任务约 10 分钟。

### 参考链接

- 文档：https://hermes-agent.nousresearch.com/docs/
- GitHub：https://github.com/NousResearch/hermes-agent
- Skills Hub（社区技能库）：https://agentskills.io

---

## 七、总结

| 我想要... | 用哪个 |
|-----------|--------|
| 帮我写/审代码 | Claude Code / Codex |
| 记住我，跨会话学习 | Hermes |
| 不在电脑旁也能自动执行任务 | Hermes |
| 自由切换 AI 模型 | Hermes |
| 定时自动化 + 消息推送 | Hermes |
| 用了 OpenClaw 想升级 | `hermes claw migrate` |

> Hermes 不是要替代你的编码工具，而是在编码工具之外，给你一个**长期记得你、能独立工作的助手**。
