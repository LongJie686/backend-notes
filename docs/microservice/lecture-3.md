# 第 3 讲：服务注册与发现（Python 版）— Consul 实战

这一讲是微服务的"大脑"和"地图"。

微服务拆分后，服务实例会动态变化（扩容、缩容、迁移、故障）。如果不知道服务在哪，通信就无法进行。

这一讲的目标是让你：
- **理解为什么微服务必须要有注册中心**
- **掌握服务注册与发现的完整流程**
- **理解 Consul 的核心架构和原理**
- **能用 Python 接入 Consul 实现服务注册与发现**
- **掌握健康检查机制**
- **理解客户端负载均衡**
- **知道注册中心挂了怎么办**
- **规避大厂常见的注册中心坑点**

---

## 一、为什么微服务需要注册中心？

### 1. 微服务的痛点：服务地址动态变化

在单体架构里，服务地址是固定的：
```python
# 单体架构：数据库地址写死在配置文件里
DATABASE_URL = "mysql://localhost:3306/mydb"
```

但在微服务架构里，问题复杂了：

**场景：**
- 订单服务要调用用户服务
- 用户服务有 3 个实例：`10.0.0.1:8001`、`10.0.0.2:8001`、`10.0.0.3:8001`
- 突然流量暴增，K8s 自动扩容到 5 个实例
- 突然某个实例挂了，K8s 自动重启，IP 变了
- 发布新版本，旧实例下线，新实例上线

**问题：**
- 订单服务怎么知道用户服务的实例列表？
- 实例变化了，订单服务怎么感知？
- 不能把 IP 写死在配置文件里，维护成本太高

---

### 2. 解决方案：服务注册与发现

**核心思想：**
- **服务注册**：服务启动时，把自己的信息（IP、端口、元数据）注册到注册中心
- **服务发现**：调用方从注册中心查询服务列表，动态获取可用实例
- **健康检查**：注册中心定期检查服务是否存活，剔除不可用实例

**架构图：**
```
┌─────────────┐           ┌──────────────────┐
│  User Service│ ───────► │                  │
│  (实例1)     │  注册    │                  │
└─────────────┘           │                  │
┌─────────────┐           │                  │
│  User Service│ ───────► │   Consul 注册中心 │
│  (实例2)     │  注册    │                  │
└─────────────┘           │                  │
┌─────────────┐           │                  │
│  User Service│ ───────► │                  │
│  (实例3)     │  注册    │                  │
└─────────────┘           │                  │
                          │                  │
                          │                  │
                          │◄─────────────────┘
                          │      查询
┌─────────────┐           │
│ Order Service│ ────────►│
│  (调用方)   │           │
└─────────────┘           │
```

---

### 3. 注册中心的核心职责

| 职责 | 说明 |
|------|------|
| **服务注册** | 服务启动时注册信息 |
| **服务发现** | 提供查询接口，返回可用实例列表 |
| **健康检查** | 定期检测服务存活，剔除故障实例 |
| **变更通知** | 服务列表变化时通知调用方（或调用方轮询） |
| **元数据存储** | 存储服务的版本、区域、权重等信息 |

---

## 二、主流注册中心选型

### 1. Consul（推荐）

**特点：**
- HashiCorp 开源
- **CP 架构**（强一致性，基于 Raft 协议）
- 支持多数据中心
- 内置健康检查
- 支持 KV 存储（可做配置中心）
- 有 Web UI
- 多语言支持好

**适用场景：**
- 追求强一致性
- 需要多数据中心支持
- Python/Go 微服务

---

### 2. Etcd

**特点：**
- CoreOS 开源（现 CNCF）
- **CP 架构**（强一致性，基于 Raft 协议）
- Kubernetes 默认注册中心
- 纯 KV 存储，需自己实现服务发现逻辑

**适用场景：**
- Kubernetes 原生应用
- 需要强一致性

---

### 3. Nacos

**特点：**
- 阿里开源
- **AP/CP 可切换**（默认 AP）
- 集配置中心、注册中心于一体
- Spring Cloud 生态最完善
- 有 Web UI

**适用场景：**
- Java/Spring Cloud 生态
- 国内团队多用
- 需要配置中心一体化

---

### 4. Eureka（不推荐）

**特点：**
- Netflix 开源
- **AP 架构**（最终一致性）
- **已停止维护**（Netflix 已停更）
- Spring Cloud Netflix 已进入维护模式

**适用场景：**
- 老项目维护

---

### 选型建议

| 场景 | 推荐 |
|------|------|
| Python/Go 微服务，追求强一致性 | **Consul** |
| Kubernetes 原生应用 | **Etcd** |
| Java/Spring Cloud 生态 | **Nacos** |
| 简单项目，不需要强一致性 | Nacos (AP 模式) |

**本讲重点讲 Consul，因为它在 Python 生态中非常流行。**

---

## 三、Consul 核心架构

### 1. 架构组件

```
┌─────────────────────────────────────────────────────┐
│                  Consul Cluster                     │
├─────────────────────────────────────────────────────┤
│  ┌─────────┐    ┌─────────┐    ┌─────────┐         │
│  │ Server  │    │ Server  │    │ Server  │         │
│  │ (Leader)│◄───│ (Follower)│◄───│ (Follower)│       │
│  └─────────┘    └─────────┘    └─────────┘         │
│       │               │               │             │
│       └───────────────┼───────────────┘             │
│                       │                             │
│              ┌────────▼────────┐                    │
│              │   Raft Log      │                    │
│              │   (数据同步)     │                    │
│              └─────────────────┘                    │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │ Client  │    │ Client  │    │ Client  │
   │ (Agent) │    │ (Agent) │    │ (Agent) │
   └─────────┘    └─────────┘    └─────────┘
        │               │               │
   ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
   │Service A│     │Service B│     │Service C│
   └─────────┘     └─────────┘     └─────────┘
```

**组件说明：**

- **Server**：Consul 服务端，负责存储数据、维护集群状态。建议 3 或 5 个（奇数），通过 Raft 选举 Leader。
- **Client**：Consul 客户端（Agent），运行在每个节点上，负责转发请求、健康检查、服务注册。
- **Raft**：一致性协议，保证数据在多个 Server 间同步。

---

### 2. 数据模型

Consul 存储的服务信息：

```json
{
  "ID": "user-service-1",
  "Name": "user-service",
  "Tags": ["v1", "zone-a"],
  "Address": "10.0.0.1",
  "Port": 8001,
  "Meta": {
    "version": "1.0.0"
  },
  "Check": {
    "HTTP": "http://10.0.0.1:8001/health",
    "Interval": "10s"
  }
}
```

---

### 3. 健康检查机制

Consul 支持多种健康检查方式：

| 类型 | 说明 |
|------|------|
| **HTTP** | 访问 HTTP 接口，返回 2xx 为健康 |
| **TCP** | 尝试 TCP 连接，连通为健康 |
| **Script** | 执行脚本，返回 0 为健康 |
| **TTL** | 服务定期上报心跳，超时为不健康 |
| **gRPC** | gRPC 健康检查协议 |

**推荐：** HTTP 或 gRPC 健康检查。

---

## 四、Consul 实战（Python 版）

### 1. 环境准备

#### 安装 Consul

**方式 1：Docker（推荐）**
```bash
# 开发模式（单节点，不适合生产）
docker run -d --name consul \
  -p 8500:8500 \
  -p 8600:8600/udp \
  consul agent -dev -client=0.0.0.0
```

**方式 2：二进制**
```bash
# 下载 Consul
wget https://releases.hashicorp.com/consul/1.15.0/consul_1.15.0_linux_amd64.zip
unzip consul_1.15.0_linux_amd64.zip
sudo mv consul /usr/local/bin/

# 启动开发模式
consul agent -dev -client=0.0.0.0
```

---

#### 访问 Web UI

```
http://localhost:8500
```

可以看到服务列表、KV 存储、节点状态。

---

### 2. 安装 Python 客户端

```bash
pip install python-consul
```

---

### 3. 服务注册

#### 场景：用户服务启动时注册到 Consul

```python
import consul
import socket
import uuid

# 连接 Consul
consul_client = consul.Consul(host='localhost', port=8500)

# 服务信息
service_name = "user-service"
service_id = f"{service_name}-{uuid.uuid4().hex[:8]}"  # 唯一 ID
service_address = socket.gethostbyname(socket.gethostname())  # 获取本机 IP
service_port = 8001

# 注册服务
consul_client.agent.service.register(
    name=service_name,
    service_id=service_id,
    address=service_address,
    port=service_port,
    tags=["v1", "python"],
    check=consul.Check.http(
        f"http://{service_address}:{service_port}/health",
        interval="10s",  # 检查间隔
        timeout="5s"     # 超时时间
    )
)

print(f"Service registered: {service_id}")
```

---

### 4. 服务发现

#### 场景：订单服务查询用户服务实例

```python
import consul
import random

# 连接 Consul
consul_client = consul.Consul(host='localhost', port=8500)

# 查询服务
def get_service_instances(service_name):
    # 获取健康的服务实例
    index, services = consul_client.health.service(
        service_name,
        passing=True  # 只返回健康的实例
    )

    instances = []
    for service in services:
        instance = {
            'id': service['Service']['ID'],
            'address': service['Service']['Address'],
            'port': service['Service']['Port'],
            'tags': service['Service']['Tags']
        }
        instances.append(instance)

    return instances

# 使用示例
instances = get_service_instances("user-service")

if instances:
    # 简单的负载均衡：随机选择
    instance = random.choice(instances)
    print(f"Selected instance: {instance['address']}:{instance['port']}")

    # 这里可以发起 gRPC 或 HTTP 请求
    # grpc_channel = grpc.insecure_channel(f"{instance['address']}:{instance['port']}")
else:
    print("No healthy instances found")
```

---

### 5. 服务注销

#### 场景：服务优雅关闭时注销

```python
import atexit

# 注册退出处理函数
def deregister_service():
    consul_client.agent.service.deregister(service_id)
    print(f"Service deregistered: {service_id}")

atexit.register(deregister_service)
```

---

### 6. 完整示例：用户服务 + 订单服务

#### 用户服务（服务提供者）

```python
# user_service.py
import consul
import socket
import uuid
import atexit
from flask import Flask, jsonify

app = Flask(__name__)

# Consul 配置
CONSUL_HOST = 'localhost'
CONSUL_PORT = 8500
SERVICE_NAME = 'user-service'
SERVICE_PORT = 8001

# 初始化 Consul 客户端
consul_client = consul.Consul(host=CONSUL_HOST, port=CONSUL_PORT)

# 服务注册
def register_service():
    service_id = f"{SERVICE_NAME}-{uuid.uuid4().hex[:8]}"
    service_address = socket.gethostbyname(socket.gethostname())

    consul_client.agent.service.register(
        name=SERVICE_NAME,
        service_id=service_id,
        address=service_address,
        port=SERVICE_PORT,
        tags=["v1"],
        check=consul.Check.http(
            f"http://{service_address}:{SERVICE_PORT}/health",
            interval="10s",
            timeout="5s"
        )
    )

    # 注册退出处理
    atexit.register(lambda: consul_client.agent.service.deregister(service_id))

    print(f"Registered: {service_id} at {service_address}:{SERVICE_PORT}")
    return service_id

# 健康检查端点
@app.route('/health')
def health():
    return jsonify({"status": "healthy"})

# 业务接口
@app.route('/users/<user_id>')
def get_user(user_id):
    return jsonify({
        "id": user_id,
        "name": f"User{user_id}",
        "email": f"user{user_id}@example.com"
    })

if __name__ == '__main__':
    register_service()
    app.run(host='0.0.0.0', port=SERVICE_PORT)
```

---

#### 订单服务（服务调用者）

```python
# order_service.py
import consul
import random
import requests

# Consul 配置
CONSUL_HOST = 'localhost'
CONSUL_PORT = 8500
USER_SERVICE_NAME = 'user-service'

consul_client = consul.Consul(host=CONSUL_HOST, port=CONSUL_PORT)

def get_user_service_url():
    """服务发现：获取用户服务地址"""
    index, services = consul_client.health.service(
        USER_SERVICE_NAME,
        passing=True
    )

    if not services:
        raise Exception("No healthy user-service instances")

    # 简单的负载均衡：随机选择
    service = random.choice(services)
    address = service['Service']['Address']
    port = service['Service']['Port']

    return f"http://{address}:{port}"

def get_user(user_id):
    """调用用户服务"""
    base_url = get_user_service_url()
    url = f"{base_url}/users/{user_id}"

    response = requests.get(url, timeout=3)
    return response.json()

# 使用示例
if __name__ == '__main__':
    try:
        user = get_user("123")
        print(f"User: {user}")
    except Exception as e:
        print(f"Error: {e}")
```

---

## 五、客户端负载均衡

### 1. 什么是客户端负载均衡？

**服务端负载均衡：**
```
Client → Nginx/LB → Service A
                → Service B
```
- 由独立的 LB（如 Nginx）分发流量
- 客户端不知道后端有多少实例

**客户端负载均衡：**
```
Client → 查询 Consul → 获取实例列表
         → 自己选择实例 → 直接调用
```
- 客户端从注册中心获取实例列表
- 客户端自己选择实例（随机、轮询、加权）
- 客户端直接调用服务，无中间代理

**优缺点：**

| 方式 | 优点 | 缺点 |
|------|------|------|
| 服务端 LB | 客户端简单，统一管理 | LB 成为单点，性能瓶颈 |
| 客户端 LB | 无单点，性能好，直连 | 客户端逻辑复杂，需感知注册中心 |

**微服务常用：** 客户端负载均衡（配合注册中心）

---

### 2. 负载均衡策略

```python
import random

class LoadBalancer:
    """负载均衡器"""

    def __init__(self, instances):
        self.instances = instances
        self.index = 0

    def random(self):
        """随机"""
        return random.choice(self.instances)

    def round_robin(self):
        """轮询"""
        instance = self.instances[self.index]
        self.index = (self.index + 1) % len(self.instances)
        return instance

    def weighted(self, weights):
        """加权轮询"""
        # weights: {'instance_id': weight}
        pass

    def consistent_hash(self, key):
        """一致性哈希"""
        # 相同 key 始终路由到同一实例
        pass
```

---

### 3. 实战：带负载均衡的服务调用

```python
import consul
import random

class ServiceClient:
    """带服务发现和负载均衡的客户端"""

    def __init__(self, consul_host='localhost', consul_port=8500):
        self.consul = consul.Consul(host=consul_host, port=consul_port)
        self.cache = {}  # 本地缓存
        self.cache_ttl = 30  # 缓存 30 秒

    def get_instances(self, service_name):
        """获取服务实例（带缓存）"""
        import time

        # 检查缓存
        if service_name in self.cache:
            cached_time, instances = self.cache[service_name]
            if time.time() - cached_time < self.cache_ttl:
                return instances

        # 查询 Consul
        index, services = self.consul.health.service(
            service_name,
            passing=True
        )

        instances = [
            {
                'address': s['Service']['Address'],
                'port': s['Service']['Port'],
                'id': s['Service']['ID']
            }
            for s in services
        ]

        # 更新缓存
        self.cache[service_name] = (time.time(), instances)

        return instances

    def call_service(self, service_name, path, method='GET', **kwargs):
        """调用服务"""
        instances = self.get_instances(service_name)

        if not instances:
            raise Exception(f"No healthy instances for {service_name}")

        # 随机负载均衡
        instance = random.choice(instances)

        url = f"http://{instance['address']}:{instance['port']}{path}"

        # 发起请求
        if method == 'GET':
            response = requests.get(url, **kwargs)
        elif method == 'POST':
            response = requests.post(url, **kwargs)

        return response.json()

# 使用
client = ServiceClient()
user = client.call_service('user-service', '/users/123')
```

---

## 六、注册中心挂了怎么办？

### 1. 问题分析

如果 Consul 挂了：
- 新服务无法注册
- 服务无法发现新实例
- **但已有的服务调用不受影响**（如果有本地缓存）

---

### 2. 解决方案

#### 方案 1：Consul 集群高可用

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
    ┌──▼──┐
    │Consul│  (3-5 个 Server 组成集群)
    │Cluster│
    └──────┘
```

- 部署 3 或 5 个 Server 节点
- 通过 Raft 选举 Leader
- 只要超过半数节点存活，集群可用

---

#### 方案 2：客户端本地缓存

**原理：**
- 客户端缓存服务列表
- Consul 挂了时，使用缓存
- 定期后台刷新缓存

**代码实现：**（上面的 `ServiceClient` 已实现缓存）

```python
def get_instances(self, service_name):
    # 1. 先查缓存
    # 2. 缓存过期，查 Consul
    # 3. Consul 挂了，返回缓存（如果有）
    # 4. 都没有，抛异常
```

---

#### 方案 3：多注册中心

```
Client → Consul (主)
     ↘
      → Etcd (备)
```

- 同时连接多个注册中心
- 一个挂了，用另一个

---

### 3. 最佳实践

1. **Consul 集群部署**：至少 3 个 Server 节点
2. **客户端缓存**：必须有本地缓存，防止注册中心抖动影响业务
3. **优雅降级**：注册中心不可用时，使用缓存或静态配置
4. **监控告警**：监控 Consul 集群状态

---

## 七、大厂常见注册中心坑点

### 坑点 1：健康检查不准确

**问题：**
- 服务进程在，但业务逻辑挂了（如数据库连接断了）
- 健康检查只检查进程存活，返回健康
- 流量路由到故障实例

**正确做法：**
```python
@app.route('/health')
def health():
    # 检查数据库连接
    if not db.is_connected():
        return jsonify({"status": "unhealthy"}), 503

    # 检查依赖服务
    if not check_dependencies():
        return jsonify({"status": "unhealthy"}), 503

    return jsonify({"status": "healthy"})
```

---

### 坑点 2：服务注册风暴

**场景：**
- Consul 重启
- 所有服务同时重新注册
- Consul 被打挂

**正确做法：**
- 服务启动时随机延迟注册（0~30 秒）
- Consul 限流配置

---

### 坑点 3：缓存过期时间设置不当

**问题：**
- 缓存时间太长：服务下线了，客户端还在调
- 缓存时间太短：频繁查询 Consul，压力大

**建议：**
- 缓存 TTL：10~30 秒
- 后台异步刷新

---

### 坑点 4：没有处理空列表

**问题：**
```python
instances = get_instances("user-service")
instance = random.choice(instances)  # 如果 instances 为空，直接崩
```

**正确做法：**
```python
instances = get_instances("user-service")
if not instances:
    # 降级：返回默认值、抛异常、使用静态配置
    raise ServiceUnavailableException()
```

---

### 坑点 5：网络分区导致脑裂

**场景：**
- Consul 集群网络分区
- 出现两个 Leader
- 数据不一致

**预防：**
- Consul Server 部署在同一网络段
- 使用奇数个节点（3 或 5）
- 监控集群状态

---

## 八、面试高频题（这一讲相关）

### 1. 为什么微服务需要注册中心？

**参考答案：**

微服务拆分后，服务实例动态变化（扩容、缩容、故障、迁移），IP 和端口不固定。注册中心解决：
1. **服务注册**：服务启动时自动注册
2. **服务发现**：调用方动态获取实例列表
3. **健康检查**：剔除故障实例
4. **元数据管理**：存储服务版本、区域等信息

---

### 2. Consul 和 Eureka 的区别？

| 维度 | Consul | Eureka |
|------|--------|--------|
| 一致性 | CP（强一致性） | AP（最终一致性） |
| 协议 | Raft | 自己实现 |
| 语言支持 | 多语言 | Java 为主 |
| 健康检查 | 丰富（HTTP/TCP/Script/TTL） | 简单 |
| 状态 | 活跃维护 | 已停更 |
| KV 存储 | 支持 | 不支持 |

**选型建议：** 追求强一致性选 Consul，Java 生态且能接受最终一致性可选 Nacos。

---

### 3. 服务注册与发现的流程？

**参考答案：**

1. **服务启动**：向注册中心发送注册请求（IP、端口、元数据）
2. **健康检查**：注册中心定期检查服务健康状态
3. **服务发现**：调用方查询注册中心，获取健康实例列表
4. **负载均衡**：调用方选择实例发起调用
5. **服务下线**：服务关闭时注销，或健康检查失败被剔除

---

### 4. 客户端负载均衡和服务端负载均衡的区别？

**参考答案：**

| 维度 | 客户端 LB | 服务端 LB |
|------|----------|----------|
| 架构 | 客户端直接调用服务 | 通过中间代理（Nginx） |
| 服务发现 | 客户端从注册中心获取 | LB 从注册中心获取 |
| 优点 | 无单点，性能好 | 客户端简单 |
| 缺点 | 客户端逻辑复杂 | LB 成为瓶颈 |

**微服务常用：** 客户端负载均衡。

---

### 5. 注册中心挂了怎么办？

**参考答案：**

1. **集群部署**：Consul 部署 3~5 个 Server，保证高可用
2. **客户端缓存**：本地缓存服务列表，注册中心挂了用缓存
3. **优雅降级**：缓存也没了，使用静态配置或熔断
4. **监控告警**：及时发现并处理

---

### 6. 怎么保证服务注册的准确性？

**参考答案：**

1. **健康检查**：不仅检查进程，还要检查业务依赖（数据库、下游服务）
2. **优雅注销**：服务关闭时主动注销，避免僵尸实例
3. **TTL 机制**：服务定期上报心跳，超时自动剔除
4. **防抖动**：避免网络抖动导致频繁上下线

---

## 九、这一讲你必须记住的核心结论

1. **微服务必须要有注册中心**，解决服务地址动态变化问题
2. **Consul 是 CP 架构**，追求强一致性，适合 Python/Go 微服务
3. **服务注册**：启动时注册，关闭时注销
4. **服务发现**：查询健康实例列表
5. **健康检查**：必须检查业务依赖，不仅是进程
6. **客户端负载均衡**：微服务常用，客户端直接选择实例调用
7. **本地缓存**：必须有，防止注册中心故障影响业务
8. **Consul 集群**：生产环境至少 3 个 Server 节点
9. **常见坑**：健康检查不准、注册风暴、缓存设置不当
10. **选型**：Python 推荐 Consul，K8s 原生推荐 Etcd，Java 推荐 Nacos

---

## 十、这一讲的练习题

### 练习 1：完善健康检查

**要求：**
修改用户服务的 `/health` 接口，检查：
1. 数据库连接是否正常
2. Redis 连接是否正常
3. 磁盘空间是否充足

如果任何一项失败，返回 503。

---

### 练习 2：实现加权负载均衡

**要求：**
实现一个加权轮询负载均衡器：
- 实例 A 权重 3
- 实例 B 权重 1
- 4 次请求中，A 被选 3 次，B 被选 1 次

---

### 练习 3：模拟注册中心故障

**要求：**
1. 启动 Consul、用户服务、订单服务
2. 停止 Consul
3. 观察订单服务的表现（应该能用缓存继续调用一段时间）
4. 重启 Consul，观察服务是否自动恢复

---

## 十一、下一讲预告

下一讲我们进入微服务的"保护伞"：

**第 4 讲：服务治理（Python 版）— 限流、熔断、降级实战**

会讲：
- 为什么需要服务治理？
- 服务限流：令牌桶、漏桶算法实战
- 服务熔断：熔断器状态机
- 服务降级：返回默认值、降级策略
- Python 限流库：ratelimit
- Python 熔断库：pybreaker
- 超时控制与重试机制
- 幂等性设计
- 大厂常见服务治理坑点
