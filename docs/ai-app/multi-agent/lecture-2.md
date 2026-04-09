# 第 2 讲：角色分工与任务编排

## 核心结论（5 条必记）

1. **角色设计四原则** -- 职责单一、边界清晰、可测试、可替换，缺一不可
2. **三种编排模式灵活组合** -- 顺序（有依赖）、并行（无依赖）、条件分支（按质量判断），根据任务特征选用
3. **状态设计要控制大小、保持不可变** -- 每次流转产生新状态，包含足够上下文，避免 Token 浪费
4. **终止条件必须包含最大迭代次数和超时保护** -- 防止 Agent 间无限循环
5. **LangGraph 的状态机模型是当前最灵活的生产级编排方案** -- 支持循环、条件分支、持久化

---

## 一、Agent 角色设计

### 角色设计原则

好的角色设计应该满足以下条件：
- **职责单一**：每个 Agent 只负责一类任务
- **边界清晰**：明确输入输出的格式和约束
- **可测试性**：每个 Agent 可以独立测试
- **可替换性**：替换某个 Agent 不影响其他部分

### 常见角色类型

| 角色 | 职责 | 典型 Prompt 前缀 | 适用模型 |
|------|------|-----------------|---------|
| Researcher | 信息搜索与整理 | "你是一个专业的研究员..." | 强推理模型 |
| Writer | 内容生成与撰写 | "你是一个技术写作专家..." | 通用模型 |
| Reviewer | 质量审核与反馈 | "你是一个严格的审核员..." | 强推理模型 |
| Coder | 代码生成与调试 | "你是一个高级软件工程师..." | 代码专用模型 |
| Planner | 任务规划与分解 | "你是一个项目管理者..." | 强推理模型 |
| Validator | 输出验证与格式检查 | "你是一个质量检查员..." | 轻量模型 |

### 角色定义模板

```python
agent_config = {
    "name": "Researcher",
    "role": "负责搜索和整理相关信息",
    "backstory": "你是一名拥有10年经验的研究员，擅长从海量信息中提取关键要点",
    "goal": "提供准确、全面、结构化的研究资料",
    "input_format": {"topic": "str", "requirements": "list[str]"},
    "output_format": {"findings": "list[str]", "sources": "list[str]", "summary": "str"},
    "model": "qwen-plus",
    "max_iterations": 5,
    "tools": ["search_engine", "web_scraper"]
}
```

---

## 二、输入输出接口定义

### 接口设计原则

- 使用结构化数据格式（JSON Schema）
- 明确必填字段和可选字段
- 定义字段的类型、范围和默认值
- 包含版本号以支持接口演进

### 接口定义示例

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class ResearcherInput(BaseModel):
    topic: str = Field(description="研究主题")
    depth: str = Field(default="medium", description="研究深度: shallow/medium/deep")
    language: str = Field(default="zh", description="输出语言")
    max_sources: int = Field(default=10, description="最大来源数量")

class ResearcherOutput(BaseModel):
    findings: List[str] = Field(description="关键发现列表")
    sources: List[str] = Field(description="信息来源URL列表")
    summary: str = Field(description="研究摘要")
    confidence: float = Field(ge=0, le=1, description="置信度")
```

---

## 三、任务分解与编排

### 顺序执行（Sequential）

Agent 按顺序依次执行，前一个的输出是后一个的输入。

```
Researcher -> Writer -> Reviewer
```

适用场景：有明确前后依赖关系的流程。

```python
# LangGraph 顺序编排
from langgraph.graph import StateGraph, END

workflow = StateGraph(AgentState)
workflow.add_node("researcher", researcher_agent)
workflow.add_node("writer", writer_agent)
workflow.add_node("reviewer", reviewer_agent)

workflow.set_entry_point("researcher")
workflow.add_edge("researcher", "writer")
workflow.add_edge("writer", "reviewer")
workflow.add_edge("reviewer", END)
```

### 并行执行（Parallel）

多个 Agent 同时执行，结果汇聚后继续。

```
        -> Researcher_A ->
Planner                   -> Aggregator -> Writer
        -> Researcher_B ->
```

适用场景：子任务之间无依赖、需要提高效率。

```python
# LangGraph 并行编排
workflow.add_node("researcher_a", researcher_a_agent)
workflow.add_node("researcher_b", researcher_b_agent)
workflow.add_node("aggregator", aggregator_agent)

workflow.set_entry_point("researcher_a")  # 两个节点同时启动
# 使用 fan-out/fan-in 模式
```

### 条件分支（Conditional）

根据中间结果决定下一步执行哪个 Agent。

```
Researcher -> [判断] -> Writer (通过)
                   -> Researcher (不通过，继续搜索)
```

适用场景：需要根据质量判断决定流程走向。

```python
# LangGraph 条件分支
def should_continue(state):
    if state["quality_score"] >= 0.8:
        return "writer"
    elif state["retry_count"] >= 3:
        return "end_with_warning"
    else:
        return "researcher"

workflow.add_conditional_edges("reviewer", should_continue)
```

---

## 四、Agent 间状态传递

### 状态设计原则

- 状态应该是不可变的（Immutable），每次流转产生新状态
- 包含足够上下文信息，避免 Agent 丢失关键信息
- 控制状态大小，避免 Token 浪费

### 状态定义示例

```python
from typing import TypedDict, Annotated, List
import operator

class AgentState(TypedDict):
    # 任务信息
    task_id: str
    task_description: str

    # 各 Agent 的输出
    research_findings: List[str]
    draft_content: str
    review_feedback: List[str]

    # 控制信息
    current_step: str
    retry_count: int
    quality_score: float
    error_messages: Annotated[List[str], operator.add]
```

### 状态传递方式

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 共享状态 | 简单直接、全量可见 | 状态膨胀 | 简单流程 |
| 消息传递 | 解耦、灵活 | 实现复杂 | 大规模系统 |
| 事件驱动 | 异步、可扩展 | 调试困难 | 实时系统 |

---

## 五、终止条件设计

### 常见终止条件

```python
class TerminationConfig:
    # 最大迭代次数
    max_iterations: int = 10

    # 质量达标即终止
    quality_threshold: float = 0.8

    # 超时终止
    timeout_seconds: int = 300

    # 关键字终止
    stop_keywords: List[str] = ["TASK_COMPLETE", "NO_MORE_STEPS"]

    # 连续无改进终止
    max_no_improvement: int = 3
```

### 终止条件检查

```python
def check_termination(state: AgentState) -> bool:
    # 检查迭代次数
    if state["retry_count"] >= MAX_ITERATIONS:
        return True

    # 检查质量分数
    if state.get("quality_score", 0) >= QUALITY_THRESHOLD:
        return True

    # 检查超时
    if time.time() - state["start_time"] > TIMEOUT_SECONDS:
        return True

    return False
```

---

## 六、LangGraph 状态机编排实战

### 完整的研报生成系统

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

# 1. 定义状态
class ReportState(TypedDict):
    topic: str
    research_data: dict
    outline: str
    draft: str
    review_comments: list
    final_report: str
    iteration: int

# 2. 定义 Agent 节点
def researcher_node(state):
    research_data = research(state["topic"])
    return {"research_data": research_data}

def planner_node(state):
    outline = generate_outline(state["research_data"])
    return {"outline": outline}

def writer_node(state):
    draft = write_report(state["outline"], state["research_data"])
    return {"draft": draft}

def reviewer_node(state):
    comments, score = review(state["draft"])
    return {"review_comments": comments, "quality_score": score}

# 3. 条件路由
def route_after_review(state):
    if state["quality_score"] >= 0.8:
        return "finalize"
    elif state["iteration"] >= 3:
        return "finalize"
    else:
        return "revise"

# 4. 构建工作流
workflow = StateGraph(ReportState)
workflow.add_node("researcher", researcher_node)
workflow.add_node("planner", planner_node)
workflow.add_node("writer", writer_node)
workflow.add_node("reviewer", reviewer_node)
workflow.add_node("finalizer", lambda s: {"final_report": s["draft"]})

workflow.set_entry_point("researcher")
workflow.add_edge("researcher", "planner")
workflow.add_edge("planner", "writer")
workflow.add_edge("writer", "reviewer")
workflow.add_conditional_edges("reviewer", route_after_review, {
    "finalize": "finalizer",
    "revise": "writer"
})
workflow.add_edge("finalizer", END)

# 5. 编译并运行
checkpointer = MemorySaver()
app = workflow.compile(checkpointer=checkpointer)
result = app.invoke({"topic": "2024年AI行业发展趋势", "iteration": 0})
```

---

## 练习题（待完成）

- [ ] 练习1：设计一个"市场调研系统"的角色分工方案，至少包含 4 个 Agent
- [ ] 练习2：使用 LangGraph 实现一个包含条件分支的工作流，区分"内容问题"和"格式问题"分别路由到不同的修复 Agent
- [ ] 练习3：为上述工作流设计完整的状态结构，包含所有必要字段和控制信息
- [ ] 练习4：说明角色设计中"职责单一"和"可替换性"的重要性
