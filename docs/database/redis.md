# Redis

## Data Types

| Type | Use Case |
|------|----------|
| String | Cache, counter, distributed lock |
| Hash | User profile, object storage |
| List | Message queue, timeline |
| Set | Tags, mutual friends |
| ZSet | Leaderboard, priority queue |

## Persistence

### RDB (Redis Database)

- Point-in-time snapshot
- `save` / `bgsave`
- Faster recovery, may lose recent data

### AOF (Append Only File)

- Log every write command
- Three sync policies: always, everysec, no
- More durable, larger file size

## Cache Patterns

### Cache Aside

```
Read:  Cache hit -> return | Cache miss -> DB -> write cache -> return
Write: DB -> delete cache
```

### Common Issues

- **Cache Penetration**: Query non-existent data -> Bloom Filter
- **Cache Breakdown**: Hot key expired -> Mutex lock / never expire
- **Cache Avalanche**: Mass expiration -> Staggered TTL

## Distributed Lock

```python
import redis

r = redis.Redis()

def acquire_lock(key: str, value: str, ttl: int = 10) -> bool:
    return r.set(key, value, nx=True, ex=ttl)

def release_lock(key: str, value: str) -> bool:
    script = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    end
    return 0
    """
    return r.eval(script, 1, key, value)
```
