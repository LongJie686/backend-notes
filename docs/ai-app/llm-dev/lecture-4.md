# 第4讲：Agent 编排与工具调用

> 阶段目标：能设计并实现多步推理、工具调用的智能体系统。

## 学习目标

- 理解 Agent 核心概念与 ReAct 范式
- 掌握 Function Calling 机制
- 能用 LangChain / LangGraph 编排 Agent
- 理解多 Agent 架构设计

## 核心内容

### Agent 核心概念

**Agent 和普通对话的区别：**
- 普通对话：输入 -> 输出，单轮完成
- Agent：感知 -> 推理 -> 行动 -> 观察，多轮循环

**Agent 核心组件：**
- **感知（Perception）**：接收用户输入、工具返回、环境状态
- **推理（Reasoning）**：LLM 分析当前状态，决定下一步
- **行动（Action）**：调用工具或返回最终答案
- **记忆（Memory）**：保存历史交互和中间状态

### ReAct 范式

ReAct = Reasoning + Acting，核心循环：

```
while not done:
    1. Thought: LLM 分析当前状态，推理下一步
    2. Action: 选择并执行一个工具
    3. Observation: 获取工具执行结果
    4. 将 Observation 加入上下文，回到第1步
```

**为什么 ReAct 有效：**
- 推理和行动交替进行，避免盲目行动
- 每一步都有明确的理由
- 出错了可以自我修正

### Function Calling / Tool Use

**底层原理：**
1. 在请求中定义可用工具（名称、描述、参数 Schema）
2. 模型根据用户意图决定是否调用工具
3. 如果调用，返回工具名称和参数
4. 应用层执行工具，将结果返回给模型
5. 模型基于工具结果生成最终回答

**工具定义示例：**

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "搜索互联网获取最新信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词"
                    }
                },
                "required": ["query"]
            }
        }
    }
]
```

**调用流程：**

```python
# 第1步：发送请求（带工具定义）
response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools
)

# 第2步：检查是否需要调用工具
if response.choices[0].message.tool_calls:
    tool_call = response.choices[0].message.tool_calls[0]
    # 第3步：执行工具
    result = execute_tool(tool_call.function.name, tool_call.function.arguments)
    # 第4步：将结果返回给模型
    messages.append(response.choices[0].message)
    messages.append({"role": "tool", "content": result, "tool_call_id": tool_call.id})
    # 第5步：获取最终回答
    final = client.chat.completions.create(model="gpt-4o", messages=messages, tools=tools)
```

### LangChain Agent

**核心概念：**

```python
from langchain.agents import create_react_agent
from langchain.tools import Tool
from langchain_openai import ChatOpenAI

# 定义工具
tools = [
    Tool(name="Search", func=search_func, description="搜索网页"),
    Tool(name="Calculator", func=calc_func, description="数学计算"),
]

# 创建 Agent
llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(llm, tools, prompt_template)

# 执行
agent_executor = AgentExecutor(agent=agent, tools=tools, max_iterations=5)
result = agent_executor.invoke({"input": "今天北京天气怎么样？"})
```

### LangGraph 工作流编排

LangGraph 用状态图（State Graph）编排复杂工作流：

```python
from langgraph.graph import StateGraph, END

# 定义节点
def research(state): ...
def write(state): ...
def review(state): ...

# 构建图
graph = StateGraph(AgentState)
graph.add_node("researcher", research)
graph.add_node("writer", write)
graph.add_node("reviewer", review)

graph.add_edge("researcher", "writer")
graph.add_edge("writer", "reviewer")
graph.add_conditional_edges("reviewer", should_revise, {
    True: "writer",
    False: END
})

app = graph.compile()
```

### 多 Agent 架构

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| 主从模式 | 一个主 Agent 分配任务 | 任务明确、流程固定 |
| 讨论模式 | 多个 Agent 讨论协商 | 需要多角度分析 |
| 分工模式 | 每个 Agent 独立负责一块 | 任务可并行拆分 |
| 流水线模式 | 按顺序依次处理 | 有明确前后依赖 |

### Agent 记忆系统

| 类型 | 实现 | 说明 |
|------|------|------|
| 短期记忆 | 对话历史 | 当前会话上下文 |
| 长期记忆 | 向量数据库 | 跨会话知识 |
| 工作记忆 | 结构化状态 | 当前任务进度 |

### Agent 可控性与护栏

**常见问题：**
- 循环不收敛：设置最大步数（如 5-10 步）
- 工具调用错误：加入参数验证
- 幻觉放大：关键结果做事实核查
- 成本失控：设置 Token 上限

**护栏设计：**

```
输入 -> 内容审核 -> 意图识别 -> Agent执行 -> 输出审核 -> 响应
```

## 重点认知

1. **Agent 的智能不等于模型智能**，更多是工程设计
2. **工具描述的清晰度直接决定 Agent 的效果**
3. **一定要设最大步数限制**，防止无限循环
4. **Agent 适合有明确目标和工具的场景**，不是万能的

## 实战建议

1. 实现一个带工具调用的 Agent：搜索网页、查询数据库、执行代码
2. 用 LangGraph 实现多步工作流
3. 实现错误处理和兜底策略
4. 构建多 Agent 协作系统（研究员 + 写作 + 审核）

## 常见问题

**Q: Agent 和普通对话的本质区别是什么？**
A: Agent 能自主调用外部工具、多步推理、自我修正，普通对话只是输入到输出的单轮映射。

**Q: Function Calling 的底层原理是什么？**
A: 模型在训练时学会了理解工具描述，根据用户意图输出结构化的工具调用请求，应用层负责实际执行。

**Q: Agent 为什么容易陷入循环？**
A: 工具描述不清晰导致重复调用同一工具、推理步骤没有收敛条件、错误没有正确反馈。

## 小结

本讲学习了 Agent 的核心概念：ReAct 范式提供推理+行动循环，Function Calling 实现工具调用，LangChain/LangGraph 提供编排框架，多 Agent 架构支持复杂协作。下一讲进入多轮对话实战。
