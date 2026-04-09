# 第 8 讲：生产环境部署与运维

## 核心结论（6 条必记）

1. **容器化是部署的基础** -- Docker Compose 适合中小规模，K8s 适合大规模生产
2. **高可用需要在每个层面做冗余** -- 服务多副本、存储集群、模型调用多厂商互备
3. **限流要从网关层和应用层同时做** -- Nginx 限流 + 应用层限流，防止系统过载
4. **长时任务必须用异步队列** -- Celery + RabbitMQ，支持状态查询和取消
5. **监控告警要覆盖延迟、错误率、成本三个核心维度** -- Prometheus + Grafana
6. **灰度发布降低变更风险，熔断器保障系统稳定性** -- 逐步切流 + 自动降级

---

## 一、容器化部署

### Docker 部署方案

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY . .

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  agent-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - REDIS_URL=redis://redis:6379
      - QDRANT_URL=http://qdrant:6333
      - MODEL_PROVIDER=qwen
    depends_on:
      - redis
      - qdrant
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  redis_data:
  qdrant_data:
```

### Kubernetes 部署方案

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: agent-system
  template:
    metadata:
      labels:
        app: agent-system
    spec:
      containers:
      - name: agent-api
        image: registry.cn-hangzhou.aliyuncs.com/your-org/agent-system:latest
        ports:
        - containerPort: 8000
        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
          limits:
            memory: "4Gi"
            cpu: "2"
        env:
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: agent-secrets
              key: redis-url
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: agent-service
spec:
  selector:
    app: agent-system
  ports:
  - port: 80
    targetPort: 8000
  type: ClusterIP
```

---

## 二、高可用架构

### 架构设计

```
                    [负载均衡器 Nginx/ALB]
                           |
            +--------------+--------------+
            |              |              |
        [Agent-1]      [Agent-2]      [Agent-3]
            |              |              |
            +--------------+--------------+
                           |
                [共享存储层 Redis + Qdrant]
                           |
                [模型服务层 (多厂商)]
```

### 关键设计点

| 组件 | 高可用方案 | RTO 目标 |
|------|-----------|---------|
| API 服务 | 多副本 + 自动扩缩容 | < 30s |
| Redis | Sentinel 集群 / Cluster | < 10s |
| Qdrant | 分布式部署 + 副本 | < 60s |
| 模型调用 | 多厂商互备 + 自动切换 | < 5s |

---

## 三、负载均衡与限流

### Nginx 负载均衡配置

```nginx
upstream agent_backend {
    least_conn;
    server agent-1:8000 weight=1;
    server agent-2:8000 weight=1;
    server agent-3:8000 weight=1;
    keepalive 32;
}

server {
    listen 80;

    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;

    location /api/ {
        proxy_pass http://agent_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
    }
}
```

### 应用层限流

```python
from fastapi import FastAPI, Request, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address

app = FastAPI()
limiter = Limiter(key_func=get_remote_address)

@app.post("/api/agent/execute")
@limiter.limit("10/minute")
async def execute_agent(request: Request):
    pass

class UserRateLimiter:
    def __init__(self, redis_client):
        self.redis = redis_client

    async def check_rate(self, user_id: str, action: str, limit: int, window: int):
        key = f"rate_limit:{user_id}:{action}"
        current = await self.redis.incr(key)
        if current == 1:
            await self.redis.expire(key, window)
        if current > limit:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后重试")
```

---

## 四、异步任务队列

### Celery + RabbitMQ 方案

```python
from celery import Celery

app = Celery(
    'agent_tasks',
    broker='pyamqp://guest@rabbitmq//',
    backend='redis://redis:6379/1'
)

app.conf.update(
    task_serializer='json',
    result_serializer='json',
    task_track_started=True,
    task_time_limit=600,
    task_soft_time_limit=540,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50
)

@app.task(bind=True, name='execute_report_generation')
def execute_report_generation(self, topic: str, config: dict):
    try:
        self.update_state(state='PROCESSING', meta={'progress': 0, 'step': '初始化'})
        result = report_crew.kickoff(inputs={"topic": topic})
        self.update_state(state='PROCESSING', meta={'progress': 100, 'step': '完成'})
        return {"status": "success", "report": result}
    except Exception as e:
        self.update_state(state='FAILURE', meta={'error': str(e)})
        raise
```

### API 接口设计

```python
from fastapi import FastAPI
from celery.result import AsyncResult

app = FastAPI()

@app.post("/api/report/generate")
async def generate_report(topic: str, config: dict = None):
    task = execute_report_generation.delay(topic, config or {})
    return {"task_id": task.id, "status": "submitted"}

@app.get("/api/report/status/{task_id}")
async def get_report_status(task_id: str):
    result = AsyncResult(task_id)
    return {
        "task_id": task_id,
        "status": result.status,
        "progress": result.info if result.info else None
    }

@app.post("/api/report/cancel/{task_id}")
async def cancel_report(task_id: str):
    AsyncResult(task_id).revoke(terminate=True)
    return {"task_id": task_id, "status": "cancelled"}
```

---

## 五、数据持久化

### 存储方案

| 数据类型 | 存储方案 | 保留期限 | 说明 |
|---------|---------|---------|------|
| 对话历史 | PostgreSQL | 1 年 | 结构化存储，支持查询 |
| 任务状态 | Redis | 7 天 | 高频读写，自动过期 |
| Trace 日志 | Elasticsearch | 90 天 | 全文检索，时序分析 |
| 向量数据 | Qdrant / Milvus | 永久 | 知识库向量存储 |
| 文件输出 | 对象存储 (OSS/S3) | 永久 | 报告、图表等文件 |
| 审计日志 | PostgreSQL | 3 年 | 合规要求，长期保留 |

### 数据库设计

```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    task_type VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    token_usage JSONB,
    cost_amount DECIMAL(10, 4),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
```

---

## 六、监控告警

### Prometheus + Grafana 方案

```python
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from fastapi import Response

REQUEST_COUNT = Counter('agent_requests_total', 'Total requests', ['agent', 'status'])
REQUEST_LATENCY = Histogram('agent_request_latency_seconds', 'Request latency', ['agent'])
TOKEN_USAGE = Counter('agent_token_usage_total', 'Token usage', ['agent', 'type'])
ACTIVE_TASKS = Gauge('agent_active_tasks', 'Active tasks', ['agent'])
COST_ACCUMULATOR = Counter('agent_cost_total', 'Total cost in CNY', ['agent'])

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type="text/plain")
```

### Grafana 告警规则

```yaml
groups:
  - name: agent_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(agent_requests_total{status="error"}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "Agent 错误率过高"
          description: "Agent {{ $labels.agent }} 近5分钟错误率超过10%"

      - alert: HighLatency
        expr: histogram_quantile(0.95, agent_request_latency_seconds) > 60
        for: 5m
        annotations:
          summary: "Agent 延迟过高"

      - alert: BudgetExceeded
        expr: agent_cost_total > 100
        annotations:
          summary: "Agent 成本超限"
```

---

## 七、灰度发布与故障恢复

### 灰度发布策略

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: agent-system
spec:
  replicas: 5
  strategy:
    canary:
      steps:
      - setWeight: 10
      - pause: {duration: 5m}
      - setWeight: 30
      - pause: {duration: 5m}
      - setWeight: 50
      - pause: {duration: 10m}
      - setWeight: 100
      canaryService: agent-canary
      stableService: agent-stable
```

### 故障恢复方案

```python
class CircuitBreaker:
    """熔断器"""
    def __init__(self, failure_threshold: int, recovery_timeout: int):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.last_failure_time = None
        self.state = "closed"  # closed / open / half_open

    async def call(self, func, *args, **kwargs):
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half_open"
            else:
                raise CircuitOpenError()

        try:
            result = await func(*args, **kwargs)
            self.on_success()
            return result
        except Exception:
            self.on_failure()
            raise
```

---

## 八、实战项目：研报生成系统 v3（生产化）

**目标**：将研报生成系统部署到生产环境。

**功能要求**：
1. Docker 容器化部署，包含 API、Worker、Redis、Qdrant 四个服务
2. 使用 Nginx 作为负载均衡，部署 3 个 API 副本
3. 异步任务队列处理报告生成请求
4. Prometheus + Grafana 监控，包含延迟、错误率、成本三个告警
5. 灰度发布策略：10% -> 30% -> 50% -> 100%
6. 熔断器 + 模型降级 + 自动恢复

---

## 练习题（待完成）

- [ ] 练习1：编写一个完整的 Docker Compose 文件，包含 Agent 系统的所有依赖服务
- [ ] 练习2：实现 Prometheus 指标收集，监控 Agent 的请求数、延迟和 Token 消耗
- [ ] 练习3：设计一个故障恢复方案，当模型 A 不可用时自动切换到模型 B
- [ ] 练习4：实现一个熔断器，当连续失败超过阈值时自动切换到降级方案
