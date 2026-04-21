# 第 4 讲：服务治理（Python 版）-- 限流、熔断、降级实战

微服务拆分后，服务之间相互依赖。一个服务出问题，可能引发**雪崩效应**，导致整个系统崩溃。

---

## 一、为什么需要服务治理？

### 1. 雪崩效应是什么？

**场景：**

```
用户请求 -> 订单服务 -> 库存服务 <- 数据库慢查询（响应时间从 10ms -> 10s）
```

**雪崩过程：**

```
第 1 步：库存服务数据库慢查询
第 2 步：库存服务响应变慢（10ms -> 10s）
第 3 步：订单服务调用库存服务，线程全部阻塞等待
第 4 步：订单服务线程池耗尽，无法处理新请求
第 5 步：用户请求全部超时
第 6 步：整个系统不可用
```

**一个局部故障，蔓延成全局崩溃。** 这就是**雪崩效应（Cascading Failure）**。

### 2. 雪崩的三种触发场景

#### 场景 1：流量突增
```
正常流量 100 QPS -> 突然 10000 QPS -> 下游扛不住 -> 雪崩
```

#### 场景 2：下游服务故障
```
银行接口超时 -> 支付服务阻塞 -> 订单服务阻塞 -> 雪崩
```

#### 场景 3：资源耗尽
```
慢查询占满数据库连接池 -> 其他查询等待 -> 雪崩
```

### 3. 服务治理的三把锁

| 手段 | 解决什么问题 |
|------|------------|
| **限流** | 控制流量入口，防止系统被压垮 |
| **熔断** | 快速失败，防止故障扩散 |
| **降级** | 保护核心链路，牺牲非核心功能 |

**三者关系：**
```
流量进来 -> 限流（控制进入量）
              |
         服务调用 -> 熔断（发现故障快速失败）
                       |
                  故障时 -> 降级（返回兜底结果）
```

---

## 二、限流

### 1. 为什么需要限流？

**核心目的：** 保护服务不被超出处理能力的流量压垮，保证系统在高流量下的稳定性。

### 2. 限流的主要算法

#### 算法 1：固定窗口计数器

**原理：** 每 1 秒允许最多 N 个请求，超过拒绝。

**问题：** 窗口切换的瞬间会有突刺 -- [0.9s-1.0s] 来 100 个 + [1.0s-1.1s] 来 100 个 = 0.2 秒通过 200 个。

#### 算法 2：滑动窗口计数器

**原理：** 窗口大小 1 秒，每 100ms 一个小格子，当前窗口 = 最近 10 个小格子的总请求数。解决了固定窗口的突刺问题。

#### 算法 3：令牌桶（Token Bucket）-- 推荐

**原理：**
```
桶里最多放 capacity 个令牌，每秒产生 rate 个令牌。
请求来了取一个令牌处理，没有令牌则拒绝或等待。
```

**特点：** 允许突发流量（桶里有令牌时），平均速率受控，适合大多数业务场景。

#### 算法 4：漏桶（Leaky Bucket）

**原理：** 请求进来存入桶，以固定速率流出处理。

**特点：** 输出速率绝对均匀，不允许突发，适合严格限速场景（如短信发送）。

### 3. Python 限流实战

#### 方式 1：手动实现令牌桶

```python
import time
import threading

class TokenBucket:
    """令牌桶限流器"""

    def __init__(self, capacity, rate):
        self.capacity = capacity
        self.rate = rate
        self.tokens = capacity
        self.last_refill = time.time()
        self.lock = threading.Lock()

    def _refill(self):
        now = time.time()
        elapsed = now - self.last_refill
        new_tokens = elapsed * self.rate
        self.tokens = min(self.capacity, self.tokens + new_tokens)
        self.last_refill = now

    def acquire(self, tokens=1):
        with self.lock:
            self._refill()
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False

    def wait_and_acquire(self, tokens=1, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.acquire(tokens):
                return True
            time.sleep(0.01)
        return False


# 使用
limiter = TokenBucket(capacity=10, rate=5)

def handle_request(request_id):
    if limiter.acquire():
        print(f"Request {request_id}: OK")
    else:
        print(f"Request {request_id}: Rate Limited!")

for i in range(20):
    handle_request(i)
```

#### 方式 2：装饰器形式的限流器

```python
import time
import functools
from collections import deque

class RateLimiter:
    """滑动窗口限流器（装饰器版）"""

    def __init__(self, max_calls, period=1.0):
        self.max_calls = max_calls
        self.period = period
        self.calls = deque()
        self.lock = threading.Lock()

    def __call__(self, func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with self.lock:
                now = time.time()
                while self.calls and self.calls[0] < now - self.period:
                    self.calls.popleft()

                if len(self.calls) >= self.max_calls:
                    raise Exception(
                        f"Rate limit exceeded: {self.max_calls} calls per {self.period}s"
                    )
                self.calls.append(now)

            return func(*args, **kwargs)
        return wrapper


@RateLimiter(max_calls=5, period=1.0)
def get_user(user_id):
    return {"id": user_id, "name": "Alice"}
```

#### 方式 3：Redis 分布式限流

**为什么需要？** 多实例部署时，本地限流器各自独立，整体通过量是单实例的 N 倍。

```python
import redis
import time

class RedisRateLimiter:
    """基于 Redis 的分布式限流器"""

    def __init__(self, redis_url='redis://localhost:6379'):
        self.redis = redis.from_url(redis_url)

    def is_allowed(self, key, max_calls, period):
        script = """
        local key = KEYS[1]
        local max_calls = tonumber(ARGV[1])
        local period = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])

        redis.call('ZREMRANGEBYSCORE', key, 0, now - period * 1000)
        local count = redis.call('ZCARD', key)

        if count < max_calls then
            redis.call('ZADD', key, now, now)
            redis.call('EXPIRE', key, period)
            return 1
        else
            return 0
        end
        """

        now = int(time.time() * 1000)
        result = self.redis.eval(script, 1, key, max_calls, period, now)
        return result == 1
```

### 4. 限流的维度

```python
class MultiDimensionLimiter:
    def check(self, user_id, ip, endpoint):
        self.limiter.acquire("global", max_calls=10000, period=1)          # 全局限流
        self.limiter.acquire(f"api:{endpoint}", max_calls=1000, period=1)  # 接口限流
        self.limiter.acquire(f"user:{user_id}", max_calls=100, period=1)   # 用户限流
        self.limiter.acquire(f"ip:{ip}", max_calls=500, period=1)          # IP限流
```

---

## 三、熔断

### 1. 为什么需要熔断？

**没有熔断：** 库存服务明明已经挂了，还在不停调用，每次等 10s 超时 -> 线程被阻塞 -> 资源耗尽。

**有熔断：** 失败率超过阈值 -> 直接拒绝不再调用 -> 立即返回错误（不等待 10s）-> 隔一段时间放少量请求试探 -> 如果恢复则关闭熔断器。

### 2. 熔断器的三种状态

| 状态 | 说明 |
|------|------|
| **CLOSED（关闭）** | 正常状态，请求全部通过，统计失败率 |
| **OPEN（打开）** | 熔断状态，请求全部拒绝，快速失败 |
| **HALF-OPEN（半开）** | 试探状态，放少量请求，判断服务是否恢复 |

**状态转换：**
```
CLOSED -- 失败率超过阈值 --> OPEN
OPEN -- 等待恢复时间 --> HALF-OPEN
HALF-OPEN -- 试探成功 --> CLOSED
HALF-OPEN -- 试探失败 --> OPEN
```

### 3. Python 熔断实战

#### 方式 1：手动实现熔断器

```python
import time
import threading
from enum import Enum

class CircuitBreakerState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=30, half_open_max_calls=3):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls

        self.state = CircuitBreakerState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None
        self.half_open_calls = 0
        self.lock = threading.Lock()

    def call(self, func, *args, **kwargs):
        with self.lock:
            state = self._get_state()

        if state == CircuitBreakerState.OPEN:
            raise CircuitBreakerOpenException("Circuit breaker is OPEN")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _get_state(self):
        if self.state == CircuitBreakerState.OPEN:
            if time.time() - self.last_failure_time >= self.recovery_timeout:
                self.state = CircuitBreakerState.HALF_OPEN
                self.half_open_calls = 0
        return self.state

    def _on_success(self):
        with self.lock:
            if self.state == CircuitBreakerState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.half_open_max_calls:
                    self._reset()
            elif self.state == CircuitBreakerState.CLOSED:
                self.failure_count = 0

    def _on_failure(self):
        with self.lock:
            self.failure_count += 1
            self.last_failure_time = time.time()

            if self.state == CircuitBreakerState.HALF_OPEN:
                self.state = CircuitBreakerState.OPEN
            elif self.state == CircuitBreakerState.CLOSED:
                if self.failure_count >= self.failure_threshold:
                    self.state = CircuitBreakerState.OPEN

    def _reset(self):
        self.state = CircuitBreakerState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None


class CircuitBreakerOpenException(Exception):
    pass
```

#### 方式 2：使用 pybreaker 库

```bash
pip install pybreaker
```

```python
import pybreaker
import requests

cb = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)

@cb
def call_user_service(user_id):
    response = requests.get(
        f"http://user-service:8001/users/{user_id}",
        timeout=3
    )
    response.raise_for_status()
    return response.json()

def get_user(user_id):
    try:
        return call_user_service(user_id)
    except pybreaker.CircuitBreakerError:
        print("Circuit breaker is open!")
        return None
    except Exception as e:
        print(f"Service error: {e}")
        return None
```

---

## 四、降级

### 1. 什么是服务降级？

当服务不可用时，不是直接报错，而是**返回一个"降级结果"**，保证系统核心链路可用。

### 2. 降级策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **返回默认值** | 直接返回预设的默认数据 | 非核心功能 |
| **返回缓存** | 返回上次成功的缓存数据 | 数据时效性要求不高 |
| **返回空结果** | 返回空列表、空对象 | 前端能处理空数据 |
| **降级到备用服务** | 切换到简化版服务 | 有备用方案 |
| **静态降级页** | 返回静态页面 | 整个服务不可用时 |

### 3. Python 降级实战

#### 基础降级

```python
import functools

def fallback(default_value=None):
    """降级装饰器"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                print(f"Service call failed: {e}, using fallback")
                if callable(default_value):
                    return default_value(*args, **kwargs)
                return default_value
        return wrapper
    return decorator


@fallback(default_value={"recommendations": []})
def get_recommendations(user_id):
    response = requests.get(
        f"http://recommendation-service/recommendations/{user_id}",
        timeout=3
    )
    return response.json()


@fallback(default_value={"score": 5.0, "count": 0})
def get_product_reviews(product_id):
    response = requests.get(
        f"http://review-service/products/{product_id}/reviews",
        timeout=3
    )
    return response.json()
```

#### 缓存降级

```python
import redis
import json

class CacheFallback:
    def __init__(self, redis_url='redis://localhost:6379'):
        self.redis = redis.from_url(redis_url)

    def call_with_cache_fallback(
        self, cache_key, func, *args,
        cache_ttl=300, stale_ttl=3600, **kwargs
    ):
        try:
            result = func(*args, **kwargs)
            self.redis.setex(cache_key, stale_ttl, json.dumps(result))
            return result, False  # (结果, 是否降级)
        except Exception as e:
            print(f"Service failed: {e}, trying cache fallback")
            cached = self.redis.get(cache_key)
            if cached:
                return json.loads(cached), True
            raise
```

#### 熔断 + 降级组合

```python
import pybreaker

class ServiceCaller:
    """完整的服务调用：熔断 + 降级"""

    def __init__(self, service_name):
        self.service_name = service_name
        self.circuit_breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)

    def call(self, func, fallback_func=None, *args, **kwargs):
        try:
            return self.circuit_breaker.call(func, *args, **kwargs)
        except pybreaker.CircuitBreakerError:
            print(f"{self.service_name}: Circuit breaker open, using fallback")
            if fallback_func:
                return fallback_func(*args, **kwargs)
            raise
        except Exception as e:
            print(f"{self.service_name}: Error {e}, using fallback")
            if fallback_func:
                return fallback_func(*args, **kwargs)
            raise


# 使用
inventory_caller = ServiceCaller("inventory-service")

def get_inventory(product_id):
    response = requests.get(f"http://inventory-service/inventory/{product_id}", timeout=3)
    return response.json()

def get_inventory_fallback(product_id):
    return {"product_id": product_id, "available": True, "quantity": -1, "is_fallback": True}

result = inventory_caller.call(get_inventory, get_inventory_fallback, "product-123")
```

---

## 五、超时控制

### 1. 为什么超时控制很重要？

没有超时：服务 B 因慢查询 30 秒才返回 -> 服务 A 线程等待 30 秒 -> 线程池被占满 -> 服务 A 不可用。

### 2. 超时的合理设置

**原则：** 超时时间 = 正常响应时间 x 3

**超时链路：** A（超时 3s）-> B（超时 2s）-> C（超时 1s）。下游超时必须小于上游超时。

### 3. Python 超时实战

#### HTTP 请求超时

```python
import requests

response = requests.get(url, timeout=(3, 10))  # (连接超时3s, 读取超时10s)
response = requests.get(url, timeout=5)         # 统一超时5s
```

#### 线程池超时（跨平台）

```python
from concurrent.futures import ThreadPoolExecutor, TimeoutError

executor = ThreadPoolExecutor(max_workers=10)

def call_with_timeout(func, timeout, *args, **kwargs):
    future = executor.submit(func, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        future.cancel()
        raise TimeoutException(f"Call timed out after {timeout}s")
```

---

## 六、重试机制

### 1. 重试的前提：幂等性

| 操作 | 是否幂等 | 说明 |
|------|---------|------|
| GET 查询 | 是 | 多次查询结果一样 |
| DELETE 删除 | 是 | 删了再删还是删了 |
| PUT 全量更新 | 是 | 多次设置同一个值 |
| POST 创建 | 否 | 多次创建会重复 |
| 扣减库存 | 否 | 多次扣减会超扣 |

**非幂等操作不能直接重试！必须先实现幂等。**

### 2. 指数退避重试

```
第 1 次失败：等待 1s
第 2 次失败：等待 2s
第 3 次失败：等待 4s
第 4 次失败：等待 8s
```

### 3. Python 重试实战

```python
import time
import random
import functools

def retry(
    max_attempts=3,
    delay=1.0,
    backoff=2.0,
    jitter=True,
    exceptions=(Exception,)
):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            current_delay = delay
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    if attempt == max_attempts - 1:
                        raise
                    wait_time = current_delay
                    if jitter:
                        wait_time += random.uniform(0, current_delay * 0.1)
                    print(f"Attempt {attempt + 1}/{max_attempts} failed: {e}. "
                          f"Retrying in {wait_time:.2f}s...")
                    time.sleep(wait_time)
                    current_delay *= backoff
        return wrapper
    return decorator


@retry(
    max_attempts=3,
    delay=1.0,
    backoff=2.0,
    exceptions=(requests.exceptions.Timeout, requests.exceptions.ConnectionError)
)
def call_payment_service(order_id, amount):
    response = requests.post(
        "http://payment-service/pay",
        json={"order_id": order_id, "amount": amount},
        timeout=3
    )
    response.raise_for_status()
    return response.json()
```

### 4. 幂等性实现

```python
import uuid
import redis
import json

class IdempotentService:
    def __init__(self):
        self.redis = redis.from_url('redis://localhost:6379')

    def create_order(self, request_id, order_data):
        cache_key = f"idempotent:create_order:{request_id}"

        cached_result = self.redis.get(cache_key)
        if cached_result:
            return json.loads(cached_result)

        order = self._do_create_order(order_data)

        self.redis.setex(cache_key, 86400, json.dumps(order))
        return order

    def _do_create_order(self, order_data):
        return {"order_id": str(uuid.uuid4()), "status": "created", **order_data}


# 客户端用同一个 request_id 重试，不会重复创建
service = IdempotentService()
request_id = str(uuid.uuid4())
result1 = service.create_order(request_id, {"product_id": "123", "amount": 100})
result2 = service.create_order(request_id, {"product_id": "123", "amount": 100})
assert result1['order_id'] == result2['order_id']
```

---

## 七、完整的服务治理组合

```python
import requests
import pybreaker
import redis
import time
import json
import random

class ResilientServiceClient:
    """
    弹性服务客户端
    整合：限流 + 熔断 + 超时 + 重试 + 降级 + 缓存
    """

    def __init__(self, service_name, base_url):
        self.service_name = service_name
        self.base_url = base_url
        self.circuit_breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)
        self.redis = redis.from_url('redis://localhost:6379')
        self.rate_limiter = TokenBucket(capacity=100, rate=50)

    def get(self, path, cache_key=None, cache_ttl=60,
            timeout=3, max_retries=2, fallback=None):

        # 1. 限流检查
        if not self.rate_limiter.acquire():
            if fallback:
                return fallback()
            raise Exception("Rate limited")

        # 2. 先查缓存
        if cache_key:
            cached = self.redis.get(cache_key)
            if cached:
                return json.loads(cached)

        # 3. 带重试和熔断的调用
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                response = self.circuit_breaker.call(
                    requests.get,
                    f"{self.base_url}{path}",
                    timeout=timeout
                )
                response.raise_for_status()
                result = response.json()

                if cache_key:
                    self.redis.setex(cache_key, cache_ttl, json.dumps(result))
                return result

            except pybreaker.CircuitBreakerError:
                break
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    wait = (2 ** attempt) + random.uniform(0, 1)
                    time.sleep(wait)

        # 4. 所有重试都失败：降级
        if cache_key:
            stale = self.redis.get(f"stale:{cache_key}")
            if stale:
                return json.loads(stale)

        if fallback:
            return fallback()
        raise last_error


# 使用
user_client = ResilientServiceClient("user-service", "http://user-service:8001")

user = user_client.get(
    path="/users/123",
    cache_key="user:123",
    cache_ttl=300,
    timeout=3,
    max_retries=2,
    fallback=lambda: {"id": "unknown", "name": "Guest"}
)
```

---

## 八、面试高频题

### 1. 什么是雪崩效应？怎么防止？

雪崩效应是微服务中一个服务故障导致调用链上的其他服务相继故障，最终整个系统不可用。防止手段：限流、熔断、降级、超时控制、资源隔离。

### 2. 令牌桶和漏桶的区别？

| 维度 | 令牌桶 | 漏桶 |
|------|-------|------|
| 突发流量 | 允许 | 不允许 |
| 输出速率 | 平均受控 | 绝对均匀 |
| 适用场景 | API 限流 | 严格限速（如短信） |

### 3. 熔断器的三种状态？

- **CLOSED**：正常状态，统计失败率
- **OPEN**：熔断状态，请求全部拒绝
- **HALF-OPEN**：试探状态，放少量请求
- CLOSED -> OPEN：失败率超阈值
- OPEN -> HALF-OPEN：等待恢复时间
- HALF-OPEN -> CLOSED：试探成功
- HALF-OPEN -> OPEN：试探失败

### 4. 为什么重试要加指数退避和随机抖动？

- **指数退避**：避免高频重试把下游服务打垮
- **随机抖动**：多实例同时重试时防止同时打到同一时间点（雷群效应）

### 5. 什么是幂等性？怎么实现？

幂等性：同一个请求执行多次，结果和执行一次一样。

实现方式：
1. **唯一请求 ID**：客户端生成 UUID，服务端用 Redis 去重
2. **数据库唯一索引**：order_no 唯一索引
3. **状态机**：判断当前状态，防止重复操作

---

## 九、核心结论

1. **雪崩效应**：局部故障扩散成全局崩溃，用限流+熔断+降级防止
2. **令牌桶**：允许突发，平均速率受控，推荐用于 API 限流
3. **分布式限流**：多实例场景用 Redis，单机限流不够
4. **熔断三态**：CLOSED -> OPEN -> HALF-OPEN -> CLOSED
5. **降级优先级**：本地缓存 > Redis 缓存 > 默认值 > 报错
6. **超时链路**：下游超时必须小于上游超时
7. **重试前提**：必须保证幂等性才能加重试
8. **指数退避+抖动**：防止重试风暴和雷群效应
9. **幂等性**：唯一请求 ID + Redis 去重是最常用方案
10. **组合使用**：限流+熔断+超时+重试+降级要组合使用

---

## 十、练习题

### 练习 1：实现基于 Redis 的分布式令牌桶
要求：多实例共享同一个令牌桶，用 Redis + Lua 脚本保证原子性，支持按用户 ID 隔离限流。

### 练习 2：完善熔断器
在手动实现的熔断器基础上，增加按失败率触发熔断（50% 失败率），记录最近 10 次请求的成功/失败。

### 练习 3：综合实战
模拟下单接口，调用用户服务、商品服务、库存服务。要求：每个调用有超时控制，用户/商品服务挂了降级（返回缓存），库存服务挂了熔断（快速失败），整个接口限流每秒 100 次。
