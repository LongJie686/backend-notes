# 第5讲：高可用设计（限流、熔断、降级）

## 核心结论（5条必记）

1. **限流保护系统不被压垮** -- 超出容量的请求直接拒绝，令牌桶和漏桶是常用算法
2. **熔断防止故障扩散** -- 下游异常时快速失败，避免线程池耗尽，熔断器有三种状态
3. **降级保障核心功能** -- 非核心功能降级返回默认值，确保核心链路可用
4. **超时控制避免无限等待** -- 设置合理的超时时间，配合重试机制
5. **负载均衡分发流量** -- 随机、轮询、加权、最少连接，按场景选择

---

## 一、限流

### 为什么需要限流

```
系统容量：1万QPS
实际流量：5万QPS
-> 不限流系统会崩溃
```

### 限流算法

| 算法 | 原理 | 优点 | 缺点 | 场景 |
|------|------|------|------|------|
| 固定窗口 | 统计固定时间窗口请求数 | 简单 | 边界突发 | 基础限流 |
| 滑动窗口 | 窗口切分，滑动统计 | 平滑 | 复杂 | 精确限流 |
| 令牌桶 | 恒定速率放入令牌 | 允许突发 | 参数调优 | 通用 |
| 漏桶 | 恒定速率流出 | 强制平滑 | 无突发 | 削峰 |

### Python 限流实现

#### 令牌桶

```python
import time
import threading


class TokenBucket:
    """令牌桶限流器"""
    def __init__(self, rate: int, capacity: int):
        self.rate = rate             # 每秒生成令牌数
        self.capacity = capacity     # 桶容量
        self.tokens = capacity       # 当前令牌数
        self.last_time = time.time()
        self._lock = threading.Lock()

    def acquire(self) -> bool:
        """获取一个令牌，成功返回True"""
        with self._lock:
            now = time.time()
            # 计算新生成的令牌
            elapsed = now - self.last_time
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.last_time = now

            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False
```

#### FastAPI 限流中间件

```python
from fastapi import FastAPI, Request, HTTPException
from functools import wraps

token_bucket = TokenBucket(rate=1000, capacity=2000)


def rate_limit(func):
    """接口限流装饰器"""
    @wraps(func)
    async def wrapper(*args, **kwargs):
        if not token_bucket.acquire():
            raise HTTPException(status_code=429, detail="当前访问人数过多，请稍后再试")
        return await func(*args, **kwargs)
    return wrapper


@app.post("/order/create")
@rate_limit
async def create_order(user_id: int):
    return order_service.create_order(user_id)
```

---

## 二、熔断

### 为什么需要熔断

```
下游服务响应慢
  -> 上游线程阻塞
  -> 线程池耗尽
  -> 雪崩
```

### 熔断器状态机

```
关闭 -> 打开 -> 半开 -> 关闭
正常   熔断   探测   恢复
```

### Python 熔断器实现

```python
import time
import threading
from collections import deque
from functools import wraps


class CircuitBreaker:
    """熔断器"""
    def __init__(self, failure_threshold: int = 5,
                 timeout: float = 60, half_open_limit: int = 3):
        self.failure_threshold = failure_threshold  # 失败阈值
        self.timeout = timeout                       # 熔断恢复时间
        self.half_open_limit = half_open_limit       # 半开状态放的请求数
        self.failures = deque()
        self.state = "CLOSED"   # CLOSED / OPEN / HALF_OPEN
        self.last_open_time = 0
        self.half_open_count = 0
        self._lock = threading.Lock()

    def call(self, func, *args, **kwargs):
        with self._lock:
            if self.state == "OPEN":
                if time.time() - self.last_open_time > self.timeout:
                    self.state = "HALF_OPEN"
                    self.half_open_count = 0
                else:
                    raise CircuitBreakerOpenError("熔断器已打开")

            if self.state == "HALF_OPEN":
                self.half_open_count += 1
                if self.half_open_count > self.half_open_limit:
                    raise CircuitBreakerOpenError("半开状态请求已达上限")

        try:
            result = func(*args, **kwargs)
            with self._lock:
                if self.state == "HALF_OPEN":
                    self.state = "CLOSED"
                    self.failures.clear()
            return result
        except Exception:
            with self._lock:
                now = time.time()
                self.failures.append(now)
                # 清理过期的失败记录（60秒窗口）
                while self.failures and self.failures[0] < now - 60:
                    self.failures.popleft()
                if len(self.failures) >= self.failure_threshold:
                    self.state = "OPEN"
                    self.last_open_time = now
            raise


def circuit_breaker(fallback_func=None):
    """熔断装饰器"""
    def decorator(func):
        breaker = CircuitBreaker(failure_threshold=5, timeout=60)

        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return breaker.call(func, *args, **kwargs)
            except CircuitBreakerOpenError:
                if fallback_func:
                    return fallback_func(*args, **kwargs)
                raise
        return wrapper
    return decorator


# 使用示例
def get_user_fallback(user_id: int) -> dict:
    return {"id": user_id, "name": "默认用户"}


@circuit_breaker(fallback_func=get_user_fallback)
def get_user(user_id: int) -> dict:
    return remote_client.get_user(user_id)
```

---

## 三、降级

### 降级策略

| 策略 | 说明 | 示例 |
|------|------|------|
| 返回默认值 | 返回空或默认 | 推荐列表为空 |
| 返回缓存 | 返回过期缓存 | 商品详情缓存 |
| 关闭功能 | 直接关闭 | 评论、点赞 |

### 降级开关

```python
from fastapi import FastAPI
from functools import wraps

app = FastAPI()

# 功能开关（可用 Redis/配置中心动态控制）
feature_toggles = {
    "comment": True,
    "recommend": True,
    "like": True,
}


def feature_toggle(name: str):
    """功能开关装饰器"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if not feature_toggles.get(name, True):
                return {"code": 200, "data": [], "message": f"{name} 已降级"}
            return await func(*args, **kwargs)
        return wrapper
    return decorator


@app.get("/product/detail")
async def get_product_detail(product_id: int):
    product = product_service.get_product(product_id)

    # 评论功能未开启时返回空
    if not feature_toggles.get("comment"):
        product["comments"] = []

    return product
```

---

## 四、面试高频题

### 1. 限流、熔断、降级的区别？
限流：超出容量直接拒绝 -> 熔断：下游异常快速失败 -> 降级：牺牲非核心功能 -> 三者结合形成防护体系

### 2. 令牌桶和漏桶的区别？
令牌桶：允许突发 -> 漏桶：强制平滑 -> 令牌桶适合大多数场景 -> 漏桶适合削峰填谷

---

## 练习题

- [ ] 练习1：实现令牌桶限流器并接入 FastAPI 中间件
- [ ] 练习2：实现熔断器和降级开关
- [ ] 练习3：设计一个秒杀系统的限流方案

---

## 下讲预告

第6讲将学习服务治理：注册发现、配置中心、分布式锁、链路追踪等内容。
