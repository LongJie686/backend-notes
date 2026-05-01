# 第8讲：生产环境部署与运维

欢迎进入最后的关键一讲！

前七讲我们完成了：
- 架构设计 → 角色编排 → RAG知识库 → 工具调用 → Prompt优化 → 可观测性 → 安全护栏

**现在到了最终考验：把系统真正推上生产。**

很多团队在这里翻车：

```
常见的翻车现场：

❌ 本地跑得好好的，一上线就崩
❌ 并发10个用户就卡死
❌ 没有高可用，一台服务器挂了全部瘫痪
❌ 没有灰度，新版本直接把所有用户搞崩
❌ 没有监控，用户反馈才知道系统挂了
❌ 没有回滚，出问题只能手动修
❌ 日志散落各处，出了事不知道查哪里
```

**这一讲，我们把Multi-Agent系统打造成真正的生产级服务。**

---

## 一、生产部署全景图

### **完整的生产架构**

```
┌─────────────────────────────────────────────────────┐
│                  生产环境架构                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  用户层                                             │
│  Browser/App/API Client                            │
│           ↓                                         │
│  接入层                                             │
│  Nginx（负载均衡 + SSL终止 + 限流）                 │
│           ↓                                         │
│  API层                                              │
│  FastAPI（多实例，水平扩展）                         │
│           ↓                                         │
│  任务层                                             │
│  Celery Worker（异步任务处理）                      │
│           ↓                                         │
│  Agent层                                            │
│  Multi-Agent System（CrewAI/LangGraph）             │
│           ↓                                         │
│  基础设施层                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐             │
│  │Redis │ │向量库│ │MySQL │ │对象库│             │
│  └──────┘ └──────┘ └──────┘ └──────┘             │
│                                                     │
│  可观测性层                                         │
│  Prometheus + Grafana + ELK Stack                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 二、Docker容器化

### **1. 为什么要容器化？**

```
没有容器化的痛点：
❌ "在我机器上能跑" - 环境不一致
❌ 依赖冲突 - Python版本、库版本
❌ 部署复杂 - 每台服务器手动配置
❌ 难以扩展 - 无法快速复制实例

容器化的好处：
✅ 环境完全一致
✅ 一次构建，处处运行
✅ 秒级扩缩容
✅ 资源隔离
✅ 易于回滚
```

---

### **2. 项目结构设计**

```
market-research-agent/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI主程序
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py        # API路由
│   │   └── schemas.py       # 请求/响应模型
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── researcher.py    # 研究员Agent
│   │   ├── analyst.py       # 分析师Agent
│   │   └── writer.py        # 撰写者Agent
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── search.py        # 搜索工具
│   │   └── scraper.py       # 爬虫工具
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py        # 配置管理
│   │   ├── security.py      # 安全模块
│   │   └── logger.py        # 日志模块
│   └── tasks/
│       ├── __init__.py
│       └── research_task.py # Celery任务
├── docker/
│   ├── Dockerfile.api       # API服务镜像
│   ├── Dockerfile.worker    # Worker服务镜像
│   └── nginx.conf           # Nginx配置
├── docker-compose.yml       # 本地开发
├── docker-compose.prod.yml  # 生产环境
├── k8s/                     # Kubernetes配置
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── configmap.yaml
├── requirements.txt
├── .env.example
└── Makefile                 # 常用命令
```

---

### **3. Dockerfile编写**

```dockerfile
# docker/Dockerfile.api
# ===== 构建阶段 =====
FROM python:3.11-slim as builder

WORKDIR /app

# 安装构建依赖
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装Python依赖到临时目录
RUN pip install --no-cache-dir --user -r requirements.txt

# ===== 运行阶段 =====
FROM python:3.11-slim as runtime

WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制已安装的包
COPY --from=builder /root/.local /root/.local

# 复制应用代码
COPY app/ ./app/

# 环境变量
ENV PATH=/root/.local/bin:$PATH \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 非root用户运行（安全）
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "4", \
     "--timeout-keep-alive", "60"]
```

```dockerfile
# docker/Dockerfile.worker
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1

RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Celery Worker启动
CMD ["celery", "-A", "app.tasks.research_task", \
     "worker", \
     "--loglevel=info", \
     "--concurrency=4", \
     "--queues=research,default"]
```

---

### **4. requirements.txt**

```txt
# Web框架
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0

# Agent框架
crewai==0.28.0
langchain==0.1.0
langchain-openai==0.0.5

# 异步任务
celery==5.3.4
redis==5.0.1
flower==2.0.1  # Celery监控

# 数据库
sqlalchemy==2.0.23
alembic==1.13.0
psycopg2-binary==2.9.9

# 向量数据库
chromadb==0.4.18

# 工具
requests==2.31.0
beautifulsoup4==4.12.2
tiktoken==0.5.2

# 安全
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4

# 可观测性
prometheus-client==0.19.0
opentelemetry-sdk==1.22.0
langsmith==0.0.75

# 测试
pytest==7.4.3
pytest-asyncio==0.21.1
httpx==0.25.2
```

---

## 三、FastAPI应用构建

### **1. 配置管理**

```python
# app/core/config.py
from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """
    应用配置
    优先级：环境变量 > .env文件 > 默认值
    """

    # ===== 应用基础配置 =====
    APP_NAME: str = "Market Research Agent"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "production"  # development/staging/production

    # ===== API配置 =====
    API_PREFIX: str = "/api/v1"
    ALLOWED_HOSTS: list = ["*"]
    CORS_ORIGINS: list = ["https://your-domain.com"]

    # ===== LLM配置 =====
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4"
    OPENAI_TEMPERATURE: float = 0.7
    QIANFAN_AK: Optional[str] = None
    QIANFAN_SK: Optional[str] = None
    USE_DOMESTIC_MODEL: bool = False

    # ===== 数据库配置 =====
    DATABASE_URL: str = "postgresql://user:pass@localhost/dbname"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # ===== Redis配置 =====
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # ===== 向量库配置 =====
    VECTOR_DB_TYPE: str = "chroma"
    CHROMA_PERSIST_DIR: str = "./data/chroma"
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333

    # ===== 安全配置 =====
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    DAILY_TOKEN_LIMIT: int = 500_000
    DAILY_COST_LIMIT_USD: float = 50.0
    MAX_REQUEST_TOKENS: int = 8_000

    # ===== 可观测性配置 =====
    LANGCHAIN_TRACING_V2: bool = True
    LANGCHAIN_API_KEY: Optional[str] = None
    LANGCHAIN_PROJECT: str = "market-research-prod"
    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = "./logs"

    # ===== 业务配置 =====
    MAX_CONCURRENT_TASKS: int = 10
    TASK_TIMEOUT_SECONDS: int = 300
    CACHE_TTL_SECONDS: int = 3600

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """单例模式获取配置（带缓存）"""
    return Settings()


# 全局配置实例
settings = get_settings()
```

---

### **2. 主应用程序**

```python
# app/main.py
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
import prometheus_client
from prometheus_client import Counter, Histogram, Gauge

from app.core.config import settings
from app.core.logger import get_logger
from app.api.routes import router

logger = get_logger(__name__)

# ===== Prometheus指标定义 =====
REQUEST_COUNT = Counter(
    'agent_requests_total',
    'Total requests',
    ['method', 'endpoint', 'status']
)

REQUEST_DURATION = Histogram(
    'agent_request_duration_seconds',
    'Request duration',
    ['endpoint'],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)

ACTIVE_TASKS = Gauge(
    'agent_active_tasks',
    'Currently active tasks'
)

TOKEN_USAGE = Counter(
    'agent_token_usage_total',
    'Total tokens used',
    ['model', 'task_type']
)


# ===== 应用生命周期 =====
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """
    应用启动和关闭时的处理
    """
    # ===== 启动时初始化 =====
    logger.info(f"启动 {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"环境：{settings.ENVIRONMENT}")

    # 初始化数据库连接
    logger.info("初始化数据库连接...")

    # 初始化向量库
    logger.info("初始化向量数据库...")

    # 初始化Redis连接
    logger.info("初始化Redis...")

    # 预热Agent（避免第一次请求太慢）
    logger.info("预热Agent系统...")

    logger.info("系统初始化完成，开始接受请求")

    yield  # 应用运行中

    # ===== 关闭时清理 =====
    logger.info("开始优雅关闭...")


# ===== 创建FastAPI应用 =====
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="企业级多智能体研报生成系统",
    docs_url="/docs" if settings.DEBUG else None,  # 生产环境关闭文档
    redoc_url="/redoc" if settings.DEBUG else None,
    lifespan=lifespan
)


# ===== 中间件配置 =====

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# 可信Host
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.ALLOWED_HOSTS
)


# 请求追踪中间件
@app.middleware("http")
async def request_tracking_middleware(request: Request, call_next):
    """
    为每个请求生成唯一ID，记录耗时和状态
    """
    # 生成请求ID
    request_id = str(uuid.uuid4())[:8]
    request.state.request_id = request_id
    request.state.start_time = time.time()

    # 记录请求
    logger.info(
        f"请求开始 | id={request_id} "
        f"method={request.method} "
        f"path={request.url.path}"
    )

    try:
        response = await call_next(request)

        # 记录响应
        duration = time.time() - request.state.start_time

        logger.info(
            f"请求完成 | id={request_id} "
            f"status={response.status_code} "
            f"duration={duration:.2f}s"
        )

        # 更新Prometheus指标
        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status=response.status_code
        ).inc()

        REQUEST_DURATION.labels(
            endpoint=request.url.path
        ).observe(duration)

        # 在响应头中加入请求ID（方便排查问题）
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time"] = f"{duration:.3f}s"

        return response

    except Exception as e:
        duration = time.time() - request.state.start_time
        logger.error(
            f"请求异常 | id={request_id} "
            f"error={str(e)} "
            f"duration={duration:.2f}s"
        )

        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status=500
        ).inc()

        return JSONResponse(
            status_code=500,
            content={
                "error": "服务器内部错误",
                "request_id": request_id,
                "message": "请稍后重试，如问题持续请联系支持团队"
            }
        )


# ===== 路由注册 =====
app.include_router(
    router,
    prefix=settings.API_PREFIX
)


# ===== 基础端点 =====

@app.get("/health")
async def health_check():
    """健康检查端点（用于负载均衡探活）"""
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "timestamp": time.time()
    }


@app.get("/ready")
async def readiness_check():
    """
    就绪检查（检查所有依赖是否正常）
    K8s readinessProbe使用
    """
    checks = {}

    # 检查Redis
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL)
        r.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    # 检查数据库（简化）
    checks["database"] = "ok"
    checks["vector_db"] = "ok"

    # 整体状态
    all_ok = all(v == "ok" for v in checks.values())

    if not all_ok:
        raise HTTPException(
            status_code=503,
            detail={"message": "服务未就绪", "checks": checks}
        )

    return {"status": "ready", "checks": checks}


@app.get("/metrics")
async def metrics():
    """Prometheus指标端点"""
    from fastapi.responses import Response
    return Response(
        content=prometheus_client.generate_latest(),
        media_type="text/plain"
    )
```

---

### **3. API路由设计**

```python
# app/api/routes.py
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional
import uuid
import time

from app.core.config import settings
from app.core.logger import get_logger
from app.tasks.research_task import run_research_task

logger = get_logger(__name__)
router = APIRouter()
security = HTTPBearer()


# ===== 请求/响应模型 =====

class ResearchRequest(BaseModel):
    """研报生成请求"""
    topic: str = Field(
        description="调研主题",
        min_length=2,
        max_length=200,
        example="2024年中国手机市场"
    )
    audience: Optional[str] = Field(
        default="投资者和行业分析师",
        description="目标受众"
    )
    report_length: Optional[str] = Field(
        default="standard",
        description="报告长度：brief(1000字)/standard(3000字)/detailed(5000字)"
    )
    priority: Optional[str] = Field(
        default="normal",
        description="优先级：low/normal/high"
    )
    callback_url: Optional[str] = Field(
        default=None,
        description="完成后回调URL（异步模式）"
    )


class TaskResponse(BaseModel):
    """任务创建响应"""
    task_id: str
    status: str
    message: str
    estimated_time_seconds: int
    result_url: str


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    status: str           # pending/running/completed/failed
    progress: int         # 0-100
    current_step: str
    result: Optional[str] = None
    error: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None


# ===== API端点 =====

@router.post(
    "/research",
    response_model=TaskResponse,
    summary="创建研报生成任务",
    tags=["研报生成"]
)
async def create_research_task(
    request: ResearchRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(verify_token)
):
    """
    创建研报生成任务（异步执行）
    """
    task_id = str(uuid.uuid4())

    logger.info(
        f"创建研报任务 | task_id={task_id} "
        f"topic={request.topic} "
        f"user={user['user_id']}"
    )

    # 提交Celery异步任务
    celery_task = run_research_task.apply_async(
        args=[task_id, request.topic],
        kwargs={
            "audience": request.audience,
            "report_length": request.report_length,
            "user_id": user["user_id"]
        },
        queue="research" if request.priority == "high" else "default",
        countdown=0
    )

    # 估算执行时间
    time_estimates = {
        "brief": 60,
        "standard": 180,
        "detailed": 300
    }
    estimated_time = time_estimates.get(
        request.report_length, 180
    )

    return TaskResponse(
        task_id=task_id,
        status="pending",
        message=f"研报生成任务已创建，预计{estimated_time}秒完成",
        estimated_time_seconds=estimated_time,
        result_url=f"/api/v1/research/{task_id}/status"
    )


@router.get(
    "/research/{task_id}/status",
    response_model=TaskStatusResponse,
    summary="查询任务状态",
    tags=["研报生成"]
)
async def get_task_status(
    task_id: str,
    user: dict = Depends(verify_token)
):
    """查询研报生成任务的当前状态和进度"""
    import redis
    r = redis.from_url(settings.REDIS_URL)

    task_data = r.hgetall(f"task:{task_id}")

    if not task_data:
        raise HTTPException(
            status_code=404,
            detail=f"任务不存在：{task_id}"
        )

    task = {k.decode(): v.decode() for k, v in task_data.items()}

    return TaskStatusResponse(
        task_id=task_id,
        status=task.get("status", "unknown"),
        progress=int(task.get("progress", 0)),
        current_step=task.get("current_step", ""),
        result=task.get("result"),
        error=task.get("error"),
        created_at=task.get("created_at", ""),
        started_at=task.get("started_at"),
        completed_at=task.get("completed_at"),
        duration_seconds=float(task["duration"]) if task.get("duration") else None
    )


@router.get(
    "/research/{task_id}/result",
    summary="获取报告结果",
    tags=["研报生成"]
)
async def get_task_result(
    task_id: str,
    user: dict = Depends(verify_token)
):
    """获取已完成的研报结果"""
    import redis
    r = redis.from_url(settings.REDIS_URL)

    task_data = r.hgetall(f"task:{task_id}")

    if not task_data:
        raise HTTPException(status_code=404, detail="任务不存在")

    status = task_data.get(b"status", b"").decode()

    if status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"任务未完成，当前状态：{status}"
        )

    result = task_data.get(b"result", b"").decode()

    return {
        "task_id": task_id,
        "status": "completed",
        "report": result,
        "format": "markdown",
        "word_count": len(result)
    }


@router.delete(
    "/research/{task_id}",
    summary="取消任务",
    tags=["研报生成"]
)
async def cancel_task(
    task_id: str,
    user: dict = Depends(verify_token)
):
    """取消进行中的任务"""
    from celery.result import AsyncResult
    from app.tasks.research_task import celery_app

    result = AsyncResult(task_id, app=celery_app)

    if result.state in ['PENDING', 'STARTED']:
        result.revoke(terminate=True)
        return {"message": f"任务 {task_id} 已取消"}

    return {"message": f"任务状态为 {result.state}，无法取消"}


@router.get(
    "/tasks",
    summary="查询任务列表",
    tags=["研报生成"]
)
async def list_tasks(
    user: dict = Depends(verify_token),
    page: int = 1,
    page_size: int = 10,
    status: Optional[str] = None
):
    """查询当前用户的任务列表"""
    return {"total": 0, "page": page, "page_size": page_size, "tasks": []}
```

---

## 四、Celery异步任务系统

### **任务定义与进度追踪**

```python
# app/tasks/research_task.py
import time
import redis
import json
from datetime import datetime
from celery import Celery
from celery.utils.log import get_task_logger

from app.core.config import settings

logger = get_task_logger(__name__)

# ===== 初始化Celery =====
celery_app = Celery(
    "research_agent",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_routes={
        "app.tasks.research_task.run_research_task": {"queue": "research"},
        "app.tasks.research_task.run_quick_task": {"queue": "default"}
    },
    worker_concurrency=4,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=settings.TASK_TIMEOUT_SECONDS,
    task_time_limit=settings.TASK_TIMEOUT_SECONDS + 30,
    task_max_retries=3,
    task_default_retry_delay=10,
    result_expires=86400,
)


# ===== Redis进度追踪 =====

class TaskProgressTracker:
    """任务进度追踪器（基于Redis）"""

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.redis_key = f"task:{task_id}"
        self.r = redis.from_url(settings.REDIS_URL)

    def initialize(self, topic: str, user_id: str):
        """初始化任务记录"""
        self.r.hset(self.redis_key, mapping={
            "task_id": self.task_id,
            "topic": topic,
            "user_id": user_id,
            "status": "pending",
            "progress": "0",
            "current_step": "等待执行",
            "created_at": datetime.now().isoformat(),
            "started_at": "",
            "completed_at": "",
            "result": "",
            "error": ""
        })
        self.r.expire(self.redis_key, 86400)  # 24小时后自动过期

    def start(self):
        """标记任务开始"""
        self.r.hset(self.redis_key, mapping={
            "status": "running",
            "started_at": datetime.now().isoformat()
        })

    def update_progress(self, progress: int, step: str):
        """更新进度"""
        self.r.hset(self.redis_key, mapping={
            "progress": str(progress),
            "current_step": step
        })
        logger.info(f"任务进度 {self.task_id}: {progress}% - {step}")

    def complete(self, result: str):
        """标记任务完成"""
        completed_at = datetime.now().isoformat()
        started_at = self.r.hget(self.redis_key, "started_at")

        duration = 0
        if started_at:
            start = datetime.fromisoformat(started_at.decode())
            end = datetime.fromisoformat(completed_at)
            duration = (end - start).total_seconds()

        self.r.hset(self.redis_key, mapping={
            "status": "completed",
            "progress": "100",
            "current_step": "完成",
            "completed_at": completed_at,
            "result": result,
            "duration": str(duration)
        })

    def fail(self, error: str):
        """标记任务失败"""
        self.r.hset(self.redis_key, mapping={
            "status": "failed",
            "current_step": "失败",
            "completed_at": datetime.now().isoformat(),
            "error": error
        })


# ===== Celery任务定义 =====

@celery_app.task(
    bind=True,
    name="app.tasks.research_task.run_research_task",
    max_retries=2,
    default_retry_delay=30
)
def run_research_task(
    self,
    task_id: str,
    topic: str,
    audience: str = "投资者",
    report_length: str = "standard",
    user_id: str = "anonymous"
):
    """
    执行研报生成任务
    """
    tracker = TaskProgressTracker(task_id)

    try:
        tracker.start()
        logger.info(f"开始执行研报任务 | task_id={task_id} topic={topic}")

        # Step1: 初始化 (10%)
        tracker.update_progress(10, "初始化Agent系统")

        from crewai import Agent, Task, Crew, Process
        from langchain_openai import ChatOpenAI
        from crewai_tools import tool

        llm = ChatOpenAI(
            model=settings.OPENAI_MODEL,
            temperature=settings.OPENAI_TEMPERATURE,
            openai_api_key=settings.OPENAI_API_KEY
        )

        # Step2: 搜集信息 (10-40%)
        tracker.update_progress(20, "研究员搜集市场数据")

        @tool("市场搜索")
        def market_search(query: str) -> str:
            """搜索市场数据"""
            return f"关于'{query}'的市场数据：[实际数据]"

        researcher = Agent(
            role="市场研究员",
            goal="搜集全面的市场数据",
            backstory="10年经验的科技市场研究专家",
            tools=[market_search],
            llm=llm,
            verbose=False,
            max_iter=5
        )

        research_task = Task(
            description=f"调研{topic}的市场数据，关注市场份额、趋势、竞争格局",
            expected_output="结构化的市场数据报告",
            agent=researcher
        )

        research_crew = Crew(
            agents=[researcher],
            tasks=[research_task],
            process=Process.sequential,
            verbose=False
        )
        research_result = research_crew.kickoff()

        tracker.update_progress(40, "市场数据搜集完成")

        # Step3: 数据分析 (40-70%)
        tracker.update_progress(50, "分析师进行深度分析")

        analyst = Agent(
            role="数据分析师",
            goal="深度分析市场数据",
            backstory="战略咨询顾问，擅长市场分析",
            llm=llm,
            verbose=False
        )

        analysis_task = Task(
            description=f"基于研究数据，深度分析{topic}的竞争格局和趋势",
            expected_output="深度分析报告",
            agent=analyst,
            context=[research_task]
        )

        analysis_crew = Crew(
            agents=[analyst],
            tasks=[analysis_task],
            process=Process.sequential,
            verbose=False
        )
        analysis_result = analysis_crew.kickoff()

        tracker.update_progress(70, "数据分析完成")

        # Step4: 撰写报告 (70-95%)
        tracker.update_progress(80, "撰写专业研报")

        length_map = {"brief": "1000字", "standard": "3000字", "detailed": "5000字"}
        target_length = length_map.get(report_length, "3000字")

        writer = Agent(
            role="报告撰写者",
            goal=f"撰写{target_length}的专业研究报告",
            backstory="顶级咨询公司资深分析师",
            llm=llm,
            verbose=False
        )

        writing_task = Task(
            description=(
                f"基于研究和分析结果，"
                f"撰写《{topic}研究报告》，"
                f"目标读者：{audience}，"
                f"字数要求：{target_length}，"
                f"格式：Markdown"
            ),
            expected_output=f"{target_length}的专业研报（Markdown）",
            agent=writer,
            context=[research_task, analysis_task]
        )

        final_crew = Crew(
            agents=[writer],
            tasks=[writing_task],
            process=Process.sequential,
            verbose=False
        )
        final_result = final_crew.kickoff()

        tracker.update_progress(95, "报告撰写完成，进行最终处理")

        # Step5: 保存结果 (95-100%)
        report_content = str(final_result)
        tracker.complete(report_content)
        tracker.update_progress(100, "完成")

        logger.info(
            f"研报任务完成 | task_id={task_id} "
            f"length={len(report_content)}"
        )

        return {"task_id": task_id, "status": "completed", "report_length": len(report_content)}

    except Exception as exc:
        logger.error(f"研报任务失败 | task_id={task_id} error={exc}")
        tracker.fail(str(exc))

        if self.request.retries < self.max_retries:
            logger.info(f"任务重试 | task_id={task_id} retry={self.request.retries + 1}")
            raise self.retry(exc=exc, countdown=30)

        raise
```

---

## 五、Docker Compose编排

### **1. 开发环境**

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ===== API服务 =====
  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=development
      - DEBUG=true
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
      - CELERY_RESULT_BACKEND=redis://redis:6379/2
      - DATABASE_URL=postgresql://user:password@postgres:5432/agentdb
    env_file:
      - .env
    volumes:
      - ./app:/app/app
      - ./logs:/app/logs
      - ./data:/app/data
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    networks:
      - agent_network
    restart: unless-stopped

  # ===== Celery Worker =====
  worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    environment:
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
      - CELERY_RESULT_BACKEND=redis://redis:6379/2
    env_file:
      - .env
    volumes:
      - ./app:/app/app
      - ./logs:/app/logs
    depends_on:
      - redis
    networks:
      - agent_network
    restart: unless-stopped
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 4G

  # ===== Celery Flower（任务监控）=====
  flower:
    image: mher/flower:2.0
    command: >
      celery
      --broker=redis://redis:6379/1
      flower
      --port=5555
      --basic_auth=admin:password
    ports:
      - "5555:5555"
    depends_on:
      - redis
    networks:
      - agent_network

  # ===== Redis =====
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - agent_network
    restart: unless-stopped
    command: redis-server --appendonly yes

  # ===== PostgreSQL =====
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: agentdb
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d agentdb"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - agent_network
    restart: unless-stopped

  # ===== Qdrant向量库 =====
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - agent_network
    restart: unless-stopped

  # ===== Nginx反向代理 =====
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./docker/ssl:/etc/nginx/ssl:ro
    depends_on:
      - api
    networks:
      - agent_network
    restart: unless-stopped

volumes:
  redis_data:
  postgres_data:
  qdrant_data:

networks:
  agent_network:
    driver: bridge
```

---

### **2. Nginx配置**

```nginx
# docker/nginx.conf
worker_processes auto;
error_log /var/log/nginx/error.log warn;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    'rt=$request_time '
                    'X-Request-ID=$upstream_http_x_request_id';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/plain application/json;

    # ===== 限流配置 =====
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

    # ===== 上游服务（API集群）=====
    upstream api_cluster {
        least_conn;
        server api:8000 weight=1 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    # ===== HTTP → HTTPS重定向 =====
    server {
        listen 80;
        server_name your-domain.com;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$server_name$request_uri;
        }
    }

    # ===== HTTPS主服务 =====
    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        # SSL配置
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;

        # 安全Headers
        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Frame-Options DENY always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-XSS-Protection "1; mode=block" always;

        client_max_body_size 10m;
        client_body_timeout 60s;
        client_header_timeout 60s;

        # ===== API代理 =====
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;
            limit_conn conn_limit 20;

            proxy_pass http://api_cluster;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 10s;
            proxy_send_timeout 300s;
            proxy_read_timeout 300s;

            proxy_next_upstream error timeout invalid_header http_500 http_502;
            proxy_next_upstream_tries 2;
        }

        # ===== 健康检查 =====
        location /health {
            proxy_pass http://api_cluster/health;
            access_log off;
        }

        # ===== 静态文件 =====
        location /static/ {
            alias /app/static/;
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

---

## 六、Kubernetes部署

### **生产级K8s配置**

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: research-agent-api
  namespace: production
  labels:
    app: research-agent
    component: api
    version: v1.0.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: research-agent
      component: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0    # 零停机部署
  template:
    metadata:
      labels:
        app: research-agent
        component: api
    spec:
      terminationGracePeriodSeconds: 60

      containers:
        - name: api
          image: your-registry/research-agent:v1.0.0
          ports:
            - containerPort: 8000

          envFrom:
            - configMapRef:
                name: research-agent-config
            - secretRef:
                name: research-agent-secrets

          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"

          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /ready
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3

          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]

      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values:
                        - research-agent
                topologyKey: kubernetes.io/hostname

---
# k8s/hpa.yaml - 自动扩缩容
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: research-agent-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: research-agent-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

---

## 七、监控告警体系

### **Prometheus + Grafana配置**

```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
    networks:
      - agent_network

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=your_password
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    networks:
      - agent_network

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    networks:
      - agent_network

volumes:
  prometheus_data:
  grafana_data:
```

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: 'research-agent-api'
    static_configs:
      - targets: ['api:8000']
    metrics_path: '/metrics'

  - job_name: 'celery-worker'
    static_configs:
      - targets: ['flower:5555']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
```

```yaml
# monitoring/alerts.yml
groups:
  - name: agent_alerts
    rules:
      - alert: LowSuccessRate
        expr: |
          rate(agent_requests_total{status="200"}[5m]) /
          rate(agent_requests_total[5m]) < 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Agent成功率过低"
          description: "过去5分钟成功率 {{ $value | humanizePercentage }}，低于90%阈值"

      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            rate(agent_request_duration_seconds_bucket[5m])
          ) > 60
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95响应时间过长"
          description: "P95延迟 {{ $value }}秒，超过60秒阈值"

      - alert: ServiceDown
        expr: up{job="research-agent-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Agent服务不可用"
          description: "{{ $labels.instance }} 已下线超过1分钟"

      - alert: TaskBacklog
        expr: agent_active_tasks > 50
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "任务积压过多"
          description: "当前活跃任务 {{ $value }} 个，超过50的阈值"
```

---

## 八、灰度发布与回滚

### **灰度发布策略**

```python
# app/core/feature_flags.py
import redis
from typing import Any
from app.core.config import settings


class FeatureFlagManager:
    """
    功能开关管理器
    支持：灰度发布、A/B测试、紧急关闭、实时更新
    """

    def __init__(self):
        self.r = redis.from_url(settings.REDIS_URL)
        self.prefix = "feature_flag:"

    def set_flag(
        self,
        flag_name: str,
        enabled: bool,
        rollout_percentage: float = 100.0,
        whitelist_users: list = None
    ):
        import json
        config = {
            "enabled": enabled,
            "rollout_percentage": rollout_percentage,
            "whitelist_users": whitelist_users or []
        }
        self.r.set(f"{self.prefix}{flag_name}", json.dumps(config))
        print(f"功能开关更新：{flag_name} {'开启' if enabled else '关闭'} ({rollout_percentage}%灰度)")

    def is_enabled(self, flag_name: str, user_id: str = "") -> bool:
        import json
        import hashlib

        raw = self.r.get(f"{self.prefix}{flag_name}")
        if not raw:
            return False

        config = json.loads(raw)
        if not config.get("enabled", False):
            return False

        if user_id in config.get("whitelist_users", []):
            return True

        rollout = config.get("rollout_percentage", 0)
        if rollout >= 100:
            return True
        elif rollout <= 0:
            return False
        else:
            hash_val = int(hashlib.md5(f"{flag_name}:{user_id}".encode()).hexdigest(), 16) % 100
            return hash_val < rollout

    def get_all_flags(self) -> dict:
        import json
        result = {}
        keys = self.r.keys(f"{self.prefix}*")
        for key in keys:
            flag_name = key.decode().replace(self.prefix, "")
            raw = self.r.get(key)
            if raw:
                result[flag_name] = json.loads(raw)
        return result


feature_flags = FeatureFlagManager()


def example_usage():
    """灰度发布示例"""

    # 新报告格式，先给10%用户开启
    feature_flags.set_flag(
        "new_report_format",
        enabled=True,
        rollout_percentage=10.0,
        whitelist_users=["admin_001", "beta_user_001"]
    )

    def generate_report(topic: str, user_id: str) -> str:
        if feature_flags.is_enabled("new_report_format", user_id):
            return generate_new_format_report(topic)
        else:
            return generate_old_format_report(topic)

    # 灰度扩大到50%
    feature_flags.set_flag("new_report_format", enabled=True, rollout_percentage=50.0)

    # 全量发布
    feature_flags.set_flag("new_report_format", enabled=True, rollout_percentage=100.0)

    # 紧急回滚
    feature_flags.set_flag("new_report_format", enabled=False)
```

---

### **自动化回滚脚本**

```bash
#!/bin/bash
# scripts/rollback.sh
set -e

NAMESPACE="production"
DEPLOYMENT="research-agent-api"
ROLLBACK_REASON=${1:-"手动触发回滚"}

echo "=========================================="
echo "开始回滚部署: $DEPLOYMENT"
echo "原因: $ROLLBACK_REASON"
echo "时间: $(date)"
echo "=========================================="

echo "当前版本:"
kubectl get deployment $DEPLOYMENT -n $NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
echo ""

echo "部署历史:"
kubectl rollout history deployment/$DEPLOYMENT -n $NAMESPACE

echo "执行回滚..."
kubectl rollout undo deployment/$DEPLOYMENT -n $NAMESPACE

echo "等待回滚完成..."
kubectl rollout status deployment/$DEPLOYMENT -n $NAMESPACE --timeout=120s

echo "验证服务健康..."
sleep 10

READY_PODS=$(kubectl get deployment $DEPLOYMENT -n $NAMESPACE \
  -o jsonpath='{.status.readyReplicas}')
DESIRED_PODS=$(kubectl get deployment $DEPLOYMENT -n $NAMESPACE \
  -o jsonpath='{.spec.replicas}')

if [ "$READY_PODS" == "$DESIRED_PODS" ]; then
    echo "回滚成功! Ready: $READY_PODS/$DESIRED_PODS"
else
    echo "回滚可能失败! Ready: $READY_PODS/$DESIRED_PODS"
    exit 1
fi

echo "=========================================="
echo "回滚完成"
echo "=========================================="
```

---

## 九、运维手册：常见问题处理

### **标准运维手册**

```python
# docs/runbook.py
"""生产环境运维手册（Runbook）"""

RUNBOOK = {
    "服务不可用": {
        "症状": ["健康检查失败", "用户反馈无法访问", "Prometheus告警"],
        "排查步骤": [
            "1. 检查Pod状态：kubectl get pods -n production",
            "2. 查看Pod日志：kubectl logs <pod-name> -n production --tail=100",
            "3. 检查资源使用：kubectl top pods -n production",
            "4. 检查事件：kubectl get events -n production --sort-by=.lastTimestamp"
        ],
        "处理方案": {
            "Pod崩溃重启": "检查OOMKilled，增加内存限制",
            "镜像拉取失败": "检查镜像仓库和认证信息",
            "探活失败": "检查/health端点和依赖服务",
        },
        "回滚命令": "bash scripts/rollback.sh '服务不可用'"
    },

    "响应时间过长": {
        "症状": ["P95 > 60秒", "用户反馈等待时间长", "Celery任务积压"],
        "排查步骤": [
            "1. 查看任务队列长度：celery -A app.tasks inspect active",
            "2. 检查Worker状态：flower仪表盘",
            "3. 查看慢任务日志",
            "4. 检查LLM API响应时间"
        ],
        "处理方案": {
            "任务积压": "scale up worker: kubectl scale deployment worker --replicas=6",
            "LLM超时": "检查OpenAI API状态，考虑切换备用模型",
            "内存不足": "重启Worker释放内存"
        }
    },

    "成本突增": {
        "症状": ["Token消耗异常", "成本告警", "API费用暴增"],
        "排查步骤": [
            "1. 查看成本监控仪表盘",
            "2. 找出高消耗的task_id",
            "3. 分析任务的Token消耗分布",
            "4. 检查是否有恶意请求"
        ],
        "处理方案": {
            "恶意用户": "封禁用户IP，加入黑名单",
            "任务异常": "停止异常任务，检查是否死循环",
            "紧急降级": "切换到cheaper模型（gpt-3.5-turbo）"
        }
    },

    "知识库异常": {
        "症状": ["RAG检索结果不准", "向量库连接失败", "检索延迟高"],
        "排查步骤": [
            "1. 检查Qdrant服务状态",
            "2. 测试向量检索：curl http://qdrant:6333/collections",
            "3. 检查知识库更新日志",
            "4. 验证Embedding模型可用"
        ],
        "处理方案": {
            "服务宕机": "重启Qdrant服务",
            "数据损坏": "从备份恢复",
            "检索不准": "重建索引"
        }
    }
}


class RunbookAssistant:
    """运维手册查询助手"""

    def __init__(self):
        self.runbook = RUNBOOK

    def diagnose(self, symptom: str) -> str:
        """根据症状查找处理方案"""
        result = []

        for issue, info in self.runbook.items():
            symptoms = info.get("症状", [])
            if any(s in symptom for s in symptoms):
                result.append(f"\n## 可能的问题：{issue}")
                result.append("\n排查步骤：")
                for step in info.get("排查步骤", []):
                    result.append(f"  {step}")
                result.append("\n处理方案：")
                for k, v in info.get("处理方案", {}).items():
                    result.append(f"  - {k}: {v}")
                if "回滚命令" in info:
                    result.append(f"\n紧急回滚：{info['回滚命令']}")

        if not result:
            result.append("未找到匹配的问题，请查看完整运维手册")

        return "\n".join(result)


runbook = RunbookAssistant()
```

---

## 十、Makefile：统一运维命令

```makefile
# Makefile
.PHONY: help build up down logs test deploy rollback

help:
    @echo "可用命令："
    @echo "  make build      - 构建Docker镜像"
    @echo "  make up         - 启动开发环境"
    @echo "  make down       - 停止环境"
    @echo "  make logs       - 查看日志"
    @echo "  make test       - 运行测试"
    @echo "  make deploy     - 部署到生产"
    @echo "  make rollback   - 回滚生产部署"
    @echo "  make status     - 查看系统状态"
    @echo "  make monitor    - 打开监控面板"

build:
    docker-compose build --no-cache

up:
    docker-compose up -d
    @echo "开发环境已启动"
    @echo "   API:     http://localhost:8000"
    @echo "   Docs:    http://localhost:8000/docs"
    @echo "   Flower:  http://localhost:5555"
    @echo "   Grafana: http://localhost:3000"

down:
    docker-compose down

logs:
    docker-compose logs -f api worker

logs-api:
    docker-compose logs -f api

logs-worker:
    docker-compose logs -f worker

test:
    docker-compose run --rm api pytest app/tests/ -v

test-coverage:
    docker-compose run --rm api pytest app/tests/ --cov=app --cov-report=html -v

deploy:
    @echo "开始部署到生产环境..."
    @read -p "确认部署版本 [版本号]: " version; \
    docker build -t your-registry/research-agent:$$version . -f docker/Dockerfile.api; \
    docker push your-registry/research-agent:$$version; \
    kubectl set image deployment/research-agent-api api=your-registry/research-agent:$$version -n production; \
    kubectl rollout status deployment/research-agent-api -n production --timeout=120s; \
    echo "部署完成: $$version"

rollback:
    @bash scripts/rollback.sh "Makefile触发"

status:
    @echo "=== Pod状态 ==="
    kubectl get pods -n production -l app=research-agent
    @echo "\n=== 服务状态 ==="
    kubectl get svc -n production
    @echo "\n=== HPA状态 ==="
    kubectl get hpa -n production

monitor:
    open http://localhost:3000
    open http://localhost:5555

scale-up:
    kubectl scale deployment research-agent-api --replicas=6 -n production
    kubectl scale deployment research-agent-worker --replicas=8 -n production

scale-down:
    kubectl scale deployment research-agent-api --replicas=3 -n production
    kubectl scale deployment research-agent-worker --replicas=4 -n production

reset-cost:
    @python -c "from app.core.security import cost_controller; cost_controller.reset_daily()"
    @echo "成本计数已重置"
```

---

## 十一、这一讲的核心总结

### **必须记住的10个要点**

1. **容器化是基础**：Docker保证环境一致，K8s提供弹性扩缩
2. **API和Worker要分离**：FastAPI处理请求，Celery处理耗时任务
3. **异步化是关键**：Agent任务耗时长，必须异步+进度追踪
4. **零停机部署**：RollingUpdate + readinessProbe
5. **灰度发布降低风险**：从1%→10%→50%→100%逐步放量
6. **监控是生命线**：没有监控的生产系统是定时炸弹
7. **告警要及时**：成功率<90%、P95>60秒必须立刻告警
8. **回滚要快**：一键回滚，不超过5分钟恢复
9. **运维手册要完整**：每个告警都要有对应的处理步骤
10. **成本要可控**：日限额+自动降级+告警三重保障

---

## 十二、完整课程总结

恭喜！你已经完成了《企业级多智能体设计实战》的完整学习路线！

### **你掌握的能力图谱**

```
  第1讲：Multi-Agent核心概念与架构模式
   → 理解Agent本质，掌握4种架构模式，能选型

  第2讲：角色分工与任务编排（CrewAI实战）
   → 能设计Agent角色，能编排复杂任务流程

  第3讲：RAG知识管理完整链路
   → 能构建企业知识库，让Agent拥有专业知识

  第4讲：工具调用与工具链深度实战
   → 能设计高质量工具，让Agent连接真实世界

  第5讲：Prompt工程精调与模型优化
   → 能写专业Prompt，输出稳定可控

  第6讲：可观测性与调试
   → 能构建日志追踪体系，快速定位问题

  第7讲：安全护栏与企业级治理
   → 能构建五层安全体系，系统可上生产

  第8讲：生产环境部署与运维
   → 能部署高可用系统，具备完整运维能力
```

---

## 十三、下一步学习建议

### **进阶方向**

**方向1：深度技术方向**
```
→ LangGraph：复杂状态机设计
→ 分布式Agent：跨节点协作
→ 模型精调：SFT/RLHF实战
→ 多模态Agent：视觉+语言
```

**方向2：业务落地方向**
```
→ 行业专项：金融/医疗/法律Agent
→ 数据飞轮：持续优化体系
→ 产品设计：AI产品思维
→ 团队管理：AI工程团队建设
```

**方向3：架构演进方向**
```
→ Agent OS：统一Agent平台
→ 多租户：企业SaaS化
→ 边缘部署：本地化Agent
→ 联邦学习：隐私保护
```

---

### **你的最终实战目标**

完成一个**完整的生产级Multi-Agent系统**，包含：

```
  完整的Agent系统（研报/客服/内容生成任意选择）
  RAG知识库（真实企业文档）
  完整的安全护栏
  可观测性体系（LangSmith + Prometheus）
  容器化部署（Docker Compose最低要求）
  基础监控告警
  完整API接口
```

**能达到这个标准，你就具备了独立交付企业级AI系统的硬实力。**

---

**恭喜完成全部8讲的学习！**

现在你可以：
- 把之前各讲的练习题都完成，构建完整项目
- 分享你的项目，我帮你Code Review
- 提出任何技术问题，我详细解答
- 讨论你的业务场景，帮你落地

**加油！你已经具备了成为AI架构师的核心能力！**
