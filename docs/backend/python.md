# Python 后端开发

## 核心概念

### GIL 全局解释器锁

- CPython 的全局解释器锁，同一时刻只有一个线程执行 Python 字节码
- CPU 密集型任务：用 `multiprocessing` 绕过 GIL
- IO 密集型任务：用 `asyncio` 或多线程

### 类型提示

```python
from typing import Optional, List

def search_users(
    name: str,
    age: Optional[int] = None,
    tags: List[str] = []
) -> dict:
    ...
```

### 异步编程

```python
import asyncio
import aiohttp

async def fetch(url: str) -> str:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            return await resp.text()
```

## 常用模式

### 上下文管理器

```python
from contextlib import contextmanager

@contextmanager
def timer(name: str):
    import time
    start = time.time()
    yield
    print(f"{name}: {time.time() - start:.2f}s")
```

### 数据类

```python
from dataclasses import dataclass, field

@dataclass
class User:
    name: str
    age: int
    tags: list = field(default_factory=list)
```
