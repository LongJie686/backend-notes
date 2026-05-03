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
# 多线程 CPU 任务并不加速（GIL 限制），单线程 ~3s，多线程也 ~3s
import threading, time
def cpu_task():
    total = sum(range(50_000_000))
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

**注意：** 多进程开销比多线程大（进程创建、内存复制、IPC），进程数不超过 CPU 核心数。

---

## 二、类型提示（Type Hints）

### 1. 基本类型

| 标注 | 示例 | 说明 |
|------|------|------|
| `str`, `int`, `float`, `bool` | `age: int = 25` | 基本类型 |
| `list[T]` | `users: list[str] = ["张三"]` | 列表（3.9+ 内置） |
| `dict[K, V]` | `config: dict[str, object] = {}` | 字典 |
| `tuple[T, ...]` | `point: tuple[float, float] = (1.0, 2.0)` | 元组 |
| `T \| None` | `def find(id: int) -> dict \| None` | 可为 None |
| `A \| B` | `def process(v: str \| int) -> str` | 联合类型（3.10+） |

> Python 3.10+ 推荐 `str | int` 替代 `Union[str, int]`，`dict | None` 替代 `Optional[dict]`。

### 2. 函数签名

```python
def search_users(
    name: str,
    age: int | None = None,
    limit: int = 10,
) -> dict[str, object]:
    """搜索用户，返回 {total, items}"""
    ...
```

### 3. 高级类型

| 类型 | 用途 | 典型写法 |
|------|------|---------|
| `TypedDict` | 精确描述字典结构 | `class User(TypedDict): id: int; name: str` |
| `Protocol` | 结构化子类型（鸭子类型） | `class Closeable(Protocol): def close(self): ...` |
| `Literal` | 限定具体值 | `level: Literal["DEBUG", "INFO", "ERROR"]` |
| `TypeVar + Generic` | 泛型容器 | `class Repo(Generic[T]): def add(self, item: T): ...` |

```python
from typing import Protocol, TypedDict, Literal, TypeVar, Generic

class UserInfo(TypedDict):
    id: int; name: str; email: str          # TypedDict：字典结构约束

class Closeable(Protocol):
    def close(self) -> None: ...             # Protocol：鸭子类型

T = TypeVar("T")
class Repository(Generic[T]):
    def get_all(self) -> list[T]: ...        # 泛型仓库
```

### 4. mypy 静态检查

```bash
pip install mypy && mypy src/

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
async def fetch_many(urls: list[str]) -> list[str]:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch(session, u) for u in urls]
        return await asyncio.gather(*tasks)
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

- **坑点 1：同步阻塞代码** -- `time.sleep(5)` 阻塞整个事件循环，改用 `await loop.run_in_executor(None, time.sleep, 5)`
- **坑点 2：忘记 await** -- `result = fetch_data()` 得到 coroutine 对象而非返回值，必须 `result = await fetch_data()`

---

## 四、装饰器（Decorator）

### 1. 基础装饰器

```python
import time, functools

def timer(func):
    """核心模式：外层收 func → 内层 wrapper 替换 func"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        print(f"{func.__name__} 耗时: {time.time() - start:.2f}s")
        return result
    return wrapper
```

### 2. 带参数的装饰器

```python
def retry(max_retries: int = 3, delay: float = 1.0):
    """三层嵌套：参数 → decorator → wrapper"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try: return func(*args, **kwargs)
                except Exception:
                    if attempt == max_retries - 1: raise
                    time.sleep(delay)
        return wrapper
    return decorator
```

### 3. 常用内置装饰器

| 装饰器 | 作用 | 示例 |
|--------|------|------|
| `@lru_cache(maxsize=128)` | 缓存纯函数结果 | `@lru_cache` def fib(n) |
| `@property` | 方法变属性访问 | `obj.full_name` 而非 `obj.full_name()` |
| `@staticmethod` | 不需要 self 的工具方法 | `DateUtils.format_date(dt)` |
| `@classmethod` | 工厂方法，首参为 cls | `User.from_json(data)` |

---

## 五、上下文管理器（Context Manager）

### 1. 两种实现方式

```python
# 方式 1：类（__enter__ + __exit__）
class DatabaseConnection:
    def __init__(self, url): self.url = url
    def __enter__(self):
        self.conn = create_connection(self.url); return self.conn
    def __exit__(self, *args):
        self.conn.close(); return False  # False = 异常继续传播

# 方式 2：contextmanager 装饰器
from contextlib import contextmanager

@contextmanager
def transaction(db_conn):
    try:
        yield db_conn
        db_conn.commit()
    except Exception:
        db_conn.rollback(); raise
```

### 2. 常见用途

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
@dataclass
class User:
    name: str; age: int
    email: str | None = None
    tags: list[str] = field(default_factory=list)

user = User(name="张三", age=25)
```

### 2. Pydantic（API 开发必备）

```python
class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    email: str; age: int = Field(..., ge=0, le=150)

class UserResponse(BaseModel):
    id: int; name: str; email: str
    model_config = {"from_attributes": True}

user = UserCreate(name="张三", email="test@example.com", age="25")
print(user.model_dump())  # age 自动 str→int
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

### 1. 虚拟环境 + pip

```bash
python -m venv .venv
source .venv/bin/activate        # Linux/macOS
.venv\Scripts\activate           # Windows
pip install fastapi uvicorn sqlalchemy
pip install -r requirements.txt
pip freeze > requirements.txt
```

### 2. Poetry（推荐）

```bash
poetry init
poetry add fastapi uvicorn sqlalchemy asyncpg pydantic
poetry add --group dev pytest mypy black ruff
poetry run python main.py
```

**pyproject.toml：**

```toml
[tool.poetry]
name = "my-api"; version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.104.0"; uvicorn = "^0.24.0"
sqlalchemy = "^2.0.0"; pydantic = "^2.0.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.0"; mypy = "^1.6.0"; black = "^23.0.0"; ruff = "^0.1.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

---

## 八、错误处理最佳实践

### 1. 自定义异常体系

```python
class AppError(Exception):
    def __init__(self, message: str, code="INTERNAL_ERROR", status=500):
        self.message = message; self.code = code; self.status = status
        super().__init__(message)

class NotFoundError(AppError):
    def __init__(self, resource, rid):
        super().__init__(f"{resource} 不存在: {rid}", "NOT_FOUND", 404)

class ValidationError(AppError):
    def __init__(self, msg): super().__init__(msg, "VALIDATION_ERROR", 400)
```

### 2. 全局异常处理（FastAPI）

```python
@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message})
```

---

## 九、日志（Logging）

### 1. 基础配置

```python
import logging, sys
logger = logging.getLogger("app")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter(
    "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
))
logger.addHandler(handler)
```

### 2. 结构化日志（推荐）

使用 `python-json-logger` 或自定义 JSONFormatter，输出 `{"timestamp":"...", "level":"ERROR", "message":"连接失败"}` 格式的日志，方便 ELK / Loki 等日志系统采集。

---

## 十、配置管理

### 1. 环境变量 + Pydantic Settings

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    debug: bool = False
    db_host: str = "localhost"; db_port: int = 5432
    db_user: str = "postgres"; db_password: str = ""
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = ""

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}"

    class Config:
        env_file = ".env"

settings = Settings()
```

**.env 文件：**

```env
DEBUG=False
DB_HOST=localhost
DB_PORT=5432
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

Path("data").mkdir(exist_ok=True)
content = (Path("data") / "config.json").read_text(encoding="utf-8")

word_counts = Counter(["python", "java", "python", "go", "python"])
print(word_counts.most_common(2))  # [('python', 3), ('java', 2)]

grouped = defaultdict(list)
for name, dept in [("张三", "技术"), ("李四", "产品")]:
    grouped[dept].append(name)
```

---

## 十二、测试基础

### 1. pytest 基本用法

```python
import pytest

def test_create_user():
    user = User(name="张三", age=25)
    assert user.name == "张三" and user.is_adult()

@pytest.mark.parametrize("age, expected", [(18, True), (15, False)])
def test_is_adult(age, expected):
    assert User("测试", age).is_adult() == expected
```

### 2. pytest-asyncio + Fixture

```python
@pytest.mark.asyncio
async def test_fetch_user():
    user = await fetch_user(user_id=1)
    assert user is not None

@pytest.fixture
def sample_users():
    return [User("张三", 25), User("李四", 17)]

def test_filter_adults(sample_users):
    adults = [u for u in sample_users if u.is_adult()]
    assert len(adults) == 1
```

---

## 十三、代码风格与质量工具

```bash
pip install black ruff mypy pre-commit

black src/              # 代码格式化
ruff check src/          # 快速 Lint
ruff check --fix src/    # 自动修复
mypy src/                # 类型检查
```

**.pre-commit-config.yaml：**

```yaml
repos:
  - repo: https://github.com/psf/black
    rev: 23.12.1
    hooks: [{id: black}]
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.9
    hooks: [{id: ruff}]
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.8.0
    hooks: [{id: mypy}]
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

**选择建议：** 新项目 API 服务用 **FastAPI**，内容管理用 **Django**，小型脚本用 **Flask**。

---

## 十五、高频面试题

### 1. 浅拷贝 vs 深拷贝

**核心区别：** 浅拷贝复制第一层引用，深拷贝递归复制所有层级。

```python
import copy
original = {"name": "张三", "scores": [90, 85, 92], "info": {"age": 25}}

shallow = original.copy()           # 浅拷贝：嵌套层仍共享
deep = copy.deepcopy(original)      # 深拷贝：完全独立
shallow["scores"].append(88)
print(original["scores"])  # [90, 85, 92, 88] —— 被污染
```

| 操作 | 第一层 | 嵌套层 | 适用场景 |
|------|--------|--------|---------|
| `=` 赋值 | 共享引用 | 共享引用 | 不需要副本 |
| `copy()` 浅拷贝 | 独立副本 | 共享引用 | 嵌套结构只读、单层结构 |
| `deepcopy()` 深拷贝 | 独立副本 | 独立副本 | 需要完全独立的副本 |

**性能：** `deepcopy` 比 `copy` 慢得多。常见浅拷贝：`list(old)`、`dict(old)`、`old[:]`、`old.copy()`。

---

### 2. 可变对象与不可变对象

**不可变：** int, float, str, tuple, frozenset, bytes -- 修改创建新对象
**可变：** list, dict, set -- 原地修改

```python
s = "hello"; print(id(s))
s += " world"; print(id(s))  # 不同！新对象
lst = [1, 2]; print(id(lst))
lst.append(3); print(id(lst))  # 相同！原地修改
```

**高频陷阱 -- 函数默认参数：**

```python
# 错误：默认参数在定义时创建，所有调用共享同一对象
def add(item, cache=[]): cache.append(item); return cache
print(add(1))  # [1]
print(add(2))  # [1, 2] —— 坑！

# 正确：用 None
def add(item, cache=None):
    if cache is None: cache = []
    cache.append(item); return cache
```

**元组陷阱：** `t[0].append(3)` 可以修改（tuple 存引用），但 `t[0] = [...]` 报错（不能替换引用本身）。

---

### 3. == 与 is 的区别

```python
a = [1, 2, 3]; b = [1, 2, 3]
print(a == b)    # True  —— == 调用 __eq__，比较值
print(a is b)    # False —— is 比较内存地址

# 小整数池 [-5, 256]：256 is 256 → True，257 is 257 → False（CPython 优化）
```

**要点：** `==` 比较值，`is` 比较 `id()`。判 None 用 `is`，比较值用 `==`。小整数池和字符串驻留是实现细节，不应依赖。

---

### 4. 装饰器深入

#### 4.1 本质

`@decorator` 等价于 `func = decorator(func)`，是语法糖。

#### 4.2 functools.wraps 为什么必须加

不加 `@functools.wraps(func)`：被装饰函数的 `__name__` 变成 `"wrapper"`，`__doc__` 丢失。加上后元信息保留。

#### 4.3 类装饰器

```python
class Singleton:
    def __init__(self, cls): self._cls = cls; self._instance = None
    def __call__(self, *args, **kwargs):
        if self._instance is None:
            self._instance = self._cls(*args, **kwargs)
        return self._instance
```

#### 4.4 常见装饰器使用场景

| 装饰器 | 场景 |
|--------|------|
| `@lru_cache` | 缓存计算结果（递归、DB 查询） |
| `@property` | 方法当属性用 |
| `@staticmethod` | 不需要 self 的工具方法 |
| `@classmethod` | 工厂方法 |
| `@retry` | 接口调用重试 |
| `@timer` | 性能计时 |
| `@require_auth` | 权限校验 |

---

### 5. 线程、进程、协程的选用

#### 5.1 三者对比

| 维度 | 多线程 | 多进程 | 协程 |
|------|--------|--------|------|
| 并行方式 | 并发（受 GIL 限制） | 真正并行 | 并发（单线程） |
| 切换开销 | 中（OS 调度） | 大（进程创建+内存复制） | 极小（用户态切换） |
| 内存 | 共享地址空间 | 各自独立 | 共享（单线程） |
| GIL 影响 | 受限 | 不受 | 不受 |
| 数据安全 | 需要锁（Lock） | 天然隔离（IPC） | 天然安全（无并发写） |
| 适用场景 | IO 密集（适中并发） | CPU 密集 | IO 密集（极高并发） |

#### 5.2 各场景代码模式

```python
# 多线程：IO 密集，几十到几百并发
for url in urls:
    threading.Thread(target=download, args=(url,)).start()

# 多进程：CPU 密集，充分利用多核
with ProcessPoolExecutor(max_workers=4) as ex:
    results = list(ex.map(cpu_task, data_list))

# 协程：IO 密集，数千到数万并发（Semaphore 控制并发）
results = await asyncio.gather(*[fetch(s, u) for u in urls])

# 混合：CPU 密集丢进程池，IO 操作用协程
result = await loop.run_in_executor(pool, cpu_task, data)
```

#### 5.3 决策树

```
任务类型？
├── CPU 密集型 → 多进程（multiprocessing / ProcessPoolExecutor）
├── IO 密集型
│   ├── 并发量 < 100    → 多线程（threading / ThreadPoolExecutor）
│   └── 并发量 >= 1000  → 协程（asyncio）
└── 混合型（CPU + IO）  → 进程池 + 协程
```

---

### 6. Python 性能优化

#### 6.1 核心技巧速查

| 优化手段 | 效果 | 原理 | 示例 |
|----------|------|------|------|
| `str.join` 替代 `+` | 快 5-10 倍 | 一次分配内存 | `"".join(items)` |
| 列表推导式替代 `for+append` | 快 20-30% | 底层 C 实现 | `[i*2 for i in range(n)]` |
| 字典/集合查找替代列表查找 | O(1) vs O(n) | 哈希表 | `if key in dict` |
| 局部变量替代全局变量 | 快 20-30% | LOAD_FAST vs LOAD_GLOBAL | `sqrt = math.sqrt` |
| 生成器替代列表 | 省内存 | 惰性求值 | `(x*2 for x in data)` |
| `lru_cache` | 避免重复计算 | 缓存纯函数结果 | `@lru_cache(maxsize=128)` |
| 多进程 | 利用多核 | 绕过 GIL | `ProcessPoolExecutor` |
| 协程 | 万级并发 | 单线程事件循环 | `asyncio` |
| C 扩展 / Cython | 10-100 倍 | 编译为 C | 性能瓶颈热点 |

#### 6.2 关键示例

```python
# join >> + ；局部变量快过全局；lru_cache：O(2^n) → O(n)；生成器：内存恒定
sqrt = math.sqrt
result = "".join(str(sqrt(n)) for n in numbers)

@lru_cache(maxsize=None)
def fib(n): return n if n < 2 else fib(n-1) + fib(n-2)

for item in (process(line) for line in open("huge.csv")):
    save_to_db(item)  # 内存恒定
```

---

### 7. GIL 常见追问

**Q：Python 3.13 的 no-GIL？**
Python 3.13 引入实验性 free-threaded 模式（PEP 703），通过 `--disable-gil` 编译或 `PYTHON_GIL=0` 启用。目前实验阶段，第三方库尚未广泛适配。

**Q：GIL 什么时候释放？**
IO 操作（网络请求、文件读写）、`time.sleep()` 时自动释放；C 扩展代码可手动释放；每执行一定字节码后检查是否需要切换线程。

**Q：多线程在 Python 中完全没用吗？**
不是。IO 密集型场景多线程依然有效（GIL 在 IO 等待时释放）。只有 CPU 密集型的多线程才受 GIL 限制。

---

### 8. Python 内存管理

#### 8.1 引用计数（主要机制）

```python
import sys
a = [1, 2, 3]
print(sys.getrefcount(a))  # 2（a + 参数）
b = a; del b              # 引用计数 +1 后 -1
```

#### 8.2 循环引用与分代 GC

```python
a = Node(); b = Node()
a.ref = b; b.ref = a  # 循环引用
del a, b  # 引用计数不为 0，但分代 GC 回收
# gc.get_threshold() → (700, 10, 10)；gc.collect() → 手动触发
```

**分代回收：** 第 0 代（新对象，频繁扫描）→ 第 1 代（存活一次 GC）→ 第 2 代（存活两次 GC，很少扫描）

#### 8.3 内存泄漏常见原因

| 原因 | 示例 | 修复 |
|------|------|------|
| 全局缓存无限增长 | `_cache[key] = value` | LRU 缓存或定期清理 |
| 闭包持有大对象 | handler 捕获 100MB data | 只捕获需要的字段 |
| `__del__` 循环引用 | 有 `__del__` 的循环引用 GC 无法回收 | 避免 `__del__`，用 `weakref` |
| 模块级缓存 | `module.cache[key] = value` | 显式清理或 TTL |

---

### 9. 常用魔术方法

```python
class Vector:
    def __init__(self, x, y): self.x = x; self.y = y
    def __repr__(self):         return f"Vector({self.x}, {self.y})"
    def __eq__(self, other):    return self.x == other.x and self.y == other.y
    def __add__(self, other):   return Vector(self.x + other.x, self.y + other.y)
    def __iter__(self):         yield self.x; yield self.y
    def __bool__(self):         return self.x != 0 or self.y != 0

v1 = Vector(3, 4); v2 = Vector(1, 2)
print(v1 + v2, list(v1), bool(v1))  # Vector(4,6)  [3,4]  True
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

**推荐：模块级变量**（Python 模块只加载一次，天然单例）

```python
# config.py
class _Config:
    debug = False; db_url = ""
config = _Config()  # 导入此模块的所有地方共享同一实例
```

**备选：元类**

```python
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *a, **kw):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*a, **kw)
        return cls._instances[cls]
```

#### 10.2 工厂模式

```python
# 核心：注册表 + 类型枚举 → 按类型创建实例
factory = {"email": EmailSender, "sms": SmsSender}
sender = factory["email"]()
sender.send("欢迎注册")
```

#### 10.3 策略模式

```python
# 核心：接口定义算法族，运行时注入不同策略
class VIPPricing:
    calc = lambda self, p: p * 0.8
class RegularPricing:
    calc = lambda self, p: p

class Order:
    def __init__(self, price, strategy): self.price = price; self.strategy = strategy
    def final_price(self): return self.strategy.calc(self.price)

order = Order(100, VIPPricing())
order.strategy = RegularPricing()  # 运行时切换策略
```

---

### 11. Python 3.10+ 新特性面试要点

#### 11.1 match-case（结构化模式匹配，3.10+）

```python
def handle_command(command):
    match command.split():
        case ["quit"]:              return "退出"
        case ["go", direction]:     return f"前往 {direction}"
        case ["attack", t, *rest]:  return f"攻击 {t}"
        case _:                     return "未知命令"
```

#### 11.2 类型联合语法（3.10+）

`str | int` 替代 `Union[str, int]`，`dict | None` 替代 `Optional[dict]`。

#### 11.3 ExceptionGroup（3.11+）

```python
exceptions = [e for task in tasks if (e := try_run(task))]
if exceptions:
    raise ExceptionGroup("任务执行失败", exceptions)
```

#### 11.4 更好的错误提示（3.11+）

旧：`SyntaxError: invalid syntax`，新：`SyntaxError: '(' was never closed`，异常链回溯标注精确行号。
