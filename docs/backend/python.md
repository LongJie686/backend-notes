# Python 后端开发

## 核心结论

1. **GIL 是 CPython 的核心约束** -- CPU 密集型用多进程，IO 密集型用多线程或 asyncio
2. **类型提示不是可选的** -- 生产代码必须有类型标注，配合 mypy 做静态检查
3. **异步是高并发的基础** -- asyncio + aiohttp / FastAPI 是主流方案
4. **装饰器和上下文管理器是 Python 的利器** -- 抽象横切关注点的最佳方式
5. **包管理和虚拟环境是工程化的起点** -- poetry / uv + venv 是标配

---

## 一、GIL 全局解释器锁

### 1. 什么是 GIL？

CPython 的全局解释器锁（Global Interpreter Lock），同一时刻只有一个线程能执行 Python 字节码。

```python
import threading
import time

def cpu_task():
    total = 0
    for i in range(50_000_000):
        total += i

# 单线程
start = time.time()
cpu_task()
cpu_task()
print(f"单线程: {time.time() - start:.2f}s")  # ~3s

# 多线程（因为 GIL，并不会加速）
start = time.time()
t1 = threading.Thread(target=cpu_task)
t2 = threading.Thread(target=cpu_task)
t1.start(); t2.start()
t1.join(); t2.join()
print(f"多线程: {time.time() - start:.2f}s")  # ~3s（没变快，甚至可能更慢）
```

### 2. 怎么绕过 GIL？

| 场景 | 方案 | 原因 |
|------|------|------|
| CPU 密集型 | `multiprocessing` | 多进程各有独立 GIL |
| IO 密集型 | `threading` | IO 等待时释放 GIL |
| IO 密集型（高并发） | `asyncio` | 单线程事件循环，无 GIL 问题 |
| 混合型 | 进程池 + 协程 | 进程内跑协程 |

### 3. 多进程实战

```python
from multiprocessing import Pool
import time

def cpu_task(n):
    total = 0
    for i in range(n):
        total += i
    return total

if __name__ == "__main__":
    # 进程池
    with Pool(processes=4) as pool:
        results = pool.map(cpu_task, [50_000_000] * 4)
    print(results)
```

**注意：** 多进程的开销比多线程大（进程创建、内存复制、IPC 通信），进程数一般不超过 CPU 核心数。

---

## 二、类型提示（Type Hints）

### 1. 基本类型

```python
from typing import Optional, List, Dict, Tuple, Set, Union, Any

# 基本类型标注
name: str = "张三"
age: int = 25
price: float = 99.9
is_active: bool = True

# 容器类型
users: List[str] = ["张三", "李四"]
config: Dict[str, Any] = {"host": "localhost", "port": 3306}
point: Tuple[float, float] = (1.0, 2.0)
tags: Set[str] = {"python", "backend"}

# Optional = Union[T, None]
def find_user(user_id: int) -> Optional[dict]:
    """返回用户信息或 None"""
    ...

# Union = 多种类型之一
def process(value: Union[str, int]) -> str:
    return str(value)
```

### 2. 函数签名

```python
from typing import Optional, List

def search_users(
    name: str,
    age: Optional[int] = None,
    tags: List[str] = [],
    limit: int = 10,
    offset: int = 0,
) -> Dict[str, Any]:
    """搜索用户

    Args:
        name: 用户名（模糊匹配）
        age: 年龄筛选（可选）
        tags: 标签列表
        limit: 每页数量
        offset: 偏移量

    Returns:
        包含 total 和 items 的字典
    """
    ...
```

### 3. 高级类型

```python
from typing import Protocol, TypeVar, Generic, Callable, Literal, TypedDict

# TypedDict：精确描述字典结构
class UserInfo(TypedDict):
    id: int
    name: str
    email: str
    is_active: bool

def create_user(info: UserInfo) -> None:
    # info["id"] 是 int，info["name"] 是 str
    ...

# Protocol：结构化子类型（鸭子类型的类型检查版本）
class Closeable(Protocol):
    def close(self) -> None: ...

def cleanup(resource: Closeable) -> None:
    resource.close()

# 任何有 close() 方法的对象都可以传进来

# Literal：限定具体值
def set_log_level(level: Literal["DEBUG", "INFO", "WARNING", "ERROR"]) -> None:
    ...

# TypeVar + Generic：泛型
T = TypeVar("T")

class Repository(Generic[T]):
    def __init__(self) -> None:
        self._data: List[T] = []

    def add(self, item: T) -> None:
        self._data.append(item)

    def get_all(self) -> List[T]:
        return self._data

# 使用
user_repo: Repository[dict] = Repository()
```

### 4. mypy 静态检查

```bash
# 安装
pip install mypy

# 检查
mypy src/

# 配置 mypy.ini
[mypy]
python_version = 3.11
strict = True
warn_return_any = True
disallow_untyped_defs = True
```

---

## 三、异步编程（asyncio）

### 1. 基础概念

```python
import asyncio
import time

async def say_hello(name: str, delay: float) -> str:
    """模拟 IO 操作"""
    await asyncio.sleep(delay)
    return f"Hello, {name}!"

async def main():
    start = time.time()

    # 并发执行（总耗时 = 最慢的那个）
    results = await asyncio.gather(
        say_hello("张三", 2),
        say_hello("李四", 1),
        say_hello("王五", 3),
    )

    print(f"耗时: {time.time() - start:.1f}s")  # ~3s，不是 6s
    print(results)

asyncio.run(main())
```

### 2. HTTP 请求

```python
import asyncio
import aiohttp
import time

async def fetch(session: aiohttp.ClientSession, url: str) -> str:
    async with session.get(url) as resp:
        return await resp.text()

async def fetch_many(urls: List[str]) -> List[str]:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch(session, url) for url in urls]
        return await asyncio.gather(*tasks)

# 并发请求 10 个 URL
urls = [f"https://httpbin.org/get?id={i}" for i in range(10)]
results = asyncio.run(fetch_many(urls))
```

### 3. 数据库操作（asyncpg 示例）

```python
import asyncpg

async def get_users():
    conn = await asyncpg.connect(
        "postgresql://user:pass@localhost/db"
    )
    try:
        rows = await conn.fetch("SELECT id, name FROM users LIMIT 10")
        return [dict(row) for row in rows]
    finally:
        await conn.close()
```

### 4. 同步 vs 异步怎么选？

| 场景 | 方案 | 原因 |
|------|------|------|
| Web API 服务 | 异步（FastAPI） | 大量 IO 等待 |
| 数据处理脚本 | 同步 | 逻辑简单，不需要高并发 |
| 爬虫 | 异步 | 大量网络请求 |
| 定时任务 | 同步或异步均可 | 看任务类型 |
| CPU 密集计算 | 多进程 | 绕过 GIL |

### 5. 异步的常见坑点

**坑点 1：在异步函数中调用同步阻塞代码**

```python
import asyncio
import time

# 错误：阻塞整个事件循环
async def bad():
    time.sleep(5)  # 阻塞 5 秒，其他协程都无法执行

# 正确：用 run_in_executor
async def good():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, time.sleep, 5)
```

**坑点 2：忘记 await**

```python
async def fetch_data() -> str:
    await asyncio.sleep(1)
    return "data"

async def main():
    # 错误：忘记 await，result 是 coroutine 对象而非字符串
    result = fetch_data()

    # 正确
    result = await fetch_data()
```

---

## 四、装饰器（Decorator）

### 1. 基础装饰器

```python
import time
import functools
from typing import Callable, TypeVar

T = TypeVar("T")

def timer(func: Callable[..., T]) -> Callable[..., T]:
    """计算函数执行时间"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs) -> T:
        start = time.time()
        result = func(*args, **kwargs)
        elapsed = time.time() - start
        print(f"{func.__name__} 耗时: {elapsed:.2f}s")
        return result
    return wrapper

@timer
def process_data(data: list) -> list:
    time.sleep(1)
    return [x * 2 for x in data]

process_data([1, 2, 3])  # process_data 耗时: 1.00s
```

### 2. 带参数的装饰器

```python
def retry(max_retries: int = 3, delay: float = 1.0):
    """重试装饰器"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise
                    print(f"第 {attempt + 1} 次失败，{delay}s 后重试: {e}")
                    time.sleep(delay)
        return wrapper
    return decorator

@retry(max_retries=3, delay=2.0)
def call_api(url: str) -> dict:
    ...
```

### 3. 常用内置装饰器

```python
from functools import lru_cache, wraps

# lru_cache：缓存函数结果
@lru_cache(maxsize=128)
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# property：把方法变成属性
class User:
    def __init__(self, first_name: str, last_name: str):
        self.first_name = first_name
        self.last_name = last_name

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    # cached_property：只计算一次（Python 3.8+）
    # from functools import cached_property
    # @cached_property
    # def expensive_data(self): ...

# staticmethod / classmethod
class DateUtils:
    @staticmethod
    def format_date(dt) -> str:
        return dt.strftime("%Y-%m-%d")

    @classmethod
    def today(cls) -> str:
        from datetime import date
        return cls.format_date(date.today())
```

---

## 五、上下文管理器（Context Manager）

### 1. 类方式

```python
class DatabaseConnection:
    def __init__(self, url: str):
        self.url = url
        self.conn = None

    def __enter__(self):
        self.conn = create_connection(self.url)
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn:
            self.conn.close()
        # 返回 False 表示异常继续传播
        # 返回 True 表示异常被吞掉（慎用）
        return False

# 使用
with DatabaseConnection("postgresql://...") as conn:
    conn.execute("SELECT 1")
```

### 2. contextmanager 装饰器

```python
from contextlib import contextmanager

@contextmanager
def timer(name: str):
    import time
    start = time.time()
    yield
    elapsed = time.time() - start
    print(f"{name}: {elapsed:.2f}s")

@contextmanager
def transaction(db_conn):
    """数据库事务管理"""
    try:
        yield db_conn
        db_conn.commit()
    except Exception:
        db_conn.rollback()
        raise

# 使用
with timer("数据处理"):
    process_data(data)

with transaction(db) as conn:
    conn.execute("INSERT INTO users ...")
    conn.execute("UPDATE stats ...")
```

### 3. 常见用途

| 场景 | 示例 |
|------|------|
| 文件操作 | `with open("file.txt") as f:` |
| 数据库连接 | `with get_connection() as conn:` |
| 事务管理 | `with transaction(conn):` |
| 锁 | `with threading.Lock():` |
| 计时 | `with timer("任务名"):` |
| 临时修改环境 | `with override_settings(DEBUG=True):` |

---

## 六、数据类（dataclass & Pydantic）

### 1. dataclass

```python
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class User:
    name: str
    age: int
    email: Optional[str] = None
    tags: List[str] = field(default_factory=list)

    def is_adult(self) -> bool:
        return self.age >= 18

user = User(name="张三", age=25)
print(user)              # User(name='张三', age=25, email=None, tags=[])
print(user.is_adult())   # True
```

### 2. Pydantic（API 开发必备）

```python
from pydantic import BaseModel, Field, EmailStr, validator
from datetime import datetime
from typing import Optional, List

class UserCreate(BaseModel):
    """创建用户请求体"""
    name: str = Field(..., min_length=1, max_length=50, description="用户名")
    email: EmailStr
    age: int = Field(..., ge=0, le=150, description="年龄")
    tags: List[str] = Field(default_factory=list)

    @validator("name")
    def name_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("用户名不能为空")
        return v.strip()

class UserResponse(BaseModel):
    """用户响应体"""
    id: int
    name: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True  # 允许从 ORM 对象转换

# 自动校验 + 类型转换
user = UserCreate(name="张三", email="test@example.com", age="25")
print(user.age)        # 25（自动从 str 转 int）
print(user.model_dump())  # {'name': '张三', 'email': 'test@example.com', 'age': 25, 'tags': []}
```

### 3. dataclass vs Pydantic

| 维度 | dataclass | Pydantic |
|------|-----------|----------|
| 类型转换 | 不支持 | 自动转换 |
| 数据校验 | 不支持 | 丰富的校验规则 |
| 序列化 | 需要手动 | `model_dump()` / `model_dump_json()` |
| 性能 | 更快 | 稍慢（校验开销） |
| 适用场景 | 内部数据结构 | API 请求/响应、配置 |

---

## 七、包管理与虚拟环境

### 1. 虚拟环境

```bash
# 创建虚拟环境
python -m venv .venv

# 激活
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

# 退出
deactivate
```

### 2. pip 基本操作

```bash
# 安装
pip install fastapi uvicorn sqlalchemy

# 从 requirements.txt 安装
pip install -r requirements.txt

# 导出依赖
pip freeze > requirements.txt

# 升级
pip install --upgrade fastapi
```

### 3. Poetry（推荐）

```bash
# 安装
pip install poetry

# 初始化项目
poetry init

# 安装依赖
poetry add fastapi uvicorn sqlalchemy
poetry add --group dev pytest mypy black

# 安装所有依赖
poetry install

# 运行
poetry run python main.py

# 打包
poetry build
```

**pyproject.toml 示例：**

```toml
[tool.poetry]
name = "my-api"
version = "0.1.0"
description = "My Backend API"
authors = ["zhangsan <zhangsan@example.com>"]

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.104.0"
uvicorn = "^0.24.0"
sqlalchemy = "^2.0.0"
asyncpg = "^0.29.0"
pydantic = "^2.0.0"
redis = "^5.0.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.0"
pytest-asyncio = "^0.21.0"
mypy = "^1.6.0"
black = "^23.0.0"
ruff = "^0.1.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

---

## 八、错误处理最佳实践

### 1. 自定义异常体系

```python
class AppError(Exception):
    """应用基础异常"""
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", status: int = 500):
        self.message = message
        self.code = code
        self.status = status
        super().__init__(message)

class NotFoundError(AppError):
    def __init__(self, resource: str, resource_id: str):
        super().__init__(
            message=f"{resource} 不存在: {resource_id}",
            code="NOT_FOUND",
            status=404,
        )

class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(
            message=message,
            code="VALIDATION_ERROR",
            status=400,
        )

class AuthError(AppError):
    def __init__(self, message: str = "未授权"):
        super().__init__(
            message=message,
            code="UNAUTHORIZED",
            status=401,
        )
```

### 2. 全局异常处理（FastAPI 示例）

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status,
        content={
            "code": exc.code,
            "message": exc.message,
        }
    )

# 使用
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    user = await find_user(user_id)
    if not user:
        raise NotFoundError("用户", str(user_id))
    return user
```

---

## 九、日志（Logging）

### 1. 基础配置

```python
import logging
import sys

def setup_logger(name: str = "app") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # 控制台输出
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    return logger

logger = setup_logger()

logger.info("服务启动")
logger.warning("配置缺失，使用默认值")
logger.error("数据库连接失败", exc_info=True)
```

### 2. 结构化日志（推荐）

```python
import json
import logging

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_data, ensure_ascii=False)

# 输出：{"timestamp": "2025-01-01 12:00:00", "level": "ERROR", "logger": "app", "message": "连接失败"}
```

---

## 十、配置管理

### 1. 环境变量 + Pydantic Settings

```python
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # 应用
    app_name: str = "my-api"
    debug: bool = False

    # 数据库
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "mydb"
    db_user: str = "postgres"
    db_password: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret: str = ""
    jwt_expire_minutes: int = 60

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
```

**.env 文件：**

```env
DEBUG=False
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mydb
DB_USER=postgres
DB_PASSWORD=secret
JWT_SECRET=your-secret-key
REDIS_URL=redis://localhost:6379/0
```

---

## 十一、常用标准库速查

| 模块 | 用途 | 常用 API |
|------|------|---------|
| `pathlib` | 路径操作 | `Path("file.txt").read_text()` |
| `datetime` | 时间日期 | `datetime.now()`, `timedelta(days=7)` |
| `json` | JSON 处理 | `json.dumps()`, `json.loads()` |
| `collections` | 高级容器 | `defaultdict`, `Counter`, `OrderedDict` |
| `itertools` | 迭代器工具 | `chain`, `groupby`, `islice` |
| `functools` | 函数工具 | `lru_cache`, `partial`, `wraps` |
| `hashlib` | 哈希 | `hashlib.sha256(data).hexdigest()` |
| `secrets` | 安全随机 | `secrets.token_urlsafe(32)` |
| `tempfile` | 临时文件 | `NamedTemporaryFile`, `TemporaryDirectory` |
| `dataclasses` | 数据类 | `@dataclass`, `field()` |
| `enum` | 枚举 | `class Status(str, Enum)` |
| `abc` | 抽象基类 | `ABC`, `abstractmethod` |

### 实用示例

```python
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from enum import Enum
import hashlib
import secrets

# pathlib：优雅的路径操作
data_dir = Path("data")
data_dir.mkdir(exist_ok=True)
content = (data_dir / "config.json").read_text(encoding="utf-8")

# Counter：统计频率
words = ["python", "java", "python", "go", "python", "java"]
word_counts = Counter(words)
print(word_counts.most_common(2))  # [('python', 3), ('java', 2)]

# defaultdict：避免 KeyError
grouped = defaultdict(list)
for name, dept in [("张三", "技术"), ("李四", "技术"), ("王五", "产品")]:
    grouped[dept].append(name)
# {'技术': ['张三', '李四'], '产品': ['王五']}

# Enum：类型安全的枚举
class OrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    COMPLETED = "completed"

def update_status(order_id: int, status: OrderStatus):
    # 只能传合法的枚举值
    ...

# hashlib + secrets：密码处理
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{hashed}"
```

---

## 十二、测试基础

### 1. pytest 基本用法

```python
# test_user.py
import pytest
from myapp.models import User

def test_create_user():
    user = User(name="张三", age=25)
    assert user.name == "张三"
    assert user.is_adult() is True

def test_underage_user():
    user = User(name="小明", age=15)
    assert user.is_adult() is False

# 参数化测试
@pytest.mark.parametrize("age, expected", [
    (0, False),
    (17, False),
    (18, True),
    (25, True),
])
def test_is_adult(age, expected):
    user = User(name="测试", age=age)
    assert user.is_adult() == expected
```

### 2. pytest-asyncio：异步测试

```python
import pytest

@pytest.mark.asyncio
async def test_fetch_user():
    user = await fetch_user(user_id=1)
    assert user is not None
    assert user["name"] == "张三"
```

### 3. Fixture

```python
import pytest

@pytest.fixture
def sample_users():
    return [
        User(name="张三", age=25),
        User(name="李四", age=17),
    ]

def test_filter_adults(sample_users):
    adults = [u for u in sample_users if u.is_adult()]
    assert len(adults) == 1
    assert adults[0].name == "张三"
```

---

## 十三、代码风格与质量工具

### 1. Black（代码格式化）

```bash
pip install black
black src/          # 格式化所有文件
black src/main.py   # 格式化单个文件
```

### 2. Ruff（快速 Linter）

```bash
pip install ruff
ruff check src/     # 检查问题
ruff check --fix src/  # 自动修复
```

### 3. mypy（类型检查）

```bash
mypy src/           # 检查类型
```

### 4. pre-commit（Git 提交前自动检查）

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/psf/black
    rev: 23.12.1
    hooks:
      - id: black
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.9
    hooks:
      - id: ruff
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.8.0
    hooks:
      - id: mypy
```

```bash
pre-commit install   # 安装 hook
pre-commit run --all-files  # 手动运行
```

---

## 十四、Web 框架对比

| 框架 | 类型 | 异步支持 | 性能 | 适合场景 |
|------|------|---------|------|---------|
| FastAPI | ASGI | 原生异步 | 高 | API 服务、微服务 |
| Flask | WSGI | 需要扩展 | 中 | 小型项目、原型 |
| Django | WSGI/ASGI | 部分支持 | 中 | 全栈应用、CMS |
| Sanic | ASGI | 原生异步 | 高 | 高性能 API |
| Starlette | ASGI | 原生异步 | 极高 | FastAPI 的底层框架 |

**选择建议：**
- 新项目、API 服务 → **FastAPI**
- 内容管理、后台系统 → **Django**
- 小型脚本、简单服务 → **Flask**
