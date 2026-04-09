# Redis

## 数据类型

| 类型 | 使用场景 |
|------|----------|
| String | 缓存、计数器、分布式锁 |
| Hash | 用户信息、对象存储 |
| List | 消息队列、时间线 |
| Set | 标签、共同好友 |
| ZSet | 排行榜、优先队列 |

## 持久化

### RDB

- 定时快照
- `save` / `bgsave`
- 恢复速度快，可能丢失最近数据

### AOF

- 记录每条写命令
- 三种同步策略：always、everysec、no
- 数据更安全，文件体积更大

## 缓存模式

### 缓存旁路模式

```
读:  缓存命中 -> 返回 | 缓存未命中 -> 查数据库 -> 写缓存 -> 返回
写:  更新数据库 -> 删除缓存
```

### 常见问题

- **缓存穿透**：查询不存在的数据 -> 布隆过滤器
- **缓存击穿**：热点 Key 过期 -> 互斥锁 / 永不过期
- **缓存雪崩**：大量 Key 同时过期 -> 错开过期时间

## 分布式锁

```python
import redis

r = redis.Redis()

def acquire_lock(key: str, value: str, ttl: int = 10) -> bool:
    """获取分布式锁"""
    return r.set(key, value, nx=True, ex=ttl)

def release_lock(key: str, value: str) -> bool:
    """释放分布式锁（Lua 脚本保证原子性）"""
    script = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    end
    return 0
    """
    return r.eval(script, 1, key, value)
```
