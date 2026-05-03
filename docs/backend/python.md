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
import threading, time

def cpu_task():
    total = 0
    for i in range(50_000_000):
        total += i

# 单线程 ~3s；多线程也因为 GIL 不加速
start = time.time()
cpu_task(); cpu_task()
print(f"单线程: {time.time() - start:.2f}s")
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

def cpu_task(n):
    return sum(range(n))

if __name__ == "__main__":
    with Pool(processes=4) as pool:
        results = pool.map(cpu_task, [50_000_000] * 4)
```

**注意：** 多进程的开销比多线程大（进程创建、内存复制、IPC 通信），进程数一般不超过 CPU 核心数。

---

## 二、类型提示（Type Hints）

### 1. 基本类型

| 标注 | 示例 | 说明 |
|------|------|------|
| `str`, `int`, `float`, `bool` | `age: int = 25` | 基本类型 |
| `List[T]` | `users: List[str] = ["张三"]` | 列表 |
| `Dict[K, V]` | `config: Dict[str, Any] = {}` | 字典 |
| `Tuple[T, ...]` | `point: Tuple[float, float] = (1.0, 2.0)` | 元组 |
| `Optional[T]` | `def find(id: int) -> Optional[dict]` | T 或 None |
| `Union[A, B]` | `def process(v: Union[str, int]) -> str` | 多种类型之一 |

> Python 3.10+ 推荐用 `str | int` 替代 `Union[str, int]`，`dict | None` 替代 `Optional[dict]`。

### 2. 函数签名

```python
def search_users(
    name: str,
    age: int | None = None,
    tags: list[str] = [],
    limit: int = 10,
) -> dict[str, object]:
    """搜索用户，返回 {total, items}"""
    ...
```

### 3. 高级类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `TypedDict` | 精确描述字典结构 | `class User(TypedDict): id: int; name: str` |
| `Protocol` | 结构化子类型（鸭子类型） | `class Closeable(Protocol): def close(self): ...` |
| `Literal` | 限定具体值 | `level: Literal["DEBUG", "INFO", "ERROR"]` |
| `TypeVar + Generic` | 泛型 | `class Repo(Generic[T]): def add(self, item: T): ...` |
| `Callable` | 可调用对象 | `handler: Callable[[int], str]` |

```python
from typing import Protocol, TypedDict, Literal, TypeVar, Generic

# TypedDict：字典结构约束
class UserInfo(TypedDict):
    id: int
    name: str
    email: str

# Protocol：只要对象有 close() 就可以传入
class Closeable(Protocol):
    def close(self) -> None: ...

# 泛型仓库
T = TypeVar("T")
class Repository(Generic[T]):
    def get_all(self) -> list[T]: ...
```

### 4. mypy 静态检查

```bash
pip install mypy
mypy src/

# mypy.ini
[mypy]
python_version = 3.11
strict = True
disallow_untyped_defs = True
```

---

## 三、异步编程（asyncio）

### 1. 基础概念

```python
import asyncio, time

async def say_hello(name: str, delay: float) -> str:
    await asyncio.sleep(delay)
    return f"Hello, {name}!"

async def main():
    start = time.time()
    results = await asyncio.gather(
        say_hello("张三", 2), say_hello("李四", 1), say_hello("王五", 3),
    )
    print(f"耗时: {time.time() - start:.1f}s")  # ~3s，不是 6s

asyncio.run(main())
```

### 2. HTTP 请求

```python
import asyncio, aiohttp

async def fetch(session: aiohttp.ClientSession, url: str) -> str:
    async with session.get(url) as resp:
        return await resp.text()

async def fetch_many(urls: list[str]) -> list[str]:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch(session, u) for u in urls]
        return await asyncio.gather(*tasks)

results = asyncio.run(fetch_many([f"https://httpbin.org/get?id={i}" for i in range(10)]))
```

### 3. 数据库操作（asyncpg 示例）

```python
import asyncpg

async def get_users():
    conn = await asyncpg.connect("postgresql://user:pass@localhost/db")
    try:
        return [dict(r) for r in await conn.fetch("SELECT id, name FROM users LIMIT 10")]
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
# 错误：time.sleep(5) 阻塞整个事件循环
# 正确：用 run_in_executor
await asyncio.get_event_loop().run_in_executor(None, time.sleep, 5)
```

**坑点 2：忘记 await**

```python
# 错误：result = fetch_data()  → 得到 coroutine 对象而非字符串
# 正确：result = await fetch_data()
```

---

## 四、装饰器（Decorator）

### 1. 基础装饰器

```python
import time, functools

def timer(func):
    """计算函数执行时间 -- 核心模式"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        print(f"{func.__name__} 耗时: {time.time() - start:.2f}s")
        return result
    return wrapper

@timer
def process_data(data: list) -> list:
    time.sleep(1)
    return [x * 2 for x in data]
```

### 2. 带参数的装饰器

```python
def retry(max_retries: int = 3, delay: float = 1.0):
    """重试装饰器 -- 三层嵌套模式：参数 → decorator → wrapper"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise
                    time.sleep(delay)
        return wrapper
    return decorator

@retry(max_retries=3, delay=2.0)
def call_api(url: str) -> dict: ...
```

### 3. 常用内置装饰器

```python
from functools import lru_cache

# lru_cache：缓存函数结果
@lru_cache(maxsize=128)
def fibonacci(n: int) -> int:
    return n if n < 2 else fibonacci(n - 1) + fibonacci(n - 2)

# property：方法变属性
class User:
    def __init__(self, first: str, last: str):
        self._first = first; self._last = last
    @property
    def full_name(self) -> str:
        return f"{self._first} {self._last}"

# staticmethod / classmethod
class DateUtils:
    @staticmethod
    def format_date(dt) -> str: return dt.strftime("%Y-%m-%d")
    @classmethod
    def today(cls) -> str: return cls.format_date(__import__("datetime").date.today())
```

---

## 五、上下文管理器（Context Manager）

### 1. 类方式

```python
class DatabaseConnection:
    def __init__(self, url: str): self.url = url
    def __enter__(self):
        self.conn = create_connection(self.url)
        return self.conn
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn.close()
        return False  # False = 异常继续传播

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
    print(f"{name}: {time.time() - start:.2f}s")

@contextmanager
def transaction(db_conn):
    """数据库事务管理"""
    try:
        yield db_conn
        db_conn.commit()
    except Exception:
        db_conn.rollback()
        raise
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

@dataclass
class User:
    name: str
    age: int
    email: str | None = None
    tags: list[str] = field(default_factory=list)

    def is_adult(self) -> bool:
        return self.age >= 18

user = User(name="张三", age=25)
print(user)  # User(name='张三', age=25, email=None, tags=[])
```

### 2. Pydantic（API 开发必备）

```python
from pydantic import BaseModel, Field

class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="用户名")
    email: str
    age: int = Field(..., ge=0, le=150)

class UserResponse(BaseModel):
    id: int
    name: str
    email: str

    model_config = {"from_attributes": True}  # 允许 ORM 转换

# 自动校验 + 类型转换
user = UserCreate(name="张三", email="test@example.com", age="25")
print(user.model_dump())  # age 自动从 str 转 int
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
pip install fastapi uvicorn sqlalchemy
pip install -r requirements.txt
pip freeze > requirements.txt
pip install --upgrade fastapi
```

### 3. Poetry（推荐）

```bash
pip install poetry
poetry init
poetry add fastapi uvicorn sqlalchemy
poetry add --group dev pytest mypy black
poetry install
poetry run python main.py
```

**pyproject.toml 示例：**

```toml
[tool.poetry]
name = "my-api"
version = "0.1.0"
authors = ["zhangsan <zhangsan@example.com>"]

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.104.0"
uvicorn = "^0.24.0"
sqlalchemy = "^2.0.0"
asyncpg = "^0.29.0"
pydantic = "^2.0.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.0"
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
        self.message = message; self.code = code; self.status = status
        super().__init__(message)

class NotFoundError(AppError):
    def __init__(self, resource: str, resource_id: str):
        super().__init__(f"{resource} 不存在: {resource_id}", code="NOT_FOUND", status=404)

class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(message, code="VALIDATION_ERROR", status=400)
```

### 2. 全局异常处理（FastAPI 示例）

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message})

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
import logging, sys

def setup_logger(name: str = "app") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(handler)
    return logger

logger = setup_logger()
logger.info("服务启动")
logger.error("数据库连接失败", exc_info=True)
```

### 2. 结构化日志（推荐）

```python
import json, logging

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log = {"timestamp": self.formatTime(record), "level": record.levelname,
               "logger": record.name, "message": record.getMessage()}
        if record.exc_info:
            log["exception"] = self.formatException(record.exc_info)
        return json.dumps(log, ensure_ascii=False)
```

---

## 十、配置管理

### 1. 环境变量 + Pydantic Settings

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "my-api"
    debug: bool = False
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "mydb"
    db_user: str = "postgres"
    db_password: str = ""
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = ""
    jwt_expire_minutes: int = 60

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    class Config:
        env_file = ".env"

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
from enum import Enum

# pathlib：优雅的路径操作
Path("data").mkdir(exist_ok=True)
content = (Path("data") / "config.json").read_text(encoding="utf-8")

# Counter：统计频率
word_counts = Counter(["python", "java", "python", "go", "python"])
print(word_counts.most_common(2))  # [('python', 3), ('java', 2)]

# defaultdict：避免 KeyError（list 为默认工厂）
grouped = defaultdict(list)
for name, dept in [("张三", "技术"), ("李四", "产品")]:
    grouped[dept].append(name)

# Enum：类型安全的枚举
class OrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    COMPLETED = "completed"
```

---

## 十二、测试基础

### 1. pytest 基本用法

```python
import pytest
from myapp.models import User

def test_create_user():
    user = User(name="张三", age=25)
    assert user.name == "张三" and user.is_adult()

@pytest.mark.parametrize("age, expected", [(0, False), (17, False), (18, True), (25, True)])
def test_is_adult(age, expected):
    assert User(name="测试", age=age).is_adult() == expected
```

### 2. pytest-asyncio：异步测试

```python
@pytest.mark.asyncio
async def test_fetch_user():
    user = await fetch_user(user_id=1)
    assert user is not None
```

### 3. Fixture

```python
@pytest.fixture
def sample_users():
    return [User(name="张三", age=25), User(name="李四", age=17)]

def test_filter_adults(sample_users):
    adults = [u for u in sample_users if u.is_adult()]
    assert len(adults) == 1
```

---

## 十三、代码风格与质量工具

### 1. Black（代码格式化）

```bash
pip install black
black src/
```

### 2. Ruff（快速 Linter）

```bash
pip install ruff
ruff check src/
ruff check --fix src/
```

### 3. mypy（类型检查）

```bash
mypy src/
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
pre-commit install
pre-commit run --all-files
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
ref = original               # 赋值：共享引用，改 ref 影响 original
shallow = original.copy()    # 浅拷贝：第一层独立，嵌套层仍共享
deep = copy.deepcopy(original)  # 深拷贝：完全独立

# 验证
shallow["scores"].append(88)
print(original["scores"])   # [90, 85, 92, 88] —— 嵌套层被污染

deep["scores"].append(99)
print(original["scores"])   # [90, 85, 92, 88] —— 不受 deep 影响
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
# 列表: new = old[:] / list(old) / old.copy()
# 字典: new = old.copy() / dict(old)
# 集合: new = old.copy() / set(old)
```

---

### 2. 可变对象与不可变对象

**不可变（immutable）：** int, float, str, tuple, frozenset, bytes -- 修改时创建新对象
**可变（mutable）：** list, dict, set -- 修改时原地修改

```python
# 不可变：id 变了说明是新对象
s = "hello"
print(id(s))
s += " world"
print(id(s))  # 不同！创建了新对象

# 可变：id 不变说明原地修改
lst = [1, 2, 3]
print(id(lst))
lst.append(4)
print(id(lst))  # 相同！原地修改
```

**面试高频陷阱 -- 函数默认参数：**

```python
# 错误：默认参数在函数定义时创建，所有调用共享同一对象
def append_item(item, cache=[]):
    cache.append(item)
    return cache
print(append_item(1))  # [1]
print(append_item(2))  # [1, 2] —— 坑！

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
t[0].append(3)       # 可以！tuple 存引用，引用没变
# t[0] = [10, 20]    # TypeError: 不能替换引用本身
```

---

### 3. == 与 is 的区别

```python
a = [1, 2, 3]
b = [1, 2, 3]
print(a == b)    # True  —— == 调用 __eq__，比较值
print(a is b)    # False —— is 比较内存地址

# 小整数池 [-5, 256]：同一值指向同一对象（CPython 优化）
print(256 is 256)    # True
print(257 is 257)    # False（超出池范围）
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

#### 4.2 functools.wraps 为什么必须加

```python
# 不加 wraps：my_function.__name__ → "wrapper"，__doc__ → None
# 加 @functools.wraps(func)：my_function.__name__ → "my_function"，__doc__ 保留
```

#### 4.3 类装饰器

```python
class Singleton:
    """单例装饰器"""
    def __init__(self, cls):
        self._cls = cls; self._instance = None
    def __call__(self, *args, **kwargs):
        if self._instance is None:
            self._instance = self._cls(*args, **kwargs)
        return self._instance

@Singleton
class Database:
    def __init__(self, url): self.url = url

db1 = Database("host1")
db2 = Database("host2")  # 忽略参数，返回 db1
print(db1 is db2)  # True
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
# 场景：中等并发 IO（几十到几百），代码简单
import threading
threads = [threading.Thread(target=download, args=(url,)) for url in urls]
for t in threads: t.start()
for t in threads: t.join()
```

**特点：** 代码简单，但受 GIL 限制不能真正并行 CPU 任务。线程间共享数据需要加锁。

#### 5.3 什么时候用多进程

```python
# 场景：CPU 密集型，充分利用多核
from concurrent.futures import ProcessPoolExecutor
with ProcessPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(cpu_heavy_task, data_list))
```

**特点：** 真正的多核并行。但进程创建开销大，进程间通信需要序列化（pickle），不能共享内存对象。

#### 5.4 什么时候用协程

```python
# 场景：极高并发 IO（数千到数万），如 API 网关、爬虫
async with aiohttp.ClientSession() as session:
    sem = asyncio.Semaphore(50)  # 并发控制
    async def limited_fetch(url):
        async with sem:
            async with session.get(url) as resp:
                return await resp.text()
    results = await asyncio.gather(*[limited_fetch(u) for u in urls])
```

**特点：** 单线程、极低开销、万级并发。但所有代码必须是 async/await 链，不能混用阻塞调用。

#### 5.5 混合方案：进程池 + 协程

```python
# 既有 CPU 密集计算，又有高并发 IO
loop = asyncio.get_event_loop()
with ProcessPoolExecutor() as pool:
    result = await loop.run_in_executor(pool, cpu_heavy_task, data)
await save_to_db(result)  # IO 操作用协程
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

#### 6.1 核心技巧速查

| 优化手段 | 效果 | 原理 | 示例 |
|----------|------|------|------|
| `str.join` 替代 `+` | 快 5-10 倍 | 一次分配内存 vs 每次创建新对象 | `"".join(items)` |
| 列表推导式替代 `for+append` | 快 20-30% | 底层 C 实现，少函数调用开销 | `[i*2 for i in range(n)]` |
| 字典/集合查找替代列表查找 | O(1) vs O(n) | 哈希表 vs 线性扫描 | `if key in dict` |
| 局部变量替代全局变量 | 快 20-30% | 局部变量 LOAD_FAST vs 全局 LOAD_GLOBAL | `sqrt = math.sqrt` |
| 生成器替代列表 | 省内存 | 惰性求值，不一次性加载 | `(x*2 for x in data)` |
| `lru_cache` | 避免重复计算 | 缓存纯函数结果 | `@lru_cache(maxsize=128)` |
| 多进程 | 利用多核 | 绕过 GIL | `ProcessPoolExecutor` |
| 协程 | 万级并发 | 单线程事件循环 | `asyncio` |
| C 扩展 / Cython | 10-100 倍 | 编译为 C | 性能瓶颈热点 |

#### 6.2 关键示例

```python
from functools import lru_cache
import math

# 字符串拼接：join >> +
result = "".join(items)  # 而非 result += item

# 局部变量缓存：在循环中避免重复全局查找
sqrt = math.sqrt  # 缓存到局部
result = [sqrt(n) for n in numbers]

# lru_cache：斐波那契从 O(2^n) → O(n)
@lru_cache(maxsize=None)
def fibonacci(n: int) -> int:
    return n if n < 2 else fibonacci(n - 1) + fibonacci(n - 2)

# 生成器：大数据集内存友好
def process_lines(filepath):
    with open(filepath) as f:
        for line in f:
            yield process(line)  # 内存恒定，而非全部加载
```

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
print(sys.getrefcount(a))  # 2（a + getrefcount 参数）
b = a; print(sys.getrefcount(a))  # 3（引用 +1）
del b; print(sys.getrefcount(a))  # 2（引用 -1）
```

#### 8.2 循环引用与垃圾回收

```python
# 引用计数无法处理循环引用 → 分代垃圾回收器兜底
class Node:
    def __init__(self): self.ref = None

a = Node(); b = Node()
a.ref = b; b.ref = a  # 循环引用
del a, b  # 引用计数不为 0，但分代 GC 会检测并回收
```

**分代回收：**
- 第 0 代：新创建的对象（频繁扫描）
- 第 1 代：存活过一次 GC 的对象
- 第 2 代：存活过两次 GC 的对象（很少扫描）

```python
import gc
gc.get_threshold()  # (700, 10, 10)
gc.collect()        # 手动触发
```

#### 8.3 内存泄漏常见原因

| 原因 | 示例 | 修复 |
|------|------|------|
| 全局缓存无限增长 | `_cache[key] = value` 只增不删 | LRU 缓存或定期清理 |
| 闭包持有大对象 | `handler` 捕获 `big_data(100MB)` 不释放 | 闭包只捕获需要的字段 |
| `__del__` 循环引用 | 有 `__del__` 的循环引用对象 GC 无法回收 | 避免 `__del__`，使用 `weakref` |
| 模块级缓存 | `module.cache[key] = value` 永不清除 | 显式清理或使用 TTL |

---

### 9. 常用魔术方法

```python
class Vector:
    """向量类 -- 演示核心魔术方法（完整分类见下方速查表）"""

    def __init__(self, x, y):
        self.x = x; self.y = y

    def __repr__(self):
        return f"Vector({self.x}, {self.y})"

    def __eq__(self, other):
        return self.x == other.x and self.y == other.y

    def __add__(self, other):
        return Vector(self.x + other.x, self.y + other.y)

    def __iter__(self):
        yield self.x; yield self.y

    def __bool__(self):
        return self.x != 0 or self.y != 0

v1 = Vector(3, 4); v2 = Vector(1, 2)
print(v1 + v2)           # Vector(4, 6)  __add__
print(v1 == Vector(3,4)) # True          __eq__
print(list(v1))          # [3, 4]        __iter__
print(bool(v1))          # True          __bool__
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

**推荐方式：模块级变量**（Python 模块只加载一次，天然单例）

```python
# config.py
class _Config:
    debug = False
    db_url = ""

config = _Config()  # 导入此模块的所有地方共享同一个实例
```

**备选：元类方式**

```python
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]
```

#### 10.2 工厂模式

```python
# 核心思路：注册表 + 类型枚举 → 按类型创建实例
from enum import Enum

class NotifyType(Enum):
    EMAIL = "email"; SMS = "sms"

class EmailSender:
    def send(self, msg): print(f"邮件: {msg}")

class SmsSender:
    def send(self, msg): print(f"短信: {msg}")

factory = {NotifyType.EMAIL: EmailSender, NotifyType.SMS: SmsSender}

sender = factory[NotifyType.EMAIL]()
sender.send("欢迎注册")
```

#### 10.3 策略模式

```python
# 核心思路：接口定义算法族，运行时注入不同策略
class VIPPricing:
    def calculate(self, price: float) -> float: return price * 0.8

class RegularPricing:
    def calculate(self, price: float) -> float: return price

class Order:
    def __init__(self, price: float, strategy):
        self.price = price; self.strategy = strategy
    def final_price(self) -> float:
        return self.strategy.calculate(self.price)

order = Order(100, VIPPricing())
print(order.final_price())  # 80
order.strategy = RegularPricing()
print(order.final_price())  # 100
```

---

### 11. Python 3.10+ 新特性面试要点

#### 11.1 match-case（结构化模式匹配）

```python
# Python 3.10+
def handle_command(command):
    match command.split():
        case ["quit"]:              return "退出"
        case ["go", direction]:     return f"前往 {direction}"
        case ["attack", target, *rest]: return f"攻击 {target}"
        case _:                     return "未知命令"
```

#### 11.2 类型联合语法

```python
# Python 3.10+ 用 X | Y 替代 Union[X, Y]，X | None 替代 Optional[X]
def process(value: str | int) -> str: ...
def find(id: int) -> dict | None: ...
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
