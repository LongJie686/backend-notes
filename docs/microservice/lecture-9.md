# 第 9 讲：Service Mesh（Python 版）— 服务网格原理与实践

这一讲是微服务架构的**"进化形态"**。

前面几讲我们学了服务治理（限流、熔断、降级），这些功能都是用 Python 代码实现的，写在每个服务里。

这带来一个问题：**每个服务都要写一遍，而且只能用 Python**。如果公司里有 Go 服务、Java 服务、Python 服务，每种语言都要实现一遍，维护成本极高。

**Service Mesh 把这些治理能力从业务代码里抽出来，下沉到基础设施层。**

这一讲的目标是让你：
- **彻底理解 Service Mesh 解决了什么问题**
- **掌握 Sidecar 模式的原理**
- **理解 Istio 的核心架构**
- **能把 Python 服务接入 Istio**
- **掌握 Istio 流量管理**
- **理解 mTLS 服务间安全通信**
- **了解 Weibo Mesh 的演进思路**
- **判断什么时候该用 Service Mesh**

---

## 一、从痛点开始

### 1. 回顾：SDK 方式的服务治理

**前几讲的方案：**

```python
# order_service.py
# 每个服务都要写这些代码

import pybreaker          # 熔断
import redis              # 限流
from tracing import ...   # 链路追踪
from retry import ...     # 重试
from consul import ...    # 服务发现

class OrderService:
    def __init__(self):
        self.circuit_breaker = pybreaker.CircuitBreaker(...)
        self.rate_limiter = RedisRateLimiter(...)
        self.consul = consul.Consul(...)
    
    def call_inventory(self, order_id):
        # 服务发现
        instance = self.consul.get_instance("inventory-service")
        
        # 熔断
        try:
            result = self.circuit_breaker.call(
                requests.get,
                f"http://{instance}/inventory/{order_id}",
                timeout=3
            )
        except pybreaker.CircuitBreakerError:
            return self.fallback()
        
        return result
```

**这种方式的问题：**

---

### 2. SDK 方式的五个痛点

#### 痛点 1：语言绑定

```
Python 服务：用 pybreaker、python-consul
Go 服务：用 go-circuit、go-consul
Java 服务：用 Hystrix、Eureka

3 种语言 = 3 套实现
功能升级 = 3 套代码同步升级
```

#### 痛点 2：版本碎片化

```
user-service：pybreaker 2.0（有 Bug）
order-service：pybreaker 1.5（更老）
payment-service：pybreaker 2.1（最新）

同一个功能，不同服务版本不一致
```

#### 痛点 3：业务代码和治理代码耦合

```python
def create_order():
    # 以下都是"治理代码"，不是业务逻辑
    if not rate_limiter.acquire():
        raise Exception("Rate limited")
    instance = consul.get_instance("inventory-service")
    try:
        result = circuit_breaker.call(requests.get, ...)
    except CircuitBreakerError:
        return fallback()
    
    # 真正的业务逻辑只有这一行
    return save_order(result)
```

治理代码占了 90%，业务代码只有 10%。

#### 痛点 4：治理策略修改需要重新发布

```
想修改超时时间：3s → 5s
必须：改代码 → 构建镜像 → 部署 → 重启服务
影响：服务有短暂不可用
```

#### 痛点 5：治理能力不统一

```
不同团队的服务，限流策略不同
熔断阈值不同，重试策略不同
出了问题排查困难
没有统一视图
```

---

### 3. Service Mesh 的解法

**核心思想：把治理能力从业务代码中抽离，下沉到独立的代理层（Sidecar）。**

```
SDK 方式：
┌─────────────────────────────┐
│  业务代码                    │
│  + 熔断代码                  │
│  + 限流代码                  │
│  + 追踪代码                  │
│  + 服务发现代码               │
└─────────────────────────────┘

Service Mesh 方式：
┌─────────────────┐    ┌───────────────────────────┐
│  业务代码        │ ←→ │  Sidecar Proxy（治理层）   │
│  （纯业务逻辑）   │    │  熔断、限流、追踪、服务发现  │
└─────────────────┘    └───────────────────────────┘
```

**业务代码只管业务，治理交给 Sidecar。**

---

## 二、Sidecar 模式

### 1. 什么是 Sidecar？

**Sidecar（边车）**：在每个服务 Pod 旁边注入一个代理容器，所有网络流量都经过这个代理。

```
┌──────────────────────────────────────────┐
│                  Pod                     │
│                                          │
│  ┌──────────────┐   ┌────────────────┐  │
│  │ 业务容器      │   │ Sidecar 代理   │  │
│  │ order-service│ ←→│ (Envoy Proxy)  │  │
│  │              │   │                │  │
│  └──────────────┘   └───────┬────────┘  │
│                             │           │
└─────────────────────────────┼───────────┘
                              │
                    所有出入流量都经过 Sidecar
```

---

### 2. 流量如何经过 Sidecar？

```
请求发出（不经过 Sidecar）的问题：
业务容器 → 直接网络 → 下游服务

通过 iptables 劫持流量：
业务容器 → iptables 拦截 → Sidecar → 下游的 Sidecar → 业务容器

具体流程：
发送方：
  order-service（业务代码）
      ↓ 发出请求（认为是直连）
  iptables 劫持
      ↓
  Envoy Sidecar（出向代理）
      ↓ 负载均衡、熔断、限流、加密、追踪
  网络传输

接收方：
  iptables 劫持
      ↓
  Envoy Sidecar（入向代理）
      ↓ 鉴权、限流、追踪
  inventory-service（业务代码）
```

**业务代码完全不知道 Sidecar 的存在，透明代理。**

---

### 3. Sidecar 能做什么？

```
┌─────────────────────────────────────────┐
│              Sidecar (Envoy)            │
├─────────────────────────────────────────┤
│  流量管理：负载均衡、超时、重试、熔断       │
│  安全：mTLS 双向认证、授权策略            │
│  可观测性：指标、日志、链路追踪            │
│  服务发现：动态更新上游地址               │
│  流量控制：限流、流量镜像、故障注入        │
└─────────────────────────────────────────┘
```

**业务代码不需要写任何治理逻辑，全部由 Sidecar 处理。**

---

## 三、Istio 架构

### 1. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│                    Control Plane（控制面）                 │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                    Istiod                           │  │
│  │                                                    │  │
│  │  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │  │
│  │  │   Pilot    │  │   Citadel  │  │   Galley    │  │  │
│  │  │ 流量管理   │  │ 证书管理   │  │ 配置管理    │  │  │
│  │  └────────────┘  └────────────┘  └─────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │                    │                  │
         │ xDS 协议           │                  │
         ↓                    ↓                  ↓
┌──────────────────────────────────────────────────────────┐
│                    Data Plane（数据面）                    │
│                                                          │
│  ┌─────────────────────┐   ┌─────────────────────────┐  │
│  │       Pod A          │   │        Pod B             │  │
│  │  ┌───────┐ ┌──────┐ │   │  ┌──────────┐ ┌──────┐  │  │
│  │  │ App   │ │Envoy │ │   │  │   App    │ │Envoy │  │  │
│  │  │(Python│←│Proxy │←┼───┼─→│(Python)  │ │Proxy │  │  │
│  │  │Service│ │      │ │   │  │          │ │      │  │  │
│  │  └───────┘ └──────┘ │   │  └──────────┘ └──────┘  │  │
│  └─────────────────────┘   └─────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

### 2. 核心组件

#### Istiod（控制面）

```
Istiod 三合一：

Pilot（流量管理）：
  - 管理服务发现
  - 配置 Envoy 的路由规则
  - 管理负载均衡策略
  - 下发 xDS 配置给 Envoy

Citadel（安全管理）：
  - 签发 mTLS 证书
  - 证书轮换
  - 管理服务身份

Galley（配置管理）：
  - 验证 Istio 配置
  - 分发配置到各组件
```

#### Envoy（数据面代理）

```
Envoy 是 Istio 的默认 Sidecar 代理：
- C++ 编写，高性能
- 支持 HTTP/1.1、HTTP/2、gRPC
- 支持 L4/L7 流量管理
- 内置健康检查、熔断、限流
- 丰富的可观测性
```

---

### 3. xDS 协议

Istiod 通过 **xDS 协议**动态下发配置给 Envoy：

```
xDS（x Discovery Service）：
  LDS：Listener Discovery Service（监听器）
  RDS：Route Discovery Service（路由）
  CDS：Cluster Discovery Service（上游集群）
  EDS：Endpoint Discovery Service（端点/实例列表）

Istiod → xDS → Envoy（动态更新，无需重启）
```

**这就是为什么修改流量规则不需要重启服务。**

---

## 四、安装 Istio

### 1. 安装 Istio

```bash
# 下载 Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-1.20.0
export PATH=$PWD/bin:$PATH

# 安装到 Minikube（demo 配置）
istioctl install --set profile=demo -y

# 验证安装
istioctl verify-install

# 查看组件
kubectl get pods -n istio-system
```

---

### 2. 给 Namespace 开启自动注入

```bash
# 给 ecommerce namespace 开启 Sidecar 自动注入
kubectl label namespace ecommerce istio-injection=enabled

# 验证
kubectl get namespace ecommerce --show-labels
```

**之后部署在 ecommerce namespace 的 Pod，都会自动注入 Envoy Sidecar。**

---

## 五、Python 服务接入 Istio

### 1. Python 服务不需要改任何代码

**这是 Service Mesh 最大的优势：**

```python
# order_service.py
# 不需要任何 Service Mesh 相关代码！
from fastapi import FastAPI
import httpx

app = FastAPI()

@app.post("/orders")
async def create_order(request_data: dict):
    # 直接调用 inventory-service（不需要服务发现、熔断、限流代码）
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "http://inventory-service:8003/inventory/product-001"
        )
    
    # 直接调用 account-service
    async with httpx.AsyncClient() as client:
        result = await client.post(
            "http://account-service:8004/accounts/deduct",
            json={"user_id": "user-001", "amount": 100}
        )
    
    # 纯业务逻辑
    return {"order_id": "order-001", "status": "created"}
```

**Sidecar 自动处理：**
- 服务发现（Envoy 知道 inventory-service 的实例）
- 负载均衡（Envoy 自动分配）
- 链路追踪（Envoy 自动注入 TraceID）
- 指标采集（Envoy 自动暴露 metrics）

---

### 2. Kubernetes 部署配置

```yaml
# k8s/order-service-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: ecommerce  # 已开启 istio-injection=enabled
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
      version: v1          # 版本标签（灰度用）
  template:
    metadata:
      labels:
        app: order-service
        version: v1
    spec:
      containers:
        - name: order-service
          image: registry.example.com/ecommerce/order-service:1.0.0
          ports:
            - containerPort: 8002
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /health
              port: 8002
            initialDelaySeconds: 5
            periodSeconds: 5
```

**注意：不需要任何 Istio 特定的配置，普通的 K8s YAML 就够了。**
**Istio 自动为这个 Pod 注入 Envoy Sidecar。**

---

### 3. 验证 Sidecar 注入

```bash
# 部署后查看 Pod
kubectl get pods -n ecommerce

# 可以看到 Pod 有 2 个容器（业务容器 + Envoy Sidecar）
NAME                             READY   STATUS    RESTARTS   AGE
order-service-7d4f9b7c8-abc12   2/2     Running   0          5m
                                 ↑
                            2 个容器（1 业务 + 1 Envoy）

# 查看 Pod 详情
kubectl describe pod order-service-7d4f9b7c8-abc12 -n ecommerce
# 可以看到 istio-proxy 容器
```

---

## 六、Istio 流量管理

### 1. 核心 CRD

```
Istio 通过自定义资源（CRD）管理流量：

VirtualService：定义流量路由规则（怎么走）
DestinationRule：定义目标服务的策略（负载均衡、熔断）
Gateway：管理入口流量（替代 Ingress）
ServiceEntry：注册外部服务
PeerAuthentication：mTLS 配置
AuthorizationPolicy：访问控制
```

---

### 2. DestinationRule（目标规则）

**配置负载均衡、熔断、连接池：**

```yaml
# k8s/istio/destination-rule.yaml
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: order-service-dr
  namespace: ecommerce
spec:
  host: order-service

  # 全局流量策略
  trafficPolicy:
    # 负载均衡策略
    loadBalancer:
      simple: LEAST_CONN  # 最少连接（也可以是 ROUND_ROBIN、RANDOM）

    # 连接池（限制并发）
    connectionPool:
      http:
        http1MaxPendingRequests: 100   # 最大等待请求数
        http2MaxRequests: 1000         # 最大并发请求数
      tcp:
        maxConnections: 100            # 最大 TCP 连接数

    # 熔断配置
    outlierDetection:
      consecutive5xxErrors: 5          # 连续 5 个 5xx 错误触发熔断
      interval: 10s                    # 检测间隔
      baseEjectionTime: 30s            # 熔断基础时间（第 1 次 30s，第 2 次 60s）
      maxEjectionPercent: 50           # 最多熔断 50% 的实例

  # 版本子集（用于灰度）
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
      trafficPolicy:
        loadBalancer:
          simple: ROUND_ROBIN  # v2 用轮询
```

---

### 3. VirtualService（虚拟服务）

**配置路由规则、超时、重试、故障注入：**

```yaml
# k8s/istio/virtual-service.yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: order-service-vs
  namespace: ecommerce
spec:
  hosts:
    - order-service

  http:
    # 路由规则
    - name: "order-service-route"

      # 超时控制
      timeout: 5s

      # 重试策略
      retries:
        attempts: 3             # 最多重试 3 次
        perTryTimeout: 2s       # 每次超时 2 秒
        retryOn: "5xx,reset,connect-failure"  # 触发重试的条件

      route:
        - destination:
            host: order-service
            port:
              number: 8002
```

---

### 4. 灰度发布（流量分割）

```yaml
# k8s/istio/canary-virtual-service.yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: order-service-canary
  namespace: ecommerce
spec:
  hosts:
    - order-service

  http:
    - name: "canary-route"
      route:
        # 90% 流量走 v1（稳定版本）
        - destination:
            host: order-service
            subset: v1
          weight: 90

        # 10% 流量走 v2（新版本）
        - destination:
            host: order-service
            subset: v2
          weight: 10
```

```bash
kubectl apply -f k8s/istio/destination-rule.yaml
kubectl apply -f k8s/istio/canary-virtual-service.yaml

# 验证
kubectl get virtualservice -n ecommerce
kubectl get destinationrule -n ecommerce
```

---

### 5. 按 Header 路由（测试人员走新版本）

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: order-service-header-route
  namespace: ecommerce
spec:
  hosts:
    - order-service

  http:
    # 带 X-Version: v2 Header 的走新版本
    - name: "v2-testers"
      match:
        - headers:
            x-version:
              exact: v2
      route:
        - destination:
            host: order-service
            subset: v2

    # 其他流量走 v1
    - name: "default"
      route:
        - destination:
            host: order-service
            subset: v1
```

**测试工程师只需要在请求中加 `X-Version: v2` 就能测试新版本，不影响普通用户。**

---

### 6. 流量镜像（Shadow Traffic）

**把生产流量复制一份发到新版本，不影响用户：**

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: order-service-mirror
  namespace: ecommerce
spec:
  hosts:
    - order-service

  http:
    - name: "mirror-to-v2"
      route:
        - destination:
            host: order-service
            subset: v1
          weight: 100  # 所有真实流量走 v1

      # 镜像：复制流量到 v2（异步，不影响响应）
      mirror:
        host: order-service
        subset: v2
      mirrorPercentage:
        value: 100.0  # 100% 复制
```

**场景：**
- 新版本上线前，用真实流量做压测
- 验证新版本的功能是否正确
- 不影响用户（v2 的响应会被丢弃）

---

### 7. 故障注入（Chaos Engineering）

**模拟故障，测试系统的弹性：**

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: order-service-fault
  namespace: ecommerce
spec:
  hosts:
    - order-service

  http:
    - name: "fault-injection"
      fault:
        # 延迟注入：10% 的请求延迟 5 秒
        delay:
          percentage:
            value: 10.0
          fixedDelay: 5s

        # 错误注入：5% 的请求返回 503
        abort:
          percentage:
            value: 5.0
          httpStatus: 503

      route:
        - destination:
            host: order-service
```

**用途：**
- 测试下游服务故障时，系统是否正确触发熔断
- 测试超时设置是否合理
- 验证告警是否正常触发

---

## 七、Istio 安全：mTLS

### 1. 什么是 mTLS？

```
普通 TLS（单向）：
  客户端验证服务端证书
  服务端不验证客户端

mTLS（双向 TLS）：
  客户端验证服务端证书
  服务端也验证客户端证书
  双方互相认证身份
```

**为什么微服务需要 mTLS？**
```
没有 mTLS：
  恶意服务伪装成 order-service 调用 payment-service
  → 成功！系统无法区分

有 mTLS：
  每个服务都有 Istio 颁发的证书
  调用时双方验证证书
  → 伪装失败，调用被拒绝
```

---

### 2. 开启 mTLS

```yaml
# k8s/istio/peer-authentication.yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default-mtls
  namespace: ecommerce
spec:
  mtls:
    # STRICT：强制 mTLS（所有服务间通信必须加密）
    # PERMISSIVE：允许明文和 mTLS（过渡期使用）
    mode: STRICT
```

```bash
kubectl apply -f k8s/istio/peer-authentication.yaml
```

**开启后：**
- 所有服务间通信自动加密
- 不需要修改任何业务代码
- Envoy Sidecar 自动处理证书

---

### 3. 访问控制

```yaml
# k8s/istio/authorization-policy.yaml
# 只允许 order-service 调用 inventory-service

apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: inventory-service-policy
  namespace: ecommerce
spec:
  selector:
    matchLabels:
      app: inventory-service

  action: ALLOW

  rules:
    - from:
        - source:
            # 只允许来自 order-service 的调用
            principals:
              - "cluster.local/ns/ecommerce/sa/order-service"
      to:
        - operation:
            # 只允许 GET 方法
            methods: ["GET"]
            paths: ["/inventory/*"]
```

**场景：**
- 防止未授权服务访问敏感接口
- 实现细粒度的服务间访问控制

---

## 八、Istio 可观测性

### 1. 自动链路追踪

**Istio 自动注入追踪信息，但需要应用透传 Header：**

```python
# order_service.py
# 虽然不需要追踪 SDK，但需要透传 Istio 的追踪 Header

from fastapi import FastAPI, Request
import httpx

app = FastAPI()

# Istio 使用的追踪 Header
TRACE_HEADERS = [
    "x-request-id",
    "x-b3-traceid",
    "x-b3-spanid",
    "x-b3-parentspanid",
    "x-b3-sampled",
    "x-b3-flags",
    "x-ot-span-context",
]

def extract_trace_headers(request: Request) -> dict:
    """
    从入请求中提取追踪 Header
    在调用下游时透传这些 Header
    """
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() in TRACE_HEADERS
    }


@app.post("/orders")
async def create_order(request: Request):
    # 提取追踪 Header
    trace_headers = extract_trace_headers(request)
    
    # 调用下游时透传
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "http://inventory-service:8003/inventory/product-001",
            headers=trace_headers  # 透传追踪 Header！
        )
    
    return {"order_id": "order-001", "status": "created"}
```

**为什么需要透传？**
```
Sidecar 自动追踪：入向和出向的 Span 创建
但 Sidecar 之间如何关联？通过追踪 Header！

如果不透传：
  order-service-sidecar 创建 Span A
  inventory-service-sidecar 创建 Span B
  Span A 和 Span B 没有父子关系，断链！

透传之后：
  inventory-service-sidecar 知道 Span B 的父是 Span A
  链路完整！
```

---

### 2. Kiali（服务拓扑图）

**Kiali 是 Istio 的可视化界面：**

```bash
# 安装 Kiali
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/kiali.yaml

# 访问 Kiali
istioctl dashboard kiali
```

**Kiali 可以看到：**
- 服务调用关系图
- 流量走向
- 每条链路的错误率和延迟
- 灰度发布的流量分布

---

### 3. 安装完整可观测性套件

```bash
# 安装 Prometheus（Istio 内置）
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/prometheus.yaml

# 安装 Grafana
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/grafana.yaml

# 安装 Jaeger
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/jaeger.yaml

# 安装 Kiali
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.20/samples/addons/kiali.yaml

# 访问各个 UI
istioctl dashboard grafana
istioctl dashboard jaeger
istioctl dashboard kiali
```

---

## 九、Weibo Mesh：大厂实践案例

### 1. 微博的演进历程

```
第 1 阶段：单体架构（2009~2012）
  Rails 单体应用
  随着用户增长，性能瓶颈明显

第 2 阶段：服务化（2012~2017）
  拆分成多个 Java 服务
  自研 Motan RPC 框架
  问题：只支持 Java，Python/Go 服务无法接入

第 3 阶段：Motan-Mesh 演进（2017~至今）
  基于 Motan 演进到 Service Mesh
  解决跨语言服务治理问题
  支持 Java、Python、Go、PHP
```

---

### 2. Motan 到 Mesh 的演进

```
Motan SDK 方式：
┌──────────────────────────────────────────┐
│              Java 服务                    │
│                                          │
│  业务代码                                 │
│  + Motan SDK（注册发现、负载均衡、熔断）  │
└──────────────────────────────────────────┘

问题：只支持 Java，其他语言无法使用 Motan

Motan-Mesh 方式：
┌──────────────────────┐  ┌────────────────────────┐
│      Java 服务        │  │     Python 服务          │
│      业务代码          │  │     业务代码              │
└──────────┬───────────┘  └────────────┬───────────┘
           │                           │
           ↓                           ↓
┌──────────────────────┐  ┌────────────────────────┐
│   Mesh Agent（本地代理）  │  │  Mesh Agent（本地代理）   │
│   注册发现、负载均衡、熔断  │  │  注册发现、负载均衡、熔断   │
└──────────────────────┘  └────────────────────────┘

两个语言的服务都通过 Mesh Agent 做服务治理
语言无关！
```

---

### 3. Weibo Mesh 核心设计

```python
"""
Weibo Mesh 的核心思想：

1. 本地代理模式（不是 Sidecar，而是本机进程）
   每台机器运行一个 Mesh Agent
   所有服务通过 localhost 和 Agent 通信

2. 控制面和数据面分离
   控制面：统一管理路由规则、配置
   数据面：Agent 处理实际流量

3. 平滑迁移
   老服务不改代码，通过 Agent 接入 Mesh
   新服务直接使用 Mesh API

4. 多协议支持
   HTTP/1.1
   HTTP/2
   Motan（私有 RPC 协议）
   gRPC
"""

# Python 服务接入 Weibo Mesh（示意）
class WeiboMeshClient:
    """
    Python 服务通过 Mesh Agent 调用下游
    """
    
    def __init__(self):
        # 连接本地 Mesh Agent（127.0.0.1:9981）
        self.agent_host = "127.0.0.1"
        self.agent_port = 9981
    
    def call(self, service_name: str, method: str, params: dict):
        """
        通过 Mesh Agent 调用服务
        服务发现、负载均衡由 Agent 处理
        """
        import requests
        
        response = requests.post(
            f"http://{self.agent_host}:{self.agent_port}/invoke",
            json={
                "service": service_name,
                "method": method,
                "params": params
            }
        )
        return response.json()


# 使用示例
client = WeiboMeshClient()
user_info = client.call("user-service", "getUser", {"user_id": "001"})
```

---

### 4. Weibo Mesh vs Istio

| 维度 | Weibo Mesh | Istio |
|------|-----------|-------|
| **代理模式** | 本机进程 | Pod Sidecar |
| **语言支持** | Java/Python/Go/PHP | 任何语言 |
| **性能** | 较低延迟 | 有 Sidecar 开销 |
| **运维复杂度** | 较低 | 较高 |
| **功能完整性** | 针对微博定制 | 功能更全面 |
| **社区** | 内部为主 | 开源社区活跃 |

---

## 十、Service Mesh 的代价

### 1. 性能损耗

```
没有 Mesh：
  service A → service B
  延迟：5ms（网络）

有 Mesh：
  service A → Envoy（sidecar A）→ service B → Envoy（sidecar B）
  延迟：5ms（网络）+ 1~3ms（两个 Envoy 处理）

额外开销：约 20%~40% 延迟增加
内存：每个 Envoy 约 50~100MB
CPU：额外 5%~10%
```

---

### 2. 运维复杂度

```
K8s 已经很复杂了
加上 Istio：
  CRD 增加几十个
  控制面组件（Istiod）需要维护
  Envoy 配置调试困难
  升级 Istio 有风险
  需要专门的 Service Mesh 运维团队
```

---

### 3. 调试困难

```
没有 Mesh：
  请求失败 → 看业务日志 → 找到问题

有 Mesh：
  请求失败 → 是业务代码问题还是 Sidecar 问题？
           → Envoy 配置是否正确？
           → mTLS 证书是否过期？
           → DestinationRule 是否配置错了？
```

---

### 4. 什么时候该用 Service Mesh？

```
✅ 适合用 Service Mesh 的场景：
  - 多语言微服务（Python + Go + Java 混合）
  - 需要统一的安全策略（mTLS）
  - 需要细粒度的流量管理（灰度、镜像）
  - 有专职的平台团队维护 Mesh
  - 服务数量多（50+ 个服务）
  - 对运维复杂度有容忍度

❌ 不适合用 Service Mesh 的场景：
  - 团队规模小（< 20 人）
  - 服务数量少（< 10 个）
  - 运维能力不足
  - 对延迟极其敏感（如高频交易）
  - 单一语言技术栈（直接用 SDK 更简单）
```

---

## 十一、SDK 方式 vs Service Mesh 完整对比

```
┌──────────────────┬───────────────────┬────────────────────┐
│ 维度             │ SDK 方式           │ Service Mesh       │
├──────────────────┼───────────────────┼────────────────────┤
│ 语言支持         │ 需要每种语言实现   │ 语言无关           │
│ 业务代码侵入     │ 高                 │ 低（只透传 Header） │
│ 治理策略变更     │ 需要重新发布       │ 动态下发           │
│ 性能             │ 好（进程内）       │ 有损耗（网络转发） │
│ 运维复杂度       │ 低                 │ 高                 │
│ 统一视图         │ 难                 │ 容易（Kiali）      │
│ mTLS            │ 需要自己实现       │ 自动               │
│ 调试难度         │ 低                 │ 高                 │
│ 适用团队规模     │ 小中型             │ 中大型             │
└──────────────────┴───────────────────┴────────────────────┘
```

---

## 十二、面试高频题

### 1. 什么是 Service Mesh？解决了什么问题？

**参考答案：**

Service Mesh 是一个基础设施层，处理服务间通信，将服务治理能力（熔断、限流、追踪、安全）从业务代码中抽离，下沉到独立的代理层（Sidecar）。

**解决的问题：**
1. **语言绑定**：SDK 方式每种语言要单独实现，Mesh 语言无关
2. **代码侵入**：业务代码中充斥治理代码，Mesh 业务代码纯净
3. **策略变更**：SDK 方式改策略要重新发布，Mesh 动态生效
4. **统一视图**：SDK 方式每个服务分散，Mesh 统一管控

---

### 2. Sidecar 模式的原理？

**参考答案：**

每个 Pod 中注入一个 Envoy Proxy 容器（Sidecar），通过 iptables 拦截所有进出流量，由 Sidecar 代理处理服务发现、负载均衡、熔断、加密等逻辑，业务容器完全无感知。

```
业务代码发出请求 → iptables 劫持 → Envoy（出向代理）→ 网络
网络 → iptables 劫持 → Envoy（入向代理）→ 业务代码接收
```

---

### 3. Istio 的数据面和控制面分别是什么？

**参考答案：**

**控制面（Istiod）：**
- Pilot：管理流量规则，通过 xDS 协议下发给 Envoy
- Citadel：管理证书，支持 mTLS
- Galley：验证和分发配置

**数据面（Envoy Sidecar）：**
- 实际处理流量
- 执行控制面下发的规则
- 采集 metrics、trace

---

### 4. mTLS 是什么？为什么需要它？

**参考答案：**

mTLS（双向 TLS）：客户端和服务端互相验证证书，双向认证身份。

**为什么需要：**
- 普通 HTTP：服务 A 伪装成 B 调用 C，C 无法识别
- mTLS：每个服务都有 Istio 颁发的证书，伪装会被检测出来
- 额外好处：通信自动加密，防止数据被窃听

---

### 5. 灰度发布在 Istio 里怎么实现？

**参考答案：**

```yaml
# DestinationRule 定义版本子集
subsets:
  - name: v1
    labels: {version: v1}
  - name: v2
    labels: {version: v2}

# VirtualService 分配流量权重
route:
  - destination: {host: order-service, subset: v1}
    weight: 90
  - destination: {host: order-service, subset: v2}
    weight: 10
```

修改权重不需要重启服务，Istio 动态下发配置。

---

### 6. Service Mesh 有什么缺点？什么时候不应该用？

**参考答案：**

**缺点：**
- 性能损耗：每次调用多经过两个 Envoy（20%~40% 延迟增加）
- 运维复杂：Istio 本身的运维成本很高
- 调试困难：问题可能出在业务层或 Mesh 层
- 内存占用：每个 Envoy 约 50~100MB

**不适合的场景：**
- 小团队（< 20 人），运维成本承受不了
- 服务数量少（< 10 个），收益不明显
- 对延迟极敏感（高频交易）
- 单一语言技术栈，用 SDK 更简单

---

## 十三、这一讲你必须记住的核心结论

1. **Service Mesh 解决了 SDK 方式的语言绑定和代码侵入问题**
2. **Sidecar 模式**：iptables 透明劫持流量，业务代码无感知
3. **Istio = 控制面（Istiod）+ 数据面（Envoy）**
4. **xDS 协议**：控制面动态下发配置，不需要重启
5. **Python 接入 Istio 不需要改代码**，只需透传追踪 Header
6. **VirtualService**：定义路由规则、超时、重试、故障注入
7. **DestinationRule**：定义负载均衡、熔断、连接池
8. **mTLS**：一行配置开启服务间双向认证和加密
9. **灰度发布**：修改 VirtualService 权重，动态生效
10. **不是所有团队都适合 Mesh**：小团队、单语言用 SDK 更合适

---

## 十四、这一讲的练习题

### 练习 1：灰度发布实验

**要求：**
1. 部署订单服务 v1 和 v2（v2 返回的响应中多一个字段）
2. 配置 DestinationRule 和 VirtualService
3. 实现 10% 流量走 v2，90% 走 v1
4. 通过 Kiali 观察流量分布
5. 逐步把流量从 10% 调整到 100%

---

### 练习 2：故障注入与熔断测试

**要求：**
1. 给库存服务注入 20% 延迟（5 秒）
2. 观察订单服务的超时告警
3. 给库存服务配置 DestinationRule 熔断规则
4. 观察熔断触发后的行为
5. 去掉故障注入，观察熔断恢复

---

### 练习 3：mTLS 配置

**要求：**
1. 给 ecommerce namespace 开启严格 mTLS
2. 验证服务间通信是否自动加密
3. 配置 AuthorizationPolicy，只允许 order-service 调用 inventory-service
4. 尝试用其他服务调用 inventory-service，验证被拒绝

---

## 十五、课程总结

恭喜你完成了完整的微服务学习路线！

让我们回顾一下我们学了什么：

```
第 1 讲：微服务架构认知
  ├── 什么时候该拆微服务
  ├── 服务拆分原则
  └── 电商系统拆分实战

第 2 讲：服务通信与 RPC
  ├── REST vs gRPC
  ├── Protobuf 序列化
  └── gRPC 四种通信模式

第 3 讲：服务注册与发现
  ├── Consul 原理
  ├── 服务注册注销
  └── 客户端负载均衡

第 4 讲：服务治理
  ├── 限流（令牌桶）
  ├── 熔断（状态机）
  └── 降级 + 幂等性

第 5 讲：API 网关
  ├── 统一入口设计
  ├── JWT 鉴权
  └── 灰度路由

第 6 讲：分布式数据一致性
  ├── CAP + BASE
  ├── 本地消息表
  └── Saga 模式

第 7 讲：可观测性
  ├── Metrics + Logging + Tracing
  ├── OpenTelemetry
  └── Prometheus + Grafana + Jaeger

第 8 讲：容器化与 CI/CD
  ├── Docker 最佳实践
  ├── K8s 核心概念
  └── GitHub Actions 流水线

第 9 讲：Service Mesh
  ├── Sidecar 模式
  ├── Istio 实战
  └── 灰度发布 + mTLS
```

---

## 十六、下一步学习建议

### 继续深入的方向

```
1. 深入 K8s
   - K8s 网络原理
   - K8s 存储
   - 自定义 Operator
   - K8s 安全

2. 深入 Istio
   - Envoy 配置深入
   - Istio 性能调优
   - 多集群 Mesh

3. 大数据与微服务
   - Kafka 深入
   - 流式处理
   - 数据湖架构

4. AI 工程化
   - 模型服务化（FastAPI + Model）
   - AI 推理服务的微服务化
   - LLM 服务网格

5. 云原生进阶
   - Serverless
   - eBPF
   - WASM
```

---

### 推荐实战项目

**最终实战：完整电商微服务系统**

```
目标：从 0 到 1 搭建一个生产级微服务系统

包含：
├── 8 个微服务（用户、商品、库存、订单、支付、通知、推荐、搜索）
├── API 网关（FastAPI）
├── gRPC 服务间通信
├── Consul 注册发现
├── Sentinel 服务治理
├── 分布式事务（本地消息表）
├── ELK + Prometheus + Jaeger 可观测性
├── Docker + K8s 部署
├── Istio 服务网格
├── GitHub Actions CI/CD
└── 压测报告
```

**完成这个项目，你就具备了大厂微服务工程师的核心能力。**

---

**整个课程到这里就完成了！**

**你现在可以：**
1. **回顾任何一讲**，告诉我你想深入哪个部分
2. **做练习题**，我帮你点评
3. **问任何问题**，实际项目中遇到的问题也可以
4. **开始实战项目**，我可以带你一步步实现完整的电商微服务系统

你想接下来做什么？
