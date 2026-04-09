# WebSocket

## 核心概念

| 概念 | 说明 |
|------|------|
| 全双工通信 | 客户端和服务器可同时发送数据 |
| 持久连接 | 一次握手，长期保持，无需反复建连 |
| 低开销 | 数据帧轻量，无 HTTP 头部重复开销 |
| 协议标识 | `ws://` 或加密 `wss://` |

### WebSocket vs HTTP

| 对比项 | HTTP | WebSocket |
|--------|------|-----------|
| 通信方向 | 请求-响应（单向） | 全双工（双向） |
| 连接生命周期 | 短连接 | 持久连接 |
| 实时性 | 需轮询 / SSE | 服务端主动推送 |
| 适用场景 | CRUD、页面请求 | 实时通信、流式数据 |

## 工作原理

```
1. 客户端发送 HTTP Upgrade 请求
   GET /ws HTTP/1.1
   Upgrade: websocket
   Sec-WebSocket-Key: xxx

2. 服务端返回 101 Switching Protocols

3. 建立连接后，双方通过数据帧互发消息

4. Ping/Pong 心跳帧维持连接存活
```

## FastAPI WebSocket

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, msg: str):
        for ws in self.active:
            await ws.send_text(msg)

manager = ConnectionManager()

@app.websocket("/ws/chat")
async def chat(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            await manager.broadcast(data)
    except WebSocketDisconnect:
        manager.disconnect(ws)
```

## 生产部署

```nginx
# Nginx 代理配置
location /ws/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400s;
}
```

**连接管理要点：** 设置 `proxy_read_timeout` 防止断连、客户端自动重连（指数退避）、服务端定期清理断开连接、Ping/Pong 心跳检测。

## 常见应用场景

| 场景 | 说明 |
|------|------|
| 实时聊天 | IM 消息即时收发 |
| 数据推送 | 股票行情、实时监控仪表盘 |
| AI 对话流式输出 | LLM 逐 token 推送，打字机效果 |
| 协同编辑 | 多人文档/画板实时同步 |
