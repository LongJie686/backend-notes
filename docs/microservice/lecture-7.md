# 第7讲：可观测性（监控、日志、链路追踪）

## 核心结论（5条必记）

1. **可观测性三大支柱** -- Metrics（指标监控）、Logging（日志记录）、Tracing（链路追踪），三者结合才能完整掌握系统状态
2. **全链路追踪的核心是TraceID传递** -- 每个请求生成唯一TraceID，在服务间调用中传递，将所有日志关联起来
3. **监控要覆盖业务指标** -- 不只是CPU、内存等系统指标，还要监控QPS、响应时间、错误率、Token消耗等业务指标
4. **告警要分级避免告警疲劳** -- P0核心告警必须响应，P2次要告警可以异步处理，告警太多等于没有告警
5. **日志要结构化并包含上下文** -- JSON格式，包含TraceID、用户ID、请求参数等，便于检索和分析

---

## 一、可观测性三大支柱

### Metrics（指标监控）

**什么是指标：**
- 时间序列数据
- 数值型，可聚合
- 用于监控和告警

**核心指标：**

| 类别 | 指标 | 说明 |
|------|------|------|
| 延迟 | P50/P95/P99响应时间 | 99%的用户等待时间 |
| 吞吐 | QPS/TPS | 系统处理能力 |
| 错误 | 错误率、超时率 | 系统稳定性 |
| 资源 | CPU/内存/磁盘/网络 | 系统健康度 |
| 业务 | 订单量、支付成功率 | 业务健康度 |

### Logging（日志记录）

**什么是日志：**
- 离散事件记录
- 文本或结构化数据
- 用于问题排查和审计

**日志级别：**

| 级别 | 说明 | 使用场景 |
|------|------|----------|
| ERROR | 错误，需要立即处理 | 系统异常、业务失败 |
| WARN | 警告，需要关注 | 性能问题、降级熔断 |
| INFO | 关键信息 | 关键业务节点、系统状态 |
| DEBUG | 调试信息 | 开发调试、问题排查 |

### Tracing（链路追踪）

**什么是链路追踪：**
- 记录请求在微服务间的完整调用路径
- 每个调用包含时间戳、耗时、状态
- 用于性能分析和故障定位

**核心概念：**

```
TraceID: 全局唯一，标识一次完整请求
SpanID: 标识单个服务调用
ParentSpanID: 父调用，形成调用树
```

**调用链示例：**
```
TraceID: abc123
  Span1: API网关 (100ms)
    Span2: 用户服务 (50ms)
      Span3: 数据库查询 (30ms)
    Span4: 订单服务 (40ms)
      Span5: 库存服务 (20ms)
```

---

## 二、全链路追踪原理

### TraceID生成与传递

**生成TraceID：**
```
请求到达网关
  -> 生成全局唯一TraceID（如UUID）
  -> 写入MDC或Request Header
  -> 在服务间调用中传递
```

**传递方式：**
- HTTP Header: `X-Trace-Id`
- RPC Metadata: gRPC Metadata
- MDC: 线程上下文

### Span埋点

**Span包含信息：**
```
{
  "traceId": "abc123",
  "spanId": "span1",
  "parentSpanId": null,
  "service": "api-gateway",
  "operation": "GET /api/order",
  "startTime": 1678900000000,
  "duration": 100,
  "tags": {
    "user.id": "12345",
    "http.status_code": "200"
  },
  "logs": [
    {"timestamp": 1678900000000, "event": "request_received"},
    {"timestamp": 1678900000100, "event": "request_completed"}
  ]
}
```

**埋点位置：**
- 请求入口（Controller）
- RPC调用前后
- 数据库查询前后
- 缓存访问前后
- 外部API调用

### 调用链分析

**从调用链可以发现：**
- 哪个服务响应慢
- 哪个环节是瓶颈
- 请求的完整路径
- 串行还是并行调用

**示例分析：**
```
总耗时: 1000ms
  服务A: 200ms
  服务B: 500ms (瓶颈)
  服务C: 300ms
```

---

## 三、主流链路追踪方案

| 方案 | 特点 | 优势 | 劣势 |
|------|------|------|------|
| SkyWalking | JavaAgent无侵入 | 部署简单，中文友好 | 主要支持Java |
| Zipkin | Twitter开源 | 社区活跃，语言支持广 | 需要代码侵入 |
| Jaeger | Uber开源 | 性能好，云原生 | 部署复杂 |
| Pinpoint | 韩国Naver | 功能强大，无侵入 | 资源占用高 |
| Datadog | SaaS服务 | 功能全面，易用 | 价格贵 |

### SkyWalking

**特点：**
- JavaAgent无侵入埋点
- 支持多种中间件
- 服务拓扑图自动生成
- 中文文档友好

**部署：**
```bash
# 下载
wget https://downloads.apache.org/skywalking/8.10.0/apache-skywalking-apm-bin-8.10.0.tar.gz

# 启动OAP服务
bin/oapService.sh

# 启动WebUI
bin/webappService.sh
```

**Java应用接入：**
```bash
java -javaagent:/path/to/skywalking-agent.jar \
     -Dskywalking.agent.service_name=user-service \
     -Dskywalking.collector.backend_service=localhost:11800 \
     -jar user-service.jar
```

### Zipkin

**特点：**
- 轻量级
- 多语言支持
- 存储灵活（MySQL、Elasticsearch、Cassandra）

**部署：**
```bash
# Docker快速启动
docker run -d -p 9411:9411 \
  --name zipkin \
  openzipkin/zipkin
```

**Java应用接入：**
```xml
<dependency>
    <groupId>io.zipkin.brave</groupId>
    <artifactId>brave-spring-boot-starter</artifactId>
</dependency>
```

---

## 四、日志采集与管理

### ELK架构

```
应用日志 -> Filebeat/Logstash
  -> Elasticsearch存储
  -> Kibana可视化
```

**组件说明：**
- **Filebeat**: 轻量级日志采集器
- **Logstash**: 日志处理、转换、过滤
- **Elasticsearch**: 日志存储和搜索
- **Kibana**: 日志查询和可视化

### 日志规范

**结构化日志：**
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "level": "INFO",
  "service": "user-service",
  "traceId": "abc123",
  "spanId": "span1",
  "userId": "12345",
  "message": "用户登录成功",
  "duration": 100,
  "tags": ["login", "success"]
}
```

**日志最佳实践：**
- JSON格式，便于解析
- 包含TraceID，便于关联
- 记录关键参数和结果
- 敏感信息脱敏
- 日志级别使用得当

### 日志查询

**按TraceID查询：**
```
traceId: "abc123"
```

**按时间范围查询：**
```
@timestamp: [2024-01-01 TO 2024-01-02]
```

**按服务查询：**
```
service: "user-service" AND level: "ERROR"
```

---

## 五、指标监控与告警

### Prometheus + Grafana

**架构：**
```
应用暴露Metrics端点
  -> Prometheus抓取指标
  -> Grafana可视化
  -> AlertManager告警
```

**核心指标类型：**

| 类型 | 说明 | 示例 |
|------|------|------|
| Counter | 只增不减 | 请求总数 |
| Gauge | 可增可减 | 当前内存使用 |
| Histogram | 分布统计 | 响应时间分布 |
| Summary | 分布统计摘要 | P95响应时间 |

**Prometheus查询示例：**
```
# QPS
rate(http_requests_total[5m])

# P95响应时间
histogram_quantile(0.95, rate(http_duration_seconds_bucket[5m]))

# 错误率
rate(http_errors_total[5m]) / rate(http_requests_total[5m])
```

### 告警设计

**告警分级：**

| 级别 | 说明 | 响应时间 | 示例 |
|------|------|----------|------|
| P0 | 核心服务故障 | 立即 | 支付不可用 |
| P1 | 重要服务异常 | 5分钟内 | 订单服务超时 |
| P2 | 次要服务异常 | 30分钟内 | 评论服务慢 |
| P3 | 潜在风险 | 工作时间 | 磁盘使用率>80% |

**告警规则示例：**
```yaml
groups:
  - name: api_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: P1
        annotations:
          summary: "API错误率过高"
          description: "{{ $labels.service }} 错误率 > 5%"

      - alert: HighLatency
        expr: histogram_quantile(0.99, rate(http_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: P2
        annotations:
          summary: "API响应延迟过高"
          description: "{{ $labels.service }} P99延迟 > 1s"
```

---

## 六、日志与链路关联

### TraceID注入日志

**Logback配置：**
```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} [traceId=%X{traceId}] - %msg%n</pattern>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE" />
    </root>
</configuration>
```

**MDC传递：**
```java
@Component
public class TraceIdFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
        String traceId = request.getHeader("X-Trace-Id");
        if (StringUtils.isEmpty(traceId)) {
            traceId = UUID.randomUUID().toString();
        }
        MDC.put("traceId", traceId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

---

## 七、面试高频题

### 1. 可观测性三大支柱是什么？
Metrics（指标监控）、Logging（日志记录）、Tracing（链路追踪） -> Metrics监控系统和业务指标 -> Logging记录离散事件用于排查 -> Tracing追踪完整调用链路 -> 三者结合才能完整掌握系统状态

### 2. TraceID怎么在服务间传递？
请求到达时生成TraceID放入Request Header -> RPC调用时通过HTTP Header或gRPC Metadata传递 -> 服务间层层传递保持TraceID不变 -> 写入MDC在日志中输出

### 3. 监控哪些指标最重要？
黄金信号：延迟、流量、错误、饱和度 -> 业务指标：订单量、支付成功率 -> 资源指标：CPU、内存、磁盘、网络 -> 分业务告警分级避免告警疲劳

### 4. 怎么定位"某个服务偶尔超时"？
通过TraceID关联所有服务的日志 -> 分析调用链找到慢的环节 -> 查看该服务的监控指标 -> 定位是数据库慢、锁竞争、GC还是网络问题

---

## 练习题

- [ ] 练习1：本地搭建SkyWalking，体验链路追踪
- [ ] 练习2：实现TraceID的生成和传递
- [ ] 练习3：搭建ELK日志采集系统
- [ ] 练习4：配置Prometheus + Grafana监控
- [ ] 练习5：设计告警规则并模拟告警触发

---

## 下讲预告

第8讲将学习容器化与CI/CD：Docker基础、Kubernetes核心概念、微服务容器化部署、CI/CD流水线等DevOps能力。
