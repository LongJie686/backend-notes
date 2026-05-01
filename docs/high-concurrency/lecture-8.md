# 第 8 讲：分布式服务治理——注册发现、分布式锁、链路追踪

这一讲是高并发系统**基础设施层**的核心。

前面几讲我们解决的是业务层的问题：
- 缓存解决读性能
- 消息队列解决写削峰
- 分库分表解决数据层扩展
- 秒杀/信息流解决具体业务场景

但这些服务之间是如何**找到对方**的？
多个服务同时操作同一个资源，**如何保证不冲突**？
出了问题，**如何快速定位**到哪个服务哪行代码？

这一讲解决的就是这些问题。

---

## 一、服务注册与发现

### 为什么需要服务注册发现？

**没有服务发现的时代：**

```
订单服务调用库存服务
→ 配置文件里写死库存服务的IP和端口
  inventory.service.url = 192.168.1.10:8080

问题：
→ 库存服务扩容到10台，要改10个配置
→ 某台机器挂了，要手动摘除
→ 发布新版本，要手动更新配置
→ 配置管理噩梦
```

**有了服务发现：**

```
订单服务 → 向注册中心询问：库存服务在哪？
注册中心 → 返回：[192.168.1.10:8080, 192.168.1.11:8080, ...]
订单服务 → 负载均衡选一台，发起调用

库存服务挂了 → 注册中心自动剔除
库存服务扩容 → 自动注册到注册中心
订单服务无感知
```

---

### 服务注册发现的核心原理

**三个角色：**

```
[服务提供者] → 启动时注册到注册中心（IP、端口、服务名）
[注册中心]   → 维护服务列表，检测健康状态
[服务消费者] → 从注册中心拉取服务列表，调用
```

**核心流程：**

```
1. 注册：
   库存服务启动
   → 向注册中心注册：
     {
       serviceName: "inventory-service",
       ip: "192.168.1.10",
       port: 8080,
       weight: 1
     }

2. 心跳（保活）：
   库存服务每30秒发一次心跳
   → 告诉注册中心：我还活着
   → 超时未收到心跳 → 剔除该实例

3. 拉取/订阅：
   订单服务启动
   → 从注册中心拉取库存服务的实例列表
   → 本地缓存
   → 订阅变更（注册中心主动推送）

4. 调用：
   订单服务从本地缓存的实例列表中
   → 负载均衡选一台
   → 发起调用

5. 注销：
   库存服务正常下线
   → 主动向注册中心注销
   → 注册中心通知消费者更新列表
```

---

### 主流注册中心对比

| 维度 | Nacos | Eureka | Consul | etcd | ZooKeeper |
|------|-------|--------|--------|------|-----------|
| **一致性协议** | AP/CP可切换 | AP | CP | CP | CP |
| **健康检查** | 心跳/主动检查 | 心跳 | 多种 | TTL | 临时节点 |
| **配置中心** | 内置 | 无 | 支持 | 支持 | 可以 |
| **控制台** | 丰富 | 基础 | 支持 | 无 | 无 |
| **语言** | Java | Java | Go | Go | Java |
| **维护状态** | 活跃 | 停止维护 | 活跃 | 活跃 | 活跃 |
| **适用场景** | **国内首选** | 老系统 | 多语言 | K8s | 分布式协调 |

**选型建议：**

```
国内新项目：Nacos（Spring Cloud Alibaba生态）
多语言环境：Consul
K8s环境：etcd（已内置）
老Spring Cloud项目：Eureka（逐步迁移）
```

---

### Nacos 核心原理

#### AP vs CP 模式

**AP模式（默认，临时实例）：**

```
服务实例 = 临时节点
心跳超时 → 自动剔除
优点：可用性高，即使Nacos集群部分不可用，服务仍可访问
缺点：数据可能不一致（最终一致）
适合：微服务注册发现
```

**CP模式（持久实例）：**

```
服务实例 = 持久节点
需要主动注销
优点：数据强一致
缺点：Nacos集群不可用时，服务不可访问
适合：需要强一致的配置数据
```

#### Nacos 集群架构

```
[服务实例]
    ↓ 注册/心跳
[Nacos Cluster]
  [Nacos-1] [Nacos-2] [Nacos-3]  ← Raft协议保证一致性
      ↓
  [MySQL] ← 持久化存储
    ↑
[服务消费者] ← 拉取服务列表 + 订阅变更
```

#### Nacos 实战配置

**服务提供者（库存服务）：**

```yaml
# application.yml
spring:
  application:
    name: inventory-service
  cloud:
    nacos:
      discovery:
        server-addr: nacos-cluster:8848  # Nacos集群地址
        namespace: prod                   # 命名空间（环境隔离）
        group: DEFAULT_GROUP
        weight: 1                         # 权重（负载均衡用）
        metadata:
          version: v2.0                   # 自定义元数据
          region: beijing                 # 所在区域
```

**服务消费者（订单服务）：**

```java
// 使用LoadBalanced的RestTemplate
@Configuration
public class RestTemplateConfig {

    @Bean
    @LoadBalanced  // 开启负载均衡
    public RestTemplate restTemplate() {
        RestTemplate template = new RestTemplate();
        HttpComponentsClientHttpRequestFactory factory =
            new HttpComponentsClientHttpRequestFactory();
        factory.setConnectTimeout(3000);
        factory.setReadTimeout(5000);
        template.setRequestFactory(factory);
        return template;
    }
}

// 调用时使用服务名，而不是IP
@Service
public class OrderService {

    @Autowired
    private RestTemplate restTemplate;

    public Inventory getInventory(Long productId) {
        return restTemplate.getForObject(
            "http://inventory-service/inventory/" + productId,
            Inventory.class
        );
    }
}
```

**使用Feign（更推荐）：**

```java
// 声明式HTTP客户端
@FeignClient(
    name = "inventory-service",
    fallback = InventoryFallback.class  // 降级实现
)
public interface InventoryClient {

    @GetMapping("/inventory/{productId}")
    Inventory getInventory(@PathVariable Long productId);

    @PostMapping("/inventory/deduct")
    boolean deductStock(@RequestBody DeductRequest request);
}

// 降级实现
@Component
public class InventoryFallback implements InventoryClient {

    @Override
    public Inventory getInventory(Long productId) {
        return Inventory.defaultInventory(productId);
    }

    @Override
    public boolean deductStock(DeductRequest request) {
        return false;
    }
}
```

---

### 服务发现的本地缓存

**重要：服务消费者不是每次调用都请求注册中心！**

```
消费者 → 启动时拉取服务列表 → 缓存在本地
       → 订阅注册中心的变更推送
       → 注册中心推送变更 → 更新本地缓存
       → 调用时从本地缓存读取（不请求注册中心）
```

**好处：**

```
注册中心宕机了 → 消费者仍能使用本地缓存调用
→ 短时间内服务不受影响
→ 注册中心恢复后自动同步
```

---

## 二、分布式锁

### 为什么需要分布式锁？

**单机锁的局限：**

```
synchronized / ReentrantLock
→ 只在同一个JVM内有效
→ 多台机器 → 每台机器有自己的锁
→ 不能跨机器互斥
```

**典型场景：**

```
库存扣减：
  机器A：读库存=1 → 准备扣减
  机器B：读库存=1 → 准备扣减
  → 两台机器同时扣 → 超卖

定时任务：
  机器A：执行了定时任务
  机器B：也执行了定时任务
  → 重复执行

秒杀去重：
  同一用户同时发两个请求
  → 打到不同机器
  → 两个都成功 → 重复购买
```

---

### 方案一：Redis分布式锁

#### 基础实现

```java
public class RedisDistributedLock {

    private final RedisTemplate<String, String> redis;

    // 加锁
    public boolean tryLock(String key, String value, long expireSeconds) {
        // SET key value NX EX expireSeconds
        // NX = 不存在才设置（原子操作）
        // EX = 过期时间（防止死锁）
        Boolean result = redis.opsForValue()
            .setIfAbsent(key, value, expireSeconds, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(result);
    }

    // 释放锁（Lua脚本保证原子性）
    public boolean unlock(String key, String value) {
        String script =
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('del', KEYS[1]); " +
            "else " +
            "    return 0; " +
            "end";

        Long result = redis.execute(
            new DefaultRedisScript<>(script, Long.class),
            Collections.singletonList(key),
            value
        );

        return result != null && result == 1L;
    }
}
```

**使用示例：**

```java
public void deductStock(Long productId, int quantity) {
    String lockKey = "lock:stock:" + productId;
    String lockValue = UUID.randomUUID().toString();

    try {
        boolean locked = lock.tryLock(lockKey, lockValue, 30);

        if (!locked) {
            throw new BusinessException("系统繁忙，请稍后重试");
        }

        Stock stock = stockDao.getByProductId(productId);
        if (stock.getCount() < quantity) {
            throw new BusinessException("库存不足");
        }
        stockDao.deduct(productId, quantity);

    } finally {
        lock.unlock(lockKey, lockValue);
    }
}
```

---

#### Redis分布式锁的三大坑

**坑1：锁过期了，业务还没执行完**

```
问题：
  设置锁过期时间30秒
  业务执行到第35秒才完成
  → 第30秒时锁已经自动释放
  → 其他线程拿到锁
  → 两个线程同时在执行
  → 数据不一致
```

**解决：看门狗机制（续期）**

```java
public class WatchdogLock {

    private final RedisTemplate<String, String> redis;
    private final ScheduledExecutorService scheduler =
        Executors.newScheduledThreadPool(1);

    private ScheduledFuture<?> watchdog;

    public boolean tryLock(String key, String value, long expireSeconds) {
        boolean locked = redis.opsForValue()
            .setIfAbsent(key, value, expireSeconds, TimeUnit.SECONDS);

        if (locked) {
            long renewInterval = expireSeconds * 1000 / 3;

            watchdog = scheduler.scheduleAtFixedRate(() -> {
                String currentValue = redis.opsForValue().get(key);
                if (value.equals(currentValue)) {
                    redis.expire(key, expireSeconds, TimeUnit.SECONDS);
                }
            }, renewInterval, renewInterval, TimeUnit.MILLISECONDS);
        }

        return locked;
    }

    public void unlock(String key, String value) {
        if (watchdog != null) {
            watchdog.cancel(false);
        }

        String script =
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('del', KEYS[1]); " +
            "else " +
            "    return 0; " +
            "end";

        redis.execute(
            new DefaultRedisScript<>(script, Long.class),
            Collections.singletonList(key),
            value
        );
    }
}
```

**更好的方案：直接用Redisson（生产推荐）**

```java
// Redisson内置看门狗机制
RLock lock = redisson.getLock("lock:stock:" + productId);

try {
    // 加锁，看门狗自动续期（默认30秒，每10秒续期一次）
    lock.lock();

    // 或者：尝试加锁，最多等待3秒，持有30秒
    boolean locked = lock.tryLock(3, 30, TimeUnit.SECONDS);

    if (locked) {
        doDeductStock(productId, quantity);
    }
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
```

---

**坑2：释放了别人的锁**

```
问题：
  线程A加锁，key=lockKey, value=A的UUID
  线程A业务执行很慢，锁过期了
  线程B加锁成功，key=lockKey, value=B的UUID
  线程A执行完，释放锁
  → 线程A释放的是B的锁！
  → 线程C加锁成功
  → 线程B和C同时持有锁
```

**解决：释放锁时验证value（前面的Lua脚本已解决）**

```lua
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
```

---

**坑3：Redis主从切换导致锁丢失**

```
问题：
  线程A在Master加锁成功
  Master还没把数据同步给Slave，Master宕机
  Slave升级为新Master
  新Master上没有这个锁
  线程B在新Master加锁成功
  → 两个线程同时持有锁
```

**解决方案一：RedLock算法**

```
向N个独立的Redis Master同时加锁
需要超过N/2+1个成功才算加锁成功

N=5时：
  → 向5个Master发加锁请求
  → 至少3个成功才算成功
  → 某个Master宕机，不影响多数派
```

```java
// Redisson实现RedLock
RLock lock1 = redisson1.getLock("lock:stock");
RLock lock2 = redisson2.getLock("lock:stock");
RLock lock3 = redisson3.getLock("lock:stock");

RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);

try {
    boolean locked = redLock.tryLock(3, 30, TimeUnit.SECONDS);
    if (locked) {
        // 执行业务
    }
} finally {
    redLock.unlock();
}
```

**RedLock的争议：**

```
Martin Kleppmann（《数据密集型应用系统设计》作者）指出：
→ 即使用RedLock，在极端情况下（时钟跳跃）仍可能出现问题
→ 如果需要绝对的分布式互斥，应该使用ZooKeeper

Redis作者Antirez的回应：
→ 大多数业务场景RedLock足够用
→ 完全的强一致性需要Chubby/ZooKeeper这样的系统
```

**解决方案二：使用ZooKeeper锁（强一致性）**

---

### 方案二：ZooKeeper分布式锁

#### ZooKeeper基础概念

**ZooKeeper的节点类型：**

```
持久节点（Persistent）：
  → 客户端断开后不删除
  → 需要主动删除

临时节点（Ephemeral）：
  → 客户端断开后自动删除
  → 用于分布式锁

有序节点（Sequential）：
  → 节点名自动加序号
  → /lock/node-0001, /lock/node-0002...
  → 用于有序排队
```

#### 基于临时有序节点实现

**原理：**

```
1. 所有线程在 /lock 下创建临时有序节点
   线程A → /lock/node-0001
   线程B → /lock/node-0002
   线程C → /lock/node-0003

2. 序号最小的获得锁（线程A）

3. 线程B、C监听自己前一个节点的删除事件
   线程B监听 /lock/node-0001 的删除
   线程C监听 /lock/node-0002 的删除

4. 线程A释放锁（删除/lock/node-0001）
   → 触发线程B的监听
   → 线程B发现自己是最小节点
   → 线程B获得锁

5. 如此类推...
```

**代码实现（Curator框架）：**

```java
@Configuration
public class ZookeeperConfig {

    @Bean
    public CuratorFramework curatorFramework() {
        RetryPolicy retryPolicy = new ExponentialBackoffRetry(1000, 3);

        CuratorFramework client = CuratorFrameworkFactory.newClient(
            "zk-cluster:2181",
            5000,
            3000,
            retryPolicy
        );

        client.start();
        return client;
    }
}

@Service
public class ZkDistributedLock {

    @Autowired
    private CuratorFramework curator;

    public void executeWithLock(String lockPath, Runnable task) throws Exception {
        InterProcessMutex lock = new InterProcessMutex(curator, lockPath);

        try {
            boolean acquired = lock.acquire(3, TimeUnit.SECONDS);

            if (!acquired) {
                throw new BusinessException("获取锁超时");
            }

            task.run();

        } finally {
            lock.release();
        }
    }
}

// 使用
public void deductStock(Long productId, int quantity) throws Exception {
    zkLock.executeWithLock("/lock/stock/" + productId, () -> {
        doDeductStock(productId, quantity);
    });
}
```

---

#### ZooKeeper锁的优势

```
ZooKeeper使用ZAB协议（类Paxos），保证强一致性：
→ 节点创建/删除，所有ZK节点一致后才返回成功
→ 不会出现Redis那种主从切换导致锁丢失的问题

客户端宕机：
→ 临时节点自动删除（session过期）
→ 其他线程自动获得锁
→ 不会死锁
```

---

### 方案三：数据库分布式锁

```sql
CREATE TABLE distributed_lock (
    lock_key VARCHAR(128) NOT NULL COMMENT '锁的Key',
    lock_value VARCHAR(64) NOT NULL COMMENT '锁的Value（UUID）',
    expire_time DATETIME NOT NULL COMMENT '过期时间',
    PRIMARY KEY (lock_key)
);
```

```java
public class DbDistributedLock {

    public boolean tryLock(String key, String value, int expireSeconds) {
        try {
            lockDao.insert(key, value,
                LocalDateTime.now().plusSeconds(expireSeconds));
            return true;
        } catch (DuplicateKeyException e) {
            Lock lock = lockDao.getByKey(key);
            if (lock != null && lock.getExpireTime().isBefore(LocalDateTime.now())) {
                int updated = lockDao.updateIfExpired(key, value,
                    LocalDateTime.now().plusSeconds(expireSeconds));
                return updated > 0;
            }
            return false;
        }
    }

    public boolean unlock(String key, String value) {
        int deleted = lockDao.deleteByKeyAndValue(key, value);
        return deleted > 0;
    }
}
```

**适用：并发量低、已有数据库、不想引入新组件的场景**

---

### 三种锁的对比

| 维度 | Redis锁 | ZooKeeper锁 | 数据库锁 |
|------|---------|------------|---------|
| **性能** | 最高 | 中 | 最低 |
| **可靠性** | 中（主从切换有风险） | 最高 | 高 |
| **实现复杂度** | 低（Redisson已封装） | 中（Curator） | 低 |
| **死锁处理** | 过期时间 | 临时节点自动删除 | 过期时间 |
| **续期** | Redisson看门狗 | 不需要（临时节点） | 需要自己实现 |
| **适用场景** | **高并发，容忍极小概率问题** | **强一致性要求高** | 并发低 |

**选型建议：**

```
99%的业务场景：Redis + Redisson
对一致性要求极高（金融核心）：ZooKeeper
简单低并发场景：数据库锁
```

---

### 分布式锁的最佳实践

```java
public void executeWithLock(String lockKey, Runnable business) {
    RLock lock = redisson.getLock(lockKey);

    try {
        boolean acquired = lock.tryLock(3, -1, TimeUnit.SECONDS);

        if (!acquired) {
            throw new BusinessException("操作频繁，请稍后重试");
        }

        business.run();

    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new BusinessException("获取锁被中断");
    } finally {
        if (lock.isHeldByCurrentThread()) {
            lock.unlock();
        }
    }
}
```

---

## 三、分布式链路追踪

### 为什么需要链路追踪？

**微服务调用链路：**

```
用户请求
  ↓
[API网关]
  ↓
[订单服务]
  ↓           ↓          ↓
[库存服务] [用户服务] [优惠券服务]
  ↓
[数据库]
```

**出问题了，怎么找？**

```
用户反馈：下单失败
→ 是API网关的问题？
→ 是订单服务的问题？
→ 是库存服务的问题？
→ 是数据库的问题？

没有链路追踪：
→ 一个个服务查日志
→ 日志散落在不同机器
→ 无法关联同一个请求的日志
→ 排查效率极低
```

**有了链路追踪：**

```
一个请求有唯一的TraceID
→ 所有服务的日志都带这个TraceID
→ 输入TraceID，看完整调用链路
→ 哪个服务、哪行代码、花了多少时间
→ 秒级定位问题
```

---

### 链路追踪核心概念

**Trace（链路）：**

```
一次完整的请求链路
由唯一的TraceID标识
包含多个Span
```

**Span（跨度）：**

```
链路中的一个操作单元
比如：一次服务调用、一次数据库查询
包含：
  - SpanID（自身ID）
  - ParentSpanID（父节点ID）
  - 操作名
  - 开始时间
  - 结束时间
  - 状态（成功/失败）
  - 标签（key-value）
```

**调用链示例：**

```
TraceID: abc123

Span1: API网关处理
  SpanID: 0001
  ParentSpanID: null
  耗时: 50ms

  Span2: 订单服务处理
    SpanID: 0002
    ParentSpanID: 0001
    耗时: 30ms

    Span3: 库存服务调用
      SpanID: 0003
      ParentSpanID: 0002
      耗时: 10ms

    Span4: 数据库查询
      SpanID: 0004
      ParentSpanID: 0002
      耗时: 5ms
```

---

### TraceID如何跨服务传递？

**这是链路追踪最核心的问题。**

**HTTP调用传递：**

```
发起方：把TraceID放在HTTP Header中
  X-Trace-Id: abc123
  X-Span-Id: 0002

接收方：从Header中提取TraceID
  → 存入ThreadLocal
  → 后续操作使用同一TraceID
  → 调用下游服务时，带上TraceID
```

**代码实现：**

```java
// TraceID在ThreadLocal中存储
public class TraceContext {

    private static final ThreadLocal<String> traceId = new ThreadLocal<>();
    private static final ThreadLocal<String> spanId = new ThreadLocal<>();

    public static String getTraceId() {
        return traceId.get();
    }

    public static void setTraceId(String id) {
        traceId.set(id);
    }

    public static String getSpanId() {
        return spanId.get();
    }

    public static void setSpanId(String id) {
        spanId.set(id);
    }

    public static void clear() {
        traceId.remove();
        spanId.remove();
    }
}

// HTTP请求拦截器（服务端）：提取TraceID
@Component
public class TraceInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request,
                              HttpServletResponse response,
                              Object handler) {
        String traceId = request.getHeader("X-Trace-Id");

        if (StringUtils.isEmpty(traceId)) {
            traceId = generateTraceId();
        }

        String spanId = generateSpanId();

        TraceContext.setTraceId(traceId);
        TraceContext.setSpanId(spanId);

        response.setHeader("X-Trace-Id", traceId);

        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                                 HttpServletResponse response,
                                 Object handler,
                                 Exception ex) {
        TraceContext.clear();
    }

    private String generateTraceId() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    private String generateSpanId() {
        return Long.toHexString(System.nanoTime());
    }
}

// Feign拦截器（客户端）：透传TraceID
@Component
public class FeignTraceInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        String traceId = TraceContext.getTraceId();
        String spanId = TraceContext.getSpanId();

        if (traceId != null) {
            template.header("X-Trace-Id", traceId);
            template.header("X-Parent-Span-Id", spanId);
            template.header("X-Span-Id", generateSpanId());
        }
    }
}
```

**日志中自动带上TraceID：**

```xml
<!-- logback配置（使用MDC） -->
<Pattern>
    [%d{yyyy-MM-dd HH:mm:ss}] [%X{traceId}] [%thread] %-5level %logger{36} - %msg%n
</Pattern>
```

```java
// 在拦截器中设置MDC
@Override
public boolean preHandle(HttpServletRequest request, ...) {
    String traceId = ...;
    MDC.put("traceId", traceId);
    return true;
}

@Override
public void afterCompletion(...) {
    MDC.clear();
}
```

**日志效果：**

```
[2024-01-01 10:00:00] [abc123] [http-nio-8080] INFO  OrderService - 开始创建订单
[2024-01-01 10:00:00] [abc123] [http-nio-8080] INFO  InventoryService - 查询库存
[2024-01-01 10:00:00] [abc123] [http-nio-8080] INFO  OrderService - 订单创建成功

→ 通过TraceID abc123，可以串联整个请求链路的所有日志
```

---

### 消息队列中的TraceID传递

```java
// Kafka生产者：把TraceID放在消息Header
public void sendMessage(String topic, String value) {
    ProducerRecord<String, String> record = new ProducerRecord<>(topic, value);

    String traceId = TraceContext.getTraceId();
    if (traceId != null) {
        record.headers().add("X-Trace-Id", traceId.getBytes());
    }

    kafkaProducer.send(record);
}

// Kafka消费者：从消息Header提取TraceID
@KafkaListener(topics = "order-topic")
public void consume(ConsumerRecord<String, String> record) {
    Header traceHeader = record.headers().lastHeader("X-Trace-Id");
    if (traceHeader != null) {
        String traceId = new String(traceHeader.value());
        TraceContext.setTraceId(traceId);
        MDC.put("traceId", traceId);
    }

    try {
        processMessage(record);
    } finally {
        TraceContext.clear();
        MDC.clear();
    }
}
```

---

### 主流链路追踪框架

#### SkyWalking（推荐）

**特点：**

```
- Apache开源，国内最流行
- Java Agent方式，无侵入（不需要改业务代码）
- 支持丰富的框架（Spring, Dubbo, Kafka, MySQL...）
- 控制台功能丰富
- 支持告警
```

**部署：**

```yaml
# docker-compose.yml
version: '3'
services:
  oap:
    image: apache/skywalking-oap-server
    environment:
      SW_STORAGE: elasticsearch
      SW_STORAGE_ES_CLUSTER_NODES: es:9200
    ports:
      - 11800:11800
      - 12800:12800

  ui:
    image: apache/skywalking-ui
    environment:
      SW_OAP_ADDRESS: oap:12800
    ports:
      - 8080:8080
```

**Java应用接入（只需加JVM参数，不改代码）：**

```bash
java -javaagent:/path/to/skywalking-agent.jar \
     -Dskywalking.agent.service_name=order-service \
     -Dskywalking.collector.backend_service=oap:11800 \
     -jar order-service.jar
```

---

#### Zipkin

```java
// Spring Boot集成Sleuth + Zipkin
// application.yml
spring:
  zipkin:
    base-url: http://zipkin:9411
  sleuth:
    sampler:
      probability: 0.1  # 采样率10%（生产环境不能全量采集）
```

---

### 采样率的重要性

**问题：**

```
全量采集链路数据：
→ 每个请求都上报
→ 1万QPS → 每秒上报1万条链路数据
→ 存储和计算压力极大
```

**解决：采样**

```
只采集一部分请求的链路数据

采样策略：
  1. 固定比例：10%的请求采集
  2. 基于QPS：每秒采集100条
  3. 错误请求全采集（重要！）
  4. 慢请求全采集（响应时间>1s）
```

```yaml
# SkyWalking采样配置
skywalking:
  agent:
    sample_n_per_3_secs: 9    # 每3秒采集9个（相当于3 QPS）
    # 错误和慢请求会被强制采集，不受采样率限制
```

---

## 四、配置中心

### 为什么需要配置中心？

**没有配置中心：**

```
配置在application.yml里
→ 修改配置要重新打包部署
→ 重启服务（影响可用性）
→ 10台机器要改10次
→ 出错后回滚困难
```

**有了配置中心：**

```
配置在配置中心
→ 修改配置立即生效（不重启）
→ 所有机器同时更新
→ 版本管理（可回滚）
→ 灰度发布（只部分机器生效）
```

---

### Nacos配置中心

**核心功能：**

```
1. 动态配置：修改配置实时推送到应用
2. 版本管理：每次修改都有历史记录
3. 回滚：一键回滚到历史版本
4. 灰度：先发布到部分机器，验证后全量
5. 监听：配置变更时触发回调
```

**配置示例：**

```java
// Spring Boot集成Nacos配置中心
@Configuration
public class NacosConfig {

    @Value("${feature.seckill.limit:1000}")
    private int seckillLimit;

    @Value("${feature.recommend.enabled:true}")
    private boolean recommendEnabled;
}

// 动态刷新（加@RefreshScope）
@RestController
@RefreshScope
public class FeatureController {

    @Value("${feature.recommend.enabled:true}")
    private boolean recommendEnabled;

    @GetMapping("/recommend")
    public List<Product> getRecommend() {
        if (!recommendEnabled) {
            return Collections.emptyList();
        }
        return recommendService.get();
    }
}
```

**监听配置变更：**

```java
@Component
public class ConfigListener implements ApplicationRunner {

    @Autowired
    private NacosConfigManager configManager;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        configManager.getConfigService().addListener(
            "seckill-config",
            "DEFAULT_GROUP",
            new Listener() {
                @Override
                public void receiveConfigInfo(String configInfo) {
                    log.info("配置变更: {}", configInfo);
                    SeckillConfig config = JSON.parseObject(configInfo, SeckillConfig.class);
                    seckillService.updateConfig(config);
                }

                @Override
                public Executor getExecutor() {
                    return null;
                }
            }
        );
    }
}
```

---

### 配置的分层管理

```
Nacos命名空间（Namespace）：环境隔离
  - dev（开发环境）
  - test（测试环境）
  - prod（生产环境）

Group：业务隔离
  - ORDER_GROUP（订单相关配置）
  - SECKILL_GROUP（秒杀相关配置）

DataId：具体配置文件
  - application.yml（通用配置）
  - order-service.yml（服务特有配置）
```

---

## 五、API网关

### 网关的核心功能

```
[客户端]
  ↓
[API网关]
  → 路由（把请求转发到对应的微服务）
  → 鉴权（验证Token，不需要每个服务都做）
  → 限流（全局流量控制）
  → 熔断（下游服务故障时保护）
  → 负载均衡（配合注册中心）
  → 协议转换（HTTP → gRPC）
  → 请求/响应转换（数据格式转换）
  → 灰度发布（部分流量到新版本）
  → 日志记录
  ↓
[微服务集群]
```

---

### Spring Cloud Gateway配置

**路由配置：**

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-route
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
            - Method=GET,POST
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
            - name: CircuitBreaker
              args:
                name: orderCircuitBreaker
                fallbackUri: forward:/fallback/order

        - id: seckill-route
          uri: lb://seckill-service
          predicates:
            - Path=/api/seckill/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 1000
                redis-rate-limiter.burstCapacity: 2000
```

**全局过滤器（鉴权）：**

```java
@Component
@Order(-1)
public class AuthGlobalFilter implements GlobalFilter {

    private static final List<String> WHITE_LIST = Arrays.asList(
        "/api/user/login",
        "/api/user/register",
        "/api/product/list"
    );

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        if (WHITE_LIST.stream().anyMatch(path::startsWith)) {
            return chain.filter(exchange);
        }

        String token = exchange.getRequest().getHeaders().getFirst("Authorization");

        if (StringUtils.isEmpty(token)) {
            return returnUnauthorized(exchange, "请先登录");
        }

        return validateToken(token)
            .flatMap(userId -> {
                if (userId == null) {
                    return returnUnauthorized(exchange, "Token已过期，请重新登录");
                }

                ServerHttpRequest mutated = exchange.getRequest()
                    .mutate()
                    .header("X-User-Id", userId)
                    .build();

                return chain.filter(exchange.mutate().request(mutated).build());
            });
    }

    private Mono<String> validateToken(String token) {
        return Mono.fromCallable(() -> redis.get("token:" + token));
    }

    private Mono<Void> returnUnauthorized(ServerWebExchange exchange, String message) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        exchange.getResponse().getHeaders().add("Content-Type", "application/json");

        String body = JSON.toJSONString(Result.fail(message));
        DataBuffer buffer = exchange.getResponse().bufferFactory()
            .wrap(body.getBytes(StandardCharsets.UTF_8));

        return exchange.getResponse().writeWith(Mono.just(buffer));
    }
}
```

---

### 灰度发布

```java
@Component
public class GrayscaleFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String userId = exchange.getRequest().getHeaders().getFirst("X-User-Id");

        if (userId != null) {
            long uid = Long.parseLong(userId);

            if (uid % 10 == 0) {
                ServerHttpRequest mutated = exchange.getRequest()
                    .mutate()
                    .header("X-Version", "v2")
                    .build();
                return chain.filter(exchange.mutate().request(mutated).build());
            }
        }

        return chain.filter(exchange);
    }
}
```

---

## 六、完整的服务治理全景图

```
[用户请求]
    ↓
[DNS负载均衡]
    ↓
[API网关集群]
  - 全局鉴权
  - 全局限流
  - 路由
  - 熔断
  - 链路追踪（生成TraceID）
    ↓
[微服务集群]
  [订单服务]  [库存服务]  [用户服务]
      |              |            |
      +——————————————+————————————+
                     |
            [注册中心 Nacos]
            - 服务注册
            - 服务发现
            - 配置管理
                     |
            [监控体系]
            - Prometheus（指标采集）
            - Grafana（指标展示）
            - SkyWalking（链路追踪）
            - ELK（日志搜索）
```

---

## 七、面试高频题

### 1. 服务注册发现的原理？

**标准回答：**

```
三个角色：服务提供者、注册中心、服务消费者

流程：
1. 提供者启动 → 注册到注册中心（IP、端口、服务名）
2. 提供者定时心跳 → 超时未心跳自动剔除
3. 消费者启动 → 拉取服务列表 → 本地缓存
4. 消费者订阅变更 → 注册中心推送更新
5. 消费者调用 → 从本地缓存取实例 → 负载均衡 → 调用

注册中心宕机：消费者使用本地缓存，短时间不受影响
```

---

### 2. Redis分布式锁有什么坑？

**标准回答：**

```
坑1：锁过期，业务还没完
解决：Redisson看门狗自动续期

坑2：释放了别人的锁
解决：value用UUID，释放前用Lua脚本验证value

坑3：主从切换，锁丢失
解决：RedLock（多个Master都加锁）
     或换用ZooKeeper（强一致性）
```

---

### 3. ZooKeeper和Redis做分布式锁的区别？

**标准回答：**

```
Redis锁：
→ 基于SETNX + 过期时间
→ 性能高
→ 主从切换有极小概率丢锁
→ 适合高并发、容忍极小概率问题的场景

ZooKeeper锁：
→ 基于临时有序节点
→ 客户端宕机，临时节点自动删除
→ ZAB协议保证强一致性，不会丢锁
→ 性能低于Redis
→ 适合对一致性要求极高的场景（金融）

实际选择：
→ 大多数场景用Redis + Redisson
→ 金融核心场景用ZooKeeper
```

---

### 4. 链路追踪是如何跨服务传递TraceID的？

**标准回答：**

```
HTTP调用：
→ 发起方把TraceID放在HTTP Header（X-Trace-Id）
→ 接收方从Header提取，存入ThreadLocal
→ 日志框架从ThreadLocal取出，加入每条日志（MDC）
→ 调用下游时，从ThreadLocal取出，放入Header

消息队列：
→ 发送时把TraceID放入消息Header
→ 消费时从消息Header提取
→ 存入ThreadLocal

SkyWalking：
→ Java Agent方式
→ 自动拦截所有支持的框架
→ 无侵入透明传递
```

---

### 5. Nacos和Eureka的区别？

**标准回答：**

```
Nacos：
→ AP/CP可切换
→ 内置配置中心
→ 控制台功能丰富
→ 活跃维护
→ 国内首选

Eureka：
→ AP模式（强调可用性）
→ 只有注册发现，没有配置中心
→ Netflix已停止维护
→ 新项目不推荐

主要区别：
1. Nacos = 注册中心 + 配置中心
2. Nacos支持CP模式（强一致），Eureka只有AP
3. Nacos主动推送变更，Eureka客户端轮询
4. Nacos的心跳和健康检查更灵活
```

---

### 6. API网关和Nginx有什么区别？

**标准回答：**

```
Nginx：
→ 七层/四层负载均衡
→ 静态配置为主
→ 不感知服务注册发现
→ 性能极高（C语言）
→ 适合最外层流量接入

API网关：
→ 感知注册中心（服务发现）
→ 动态路由（不需要重启）
→ 业务级过滤器（鉴权、限流）
→ 配置可动态变更
→ 适合微服务内部流量治理

关系：
Nginx（最外层）→ API网关 → 微服务
```

---

### 7. 配置中心解决了什么问题？

**标准回答：**

```
解决的问题：
1. 配置修改需要重新部署（改为动态刷新）
2. 多台机器配置不一致（改为集中管理）
3. 配置没有版本记录（改为版本管理 + 回滚）
4. 无法灰度配置（改为灰度推送）
5. 配置变更无审计（改为变更记录）

核心能力：
→ 动态配置：不重启生效
→ 版本管理：随时回滚
→ 环境隔离：dev/test/prod分开
→ 监听推送：变更实时通知
```

---

## 八、核心结论

1. **服务注册发现消费者本地缓存，注册中心宕机不影响正常调用**
2. **Redis分布式锁三个坑：过期/释放他人锁/主从切换，Redisson全部解决**
3. **Redis锁高性能，ZooKeeper锁强一致，90%场景用Redis**
4. **TraceID通过HTTP Header跨服务传递，存入ThreadLocal**
5. **SkyWalking用Java Agent无侵入接入，生产环境要设采样率**
6. **Nacos = 注册中心 + 配置中心，国内新项目首选**
7. **API网关统一处理鉴权、限流、路由，避免各服务重复实现**
8. **配置中心解决配置动态刷新、版本管理、环境隔离**

---

## 九、练习题

### 练习1：分布式锁设计

场景：分布式定时任务，同一时刻只能有一台机器执行。

要求：
1. 用Redis实现（Redisson）
2. 任务执行超时怎么处理？（看门狗）
3. 任务执行完如何保证锁一定释放？
4. 写出完整代码

---

### 练习2：链路追踪

场景：服务A（HTTP）→ 服务B（HTTP）→ 服务C（Kafka消息）

要求：
1. TraceID如何从A传到B？
2. TraceID如何从B传到C（Kafka消息中）？
3. TraceID如何从Kafka传到服务C的处理代码？
4. 日志如何自动带上TraceID？

---

### 练习3：服务治理设计

为一个电商系统设计完整的服务治理方案：
- 3个微服务：订单服务、库存服务、用户服务
- 需要：注册发现、配置中心、鉴权、限流、链路追踪

要求：
1. 画出架构图
2. 选型（注册中心/网关/链路追踪）
3. 说明各组件的职责
4. 说明鉴权在哪一层实现

---

### 练习4：思考题

**为什么Redis分布式锁要用Lua脚本释放，而不是普通的DEL命令？**

---

## 十、下讲预告

**第 9 讲：高可用架构——同城双活与容灾设计**

会讲：高可用度量、单点故障排查与消除、同城双活架构、异地多活挑战、数据同步与一致性、流量调度与容灾切换、故障演练（混沌工程）、大厂高可用实践案例。
