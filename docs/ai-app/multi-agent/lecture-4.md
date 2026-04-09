# 第四讲：工具调用与 CrewAI 实战

> 阶段目标：掌握 Function Calling 机制，能用 CrewAI 搭建工具驱动的 Multi-Agent 系统。

## 学习目标

- 理解 Function Calling 的原理与流程
- 掌握工具 Schema 设计的最佳实践
- 学会工具链组合、异常处理与重试机制
- 能使用 CrewAI 构建 Task/Agent/Tool 三要素系统
- 掌握将 API 封装为 Agent 工具的方法

---

## 核心内容

### 1. Function Calling 原理

#### 工作流程

```
用户请求 -> LLM 判断是否需要调用工具 -> 生成工具调用指令（JSON）-> 执行工具 -> 返回结果 -> LLM 继续推理
```

#### 完整调用示例

```python
import openai

# 1. 定义工具
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
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "返回结果数量",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    }
]

# 2. 第一次调用：LLM 决定是否使用工具
response = client.chat.completions.create(
    model="qwen-plus",
    messages=[{"role": "user", "content": "今天北京天气怎么样？"}],
    tools=tools
)

# 3. 如果 LLM 决定调用工具，执行工具
if response.choices[0].message.tool_calls:
    tool_call = response.choices[0].message.tool_calls[0]
    function_name = tool_call.function.name
    function_args = json.loads(tool_call.function.arguments)

    # 执行实际工具函数
    tool_result = execute_tool(function_name, function_args)

    # 4. 将工具结果返回给 LLM
    response = client.chat.completions.create(
        model="qwen-plus",
        messages=[
            {"role": "user", "content": "今天北京天气怎么样？"},
            response.choices[0].message,
            {"role": "tool", "tool_call_id": tool_call.id, "content": str(tool_result)}
        ]
    )

final_answer = response.choices[0].message.content
```

---

### 2. 工具 Schema 设计

#### 设计原则

- **描述清晰**：description 要让 LLM 准确理解工具的用途
- **参数完整**：包含类型、描述、默认值、枚举值
- **必填区分**：required 字段只放真正必须的参数
- **枚举约束**：对有限选项使用 enum 约束，减少幻觉

#### 好的 Schema 示例

```python
{
    "type": "function",
    "function": {
        "name": "query_database",
        "description": "查询指定数据库表的数据，支持条件过滤和排序。仅支持只读查询，不能执行修改操作。",
        "parameters": {
            "type": "object",
            "properties": {
                "table": {
                    "type": "string",
                    "description": "表名",
                    "enum": ["users", "orders", "products"]
                },
                "conditions": {
                    "type": "object",
                    "description": "过滤条件，key为字段名，value为过滤值"
                },
                "order_by": {
                    "type": "string",
                    "description": "排序字段",
                    "default": "id"
                },
                "limit": {
                    "type": "integer",
                    "description": "返回条数上限",
                    "default": 20,
                    "maximum": 100
                }
            },
            "required": ["table"]
        }
    }
}
```

#### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| LLM 不调用工具 | description 不够清晰 | 补充使用场景说明 |
| 参数传错 | 类型定义不明确 | 添加 enum 约束和详细描述 |
| 幻觉调用不存在的工具 | 工具名太相似 | 使用差异化的命名 |
| 参数缺失 | required 设置不当 | 检查并补全 required 列表 |

---

### 3. 工具链组合与编排

#### 串行工具链

前一个工具的输出作为后一个工具的输入。

```python
# 搜索 -> 抓取网页 -> 提取信息 -> 生成摘要
tool_chain = [
    {"name": "search_web", "input": {"query": "{topic}"}},
    {"name": "scrape_page", "input": {"url": "$.search_web.results[0].url"}},
    {"name": "extract_info", "input": {"content": "$.scrape_page.content"}},
    {"name": "summarize", "input": {"text": "$.extract_info.text"}}
]
```

#### 并行工具调用

同时调用多个独立工具，汇聚结果。

```python
# 同时查询多个数据源
parallel_tools = [
    {"name": "query_knowledge_base", "input": {"query": "{question}"}},
    {"name": "search_web", "input": {"query": "{question}"}},
    {"name": "query_database", "input": {"table": "faq", "conditions": {"keyword": "{question}"}}
]
```

#### 条件工具选择

根据任务类型选择不同工具。

```python
def select_tool(task_type: str) -> str:
    tool_mapping = {
        "search": "search_web",
        "calculate": "calculator",
        "query": "query_database",
        "generate": "code_generator"
    }
    return tool_mapping.get(task_type, "search_web")
```

---

### 4. 异常处理与重试

#### 异常类型

| 异常类型 | 原因 | 处理方式 |
|---------|------|---------|
| 工具不可用 | API 宕机、网络超时 | 重试 + 降级 |
| 参数错误 | LLM 生成错误参数 | 参数校验 + 提示纠正 |
| 结果异常 | 工具返回非预期结果 | 结果校验 + 重试 |
| 超时 | 工具执行时间过长 | 超时中断 + 简化请求 |

#### 重试策略

```python
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),           # 最多重试3次
    wait=wait_exponential(multiplier=1, max=10),  # 指数退避
    retry=lambda e: isinstance(e, (TimeoutError, ConnectionError))
)
async def call_tool_with_retry(tool_name: str, params: dict):
    try:
        result = await execute_tool(tool_name, params)
        validate_result(result)  # 校验结果
        return result
    except ValidationError as e:
        # 参数错误不重试，记录日志
        log_error(f"Tool parameter error: {e}")
        raise
    except Exception as e:
        log_error(f"Tool execution error: {e}")
        raise
```

#### 降级策略

```python
async def call_tool_with_fallback(tool_name: str, params: dict):
    try:
        return await call_tool_with_retry(tool_name, params)
    except Exception:
        # 降级到备选工具
        fallback_map = {
            "search_web": "search_knowledge_base",
            "query_primary_db": "query_cache_db"
        }
        fallback = fallback_map.get(tool_name)
        if fallback:
            return await execute_tool(fallback, params)
        return {"error": "工具暂时不可用"}
```

---

### 5. CrewAI 的 Task/Agent/Tool 设计

#### CrewAI 核心概念

```
Crew (团队)
  ├── Agent (角色)
  │     ├── role: 角色描述
  │     ├── goal: 目标
  │     ├── backstory: 背景故事
  │     └── tools: 可用工具列表
  ├── Task (任务)
  │     ├── description: 任务描述
  │     ├── agent: 执行者
  │     ├── expected_output: 预期输出
  │     └── output_file: 输出文件
  └── Process (流程)
        └── sequential / hierarchical
```

#### 实战示例：市场调研 Agent

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import SerperDevTool, ScrapeWebsiteTool

# 定义工具
search_tool = SerperDevTool()
scrape_tool = ScrapeWebsiteTool()

# 定义 Agent
researcher = Agent(
    role="市场研究员",
    goal="收集并整理指定行业的市场数据和趋势",
    backstory="你是一名拥有15年经验的市场研究员，擅长数据分析和趋势预测",
    tools=[search_tool, scrape_tool],
    verbose=True,
    max_iter=5,
    llm="qwen-plus"
)

analyst = Agent(
    role="数据分析师",
    goal="对市场数据进行深度分析，生成可视化洞察",
    backstory="你是一名资深数据分析师，擅长从数据中发现商业价值",
    tools=[search_tool],
    verbose=True,
    max_iter=3,
    llm="qwen-plus"
)

writer = Agent(
    role="报告撰写员",
    goal="将分析结果整理成专业的市场调研报告",
    backstory="你是一名技术写作专家，擅长将复杂信息转化为清晰的报告",
    verbose=True,
    max_iter=3,
    llm="qwen-plus"
)

# 定义任务
research_task = Task(
    description="调研{topic}行业的市场规模、主要玩家、发展趋势",
    agent=researcher,
    expected_output="包含市场数据和趋势的结构化调研报告"
)

analysis_task = Task(
    description="基于调研数据，进行SWOT分析并识别关键机会",
    agent=analyst,
    expected_output="SWOT分析报告和机会清单"
)

report_task = Task(
    description="将调研和分析结果整合为完整的市场调研报告",
    agent=writer,
    expected_output="格式规范的PDF报告，包含图表和建议"
)

# 组建团队
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, report_task],
    process=Process.sequential,
    verbose=True
)

# 执行
result = crew.kickoff(inputs={"topic": "中国AI大模型"})
```

---

### 6. API 封装成工具

#### 封装模板

```python
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
import httpx

class WeatherInput(BaseModel):
    city: str = Field(description="城市名称")
    date: str = Field(default="today", description="日期，默认今天")

class WeatherTool(BaseTool):
    name: str = "weather_query"
    description: str = "查询指定城市的天气信息"

    def _run(self, city: str, date: str = "today") -> str:
        try:
            response = httpx.get(
                "https://api.weather.com/v1/forecast",
                params={"city": city, "date": date},
                timeout=10
            )
            data = response.json()
            return f"{city}{date}天气：{data['weather']}，温度{data['temp']}度"
        except Exception as e:
            return f"查询失败：{str(e)}"
```

#### 封装要点

- 工具名称使用动词+名词格式（如 search_web, query_database）
- description 简洁明确，说明功能和限制
- 所有外部调用设置超时时间
- 统一异常处理，返回可理解的错误信息
- 敏感参数（API Key）通过环境变量注入

---

## 实战项目

### 项目：市场调研 Agent 系统

**目标**：使用 CrewAI 实现一个自动化的市场调研系统。

**功能要求**：
1. Researcher Agent：搜索行业信息、抓取竞品数据
2. Analyst Agent：分析市场趋势、生成 SWOT 报告
3. Writer Agent：整合所有信息生成完整报告
4. 支持自定义调研主题和深度
5. 包含工具调用异常处理和重试机制
6. 记录每步的 Token 消耗和成本

---

## 练习题

### 概念题

1. 解释 Function Calling 的完整流程（从用户请求到最终回答）。
2. 工具 Schema 设计中，为什么 description 字段如此重要？
3. CrewAI 中 sequential 和 hierarchical 两种流程模式有什么区别？

### 实践题

1. 设计一个"数据分析工具"的 Schema，支持 SQL 查询、数据聚合和图表生成。
2. 使用 CrewAI 搭建一个"技术调研 Agent"，包含技术搜索、代码验证和报告生成三个角色。
3. 为上述系统实现工具调用的异常处理，包含重试和降级机制。

---

## 小结

本讲学习了工具调用与 CrewAI 实战。关键要点：

- Function Calling 是 Agent 与外部世界交互的核心机制
- 工具 Schema 设计直接影响 LLM 的工具选择准确性
- 工具链编排要考虑串行、并行和条件三种模式
- 异常处理必须包含重试、降级和超时三个维度
- CrewAI 适合快速搭建角色驱动的 Multi-Agent 系统
- API 封装要注意超时、异常处理和敏感信息保护

下一讲将学习 Prompt 精调与模型优化，提升 Agent 的输出质量。
