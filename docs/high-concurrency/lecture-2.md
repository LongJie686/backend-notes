# 第 2 讲：缓存设计 -- 从穿透到雪崩的完整防护方案

高并发系统中，80% 的性能优化和缓存有关，90% 的线上故障和缓存设计不当有关。

---

## 核心结论

1. **缓存用空间换时间** -- 内存比 SSD 快 1000 倍，比网络+数据库快数万倍
2. **多级缓存层层拦截** -- 浏览器 -> CDN -> Nginx -> 本地缓存 -> Redis -> DB
3. **Cache Aside 是最常用模式** -- 先更新 DB 再删缓存，配合延迟双删
4. **缓存一致性靠组合拳** -- 延迟双删 + 重试 + 过期时间 + binlog 订阅
5. **三大经典问题各有解法** -- 穿透（布隆过滤器）、击穿（互斥锁）、雪崩（随机过期）
6. **热点 Key 用本地缓存拦截，大 Key 要拆分**
7. **Redis 快的原因** -- 纯内存 + 单线程 + IO 多路复用 + 高效数据结构

---

## 一、为什么缓存是高并发第一武器？

### 1. 访问延迟对比

```
L1 Cache:      0.5 ns
L2 Cache:      7 ns
内存:          100 ns
SSD:           150,000 ns  (0.15 ms)
网络(同机房):  500,000 ns  (0.5 ms)
网络(跨地域):  100,000,000 ns  (100 ms)
```

内存比 SSD 快 1000 倍，比网络+数据库快数万倍。查 MySQL 10ms，查 Redis 1ms，性能提升 10 倍。

### 2. 缓存解决三大问题

**问题 1：数据库扛不住高并发读**

```
不用缓存：1万 QPS -> MySQL 单机极限 5000 QPS -> 打死
用了缓存：1万 QPS -> 99% 命中 Redis -> 100 QPS 打 MySQL -> 轻松扛住
```

**问题 2：响应时间要求高**

```
不用缓存：查 MySQL 20-100ms -> P99 可能超 100ms
用了缓存：查 Redis 1-5ms -> P99 稳定在 10ms 以内
```

**问题 3：降低成本**

```
MySQL：单机 5000 QPS，需要 10 台，成本高
Redis：单机 10 万 QPS，需要 1 台，成本低
```

---

## 二、多级缓存体系

```
[客户端]
   |
[1. 浏览器缓存] <- HTTP 缓存头控制
   |
[2. CDN 缓存]   <- 静态资源、页面
   |
[3. Nginx 缓存] <- 页面缓存、接口缓存
   |
[4. 应用层本地缓存] <- Caffeine/Guava Cache
   |
[5. 分布式缓存] <- Redis/Memcached
   |
[6. 数据库]     <- MySQL
```

### 1. 浏览器缓存

```http
Cache-Control: max-age=3600
ETag: "abc123"
Last-Modified: xxx
```

适用：静态资源（CSS、JS、图片）。完全不占服务端资源，响应最快。

### 2. CDN 缓存

```
[用户北京] -> [CDN 北京节点]
[用户上海] -> [CDN 上海节点]
[用户深圳] -> [CDN 深圳节点]
                    | (未命中)
              [源站服务器]
```

响应时间从 100ms 降到 10ms，源站流量减少 90%+。

### 3. Nginx 本地缓存

```nginx
proxy_cache_path /data/nginx/cache levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m;

server {
    location /api/product/ {
        proxy_cache my_cache;
        proxy_cache_valid 200 10m;
        proxy_cache_key $uri$is_args$args;
        proxy_pass http://backend;
    }
}
```

### 4. 应用层本地缓存（Caffeine）

```java
Cache<String, User> userCache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(10, TimeUnit.MINUTES)
    .build();

User user = userCache.get(userId, key -> userDao.getById(key));
```

| 优点 | 缺点 |
|------|------|
| 访问最快（纳秒级） | 占用应用服务器内存 |
| 无网络开销 | 多台服务器缓存不一致 |
| 减轻 Redis 压力 | 容量有限 |

适用：配置信息、字典数据、用户基本信息、商品基础信息。

### 5. 多级缓存配合效果

```
10万 QPS 请求：
  - 5万被浏览器缓存拦截
  - 3万被 CDN 拦截
  - 1.5万被 Nginx 拦截
  - 1万被本地缓存拦截
  - 4000被 Redis 拦截
  - 1000打到 MySQL
```

从 10 万降到 1000，减轻 99% 的压力。

---

## 三、缓存更新策略

### 策略 1：Cache Aside（旁路缓存） -- 最常用

**读流程：**

```
1. 先查缓存 -> 命中则直接返回
2. 未命中 -> 查数据库 -> 写入缓存 -> 返回
```

```java
public User getUser(Long userId) {
    String cacheKey = "user:" + userId;
    User user = redis.get(cacheKey);
    if (user != null) return user;

    user = userDao.getById(userId);
    if (user != null) {
        redis.setex(cacheKey, 600, user);
    }
    return user;
}
```

**写流程：先更新 DB，再删除缓存（推荐）**

```java
public void updateUser(User user) {
    userDao.update(user);
    redis.del("user:" + user.getId());
}
```

为什么删除而不是更新？并发更新可能导致缓存和 DB 不一致。删除后下次读时自动加载最新数据。

**不推荐：先删缓存再更新 DB**

```
时刻1：线程A删除缓存
时刻2：线程B读（未命中）-> 查DB（旧值）-> 写缓存
时刻3：线程A更新DB
结果：DB 新值，缓存旧值
```

### 延迟双删

解决并发读写导致的不一致：

```java
public void updateUser(User user) {
    redis.del(cacheKey);          // 第一次删除
    userDao.update(user);
    // 异步延迟删除
    executor.schedule(() -> redis.del(cacheKey), 500, TimeUnit.MILLISECONDS);
}
```

延迟时间 = 读操作 P99 耗时 + 100ms。

### 策略 2：Read Through / Write Through

应用不直接操作数据库，全部通过缓存层代理：

```
[应用] -> [缓存层(封装DB操作)] -> [数据库]
```

一致性更好，但需要额外缓存层框架，同步写性能较差。

### 策略 3：Write Behind Caching（异步写回）

写操作只更新缓存，异步批量写回数据库：

```java
// 点赞 -- 只更新 Redis
redis.incr("article:like:" + articleId);
// 定时任务每10秒批量刷 DB
```

写入性能极高，但数据可能丢失，一致性最弱。适用：计数器、访问统计。

### 三种策略对比

| 策略 | 一致性 | 性能 | 适用场景 |
|------|--------|------|---------|
| Cache Aside | 最终一致 | 高 | 最常用，90% 场景 |
| Read/Write Through | 强一致 | 中 | 企业框架 |
| Write Behind | 弱一致 | 最高 | 计数、统计 |

---

## 四、缓存一致性深度剖析

### 不一致的三大根因

1. **并发读写**：读线程和写线程交错执行
2. **删除缓存失败**：Redis 宕机/网络故障
3. **主从延迟**：从库还是旧数据时被写入缓存

### 解决方案

#### 方案 1：延迟双删 + 过期时间（兜底）

```java
redis.del(cacheKey);
userDao.update(user);
executor.schedule(() -> redis.del(cacheKey), 500, TimeUnit.MILLISECONDS);
// 即使双重删除都失败，过期时间也能保证最终一致
```

#### 方案 2：删除缓存重试机制

```java
public void updateUser(User user) {
    userDao.update(user);
    if (!redis.del(cacheKey)) {
        retryQueue.offer(new DelCacheTask(cacheKey));  // 失败放入重试队列
    }
}
```

#### 方案 3：消息队列异步删除

```
[应用] -> 更新DB -> 发消息 -> [MQ] -> [消费者] -> 删除缓存
```

解耦、自动重试、削峰。

#### 方案 4：订阅 MySQL binlog（大厂方案）

```
[MySQL] -> binlog -> [Canal/Debezium] -> 解析变更 -> 删除对应缓存
```

完全解耦，不侵入业务代码，不怕删除失败（binlog 可回溯）。

### 一致性方案选择

| 一致性要求 | 方案 |
|------------|------|
| 弱一致 | Cache Aside + 过期时间 |
| 最终一致 | 延迟双删 / 重试 / MQ |
| 准实时一致 | 订阅 binlog |
| 强一致 | 不用缓存，或分布式事务（成本高） |

---

## 五、缓存三大经典问题

### 1. 缓存穿透（Cache Penetration）

请求的数据既不在缓存也不在数据库，每次请求都打到 DB。

**恶意攻击：** 大量请求随机 ID，全部穿透到 DB。

#### 解决方案 1：缓存空值

```java
User user = userDao.getById(userId);
if (user != null) {
    redis.setex(cacheKey, 600, JSON.toJSONString(user));
} else {
    redis.setex(cacheKey, 60, "null");  // 空值过期时间短一些
}
```

#### 解决方案 2：布隆过滤器

```
[请求] -> [布隆过滤器] -> 可能存在 -> [Redis] -> [MySQL]
                      -> 一定不存在 -> 直接返回
```

```java
RBloomFilter<Long> bloomFilter = redisson.getBloomFilter("user:bloom");
bloomFilter.tryInit(10_000_000L, 0.01);  // 1000万数据，1%误判率

// 查询前先过滤
if (!bloomFilter.contains(userId)) return null;

// 新增用户时加入
bloomFilter.add(user.getId());
```

特点：
- 说"不存在"则一定不存在
- 说"存在"则可能存在（1% 误判率）
- 1000 万数据只需约 12MB 内存
- 不支持删除

#### 解决方案 3：参数校验 + 限流

最基础的防护，在入口拦截非法请求。

### 2. 缓存击穿（Cache Breakdown）

某个热点 Key 过期瞬间，大量并发请求同时打到数据库。

#### 解决方案 1：互斥锁

缓存失效时只让一个线程查 DB，其他线程等待：

```java
public User getUser(Long userId) {
    User user = redis.get(cacheKey);
    if (user != null) return user;

    RLock lock = redisson.getLock("lock:" + cacheKey);
    try {
        lock.lock(10, TimeUnit.SECONDS);
        user = redis.get(cacheKey);  // 双重检查
        if (user != null) return user;

        user = userDao.getById(userId);
        if (user != null) redis.setex(cacheKey, 600, user);
        return user;
    } finally {
        lock.unlock();
    }
}
```

#### 解决方案 2：逻辑过期

缓存永不过期，在值里存过期时间字段：

```java
class CacheValue {
    Object data;
    Long expireTime;
}

// 读取时检查逻辑过期
if (cacheValue.getExpireTime() > System.currentTimeMillis()) {
    return cacheValue.getData();  // 未过期
}
// 已过期 -> 异步更新，返回旧数据（降级）
executor.submit(() -> loadAndCache(userId));
return cacheValue.getData();
```

用户体验好（返回旧数据比等待强），但有短时间不一致。

#### 解决方案 3：提前刷新

缓存年龄超过 80% 生命周期时，异步刷新：

```java
if (age > ttl * 0.8) {
    executor.submit(() -> loadAndCache(userId));
}
```

### 3. 缓存雪崩（Cache Avalanche）

大量缓存同时失效或 Redis 宕机。

#### 场景 1：大量 Key 同时过期

凌晨批量导入 10 万商品，都是 1 小时过期 -> 1 小时后同时失效。

**解决：过期时间加随机值**

```java
int expire = 3600 + new Random().nextInt(600);  // 3600~4200秒
redis.setex(cacheKey, expire, value);
```

#### 场景 2：Redis 宕机

**解决方案：**

| 方案 | 说明 |
|------|------|
| Redis 高可用 | 主从 + 哨兵（小规模）/ Cluster（大规模） |
| 多级缓存 | Redis 挂了，本地缓存兜底 |
| 限流降级 | Sentinel/Hystrix 熔断，保护 DB |
| 请求合并 | 10ms 内的相同请求合并成一个批量查询 |

### 三大问题对比

| 问题 | 原因 | 核心解法 |
|------|------|---------|
| **穿透** | 查不存在的数据 | 布隆过滤器、缓存空值 |
| **击穿** | 热点 Key 过期 | 互斥锁、逻辑过期 |
| **雪崩** | 大量 Key 同时失效 | 过期时间加随机、高可用、多级缓存 |

---

## 六、Redis 核心原理

### 1. 为什么 Redis 这么快？

1. **纯内存操作** -- 纳秒级
2. **单线程模型** -- 避免线程切换和锁竞争（6.0 后 IO 多线程，命令执行仍单线程）
3. **IO 多路复用** -- epoll，单线程处理大量连接
4. **高效数据结构** -- 针对不同场景优化
5. **简单协议** -- RESP 协议

### 2. 数据结构及应用场景

| 类型 | 场景 | 常用命令 |
|------|------|---------|
| String | 缓存对象、计数器、分布式锁、Session | `set/get/incr/setnx` |
| Hash | 对象存储（部分更新）、购物车 | `hset/hget/hincrby` |
| List | 消息队列、最新列表 | `lpush/rpop/lrange` |
| Set | 去重、共同好友、抽奖 | `sadd/sinter/srandmember` |
| Sorted Set | 排行榜、延迟队列、范围查询 | `zadd/zrevrange/zrangebyscore` |

### 3. 持久化

| 方式 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| RDB | 定时快照 | 恢复快、文件紧凑 | 可能丢最后一次快照后的数据 |
| AOF | 记录写操作命令 | 数据安全（最多丢 1 秒） | 文件大、恢复慢 |
| 混合（4.0+） | RDB + AOF | 兼顾速度和安全 | -- |

推荐：混合持久化 `aof-use-rdb-preamble yes`。

### 4. 集群方案

| 方案 | 特点 | 适用 |
|------|------|------|
| 主从复制 | 读写分离，手动切换 | 入门 |
| 哨兵 | 自动故障转移 | 中小规模 |
| Cluster | 自动分片，水平扩展 | 大规模 |

---

## 七、热点 Key 问题

热点 Key 被高频访问（明星微博、秒杀商品），导致单个 Redis 分片压力过大。

### 解决方案

**1. 本地缓存（最有效）**

```java
Cache<String, Object> hotKeyCache = Caffeine.newBuilder()
    .maximumSize(1000)
    .expireAfterWrite(10, TimeUnit.SECONDS)
    .build();
```

10 万 QPS 中 99.9% 被本地缓存拦截。

**2. Key 拆分（多副本）**

```java
// 一个热点 Key 拆成 10 个副本
int random = ThreadLocalRandom.current().nextInt(10);
redis.get("hot:key:" + random);
```

**3. 读写分离** -- 读请求打从库，分散压力。

**4. 监控识别** -- 客户端统计、`redis-cli monitor`、代理层统计。

---

## 八、大 Key 问题

| 类型 | 标准 |
|------|------|
| String | Value > 10KB |
| List/Set/Hash/ZSet | 元素个数 > 5000 |

### 危害

- `del bigKey` 阻塞 10 秒
- 网络传输超时
- Cluster 内存不均
- 主从复制延迟

### 解决方案

**1. 拆分**

```java
// 大 List 分页存储
lpush("comment:1001:1", ...)  // 第1页
lpush("comment:1001:2", ...)  // 第2页

// 大 Hash 分组
hset("user:1001:info:base", field, value)
hset("user:1001:info:extend", field, value)
```

**2. 压缩**

```java
byte[] compressed = gzip(JSON.toJSONString(value));
redis.set(key, compressed);
```

**3. 异步删除（Redis 4.0+）**

```bash
unlink bigKey   # 异步删除，不阻塞
```

---

## 九、实战案例

### 案例 1：商品详情页缓存

QPS 10 万，P99 < 50ms，更新频率低。

```
[CDN] <- 静态资源
[Nginx] <- 页面片段缓存（10秒）
[本地缓存] <- 商品基础信息（1分钟）
[Redis] <- 商品详情（10分钟）
[MySQL]
```

更新策略：先更新 DB -> 删除 Redis -> 延迟双删 -> 刷新 CDN。

### 案例 2：秒杀库存

百万 QPS，防超卖。

**预热：** `redis.set("stock:" + activityId, stock)`

**扣减（Lua 脚本保证原子性）：**

```lua
local stock = redis.call('get', KEYS[1])
if tonumber(stock) > 0 then
    redis.call('decr', KEYS[1])
    return 1
else
    return 0
end
```

扣减成功后异步创建订单，最终落库。

### 案例 3：计数系统

点赞数、评论数、阅读数。

```java
// 点赞（Set 去重 + incr 计数）
if (!redis.sismember("user:like:" + userId, articleId)) {
    redis.sadd("user:like:" + userId, articleId);
    redis.incr("article:like:" + articleId);
}

// 定时落库（每5分钟）
@Scheduled(cron = "0 */5 * * * ?")
public void syncToDB() { ... }
```

---

## 十、面试高频题

### Q1：缓存穿透、击穿、雪崩的区别？

| 问题 | 原因 | 解法 |
|------|------|------|
| 穿透 | 数据不存在 | 布隆过滤器、缓存空值 |
| 击穿 | 热点 Key 过期 | 互斥锁、逻辑过期 |
| 雪崩 | 大量 Key 同时失效 | 随机过期、高可用、多级缓存 |

### Q2：Cache Aside 为什么先更新 DB 再删缓存？

先删缓存再更新 DB 时，并发读可能将旧值写回缓存。先更新 DB 再删缓存虽也有极小概率不一致，但概率低得多，且可用延迟双删兜底。

### Q3：如何保证缓存和数据库一致性？

1. 最终一致：Cache Aside + 延迟双删 + 过期时间
2. 重试机制：删除失败放入重试队列
3. binlog 订阅：Canal 监听 MySQL 变更自动删缓存
4. 强一致：不用缓存，或分布式事务

### Q4：Redis 为什么快？

纯内存 + 单线程（无锁竞争）+ IO 多路复用（epoll）+ 高效数据结构 + RESP 协议。

### Q5：Redis 单线程为什么能扛高并发？

单线程指命令执行是单线程。纯内存微秒级操作 + IO 多路复用一个线程处理大量连接 + 命令简单不阻塞。6.0 后网络读写用多线程，命令执行仍单线程。

### Q6：热点 Key 怎么处理？

识别：客户端统计、monitor、代理层。处理：本地缓存（最有效）、Key 拆分、读写分离。

### Q7：Redis 持久化方式？

RDB（快照，快但可能丢数据）、AOF（日志，安全但慢）、混合（推荐）。选择：不能丢数据用混合持久化。

### Q8：Redis 集群方案？

主从（读写分离）、哨兵（自动故障转移）、Cluster（自动分片，大规模推荐）。
