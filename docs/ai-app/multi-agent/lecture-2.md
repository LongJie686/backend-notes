# 第 2 讲：角色分工与任务编排实战（CrewAI 深度实战）

## 核心结论（10 条必记）

1. **Agent 设计三要素** -- Role（具体）、Goal（聚焦）、Backstory（专业），缺一不可
2. **Task 设计两原则** -- Description（详细到像 PRD）、Expected Output（明确格式和长度）
3. **一个 Agent 一件事** -- 不要让 Agent 身兼数职，否则输出不可控
4. **用 Context 建立依赖** -- 后续 Task 能看到前置输出，避免信息丢失
5. **Backstory 决定行为风格** -- 同样的 Role，不同的 Backstory 会产出截然不同的结果
6. **Expected Output 要有示例** -- 格式、结构、长度都要明确，最好给模板
7. **工具要匹配角色** -- 研究员用搜索，分析师不需要，乱配工具会导致幻觉
8. **国产模型易替换** -- 只需实现 LLM 接口，CrewAI 对模型无绑定
9. **verbose=True 必开** -- 开发阶段不开等于盲飞
10. **先串行后并行** -- 先把流程跑通，再考虑优化和复杂编排

---

## 一、为什么选择 CrewAI？

### CrewAI vs LangChain

| 维度 | CrewAI | LangChain |
|------|--------|-----------|
| 学习曲线 | 平缓，概念清晰 | 陡峭，抽象层次高 |
| 代码量 | 少，简洁直观 | 多，配置复杂 |
| 角色建模 | 天然支持，核心特性 | 需要自己设计 |
| 任务编排 | 内置 Task 系统 | 需要用 LangGraph 等 |
| 适合场景 | 业务流程明确的企业应用 | 需要极致灵活性的场景 |
| 生产级特性 | 开箱即用 | 需要大量定制 |

**结论：**
- **学习阶段** -- CrewAI 更友好
- **企业应用** -- CrewAI 更高效
- **复杂定制** -- 后续再学 LangGraph

---

## 二、CrewAI 核心概念

CrewAI 的设计哲学是**模拟一个专业团队的协作方式**。

### 三大核心组件

```
+-------------------------------------------+
|           CrewAI 核心架构                  |
+-------------------------------------------+
|                                           |
|  +------------------------------------+  |
|  |  Crew（团队）                       |  |
|  |  - 协调所有 Agent                   |  |
|  |  - 定义执行流程                     |  |
|  +----------+-------------------------+  |
|             |                             |
|    +--------+--------+                   |
|    v                 v                   |
|  +---------+    +---------+             |
|  | Agent   |    |  Task   |             |
|  | (角色)  |--->| (任务)  |             |
|  +---------+    +---------+             |
|      |                                     |
|      v                                     |
|  +---------+                              |
|  |  Tool   |                              |
|  | (工具)  |                              |
|  +---------+                              |
|                                           |
+-------------------------------------------+
```

### 1. Agent（智能体/角色）

**定义一个 Agent 需要明确：**
- **Role**（角色）：我是谁？
- **Goal**（目标）：我的使命是什么？
- **Backstory**（背景故事）：我的专业能力是什么？
- **Tools**（工具）：我能用什么工具？
- **LLM**（大模型）：我用什么模型思考？

**示例：研究员 Agent**

```python
from crewai import Agent

researcher = Agent(
    role="市场研究员",
    goal="搜集手机市场的最新数据和趋势",
    backstory="""
    你是一位经验丰富的市场研究专家，擅长：
    - 搜集行业数据
    - 识别市场趋势
    - 分析竞争格局
    你的研究报告总是数据翔实、洞察深刻。
    """,
    tools=[search_tool, scrape_tool],
    verbose=True,
    allow_delegation=False  # 不允许委托任务给其他 Agent
)
```

**关键点：**
- **Role 要具体**：不要写"助手"，要写"市场研究员"
- **Goal 要聚焦**：一个 Agent 只做一件事
- **Backstory 要专业**：这会影响 Agent 的行为风格
- **Tools 要匹配**：研究员用搜索工具，分析师用分析工具

### 2. Task（任务）

**定义一个 Task 需要明确：**
- **Description**（任务描述）：要做什么？
- **Expected Output**（期望输出）：输出什么格式？
- **Agent**（执行者）：谁来做？
- **Context**（上下文）：依赖哪些前置任务？

**示例：市场调研任务**

```python
from crewai import Task

research_task = Task(
    description="""
    调研2024年中国手机市场：
    1. 搜索TOP5品牌的市场份额
    2. 分析价格区间分布
    3. 总结主要趋势

    关键词：华为、小米、OPPO、vivo、苹果
    """,
    expected_output="""
    一份结构化的调研报告，包含：
    - 市场份额数据（JSON格式）
    - 价格分布分析
    - 3-5个核心趋势
    """,
    agent=researcher
)
```

**关键点：**
- **Description 要具体**：明确步骤、关键词、范围
- **Expected Output 要明确**：格式、内容、长度
- **避免模糊指令**：不要写"调研市场"，要写"调研TOP5品牌的市场份额"

### 3. Crew（团队）

**Crew 负责：**
- 组织所有 Agent
- 编排 Task 执行顺序
- 管理 Agent 间的协作

```python
from crewai import Crew, Process

crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, writing_task],
    process=Process.sequential,  # 串行执行
    verbose=True
)

result = crew.kickoff()
```

**Process 类型：**
- **Sequential**（串行）：Task1 -> Task2 -> Task3
- **Hierarchical**（层级）：主 Agent 分配任务（企业版功能）

---

## 三、实战项目：研报自动生成系统 v1

### 需求分析

**用户需求：**"我想生成一份《2024年中国手机市场调研报告》，包含市场格局、竞争态势、趋势分析。"

**拆解成 Multi-Agent 任务：**

```
Agent 1: 市场研究员
任务：搜集市场数据
输出：原始数据和关键信息
        |
Agent 2: 数据分析师
任务：分析数据，提炼洞察
输出：分析结论和图表数据
        |
Agent 3: 报告撰写者
任务：撰写专业报告
输出：完整的研报文档
```

### Step 1: 环境准备

```bash
# 安装依赖
pip install crewai crewai-tools openai

# 或者用国产模型
pip install crewai qianfan  # 文心一言
```

**配置 API Key：**

```python
import os

# 方案1：用 OpenAI
os.environ["OPENAI_API_KEY"] = "your_openai_key"

# 方案2：用文心一言
os.environ["QIANFAN_AK"] = "your_ak"
os.environ["QIANFAN_SK"] = "your_sk"
```

### Step 2: 定义工具

```python
from crewai_tools import SerperDevTool, ScrapeWebsiteTool, tool

# 工具1：搜索工具（需要 Serper API Key）
search_tool = SerperDevTool()

# 工具2：网页抓取工具
scrape_tool = ScrapeWebsiteTool()

# 如果没有 Serper API，可以自定义简单搜索工具
@tool("简单搜索")
def simple_search(query: str) -> str:
    """搜索工具（演示版），实际项目中应该对接真实搜索 API"""
    return f"""
    搜索关键词：{query}

    结果：
    1. 2024年Q1中国手机市场份额：
       - 华为：20%
       - 小米：18%
       - OPPO：15%
       - vivo：14%
       - 苹果：16%

    2. 价格分布：
       - 1000-2000元：35%
       - 2000-4000元：40%
       - 4000元以上：25%

    3. 主要趋势：
       - 高端化趋势明显
       - 折叠屏市场增长
       - AI手机成为新卖点
    """
```

### Step 3: 定义 Agent

```python
from crewai import Agent
from langchain_openai import ChatOpenAI

# 初始化 LLM
llm = ChatOpenAI(model="gpt-4", temperature=0.7)

# Agent 1: 市场研究员
researcher = Agent(
    role="资深市场研究员",
    goal="搜集手机市场的全面、准确的数据",
    backstory="""
    你是一位拥有10年经验的科技行业市场研究专家。
    你的优势：
    - 熟悉各大数据源和行业报告
    - 擅长快速定位关键信息
    - 对数字敏感，注重数据准确性

    工作风格：
    - 系统性搜集信息
    - 交叉验证数据
    - 注明信息来源
    """,
    tools=[simple_search],
    llm=llm,
    verbose=True,
    allow_delegation=False
)

# Agent 2: 数据分析师
analyst = Agent(
    role="数据分析专家",
    goal="从数据中提炼有价值的商业洞察",
    backstory="""
    你是一位数据驱动的战略分析师，拥有MBA学位。
    你的优势：
    - 擅长发现数据背后的趋势
    - 能够做跨维度对比分析
    - 洞察力强，结论有深度

    工作风格：
    - 结构化思考
    - 数据可视化
    - 注重商业价值
    """,
    llm=llm,
    verbose=True,
    allow_delegation=False
)

# Agent 3: 报告撰写者
writer = Agent(
    role="专业商业分析师",
    goal="撰写清晰、专业、有洞察力的研究报告",
    backstory="""
    你是一位顶级咨询公司的资深分析师，擅长撰写商业报告。
    你的优势：
    - 文笔专业、逻辑清晰
    - 擅长数据叙事
    - 能够平衡深度与可读性

    写作风格：
    - 结构完整（背景-现状-趋势-建议）
    - 论据充分（数据+案例）
    - 语言精练（专业但不晦涩）
    """,
    llm=llm,
    verbose=True,
    allow_delegation=False
)
```

**关键点：**
- **Backstory 要塑造"人设"**：这会影响 Agent 的思考方式
- **每个 Agent 只分配匹配的工具**：研究员用搜索，分析师不需要工具
- **allow_delegation=False**：防止 Agent 互相推诿

### Step 4: 定义 Task

```python
from crewai import Task

# 任务1：市场调研
research_task = Task(
    description="""
    调研2024年中国手机市场，重点关注：

    1. 市场格局
       - TOP5品牌市场份额
       - 各品牌增长趋势

    2. 价格分布
       - 不同价格段的销量占比
       - 均价变化趋势

    3. 技术趋势
       - 折叠屏市场规模
       - AI功能普及情况
       - 影像技术竞争

    搜索关键词：
    - "2024年手机市场份额"
    - "手机价格趋势"
    - "折叠屏手机销量"
    - "AI手机"
    """,
    expected_output="""
    一份结构化的调研数据，包含：

    ## 市场格局
    - 品牌市场份额（百分比）
    - 增长率数据

    ## 价格分布
    - 各价格段占比
    - 平均售价

    ## 技术趋势
    - 关键技术的市场渗透率
    - 未来趋势判断

    注：所有数据需标注来源
    """,
    agent=researcher
)

# 任务2：数据分析
analysis_task = Task(
    description="""
    基于调研数据，进行深度分析：

    1. 竞争格局分析
       - 识别市场领导者、挑战者、跟随者
       - 分析各品牌的竞争优势
       - 预测格局演变

    2. 价格策略分析
       - 分析价格区间竞争态势
       - 识别价格战/高端化趋势

    3. 技术趋势分析
       - 哪些技术成为主流
       - 哪些技术是差异化竞争点
       - 未来6-12个月的技术方向

    分析要求：
    - 有数据支撑
    - 有逻辑推理
    - 有行业洞察
    """,
    expected_output="""
    一份分析报告，包含：

    ## 竞争格局分析
    - 市场定位矩阵（文字描述）
    - 各品牌SWOT简析
    - 格局演变预测

    ## 价格策略分析
    - 主要价格带的竞争态势
    - 价格趋势判断

    ## 技术趋势分析
    - 当前主流技术
    - 新兴技术机会
    - 技术演进预测

    每个结论需有数据/逻辑支撑
    """,
    agent=analyst,
    context=[research_task]  # 依赖研究任务的输出
)

# 任务3：报告撰写
writing_task = Task(
    description="""
    撰写一份专业的《2024年中国手机市场调研报告》。

    报告结构：

    # 一、市场概况
    - 市场规模
    - 增长趋势
    - 主要玩家

    # 二、竞争格局
    - 市场份额分析
    - 品牌定位分析
    - 竞争态势总结

    # 三、价格分析
    - 价格分布
    - 价格策略
    - 价格趋势

    # 四、技术趋势
    - 当前主流技术
    - 新兴技术方向
    - 技术竞争焦点

    # 五、未来展望
    - 市场预测
    - 机会与挑战
    - 战略建议

    写作要求：
    - 语言专业但易懂
    - 数据充分
    - 逻辑严谨
    - 洞察深刻
    - 总字数3000-5000字
    """,
    expected_output="""
    一份完整的研究报告（Markdown格式），包含：
    - 清晰的章节结构
    - 充分的数据支撑
    - 深刻的商业洞察
    - 可执行的战略建议

    输出格式：Markdown
    """,
    agent=writer,
    context=[research_task, analysis_task]  # 依赖前两个任务
)
```

**关键点：**
- **Description 要详细**：像写 PRD 一样写清楚要求
- **Expected Output 要具体**：明确格式、结构、长度
- **Context 建立任务依赖**：后续任务能看到前置任务的输出

### Step 5: 组建 Crew 并执行

```python
from crewai import Crew, Process

# 组建团队
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analysis_task, writing_task],
    process=Process.sequential,  # 串行执行
    verbose=True  # 显示详细日志
)

# 执行
print("开始生成研报...")
result = crew.kickoff()

# 输出结果
print("\n" + "=" * 50)
print("研报生成完成！")
print("=" * 50)
print(result)

# 保存到文件
with open("market_report.md", "w", encoding="utf-8") as f:
    f.write(result)
print("\n报告已保存到 market_report.md")
```

### Step 6: 完整代码

将以上 Step 1-5 的代码整合即为完整可运行脚本，核心结构：

```
配置 API Key → 定义工具 → 定义 Agent（3个）→ 定义 Task（3个）→ 组建 Crew → kickoff()
```

完整代码约 100 行，详见各步骤的代码片段。

---

## 四、执行过程详解

运行后你会看到类似这样的输出：

```
[DEBUG]: == Working Agent: 市场研究员
[INFO]: == Starting Task: 调研2024年中国手机市场...

> Entering new CrewAgentExecutor chain...

Thought: 我需要搜集市场份额数据
Action: 市场搜索
Action Input: {"query": "2024年手机市场份额"}

Observation: 搜索结果：华为20%、小米18%...

Thought: 我还需要搜集价格信息
Action: 市场搜索
Action Input: {"query": "手机价格分布"}

Observation: 1000-2000元：35%...

Thought: 我已经搜集到足够的数据
Final Answer: [结构化的调研数据]

[DEBUG]: == Working Agent: 数据分析师
[INFO]: == Starting Task: 分析竞争格局...

Thought: 基于调研数据，我发现华为和小米处于领先...
Final Answer: [深度分析报告]

[DEBUG]: == Working Agent: 报告撰写者
[INFO]: == Starting Task: 撰写研报...

Final Answer:
# 2024年中国手机市场调研报告
## 一、市场概况
...
```

**关键观察点：**
1. Agent 按顺序执行（researcher -> analyst -> writer）
2. 每个 Agent 能看到前置任务的输出
3. Agent 会根据任务描述调用工具
4. 最终输出符合 Expected Output 的要求

---

## 五、用国产模型替换 OpenAI

CrewAI 默认用 OpenAI，但可以轻松换成国产模型。

### 方案1：用文心一言

实现 `LLM` 基类的 `_call` 和 `_llm_type` 方法即可适配：

```python
from langchain.llms.base import LLM
import qianfan

class WenxinLLM(LLM):
    def _call(self, prompt: str, stop=None) -> str:
        return qianfan.ChatCompletion().do(
            model="ERNIE-4.0-8K",
            messages=[{"role": "user", "content": prompt}]
        )['result']

    @property
    def _llm_type(self) -> str:
        return "wenxin"

llm = WenxinLLM()
```

### 方案2：用通义千问

```python
from langchain_community.llms import Tongyi

llm = Tongyi(
    model_name="qwen-max",
    dashscope_api_key="your_api_key"
)
```

### 方案3：用智谱 AI

```python
from langchain_community.chat_models import ChatZhipuAI

llm = ChatZhipuAI(
    model="glm-4",
    api_key="your_api_key"
)
```

---

## 六、任务编排的高级技巧

### 技巧1：任务依赖管理

```python
# 场景：分析任务需要等待多个数据源
market_research = Task(...)
competitor_research = Task(...)
tech_research = Task(...)

analysis_task = Task(
    description="综合分析",
    context=[market_research, competitor_research, tech_research],
    agent=analyst
)
```

**效果：** 分析师能看到所有前置任务的输出

### 技巧2：条件执行

```python
# CrewAI 原生不支持条件执行，可以通过 Agent 逻辑实现

quality_checker = Agent(
    role="质量检查员",
    goal="评估报告质量，决定是否需要重写",
    backstory="严格的质量审查专家",
    llm=llm
)

check_task = Task(
    description="""
    评估报告质量：
    - 数据是否充分
    - 逻辑是否严谨
    - 结论是否有洞察

    如果质量不达标，输出："需要重写"并说明原因
    如果质量达标，输出："通过"
    """,
    expected_output="评估结果和建议",
    agent=quality_checker,
    context=[writing_task]
)
```

### 技巧3：并行执行

```python
# CrewAI 社区版只支持 sequential
# 企业版支持 hierarchical（层级式）

crew = Crew(
    agents=[...],
    tasks=[...],
    process=Process.hierarchical,  # 需要企业版
    manager_llm=llm  # 主 Agent
)
```

**如果想要并行，可以用 LangGraph：**

```python
from langgraph.graph import StateGraph

graph = StateGraph(...)
graph.add_node("research1", researcher1)
graph.add_node("research2", researcher2)
graph.add_edge("research1", "analysis")
graph.add_edge("research2", "analysis")  # 并行
```

---

## 七、调试与优化

### 常见问题1：Agent 输出格式不对

**现象：** 期望 JSON 格式的市场份额数据，实际输出一段文字描述

**解决方案：**

```python
research_task = Task(
    description="...",
    expected_output="""
    必须输出JSON格式：
    ```json
    {
      "market_share": {
        "华为": 20,
        "小米": 18,
        ...
      }
    }
    ```
    不要输出其他格式！
    """,
    agent=researcher
)
```

**关键点：** 在 Expected Output 中明确要求格式，甚至给示例

### 常见问题2：Agent 没有调用工具

**现象：** Agent 直接"编造"数据，没有调用搜索工具

**解决方案：**

```python
researcher = Agent(
    role="市场研究员",
    goal="搜集真实数据",
    backstory="""
    你是严谨的研究员，必须基于真实数据。
    你绝不编造数据，所有信息必须通过搜索工具获取。
    """,
    tools=[search_tool],
    llm=llm,
    verbose=True
)

research_task = Task(
    description="""
    使用搜索工具，搜集以下信息：
    1. 搜索"2024年手机市场份额"
    2. 搜索"手机价格分布"

    不要编造数据，必须基于搜索结果！
    """,
    ...
)
```

**关键点：**
- 在 Backstory 中强调"不编造"
- 在 Description 中明确"必须用工具"

### 常见问题3：任务间信息丢失

**现象：** 分析师没有看到研究员的完整数据

**解决方案：**

```python
analysis_task = Task(
    description="""
    基于前置研究任务的完整数据进行分析。

    首先，总结研究员提供的数据：
    - 市场份额数据
    - 价格分布数据
    - 技术趋势数据

    然后，进行深度分析...
    """,
    context=[research_task],  # 确保 context 设置正确
    agent=analyst
)
```

**关键点：** 让 Agent 先"复述"前置信息，确保看到了

### 常见问题4：输出太短或太长

**解决方案：**

```python
writing_task = Task(
    description="...",
    expected_output="""
    一份3000-5000字的报告。

    字数要求：
    - 市场概况：500-800字
    - 竞争格局：800-1200字
    - 价格分析：600-800字
    - 技术趋势：600-800字
    - 未来展望：500-800字

    如果字数不够，需要补充案例和数据。
    """,
    agent=writer
)
```

---

## 八、生产级优化

### 优化1：错误处理 + 重试

`crew.kickoff()` 外层包裹 try/except，失败后自动重试（建议 3 次），间隔可使用递增等待。

### 优化2：日志记录

使用 Python `logging` 模块，同时输出到文件和控制台，记录 Crew 执行的开始/结束时间。

### 优化3：成本监控

用 `tiktoken` 统计每次调用的 Token 消耗，按 GPT-4 定价（输入 $0.03/1K、输出 $0.06/1K）估算费用。

### 优化4：缓存

对 Task 的 description 做 MD5 哈希作为缓存 key，结果存为 JSON 文件。相同任务直接返回缓存，避免重复调用 LLM。

---

## 九、练习题

- [ ] 练习1：Agent 的 Role、Goal、Backstory 分别影响什么？
- [ ] 练习2：Task 的 Context 参数有什么作用？
- [ ] 练习3：设计一个"小红书爆款文案生成系统"，至少3个 Agent、3个 Task，画出架构图
- [ ] 练习4：基于本讲的研报系统，改造成"竞品分析报告生成系统"，输入两个竞品名称，输出对比分析报告
