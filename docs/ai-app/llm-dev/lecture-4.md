# 第四讲：Agent 编排与工具调用

> 阶段目标：掌握 Agent 核心概念和工具调用机制，能够设计多 Agent 协作系统

## 学习目标

1. 理解 Agent 的核心概念和工作原理
2. 掌握 Function Calling / Tool Use 的实现方式
3. 熟悉 ReAct 范式及其实现
4. 学会使用 LangChain / LangGraph 构建 Agent
5. 了解多 Agent 架构设计模式
6. 掌握 Agent 记忆系统和可控性设计

## 核心内容

### Agent 核心概念

Agent 是能够自主感知环境、做出决策、执行动作的智能体。与简单的 Prompt-Response 模式不同，Agent 具有目标导向、工具使用和迭代推理的能力。

#### 核心组件

```
Agent = LLM + 工具 + 记忆 + 规划

LLM     -- 大脑，负责理解和决策
工具     -- 手脚，执行具体操作
记忆     -- 经验，保留历史信息
规划     -- 策略，分解任务步骤
```

#### Agent 与普通调用的区别

| 特性 | 普通调用 | Agent |
|------|----------|-------|
| 交互模式 | 单轮问答 | 多轮迭代 |
| 工具使用 | 无 | 可调用外部工具 |
| 决策能力 | 无 | 自主决策下一步 |
| 状态管理 | 无 | 维护内部状态 |
| 终止条件 | 生成完成 | 达成目标或触发停止条件 |

#### Agent 循环

```
1. 感知：接收用户输入或环境变化
2. 思考：LLM 分析当前状态，决定下一步行动
3. 行动：调用工具执行操作
4. 观察：获取工具返回的结果
5. 判断：是否达成目标？
   - 是：输出最终结果
   - 否：回到步骤2继续迭代
```

### Function Calling / Tool Use

Function Calling 是让大模型能够调用外部函数的机制，是 Agent 的基础设施。

#### 工作流程

1. 开发者定义可用的函数列表和参数格式
2. 用户发送请求
3. 模型判断是否需要调用函数，如果需要则返回函数调用指令
4. 开发者执行函数并将结果返回给模型
5. 模型基于函数结果生成最终回答

#### OpenAI Function Calling

```python
from openai import OpenAI

client = OpenAI()

# 定义工具
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "温度单位"
                    }
                },
                "required": ["city"]
            }
        }
    }
]

# 调用
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
    tools=tools
)

# 处理函数调用
message = response.choices[0].message
if message.tool_calls:
    for tool_call in message.tool_calls:
        function_name = tool_call.function.name
        function_args = json.loads(tool_call.function.arguments)

        # 执行对应函数
        if function_name == "get_weather":
            result = get_weather(**function_args)

        # 将结果返回给模型
        messages = [
            {"role": "user", "content": "北京今天天气怎么样？"},
            message,
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": str(result)
            }
        ]

        final_response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=tools
        )
```

#### 工具设计原则

1. **描述要清晰**：模型的函数选择依赖描述，模糊的描述导致错误调用
2. **参数要明确**：类型、枚举值、必填项都要清楚定义
3. **功能要单一**：每个工具只做一件事，方便模型选择
4. **错误处理要友好**：工具执行失败时返回有意义的错误信息

### ReAct 范式

ReAct（Reasoning + Acting）是 Agent 最常用的推理框架。

#### 核心思想

将推理（Reasoning）和行动（Acting）交织进行，每一步都有明确的思考和行动。

#### 实现示例

```python
class ReActAgent:
    def __init__(self, llm, tools):
        self.llm = llm
        self.tools = {tool.name: tool for tool in tools}
        self.max_iterations = 10

    def run(self, query):
        prompt = self._build_prompt(query)

        for i in range(self.max_iterations):
            response = self.llm.generate(prompt)
            action = self._parse_action(response)

            if action is None:
                # 没有行动指令，输出最终答案
                return response

            if action["type"] == "finish":
                return action["answer"]

            if action["type"] == "tool":
                tool_name = action["name"]
                tool_args = action["args"]

                if tool_name in self.tools:
                    observation = self.tools[tool_name].run(**tool_args)
                else:
                    observation = f"错误：工具 {tool_name} 不存在"

                # 将观察结果追加到上下文
                prompt += f"\n观察：{observation}"

        return "达到最大迭代次数，任务未完成。"

    def _build_prompt(self, query):
        tool_descriptions = "\n".join([
            f"- {name}: {tool.description}"
            for name, tool in self.tools.items()
        ])
        return f"""你可以使用以下工具：
{tool_descriptions}

请按以下格式思考和行动：
思考：[分析当前情况]
行动：[工具名称(参数)]
观察：[工具返回的结果]
...（重复直到得出答案）
回答：[最终答案]

问题：{query}
思考："""
```

#### ReAct 的局限

- Token 消耗较大（每步都要输出思考过程）
- 可能陷入循环（反复调用相同工具）
- 对复杂任务规划能力有限

### LangChain / LangGraph

#### LangChain Agent

```python
from langchain.agents import create_openai_tools_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI
from langchain.tools import tool

# 定义工具
@tool
def search_database(query: str) -> str:
    """搜索数据库获取信息"""
    # 实际的数据库搜索逻辑
    return f"搜索结果：{query} 的相关信息"

@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    try:
        return str(eval(expression))
    except Exception as e:
        return f"计算错误：{e}"

# 创建 Agent
llm = ChatOpenAI(model="gpt-4o")
tools = [search_database, calculate]

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个有用的助手，可以使用工具来帮助用户。"),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])

agent = create_openai_tools_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 运行
result = agent_executor.invoke({"input": "数据库里有什么关于Python的信息？"})
```

#### LangGraph 状态图

LangGraph 提供了更灵活的 Agent 编排能力，支持复杂的状态管理。

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    next_action: str

def think(state: AgentState) -> AgentState:
    """思考节点"""
    response = llm.invoke(state["messages"])
    return {"messages": [response], "next_action": parse_action(response)}

def act(state: AgentState) -> AgentState:
    """行动节点"""
    action = state["next_action"]
    result = execute_tool(action)
    return {"messages": [result]}

def should_continue(state: AgentState) -> str:
    """判断是否继续"""
    if state["next_action"] == "finish":
        return "end"
    return "continue"

# 构建图
workflow = StateGraph(AgentState)
workflow.add_node("think", think)
workflow.add_node("act", act)

workflow.add_conditional_edges(
    "think",
    should_continue,
    {"continue": "act", "end": END}
)
workflow.add_edge("act", "think")
workflow.set_entry_point("think")

app = workflow.compile()
```

LangGraph 的优势：
- 可视化工作流程
- 支持条件分支和循环
- 内置状态持久化
- 支持人工介入（Human-in-the-loop）

### 多 Agent 架构

当单个 Agent 难以处理复杂任务时，可以使用多个 Agent 协作。

#### 常见模式

**主管-工人模式（Supervisor-Worker）**

```
用户 --> 主管Agent --> 分配任务给工人Agent
                      |       |       |
                      v       v       v
                    Agent1  Agent2  Agent3
                      |       |       |
                      v       v       v
                    结果汇总 --> 主管Agent --> 最终回答
```

适用场景：任务可以明确分解为独立子任务。

**流水线模式（Pipeline）**

```
用户 --> Agent1 --> Agent2 --> Agent3 --> 最终回答
         信息收集   内容分析   报告生成
```

适用场景：任务有明确的处理顺序，前一步的输出是后一步的输入。

**辩论模式（Debate）**

```
用户 --> 正方Agent --> 论点
                |
                v
用户 --> 反方Agent --> 论点
                |
                v
用户 --> 评委Agent --> 综合结论
```

适用场景：需要多角度分析、减少偏见的场景。

#### 多 Agent 通信

```python
# 简单的消息传递
class MessageBus:
    def __init__(self):
        self.messages = []

    def send(self, sender, receiver, content):
        self.messages.append({
            "from": sender,
            "to": receiver,
            "content": content
        })

    def receive(self, receiver):
        return [m for m in self.messages if m["to"] == receiver]
```

### Agent 记忆系统

#### 记忆类型

| 类型 | 说明 | 实现方式 |
|------|------|----------|
| 短期记忆 | 当前对话的上下文 | 对话历史列表 |
| 长期记忆 | 跨会话的用户偏好/知识 | 向量数据库/关系数据库 |
| 工作记忆 | 当前任务的中间结果 | 状态字典/Scratchpad |

#### 实现示例

```python
class AgentMemory:
    def __init__(self):
        self.short_term = []      # 当前对话历史
        self.working = {}         # 任务中间状态
        self.long_term = VectorStore()  # 长期记忆

    def add_message(self, role, content):
        self.short_term.append({"role": role, "content": content})

    def save_fact(self, fact):
        self.long_term.add(fact)

    def recall(self, query, top_k=3):
        return self.long_term.search(query, top_k)

    def get_context(self, max_tokens=4000):
        """获取压缩后的上下文"""
        # 如果超出限制，压缩早期的对话
        if self.estimate_tokens() > max_tokens:
            return self.compress()
        return self.short_term
```

### Agent 可控性与护栏

#### 为什么需要护栏

Agent 有自主行动能力，如果不加限制可能导致：
- 执行危险操作（如删除数据）
- 陷入无限循环
- 泄露敏感信息
- 产生有害内容

#### 护栏设计

**输入护栏**

```python
def input_guardrail(user_input):
    # 检测恶意指令
    dangerous_patterns = ["删除", "DROP TABLE", "rm -rf", "格式化"]
    for pattern in dangerous_patterns:
        if pattern in user_input:
            return False, "检测到危险操作，已拦截。"
    return True, None
```

**输出护栏**

```python
def output_guardrail(agent_response):
    # 检查是否包含敏感信息
    sensitive_patterns = [r"\d{17}[\dXx]",  # 身份证号
                         r"\d{16,19}",       # 银行卡号
                         r"password\s*[:=]"]  # 密码
    for pattern in sensitive_patterns:
        if re.search(pattern, agent_response):
            return False, "输出包含敏感信息，已过滤。"
    return True, None
```

**行为护栏**

```python
# 限制 Agent 的最大迭代次数
MAX_ITERATIONS = 10

# 限制可调用的工具范围
ALLOWED_TOOLS = ["search", "calculate", "lookup"]

# 限制单次操作的影响范围
def validate_action(action):
    if action.tool not in ALLOWED_TOOLS:
        raise PermissionError(f"工具 {action.tool} 不在允许列表中")
    if action.is_destructive():
        raise PermissionError("不允许执行破坏性操作")
```

## 重点认知

1. **Agent 不是万能的**：简单任务用普通调用就够了，不要过度设计
2. **工具定义是关键**：好的工具定义让模型更容易正确使用
3. **可控性是底线**：Agent 必须有明确的边界和停止条件
4. **调试 Agent 很难**：建议实现详细的日志系统，记录每一步的思考和行动
5. **成本需要监控**：Agent 的多轮迭代可能产生大量 Token 消耗

## 实战建议

1. 从单工具 Agent 开始，逐步增加工具数量
2. 实现完善的日志系统，记录 Agent 的完整决策过程
3. 设置合理的迭代上限（通常 5-10 次）
4. 对工具的输入输出做严格的校验
5. 实现人工介入机制，关键操作前请求人工确认

## 常见问题

**Q：Agent 总是选错工具怎么办？**

A：首先检查工具描述是否足够清晰。如果描述没问题，可以在 Prompt 中增加工具选择指南，或者用 Few-shot 示范正确的工具选择。极端情况下可以用分类模型先判断意图，再选择工具子集。

**Q：如何处理 Agent 的超时问题？**

A：设置全局超时和单步超时。全局超时控制整个任务的最长执行时间，单步超时控制每次工具调用的最长等待时间。超时后返回友好的错误信息，而不是让用户一直等待。

**Q：LangChain 和 LangGraph 怎么选？**

A：简单的线性工作流用 LangChain Agent 即可。需要复杂的状态管理、条件分支、人工介入或持久化时，选择 LangGraph。

## 小结

本讲系统学习了 Agent 的核心概念和实现技术：从 Function Calling 到 ReAct 范式，从 LangChain 到 LangGraph，从单 Agent 到多 Agent 架构。Agent 是大模型应用的前沿方向，但也带来了更大的复杂性和可控性挑战。下一讲将进入多轮对话和情感机器人项目，将前面学到的知识综合运用到实际项目中。
