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

---

## 十五、高频面试题

### 1. 浅拷贝 vs 深拷贝

**核心区别：** 浅拷贝复制第一层引用，深拷贝递归复制所有层级。

```python
import copy

original = {"name": "张三", "scores": [90, 85, 92], "info": {"age": 25}}
```

```python
# === 赋值（不是拷贝） ===
ref = original
ref["name"] = "李四"
print(original["name"])  # "李四" —— 原对象也被改了
```

```python
# === 浅拷贝（copy.copy / dict() / list() / [:]） ===
original = {"name": "张三", "scores": [90, 85, 92], "info": {"age": 25}}

shallow = original.copy()
shallow["name"] = "李四"            # 第一层：不影响原对象
shallow["scores"].append(88)        # 第二层：影响原对象！
shallow["info"]["age"] = 30         # 第二层：影响原对象！

print(original["name"])             # "张三"（第一层独立）
print(original["scores"])           # [90, 85, 92, 88]（嵌套对象共享引用）
print(original["info"]["age"])      # 30（嵌套对象共享引用）
```

```python
# === 深拷贝（copy.deepcopy） ===
original = {"name": "张三", "scores": [90, 85, 92], "info": {"age": 25}}

deep = copy.deepcopy(original)
deep["scores"].append(88)
deep["info"]["age"] = 30

print(original["scores"])           # [90, 85, 92]（完全独立）
print(original["info"]["age"])      # 25（完全独立）
```

**对比表：**

| 操作 | 第一层 | 嵌套层 | 适用场景 |
|------|--------|--------|---------|
| `=` 赋值 | 共享引用 | 共享引用 | 不需要副本 |
| `copy()` 浅拷贝 | 独立副本 | 共享引用 | 嵌套结构只读、单层结构 |
| `deepcopy()` 深拷贝 | 独立副本 | 独立副本 | 需要完全独立的副本 |

**性能：** `deepcopy` 比 `copy` 慢得多（需要递归遍历），能用浅拷贝就不要用深拷贝。

**常见浅拷贝方式：**

```python
# 列表
new_list = old_list[:]
new_list = list(old_list)
new_list = old_list.copy()

# 字典
new_dict = old_dict.copy()
new_dict = dict(old_dict)

# 集合
new_set = old_set.copy()
new_set = set(old_set)
```

---

### 2. 可变对象与不可变对象

**不可变（immutable）：** int, float, str, tuple, frozenset, bytes -- 修改时创建新对象
**可变（mutable）：** list, dict, set -- 修改时原地修改

```python
# 字符串（不可变）：每次拼接都创建新对象
s = "hello"
print(id(s))          # 14023456
s += " world"
print(id(s))          # 14056789 —— 不同对象！

# 列表（可变）：原地修改
lst = [1, 2, 3]
print(id(lst))        # 14023456
lst.append(4)
print(id(lst))        # 14023456 —— 同一个对象！
```

**面试高频陷阱 -- 函数默认参数：**

```python
# 错误：默认参数在函数定义时创建，所有调用共享同一个对象
def append_item(item, cache=[]):
    cache.append(item)
    return cache

print(append_item(1))   # [1]
print(append_item(2))   # [1, 2]  —— 坑！上一次的结果还在
print(append_item(3))   # [1, 2, 3]

# 正确：用 None 作为默认值
def append_item(item, cache=None):
    if cache is None:
        cache = []
    cache.append(item)
    return cache
```

**面试高频陷阱 -- 元组里的可变对象：**

```python
t = ([1, 2], [3, 4])
t[0].append(3)       # 可以修改！元组存的是引用，引用没变
print(t)             # ([1, 2, 3], [3, 4])

t[0] = [10, 20]      # TypeError: 'tuple' object does not support item assignment
                      # 不能替换引用本身
```

---

### 3. == 与 is 的区别

```python
# == 比较值（__eq__），is 比较内存地址（id）
a = [1, 2, 3]
b = [1, 2, 3]

print(a == b)    # True  —— 值相等
print(a is b)    # False —— 不同对象（不同内存地址）

# 小整数池 [-5, 256]：同一值指向同一对象
x = 256
y = 256
print(x is y)    # True

x = 257
y = 257
print(x is y)    # False（超出小整数池范围）

# 字符串驻留：编译期确定的短字符串会驻留
s1 = "hello"
s2 = "hello"
print(s1 is s2)  # True

s1 = "hello!" + "world"
s2 = "hello!world"
print(s1 is s2)  # 可能 True（编译期合并）

s1 = "hello!"
s2 = "hello!"
print(s1 is s2)  # 可能 False（含特殊字符可能不驻留）
```

**面试回答要点：**
- `==` 调用 `__eq__` 方法，比较值
- `is` 比较 `id()` 返回的内存地址
- 判断单例用 `is`（如 `if x is None`），比较值用 `==`
- 小整数池和字符串驻留是 CPython 的优化，不应依赖

---

### 4. 装饰器深入

#### 4.1 装饰器的本质

装饰器是**语法糖**，`@decorator` 等价于 `func = decorator(func)`。

```python
@timer
def process():
    pass

# 等价于
process = timer(process)
```

#### 4.2 functools.wraps 为什么必须加

```python
# 不加 wraps：被装饰函数的元信息丢失
def bad_decorator(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@bad_decorator
def my_function():
    """这是文档字符串"""
    pass

print(my_function.__name__)    # "wrapper" —— 丢了！
print(my_function.__doc__)     # None —— 丢了！

# 加 wraps：保留元信息
import functools

def good_decorator(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@good_decorator
def my_function():
    """这是文档字符串"""
    pass

print(my_function.__name__)    # "my_function"
print(my_function.__doc__)     # "这是文档字符串"
```

#### 4.3 类装饰器

```python
class Singleton:
    """单例装饰器"""
    def __init__(self, cls):
        self._cls = cls
        self._instance = None

    def __call__(self, *args, **kwargs):
        if self._instance is None:
            self._instance = self._cls(*args, **kwargs)
        return self._instance

@Singleton
class Database:
    def __init__(self, url):
        self.url = url

db1 = Database("postgresql://host1")
db2 = Database("postgresql://host2")  # 忽略，返回 db1
print(db1 is db2)  # True
print(db1.url)     # "postgresql://host1"
```

#### 4.4 常见装饰器使用场景

| 装饰器 | 场景 |
|--------|------|
| `@lru_cache` | 缓存计算结果（递归、数据库查询） |
| `@property` | 把方法当属性用（计算属性、延迟加载） |
| `@staticmethod` | 不需要 self 的工具方法 |
| `@classmethod` | 工厂方法、替代构造函数 |
| `@retry` | 接口调用重试 |
| `@timer` | 性能计时 |
| `@require_auth` | 权限校验 |
| `@validate` | 参数校验 |

---

### 5. 线程、进程、协程的选用

#### 5.1 三者对比

| 维度 | 多线程 | 多进程 | 协程 |
|------|--------|--------|------|
| 并行方式 | 并发（受 GIL 限制） | 真正并行 | 并发（单线程） |
| 切换开销 | 中（OS 调度） | 大（进程创建+内存复制） | 极小（用户态切换） |
| 内存 | 共享地址空间 | 各自独立 | 共享（单线程） |
| GIL 影响 | 受限 | 不受（各进程独立 GIL） | 不受 |
| 数据安全 | 需要锁（Lock） | 天然隔离（IPC 通信） | 天然安全（无并发写） |
| 适用场景 | IO 密集型（适中并发） | CPU 密集型 | IO 密集型（极高并发） |

#### 5.2 什么时候用多线程

```python
# 场景：中等并发的 IO 操作（文件读写、数据库查询、HTTP 请求）
# 并发量：几十到几百
import threading
import requests

def download(url: str) -> bytes:
    return requests.get(url).content

urls = ["https://example.com/1", "https://example.com/2", ...]

threads = []
for url in urls:
    t = threading.Thread(target=download, args=(url,))
    t.start()
    threads.append(t)

for t in threads:
    t.join()
```

**特点：** 代码简单，但受 GIL 限制不能真正并行 CPU 任务。线程间共享数据需要加锁。

#### 5.3 什么时候用多进程

```python
# 场景：CPU 密集型计算（数据处理、图像处理、科学计算）
# 充分利用多核 CPU
from concurrent.futures import ProcessPoolExecutor

def process_image(image_path: str) -> dict:
    """CPU 密集：图像处理"""
    from PIL import Image
    img = Image.open(image_path)
    img = img.resize((224, 224))
    # ... 复杂计算
    return {"path": image_path, "result": "..."}

image_paths = ["img1.jpg", "img2.jpg", ...]

with ProcessPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(process_image, image_paths))
```

**特点：** 真正的多核并行。但进程创建开销大，进程间通信需要序列化（pickle），不能共享内存对象。

#### 5.4 什么时候用协程

```python
# 场景：极高并发 IO 操作（API 网关、爬虫、WebSocket 服务）
# 并发量：数千到数万
import asyncio
import aiohttp

async def fetch(session, url):
    async with session.get(url) as resp:
        return await resp.text()

async def main():
    urls = [f"https://api.example.com/data/{i}" for i in range(1000)]
    async with aiohttp.ClientSession() as session:
        tasks = [fetch(session, url) for url in urls]
        # Semaphore 控制并发数，避免压垮对方服务器
        sem = asyncio.Semaphore(50)
        async def fetch_with_sem(url):
            async with sem:
                return await fetch(session, url)
        results = await asyncio.gather(*[fetch_with_sem(u) for u in urls])

asyncio.run(main())
```

**特点：** 单线程、极低开销、万级并发。但所有代码必须是 async/await 链，不能混用阻塞调用。

#### 5.5 混合方案：进程池 + 协程

```python
# 场景：既有 CPU 密集计算，又有高并发 IO
import asyncio
from concurrent.futures import ProcessPoolExecutor

async def handle_request(data):
    loop = asyncio.get_event_loop()
    # CPU 密集任务丢到进程池
    with ProcessPoolExecutor() as pool:
        result = await loop.run_in_executor(pool, cpu_heavy_task, data)
    # IO 操作用协程
    await save_to_db(result)
    return result
```

#### 5.6 决策树

```
任务类型？
├── CPU 密集型（计算、图像处理、加密）
│   └── 多进程（multiprocessing / ProcessPoolExecutor）
├── IO 密集型
│   ├── 并发量 < 100
│   │   └── 多线程（threading / ThreadPoolExecutor）
│   └── 并发量 >= 1000
│       └── 协程（asyncio）
└── 混合型（CPU + IO）
    └── 进程池 + 协程（ProcessPoolExecutor + asyncio）
```

---

### 6. Python 性能优化

#### 6.1 字符串拼接

```python
import time

items = [str(i) for i in range(100000)]

# 慢：+ 拼接（每次创建新字符串对象）
start = time.time()
result = ""
for item in items:
    result += item
print(f"+ 拼接: {time.time() - start:.3f}s")     # ~0.03s

# 快：join（一次性分配内存）
start = time.time()
result = "".join(items)
print(f"join: {time.time() - start:.3f}s")        # ~0.003s（快 10 倍）
```

#### 6.2 列表推导式 vs for 循环

```python
import time

# 慢：append 循环
start = time.time()
result = []
for i in range(1000000):
    result.append(i * 2)
print(f"for + append: {time.time() - start:.3f}s")  # ~0.08s

# 快：列表推导式（底层 C 实现，少了一次函数调用）
start = time.time()
result = [i * 2 for i in range(1000000)]
print(f"列表推导式: {time.time() - start:.3f}s")    # ~0.05s

# 更快：生成器表达式（不占内存，适合大数据量）
total = sum(i * 2 for i in range(1000000))
```

#### 6.3 字典查找 vs 列表查找

```python
# O(1) vs O(n)
data_dict = {i: f"value_{i}" for i in range(100000)}
data_list = [f"value_{i}" for i in range(100000)]

# 字典查找：O(1)，哈希表
if 99999 in data_dict:     # 极快
    pass

# 列表查找：O(n)，逐个遍历
if "value_99999" in data_list:  # 慢
    pass
```

#### 6.4 避免全局变量查找

```python
import math

# 慢：每次循环都查找全局 math.sqrt
def compute_slow(numbers):
    result = []
    for n in numbers:
        result.append(math.sqrt(n))
    return result

# 快：局部变量缓存（局部变量查找比全局快）
def compute_fast(numbers):
    sqrt = math.sqrt       # 缓存到局部变量
    result = []
    for n in numbers:
        result.append(sqrt(n))
    return result
```

#### 6.5 使用内置函数和标准库

```python
# 慢：手动循环
total = 0
for n in numbers:
    total += n

# 快：内置 sum（C 实现）
total = sum(numbers)

# 慢：手动排序
# 快：内置 sorted / list.sort（Timsort，O(n log n)）
sorted_list = sorted(numbers)

# 慢：手动实现
# 快：itertools（C 实现的迭代器工具）
from itertools import chain, groupby, islice
```

#### 6.6 懒加载与生成器

```python
# 内存爆炸：一次性加载所有数据
all_data = [process(line) for line in read_huge_file()]  # 几 GB 内存

# 内存友好：生成器逐条处理
def process_lines(filepath):
    with open(filepath) as f:
        for line in f:
            yield process(line)

for item in process_lines("huge.csv"):
    save_to_db(item)  # 内存占用恒定
```

#### 6.7 缓存计算结果

```python
from functools import lru_cache

# 斐波那契：无缓存 O(2^n)，有缓存 O(n)
@lru_cache(maxsize=None)
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# API 响应缓存
@lru_cache(maxsize=128)
def get_user_config(user_id: int) -> dict:
    """5 分钟内重复查询直接返回缓存"""
    return db.query("SELECT config FROM users WHERE id = %s", user_id)
```

#### 6.8 性能优化检查清单

| 优化手段 | 效果 | 适用场景 |
|----------|------|---------|
| `str.join` 替代 `+` | 快 5-10 倍 | 大量字符串拼接 |
| 列表推导式替代 `for+append` | 快 20-30% | 列表构建 |
| 字典/集合查找替代列表查找 | O(1) vs O(n) | 频繁查找 |
| 局部变量替代全局变量 | 快 20-30% | 循环内频繁调用 |
| 生成器替代列表 | 省内存 | 大数据量处理 |
| `lru_cache` | 避免重复计算 | 纯函数、DB 查询 |
| 多进程 | 利用多核 | CPU 密集型 |
| 协程 | 万级并发 | IO 密集型 |
| C 扩展 / Cython | 10-100 倍 | 性能瓶颈热点 |

---

### 7. GIL 常见追问

**Q：Python 3.13 的 no-GIL 是怎么回事？**

Python 3.13 引入实验性的 free-threaded 模式（PEP 703），可以关闭 GIL。通过 `--disable-gil` 编译或设置环境变量 `PYTHON_GIL=0` 启用。目前是实验阶段，很多第三方库还未适配。

**Q：GIL 什么时候释放？**

- IO 操作（网络请求、文件读写）时自动释放
- `time.sleep()` 时释放
- C 扩展代码中可手动释放（如 NumPy 的计算）
- 每执行一定数量字节码后检查是否需要切换线程（check interval）

**Q：多线程在 Python 中完全没用吗？**

不是。IO 密集型场景（HTTP 请求、数据库查询、文件操作）多线程依然有效，因为 IO 等待时 GIL 会释放，其他线程可以执行。只有 CPU 密集型的多线程才受 GIL 限制。

---

### 8. Python 内存管理

#### 8.1 引用计数（主要机制）

```python
import sys

a = [1, 2, 3]
print(sys.getrefcount(a))  # 2（a 本身 + getrefcount 参数）

b = a          # 引用计数 +1
print(sys.getrefcount(a))  # 3

del b          # 引用计数 -1
print(sys.getrefcount(a))  # 2
```

#### 8.2 循环引用与垃圾回收

```python
# 引用计数无法处理循环引用
class Node:
    def __init__(self):
        self.ref = None

a = Node()
b = Node()
a.ref = b    # a → b
b.ref = a    # b → a（循环引用）

del a, b     # 引用计数不为 0，但对象已不可达
# Python 的分代垃圾回收器会检测并回收循环引用
```

**分代回收：**
- 第 0 代：新创建的对象（频繁扫描）
- 第 1 代：存活过一次 GC 的对象
- 第 2 代：存活过两次 GC 的对象（很少扫描）

```python
import gc

gc.get_threshold()    # (700, 10, 10)：第 0 代阈值 700，第 1/2 代各 10 次
gc.collect()          # 手动触发垃圾回收
gc.disable()          # 禁用自动 GC（性能敏感场景）
```

#### 8.3 内存泄漏常见原因

```python
# 1. 全局列表/字典持续增长
_cache = {}
def process(key, value):
    _cache[key] = value  # 只增不删 → 内存泄漏

# 正确：使用 LRU 缓存或定期清理
from functools import lru_cache

# 2. 闭包持有大对象引用
def create_handler():
    big_data = load_huge_data()  # 100MB
    def handler():
        return len(big_data)     # 闭包持有 big_data 引用
    return handler               # handler 存活 → big_data 不释放

# 3. __del__ 导致循环引用无法回收
class Bad:
    def __del__(self):
        pass  # 有 __del__ 的循环引用对象在 Python < 3.4 无法被 GC 回收

# 4. 模块级缓存
import module
module.cache[key] = value  # 模块级缓存不会被回收
```

---

### 9. 常用魔术方法

```python
class Vector:
    """向量类 -- 演示常用魔术方法"""

    def __init__(self, x, y):
        self.x = x
        self.y = y

    # 对象表示
    def __repr__(self):
        return f"Vector({self.x}, {self.y})"

    def __str__(self):
        return f"({self.x}, {self.y})"

    # 比较操作
    def __eq__(self, other):
        return self.x == other.x and self.y == other.y

    def __lt__(self, other):
        return self.length() < other.length()

    # 算术运算
    def __add__(self, other):
        return Vector(self.x + other.x, self.y + other.y)

    def __sub__(self, other):
        return Vector(self.x - other.x, self.y - other.y)

    def __mul__(self, scalar):
        return Vector(self.x * scalar, self.y * scalar)

    # 长度和布尔
    def __len__(self):
        return int(self.length())

    def __bool__(self):
        return self.x != 0 or self.y != 0

    # 可调用
    def __call__(self, scale=1):
        return Vector(self.x * scale, self.y * scale)

    # 下标访问
    def __getitem__(self, index):
        if index == 0: return self.x
        if index == 1: return self.y
        raise IndexError

    # 迭代
    def __iter__(self):
        yield self.x
        yield self.y

    def length(self):
        return (self.x ** 2 + self.y ** 2) ** 0.5


v1 = Vector(3, 4)
v2 = Vector(1, 2)

print(v1 + v2)          # Vector(4, 6)  __add__
print(v1 * 2)           # Vector(6, 8)  __mul__
print(v1 == Vector(3,4))# True          __eq__
print(v1[0])            # 3             __getitem__
print(list(v1))         # [3, 4]        __iter__
print(bool(v1))         # True          __bool__
```

**分类速查：**

| 类别 | 魔术方法 | 触发方式 |
|------|---------|---------|
| 构造/销毁 | `__init__`, `__del__`, `__new__` | 创建/销毁对象 |
| 字符串表示 | `__str__`, `__repr__` | `str()`, `print()`, `repr()` |
| 比较 | `__eq__`, `__lt__`, `__gt__`, `__le__` | `==`, `<`, `>`, `<=` |
| 算术 | `__add__`, `__sub__`, `__mul__` | `+`, `-`, `*` |
| 容器 | `__len__`, `__getitem__`, `__setitem__`, `__contains__` | `len()`, `[]`, `in` |
| 迭代 | `__iter__`, `__next__` | `for x in obj` |
| 可调用 | `__call__` | `obj()` |
| 上下文管理 | `__enter__`, `__exit__` | `with obj:` |
| 属性访问 | `__getattr__`, `__setattr__`, `__getattribute__` | `obj.attr` |

---

### 10. Python 中的设计模式

#### 10.1 单例模式

```python
# 方法 1：模块级变量（最简单，推荐）
# config.py
class _Config:
    debug = False
    db_url = ""

config = _Config()  # 模块只加载一次，天然单例

# 方法 2：元类
class SingletonMeta(type):
    _instance = None
    def __call__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__call__(*args, **kwargs)
        return cls._instance

class Database(metaclass=SingletonMeta):
    def __init__(self, url):
        self.url = url
```

#### 10.2 工厂模式

```python
from abc import ABC, abstractmethod
from enum import Enum

class NotificationType(Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"

class Notification(ABC):
    @abstractmethod
    def send(self, message: str) -> bool:
        pass

class EmailNotification(Notification):
    def send(self, message: str) -> bool:
        print(f"发送邮件: {message}")
        return True

class SmsNotification(Notification):
    def send(self, message: str) -> bool:
        print(f"发送短信: {message}")
        return True

class NotificationFactory:
    _registry = {
        NotificationType.EMAIL: EmailNotification,
        NotificationType.SMS: SmsNotification,
    }

    @classmethod
    def create(cls, type: NotificationType) -> Notification:
        handler = cls._registry.get(type)
        if not handler:
            raise ValueError(f"不支持的通知类型: {type}")
        return handler()

# 使用
notify = NotificationFactory.create(NotificationType.EMAIL)
notify.send("欢迎注册")
```

#### 10.3 策略模式

```python
from typing import Protocol

class PricingStrategy(Protocol):
    def calculate(self, price: float) -> float: ...

class RegularPricing:
    def calculate(self, price: float) -> float:
        return price

class VIPPricing:
    def calculate(self, price: float) -> float:
        return price * 0.8

class DiscountPricing:
    def __init__(self, discount: float):
        self.discount = discount

    def calculate(self, price: float) -> float:
        return price * self.discount

class Order:
    def __init__(self, price: float, strategy: PricingStrategy):
        self.price = price
        self.strategy = strategy

    def final_price(self) -> float:
        return self.strategy.calculate(self.price)

# 运行时切换策略
order = Order(100, RegularPricing())
print(order.final_price())    # 100

order.strategy = VIPPricing()
print(order.final_price())    # 80
```

---

### 11. Python 3.10+ 新特性面试要点

#### 11.1 match-case（结构化模式匹配）

```python
# Python 3.10+
def handle_command(command):
    match command.split():
        case ["quit"]:
            return "退出"
        case ["go", direction]:
            return f"前往 {direction}"
        case ["attack", target, *rest]:
            return f"攻击 {target}，参数: {rest}"
        case _:
            return "未知命令"
```

#### 11.2 类型联合语法

```python
# Python 3.10+ 用 X | Y 替代 Union[X, Y]
def process(value: str | int) -> str:
    ...

# Optional[X] → X | None
def find(id: int) -> dict | None:
    ...
```

#### 11.3 ExceptionGroup

```python
# Python 3.11+：批量处理异常
exceptions = []
for task in tasks:
    try:
        task.run()
    except Exception as e:
        exceptions.append(e)

if exceptions:
    raise ExceptionGroup("任务执行失败", exceptions)
```

#### 11.4 更好的错误提示

```python
# Python 3.11+ 错误提示更精确
# 旧：SyntaxError: invalid syntax
# 新：SyntaxError: '(' was never closed

# 异常链回溯更清晰，标注准确行号
```
