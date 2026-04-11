# 第 3 讲（Python 版）：高性能架构模式（上）——单机高性能

---

很好，既然你的主语言是 Python，我会把所有代码示例、框架选型、实战场景都切换到 Python 生态。

同时会重点讲清楚：
- Python 的 GIL 对高性能有什么影响
- Python 生态里怎么做高性能
- asyncio 和 Reactor 模型的关系
- 为什么理解底层 I/O 模型对 Python 开发者同样重要

---

## 一、Python 开发者为什么要懂 I/O 模型？

你可能会想：

> "我用 Python，不写 C/C++，为什么要懂 epoll、Reactor 这些底层的东西？"

原因有三个：

### 原因 1：你用的框架底层就是这些

| Python 框架 | 底层模型 |
|------------|---------|
| Django（WSGI + Gunicorn） | 多进程/多线程 + 阻塞 I/O |
| Flask（WSGI + Gunicorn） | 多进程/多线程 + 阻塞 I/O |
| FastAPI（ASGI + Uvicorn） | asyncio + 事件循环（Reactor） |
| Tornado | asyncio + 事件循环（Reactor） |
| aiohttp | asyncio + 事件循环（Reactor） |
| Celery | 多进程 + 消息队列 |

你不理解底层模型，就不知道：
- 为什么 Django 扛不住高并发
- 为什么 FastAPI 比 Flask 性能高
- 为什么 Gunicorn 要配置 worker 数量
- 为什么异步框架能用更少的资源扛更多请求

---

### 原因 2：面试必考

大厂面试 Python 后端，必问：
- Python GIL 是什么？对性能有什么影响？
- 多进程 vs 多线程 vs 协程，什么时候用哪个？
- asyncio 的底层原理是什么？
- 为什么 FastAPI 性能比 Django 高？
- 如何设计高性能 Python 后端服务？

这些问题的本质，都是 I/O 模型和并发模型。

---

### 原因 3：架构设计需要

当你做架构设计时，需要回答：
- 这个服务用同步还是异步？
- 用多进程还是协程？
- 部署几个 worker？
- 预计能扛多少 QPS？

不懂底层，这些问题你只能凭感觉猜。

---

## 二、Python 的并发困境：GIL

在讲 I/O 模型之前，必须先理解 Python 的 GIL，因为它直接决定了 Python 的并发策略。

### 1. 什么是 GIL？

> **GIL（Global Interpreter Lock，全局解释器锁）**
> 
> CPython 解释器中的一把全局锁，确保同一时刻只有一个线程执行 Python 字节码。

```
                  ┌─────────────────────────────────────┐
                  │         CPython 解释器               │
                  │                                     │
                  │  ┌───────────────────────────────┐  │
                  │  │          GIL（全局锁）          │  │
                  │  └───────────────────────────────┘  │
                  │         │                           │
                  │    同一时刻只有一个线程能执行        │
                  │                                     │
线程 1 ──────▶   │  ██████░░░░░░██████░░░░░░           │
线程 2 ──────▶   │  ░░░░░░██████░░░░░░██████           │
线程 3 ──────▶   │  ░░░░░░░░░░░░░░░░░░░░░░░░           │（等待）
                  │                                     │
                  │  █ = 执行   ░ = 等待GIL             │
                  └─────────────────────────────────────┘
```

### 2. GIL 的影响

```python
# CPU 密集型任务：多线程没用！
import threading
import time

def cpu_heavy():
    total = 0
    for i in range(100_000_000):
        total += i

# 单线程
start = time.time()
cpu_heavy()
print(f"单线程: {time.time() - start:.2f}s")  # 约 5 秒

# 多线程（2个线程）
start = time.time()
t1 = threading.Thread(target=cpu_heavy)
t2 = threading.Thread(target=cpu_heavy)
t1.start()
t2.start()
t1.join()
t2.join()
print(f"多线程: {time.time() - start:.2f}s")  # 约 5~6 秒！甚至更慢！
```

**结果：多线程反而可能更慢！**

因为 GIL 导致两个线程轮流执行，加上切换开销，比单线程还慢。

---

### 3. GIL 不影响什么？

**GIL 在 I/O 等待时会释放！**

```python
# I/O 密集型任务：多线程有用！
import threading
import time
import requests

def fetch_url(url):
    response = requests.get(url)
    return response.status_code

urls = ["https://httpbin.org/delay/1"] * 5

# 单线程：串行请求
start = time.time()
for url in urls:
    fetch_url(url)
print(f"单线程: {time.time() - start:.2f}s")  # 约 5 秒

# 多线程：并行请求
start = time.time()
threads = [threading.Thread(target=fetch_url, args=(url,)) for url in urls]
for t in threads:
    t.start()
for t in threads:
    t.join()
print(f"多线程: {time.time() - start:.2f}s")  # 约 1 秒！
```

**因为在等 I/O（网络请求）时，GIL 被释放了，其他线程可以执行。**

---

### 4. Python 并发策略总结

| 场景 | GIL 影响 | 推荐方案 |
|------|---------|---------|
| **CPU 密集型** | 严重影响 | **多进程**（multiprocessing） |
| **I/O 密集型** | 不影响（I/O 时释放 GIL） | **多线程** 或 **协程**（asyncio） |
| **高并发网络服务** | 不影响 | **协程**（asyncio）最高效 |
| **混合型** | 部分影响 | **多进程 + 协程** |

---

## 三、Python 的三种并发模型

### 1. 多进程（对应 PPC 模型）

```python
import multiprocessing
import os

def worker(name):
    print(f"Worker {name}, PID: {os.getpid()}")
    # 做一些 CPU 密集的计算
    total = sum(range(10_000_000))
    print(f"Worker {name} done, result: {total}")

if __name__ == "__main__":
    processes = []
    for i in range(4):
        p = multiprocessing.Process(target=worker, args=(i,))
        processes.append(p)
        p.start()
    
    for p in processes:
        p.join()
    
    print("All workers done")
```

**进程池（更推荐）：**

```python
from concurrent.futures import ProcessPoolExecutor
import os

def cpu_heavy_task(n):
    """CPU 密集型任务"""
    total = sum(i * i for i in range(n))
    return total

if __name__ == "__main__":
    # 进程池，进程数 = CPU 核数
    with ProcessPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(cpu_heavy_task, 10_000_000) for _ in range(4)]
        results = [f.result() for f in futures]
    
    print(f"Results: {results}")
```

**特点：**
- 绕过 GIL，真正的并行
- 每个进程有独立的内存空间
- 进程创建和通信开销大
- 适合 CPU 密集型任务

---

### 2. 多线程（对应 TPC 模型）

```python
import threading
import time
import requests

def fetch_data(url):
    """I/O 密集型任务"""
    response = requests.get(url)
    return len(response.content)

def main():
    urls = [
        "https://httpbin.org/get",
        "https://httpbin.org/ip",
        "https://httpbin.org/headers",
        "https://httpbin.org/user-agent",
    ] * 5  # 20 个请求

    # 多线程执行
    start = time.time()
    threads = []
    for url in urls:
        t = threading.Thread(target=fetch_data, args=(url,))
        threads.append(t)
        t.start()
    
    for t in threads:
        t.join()
    
    print(f"多线程完成: {time.time() - start:.2f}s")

main()
```

**线程池（更推荐）：**

```python
from concurrent.futures import ThreadPoolExecutor
import requests
import time

def fetch_data(url):
    response = requests.get(url)
    return len(response.content)

urls = ["https://httpbin.org/get"] * 20

start = time.time()
with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(fetch_data, urls))
print(f"线程池完成: {time.time() - start:.2f}s")
```

**特点：**
- I/O 等待时释放 GIL，可以并发
- 线程切换比进程轻
- 但受 GIL 限制，CPU 密集不能真正并行
- 适合 I/O 密集型任务

---

### 3. 协程/异步（对应 Reactor 模型）★★★

**这是 Python 高性能的核心。**

```python
import asyncio
import aiohttp
import time

async def fetch_data(session, url):
    """异步 I/O 密集型任务"""
    async with session.get(url) as response:
        data = await response.read()
        return len(data)

async def main():
    urls = ["https://httpbin.org/get"] * 20
    
    async with aiohttp.ClientSession() as session:
        # 同时发起所有请求
        tasks = [fetch_data(session, url) for url in urls]
        results = await asyncio.gather(*tasks)
    
    print(f"Results: {results}")

start = time.time()
asyncio.run(main())
print(f"异步完成: {time.time() - start:.2f}s")
```

**特点：**
- 单线程，但可以处理大量并发 I/O
- 没有线程切换开销
- 没有锁的问题
- 内存占用极小
- 适合高并发网络服务

---

### 4. 三种模型性能对比

我们做一个直观对比：

```python
"""
三种并发模型性能对比：20 个 HTTP 请求
"""
import time
import requests
import threading
import asyncio
import aiohttp
from concurrent.futures import ThreadPoolExecutor

URL = "https://httpbin.org/delay/1"  # 每个请求需要 1 秒
COUNT = 20

# ========== 同步（串行） ==========
def sync_requests():
    start = time.time()
    for _ in range(COUNT):
        requests.get(URL)
    print(f"同步串行: {time.time() - start:.2f}s")  # 约 20 秒

# ========== 多线程 ==========
def threaded_requests():
    start = time.time()
    with ThreadPoolExecutor(max_workers=20) as executor:
        list(executor.map(lambda _: requests.get(URL), range(COUNT)))
    print(f"多线程: {time.time() - start:.2f}s")  # 约 1 秒

# ========== 异步协程 ==========
async def async_requests():
    start = time.time()
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(URL) for _ in range(COUNT)]
        await asyncio.gather(*tasks)
    print(f"异步协程: {time.time() - start:.2f}s")  # 约 1 秒（但内存更少）

# 执行对比
sync_requests()         # ~20 秒
threaded_requests()     # ~1 秒
asyncio.run(async_requests())  # ~1 秒（但内存更少）
```

**结果对比：**

| 模型 | 20 个请求耗时 | 线程/协程数 | 内存占用 |
|------|-------------|------------|---------|
| 同步串行 | ~20 秒 | 1 | 最少 |
| 多线程（20线程）| ~1 秒 | 20 | 中等 |
| 异步协程 | ~1 秒 | 1（单线程）| 最少 |

**如果是 10000 个请求呢？**

| 模型 | 10000 个请求 | 资源需求 |
|------|-------------|---------|
| 多线程 | 需要 10000 线程，内存爆炸 | 几 GB 内存 |
| 异步协程 | 1 个线程搞定 | 几十 MB 内存 |

**这就是协程在高并发场景下碾压多线程的原因。**

---

## 四、Python asyncio 深入理解

asyncio 是 Python 的异步编程框架，底层就是 **Reactor 模型**。

### 1. asyncio 的核心架构

```
┌────────────────────────────────────────────────────────┐
│                    asyncio                             │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │              Event Loop（事件循环）                │ │
│  │                                                  │ │
│  │   底层：epoll（Linux）/ kqueue（Mac）             │ │
│  │                                                  │ │
│  │   ┌──────────────────────────────────────────┐   │ │
│  │   │    注册的事件                             │   │ │
│  │   │    socket 可读？→ 调用回调               │   │ │
│  │   │    socket 可写？→ 调用回调               │   │ │
│  │   │    定时器到期？→ 调用回调                │   │ │
│  │   └──────────────────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ 协程 1   │ │ 协程 2   │ │ 协程 N   │              │
│  │ coroutine│ │ coroutine│ │ coroutine│              │
│  └──────────┘ └──────────┘ └──────────┘              │
└────────────────────────────────────────────────────────┘
```

**asyncio 就是 Python 版的 Reactor：**

| Reactor 概念 | asyncio 对应 |
|-------------|-------------|
| Reactor（事件分发器） | Event Loop（事件循环） |
| I/O 多路复用（epoll） | Selector（底层用 epoll/kqueue） |
| Handler（事件处理器） | 协程（coroutine） |
| 注册事件 | `add_reader()` / `create_task()` |

---

### 2. 协程的本质

```python
import asyncio

async def my_coroutine():
    print("开始")
    await asyncio.sleep(1)  # 这里让出控制权，事件循环可以去干别的
    print("1秒后")
    await asyncio.sleep(1)  # 再次让出
    print("又1秒后")

asyncio.run(my_coroutine())
```

**关键理解：**

> `await` 不是"阻塞等待"，而是"让出控制权"。

```
协程 A: 执行 → await（让出）→ ............ → 恢复执行
协程 B: ........ → 执行 → await（让出）→ ... → 恢复执行
协程 C: ................ → 执行 → await → ......

事件循环：不断在协程之间调度
```

**与线程的区别：**

| 维度 | 线程 | 协程 |
|------|------|------|
| 调度者 | 操作系统 | 程序自身（事件循环） |
| 切换开销 | 大（上下文切换） | 极小（只保存少量状态） |
| 切换时机 | 操作系统决定（抢占式） | 程序员决定（协作式，在 await 处） |
| 内存占用 | 大（每个线程 512KB~1MB） | 小（每个协程几 KB） |
| 数量上限 | 千级 | 万级甚至十万级 |
| 并发安全 | 需要锁 | 天然安全（单线程） |

---

### 3. asyncio 实战：并发处理多个任务

```python
import asyncio
import time

async def process_request(request_id: int):
    """模拟处理一个请求"""
    print(f"Request {request_id}: 开始处理")
    
    # 模拟查数据库（I/O 操作）
    await asyncio.sleep(0.1)  # 模拟 100ms 的数据库查询
    
    # 模拟调用外部 API
    await asyncio.sleep(0.05)  # 模拟 50ms 的 API 调用
    
    print(f"Request {request_id}: 处理完成")
    return f"Result-{request_id}"

async def main():
    start = time.time()
    
    # 同时处理 100 个请求
    tasks = [process_request(i) for i in range(100)]
    results = await asyncio.gather(*tasks)
    
    elapsed = time.time() - start
    print(f"\n处理 100 个请求，耗时: {elapsed:.2f}s")
    # 如果串行：100 * 0.15 = 15 秒
    # 实际异步：约 0.15 秒！

asyncio.run(main())
```

**100 个请求，每个需要 150ms I/O，但总耗时只有 ~150ms！**

---

### 4. asyncio 的常见模式

#### 模式 1：并发执行多个任务

```python
import asyncio

async def task_a():
    await asyncio.sleep(1)
    return "A done"

async def task_b():
    await asyncio.sleep(2)
    return "B done"

async def task_c():
    await asyncio.sleep(1.5)
    return "C done"

async def main():
    # 并发执行，总耗时 = 最长的那个 = 2秒
    results = await asyncio.gather(task_a(), task_b(), task_c())
    print(results)  # ['A done', 'B done', 'C done']

asyncio.run(main())
```

---

#### 模式 2：生产者-消费者

```python
import asyncio
import random

async def producer(queue: asyncio.Queue, name: str):
    """生产者：生成数据放入队列"""
    for i in range(5):
        item = f"{name}-item-{i}"
        await queue.put(item)
        print(f"  [生产] {item}")
        await asyncio.sleep(random.uniform(0.1, 0.5))
    
    await queue.put(None)  # 结束信号

async def consumer(queue: asyncio.Queue, name: str):
    """消费者：从队列取数据处理"""
    while True:
        item = await queue.get()
        if item is None:
            break
        print(f"  [消费] {name} 处理 {item}")
        await asyncio.sleep(random.uniform(0.2, 0.8))  # 模拟处理
        queue.task_done()

async def main():
    queue = asyncio.Queue(maxsize=10)
    
    # 1 个生产者，3 个消费者
    producer_task = asyncio.create_task(producer(queue, "P1"))
    consumer_tasks = [
        asyncio.create_task(consumer(queue, f"C{i}"))
        for i in range(3)
    ]
    
    await producer_task
    
    # 等生产者结束后，给每个消费者发结束信号
    for _ in consumer_tasks:
        await queue.put(None)
    
    await asyncio.gather(*consumer_tasks)
    print("全部完成")

asyncio.run(main())
```

---

#### 模式 3：限制并发数

```python
import asyncio
import aiohttp

async def fetch_url(session, url, semaphore):
    """带并发限制的请求"""
    async with semaphore:  # 限制并发数
        async with session.get(url) as response:
            data = await response.read()
            return len(data)

async def main():
    urls = [f"https://httpbin.org/get?id={i}" for i in range(100)]
    
    # 限制同时最多 10 个并发请求
    semaphore = asyncio.Semaphore(10)
    
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_url(session, url, semaphore) for url in urls]
        results = await asyncio.gather(*tasks)
    
    print(f"完成 {len(results)} 个请求")

asyncio.run(main())
```

**为什么要限制并发？**
- 不限制的话，100 万个协程可能同时打爆目标服务
- 数据库连接池有上限
- 网络带宽有限

---

### 5. asyncio 的陷阱

#### 陷阱 1：在 async 函数里调用同步阻塞代码

```python
import asyncio
import time

async def bad_example():
    """错误：在异步函数里用同步阻塞"""
    time.sleep(1)  # 这会阻塞整个事件循环！
    return "done"

async def good_example():
    """正确：用异步方式"""
    await asyncio.sleep(1)  # 不阻塞事件循环
    return "done"
```

**如果必须调用同步阻塞代码：**

```python
import asyncio

def sync_blocking_operation():
    """同步阻塞函数（比如调用不支持异步的库）"""
    import time
    time.sleep(1)
    return "result"

async def main():
    loop = asyncio.get_event_loop()
    
    # 在线程池中运行同步阻塞代码
    result = await loop.run_in_executor(None, sync_blocking_operation)
    print(result)

asyncio.run(main())
```

---

#### 陷阱 2：CPU 密集操作阻塞事件循环

```python
import asyncio

async def cpu_heavy():
    """错误：CPU 密集操作会阻塞事件循环"""
    total = 0
    for i in range(100_000_000):  # 这会阻塞很久
        total += i
    return total

# 正确做法：放到进程池
import concurrent.futures

async def main():
    loop = asyncio.get_event_loop()
    
    with concurrent.futures.ProcessPoolExecutor() as pool:
        result = await loop.run_in_executor(pool, cpu_heavy_sync)

def cpu_heavy_sync():
    """同步版本的 CPU 密集函数"""
    return sum(range(100_000_000))
```

---

#### 陷阱 3：忘记 await

```python
async def fetch_data():
    await asyncio.sleep(1)
    return "data"

async def main():
    # 错误：忘记 await，result 是个协程对象，不是结果！
    result = fetch_data()
    print(result)  # <coroutine object fetch_data at 0x...>
    
    # 正确：
    result = await fetch_data()
    print(result)  # "data"
```

---

## 五、Python Web 框架的并发模型分析

### 1. Django / Flask（WSGI 同步框架）

```
                    ┌────────────────────────────────────┐
                    │          Gunicorn（Master）         │
                    │                                    │
                    │   ┌──────────────────────────────┐ │
                    │   │  Worker 1（进程）             │ │
客户端 ──────────▶ │   │  ┌────────────────────────┐  │ │
                    │   │  │ Django/Flask 应用       │  │ │
                    │   │  │ 同步处理请求            │  │ │
                    │   │  │ 一次处理一个请求        │  │ │
                    │   │  └────────────────────────┘  │ │
                    │   └──────────────────────────────┘ │
                    │                                    │
                    │   ┌──────────────────────────────┐ │
                    │   │  Worker 2（进程）             │ │
                    │   │  ┌────────────────────────┐  │ │
                    │   │  │ Django/Flask 应用       │  │ │
                    │   │  └────────────────────────┘  │ │
                    │   └──────────────────────────────┘ │
                    │            ...                     │
                    │   Worker N（通常 = 2*CPU+1）       │
                    └────────────────────────────────────┘
```

**特点：**
- 多进程模型（Prefork）
- 每个 Worker 同步处理请求
- 一个 Worker 同时只能处理一个请求（sync worker）
- Worker 数通常 = 2 * CPU 核数 + 1

**性能瓶颈：**
- Worker 在等 I/O 时被阻塞
- 4 核机器，9 个 Worker，最多同时处理 9 个请求
- 如果每个请求需要 100ms I/O，QPS 上限约 90

**适用场景：**
- 中小型 Web 应用
- 内部管理系统
- 请求量不大的 API

---

#### Gunicorn 配置建议

```python
# gunicorn.conf.py

# Worker 数量
workers = 2 * multiprocessing.cpu_count() + 1

# Worker 类型
worker_class = "sync"  # 同步模式（默认）
# worker_class = "gevent"  # gevent 协程模式（更高并发）
# worker_class = "uvicorn.workers.UvicornWorker"  # ASGI 模式

# 每个 Worker 的线程数（如果用 gthread）
threads = 4

# 每个 Worker 的最大并发连接数（gevent 模式）
worker_connections = 1000

# 超时
timeout = 30

# 绑定地址
bind = "0.0.0.0:8000"
```

**Gunicorn 不同 Worker 类型对比：**

| Worker 类型 | 并发模型 | 并发能力 | 适用场景 |
|------------|---------|---------|---------|
| sync | 同步，一次一个请求 | 低 | 简单应用 |
| gthread | 多线程 | 中 | I/O 较多的应用 |
| gevent | 协程（猴子补丁）| 高 | I/O 密集应用 |
| uvicorn | asyncio | 最高 | ASGI 应用 |

---

### 2. FastAPI + Uvicorn（ASGI 异步框架）★★★

```
                    ┌────────────────────────────────────────────┐
                    │          Uvicorn（ASGI Server）             │
                    │                                            │
                    │   ┌──────────────────────────────────────┐ │
                    │   │        事件循环（Event Loop）          │ │
客户端 ──────────▶ │   │        底层：uvloop（epoll）          │ │
                    │   │                                      │ │
                    │   │   ┌────────────┐ ┌────────────┐     │ │
                    │   │   │  协程 1    │ │  协程 2    │     │ │
                    │   │   │  处理请求1 │ │  处理请求2 │     │ │
                    │   │   └────────────┘ └────────────┘     │ │
                    │   │   ┌────────────┐ ┌────────────┐     │ │
                    │   │   │  协程 3    │ │  协程 N    │     │ │
                    │   │   │  处理请求3 │ │  处理请求N │     │ │
                    │   │   └────────────┘ └────────────┘     │ │
                    │   │                                      │ │
                    │   │  单线程，但可同时处理数千个请求       │ │
                    │   └──────────────────────────────────────┘ │
                    └────────────────────────────────────────────┘
```

**FastAPI 示例：**

```python
from fastapi import FastAPI
import asyncio
import aiohttp

app = FastAPI()

@app.get("/user/{user_id}")
async def get_user(user_id: int):
    """异步处理请求"""
    # 异步查数据库
    user = await async_db_query(f"SELECT * FROM user WHERE id = {user_id}")
    
    # 异步调用外部 API
    extra_info = await async_api_call(f"https://api.example.com/user/{user_id}")
    
    return {"user": user, "extra": extra_info}

async def async_db_query(sql: str):
    """模拟异步数据库查询"""
    await asyncio.sleep(0.01)  # 模拟 10ms 查询
    return {"id": 1, "name": "test"}

async def async_api_call(url: str):
    """模拟异步 API 调用"""
    await asyncio.sleep(0.02)  # 模拟 20ms API 调用
    return {"status": "ok"}
```

**FastAPI + Uvicorn 部署：**

```bash
# 单进程（开发）
uvicorn main:app --host 0.0.0.0 --port 8000

# 多进程（生产）
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# 或用 Gunicorn 管理多个 Uvicorn Worker
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

**特点：**
- 异步处理，单线程可处理数千并发
- 多 Worker 可利用多核
- 性能远超 Django/Flask

---

### 3. Django / Flask vs FastAPI 性能对比

```
场景：100 个并发请求，每个请求需要查数据库（50ms）+ 调用外部 API（50ms）

Django（sync，4 Worker）:
  ┌────────┐
  │Worker 1│ ████████████████████████████████ (100ms)
  │Worker 2│ ████████████████████████████████ (100ms)  
  │Worker 3│ ████████████████████████████████ (100ms)
  │Worker 4│ ████████████████████████████████ (100ms)
  └────────┘
  4 个 Worker 同时处理 4 个请求
  100 个请求需要：100 / 4 * 100ms = 2500ms

FastAPI（async，1 Worker）:
  ┌────────┐
  │Worker 1│ 同时处理 100 个请求的 I/O
  │        │ 所有请求的 I/O 并发进行
  │        │ 总耗时 ≈ 100ms（单批）
  └────────┘
  100 个请求需要：约 100ms！

差距：25 倍！
```

---

### 4. Python Web 框架选型建议

| 场景 | 推荐框架 | 理由 |
|------|---------|------|
| 内部管理系统 | Django | 功能全，admin 好用 |
| 简单 API | Flask | 轻量灵活 |
| 高性能 API | **FastAPI** | 异步、类型安全、性能高 |
| 高并发长连接 | FastAPI / Tornado | 异步支持好 |
| 微服务 | **FastAPI** | 轻量、性能高、文档好 |
| 已有 Django 项目 | Django + Channels | 给 Django 加异步能力 |

---

## 六、Python 高性能实战架构

### 1. 典型的 Python 高性能部署架构

```
                         ┌─────────┐
                         │  Nginx  │
                         │ 反向代理 │
                         │ 静态文件 │
                         │ 负载均衡 │
                         └────┬────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Uvicorn  │   │ Uvicorn  │   │ Uvicorn  │
        │ Worker 1 │   │ Worker 2 │   │ Worker N │
        │ FastAPI  │   │ FastAPI  │   │ FastAPI  │
        │ asyncio  │   │ asyncio  │   │ asyncio  │
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │               │               │
    ┌────────┼───────────────┼───────────────┤
    ▼        ▼               ▼               ▼
┌───────┐ ┌───────┐   ┌──────────┐    ┌──────────┐
│ Redis │ │ MySQL │   │ RabbitMQ │    │ 外部API  │
│ 缓存  │ │ 数据库 │   │ 消息队列 │    │          │
└───────┘ └───────┘   └──────────┘    └──────────┘
```

---

### 2. 完整的 FastAPI 高性能示例

```python
"""
高性能 FastAPI 服务示例
"""
from fastapi import FastAPI, Depends
from contextlib import asynccontextmanager
import asyncio
import aioredis
import aiomysql
import aiohttp

# ========== 全局连接池 ==========
class AppState:
    redis_pool = None
    mysql_pool = None
    http_session = None

state = AppState()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动和关闭时管理连接池"""
    # 启动时：创建连接池
    state.redis_pool = await aioredis.from_url(
        "redis://localhost:6379",
        max_connections=20
    )
    state.mysql_pool = await aiomysql.create_pool(
        host="localhost",
        port=3306,
        user="root",
        password="password",
        db="mydb",
        minsize=5,
        maxsize=20
    )
    state.http_session = aiohttp.ClientSession()
    
    print("连接池已创建")
    yield
    
    # 关闭时：释放连接池
    await state.redis_pool.close()
    state.mysql_pool.close()
    await state.mysql_pool.wait_closed()
    await state.http_session.close()
    print("连接池已关闭")

app = FastAPI(lifespan=lifespan)

# ========== 异步数据库查询 ==========
async def get_user_from_db(user_id: int) -> dict:
    """异步查询 MySQL"""
    async with state.mysql_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, name, email FROM user WHERE id = %s",
                (user_id,)
            )
            result = await cur.fetchone()
            return result

# ========== 缓存层 ==========
async def get_user_cached(user_id: int) -> dict:
    """先查缓存，没有再查数据库"""
    cache_key = f"user:{user_id}"
    
    # 1. 查缓存
    cached = await state.redis_pool.get(cache_key)
    if cached:
        import json
        return json.loads(cached)
    
    # 2. 缓存未命中，查数据库
    user = await get_user_from_db(user_id)
    if user:
        import json
        # 3. 写入缓存，设置过期时间
        await state.redis_pool.setex(
            cache_key,
            300,  # 5 分钟过期
            json.dumps(user, default=str)
        )
    
    return user

# ========== API 接口 ==========
@app.get("/user/{user_id}")
async def get_user(user_id: int):
    """获取用户信息"""
    user = await get_user_cached(user_id)
    if not user:
        return {"error": "User not found"}, 404
    return {"data": user}

@app.get("/user/{user_id}/full")
async def get_user_full(user_id: int):
    """获取用户完整信息（并发查询多个数据源）"""
    # 并发执行多个异步查询
    user_task = get_user_cached(user_id)
    orders_task = get_user_orders(user_id)
    score_task = get_user_score(user_id)
    
    # 同时等待所有结果
    user, orders, score = await asyncio.gather(
        user_task, orders_task, score_task
    )
    
    return {
        "user": user,
        "orders": orders,
        "score": score
    }

async def get_user_orders(user_id: int) -> list:
    """查询用户订单"""
    async with state.mysql_pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM order_info WHERE user_id = %s ORDER BY id DESC LIMIT 10",
                (user_id,)
            )
            return await cur.fetchall()

async def get_user_score(user_id: int) -> dict:
    """调用外部积分服务"""
    url = f"http://score-service/api/score/{user_id}"
    async with state.http_session.get(url) as resp:
        return await resp.json()
```

**这个例子展示了：**
1. 异步连接池（Redis、MySQL、HTTP）
2. 缓存层设计
3. 并发查询多个数据源（asyncio.gather）
4. 应用生命周期管理

---

### 3. 多进程 + 协程的组合架构

```python
"""
生产环境部署：多进程 + 协程

Gunicorn（多进程管理） + Uvicorn（异步事件循环）
"""

# gunicorn_config.py

import multiprocessing

# Worker 数量 = CPU 核数
workers = multiprocessing.cpu_count()

# Worker 类型：Uvicorn（异步）
worker_class = "uvicorn.workers.UvicornWorker"

# 每个 Worker 的最大并发
# Uvicorn Worker 基于 asyncio，可以处理大量并发
# 这个数字取决于你的业务和内存

# 绑定
bind = "0.0.0.0:8000"

# 超时
timeout = 30
graceful_timeout = 30

# 预加载应用（减少 Worker 启动时间）
preload_app = True

# 日志
accesslog = "-"
errorlog = "-"
loglevel = "info"
```

```bash
# 启动命令
gunicorn main:app -c gunicorn_config.py
```

**架构效果：**

```
                    ┌─────────────────────────────────────────────┐
                    │              Gunicorn Master                │
                    └─────────────┬───────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
   │ Worker 1     │       │ Worker 2     │       │ Worker N     │
   │ (进程 1)     │       │ (进程 2)     │       │ (进程 N)     │
   │              │       │              │       │              │
   │ Event Loop   │       │ Event Loop   │       │ Event Loop   │
   │ 数千个协程   │       │ 数千个协程   │       │ 数千个协程   │
   │              │       │              │       │              │
   │ 处理数千个   │       │ 处理数千个   │       │ 处理数千个   │
   │ 并发请求     │       │ 并发请求     │       │ 并发请求     │
   └──────────────┘       └──────────────┘       └──────────────┘
   
   4 核机器，4 个 Worker
   每个 Worker 处理 5000 并发
   总并发能力：20000
```

---

## 七、Python 异步生态

使用 asyncio 时，必须配套使用异步库，否则同步库会阻塞事件循环。

### 异步库对照表

| 功能 | 同步库 | 异步库 |
|------|--------|--------|
| HTTP 客户端 | requests | **aiohttp** / httpx |
| MySQL | pymysql / mysqlclient | **aiomysql** |
| PostgreSQL | psycopg2 | **asyncpg** |
| Redis | redis-py | **aioredis** / redis-py (async) |
| MongoDB | pymongo | **motor** |
| ORM | SQLAlchemy（同步） | **SQLAlchemy 2.0（async）** / Tortoise ORM |
| HTTP 框架 | Flask / Django | **FastAPI** / aiohttp |
| 消息队列 | pika（RabbitMQ） | **aio-pika** |
| 文件操作 | open() | **aiofiles** |
| WebSocket | - | **websockets** |

---

### SQLAlchemy 2.0 异步示例

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, Integer, String, select

# 创建异步引擎
engine = create_async_engine(
    "mysql+aiomysql://root:password@localhost/mydb",
    pool_size=20,
    max_overflow=10
)

AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()

class User(Base):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True)
    name = Column(String(64))
    email = Column(String(128))

# 异步查询
async def get_user(user_id: int):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

# 在 FastAPI 中使用
from fastapi import FastAPI, Depends

app = FastAPI()

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

@app.get("/user/{user_id}")
async def read_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return {"error": "Not found"}
    return {"id": user.id, "name": user.name}
```

---

## 八、容量估算：Python 服务能扛多少 QPS？

### 估算方法

```
QPS = Worker 数 × 每个 Worker 每秒处理请求数

每个 Worker 每秒处理请求数 = 1000ms / 平均请求处理时间

同步模型：
  每个 Worker 串行处理，一次只处理一个请求
  QPS = Worker 数 × (1000 / 请求耗时ms)

异步模型：
  每个 Worker 可以并发处理大量请求
  QPS ≈ Worker 数 × 并发数 × (1000 / 请求耗时ms)
  （受限于连接池大小、网络带宽等）
```

### 具体估算

**场景：4 核服务器，每个请求平均 50ms（其中 I/O 等待 45ms，计算 5ms）**

**Django + Gunicorn（sync，9 个 Worker）：**
```
QPS = 9 × (1000 / 50) = 180
```

**Django + Gunicorn（gevent，4 个 Worker，每个 1000 协程）：**
```
QPS ≈ 4 × 1000 × (1000 / 50) = 80000（理论上限）
实际受连接池和带宽限制，大约 5000~10000
```

**FastAPI + Uvicorn（4 个 Worker）：**
```
QPS ≈ 4 × 数千并发 × (1000 / 50) = 数万
实际大约 5000~20000（取决于连接池和硬件）
```

### 对比总结

| 部署方式 | QPS 估算（4核，50ms/请求） |
|---------|--------------------------|
| Django sync | ~200 |
| Django gthread | ~500-1000 |
| Django gevent | ~5000-10000 |
| FastAPI async | ~5000-20000 |
| Go（对比） | ~50000+ |

**注意：**
- 这只是粗略估算
- 实际性能取决于具体业务
- Python 的性能天花板确实不如 Go/Java
- 但大多数业务场景，Python async 已经够用

---

## 九、面试高频题（Python 版）

### 1. Python GIL 是什么？对性能有什么影响？

**答题框架：**

**什么是 GIL：**
> GIL 是 CPython 解释器的全局解释器锁，确保同一时刻只有一个线程执行 Python 字节码。

**影响：**
1. CPU 密集型任务：多线程无法并行，性能甚至更差
2. I/O 密集型任务：影响不大，因为 I/O 等待时 GIL 会释放

**应对策略：**
- CPU 密集 → 多进程（multiprocessing）
- I/O 密集 → 多线程或协程（asyncio）
- 高并发网络 → asyncio + 异步框架（FastAPI）

---

### 2. 多进程、多线程、协程的区别和选择？

**答题框架：**

| 维度 | 多进程 | 多线程 | 协程 |
|------|--------|--------|------|
| 并行能力 | 真正并行 | 受 GIL 限制 | 单线程并发 |
| 切换开销 | 大 | 中 | 极小 |
| 内存占用 | 大（独立空间） | 中（共享空间） | 小（几KB/协程） |
| 通信方式 | 管道/队列/共享内存 | 共享变量（需加锁） | 无需锁 |
| 适用场景 | CPU 密集 | I/O 密集 | 高并发 I/O |
| 数量上限 | 十几个 | 几百~几千 | 几万~几十万 |

---

### 3. asyncio 的原理是什么？

**答题框架：**

> asyncio 本质上是 Python 实现的 **Reactor 模型**：

1. **Event Loop（事件循环）** = Reactor
   - 底层用 epoll（Linux）监控所有 I/O
   - 不断循环检查哪些 I/O 准备好了

2. **协程** = Handler
   - 用 `async/await` 定义
   - `await` 时让出控制权，不阻塞

3. **工作流程：**
   - 协程发起 I/O → 注册到事件循环 → 让出控制权
   - 事件循环切换到其他协程
   - I/O 完成 → 事件循环通知协程恢复

4. **核心优势：**
   - 单线程处理大量并发 I/O
   - 无线程切换开销
   - 无需加锁

---

### 4. 为什么 FastAPI 比 Django 性能高？

**答题框架：**

| 维度 | Django（WSGI） | FastAPI（ASGI） |
|------|---------------|-----------------|
| 并发模型 | 同步阻塞 | 异步非阻塞 |
| I/O 处理 | 等 I/O 时线程阻塞 | 等 I/O 时切换到其他请求 |
| Worker 利用率 | 低（大量时间在等待） | 高（几乎不等待） |
| 并发能力 | 低（受 Worker 数限制） | 高（单 Worker 数千并发） |
| 底层框架 | WSGI（同步协议） | ASGI（异步协议） |
| 事件循环 | 无 | uvloop（epoll） |

**简单说：**
> Django 一个 Worker 同时只能处理一个请求，等 I/O 时 Worker 闲着。FastAPI 一个 Worker 可以同时处理数千个请求，等 I/O 时去处理其他请求。

---

### 5. Python 后端如何做到高性能？

**答题框架：**

1. **选择异步框架**
   - FastAPI + Uvicorn
   - 全链路异步（异步数据库驱动、异步 Redis 等）

2. **多进程 + 协程**
   - Gunicorn + UvicornWorker
   - Worker 数 = CPU 核数

3. **缓存**
   - Redis 缓存热点数据
   - 本地缓存（如 cachetools）

4. **连接池**
   - 数据库连接池
   - Redis 连接池
   - HTTP 连接池

5. **计算密集任务卸载**
   - 用 Celery 异步处理
   - 用多进程处理 CPU 密集任务
   - 用 C 扩展（Cython）加速核心逻辑

6. **架构层面**
   - Nginx 反向代理 + 负载均衡
   - 读写分离
   - 消息队列削峰

---

### 6. 如果让你设计一个高并发 Python 后端，你会怎么做？

**答题框架：**

```
1. 框架选型：FastAPI + Uvicorn

2. 部署架构：
   Nginx → Gunicorn（4 Worker）→ Uvicorn（asyncio）

3. 数据层：
   - MySQL + asyncpg/aiomysql（异步驱动）
   - Redis 缓存（aioredis）
   - 连接池

4. 异步全链路：
   - 所有 I/O 操作都用异步
   - 数据库查询异步
   - 外部 API 调用异步
   - Redis 操作异步

5. CPU 密集任务：
   - Celery 异步任务队列
   - 或 ProcessPoolExecutor

6. 性能优化：
   - 热点数据缓存
   - 数据库索引优化
   - 批量操作替代逐条操作
   - 限流保护

7. 监控：
   - Prometheus + Grafana
   - 慢查询监控
   - 请求耗时监控
```

---

## 十、本讲核心要点总结

### 必须记住的 12 条

1. **Python 高性能的最大障碍是 GIL，CPU 密集用多进程，I/O 密集用协程**
2. **asyncio 本质是 Python 版的 Reactor 模型，底层用 epoll**
3. **await 不是阻塞等待，是让出控制权给事件循环**
4. **协程比线程轻：几 KB vs 几百 KB，可以开数万个**
5. **FastAPI（ASGI）比 Django（WSGI）性能高的核心原因是异步非阻塞**
6. **生产部署：Gunicorn + UvicornWorker，Worker 数 = CPU 核数**
7. **全链路异步：数据库、Redis、HTTP 客户端都必须用异步库**
8. **在 async 函数里调用同步阻塞代码，会阻塞整个事件循环**
9. **必须调用同步代码时，用 `run_in_executor` 放到线程池**
10. **连接池是必须的：数据库连接池、Redis 连接池、HTTP Session 复用**
11. **asyncio.gather 并发执行多个协程，比串行快数倍**
12. **Python 性能天花板不如 Go/Java，但用好异步框架，大多数场景够用**

---

## 十一、课后练习

### 练习 1：GIL 理解

用代码验证：
1. CPU 密集型任务，多线程 vs 多进程的性能差异
2. I/O 密集型任务，多线程 vs 协程的性能差异

```python
# 请补全以下代码，对比性能

import time
import threading
import multiprocessing
import asyncio

# CPU 密集型
def cpu_task():
    return sum(i * i for i in range(5_000_000))

# 1. 单线程执行 4 次
# 2. 多线程（4线程）执行 4 次
# 3. 多进程（4进程）执行 4 次
# 分别计时并对比
```

---

### 练习 2：asyncio 实战

用 asyncio 实现一个简单的并发爬虫：
1. 给定 50 个 URL
2. 限制最多同时 10 个并发
3. 统计每个 URL 的响应大小
4. 计算总耗时

---

### 练习 3：框架对比

用 FastAPI 和 Flask 分别实现一个简单的 API：
- 接收用户 ID
- 模拟查询数据库（sleep 50ms）
- 返回用户信息

然后用 `wrk` 或 `ab` 做压测，对比两者的 QPS。

---

### 练习 4：架构设计

假设你要为公司设计一个通知服务：
- 支持发送短信、邮件、站内消息
- 预期每秒 1000 条消息
- 要求消息不能丢

请用 Python 生态设计方案，包括：
1. 选什么框架？
2. 用什么并发模型？
3. 消息怎么保证不丢？
4. 架构图是怎样的？

---

## 十二、下一讲预告

下一讲我们进入集群层面的高性能架构：

**第 4 讲：高性能架构模式（下）——负载均衡、读写分离、分库分表**

会讲：
- 负载均衡：DNS、Nginx、LVS 的层次与选型
- 负载均衡算法：轮询、加权、一致性哈希
- 读写分离：原理、Python 实现、坑点
- 分库分表：垂直拆分、水平拆分、分片键选择
- 全局 ID 生成方案
- 缓存架构：穿透、雪崩、热点
- 消息队列：Celery、RabbitMQ、Kafka 选型
- Python 生态的对应实现
- 面试高频题
