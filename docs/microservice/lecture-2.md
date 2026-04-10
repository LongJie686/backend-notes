# L2: 服务通信与 RPC 框架 -- gRPC + Protobuf 实战

> 微服务拆分后，服务间必须通信。通信方式选错了，整个系统的性能、可维护性都会受影响。

---

## 核心结论（10 条必记）

1. **REST 适合对外 API，gRPC 适合内部服务间通信**
2. **gRPC 性能比 REST 高 3~5 倍**（HTTP/2 + Protobuf 二进制）
3. **Protobuf 是强类型二进制协议**，体积小 3~10 倍，序列化快 5~10 倍
4. **gRPC 有 4 种通信模式**：Unary、Server Streaming、Client Streaming、双向流
5. **必须设置超时**，否则调用方线程阻塞、资源耗尽
6. **重试要判断是否可重试**，非幂等接口不能盲目重试
7. **Protobuf 字段编号一旦分配不能改**，要用 `reserved` 保留
8. **gRPC 连接要复用**，不要频繁创建/销毁
9. **必须有错误处理和降级逻辑**，网络分区是常态
10. **生产环境必须接入监控和链路追踪**

---

## 一、服务间通信：REST vs RPC

### 什么是服务间通信？

微服务拆分后，服务 A 要调用服务 B，有两种主流方式：

| 方式 | 代表技术 | 特点 |
|------|---------|------|
| **同步通信** | HTTP REST、gRPC | 调用方等待结果返回 |
| **异步通信** | 消息队列（RabbitMQ、Kafka） | 调用方不等待，通过消息传递 |

这一讲先讲**同步通信**，异步通信后续章节会讲。

---

### HTTP REST 通信

**REST（Representational State Transfer）**：基于 HTTP 协议的 API 设计风格。

- 基于 HTTP/1.1
- 使用标准 HTTP 方法：GET、POST、PUT、DELETE
- 数据格式通常是 JSON
- URL 代表资源

```python
# 用户服务提供 REST API
GET    /users/123        # 查询用户
POST   /users            # 创建用户
PUT    /users/123        # 更新用户
DELETE /users/123        # 删除用户

# 订单服务调用用户服务
import requests
response = requests.get('http://user-service:8000/users/123')
user = response.json()
```

**REST 的优缺点：**

| 优点 | 缺点 |
|------|------|
| 简单直观，人人都懂 | HTTP/1.1 头部冗余，性能一般 |
| 跨语言，工具丰富 | JSON 序列化/反序列化慢 |
| 浏览器友好 | 没有强制的接口契约 |
| Postman/curl 都能测试 | 不支持流式传输 |

---

### RPC 通信

**RPC（Remote Procedure Call，远程过程调用）**：让远程服务调用像本地函数调用一样。

```python
# 本地调用
result = calculate_sum(1, 2)

# RPC 调用（看起来一样，但实际是网络调用）
result = rpc_client.calculate_sum(1, 2)
```

**背后发生了什么：**

```
1. 客户端序列化参数 (1, 2)
2. 通过网络发送到服务端
3. 服务端反序列化参数
4. 服务端执行 calculate_sum(1, 2)
5. 服务端序列化结果
6. 通过网络返回给客户端
7. 客户端反序列化结果
```

**主流 RPC 框架：**

| 框架 | 语言 | 特点 |
|------|------|------|
| **gRPC** | 跨语言 | Google 开源，HTTP/2 + Protobuf，性能高 |
| **Thrift** | 跨语言 | Facebook 开源，支持多种序列化格式 |
| **Dubbo** | Java | 阿里开源，Java 生态最流行 |
| **Nameko** | Python | Python 微服务框架，基于 RabbitMQ |

---

### REST vs RPC 对比

| 维度 | REST | RPC (gRPC) |
|------|------|-----------|
| 协议 | HTTP/1.1 | HTTP/2 |
| 数据格式 | JSON（文本） | Protobuf（二进制） |
| 性能 | 一般 | 高 |
| 接口定义 | 不强制 | 强制（.proto 文件） |
| 类型安全 | 弱 | 强 |
| 流式传输 | 不支持 | 支持 |
| 浏览器支持 | 好 | 差（需要 gRPC-Web） |

### 什么时候用 REST，什么时候用 RPC？

| 场景 | 推荐 |
|------|------|
| 对外开放 API、前端调用 | REST |
| 内部管理系统、性能要求不高 | REST |
| 微服务间内部通信 | gRPC |
| 需要类型安全、减少接口错误 | gRPC |
| 需要流式传输、实时推送 | gRPC |
| 跨语言团队（Python + Go + Java） | gRPC |

**大厂实践：对外 API 用 REST（或 GraphQL），内部服务间用 gRPC。**

---

## 二、为什么 Python 微服务推荐 gRPC？

### Python REST 的问题

Python 常用 REST 框架（Flask、FastAPI、DRF）共同的问题：
- JSON 序列化/反序列化慢
- 没有强类型约束，容易出错
- HTTP/1.1 性能瓶颈

### gRPC 的优势

**优势 1：性能高**

```
REST (JSON)：   10000 次请求，耗时 8.2 秒
gRPC (Protobuf)：10000 次请求，耗时 2.1 秒
快 4 倍
```

原因：Protobuf 二进制格式体积比 JSON 小 3~10 倍，HTTP/2 多路复用减少连接开销。

**优势 2：强类型，接口定义规范**

REST 的问题：调用方不知道返回什么字段。

gRPC 用 .proto 文件强制定义接口，自动生成类型安全的 Python 代码，IDE 支持自动补全。

**优势 3：支持 4 种流式传输模式**

Unary（请求-响应）、Server Streaming（实时推送）、Client Streaming（文件上传）、双向流（聊天系统）。

**优势 4：跨语言支持好**

Python、Java、Go、C++、Node.js 等官方支持，混合语言团队无缝互调。

### gRPC 的缺点

- 学习曲线稍高（要学 Protobuf）
- 浏览器支持差（需要 gRPC-Web）
- 调试不如 REST 直观（不能直接 curl）
- 生态不如 REST 丰富

---

## 三、Protobuf 详解

### 什么是 Protobuf？

**Protobuf（Protocol Buffers）**：Google 开源的序列化协议。二进制格式、体积小、序列化快、跨语言、强类型。

### Protobuf vs JSON

```json
// JSON：约 80 字节
{"id": "12345", "name": "Alice", "email": "alice@example.com", "age": 30}
```

```protobuf
// Protobuf：约 25 字节（序列化后的二进制）
message User {
  string id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
}
```

Protobuf 体积是 JSON 的 **1/3**，序列化速度快 **5~10 倍**。

### Protobuf 语法基础

#### 定义消息

```protobuf
syntax = "proto3";

message User {
  string id = 1;        // 字段类型 字段名 = 字段编号
  string name = 2;
  string email = 3;
  int32 age = 4;
  bool is_active = 5;
}
```

字段编号的作用：序列化时用编号代替字段名。编号 1~15 只占 1 字节，高频字段用这个范围。

#### 基本数据类型

| Protobuf 类型 | Python 类型 | 说明 |
|--------------|------------|------|
| `double` | float | 双精度浮点 |
| `float` | float | 单精度浮点 |
| `int32` | int | 32 位整数 |
| `int64` | int | 64 位整数 |
| `bool` | bool | 布尔 |
| `string` | str | 字符串（UTF-8） |
| `bytes` | bytes | 二进制数据 |

#### 嵌套消息、枚举、Map

```protobuf
// 嵌套消息
message Order {
  string id = 1;
  User user = 2;
  repeated OrderItem items = 3;  // repeated = 数组/列表
}

message OrderItem {
  string product_id = 1;
  int32 quantity = 2;
  float price = 3;
}

// 枚举（必须从 0 开始）
enum OrderStatus {
  PENDING = 0;
  PAID = 1;
  SHIPPED = 2;
  COMPLETED = 3;
  CANCELLED = 4;
}

// Map（Python 里映射成 dict）
message Product {
  string id = 1;
  map<string, string> attributes = 2;
}
```

### 定义服务接口

```protobuf
syntax = "proto3";

message GetUserRequest {
  string user_id = 1;
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
}

service UserService {
  // Unary（一元）
  rpc GetUser(GetUserRequest) returns (User);

  // Server Streaming
  rpc ListUsers(ListUsersRequest) returns (stream User);
}
```

---

## 四、gRPC 实战：搭建第一个服务

### 环境准备

```bash
pip install grpcio grpcio-tools
```

### 项目结构

```
grpc-demo/
  protos/
    user.proto           # Protobuf 定义
  generated/             # 自动生成的代码
    user_pb2.py
    user_pb2_grpc.py
  user_service.py        # 服务端
  user_client.py         # 客户端
```

### 定义 Protobuf

**`protos/user.proto`：**

```protobuf
syntax = "proto3";

package user;

message GetUserRequest {
  string user_id = 1;
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
  int32 age = 3;
}

message CreateUserResponse {
  User user = 1;
  bool success = 2;
  string message = 3;
}

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc CreateUser(CreateUserRequest) returns (CreateUserResponse);
}
```

### 生成 Python 代码

```bash
python -m grpc_tools.protoc \
  -I./protos \
  --python_out=./generated \
  --grpc_python_out=./generated \
  ./protos/user.proto
```

### 实现服务端

**`user_service.py`：**

```python
import grpc
from concurrent import futures
import time
import sys

sys.path.append('./generated')
import user_pb2
import user_pb2_grpc


class UserService(user_pb2_grpc.UserServiceServicer):

    def __init__(self):
        self.users = {
            "1": user_pb2.User(id="1", name="Alice", email="alice@example.com", age=30),
            "2": user_pb2.User(id="2", name="Bob", email="bob@example.com", age=25),
        }
        self.next_id = 3

    def GetUser(self, request, context):
        user_id = request.user_id
        user = self.users.get(user_id)
        if user:
            return user
        context.set_code(grpc.StatusCode.NOT_FOUND)
        context.set_details(f'User {user_id} not found')
        return user_pb2.User()

    def CreateUser(self, request, context):
        user_id = str(self.next_id)
        self.next_id += 1
        user = user_pb2.User(
            id=user_id, name=request.name,
            email=request.email, age=request.age
        )
        self.users[user_id] = user
        return user_pb2.CreateUserResponse(
            user=user, success=True,
            message="User created successfully"
        )


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    user_pb2_grpc.add_UserServiceServicer_to_server(UserService(), server)
    server.add_insecure_port('[::]:50051')
    print("gRPC server started on port 50051")
    server.start()
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(0)


if __name__ == '__main__':
    serve()
```

### 实现客户端

**`user_client.py`：**

```python
import grpc
import sys

sys.path.append('./generated')
import user_pb2
import user_pb2_grpc


def run():
    with grpc.insecure_channel('localhost:50051') as channel:
        stub = user_pb2_grpc.UserServiceStub(channel)

        # 查询用户
        print("=== Test 1: GetUser ===")
        try:
            user = stub.GetUser(user_pb2.GetUserRequest(user_id="1"))
            print(f"User found: {user.name}, {user.email}, age {user.age}")
        except grpc.RpcError as e:
            print(f"Error: {e.code()}, {e.details()}")

        # 创建用户
        print("\n=== Test 2: CreateUser ===")
        response = stub.CreateUser(user_pb2.CreateUserRequest(
            name="Charlie", email="charlie@example.com", age=28
        ))
        if response.success:
            print(f"User created: {response.user.id}, {response.user.name}")

        # 查询不存在的用户
        print("\n=== Test 3: GetUser (not found) ===")
        try:
            user = stub.GetUser(user_pb2.GetUserRequest(user_id="999"))
            print(f"User found: {user.name}")
        except grpc.RpcError as e:
            print(f"Error: {e.code()}, {e.details()}")


if __name__ == '__main__':
    run()
```

### 运行

```bash
# 终端 1：启动服务端
python user_service.py

# 终端 2：运行客户端
python user_client.py
```

**输出：**

```
=== Test 1: GetUser ===
User found: Alice, alice@example.com, age 30

=== Test 2: CreateUser ===
User created: 3, Charlie

=== Test 3: GetUser (not found) ===
Error: StatusCode.NOT_FOUND, User 999 not found
```

---

## 五、gRPC 的四种通信模式

### 1. Unary RPC（一元）

```protobuf
rpc GetUser(GetUserRequest) returns (User);
```

客户端发一个请求，服务端返回一个响应。和 HTTP REST 类似。（上面的示例已实现）

### 2. Server Streaming RPC（服务端流式）

```protobuf
rpc ListUsers(ListUsersRequest) returns (stream User);
```

客户端发一个请求，服务端返回多个响应（流式）。

**应用场景：** 分页数据推送、实时日志推送、文件下载

**服务端：**

```python
def ListUsers(self, request, context):
    for user in self.users.values():
        yield user  # 使用 yield 返回流
        time.sleep(0.5)  # 模拟延迟
```

**客户端：**

```python
users_stream = stub.ListUsers(user_pb2.ListUsersRequest())
for user in users_stream:
    print(f"Received user: {user.name}")
```

### 3. Client Streaming RPC（客户端流式）

```protobuf
rpc CreateUsers(stream CreateUserRequest) returns (CreateUsersResponse);
```

客户端发送多个请求（流式），服务端返回一个响应。

**应用场景：** 批量数据上传、文件上传

**服务端：**

```python
def CreateUsers(self, request_iterator, context):
    count = 0
    for request in request_iterator:
        user_id = str(self.next_id)
        self.next_id += 1
        user = user_pb2.User(
            id=user_id, name=request.name,
            email=request.email, age=request.age
        )
        self.users[user_id] = user
        count += 1
    return user_pb2.CreateUsersResponse(
        count=count, message=f"{count} users created"
    )
```

**客户端：**

```python
def generate_requests():
    for i in range(5):
        yield user_pb2.CreateUserRequest(
            name=f"User{i}", email=f"user{i}@example.com", age=20 + i
        )

response = stub.CreateUsers(generate_requests())
print(f"Result: {response.message}")
```

### 4. Bidirectional Streaming RPC（双向流）

```protobuf
rpc Chat(stream ChatMessage) returns (stream ChatMessage);
```

客户端和服务端都可以流式发送数据，双向独立。

**应用场景：** 聊天系统、实时协作、游戏服务器

**服务端：**

```python
def Chat(self, request_iterator, context):
    for message in request_iterator:
        yield user_pb2.ChatMessage(content=f"Echo: {message.content}")
```

**客户端：**

```python
def generate_messages():
    for msg in ["Hello", "How are you?", "Bye"]:
        yield user_pb2.ChatMessage(content=msg)
        time.sleep(1)

responses = stub.Chat(generate_messages())
for response in responses:
    print(f"Server: {response.content}")
```

---

## 六、gRPC 错误处理、超时、重试

### 错误处理

**服务端抛出错误：**

```python
def GetUser(self, request, context):
    if request.user_id not in self.users:
        context.set_code(grpc.StatusCode.NOT_FOUND)
        context.set_details(f'User {request.user_id} not found')
        return user_pb2.User()
    return self.users[request.user_id]
```

**客户端捕获错误：**

```python
try:
    user = stub.GetUser(request)
except grpc.RpcError as e:
    print(f"Error code: {e.code()}")
    print(f"Error details: {e.details()}")
```

**gRPC 常用错误码：**

| 错误码 | 说明 |
|--------|------|
| `OK` | 成功 |
| `CANCELLED` | 操作被取消 |
| `INVALID_ARGUMENT` | 参数无效 |
| `NOT_FOUND` | 资源不存在 |
| `PERMISSION_DENIED` | 权限不足 |
| `UNAUTHENTICATED` | 未认证 |
| `RESOURCE_EXHAUSTED` | 资源耗尽（限流） |
| `UNAVAILABLE` | 服务不可用 |
| `INTERNAL` | 内部错误 |
| `DEADLINE_EXCEEDED` | 超时 |

### 超时控制

```python
# 设置超时 3 秒
try:
    user = stub.GetUser(request, timeout=3)
except grpc.RpcError as e:
    if e.code() == grpc.StatusCode.DEADLINE_EXCEEDED:
        print("Request timeout!")
```

### 重试机制

**手动重试（推荐，控制精确）：**

```python
retryable_codes = [
    grpc.StatusCode.UNAVAILABLE,
    grpc.StatusCode.DEADLINE_EXCEEDED
]

for i in range(3):
    try:
        user = stub.GetUser(request, timeout=3)
        break
    except grpc.RpcError as e:
        if e.code() not in retryable_codes:
            raise  # 不可重试的错误直接抛出
        if i == 2:
            raise
        time.sleep(1)
```

**gRPC 内置重试策略：**

```python
retry_config = {
    "methodConfig": [{
        "name": [{"service": "user.UserService"}],
        "retryPolicy": {
            "maxAttempts": 3,
            "initialBackoff": "0.1s",
            "maxBackoff": "1s",
            "backoffMultiplier": 2,
            "retryableStatusCodes": ["UNAVAILABLE"]
        }
    }]
}

channel = grpc.insecure_channel(
    'localhost:50051',
    options=[('grpc.service_config', json.dumps(retry_config))]
)
```

---

## 七、gRPC vs REST 性能对比实验

### 实验设计

场景：查询用户信息 10000 次。

**REST 版本（FastAPI）：**

```python
# 服务端
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class User(BaseModel):
    id: str
    name: str
    email: str
    age: int

users = {"1": User(id="1", name="Alice", email="alice@example.com", age=30)}

@app.get("/users/{user_id}")
def get_user(user_id: str):
    return users.get(user_id)
```

```python
# 客户端
import requests, time

start = time.time()
for i in range(10000):
    response = requests.get('http://localhost:8000/users/1')
    user = response.json()
print(f"REST: {time.time() - start:.2f} seconds")
```

**gRPC 版本：**

```python
import time

start = time.time()
for i in range(10000):
    user = stub.GetUser(user_pb2.GetUserRequest(user_id="1"))
print(f"gRPC: {time.time() - start:.2f} seconds")
```

### 实验结果

| 方式 | 10000 次请求耗时 | 性能 |
|------|-----------------|------|
| REST (FastAPI + JSON) | 8.2 秒 | 基准 |
| gRPC (Protobuf) | 2.1 秒 | **快 4 倍** |

---

## 八、大厂常见的 RPC 坑点

### 坑点 1：不做超时控制

```python
# 错误：没有超时，服务端挂了会一直等
user = stub.GetUser(request)

# 正确
user = stub.GetUser(request, timeout=3)
```

### 坑点 2：盲目重试

```python
# 错误：不管什么错误都重试，参数错误也重试浪费资源
for i in range(3):
    try:
        user = stub.GetUser(request)
        break
    except:
        pass

# 正确：只重试特定错误
retryable_codes = [grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED]
for i in range(3):
    try:
        user = stub.GetUser(request)
        break
    except grpc.RpcError as e:
        if e.code() not in retryable_codes:
            raise
```

### 坑点 3：Protobuf 字段编号冲突

```protobuf
// 错误：编号 2 被复用了，老版本客户端解析出错
message User {
  string id = 1;
  string email = 2;  // 之前是 name
  string name = 3;
}

// 正确：用 reserved 保留编号
message User {
  string id = 1;
  reserved 2;
  string name = 3;
  string email = 4;
}
```

### 坑点 4：忘记处理网络分区

```python
# 错误：没有处理 UNAVAILABLE
user = stub.GetUser(request)

# 正确：降级处理
try:
    user = stub.GetUser(request, timeout=3)
except grpc.RpcError as e:
    if e.code() == grpc.StatusCode.UNAVAILABLE:
        user = get_user_from_cache(user_id)  # 降级
    else:
        raise
```

### 坑点 5：连接池管理不当

```python
# 错误：每次调用都创建新连接
def call_service():
    channel = grpc.insecure_channel('localhost:50051')
    stub = user_pb2_grpc.UserServiceStub(channel)
    user = stub.GetUser(request)
    channel.close()

# 正确：全局复用连接
channel = grpc.insecure_channel('localhost:50051')
stub = user_pb2_grpc.UserServiceStub(channel)
```

### 坑点 6：没有监控和链路追踪

- 不知道哪个 RPC 调用慢了
- 调用链路不清楚
- 接入 OpenTelemetry（后续章节讲）

---

## 九、面试高频题

### Q1：REST 和 RPC 有什么区别？

| 维度 | REST | RPC |
|------|------|-----|
| 协议 | HTTP/1.1 | HTTP/2 (gRPC) |
| 数据格式 | JSON（文本） | Protobuf（二进制） |
| 性能 | 一般 | 高 |
| 接口定义 | 不强制 | 强制（.proto） |
| 流式传输 | 不支持 | 支持 |

使用场景：REST 对外 API、浏览器访问；RPC 微服务内部通信。

### Q2：为什么 gRPC 比 REST 快？

1. HTTP/2 多路复用，减少连接开销
2. Protobuf 二进制格式，体积小 3~10 倍，序列化快 5~10 倍
3. 强类型减少运行时类型检查开销

### Q3：Protobuf 字段编号的作用？

序列化时用编号代替字段名节省空间。编号 1~15 只占 1 字节。**字段编号一旦分配不能改，否则数据不兼容。**

### Q4：gRPC 有哪几种通信模式？

1. **Unary**：请求-响应
2. **Server Streaming**：服务端流式返回（实时日志、分页推送）
3. **Client Streaming**：客户端流式发送（批量上传、文件上传）
4. **Bidirectional Streaming**：双向流（聊天系统、实时协作）

### Q5：gRPC 调用超时了怎么办？

1. 设置超时：`stub.GetUser(request, timeout=3)`
2. 捕获 DEADLINE_EXCEEDED 错误
3. 考虑重试（判断是否可重试、是否幂等）
4. 降级处理：返回缓存或默认值

### Q6：怎么保证 gRPC 调用的幂等性？

**幂等性**：同一个请求多次调用，结果一致。

方法：1) 唯一请求 ID + 服务端去重；2) 状态机判断；3) 数据库唯一索引防重复插入。

---

## 十、练习题

### 练习 1：搭建订单服务和商品服务

定义 `OrderService` 和 `ProductService`，`OrderService` 通过 gRPC 调用 `ProductService` 查询商品信息，实现 `CreateOrder` 接口。

```protobuf
// 提示
service ProductService {
  rpc GetProduct(GetProductRequest) returns (Product);
}

service OrderService {
  rpc CreateOrder(CreateOrderRequest) returns (Order);
}
```

### 练习 2：实现 Server Streaming

实现一个日志推送服务：客户端请求查看日志，服务端流式返回（每秒一条，共 10 条）。

```protobuf
service LogService {
  rpc StreamLogs(StreamLogsRequest) returns (stream LogEntry);
}
```

### 练习 3：性能对比实验

搭建 REST 版本（FastAPI）和 gRPC 版本的用户服务，分别测试 10000 次请求耗时，对比性能差异。

---

## 下一讲预告

**第 3 讲：服务注册与发现 -- Consul 实战**

- 为什么微服务需要注册中心？
- 服务注册与发现的完整流程
- Consul 核心原理与架构
- Python 接入 Consul
- 健康检查机制
- 客户端负载均衡
- Consul vs Nacos vs Eureka 选型
- 注册中心挂了怎么办？
