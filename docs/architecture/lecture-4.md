# 第 4 讲：高性能架构模式（下）——负载均衡、读写分离、分库分表

---

上一讲我们搞清楚了单机高性能的底层原理。

这一讲进入**集群层面**的高性能架构。

当单机撑不住时，你需要：
- 多台机器分摊流量 → **负载均衡**
- 数据库读压力太大 → **读写分离**
- 数据量太大单库扛不住 → **分库分表**
- 热点数据反复查数据库 → **缓存架构**
- 高峰流量冲击后端 → **消息队列削峰**

这些是后端架构师**最核心的工具箱**，也是大厂面试**最高频的考点**。

全程用 **Python 生态**实现。

---

## 一、负载均衡

### 1. 为什么需要负载均衡？

单机瓶颈场景：

```
所有请求 ──────────────────▶ 单台服务器
                              ┌──────────┐
                              │  CPU 满了│
                              │  内存满了│
                              │  带宽满了│
                              └──────────┘
```

解决方法：多台服务器分摊流量

```
                    ┌──────────────────────────┐
                    │       负载均衡器          │
所有请求 ──────────▶│    （分发请求）           │
                    └────────┬─────────────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
       ┌─────────┐      ┌─────────┐      ┌─────────┐
       │ 服务器1  │      │ 服务器2  │      │ 服务器3  │
       └─────────┘      └─────────┘      └─────────┘
```

---

### 2. 负载均衡的三个层次

#### 层次一：DNS 负载均衡

```
用户请求 www.example.com
    ↓
DNS 解析
    ↓
返回多个 IP（每次返回不同的）
    ↓
用户连接到其中一个 IP
```

**Python 验证：**

```python
import socket

# 查看 DNS 返回的多个 IP
hostname = "www.baidu.com"
results = socket.getaddrinfo(hostname, 80)
ips = [r[4][0] for r in results]
print(f"{hostname} 的 IP 列表: {ips}")
# 可能返回多个 IP
```

**优点：**
- 简单，不需要额外设备
- 天然地理分布

**缺点：**
- DNS 有缓存，切换慢（TTL 时间内无法更新）
- 无法感知服务器健康状态
- 分配不够均匀（客户端缓存）

**适用：** 跨地域流量调度（大厂用来做 CDN 调度）

---

#### 层次二：硬件负载均衡（F5）

- 专用硬件设备
- 性能极强（百万级 QPS）
- 价格极贵（几万~几十万）
- 大型银行、运营商用

**普通互联网公司基本不用，了解即可。**

---

#### 层次三：软件负载均衡（Nginx / LVS）★★★

这是互联网公司最常用的方案。

```
                    ┌───────────────────────────────┐
                    │         Nginx                 │
用户 ─────────────▶ │    七层负载均衡（HTTP层）      │
                    │    可以根据 URL、Header 分发   │
                    └─────────────────┬─────────────┘
                                      │
                      ┌───────────────┼───────────────┐
                      ▼               ▼               ▼
               ┌──────────┐   ┌──────────┐   ┌──────────┐
               │ 应用服务1 │   │ 应用服务2 │   │ 应用服务3 │
               └──────────┘   └──────────┘   └──────────┘
```

**LVS vs Nginx：**

| 维度 | LVS | Nginx |
|------|-----|-------|
| 工作层次 | 四层（IP+端口） | 七层（HTTP） |
| 性能 | 极高（内核态） | 高（用户态） |
| 功能 | 简单转发 | 丰富（限流、重写、缓存等）|
| 健康检查 | 基础 | 丰富 |
| 常见组合 | LVS → Nginx → 应用 | Nginx → 应用 |

**中小公司通常直接用 Nginx 就够了。**

---

### 3. 负载均衡算法 ★★★

这是面试必考内容。

#### 算法一：轮询（Round Robin）

```python
"""
轮询算法：按顺序依次分配
"""
from itertools import cycle

class RoundRobinBalancer:
    def __init__(self, servers: list):
        self.servers = servers
        self._cycle = cycle(servers)
    
    def get_server(self) -> str:
        return next(self._cycle)

# 使用
balancer = RoundRobinBalancer([
    "192.168.1.1:8000",
    "192.168.1.2:8000",
    "192.168.1.3:8000",
])

for i in range(6):
    server = balancer.get_server()
    print(f"请求 {i+1} → {server}")

# 输出：
# 请求 1 → 192.168.1.1:8000
# 请求 2 → 192.168.1.2:8000
# 请求 3 → 192.168.1.3:8000
# 请求 4 → 192.168.1.1:8000
# 请求 5 → 192.168.1.2:8000
# 请求 6 → 192.168.1.3:8000
```

**优点：** 简单，均匀分配
**缺点：** 不考虑服务器性能差异，不考虑当前负载

---

#### 算法二：加权轮询（Weighted Round Robin）

```python
"""
加权轮询：性能强的服务器分配更多请求
"""
class WeightedRoundRobinBalancer:
    def __init__(self, servers: list[tuple]):
        """
        servers: [(server, weight), ...]
        例如: [("s1", 5), ("s2", 3), ("s3", 2)]
        """
        self.servers = []
        for server, weight in servers:
            self.servers.extend([server] * weight)
        self._cycle = cycle(self.servers)
    
    def get_server(self) -> str:
        return next(self._cycle)

# 使用：服务器1性能最强，分5份；服务器2次之，3份；服务器3最弱，2份
balancer = WeightedRoundRobinBalancer([
    ("192.168.1.1:8000", 5),  # 高配服务器
    ("192.168.1.2:8000", 3),  # 中配服务器
    ("192.168.1.3:8000", 2),  # 低配服务器
])

# 10个请求，服务器1分5个，服务器2分3个，服务器3分2个
results = [balancer.get_server() for _ in range(10)]
from collections import Counter
print(Counter(results))
# {'192.168.1.1:8000': 5, '192.168.1.2:8000': 3, '192.168.1.3:8000': 2}
```

**优点：** 可以根据服务器性能差异分配
**缺点：** 还是不考虑实时负载

---

#### 算法三：最少连接（Least Connections）

```python
"""
最少连接：把请求发给当前连接数最少的服务器
"""
import threading

class LeastConnectionBalancer:
    def __init__(self, servers: list):
        self.servers = {server: 0 for server in servers}
        self._lock = threading.Lock()
    
    def get_server(self) -> str:
        with self._lock:
            # 选连接数最少的服务器
            server = min(self.servers, key=lambda s: self.servers[s])
            self.servers[server] += 1
            return server
    
    def release_server(self, server: str):
        """请求完成后释放连接"""
        with self._lock:
            self.servers[server] = max(0, self.servers[server] - 1)

# 模拟使用
balancer = LeastConnectionBalancer([
    "192.168.1.1:8000",
    "192.168.1.2:8000",
    "192.168.1.3:8000",
])

import random
import time

def simulate_request(request_id):
    server = balancer.get_server()
    print(f"请求 {request_id} → {server}（当前连接数: {balancer.servers}）")
    time.sleep(random.uniform(0.1, 0.5))  # 模拟处理时间
    balancer.release_server(server)

threads = [threading.Thread(target=simulate_request, args=(i,)) for i in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

**优点：** 动态感知服务器负载，适合请求处理时间差异大的场景
**缺点：** 需要维护连接状态，有一定开销

---

#### 算法四：一致性哈希（Consistent Hashing）★★★

这是**最重要、最难**的负载均衡算法，面试高频。

**先看普通哈希的问题：**

```python
# 普通哈希：hash(key) % 服务器数量
servers = ["s1", "s2", "s3"]

def get_server_normal(key: str) -> str:
    return servers[hash(key) % len(servers)]

# 问题：添加/删除服务器时，大量 key 的映射发生变化
print(get_server_normal("user:1001"))  # s2

# 添加一台服务器
servers_new = ["s1", "s2", "s3", "s4"]

def get_server_new(key: str) -> str:
    return servers_new[hash(key) % len(servers_new)]

print(get_server_new("user:1001"))  # 可能是 s3（变了！）
```

**节点变化时，几乎所有 key 的映射都会变化。**

如果是缓存服务器，节点变化会导致**大量缓存失效**，直接打爆后端数据库。

---

**一致性哈希解决方案：**

```python
"""
一致性哈希实现
核心思想：
1. 把所有服务器映射到一个哈希环（0 ~ 2^32）上
2. 每个 key 也映射到哈希环上
3. 沿顺时针方向，找到第一个服务器节点
4. 添加/删除节点时，只有相邻的 key 受影响
"""
import hashlib
import bisect

class ConsistentHashBalancer:
    def __init__(self, servers: list[str], virtual_nodes: int = 150):
        """
        virtual_nodes: 虚拟节点数量（解决数据倾斜问题）
        每个真实节点对应多个虚拟节点
        """
        self.virtual_nodes = virtual_nodes
        self.ring = {}          # 哈希环：{哈希值: 服务器}
        self.sorted_keys = []   # 排序的哈希值列表
        
        for server in servers:
            self.add_server(server)
    
    def _hash(self, key: str) -> int:
        """计算哈希值"""
        return int(hashlib.md5(key.encode()).hexdigest(), 16)
    
    def add_server(self, server: str):
        """添加服务器节点"""
        for i in range(self.virtual_nodes):
            # 每个真实节点创建多个虚拟节点
            virtual_key = f"{server}#VN{i}"
            hash_val = self._hash(virtual_key)
            self.ring[hash_val] = server
            bisect.insort(self.sorted_keys, hash_val)
        print(f"✅ 添加节点: {server}（{self.virtual_nodes} 个虚拟节点）")
    
    def remove_server(self, server: str):
        """删除服务器节点"""
        for i in range(self.virtual_nodes):
            virtual_key = f"{server}#VN{i}"
            hash_val = self._hash(virtual_key)
            if hash_val in self.ring:
                del self.ring[hash_val]
                idx = bisect.bisect_left(self.sorted_keys, hash_val)
                self.sorted_keys.pop(idx)
        print(f"❌ 删除节点: {server}")
    
    def get_server(self, key: str) -> str:
        """获取 key 对应的服务器"""
        if not self.ring:
            raise Exception("没有可用的服务器")
        
        hash_val = self._hash(key)
        
        # 在环上顺时针找第一个节点
        idx = bisect.bisect_right(self.sorted_keys, hash_val)
        
        # 如果超过末尾，回到第一个节点（形成环）
        if idx >= len(self.sorted_keys):
            idx = 0
        
        return self.ring[self.sorted_keys[idx]]


# ========== 演示 ==========
from collections import defaultdict

balancer = ConsistentHashBalancer([
    "cache-server-1",
    "cache-server-2",
    "cache-server-3",
])

print("\n--- 初始分配（1000个key）---")
initial_mapping = {}
distribution = defaultdict(int)
for i in range(1000):
    key = f"user:{i}"
    server = balancer.get_server(key)
    initial_mapping[key] = server
    distribution[server] += 1

for server, count in sorted(distribution.items()):
    print(f"  {server}: {count} 个key（{count/10:.1f}%）")

print("\n--- 添加新节点 cache-server-4 ---")
balancer.add_server("cache-server-4")

changed = 0
new_distribution = defaultdict(int)
for i in range(1000):
    key = f"user:{i}"
    new_server = balancer.get_server(key)
    new_distribution[new_server] += 1
    if new_server != initial_mapping[key]:
        changed += 1

print(f"\n受影响的key数量: {changed}/1000 ({changed/10:.1f}%)")
print("新的分配:")
for server, count in sorted(new_distribution.items()):
    print(f"  {server}: {count} 个key")
```

**输出示例：**

```
--- 初始分配（1000个key）---
  cache-server-1: 342 个key（34.2%）
  cache-server-2: 318 个key（31.8%）
  cache-server-3: 340 个key（34.0%）

--- 添加新节点 cache-server-4 ---
✅ 添加节点: cache-server-4（150 个虚拟节点）

受影响的key数量: 248/1000 (24.8%)
新的分配:
  cache-server-1: 256 个key
  cache-server-2: 242 个key
  cache-server-3: 256 个key
  cache-server-4: 246 个key
```

**关键结论：**
- 普通哈希：添加节点后，约 75% 的 key 会变化
- 一致性哈希：添加节点后，只有约 25% 的 key 会变化（约 1/N）
- 这就是一致性哈希的核心价值

---

**一致性哈希算法总结：**

| 特性 | 说明 |
|------|------|
| **节点变化影响** | 只影响相邻节点，约 1/N 的 key |
| **虚拟节点** | 解决数据分布不均（倾斜）问题，通常设 100~200 个 |
| **适用场景** | 缓存集群、分布式存储 |
| **典型应用** | Redis Cluster、Nginx upstream、Cassandra |

---

### 4. Nginx 负载均衡配置

```nginx
# /etc/nginx/nginx.conf

upstream python_backend {
    # 轮询（默认）
    server 192.168.1.1:8000;
    server 192.168.1.2:8000;
    server 192.168.1.3:8000;
    
    # 加权轮询
    # server 192.168.1.1:8000 weight=5;
    # server 192.168.1.2:8000 weight=3;
    # server 192.168.1.3:8000 weight=2;
    
    # 最少连接
    # least_conn;
    
    # IP 哈希（同一IP总打到同一服务器）
    # ip_hash;
    
    # 健康检查
    # server 192.168.1.1:8000 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name api.example.com;
    
    location / {
        proxy_pass http://python_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 超时设置
        proxy_connect_timeout 3s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }
}
```

---

## 二、读写分离

### 1. 为什么需要读写分离？

大部分业务是**读多写少**：

```
典型电商系统：
读操作：查商品详情、查订单列表、查用户信息 → 占 80%+
写操作：下单、支付、更新库存 → 占 20%-
```

问题：读写都打到同一个数据库

```
所有读请求 ─────┐
                 ├──▶ 主库（一台）← 压力山大
所有写请求 ─────┘
```

解决：主库写，从库读

```
写请求 ────────▶ 主库（MySQL Master）
                      │ 复制（binlog）
读请求 ────────▶ 从库1（MySQL Slave 1）
读请求 ────────▶ 从库2（MySQL Slave 2）
```

---

### 2. MySQL 主从复制原理

```
┌──────────────────────────────────────────────────────────┐
│                      主库（Master）                       │
│                                                          │
│  写操作 → 执行SQL → 写 binlog（二进制日志）               │
│                                ↓                         │
│                    binlog（记录所有变更）                  │
└────────────────────────────────┬─────────────────────────┘
                                 │ binlog 传输
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│  从库 1    │  │  从库 2    │  │  从库 N    │
│ I/O Thread │  │ I/O Thread │  │ I/O Thread │
│ 接收binlog │  │ 接收binlog │  │ 接收binlog │
│ 写relaylog │  │ 写relaylog │  │ 写relaylog │
│ SQL Thread │  │ SQL Thread │  │ SQL Thread │
│ 执行SQL    │  │ 执行SQL    │  │ 执行SQL    │
└────────────┘  └────────────┘  └────────────┘
```

**复制流程：**
1. 主库执行 SQL，写入 binlog
2. 从库 I/O Thread 连接主库，拉取 binlog
3. 从库写入 relay log（中继日志）
4. 从库 SQL Thread 执行 relay log 中的 SQL
5. 从库数据与主库同步

---

### 3. 主从延迟问题

**主从复制是异步的，存在延迟！**

```
主库：写入数据 t=0
从库：收到数据 t=0.1s（100ms 后）
```

**导致的问题：**
- 刚写主库，立刻读从库，可能读不到最新数据
- 典型场景：用户刚注册，立刻登录，读不到用户信息

---

### 4. Python 实现读写分离

```python
"""
Python + SQLAlchemy 实现读写分离
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import random


class ReadWriteRouter:
    """
    读写分离路由
    写操作 → 主库
    读操作 → 从库（随机选一个）
    """
    
    def __init__(self):
        # 主库（写）
        self.master_engine = create_engine(
            "mysql+pymysql://root:password@master-host:3306/mydb",
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,  # 连接前先 ping，确保连接有效
        )
        
        # 从库（读）- 可以有多个
        self.slave_engines = [
            create_engine(
                f"mysql+pymysql://root:password@slave{i}-host:3306/mydb",
                pool_size=10,
                max_overflow=20,
                pool_pre_ping=True,
            )
            for i in range(1, 3)  # slave1, slave2
        ]
        
        # Session 工厂
        self.MasterSession = sessionmaker(bind=self.master_engine)
        self.SlaveSession = [
            sessionmaker(bind=engine) for engine in self.slave_engines
        ]
    
    def get_master_session(self):
        """获取主库 Session（写操作用）"""
        return self.MasterSession()
    
    def get_slave_session(self):
        """获取从库 Session（读操作用，随机选一个）"""
        SessionClass = random.choice(self.SlaveSession)
        return SessionClass()


# 全局路由器
router = ReadWriteRouter()


class UserRepository:
    """用户数据访问层"""
    
    def create_user(self, name: str, email: str) -> dict:
        """创建用户（写操作，走主库）"""
        session = router.get_master_session()
        try:
            session.execute(
                text("INSERT INTO user (name, email) VALUES (:name, :email)"),
                {"name": name, "email": email}
            )
            session.commit()
            # 获取新插入的 ID
            result = session.execute(text("SELECT LAST_INSERT_ID()"))
            user_id = result.scalar()
            return {"id": user_id, "name": name, "email": email}
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()
    
    def get_user(self, user_id: int) -> dict:
        """查询用户（读操作，走从库）"""
        session = router.get_slave_session()
        try:
            result = session.execute(
                text("SELECT id, name, email FROM user WHERE id = :id"),
                {"id": user_id}
            )
            row = result.fetchone()
            if row:
                return {"id": row.id, "name": row.name, "email": row.email}
            return None
        finally:
            session.close()
    
    def get_user_from_master(self, user_id: int) -> dict:
        """
        从主库读用户（解决主从延迟问题）
        场景：刚写入后立刻需要读，必须从主库读
        """
        session = router.get_master_session()
        try:
            result = session.execute(
                text("SELECT id, name, email FROM user WHERE id = :id"),
                {"id": user_id}
            )
            row = result.fetchone()
            if row:
                return {"id": row.id, "name": row.name, "email": row.email}
            return None
        finally:
            session.close()
```

---

### 5. 如何解决主从延迟导致的读不到问题？

```python
"""
几种解决主从延迟的策略
"""

class SmartUserService:
    
    def __init__(self):
        self.repo = UserRepository()
        self.redis = redis.Redis(host='localhost', port=6379)
    
    # 策略 1：写操作后，标记"刚写入"，短时间内读主库
    def register_user(self, name: str, email: str) -> dict:
        """注册用户"""
        user = self.repo.create_user(name, email)
        
        # 标记该用户刚被创建，15 秒内读主库
        self.redis.setex(
            f"read_master:user:{user['id']}",
            15,  # 15 秒
            "1"
        )
        return user
    
    def get_user(self, user_id: int) -> dict:
        """获取用户（智能路由）"""
        # 判断是否需要读主库
        if self.redis.exists(f"read_master:user:{user_id}"):
            # 刚写入，从主库读
            return self.repo.get_user_from_master(user_id)
        else:
            # 正常情况，从从库读
            return self.repo.get_user(user_id)
    
    # 策略 2：重要操作始终读主库
    def get_user_for_payment(self, user_id: int) -> dict:
        """
        支付前查用户余额（强一致性场景）
        必须从主库读，不能有延迟
        """
        return self.repo.get_user_from_master(user_id)
    
    # 策略 3：允许延迟的场景，读从库
    def get_user_for_display(self, user_id: int) -> dict:
        """
        展示用户信息（允许短暂延迟）
        从从库读，减轻主库压力
        """
        return self.repo.get_user(user_id)
```

---

## 三、分库分表

### 1. 什么时候需要分库分表？

**先看单库单表的瓶颈：**

| 瓶颈类型 | 表现 | 阈值参考 |
|---------|------|---------|
| **单表数据量** | 查询变慢，索引大 | 单表 > 2000 万行（视情况）|
| **单库连接数** | 连接耗尽 | MySQL 默认 151 |
| **单库磁盘** | 空间不足，I/O 瓶颈 | 磁盘使用率 > 70% |
| **单库 QPS** | 写操作成瓶颈 | MySQL 写约 1000~5000 QPS |

**不要过早分库分表！**

先尝试：
1. 优化 SQL 和索引
2. 加缓存
3. 读写分离
4. 只有以上都不够了，才考虑分库分表

---

### 2. 垂直拆分

#### 垂直分表：大表拆小表

**问题场景：**

```sql
-- 用户表：字段太多，有些字段很少用
CREATE TABLE user (
    id BIGINT,
    name VARCHAR(64),
    email VARCHAR(128),
    phone VARCHAR(20),
    -- 以下字段很少被查询
    intro TEXT,           -- 个人介绍（大字段）
    settings JSON,        -- 个人设置（大字段）
    last_login DATETIME,
    login_count INT,
    ...
);
```

**拆分后：**

```sql
-- 主表：高频字段，小而快
CREATE TABLE user (
    id BIGINT PRIMARY KEY,
    name VARCHAR(64),
    email VARCHAR(128),
    phone VARCHAR(20)
);

-- 扩展表：低频字段，不常查
CREATE TABLE user_detail (
    user_id BIGINT PRIMARY KEY,  -- 与主表 1:1 关联
    intro TEXT,
    settings JSON,
    last_login DATETIME,
    login_count INT
);
```

**好处：**
- 主表变小，热点数据更容易缓存
- 减少单次查询的数据量
- 大字段不影响主表性能

---

#### 垂直分库：按业务拆库

**问题场景：**

```
单个数据库里，有用户、商品、订单、支付所有表
```

**拆分后：**

```
用户库（user_db）：user、user_detail、user_address
商品库（product_db）：product、category、brand
订单库（order_db）：order_info、order_item
支付库（pay_db）：payment、refund
```

**好处：**
- 各业务独立，互不影响
- 可以针对不同业务做不同的优化
- 团队可以独立负责不同数据库

**坏处：**
- 跨库 join 不能直接做
- 跨库事务需要分布式事务

---

### 3. 水平拆分（分库分表的核心）★★★

**问题：** 单张表数据量太大

```
order_info 表：5 亿条订单记录 → 查询慢，索引大
```

**解决：** 按某个规则，把数据分散到多张表/多个库

```
order_info_0：存部分订单（如用户ID % 4 == 0 的订单）
order_info_1：存部分订单（如用户ID % 4 == 1 的订单）
order_info_2：存部分订单（如用户ID % 4 == 2 的订单）
order_info_3：存部分订单（如用户ID % 4 == 3 的订单）
```

---

### 4. 分片键如何选择？★★★

**分片键（Sharding Key）是分库分表最关键的设计决策。**

选择原则：

| 原则 | 说明 |
|------|------|
| **区分度高** | 数据分布均匀，避免热点 |
| **查询频繁** | 大多数查询都带这个字段 |
| **不可变** | 一旦确定不能改变 |
| **业务相关** | 符合业务访问模式 |

---

**常见选择：**

#### 按用户 ID 分片

```python
"""
按用户 ID 分库分表

优点：
- 同一用户的数据在同一分片，避免跨片查询
- 适合"查自己的数据"的场景

缺点：
- 无法高效查询"所有用户的某类数据"
- 可能有用户热点（大V用户活跃度远高于普通用户）
"""

class UserShardingRouter:
    def __init__(self, db_count: int = 4, table_count: int = 4):
        self.db_count = db_count        # 分几个库
        self.table_count = table_count  # 每个库分几张表
    
    def get_shard(self, user_id: int) -> tuple[int, int]:
        """
        返回 (库编号, 表编号)
        """
        # 总分片数 = db_count * table_count
        total_shards = self.db_count * self.table_count
        shard_id = user_id % total_shards
        
        db_idx = shard_id // self.table_count
        table_idx = shard_id % self.table_count
        
        return db_idx, table_idx
    
    def get_table_name(self, user_id: int, base_name: str) -> str:
        db_idx, table_idx = self.get_shard(user_id)
        return f"db_{db_idx}.{base_name}_{db_idx}_{table_idx}"


router = UserShardingRouter(db_count=4, table_count=4)

# 测试分片分布
for user_id in [1001, 1002, 1003, 1016, 1032]:
    table = router.get_table_name(user_id, "order_info")
    print(f"用户 {user_id} 的订单 → {table}")

# 输出：
# 用户 1001 的订单 → db_1.order_info_1_1
# 用户 1002 的订单 → db_2.order_info_2_2
# 用户 1003 的订单 → db_3.order_info_3_3
# 用户 1016 的订单 → db_0.order_info_0_0
# 用户 1032 的订单 → db_0.order_info_0_0
```

---

#### 按时间分片

```python
"""
按时间分表：按月/按年分表

优点：
- 历史数据可以归档
- 最近数据在同一张表，访问快

缺点：
- 数据不均匀（热表是最近月份）
- 跨月查询需要多表 union
"""
from datetime import datetime

class TimeShardingRouter:
    def get_table_name(self, create_time: datetime, base_name: str) -> str:
        """按年月分表"""
        suffix = create_time.strftime("%Y%m")  # 如 202401
        return f"{base_name}_{suffix}"
    
    def get_tables_for_range(
        self,
        base_name: str,
        start_time: datetime,
        end_time: datetime
    ) -> list[str]:
        """获取时间范围内涉及的所有表"""
        tables = []
        current = start_time.replace(day=1, hour=0, minute=0, second=0)
        
        while current <= end_time:
            tables.append(self.get_table_name(current, base_name))
            # 移到下个月
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1)
            else:
                current = current.replace(month=current.month + 1)
        
        return tables


router = TimeShardingRouter()

# 查询 2024 年 1 月到 3 月的订单
tables = router.get_tables_for_range(
    "order_info",
    datetime(2024, 1, 1),
    datetime(2024, 3, 31)
)
print(f"需要查询的表: {tables}")
# ['order_info_202401', 'order_info_202402', 'order_info_202403']
```

---

### 5. 全局 ID 生成 ★★★

**分库分表后，不能用数据库自增 ID！**

因为：
- 两个分片各自自增，会产生重复 ID
- 订单 1001 可能在 shard_0 和 shard_1 各有一条

需要**全局唯一 ID** 生成方案。

---

#### 方案一：UUID

```python
import uuid

def generate_uuid() -> str:
    return str(uuid.uuid4())
    # "550e8400-e29b-41d4-a716-446655440000"

# 缺点：
# - 36 个字符，太长
# - 字符串类型，索引效率低
# - 无序，插入导致页分裂
# - 不携带时间信息
```

---

#### 方案二：雪花算法（Snowflake）★★★

Twitter 开源，最常用的分布式 ID 生成方案。

```python
"""
雪花算法（Snowflake ID）实现

ID 结构（64 bit）：
┌──────────────────────────────────────────────────────────────────┐
│ 1 bit  │ 41 bit          │ 10 bit      │ 12 bit                  │
│ 符号位  │ 毫秒时间戳      │ 机器ID      │ 序列号                   │
│ 始终0  │ 约69年          │ 最多1024台  │ 每毫秒最多4096个ID       │
└──────────────────────────────────────────────────────────────────┘
"""
import time
import threading


class SnowflakeIDGenerator:
    # 开始时间戳（2024-01-01）
    EPOCH = 1704067200000
    
    # 各部分占用 bit 数
    WORKER_ID_BITS = 5      # 工作机器 ID
    DATACENTER_ID_BITS = 5  # 数据中心 ID
    SEQUENCE_BITS = 12      # 序列号
    
    # 最大值
    MAX_WORKER_ID = (1 << WORKER_ID_BITS) - 1        # 31
    MAX_DATACENTER_ID = (1 << DATACENTER_ID_BITS) - 1  # 31
    MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1           # 4095
    
    # 位移量
    WORKER_ID_SHIFT = SEQUENCE_BITS
    DATACENTER_ID_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS
    TIMESTAMP_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS + DATACENTER_ID_BITS
    
    def __init__(self, worker_id: int, datacenter_id: int):
        if not (0 <= worker_id <= self.MAX_WORKER_ID):
            raise ValueError(f"worker_id 必须在 0~{self.MAX_WORKER_ID} 之间")
        if not (0 <= datacenter_id <= self.MAX_DATACENTER_ID):
            raise ValueError(f"datacenter_id 必须在 0~{self.MAX_DATACENTER_ID} 之间")
        
        self.worker_id = worker_id
        self.datacenter_id = datacenter_id
        self.sequence = 0
        self.last_timestamp = -1
        self._lock = threading.Lock()
    
    def _current_millis(self) -> int:
        return int(time.time() * 1000)
    
    def _wait_next_millis(self, last_timestamp: int) -> int:
        timestamp = self._current_millis()
        while timestamp <= last_timestamp:
            timestamp = self._current_millis()
        return timestamp
    
    def next_id(self) -> int:
        with self._lock:
            timestamp = self._current_millis()
            
            # 时钟回拨检测
            if timestamp < self.last_timestamp:
                raise Exception(
                    f"时钟回拨！拒绝生成ID，"
                    f"回拨了 {self.last_timestamp - timestamp} 毫秒"
                )
            
            if timestamp == self.last_timestamp:
                # 同一毫秒内，序列号递增
                self.sequence = (self.sequence + 1) & self.MAX_SEQUENCE
                if self.sequence == 0:
                    # 序列号用完，等到下一毫秒
                    timestamp = self._wait_next_millis(self.last_timestamp)
            else:
                # 不同毫秒，序列号重置
                self.sequence = 0
            
            self.last_timestamp = timestamp
            
            # 拼装 ID
            snow_id = (
                ((timestamp - self.EPOCH) << self.TIMESTAMP_SHIFT) |
                (self.datacenter_id << self.DATACENTER_ID_SHIFT) |
                (self.worker_id << self.WORKER_ID_SHIFT) |
                self.sequence
            )
            
            return snow_id
    
    def parse_id(self, snow_id: int) -> dict:
        """解析雪花ID，获取各部分信息"""
        sequence = snow_id & self.MAX_SEQUENCE
        worker_id = (snow_id >> self.WORKER_ID_SHIFT) & self.MAX_WORKER_ID
        datacenter_id = (snow_id >> self.DATACENTER_ID_SHIFT) & self.MAX_DATACENTER_ID
        timestamp = (snow_id >> self.TIMESTAMP_SHIFT) + self.EPOCH
        
        return {
            "id": snow_id,
            "timestamp": timestamp,
            "datetime": time.strftime(
                "%Y-%m-%d %H:%M:%S",
                time.localtime(timestamp / 1000)
            ),
            "datacenter_id": datacenter_id,
            "worker_id": worker_id,
            "sequence": sequence,
        }


# ========== 使用演示 ==========
generator = SnowflakeIDGenerator(worker_id=1, datacenter_id=1)

print("生成 5 个雪花 ID：")
ids = []
for i in range(5):
    snow_id = generator.next_id()
    ids.append(snow_id)
    info = generator.parse_id(snow_id)
    print(f"  ID: {snow_id}")
    print(f"     时间: {info['datetime']}")
    print(f"     机器: datacenter={info['datacenter_id']}, worker={info['worker_id']}")
    print(f"     序列: {info['sequence']}")

print(f"\nID 是否递增: {ids == sorted(ids)}")  # True
print(f"ID 是否唯一: {len(set(ids)) == len(ids)}")  # True
```

**雪花算法特性：**

| 特性 | 说明 |
|------|------|
| **全局唯一** | 不同机器/时间不会重复 |
| **趋势递增** | 时间戳在高位，时间越新 ID 越大 |
| **有序** | 适合做主键，减少页分裂 |
| **高性能** | 本地生成，无网络开销，每秒 400 万+ |
| **携带信息** | 可以反解出生成时间、机器 ID |

---

#### 方案三：号段模式

```python
"""
号段模式：从数据库预分配一段 ID

数据库表：
CREATE TABLE id_generator (
    biz_type VARCHAR(32) PRIMARY KEY COMMENT '业务类型',
    max_id BIGINT NOT NULL COMMENT '当前最大 ID',
    step INT NOT NULL DEFAULT 1000 COMMENT '每次分配的步长',
    update_time DATETIME NOT NULL
);

优点：
- 实现简单
- ID 连续（在段内）

缺点：
- 依赖数据库
- 重启会浪费一段 ID
"""
import threading
from sqlalchemy import create_engine, text

class SegmentIDGenerator:
    def __init__(self, biz_type: str, db_url: str):
        self.biz_type = biz_type
        self.engine = create_engine(db_url)
        self._lock = threading.Lock()
        
        self.current_id = 0   # 当前ID
        self.max_id = 0        # 当前段最大ID
    
    def _fetch_new_segment(self):
        """从数据库申请新的号段"""
        with self.engine.connect() as conn:
            # 原子性地更新并获取新段
            conn.execute(
                text("""
                    UPDATE id_generator 
                    SET max_id = max_id + step, 
                        update_time = NOW()
                    WHERE biz_type = :biz_type
                """),
                {"biz_type": self.biz_type}
            )
            result = conn.execute(
                text("""
                    SELECT max_id, step 
                    FROM id_generator 
                    WHERE biz_type = :biz_type
                """),
                {"biz_type": self.biz_type}
            ).fetchone()
            conn.commit()
            
            self.max_id = result.max_id
            self.current_id = result.max_id - result.step
    
    def next_id(self) -> int:
        with self._lock:
            if self.current_id >= self.max_id:
                # 当前段用完，申请新段
                self._fetch_new_segment()
            
            self.current_id += 1
            return self.current_id
```

---

### 6. 分库分表后的常见难题

#### 难题 1：跨分片分页查询

```python
"""
问题：查询第 2 页（每页 10 条），数据分散在 4 个分片

错误做法（性能差）：
- 每个分片取 20 条（前两页）
- 在应用层合并、排序、取第 11~20 条

正确做法（根据场景选择）：
"""

# 方法 1：全局排序（性能差，数据量大时不用）
async def get_orders_page_global(page: int, page_size: int):
    offset = (page - 1) * page_size
    
    # 每个分片都查 offset + page_size 条
    shard_tasks = []
    for shard_id in range(4):
        # 每个分片查 offset + page_size 条
        limit = offset + page_size
        shard_tasks.append(query_shard(shard_id, limit))
    
    # 合并所有分片结果
    all_results = []
    for shard_result in await asyncio.gather(*shard_tasks):
        all_results.extend(shard_result)
    
    # 全局排序，取需要的部分
    all_results.sort(key=lambda x: x['id'], reverse=True)
    return all_results[offset:offset + page_size]

# 方法 2：禁止深翻页（推荐）
# 大多数业务场景，用户不会翻到很深的页
# 限制最大翻页深度（如最多 100 页）
MAX_PAGE = 100

async def get_orders_page_limited(user_id: int, page: int, page_size: int):
    if page > MAX_PAGE:
        raise ValueError(f"最多只能翻到第 {MAX_PAGE} 页")
    
    # 同一用户的订单在同一分片，不需要跨分片
    shard_id = user_id % 4
    offset = (page - 1) * page_size
    return await query_shard_by_user(shard_id, user_id, offset, page_size)

# 方法 3：游标翻页（最推荐）
async def get_orders_by_cursor(user_id: int, last_id: int, page_size: int):
    """
    基于游标（最后一条记录的ID）翻页
    不需要 offset，性能稳定
    """
    shard_id = user_id % 4
    return await query_shard_by_cursor(shard_id, user_id, last_id, page_size)
```

---

#### 难题 2：分布式事务

```python
"""
问题：
用户下单，需要同时操作：
- order_db: 创建订单
- product_db: 扣减库存
- user_db: 扣减余额

这三个操作在不同的数据库！

常见解决方案：
"""

# 方案 1：Saga 模式（最常用）
# 把一个大事务拆成多个本地事务
# 每个本地事务完成后发消息，触发下一个
# 如果某一步失败，执行补偿操作（回滚）

class CreateOrderSaga:
    """
    创建订单的 Saga 流程
    
    正向：创建订单 → 扣库存 → 扣余额
    补偿：取消订单 ← 恢复库存 ← 恢复余额（如果失败）
    """
    
    async def execute(self, order_data: dict) -> bool:
        results = []  # 记录已完成的步骤，用于回滚
        
        try:
            # Step 1: 创建订单
            order_id = await self.create_order(order_data)
            results.append(("order", order_id))
            
            # Step 2: 扣减库存
            await self.deduct_stock(
                order_data["product_id"],
                order_data["quantity"]
            )
            results.append(("stock", order_data["product_id"]))
            
            # Step 3: 扣减余额
            await self.deduct_balance(
                order_data["user_id"],
                order_data["amount"]
            )
            results.append(("balance", order_data["user_id"]))
            
            return True
            
        except Exception as e:
            # 执行补偿操作（逆向回滚）
            await self.compensate(results)
            raise e
    
    async def compensate(self, results: list):
        """补偿：逆序回滚已完成的步骤"""
        for step, data in reversed(results):
            try:
                if step == "balance":
                    await self.restore_balance(data)
                elif step == "stock":
                    await self.restore_stock(data)
                elif step == "order":
                    await self.cancel_order(data)
            except Exception as e:
                # 补偿失败，记录日志，人工处理
                print(f"补偿失败: step={step}, error={e}")


# 方案 2：本地消息表（最可靠）
"""
思路：
1. 在本地数据库建一张消息表
2. 业务操作和消息写入，在同一个本地事务里
3. 后台任务轮询消息表，发送消息到 MQ
4. 消费者处理消息，完成后续步骤
5. 消费者要保证幂等性

优点：不依赖分布式事务，最终一致性可靠
缺点：有一定延迟（不是强一致）
"""
```

---

## 四、缓存架构

### 1. 缓存的三大问题 ★★★

#### 问题一：缓存穿透

```python
"""
缓存穿透：查询一个根本不存在的数据

正常流程：
查缓存 → 未命中 → 查数据库 → 有数据 → 写缓存

缓存穿透：
查缓存 → 未命中 → 查数据库 → 没有数据 → 不写缓存
         下次还是 → 未命中 → 查数据库 → 依然没有
         
恶意攻击：大量查询不存在的ID → 数据库被打爆
"""
import redis
import json
from typing import Optional

redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)

# ❌ 有缓存穿透问题
def get_user_bad(user_id: int) -> Optional[dict]:
    cache_key = f"user:{user_id}"
    
    # 查缓存
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # 查数据库
    user = query_user_from_db(user_id)
    if user:
        redis_client.setex(cache_key, 300, json.dumps(user))
    # 如果 user 是 None，没有写缓存！下次还会查数据库
    
    return user


# ✅ 解决方案 1：缓存空值
def get_user_cache_null(user_id: int) -> Optional[dict]:
    cache_key = f"user:{user_id}"
    
    cached = redis_client.get(cache_key)
    if cached is not None:
        if cached == "null":
            return None  # 缓存的空值
        return json.loads(cached)
    
    user = query_user_from_db(user_id)
    
    if user:
        redis_client.setex(cache_key, 300, json.dumps(user))
    else:
        # 缓存空值，但设置较短的过期时间
        redis_client.setex(cache_key, 60, "null")  # 60秒过期
    
    return user


# ✅ 解决方案 2：布隆过滤器（更优雅）
from pybloom_live import BloomFilter

class BloomFilterUserService:
    def __init__(self):
        # 初始化布隆过滤器，预期元素数量和误判率
        self.bloom = BloomFilter(capacity=10_000_000, error_rate=0.001)
        self._load_all_user_ids()  # 启动时把所有user_id加入布隆过滤器
    
    def _load_all_user_ids(self):
        """把数据库中所有存在的 user_id 加入布隆过滤器"""
        user_ids = query_all_user_ids_from_db()
        for uid in user_ids:
            self.bloom.add(str(uid))
        print(f"布隆过滤器已加载 {len(user_ids)} 个用户ID")
    
    def get_user(self, user_id: int) -> Optional[dict]:
        # 先用布隆过滤器判断
        if str(user_id) not in self.bloom:
            # 布隆过滤器说不存在，一定不存在
            return None  # 直接返回，不查缓存不查数据库
        
        # 布隆过滤器说存在（可能误判），才查缓存和数据库
        cache_key = f"user:{user_id}"
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
        
        user = query_user_from_db(user_id)
        if user:
            redis_client.setex(cache_key, 300, json.dumps(user))
        return user
    
    def add_user(self, user: dict):
        """新增用户时，同时加入布隆过滤器"""
        self.bloom.add(str(user['id']))
        save_user_to_db(user)
```

---

#### 问题二：缓存雪崩

```python
"""
缓存雪崩：大量缓存同时过期 OR 缓存服务宕机

场景：
- 系统启动，批量写入 100 万条缓存，都设置 5 分钟过期
- 5 分钟后，100 万条同时过期
- 瞬间 100 万请求打到数据库 → 数据库宕机

解决方案：
"""

import random
import redis
import json

redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)

# ✅ 方案 1：过期时间加随机抖动
def set_cache_with_jitter(key: str, value: dict, base_ttl: int = 300):
    """
    设置缓存时，在基础过期时间上加随机抖动
    避免大量缓存同时过期
    """
    jitter = random.randint(0, 60)  # 随机 0~60 秒的抖动
    ttl = base_ttl + jitter
    redis_client.setex(key, ttl, json.dumps(value))

# 批量写入 1000 个用户缓存
# 过期时间分散在 300~360 秒之间，不会同时失效
for user_id in range(1000):
    user = {"id": user_id, "name": f"user_{user_id}"}
    set_cache_with_jitter(f"user:{user_id}", user)


# ✅ 方案 2：缓存永不过期 + 异步更新
"""
思路：
- 缓存不设置过期时间（永不过期）
- 在缓存的 value 里记录逻辑过期时间
- 读取时判断是否逻辑过期：
  - 未过期：直接返回
  - 已过期：返回旧值，同时触发异步更新
"""
import asyncio
import time

async def get_with_logical_expiry(key: str, refresh_func, ttl: int):
    cached = redis_client.get(key)
    
    if cached:
        data = json.loads(cached)
        # 判断逻辑过期时间
        if data.get("expire_at", 0) > time.time():
            return data.get("value")  # 未过期，返回数据
        else:
            # 已逻辑过期，触发异步更新，先返回旧值
            asyncio.create_task(refresh_cache(key, refresh_func, ttl))
            return data.get("value")  # 返回旧值，不阻塞
    
    # 缓存不存在，同步获取并写入
    value = await refresh_func()
    expire_at = time.time() + ttl
    redis_client.set(key, json.dumps({
        "value": value,
        "expire_at": expire_at
    }))
    return value

async def refresh_cache(key: str, refresh_func, ttl: int):
    """异步刷新缓存"""
    value = await refresh_func()
    expire_at = time.time() + ttl
    redis_client.set(key, json.dumps({
        "value": value,
        "expire_at": expire_at
    }))


# ✅ 方案 3：缓存集群高可用（根本解决宕机问题）
# Redis Sentinel 或 Redis Cluster
# 即使部分节点宕机，整体服务不受影响
```

---

#### 问题三：缓存击穿

```python
"""
缓存击穿：热点 key 突然过期，大量并发请求同时打到数据库

场景：
- 某个热门商品缓存突然过期
- 100 个并发请求同时发现缓存不存在
- 100 个请求同时查数据库 → 数据库瞬间压力暴增

（与雪崩的区别：雪崩是大量 key 同时失效，击穿是单个热点 key 失效）
"""

import redis
import threading
import json
import time

redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)

# ✅ 解决方案：互斥锁（Mutex Lock）
def get_hot_product(product_id: int) -> dict:
    cache_key = f"product:{product_id}"
    lock_key = f"lock:product:{product_id}"
    
    # 1. 查缓存
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # 2. 缓存不存在，尝试获取锁
    # SET key value NX EX 30 = 原子操作，不存在时设置，30秒过期
    acquired = redis_client.set(lock_key, "1", nx=True, ex=30)
    
    if acquired:
        try:
            # 3. 获取锁成功，查数据库
            # 再次检查缓存（double check，可能锁等待期间其他线程已更新）
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
            
            product = query_product_from_db(product_id)
            if product:
                redis_client.setex(cache_key, 300, json.dumps(product))
            return product
        finally:
            # 4. 释放锁
            redis_client.delete(lock_key)
    else:
        # 5. 未获取到锁，等待后重试
        time.sleep(0.05)  # 等 50ms
        return get_hot_product(product_id)  # 递归重试
```

---

### 2. Python Redis 缓存最佳实践

```python
"""
完整的缓存使用最佳实践
"""
import redis
import json
import functools
import hashlib
from typing import Any, Optional, Callable
import asyncio
import aioredis

# 异步 Redis 客户端
redis_client = aioredis.from_url("redis://localhost:6379", decode_responses=True)

def cache(ttl: int = 300, prefix: str = ""):
    """
    通用缓存装饰器
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存 key
            key_data = f"{prefix}:{func.__name__}:{args}:{kwargs}"
            cache_key = hashlib.md5(key_data.encode()).hexdigest()
            
            # 查缓存
            cached = await redis_client.get(cache_key)
            if cached is not None:
                return json.loads(cached)
            
            # 执行函数
            result = await func(*args, **kwargs)
            
            # 写缓存
            if result is not None:
                await redis_client.setex(
                    cache_key,
                    ttl,
                    json.dumps(result, default=str)
                )
            
            return result
        return wrapper
    return decorator

# 使用缓存装饰器
@cache(ttl=300, prefix="product")
async def get_product(product_id: int) -> dict:
    """获取商品信息（自动缓存 5 分钟）"""
    return await query_product_from_db(product_id)

@cache(ttl=60, prefix="hot_rank")
async def get_hot_ranking() -> list:
    """获取热门排行榜（缓存 1 分钟）"""
    return await query_hot_ranking_from_db()
```

---

## 五、消息队列削峰

### 1. 消息队列的三大作用

```
1. 削峰填谷：流量高峰时，消息队列缓冲请求，保护后端
2. 异步解耦：下单后不同步等待发短信、发邮件，放到队列异步处理
3. 服务解耦：订单系统不直接调用通知系统，通过消息队列解耦
```

### 2. Python 消息队列选型

| 场景 | 推荐 | 理由 |
|------|------|------|
| 简单任务队列 | **Celery + Redis** | 简单易用，Python生态最成熟 |
| 高可靠消息 | **Celery + RabbitMQ** | 消息确认机制完善 |
| 高吞吐日志/流处理 | **Kafka（confluent-kafka）** | 吞吐量极高 |
| 轻量异步任务 | **dramatiq / huey** | 比 Celery 轻 |

---

### 3. Celery 实战（Python 最主流方案）

```python
"""
Celery + Redis 实现异步任务队列
"""

# tasks.py
from celery import Celery
import time
import smtplib
import requests

# 创建 Celery 应用
# broker: 消息队列（Redis）
# backend: 存储任务结果（Redis）
app = Celery(
    'myapp',
    broker='redis://localhost:6379/0',
    backend='redis://localhost:6379/1'
)

# 配置
app.conf.update(
    task_serializer='json',
    result_serializer='json',
    timezone='Asia/Shanghai',
    
    # 任务重试配置
    task_acks_late=True,        # 任务执行完才确认
    task_reject_on_worker_lost=True,
    
    # 队列配置（不同优先级用不同队列）
    task_routes={
        'tasks.send_sms': {'queue': 'high_priority'},
        'tasks.send_email': {'queue': 'normal'},
        'tasks.generate_report': {'queue': 'low_priority'},
    }
)

# ========== 定义任务 ==========

@app.task(
    bind=True,
    max_retries=3,           # 最多重试 3 次
    default_retry_delay=60,  # 重试间隔 60 秒
    queue='high_priority'
)
def send_sms(self, phone: str, content: str):
    """发送短信（高优先级）"""
    try:
        # 调用短信 API
        response = requests.post(
            "https://sms-api.example.com/send",
            json={"phone": phone, "content": content},
            timeout=10
        )
        response.raise_for_status()
        return {"status": "success", "phone": phone}
    except Exception as exc:
        # 失败时重试
        raise self.retry(exc=exc)

@app.task(
    bind=True,
    max_retries=5,
    default_retry_delay=300,  # 5 分钟后重试
    queue='normal'
)
def send_email(self, to_email: str, subject: str, content: str):
    """发送邮件（普通优先级）"""
    try:
        # 发送邮件逻辑
        print(f"发送邮件到 {to_email}: {subject}")
        time.sleep(0.5)  # 模拟发送耗时
        return {"status": "success", "email": to_email}
    except Exception as exc:
        raise self.retry(exc=exc)

@app.task(queue='low_priority')
def generate_report(report_type: str, user_id: int):
    """生成报表（低优先级，耗时任务）"""
    print(f"开始生成 {report_type} 报表，用户 {user_id}")
    time.sleep(30)  # 模拟耗时 30 秒
    return {"status": "done", "file": f"report_{report_type}_{user_id}.xlsx"}
```

```python
# 启动 Worker（命令行）
# celery -A tasks worker --loglevel=info -Q high_priority,normal,low_priority

# main.py（调用方）
from tasks import send_sms, send_email, generate_report

def create_order(order_data: dict):
    """下单接口"""
    # 1. 创建订单（同步）
    order_id = save_order_to_db(order_data)
    
    # 2. 发送短信通知（异步，不阻塞下单流程）
    send_sms.delay(
        phone=order_data['user_phone'],
        content=f"您的订单 {order_id} 已创建成功！"
    )
    
    # 3. 发送邮件（异步）
    send_email.delay(
        to_email=order_data['user_email'],
        subject="订单确认",
        content=f"您的订单 {order_id} 已成功创建"
    )
    
    # 4. 生成订单报表（异步，低优先级）
    generate_report.apply_async(
        args=["order", order_data['user_id']],
        countdown=300  # 5 分钟后执行
    )
    
    # 立即返回，不等异步任务完成
    return {"order_id": order_id, "status": "created"}
```

---

### 4. 消息队列的核心问题

```python
"""
消息队列三大核心问题：
1. 消息丢失
2. 消息重复
3. 消息积压
"""

# ========== 1. 消息不丢失 ==========
# Celery + RabbitMQ 配置，确保消息持久化
app.conf.update(
    # 消息持久化（RabbitMQ 重启后消息不丢）
    task_serializer='json',
    task_acks_late=True,             # 任务完成才 ack，防止执行中宕机丢消息
    task_reject_on_worker_lost=True, # Worker 丢失时，任务重新入队
)


# ========== 2. 消息幂等（防重复消费）==========
import redis
import hashlib

redis_client = redis.Redis(host='localhost', port=6379)

@app.task(bind=True, max_retries=3)
def create_order_idempotent(self, order_data: dict):
    """
    幂等性：同一条消息，执行多次，结果相同
    
    实现：用唯一标识做去重
    """
    # 生成幂等 key
    idempotent_key = f"idempotent:order:{order_data['idempotent_id']}"
    
    # 检查是否已处理过
    if redis_client.exists(idempotent_key):
        print(f"消息已处理过，跳过: {order_data['idempotent_id']}")
        return {"status": "already_processed"}
    
    try:
        # 处理业务逻辑
        order_id = process_order(order_data)
        
        # 标记为已处理（设置 24 小时过期）
        redis_client.setex(idempotent_key, 86400, order_id)
        
        return {"status": "success", "order_id": order_id}
    except Exception as exc:
        raise self.retry(exc=exc)


# ========== 3. 消息积压处理 ==========
"""
消息积压原因：生产速度 > 消费速度

解决方案：
1. 增加消费者数量（横向扩展 Worker）
2. 提升消费者处理速度（优化代码、异步化）
3. 临时扩容（大促期间提前扩容）
"""

# 查看积压情况（Celery 监控）
# celery -A tasks inspect active     # 查看活跃任务
# celery -A tasks inspect reserved   # 查看待处理任务
# flower --app=tasks                 # Web 监控界面
```

---

## 六、完整架构案例：秒杀系统（Python 版）

把本讲所有知识点组合起来，设计一个秒杀系统：

```python
"""
秒杀系统完整架构（Python 版）

架构图：
用户请求
  ↓
Nginx（限流 + 负载均衡）
  ↓
FastAPI 服务（多 Worker + asyncio）
  ↓（先查布隆过滤器）
Redis（库存预热 + 分布式锁）
  ↓（库存扣减成功）
Celery 任务队列
  ↓（异步消费）
MySQL（创建订单）
"""

from fastapi import FastAPI, HTTPException
import aioredis
import asyncio
import json
import time
from celery import Celery

app = FastAPI()

# Redis 连接
redis = aioredis.from_url("redis://localhost:6379", decode_responses=True)

# Celery
celery_app = Celery('seckill', broker='redis://localhost:6379/2')


# ========== 秒杀预热 ==========
async def warmup_seckill(activity_id: int, product_id: int, stock: int):
    """
    秒杀开始前，把库存预热到 Redis
    """
    key = f"seckill:stock:{activity_id}:{product_id}"
    await redis.set(key, stock)
    print(f"秒杀库存预热完成: {key} = {stock}")


# ========== 秒杀接口 ==========
@app.post("/seckill/{activity_id}")
async def seckill(activity_id: int, user_id: int, product_id: int):
    """
    秒杀接口
    
    高并发场景：
    - Nginx 层已做限流
    - 这里用 Redis 原子操作保证库存安全
    - 成功后异步创建订单
    """
    # 1. 防重复提交（同一用户同一活动只能参与一次）
    user_key = f"seckill:user:{activity_id}:{user_id}"
    already_joined = await redis.setnx(user_key, "1")
    if not already_joined:
        raise HTTPException(status_code=400, detail="您已参与过该活动")
    await redis.expire(user_key, 86400)  # 24 小时
    
    # 2. 扣减库存（原子操作）
    stock_key = f"seckill:stock:{activity_id}:{product_id}"
    remaining_stock = await redis.decr(stock_key)
    
    if remaining_stock < 0:
        # 库存不足，回滚用户参与记录
        await redis.incr(stock_key)  # 恢复库存
        await redis.delete(user_key)  # 删除参与记录
        raise HTTPException(status_code=400, detail="库存不足，秒杀失败")
    
    # 3. 库存扣减成功，异步创建订单
    order_data = {
        "activity_id": activity_id,
        "user_id": user_id,
        "product_id": product_id,
        "seckill_time": time.time(),
        "idempotent_id": f"{activity_id}:{user_id}:{product_id}"
    }
    
    # 发送到 Celery 异步创建订单
    celery_app.send_task(
        'tasks.create_seckill_order',
        args=[order_data]
    )
    
    return {
        "status": "success",
        "message": "秒杀成功！订单正在处理中",
        "order_status_url": f"/order/query?user_id={user_id}"
    }


# ========== 查询订单结果 ==========
@app.get("/order/query")
async def query_order(user_id: int):
    """用户轮询订单状态"""
    order_key = f"order:result:{user_id}"
    result = await redis.get(order_key)
    
    if result:
        return json.loads(result)
    else:
        return {"status": "processing", "message": "订单处理中，请稍候"}
```

---

## 七、面试高频题

### 1. 一致性哈希是什么？解决什么问题？

**答题框架：**

**问题：**
- 普通哈希（hash % N）在节点数量变化时，大量 key 的映射改变
- 缓存场景下导致大量缓存失效，数据库被打爆

**一致性哈希：**
- 把节点和 key 都映射到哈希环（0 ~ 2^32）
- key 顺时针找到第一个节点
- 节点变化只影响相邻 key，约 1/N 的 key 变化

**虚拟节点：**
- 每个真实节点映射多个虚拟节点
- 解决数据分布不均（倾斜）问题
- 通常设 100~200 个虚拟节点

---

### 2. 分库分表的分片键怎么选？

**答题框架：**

**原则：**
1. 区分度高（数据分布均匀）
2. 查询频繁（大多数查询带这个字段）
3. 不可变（一旦确定不能改）
4. 符合业务访问模式

**常见选择：**
- 用户系统：按 user_id → 同一用户数据在同一分片
- 订单系统：按 user_id → 查"我的订单"不跨分片
- 消息系统：按 conversation_id → 同一会话在同一分片

**坑点：**
- 不能选可变字段（如状态、时间）
- 不能选区分度低的字段（如性别）
- 选错了后期无法修改，代价极大

---

### 3. 缓存穿透、雪崩、击穿的区别和解决方案？

**答题框架：**

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| **穿透** | 查询不存在的数据，缓存没有，每次都查 DB | 布隆过滤器 / 缓存空值 |
| **雪崩** | 大量缓存同时过期，或缓存服务宕机 | 过期时间加随机抖动 / 集群高可用 |
| **击穿** | 热点 key 过期，大量并发同时打 DB | 互斥锁（分布式锁）/ 永不过期+异步更新 |

---

### 4. 主从延迟如何解决？

**答题框架：**

**原因：**
- MySQL 主从复制是异步的
- 主库写完，从库延迟 ms~s 级才同步

**解决方案：**
1. 强一致性场景（支付、库存）→ 强制读主库
2. 刚写入立刻读 → 标记"读主库"，短时间内读主库
3. 允许延迟的场景 → 读从库
4. 从架构上：半同步复制（牺牲部分写性能，降低延迟）

---

### 5. 如何设计一个高性能的秒杀系统？

**答题框架（四步法）：**

**识别复杂度：**
- 核心：高并发（瞬时峰值）
- 关键：库存不能超卖

**方案设计：**
1. Nginx 层限流（漏桶/令牌桶）
2. 库存预热到 Redis
3. Redis 原子操作扣减库存（DECR）
4. 消息队列异步创建订单
5. 用户轮询结果

**关键细节：**
- 防重复提交：Redis SETNX
- 库存安全：Redis DECR（原子操作）
- 不超卖：DECR 后检查是否 < 0
- 异步解耦：Celery 处理订单创建
- 幂等性：消费端去重

---

## 八、本讲核心要点总结

### 必须记住的 15 条

1. **负载均衡三层：DNS、LVS（四层）、Nginx（七层）**
2. **负载均衡四种算法：轮询、加权轮询、最少连接、一致性哈希**
3. **一致性哈希：节点变化只影响 1/N 的 key，虚拟节点解决倾斜**
4. **读写分离：主库写，从库读，注意主从延迟**
5. **主从延迟解决：强一致场景读主库，其他读从库**
6. **分库分表先尝试：优化索引 → 缓存 → 读写分离 → 才考虑拆**
7. **垂直拆分：按业务拆库、按访问频率拆表**
8. **水平拆分：数据量大时，按分片键分散数据**
9. **分片键选择：区分度高、查询频繁、不可变**
10. **全局 ID：雪花算法（趋势递增、全局唯一、高性能）**
11. **缓存穿透：布隆过滤器或缓存空值**
12. **缓存雪崩：过期时间加随机抖动，或集群高可用**
13. **缓存击穿：分布式互斥锁，或逻辑过期+异步更新**
14. **消息队列三大作用：削峰、异步、解耦**
15. **Python 推荐：FastAPI + Celery + Redis + MySQL（读写分离）**

---

## 九、课后练习

### 练习 1：一致性哈希
运行本讲的一致性哈希代码，观察：
1. 虚拟节点数量对数据分布的影响（试试 10、50、150、300）
2. 添加节点后，受影响的 key 比例

### 练习 2：缓存三大问题
自己实现一个简单的缓存服务，要解决：
1. 用布隆过滤器防止缓存穿透
2. 用随机过期时间防止缓存雪崩
3. 用分布式锁防止缓存击穿

### 练习 3：秒杀系统设计
基于本讲的秒杀系统代码，补充完整：
1. 添加 Celery 消费者（从队列取消息，写入 MySQL）
2. 添加幂等性检查
3. 添加查询订单结果接口

### 练习 4：架构设计
假设你的电商 API 每天处理 1000 万请求：
- 读写比例 8:2
- 数据库有 5000 万条订单
- 高峰 QPS 是均值的 5 倍

请设计完整的架构方案，包括：
1. 部署架构（几台机器、用什么框架）
2. 数据库方案（是否需要分库分表）
3. 缓存方案
4. 预计能扛多少 QPS

---

## 十、下一讲预告

**第 5 讲：可扩展架构模式**

会讲：
- 分层架构
- SOA 架构
- 微服务架构
- 微内核架构
- 架构模式选择
- Python 服务的可扩展设计
- 面试高频题

---

**你想继续第 5 讲，还是对这一讲有疑问？**
