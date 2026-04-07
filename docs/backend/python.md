# Python

## Core Concepts

### GIL (Global Interpreter Lock)

- CPython 的全局解释器锁，同一时刻只有一个线程执行 Python 字节码
- CPU 密集型任务：用 `multiprocessing` 绕过 GIL
- IO 密集型任务：用 `asyncio` 或多线程

### Type Hints

```python
from typing import Optional, List

def search_users(
    name: str,
    age: Optional[int] = None,
    tags: List[str] = []
) -> dict:
    ...
```

### Asyncio

```python
import asyncio
import aiohttp

async def fetch(url: str) -> str:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            return await resp.text()
```

## Common Patterns

### Context Manager

```python
from contextlib import contextmanager

@contextmanager
def timer(name: str):
    import time
    start = time.time()
    yield
    print(f"{name}: {time.time() - start:.2f}s")
```

### Dataclass

```python
from dataclasses import dataclass, field

@dataclass
class User:
    name: str
    age: int
    tags: list = field(default_factory=list)
```
