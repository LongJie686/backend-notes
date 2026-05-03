# FastAPI

## 核心特性

| 特性 | 说明 |
|------|------|
| 异步框架 | 原生支持 async/await，基于 Starlette |
| 自动文档 | 自动生成 Swagger UI / ReDoc |
| 类型校验 | 基于 Pydantic，请求/响应自动校验 |
| 依赖注入 | 内置 DI 系统，灵活可测试 |
| 高性能 | 接近 NodeJS / Go 的吞吐量 |

## 项目结构

```
app/
  main.py          # 应用入口
  routers/         # 路由模块
  schemas/         # Pydantic Model
  models/          # 数据库模型
  services/        # 业务逻辑
  dependencies.py  # 公共依赖
  database.py      # 数据库连接
```

## 路由与请求

| 参数类型 | 装饰器参数 | 示例 |
|---------|-----------|------|
| 路径参数 | `Path(...)` | `/users/{user_id}` |
| 查询参数 | `Query(None)` | `?keyword=xxx` |
| 请求体 | Pydantic Model | POST body JSON |

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class UserCreate(BaseModel):
    name: str
    email: str

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    return {"id": user_id}

@app.post("/users")
async def create_user(user: UserCreate):
    return {"name": user.name}
```

## 依赖注入

依赖注入用于复用数据库连接、认证校验等公共逻辑。

```python
from fastapi import Depends

async def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/me")
async def me(user=Depends(get_current_user), db=Depends(get_db)):
    return user
```

## 中间件与 CORS

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(CORSMiddleware, allow_origins=["https://example.com"],
                   allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def log_requests(request, call_next):
    response = await call_next(request)
    return response
```

## WebSocket 与部署

```python
@app.websocket("/ws/{client_id}")
async def ws_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        await websocket.send_text(f"{client_id}: {data}")
```

```bash
# 开发
uvicorn app.main:app --reload
# 生产
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```
