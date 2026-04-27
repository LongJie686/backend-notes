# 第6讲：可观测性与调试——让Agent系统透明可控

欢迎进入企业级AI系统的核心能力！

前五讲我们构建了完整的Multi-Agent系统：
- 架构设计 → 角色编排 → RAG知识库 → 工具调用 → Prompt优化

但你会发现上线后最大的噩梦：

**你不知道Agent在干什么。**

```
用户反馈："这个AI回答错了"
你：为什么错了？是哪一步出问题的？
    是搜索工具没找到数据？
    还是LLM理解错了问题？
    还是Prompt设计有问题？
    还是RAG检索不准？
    ……完全不知道
```

没有可观测性的Agent系统就像**黑盒子**：
- 出了问题不知道从哪里查
- 性能瓶颈不知道在哪里
- 成本失控不知道谁消耗的
- 用户投诉无法复现问题

**这一讲，我们把黑盒变成玻璃盒。**

---

## 一、可观测性的三大支柱

### **经典可观测性模型**

```
┌─────────────────────────────────────────────┐
│         可观测性三大支柱                     │
├─────────────────────────────────────────────┤
│                                             │
│  ① Logs（日志）                            │
│     记录发生了什么事                        │
│     "Agent在10:30调用了搜索工具"            │
│                                             │
│  ② Traces（追踪）                          │
│     记录一次请求的完整链路                  │
│     "用户问题→Agent决策→工具调用→生成答案"  │
│                                             │
│  ③ Metrics（指标）                         │
│     记录系统的整体状态                      │
│     "今天成功率98%，平均耗时8秒"           │
│                                             │
│  三者缺一不可：                             │
│  日志告诉你"发生了什么"                     │
│  追踪告诉你"哪里出了问题"                   │
│  指标告诉你"系统是否健康"                   │
│                                             │
└─────────────────────────────────────────────┘
```

---

### **Agent系统特有的可观测需求**

普通Web系统的可观测性已经很成熟，但Agent系统有特殊挑战：

| 挑战 | 普通系统 | Agent系统 |
|------|---------|----------|
| **执行路径** | 固定 | 动态，每次不同 |
| **调用深度** | 浅（3-5层） | 深（10-20层） |
| **耗时分布** | 可预测 | 高度不确定 |
| **成本** | 固定 | 随Token变化 |
| **失败原因** | 代码错误 | 模型行为+代码+外部工具 |
| **复现难度** | 低 | 高（LLM有随机性） |

---

## 二、日志系统设计

### **1. Agent日志的分级规范**

```python
import logging
import json
import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from pathlib import Path


class AgentLogLevel(Enum):
    """Agent专用日志级别"""
    DEBUG = "DEBUG"       # 详细调试信息
    INFO = "INFO"         # 正常流程记录
    WARNING = "WARNING"   # 潜在问题
    ERROR = "ERROR"       # 错误（可恢复）
    CRITICAL = "CRITICAL" # 严重错误（不可恢复）


class AgentEventType(Enum):
    """Agent事件类型"""
    # Agent生命周期
    AGENT_START = "agent.start"
    AGENT_END = "agent.end"
    AGENT_ERROR = "agent.error"
    
    # LLM调用
    LLM_REQUEST = "llm.request"
    LLM_RESPONSE = "llm.response"
    LLM_ERROR = "llm.error"
    
    # 工具调用
    TOOL_CALL = "tool.call"
    TOOL_RESULT = "tool.result"
    TOOL_ERROR = "tool.error"
    
    # RAG检索
    RAG_QUERY = "rag.query"
    RAG_RESULT = "rag.result"
    
    # 任务流程
    TASK_START = "task.start"
    TASK_END = "task.end"
    TASK_ERROR = "task.error"
    
    # 业务事件
    USER_INPUT = "user.input"
    FINAL_OUTPUT = "final.output"
```

---

### **2. 结构化日志记录器**

```python
class AgentLogger:
    """
    企业级Agent结构化日志记录器
    
    特点：
    - 结构化JSON日志（便于ELK/Splunk分析）
    - 完整上下文追踪（trace_id/span_id）
    - 自动计时和Token统计
    - 敏感信息脱敏
    """
    
    def __init__(
        self,
        service_name: str,
        log_dir: str = "./logs",
        log_level: str = "INFO",
        enable_console: bool = True,
        enable_file: bool = True,
        mask_sensitive: bool = True
    ):
        self.service_name = service_name
        self.mask_sensitive = mask_sensitive
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        # 配置Python原生logger
        self.logger = logging.getLogger(service_name)
        self.logger.setLevel(getattr(logging, log_level))
        self.logger.handlers.clear()
        
        # 控制台Handler
        if enable_console:
            console_handler = logging.StreamHandler()
            console_handler.setFormatter(self._get_formatter())
            self.logger.addHandler(console_handler)
        
        # 文件Handler（按天滚动）
        if enable_file:
            log_file = self.log_dir / f"{service_name}_{datetime.now():%Y%m%d}.log"
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            file_handler.setFormatter(self._get_formatter())
            self.logger.addHandler(file_handler)
        
        # JSON日志文件（用于结构化分析）
        self.json_log_file = self.log_dir / f"{service_name}_{datetime.now():%Y%m%d}.jsonl"
        
        # 敏感字段列表
        self.sensitive_fields = [
            'api_key', 'password', 'token', 'secret',
            'phone', 'id_card', 'bank_card'
        ]
    
    def _get_formatter(self):
        return logging.Formatter(
            fmt='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    
    def _mask_sensitive_data(self, data: Any) -> Any:
        """脱敏处理"""
        if not self.mask_sensitive:
            return data
        
        if isinstance(data, dict):
            masked = {}
            for k, v in data.items():
                if any(sf in k.lower() for sf in self.sensitive_fields):
                    masked[k] = "***MASKED***"
                else:
                    masked[k] = self._mask_sensitive_data(v)
            return masked
        
        elif isinstance(data, str):
            # 手机号脱敏
            import re
            data = re.sub(r'1[3-9]\d{9}', '1XX-XXXX-XXXX', data)
            # 邮箱脱敏
            data = re.sub(r'\b[\w.-]+@[\w.-]+\.\w+\b', 
                         lambda m: m.group()[0] + '***@***.***', data)
            return data
        
        return data
    
    def _write_json_log(self, log_entry: dict):
        """写入JSON结构化日志"""
        with open(self.json_log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
    
    def log_event(
        self,
        event_type: AgentEventType,
        level: AgentLogLevel = AgentLogLevel.INFO,
        trace_id: str = "",
        span_id: str = "",
        agent_name: str = "",
        data: Dict = None,
        duration_ms: float = None,
        tokens: Dict = None,
        error: Exception = None
    ):
        """
        记录一个Agent事件
        
        trace_id: 整个请求的唯一ID
        span_id: 当前操作的唯一ID
        agent_name: 哪个Agent触发了这个事件
        data: 事件相关数据
        duration_ms: 耗时（毫秒）
        tokens: Token消耗 {"input": 100, "output": 200}
        error: 如果有错误
        """
        
        # 构建日志条目
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "service": self.service_name,
            "event_type": event_type.value,
            "level": level.value,
            "trace_id": trace_id,
            "span_id": span_id or str(uuid.uuid4())[:8],
            "agent_name": agent_name,
        }
        
        # 添加数据（脱敏）
        if data:
            log_entry["data"] = self._mask_sensitive_data(data)
        
        # 添加性能指标
        if duration_ms is not None:
            log_entry["duration_ms"] = round(duration_ms, 2)
        
        if tokens:
            log_entry["tokens"] = tokens
            # 估算成本（GPT-4定价）
            input_cost = tokens.get("input", 0) / 1000 * 0.03
            output_cost = tokens.get("output", 0) / 1000 * 0.06
            log_entry["cost_usd"] = round(input_cost + output_cost, 6)
        
        # 添加错误信息
        if error:
            log_entry["error"] = {
                "type": type(error).__name__,
                "message": str(error),
            }
        
        # 写入JSON日志
        self._write_json_log(log_entry)
        
        # 写入普通日志
        log_msg = (
            f"[{event_type.value}] "
            f"trace={trace_id[:8] if trace_id else 'N/A'} "
            f"agent={agent_name or 'N/A'}"
        )
        
        if duration_ms:
            log_msg += f" duration={duration_ms:.0f}ms"
        if tokens:
            log_msg += f" tokens={sum(tokens.values())}"
        if error:
            log_msg += f" error={type(error).__name__}"
        
        log_func = getattr(
            self.logger,
            level.value.lower(),
            self.logger.info
        )
        log_func(log_msg)
    
    # ========== 便捷方法 ==========
    
    def log_agent_start(self, trace_id: str, agent_name: str,
                        task: str):
        self.log_event(
            event_type=AgentEventType.AGENT_START,
            trace_id=trace_id,
            agent_name=agent_name,
            data={"task": task[:200]}
        )
    
    def log_llm_call(self, trace_id: str, agent_name: str,
                     prompt_preview: str, tokens: dict,
                     duration_ms: float, response_preview: str):
        self.log_event(
            event_type=AgentEventType.LLM_RESPONSE,
            trace_id=trace_id,
            agent_name=agent_name,
            data={
                "prompt_preview": prompt_preview[:100],
                "response_preview": response_preview[:100]
            },
            duration_ms=duration_ms,
            tokens=tokens
        )
    
    def log_tool_call(self, trace_id: str, agent_name: str,
                      tool_name: str, tool_input: str,
                      tool_output: str, duration_ms: float,
                      success: bool = True):
        self.log_event(
            event_type=AgentEventType.TOOL_RESULT if success 
                       else AgentEventType.TOOL_ERROR,
            level=AgentLogLevel.INFO if success else AgentLogLevel.WARNING,
            trace_id=trace_id,
            agent_name=agent_name,
            data={
                "tool_name": tool_name,
                "input": tool_input[:200],
                "output": tool_output[:200],
                "success": success
            },
            duration_ms=duration_ms
        )
    
    def log_error(self, trace_id: str, agent_name: str,
                  error: Exception, context: str = ""):
        self.log_event(
            event_type=AgentEventType.AGENT_ERROR,
            level=AgentLogLevel.ERROR,
            trace_id=trace_id,
            agent_name=agent_name,
            data={"context": context},
            error=error
        )


# 初始化全局日志器
agent_logger = AgentLogger(
    service_name="market_research_agent",
    log_dir="./logs",
    log_level="INFO",
    enable_console=True,
    enable_file=True
)
```

---

## 三、Trace追踪系统

### **1. Trace的概念**

```
一次完整的用户请求 = 一个Trace
Trace由多个Span组成：

Trace: user_query_001
├── Span: 用户输入处理 (10ms)
├── Span: Agent1-研究员 (5200ms)
│   ├── Span: LLM调用#1 (1200ms)
│   ├── Span: 工具调用-搜索 (800ms)
│   ├── Span: LLM调用#2 (1500ms)
│   └── Span: 工具调用-抓取 (1200ms)
├── Span: Agent2-分析师 (3800ms)
│   ├── Span: LLM调用#1 (1800ms)
│   └── Span: 工具调用-分析 (600ms)
├── Span: Agent3-写作者 (4200ms)
│   └── Span: LLM调用#1 (4200ms)
└── Span: 输出处理 (50ms)

总耗时: 13260ms
总Token: 8500
总成本: $0.68
```

---

### **2. 自定义Trace系统**

```python
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from datetime import datetime


@dataclass
class Span:
    """追踪Span"""
    span_id: str
    trace_id: str
    parent_span_id: Optional[str]
    name: str
    start_time: float
    end_time: Optional[float] = None
    status: str = "running"  # running/success/error
    attributes: Dict = field(default_factory=dict)
    events: List[Dict] = field(default_factory=list)
    
    @property
    def duration_ms(self) -> Optional[float]:
        if self.end_time:
            return round((self.end_time - self.start_time) * 1000, 2)
        return None
    
    def add_event(self, name: str, data: dict = None):
        """添加事件到Span"""
        self.events.append({
            "name": name,
            "timestamp": datetime.now().isoformat(),
            "data": data or {}
        })
    
    def set_attribute(self, key: str, value):
        """设置Span属性"""
        self.attributes[key] = value
    
    def finish(self, status: str = "success", error: str = None):
        """完成Span"""
        self.end_time = time.time()
        self.status = status
        if error:
            self.attributes["error"] = error
    
    def to_dict(self) -> dict:
        return {
            "span_id": self.span_id,
            "trace_id": self.trace_id,
            "parent_span_id": self.parent_span_id,
            "name": self.name,
            "start_time": datetime.fromtimestamp(self.start_time).isoformat(),
            "end_time": datetime.fromtimestamp(self.end_time).isoformat() 
                       if self.end_time else None,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "attributes": self.attributes,
            "events": self.events
        }


class TraceManager:
    """
    Trace追踪管理器
    
    功能：
    - 创建和管理Trace
    - 支持嵌套Span（父子关系）
    - 自动计算耗时
    - 导出Trace报告
    """
    
    def __init__(self, logger: AgentLogger = None):
        self.traces: Dict[str, List[Span]] = {}
        self.active_spans: Dict[str, Span] = {}
        self.logger = logger
        self._span_stack: List[str] = []  # 当前活跃Span栈
    
    def start_trace(self, name: str = "") -> str:
        """开始一个新的Trace"""
        trace_id = str(uuid.uuid4())[:12]
        self.traces[trace_id] = []
        print(f"Trace开始: {trace_id} [{name}]")
        return trace_id
    
    def start_span(
        self,
        trace_id: str,
        name: str,
        attributes: dict = None
    ) -> Span:
        """开始一个新的Span"""
        parent_span_id = self._span_stack[-1] if self._span_stack else None
        
        span = Span(
            span_id=str(uuid.uuid4())[:8],
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            name=name,
            start_time=time.time(),
            attributes=attributes or {}
        )
        
        self.traces[trace_id].append(span)
        self.active_spans[span.span_id] = span
        self._span_stack.append(span.span_id)
        
        return span
    
    def end_span(self, span: Span, status: str = "success",
                 error: str = None):
        """结束一个Span"""
        span.finish(status=status, error=error)
        
        if span.span_id in self._span_stack:
            self._span_stack.remove(span.span_id)
        
        if span.span_id in self.active_spans:
            del self.active_spans[span.span_id]
    
    @contextmanager
    def span(self, trace_id: str, name: str, attributes: dict = None):
        """
        上下文管理器：自动管理Span的开始和结束
        
        用法：
        with tracer.span(trace_id, "LLM调用") as span:
            span.set_attribute("model", "gpt-4")
            result = llm.invoke(prompt)
            span.set_attribute("tokens", token_count)
        """
        s = self.start_span(trace_id, name, attributes)
        
        try:
            yield s
            self.end_span(s, status="success")
        except Exception as e:
            self.end_span(s, status="error", error=str(e))
            raise
    
    def get_trace_summary(self, trace_id: str) -> dict:
        """获取Trace摘要"""
        spans = self.traces.get(trace_id, [])
        if not spans:
            return {}
        
        total_duration = sum(
            s.duration_ms or 0 for s in spans
        )
        total_tokens = sum(
            s.attributes.get("tokens", {}).get("total", 0)
            for s in spans
        )
        total_cost = sum(
            s.attributes.get("cost_usd", 0)
            for s in spans
        )
        
        error_spans = [s for s in spans if s.status == "error"]
        
        return {
            "trace_id": trace_id,
            "total_spans": len(spans),
            "total_duration_ms": round(total_duration, 2),
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 6),
            "error_count": len(error_spans),
            "status": "error" if error_spans else "success"
        }
    
    def print_trace_tree(self, trace_id: str):
        """打印Trace树形结构"""
        spans = self.traces.get(trace_id, [])
        if not spans:
            print(f"Trace {trace_id} 不存在")
            return
        
        summary = self.get_trace_summary(trace_id)
        
        print(f"\n{'='*60}")
        print(f"Trace: {trace_id}")
        print(f"总耗时: {summary['total_duration_ms']:.0f}ms")
        print(f"总Token: {summary['total_tokens']}")
        print(f"总成本: ${summary['total_cost_usd']:.6f}")
        print(f"状态: {'成功' if summary['status'] == 'success' else '失败'}")
        print(f"{'='*60}")
        
        # 构建树形
        def print_span(span: Span, indent: int = 0):
            prefix = "  " * indent + ("├─ " if indent > 0 else "")
            status_icon = "[OK]" if span.status == "success" else "[FAIL]"
            duration = f"{span.duration_ms:.0f}ms" if span.duration_ms else "running"
            
            print(f"{prefix}{status_icon} {span.name} [{duration}]")
            
            # 显示关键属性
            if span.attributes.get("tool_name"):
                print(f"{'  ' * (indent+1)}工具: {span.attributes['tool_name']}")
            if span.attributes.get("model"):
                print(f"{'  ' * (indent+1)}模型: {span.attributes['model']}")
            tokens = span.attributes.get("tokens", {})
            if tokens:
                print(f"{'  ' * (indent+1)}Token: {tokens}")
            if span.status == "error":
                print(f"{'  ' * (indent+1)}错误: {span.attributes.get('error', '未知')}")
        
        # 找根Span（无父Span）
        root_spans = [s for s in spans if not s.parent_span_id]
        for root in root_spans:
            print_span(root, 0)
            # 找子Span
            children = [s for s in spans 
                        if s.parent_span_id == root.span_id]
            for child in children:
                print_span(child, 1)
                grandchildren = [s for s in spans 
                                 if s.parent_span_id == child.span_id]
                for gc in grandchildren:
                    print_span(gc, 2)
        
        print(f"{'='*60}\n")
    
    def export_trace(self, trace_id: str, 
                     output_file: str = None) -> dict:
        """导出Trace数据"""
        spans = self.traces.get(trace_id, [])
        trace_data = {
            "trace_id": trace_id,
            "summary": self.get_trace_summary(trace_id),
            "spans": [s.to_dict() for s in spans]
        }
        
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(trace_data, f, ensure_ascii=False, indent=2)
            print(f"Trace已导出: {output_file}")
        
        return trace_data


# 全局Trace管理器
tracer = TraceManager(logger=agent_logger)
```

---

### **3. 把Trace集成到Agent系统**

```python
from crewai import Agent, Task, Crew
from langchain_openai import ChatOpenAI
from crewai_tools import tool
import functools


def traced_tool(tool_func):
    """
    工具调用追踪装饰器
    自动记录工具的调用、耗时、结果
    """
    @functools.wraps(tool_func)
    def wrapper(*args, **kwargs):
        # 从上下文获取trace_id（简化处理）
        trace_id = getattr(wrapper, '_current_trace_id', 'unknown')
        tool_name = tool_func.__name__
        
        start_time = time.time()
        
        # 记录工具开始
        agent_logger.log_event(
            event_type=AgentEventType.TOOL_CALL,
            trace_id=trace_id,
            data={
                "tool_name": tool_name,
                "args": str(args)[:200],
                "kwargs": str(kwargs)[:200]
            }
        )
        
        try:
            result = tool_func(*args, **kwargs)
            duration_ms = (time.time() - start_time) * 1000
            
            agent_logger.log_tool_call(
                trace_id=trace_id,
                agent_name="",
                tool_name=tool_name,
                tool_input=str(args)[:200],
                tool_output=str(result)[:200],
                duration_ms=duration_ms,
                success=True
            )
            
            return result
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            agent_logger.log_tool_call(
                trace_id=trace_id,
                agent_name="",
                tool_name=tool_name,
                tool_input=str(args)[:200],
                tool_output=str(e),
                duration_ms=duration_ms,
                success=False
            )
            raise
    
    return wrapper


class ObservableCrewRunner:
    """
    带完整可观测性的Crew执行器
    
    功能：
    - 自动生成trace_id
    - 记录每个Agent的执行
    - 统计Token消耗和成本
    - 捕获并记录错误
    - 生成执行报告
    """
    
    def __init__(
        self,
        crew: Crew,
        logger: AgentLogger,
        tracer: TraceManager
    ):
        self.crew = crew
        self.logger = logger
        self.tracer = tracer
        self.execution_history = []
    
    def run(self, inputs: dict = None) -> dict:
        """
        执行Crew并记录完整追踪
        
        返回：
        {
            "result": "最终输出",
            "trace_id": "xxx",
            "summary": {执行摘要},
            "success": True/False
        }
        """
        # 生成追踪ID
        trace_id = self.tracer.start_trace(
            name=f"crew_execution_{datetime.now():%H%M%S}"
        )
        
        # 记录用户输入
        self.logger.log_event(
            event_type=AgentEventType.USER_INPUT,
            trace_id=trace_id,
            data={"inputs": str(inputs)[:500] if inputs else ""}
        )
        
        start_time = time.time()
        result = None
        success = False
        error_info = None
        
        # 主执行Span
        with self.tracer.span(trace_id, "crew.execute") as main_span:
            try:
                # 执行Crew
                if inputs:
                    result = self.crew.kickoff(inputs=inputs)
                else:
                    result = self.crew.kickoff()
                
                success = True
                main_span.set_attribute("success", True)
                
                # 记录输出
                self.logger.log_event(
                    event_type=AgentEventType.FINAL_OUTPUT,
                    trace_id=trace_id,
                    data={"output_preview": str(result)[:500]}
                )
                
            except Exception as e:
                success = False
                error_info = str(e)
                main_span.set_attribute("success", False)
                main_span.set_attribute("error", error_info)
                
                self.logger.log_error(
                    trace_id=trace_id,
                    agent_name="crew",
                    error=e,
                    context="Crew执行失败"
                )
                
                raise
            
            finally:
                # 记录总耗时
                total_duration = (time.time() - start_time) * 1000
                main_span.set_attribute(
                    "total_duration_ms",
                    round(total_duration, 2)
                )
        
        # 获取执行摘要
        summary = self.tracer.get_trace_summary(trace_id)
        
        # 打印追踪树
        self.tracer.print_trace_tree(trace_id)
        
        # 保存执行历史
        execution_record = {
            "trace_id": trace_id,
            "timestamp": datetime.now().isoformat(),
            "success": success,
            "summary": summary,
            "inputs": inputs,
            "error": error_info
        }
        self.execution_history.append(execution_record)
        
        # 导出Trace
        self.tracer.export_trace(
            trace_id,
            f"./traces/trace_{trace_id}.json"
        )
        
        return {
            "result": str(result) if result else None,
            "trace_id": trace_id,
            "summary": summary,
            "success": success,
            "error": error_info
        }
    
    def get_performance_report(self) -> str:
        """生成性能报告"""
        if not self.execution_history:
            return "暂无执行记录"
        
        total_runs = len(self.execution_history)
        success_runs = sum(1 for r in self.execution_history if r['success'])
        
        durations = [
            r['summary'].get('total_duration_ms', 0)
            for r in self.execution_history
            if r['success']
        ]
        
        costs = [
            r['summary'].get('total_cost_usd', 0)
            for r in self.execution_history
        ]
        
        report = f"""
=== 性能报告 ===

执行统计：
  总运行次数：{total_runs}
  成功次数：{success_runs}
  失败次数：{total_runs - success_runs}
  成功率：{success_runs/total_runs*100:.1f}%

耗时统计：
  平均耗时：{sum(durations)/len(durations):.0f}ms
  最短耗时：{min(durations):.0f}ms
  最长耗时：{max(durations):.0f}ms

成本统计：
  总成本：${sum(costs):.4f}
  平均成本：${sum(costs)/len(costs):.4f}
  
最近5次执行：
"""
        for record in self.execution_history[-5:]:
            status = "[OK]" if record['success'] else "[FAIL]"
            duration = record['summary'].get('total_duration_ms', 0)
            cost = record['summary'].get('total_cost_usd', 0)
            report += f"  {status} {record['timestamp'][:19]} | "
            report += f"{duration:.0f}ms | ${cost:.4f}\n"
        
        return report
```

---

## 四、LangSmith集成实战

### **1. 什么是LangSmith？**

```
LangSmith是LangChain官方提供的Agent可观测性平台：
- 自动追踪所有LLM调用
- 可视化Agent的决策链路
- 支持调试和回放
- 提供评估和测试功能
- 免费版够用
```

---

### **2. LangSmith快速接入**

```python
import os
from langsmith import Client
from langsmith.wrappers import wrap_openai
from langchain_openai import ChatOpenAI

# 配置LangSmith
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_ENDPOINT"] = "https://api.smith.langchain.com"
os.environ["LANGCHAIN_API_KEY"] = "your_langsmith_api_key"
os.environ["LANGCHAIN_PROJECT"] = "market-research-agent"  # 项目名

# 就这么简单！LangChain会自动追踪所有调用
llm = ChatOpenAI(model="gpt-4", temperature=0)

# 现在所有LLM调用都会被自动追踪到LangSmith
response = llm.invoke("你好")
```

**接入后你能看到：**
- 每次LLM调用的输入输出
- Token消耗和成本
- 调用链路的完整树形图
- 每个步骤的耗时分布

---

### **3. 给Trace加自定义标签**

```python
from langsmith import traceable

# @traceable装饰器：自动追踪函数执行
@traceable(
    name="市场调研-研究阶段",
    tags=["research", "market-analysis"],
    metadata={"version": "v1.2"}
)
def run_research_phase(topic: str) -> str:
    """研究阶段（自动追踪）"""
    
    # 内部的LLM调用也会被追踪
    llm = ChatOpenAI(model="gpt-4")
    result = llm.invoke(f"调研{topic}市场")
    
    return result.content


@traceable(name="市场调研-分析阶段")
def run_analysis_phase(research_data: str) -> str:
    """分析阶段（自动追踪）"""
    llm = ChatOpenAI(model="gpt-4")
    result = llm.invoke(f"分析以下数据：{research_data}")
    return result.content


# 执行（所有调用自动追踪到LangSmith）
research = run_research_phase("手机市场")
analysis = run_analysis_phase(research)
```

---

### **4. LangSmith评估实战**

```python
from langsmith import Client
from langsmith.evaluation import evaluate, LangChainStringEvaluator

client = Client()

# 创建评估数据集
dataset = client.create_dataset(
    dataset_name="市场调研质量评估",
    description="评估研报生成Agent的输出质量"
)

# 添加测试样本
examples = [
    {
        "inputs": {"topic": "2024年手机市场"},
        "outputs": {"answer": "华为市场份额20%，同比增长35%..."}
    },
    {
        "inputs": {"topic": "折叠屏手机趋势"},
        "outputs": {"answer": "2024年折叠屏市场规模1500万台..."}
    }
]

for example in examples:
    client.create_example(
        inputs=example["inputs"],
        outputs=example["outputs"],
        dataset_id=dataset.id
    )


# 定义被测试的函数
def research_agent(inputs: dict) -> dict:
    """被评估的Agent函数"""
    topic = inputs["topic"]
    
    llm = ChatOpenAI(model="gpt-4")
    result = llm.invoke(f"分析{topic}，给出关键数据和趋势")
    
    return {"answer": result.content}


# 评估配置
evaluators = [
    LangChainStringEvaluator(
        "qa",  # 问答准确性评估
        config={
            "llm": ChatOpenAI(model="gpt-4")
        }
    ),
    LangChainStringEvaluator(
        "criteria",  # 自定义标准评估
        config={
            "criteria": {
                "has_data": "回答中是否包含具体数据？",
                "is_structured": "回答是否有清晰的结构？",
                "cites_sources": "回答是否提及数据来源？"
            },
            "llm": ChatOpenAI(model="gpt-4")
        }
    )
]

# 运行评估
results = evaluate(
    research_agent,
    data=dataset.name,
    evaluators=evaluators,
    experiment_prefix="v1-baseline"
)

print(f"评估结果：{results}")
```

---

## 五、Agent调试技巧

### **1. 常见问题诊断清单**

```python
class AgentDebugger:
    """
    Agent问题诊断工具
    帮助快速定位常见问题
    """
    
    COMMON_ISSUES = {
        "无限循环": {
            "症状": ["Agent一直在思考没有输出", "日志显示重复调用工具"],
            "原因": ["缺少终止条件", "工具返回结果不明确", "Prompt没有明确目标"],
            "解决": [
                "设置max_iterations限制",
                "工具返回值加上明确的完成标志",
                "Prompt中明确说明何时停止"
            ]
        },
        "输出格式错误": {
            "症状": ["JSON解析失败", "返回纯文本而非结构化格式"],
            "原因": ["Prompt格式要求不够明确", "模型温度过高"],
            "解决": [
                "在Prompt中给出具体示例",
                "temperature设为0或0.1",
                "使用OutputFixingParser"
            ]
        },
        "工具不被调用": {
            "症状": ["Agent直接回答而不使用工具", "工具调用日志为空"],
            "原因": ["工具描述不够清晰", "Agent认为不需要工具"],
            "解决": [
                "改善工具的Description",
                "在Task中明确要求使用工具",
                "在Backstory中强调必须使用工具"
            ]
        },
        "输出质量差": {
            "症状": ["内容浅显无深度", "缺乏数据支撑"],
            "原因": ["System Prompt不够专业", "缺少Few-shot示例"],
            "解决": [
                "加强角色定义的专业性",
                "增加高质量Few-shot示例",
                "在Task中明确质量标准"
            ]
        },
        "响应超慢": {
            "症状": ["单次调用超过30秒", "用户等待时间过长"],
            "原因": ["工具调用次数过多", "Prompt太长", "模型本身延迟"],
            "解决": [
                "限制工具调用次数",
                "压缩Prompt长度",
                "换用更快的模型（gpt-3.5-turbo）"
            ]
        }
    }
    
    def diagnose(self, trace_data: dict) -> list:
        """
        根据Trace数据诊断问题
        """
        issues_found = []
        spans = trace_data.get("spans", [])
        summary = trace_data.get("summary", {})
        
        # 检查1：是否有错误
        error_spans = [s for s in spans if s.get("status") == "error"]
        if error_spans:
            issues_found.append({
                "issue": "执行错误",
                "severity": "HIGH",
                "spans": [s["name"] for s in error_spans],
                "suggestion": "检查错误日志，优先修复"
            })
        
        # 检查2：耗时过长
        total_duration = summary.get("total_duration_ms", 0)
        if total_duration > 60000:  # 超过60秒
            slow_spans = [
                s for s in spans
                if (s.get("duration_ms") or 0) > 10000
            ]
            issues_found.append({
                "issue": "响应过慢",
                "severity": "MEDIUM",
                "detail": f"总耗时{total_duration/1000:.0f}秒",
                "slow_spans": [s["name"] for s in slow_spans],
                "suggestion": "考虑并行执行或减少工具调用"
            })
        
        # 检查3：Token消耗过高
        total_tokens = summary.get("total_tokens", 0)
        if total_tokens > 50000:
            issues_found.append({
                "issue": "Token消耗过高",
                "severity": "MEDIUM",
                "detail": f"共消耗{total_tokens}个Token",
                "suggestion": "压缩Prompt，减少不必要的上下文"
            })
        
        # 检查4：工具调用次数异常
        tool_spans = [s for s in spans if "tool" in s.get("name", "").lower()]
        if len(tool_spans) > 20:
            issues_found.append({
                "issue": "工具调用过多",
                "severity": "MEDIUM",
                "detail": f"工具调用{len(tool_spans)}次",
                "suggestion": "可能有循环，检查终止条件"
            })
        
        # 检查5：成本异常
        total_cost = summary.get("total_cost_usd", 0)
        if total_cost > 1.0:
            issues_found.append({
                "issue": "单次成本过高",
                "severity": "LOW",
                "detail": f"本次成本${total_cost:.4f}",
                "suggestion": "考虑使用更便宜的模型或缓存"
            })
        
        return issues_found
    
    def suggest_fix(self, issue_name: str) -> dict:
        """获取问题修复建议"""
        return self.COMMON_ISSUES.get(issue_name, {
            "症状": ["未知问题"],
            "解决": ["查看完整日志进行分析"]
        })
    
    def print_diagnosis(self, trace_data: dict):
        """打印诊断报告"""
        issues = self.diagnose(trace_data)
        
        print("\n=== Agent诊断报告 ===\n")
        
        if not issues:
            print("未发现明显问题，系统运行正常\n")
            return
        
        for issue in issues:
            severity_icon = {
                "HIGH": "[HIGH]",
                "MEDIUM": "[MEDIUM]",
                "LOW": "[LOW]"
            }.get(issue["severity"], "[INFO]")
            
            print(f"{severity_icon} {issue['issue']}")
            if "detail" in issue:
                print(f"   详情：{issue['detail']}")
            if "suggestion" in issue:
                print(f"   建议：{issue['suggestion']}")
            print()


debugger = AgentDebugger()
```

---

### **2. 实时调试工具**

```python
class AgentInspector:
    """
    Agent实时检查工具
    用于开发调试阶段
    """
    
    def __init__(self, llm):
        self.llm = llm
        self.checkpoints = []
    
    def checkpoint(self, name: str, data: any, 
                   trace_id: str = ""):
        """
        设置检查点，保存中间状态
        在Agent执行的关键位置调用
        """
        checkpoint = {
            "name": name,
            "timestamp": datetime.now().isoformat(),
            "trace_id": trace_id,
            "data_preview": str(data)[:500],
            "data_type": type(data).__name__
        }
        self.checkpoints.append(checkpoint)
        
        print(f"\n检查点: {name}")
        print(f"   数据类型: {type(data).__name__}")
        print(f"   数据预览: {str(data)[:200]}...")
        
        return data  # 透传数据，不影响流程
    
    def analyze_output(self, output: str, 
                       expected_format: str = "json") -> dict:
        """
        分析Agent输出质量
        """
        analysis = {
            "output_length": len(output),
            "format_check": False,
            "issues": []
        }
        
        # 格式检查
        if expected_format == "json":
            try:
                json.loads(output)
                analysis["format_check"] = True
            except json.JSONDecodeError as e:
                analysis["issues"].append(f"JSON格式错误: {e}")
        
        elif expected_format == "markdown":
            has_headers = any(line.startswith('#') 
                             for line in output.split('\n'))
            analysis["format_check"] = has_headers
            if not has_headers:
                analysis["issues"].append("缺少Markdown标题结构")
        
        # 长度检查
        if len(output) < 100:
            analysis["issues"].append("输出过短，可能不完整")
        elif len(output) > 10000:
            analysis["issues"].append("输出过长，可能有冗余内容")
        
        # 质量检查
        low_quality_signals = [
            "对不起", "无法", "I cannot", "作为AI",
            "请注意这是", "以下是一个示例"
        ]
        for signal in low_quality_signals:
            if signal in output:
                analysis["issues"].append(f"检测到低质量信号: '{signal}'")
        
        return analysis
    
    def compare_outputs(self, outputs: list, 
                        criteria: list) -> dict:
        """
        对比多个输出版本
        用于Prompt优化时的对比分析
        """
        if not outputs:
            return {}
        
        print("\n=== 输出对比分析 ===\n")
        
        results = []
        for i, output in enumerate(outputs):
            analysis = self.analyze_output(output)
            
            result = {
                "version": i + 1,
                "length": analysis["output_length"],
                "format_ok": analysis["format_check"],
                "issues": analysis["issues"],
                "score": 10 - len(analysis["issues"]) * 2
            }
            results.append(result)
            
            print(f"版本{i+1}:")
            print(f"  长度: {result['length']}字")
            print(f"  格式: {'OK' if result['format_ok'] else 'FAIL'}")
            print(f"  问题: {result['issues'] or '无'}")
            print(f"  得分: {result['score']}/10")
            print()
        
        best = max(results, key=lambda x: x['score'])
        print(f"推荐版本: 版本{best['version']}")
        
        return {"results": results, "best_version": best['version']}
    
    def print_checkpoints(self):
        """打印所有检查点"""
        print("\n=== 执行检查点记录 ===\n")
        for i, cp in enumerate(self.checkpoints, 1):
            print(f"{i}. [{cp['timestamp'][11:19]}] {cp['name']}")
            print(f"   类型: {cp['data_type']}")
            print(f"   数据: {cp['data_preview'][:100]}...")
            print()


inspector = AgentInspector(llm=ChatOpenAI(model="gpt-4"))
```

---

## 六、Metrics指标体系

### **完整指标监控系统**

```python
from collections import defaultdict
from typing import List
import statistics


class AgentMetricsCollector:
    """
    Agent系统指标收集器
    
    监控维度：
    - 成功率
    - 响应时间（P50/P95/P99）
    - Token消耗
    - 成本
    - 错误分布
    - 工具使用频率
    """
    
    def __init__(self):
        self.metrics = defaultdict(list)
        self.counters = defaultdict(int)
        self.start_time = time.time()
    
    def record_execution(
        self,
        duration_ms: float,
        tokens_used: int,
        cost_usd: float,
        success: bool,
        error_type: str = None,
        agent_names: List[str] = None,
        tools_called: List[str] = None
    ):
        """记录一次执行"""
        self.metrics["duration_ms"].append(duration_ms)
        self.metrics["tokens"].append(tokens_used)
        self.metrics["cost_usd"].append(cost_usd)
        
        self.counters["total_executions"] += 1
        if success:
            self.counters["success_count"] += 1
        else:
            self.counters["error_count"] += 1
            if error_type:
                self.counters[f"error.{error_type}"] += 1
        
        if tools_called:
            for tool in tools_called:
                self.counters[f"tool.{tool}"] += 1
    
    def get_percentile(self, data: List[float], 
                       percentile: float) -> float:
        """计算百分位数"""
        if not data:
            return 0
        sorted_data = sorted(data)
        index = int(len(sorted_data) * percentile / 100)
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    def get_dashboard(self) -> str:
        """生成监控面板"""
        total = self.counters["total_executions"]
        if total == 0:
            return "暂无数据"
        
        success = self.counters["success_count"]
        durations = self.metrics["duration_ms"]
        tokens = self.metrics["tokens"]
        costs = self.metrics["cost_usd"]
        
        uptime_hours = (time.time() - self.start_time) / 3600
        
        dashboard = f"""
+------------------------------------------------+
|        Agent系统监控面板                         |
+------------------------------------------------+
|                                                  |
|  服务状态：正常                                 |
|  运行时长：{uptime_hours:.1f}小时                 |
|                                                  |
+------------------------------------------------+
|  执行统计                                        |
+------------------------------------------------+
|                                                  |
|  总执行次数：{total:<10}                         |
|  成功次数：  {success:<10}                       |
|  失败次数：  {total-success:<10}                 |
|  成功率：    {success/total*100:.1f}%            |
|                                                  |
+------------------------------------------------+
|  响应时间                                        |
+------------------------------------------------+
|                                                  |
|  平均耗时：  {statistics.mean(durations):.0f}ms  |
|  P50耗时：   {self.get_percentile(durations, 50):.0f}ms  |
|  P95耗时：   {self.get_percentile(durations, 95):.0f}ms  |
|  P99耗时：   {self.get_percentile(durations, 99):.0f}ms  |
|  最长耗时：  {max(durations):.0f}ms              |
|                                                  |
+------------------------------------------------+
|  成本统计                                        |
+------------------------------------------------+
|                                                  |
|  总Token：   {sum(tokens):,}                     |
|  总成本：    ${sum(costs):.4f}                    |
|  均次成本：  ${statistics.mean(costs):.4f}        |
|  均次Token： {statistics.mean(tokens):.0f}        |
|                                                  |
+------------------------------------------------+
|  工具使用                                        |
+------------------------------------------------+
"""
        
        # 工具使用统计
        tool_counts = {
            k.replace("tool.", ""): v
            for k, v in self.counters.items()
            if k.startswith("tool.")
        }
        
        for tool, count in sorted(tool_counts.items(),
                                   key=lambda x: x[1],
                                   reverse=True)[:5]:
            dashboard += f"  {tool[:20]:<20}：{count}次\n"
        
        dashboard += """
+------------------------------------------------+
"""
        return dashboard
    
    def get_alerts(self) -> List[dict]:
        """检查是否有告警"""
        alerts = []
        total = self.counters["total_executions"]
        
        if total == 0:
            return alerts
        
        success = self.counters["success_count"]
        durations = self.metrics["duration_ms"]
        
        # 成功率告警
        success_rate = success / total
        if success_rate < 0.9:
            alerts.append({
                "level": "CRITICAL",
                "metric": "success_rate",
                "value": f"{success_rate*100:.1f}%",
                "threshold": "90%",
                "message": f"成功率过低！当前{success_rate*100:.1f}%，阈值90%"
            })
        
        # 响应时间告警
        p95 = self.get_percentile(durations, 95)
        if p95 > 60000:
            alerts.append({
                "level": "WARNING",
                "metric": "p95_latency",
                "value": f"{p95:.0f}ms",
                "threshold": "60000ms",
                "message": f"P95延迟过高！当前{p95/1000:.0f}秒，阈值60秒"
            })
        
        # 成本告警
        total_cost = sum(self.metrics["cost_usd"])
        if total_cost > 100:
            alerts.append({
                "level": "WARNING",
                "metric": "total_cost",
                "value": f"${total_cost:.2f}",
                "threshold": "$100",
                "message": f"总成本超过阈值！当前${total_cost:.2f}"
            })
        
        return alerts


# 全局指标收集器
metrics = AgentMetricsCollector()
```

---

## 七、完整可观测性集成：研报系统升级版

### **把所有能力整合到研报系统**

```python
from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI
import time


def build_observable_research_system():
    """
    构建带完整可观测性的研报生成系统
    """
    
    # ===== 初始化可观测性组件 =====
    logger = AgentLogger(
        service_name="research_system",
        log_dir="./logs",
        log_level="INFO"
    )
    
    trace_mgr = TraceManager(logger=logger)
    metrics_collector = AgentMetricsCollector()
    debugger = AgentDebugger()
    inspector = AgentInspector(llm=ChatOpenAI(model="gpt-4"))
    
    # ===== 工具定义（带追踪） =====
    from crewai_tools import tool
    
    @tool("市场搜索")
    def market_search(query: str) -> str:
        """搜索市场数据"""
        start = time.time()
        
        # 模拟搜索
        result = f"搜索'{query}'：华为20%，小米18%，苹果16%"
        
        duration = (time.time() - start) * 1000
        logger.log_tool_call(
            trace_id="current",
            agent_name="researcher",
            tool_name="market_search",
            tool_input=query,
            tool_output=result,
            duration_ms=duration
        )
        
        return result
    
    # ===== LLM初始化 =====
    llm = ChatOpenAI(
        model="gpt-4",
        temperature=0.7,
        # LangSmith自动追踪所有调用
    )
    
    # ===== Agent定义 =====
    researcher = Agent(
        role="市场研究员",
        goal="搜集全面的市场数据",
        backstory="10年经验的科技市场研究专家",
        tools=[market_search],
        llm=llm,
        verbose=True,
        max_iter=5
    )
    
    analyst = Agent(
        role="数据分析师",
        goal="深度分析市场数据",
        backstory="战略咨询顾问，擅长市场分析",
        llm=llm,
        verbose=True
    )
    
    writer = Agent(
        role="报告撰写者",
        goal="撰写专业研究报告",
        backstory="顶级咨询公司资深分析师",
        llm=llm,
        verbose=True
    )
    
    # ===== Task定义 =====
    def make_tasks(topic: str):
        research_task = Task(
            description=f"调研{topic}的市场数据",
            expected_output="结构化的市场数据报告",
            agent=researcher
        )
        
        analysis_task = Task(
            description="深度分析市场数据，提炼商业洞察",
            expected_output="深度分析报告",
            agent=analyst,
            context=[research_task]
        )
        
        writing_task = Task(
            description=f"撰写《{topic}研究报告》",
            expected_output="3000字专业研报（Markdown格式）",
            agent=writer,
            context=[research_task, analysis_task]
        )
        
        return [research_task, analysis_task, writing_task]
    
    # ===== 可观测执行函数 =====
    def run_with_observability(topic: str) -> dict:
        """
        带完整可观测性的执行
        """
        # 开始Trace
        trace_id = trace_mgr.start_trace(f"research_{topic}")
        start_time = time.time()
        
        logger.log_event(
            event_type=AgentEventType.USER_INPUT,
            trace_id=trace_id,
            data={"topic": topic}
        )
        
        result = None
        success = False
        error_msg = None
        
        try:
            # 创建Crew
            tasks = make_tasks(topic)
            crew = Crew(
                agents=[researcher, analyst, writer],
                tasks=tasks,
                process=Process.sequential,
                verbose=True
            )
            
            # 执行
            with trace_mgr.span(trace_id, "crew_execution") as span:
                span.set_attribute("topic", topic)
                span.set_attribute("agents", ["researcher", "analyst", "writer"])
                
                result = crew.kickoff()
                
                span.set_attribute("output_length", len(str(result)))
            
            success = True
            
            # 检查点
            inspector.checkpoint(
                "最终报告",
                result,
                trace_id=trace_id
            )
            
            # 分析输出质量
            quality = inspector.analyze_output(
                str(result),
                expected_format="markdown"
            )
            
            if quality["issues"]:
                logger.log_event(
                    event_type=AgentEventType.WARNING,
                    level=AgentLogLevel.WARNING,
                    trace_id=trace_id,
                    data={"quality_issues": quality["issues"]}
                )
            
        except Exception as e:
            error_msg = str(e)
            logger.log_error(
                trace_id=trace_id,
                agent_name="system",
                error=e,
                context=f"执行研报生成失败：{topic}"
            )
            raise
        
        finally:
            duration_ms = (time.time() - start_time) * 1000
            
            # 记录指标
            metrics_collector.record_execution(
                duration_ms=duration_ms,
                tokens_used=5000,  # 实际从LLM回调获取
                cost_usd=0.5,
                success=success,
                error_type=type(Exception()).__name__ if not success else None,
                agent_names=["researcher", "analyst", "writer"],
                tools_called=["market_search"]
            )
            
            # 打印Trace树
            trace_mgr.print_trace_tree(trace_id)
            
            # 导出Trace
            trace_data = trace_mgr.export_trace(
                trace_id,
                f"./traces/trace_{trace_id}.json"
            )
            
            # 诊断问题
            debugger.print_diagnosis(trace_data)
        
        return {
            "result": str(result) if result else None,
            "trace_id": trace_id,
            "success": success,
            "error": error_msg
        }
    
    return run_with_observability, metrics_collector


# ===== 主程序 =====
def main():
    print("初始化研报系统（带可观测性）...")
    
    run_research, metrics = build_observable_research_system()
    
    # 执行研报生成
    result = run_research("2024年中国手机市场")
    
    if result["success"]:
        print(f"\n研报生成成功！")
        print(f"Trace ID: {result['trace_id']}")
        print(f"\n报告预览：")
        print(str(result['result'])[:500])
    else:
        print(f"\n研报生成失败：{result['error']}")
    
    # 显示监控面板
    print(metrics.get_dashboard())
    
    # 检查告警
    alerts = metrics.get_alerts()
    if alerts:
        print("\n告警信息：")
        for alert in alerts:
            print(f"  [{alert['level']}] {alert['message']}")
    else:
        print("无告警，系统正常")


if __name__ == "__main__":
    main()
```

---

## 八、这一讲的核心总结

### **必须记住的10个要点**

1. **可观测性三支柱**：日志（发生了什么）+追踪（哪里出问题）+指标（系统是否健康）
2. **日志必须结构化**：JSON格式，便于后续分析和查询
3. **Trace_ID贯穿全程**：一次请求的所有日志共享同一ID
4. **工具调用必须记录**：输入、输出、耗时、成功/失败
5. **敏感信息要脱敏**：手机号、密码、Token不能明文记录
6. **LangSmith是利器**：两行代码接入，自动追踪所有LLM调用
7. **设置检查点调试**：在关键位置记录中间状态
8. **P95比平均值重要**：平均延迟好看，P95才代表真实体验
9. **告警要有阈值**：成功率<90%、P95>60秒要立刻告警
10. **定期导出Trace**：用于问题复现和持续优化

---

## 九、这一讲的练习题

### **练习1：概念理解**
1. 为什么Agent系统的可观测性比普通Web服务更难？
2. Trace和Log的核心区别是什么？各自解决什么问题？
3. 为什么监控P95延迟比平均延迟更重要？

---

### **练习2：日志设计**
为一个"客服Agent系统"设计日志规范：
1. 需要记录哪些事件类型？
2. 每个事件需要记录哪些字段？
3. 哪些信息需要脱敏？
4. 告警阈值怎么设置？

---

### **练习3：代码实战**
改造本讲的可观测性系统：
1. 加入**每日报表**功能（每天0点生成前一天的统计）
2. 加入**慢查询分析**（找出耗时Top5的工具调用）
3. 加入**成本预警**（当天成本超过阈值时发送警告）

**提示框架：**
```python
class DailyReporter:
    """每日报表生成器"""
    
    def __init__(self, log_dir: str = "./logs"):
        self.log_dir = Path(log_dir)
    
    def generate_daily_report(self, date: str = None) -> str:
        """
        生成指定日期的报表
        date: 格式 YYYY-MM-DD，不填则为昨天
        """
        if not date:
            from datetime import timedelta
            date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        
        # TODO: 读取当天的JSONL日志文件
        # TODO: 统计执行次数、成功率、Token消耗、成本
        # TODO: 找出慢查询（Top5耗时工具调用）
        # TODO: 找出错误分布
        # TODO: 生成报告
        
        log_file = self.log_dir / f"research_system_{date.replace('-', '')}.jsonl"
        
        if not log_file.exists():
            return f"未找到 {date} 的日志文件"
        
        logs = []
        with open(log_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    logs.append(json.loads(line))
                except:
                    continue
        
        # TODO: 完成报表统计逻辑
        
        return f"日报：{date}\n共{len(logs)}条日志"
    
    def find_slow_tools(self, logs: list, top_n: int = 5) -> list:
        """找出最慢的工具调用"""
        tool_logs = [
            log for log in logs
            if log.get('event_type') == 'tool.result'
            and log.get('duration_ms')
        ]
        
        # TODO: 按duration_ms排序，返回Top N
        pass
    
    def cost_alert(self, logs: list, 
                   daily_budget: float = 50.0) -> bool:
        """成本预警"""
        total_cost = sum(
            log.get('cost_usd', 0) for log in logs
        )
        
        if total_cost > daily_budget:
            print(f"成本预警！今日成本${total_cost:.2f}，超过预算${daily_budget}")
            return True
        
        return False
```

---

## 十、下一讲预告

### **第7讲：安全护栏与企业级治理**

会讲：
- Prompt注入攻击原理与防御
- Agent行为边界的设计
- 敏感信息检测与脱敏
- 内容审核机制（关键词过滤/模型审核）
- 成本控制与Token限额
- 合规性设计（数据隐私/审计日志）
- 人工介入机制（Human-in-the-loop）
- 实战：为客服Agent加入完整安全防护

**准备工作：**
```bash
pip install presidio-analyzer presidio-anonymizer
# 这是微软开源的PII（个人信息）检测库
```

**预习思考：**
- 你的Agent系统有哪些潜在的安全风险？
- 如果用户试图"越狱"你的Agent，会发生什么？
- 如何在"安全"和"有用"之间取得平衡？

---

**你准备好进入第7讲了吗？**

或者你可以：
- 把练习题做完，我帮你点评
- 分享你遇到的调试难题，我帮你分析
- 有任何问题直接提问！
