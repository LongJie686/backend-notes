# OpenHuman 项目分析

> 31K Stars 的 AI Agent 新物种，2026年2月发布
> 仓库: https://github.com/tinyhumansai/openhuman

---

## 核心结论

1. **定位不同** — OpenHuman 是"个人 AI 超级智能"，Hermes 是"通用自主 Agent 框架"。前者面向终端用户，后者面向开发者和自动化场景
2. **最大创新** — Memory Tree + Obsidian vault 自动构建，从连接的数据源持续抽取知识
3. **TokenJuice 压缩** — 每个 tool call 前自动压缩，声称节省 80% token
4. **118+ OAuth 集成** — 一键连接 Gmail/Notion/GitHub 等，20 分钟自动轮询

---

## 一、项目速览

| 维度 | 详情 |
|------|------|
| Stars | 31,083（4个月） |
| 语言 | Rust（核心）+ TypeScript（UI） |
| 协议 | GNU |
| 现状 | Early Beta |
| 桌面壳 | Tauri + CEF |
| 安装 | Homebrew / apt / MSI / AppImage |

---

## 二、核心架构

### 技术栈

```
OpenHuman
  ├── src/core/        — Rust 核心（Agent 循环、调度、记忆引擎）
  ├── src/api/         — JSON-RPC / Socket.io API
  ├── app/             — Tauri 桌面壳
  ├── packages/        — 前端 UI 组件
  └── src/rpc/         — RPC 日志与通信
```

### 五大核心能力

| 能力 | 实现方式 | 创新度 |
|------|---------|--------|
| Memory Tree | SQLite + 分层摘要树 + Obsidian vault | 🚀 独有 |
| TokenJuice | tool call 前规则引擎压缩 | 🚀 独有 |
| Auto-fetch | 20 分钟定时轮询 118 个数据源 | 🚀 独有 |
| 模型路由 | 后端代理选模型，一个订阅全覆盖 | ⭐ 便利 |
| 原生语音 | STT + ElevenLabs TTS + Google Meet | ⭐ 场景化 |

---

## 三、与 Hermes / Claude Code / OpenClaw 对比

| 维度 | OpenHuman | Hermes | Claude Code | OpenClaw |
|------|-----------|--------|-------------|----------|
| 开源 | ✅ GNU | ✅ MIT | ❌ 闭源 | ✅ MIT |
| 上手难度 | 分钟级 | 小时级 | 分钟级 | 小时级 |
| 记忆系统 | 🚀 自动构建知识树 | ✅ 自学习记忆 | ✅ 会话内 | ⚠️ 依赖插件 |
| 集成数 | 118+ OAuth | 需手动配 MCP | 少量 | 需手动配 |
| Auto-fetch | ✅ 20min | ❌ | ❌ | ❌ |
| Token 压缩 | ✅ TokenJuice | ⚠️ 上下文超限才压 | ⚠️ 基础压缩 | ❌ |
| 模型 | 一个订阅全覆盖 | BYO key | 绑定 Claude | BYO key |
| 桌面/语音 | ✅ | ❌ | ✅ 桌面 | ❌ |
| 多平台消息 | ⚠️ Discord 等 | ✅ 15+ 平台 | ❌ | ✅ 5 平台 |
| 定时任务 | ⚠️ 有限 | ✅ cron | ❌ | ⚠️ 有限 |
| 子 Agent | ❓ | ✅ delegate | ✅ subagent | ❌ |

---

## 四、Memory Tree 机制（最值得借鉴）

### 工作流程

```
数据源连接（Gmail/Notion/GitHub/Slack...）
  ↓ 20 分钟一次
数据拉取（Composio 连接器层）
  ↓ 
内容分块（≤3K token Markdown chunks）
  ↓
评分排序（相关性/新鲜度）
  ↓
分层摘要树（SQLite 存储）
  ↓ 
同步到 Obsidian vault（.md 文件）
```

### 关键设计

- 本地存储，不依赖云端
- chunk 大小 ≤ 3K tokens（适合 LLM context 注入）
- 分层摘要：原始 chunk → 主题摘要 → 全局总览
- Obsidian 兼容：可直接打开浏览、编辑

---

## 五、TokenJuice 压缩策略

### 规则引擎

| 规则 | 行为 |
|------|------|
| HTML → Markdown | 去除所有标签，保留文本 |
| URL 缩短 | `github:user/repo/src/file` |
| 重复行去重 | 同内容 ≥5 行 → 合并为 1 行 + 计数 |
| 日志噪音去除 | 去时间戳、日志级别前缀 |
| 堆栈截断 | 长堆栈只保留前 100 字符 |
| CJK/emoji 保留 | 字节级保真，不裁切 |

### 实测效果

OpenHuman 声称节省 80%。Hermes 移植版实测：
- 重复行场景：87% 压缩
- 日志场景：25% 压缩
- HTML 场景：1% 压缩（取决于内容密度）
- 综合：~11-30%

---

## 六、对 Hermes 的启发

### 已实现

```
✅ Memory Tree Builder（20分钟 cron → Obsidian vault）
✅ TokenJuice 独立工具（脚本预处理用）
```

### 待探索

```
🟡 MCP server 包装（让 Hermes 在对话中主动查知识库）
🟡 RSS auto-fetch（需在 MCP 环境中集成）
🟡 分层摘要树（当前是 flat 结构，未做层级聚合）
```

### 不适合移植的

```
❌ Rust 重写（Python 生态够用）
❌ 桌面 UI（Hermes 走 CLI/Gateway 路线）
❌ 模型订阅模式（BYO key 更灵活）
❌ Composio 集成层（太重，Hermes 用 MCP 协议即可）
```

---

## 七、总结

OpenHuman 和 Hermes 是两种不同哲学的产品：

- OpenHuman = "给你一个开箱即用的 AI 伙伴"
- Hermes = "给你一套可定制的 AI 基础设施"

OpenHuman 的 **Memory Tree + TokenJuice + Auto-fetch** 三位一体是当前最先进的个人知识管理方案。Hermes 可以借鉴这些思想，但不需要复制其产品形态——通过 cron + MCP + 脚本的组合，Hermes 可以实现同样甚至更强的能力，同时保持架构的简洁和灵活。
