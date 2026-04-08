# Learn Claude Code -- 架构与实现分析

> 从零复现 Claude Code 核心架构的教学项目
> 项目地址: E:\Project\Astudy\learn-claude-code-analysis

---

## 核心结论

1. **Agent = 模型(智能) + Harness(工具/环境)** -- 复杂度在 Harness 层，不在框架层
2. **整个系统核心是一个 while 循环** -- 模型决策何时停止、调用什么工具
3. **添加新功能 = 添加工具 handler** -- 不改循环结构，只扩展工具集
4. **安全是第一优先级** -- 命令黑名单、路径逃逸检查、输出截断
5. **上下文管理是长任务的关键** -- 三层压缩策略让 Agent 可以无限工作
6. **多 Agent 协作靠文件系统通信** -- JSONL 邮箱实现松耦合

---

## 一、项目结构

```
learn-claude-code-analysis/
  main.py                  -- 主入口
  src/
    config.py              -- 全局配置
    tools/
      base.py              -- 基础工具 (bash/read/write/edit)
      registry.py          -- 工具注册中心
    managers/
      todo.py              -- 待办任务管理器
      skill.py             -- 技能加载器
      compact.py           -- 上下文压缩管理器
      task.py              -- 任务持久化管理器
      background.py        -- 后台任务管理器
      message_bus.py       -- 消息总线
    agents/
      loop.py              -- 核心 Agent 循环
      subagent.py          -- 子 Agent 实现
```

---

## 二、核心理念：Harness Engineering

### Agent 分解

```
Agent = Model (模型) + Harness (线束)
         |                |
      神经网络         工具、知识、上下文管理、权限控制
      感知/推理/决策    模型栖居的世界
```

### 与传统框架对比

| 维度 | LangChain 类框架 | Harness 思路 |
|------|-----------------|-------------|
| 核心架构 | Chain/Pipeline/Graph | 一个 while 循环 |
| 决策权 | 代码编排 (if-else) | 模型决定 (stop_reason) |
| 复杂度来源 | 框架层 (节点/边/状态机) | Harness 层 (工具/知识/隔离) |
| 扩展方式 | 加节点/加边 | 加工具 handler |

---

## 三、核心 Agent 循环

这是整个项目的灵魂，12 个 Session 中这个结构从未改变：

```python
def agent_loop(client, model, system, messages, tools_schema, tool_handlers):
    while True:
        # 1. 调用模型
        response = client.messages.create(model, system, messages, tools)
        messages.append({"role": "assistant", "content": response.content})

        # 2. 模型决定停止 -> 返回结果
        if response.stop_reason != "tool_use":
            return

        # 3. 模型决定调用工具 -> 执行并回传结果
        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = tool_handlers[block.name](**block.input)
                results.append({"type": "tool_result", ...})

        messages.append({"role": "user", "content": results})
        # 回到 while 开始下一轮
```

**关键设计决策：**

- 模型是决策者，决定何时停止、调用什么工具
- 工具执行是同步的，结果回传给模型做下一轮决策
- 循环只做三件事：调模型、判断停止、执行工具

---

## 四、12 个渐进式课程架构

| 阶段 | Session | 工具数 | 新概念 |
|------|---------|--------|--------|
| 基础 | s01 Agent Loop | 1 | 核心 while 循环 + bash |
| 基础 | s02 Tool Use | 4 | read/write/edit + 工具分发 |
| 规划 | s03 TodoWrite | 5 | 任务管理 |
| 规划 | s04 Subagent | 5 | 上下文隔离 |
| 规划 | s05 Skill Loading | 5 | 按需知识加载 |
| 规划 | s06 Context Compact | 5 | 上下文压缩 |
| 持久化 | s07 Task System | 8 | 任务持久化 |
| 持久化 | s08 Background | 6 | 异步执行 |
| 多Agent | s09 Agent Teams | 9 | 多 Agent 协作 |
| 多Agent | s10 Team Protocols | 12 | 团队协议 |
| 多Agent | s11 Autonomous | 14 | 自主 Agent |
| 多Agent | s12 Worktree | 16 | 目录隔离 |

> 每个 Session 只添加一个新概念，所有概念独立且可组合

---

## 五、安全防护机制

```python
# 1. 危险命令黑名单
DANGEROUS_COMMANDS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]

# 2. 路径逃逸检查
def safe_path(p: str, workdir: Path) -> Path:
    path = (workdir / p).resolve()
    if not path.is_relative_to(workdir):
        raise ValueError(f"Path escapes workspace: {p}")
    return path

# 3. 输出截断 (防止单次输出过大)
MAX_OUTPUT = 50000

# 4. 超时限制 (防止单次命令执行过久)
TIMEOUT = 120
```

---

## 六、上下文压缩策略（三层）

这是让 Agent 可以长时间工作的关键技术：

| 层级 | 触发条件 | 行为 |
|------|---------|------|
| micro_compact | 每轮静默执行 | 旧 tool_result 替换为 `[Previous: used tool_name]` |
| auto_compact | tokens > 50000 | 保存磁盘 + LLM 总结 |
| compact 工具 | 模型主动触发 | 模型决定何时压缩 |

```python
PRESERVE_TOOLS = {"read_file"}  # read_file 结果不压缩
KEEP_RECENT = 3                 # 保留最近 3 条工具结果
THRESHOLD = 50000               # token 阈值
```

> 对话可能被压缩，但状态通过文件系统持久化

---

## 七、任务持久化

使用文件系统作为简化版数据库：

```python
class TaskManager:
    def create(self, subject, description=""):
        task = {
            "id": self._next_id,
            "subject": subject,
            "status": "pending",
            "blockedBy": [],
        }
        self._save(task)  # 写入 .tasks/task_N.json

    def _clear_dependency(self, completed_id):
        # 任务完成后，自动从其他任务的 blockedBy 中移除
        for f in self.dir.glob("task_*.json"):
            task = json.loads(f.read_text())
            if completed_id in task.get("blockedBy", []):
                task["blockedBy"].remove(completed_id)
                self._save(task)
```

---

## 八、多 Agent 协作

### 消息总线（JSONL 邮箱）

```
.team/inbox/
  alice.jsonl    -- Alice 的收件箱
  bob.jsonl      -- Bob 的收件箱
  lead.jsonl     -- Lead 的收件箱
```

```python
class MessageBus:
    def send(self, sender, to, content):
        msg = {"from": sender, "content": content, "timestamp": time.time()}
        with open(self.dir / f"{to}.jsonl", "a") as f:
            f.write(json.dumps(msg) + "\n")

    def read_inbox(self, name):
        # 读取并清空 (drain 模式)
        messages = [...]
        inbox_path.write_text("")  # 清空
        return messages
```

### 子 Agent 模式

```python
def run_subagent(client, model, system_prompt, prompt):
    sub_messages = [{"role": "user", "content": prompt}]
    for _ in range(SUBAGENT_MAX_ROUNDS):  # 最多 30 轮
        response = client.messages.create(...)
        # ... 执行工具 ...
    # 只返回最终文本摘要
    return "".join(b.text for b in response.content if hasattr(b, "text"))
```

**关键特征：** 共享文件系统，独立对话历史，只返回摘要

---

## 九、技能双层加载

避免一次性把所有技能塞进 system prompt 浪费 token：

```python
class SkillLoader:
    def get_descriptions(self) -> str:
        # Layer 1: system prompt 中的简短描述
        return "  - git: Git version control commands"

    def get_content(self, name: str) -> str:
        # Layer 2: 通过 tool_result 注入完整内容
        return f'<skill name="{name}">\n{skill["body"]}\n</skill>'
```

---

## 十、后台任务与 Nag 提醒

### 后台任务

```python
class BackgroundManager:
    def run(self, command: str) -> str:
        task_id = str(uuid.uuid4())[:8]
        thread = threading.Thread(target=self._execute, args=(task_id, command), daemon=True)
        thread.start()
        return f"Background task {task_id} started"

    def drain_notifications(self) -> list:
        # 每次 LLM 调用前排空通知
        with self._lock:
            notifs = list(self._notification_queue)
            self._notification_queue.clear()
        return notifs
```

### Nag 提醒（软约束）

```python
rounds_since_todo = 0 if used_todo else rounds_since_todo + 1
if rounds_since_todo >= 3:
    history.append({
        "role": "user",
        "content": "<reminder>Update your todos.</reminder>",
    })
```

> 不是硬编码逻辑，而是通过 system prompt 中的提醒引导模型行为

---

## 十一、学习价值

| 学到什么 | 对应模块 |
|---------|---------|
| Agent 的本质是循环 | `agents/loop.py` |
| 工具注册与分发 | `tools/registry.py` |
| 安全防护设计 | `tools/base.py` |
| 上下文压缩策略 | `managers/compact.py` |
| 任务持久化 | `managers/task.py` |
| 多 Agent 通信 | `managers/message_bus.py` |
| 异步任务执行 | `managers/background.py` |
| 按需知识加载 | `managers/skill.py` |
