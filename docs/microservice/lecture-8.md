# 第 8 讲：容器化与 CI/CD（Python 版）— Docker、K8s、自动化部署实战

这一讲是微服务的**"运输层"和"生产线"**。

微服务拆分后，你可能有 10~30 个服务。如果还是手动 SSH 到服务器、手动拉代码、手动重启进程，那运维成本会把你压垮。

容器化 + CI/CD 就是解决这个问题的：
- **Docker**：把服务打包成标准化的容器，任何地方都能运行
- **Kubernetes**：管理成百上千个容器，自动调度、弹性伸缩、故障自愈
- **CI/CD**：代码提交后自动构建、测试、部署，解放人力

这一讲的目标是让你：
- **掌握 Docker 镜像构建最佳实践**
- **能为 Python 服务编写高质量 Dockerfile**
- **掌握 docker-compose 多服务编排**
- **理解 Kubernetes 核心概念并能部署微服务**
- **掌握滚动更新和零停机部署**
- **理解 HPA 弹性伸缩**
- **能搭建一条完整的 CI/CD 流水线**
- **规避大厂常见的容器化坑点**

---

## 一、Docker 基础

### 1. 为什么微服务需要 Docker？

**没有 Docker 的痛：**

```
开发环境：Python 3.11 + MySQL 8.0
测试环境：Python 3.9 + MySQL 5.7
生产环境：Python 3.10 + MySQL 8.0

"我本地跑没问题啊！"
```

**有了 Docker：**

```
开发 = 测试 = 生产

同一个镜像，任何环境都一样
不存在"我本地跑没问题"
```

---

### 2. Docker 核心概念

```
源代码 + Dockerfile
        ↓ docker build
      镜像（Image）
        ↓ docker run
      容器（Container）
        ↓ docker push
   镜像仓库（Registry）
        ↓ docker pull
   其他机器运行同样的容器
```

| 概念 | 说明 | 类比 |
|------|------|------|
| **Dockerfile** | 构建镜像的"说明书" | 菜谱 |
| **Image（镜像）** | 打包好的运行环境 | 菜品模板 |
| **Container（容器）** | 镜像的运行实例 | 一盘做好的菜 |
| **Registry（仓库）** | 存储镜像的地方 | 菜谱书店 |

---

### 3. Python 服务的 Dockerfile

#### 最简版（不推荐生产用）

```dockerfile
FROM python:3.11

WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["python", "main.py"]
```

**问题：**
- 镜像太大（python:3.11 约 900MB）
- 没有利用构建缓存
- 用 root 用户运行（不安全）
- 没有健康检查

#### 生产级 Dockerfile

```dockerfile
# ============================================================
# 阶段 1：构建阶段（安装依赖）
# ============================================================
FROM python:3.11-slim AS builder

WORKDIR /app

# 先复制依赖文件（利用 Docker 缓存层）
# 只要 requirements.txt 没变，这一层就不会重新构建
COPY requirements.txt .

# 安装依赖到虚拟环境
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# ============================================================
# 阶段 2：运行阶段（最小化镜像）
# ============================================================
FROM python:3.11-slim AS runtime

# 安装运行时必要的系统包
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN groupadd -r appuser && \
    useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# 从构建阶段复制虚拟环境
COPY --from=builder /opt/venv /opt/venv

# 复制应用代码
COPY . .

# 修改目录权限
RUN chown -R appuser:appuser /app

# 切换到非 root 用户
USER appuser

# 设置环境变量
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

#### 逐行解释关键设计

```dockerfile
# 1. 多阶段构建：builder 阶段安装依赖，runtime 阶段只复制结果
# 好处：最终镜像不包含编译工具，体积小

# 2. python:3.11-slim 替代 python:3.11
# slim 约 150MB，完整版约 900MB

# 3. 先 COPY requirements.txt，后 COPY .
# 利用 Docker 层缓存：代码变了但依赖没变，不重新安装依赖
# 大幅提升构建速度

# 4. 非 root 用户
# 安全最佳实践：容器被攻破后，攻击者权限有限

# 5. PYTHONUNBUFFERED=1
# Python 日志立即输出，不缓存（Docker 日志实时可见）

# 6. HEALTHCHECK
# Docker/K8s 用来判断容器是否健康
```

#### 镜像大小对比

| 方式 | 镜像大小 |
|------|---------|
| `FROM python:3.11` | ~900MB |
| `FROM python:3.11-slim` | ~150MB |
| `FROM python:3.11-slim` + 多阶段 | ~130MB |
| `FROM python:3.11-alpine` | ~50MB |

**注意：** Alpine 的 musl libc 和 glibc 不兼容，有些 Python 包（如 numpy、pandas）在 Alpine 上编译很慢或出错。推荐用 slim。

---

### 4. .dockerignore 文件

```plaintext
# .dockerignore
.git
.gitignore
__pycache__
*.pyc
*.pyo
.env
.venv
venv
env
node_modules
.pytest_cache
.mypy_cache
*.egg-info
dist
build
docker-compose*.yml
Dockerfile
.dockerignore
README.md
docs/
tests/
*.md
*.log
```

**作用：** 减少构建上下文大小，加快构建速度，避免把敏感文件打进镜像。

---

### 5. requirements.txt 最佳实践

```bash
# 固定版本号（保证构建一致性）
fastapi==0.104.1
uvicorn[standard]==0.24.0
httpx==0.25.2
pydantic==2.5.3
python-jose[cryptography]==3.3.0
prometheus-client==0.19.0
structlog==23.2.0
redis==5.0.1
grpcio==1.60.0
grpcio-tools==1.60.0
opentelemetry-api==1.22.0
opentelemetry-sdk==1.22.0
```

**不要用 `>=` 或 `~=`**，否则不同时间构建可能得到不同版本。

---

## 二、docker-compose 多服务编排

### 1. 为什么需要 docker-compose？

开发环境要启动：订单服务、用户服务、库存服务、MySQL、Redis、Consul、Jaeger、Prometheus、Grafana。

**没有 docker-compose：** 手动一个个启动，还要配置网络。

**有了 docker-compose：** `docker-compose up -d` 一键启动所有服务。

---

### 2. 完整的电商微服务 docker-compose

```yaml
# docker-compose.yml
version: '3.8'

networks:
  microservice-net:
    driver: bridge

volumes:
  mysql_data:
  redis_data:
  consul_data:
  prometheus_data:
  grafana_data:
  es_data:

services:

  # ========================================
  # 基础设施
  # ========================================
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root123
      MYSQL_DATABASE: microservice
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - microservice-net

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - microservice-net

  # ========================================
  # 注册中心
  # ========================================
  consul:
    image: consul:latest
    ports:
      - "8500:8500"
      - "8600:8600/udp"
    volumes:
      - consul_data:/consul/data
    command: agent -dev -client=0.0.0.0
    healthcheck:
      test: ["CMD", "consul", "info"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - microservice-net

  # ========================================
  # 可观测性
  # ========================================
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "6831:6831/udp"
      - "4317:4317"
    networks:
      - microservice-net

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    networks:
      - microservice-net

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      - prometheus
    networks:
      - microservice-net

  # ========================================
  # API 网关
  # ========================================
  api-gateway:
    build:
      context: ./services/api-gateway
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - ENV=development
      - CONSUL_HOST=consul
      - CONSUL_PORT=8500
      - REDIS_URL=redis://redis:6379
      - JAEGER_HOST=jaeger
    depends_on:
      consul:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 15s
      timeout: 5s
      retries: 3
    networks:
      - microservice-net

  # ========================================
  # 业务服务
  # ========================================
  user-service:
    build:
      context: ./services/user-service
      dockerfile: Dockerfile
    environment:
      - ENV=development
      - DB_URL=mysql://root:root123@mysql:3306/user_db
      - CONSUL_HOST=consul
      - REDIS_URL=redis://redis:6379
      - JAEGER_HOST=jaeger
      - SERVICE_PORT=8001
    depends_on:
      mysql:
        condition: service_healthy
      consul:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 15s
      timeout: 5s
      retries: 3
    deploy:
      replicas: 2
    networks:
      - microservice-net

  order-service:
    build:
      context: ./services/order-service
      dockerfile: Dockerfile
    environment:
      - ENV=development
      - DB_URL=mysql://root:root123@mysql:3306/order_db
      - CONSUL_HOST=consul
      - REDIS_URL=redis://redis:6379
      - JAEGER_HOST=jaeger
      - SERVICE_PORT=8002
    depends_on:
      mysql:
        condition: service_healthy
      consul:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8002/health"]
      interval: 15s
      timeout: 5s
      retries: 3
    networks:
      - microservice-net

  inventory-service:
    build:
      context: ./services/inventory-service
      dockerfile: Dockerfile
    environment:
      - ENV=development
      - DB_URL=mysql://root:root123@mysql:3306/inventory_db
      - CONSUL_HOST=consul
      - REDIS_URL=redis://redis:6379
      - JAEGER_HOST=jaeger
      - SERVICE_PORT=8003
    depends_on:
      mysql:
        condition: service_healthy
      consul:
        condition: service_healthy
    networks:
      - microservice-net

  payment-service:
    build:
      context: ./services/payment-service
      dockerfile: Dockerfile
    environment:
      - ENV=development
      - DB_URL=mysql://root:root123@mysql:3306/payment_db
      - CONSUL_HOST=consul
      - REDIS_URL=redis://redis:6379
      - JAEGER_HOST=jaeger
      - SERVICE_PORT=8004
    depends_on:
      mysql:
        condition: service_healthy
      consul:
        condition: service_healthy
    networks:
      - microservice-net
```

---

### 3. 常用命令

```bash
# 启动所有服务
docker-compose up -d

# 查看所有服务状态
docker-compose ps

# 查看日志
docker-compose logs -f order-service

# 重启某个服务
docker-compose restart order-service

# 重新构建并启动
docker-compose up -d --build

# 停止所有服务
docker-compose down

# 停止并清理数据卷
docker-compose down -v

# 扩缩容
docker-compose up -d --scale user-service=3
```

---

## 三、Kubernetes 核心概念

### 1. 为什么需要 Kubernetes？

**docker-compose 的局限：**
- 只能在单机运行
- 没有自动故障恢复
- 没有弹性伸缩
- 没有滚动更新
- 没有服务发现

**Kubernetes 解决：**
- 跨多台机器编排容器
- 容器挂了自动重启
- 流量大了自动扩容，小了自动缩容
- 滚动更新，零停机发布
- 内置服务发现和负载均衡

---

### 2. K8s 核心概念

```
┌─────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                     │
│                                                          │
│  ┌──────────────── Node 1 ──────────────────────────┐   │
│  │                                                    │   │
│  │  ┌─── Pod ─────┐  ┌─── Pod ─────┐                │   │
│  │  │ Container A  │  │ Container C  │                │   │
│  │  │ (order-svc)  │  │ (user-svc)   │                │   │
│  │  └──────────────┘  └──────────────┘                │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────── Node 2 ──────────────────────────┐   │
│  │                                                    │   │
│  │  ┌─── Pod ─────┐  ┌─── Pod ─────┐                │   │
│  │  │ Container A  │  │ Container D  │                │   │
│  │  │ (order-svc)  │  │ (inventory)  │                │   │
│  │  └──────────────┘  └──────────────┘                │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

| 概念 | 说明 | 类比 |
|------|------|------|
| **Cluster** | 集群，由多个 Node 组成 | 整个工厂 |
| **Node** | 集群中的一台机器 | 一个车间 |
| **Pod** | 最小调度单元，包含 1 个或多个容器 | 一个工位 |
| **Deployment** | 管理 Pod 的副本数和更新策略 | 生产线管理 |
| **Service** | 为 Pod 提供稳定的访问入口 | 工厂的统一前台 |
| **Ingress** | 外部流量入口（HTTP 路由） | 工厂大门 |
| **ConfigMap** | 配置信息 | 工艺手册 |
| **Secret** | 敏感配置（密码、密钥） | 保险柜 |
| **HPA** | 水平自动伸缩 | 自动增减工位 |
| **Namespace** | 资源隔离 | 不同部门 |

---

### 3. 本地搭建 K8s

#### Minikube（推荐学习用）

```bash
# 安装 Minikube
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

# 启动集群
minikube start --driver=docker --memory=4096 --cpus=2

# 安装 kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl

# 验证
kubectl cluster-info
kubectl get nodes
```

---

## 四、微服务的 K8s 部署

### 1. Namespace

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ecommerce
  labels:
    project: ecommerce
    env: development
```

```bash
kubectl apply -f k8s/namespace.yaml
```

---

### 2. ConfigMap（配置）

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: ecommerce
data:
  ENV: "production"
  LOG_LEVEL: "INFO"
  CONSUL_HOST: "consul.ecommerce.svc.cluster.local"
  CONSUL_PORT: "8500"
  REDIS_HOST: "redis.ecommerce.svc.cluster.local"
  REDIS_PORT: "6379"
  JAEGER_HOST: "jaeger.ecommerce.svc.cluster.local"
```

---

### 3. Secret（敏感配置）

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: ecommerce
type: Opaque
data:
  # base64 编码：echo -n 'root123' | base64
  DB_PASSWORD: cm9vdDEyMw==
  JWT_SECRET: bXktand0LXNlY3JldC1rZXk=
  REDIS_PASSWORD: ""
```

```bash
kubectl apply -f k8s/secret.yaml
```

---

### 4. Deployment

```yaml
# k8s/order-service-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: ecommerce
  labels:
    app: order-service
    version: v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: order-service
        version: v1
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8002"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: order-service
          image: registry.example.com/ecommerce/order-service:1.0.0
          imagePullPolicy: Always
          ports:
            - containerPort: 8002
              name: http
          envFrom:
            - configMapRef:
                name: app-config
          env:
            - name: SERVICE_NAME
              value: "order-service"
            - name: SERVICE_PORT
              value: "8002"
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: app-secrets
                  key: DB_PASSWORD
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /health
              port: 8002
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8002
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health
              port: 8002
            failureThreshold: 30
            periodSeconds: 10
      terminationGracePeriodSeconds: 30
```

#### 三种探针的区别

```
startupProbe：    启动检查（启动完成前不做其他检查），解决慢启动服务的问题
livenessProbe：   存活检查（失败则重启容器），解决进程假死的问题
readinessProbe：  就绪检查（失败则不接收流量），解决服务还没准备好就收到流量的问题

时序：启动 → startupProbe（通过后）→ livenessProbe + readinessProbe（持续检查）
```

---

### 5. Service

```yaml
# k8s/order-service-svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: ecommerce
  labels:
    app: order-service
spec:
  type: ClusterIP
  selector:
    app: order-service
  ports:
    - name: http
      port: 8002
      targetPort: 8002
      protocol: TCP
```

**K8s Service 相当于一个内部负载均衡器：**

```
其他服务 → order-service.ecommerce.svc.cluster.local:8002
              ↓ 负载均衡
     Pod1(order-service) / Pod2(order-service) / Pod3(order-service)
```

---

### 6. Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-gateway-ingress
  namespace: ecommerce
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "false"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
spec:
  ingressClassName: nginx
  rules:
    - host: api.ecommerce.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-gateway
                port:
                  number: 8000
```

```
外部流量 → Ingress → api-gateway → 各个微服务
```

---

### 7. 一键部署

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/order-service-deployment.yaml
kubectl apply -f k8s/order-service-svc.yaml

kubectl get pods -n ecommerce
kubectl get services -n ecommerce
kubectl get deployments -n ecommerce

kubectl logs -f deployment/order-service -n ecommerce
kubectl describe pod <pod-name> -n ecommerce
```

---

## 五、滚动更新与零停机部署

### 1. 滚动更新原理

```
当前状态：3 个 v1 Pod

更新过程（maxSurge=1, maxUnavailable=0）：

步骤 1：创建 1 个 v2 Pod
  v1 ● ● ●  v2 ◐          （4 个 Pod，1 个启动中）

步骤 2：v2 Pod 就绪，下线 1 个 v1 Pod
  v1 ● ●    v2 ●           （3 个 Pod）

步骤 3：创建第 2 个 v2 Pod
  v1 ● ●    v2 ● ◐         （4 个 Pod）

步骤 4：v2 就绪，下线 v1
  v1 ●      v2 ● ●         （3 个 Pod）

步骤 5：创建第 3 个 v2 Pod
  v1 ●      v2 ● ● ◐       （4 个 Pod）

步骤 6：v2 就绪，下线最后一个 v1
             v2 ● ● ●       （3 个 Pod，全部 v2）

全程始终有 3 个 Pod 在服务，零停机！
```

---

### 2. 触发更新

```bash
# 方式 1：修改镜像版本
kubectl set image deployment/order-service \
  order-service=registry.example.com/ecommerce/order-service:1.1.0 \
  -n ecommerce

# 方式 2：修改 YAML 后 apply
kubectl apply -f k8s/order-service-deployment.yaml

# 查看更新状态
kubectl rollout status deployment/order-service -n ecommerce

# 查看更新历史
kubectl rollout history deployment/order-service -n ecommerce
```

---

### 3. 回滚

```bash
# 回滚到上一个版本
kubectl rollout undo deployment/order-service -n ecommerce

# 回滚到指定版本
kubectl rollout undo deployment/order-service --to-revision=2 -n ecommerce
```

---

### 4. 优雅终止

```python
# Python 服务的优雅终止处理
import signal
import asyncio
from fastapi import FastAPI

app = FastAPI()
shutting_down = False

@app.get("/health")
async def health():
    if shutting_down:
        return {"status": "shutting_down"}, 503
    return {"status": "healthy"}

def graceful_shutdown(signum, frame):
    """
    收到 SIGTERM 信号后：
    1. 标记正在关闭（readinessProbe 返回 503）
    2. K8s 停止发送新流量
    3. 等待已有请求处理完成
    4. 退出
    """
    global shutting_down
    shutting_down = True
    print("Received SIGTERM, starting graceful shutdown...")
    import time
    time.sleep(10)
    print("Graceful shutdown completed")
    exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
```

```
K8s 终止 Pod 流程：
1. K8s 发送 SIGTERM 信号
2. Pod 标记为 Terminating
3. Service 移除 Pod（不再发新流量）
4. Pod 处理完已有请求
5. 等待 terminationGracePeriodSeconds（默认 30s）
6. 如果还没退出，发送 SIGKILL 强杀
```

---

## 六、HPA 弹性伸缩

### 1. 什么是 HPA？

**HPA（Horizontal Pod Autoscaler）：** 根据 CPU、内存或自定义指标自动调整 Pod 副本数。

```
正常流量：3 个 Pod
              ↓ 流量暴增
HPA 检测到 CPU > 70%
              ↓
自动扩容到 10 个 Pod
              ↓ 流量恢复正常
HPA 检测到 CPU < 30%
              ↓
自动缩容到 3 个 Pod
```

---

### 2. HPA 配置

```yaml
# k8s/order-service-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
  namespace: ecommerce
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 4
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

```bash
kubectl apply -f k8s/order-service-hpa.yaml
kubectl get hpa -n ecommerce
```

---

## 七、CI/CD 流水线

### 1. CI/CD 是什么？

```
CI（持续集成）：代码提交 → 自动构建 → 自动测试
CD（持续交付/部署）：自动测试通过 → 自动部署到测试环境 → 自动部署到生产环境

完整流程：git push → 构建镜像 → 单元测试 → 推送镜像 → 部署到 K8s
```

---

### 2. GitHub Actions CI/CD

#### `.github/workflows/ci-cd.yml`

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:

  # Job 1：代码检查 + 测试
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test123
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov flake8 mypy
      - name: Lint
        run: |
          flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
          flake8 . --count --exit-zero --max-line-length=120 --statistics
      - name: Type Check
        run: mypy --ignore-missing-imports .
      - name: Run Tests
        env:
          DB_URL: mysql://root:test123@localhost:3306/test_db
          REDIS_URL: redis://localhost:6379
        run: |
          pytest tests/ -v --cov=app --cov-report=xml --cov-report=html
      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage.xml

  # Job 2：构建并推送 Docker 镜像
  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest

  # Job 3：部署到 K8s
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG }}
      - name: Deploy to K8s
        run: |
          kubectl set image deployment/order-service \
            order-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -n ecommerce
      - name: Wait for rollout
        run: |
          kubectl rollout status deployment/order-service \
            -n ecommerce --timeout=300s
      - name: Rollback on failure
        if: failure()
        run: |
          kubectl rollout undo deployment/order-service -n ecommerce
```

---

### 3. 完整流程图

```
开发者 git push
       ↓
GitHub Actions 触发
       ↓
┌─── test ─────────────────────┐
│  安装依赖                     │
│  代码风格检查（flake8）        │
│  类型检查（mypy）              │
│  单元测试（pytest）            │
│  覆盖率报告                   │
└──────────────────────────────┘
       ↓ 通过
┌─── build ────────────────────┐
│  Docker build                │
│  Docker push → 镜像仓库      │
│  打标签: commit SHA          │
└──────────────────────────────┘
       ↓ 通过且是 main 分支
┌─── deploy ───────────────────┐
│  kubectl set image           │
│  等待 rollout 完成            │
│  失败自动回滚                 │
└──────────────────────────────┘
```

---

## 八、大厂常见容器化坑点

### 坑点 1：镜像太大

**问题：** 镜像 1.2GB，拉取慢、部署慢、占存储

**解决：** 使用 slim 基础镜像 + 多阶段构建 + 清理缓存

### 坑点 2：不设资源限制

**问题：** Pod 内存泄漏吃掉整个 Node 的内存，其他 Pod 被驱逐

**解决：** 设置 resources.requests 和 resources.limits

### 坑点 3：没有 readinessProbe

**问题：** Pod 启动了但还没初始化完成，K8s 已开始发流量

**解决：** 配置 readinessProbe，就绪后才接收流量

### 坑点 4：没有优雅终止

**问题：** K8s 终止 Pod 但 Pod 正在处理请求，请求被中断

**解决：** Python 代码处理 SIGTERM 信号 + K8s 配置 terminationGracePeriodSeconds

### 坑点 5：配置写死在代码里

**问题：** 数据库密码等敏感信息写死在代码中

**解决：** 用 Secret 管理敏感配置

### 坑点 6：日志写到容器内文件

**问题：** 容器重启后日志丢失，无法统一采集

**解决：** 日志输出到 stdout，用 kubectl logs 查看

---

## 九、面试高频题

### 1. Docker 镜像怎么优化大小？

**参考答案：**

1. 用 slim/alpine 基础镜像
2. 多阶段构建：builder 安装依赖，runtime 只复制结果
3. 合并 RUN 指令，减少层数
4. 清理缓存：`--no-cache-dir`，`rm -rf /var/lib/apt/lists/*`
5. 使用 .dockerignore

---

### 2. K8s 的 liveness 和 readiness 探针区别？

**参考答案：**

| 探针 | 失败后果 | 用途 |
|------|---------|------|
| liveness | 重启容器 | 检测进程假死 |
| readiness | 停止发流量 | 检测服务是否就绪 |

**liveness 失败**：K8s 认为容器坏了，重启它
**readiness 失败**：K8s 认为容器没准备好，不发流量

---

### 3. K8s 滚动更新怎么保证零停机？

**参考答案：**

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

配合 readinessProbe（新 Pod 就绪后才接收流量）和优雅终止（旧 Pod 处理完已有请求后才退出）。

---

### 4. HPA 的工作原理？

**参考答案：**

1. HPA Controller 定期（默认 15s）查询 Metrics Server
2. 获取 Pod 的 CPU/内存使用率
3. 计算期望副本数：`期望副本 = 当前副本 × (当前指标值 / 目标指标值)`
4. 调整 Deployment 的 replicas
5. 有稳定窗口防止频繁扩缩

---

### 5. CI/CD 流水线包含哪些步骤？

**参考答案：**

```
1. 代码检出
2. 代码检查（Lint、类型检查）
3. 单元测试
4. 构建 Docker 镜像
5. 推送镜像到仓库
6. 部署到测试环境
7. 集成测试
8. 部署到生产环境（灰度）
9. 全量发布
10. 部署失败自动回滚
```

---

## 十、核心结论

1. **Dockerfile 最佳实践**：slim 镜像、多阶段构建、非 root 用户、利用缓存层
2. **docker-compose**：开发环境编排工具，一键启动所有服务
3. **K8s 核心**：Pod、Deployment、Service、Ingress、ConfigMap、Secret
4. **三种探针**：liveness（重启）、readiness（摘流量）、startup（慢启动）
5. **滚动更新**：maxSurge + maxUnavailable + readinessProbe = 零停机
6. **优雅终止**：处理 SIGTERM，等待已有请求完成
7. **HPA**：基于 CPU/内存/自定义指标自动扩缩容
8. **CI/CD**：代码提交 → 测试 → 构建镜像 → 部署 → 回滚
9. **配置不能写死**：用 ConfigMap 和 Secret
10. **日志写 stdout**：不写容器内文件

---

## 十一、练习题

### 练习 1：编写生产级 Dockerfile

为订单服务编写 Dockerfile，满足：多阶段构建、slim 基础镜像、非 root 用户、健康检查、利用缓存层、镜像大小 < 200MB。

### 练习 2：docker-compose 编排

编写 docker-compose.yml，包含 MySQL、Redis、Consul、用户服务（2 个实例）、订单服务、API 网关。验证所有服务能互相通信。

### 练习 3：K8s 部署

在 Minikube 上部署订单服务：编写 Deployment（3 副本）、Service、配置探针、触发滚动更新、验证零停机。

---

## 十二、下讲预告

**第 9 讲：Service Mesh（Python 版）— 服务网格原理与实践**

会讲：Service Mesh 是什么、Sidecar 模式、Istio 架构、Python 服务接入 Istio、流量管理、mTLS 安全、自动注入追踪、Weibo Mesh 案例、Service Mesh 的代价和适用场景。
