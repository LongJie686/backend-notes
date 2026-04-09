# 第 1 讲：多智能体基础认知

## 核心结论（6 条必记）

1. **Agent = LLM + 记忆 + 规划 + 工具 + 反思** -- 以大语言模型为"大脑"，结合四大组件完成复杂任务
2. **三种架构模式各有适用场景** -- ReAct（简单任务）、Plan-Execute（多步骤任务）、Reflexion（高质量输出），选择取决于任务复杂度
3. **先从单 Agent 开始，按需拆分** -- Prompt 超 2000 token 或任务步骤超 5 步时，考虑拆分为 Multi-Agent
4. **LangGraph 适合生产系统，CrewAI 适合快速原型** -- 选型取决于对流程控制的精细度要求
5. **国产模型通过 OpenAI 兼容接口即可对接** -- 关键是做好模型抽象层，支持热切换
6. **多智能体系统的核心特征** -- 角色分工、协作机制、状态共享、容错能力

---

## 一、Agent 与多智能体系统概念

### 什么是 Agent

Agent 是一个能够感知环境、做出决策并执行动作的自主实体。在 LLM 语境下，Agent 以大语言模型为"大脑"，结合记忆、规划、工具和反思四大组件，完成复杂任务。

### Agent 的核心组件

| 组件 | 作用 | 典型实现 |
|------|------|---------|
| 记忆 (Memory) | 存储对话历史、中间结果、长期知识 | 对话缓冲区、向量存储、Redis |
| 规划 (Planning) | 将复杂任务分解为可执行步骤 | Chain of Thought、Task Decomposition |
| 工具 (Tools) | 调用外部 API、搜索引擎、数据库 | Function Calling、自定义工具函数 |
| 反思 (Reflection) | 评估执行结果、自我纠错 | ReAct 循环、Reflexion 模式 |

### 什么是多智能体系统

多智能体系统（Multi-Agent System, MAS）是由多个 Agent 协作完成任务的系统。每个 Agent 扮演特定角色，通过消息传递或共享状态进行协作。

核心特征：
- **角色分工**：每个 Agent 有明确的职责边界
- **协作机制**：Agent 之间通过编排流程协作
- **状态共享**：任务上下文在 Agent 之间传递
- **容错能力**：单个 Agent 失败不影响整体流程

---

## 二、架构模式

### ReAct 模式

ReAct (Reasoning + Acting) 是最基础的 Agent 循环模式：

```
思考(Thought) -> 行动(Action) -> 观察(Observation) -> 思考 -> ...
```

适用场景：简单任务、单步或少量步骤即可完成的场景。

```python
# ReAct 伪代码
while not task_complete:
    thought = llm.think(context, observation)
    action = llm.decide_action(thought)
    observation = tool.execute(action)
    context.update(observation)
```

### Plan-Execute 模式

将规划与执行分离，先生成完整计划，再逐步执行：

```
规划(Plan) -> 执行(Execute Step 1) -> 执行(Execute Step 2) -> ... -> 重规划(Replan)
```

适用场景：多步骤复杂任务、需要全局视角的场景。

### Reflexion 模式

在 ReAct 基础上增加自我反思环节：

```
执行(Task) -> 反思(Reflect) -> 改进(Improve) -> 重新执行 -> ...
```

适用场景：需要高质量输出、允许多次迭代的场景。

三种模式对比：

| 模式 | 复杂度 | 适用场景 | 典型耗时 |
|------|--------|---------|---------|
| ReAct | 低 | 简单查询、单步操作 | 1-3 轮 |
| Plan-Execute | 中 | 多步骤任务、报告生成 | 5-10 步 |
| Reflexion | 高 | 高质量输出、代码生成 | 3-5 轮迭代 |

---

## 三、单 Agent vs 多智能体场景选择

### 使用单 Agent 的场景

- 任务简单明确，步骤少于 5 步
- 不需要不同专业能力的切换
- 对延迟敏感，需要快速响应
- 资源受限，无法承担多 Agent 开销

### 使用多智能体的场景

- 任务需要多种专业能力（如搜索+写作+审核）
- 单个 Agent 的 Prompt 过长，导致性能下降
- 需要并行处理子任务以提高效率
- 业务流程有明确的分工环节
- 需要不同 Agent 使用不同模型（成本优化）

判断原则：**先从单 Agent 开始，当 Prompt 超过 2000 token 或任务步骤超过 5 步时，考虑拆分为 Multi-Agent。**

---

## 四、框架对比

### LangGraph

- **定位**：基于图的状态机编排框架
- **优势**：灵活的流程控制、支持循环和条件分支、可视化调试
- **劣势**：学习曲线较陡、需要手动管理状态
- **适用**：复杂工作流、需要精细控制执行流程的场景

### CrewAI

- **定位**：角色驱动的 Multi-Agent 框架
- **优势**：上手快、角色定义直观、内置工具丰富
- **劣势**：流程控制不如 LangGraph 灵活、定制性有限
- **适用**：快速原型、标准化的协作场景

### AutoGen

- **定位**：对话驱动的 Multi-Agent 框架（微软开源）
- **优势**：自然对话式协作、支持人工介入、研究生态丰富
- **劣势**：偏向研究用途、生产就绪度较低
- **适用**：研究探索、需要人机协作的场景

### MetaGPT

- **定位**：模拟软件公司的 Multi-Agent 框架
- **优势**：预设了完整的软件开发流程、角色丰富
- **劣势**：应用场景偏窄、定制困难
- **适用**：自动化软件开发、需求分析场景

选型建议：

| 需求 | 推荐框架 |
|------|---------|
| 复杂流程控制 | LangGraph |
| 快速搭建原型 | CrewAI |
| 研究和探索 | AutoGen |
| 软件开发自动化 | MetaGPT |
| 生产级系统 | LangGraph + 自定义编排 |

---

## 五、国产化适配

### 为什么要做国产化适配

- OpenAI API 在国内访问不稳定，延迟高
- 数据出境合规风险
- 成本控制需求
- 国产模型能力持续提升

### 国产模型对接方式

```python
# OpenAI 兼容接口（通义千问、DeepSeek 等）
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

response = client.chat.completions.create(
    model="qwen-plus",
    messages=[{"role": "user", "content": "你好"}]
)
```

### 国产模型选择

| 模型 | 厂商 | 适用场景 | Function Calling |
|------|------|---------|-----------------|
| Qwen-Max | 阿里 | 通用对话、长文本 | 支持 |
| DeepSeek-V3 | 深度求索 | 代码生成、推理 | 支持 |
| GLM-4 | 智谱 | 通用对话、工具调用 | 支持 |
| ERNIE-4 | 百度 | 中文场景、知识问答 | 支持 |

### 适配要点

- 使用 OpenAI 兼容接口，减少代码改动
- 封装统一的模型调用层，支持热切换
- 注意不同模型的 Prompt 风格差异
- 测试 Function Calling 的兼容性

---

## 六、实战项目：搭建第一个 ReAct Agent

**目标**：使用 LangChain 实现一个能搜索并回答问题的 Agent。

**步骤**：
1. 配置 LLM 接口（OpenAI 或国产模型）
2. 定义搜索工具（Tavily / SerpAPI）
3. 构建 ReAct Agent
4. 测试多轮对话能力
5. 观察思考-行动-观察循环

**预期产出**：一个能自主搜索并回答复杂问题的 Agent，能展示完整的推理链。

---

## 练习题（待完成）

- [ ] 练习1：使用 LangChain 搭建一个 ReAct Agent，配备搜索和计算器两个工具
- [ ] 练习2：分别用 OpenAI 和通义千问运行同一个任务，对比输出质量
- [ ] 练习3：尝试用 LangGraph 实现一个简单的状态机，包含两个 Agent 节点
- [ ] 练习4：对比 ReAct 和 Plan-Execute 模式在同一任务上的表现差异
