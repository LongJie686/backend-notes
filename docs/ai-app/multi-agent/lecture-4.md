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
import json
import openai

client = openai.OpenAI()

# 定义工具
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的实时天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称"
                    }
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "执行数学计算",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "数学表达式，如：100 * 50 + 300"
                    }
                },
                "required": ["expression"]
            }
        }
    }
]

# 工具的真实实现
def get_weather(city: str) -> dict:
    """真实的天气查询（这里用模拟数据）"""
    weather_data = {
        "北京": {"temp": 15, "weather": "晴", "wind": "北风3级"},
        "上海": {"temp": 22, "weather": "多云", "wind": "东南风2级"},
        "广州": {"temp": 28, "weather": "阴", "wind": "南风2级"},
    }
    return weather_data.get(city, {"error": f"未找到{city}的天气数据"})

def calculate(expression: str) -> dict:
    """安全的数学计算"""
    try:
        # 安全限制：只允许数字和运算符
        allowed = set('0123456789+-*/()., ')
        if not all(c in allowed for c in expression):
            return {"error": "不支持的字符"}
        result = eval(expression)
        return {"result": result}
    except Exception as e:
        return {"error": str(e)}

# 工具路由
def execute_tool(tool_name: str, tool_args: dict) -> str:
    """执行工具并返回结果"""
    if tool_name == "get_weather":
        result = get_weather(**tool_args)
    elif tool_name == "calculate":
        result = calculate(**tool_args)
    else:
        result = {"error": f"未知工具：{tool_name}"}
    return json.dumps(result, ensure_ascii=False)

# 完整的对话流程
def chat_with_tools(user_message: str) -> str:
    """支持工具调用的对话"""
    messages = [{"role": "user", "content": user_message}]

    while True:
        # 发送给LLM
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        message = response.choices[0].message

        # 判断是否需要调用工具
        if message.tool_calls:
            messages.append(message)

            for tool_call in message.tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)

                print(f"  调用工具：{tool_name}，参数：{tool_args}")

                tool_result = execute_tool(tool_name, tool_args)
                print(f"  工具结果：{tool_result}")

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_result
                })
        else:
            return message.content

# 测试
print("测试1：天气查询")
result = chat_with_tools("今天北京和上海哪个更热？")
print(f"最终答案：{result}\n")

print("测试2：数学计算")
result = chat_with_tools("帮我算一下：如果每月存5000元，一年能存多少？")
print(f"最终答案：{result}\n")

print("测试3：混合使用")
result = chat_with_tools("北京今天温度多少？再帮我算一下华氏温度")
print(f"最终答案：{result}")
```

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

```python
from crewai_tools import tool

@tool("网络搜索")
def web_search(query: str) -> str:
    """
    搜索互联网上的最新信息。
    适用于：新闻、实时数据、市场信息
    输入：搜索关键词
    输出：相关搜索结果
    """
    import requests

    headers = {"X-API-KEY": "your_serper_key"}
    payload = {"q": query, "num": 5, "gl": "cn", "hl": "zh-cn"}

    response = requests.post(
        "https://google.serper.dev/search",
        json=payload,
        headers=headers
    )

    results = response.json().get('organic', [])
    if not results:
        return f"没有找到'{query}'的相关结果"

    output = f"搜索'{query}'的结果：\n\n"
    for i, r in enumerate(results[:3], 1):
        output += f"{i}. {r['title']}\n"
        output += f"   {r.get('snippet', '')}\n"
        output += f"   来源：{r['link']}\n\n"

    return output
```

#### 方式 2：继承 BaseTool（最灵活）

```python
from crewai_tools import BaseTool
from pydantic import BaseModel, Field
from typing import Type

class WebScraperInput(BaseModel):
    url: str = Field(description="要抓取的网页URL")
    extract_type: str = Field(
        default="text",
        description="提取类型：text(纯文本)、links(链接)、tables(表格)"
    )

class WebScraperTool(BaseTool):
    """网页内容抓取工具"""

    name: str = "网页抓取"
    description: str = """
    抓取指定网页的内容。
    适用于：获取特定网页的详细内容
    不适用于：需要登录的页面、动态渲染的页面
    """
    args_schema: Type[BaseModel] = WebScraperInput

    def _run(self, url: str, extract_type: str = "text") -> str:
        import requests
        from bs4 import BeautifulSoup

        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            response = requests.get(url, headers=headers, timeout=10)
            response.encoding = 'utf-8'

            soup = BeautifulSoup(response.text, 'html.parser')

            if extract_type == "text":
                for tag in soup(['script', 'style', 'nav', 'footer']):
                    tag.decompose()
                text = soup.get_text(separator='\n', strip=True)
                return text[:2000] + ("..." if len(text) > 2000 else "")

            elif extract_type == "links":
                links = []
                for a in soup.find_all('a', href=True)[:20]:
                    links.append(f"- {a.text.strip()}: {a['href']}")
                return "\n".join(links)

            elif extract_type == "tables":
                tables = []
                for table in soup.find_all('table')[:3]:
                    rows = []
                    for row in table.find_all('tr'):
                        cols = [td.get_text(strip=True)
                                for td in row.find_all(['td', 'th'])]
                        rows.append(' | '.join(cols))
                    tables.append('\n'.join(rows))
                return '\n\n'.join(tables)

        except requests.Timeout:
            return f"访问 {url} 超时，请稍后重试"
        except Exception as e:
            return f"抓取失败：{str(e)}"

web_scraper = WebScraperTool()
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

```python
import requests
import json
import pandas as pd
from datetime import datetime
from crewai_tools import tool


@tool("市场数据搜索")
def market_search(query: str) -> str:
    """
    搜索市场和行业相关信息。
    适用于：市场份额、行业趋势、竞品信息
    输入：具体的市场研究问题
    输出：相关市场数据和分析信息
    """
    mock_data = {
        "手机市场份额": """
        2024年Q1中国手机市场数据：
        - 华为：市场份额20%，同比增长35%
        - 小米：市场份额18%，同比增长8%
        - OPPO：市场份额15%，同比下滑3%
        - vivo：市场份额14%，同比持平
        - 苹果：市场份额16%，同比下滑5%
        - 其他：市场份额17%
        数据来源：IDC 2024Q1报告
        """,
        "折叠屏": """
        2024年折叠屏手机市场：
        - 全球出货量：1500万台，同比增长52%
        - 中国市场：650万台，占全球43%
        - 华为领导国内市场，三星领导全球市场
        - 平均售价：8000-15000元
        数据来源：Counterpoint Research
        """
    }

    for key, data in mock_data.items():
        if key in query:
            return data

    return f"搜索结果：关于'{query}'的市场数据\n市场规模持续增长，具体数据建议参考IDC、Gartner等专业报告。"


@tool("数据分析")
def data_analysis(data: str, analysis_type: str = "trend") -> str:
    """
    对提供的数据进行分析。
    analysis_type选项：
    - trend：趋势分析
    - compare：对比分析
    - summary：数据摘要
    输入：数据内容和分析类型
    输出：分析结论
    """
    if analysis_type == "trend":
        prompt_hint = "识别数据中的增长趋势、季节性特征和异常点"
    elif analysis_type == "compare":
        prompt_hint = "对比不同维度的数据差异，找出关键差距"
    else:
        prompt_hint = "提炼数据中的核心指标和关键结论"

    return f"""
数据分析结果（{analysis_type}）：

原始数据：
{data}

分析结论：
{prompt_hint}

主要发现：
1. 数据整体呈增长态势
2. 头部效应明显，TOP3占据超过50%份额
3. 新兴品牌增速明显高于传统品牌

建议：
- 重点关注增速超过行业平均水平的品牌
- 跟踪市场份额变化趋势
"""


@tool("报告生成")
def generate_report_section(
    section_title: str,
    content: str,
    format_type: str = "markdown"
) -> str:
    """
    生成报告的指定章节。
    format_type：markdown（默认）或 plain
    输入：章节标题和内容
    输出：格式化的报告章节
    """
    if format_type == "markdown":
        return f"""
## {section_title}

{content}

---
*生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}*
"""
    else:
        return f"{section_title}\n\n{content}"


@tool("竞品对比")
def competitor_analysis(
    company_a: str,
    company_b: str,
    dimension: str = "综合"
) -> str:
    """
    对比两家公司在指定维度的竞争态势。
    dimension选项：市场份额、产品、价格、技术、品牌
    输入：两家公司名称和对比维度
    输出：详细的对比分析
    """
    return f"""
{company_a} vs {company_b} {dimension}对比分析：

维度：{dimension}

{company_a}优势：
- 在高端市场具有强品牌认知
- 供应链整合能力强
- 研发投入持续增加

{company_b}优势：
- 性价比突出，中低端市场份额大
- 互联网生态协同效应
- 社区用户活跃度高

总体评估：
两者各有所长，在不同价格带形成差异化竞争。
短期内竞争格局不会发生根本性变化。
"""
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

```python
import os
from datetime import datetime
from crewai import Agent, Task, Crew, Process
from crewai_tools import tool
from langchain_openai import ChatOpenAI

# ========== 环境配置 ==========
os.environ["OPENAI_API_KEY"] = "your_key"


# ========== 工具定义 ==========

@tool("市场数据搜索")
def market_search(query: str) -> str:
    """
    搜索市场和行业数据。
    适用于：市场份额、行业规模、增长趋势
    输入：搜索关键词
    """
    return f"""
搜索'{query}'的结果：

1. 市场规模：2024年中国手机市场规模约3.5亿台，同比下滑2%
2. 品牌格局：
   - 华为：20%（强势回归，增长35%）
   - 苹果：16%（高端市场为主）
   - 小米：18%（性价比路线）
   - OPPO：15%（线下渠道优势）
   - vivo：14%（影像赛道突围）
3. 价格趋势：高端化明显，3000元以上机型占比提升至45%
4. 技术趋势：AI功能成为核心卖点，折叠屏市场持续增长

数据来源：IDC、Counterpoint Research（2024Q1）
"""


@tool("竞品对比分析")
def competitor_compare(
    companies: str,
    dimension: str = "综合竞争力"
) -> str:
    """
    分析多家公司的竞争态势。
    companies：公司名称，用逗号分隔，如"华为,小米,苹果"
    dimension：对比维度，如"市场份额"、"产品策略"、"技术实力"
    """
    company_list = [c.strip() for c in companies.split(",")]

    return f"""
{' vs '.join(company_list)} {dimension}对比分析：

各品牌核心竞争力：

华为：
- 优势：国产旗舰代表，品牌溢价高，5G+卫星通信技术领先
- 劣势：高端芯片受限，海外市场受阻
- 策略：主打国产替代，深耕高端市场

小米：
- 优势：性价比极致，互联网生态完善，粉丝黏性高
- 劣势：品牌溢价不足，高端突破困难
- 策略：冲击高端（小米14系列），保持中端基本盘

苹果：
- 优势：生态护城河深，品牌溢价最强，高端市场主导
- 劣势：价格敏感用户流失，国内市场承压
- 策略：服务生态变现，AI功能差异化

综合判断：
华为强势回归改变了竞争格局，
苹果在高端受到压力，
小米持续向上突破。
"""


@tool("数据趋势分析")
def trend_analysis(
    data_description: str,
    analysis_focus: str = "增长趋势"
) -> str:
    """
    分析数据中的趋势和规律。
    data_description：数据描述
    analysis_focus：分析重点，如"增长趋势"、"市场机会"、"风险点"
    """
    return f"""
趋势分析报告（聚焦：{analysis_focus}）：

基于数据：{data_description[:200]}...

核心趋势：

1. 高端化趋势加速
   - 3000元以上机型占比：40%->45%（同比+5pct）
   - 均价提升至3200元，创历史新高

2. 品牌集中度提升
   - TOP5品牌合计份额：83%（去年78%）
   - 中小品牌持续出清

3. AI成为核心卖点
   - 配备端侧AI的机型：35%->60%（预计年底）

4. 折叠屏高速增长
   - 出货量：800万->1500万台（+87%）
   - 价格快速下探：主力价格带从1.5万降至8000元

机会与风险：
机会：高端AI手机、折叠屏平民化
风险：整体需求疲软、AI功能同质化、渠道竞争加剧
"""


# ========== Agent定义 ==========

llm = ChatOpenAI(model="gpt-4", temperature=0.7)

researcher = Agent(
    role="资深市场研究员",
    goal="搜集全面准确的市场数据，为后续分析提供翔实的原始素材",
    backstory="""
    你是IDC的资深研究员，有15年手机行业研究经验。
    你的工作方法论：
    - 先搜索宏观市场数据（用市场数据搜索工具）
    - 再搜索具体的竞品信息（用竞品对比分析工具）
    - 所有数据必须注明来源
    - 用数据说话，不凭感觉判断
    """,
    tools=[market_search, competitor_compare],
    llm=llm,
    verbose=True,
    max_iter=8,
    allow_delegation=False
)

analyst = Agent(
    role="战略分析专家",
    goal="深度分析市场数据，提炼有价值的商业洞察和战略建议",
    backstory="""
    你是麦肯锡的资深合伙人，擅长市场战略分析。
    你的分析框架：
    - 用趋势分析工具处理数据
    - MECE原则：互相独立、完全穷尽
    - 每个结论必须有数据支撑
    - 洞察要超越表面，挖掘深层原因
    """,
    tools=[trend_analysis, competitor_compare],
    llm=llm,
    verbose=True,
    allow_delegation=False
)

writer = Agent(
    role="高级报告撰写专家",
    goal="将研究数据和分析洞察转化为专业、易读的研究报告",
    backstory="""
    你是Gartner的高级分析师，擅长撰写商业研究报告。
    你的写作风格：
    - 结构严谨：总-分-总
    - 数据丰富：每个观点有数据支撑
    - 洞察深刻：不停留在描述层面
    - 建议具体：可落地，有优先级
    """,
    tools=[],
    llm=llm,
    verbose=True,
    allow_delegation=False
)


# ========== Task定义 ==========

def create_tasks(research_topic: str):

    task1_market = Task(
        description=f"""
        对 [{research_topic}] 进行全面的市场数据搜集。

        必须完成的搜索：
        1. 搜索整体市场规模和增长趋势
        2. 搜索各主要品牌的市场份额
        3. 搜索价格分布和高端化趋势
        4. 搜索折叠屏和AI手机的市场数据

        注意：必须调用工具，不要凭记忆回答！
        """,
        expected_output="""
        结构化的市场数据报告，包含：
        1. 市场规模数据（附来源）
        2. 品牌份额数据（附来源）
        3. 价格分布数据（附来源）
        4. 新兴市场数据（折叠屏、AI手机）
        """,
        agent=researcher
    )

    task2_competitor = Task(
        description=f"""
        对 [{research_topic}] 中的主要竞争品牌进行深度分析。

        分析维度：
        1. 华为 vs 苹果（高端市场竞争）
        2. 小米 vs OPPO vs vivo（中端市场竞争）
        3. 各品牌的核心竞争优势
        4. 竞争格局演变趋势
        """,
        expected_output="""
        竞争格局分析报告，包含：
        1. 各主要品牌的竞争定位
        2. 品牌间的竞争关系
        3. 竞争态势的核心变化
        4. 未来竞争格局预测
        """,
        agent=researcher,
        context=[task1_market]
    )

    task3_analysis = Task(
        description=f"""
        基于已搜集的市场数据，进行深度战略分析。

        分析任务：
        1. 市场趋势分析（增长/下滑的深层原因）
        2. 竞争格局分析（谁在赢，为什么）
        3. 机会识别（未来6-12个月的核心机会）
        4. 风险评估（主要威胁和挑战）
        5. 战略建议（针对不同品牌）
        """,
        expected_output="""
        深度战略分析报告，包含：
        1. 市场趋势及深层驱动因素（数据支撑）
        2. 竞争格局的关键判断
        3. 3-5个核心机会点
        4. 主要风险
        5. 针对性战略建议
        """,
        agent=analyst,
        context=[task1_market, task2_competitor]
    )

    task4_report = Task(
        description=f"""
        基于前三个任务的所有输出，撰写完整的研究报告。

        报告结构：
        # {research_topic} 研究报告

        ## 执行摘要（300字）
        ## 一、市场概况
        ## 二、竞争格局
        ## 三、核心趋势
        ## 四、机会与风险
        ## 五、战略建议

        要求：总字数3000-5000字，Markdown格式，数据充分。
        """,
        expected_output="""
        一份完整的专业研究报告：
        - Markdown格式
        - 包含执行摘要和完整章节
        - 所有数据有来源
        - 有深度洞察和可执行建议
        - 3000-5000字
        """,
        agent=writer,
        context=[task1_market, task2_competitor, task3_analysis]
    )

    return [task1_market, task2_competitor, task3_analysis, task4_report]


# ========== 主程序 ==========

class MarketResearchSystem:
    """市场调研Agent系统"""

    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4", temperature=0.7)
        self.researcher = researcher
        self.analyst = analyst
        self.writer = writer

    def run(self, research_topic: str, output_file: str = None):
        print(f"\n{'='*60}")
        print(f"开始执行市场调研：{research_topic}")
        print(f"{'='*60}\n")

        start_time = datetime.now()

        tasks = create_tasks(research_topic)

        crew = Crew(
            agents=[self.researcher, self.analyst, self.writer],
            tasks=tasks,
            process=Process.sequential,
            verbose=True
        )

        try:
            result = crew.kickoff()

            duration = (datetime.now() - start_time).seconds
            print(f"\n{'='*60}")
            print(f"调研完成！耗时：{duration}秒")
            print(f"{'='*60}\n")

            if output_file:
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(f"# {research_topic}\n\n")
                    f.write(f"*生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}*\n\n")
                    f.write(result)
                print(f"报告已保存到：{output_file}")

            return result

        except Exception as e:
            print(f"\n执行出错：{e}")
            raise


def main():
    system = MarketResearchSystem()
    result = system.run(
        research_topic="2024年中国手机市场",
        output_file="phone_market_report.md"
    )

    print("\n=== 报告预览（前500字）===")
    print(result[:500])


if __name__ == "__main__":
    main()
```

---

## 六、工具调用的异常处理与重试机制

### 1. 多层次异常处理

```python
import time
import functools
from typing import Callable

def with_retry(
    max_retries: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    exceptions: tuple = (Exception,)
):
    """
    重试装饰器
    max_retries: 最大重试次数
    delay: 初始等待时间（秒）
    backoff: 等待时间倍增系数
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)

                except exceptions as e:
                    last_exception = e

                    if attempt < max_retries:
                        print(f"工具调用失败（第{attempt+1}次），"
                              f"{current_delay}秒后重试...\n错误：{e}")
                        time.sleep(current_delay)
                        current_delay *= backoff
                    else:
                        print(f"工具调用最终失败（已重试{max_retries}次）")

            return f"工具调用失败，请稍后重试。错误详情：{last_exception}"

        return wrapper
    return decorator


# 使用重试装饰器
@tool("带重试的网络搜索")
@with_retry(max_retries=3, delay=1.0, exceptions=(Exception,))
def robust_search(query: str) -> str:
    """带自动重试的网络搜索工具。"""
    import requests
    response = requests.get(
        f"https://api.search.com/search?q={query}",
        timeout=5
    )
    return response.json()['results']
```

### 2. 工具调用的降级策略

```python
@tool("智能搜索（带降级）")
def smart_search(query: str) -> str:
    """
    智能搜索：优先使用高质量API，失败时自动降级。
    降级顺序：Serper -> Bing -> 本地知识库 -> 默认回答
    """

    # 优先：Serper搜索
    try:
        result = serper_search(query)
        if result and len(result) > 50:
            return f"[来源：Serper]\n{result}"
    except Exception as e:
        print(f"Serper搜索失败：{e}，尝试降级...")

    # 次选：Bing搜索
    try:
        result = bing_search(query)
        if result and len(result) > 50:
            return f"[来源：Bing]\n{result}"
    except Exception as e:
        print(f"Bing搜索失败：{e}，尝试降级...")

    # 再次：本地知识库
    try:
        result = local_kb_search(query)
        if result:
            return f"[来源：本地知识库]\n{result}"
    except Exception as e:
        print(f"知识库搜索失败：{e}，使用默认回答...")

    return f"暂时无法搜索'{query}'，请稍后重试或换个关键词。"
```

### 3. 工具调用的超时控制

```python
import signal
from contextlib import contextmanager

class TimeoutError(Exception):
    pass

@contextmanager
def timeout(seconds: int):
    """超时控制上下文管理器"""
    def handler(signum, frame):
        raise TimeoutError(f"工具执行超时（{seconds}秒）")

    signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)

    try:
        yield
    finally:
        signal.alarm(0)

# 使用
@tool("带超时的搜索")
def search_with_timeout(query: str) -> str:
    """最多等待10秒的搜索工具"""
    try:
        with timeout(10):
            result = slow_search_api(query)
            return result
    except TimeoutError:
        return f"搜索超时，'{query}'的结果暂时无法获取，请稍后重试"
```

---

## 七、工具调用的成本控制

### 1. Token 消耗统计

```python
class ToolCostTracker:
    """工具调用成本追踪器"""

    def __init__(self):
        self.call_count = {}
        self.token_count = 0
        self.cost_usd = 0.0

    def track_tool_call(self, tool_name: str, input_text: str, output_text: str):
        self.call_count[tool_name] = self.call_count.get(tool_name, 0) + 1

        input_tokens = len(input_text) // 1.5
        output_tokens = len(output_text) // 1.5
        total_tokens = input_tokens + output_tokens

        self.token_count += total_tokens
        self.cost_usd += (input_tokens / 1000 * 0.03 +
                          output_tokens / 1000 * 0.06)

    def report(self):
        print("\n=== 工具调用成本报告 ===")
        print(f"总Token消耗：{self.token_count:,.0f}")
        print(f"估算成本：${self.cost_usd:.4f}")
        print("\n各工具调用次数：")
        for tool, count in sorted(
            self.call_count.items(),
            key=lambda x: x[1],
            reverse=True
        ):
            print(f"  {tool}：{count}次")

tracker = ToolCostTracker()
```

### 2. 调用频率限制

```python
import time
from collections import defaultdict

class RateLimiter:
    """工具调用频率限制器"""

    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls = max_calls
        self.window = window_seconds
        self.calls = defaultdict(list)

    def is_allowed(self, tool_name: str) -> bool:
        now = time.time()
        self.calls[tool_name] = [
            t for t in self.calls[tool_name]
            if now - t < self.window
        ]

        if len(self.calls[tool_name]) >= self.max_calls:
            return False

        self.calls[tool_name].append(now)
        return True

    def wait_if_needed(self, tool_name: str):
        if not self.is_allowed(tool_name):
            wait_time = self.window / self.max_calls
            print(f"工具'{tool_name}'调用频率超限，等待{wait_time:.1f}秒...")
            time.sleep(wait_time)

# 配置：搜索工具每分钟最多10次
rate_limiter = RateLimiter(max_calls=10, window_seconds=60)

@tool("频率受控的搜索")
def rate_limited_search(query: str) -> str:
    """带频率限制的搜索，防止超出API配额"""
    rate_limiter.wait_if_needed("search")
    return actual_search(query)
```

---

## 八、防止工具滥用

### 1. 工具调用安全守卫

```python
class ToolGuard:
    """工具调用安全守卫"""

    DANGEROUS_PATTERNS = [
        "rm -rf", "DROP TABLE", "DELETE FROM",
        "format", "shutdown", "reboot",
        "password", "secret", "token"
    ]

    MAX_ITERATIONS = {
        "web_search": 10,
        "web_scrape": 5,
        "database_query": 20
    }

    def __init__(self):
        self.iteration_count = defaultdict(int)

    def validate_input(self, tool_name: str, input_text: str) -> tuple:
        """
        验证工具调用输入
        返回：(is_safe, reason)
        """
        for pattern in self.DANGEROUS_PATTERNS:
            if pattern.lower() in input_text.lower():
                return False, f"输入包含危险关键词：{pattern}"

        max_iter = self.MAX_ITERATIONS.get(tool_name, 50)
        self.iteration_count[tool_name] += 1

        if self.iteration_count[tool_name] > max_iter:
            return False, f"工具'{tool_name}'调用次数超限（最多{max_iter}次）"

        return True, "安全"

    def safe_execute(self, tool_name: str, tool_func, *args, **kwargs):
        input_str = str(args) + str(kwargs)
        is_safe, reason = self.validate_input(tool_name, input_str)

        if not is_safe:
            return f"工具调用被拒绝：{reason}"

        return tool_func(*args, **kwargs)

guard = ToolGuard()
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
