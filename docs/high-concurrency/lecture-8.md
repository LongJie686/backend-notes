# 第 8 讲：分布式服务治理——注册发现、分布式锁、链路追踪

这一讲是高并发系统**基础设施层**的核心。

前面几讲我们解决的是业务层的问题：
- 缓存解决读性能
- 消息队列解决写削峰
- 分库分表解决数据层扩展
- 秒杀/信息流解决具体业务场景

但这些服务之间是如何**找到对方**的？
多个服务同时操作同一个资源，**如何保证不冲突**？
出了问题，**如何快速定位**到哪个服务哪行代码？

这一讲解决的就是这些问题。

---

## 一、服务注册与发现

### 为什么需要服务注册发现？

**没有服务发现的时代：**

```
订单服务调用库存服务
→ 配置文件里写死库存服务的IP和端口
  INVENTORY_SERVICE_URL = "http://192.168.1.10:8080"

问题：
→ 库存服务扩容到10台，要改10个配置
→ 某台机器挂了，要手动摘除
→ 发布新版本，要手动更新配置
→ 配置管理噩梦
```

**有了服务发现：**

```
订单服务 → 向注册中心询问：库存服务在哪？
注册中心 → 返回：[192.168.1.10:8080, 192.168.1.11:8080, ...]
订单服务 → 负载均衡选一台，发起调用

库存服务挂了 → 注册中心自动剔除
库存服务扩容 → 自动注册到注册中心
订单服务无感知
```

---

### 服务注册发现的核心原理

**三个角色：**

```
[服务提供者] → 启动时注册到注册中心
[注册中心]   → 维护服务列表，检测健康状态
[服务消费者] → 从注册中心拉取服务列表，调用
```

**核心流程：**

```
1. 注册 → 服务启动时注册（服务名、IP、端口、权重）
2. 心跳 → 每30秒发心跳，超时未收到则剔除
3. 拉取/订阅 → 消费者拉取实例列表，本地缓存，订阅变更
4. 调用 → 从本地缓存选择实例 → 负载均衡 → 发起调用
5. 注销 → 正常下线时主动注销
```

---

### 主流注册中心对比

| 维度 | Nacos | Consul | etcd | ZooKeeper |
|------|-------|--------|------|-----------|
| **一致性协议** | AP/CP可切换 | CP | CP | CP |
| **健康检查** | 心跳/主动检查 | 多种 | TTL | 临时节点 |
| **配置中心** | 内置 | 支持 | 支持 | 可以 |
| **适用场景** | **国内首选** | 多语言 | K8s | 分布式协调 |

---

### Python 服务注册发现实践

```python
import httpx
import random
from typing import Any


class ServiceRegistry:
    """服务注册发现客户端（对接 Nacos/Consul）"""
    def __init__(self, registry_url: str):
        self.registry_url = registry_url
        self.local_cache: dict[str, list[dict]] = {}

    def register(self, service_name: str, ip: str, port: int, weight: float = 1.0) -> None:
        """注册服务"""
        httpx.post(
            f"{self.registry_url}/v1/ns/instance",
            json={
                "serviceName": service_name,
                "ip": ip,
                "port": port,
                "weight": weight,
                "healthy": True,
            }
        )

    def discover(self, service_name: str) -> list[dict]:
        """发现服务（优先用本地缓存）"""
        if service_name in self.local_cache:
            return self.local_cache[service_name]

        resp = httpx.get(f"{self.registry_url}/v1/ns/instance/list",
                         params={"serviceName": service_name})
        instances = resp.json()["hosts"]
        self.local_cache[service_name] = instances
        return instances

    def get_instance(self, service_name: str) -> dict:
        """随机负载均衡获取一个实例"""
        instances = self.discover(service_name)
        healthy = [i for i in instances if i.get("healthy")]
        if not healthy:
            raise Exception(f"没有可用的 {service_name} 实例")
        return random.choice(healthy)
```

**使用示例：**

```python
registry = ServiceRegistry("http://nacos:8848")

# 服务提供者：注册
registry.register("inventory-service", "192.168.1.10", 8080)

# 服务消费者：发现 + 调用
instance = registry.get_instance("inventory-service")
url = f"http://{instance['ip']}:{instance['port']}/inventory/{product_id}"
resp = httpx.get(url, timeout=5)
```

---

## 二、分布式锁

### 为什么需要分布式锁？

**单机锁的局限：**

```
threading.Lock → 只在同一进程内有效
多台机器 → 每台有自己的锁 → 不能跨机器互斥
```

---

### 方案一：Redis分布式锁

#### 基础实现

```python
import uuid
import redis

r = redis.Redis()


class RedisDistributedLock:
    LUA_UNLOCK = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    else
        return 0
    end
    """

    def try_lock(self, key: str, value: str, expire_seconds: int) -> bool:
        """SET key value NX EX expire_seconds"""
        return bool(r.set(key, value, nx=True, ex=expire_seconds))

    def unlock(self, key: str, value: str) -> bool:
        """Lua脚本原子释放"""
        return bool(r.eval(self.LUA_UNLOCK, 1, key, value))
```

**使用示例：**

```python
def deduct_stock(product_id: int, quantity: int) -> None:
    lock = RedisDistributedLock()
    lock_key = f"lock:stock:{product_id}"
    lock_value = str(uuid.uuid4())

    try:
        if not lock.try_lock(lock_key, lock_value, 30):
            raise Exception("系统繁忙，请稍后重试")

        stock = stock_dao.get_by_product_id(product_id)
        if stock["count"] < quantity:
            raise Exception("库存不足")
        stock_dao.deduct(product_id, quantity)

    finally:
        lock.unlock(lock_key, lock_value)
```

---

#### Redis分布式锁的三大坑

**坑1：锁过期了，业务还没执行完**

**解决：看门狗机制（续期）**

```python
import threading


class WatchdogLock:
    def __init__(self):
        self.r = redis.Redis()
        self._watchdogs: dict[str, threading.Timer] = {}

    LUA_UNLOCK = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    else
        return 0
    end
    """

    def try_lock(self, key: str, value: str, expire_seconds: int = 30) -> bool:
        locked = self.r.set(key, value, nx=True, ex=expire_seconds)

        if locked:
            # 每 expire/3 秒续期一次
            renew_interval = expire_seconds / 3

            def renew():
                current = self.r.get(key)
                if current and current.decode() == value:
                    self.r.expire(key, expire_seconds)
                    # 重新调度
                    self._watchdogs[key] = threading.Timer(renew_interval, renew)
                    self._watchdogs[key].start()

            self._watchdogs[key] = threading.Timer(renew_interval, renew)
            self._watchdogs[key].start()

        return locked

    def unlock(self, key: str, value: str) -> bool:
        # 停止看门狗
        watchdog = self._watchdogs.pop(key, None)
        if watchdog:
            watchdog.cancel()

        return bool(self.r.eval(self.LUA_UNLOCK, 1, key, value))
```

> **生产环境推荐用 `redis-py` + 手动看门狗，或使用 `redlock-py` 库。**

---

**坑2：释放了别人的锁**

```
线程A加锁，value=A的UUID
线程A业务慢，锁过期
线程B加锁成功，value=B的UUID
线程A执行完释放锁 → 释放的是B的锁！

解决：Lua脚本验证value再删除（上方已实现）
```

---

**坑3：Redis主从切换导致锁丢失**

```
Master加锁成功 → Master宕机 → Slave升级为Master
→ 新Master没这个锁 → 线程B加锁成功 → 两个线程同时持有锁
```

**解决方案：RedLock**

```
向N个独立Redis Master同时加锁
需要超过 N/2+1 个成功才算成功
```

```python
# Python RedLock 实现思路
from redlock import Redlock

dlm = Redlock([
    {"host": "redis1", "port": 6379},
    {"host": "redis2", "port": 6379},
    {"host": "redis3", "port": 6379},
])

lock = dlm.lock("lock:stock", 30000)  # 30秒TTL
if lock:
    try:
        do_deduct_stock(product_id, quantity)
    finally:
        dlm.unlock(lock)
```

---

### 方案二：ZooKeeper分布式锁

**基于临时有序节点实现：**

```
1. 所有线程在 /lock 下创建临时有序节点
   线程A → /lock/node-0001, 线程B → /lock/node-0002

2. 序号最小的获得锁（线程A）

3. 其他线程监听前一个节点的删除事件

4. 线程A释放锁 → 触发线程B的监听 → 线程B获得锁

5. 客户端宕机 → 临时节点自动删除 → 不会死锁
```

```python
from kazoo.client import KazooClient
from kazoo.recipe.lock import Lock

zk = KazooClient(hosts="zk-cluster:2181")
zk.start()

# ZooKeeper分布式锁（kazoo已封装）
lock = zk.Lock("/lock/stock", identifier=str(uuid.uuid4()))

with lock:  # 自动加锁/释放
    do_deduct_stock(product_id, quantity)
```

**ZooKeeper锁的优势：**
- ZAB协议保证强一致性
- 客户端宕机，临时节点自动删除，不会死锁
- 不会出现主从切换导致锁丢失

---

### 方案三：数据库分布式锁

```sql
CREATE TABLE distributed_lock (
    lock_key VARCHAR(128) NOT NULL,
    lock_value VARCHAR(64) NOT NULL,
    expire_time DATETIME NOT NULL,
    PRIMARY KEY (lock_key)
);
```

```python
from datetime import datetime, timedelta


class DbDistributedLock:
    def try_lock(self, key: str, value: str, expire_seconds: int) -> bool:
        expire_time = datetime.now() + timedelta(seconds=expire_seconds)
        try:
            lock_dao.insert(key, value, expire_time)
            return True
        except IntegrityError:
            # 检查是否过期
            lock = lock_dao.get_by_key(key)
            if lock and lock["expire_time"] < datetime.now():
                return lock_dao.update_if_expired(key, value, expire_time) > 0
            return False

    def unlock(self, key: str, value: str) -> bool:
        return lock_dao.delete_by_key_and_value(key, value) > 0
```

---

### 三种锁的对比

| 维度 | Redis锁 | ZooKeeper锁 | 数据库锁 |
|------|---------|------------|---------|
| **性能** | 最高 | 中 | 最低 |
| **可靠性** | 中 | 最高 | 高 |
| **实现复杂度** | 低 | 中 | 低 |
| **适用场景** | **高并发** | **强一致性** | 并发低 |

**选型建议：** 99% 场景用 Redis 锁，金融核心场景用 ZooKeeper。

---

## 三、分布式链路追踪

### 为什么需要链路追踪？

```
用户反馈：下单失败
→ 是API网关的问题？订单服务？库存服务？数据库？

没有链路追踪：
→ 一个个服务查日志，日志散落不同机器，无法关联

有了链路追踪：
→ 一个请求有唯一TraceID → 所有服务日志带这个TraceID
→ 输入TraceID，看完整调用链路 → 秒级定位问题
```

---

### TraceID跨服务传递（Python实现）

```python
import contextvars
import uuid
import time
import httpx
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

# ---- Thread-safe TraceID 存储（支持异步） ----
trace_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="")
span_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("span_id", default="")


def generate_trace_id() -> str:
    return uuid.uuid4().hex

def generate_span_id() -> str:
    return hex(int(time.time() * 1e9))[2:]


# ---- FastAPI 中间件：自动提取/生成 TraceID ----
class TraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-Id") or generate_trace_id()
        span_id = request.headers.get("X-Span-Id") or generate_span_id()

        trace_id_ctx.set(trace_id)
        span_id_ctx.set(span_id)

        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        return response


# ---- httpx 客户端：自动透传 TraceID ----
class TraceTransport(httpx.HTTPTransport):
    def handle_request(self, request):
        trace_id = trace_id_ctx.get()
        span_id = span_id_ctx.get()
        if trace_id:
            request.headers["X-Trace-Id"] = trace_id
            request.headers["X-Parent-Span-Id"] = span_id
            request.headers["X-Span-Id"] = generate_span_id()
        return super().handle_request(request)


traced_client = httpx.Client(transport=TraceTransport())


# ---- 日志自动带上 TraceID ----
import logging

class TraceFilter(logging.Filter):
    def filter(self, record):
        record.trace_id = trace_id_ctx.get() or "-"
        return True


logging.basicConfig(
    format="[%(asctime)s] [%(trace_id)s] [%(threadName)s] %(levelname)s %(name)s - %(message)s"
)
logger = logging.getLogger(__name__)
logger.addFilter(TraceFilter())
```

**日志效果：**

```
[2024-01-01 10:00:00] [abc123] [MainThread] INFO OrderService - 开始创建订单
[2024-01-01 10:00:00] [abc123] [MainThread] INFO InventoryService - 查询库存
[2024-01-01 10:00:00] [abc123] [MainThread] INFO OrderService - 订单创建成功
```

---

### 消息队列中的TraceID传递

```python
from kafka import KafkaProducer, KafkaConsumer

# Kafka生产者：把TraceID放在Header
def send_message(topic: str, value: dict) -> None:
    trace_id = trace_id_ctx.get()
    headers = [("X-Trace-Id", trace_id.encode())] if trace_id else []
    producer.send(topic, value=json.dumps(value).encode(), headers=headers)


# Kafka消费者：从Header提取TraceID
def consume_messages():
    consumer = KafkaConsumer(
        'order-topic',
        bootstrap_servers=['localhost:9092'],
        value_deserializer=lambda v: json.loads(v)
    )
    for msg in consumer:
        for header in msg.headers:
            if header[0] == "X-Trace-Id":
                trace_id_ctx.set(header[1].decode())
                break

        try:
            process_message(msg.value)
        finally:
            trace_id_ctx.set("")
```

---

### 主流链路追踪框架

| 框架 | 特点 | 适用 |
|------|------|------|
| **SkyWalking** | Java Agent无侵入，国内最流行 | Java微服务 |
| **Jaeger** | CNCF项目，多语言支持 | Go/Python |
| **Zipkin** | Spring Sleuth集成 | Spring Cloud |
| **OpenTelemetry** | 新标准，厂商中立 | 新项目首选 |

```yaml
# OpenTelemetry Python 示例配置
# pip install opentelemetry-api opentelemetry-sdk opentelemetry-instrumentation-fastapi

# 环境变量
# OTEL_SERVICE_NAME=order-service
# OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4317
```

### 采样率的重要性

```
全量采集 → 1万QPS → 每秒上报1万条链路数据 → 存储压力极大

采样策略：
  1. 固定比例：10%
  2. 错误请求全采集
  3. 慢请求全采集（>1s）
```

---

## 四、配置中心

### 为什么需要配置中心？

```
没有配置中心：修改配置要重新部署、重启、逐台改、难回滚

有了配置中心：修改实时生效、所有机器同步更新、版本管理可回滚、灰度发布
```

### Python 配置中心实践

```python
import os
import json
from functools import lru_cache
import httpx


class ConfigCenter:
    """对接 Nacos 配置中心"""
    def __init__(self, server_addr: str, namespace: str = "", group: str = "DEFAULT_GROUP"):
        self.server_addr = server_addr
        self.namespace = namespace
        self.group = group
        self._local: dict[str, str] = {}

    def get_config(self, data_id: str, default: str = "") -> str:
        """获取配置（优先本地缓存）"""
        if data_id in self._local:
            return self._local[data_id]

        try:
            resp = httpx.get(
                f"{self.server_addr}/v1/cs/configs",
                params={"dataId": data_id, "group": self.group}
            )
            self._local[data_id] = resp.text
            return resp.text
        except Exception:
            return default

    def watch_config(self, data_id: str, callback) -> None:
        """监听配置变更（通过长轮询）"""
        import threading

        def _poll():
            import time
            while True:
                time.sleep(10)
                new_val = self.get_config(data_id)
                if new_val != self._local.get(data_id):
                    self._local[data_id] = new_val
                    callback(new_val)

        threading.Thread(target=_poll, daemon=True).start()


# 使用
config = ConfigCenter("http://nacos:8848")

seckill_limit = int(config.get_config("seckill-limit", "1000"))
recommend_enabled = config.get_config("feature.recommend.enabled", "true") == "true"

config.watch_config("seckill-limit", lambda v: update_seckill_config(int(v)))
```

---

## 五、API网关

### 网关的核心功能

```
[客户端]
  ↓
[API网关]
  → 路由、鉴权、限流、熔断、负载均衡、灰度发布
  ↓
[微服务集群]
```

### Python API网关实现（FastAPI中间件）

**全局鉴权过滤器：**

```python
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

WHITE_LIST = ["/api/user/login", "/api/user/register", "/api/product/list"]


class AuthGlobalMiddleware(BaseHTTPMiddleware):
    """API网关全局鉴权"""
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 白名单放行
        if any(path.startswith(w) for w in WHITE_LIST):
            return await call_next(request)

        token = request.headers.get("Authorization")
        if not token:
            return JSONResponse({"message": "请先登录"}, status_code=401)

        user_id = redis.get(f"token:{token}")
        if not user_id:
            return JSONResponse({"message": "Token已过期"}, status_code=401)

        # 透传用户ID
        request.state.user_id = user_id.decode()
        return await call_next(request)
```

**灰度发布：**

```python
class GrayscaleMiddleware(BaseHTTPMiddleware):
    """灰度发布：10%用户走新版本"""
    async def dispatch(self, request: Request, call_next):
        user_id = request.headers.get("X-User-Id")

        if user_id and int(user_id) % 10 == 0:
            # 注入版本标记
            request.state.version = "v2"

        return await call_next(request)
```

---

## 六、完整的服务治理全景图

```
[用户请求]
    ↓
[API网关集群]
  - 全局鉴权、限流、路由、熔断、TraceID生成
    ↓
[微服务集群]
  订单服务、库存服务、用户服务
    ↓
[注册中心 Nacos/Consul]
  - 服务注册、服务发现、配置管理
    ↓
[监控体系]
  - Prometheus（指标）+ Grafana（展示）
  - Jaeger/OpenTelemetry（链路追踪）
  - ELK（日志搜索）
```

---

## 七、面试高频题

### 1. 服务注册发现的原理？

```
三个角色：服务提供者、注册中心、服务消费者

流程：
1. 提供者启动 → 注册（IP、端口、服务名）
2. 提供者定时心跳 → 超时自动剔除
3. 消费者启动 → 拉取服务列表 → 本地缓存
4. 消费者订阅变更 → 注册中心推送更新
5. 注册中心宕机 → 消费者用本地缓存，短时间不受影响
```

### 2. Redis分布式锁有什么坑？

```
坑1：锁过期业务还没完 → Redisson看门狗自动续期
坑2：释放了别人的锁 → Lua脚本验证value再删
坑3：主从切换锁丢失 → RedLock或换ZooKeeper
```

### 3. ZooKeeper和Redis做分布式锁的区别？

```
Redis：基于SETNX + 过期，性能高，主从切换有风险，适合高并发
ZooKeeper：基于临时有序节点，强一致性，客户端宕机自动删除
大多数场景用Redis，金融核心用ZooKeeper
```

### 4. 链路追踪如何跨服务传递TraceID？

```
HTTP：Header中传递 X-Trace-Id → 存入 contextvars → 日志自动带上
MQ：消息Header携带 TraceID → 消费时提取
```

### 5. Nacos和Eureka的区别？

```
Nacos = 注册中心 + 配置中心，AP/CP可切换，国内首选
Eureka 只有注册发现，已停止维护
```

### 6. API网关和Nginx有什么区别？

```
Nginx：七层负载均衡、静态配置、性能极高、适合最外层
API网关：感知注册中心、动态路由、业务级过滤器、适合微服务内部治理
```

### 7. 配置中心解决了什么问题？

```
动态配置（不停机生效）、版本管理（可回滚）、环境隔离、灰度推送
```

---

## 八、核心结论

1. **服务注册发现消费者本地缓存，注册中心宕机不影响正常调用**
2. **Redis分布式锁三个坑：过期/释放他人锁/主从切换，看门狗+Lua解决**
3. **Redis锁高性能，ZooKeeper锁强一致，90%场景用Redis**
4. **TraceID通过HTTP Header跨服务传递，contextvars存储**
5. **生产环境链路追踪要设采样率，错误和慢请求全采集**
6. **Nacos/Consul = 注册中心 + 配置中心**
7. **API网关统一处理鉴权、限流、路由，避免各服务重复实现**
8. **配置中心解决配置动态刷新、版本管理、环境隔离**

---

## 九、练习题

### 练习1：分布式锁设计
用Redis实现分布式定时任务锁，同一时刻只能一台机器执行。考虑任务超时、锁释放、锁续期。

### 练习2：链路追踪
设计 TraceID 传递方案：服务A(HTTP) → 服务B(HTTP) → 服务C(Kafka消息)。

### 练习3：服务治理设计
为电商系统设计完整服务治理方案（3个微服务），画出架构图并选型。

### 练习4：思考题
**为什么Redis分布式锁要用Lua脚本释放，而不是普通的DEL命令？**

---

## 十、下讲预告

**第 9 讲：高可用架构——同城双活与容灾设计**
