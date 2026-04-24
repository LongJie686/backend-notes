# 第 5 讲：API 网关（Python 版）— 统一入口、鉴权、路由实战

这一讲是微服务的**统一大门**。

没有 API 网关的微服务，就像一栋大楼没有门卫，每个房间都直接开门对外。混乱、不安全、难维护。

这一讲的目标是让你：
- **理解为什么微服务必须要有 API 网关**
- **掌握网关的核心职责**
- **能用 Python 实现一个生产级网关**
- **掌握 JWT 鉴权实战**
- **掌握动态路由配置**
- **理解网关层的限流和熔断**
- **理解灰度发布的实现原理**
- **了解主流网关框架的选型**
- **规避大厂常见的网关坑点**

---

## 一、为什么需要 API 网关？

### 1. 没有网关的问题

**场景：**
前端要调用微服务，没有网关时：

```
前端 App
   ├──> http://user-service:8001/users/123
   ├──> http://order-service:8002/orders?user_id=123
   ├──> http://product-service:8003/products/456
   └──> http://payment-service:8004/payments/789
```

**问题：**

#### 问题 1：跨域
```
前端：http://www.example.com
用户服务：http://user-service:8001
跨域！每个服务都要配置 CORS
```

#### 问题 2：鉴权重复
```
用户服务需要验证 JWT
订单服务需要验证 JWT
商品服务需要验证 JWT
支付服务需要验证 JWT
每个服务都要写一遍鉴权逻辑
```

#### 问题 3：前端耦合服务地址
```
前端代码里写了 4 个服务地址
服务扩容、迁移、地址变化
前端代码要跟着改
```

#### 问题 4：没有统一的日志和监控
```
每个服务单独记录日志
无法从统一视角看到：
- 哪个接口调用次数最多？
- 哪个接口响应最慢？
- 哪个用户在异常访问？
```

#### 问题 5：安全暴露
```
所有微服务直接暴露到公网
攻击面大
每个服务都要做安全加固
```

---

### 2. 有了网关之后

```
前端 App
   └──> http://api.example.com (API 网关)
              │
              ├──> user-service（内网）
              ├──> order-service（内网）
              ├──> product-service（内网）
              └──> payment-service（内网）
```

**网关统一处理：**
- 跨域：网关统一配置
- 鉴权：网关统一验证 JWT
- 路由：前端只知道网关地址
- 日志：统一记录所有请求
- 限流：网关层统一限流
- 安全：只有网关暴露到公网

---

### 3. 网关的核心职责

```
                    ┌─────────────────────────────────┐
                    │           API Gateway            │
请求进来 ──────────►│                                  │──────► 后端服务
                    │  1. 路由（Route）                 │
                    │  2. 鉴权（Auth）                  │
                    │  3. 限流（Rate Limit）             │
                    │  4. 协议转换（Protocol）           │
                    │  5. 日志（Logging）                │
                    │  6. 熔断（Circuit Break）          │
                    │  7. 灰度（Canary）                 │
                    │  8. 请求/响应转换（Transform）      │
                    └─────────────────────────────────┘
```

---

## 二、用 Python 实现 API 网关

### 1. 技术选型

**实现一个 Python 网关，使用：**
- **FastAPI**：高性能异步框架，作为网关本身
- **httpx**：异步 HTTP 客户端，转发请求
- **python-jose**：JWT 验证
- **Redis**：限流计数器、Token 黑名单
- **PyYAML**：路由配置文件

---

### 2. 安装依赖

```bash
pip install fastapi uvicorn httpx python-jose[cryptography] redis pyyaml
```

---

### 3. 项目结构

```
api-gateway/
├── main.py              # 网关入口
├── config/
│   └── routes.yaml      # 路由配置
├── middleware/
│   ├── auth.py          # 鉴权中间件
│   ├── rate_limit.py    # 限流中间件
│   ├── logging.py       # 日志中间件
│   └── circuit_breaker.py # 熔断中间件
├── core/
│   ├── router.py        # 路由解析
│   ├── proxy.py         # 请求转发
│   └── load_balancer.py # 负载均衡
└── utils/
    └── jwt_utils.py     # JWT 工具
```

---

### 4. 路由配置文件

#### `config/routes.yaml`

```yaml
# API 网关路由配置

gateway:
  port: 8000
  prefix: /api/v1

routes:
  # 用户服务
  - name: user-service
    prefix: /users
    upstream: http://user-service:8001
    methods: [GET, POST, PUT, DELETE]
    auth_required: true
    rate_limit:
      enabled: true
      max_calls: 100
      period: 1
    timeout: 5
    retry: 2

  # 商品服务（不需要鉴权）
  - name: product-service
    prefix: /products
    upstream: http://product-service:8003
    methods: [GET]
    auth_required: false
    rate_limit:
      enabled: true
      max_calls: 500
      period: 1
    timeout: 3
    retry: 1

  # 订单服务
  - name: order-service
    prefix: /orders
    upstream: http://order-service:8002
    methods: [GET, POST, PUT]
    auth_required: true
    rate_limit:
      enabled: true
      max_calls: 50
      period: 1
    timeout: 10
    retry: 0  # 创建订单不重试

  # 支付服务
  - name: payment-service
    prefix: /payments
    upstream: http://payment-service:8004
    methods: [POST]
    auth_required: true
    rate_limit:
      enabled: true
      max_calls: 20
      period: 1
    timeout: 30
    retry: 0  # 支付不重试

  # 认证服务（公开）
  - name: auth-service
    prefix: /auth
    upstream: http://auth-service:8005
    methods: [POST]
    auth_required: false
    rate_limit:
      enabled: true
      max_calls: 10
      period: 1
    timeout: 5
    retry: 1
```

---

### 5. JWT 工具

#### `utils/jwt_utils.py`

```python
from jose import jwt, JWTError
from datetime import datetime, timedelta
from typing import Optional

# 配置（生产环境用环境变量）
SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """
    生成 JWT Token
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow()  # 签发时间
    })

    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return token


def verify_token(token: str) -> dict:
    """
    验证 JWT Token
    返回 payload（用户信息）
    抛出 JWTError 表示验证失败
    """
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    return payload


def get_user_id_from_token(token: str) -> Optional[str]:
    """
    从 Token 中获取用户 ID
    """
    try:
        payload = verify_token(token)
        return payload.get("sub")  # sub 是标准的用户标识字段
    except JWTError:
        return None


# 测试
if __name__ == "__main__":
    # 生成 Token
    token = create_access_token(
        data={"sub": "user-123", "name": "Alice", "role": "user"}
    )
    print(f"Token: {token}")

    # 验证 Token
    payload = verify_token(token)
    print(f"Payload: {payload}")
```

---

### 6. 鉴权中间件

#### `middleware/auth.py`

```python
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from jose import JWTError
import redis
import json

from utils.jwt_utils import verify_token

redis_client = redis.from_url("redis://localhost:6379")


async def auth_middleware(request: Request, route_config: dict):
    """
    JWT 鉴权中间件

    流程：
    1. 检查路由是否需要鉴权
    2. 从 Header 中提取 Token
    3. 验证 Token 是否有效
    4. 检查 Token 是否被拉黑（登出场景）
    5. 将用户信息注入到请求头
    """

    # 1. 检查是否需要鉴权
    if not route_config.get("auth_required", True):
        return None  # 不需要鉴权，放行

    # 2. 提取 Token
    authorization = request.headers.get("Authorization")
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing"
        )

    # 格式：Bearer <token>
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization format. Expected: Bearer <token>"
        )

    token = parts[1]

    # 3. 验证 Token
    try:
        payload = verify_token(token)
    except JWTError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid token: {str(e)}"
        )

    # 4. 检查 Token 是否被拉黑（登出后 Token 失效）
    blacklist_key = f"token:blacklist:{token}"
    if redis_client.exists(blacklist_key):
        raise HTTPException(
            status_code=401,
            detail="Token has been revoked"
        )

    # 5. 返回用户信息（后续注入到请求头）
    return {
        "user_id": payload.get("sub"),
        "user_name": payload.get("name"),
        "role": payload.get("role", "user")
    }


def blacklist_token(token: str, expire_seconds: int = 1800):
    """
    将 Token 加入黑名单（登出时调用）
    """
    blacklist_key = f"token:blacklist:{token}"
    redis_client.setex(blacklist_key, expire_seconds, "1")
```

---

### 7. 限流中间件

#### `middleware/rate_limit.py`

```python
import redis
import time
import json
from fastapi import HTTPException

redis_client = redis.from_url("redis://localhost:6379")

# Lua 脚本：原子性滑动窗口限流
RATE_LIMIT_SCRIPT = """
local key = KEYS[1]
local max_calls = tonumber(ARGV[1])
local period = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 清除窗口外的记录
redis.call('ZREMRANGEBYSCORE', key, 0, now - period * 1000)

-- 获取当前窗口请求数
local count = redis.call('ZCARD', key)

if count < max_calls then
    -- 添加本次请求记录
    redis.call('ZADD', key, now, now .. math.random())
    redis.call('EXPIRE', key, period + 1)
    return 1
else
    return 0
end
"""


async def rate_limit_middleware(
    request,
    route_config: dict,
    user_info: dict = None
):
    """
    限流中间件
    支持：
    - 接口级别限流
    - 用户级别限流
    - IP 级别限流
    """
    rate_config = route_config.get("rate_limit", {})

    if not rate_config.get("enabled", False):
        return  # 未配置限流，放行

    max_calls = rate_config.get("max_calls", 100)
    period = rate_config.get("period", 1)
    now = int(time.time() * 1000)

    # 1. 接口级别限流
    api_key = f"rate_limit:api:{route_config['name']}"
    allowed = redis_client.eval(
        RATE_LIMIT_SCRIPT, 1, api_key, max_calls, period, now
    )

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Too Many Requests",
                "message": f"API rate limit exceeded: {max_calls} calls per {period}s",
                "retry_after": period
            }
        )

    # 2. 用户级别限流（每个用户独立）
    if user_info:
        user_id = user_info.get("user_id")
        user_key = f"rate_limit:user:{user_id}:{route_config['name']}"
        user_max = max_calls // 10  # 单用户限制为接口总限制的 10%

        allowed = redis_client.eval(
            RATE_LIMIT_SCRIPT, 1, user_key,
            user_max, period, now
        )

        if not allowed:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "Too Many Requests",
                    "message": f"User rate limit exceeded",
                    "retry_after": period
                }
            )

    # 3. IP 级别限流（防 DDOS）
    client_ip = request.client.host
    ip_key = f"rate_limit:ip:{client_ip}"
    ip_max = 1000  # IP 每秒最多 1000 次

    allowed = redis_client.eval(
        RATE_LIMIT_SCRIPT, 1, ip_key, ip_max, period, now
    )

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Too Many Requests",
                "message": "IP rate limit exceeded",
                "retry_after": period
            }
        )
```

---

### 8. 日志中间件

#### `middleware/logging.py`

```python
import time
import uuid
import json
import logging
from fastapi import Request

# 配置日志格式
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("api-gateway")


class RequestLogger:
    """请求日志记录器"""

    @staticmethod
    def log_request(
        request: Request,
        trace_id: str,
        user_info: dict = None
    ):
        """记录请求日志"""
        log_data = {
            "trace_id": trace_id,
            "method": request.method,
            "path": request.url.path,
            "query_params": dict(request.query_params),
            "client_ip": request.client.host,
            "user_agent": request.headers.get("user-agent"),
            "user_id": user_info.get("user_id") if user_info else None,
        }
        logger.info(f"REQUEST: {json.dumps(log_data)}")

    @staticmethod
    def log_response(
        trace_id: str,
        status_code: int,
        duration_ms: float,
        upstream_service: str
    ):
        """记录响应日志"""
        log_data = {
            "trace_id": trace_id,
            "status_code": status_code,
            "duration_ms": round(duration_ms, 2),
            "upstream_service": upstream_service,
        }

        if status_code >= 500:
            logger.error(f"RESPONSE: {json.dumps(log_data)}")
        elif status_code >= 400:
            logger.warning(f"RESPONSE: {json.dumps(log_data)}")
        else:
            logger.info(f"RESPONSE: {json.dumps(log_data)}")

    @staticmethod
    def log_error(
        trace_id: str,
        error: Exception,
        upstream_service: str
    ):
        """记录错误日志"""
        log_data = {
            "trace_id": trace_id,
            "error": str(error),
            "upstream_service": upstream_service,
        }
        logger.error(f"ERROR: {json.dumps(log_data)}")
```

---

### 9. 请求转发核心

#### `core/proxy.py`

```python
import httpx
import asyncio
from fastapi import Request, HTTPException
from fastapi.responses import Response


class ReverseProxy:
    """反向代理：转发请求到后端服务"""

    def __init__(self):
        # 使用异步 HTTP 客户端，复用连接
        self.client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=20
            )
        )

    async def forward(
        self,
        request: Request,
        upstream_url: str,
        timeout: float = 5.0,
        extra_headers: dict = None
    ) -> Response:
        """
        转发请求到上游服务

        request: 原始请求
        upstream_url: 上游服务 URL
        timeout: 超时时间
        extra_headers: 额外注入的请求头
        """

        # 构建转发 URL
        path = request.url.path
        query = request.url.query
        if query:
            forward_url = f"{upstream_url}{path}?{query}"
        else:
            forward_url = f"{upstream_url}{path}"

        # 构建请求头（过滤掉不需要转发的头）
        headers = self._build_headers(request, extra_headers)

        # 读取请求体
        body = await request.body()

        try:
            # 转发请求
            upstream_response = await self.client.request(
                method=request.method,
                url=forward_url,
                headers=headers,
                content=body,
                timeout=timeout
            )

            # 构建响应
            return Response(
                content=upstream_response.content,
                status_code=upstream_response.status_code,
                headers=dict(upstream_response.headers),
                media_type=upstream_response.headers.get("content-type")
            )

        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="Gateway Timeout: Upstream service did not respond in time"
            )
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="Service Unavailable: Cannot connect to upstream service"
            )
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Bad Gateway: {str(e)}"
            )

    def _build_headers(self, request: Request, extra_headers: dict = None) -> dict:
        """
        构建转发请求头
        """
        # 需要过滤的头（不转发到上游）
        skip_headers = {
            "host",
            "content-length",
            "transfer-encoding",
            "connection"
        }

        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() not in skip_headers
        }

        # 注入额外的头
        if extra_headers:
            headers.update(extra_headers)

        return headers

    async def close(self):
        await self.client.aclose()
```

---

### 10. 路由解析

#### `core/router.py`

```python
import yaml
from typing import Optional


class RouteConfig:
    """路由配置"""

    def __init__(self, config_path: str = "config/routes.yaml"):
        with open(config_path) as f:
            config = yaml.safe_load(f)

        self.gateway_config = config.get("gateway", {})
        self.routes = config.get("routes", [])

    def match(self, path: str, method: str) -> Optional[dict]:
        """
        根据路径和方法匹配路由
        返回路由配置，未匹配返回 None
        """
        for route in self.routes:
            prefix = route["prefix"]

            # 路径前缀匹配
            if path.startswith(prefix):
                # 方法匹配
                allowed_methods = route.get("methods", ["GET"])
                if method.upper() in allowed_methods:
                    return route

        return None

    def get_upstream_url(self, route: dict, path: str) -> str:
        """
        获取上游服务 URL
        去掉路由前缀，拼接上游地址
        """
        upstream = route["upstream"]
        prefix = route["prefix"]

        # 去掉网关前缀
        gateway_prefix = self.gateway_config.get("prefix", "")
        if path.startswith(gateway_prefix):
            path = path[len(gateway_prefix):]

        return upstream
```

---

### 11. 负载均衡

#### `core/load_balancer.py`

```python
import random
import time
from typing import List


class LoadBalancer:
    """
    客户端负载均衡器
    支持从注册中心动态获取实例
    """

    def __init__(self, strategy="round_robin"):
        self.strategy = strategy
        self.index = 0
        self.instances_cache = {}
        self.cache_ttl = 30  # 缓存 30 秒

    def get_instance(self, service_name: str) -> str:
        """
        获取一个服务实例
        """
        instances = self._get_instances(service_name)

        if not instances:
            raise Exception(f"No available instances for {service_name}")

        if self.strategy == "random":
            return random.choice(instances)

        elif self.strategy == "round_robin":
            instance = instances[self.index % len(instances)]
            self.index += 1
            return instance

        elif self.strategy == "least_conn":
            # 实际场景需要追踪连接数
            return random.choice(instances)

        return instances[0]

    def _get_instances(self, service_name: str) -> List[str]:
        """
        获取服务实例列表
        实际场景从 Consul 获取
        """
        now = time.time()
        cache = self.instances_cache.get(service_name)

        if cache and now - cache["time"] < self.cache_ttl:
            return cache["instances"]

        # 实际项目：从 Consul 查询
        # instances = consul_client.get_healthy_instances(service_name)

        # 这里用静态配置模拟
        instances = self._static_instances(service_name)

        self.instances_cache[service_name] = {
            "time": now,
            "instances": instances
        }

        return instances

    def _static_instances(self, service_name: str) -> List[str]:
        """静态服务实例（模拟）"""
        static_map = {
            "user-service": ["http://user-service:8001"],
            "order-service": ["http://order-service:8002"],
            "product-service": ["http://product-service:8003"],
            "payment-service": ["http://payment-service:8004"],
        }
        return static_map.get(service_name, [])
```

---

### 12. 网关主程序

#### `main.py`

```python
import time
import uuid
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from core.router import RouteConfig
from core.proxy import ReverseProxy
from middleware.auth import auth_middleware
from middleware.rate_limit import rate_limit_middleware
from middleware.logging import RequestLogger
from utils.jwt_utils import create_access_token, blacklist_token

# 初始化
app = FastAPI(title="API Gateway", version="1.0.0")
router_config = RouteConfig("config/routes.yaml")
proxy = ReverseProxy()
logger = RequestLogger()

# CORS 配置（统一处理跨域）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 生产环境要限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    print("API Gateway starting...")


@app.on_event("shutdown")
async def shutdown():
    await proxy.close()
    print("API Gateway stopped.")


# ============================================================
# 认证接口（不需要鉴权）
# ============================================================

@app.post("/api/v1/auth/login")
async def login(request: Request):
    """登录接口，生成 JWT Token"""
    body = await request.json()
    username = body.get("username")
    password = body.get("password")

    # TODO: 实际验证用户名密码
    if username == "admin" and password == "123456":
        token = create_access_token(
            data={"sub": "user-001", "name": username, "role": "admin"}
        )
        return {"access_token": token, "token_type": "bearer"}
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")


@app.post("/api/v1/auth/logout")
async def logout(request: Request):
    """登出接口，Token 加入黑名单"""
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        token = authorization[7:]
        blacklist_token(token)
    return {"message": "Logged out successfully"}


# ============================================================
# 核心：统一路由处理
# ============================================================

@app.api_route(
    "/api/v1/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"]
)
async def gateway_handler(request: Request, path: str):
    """
    统一网关处理器
    所有请求都经过这里
    """

    # 生成 TraceID（全链路追踪用）
    trace_id = str(uuid.uuid4())
    start_time = time.time()

    # 1. 路由匹配
    route = router_config.match(request.url.path, request.method)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    upstream_service = route["name"]

    try:
        # 2. 鉴权
        user_info = await auth_middleware(request, route)

        # 3. 限流
        await rate_limit_middleware(request, route, user_info)

        # 4. 记录请求日志
        logger.log_request(request, trace_id, user_info)

        # 5. 构建注入的请求头
        extra_headers = {
            "X-Trace-ID": trace_id,           # 链路追踪 ID
            "X-Gateway": "python-gateway",     # 标记经过网关
        }

        if user_info:
            # 将用户信息注入到请求头，后端服务直接使用
            extra_headers["X-User-ID"] = user_info.get("user_id", "")
            extra_headers["X-User-Name"] = user_info.get("user_name", "")
            extra_headers["X-User-Role"] = user_info.get("role", "")

        # 6. 转发请求
        upstream_url = route["upstream"]
        timeout = route.get("timeout", 5)

        response = await proxy.forward(
            request=request,
            upstream_url=upstream_url,
            timeout=timeout,
            extra_headers=extra_headers
        )

        # 7. 记录响应日志
        duration_ms = (time.time() - start_time) * 1000
        logger.log_response(trace_id, response.status_code, duration_ms, upstream_service)

        # 8. 注入响应头
        response.headers["X-Trace-ID"] = trace_id
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"

        return response

    except HTTPException as e:
        duration_ms = (time.time() - start_time) * 1000
        logger.log_response(trace_id, e.status_code, duration_ms, upstream_service)
        raise

    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        logger.log_error(trace_id, e, upstream_service)
        raise HTTPException(status_code=500, detail="Internal Gateway Error")


# ============================================================
# 健康检查
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "api-gateway",
        "timestamp": time.time()
    }


# ============================================================
# 启动
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 三、灰度发布实现

### 1. 什么是灰度发布？

**核心思想：**
```
新版本上线时，不是全量发布
而是先发给 5% 的用户
观察没问题后，再逐步扩大
最终全量发布
```

**好处：**
- 新版本有 bug，只影响 5% 用户
- 快速发现问题，快速回滚
- 降低发布风险

---

### 2. 灰度策略

| 策略 | 说明 |
|------|------|
| **按用户比例** | 5% 的用户走新版本 |
| **按用户 ID** | 指定用户走新版本 |
| **按 Header** | 带特定 Header 走新版本 |
| **按 IP** | 特定 IP 走新版本 |
| **按地区** | 特定地区走新版本 |

---

### 3. Python 实现灰度路由

```python
import hashlib
import redis

redis_client = redis.from_url("redis://localhost:6379")


class CanaryRouter:
    """
    灰度路由器
    """

    def __init__(self):
        # 灰度配置（实际从配置中心读取）
        self.canary_config = {
            "order-service": {
                "enabled": True,
                "stable_upstream": "http://order-service-v1:8002",
                "canary_upstream": "http://order-service-v2:8002",
                "canary_percent": 10,          # 10% 流量走新版本
                "canary_users": ["user-001"],  # 指定用户走新版本
                "canary_header": "X-Canary",   # 带此 Header 走新版本
            }
        }

    def get_upstream(
        self,
        service_name: str,
        default_upstream: str,
        user_id: str = None,
        request_headers: dict = None
    ) -> tuple:
        """
        获取上游地址（考虑灰度）
        返回 (upstream_url, is_canary)
        """
        config = self.canary_config.get(service_name)

        if not config or not config.get("enabled"):
            return default_upstream, False

        # 策略 1：强制 Header（测试用）
        if request_headers and config.get("canary_header"):
            if config["canary_header"] in request_headers:
                return config["canary_upstream"], True

        # 策略 2：指定用户
        if user_id and user_id in config.get("canary_users", []):
            return config["canary_upstream"], True

        # 策略 3：按百分比（用用户 ID 做一致性哈希）
        if user_id and config.get("canary_percent", 0) > 0:
            if self._should_canary(user_id, config["canary_percent"]):
                return config["canary_upstream"], True

        return config["stable_upstream"], False

    def _should_canary(self, user_id: str, percent: int) -> bool:
        """
        一致性哈希判断是否走灰度
        同一个用户每次结果一致
        """
        hash_value = int(
            hashlib.md5(user_id.encode()).hexdigest(), 16
        ) % 100

        return hash_value < percent


# 在网关主程序中使用
canary_router = CanaryRouter()

async def gateway_handler_with_canary(request: Request, path: str):
    """带灰度的网关处理器"""
    route = router_config.match(request.url.path, request.method)
    user_info = await auth_middleware(request, route)
    user_id = user_info.get("user_id") if user_info else None

    # 获取上游地址（考虑灰度）
    upstream_url, is_canary = canary_router.get_upstream(
        service_name=route["name"],
        default_upstream=route["upstream"],
        user_id=user_id,
        request_headers=dict(request.headers)
    )

    # 记录是否走灰度
    extra_headers = {
        "X-Canary": "true" if is_canary else "false"
    }

    return await proxy.forward(
        request=request,
        upstream_url=upstream_url,
        timeout=route.get("timeout", 5),
        extra_headers=extra_headers
    )
```

---

## 四、主流网关框架选型

### 1. Kong

**特点：**
- 基于 Nginx + Lua
- 插件生态丰富
- 性能极高
- 有开源版和企业版
- 支持 REST API 管理

**适用：**
- 高性能需求
- 插件需求丰富
- 运维团队强

---

### 2. APISIX

**特点：**
- Apache 开源
- 基于 Nginx + Lua
- 国内团队（API7）维护，中文支持好
- 动态路由，无需重启
- 支持 gRPC、WebSocket
- 插件热加载

**适用：**
- 国内团队首选
- 需要动态配置
- 对 Kong 的国产替代

---

### 3. Spring Cloud Gateway

**特点：**
- Java 生态，Spring 官方
- 基于 Reactor 异步非阻塞
- 与 Spring Cloud 深度集成

**适用：**
- Java/Spring Cloud 团队

---

### 4. 自研网关（Python）

**适用：**
- 有特殊业务需求
- Python 技术栈为主
- 对网关有深度定制需求

**代价：**
- 需要自己维护
- 性能不如 Kong/APISIX

---

### 选型建议

| 场景 | 推荐 |
|------|------|
| Python 团队，高度定制 | 自研（本讲方案） |
| 高性能，插件丰富 | Kong / APISIX |
| Java/Spring Cloud | Spring Cloud Gateway |
| 国内团队，运维简单 | APISIX |
| K8s 原生 | Ingress + Istio |

---

## 五、大厂常见网关坑点

### 坑点 1：网关成为单点瓶颈

**问题：**
```
所有流量 → 单个网关实例 → 网关挂了 → 全站挂了
```

**解决：**
```
DNS 负载均衡
    ↓
多个网关实例（3~5 个）
    ↓
后端服务
```

---

### 坑点 2：在网关做太多业务逻辑

**问题：**
```
网关里写了：
- 用户信息查询
- 业务权限判断
- 数据聚合
- 业务计算
```

**后果：**
- 网关变成"业务服务"
- 维护困难
- 网关变慢影响所有服务

**原则：**
```
网关只做：路由、鉴权、限流、日志、协议转换
业务逻辑放到 BFF 或微服务里
```

---

### 坑点 3：JWT 没有设置合理的过期时间

**问题：**
```
Token 过期时间设置 7 天
用户被封号，但 Token 还有 7 天有效
```

**解决：**
```python
# 短期 Token + Redis 黑名单
ACCESS_TOKEN_EXPIRE_MINUTES = 30    # 30 分钟
# 登出时把 Token 加入黑名单
# 封号时把用户所有 Token 加入黑名单
```

---

### 坑点 4：TraceID 没有透传

**问题：**
```
网关生成了 TraceID
但没有透传给后端服务
后端服务日志没有 TraceID
无法关联整条链路的日志
```

**解决：**
```python
# 网关注入
extra_headers["X-Trace-ID"] = trace_id

# 后端服务取出
trace_id = request.headers.get("X-Trace-ID")
# 在日志中输出 trace_id
```

---

### 坑点 5：超时设置不合理

**问题：**
```
网关超时 30s
后端服务超时 5s
后端服务 5s 超时，网关等了 30s 才超时
浪费连接资源
```

**原则：**
```
网关超时 > 后端超时（留出余量）
但网关超时不能太长
通常：网关超时 = 后端超时 × 1.2
```

---

### 坑点 6：大文件上传走网关

**问题：**
- 网关内存撑满
- 影响其他请求

**解决：**
- 大文件直传到对象存储（OSS/S3）
- 或绕过网关直连上传服务

---

## 六、面试高频题

### 1. 为什么需要 API 网关？

**参考答案：**

没有网关时，前端直接调多个微服务，存在问题：
1. **跨域**：每个服务都要配置
2. **鉴权重复**：每个服务都要验证 Token
3. **前端耦合**：前端要知道所有服务地址
4. **没有统一日志**：无法全局监控
5. **安全暴露**：所有服务暴露公网

网关统一解决以上问题。

---

### 2. 网关的核心职责有哪些？

**参考答案：**

- **路由**：根据路径转发到对应服务
- **鉴权**：验证 JWT Token
- **限流**：防止过载
- **日志**：统一记录请求和响应
- **熔断**：防止雪崩
- **协议转换**：HTTP → gRPC
- **灰度发布**：部分流量走新版本
- **请求/响应转换**：加工请求和响应

---

### 3. JWT 鉴权的流程？

**参考答案：**

```
1. 用户登录，服务端签发 JWT Token
2. 客户端存储 Token（LocalStorage 或 Cookie）
3. 后续请求在 Header 中带上 Token：Authorization: Bearer <token>
4. 网关验证 Token：签名、过期时间
5. 验证通过，提取用户信息注入请求头
6. 后端服务从请求头读取用户信息，不再验证 Token
```

---

### 4. 灰度发布怎么实现？

**参考答案：**

常见策略：
1. **按百分比**：5% 流量走新版本（一致性哈希保证同一用户一致）
2. **按用户 ID**：指定用户走新版本
3. **按 Header**：带特定 Header 走新版本（测试用）
4. **按 IP/地区**：特定 IP 走新版本

**流程：**
```
新版本上线 → 5% 流量 → 监控指标 → 无问题 → 10% → 50% → 100%
```

---

### 5. 网关和 BFF 的区别？

**参考答案：**

| 维度 | API 网关 | BFF |
|------|---------|-----|
| 职责 | 路由、鉴权、限流 | 业务逻辑、数据聚合 |
| 通用性 | 所有服务通用 | 面向特定客户端（App/Web/小程序） |
| 业务逻辑 | 无 | 有 |
| 数量 | 1 个 | 多个（每种客户端一个） |

---

## 七、这一讲你必须记住的核心结论

1. **网关是微服务的统一入口**，解决跨域、鉴权、限流等公共问题
2. **网关核心职责**：路由、鉴权、限流、日志、熔断、灰度
3. **JWT 鉴权**：网关统一验证，后端服务信任网关注入的用户信息
4. **TraceID**：必须在网关生成并透传，实现全链路追踪
5. **限流维度**：接口级 + 用户级 + IP 级，多层保护
6. **灰度发布**：一致性哈希保证同一用户始终访问同一版本
7. **网关不做业务逻辑**，业务逻辑放 BFF 或微服务
8. **网关高可用**：多实例部署，前置 DNS 负载均衡
9. **超时设置**：网关超时略大于后端超时
10. **选型**：Python 团队自研，高性能用 Kong/APISIX

---

## 八、这一讲的练习题

### 练习 1：完善路由配置

**要求：**
在 `routes.yaml` 中添加：
- 搜索服务（不需要鉴权）
- 评论服务（需要鉴权）
- 管理后台（需要鉴权，且角色必须是 admin）

**思考：** 怎么在网关层做角色权限控制？

---

### 练习 2：实现 Token 刷新

**要求：**
实现 `POST /api/v1/auth/refresh` 接口：
- 接收一个快过期的 Access Token
- 返回一个新的 Access Token
- 旧 Token 加入黑名单

---

### 练习 3：实现请求/响应日志存储

**要求：**
将网关的请求日志写入 Redis（或文件），包含：
- TraceID
- 请求路径
- 响应状态码
- 耗时
- 用户 ID

并提供一个查询接口 `GET /admin/logs`，支持按 TraceID 查询。

---

## 九、下一讲预告

下一讲我们进入微服务最难的问题：

**第 6 讲：分布式数据一致性（Python 版）— 分布式事务、幂等、最终一致性实战**

会讲：
- CAP 定理和 BASE 理论
- 为什么微服务不能用本地事务
- 分布式事务五种方案详解
- 本地消息表 + 消息队列实战
- Saga 模式实战（Python）
- TCC 模式设计
- 幂等性方案对比
- 补偿机制与对账设计
- 大厂常见数据一致性坑点
