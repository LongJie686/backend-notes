# 系统监控与告警

## 监控指标

| 指标 | 说明 | 告警参考 |
|------|------|---------|
| **延迟 P50/P95/P99** | 请求响应时间分位数 | P99 > 2s 需关注 |
| **错误率** | 5xx 响应占比 | > 1% 触发告警 |
| **QPS** | 每秒请求数 | 配合容量规划 |
| **CPU / 内存 / 磁盘** | 资源使用率 | > 80% 需关注 |
| **连接池** | 数据库/Redis 活跃连接 | 接近上限需扩容 |

## 日志设计

```python
import logging
import json
from datetime import datetime

# 结构化日志
class JSONFormatter(logging.Formatter):
    def format(self, record):
        log = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
            "request_id": getattr(record, "request_id", None),
        }
        return json.dumps(log, ensure_ascii=False)

# 配置
logger = logging.getLogger("app")
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logger.addHandler(handler)
logger.setLevel(logging.INFO)
```

**日志级别使用**：DEBUG 调试信息 / INFO 关键流程 / WARNING 异常但不影响主流程 / ERROR 需要处理 / CRITICAL 系统不可用

## Prometheus + Grafana

```yaml
# prometheus.yml - 指标采集配置
scrape_configs:
  - job_name: "fastapi"
    metrics_path: "/metrics"
    static_configs:
      - targets: ["api:8000"]

  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]
```

```yaml
# 告警规则
groups:
  - name: api-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API 错误率超过 1%"
```

## AI 应用特有监控

| 监控项 | 说明 | 采集方式 |
|--------|------|---------|
| **Token 消耗** | 每次请求的 input/output token 数 | 从 API 响应中提取 |
| **模型延迟** | 首 Token 时间 (TTFT)、总生成时间 | 请求耗时统计 |
| **幻觉率** | 生成内容与事实不符的比例 | 抽样人工评估 + 自动化校验 |
| **成本追踪** | 按 model / project / user 统计费用 | `tokens * 单价` 计算 |

## 告警策略

| 策略 | 说明 | 示例 |
|------|------|------|
| **阈值告警** | 指标超过固定值 | 错误率 > 5% |
| **趋势告警** | 指标持续上升 | 磁盘使用率 1 小时增长 > 10% |
| **分级通知** | P1 电话/P2 短信/P3 邮件 | P1: 服务不可用立即电话 |

**告警原则**：可操作性（收到告警知道怎么处理）、避免告警疲劳（减少误报）、分级明确。
