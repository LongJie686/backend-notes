# JWT 权限管理

## 核心结论

1. **JWT = 无状态令牌认证** -- 服务端不存储会话，令牌自带用户信息，适合分布式系统
2. **三段结构：Header.Payload.Signature** -- 头部（算法）、载荷（用户数据）、签名（防篡改）
3. **双认证策略：自签 JWT + Clerk JWT** -- 自建系统用 HS256/RS256 签发，第三方认证（Clerk）用 JWKS 验证
4. **中间件 + 依赖注入双层校验** -- FastAPI 中间件做全局拦截，Depends 做路由级权限控制
5. **WebSocket 通过 Cookie 传递 JWT** -- 浏览器 WebSocket API 不支持自定义 Header，改用 Cookie 携带令牌

---

## 一、JWT 基础

### 1. JWT 是什么？

JWT（JSON Web Token），一种开放标准（RFC 7519），用于在各方之间安全传输信息。

```
令牌结构（三段 base64url 编码）：

eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInVzZXJuYW1lIjoi5byg5LiJIiwiZXhwIjoxNzAwMDAwMDAwfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
│                          │                                                           │
└── Header（算法+类型）     └── Payload（用户数据，不要放敏感信息）                          └── Signature（签名）
```

**Header（头部）：**
```json
{"alg": "HS256", "typ": "JWT"}
```

**Payload（载荷）：**
```json
{
  "sub": "user_123",        // Subject：用户ID（标准字段）
  "username": "张三",       // 自定义字段
  "email": "a@b.com",      // 自定义字段
  "roles": ["USER", "ADMIN"], // 自定义字段
  "iat": 1700000000,       // Issued At：签发时间（标准字段）
  "exp": 1700086400        // Expiration：过期时间（标准字段）
}
```

**Signature（签名）：**
```
HMACSHA256(base64url(header) + "." + base64url(payload), secret_key)
```

### 2. 签名算法对比

| 算法 | 密钥类型 | 安全性 | 适用场景 |
|------|---------|--------|---------|
| HS256 | 对称密钥（共享密钥） | 中 | 单体应用、内部服务 |
| RS256 | 非对称密钥（RSA 私钥签名，公钥验证） | 高 | 微服务、第三方集成 |
| ES256 | 非对称密钥（ECDSA） | 高 | 高性能场景 |

### 3. JWT vs Session

| 维度 | JWT | Session |
|------|-----|---------|
| 状态 | 无状态，令牌自带信息 | 有状态，服务端存储 |
| 扩展性 | 天然支持分布式 | 需要共享存储（Redis） |
| 安全性 | 令牌泄露即被盗用 | 可服务端主动注销 |
| 适用场景 | API、微服务、移动端 | 传统 Web 应用 |

---

## 二、Token 生命周期管理

### JWTHandler 方法一览

| 方法 | 用途 | 输入 | 输出 |
|------|------|------|------|
| `__init__(secret_key, algorithm, expiration_hours)` | 初始化处理器 | 密钥、算法、过期小时数 | -- |
| `create_token(user_id, username, ...)` | 创建 JWT，设置标准字段 sub/iat/exp | 用户信息 | JWT 字符串 |
| `decode_token(token)` | 解码 JWT，RS256 跳过签名但仍验证过期 | 令牌 | payload dict |
| `verify_token(token)` | 验证令牌有效性 | 令牌 | bool |
| `refresh_token(token)` | 解码旧令牌后生成新令牌 | 旧令牌 | 新令牌 or None |
| `decode_token_with_fallback(token)` | 过期令牌降级提取用户信息，标记 `expired=True` | 令牌 | payload dict or None |

### Token 创建（完整示例）

```python
import jwt
from datetime import datetime, timedelta

class JWTHandler:
    def __init__(self, secret_key: str, algorithm="HS256", expiration_hours=24):
        self.secret_key = secret_key
        self.algorithm = algorithm
        self.expiration_hours = expiration_hours

    def create_token(self, user_id: str, username: str,
                     email=None, roles=None, expires_delta=None) -> str:
        expires = datetime.utcnow() + (
            expires_delta or timedelta(hours=self.expiration_hours))
        payload = {
            "sub": user_id, "username": username,
            "exp": expires.timestamp(), "iat": datetime.utcnow().timestamp(),
        }
        if email: payload["email"] = email
        if roles: payload["roles"] = roles
        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)
```

### Token 解码（算法自适应）

```python
def decode_token(self, token: str) -> dict:
    header = jwt.get_unverified_header(token)
    if header.get("alg") == "RS256":
        # 无私钥，跳过签名验证，仍验证过期
        return jwt.decode(token, options={
            "verify_signature": False, "verify_exp": True})
    return jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
```

`verify_token` 和 `refresh_token` 基于 `decode_token` 实现：前者返回 bool，后者解码后重新调用 `create_token`。`decode_token_with_fallback` 在过期时跳过 exp 验证，仅提取用户信息并标记 `expired=True`。

---

## 三、FastAPI 认证中间件

### 认证层级

| 层级 | 组件 | 职责 |
|------|------|------|
| 全局认证 | `JWTAuthMiddleware` (HTTPBearer) | 提取 Authorization 头，解码 JWT，设置 UserContext |
| 路由级认证 | `create_jwt_dependency()` | 支持必选/可选认证，注入当前用户 |
| 角色检查 | `require_roles()` | 校验用户角色，403 拒绝无权限用户 |

### 核心实现

```python
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# 1. Bearer Token 中间件
class JWTAuthMiddleware(HTTPBearer):
    def __init__(self, jwt_handler: JWTHandler, auto_error=True):
        super().__init__(auto_error=auto_error)
        self.jwt_handler = jwt_handler

    async def __call__(self, request: Request) -> dict | None:
        credentials = await super().__call__(request)
        if not credentials:
            if self.auto_error:
                raise HTTPException(status_code=401, detail="未提供认证凭据")
            return None
        return self.jwt_handler.decode_token(credentials.credentials)

# 2. 依赖注入（支持 optional 模式）
def create_jwt_dependency(jwt_handler: JWTHandler, optional=False):
    security = HTTPBearer(auto_error=not optional)

    async def get_current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(security),
    ) -> UserContext | None:
        if not credentials:
            if optional:
                return None
            raise HTTPException(status_code=401, detail="未提供认证凭据")
        payload = jwt_handler.decode_token(credentials.credentials)
        return UserContext(
            user_id=payload.get("sub"), username=payload.get("username"),
            email=payload.get("email"), roles=payload.get("roles", []))
    return get_current_user

# 3. 角色检查装饰器
def require_roles(*required_roles: str):
    def role_checker(current_user: UserContext = Depends()):
        if not current_user:
            raise HTTPException(status_code=401, detail="用户未认证")
        if not any(r in current_user.roles for r in required_roles):
            raise HTTPException(status_code=403,
                detail=f"需要角色: {', '.join(required_roles)}")
        return current_user
    return role_checker
```

### 使用示例

```python
jwt_handler = JWTHandler(secret_key="your-secret-key")

@app.get("/profile")
async def get_profile(user=Depends(create_jwt_dependency(jwt_handler))):
    return {"user_id": user.user_id}

@app.get("/admin")
async def admin(user=Depends(require_roles("ADMIN"))):
    return {"message": f"欢迎 {user.username}"}
```

---

## 四、WebSocket JWT 认证

浏览器 WebSocket API 不支持自定义 Header，需要通过 Cookie 传递 JWT。

### 认证流程

1. 从 WebSocket 请求头读取 Cookie（兼容 `cookie`/`Cookie`/`COOKIE` 多种大小写）
2. 解析 Cookie 字符串，提取 `internal_access_token`
3. 调用 `decode_session_token()` 解码 JWT 并做数据库二次验证
4. 验证通过则继续业务处理，否则 close(code=4001)

### 核心代码

```python
from urllib.parse import unquote

def extract_token_from_websocket(headers: dict) -> str | None:
    """从 WebSocket 请求头解析 Cookie 并提取 JWT 令牌"""
    cookie_header = next(
        (headers[k] for k in ["cookie", "Cookie", "COOKIE"] if k in headers), None)
    if not cookie_header:
        return None
    cookies = {}
    for pair in cookie_header.split(";"):
        if "=" in pair:
            name, value = pair.strip().split("=", 1)
            cookies[name.strip()] = unquote(value.strip())
    return cookies.get("internal_access_token")

def decode_session_token(session_token: str) -> dict | None:
    """解码 JWT 并验证用户存在性（数据库二次验证）"""
    try:
        payload = JWTHandler().decode_token(session_token)
        user_id = payload.get("sub") or payload.get("user_id")
        if not UserRepository().find_by_user_id(user_id):
            return None
        return {
            "user_id": user_id,
            "username": payload.get("username", "unknown"),
            "email": payload.get("email"),
            "roles": payload.get("roles", []),
        }
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
```

---

## 五、Webhook 认证（服务间通信）

微服务间调用不走用户 JWT，使用系统级认证。

### 1. 支持的认证格式

| 格式 | 令牌结构 | 验证方式 |
|------|---------|---------|
| 系统级 JWT | `xxx.yyy.zzz`（三段） | HMAC-SHA256 签名验证，payload 须含 `system` + `webhook` 字段 |
| SYSTEM 格式 | Base64 → `SYSTEM:<secret>:<timestamp>` | 比对 secret |
| webhook 格式 | Base64 → `webhook:<secret>` | 比对 secret |

### 核心代码

```python
import base64, hmac, hashlib, json

def verify_webhook_auth(auth_header: str, webhook_secret: str) -> bool:
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    token = auth_header[7:]

    # 格式 1：JWT 格式
    if token.count(".") == 2:
        return _verify_system_jwt(token, webhook_secret)

    # 格式 2：Base64 编码
    try:
        decoded = base64.b64decode(token).decode("utf-8")
        if decoded.startswith("SYSTEM:"):
            return decoded.split(":")[1] == webhook_secret
        if decoded.startswith("webhook:"):
            return decoded[8:] == webhook_secret
    except Exception:
        pass
    return False
```

`_verify_system_jwt()` 解码 payload 校验 `system`+`webhook` 字段，再用 HMAC-SHA256 验证签名。

---

## 六、安全配置管理

### 1. 集中化配置

```python
from dataclasses import dataclass, field

@dataclass
class SecurityConfig:
    """安全配置（从环境变量加载）"""
    # JWT
    jwt_secret_key: str = ""
    jwt_algorithm: str = "RS256"
    jwt_expiration_hours: int = 24
    jwt_refresh_expiration_days: int = 7

    # 会话
    session_timeout_minutes: int = 30
    max_concurrent_sessions_per_user: int = 5

    # 安全头
    security_headers_enabled: bool = True
    csrf_protection_enabled: bool = True
    rate_limiting_enabled: bool = True
    rate_limit_requests_per_minute: int = 60

    # CORS
    allowed_origins: list = field(default_factory=lambda: ["http://localhost:3000"])
    allowed_methods: list = field(default_factory=lambda: ["GET", "POST", "PUT", "DELETE"])
    allow_credentials: bool = True

    # 密码
    password_hash_algorithm: str = "bcrypt"
    password_hash_rounds: int = 12
```

### 2. 配置校验

```python
class SecurityConfigManager:
    def _validate_config(self):
        """启动时校验安全配置"""
        warnings, errors = [], []

        if not self.config.jwt_secret_key:
            errors.append("JWT_SECRET_KEY 未设置")
        elif len(self.config.jwt_secret_key) < 32:
            warnings.append("JWT_SECRET_KEY 长度过短，建议至少 32 字符")

        if "*" in self.config.allowed_origins and self.config.allow_credentials:
            warnings.append("CORS：允许所有源且启用凭据存在安全风险")

        for error in errors:
            raise ValueError(f"安全配置错误: {error}")
```

### 3. 安全响应头

```python
def get_security_headers(self) -> dict:
    """安全相关的 HTTP 响应头"""
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": "default-src 'self'",
    }
```

---

## 七、API 路由设计

### 1. 认证路由

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["认证"])

# POST /api/auth/register   -- 用户注册/同步（Webhook 认证）
# GET  /api/auth/me          -- 获取当前用户信息（JWT 认证）
# POST /api/auth/verify      -- 验证令牌有效性
# POST /api/auth/refresh     -- 刷新令牌
# GET  /api/auth/status      -- 获取认证状态（可选认证）
# GET  /api/auth/config      -- 获取认证配置（公开）
```

### 2. 用户同步流程

```
Clerk（第三方认证服务）
    ↓  用户注册/更新 webhook
Node.js BFF（前端网关）
    ↓  POST /api/auth/sync（系统级 JWT）
Python 后端
    ↓  验证 webhook → 同步用户到本地数据库
    ↓  返回同步结果
```

### 3. 请求认证流程

```
浏览器请求
    ↓
Authorization: Bearer <token>
    ↓
JWTAuthMiddleware
    ├─ 提取 Bearer Token
    ├─ 解码 JWT（支持 RS256/HS256）
    ├─ 设置 UserContext
    └─ 验证通过 → 进入路由处理
         ↓
    require_roles("ADMIN")  -- 路由级角色检查
         ↓
    业务逻辑
```

---

## 八、整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      JWT 认证架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  客户端（浏览器 / 移动端）                                       │
│      │  Authorization: Bearer <token>                           │
│      │  或 Cookie: internal_access_token=<token>（WebSocket）   │
│      ↓                                                          │
│  FastAPI 中间件                                                  │
│      ├─ JWTAuthMiddleware（全局认证）                             │
│      ├─ create_jwt_dependency()（路由级认证）                    │
│      └─ require_roles()（角色检查）                              │
│      ↓                                                          │
│  JWTHandler                                                     │
│      ├─ Clerk JWT（RS256，JWKS 验证）    ← 第三方认证           │
│      ├─ 自签 JWT（HS256，密钥验证）      ← 自建认证             │
│      └─ 过期降级（提取用户信息 + expired 标记）                  │
│      ↓                                                          │
│  UserContext（用户上下文）                                       │
│      ├─ user_id / username / email / roles                      │
│      └─ UserContextManager（上下文管理）                         │
│      ↓                                                          │
│  数据库二次验证（用户存在性检查）                                 │
│                                                                 │
│  ┌────────────────────────────────────────┐                     │
│  │        服务间通信（Webhook）             │                     │
│  │  SYSTEM:<secret>:<timestamp>           │                     │
│  │  webhook:<secret>                      │                     │
│  │  系统级 JWT（HMAC-SHA256）              │                     │
│  └────────────────────────────────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、常见面试题

### Q1：JWT 和 Session 的区别？各自适用场景？

JWT 无状态，服务端不存储会话，适合分布式 API 和移动端。Session 有状态，服务端存储会话数据，适合传统 Web 应用。JWT 的缺点是无法主动注销（令牌签发后无法撤销），需要通过黑名单或短过期时间 + 刷新令牌解决。

### Q2：JWT 的安全注意事项？

- Payload 是 Base64 编码（非加密），不要放敏感信息（密码、密钥）
- 密钥至少 32 字符，生产环境推荐 RS256（非对称）
- 设置合理的过期时间（Access Token 15-30 分钟，Refresh Token 7 天）
- 使用 HTTPS 传输，防止令牌被窃取

### Q3：WebSocket 如何做 JWT 认证？

浏览器 WebSocket API 不支持自定义 Header。两种方案：
1. **Cookie 传递**：登录时将 JWT 写入 Cookie，WebSocket 连接时自动携带
2. **URL 参数**：连接时在 URL 中传递 `ws://host/ws?token=xxx`（安全性较低）

### Q4：RS256 令牌为什么可以不验证签名？

RS256 是非对称算法，需要私钥签名、公钥验证。在微服务中，如果后端服务没有公钥（或使用第三方认证如 Clerk），可以跳过签名验证但仍然验证过期时间。这不是最佳实践，但在特定场景下是可接受的降级方案。

### Q5：如何实现 JWT 的主动注销？

JWT 本身无法主动注销。常见方案：
1. **黑名单**：将已注销的令牌 ID 存入 Redis，中间件检查
2. **短过期 + Refresh Token**：Access Token 15 分钟过期，Refresh Token 可主动撤销
3. **版本号**：用户表增加 token_version 字段，每次注销递增，验证时对比
