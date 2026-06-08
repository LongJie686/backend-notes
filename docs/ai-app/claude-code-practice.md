# Claude Code 实战笔记

> 基于实际项目使用的踩坑记录和工作流沉淀
> 更新日期: 2026-06-08

---

## 核心结论

1. Claude Code 本质是**智谱 GLM-5.1 套壳**，但功能完整
2. 与 Hermes 互补而非竞争：CC 管编码，Hermes 管自动化+跨会话记忆
3. 真正的痛点不在写代码，而在**跨项目上下文丢失**
4. 权限白名单是安全第一关，出问题先查 `settings.local.json`

---

## 一、环境与配置

### 安装位置

```
Windows 全局安装（npm/npx 方式）
用户配置：C:/Users/20597/.claude/
项目配置：{project}/.claude/
```

### 核心配置文件

| 文件 | 用途 |
|------|------|
| `settings.json` | 全局设置（模型、hooks、插件、权限） |
| `settings.local.json` | 项目级权限白名单（最常改） |
| `mcp.json` | MCP 服务器配置 |
| `CLAUDE.md` | 项目级 agent 指令 |
| `.claude/projects/{hash}/memory/` | 按项目隔离的记忆存储 |

### MCP 服务器配置（10个）

```json
// C:/Users/20597/.claude/mcp.json
{
  "filesystem":  "C:/Users/20597/Documents, Desktop, E:/",
  "fetch":       "mcp-fetch-server",
  "sqlite":      "mcp-sqlite-tools",
  "puppeteer":   "@modelcontextprotocol/server-puppeteer",
  "memory":      "@modelcontextprotocol/server-memory",
  "office":      "office-mcp + @promptx/mcp-office（两个，处理 docx/pptx/xlsx）",
  "playwright":  "@executeautomation/playwright-mcp-server",
  "chart":       "@antv/mcp-server-chart",
  "github":      "@modelcontextprotocol/server-github",
  "xiaohongshu": "http://localhost:18060/sse（Docker 容器）"
}
```

### Hooks 系统

Claude-HUD 插件实现工具调用的可视化确认：

```
PreToolUse  →  notify.py（异步通知）+ permission.py（权限检查弹窗）
PostToolUse →  notify.py（异步通知）
Stop        →  notify.py
SessionStart → notify.py
SessionEnd  →  notify.py
```

启用插件：`claude-hud@claude-hud`（GitHub: jarrodwatts/claude-hud）

---

## 二、权限系统（最常遇到问题的地方）

### 两级权限

1. **全局白名单**（`settings.json`）
2. **项目级白名单**（`settings.local.json`）

### 权限格式

```json
{
  "permissions": {
    "allow": [
      "Bash(powershell:*)",        // 允许所有 PowerShell 命令
      "Bash(wsl:*)",               // 允许所有 WSL 命令
      "Bash(python:*)",            // 允许所有 Python 命令
      "mcp__github__search_repositories",  // 允许特定 MCP 工具
      "mcp__filesystem__write_file",       // 允许写文件
      "Write(C:/Users/20597/*)",   // 允许写特定路径
      "WebSearch"                  // 允许网络搜索
    ]
  }
}
```

### 排查流程

```
报错 "Permission denied" 
→ 看错误信息里的命令名 
→ 去 settings.local.json 的 allow 数组追加对应条目
→ 格式：Bash(命令前缀*)
```

### 常见权限条目

| 场景 | 权限 |
|------|------|
| Python 脚本 | `Bash(python:*)` |
| pip 安装 | `Bash(pip show:*)` `Bash(pip install:*)` |
| Node 命令 | `Bash(npm:*)` `Bash(npx:*)` `Bash(node:*)` |
| Git 操作 | `Bash(git:*)` |
| Docker | `Bash(docker:*)` |
| WSL 调用 | `Bash(wsl:*)` |
| 文件写入 | `Write(C:/Users/20597/*)` |
| MCP 工具 | `mcp__{server}__{tool}` |

---

## 三、项目级 CLAUDE.md 写法

### backend-notes 项目示例

```markdown
# CLAUDE.md
- VitePress 静态站点，base: '/backend-notes/'
- docs/ 同时是 Obsidian vault
- git push 需代理: http://127.0.0.1:7890
- 修改 sidebar 时必须同步更新 generate-graph-data.mts
- 不要手动编辑 graph-data.json
```

### 有效规则的特征

- 短（每条一行）
- 精确（带具体路径/命令）
- 防错（标注"不要XXX"比"要XXX"更有效）
- 平台特定（Windows 用 PowerShell，不在 WSL 里执行 Windows 命令）

---

## 四、与 Hermes 的桥接

### ACP 桥接器

```
/root/content-matrix/scripts/claude_acp_bridge.py
```

历史问题与修复：

| 问题 | 根因 | 修复 |
|------|------|------|
| claude.exe 挂起 | WSL 下子进程等待 stdin | 改用 os.open(os.devnull) + start_new_session=True |
| 超时不返回 | communicate() 无限等待 | --max-turns 1 + Popen communicate() 超时后 kill |
| --acp --stdio 不支持 | 那是 GitHub Copilot 协议 | 改用 --print --output-format=stream-json |

### 调用方式

```
Hermes: delegate_task + acp_command: 'claude'
→ claude_acp_bridge.py 
→ claude.exe -p "prompt"
```

日志前缀 `[claude-bridge]`，便于排查。

---

## 五、Skills 系统

### 项目级 Skill

`backend-notes/.claude/skills/backend-notes-update.md`

功能：规范地创建课程笔记文件、更新 VitePress sidebar、新建目录。包含完整的文件命名规则、模板、校验清单。

### 全局 Skills（100+）

安装在 `C:/Users/20597/.claude/skills/`，涵盖：

| 类别 | 数量 | 代表 |
|------|------|------|
| 编码规范 | 10+ | python-patterns, java-coding-standards, cpp-coding-standards |
| 测试 | 8+ | tdd-workflow, e2e-testing, systematic-debugging |
| 文档 | 6+ | docx, pptx, xlsx, pdf, article-writing |
| 设计 | 4+ | frontend-design, canvas-design, ui-ux-pro-max |
| 部署 | 5+ | docker-patterns, deployment-patterns, executing-plans |
| Agent 工程 | 8+ | agentic-engineering, autonomous-loops, subagent-driven-development |
| 安全 | 3+ | security-review, security-scan, receiving-code-review |

---

## 六、插件系统

### 已安装

| 插件 | 来源 | 功能 |
|------|------|------|
| claude-hud | jarrodwatts/claude-hud | 工具调用可视化确认弹窗 |

### 配置

```json
// settings.json
{
  "enabledPlugins": { "claude-hud@claude-hud": true },
  "extraKnownMarketplaces": {
    "claude-hud": {
      "source": { "source": "github", "repo": "jarrodwatts/claude-hud" }
    }
  }
}
```

---

## 七、常见踩坑

1. **WSL 命令挂起** — 在 Windows CC 中执行 wsl 命令，优先用 `Bash(wsl:*)` 权限 + 短命令
2. **Python 路径混乱** — Windows 上有多个 Python（系统/uv/venv），用完整路径
3. **文件编码** — Windows 默认 GBK，写文件时必须指定 UTF-8
4. **MCP 服务器连接失败** — 检查 npx 缓存，`npx -y @scope/package` 确保拉最新
5. **代理问题** — git push 和网络请求需显式指定 `http://127.0.0.1:7890`

---

## 八、与 Hermes 的分工

| 场景 | 用 Claude Code | 用 Hermes |
|------|---------------|-----------|
| 写代码/修 bug | ✅ | 🟡 可以但不擅长 |
| 审 PR/重构 | ✅ | 🟡 |
| 定时自动化任务 | ❌ | ✅ |
| 跨会话记忆 | ❌ | ✅ |
| 手机端交互 | ❌ | ✅ |
| 多平台消息推送 | ❌ | ✅ |
| 技能沉淀与复用 | 🟡 手动 | ✅ 自动 |
| 多模型对比 | ❌ | ✅ |

> 原则：编码找 CC，自动化找 Hermes，长期项目两者配合。
