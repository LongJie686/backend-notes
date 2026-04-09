# 第六讲：可观测性与调试

> 阶段目标：让 Agent 系统变得可追踪、可调试、可评估。

## 学习目标

- 掌握 Agent 日志设计方法
- 理解 Trace 记录与可视化方案
- 学会中间状态持久化
- 掌握 LangSmith / AgentOps 调试工具
- 能进行性能分析和效果评估

---

## 核心内容

### 1. Agent 日志设计

#### 日志层级设计

```python
import logging
import json
from datetime import datetime

class AgentLogger:
    """Agent 专用日志器"""

    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        self.logger = logging.getLogger(f"agent.{agent_name}")

    def log_input(self, input_data: dict):
        """记录 Agent 输入"""
        self.logger.info(json.dumps({
            "type": "agent_input",
            "agent": self.agent_name,
            "timestamp": datetime.now().isoformat(),
            "data": input_data
        }, ensure_ascii=False))

    def log_output(self, output_data: dict):
        """记录 Agent 输出"""
        self.logger.info(json.dumps({
            "type": "agent_output",
            "agent": self.agent_name,
            "timestamp": datetime.now().isoformat(),
            "data": output_data
        }, ensure_ascii=False))

    def log_tool_call(self, tool_name: str, params: dict, result: dict, duration_ms: int):
        """记录工具调用"""
        self.logger.info(json.dumps({
            "type": "tool_call",
            "agent": self.agent_name,
            "tool": tool_name,
            "params": params,
            "result_summary": str(result)[:200],  # 截断避免日志过大
            "duration_ms": duration_ms,
            "timestamp": datetime.now().isoformat()
        }, ensure_ascii=False))

    def log_error(self, error: Exception, context: dict = None):
        """记录错误"""
        self.logger.error(json.dumps({
            "type": "agent_error",
            "agent": self.agent_name,
            "error_type": type(error).__name__,
            "error_message": str(error),
            "context": context,
            "timestamp": datetime.now().isoformat()
        }, ensure_ascii=False))
```

#### 日志格式规范

每条日志应包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 日志类型：agent_input/agent_output/tool_call/agent_error |
| agent | string | Agent 名称 |
| timestamp | string | ISO 格式时间戳 |
| trace_id | string | 追踪ID，关联同一次完整执行 |
| data | object | 日志内容 |

---

### 2. Trace 记录与可视化

#### Trace 数据模型

```python
@dataclass
class TraceRecord:
    trace_id: str           # 全局唯一的追踪ID
    span_id: str            # 当前步骤ID
    parent_span_id: str     # 父步骤ID
    agent_name: str         # Agent 名称
    step_type: str          # 步骤类型：think/action/observe/tool_call
    input_data: dict        # 输入数据
    output_data: dict       # 输出数据
    start_time: datetime    # 开始时间
    end_time: datetime      # 结束时间
    duration_ms: int        # 耗时（毫秒）
    token_usage: dict       # Token 消耗 {input: n, output: n}
    status: str             # 状态：success/error/timeout
    error_message: str      # 错误信息（如有）
```

#### Trace 收集实现

```python
import uuid
from contextlib import contextmanager

class Tracer:
    def __init__(self):
        self.traces = []

    @contextmanager
    def trace_span(self, agent_name: str, step_type: str, input_data: dict):
        span_id = str(uuid.uuid4())
        start_time = datetime.now()

        try:
            yield span_id
            status = "success"
            error_message = None
        except Exception as e:
            status = "error"
            error_message = str(e)
            raise
        finally:
            end_time = datetime.now()
            self.traces.append(TraceRecord(
                trace_id=get_current_trace_id(),
                span_id=span_id,
                parent_span_id=get_current_parent_span_id(),
                agent_name=agent_name,
                step_type=step_type,
                input_data=input_data,
                start_time=start_time,
                end_time=end_time,
                duration_ms=int((end_time - start_time).total_seconds() * 1000),
                status=status,
                error_message=error_message
            ))

# 使用方式
tracer = Tracer()

with tracer.trace_span("researcher", "tool_call", {"query": "AI趋势"}):
    result = search_tool.execute("AI趋势")
```

---

### 3. 中间状态持久化

#### 为什么需要持久化

- 支持断点续跑：任务中断后可以从上次状态恢复
- 支持回溯分析：查看每一步的中间结果
- 支持调试复现：用历史数据复现问题

#### 持久化方案

```python
import redis
import json

class StatePersistence:
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.from_url(redis_url)

    def save_state(self, trace_id: str, state: dict):
        """保存当前状态"""
        key = f"agent_state:{trace_id}"
        self.redis.set(key, json.dumps(state, ensure_ascii=False))
        self.redis.expire(key, 86400 * 7)  # 7天过期

    def load_state(self, trace_id: str) -> dict:
        """加载状态"""
        key = f"agent_state:{trace_id}"
        data = self.redis.get(key)
        if data:
            return json.loads(data)
        return None

    def save_checkpoint(self, trace_id: str, step: str, state: dict):
        """保存检查点"""
        key = f"agent_checkpoint:{trace_id}:{step}"
        self.redis.set(key, json.dumps(state, ensure_ascii=False))
```

#### LangGraph 内置持久化

```python
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.checkpoint.redis import RedisSaver

# SQLite 持久化（单机）
checkpointer = SqliteSaver.from_conn_string("checkpoints.db")

# Redis 持久化（分布式）
checkpointer = RedisSaver.from_conn_string("redis://localhost:6379")

app = workflow.compile(checkpointer=checkpointer)

# 执行时传入 thread_id
config = {"configurable": {"thread_id": "trace-001"}}
result = app.invoke(input_data, config)
```

---

### 4. 调试工具

#### LangSmith

LangSmith 是 LangChain 官方的可观测性平台。

```python
# 配置 LangSmith
import os
os.environ["LANGSMITH_API_KEY"] = "your-api-key"
os.environ["LANGSMITH_PROJECT"] = "multi-agent-system"

# 自动追踪 LangChain/LangGraph 的所有调用
# 无需额外代码，所有 trace 自动上传

# 功能：
# - 可视化 Trace 链路
# - Token 消耗统计
# - 输入输出对比
# - 延迟分析
# - 反馈评分
```

#### AgentOps

AgentOps 是独立的 Agent 监控平台。

```python
import agentops

# 初始化
agentops.init(api_key="your-api-key")

# 自动记录 Agent 执行过程
@agentops.record_action("research")
def research_agent(query):
    return search_and_analyze(query)

# 记录工具调用
@agentops.record_tool("web_search")
def search_web(query):
    return search(query)

# 结束会话
agentops.end_session("Success")
```

#### 自建调试面板

```python
# 关键指标面板
DEBUG_METRICS = {
    "total_requests": 0,
    "total_tokens": 0,
    "total_cost": 0.0,
    "avg_latency_ms": 0,
    "error_rate": 0.0,
    "tool_call_success_rate": 0.0
}

# Flask API 暴露指标
@app.route("/debug/metrics")
def get_metrics():
    return jsonify(DEBUG_METRICS)

@app.route("/debug/traces/<trace_id>")
def get_trace(trace_id):
    return jsonify(tracer.get_trace(trace_id))

@app.route("/debug/replay/<trace_id>")
def replay_trace(trace_id):
    """使用历史数据重放执行过程"""
    trace = tracer.get_trace(trace_id)
    return jsonify(replay(trace))
```

---

### 5. 性能分析

#### 关键性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 首次响应时间 | < 2s | 用户感知到系统开始工作的时间 |
| 端到端延迟 | < 30s | 完整任务执行时间 |
| Token 效率 | > 80% | 有效输出 Token 占比 |
| 工具调用成功率 | > 95% | 工具正常返回的比例 |
| 并发处理能力 | > 50 QPS | 系统可同时处理的请求数 |

#### 性能优化方向

```python
class PerformanceAnalyzer:
    def analyze_trace(self, trace: list):
        """分析单次执行的 Trace 数据"""
        report = {
            "total_duration_ms": 0,
            "llm_calls": 0,
            "tool_calls": 0,
            "total_tokens": 0,
            "total_cost": 0.0,
            "bottlenecks": []
        }

        for span in trace:
            report["total_duration_ms"] += span.duration_ms

            if span.step_type == "llm_call":
                report["llm_calls"] += 1
                report["total_tokens"] += span.token_usage.get("total", 0)

            if span.step_type == "tool_call":
                report["tool_calls"] += 1

            # 识别瓶颈：耗时超过平均值的 2 倍
            avg_duration = report["total_duration_ms"] / len(trace)
            if span.duration_ms > avg_duration * 2:
                report["bottlenecks"].append({
                    "step": span.agent_name,
                    "duration_ms": span.duration_ms,
                    "suggestion": "考虑缓存或并行化"
                })

        return report
```

#### 优化策略

| 瓶颈类型 | 优化手段 |
|---------|---------|
| LLM 调用慢 | 使用更快的模型、减少 Prompt 长度、流式输出 |
| 工具调用慢 | 并行调用、缓存结果、优化工具实现 |
| Token 浪费 | 精简 Prompt、控制输出长度、复用上下文 |
| 串行等待 | 改为并行执行、预取数据 |

---

### 6. 效果评估

#### 评估维度

```python
class AgentEvaluator:
    """Agent 效果评估器"""

    def evaluate(self, predictions: list, references: list) -> dict:
        return {
            "accuracy": self._calc_accuracy(predictions, references),
            "format_compliance": self._calc_format_compliance(predictions),
            "relevance": self._calc_relevance(predictions, references),
            "completeness": self._calc_completeness(predictions, references),
            "hallucination_rate": self._calc_hallucination(predictions, references)
        }

    def _calc_accuracy(self, predictions, references):
        """准确率：与标准答案的匹配度"""
        correct = sum(1 for p, r in zip(predictions, references) if self._match(p, r))
        return correct / len(predictions)

    def _calc_format_compliance(self, predictions):
        """格式合规率：输出是否符合预期格式"""
        compliant = sum(1 for p in predictions if self._check_format(p))
        return compliant / len(predictions)

    def _calc_relevance(self, predictions, references):
        """相关性：输出是否切题"""
        scores = [self._semantic_sim(p, r) for p, r in zip(predictions, references)]
        return sum(scores) / len(scores)

    def _calc_hallucination(self, predictions, references):
        """幻觉率：输出中编造内容的比例"""
        hallucinated = sum(1 for p in predictions if self._detect_hallucination(p))
        return hallucinated / len(predictions)
```

#### 评估指标体系

| 指标 | 评估方式 | 合格线 |
|------|---------|--------|
| 准确率 | 自动 + 人工 | > 85% |
| 格式合规率 | 自动 | > 95% |
| 相关性 | LLM-as-Judge | > 80% |
| 完整性 | 规则检查 | > 90% |
| 幻觉率 | 自动检测 | < 5% |
| 用户满意度 | 用户评分 | > 4.0/5 |

---

## 实战项目

### 项目：研报生成系统 v2（加监控）

**目标**：为第二讲的研报生成系统添加完整的可观测性。

**功能要求**：
1. 结构化日志记录每个 Agent 的输入输出
2. Trace 链路可视化（使用 LangSmith 或自建）
3. 中间状态持久化到 Redis，支持断点续跑
4. 性能分析面板：展示延迟、Token 消耗、瓶颈分布
5. 效果评估：对生成的报告进行自动评分

---

## 练习题

### 概念题

1. Trace 和日志的区别是什么？各自解决什么问题？
2. 为什么中间状态持久化对生产系统至关重要？
3. 效果评估中，"幻觉率"如何检测？

### 实践题

1. 为一个简单的 ReAct Agent 添加完整的日志和 Trace 记录。
2. 使用 LangSmith 追踪一次完整的 Multi-Agent 执行过程。
3. 设计一套评估指标，量化 RAG 系统的回答质量。

---

## 小结

本讲学习了可观测性与调试的完整方案。关键要点：

- 日志要结构化，包含 trace_id、agent_name、timestamp 等关键字段
- Trace 记录是理解 Agent 行为链路的核心手段
- 中间状态持久化是生产系统的基本要求
- LangSmith 和 AgentOps 能大幅降低调试成本
- 性能分析要聚焦瓶颈识别和优化
- 效果评估需要建立多维度的指标体系

下一讲将学习安全护栏与治理，让 Agent 系统"安全可控"。
