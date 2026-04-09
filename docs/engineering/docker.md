# Docker 容器化部署

## 核心概念

| 概念 | 说明 |
|------|------|
| **镜像 (Image)** | 只读模板，包含运行应用所需的文件系统和依赖 |
| **容器 (Container)** | 镜像的运行实例，隔离的进程环境 |
| **Dockerfile** | 构建镜像的指令文件，逐层定义镜像内容 |
| **docker-compose** | 多容器编排工具，定义和运行多服务应用 |

## 常用命令

```bash
# 镜像管理
docker build -t myapp:1.0 .
docker images                          # 查看本地镜像
docker rmi myapp:1.0                   # 删除镜像

# 容器管理
docker run -d -p 8000:8000 --name app myapp:1.0
docker exec -it app /bin/bash          # 进入容器
docker logs -f app                     # 查看日志
docker stop app && docker rm app       # 停止并删除

# compose
docker compose up -d                   # 后台启动
docker compose down -v                 # 停止并删除容器和卷
docker compose logs -f                 # 查看所有服务日志
```

## Dockerfile 编写

```dockerfile
# 多阶段构建 - Python 项目示例
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## docker-compose 编排

```yaml
# FastAPI + PostgreSQL + Redis
services:
  api:
    build: .
    ports: ["8000:8000"]
    depends_on: [db, redis]
    environment:
      DATABASE_URL: postgresql://user:pass@db:5432/app
      REDIS_URL: redis://redis:6379/0

  db:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: app

  redis:
    image: redis:7-alpine
    volumes: [redisdata:/data]

volumes:
  pgdata:
  redisdata:
```

## 数据持久化

| 方式 | 说明 | 场景 |
|------|------|------|
| **Volume** | Docker 管理，存在 `/var/lib/docker/volumes/` | 生产环境推荐 |
| **Bind Mount** | 映射宿主机目录 `-v /host/path:/container/path` | 开发热更新 |

## 网络模式

| 模式 | 说明 |
|------|------|
| **bridge** | 默认模式，容器间通过虚拟网桥通信 |
| **host** | 直接使用宿主机网络，无端口映射开销 |
| **自定义网络** | `docker network create`，支持容器名 DNS 解析 |

## 生产部署注意点

- **镜像精简**：使用 `alpine` 或 `slim` 基础镜像，多阶段构建减小体积
- **安全扫描**：`docker scout cves myapp:1.0` 扫描漏洞
- **日志管理**：配置日志驱动，限制日志大小 `--log-opt max-size=10m`
- **资源限制**：`docker run -m 512m --cpus=1.0` 限制内存和 CPU
- **非 root 用户**：Dockerfile 中添加 `USER app` 避免权限风险
