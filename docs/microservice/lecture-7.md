# 第 7 讲：可观测性（Python 版）— 链路追踪、日志、监控实战

这一讲是微服务的**"眼睛"**。

微服务拆分后，一个请求可能经过 5~10 个服务。出了问题，你怎么知道是哪个服务慢了？哪行代码出错了？哪个数据库查询拖垮了系统？

没有可观测性，微服务就是一个黑盒。出了问题只能靠猜。

这一讲的目标是让你：
- **理解可观测性三大支柱：Metrics、Logging、Tracing**
- **掌握 OpenTelemetry 标准**
- **能用 Python 实现全链路追踪**
- **掌握 TraceID 跨服务透传**
- **能搭建 ELK 日志体系**
- **能搭建 Prometheus + Grafana 监控**
- **设计合理的告警规则**
- **规避大厂常见的可观测性坑点**

---

## 一、为什么微服务必须要可观测性？

### 1. 单体架构 vs 微服务的排查难度

**单体架构出问题：**

```
用户反馈：下单失败
开发者：ssh 到服务器，看日志
cat /var/log/app.log | grep "ERROR"
找到了：数据库连接超时
修复：完成
```

**微服务出问题：**

```
用户反馈：下单失败
开发者：...

请求经过了：
API 网关 → 订单服务 → 库存服务 → 账户服务 → 支付服务
                  ↓              ↓
              MySQL DB      Redis Cache

是哪个环节出问题了？
日志分散在 10 台机器上
没有统一查询方式
没有请求链路追踪
→ 只能靠猜 + 逐台机器查日志
→ 平均排查时间：1~2 小时
```

**可观测性解决的核心问题：**

> 出了问题，能在 5 分钟内定位到根因。

---

### 2. 可观测性 vs 监控

**监控（Monitoring）：**
- 告诉你**出了问题**
- 例：CPU 超过 80%、错误率超过 1%

**可观测性（Observability）：**
- 告诉你**为什么出了问题**
- 例：是哪个请求、哪个服务、哪行代码、哪个 SQL 导致的

**可观测性包含监控，但比监控更全面。**

---

### 3. 可观测性三大支柱

```
┌─────────────────────────────────────────────────────┐
│                   可观测性                           │
├──────────────┬──────────────┬────────────────────────┤
│   Metrics    │   Logging    │       Tracing           │
│   指标       │   日志       │       链路追踪           │
├──────────────┼──────────────┼────────────────────────┤
│ 系统整体状态  │ 单次事件详情  │ 请求的完整调用链        │
│ QPS、RT、错误率│ 错误信息、上下文│ 跨服务追踪            │
│ CPU、内存    │              │ 耗时分析               │
├──────────────┼──────────────┼────────────────────────┤
│ Prometheus   │ ELK Stack    │ Jaeger / SkyWalking    │
│ Grafana      │ Loki         │ Zipkin                 │
└──────────────┴──────────────┴────────────────────────┘
```

**三者缺一不可：**
- **只有 Metrics**：知道出问题了，不知道是哪个请求
- **只有 Logging**：知道错误详情，不知道整条链路
- **只有 Tracing**：知道链路，但没有系统整体状态

---

## 二、链路追踪

### 1. 核心概念

#### Trace（追踪）

一次完整的请求调用链，由多个 Span 组成。

```
Trace ID: abc-123-xyz
│
├── Span: API Gateway (0ms ~ 150ms)
│    ├── Span: Order Service (10ms ~ 120ms)
│    │    ├── Span: MySQL Query (15ms ~ 40ms)
│    │    ├── Span: Inventory Service (45ms ~ 90ms)
│    │    │    ├── Span: Redis Get (46ms ~ 48ms)
│    │    │    └── Span: MySQL Query (50ms ~ 85ms)
│    │    └── Span: Account Service (92ms ~ 115ms)
│    │         └── Span: MySQL Query (93ms ~ 110ms)
│    └── Span: Response (120ms ~ 150ms)
```

#### Span（跨度）

追踪中的一个操作单元，包含：
- **Span ID**：唯一标识
- **Parent Span ID**：父 Span（形成树形结构）
- **Trace ID**：所属 Trace
- **操作名称**：如 `GET /users/123`
- **开始时间、结束时间**
- **Tags**：键值对标注
- **Logs**：Span 内的事件日志

#### TraceID 传播

```
请求进入 API 网关
   ↓ 生成 TraceID（或从请求头取）
API 网关 → 订单服务（HTTP Header: X-Trace-ID: abc-123）
              ↓
         订单服务 → 库存服务（继续传递 X-Trace-ID: abc-123）
              ↓
         订单服务 → 账户服务（继续传递 X-Trace-ID: abc-123）
```

**同一个 TraceID 贯穿整条链路，这样才能把所有 Span 关联起来。**

---

### 2. OpenTelemetry 标准

**为什么用 OpenTelemetry？**

以前每个追踪框架有自己的 SDK：
- Zipkin 有 Zipkin SDK
- Jaeger 有 Jaeger SDK
- SkyWalking 有 SkyWalking SDK

换框架就要改代码，耦合严重。

**OpenTelemetry（OTel）** 解决这个问题：

```
应用代码
   ↓ 用 OpenTelemetry SDK（统一标准）
OTel Collector（采集器）
   ↓ 可以同时导出到多个后端
Jaeger / Zipkin / SkyWalking / 自定义
```

**一套代码，随时切换追踪后端。**

---

### 3. Python 接入 OpenTelemetry

#### 安装依赖

```bash
pip install opentelemetry-api \
            opentelemetry-sdk \
            opentelemetry-exporter-jaeger \
            opentelemetry-instrumentation-fastapi \
            opentelemetry-instrumentation-requests \
            opentelemetry-instrumentation-sqlalchemy
```

#### 启动 Jaeger（Docker）

```bash
docker run -d --name jaeger \
  -p 16686:16686 \   # Web UI
  -p 6831:6831/udp \ # Jaeger Thrift
  -p 4317:4317 \     # OTLP gRPC
  jaegertracing/all-in-one:latest
```

访问：`http://localhost:16686`

#### 基础配置

```python
# tracing.py
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.jaeger.thrift import JaegerExporter
from opentelemetry.sdk.resources import Resource


def setup_tracing(service_name: str):
    """
    初始化链路追踪
    """
    # 1. 配置资源（服务信息）
    resource = Resource.create({
        "service.name": service_name,
        "service.version": "1.0.0",
        "deployment.environment": "development"
    })

    # 2. 创建 TracerProvider
    provider = TracerProvider(resource=resource)

    # 3. 配置 Jaeger 导出器
    jaeger_exporter = JaegerExporter(
        agent_host_name="localhost",
        agent_port=6831,
    )

    # 4. 批量发送 Span（性能优化）
    provider.add_span_processor(
        BatchSpanProcessor(jaeger_exporter)
    )

    # 5. 注册为全局 Provider
    trace.set_tracer_provider(provider)

    print(f"Tracing initialized for service: {service_name}")
    return trace.get_tracer(service_name)
```

#### FastAPI 服务接入追踪

```python
# order_service.py
import time
import uuid
from fastapi import FastAPI, Request
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.propagate import extract, inject
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from tracing import setup_tracing

# 初始化追踪
tracer = setup_tracing("order-service")

app = FastAPI()

# 自动为所有 FastAPI 请求创建 Span
FastAPIInstrumentor.instrument_app(app)

# 自动为所有 requests 请求注入 TraceID
RequestsInstrumentor().instrument()


@app.post("/orders")
async def create_order(request: Request):
    """
    创建订单接口
    """
    # 获取当前 Span（FastAPIInstrumentor 自动创建）
    current_span = trace.get_current_span()

    # 添加自定义标签
    current_span.set_attribute("order.user_id", "user-001")
    current_span.set_attribute("order.product_id", "product-001")
    current_span.set_attribute("order.amount", 199.00)

    body = await request.json()

    # 创建子 Span：验证库存
    with tracer.start_as_current_span("check-inventory") as span:
        span.set_attribute("product.id", body.get("product_id"))
        span.set_attribute("quantity", body.get("quantity"))

        inventory_result = await check_inventory(
            body.get("product_id"),
            body.get("quantity")
        )

        if not inventory_result["available"]:
            span.set_attribute("error", True)
            span.add_event("inventory_insufficient")
            return {"error": "Insufficient inventory"}

    # 创建子 Span：扣减余额
    with tracer.start_as_current_span("deduct-balance") as span:
        span.set_attribute("user.id", body.get("user_id"))
        span.set_attribute("amount", body.get("amount"))

        await deduct_balance(body.get("user_id"), body.get("amount"))

    # 创建子 Span：写入数据库
    with tracer.start_as_current_span("db-insert-order") as span:
        span.set_attribute("db.system", "mysql")
        span.set_attribute("db.table", "orders")

        order_id = await save_order(body)

    return {"order_id": order_id, "status": "created"}


async def check_inventory(product_id: str, quantity: int):
    """调用库存服务（TraceID 自动透传）"""
    import httpx

    # RequestsInstrumentor 会自动注入 TraceID 到请求头
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"http://inventory-service:8003/inventory/{product_id}",
            params={"quantity": quantity}
        )
        return response.json()


async def deduct_balance(user_id: str, amount: float):
    """调用账户服务"""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://account-service:8004/accounts/deduct",
            json={"user_id": user_id, "amount": amount}
        )
        return response.json()


async def save_order(order_data: dict) -> str:
    """保存订单到数据库"""
    # 模拟数据库操作
    await asyncio.sleep(0.05)
    return str(uuid.uuid4())
```

#### 手动创建和管理 Span

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind, StatusCode
import time

tracer = trace.get_tracer("my-service")


def process_payment(order_id: str, amount: float):
    """
    处理支付（手动创建 Span）
    """
    with tracer.start_as_current_span(
        "process-payment",
        kind=SpanKind.INTERNAL
    ) as span:

        # 添加属性
        span.set_attribute("payment.order_id", order_id)
        span.set_attribute("payment.amount", amount)
        span.set_attribute("payment.currency", "CNY")

        try:
            # 记录事件
            span.add_event("payment_started", {
                "timestamp": time.time()
            })

            # 调用第三方支付
            result = call_payment_gateway(order_id, amount)

            # 记录成功事件
            span.add_event("payment_completed", {
                "transaction_id": result["transaction_id"]
            })
            span.set_attribute("payment.transaction_id",
                               result["transaction_id"])

            # 设置成功状态
            span.set_status(StatusCode.OK)
            return result

        except Exception as e:
            # 记录错误
            span.set_status(StatusCode.ERROR, str(e))
            span.record_exception(e)
            raise


def call_payment_gateway(order_id: str, amount: float):
    """调用第三方支付网关"""
    with tracer.start_as_current_span(
        "call-payment-gateway",
        kind=SpanKind.CLIENT
    ) as span:
        span.set_attribute("http.method", "POST")
        span.set_attribute("http.url", "https://pay.example.com/charge")

        # 模拟调用
        time.sleep(0.1)
        return {"transaction_id": "txn-001", "status": "success"}
```

---

### 4. TraceID 跨服务手动透传

当自动检测不够时（如 gRPC、消息队列），需要手动透传：

```python
from opentelemetry import trace, propagate
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

propagator = TraceContextTextMapPropagator()


# ============================================================
# 发送方：注入 TraceID 到请求头
# ============================================================

def inject_trace_context(headers: dict) -> dict:
    """
    将当前 Span 的 TraceID 注入到请求头
    用于 HTTP / gRPC 请求
    """
    propagate.inject(headers)
    return headers


# HTTP 请求示例
def call_downstream_service(url: str, data: dict):
    headers = {"Content-Type": "application/json"}

    # 注入 TraceID
    inject_trace_context(headers)

    # headers 现在包含了 traceparent 字段
    # traceparent: 00-{trace_id}-{span_id}-01

    import requests
    return requests.post(url, json=data, headers=headers)


# ============================================================
# 接收方：从请求头提取 TraceID
# ============================================================

def extract_trace_context(headers: dict):
    """
    从请求头提取 TraceContext
    用于继续上游的 Trace
    """
    return propagate.extract(headers)


# FastAPI 中间件示例
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware


class TraceMiddleware(BaseHTTPMiddleware):
    """
    TraceID 中间件
    从请求头提取 TraceContext，继续上游 Trace
    """

    async def dispatch(self, request: Request, call_next):
        # 提取上游的 TraceContext
        context = extract_trace_context(dict(request.headers))

        # 在这个 Context 下创建 Span
        tracer = trace.get_tracer("my-service")
        with tracer.start_as_current_span(
            f"{request.method} {request.url.path}",
            context=context,
            kind=trace.SpanKind.SERVER
        ) as span:
            # 注入 TraceID 到 Request State，方便后续使用
            trace_id = format(
                span.get_span_context().trace_id, '032x'
            )
            request.state.trace_id = trace_id

            response = await call_next(request)

            # 注入 TraceID 到响应头
            response.headers["X-Trace-ID"] = trace_id
            return response


# ============================================================
# 消息队列中传递 TraceID
# ============================================================

def publish_message_with_trace(topic: str, payload: dict):
    """发布消息时携带 TraceID"""
    carrier = {}
    inject_trace_context(carrier)

    message = {
        "payload": payload,
        "trace_context": carrier  # 把 TraceID 放到消息里
    }

    # 发送到 MQ
    # mq_client.publish(topic, message)
    return message


def consume_message_with_trace(message: dict):
    """消费消息时恢复 TraceContext"""
    # 从消息中提取 TraceContext
    trace_context = message.get("trace_context", {})
    context = extract_trace_context(trace_context)

    tracer = trace.get_tracer("my-service")
    with tracer.start_as_current_span(
        "process-message",
        context=context,
        kind=trace.SpanKind.CONSUMER
    ) as span:
        # 处理消息
        payload = message["payload"]
        process_payload(payload)


def process_payload(payload: dict):
    pass
```

---

## 三、日志体系

### 1. 日志设计原则

**原则 1：结构化日志**

```python
# ❌ 非结构化（难以搜索）
logger.info(f"User {user_id} created order {order_id}, amount: {amount}")

# ✅ 结构化（JSON 格式，易于搜索和分析）
logger.info("order_created", extra={
    "user_id": user_id,
    "order_id": order_id,
    "amount": amount,
    "event": "order_created"
})
```

**原则 2：必须包含 TraceID**

```python
# 每条日志都要有 TraceID，这样才能关联同一请求的所有日志
logger.info("Processing order", extra={
    "trace_id": get_current_trace_id(),
    "order_id": order_id
})
```

**原则 3：日志分级**

```
DEBUG：调试信息（开发环境）
INFO：正常业务流程
WARNING：警告，系统异常但可恢复
ERROR：错误，影响功能但服务存活
CRITICAL：严重错误，服务可能崩溃
```

---

### 2. Python 结构化日志

#### 安装依赖

```bash
pip install structlog python-json-logger
```

#### 配置结构化日志

```python
# logging_config.py
import logging
import structlog
from opentelemetry import trace


def get_current_trace_id() -> str:
    """获取当前请求的 TraceID"""
    span = trace.get_current_span()
    if span and span.get_span_context().is_valid:
        return format(span.get_span_context().trace_id, '032x')
    return ""


def get_current_span_id() -> str:
    """获取当前 Span ID"""
    span = trace.get_current_span()
    if span and span.get_span_context().is_valid:
        return format(span.get_span_context().span_id, '016x')
    return ""


def add_trace_info(logger, method, event_dict):
    """
    structlog 处理器：自动添加 TraceID 和 SpanID
    """
    event_dict["trace_id"] = get_current_trace_id()
    event_dict["span_id"] = get_current_span_id()
    return event_dict


def setup_logging(service_name: str, log_level: str = "INFO"):
    """
    配置结构化日志
    """
    # 配置 structlog
    structlog.configure(
        processors=[
            # 添加日志级别
            structlog.stdlib.add_log_level,
            # 添加时间戳
            structlog.processors.TimeStamper(fmt="iso"),
            # 添加 TraceID
            add_trace_info,
            # 添加服务名
            lambda logger, method, event_dict: {
                **event_dict,
                "service": service_name
            },
            # 渲染为 JSON
            structlog.processors.JSONRenderer()
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # 配置标准 logging
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, log_level.upper())
    )

    return structlog.get_logger()


# 使用示例
logger = setup_logging("order-service")


def process_order(order_id: str, user_id: str):
    logger.info("order_processing_started", order_id=order_id, user_id=user_id)

    try:
        # 业务逻辑
        result = do_process(order_id)
        logger.info("order_processing_completed",
                    order_id=order_id,
                    duration_ms=150)
        return result

    except Exception as e:
        logger.error("order_processing_failed",
                     order_id=order_id,
                     error=str(e),
                     exc_info=True)
        raise


def do_process(order_id: str):
    return {"order_id": order_id, "status": "completed"}
```

**输出的 JSON 日志：**

```json
{
  "event": "order_processing_started",
  "order_id": "order-001",
  "user_id": "user-001",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "service": "order-service",
  "level": "info",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### 3. ELK Stack 搭建

#### 架构

```
Python 服务
   ↓ 写日志文件 / 直接发送
Filebeat（日志采集）
   ↓
Logstash（日志处理）
   ↓
Elasticsearch（日志存储）
   ↓
Kibana（日志查询和可视化）
```

#### docker-compose.yml

```yaml
version: '3'
services:

  elasticsearch:
    image: elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data

  kibana:
    image: kibana:8.8.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

  logstash:
    image: logstash:8.8.0
    ports:
      - "5044:5044"    # Beats 输入
      - "5000:5000"    # TCP 输入
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch

  filebeat:
    image: elastic/filebeat:8.8.0
    volumes:
      - ./filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
      - /var/log/app:/var/log/app:ro  # 挂载应用日志目录
    depends_on:
      - logstash

volumes:
  es_data:
```

#### logstash.conf

```ruby
input {
  beats {
    port => 5044
  }
  tcp {
    port => 5000
    codec => json
  }
}

filter {
  # 解析 JSON 日志
  if [message] =~ /^\{/ {
    json {
      source => "message"
    }
  }

  # 添加时间戳
  date {
    match => ["timestamp", "ISO8601"]
    target => "@timestamp"
  }

  # 删除不需要的字段
  mutate {
    remove_field => ["message", "host", "@version"]
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "microservice-logs-%{service}-%{+YYYY.MM.dd}"
  }
}
```

#### filebeat.yml

```yaml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/app/*.log
    json.keys_under_root: true
    json.add_error_key: true
    fields:
      app: microservice
    fields_under_root: true

output.logstash:
  hosts: ["logstash:5044"]

logging.level: warning
```

#### Python 直接发送日志到 Logstash

```python
import logging
import json
import socket
from pythonjsonlogger import jsonlogger


class LogstashHandler(logging.Handler):
    """
    直接发送日志到 Logstash（TCP）
    """

    def __init__(self, host: str, port: int):
        super().__init__()
        self.host = host
        self.port = port
        self.sock = None
        self._connect()

    def _connect(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.connect((self.host, self.port))
        except Exception as e:
            print(f"Failed to connect to Logstash: {e}")

    def emit(self, record):
        try:
            log_entry = self.format(record)
            self.sock.send((log_entry + "\n").encode("utf-8"))
        except Exception:
            self.handleError(record)
```

---

## 四、指标监控

### 1. 核心指标

**微服务必须监控的指标：**

| 类别 | 指标 | 说明 |
|------|------|------|
| **流量** | QPS、RPS | 每秒请求数 |
| **延迟** | P50、P95、P99 RT | 响应时间分位数 |
| **错误** | Error Rate | 错误率 |
| **资源** | CPU、Memory | 系统资源 |
| **业务** | 下单量、支付成功率 | 业务指标 |

**P99 RT 是什么？**

```
100 个请求的响应时间排序后
P50：第 50 个（中位数）
P95：第 95 个（95% 的请求在这个时间内完成）
P99：第 99 个（99% 的请求在这个时间内完成）

P99 更能发现尾延迟问题
```

---

### 2. Prometheus + Python 接入

#### 安装

```bash
pip install prometheus-client
```

#### 定义指标

```python
# metrics.py
from prometheus_client import Counter, Histogram, Gauge, Summary, generate_latest
import time
import functools


# 请求计数器（带标签）
REQUEST_COUNT = Counter(
    name="http_requests_total",
    documentation="Total HTTP requests",
    labelnames=["method", "endpoint", "status_code", "service"]
)

# 请求延迟（直方图）
REQUEST_LATENCY = Histogram(
    name="http_request_duration_seconds",
    documentation="HTTP request latency",
    labelnames=["method", "endpoint", "service"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)

# 当前活跃连接数
ACTIVE_CONNECTIONS = Gauge(
    name="active_connections",
    documentation="Current active connections",
    labelnames=["service"]
)

# 业务指标
ORDER_COUNT = Counter(
    name="orders_total",
    documentation="Total orders created",
    labelnames=["status", "product_category"]
)

# 数据库查询时间
DB_QUERY_DURATION = Histogram(
    name="db_query_duration_seconds",
    documentation="Database query duration",
    labelnames=["operation", "table"]
)

# 缓存命中率
CACHE_HITS = Counter(
    name="cache_hits_total",
    documentation="Cache hits",
    labelnames=["cache_name"]
)
CACHE_MISSES = Counter(
    name="cache_misses_total",
    documentation="Cache misses",
    labelnames=["cache_name"]
)
```

#### FastAPI 集成 Prometheus

```python
# main.py
from fastapi import FastAPI, Request, Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
import time
import uvicorn

from metrics import REQUEST_COUNT, REQUEST_LATENCY, ACTIVE_CONNECTIONS, ORDER_COUNT

app = FastAPI()
SERVICE_NAME = "order-service"


# Prometheus 指标中间件
@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    # 跳过 metrics 本身
    if request.url.path == "/metrics":
        return await call_next(request)

    start_time = time.time()
    ACTIVE_CONNECTIONS.labels(service=SERVICE_NAME).inc()

    status_code = 200
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as e:
        status_code = 500
        raise
    finally:
        duration = time.time() - start_time

        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status_code=status_code,
            service=SERVICE_NAME
        ).inc()

        REQUEST_LATENCY.labels(
            method=request.method,
            endpoint=request.url.path,
            service=SERVICE_NAME
        ).observe(duration)

        ACTIVE_CONNECTIONS.labels(service=SERVICE_NAME).dec()


# 暴露 Prometheus metrics 端点
@app.get("/metrics")
async def metrics():
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )


# 业务接口
@app.post("/orders")
async def create_order(request: Request):
    body = await request.json()

    ORDER_COUNT.labels(
        status="created",
        product_category="electronics"
    ).inc()

    return {"order_id": "order-001", "status": "created"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
```

---

### 3. Prometheus 配置

#### prometheus.yml

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "order-service"
    static_configs:
      - targets: ["order-service:8002"]
    metrics_path: /metrics

  - job_name: "user-service"
    static_configs:
      - targets: ["user-service:8001"]
    metrics_path: /metrics

  - job_name: "inventory-service"
    static_configs:
      - targets: ["inventory-service:8003"]
    metrics_path: /metrics

rule_files:
  - "alert_rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]
```

#### 启动 Prometheus（Docker）

```bash
docker run -d --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

---

### 4. Grafana Dashboard

#### 启动 Grafana

```bash
docker run -d --name grafana \
  -p 3000:3000 \
  grafana/grafana
```

访问：`http://localhost:3000`（默认账号：admin/admin）

#### 核心 Dashboard 指标

**Panel 1：QPS（每秒请求数）**

```
rate(http_requests_total{service="order-service"}[1m])
```

**Panel 2：错误率**

```
rate(http_requests_total{status_code=~"5.."}[1m])
/
rate(http_requests_total[1m])
* 100
```

**Panel 3：P99 响应时间**

```
histogram_quantile(
  0.99,
  rate(http_request_duration_seconds_bucket{service="order-service"}[5m])
)
```

**Panel 4：活跃连接数**

```
active_connections{service="order-service"}
```

**Panel 5：缓存命中率**

```
rate(cache_hits_total[5m])
/
(rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))
* 100
```

---

## 五、告警设计

### 1. 告警规则

#### alert_rules.yml

```yaml
groups:
  - name: microservice-alerts
    rules:

      # 错误率告警
      - alert: HighErrorRate
        expr: |
          rate(http_requests_total{status_code=~"5.."}[5m])
          /
          rate(http_requests_total[5m])
          > 0.01
        for: 2m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "High error rate on {{ $labels.service }}"
          description: |
            Error rate is {{ $value | humanizePercentage }}
            on {{ $labels.service }} (threshold: 1%)

      # P99 响应时间告警
      - alert: HighLatency
        expr: |
          histogram_quantile(
            0.99,
            rate(http_request_duration_seconds_bucket[5m])
          ) > 1.0
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "High P99 latency on {{ $labels.service }}"
          description: |
            P99 latency is {{ $value }}s on {{ $labels.service }}

      # 服务不可用告警
      - alert: ServiceDown
        expr: up{job=~".*-service"} == 0
        for: 1m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Service {{ $labels.job }} is down"
          description: "Service has been down for more than 1 minute"

      # 高 QPS 告警
      - alert: HighQPS
        expr: |
          rate(http_requests_total[1m]) > 1000
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High QPS on {{ $labels.service }}"
          description: "QPS is {{ $value }} on {{ $labels.service }}"

      # 业务指标：下单失败率
      - alert: HighOrderFailureRate
        expr: |
          rate(orders_total{status="failed"}[5m])
          /
          rate(orders_total[5m])
          > 0.05
        for: 3m
        labels:
          severity: critical
          team: business
        annotations:
          summary: "High order failure rate"
          description: "Order failure rate is {{ $value | humanizePercentage }}"
```

### 2. 告警分级

```python
ALERT_LEVELS = {
    "P0": {
        "description": "服务完全不可用",
        "examples": ["服务挂了", "错误率 > 50%"],
        "response_time": "5 分钟内响应",
        "notify": ["电话", "钉钉", "短信"],
    },
    "P1": {
        "description": "核心功能受损",
        "examples": ["错误率 > 1%", "P99 > 2s"],
        "response_time": "15 分钟内响应",
        "notify": ["钉钉", "短信"],
    },
    "P2": {
        "description": "非核心功能受损",
        "examples": ["缓存命中率下降", "非核心接口慢"],
        "response_time": "工作时间内响应",
        "notify": ["钉钉"],
    },
    "P3": {
        "description": "观测性问题",
        "examples": ["日志量异常", "指标缺失"],
        "response_time": "下个迭代处理",
        "notify": ["邮件"],
    }
}
```

### 3. 避免告警疲劳

```python
"""
告警设计原则：

1. 每个告警必须是可操作的
   ❌ "CPU 使用率 > 50%"（没人知道该怎么办）
   ✅ "CPU 使用率 > 90% 持续 5 分钟"（需要立刻扩容）

2. 告警要有 for（持续时间）
   避免因为短暂波动触发告警

3. 告警要有明确的处理步骤
4. 定期清理无效告警
5. 告警去重（alertmanager 的 group_wait/group_interval）
"""
```

### 4. AlertManager 配置

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  receiver: 'default'

  routes:
    - match:
        severity: critical
      receiver: 'critical-alerts'
    - match:
        severity: warning
      receiver: 'warning-alerts'

receivers:
  - name: 'critical-alerts'
    webhook_configs:
      - url: 'http://alert-handler:8080/critical'
  - name: 'warning-alerts'
    webhook_configs:
      - url: 'http://alert-handler:8080/warning'
```

---

## 六、完整可观测性方案

### 一键启动所有组件

```yaml
# docker-compose-observability.yml
version: '3'

services:
  # 链路追踪
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "6831:6831/udp"
      - "4317:4317"

  # 指标存储
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./alert_rules.yml:/etc/prometheus/alert_rules.yml

  # 可视化
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    depends_on:
      - prometheus

  # 告警
  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml

  # 日志
  elasticsearch:
    image: elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"

  kibana:
    image: kibana:8.8.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

  logstash:
    image: logstash:8.8.0
    ports:
      - "5000:5000"
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
```

```bash
docker-compose -f docker-compose-observability.yml up -d
```

---

## 七、大厂常见可观测性坑点

### 坑点 1：日志没有 TraceID

**问题：**

```
订单服务日志：ERROR 2024-01-15 10:30:00 - Database connection failed
库存服务日志：ERROR 2024-01-15 10:30:01 - Inventory deduction failed
```

不知道这两条日志是不是同一个请求。

**正确做法：**

```json
{"level": "error", "trace_id": "abc-123", "message": "Database connection failed"}
{"level": "error", "trace_id": "abc-123", "message": "Inventory deduction failed"}
```

### 坑点 2：只监控平均响应时间

**问题：**

```
平均 RT = 100ms（看起来很好）
实际：
  90% 请求 < 50ms
  9% 请求 < 200ms
  1% 请求 > 5s（用户已经骂街了）
```

**正确做法：** 同时监控 P50、P95、P99，P99 > 1s 要告警

### 坑点 3：告警规则没有 for

**问题：** 网络抖动 1 秒，触发 100 条告警

**正确做法：** 设置 `for: 2m`，持续 2 分钟才告警

### 坑点 4：全量采样拖慢系统

**问题：** 每个请求都创建 Span，高并发时数据量极大

**正确做法：**

```python
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased

# 只采样 10% 的请求
sampler = TraceIdRatioBased(0.1)
provider = TracerProvider(sampler=sampler, resource=resource)
```

### 坑点 5：指标 Label 滥用

**问题：**

```python
# 把 user_id 作为 Label！
REQUEST_COUNT.labels(user_id=user_id).inc()
# 1000 万用户 = 1000 万个 Label 组合 → Prometheus 内存爆炸
```

**原则：** Label 的值不能是高基数（high cardinality），不能用 user_id、order_id、IP 做 Label

### 坑点 6：日志量太大，查询慢

**正确做法：**

```python
# 生产环境只记录 INFO 及以上
logging.basicConfig(level=logging.INFO)

# 高频接口的 DEBUG 日志采样
if random.random() < 0.01:  # 1% 采样
    logger.debug("Detailed request info", ...)
```

---

## 八、面试高频题

### 1. 可观测性三大支柱是什么？

**参考答案：**

- **Metrics（指标）**：系统整体状态，如 QPS、RT、错误率。用 Prometheus 采集，Grafana 展示。
- **Logging（日志）**：单次事件详情，如错误信息、业务流程。用 ELK 存储和查询。
- **Tracing（链路追踪）**：请求的完整调用链，跨服务追踪。用 Jaeger/SkyWalking。

**三者关系：** Metrics 发现问题 → Tracing 定位到哪个服务 → Logging 查看具体错误

---

### 2. TraceID 是怎么在服务间传递的？

**参考答案：**

使用 **W3C TraceContext** 标准（OpenTelemetry）：

```
HTTP 请求头：
traceparent: 00-{trace_id}-{span_id}-01
```

**流程：**
1. 第一个服务生成 TraceID
2. 调用下游时，把 TraceID 注入到 HTTP Header
3. 下游服务从 Header 提取 TraceID，继续 Trace
4. 消息队列：把 TraceID 放到消息 Metadata 里

---

### 3. 为什么要监控 P99 而不是平均值？

**参考答案：**

平均值会掩盖尾部延迟：

```
1000 个请求中：
990 个 50ms
10 个 5000ms
平均值 = (990×50 + 10×5000) / 1000 = 99.5ms（看起来很好）
P99 = 5000ms（1% 用户体验极差）
```

用 P99 能发现真实的用户体验问题。

---

### 4. 怎么避免告警疲劳？

**参考答案：**

1. **告警必须可操作**：触发了就知道怎么处理
2. **设置持续时间（for）**：避免短暂波动触发告警
3. **告警分级**：P0~P3，不同级别不同处理方式
4. **告警聚合**：同类告警合并，不重复发送
5. **定期 review**：清理无效告警
6. **有 Runbook**：每个告警附带处理步骤

---

### 5. 全链路追踪的采样率怎么设置？

**参考答案：**

**不能全量采样：** 高并发时追踪数据量太大，影响系统性能

**采样策略：**
- **固定比例采样**：采样 10%，适合高并发
- **错误必采**：所有错误请求必须采样
- **慢请求必采**：超过阈值的慢请求必须采样
- **头部采样**：在入口决定是否采样

```python
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ParentBased

sampler = ParentBased(TraceIdRatioBased(0.1))
```

---

## 九、核心结论

1. **可观测性三大支柱**：Metrics、Logging、Tracing，缺一不可
2. **TraceID 贯穿全链路**：所有日志、Span 都要带 TraceID
3. **日志必须结构化**：JSON 格式，方便搜索
4. **OpenTelemetry 是标准**：用它解耦代码和追踪框架
5. **监控 P99 而不是平均值**：平均值掩盖真实问题
6. **告警要有 for**：避免短暂波动触发
7. **采样不能全量**：高并发下按比例采样
8. **Label 不能高基数**：不能用 user_id、order_id 做 Label
9. **告警分级**：P0 电话叫醒，P3 邮件即可
10. **ELK + Prometheus + Jaeger**：可观测性标准技术栈

---

## 十、练习题

### 练习 1：完整链路追踪

**要求：** 搭建两个 FastAPI 服务（订单服务、库存服务），接入 Jaeger：
1. 订单服务调用库存服务
2. 在 Jaeger UI 看到完整的调用链
3. TraceID 在两个服务的日志中都能看到

### 练习 2：自定义 Grafana Dashboard

**要求：** 为订单服务创建 Grafana Dashboard，包含 QPS、P50/P95/P99 响应时间、错误率、活跃连接数、下单成功率

### 练习 3：告警规则设计

**要求：** 为以下场景设计告警规则：
1. 订单服务 P99 > 2 秒
2. 下单失败率 > 5%
3. Redis 缓存命中率 < 80%
4. 库存服务不可用

每个告警要包含触发条件、持续时间、告警级别、告警内容

---

## 十一、下讲预告

下一讲进入微服务的"运输层"：

**第 8 讲：容器化与 CI/CD（Python 版）— Docker、K8s、自动化部署实战**

会讲 Docker 镜像构建最佳实践、Python 服务的 Dockerfile 编写、docker-compose 多服务编排、Kubernetes 核心概念、微服务的 K8s 部署方案、滚动更新与零停机部署、HPA 弹性伸缩、CI/CD 流水线搭建、大厂常见容器化坑点。
