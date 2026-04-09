# 第七讲：工程化部署与运维

> 阶段目标：掌握大模型应用从开发环境到生产部署的全流程，建立运维和监控体系

## 学习目标

1. 掌握 Docker 容器化部署方法
2. 了解主流模型推理服务的特点和使用
3. 掌握流式响应（SSE）的实现
4. 理解 API 网关与负载均衡方案
5. 学会搭建监控告警体系
6. 掌握成本控制的策略和方法
7. 了解 CI/CD 与灰度发布流程

## 核心内容

### Docker 容器化部署

容器化是大模型应用部署的标准方式，确保环境一致性和可移植性。

#### 应用服务 Dockerfile

```dockerfile
# 后端 API 服务
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY . .

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### Docker Compose 编排

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DATABASE_URL=postgresql://user:pass@db:5432/llmapp
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: llmapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  # 向量数据库
  milvus:
    image: milvusdb/milvus:v2.3.0
    ports:
      - "19530:19530"
    volumes:
      - milvusdata:/var/lib/milvus

volumes:
  pgdata:
  redisdata:
  milvusdata:
```

#### 环境管理

```
.env.dev      -- 开发环境配置
.env.staging  -- 预发布环境配置
.env.prod     -- 生产环境配置
```

### 模型推理服务

#### vLLM

高吞吐量的推理服务，支持 PagedAttention 和连续批处理。

```bash
# 启动 vLLM 服务
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2.5-7B-Instruct \
    --host 0.0.0.0 \
    --port 8001 \
    --tensor-parallel-size 1 \
    --gpu-memory-utilization 0.9 \
    --max-model-len 8192
```

```python
# 使用 OpenAI 兼容 API 调用 vLLM
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8001/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="Qwen/Qwen2.5-7B-Instruct",
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)
```

特点：
- OpenAI API 兼容，迁移成本低
- PagedAttention 减少显存碎片
- 连续批处理提升吞吐量
- 支持多卡并行推理

#### TGI（Text Generation Inference）

HuggingFace 推出的推理服务。

```bash
# 启动 TGI 服务
docker run --gpus all -p 8002:80 \
    -v $PWD/data:/data \
    ghcr.io/huggingface/text-generation-inference:latest \
    --model-id Qwen/Qwen2.5-7B-Instruct \
    --max-input-length 4096 \
    --max-total-tokens 8192
```

特点：
- HuggingFace 生态集成好
- 支持张量并行和流水线并行
- 内置 Token 流式传输
- 支持水印和自定义采样

#### Ollama

本地部署最简单的方式，适合开发和小规模使用。

```bash
# 安装 Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 拉取模型
ollama pull qwen2.5:7b

# 运行
ollama run qwen2.5:7b

# API 调用
curl http://localhost:11434/api/generate -d '{
    "model": "qwen2.5:7b",
    "prompt": "解释 Transformer"
}'
```

特点：
- 一键安装和使用
- 支持 CPU 和 GPU
- 自动管理模型下载和缓存
- 提供 REST API

#### 方案选择

| 方案 | 适用场景 | GPU 要求 | 吞吐量 |
|------|----------|----------|--------|
| vLLM | 高并发生产环境 | 必须 | 高 |
| TGI | HuggingFace 生态 | 必须 | 高 |
| Ollama | 开发/小规模部署 | 可选 | 中 |
| OpenAI API | 快速上线/无 GPU | 无 | 取决于 API |

### 流式响应（SSE）

流式响应让用户逐字看到生成内容，大幅提升体验。

#### SSE 协议

Server-Sent Events 是基于 HTTP 的单向实时通信协议：

```
data: {"content": "你"}

data: {"content": "好"}

data: {"content": "，"}

data: [DONE]
```

#### 服务端实现（FastAPI）

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from openai import OpenAI
import json

app = FastAPI()
client = OpenAI()

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async def generate():
        stream = client.chat.completions.create(
            model="gpt-4o",
            messages=request.messages,
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content:
                data = json.dumps({
                    "content": chunk.choices[0].delta.content
                }, ensure_ascii=False)
                yield f"data: {data}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
```

#### 前端接收

```javascript
const response = await fetch('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split('\n');

    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            const parsed = JSON.parse(data);
            appendToUI(parsed.content);
        }
    }
}
```

### API 网关与负载均衡

#### 网关架构

```
客户端 --> API 网关 --> 后端服务集群
              |
              +-- 认证鉴权
              +-- 限流熔断
              +-- 负载均衡
              +-- 日志记录
              +-- 协议转换
```

#### Nginx 配置示例

```nginx
upstream llm_backend {
    least_conn;  # 最少连接数负载均衡

    server 10.0.0.1:8000 weight=3;  # 高配置服务器权重更大
    server 10.0.0.2:8000 weight=2;
    server 10.0.0.3:8000 weight=1;
}

server {
    listen 80;
    server_name api.example.com;

    # 流式响应需要关闭缓冲
    location /chat/stream {
        proxy_pass http://llm_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 300s;  # 大模型响应可能较慢
    }

    # 普通接口
    location /api/ {
        proxy_pass http://llm_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 限流
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    location /api/ {
        limit_req zone=api burst=20 nodelay;
    }
}
```

#### 多模型路由

```python
# 根据请求特征路由到不同模型
class ModelRouter:
    def __init__(self):
        self.routes = {
            "simple": {"endpoint": "http://ollama:11434", "model": "qwen2.5:7b"},
            "complex": {"endpoint": "http://vllm:8001", "model": "qwen2.5:72b"},
            "api": {"endpoint": "https://api.openai.com", "model": "gpt-4o"},
        }

    def route(self, request):
        """根据任务复杂度选择模型"""
        complexity = self._estimate_complexity(request)

        if complexity == "simple":
            return self.routes["simple"]
        elif complexity == "medium":
            return self.routes["complex"]
        else:
            return self.routes["api"]

    def _estimate_complexity(self, request):
        """估算任务复杂度"""
        prompt = request.messages[-1].content

        if len(prompt) < 100 and not request.requires_reasoning:
            return "simple"
        elif len(prompt) < 500:
            return "medium"
        else:
            return "complex"
```

### 监控告警

#### 核心指标

| 类别 | 指标 | 说明 | 告警阈值 |
|------|------|------|----------|
| 性能 | 响应时间（P50/P95/P99） | 请求处理耗时 | P99 > 30s |
| 性能 | 首 Token 时间（TTFT） | 流式响应首个 Token 耗时 | > 5s |
| 性能 | Tokens/second | 生成速度 | < 10 tok/s |
| 可用性 | 错误率 | 请求失败比例 | > 5% |
| 可用性 | API 限流率 | 被限流的请求比例 | > 10% |
| 成本 | Token 消耗量 | 每日/每用户消耗 | 日环比增长 > 50% |
| 成本 | 单次请求成本 | 平均每次调用费用 | 超预算 20% |
| 业务 | 用户满意度 | 点赞/踩比例 | 踩比 > 20% |
| 资源 | GPU 利用率 | 推理服务 GPU 使用率 | 持续 > 90% |

#### Prometheus + Grafana 搭建

```python
# 在 FastAPI 中接入 Prometheus
from prometheus_fastapi_instrumentator import Instrumentator
from prometheus_client import Counter, Histogram

# 自定义指标
token_counter = Counter(
    'llm_tokens_total',
    'Total tokens consumed',
    ['model', 'type']  # type: input/output
)

latency_histogram = Histogram(
    'llm_request_duration_seconds',
    'Request duration in seconds',
    ['model', 'endpoint']
)

# FastAPI 集成
app = FastAPI()
Instrumentator().instrument(app).expose(app)

# 在请求处理中记录指标
@app.post("/chat")
async def chat(request: ChatRequest):
    start_time = time.time()

    response = await process_request(request)

    # 记录指标
    token_counter.labels(model=request.model, type="input").inc(request.input_tokens)
    token_counter.labels(model=request.model, type="output").inc(response.output_tokens)
    latency_histogram.labels(model=request.model, endpoint="/chat").observe(time.time() - start_time)

    return response
```

```yaml
# Grafana 告警规则示例
groups:
  - name: llm_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "LLM API 错误率过高"
          description: "最近5分钟错误率超过5%"

      - alert: HighTokenConsumption
        expr: increase(llm_tokens_total[1h]) > 1000000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Token 消耗异常增长"
          description: "最近1小时 Token 消耗超过100万"
```

### 成本控制

#### 成本分析

```
总成本 = Token 调用费 + 服务器费用 + 向量库费用 + 存储费用

Token 调用费（占比通常最大）：
  = 输入 Token 数 * 输入单价 + 输出 Token 数 * 输出单价
```

#### 优化策略

**模型分级使用**

```python
# 根据任务复杂度选择不同级别的模型
def select_model(task):
    if task.complexity == "simple":
        return "gpt-4o-mini"     # 便宜，处理简单任务
    elif task.complexity == "medium":
        return "qwen-plus"       # 中等价格，性价比高
    else:
        return "gpt-4o"          # 贵，但效果最好
```

**缓存策略**

```python
import hashlib
import json

class ResponseCache:
    def __init__(self, redis_client, ttl=3600):
        self.redis = redis_client
        self.ttl = ttl

    def get(self, messages, model, params):
        key = self._make_key(messages, model, params)
        return self.redis.get(key)

    def set(self, messages, model, params, response):
        key = self._make_key(messages, model, params)
        self.redis.setex(key, self.ttl, json.dumps(response))

    def _make_key(self, messages, model, params):
        content = json.dumps({"messages": messages, "model": model, "params": params})
        return f"llm:cache:{hashlib.md5(content.encode()).hexdigest()}"
```

**Token 控制**

```python
# 输入 Token 控制
def trim_context(messages, max_tokens=4000):
    """确保输入不超过 Token 限制"""
    total = sum(count_tokens(m["content"]) for m in messages)
    while total > max_tokens and len(messages) > 1:
        removed = messages.pop(1)  # 保留系统消息，移除最早的对话
        total -= count_tokens(removed["content"])
    return messages

# 输出 Token 控制
max_tokens_map = {
    "summary": 200,      # 摘要类任务
    "translation": 1000,  # 翻译类任务
    "explanation": 500,   # 解释类任务
    "chat": 800,          # 对话类任务
}
```

**预算管理**

```python
class BudgetManager:
    def __init__(self, db):
        self.db = db

    def check_budget(self, user_id, estimated_cost):
        """检查用户是否超出预算"""
        daily_spend = self.db.get_daily_spend(user_id)
        daily_limit = self.db.get_user_budget(user_id)

        if daily_spend + estimated_cost > daily_limit:
            return False, "今日预算已用尽"
        return True, None

    def record_spend(self, user_id, cost, model, tokens):
        """记录消费"""
        self.db.insert_spend(user_id, cost, model, tokens)
```

### CI/CD 与灰度发布

#### CI/CD 流程

```yaml
# .github/workflows/deploy.yml
name: Deploy LLM App

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: |
          pip install -r requirements.txt
          pytest tests/ -v

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t llm-app:${{ github.sha }} .
      - name: Push to registry
        run: |
          docker tag llm-app:${{ github.sha }} registry.example.com/llm-app:${{ github.sha }}
          docker push registry.example.com/llm-app:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          ssh deploy@server "cd /app && docker-compose pull && docker-compose up -d"
```

#### 灰度发布

```nginx
# 基于 Cookie 的灰度路由
split_clients "${{cookie}user_id}" $llm_backend {
    10%   canary_backend;   # 10% 流量到新版本
    *     stable_backend;   # 90% 流量到稳定版本
}
```

```python
# 基于特征的灰度策略
def get_service_version(user):
    """决定用户访问哪个版本"""
    if user.is_beta_tester:
        return "canary"
    if user.id % 100 < 10:  # 10% 用户灰度
        return "canary"
    return "stable"
```

## 重点认知

1. **部署不是终点**：上线只是开始，监控、优化、迭代才是长期工作
2. **流式响应是标配**：大模型生成速度有限，流式输出是用户体验的必需品
3. **成本控制要前置**：不要等到账单爆炸才考虑成本，在架构设计阶段就要规划
4. **监控粒度要细**：Token 级别的监控才能精准定位成本和性能问题
5. **灰度发布降低风险**：大模型行为不确定性强，灰度发布能降低上线风险

## 实战建议

1. 从 Docker Compose 开始部署，熟悉后再迁移到 Kubernetes
2. 实现请求级别的 Token 计量和成本追踪
3. 设置每日/每月消费预算，超预算自动告警
4. 为不同任务配置不同的模型和参数模板
5. 实现缓存层，对重复查询直接返回缓存结果

## 常见问题

**Q：vLLM 和 TGI 怎么选？**

A：如果追求极致吞吐量选 vLLM；如果深度使用 HuggingFace 生态选 TGI。两者都支持 OpenAI 兼容 API，切换成本低。建议在具体业务场景下做基准测试再决定。

**Q：流式响应如何做超时控制？**

A：设置首 Token 超时（如 30s）和总超时（如 300s）。首 Token 超时内没有数据返回则断开连接；总超时控制整个请求的最长持续时间。Nginx 的 proxy_read_timeout 可以配置。

**Q：如何实现多租户的 Token 用量统计？**

A：在 API 网关层或应用层记录每次请求的 Token 数，按租户 ID 聚合存储。可以使用 Redis 实时计数 + 数据库持久化的双层方案。

## 小结

本讲覆盖了大模型应用从容器化部署到运维监控的完整工程化链路。工程化是大模型应用从原型到生产的关键跨越，没有好的工程实践，再好的模型也难以稳定服务用户。下一讲将学习安全合规与架构进阶，这是保障系统长期健康运行的基石。
