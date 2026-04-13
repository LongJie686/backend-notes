# Hermes Agent -- 自我改进 AI Agent 框架分析

> Nous Research 开源的自主进化 Agent，融合多平台消息、技能自学习、工具调用与调度自动化
> 项目地址: https://github.com/NousResearch/hermes-agent
> 本地路径: E:\Project\Astudy\hermes-agent

---

## 核心结论

1. **自我改进闭环** -- Agent 从复杂任务中自动创建技能、使用中改进技能、跨会话搜索历史、逐步建立用户模型
2. **多平台网关** -- 单进程 Gateway 同时接入 Telegram/Discord/Slack/WhatsApp/Signal/Email/钉钉/飞书/企微等 15+ 平台
3. **Agent = 模型 + Harness** -- 与 learn-claude-code-analysis 的核心理念一致，复杂度在工具层而非框架层
4. **多通道消息架构** -- 与 nanoclaw-analysis 的架构高度相似，插件式通道注册 + 消息路由 + 容器/终端隔离
5. **技能生态** -- 内置 25+ 技能目录（软件开发/数据科学/DevOps/研究等），支持 agentskills.io 开放标准
6. **多终端后端** -- local/Docker/SSH/Daytona/Singularity/Modal 六种执行后端，Serverless 模式空闲时近乎零成本

---

## 一、项目结构

```
hermes-agent/
  cli.py                    -- CLI 主入口 (prompt_toolkit TUI)
  run_agent.py              -- Agent 运行入口
  agent/
    anthropic_adapter.py    -- Anthropic API 适配器
    context_compressor.py   -- 上下文压缩
    context_engine.py       -- 上下文引擎
    memory_manager.py       -- 记忆管理
    memory_provider.py      -- 记忆提供者 (SQLite/ChromaDB/MongoDB)
    prompt_builder.py       -- 提示词构建
    skill_utils.py          -- 技能元数据工具
    smart_model_routing.py  -- 智能模型路由
    trajectory.py           -- 轨迹记录
  tools/
    registry.py             -- 工具注册中心
    delegate_tool.py        -- 子 Agent 委派
    file_tools.py           -- 文件操作
    terminal_tool.py        -- 终端执行
    browser_tool.py         -- 浏览器工具
    mcp_tool.py             -- MCP 协议工具
    skills_tool.py          -- 技能管理
    cronjob_tools.py        -- 定时任务
    memory_tool.py          -- 记忆工具
    todo_tool.py            -- 待办管理
    send_message_tool.py    -- 跨平台消息发送
  gateway/
    run.py                  -- Gateway 启动
    platforms/              -- 消息平台实现
      telegram.py
      discord.py
      slack.py
      whatsapp.py
      signal.py
      email.py
      dingtalk.py           -- 钉钉
      feishu.py             -- 飞书
      wecom.py              -- 企业微信
      weixin.py             -- 微信
      ...
  skills/                   -- 技能目录 (25+ 类别)
    software-development/
    data-science/
    devops/
    research/
    productivity/
    ...
  cron/                     -- 定时调度
  acp_adapter/              -- Agent Client Protocol 适配
  plugins/                  -- 插件系统
  tests/                    -- 测试套件
```

---

## 二、架构设计

### 2.1 整体架构

```
用户 (CLI / Telegram / Discord / Slack / ...)
    |
    v
Gateway (单进程, 消息路由)
    |
    v
Agent Core (LLM 调用循环)
    |--> Tools (工具注册中心)
    |--> Skills (技能加载/创建/改进)
    |--> Memory (记忆持久化)
    |--> Sub-Agent (委派隔离)
    |
    v
Terminal Backend (local / Docker / SSH / Daytona / Modal / Singularity)
```

### 2.2 Agent 核心循环

与 learn-claude-code-analysis 教学的 "One loop is all you need" 理念一致：

```
while True:
    1. 构建 prompt (系统提示 + 技能注入 + 记忆上下文)
    2. 调用 LLM (OpenAI / Anthropic / OpenRouter 等多模型)
    3. 判断 stop_reason:
       - tool_use --> 执行工具 --> 追加结果 --> 继续循环
       - end_turn --> 返回文本 --> 结束
    4. 上下文超限时触发压缩 (context_compressor)
```

### 2.3 技能自学习闭环

```
复杂任务完成
    |
    v
技能自动创建 (从经验中提取可复用流程)
    |
    v
技能存储 (YAML + Markdown 格式)
    |
    v
技能使用 (按需加载，匹配当前上下文)
    |
    v
技能改进 (使用中发现问题，自动优化指令)
    |
    v
技能共享 (agentskills.io 开放标准)
```

---

## 三、与本地项目的关联分析

### 3.1 与 nanoclaw-analysis 的对比

| 维度 | hermes-agent | nanoclaw-analysis | 关联程度 |
|------|-------------|-------------------|---------|
| 多平台消息 | 15+ 平台 (含钉钉/飞书/企微) | 5 平台 (TG/Slack/Discord/WA/Email) | 高度相似 |
| 通道注册 | 插件式自动注册 | 插件式自动注册 | 完全一致 |
| 消息路由 | Gateway + 触发词 | Orchestrator + @触发词 | 高度相似 |
| 执行隔离 | 6种终端后端 | Docker 容器 | 均为隔离执行 |
| 定时任务 | cronjob_tools + croniter | task_scheduler + croniter | 高度相似 |
| IPC/通信 | send_message_tool + stream | 文件系统 IPC (.tmp + rename) | 模式类似 |
| 消息游标 | session + cursor 管理 | cursor 模式 (类 Kafka offset) | 概念一致 |
| 配置管理 | .env + YAML + CLI config | .env + YAML | 模式一致 |

**结论**: hermes-agent 的消息通道架构与 nanoclaw-analysis 高度一致，可以看作是 nanoclaw 的"扩展增强版" -- 平台覆盖更广、执行后端更多样、增加了技能系统和自我改进能力。

### 3.2 与 learn-claude-code-analysis 的对比

| 维度 | hermes-agent | learn-claude-code-analysis | 关联程度 |
|------|-------------|---------------------------|---------|
| Agent 循环 | while loop + stop_reason | while loop + stop_reason | 完全一致 |
| 工具调度 | registry.py + handler 映射 | registry.py + handler 映射 | 完全一致 |
| 技能系统 | 自动创建 + 使用中改进 + 持久化 | s05 技能加载器 (按需注入) | 增强延续 |
| 子 Agent | delegate_tool (上下文隔离) | subagent.py (上下文隔离) | 概念一致 |
| 上下文压缩 | context_compressor (三层) | compact.py (三层压缩) | 高度相似 |
| 待办管理 | todo_tool.py | todo.py + nag 机制 | 概念一致 |
| 安全机制 | path_security + tirith_security | 命令黑名单 + 路径检查 | 均重视安全 |
| 记忆持久化 | memory_provider (SQLite/向量/文档) | 文件持久化 (.tasks/) | 增强延续 |

**结论**: hermes-agent 遵循 learn-claude-code-analysis 所教授的 "Agent = 模型 + Harness" 核心理念，在工具调度、子 Agent、上下文压缩等设计上直接继承了 Claude Code 的架构模式，并在技能自学习和多模型支持上做了显著增强。

### 3.3 三项目关系图

```
learn-claude-code-analysis (Claude Code 架构教学)
         |
         | 继承: Agent循环 / 工具调度 / 技能加载 / 子Agent / 上下文压缩
         v
   hermes-agent (自我改进 Agent 框架)
         ^
         |
         | 继承: 多平台消息 / 插件注册 / 消息路由 / 定时调度 / 执行隔离
         |
nanoclaw-analysis (个人AI助手平台)
```

hermes-agent = nanoclaw 的多通道能力 + learn-claude-code 的 Agent 工程架构 + 自我改进闭环

---

## 四、技术栈

### 4.1 核心依赖

| 依赖 | 用途 |
|------|------|
| openai / anthropic | 多模型 API (OpenAI + Anthropic) |
| prompt_toolkit | CLI TUI 界面 |
| pydantic | 数据模型验证 |
| rich | 终端富文本渲染 |
| tenacity | 重试策略 |
| jinja2 | 提示词模板 |
| fire | CLI 命令框架 |
| httpx | HTTP 客户端 (含 SOCKS 代理) |

### 4.2 可选依赖 (按场景)

| 场景 | 依赖 |
|------|------|
| 消息平台 | python-telegram-bot, discord.py, slack-bolt, aiohttp |
| 定时调度 | croniter |
| 语音 | edge-tts, faster-whisper, sounddevice |
| 记忆存储 | sqlalchemy, chromadb, pymongo |
| MCP | mcp |
| 容器 | docker (via terminal_tool) |
| Serverless | modal, daytona |
| 用户建模 | honcho-ai |
| 国内平台 | dingtalk-stream, lark-oapi |

---

## 五、核心模块详解

### 5.1 工具系统 (tools/)

工具注册中心模式，每个工具是一个独立 Python 文件：

| 工具文件 | 功能 |
|---------|------|
| delegate_tool.py | 子 Agent 委派，上下文隔离执行 |
| file_tools.py | 文件读写编辑 |
| terminal_tool.py | 终端命令执行 |
| browser_tool.py | 浏览器操作 (CamoFox) |
| mcp_tool.py | MCP 协议工具集成 |
| skills_tool.py | 技能搜索/加载/创建 |
| cronjob_tools.py | Cron 定时任务管理 |
| memory_tool.py | 记忆搜索与存储 |
| todo_tool.py | 待办任务管理 |
| send_message_tool.py | 跨平台消息发送 |
| vision_tools.py | 视觉/图像处理 |
| tts_tool.py | 文字转语音 |

### 5.2 消息网关 (gateway/platforms/)

插件式通道注册，支持 15+ 消息平台：

```
gateway/platforms/
  base.py          -- 抽象基类
  telegram.py      -- Telegram
  discord.py       -- Discord
  slack.py         -- Slack
  whatsapp.py      -- WhatsApp
  signal.py        -- Signal
  email.py         -- 邮件
  dingtalk.py      -- 钉钉
  feishu.py        -- 飞书
  wecom.py         -- 企业微信
  weixin.py        -- 微信
  matrix.py        -- Matrix
  mattermost.py    -- Mattermost
  sms.py           -- 短信
  webhhook.py      -- Webhook
```

### 5.3 技能系统 (skills/)

25+ 技能目录，每个技能包含 YAML 前置元数据 + Markdown 指令：

| 类别 | 示例技能 |
|------|---------|
| software-development | 代码生成/审查/重构 |
| data-science | 数据分析/可视化 |
| devops | 部署/监控/CI/CD |
| research | 论文搜索/总结 |
| productivity | 邮件/日历/笔记 |
| creative | 写作/设计 |
| smart-home | Home Assistant 集成 |
| red-teaming | 安全测试 |

### 5.4 记忆系统 (agent/memory_*)

三层记忆架构：

1. **短期记忆** -- 当前会话上下文
2. **中期记忆** -- 跨会话的技能和知识 (SQLite)
3. **长期记忆** -- 用户模型 + 对话历史搜索 (FTS5)

---

## 六、独特设计

### 6.1 自我改进闭环

与其他 Agent 框架最大的差异：hermes-agent 具备完整的"学习-应用-改进"循环：

- **技能自动创建**: 复杂任务完成后，Agent 自动提取可复用流程生成技能
- **技能使用中改进**: 发现技能指令不准确时，自动修改优化
- **定期知识持久化**: Agent 会自我提醒保存重要发现
- **对话历史搜索**: FTS5 全文搜索 + LLM 摘要实现跨会话回忆
- **用户模型构建**: 基于 Honcho 的辩证式用户建模，越用越了解用户

### 6.2 多终端后端

```
+-- local        -- 本地终端直接执行
+-- docker       -- Docker 容器隔离
+-- ssh          -- 远程 SSH 连接
+-- daytona      -- Daytona Serverless (空闲休眠，按需唤醒)
+-- singularity  -- HPC 环境容器
+-- modal        -- Modal Serverless (GPU 按需)
```

### 6.3 智能模型路由

根据任务复杂度自动选择合适的模型：

- 简单任务 --> 快速模型 (Haiku 级别)
- 复杂任务 --> 强力模型 (Opus 级别)
- 支持回退机制，主模型失败时自动降级

---

## 七、总结

### 7.1 项目定位

hermes-agent 是一个**成熟的、可投入使用的** AI Agent 框架，适合个人和团队部署。它的设计理念融合了 Claude Code 的 Agent 架构（工具调度 + 子 Agent + 上下文管理）和 NanoClaw 的多通道消息架构（插件式注册 + 消息路由 + 执行隔离），并在此基础上增加了独特的自我改进能力。

### 7.2 学习价值

| 学习方向 | 从 hermes-agent 能学到什么 |
|---------|--------------------------|
| Agent 架构 | 完整的 Agent 循环实现、工具注册与调度 |
| 多平台集成 | 15+ 消息平台的统一抽象和插件注册模式 |
| 技能系统 | 技能的创建/存储/加载/改进完整生命周期 |
| 记忆管理 | 短期/中期/长期三层记忆架构设计 |
| 工程实践 | pyproject.toml 可选依赖、Serverless 部署、CLI 设计 |
| 安全设计 | 路径安全、命令过滤、凭据管理 |

### 7.3 与前两个项目的演进关系

```
nanoclaw-analysis          learn-claude-code-analysis
  (消息通道架构)              (Agent 工程架构)
        \                        /
         \                      /
          \                    /
           v                  v
        hermes-agent
   (融合 + 自我改进 + 生产级)
```

hermes-agent 验证了一个重要观点：**一个优秀的 Agent 框架 = 可靠的 Agent 循环 + 丰富的工具集 + 多通道接入 + 自我学习能力**。前两个项目分别解决了"如何构建 Agent"和"如何连接用户"的问题，而 hermes-agent 将两者融合并加入了"如何让 Agent 自我进化"的答案。
