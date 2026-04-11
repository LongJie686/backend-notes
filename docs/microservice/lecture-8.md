# 第8讲：容器化与CI/CD

## 核心结论（5条必记）

1. **Docker容器化是微服务部署的基础** -- 统一运行环境，解决"在我机器上能跑"的问题，镜像即环境
2. **Dockerfile要精简和分层** -- 多阶段构建减小镜像体积，利用Docker缓存加速构建，镜像分层优化
3. **docker-compose适合本地开发** -- 一键启动多个服务，定义网络和卷，开发环境快速搭建
4. **Kubernetes是生产级容器编排** -- Pod、Service、Deployment管理服务生命周期，滚动更新和弹性伸缩
5. **CI/CD实现自动化交付** -- 代码提交自动触发构建、测试、部署，减少人为错误，加快交付速度

---

## 一、Docker基础

### 为什么需要Docker

**传统部署的问题：**
- 环境不一致：开发、测试、生产环境差异
- 依赖冲突：多个服务依赖不同版本
- 部署复杂：手动配置环境，易出错

**Docker的价值：**
- 环境统一：镜像打包运行时
- 隔离性：容器间资源隔离
- 可移植：一次构建，到处运行
- 快速部署：秒级启动服务

### 核心概念

| 概念 | 说明 | 类比 |
|------|------|------|
| 镜像(Image) | 只读模板，包含代码和运行时 | 类 |
| 容器(Container) | 镜像运行实例 | 对象 |
| 仓库(Registry) | 存储和分发镜像 | GitHub |

---

## 二、Dockerfile最佳实践

### 多阶段构建

**传统构建的问题：**
```dockerfile
FROM python:3.11
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["python", "app/main.py"]
```
- 镜像包含源代码
- 镜像体积大
- 暴露源代码

**多阶段构建：**
```dockerfile
# 构建阶段
FROM python:3.11 AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt
COPY . .
RUN python -m compileall .

# 运行阶段
FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY --from=builder /build/app /app/app
ENV PATH=/root/.local/bin:$PATH
CMD ["python", "app/main.py"]
```
- 最终镜像只包含运行时
- 体积小，安全性高

### 镜像分层优化

**利用Docker缓存：**
```dockerfile
# 优化前：变动频繁的内容放前面
COPY . .
RUN pip install -r requirements.txt

# 优化后：变动少的放前面
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
```

**分层原则：**
- 变动少的放前面
- 变动多的放后面
- 充分利用缓存加速构建

### 精简镜像

**选择基础镜像：**
- `python:3.11` ~ 900MB
- `python:3.11-slim` ~ 120MB
- `python:3.11-alpine` ~ 50MB

**alpine注意事项：**
- 使用musl libc（不是glibc）
- 某些Python包需要编译
- 兼容性可能有问题

---

## 三、docker-compose实战

### 基本使用

**docker-compose.yml：**
```yaml
version: "3.8"

services:
  # API网关
  api-gateway:
    build: ./api-gateway
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=dev
      - NACOS_ADDR=nacos:8848
    depends_on:
      - nacos

  # 用户服务
  user-service:
    build: ./user-service
    ports:
      - "8081:8081"
    environment:
      - SPRING_PROFILES_ACTIVE=dev
      - DB_HOST=mysql
      - REDIS_HOST=redis
    depends_on:
      - mysql
      - redis

  # 注册中心
  nacos:
    image: nacos/nacos-server:v2.2.0
    ports:
      - "8848:8848"
    environment:
      - MODE=standalone

  # 数据库
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      - MYSQL_ROOT_PASSWORD=root123
      - MYSQL_DATABASE=ms_shop
    volumes:
      - mysql-data:/var/lib/mysql

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  mysql-data:
  redis-data:
```

**常用命令：**
```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f user-service

# 停止所有服务
docker-compose down

# 重启某个服务
docker-compose restart user-service

# 进入容器
docker-compose exec user-service bash
```

---

## 四、Kubernetes核心概念

### Pod

**什么是Pod：**
- K8s最小部署单元
- 一个或多个容器组合
- 共享网络和存储

**Pod示例：**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: user-service-pod
  labels:
    app: user-service
spec:
  containers:
  - name: user-service
    image: user-service:1.0.0
    ports:
    - containerPort: 8081
    env:
    - name: SPRING_PROFILES_ACTIVE
      value: "prod"
```

### Deployment

**什么是Deployment：**
- 管理Pod副本
- 滚动更新
- 回滚能力

**Deployment示例：**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
    spec:
      containers:
      - name: user-service
        image: user-service:1.0.0
        ports:
        - containerPort: 8081
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /actuator/health
            port: 8081
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8081
          initialDelaySeconds: 10
          periodSeconds: 5
```

**滚动更新：**
```bash
# 更新镜像
kubectl set image deployment/user-service user-service=user-service:1.1.0

# 查看更新状态
kubectl rollout status deployment/user-service

# 回滚
kubectl rollout undo deployment/user-service
```

### Service

**什么是Service：**
- Pod的稳定访问入口
- 负载均衡
- 服务发现

**Service示例：**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-service
spec:
  selector:
    app: user-service
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8081
  type: ClusterIP
```

### Ingress

**什么是Ingress：**
- HTTP/HTTPS路由
- 域名、路径路由
- SSL终结

**Ingress示例：**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /user
        pathType: Prefix
        backend:
          service:
            name: user-service
            port:
              number: 80
      - path: /order
        pathType: Prefix
        backend:
          service:
            name: order-service
            port:
              number: 80
```

### ConfigMap和Secret

**ConfigMap（配置）：**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  application.yml: |
    spring:
      datasource:
        url: jdbc:mysql://mysql:3306/ms_shop
        username: root
```

**Secret（敏感信息）：**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  password: cm9vdDEyMw==  # base64编码
```

---

## 五、CI/CD流水线

### CI流程

```
代码提交
  -> 触发CI
  -> 拉取代码
  -> 单元测试
  -> 代码质量检查
  -> 构建镜像
  -> 推送镜像仓库
  -> 部署到测试环境
```

### GitHub Actions示例

**.github/workflows/ci.yml：**
```yaml
name: CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Set up JDK 11
      uses: actions/setup-java@v3
      with:
        java-version: '11'
        distribution: 'temurin'

    - name: Build with Maven
      run: mvn clean package -DskipTests

    - name: Run tests
      run: mvn test

    - name: Code coverage
      run: mvn jacoco:report

    - name: Build Docker image
      run: docker build -t user-service:${{ github.sha }} .

    - name: Login to Docker Hub
      uses: docker/login-action@v2
      with:
        username: ${{ secrets.DOCKER_USERNAME }}
        password: ${{ secrets.DOCKER_PASSWORD }}

    - name: Push to Docker Hub
      run: docker push user-service:${{ github.sha }}
```

### CD流程

**GitOps示例（ArgoCD）：**
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: user-service
spec:
  destination:
    namespace: production
    server: https://kubernetes.default.svc
  project: default
  source:
    path: k8s/production
    repoURL: https://github.com/user/ms-shop
    targetRevision: HEAD
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

---

## 六、面试高频题

### 1. Docker和虚拟机的区别？
Docker共享宿主机内核，轻量级 -> 虚拟机有完整OS，重量级 -> Docker启动秒级，虚拟机分钟级 -> Docker隔离性不如虚拟机

### 2. Kubernetes核心概念有哪些？
Pod最小部署单元，Deployment管理Pod副本，Service负载均衡和服务发现 -> Ingress HTTP路由，ConfigMap配置管理，Secret敏感信息 -> HPA弹性伸缩

### 3. 滚动更新怎么做？
Deployment更新镜像版本 -> 逐个替换Pod，新Pod就绪后再杀掉旧Pod -> 支持暂停和恢复 -> 出问题可以回滚

### 4. CI/CD有什么价值？
CI自动构建测试，CD自动部署 -> 减少人为错误，加快交付速度 -> 小步快跑，快速反馈 -> GitOps实现基础设施即代码

---

## 练习题

- [ ] 练习1：编写Spring Boot应用的Dockerfile
- [ ] 练习2：用docker-compose搭建完整的微服务开发环境
- [ ] 练习3：在本地K8s部署一个微服务
- [ ] 练习4：配置GitHub Actions实现CI/CD
- [ ] 练习5：体验滚动更新和回滚

---

## 下讲预告

第9讲将学习Service Mesh：Sidecar模式、Istio架构、流量管理、安全与可观测性等进阶内容。
