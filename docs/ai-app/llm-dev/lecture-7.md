# 第7讲：工程化部署、监控与运维

> 阶段目标：把大模型应用部署到生产环境，建立完整的运维体系。

## 学习目标

- 掌握 Docker 容器化部署
- 理解模型推理服务选型
- 实现流式响应
- 建立监控告警体系

## 核心内容

### Docker 容器化部署

**Dockerfile 示例：**

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**docker-compose.yml：**

```yaml
version: "3.8"
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - redis
      - db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: llm_app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### 模型推理服务

| 服务 | 特点 | 适用场景 |
|------|------|----------|
| vLLM | 高吞吐，PagedAttention | 大规模推理 |
| TGI | HuggingFace 官方 | HuggingFace 生态 |
| Ollama | 本地部署简单 | 开发测试 |
| Triton | NVIDIA 官方 | GPU 优化 |

**推理性能优化：**

| 技术 | 说明 | 效果 |
|------|------|------|
| KV Cache | 缓存已计算的 Key/Value | 减少 50%+ 计算 |
| 连续批处理 | 动态组 batch | 提升 2-3x 吞吐 |
| 投机采样 | 小模型先猜，大模型验证 | 降低延迟 |
| 量化推理 | INT4/INT8 推理 | 降低显存和延迟 |

### 流式响应实现

**后端 SSE：**

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    async def generate():
        stream = client.chat.completions.create(
            model="gpt-4o",
            messages=request.messages,
            stream=True
        )
        for chunk in stream:
            if chunk.choices[0].delta.content:
                data = json.dumps({"content": chunk.choices[0].delta.content})
                yield f"data: {data}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

**前端处理：**

```javascript
const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({messages})
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    // 解析 SSE 数据并更新 UI
    appendToChat(parseSSE(text));
}
```

### API 网关与负载均衡

**Nginx 配置示例：**

```nginx
upstream llm_backend {
    least_conn;
    server 10.0.0.1:8000;
    server 10.0.0.2:8000;
    server 10.0.0.3:8000;
}

server {
    location /api/ {
        proxy_pass http://llm_backend;
        proxy_read_timeout 120s;
        proxy_buffering off;  # SSE 必须
    }
}
```

### 监控体系

**Prometheus + Grafana：**

**关键监控指标：**

| 类别 | 指标 | 告警阈值 |
|------|------|----------|
| 延迟 | P50/P95/P99 响应时间 | P99 > 10s |
| 吞吐 | QPS / 并发连接数 | 根据容量设定 |
| 错误 | 错误率 / 超时率 | > 1% |
| Token | 每分钟消耗量 | 预算的 80% |
| 成本 | 每日/每月费用 | 预算的 90% |
| 模型 | 幻觉率 / 拒答率 | 根据场景设定 |

### 成本控制

**策略矩阵：**

| 策略 | 说明 | 节省幅度 |
|------|------|----------|
| 语义缓存 | 相似问题直接返回缓存结果 | 20-40% |
| 模型路由 | 简单任务用小模型 | 30-50% |
| Prompt 压缩 | 精简 System Prompt | 10-20% |
| 对话摘要 | 压缩历史对话 | 15-30% |
| 异步处理 | 非实时任务走队列 | 削峰填谷 |

### CI/CD 与灰度发布

**CI 流程：**

```
代码提交 -> 单元测试 -> 集成测试 -> 构建 Docker 镜像 -> 推送镜像仓库
```

**灰度发布策略：**
- 金丝雀发布：先 5% 流量到新版本
- 观察 30 分钟无异常后逐步扩大
- 出问题立即回滚

## 重点认知

1. **流式输出是必须的**，不是可选的
2. **监控要覆盖业务指标**，不只是系统指标
3. **成本控制要提前设计**，不是事后补救
4. **灰度发布是安全上线的保障**

## 实战建议

1. 用 Docker 部署完整的"心语"情感机器人
2. 接入 Prometheus + Grafana 监控
3. 实现流式响应
4. 设计告警规则
5. 做一次压测，找到性能瓶颈并优化

## 常见问题

**Q: 大模型推理延迟高怎么优化？**
A: 优先用 KV Cache + 连续批处理（vLLM 默认开启），其次考虑量化推理，最后考虑模型路由。

**Q: 流式响应怎么实现？**
A: 后端用 SSE（Server-Sent Events），FastAPI 用 StreamingResponse，前端用 fetch + ReadableStream。

**Q: 模型服务挂了怎么做降级？**
A: 准备备用模型（如小模型），设定超时和重试，超过阈值切换到降级响应。

## 小结

本讲学习了工程化部署的核心内容：Docker 容器化、推理服务选型、流式响应、监控告警、成本控制。关键是从第一天就把监控和成本控制考虑进去。下一讲进入安全合规。
