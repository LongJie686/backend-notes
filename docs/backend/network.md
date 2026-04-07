# Network

## TCP/IP

### Three-way Handshake

1. Client -> SYN -> Server
2. Server -> SYN+ACK -> Client
3. Client -> ACK -> Server

### Four-way Wave

1. Client -> FIN -> Server
2. Server -> ACK -> Client
3. Server -> FIN -> Client
4. Client -> ACK -> Server

## HTTP

### HTTP/1.1 vs HTTP/2 vs HTTP/3

| Feature | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---------|----------|--------|--------|
| Multiplexing | No | Yes | Yes |
| Header Compression | No | HPACK | QPACK |
| Transport | TCP | TCP | QUIC(UDP) |
| Head-of-line Blocking | TCP level | TCP level | None |

### Status Codes

- 200: OK
- 301: Moved Permanently
- 304: Not Modified
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error
- 502: Bad Gateway
- 503: Service Unavailable

## HTTPS

- TLS handshake: asymmetric encryption for key exchange
- Data transfer: symmetric encryption (AES)
- Certificate chain verification
