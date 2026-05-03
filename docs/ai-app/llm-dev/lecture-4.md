# 第 4 讲：Agent 智能体与工具调用

---

## 一、从 RAG 到 Agent：为什么需要 Agent？

---

### 场景 1：RAG 解决不了的复杂任务

**用户问题：** "帮我查一下上个月销售额超过 10 万的客户，然后给他们发一封感谢邮件的草稿。"

**RAG 系统的局限：**
- 能检索到"销售政策文档"
- 但无法直接**查询数据库**
- 更无法**生成邮件**并**调用邮件系统发送**

**Agent 的解决方式：**
1. 理解任务 -> 需要查数据库
2. 调用 SQL 工具 -> 查询客户列表
3. 拿到结果 -> 分析哪些客户超过 10 万
4. 调用写作工具 -> 生成邮件草稿
5. 返回给用户 -> 包含客户列表 + 邮件草稿

---

### 场景 2：多步骤推理

**用户问题：** "北京明天天气怎么样？我要穿羽绒服吗？"

**简单问答：**
- 回答天气 -> 用户自己判断穿衣
- 缺乏**推理链条**

**Agent 的解决方式：**
1. 推理：用户问的是天气 + 穿衣建议
2. 行动：调用天气 API 查询北京明天天气
3. 观察：天气是 -5C，有雪
4. 推理：-5C 有雪 -> 需要穿羽绒服
5. 回答：给出穿衣建议

---

### 场景 3：与外部世界交互

**核心认知：**

```
+-----------------------------------------------------------+
|                    能力对比                                |
+-----------------------------------------------------------+
|                                                            |
|  纯 LLM                    RAG                    Agent   |
|                                                            |
|  只有训练知识              能读文档               能动手   |
|  静态                      静态+检索              动态交互 |
|  不会查数据库              不会查数据库           会查数据库|
|  不会调用 API              不会调用 API           会调用 API|
|  不会算数学                不会算数学             会调用计算器|
|                                                            |
+-----------------------------------------------------------+
```

**Agent = LLM（大脑）+ 工具（手脚）+ 记忆（经验）**

---

## 二、Agent 的本质是什么？

---

### 1. Agent 的定义

**Agent（智能体）是一个能够：**
- **感知**环境（接收用户输入、工具返回结果）
- **推理**（思考下一步该做什么）
- **行动**（调用工具、执行操作）
- **记忆**（记住之前的交互）

的自主系统。

---

### 2. Agent 与普通对话的核心区别

| 维度 | 普通对话 | Agent |
|------|---------|-------|
| 交互方式 | 一问一答 | 多轮自主决策 |
| 信息来源 | 训练数据/RAG | 训练数据 + 实时工具调用 |
| 执行能力 | 只能生成文本 | 可以调用外部工具 |
| 推理深度 | 单步 | 多步规划 |
| 状态管理 | 无状态/简单历史 | 复杂的任务状态机 |

---

### 3. Agent 的核心组件

```
+-----------------------------------------------------------+
|                    Agent 架构图                            |
+-----------------------------------------------------------+
|                                                            |
|  +-------------+      +-------------+      +---------+    |
|  |   用户输入   |----->|    LLM      |<----|  记忆    |    |
|  +-------------+      +------+------+      +---------+    |
|                              |                             |
|                         +----+----+                        |
|                         | 推理/规划 |                      |
|                         +----+----+                        |
|                              |                             |
|              +---------------+---------------+             |
|              v               v               v             |
|        +---------+     +---------+     +---------+        |
|        | 工具调用 |     | 直接回答 |     | 请求澄清 |        |
|        +----+----+     +---------+     +---------+        |
|             |                                             |
|             v                                             |
|        +---------+                                        |
|        | 工具执行 |---> 返回结果 ---> LLM（再次推理）       |
|        +---------+                                        |
|                                                            |
+-----------------------------------------------------------+
```

---

## 三、ReAct 范式：推理 + 行动

---

### 1. 什么是 ReAct？

**ReAct = Reasoning（推理）+ Acting（行动）**

核心思想：**让模型把"思考过程"和"工具调用"交替进行，每步都明确写出来。**

**为什么有效？**

因为：
- 模型是逐 Token 生成的
- 如果直接调用工具，中间推理步骤"丢失"了
- 显式写出推理过程，模型能更好地规划多步任务

---

### 2. ReAct 的工作流程

```
用户问题：2024年诺贝尔文学奖得主是谁？他/她写了哪些书？

Step 1（思考）：
用户问的是 2024 年诺贝尔文学奖得主。我的知识截止到训练数据，
可能不包含最新信息。我需要搜索互联网。

Step 1（行动）：
Action: search
Action Input: "2024年诺贝尔文学奖得主"

Step 1（观察）：
Observation: 2024年诺贝尔文学奖授予韩国作家韩江（Han Kang），
表彰其"以强烈的诗意散文直面历史创伤，揭示人类生命的脆弱"。

Step 2（思考）：
我已经知道了得主是韩江。用户还问她写了哪些书。我需要再搜索她的作品。

Step 2（行动）：
Action: search
Action Input: "韩江 代表作品 书籍"

Step 2（观察）：
Observation: 韩江代表作包括《素食者》《少年来了》《白》《不做告别》等。
其中《素食者》获得 2016 年国际布克奖。

Step 3（思考）：
我已经收集到了足够的信息，可以直接回答用户了。

Step 3（行动）：
Action: finish
Action Input: 2024年诺贝尔文学奖得主是韩国作家韩江。
她的代表作品包括《素食者》《少年来了》《白》《不做告别》等。
```

---

### 3. ReAct 的 Prompt 结构

```python
REACT_PROMPT = """你是一个智能助手，可以使用工具解决复杂问题。

你有以下工具可以使用：
{tools}

请使用以下格式思考并解决问题：

Question: 用户的问题
Thought: 你的思考过程，分析当前情况，决定下一步行动
Action: 工具名称（必须是上面列出的工具之一）
Action Input: 传给工具的参数
Observation: 工具返回的结果

...（这个 Thought/Action/Action Input/Observation 过程可以重复多次）

当收集到足够信息时：
Thought: 我已经知道答案了
Final Answer: 对用户的最终回答

开始！

Question: {question}
Thought:"""
```

---

### 4. ReAct 的代码实现（手写版）

```python
import re

class Tool:
    """工具定义"""
    def __init__(self, name: str, description: str, func: Callable):
        self.name = name
        self.description = description
        self.func = func

    def run(self, input_str: str) -> str:
        try:
            return str(self.func(input_str))
        except Exception as e:
            return f"工具执行错误: {str(e)}"


class ReActAgent:
    """手写版 ReAct Agent -- 核心循环"""
    def __init__(self, llm, tools: List[Tool], max_iterations: int = 5):
        self.llm = llm
        self.tools = {t.name: t for t in tools}
        self.max_iterations = max_iterations

    def run(self, question: str) -> str:
        # 构建初始 Prompt（工具描述 + 格式说明）
        tool_desc = "\n".join([f"- {n}: {t.description}" for n, t in self.tools.items()])
        prompt = f"""可用工具：\n{tool_desc}\n\n格式：\nThought → Action → Action Input → Observation\n最终：Final Answer\n\nQuestion: {question}\nThought:"""
        history = ""

        for _ in range(self.max_iterations):
            response = self.llm.predict(prompt + history)
            history += response

            # 正则解析：Final Answer → 直接返回；Action → 执行工具 → 追加 Observation
            if m := re.search(r"Final Answer:\s*(.*)", response, re.DOTALL):
                return m.group(1).strip()

            action_m = re.search(r"Action:\s*(.*?)\n", response)
            input_m = re.search(r"Action Input:\s*(.*?)(?:\n|$)", response, re.DOTALL)
            if action_m and input_m:
                name, args = action_m.group(1).strip(), input_m.group(1).strip()
                if name in self.tools:
                    history += f"\nObservation: {self.tools[name].run(args)}\nThought:"
                else:
                    history += f"\nObservation: 错误：没有名为 {name} 的工具\nThought:"
            else:
                history += "\nThought:"

        return "达到最大迭代次数，未能完成问题。"

# 工具示例
def search(query: str) -> str:  # 模拟搜索
    return {"2024年诺贝尔文学奖": "韩江"}.get(query, "未找到")

tools = [Tool("search", "搜索互联网信息", search),
         Tool("calculator", "数学计算", lambda expr: str(eval(expr)))]
# agent = ReActAgent(llm, tools)
# result = agent.run("2024年诺贝尔文学奖得主是谁？")
```

---

## 四、Function Calling：Agent 的底层机制

---

### 1. Function Calling 的本质

**Function Calling（工具调用）是大模型的一项原生能力：**

模型不是只生成文本，而是能**生成结构化的工具调用请求**。

**底层原理：**

```
用户问题 -> 模型判断是否需要工具
              |
              +-- 不需要 -> 直接生成文本
              |
              +-- 需要 -> 生成 JSON：
                        {
                          "name": "工具名",
                          "arguments": {
                            "参数1": "值1",
                            "参数2": "值2"
                          }
                        }

              <- 工具执行结果返回给模型
              <- 模型基于结果继续生成或再次调用工具
```

**关键认知：**

> 模型本身**不会执行**工具，它只是**生成调用指令**。真正执行工具的是你的代码。

---

### 2. OpenAI Function Calling 详解

```python
from openai import OpenAI
import json

client = OpenAI()

# 定义工具（函数）
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
                        "description": "城市名称，如北京、上海"
                    },
                    "date": {
                        "type": "string",
                        "description": "日期，格式 YYYY-MM-DD，默认为今天"
                    }
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_database",
            "description": "执行 SQL 查询公司数据库",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "完整的 SQL 语句"
                    }
                },
                "required": ["sql"]
            }
        }
    }
]

# 用户消息
messages = [
    {"role": "system", "content": "你是一个助手，可以帮助用户查询天气和公司数据。"},
    {"role": "user", "content": "北京明天天气怎么样？"}
]

# 第一次调用
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=tools,
    tool_choice="auto"  # auto 表示让模型自己决定
)

# 检查模型是否想要调用工具
if response.choices[0].message.tool_calls:
    tool_call = response.choices[0].message.tool_calls[0]
    function_name = tool_call.function.name
    arguments = json.loads(tool_call.function.arguments)

    print(f"模型想要调用: {function_name}")
    print(f"参数: {arguments}")

    # 执行工具
    if function_name == "get_weather":
        result = get_weather(**arguments)  # 你的实现

        # 把工具结果加回对话
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "name": function_name,
            "content": str(result)
        })

        # 第二次调用，让模型基于工具结果回答
        final_response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            tools=tools
        )

        print(final_response.choices[0].message.content)
```

---

### 3. 工具定义的工程规范

**一个好的工具定义 = 好的 Prompt。**

```python
# 差的工具定义
{
    "name": "search",
    "description": "搜索",
    "parameters": {
        "type": "object",
        "properties": {
            "q": {"type": "string"}
        }
    }
}

# 好的工具定义
{
    "name": "web_search",
    "description": """使用搜索引擎查找实时信息。
当用户询问以下内容时必须使用：
- 时事新闻、最新事件
- 名人信息、获奖情况
- 股价、天气、实时数据
- 任何可能随时间变化的信息
不要用于常识性问题或数学计算。""",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词，应该包含用户问题的核心实体和 2-5 个关键词"
            },
            "num_results": {
                "type": "integer",
                "description": "返回结果数量，1-10，默认 5",
                "default": 5
            }
        },
        "required": ["query"]
    }
}
```

**工具定义的关键原则：**

1. **description 要详细** -- 这是模型判断要不要调用的依据
2. **说明什么时候用、什么时候不用** -- 避免误调用
3. **参数描述要具体** -- 模型才能生成正确的参数
4. **枚举值要穷尽** -- 如果有固定取值范围，用 enum

---

### 4. 工具调用的状态管理

**多轮工具调用的消息格式：**

```python
messages = [
    # 系统消息
    {"role": "system", "content": "你是一个助手"},

    # 用户消息
    {"role": "user", "content": "查一下最近 7 天销售额前 3 的商品"},

    # 模型决定调用工具
    {"role": "assistant", "content": None, "tool_calls": [
        {
            "id": "call_123",
            "type": "function",
            "function": {"name": "query_database", "arguments": "{\"sql\": \"SELECT product_name, SUM(amount) as total FROM orders WHERE create_time > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY product_name ORDER BY total DESC LIMIT 3\"}"}
        }
    ]},

    # 工具执行结果
    {"role": "tool", "tool_call_id": "call_123", "name": "query_database", "content": "[{\"product_name\": \"iPhone 15\", \"total\": 500000}, {\"product_name\": \"MacBook Pro\", \"total\": 320000}, {\"product_name\": \"AirPods\", \"total\": 180000}]"},

    # 模型基于结果回答
    # （第二次 API 调用的返回）
]
```

---

## 五、Agent 记忆系统

Agent 必须能记住之前的交互，否则无法完成复杂任务。

---

### 1. 短期记忆：对话历史

```python
class ShortTermMemory:
    """短期记忆：保留最近 N 轮对话"""

    def __init__(self, max_messages: int = 10):
        self.messages = []
        self.max_messages = max_messages

    def add_user_message(self, content: str):
        self.messages.append({"role": "user", "content": content})
        self._trim()

    def add_assistant_message(self, content: str, tool_calls=None):
        msg = {"role": "assistant", "content": content}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        self.messages.append(msg)
        self._trim()

    def add_tool_result(self, tool_call_id: str, name: str, content: str):
        self.messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": name,
            "content": content
        })
        self._trim()

    def _trim(self):
        """保留最近的消息，但始终保留 system 消息"""
        if len(self.messages) > self.max_messages:
            system_msgs = [m for m in self.messages if m.get("role") == "system"]
            other_msgs = [m for m in self.messages if m.get("role") != "system"]
            other_msgs = other_msgs[-(self.max_messages - len(system_msgs)):]
            self.messages = system_msgs + other_msgs

    def get_messages(self) -> List[dict]:
        return self.messages.copy()
```

---

### 2. 长期记忆：向量存储

```python
from langchain.vectorstores import Chroma
from langchain.embeddings import OpenAIEmbeddings

class LongTermMemory:
    """长期记忆：存储重要的事实、偏好、摘要"""

    def __init__(self):
        self.embeddings = OpenAIEmbeddings()
        self.vectorstore = Chroma(
            collection_name="agent_memory",
            embedding_function=self.embeddings
        )

    def remember(self, key_fact: str, category: str = "general"):
        """记录一个事实"""
        self.vectorstore.add_texts(
            texts=[key_fact],
            metadatas=[{"category": category, "timestamp": datetime.now().isoformat()}]
        )

    def recall(self, query: str, k: int = 3) -> List[str]:
        """回忆相关事实"""
        results = self.vectorstore.similarity_search(query, k=k)
        return [doc.page_content for doc in results]

    def summarize_conversation(self, messages: List[dict]) -> str:
        """对话摘要，存入长期记忆"""
        conversation_text = "\n".join([
            f"{m['role']}: {m['content']}"
            for m in messages if m['content']
        ])
        summary = f"对话摘要：{conversation_text[:100]}..."
        self.remember(summary, category="conversation_summary")
        return summary
```

---

### 3. 记忆的整合使用

```python
class AgentWithMemory:
    """带记忆的 Agent"""

    def __init__(self, llm, tools, long_term_memory):
        self.llm = llm
        self.tools = tools
        self.short_term = ShortTermMemory(max_messages=20)
        self.long_term = long_term_memory

    def run(self, user_input: str) -> str:
        # 1. 检索长期记忆
        relevant_memories = self.long_term.recall(user_input, k=3)
        memory_context = "\n".join([
            f"- {m}" for m in relevant_memories
        ])

        # 2. 构建系统消息（注入记忆）
        system_msg = f"""你是一个助手。以下是你记得的关于用户的重要信息：
{memory_context}
请基于这些信息更好地服务用户。"""

        messages = [{"role": "system", "content": system_msg}]
        messages.extend(self.short_term.get_messages())
        messages.append({"role": "user", "content": user_input})

        # 3. 调用模型（可能涉及工具调用循环）
        # ... 工具调用逻辑 ...

        # 4. 保存到短期记忆
        self.short_term.add_user_message(user_input)
        # ... 保存助手回复 ...

        return assistant_response
```

---

## 六、LangChain Agent 实战

LangChain 封装了很多 Agent 范式，适合快速开发。

---

### 1. 基础 Agent

```python
from langchain.agents import Tool, AgentExecutor, create_react_agent
from langchain_openai import ChatOpenAI
from langchain import hub

# 定义工具
tools = [
    Tool(
        name="Search",
        func=lambda q: f"搜索'{q}'的结果：xxx",  # 实际接搜索 API
        description="用于搜索互联网上的实时信息"
    ),
    Tool(
        name="Calculator",
        func=lambda q: str(eval(q)),  # 实际要安全计算
        description="用于数学计算"
    )
]

# 加载 ReAct Prompt
prompt = hub.pull("hwchase17/react")

# 创建 Agent
llm = ChatOpenAI(model="gpt-4")
agent = create_react_agent(llm, tools, prompt)

# 执行器
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,  # 打印执行过程
    max_iterations=5,  # 最大迭代次数
    handle_parsing_errors=True  # 处理解析错误
)

# 运行
result = agent_executor.invoke({"input": "2024年诺贝尔物理学奖得主是谁？他获奖时的年龄是多少？"})
print(result["output"])
```

---

### 2. OpenAI Functions Agent（推荐）

如果模型支持 Function Calling（GPT-4、通义千问等），用这个更高效：

```python
from langchain.agents import create_openai_functions_agent, AgentExecutor
from langchain_openai import ChatOpenAI
from langchain.tools import StructuredTool
from pydantic import BaseModel, Field

# 定义带参数校验的工具
class WeatherInput(BaseModel):
    city: str = Field(description="城市名称")
    date: str = Field(description="日期，格式 YYYY-MM-DD")

def get_weather(city: str, date: str = "today") -> str:
    return f"{city} {date} 天气晴朗，25C"

weather_tool = StructuredTool.from_function(
    func=get_weather,
    name="get_weather",
    description="获取指定城市和日期的天气",
    args_schema=WeatherInput
)

# 创建 Agent
llm = ChatOpenAI(model="gpt-4")
tools = [weather_tool]

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个有用的助手。"),
    MessagesPlaceholder(variable_name="chat_history", optional=True),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad")
])

agent = create_openai_functions_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 运行
result = agent_executor.invoke({
    "input": "北京明天天气怎么样？适合穿什么？"
})
```

---

### 3. 自定义工具集成

```python
from langchain.tools import BaseTool
from typing import Type

class DatabaseQueryTool(BaseTool):
    """数据库查询工具"""
    name = "query_database"
    description = """执行 SQL 查询以获取业务数据。
只能执行 SELECT 查询，禁止执行 INSERT/UPDATE/DELETE/DROP。
查询前必须先确认表结构。"""

    def _run(self, sql: str) -> str:
        # 安全检查
        dangerous_keywords = ["insert", "update", "delete", "drop", "truncate"]
        if any(kw in sql.lower() for kw in dangerous_keywords):
            return "错误：禁止执行非 SELECT 操作"

        # 执行查询（实际接数据库）
        return f"查询结果：{sql} -> [模拟数据]"

    def _arun(self, sql: str):
        raise NotImplementedError("不支持异步")

class SendEmailTool(BaseTool):
    """发邮件工具"""
    name = "send_email"
    description = "发送邮件给指定收件人"

    def _run(self, to: str, subject: str, content: str) -> str:
        print(f"发送邮件至 {to}，主题：{subject}")
        return "邮件发送成功"

    def _arun(self, to: str, subject: str, content: str):
        raise NotImplementedError
```

---

## 七、LangGraph：复杂工作流编排

LangChain 的 Agent 是线性的，LangGraph 可以构建复杂的图结构。

---

### 1. 为什么需要 LangGraph？

**场景：**
- 需要条件分支（如果 A 失败，走 B）
- 需要循环（重试、反思）
- 需要并行执行多个工具
- 需要人工审核节点

**LangGraph 核心概念：**

```
Node（节点）：一个函数，做一件事
Edge（边）：连接节点，决定流转方向
State（状态）：在整个图中传递的数据
```

---

### 2. LangGraph 实战：带反思的 Agent

```python
from typing import TypedDict, Annotated, Sequence
import operator
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

# 定义状态
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]  # 消息历史
    next_step: str  # 下一步节点

# 定义工具
@tool
def search(query: str) -> str:
    """搜索互联网"""
    return f"搜索结果：关于 '{query}' 的信息是 xxx"

tools = [search]
tool_map = {t.name: t for t in tools}

# 定义节点
def agent_node(state: AgentState):
    """LLM 决策节点"""
    llm = ChatOpenAI(model="gpt-4").bind_tools(tools)
    messages = state["messages"]
    response = llm.invoke(messages)

    return {
        "messages": [response],
        "next_step": "tools" if response.tool_calls else "reflect"
    }

def tools_node(state: AgentState):
    """工具执行节点"""
    last_message = state["messages"][-1]
    tool_messages = []

    for tool_call in last_message.tool_calls:
        tool = tool_map[tool_call["name"]]
        result = tool.invoke(tool_call["args"])
        tool_messages.append(ToolMessage(
            content=result,
            tool_call_id=tool_call["id"]
        ))

    return {
        "messages": tool_messages,
        "next_step": "agent"
    }

def reflect_node(state: AgentState):
    """反思节点：检查答案质量"""
    messages = state["messages"]

    reflect_prompt = """你是一个质量控制专家。
请检查以下对话，判断助手的回答是否充分、准确。
如果回答不够好，请指出问题并给出改进建议。
如果回答已经很好，请输出 "PASS"。

对话：
{conversation}

评估："""

    conversation = "\n".join([f"{m.type}: {m.content}" for m in messages])
    llm = ChatOpenAI(model="gpt-4")
    result = llm.invoke(reflect_prompt.format(conversation=conversation))

    if "PASS" in result.content:
        return {"messages": [], "next_step": "end"}
    else:
        return {
            "messages": [HumanMessage(content=f"请改进你的回答。反思意见：{result.content}")],
            "next_step": "agent"
        }

# 构建图
workflow = StateGraph(AgentState)

# 添加节点
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tools_node)
workflow.add_node("reflect", reflect_node)

# 添加边
workflow.set_entry_point("agent")

# 条件边：根据 next_step 决定走向
workflow.add_conditional_edges(
    "agent",
    lambda state: state["next_step"],
    {
        "tools": "tools",
        "reflect": "reflect"
    }
)

workflow.add_edge("tools", "agent")
workflow.add_conditional_edges(
    "reflect",
    lambda state: state["next_step"],
    {
        "agent": "agent",
        "end": END
    }
)

# 编译
app = workflow.compile()

# 运行
inputs = {"messages": [HumanMessage(content="2024年诺贝尔文学奖得主是谁？")]}
result = app.invoke(inputs)
print(result["messages"][-1].content)
```

---

## 八、多 Agent 协作架构

---

### 1. 常见协作模式

```
+-----------------------------------------------------------+
|                  多 Agent 协作模式                         |
+-----------------------------------------------------------+
|                                                            |
|  模式 1：主从模式（Master-Worker）                         |
|                                                            |
|     +---------+                                            |
|     | Master  |-- 分配任务 --> Worker 1                     |
|     | Agent   |-- 分配任务 --> Worker 2                     |
|     |         |-- 分配任务 --> Worker 3                     |
|     +----+----+                                            |
|          |                                                 |
|          +---- 汇总结果 ---- 输出                           |
|                                                            |
|  模式 2：讨论模式（Discussion）                            |
|                                                            |
|     Agent A <----> Agent B <----> Agent C                  |
|       |                              |                     |
|       +---------- 达成共识 ----------+                     |
|                                                            |
|  模式 3：流水线模式（Pipeline）                            |
|                                                            |
|     输入 --> 研究员 Agent --> 写手 Agent --> 审核 Agent --> 输出
|                                                            |
|  模式 4：路由模式（Router）                                |
|                                                            |
|     输入 --> 路由 Agent --+-- 技术 Agent                   |
|                            +-- 销售 Agent                   |
|                            +-- 售后 Agent                   |
|                                                            |
+-----------------------------------------------------------+
```

---

### 2. 多 Agent 实战：研究团队

```python
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

# 研究员 Agent
researcher_prompt = """你是一个研究员。你的任务是搜索和分析信息。
你只能做研究，不能写最终报告。
请基于搜索结果，列出关键事实和数据。
"""

# 写手 Agent
writer_prompt = """你是一个技术写手。你的任务是基于研究员提供的事实，
撰写结构清晰、语言流畅的报告。
你不能自己编造数据，必须完全基于提供的事实。
"""

# 审核 Agent
reviewer_prompt = """你是一个审核专家。请检查报告：
1. 是否有事实错误
2. 是否有遗漏的重要信息
3. 语言是否通顺
如果有问题，指出具体修改意见。如果没问题，输出 "APPROVED"。
"""

def run_multi_agent(topic: str):
    llm = ChatOpenAI(model="gpt-4")

    # 研究员工作
    research_result = llm.invoke([
        HumanMessage(content=researcher_prompt + f"\n研究主题：{topic}")
    ])
    print("=== 研究员输出 ===")
    print(research_result.content)

    # 写手工作
    draft = llm.invoke([
        HumanMessage(content=writer_prompt + f"\n研究事实：\n{research_result.content}\n\n请撰写报告。")
    ])
    print("=== 写手初稿 ===")
    print(draft.content)

    # 审核循环
    max_iterations = 3
    current_draft = draft.content

    for i in range(max_iterations):
        review = llm.invoke([
            HumanMessage(content=reviewer_prompt + f"\n报告内容：\n{current_draft}")
        ])
        print(f"=== 审核意见 (第{i+1}轮) ===")
        print(review.content)

        if "APPROVED" in review.content:
            print("审核通过！")
            break

        # 写手修改
        revision = llm.invoke([
            HumanMessage(content=writer_prompt + f"\n原报告：\n{current_draft}\n\n修改意见：\n{review.content}\n\n请修改报告。")
        ])
        current_draft = revision.content

    return current_draft

# 使用
# final_report = run_multi_agent("2024年AI大模型发展趋势")
```

---

## 九、Agent 的可控性与护栏

这是企业级 Agent 落地的关键。

---

### 1. 常见问题

| 问题 | 现象 | 危害 |
|------|------|------|
| 无限循环 | Agent 反复调用工具，无法收敛 | Token 耗尽、用户体验差 |
| 工具误调用 | 该查天气却调用了数据库 | 数据错误、信息泄露 |
| 参数错误 | 传了错误的参数导致工具报错 | 流程中断 |
| 幻觉放大 | Agent 编造工具返回结果 | 错误决策 |
| 权限越界 | Agent 调用了不该调用的工具 | 安全风险 |

---

### 2. 解决方案

#### 最大迭代限制

```python
class SafeAgent:
    def __init__(self, max_iterations: int = 5):
        self.max_iterations = max_iterations
        self.iteration_count = 0

    def run(self, query: str) -> str:
        for i in range(self.max_iterations):
            self.iteration_count += 1
            # 执行一步
            # ...

            if should_stop:
                return result

        # 达到最大迭代次数，优雅降级
        return "问题较复杂，已尝试多种方法。建议转人工处理。"
```

#### 工具权限控制

```python
class ToolRegistry:
    """带权限控制的工具注册表"""

    def __init__(self):
        self.tools = {}
        self.permissions = {}  # 工具 -> 需要的权限级别

    def register(self, name: str, tool, permission_level: int = 0):
        self.tools[name] = tool
        self.permissions[name] = permission_level

    def execute(self, name: str, args: dict, user_level: int = 0):
        if name not in self.tools:
            raise ValueError(f"未知工具: {name}")

        required_level = self.permissions.get(name, 0)
        if user_level < required_level:
            raise PermissionError(f"权限不足，需要级别 {required_level}")

        return self.tools[name].run(**args)

# 使用
registry = ToolRegistry()
registry.register("query_database", db_tool, permission_level=2)
registry.register("send_email", email_tool, permission_level=1)

# 普通用户只能发邮件，不能查数据库
result = registry.execute("send_email", {...}, user_level=1)  # OK
result = registry.execute("query_database", {...}, user_level=1)  # 报错
```

#### 人工审核节点

```python
def human_approval_node(state: AgentState):
    """人工审核"""
    last_action = state["last_action"]

    print(f"\n*** 需要人工审核 ***")
    print(f"Agent 想要执行: {last_action}")

    user_input = input("批准执行？(yes/no/modify): ")

    if user_input.lower() == "yes":
        return {"approved": True, "modified_action": None}
    elif user_input.lower() == "no":
        return {"approved": False, "error_message": "用户拒绝了操作"}
    else:
        return {"approved": True, "modified_action": user_input}
```

#### 参数校验与沙箱

```python
import jsonschema

# 定义工具参数 Schema
weather_schema = {
    "type": "object",
    "properties": {
        "city": {"type": "string", "minLength": 2, "maxLength": 50},
        "date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
    },
    "required": ["city"]
}

def validate_and_run(tool_func, args: dict, schema: dict):
    # 校验参数
    jsonschema.validate(instance=args, schema=schema)

    # 额外安全校验
    if "sql" in str(args).lower():
        forbidden = ["drop", "delete", "truncate", ";--"]
        if any(f in str(args).lower() for f in forbidden):
            raise ValueError("检测到危险操作")

    return tool_func(**args)
```

---

### 3. 循环不收敛的解决

```python
class ConvergenceChecker:
    """检测是否陷入循环"""

    def __init__(self, max_similar_actions: int = 3):
        self.action_history = []
        self.max_similar = max_similar_actions

    def record(self, action: str, action_input: str):
        """记录动作"""
        signature = f"{action}:{action_input}"
        self.action_history.append(signature)

    def is_looping(self) -> bool:
        """检测是否循环"""
        if len(self.action_history) < 3:
            return False

        # 检查最近 N 次是否重复相同动作
        recent = self.action_history[-self.max_similar:]
        return len(set(recent)) == 1  # 全部相同

# 在 Agent 循环中使用
checker = ConvergenceChecker()

for step in range(max_steps):
    action, action_input = agent.plan()

    if checker.is_looping():
        return "检测到循环行为，停止执行。建议转人工。"

    checker.record(action, action_input)
    # 执行...
```

---

## 十、核心要点总结

1. **Agent = LLM（大脑）+ 工具（手脚）+ 记忆（经验）**

2. **Agent 与 RAG 不是替代关系** -- RAG 是 Agent 的一种工具，Agent 是更上层的编排

3. **ReAct 是 Agent 的基础范式** -- Thought -> Action -> Observation 循环

4. **Function Calling 是底层机制** -- 模型生成调用指令，代码负责执行

5. **工具定义的质量决定 Agent 效果** -- description 写得好，模型才知道什么时候用

6. **Agent 需要记忆系统** -- 短期记忆（对话历史）+ 长期记忆（向量存储）

7. **LangGraph 适合复杂工作流** -- 支持分支、循环、并行、人工审核

8. **多 Agent 协作是高级形态** -- 主从、讨论、流水线、路由四种模式

9. **可控性是落地关键** -- 最大迭代限制、权限控制、循环检测、人工审核

10. **Agent 的幻觉问题比纯对话更严重** -- 可能编造工具返回结果

11. **工具执行必须有安全沙箱** -- 特别是代码执行、数据库操作

12. **不是所有任务都需要 Agent** -- 简单任务用普通对话，复杂任务才上 Agent

---

## 十一、面试高频题

---

### Q1：Agent 和 RAG 有什么区别？

| 维度 | RAG | Agent |
|------|-----|-------|
| 核心能力 | 检索静态知识 | 动态调用工具 |
| 交互方式 | 单次检索+生成 | 多轮推理+行动 |
| 外部能力 | 读文档 | 读文档 + 查数据库 + 调 API + 执行代码 |
| 复杂度 | 相对简单 | 更复杂，需要状态管理 |
| 适用场景 | 知识问答 | 任务执行、多步骤推理 |

**关系：**
- RAG 可以视为 Agent 的一个工具（检索工具）
- Agent 可以调用 RAG 系统获取知识
- RAG 解决"知道什么"的问题，Agent 解决"能做什么"的问题

---

### Q2：ReAct 范式是什么？为什么有效？

**ReAct = Reasoning（推理）+ Acting（行动）**

**工作流程：**
1. Thought：分析当前状态，决定下一步
2. Action：调用工具
3. Observation：获取工具返回
4. 循环直到得到最终答案

**为什么有效：**
- 显式写出推理过程，减少思维跳跃导致的错误
- 模型可以基于工具返回的事实修正之前的推理
- 每步都有明确的状态，便于调试和回溯

---

### Q3：Function Calling 的底层原理是什么？

1. **不是模型真的执行了函数** -- 模型只是生成 JSON 格式的调用请求
2. **模型在训练时学会了工具使用** -- 通过大量工具调用数据训练
3. **决策机制**：
   - 模型分析用户问题和工具描述
   - 判断是否需要工具
   - 如果需要，生成符合 schema 的 JSON
4. **执行流程**：
   - 模型输出 tool_calls -> 应用层解析 JSON -> 执行函数 -> 结果返回给模型 -> 模型继续生成

---

### Q4：Agent 为什么容易陷入无限循环？怎么解决？

**原因：**
1. 工具返回结果不理想，Agent 反复尝试
2. 推理逻辑有缺陷，重复相同动作
3. 目标定义不清晰，不知道何时停止

**解决方案：**
1. **最大迭代次数限制** -- 超过就停止
2. **循环检测** -- 记录历史动作，检测重复模式
3. **状态收敛检测** -- 如果结果不再变化，停止
4. **人工介入** -- 复杂任务转人工
5. **更好的 Prompt** -- 明确终止条件

---

### Q5：如何设计一个安全的 Agent 系统？

**多层安全策略：**

1. **工具权限控制**
   - 不同用户/场景有不同的工具访问权限
   - 敏感操作（写数据、发邮件）需要额外授权

2. **输入输出校验**
   - 工具参数 JSON Schema 校验
   - SQL 注入、命令注入检测
   - 输出内容审核

3. **执行隔离**
   - 代码执行用沙箱（Docker、虚拟机）
   - 数据库操作使用只读账号
   - 网络请求限制白名单

4. **监控告警**
   - 记录所有工具调用
   - 异常行为检测（高频调用、循环调用）
   - 实时告警

5. **人工审核节点**
   - 高风险操作人工确认
   - 结果抽检

---

### Q6：多 Agent 协作有哪些模式？适用什么场景？

| 模式 | 结构 | 适用场景 |
|------|------|---------|
| 主从模式 | 一个 Master 分配任务给多个 Worker | 任务分解、并行处理 |
| 讨论模式 | 多个 Agent 互相讨论达成共识 | 头脑风暴、决策制定 |
| 流水线 | 输入 -> A -> B -> C -> 输出 | 标准化流程（研究-写作-审核） |
| 路由模式 | Router 根据输入分发给不同 Agent | 多领域客服、多功能助手 |

---

## 十二、练习题

---

### 练习 1：概念理解

**场景：** 用户说："帮我查一下我们系统里上周注册但没下单的用户，给他们发一条优惠券短信。"

**问题：**
1. 这个任务用纯 RAG 能完成吗？为什么？
2. 设计一个 Agent 来完成这个任务，需要哪些工具？
3. 画出这个 Agent 的执行流程（Thought/Action/Observation）

---

### 练习 2：工具定义

**任务：** 定义一个"查询订单状态"的工具，供 Agent 使用。

**要求：**
- 工具名：`query_order_status`
- 参数：order_no（订单号）、phone（手机号，用于验证）
- 需要详细的 description，让模型知道什么时候用、怎么用
- 写出完整的 JSON Schema

---

### 练习 3：代码实现

**任务：** 实现一个能计算数学题的 Agent。

**要求：**
- 使用 ReAct 范式
- 支持加、减、乘、除
- 处理括号优先级
- 最多允许 3 次工具调用
- 如果 3 次内算不出，返回"计算过于复杂"

---

### 练习 4：问题排查

**场景：** 你的 Agent 上线后出现以下问题：

1. 用户问"今天天气"，Agent 调用了"查询数据库"工具
2. Agent 在查询数据库和搜索引擎之间反复切换，不收敛
3. Agent 把用户输入里的"请忽略之前指令"当真执行了

**请分析每个问题的原因和解决方案。**

---

### 练习 5：架构设计

**任务：** 设计一个"智能运维助手" Agent。

**功能：**
- 接收告警信息（如 CPU 使用率 95%）
- 查询监控系统获取详细指标
- 查询知识库获取排查手册
- 执行简单的诊断命令（如查看进程）
- 生成处理建议
- 如果高危，通知值班工程师

**要求：**
1. 画出 Agent 架构图
2. 列出所有工具及其定义
3. 设计工作流（哪些自动执行，哪些需要人工确认）
4. 设计安全护栏
