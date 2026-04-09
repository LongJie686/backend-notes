# 网络基础

## TCP/IP

### 三次握手

1. Client -> SYN -> Server
2. Server -> SYN+ACK -> Client
3. Client -> ACK -> Server

### 四次挥手

1. Client -> FIN -> Server
2. Server -> ACK -> Client
3. Server -> FIN -> Client
4. Client -> ACK -> Server

## HTTP

### HTTP 版本对比

| 特性 | HTTP/1.1 | HTTP/2 | HTTP/3 |
|------|----------|--------|--------|
| 多路复用 | 否 | 是 | 是 |
| 头部压缩 | 否 | HPACK | QPACK |
| 传输层 | TCP | TCP | QUIC(UDP) |
| 队头阻塞 | TCP 层 | TCP 层 | 无 |

### 状态码

- 200: 请求成功
- 301: 永久重定向
- 304: 未修改（缓存命中）
- 400: 请求参数错误
- 401: 未认证
- 403: 无权限访问
- 404: 资源不存在
- 500: 服务器内部错误
- 502: 网关错误
- 503: 服务不可用

## HTTPS

- TLS 握手：使用非对称加密交换密钥
- 数据传输：使用对称加密（AES）
- 证书链验证确保身份可信
