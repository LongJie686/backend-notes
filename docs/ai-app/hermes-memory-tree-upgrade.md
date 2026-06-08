# Hermes 改造记录：Memory Tree + TokenJuice

> 借鉴 OpenHuman 的设计思想，在 Hermes 上实现的自动化知识库构建
> 改造日期: 2026-06-08

---

## 改造动机

OpenHuman 的核心创新在于三个能力的组合：
1. **Memory Tree** — 自动从数据源抽取、分块、建立知识树
2. **TokenJuice** — tool output 进入 LLM context 前的预处理压缩
3. **Auto-fetch** — 定时轮询数据源，不等用户发起

Hermes 已有 MCP 服务器、cron 调度、记忆系统，缺的只是自动化的索引和预处理层。

---

## 改造内容

### 1. Memory Tree Builder

**文件**: `/root/hermes-tools/memory_tree_builder.py`

```
Hermes cron (每20分钟)
  → 扫描本地文档（content-matrix/docs, ai-tools, skills, scripts）
  → 按段落分块（≤3K tokens/chunk）
  → 去重（content hash）
  → 存储到 SQLite 索引数据库
  → 导出为 Obsidian 兼容的 markdown vault
  → 生成每日摘要
```

**关键技术细节**：

| 项 | 值 |
|------|------|
| Chunk 大小 | ≤3K tokens（中英文混合估算） |
| 索引数据库 | `/root/.hermes/memory_tree.db`（SQLite） |
| Vault 路径 | `/root/obsidian-vault/` |
| 排除目录 | venv, node_modules, .git, site-packages, __pycache__ |
| 覆盖扩展 | .md, .py, .yaml, .txt |
| 文件上限 | 500KB（超限跳过） |

**当前效果**：
- 索引 502 个有效文件
- 生成 509 个知识分块
- Vault 结构：inbox/（原始分块）、summaries/（数据源摘要）、daily/（每日快照）、archive/（归档）

### 2. TokenJuice 预压缩工具

**文件**: `/root/hermes-tools/token_juice.py`

```
输入 → 类型检测 → 规则压缩 → 输出
     ├─ HTML → 标签清理 + URL 缩短
     ├─ 日志 → 去时间戳 + 去冗余前缀
     ├─ 重复行 → 合并 + 计数
     └─ 通用 → URL 缩短 + 空白合并
```

**压缩率实测**：

| 场景 | 原始 tokens | 压缩后 | 节省 |
|------|-----------|--------|------|
| 重复日志行(×10) | 15 | 2 | 87% |
| 应用日志 | 83 | 62 | 25% |
| 混合内容 | 121 | 121 | 0% |
| HTML 页面 | 101 | 100 | 1% |

**注意**：TokenJuice 是独立工具，未挂到 Hermes 主流程。因 Hermes hooks 只能收 tool name + exit code，无法拦截 tool output。

### 3. Cron 部署

```
任务ID: 3d045afda596
名称: Memory Tree 自动构建
模式: no_agent=True（纯脚本，不消耗 LLM token）
间隔: 每 20 分钟
输出: local（不推送到消息平台）
```

---

## 未实现的部分

| 功能 | 状态 | 原因 |
|------|------|------|
| RSS auto-fetch | ⚠️ | cron 环境无 MCP 工具上下文 |
| 分层摘要树 | 🟡 | 当前 flat 结构，未做主题聚合 |
| MCP server 包装 | 🟡 | 可做，让 Hermes 对话中查知识库 |
| TokenJuice inline | ❌ | Hermes hooks 无法拦截 tool output |

---

## 架构图

```
┌─────────────────────────────────────────────┐
│                  Hermes Agent                 │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Gateway │  │   LLM    │  │  Cron (20m) │  │
│  │ QQ/飞书  │  │ deepseek │  │     │        │  │
│  └─────────┘  └──────────┘  └─────┼────────┘  │
│                                    │           │
└────────────────────────────────────┼───────────┘
                                     │
                              ┌──────▼──────┐
                              │ memory_tree │
                              │ builder.py  │
                              └──────┬──────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
              ┌─────▼─────┐  ┌──────▼──────┐  ┌─────▼─────┐
              │ 扫描文档   │  │ 分块+去重   │  │ 导出vault │
              │ (502文件) │  │ (509分块)  │  │ (.md)     │
              └───────────┘  └─────────────┘  └───────────┘
                                                     │
                                              ┌──────▼──────┐
                                              │  Obsidian   │
                                              │   Vault     │
                                              │ /root/      │
                                              │ obsidian-   │
                                              │ vault/      │
                                              └─────────────┘
```

---

## 与 OpenHuman 的差异

| 维度 | OpenHuman | Hermes 改造版 |
|------|-----------|-------------|
| 数据源 | 118+ OAuth 集成 | 文件系统 + RSS Feed |
| 同步方式 | 后台守护线程 | cron 定时任务 |
| 压缩时机 | 每个 tool call 前 | 独立脚本、按需调用 |
| 知识格式 | Obsidian vault | Obsidian vault（相同） |
| 索引存储 | SQLite | SQLite（相同） |
| 桌面体验 | Tauri 桌面应用 | CLI/脚本 |
| 维护成本 | 依赖 OpenHuman 更新 | 独立维护，无侵入 |

---

## 后续规划

1. **RSS 集成** — 用 Hermes cron agent 模式（非纯脚本），让 LLM 在 cron 中调用 RSS MCP 工具
2. **分层摘要** — 对同一数据源的多个 chunk 做主题聚类，生成二级摘要
3. **MCP server 化** — 让 Hermes 在对话中能主动搜索 vault 内容
4. **Windows 互通** — vault 同步到 `E:\Project\obsidian-vault\`，在 Windows Obsidian 中打开
