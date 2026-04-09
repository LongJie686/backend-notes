# 第 1 讲：Multi-Agent 核心概念与架构模式

## 核心结论（10 条必记）

1. **Agent ≠ GPT 调用** -- Agent 有规划、工具、记忆、反思能力
2. **Multi-Agent 的核心是分工协作** -- 不是简单堆砌
3. **Agent 的四大组件：记忆、规划、执行、反思** -- 缺一不可
4. **ReAct 适合灵活推理** -- 思考-行动-观察循环
5. **Plan-Execute 适合固定流程** -- 先规划再执行
6. **层级式架构最常用** -- 主 Agent 分配，子 Agent 执行
7. **协作式 Token 消耗最大** -- 多轮讨论，质量高但成本高
8. **CrewAI 上手最快，LangChain 最灵活** -- 按场景选择
9. **一定要限制最大迭代次数** -- 避免死循环
10. **Prompt 工程是 Agent 的灵魂** -- 比框架选择更重要

---

## 一、什么是 Agent？为什么它不是简单的 GPT 调用？

### 1. 从一个例子说起

假设你要做一个"写周报"的功能。

**方案 A：简单的 GPT 调用**

```python
prompt = f"帮我写一份本周工作总结，本周工作内容：{work_content}"
response = openai.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": prompt}]
)
print(response.choices[0].message.content)
```

问题：
- 只能一次性输出，无法拆解复杂任务
- 无法调用外部工具（如查日历、查 Jira）
- 无法根据中间结果调整策略
- 无法处理多步骤任务

**方案 B：Agent 方式**

```python
# 伪代码示意
agent = Agent(
    role="周报助手",
    tools=[查日历工具, 查Jira工具, 查邮件工具],
    memory=ConversationMemory()
)

# Agent 会自己规划：
# 1. 先调用查日历工具，看本周开了哪些会
# 2. 再调用查 Jira 工具，看完成了哪些任务
# 3. 再调用查邮件工具，看有哪些重要沟通
# 4. 整合信息，生成周报
result = agent.run("帮我写一份本周工作总结")
```

---

### 2. Agent 的标准定义

> 一个能够**感知环境**、**自主决策**、**执行动作**、**达成目标**的智能体。

用大白话说：
- 你给 Agent 一个目标（如"写周报"）
- Agent 自己想办法完成（规划、调用工具、整合信息）
- 你不需要告诉它每一步怎么做

---

### 3. Agent 的核心组件

```
┌─────────────────────────────────────┐
│           Agent 核心架构             │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────┐      ┌──────────┐   │
│  │  记忆     │◄────►│  规划     │   │
│  │ Memory   │      │ Planning │   │
│  └──────────┘      └──────────┘   │
│        ▲                  │        │
│        │                  ▼        │
│  ┌──────────┐      ┌──────────┐   │
│  │  反思     │◄────►│  执行     │   │
│  │Reflection│      │ Action   │   │
│  └──────────┘      └──────────┘   │
│                                     │
└─────────────────────────────────────┘
```

**Memory（记忆）**
- 短期记忆：当前对话的上下文
- 长期记忆：历史对话、知识库
- 工作记忆：任务执行过程中的中间状态

**Planning（规划）**
- 任务分解：把大任务拆成小任务
- 步骤规划：确定执行顺序
- 目标管理：追踪完成进度

**Action（执行）**
- 工具调用：调用外部 API、数据库等
- 内容生成：调用 LLM 生成文本
- 状态更新：更新任务状态

**Reflection（反思）**
- 自我评估：判断输出质量
- 错误纠正：发现问题并重试
- 策略调整：根据反馈改进

---

### 4. Agent vs 传统 GPT 调用

| 维度 | 传统 GPT 调用 | Agent |
|------|--------------|-------|
| 任务复杂度 | 单轮问答 | 多步骤任务 |
| 工具能力 | 无 | 可调用外部工具 |
| 规划能力 | 无 | 能自主规划 |
| 记忆能力 | 仅当前对话 | 长短期记忆 |
| 迭代能力 | 一次生成 | 多轮迭代优化 |
| 适用场景 | 简单问答、文本生成 | 复杂任务、流程自动化 |

---

## 二、为什么需要 Multi-Agent？

### 1. 单 Agent 的局限性

假设你要做一个"市场调研报告生成系统"：

```python
agent = Agent(
    role="全能研究员",
    tools=[搜索工具, 爬虫工具, 数据分析工具, 文档生成工具]
)
result = agent.run("生成手机市场调研报告")
```

问题：
- Prompt 非常长，LLM 容易"混乱"
- 单个 Agent 处理所有步骤，容错性差
- 无法并行执行
- 难以做专业化分工
- 调试困难

---

### 2. Multi-Agent 的优势

```python
# 定义多个专业化 Agent
researcher = Agent(role="研究员", tools=[搜索工具, 爬虫工具])
analyst = Agent(role="数据分析师", tools=[数据分析工具])
writer = Agent(role="报告撰写者", tools=[文档生成工具])

# 协作流程
crew = Crew(agents=[researcher, analyst, writer])
result = crew.run("生成手机市场调研报告")
```

| 优势 | 说明 |
|------|------|
| 专业化分工 | 每个 Agent 专注一件事，Prompt 更简洁 |
| 并行执行 | 多个 Agent 可以同时工作 |
| 容错性强 | 某个 Agent 失败不影响整体 |
| 可维护性高 | 修改某个环节只需改对应 Agent |
| 可复用 | Agent 可以在不同任务中复用 |

---

### 3. Multi-Agent 的典型场景

| 场景 | Agent 分工 |
|------|-----------|
| 研报生成 | 研究员、分析师、撰写者 |
| 小红书爆款 | 选题师、文案师、审核师 |
| 客服系统 | 路由 Agent、FAQ Agent、人工 Agent |
| 代码 Review | 需求分析 Agent、代码审查 Agent、建议生成 Agent |

---

## 三、Multi-Agent 的核心架构模式

### 模式 1：ReAct（Reasoning + Acting）

**核心思想：** "推理-行动"循环

```
Thought（思考）：我需要做什么？
Action（行动）：调用工具获取信息
Observation（观察）：得到了什么结果？
Thought（再思考）：下一步做什么？
... 循环直到完成任务
```

**示例：用户问"今天北京天气怎么样？"**

```
Thought: 我需要获取北京的实时天气信息
Action: 调用天气API，参数：city="北京"
Observation: {"temp": 15, "weather": "晴"}
Thought: 我已经得到了天气信息，可以回答了
Answer: 今天北京15度，晴天
```

| 优点 | 缺点 |
|------|------|
| 灵活性高 | Token 消耗大 |
| 可解释性强（能看到推理过程） | 可能陷入循环 |
| 适合多步推理 | 不适合复杂长任务 |

**典型框架：** LangChain 的 ReAct Agent

---

### 模式 2：Plan-Execute（规划-执行分离）

**核心思想：** 先一次性规划所有步骤，再逐步执行

```
Plan（规划）：LLM 一次性生成完整计划
Execute（执行）：按计划逐步执行
Replan（可选）：遇到问题时重新规划
```

**示例：分析华为和小米的竞争态势**

```
Plan 阶段：
- 步骤1：搜索华为最新财报
- 步骤2：搜索小米最新财报
- 步骤3：对比两家的营收、市场份额
- 步骤4：分析竞争优劣势
- 步骤5：生成报告

Execute 阶段：逐步执行
```

| 优点 | 缺点 |
|------|------|
| Token 消耗少 | 灵活性较差 |
| 执行可控性强 | 规划可能不准确 |
| 适合复杂长任务 | 难以处理突发情况 |

**典型框架：** LangGraph、AutoGPT

---

### 模式 3：Hierarchical（层级式）

**核心思想：** 主 Agent 分配任务，子 Agent 执行

```
        ┌──────────────┐
        │  主Agent      │
        │ (任务协调者)  │
        └───────┬──────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐
│子Agent1│ │子Agent2│ │子Agent3│
│ (搜索) │ │ (分析) │ │ (写作) │
└────────┘ └────────┘ └────────┘
```

| 优点 | 缺点 |
|------|------|
| 分工明确 | 主 Agent 规划能力要求高 |
| 可并行执行 | Agent 间通信成本高 |
| 易于管理 | |

**典型框架：** CrewAI、MetaGPT

---

### 模式 4：Collaborative（协作式）

**核心思想：** 多个 Agent 平等协作，互相讨论

```
Agent1 提出初步方案
  → Agent2 评估并提出修改意见
    → Agent3 补充遗漏信息
      → 多轮讨论后达成一致
```

| 优点 | 缺点 |
|------|------|
| 输出质量高 | Token 消耗巨大 |
| 考虑更全面 | 可能陷入无限讨论 |

**典型框架：** AutoGen、ChatDev

---

## 四、架构模式对比与选择

| 模式 | Token 消耗 | 灵活性 | 可控性 | 适用场景 |
|------|-----------|--------|--------|----------|
| ReAct | 高 | 高 | 中 | 多步推理、工具调用 |
| Plan-Execute | 中 | 中 | 高 | 复杂长任务、流程固定 |
| Hierarchical | 中 | 中 | 高 | 专业化分工、并行执行 |
| Collaborative | 极高 | 高 | 低 | 复杂决策、多角度评估 |

**选择建议：**
- 简单工具调用 → ReAct
- 复杂业务流程 → Plan-Execute 或 Hierarchical
- 需要专业分工 → Hierarchical
- 需要多轮讨论 → Collaborative

---

## 五、主流框架对比

| 框架 | 定位 | 优势 | 劣势 | 适合场景 |
|------|------|------|------|----------|
| LangChain/LangGraph | 通用 Agent 框架 | 生态成熟，最灵活 | 学习曲线陡 | 复杂流程定制 |
| CrewAI | 角色驱动框架 | 上手简单，概念清晰 | 灵活性不如 LangChain | 快速开发、角色分工 |
| AutoGen | 对话式框架（微软） | 支持人机协作 | 生产级功能不足 | 研究、原型 |
| MetaGPT | 模拟软件公司 | 适合代码生成 | 通用性差 | 软件开发 |

**选择决策树：**

```
需要快速开发？     → CrewAI
需要极致灵活性？   → LangChain/LangGraph
是代码生成场景？   → MetaGPT
需要人机协作？     → AutoGen
其他              → CrewAI 或 LangGraph
```

---

## 六、国产化适配实战

### 1. 主流国产模型对接

**文心一言（百度）**

```python
import qianfan

chat = qianfan.ChatCompletion()
response = chat.do(
    model="ERNIE-4.0-8K",
    messages=[{"role": "user", "content": "你好"}]
)
```

**通义千问（阿里）**

```python
from dashscope import Generation

response = Generation.call(
    model="qwen-max",
    messages=[{'role': 'user', 'content': '你好'}]
)
```

**智谱 AI（清华）**

```python
from zhipuai import ZhipuAI

client = ZhipuAI(api_key="your_api_key")
response = client.chat.completions.create(
    model="glm-4",
    messages=[{"role": "user", "content": "你好"}]
)
```

---

### 2. 让框架支持国产模型

以 LangChain 为例：

```python
from langchain.chat_models.base import BaseChatModel
from langchain.schema import AIMessage

class WenxinChatModel(BaseChatModel):
    """文心一言适配器"""

    def _generate(self, messages, stop=None):
        qianfan_messages = self._convert_messages(messages)
        response = qianfan.ChatCompletion().do(
            model="ERNIE-4.0-8K",
            messages=qianfan_messages
        )
        return AIMessage(content=response['result'])

    def _convert_messages(self, messages):
        # 格式转换逻辑
        pass
```

关键点：继承框架基类、实现必要接口、做好格式转换、处理异常。

---

## 七、第一个实战：实现一个 ReAct Agent

```python
from langchain.agents import initialize_agent, AgentType
from langchain.tools import Tool
from langchain.chat_models import ChatOpenAI

# 1. 定义工具
def search_tool(query: str) -> str:
    """搜索工具"""
    return f"搜索'{query}'的结果：今天北京天气晴朗，15度"

search = Tool(
    name="Search",
    func=search_tool,
    description="用于搜索实时信息。输入应该是搜索关键词。"
)

# 2. 初始化 LLM
llm = ChatOpenAI(temperature=0, model="gpt-4")

# 3. 创建 Agent
agent = initialize_agent(
    tools=[search],
    llm=llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True
)

# 4. 运行
result = agent.run("今天北京天气怎么样？")
print(result)
```

运行输出：

```
> Entering new AgentExecutor chain...

Thought: 我需要获取北京的实时天气信息
Action: Search
Action Input: "北京今天天气"
Observation: 搜索'北京今天天气'的结果：今天北京天气晴朗，15度
Thought: 我现在知道答案了
Final Answer: 今天北京天气晴朗，温度15度。

> Finished chain.
```

---

## 八、常见坑点与解决方案

### 坑点 1：Agent 陷入死循环

```
Thought: 我需要搜索
Action: Search
Observation: ...
Thought: 我需要再搜索
...（无限循环）
```

**解决：**

```python
agent = initialize_agent(
    tools=[search],
    llm=llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    max_iterations=5,                # 限制最大迭代次数
    early_stopping_method="generate" # 超时后强制生成答案
)
```

### 坑点 2：工具调用失败

**解决：** 工具函数内做好异常处理，返回友好错误信息。

```python
def search_tool(query: str) -> str:
    try:
        result = real_search(query)
        return result
    except Exception as e:
        return f"搜索失败，错误信息：{str(e)}。请尝试换个关键词。"
```

### 坑点 3：输出格式不稳定

**解决：** 用结构化输出或在 Prompt 中明确要求格式。

```python
from langchain.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field

class Answer(BaseModel):
    thought: str = Field(description="思考过程")
    answer: str = Field(description="最终答案")

parser = PydanticOutputParser(pydantic_object=Answer)
```

---

## 九、面试高频题

### Q1：Agent 和普通 GPT 调用的区别？

| 维度 | 普通 GPT 调用 | Agent |
|------|--------------|-------|
| 任务 | 单轮问答 | 多步骤任务 |
| 工具 | 无 | 可调用外部工具 |
| 规划 | 无 | 自主规划 |
| 记忆 | 仅当前对话 | 长短期记忆 |
| 迭代 | 一次生成 | 多轮迭代 |

### Q2：Multi-Agent 的四种架构模式？

- **ReAct**：思考-行动循环，灵活但 Token 消耗大
- **Plan-Execute**：先规划再执行，可控但不够灵活
- **Hierarchical**：主 Agent 分配子 Agent 执行，分工明确
- **Collaborative**：平等讨论，质量高但成本高

### Q3：CrewAI 和 LangChain 怎么选？

- CrewAI：快速开发、角色分工明确
- LangChain：复杂流程、需要灵活定制

### Q4：Agent 死循环怎么解决？

限制最大迭代次数（max_iterations），设置 early_stopping_method。

### Q5：怎么让框架支持国产模型？

继承框架基类，实现必要接口，做好消息格式转换。

---

## 十、练习题

### 练习 1：概念理解

1. Agent 和普通 GPT 调用的 3 个核心区别？
2. 什么场景下需要 Multi-Agent 而不是单 Agent？
3. ReAct 和 Plan-Execute 的适用场景有何不同？

### 练习 2：架构设计

设计一个"简历筛选系统"的 Multi-Agent 架构：
1. 需要哪几个 Agent？
2. 每个 Agent 负责什么？
3. Agent 之间如何协作？
4. 画出架构图

### 练习 3：代码实战

基于本讲的 ReAct Agent 示例，改造成：
1. 增加一个"计算器工具"
2. 能回答"100 * 50 + 300 是多少？"
3. 显示完整推理过程

---

## 下一讲预告

**第 2 讲：角色分工与任务编排实战（CrewAI 深度实战）**

- 如何设计 Agent 的角色（Role）
- 如何定义任务（Task）
- 如何编排执行流程
- 实战项目：研报自动生成系统
