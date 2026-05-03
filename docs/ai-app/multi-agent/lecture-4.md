# 第4讲：工具调用与CrewAI工具链深度实战

前三讲学会了多智能体架构设计、CrewAI角色编排、RAG知识管理。

但 **Agent 光会"想"还不够，还要会"做"。**

- 搜索最新数据？需要工具
- 抓取网页内容？需要工具
- 发送邮件通知？需要工具
- 操作数据库？需要工具
- 调用内部API？需要工具

**工具是 Agent 连接真实世界的桥梁。**

这一讲彻底搞懂工具调用的底层原理，掌握工具设计的最佳实践，并实战构建一个**市场调研 Agent 系统**。

---

## 一、Function Calling 底层原理

### 1. 从一个问题说起

**用户问：** "今天北京天气怎么样？"

**没有工具调用的 LLM：**
```
答：今天北京天气晴朗，温度约20度。
（纯靠训练数据猜测，可能完全不准）
```

**有工具调用的 LLM：**
```
1. LLM识别：这个问题需要实时天气数据
2. LLM决定：调用 get_weather 工具
3. 系统执行：真正调用天气API
4. LLM整合：基于真实数据回答
答：根据实时数据，今天北京晴天，15C，北风3级。
```

---

### 2. Function Calling 的完整流程

```
+---------------------------------------------------+
|           Function Calling 完整流程                |
+---------------------------------------------------+
|                                                   |
|  用户输入："今天北京天气？"                         |
|       |                                           |
|  +------------------------------------------+    |
|  |  Step1: 发送给LLM                        |    |
|  |  - 用户问题                              |    |
|  |  - 可用工具列表（Schema定义）             |    |
|  +------------------+-----------------------+    |
|                     |                             |
|  +------------------v-----------------------+    |
|  |  Step2: LLM决策                          |    |
|  |  判断：需要调用工具                       |    |
|  |  输出：{                                 |    |
|  |    "tool": "get_weather",                |    |
|  |    "args": {"city": "北京"}              |    |
|  |  }                                      |    |
|  +------------------+-----------------------+    |
|                     |                             |
|  +------------------v-----------------------+    |
|  |  Step3: 系统执行工具                     |    |
|  |  真正调用天气API                         |    |
|  |  返回：{"temp": 15, "weather": "晴"}     |    |
|  +------------------+-----------------------+    |
|                     |                             |
|  +------------------v-----------------------+    |
|  |  Step4: LLM整合结果                      |    |
|  |  基于工具返回结果生成最终答案             |    |
|  |  输出："今天北京晴天，15C"               |    |
|  +------------------------------------------+    |
|                                                   |
+---------------------------------------------------+
```

**关键点：**
- LLM 只负责**决策**（调用哪个工具、传什么参数）
- 实际执行由**你的代码**完成
- LLM 看不到工具的真实代码，只看到 Schema 描述

---

### 3. 工具 Schema 的本质

工具 Schema 就是**告诉 LLM "这个工具能做什么、怎么用"的说明书**。

```python
# 一个工具的Schema结构
tool_schema = {
    "name": "get_weather",           # 工具名称
    "description": "获取城市实时天气信息",  # 功能描述（LLM靠这个决定调不调用）
    "parameters": {
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "城市名称，如：北京、上海"  # 参数描述
            },
            "date": {
                "type": "string",
                "description": "日期，格式YYYY-MM-DD，不填默认今天"
            }
        },
        "required": ["city"]  # 必填参数
    }
}
```

**LLM 看到这个 Schema 后：**
- 知道有个工具叫 `get_weather`
- 知道它能获取天气
- 知道要传 `city` 参数（必填）
- 知道可以传 `date` 参数（可选）

---

### 4. OpenAI 原生 Function Calling 实战

```python
import json, openai

client = openai.OpenAI()

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "获取指定城市的实时天气信息",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}
    }
}]

def execute_tool(tool_name, tool_args):
    """工具路由：根据 tool_name 调用对应的真实函数"""
    if tool_name == "get_weather":
        return json.dumps(get_weather(**tool_args), ensure_ascii=False)

def chat_with_tools(user_message: str) -> str:
    """支持工具调用的对话循环"""
    messages = [{"role": "user", "content": user_message}]
    while True:
        response = client.chat.completions.create(
            model="gpt-4", messages=messages, tools=tools, tool_choice="auto")
        msg = response.choices[0].message
        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                result = execute_tool(tc.function.name, json.loads(tc.function.arguments))
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        else:
            return msg.content
```

核心流程：定义工具 Schema → LLM 返回 `tool_calls` → 代码执行真实函数 → 将结果追加到 messages → 循环直到 LLM 输出文本答案。

---

## 二、如何设计高质量工具

**工具设计是 Agent 成功的关键。** 一个设计糟糕的工具，会让 Agent 频繁调用失败或产生幻觉。

### 1. 工具设计的 5 大原则

#### 原则 1：描述要精准，让 LLM 知道"何时调用"

```python
# 差：描述太模糊
@tool("搜索")
def bad_search(query: str) -> str:
    """搜索工具"""  # LLM不知道什么时候用这个
    pass

# 好：描述清晰，包含适用场景和限制
@tool("网络搜索")
def good_search(query: str) -> str:
    """
    搜索互联网上的实时信息。
    适用于：最新新闻、实时数据、不确定的事实
    不适用于：内部文档查询、数学计算、代码生成
    输入：搜索关键词（建议精简，2-5个词效果最好）
    输出：搜索结果摘要
    """
    pass
```

#### 原则 2：参数描述要具体，告诉 LLM "怎么传参"

```python
# 差：参数描述不清楚
@tool("数据查询")
def bad_query(params: str) -> str:
    """查询数据"""
    pass

# 好：参数有明确说明
@tool("销售数据查询")
def good_query(
    product_name: str,   # 商品名称，如：iPhone15
    start_date: str,     # 开始日期，格式：YYYY-MM-DD
    end_date: str,       # 结束日期，格式：YYYY-MM-DD
    region: str = "全国" # 地区，默认全国，可选：华东、华南、华北
) -> str:
    """
    查询指定商品在指定时间段和地区的销售数据。
    返回：销售额、销售量、环比增长率
    """
    pass
```

#### 原则 3：返回值要结构化，方便 LLM 理解

```python
# 差：返回纯文本，LLM难以解析
def bad_weather(city: str) -> str:
    return "北京今天天气不错温度15度有点风"

# 好：返回结构化信息
def good_weather(city: str) -> str:
    data = get_real_weather(city)
    return f"""城市：{city}
温度：{data['temp']}C
天气：{data['weather']}
风力：{data['wind']}
湿度：{data['humidity']}%
建议：{data['suggestion']}"""
```

#### 原则 4：做好异常处理，不要让 LLM 不知所措

```python
# 差：异常直接抛出
def bad_search(query: str) -> str:
    response = requests.get(f"https://api.example.com/search?q={query}")
    return response.json()['results']  # 失败时LLM不知道怎么办

# 好：友好的错误提示
def good_search(query: str) -> str:
    try:
        response = requests.get(
            f"https://api.example.com/search?q={query}",
            timeout=5
        )
        response.raise_for_status()
        results = response.json()['results']

        if not results:
            return f"搜索'{query}'没有找到相关结果，请尝试换个关键词"

        return "\n".join([f"- {r['title']}: {r['snippet']}"
                          for r in results[:3]])

    except requests.Timeout:
        return "搜索超时，请稍后重试"
    except requests.HTTPError as e:
        return f"搜索服务暂时不可用（{e.response.status_code}），请稍后重试"
    except Exception as e:
        return f"搜索出现未知错误，请换个方式提问"
```

#### 原则 5：限制工具能力，防止误操作

```python
# 差：过于强大的工具，有安全风险
@tool("数据库操作")
def dangerous_db_tool(sql: str) -> str:
    """执行SQL语句"""
    return db.execute(sql)  # 可能执行DELETE/DROP！

# 好：限制操作范围
@tool("数据查询")
def safe_db_tool(
    table: str,
    conditions: str = "",
    limit: int = 10
) -> str:
    """
    查询数据库（只读操作）。
    支持的表：orders, products, users
    最多返回100条记录
    """
    allowed_tables = ["orders", "products", "users"]
    if table not in allowed_tables:
        return f"不支持查询表：{table}，只允许查询：{allowed_tables}"

    limit = min(limit, 100)

    sql = f"SELECT * FROM {table}"
    if conditions:
        if any(kw in conditions.upper()
               for kw in ['DROP', 'DELETE', 'INSERT', 'UPDATE']):
            return "检测到危险操作，已拒绝"
        sql += f" WHERE {conditions}"
    sql += f" LIMIT {limit}"

    return db.execute(sql)
```

---

### 2. 工具的分类设计

在企业级系统中，工具通常分为几类：

```
+-------------------------------------+
|         工具分类体系                 |
+-------------------------------------+
|                                     |
|  信息获取类                          |
|  +-- 网络搜索                       |
|  +-- 网页抓取                       |
|  +-- 数据库查询                     |
|  +-- API调用                        |
|                                     |
|  数据处理类                          |
|  +-- 数学计算                       |
|  +-- 数据分析                       |
|  +-- 格式转换                       |
|  +-- 文件处理                       |
|                                     |
|  执行操作类                          |
|  +-- 发送邮件                       |
|  +-- 创建日历                       |
|  +-- 写入数据库                     |
|  +-- 调用内部系统                   |
|                                     |
|  知识检索类                          |
|  +-- RAG知识库查询                  |
|                                     |
+-------------------------------------+
```

---

## 三、CrewAI 工具定义实战

### 1. 三种工具定义方式

#### 方式 1：@tool 装饰器（最简单）

适用于简单工具，只需装饰一个函数：

```python
from crewai_tools import tool

@tool("网络搜索")
def web_search(query: str) -> str:
    """搜索互联网上的最新信息。输入：搜索关键词。输出：相关搜索结果。"""
    import requests
    resp = requests.post("https://google.serper.dev/search",
                         json={"q": query}, headers={"X-API-KEY": "key"})
    results = resp.json().get('organic', [])
    return "\n".join(f"{r['title']}\n  {r.get('snippet', '')}" for r in results[:3])
```

#### 方式 2：继承 BaseTool（最灵活）

适用于需要自定义参数 schema 的复杂工具：

```python
from crewai_tools import BaseTool
from pydantic import BaseModel, Field

class WebScraperInput(BaseModel):
    url: str = Field(description="要抓取的网页URL")
    extract_type: str = Field(default="text", description="text/links/tables")

class WebScraperTool(BaseTool):
    name: str = "网页抓取"
    description: str = "抓取指定网页的内容。适用于获取特定网页详细内容。"
    args_schema: Type[BaseModel] = WebScraperInput

    def _run(self, url: str, extract_type: str = "text") -> str:
        import requests; from bs4 import BeautifulSoup
        soup = BeautifulSoup(requests.get(url, timeout=10).text, 'html.parser')
        if extract_type == "text":
            for tag in soup(['script', 'style', 'nav']): tag.decompose()
            return soup.get_text(separator='\n', strip=True)[:2000]
        elif extract_type == "links":
            return "\n".join(f"- {a.text.strip()}: {a['href']}"
                           for a in soup.find_all('a', href=True)[:20])
```

#### 方式 3：使用 CrewAI 内置工具

```python
from crewai_tools import (
    SerperDevTool,          # Google搜索
    ScrapeWebsiteTool,      # 网页抓取
    FileReadTool,           # 读取文件
    CodeInterpreterTool,    # 执行代码
    YoutubeVideoSearchTool, # YouTube搜索
    GithubSearchTool        # GitHub搜索
)

search_tool = SerperDevTool()
scrape_tool = ScrapeWebsiteTool()
file_tool = FileReadTool()
```

---

### 2. 自定义企业级工具集

设计一个市场调研场景的 4 个工具：

| 工具 | 功能 | 关键参数 |
|------|------|---------|
| `market_search` | 搜索市场和行业数据（使用 mock_data 字典模拟） | `query: str` — 如"手机市场份额"、"折叠屏" |
| `data_analysis` | 数据分析，支持趋势/对比/摘要三种模式 | `data: str`, `analysis_type: str` |
| `generate_report_section` | 生成 Markdown 格式的报告章节 | `section_title`, `content`, `format_type` |
| `competitor_analysis` | 两家公司的多维度对比 | `company_a`, `company_b`, `dimension` |

核心示例（其他工具同上模式）：

```python
@tool("市场数据搜索")
def market_search(query: str) -> str:
    """搜索市场和行业数据，返回市场份额、行业趋势等信息。"""
    return mock_data.get(query, f"关于'{query}'的搜索结果...")

@tool("竞品对比")
def competitor_analysis(company_a: str, company_b: str, dimension: str = "综合") -> str:
    """对比两家公司在指定维度的竞争态势。"""
    return f"{company_a} vs {company_b} {dimension}对比分析：..."
```

---

## 四、工具链的组合与编排

### 1. 工具链的执行模式

```
+---------------------------------------------+
|              工具链执行模式                   |
+---------------------------------------------+
|                                             |
|  串行执行（结果依赖）                         |
|  搜索 -> 抓取 -> 分析 -> 生成报告            |
|                                             |
|  并行执行（结果独立）                         |
|  搜索华为 --+                               |
|  搜索小米 --+-> 汇总 -> 对比分析             |
|  搜索苹果 --+                               |
|                                             |
|  条件执行（按需调用）                         |
|  搜索 -> 结果充分？-> 是：分析 / 否：补充搜索 |
|                                             |
+---------------------------------------------+
```

### 2. 带工具链的完整 Agent 设计

```python
from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4", temperature=0.7)

# 研究员：专注信息搜集
researcher = Agent(
    role="资深市场研究员",
    goal="通过多渠道搜集全面准确的市场数据",
    backstory="""
    你是一位有10年经验的科技行业研究员。
    你的工作方法：
    1. 先用市场搜索工具获取宏观数据
    2. 再用网页抓取获取详细信息
    3. 对关键数据进行交叉验证
    4. 所有数据必须标注来源

    你绝不编造数据，所有信息必须来自工具调用。
    """,
    tools=[market_search, web_scraper],
    llm=llm,
    verbose=True,
    max_iter=5,
    allow_delegation=False
)

# 分析师：专注数据分析
analyst = Agent(
    role="数据分析专家",
    goal="从原始数据中提炼商业洞察",
    backstory="""
    你是一位擅长市场分析的战略顾问。
    你的分析框架：
    1. 用数据分析工具处理原始数据
    2. 用竞品对比工具做横向比较
    3. 识别趋势、机会和威胁
    4. 每个结论必须有数据支撑
    """,
    tools=[data_analysis, competitor_analysis],
    llm=llm,
    verbose=True,
    allow_delegation=False
)

# 写作者：专注报告撰写
writer = Agent(
    role="商业报告撰写专家",
    goal="撰写清晰、专业、有洞察力的研究报告",
    backstory="""
    你是顶级咨询公司的资深分析师，擅长商业写作。
    你的写作原则：
    1. 结构清晰（总分总）
    2. 数据充分（每个观点都有数据）
    3. 洞察深刻（超越表面现象）
    4. 建议可执行（具体可操作）
    """,
    tools=[generate_report_section],
    llm=llm,
    verbose=True,
    allow_delegation=False
)
```

---

## 五、实战项目：市场调研 Agent 系统

### 完整项目架构

```
+---------------------------------------------+
|          市场调研Agent系统                   |
+---------------------------------------------+
|                                             |
|  输入：调研主题（如：2024年手机市场）         |
|         |                                   |
|  +-------------------------------------+   |
|  |  Task1：信息搜集                    |   |
|  |  Agent：研究员                      |   |
|  |  工具：市场搜索 + 网页抓取           |   |
|  |  输出：原始市场数据                  |   |
|  +------------------+------------------+   |
|                     |                       |
|  +------------------v------------------+   |
|  |  Task2：竞品分析                    |   |
|  |  Agent：研究员                      |   |
|  |  工具：竞品对比                     |   |
|  |  输出：竞争格局分析                  |   |
|  +------------------+------------------+   |
|                     |                       |
|  +------------------v------------------+   |
|  |  Task3：深度分析                    |   |
|  |  Agent：分析师                      |   |
|  |  工具：数据分析                     |   |
|  |  输出：市场洞察                     |   |
|  +------------------+------------------+   |
|                     |                       |
|  +------------------v------------------+   |
|  |  Task4：报告撰写                    |   |
|  |  Agent：写作者                      |   |
|  |  工具：报告生成                     |   |
|  |  输出：完整研究报告                  |   |
|  +--------------------------------------+   |
|                                             |
|  输出：专业研究报告（Markdown格式）          |
|                                             |
+---------------------------------------------+
```

### 完整代码

整合以上所有组件，完整系统包含：

| 模块 | 内容 | 关键点 |
|------|------|--------|
| 工具定义 | `market_search`、`competitor_compare`、`trend_analysis` | 3 个 `@tool` 装饰器函数，返回结构化文本 |
| Agent 定义 | 研究员（2 工具）、分析师（2 工具）、写作者（0 工具）| `max_iter=8`, `allow_delegation=False` |
| Task 定义 | `create_tasks(topic)` 返回 4 个 Task | 用 `context` 建立串行依赖链 |
| 主程序 | `MarketResearchSystem` 类 | 封装 Agent + Task + Crew 调度 |

**核心执行流程：**

```python
class MarketResearchSystem:
    def run(self, research_topic: str, output_file: str = None):
        tasks = create_tasks(research_topic)
        crew = Crew(
            agents=[self.researcher, self.analyst, self.writer],
            tasks=tasks,
            process=Process.sequential,
            verbose=True
        )
        result = crew.kickoff()
        if output_file:
            with open(output_file, 'w') as f:
                f.write(result)
        return result
```

**运行方式：**

```python
system = MarketResearchSystem()
system.run(research_topic="2024年中国手机市场",
           output_file="phone_market_report.md")
```

完整代码约 200 行，详见上方各模块的代码片段。核心设计模式：**工具定义 → Agent 角色分配 → Task 依赖编排 → Crew 串行执行**。

---

## 六、工具调用的异常处理与重试机制

### 1. 重试装饰器

核心思路：装饰器包裹工具函数，失败后按指数退避（1s → 2s → 4s）自动重试，可配置 `max_retries`、`delay`、`backoff` 参数。

```python
@with_retry(max_retries=3, delay=1.0, exceptions=(Exception,))
def robust_search(query: str) -> str:
    """带自动重试的网络搜索工具"""
    response = requests.get(f"https://api.search.com/search?q={query}", timeout=5)
    return response.json()['results']
```

### 2. 降级策略

工具内部按优先级依次尝试多个数据源，失败时自动切换：

```
Serper API → Bing API → 本地知识库 → 默认提示
```

每次降级返回结果时标注来源（如 `[来源：本地知识库]`），让 LLM 了解数据可信度。

### 3. 超时控制

使用 `signal.alarm` 设置最大执行时间，超时抛出异常并返回友好提示，避免工具调用无限等待。

---

## 七、工具调用的成本控制

### 1. Token 消耗统计

核心思路：每次工具调用后记录输入/输出文本长度，按字符数估算 Token（约 1.5 字符/Token），乘以 GPT-4 定价（输入 `$0.03/1K`、输出 `$0.06/1K`）计算费用。执行结束后输出汇总报告。

### 2. 调用频率限制

用滑动窗口实现限流：记录每次调用时间戳，窗口内调用次数超过阈值时自动等待，避免超出 API 配额。

```python
rate_limiter = RateLimiter(max_calls=10, window_seconds=60)

@tool("频率受控的搜索")
def rate_limited_search(query: str) -> str:
    rate_limiter.wait_if_needed("search")
    return actual_search(query)
```

---

## 八、防止工具滥用

核心防护策略：
- **危险模式检测**：检查输入中是否包含 `rm -rf`、`DROP TABLE`、`DELETE FROM` 等危险关键词
- **调用次数限制**：每种工具设置最大调用上限（如搜索 10 次、抓取 5 次），超限后拒绝执行
- **安全执行包装**：工具调用前统一过 `validate_input()`，不安全则返回拒绝原因

```python
class ToolGuard:
    DANGEROUS_PATTERNS = ["rm -rf", "DROP TABLE", "DELETE FROM"]
    MAX_ITERATIONS = {"web_search": 10, "web_scrape": 5, "database_query": 20}

    def validate_input(self, tool_name: str, input_text: str) -> tuple:
        for pattern in self.DANGEROUS_PATTERNS:
            if pattern.lower() in input_text.lower():
                return False, f"输入包含危险关键词：{pattern}"
        if self.iteration_count[tool_name] > self.MAX_ITERATIONS.get(tool_name, 50):
            return False, f"调用次数超限"
        return True, "安全"
```

---

## 九、核心要点总结

1. **Function Calling 本质**：LLM 只负责决策，你的代码负责执行
2. **工具描述是关键**：让 LLM 知道"何时调用"和"怎么传参"
3. **描述要清晰具体**：包含适用场景、不适用场景、参数格式
4. **返回值要结构化**：方便 LLM 理解和整合
5. **异常必须友好处理**：返回有意义的错误信息
6. **必须限制工具权限**：白名单、只读、范围限制
7. **加入重试机制**：网络不稳定时自动重试
8. **降级策略兜底**：主工具失败时有备选方案
9. **成本要可控**：Token 统计、频率限制、缓存
10. **verbose=True 调试**：工具调用必须能看到执行过程

---

## 十、练习题

### 练习 1：概念理解

1. Function Calling 中，LLM 实际执行工具代码了吗？为什么？
2. 工具描述（Description）写好的核心标准是什么？
3. 什么情况下工具会被 LLM 反复调用而不停止？怎么防止？

### 练习 2：工具设计

为一个"股票分析 Agent"设计工具集：
1. 需要哪些工具？（至少 4 个）
2. 每个工具的 Description 怎么写？
3. 哪些操作需要加安全限制？
4. 如何防止频繁调用产生高额 API 费用？

### 练习 3：代码实战

改造本讲的市场调研系统，加入以下功能：

1. **工具调用日志**：记录每次工具调用的输入/输出
2. **成本统计**：统计整个调研过程的 Token 消耗
3. **自定义主题**：支持命令行传入调研主题

提示框架：

```python
import sys
import json
from datetime import datetime

class ToolLogger:
    """工具调用日志记录器"""

    def __init__(self, log_file: str = "tool_calls.json"):
        self.log_file = log_file
        self.logs = []

    def log(self, tool_name: str, input_data: str, output_data: str):
        self.logs.append({
            "timestamp": datetime.now().isoformat(),
            "tool": tool_name,
            "input": input_data[:200],
            "output": output_data[:200],
            "input_len": len(input_data),
            "output_len": len(output_data)
        })

    def save(self):
        with open(self.log_file, 'w', encoding='utf-8') as f:
            json.dump(self.logs, f, ensure_ascii=False, indent=2)
        print(f"工具调用日志已保存：{self.log_file}")

    def summary(self):
        print(f"\n=== 工具调用摘要 ===")
        print(f"总调用次数：{len(self.logs)}")
        # TODO: 按工具统计调用次数
        # TODO: 统计总Token消耗

logger = ToolLogger()

if __name__ == "__main__":
    topic = sys.argv[1] if len(sys.argv) > 1 else "2024年手机市场"

    system = MarketResearchSystem()
    result = system.run(
        research_topic=topic,
        output_file=f"report_{datetime.now():%Y%m%d_%H%M}.md"
    )

    logger.save()
    logger.summary()
```
