# 第 6 讲：秒杀系统全链路设计

这一讲是整个高并发系列的**集大成之作**。

秒杀系统是高并发面试中**最高频的场景题**，也是检验你是否真正掌握高并发设计的试金石。

---

## 一、秒杀系统的核心难点

### 先理解秒杀的本质

**秒杀的特征：**
```
时间极短：可能只有1秒
库存极少：可能只有100个
用户极多：可能有100万用户同时抢

本质：
100万个并发请求，争抢100个库存
成功率 = 100 / 1000000 = 0.01%
99.99%的请求注定失败
```

**这带来了几个核心问题：**

### 难点1：瞬时高并发

```
平时QPS：1000
秒杀开始瞬间QPS：1000000

1000倍的流量突增
→ 数据库直接挂
→ 应用服务器直接挂
→ 全站崩溃
```

### 难点2：超卖问题

```
库存：100
并发请求：10000

如果没有并发控制：
→ 多个请求同时读到库存=1
→ 多个请求同时扣减
→ 库存扣成负数
→ 超卖了
```

### 难点3：数据一致性

```
Redis库存扣了，但数据库订单没创建
→ 用户扣了但没订单

数据库订单创建了，但库存没有正确扣减
→ 超卖
```

### 难点4：用户体验

```
99.99%的用户抢不到
→ 但不能给他们很差的体验
→ 不能让他们等很久
→ 要快速告诉他们结果
```

### 难点5：恶意请求

```
黄牛用脚本刷
→ 一个用户发几千个请求
→ 占用系统资源
→ 正常用户被挤出去
```

---

## 二、秒杀系统整体架构

### 架构总览

```
[用户]
  ↓
[CDN] ← 静态页面缓存
  ↓
[Nginx] ← 接入层限流、IP防刷
  ↓
[API网关] ← 鉴权、用户级限流、风控
  ↓
[秒杀服务] ← 核心逻辑
  ↓         ↓
[Redis]  [Kafka]
预扣库存   异步下单
  ↓         ↓
         [订单服务]
           ↓
         [MySQL] ← 最终落库
```

**核心思想：**
```
1. 用CDN + 静态化把大部分流量挡在最外层
2. 用多级限流把流量层层削减
3. 用Redis在内存中预扣库存（不打DB）
4. 用消息队列异步创建订单（削峰）
5. DB只做最终一致性保障
```

---

## 三、前端层：把流量挡在最外层

### 1. 页面静态化 + CDN

**商品详情页静态化：**
```
动态页面：
  用户请求 → 服务器 → 查DB → 渲染 → 返回HTML

静态化：
  用户请求 → CDN节点（就近） → 直接返回HTML文件
```

**实现：**
```
1. 商品信息提前生成静态HTML
2. 推送到CDN各节点
3. 用户访问直接命中CDN
4. 不打到源站
```

**效果：**
```
100万请求 → CDN拦截95万 → 只有5万打到源站
```

### 2. 按钮防重 + 前端限流

```javascript
// 点击按钮后禁用，防止重复点击
let isSubmitting = false;

function seckill(activityId) {
    if (isSubmitting) {
        return;  // 防重复提交
    }

    isSubmitting = true;
    document.getElementById('seckillBtn').disabled = true;
    document.getElementById('seckillBtn').innerText = '抢购中...';

    fetch('/api/seckill', {
        method: 'POST',
        body: JSON.stringify({ activityId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showResult('恭喜！抢购成功，订单号：' + data.orderNo);
        } else {
            showResult(data.message);
            // 失败后恢复按钮
            isSubmitting = false;
            document.getElementById('seckillBtn').disabled = false;
        }
    });
}
```

### 3. 验证码（防刷）

```
秒杀开始前要求用户输入验证码
→ 人工验证通过才能发起请求
→ 刷子脚本无法自动识别验证码
→ 把请求分散到几秒内（削峰）
```

```java
// 验证码校验
public boolean validateCaptcha(String userId, String captcha) {
    String key = "captcha:" + userId;
    String correct = redis.get(key);

    if (correct == null) {
        return false;  // 验证码过期
    }

    if (!correct.equalsIgnoreCase(captcha)) {
        return false;  // 验证码错误
    }

    redis.del(key);  // 用过即删
    return true;
}
```

### 4. 秒杀令牌（分散流量）

**思路：**
```
不直接开放秒杀接口
→ 先发放令牌（有限数量）
→ 只有拿到令牌的用户才能参与秒杀
→ 令牌数量 = 库存 × 3（多一点冗余）
→ 提前过滤掉大部分请求
```

```java
// 发放令牌（秒杀开始前5秒）
public void distributeTokens(Long activityId) {
    Activity activity = activityDao.getById(activityId);
    int tokenCount = activity.getStock() * 3;  // 库存的3倍令牌

    // 存入Redis Set（令牌池）
    for (int i = 0; i < tokenCount; i++) {
        String token = generateToken(activityId, i);
        redis.sadd("seckill:tokens:" + activityId, token);
    }

    redis.expire("seckill:tokens:" + activityId, 3600);
}

// 用户获取令牌
public String getToken(Long activityId, Long userId) {
    // 随机弹出一个令牌
    String token = redis.spop("seckill:tokens:" + activityId);

    if (token == null) {
        return null;  // 没有令牌了
    }

    // 绑定到用户
    redis.setex("seckill:user:token:" + userId + ":" + activityId, 300, token);
    return token;
}

// 秒杀时校验令牌
public boolean validateToken(Long userId, Long activityId, String token) {
    String key = "seckill:user:token:" + userId + ":" + activityId;
    String validToken = redis.get(key);
    return token.equals(validToken);
}
```

---

## 四、接入层：Nginx多维度限流

### Nginx配置

```nginx
http {
    # 按IP限流（防止单IP刷）
    limit_req_zone $binary_remote_addr
        zone=ip_seckill:10m
        rate=5r/s;          # 单IP每秒5个请求

    # 按接口限流（全局流量控制）
    limit_req_zone $server_name
        zone=global_seckill:10m
        rate=2000r/s;       # 全局每秒2000个

    # 按用户ID限流
    limit_req_zone $http_user_id
        zone=user_seckill:50m
        rate=1r/s;          # 单用户每秒1个

    server {
        location /api/seckill {
            # IP限流，突发允许5个，无延迟直接拒绝
            limit_req zone=ip_seckill burst=5 nodelay;

            # 全局限流
            limit_req zone=global_seckill burst=500 nodelay;

            # 用户限流
            limit_req zone=user_seckill burst=2 nodelay;

            # 限流后返回429
            limit_req_status 429;

            proxy_pass http://seckill_backend;

            # 超时控制
            proxy_connect_timeout 1s;
            proxy_read_timeout 3s;
        }
    }
}
```

---

## 五、网关层：鉴权 + 风控

### 鉴权

```java
@Component
public class AuthFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();

        // 1. 获取Token
        String token = request.getHeaders().getFirst("Authorization");
        if (StringUtils.isEmpty(token)) {
            return returnError(exchange, "未登录");
        }

        // 2. 验证Token（Redis中查）
        String userId = redis.get("token:" + token);
        if (userId == null) {
            return returnError(exchange, "Token失效");
        }

        // 3. 透传用户ID到下游
        ServerHttpRequest mutated = request.mutate()
            .header("X-User-Id", userId)
            .build();

        return chain.filter(exchange.mutate().request(mutated).build());
    }
}
```

### 风控（防刷）

```java
@Component
public class RiskControlFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        if (!isSeckillRequest(exchange)) {
            return chain.filter(exchange);
        }

        String userId = exchange.getRequest().getHeaders().getFirst("X-User-Id");
        String ip = getClientIp(exchange);

        // 1. 黑名单检查
        if (isBlacklisted(userId, ip)) {
            return returnError(exchange, "账号异常");
        }

        // 2. 用户行为检查（短时间内请求太多）
        if (isAbnormalBehavior(userId)) {
            markAsRisk(userId);
            return returnError(exchange, "操作过于频繁");
        }

        // 3. 设备指纹检查（同一设备多个账号）
        String deviceId = exchange.getRequest().getHeaders().getFirst("X-Device-Id");
        if (isSuspiciousDevice(deviceId)) {
            return returnError(exchange, "设备异常");
        }

        return chain.filter(exchange);
    }

    private boolean isAbnormalBehavior(String userId) {
        String key = "risk:behavior:" + userId;
        Long count = redis.incr(key);
        redis.expire(key, 60);  // 1分钟窗口

        return count > 20;  // 1分钟内超过20次请求
    }
}
```

---

## 六、秒杀服务：核心逻辑

### 整体流程

```java
@RestController
public class SeckillController {

    @PostMapping("/api/seckill")
    @SentinelResource(value = "seckill", blockHandler = "seckillBlock")
    public Result seckill(@RequestBody SeckillRequest request,
                          @RequestHeader("X-User-Id") Long userId) {

        // 1. 参数校验
        validateRequest(request, userId);

        // 2. 用户资格校验
        checkUserEligibility(userId, request.getActivityId());

        // 3. 活动校验（时间、状态）
        checkActivity(request.getActivityId());

        // 4. Redis预扣库存（核心）
        boolean deducted = preDeductStock(userId, request.getActivityId());
        if (!deducted) {
            return Result.fail("库存不足，手慢了");
        }

        // 5. 发送消息到Kafka（异步下单）
        sendOrderMessage(userId, request.getActivityId());

        // 6. 返回排队中
        return Result.success("正在为您抢购，请稍候查看结果");
    }

    // 限流后的处理
    public Result seckillBlock(SeckillRequest request, Long userId, BlockException ex) {
        return Result.fail("系统繁忙，请稍后再试");
    }
}
```

### 步骤1：参数校验

```java
private void validateRequest(SeckillRequest request, Long userId) {
    if (request == null) {
        throw new BusinessException("参数不能为空");
    }
    if (request.getActivityId() == null || request.getActivityId() <= 0) {
        throw new BusinessException("活动ID非法");
    }
    if (userId == null || userId <= 0) {
        throw new BusinessException("用户ID非法");
    }
}
```

### 步骤2：用户资格校验

```java
private void checkUserEligibility(Long userId, Long activityId) {
    // 1. 是否已经参与过这个活动（防止重复购买）
    String boughtKey = "seckill:bought:" + activityId + ":" + userId;
    if (redis.exists(boughtKey)) {
        throw new BusinessException("您已参与过此活动");
    }

    // 2. 账号是否正常
    if (isUserBlocked(userId)) {
        throw new BusinessException("账号异常，无法参与");
    }
}
```

### 步骤3：活动校验

```java
private void checkActivity(Long activityId) {
    // 活动信息缓存在Redis（避免每次查DB）
    String activityKey = "seckill:activity:" + activityId;
    SeckillActivity activity = redis.getObject(activityKey, SeckillActivity.class);

    if (activity == null) {
        // 缓存未命中，查DB
        activity = activityDao.getById(activityId);
        if (activity != null) {
            redis.setex(activityKey, 300, JSON.toJSONString(activity));
        }
    }

    if (activity == null) {
        throw new BusinessException("活动不存在");
    }

    // 活动状态
    if (activity.getStatus() != ActivityStatus.RUNNING) {
        throw new BusinessException("活动未开始或已结束");
    }

    // 活动时间（关键：服务器时间，不能用客户端时间）
    long now = System.currentTimeMillis();
    if (now < activity.getStartTime().getTime()) {
        throw new BusinessException("活动尚未开始");
    }
    if (now > activity.getEndTime().getTime()) {
        throw new BusinessException("活动已结束");
    }
}
```

### 步骤4：Redis预扣库存（核心中的核心）

**为什么用Lua脚本？**
```
普通操作：
  GET stock → 判断 → DECR stock

这三步不是原子的：
  线程A：GET stock = 1（库存还有1个）
  线程B：GET stock = 1（库存还有1个）
  线程A：DECR stock = 0
  线程B：DECR stock = -1  ← 超卖！

Lua脚本：在Redis中原子执行，不会被其他命令打断
```

```java
private boolean preDeductStock(Long userId, Long activityId) {
    String stockKey = "seckill:stock:" + activityId;
    String boughtKey = "seckill:bought:" + activityId + ":" + userId;

    // Lua脚本：原子执行 判断库存 + 扣减 + 标记用户已购
    String script =
        // 1. 检查用户是否已购买
        "if redis.call('exists', KEYS[2]) == 1 then " +
        "    return -1; " +  // 已购买
        "end; " +

        // 2. 获取当前库存
        "local stock = tonumber(redis.call('get', KEYS[1])); " +

        // 3. 判断库存
        "if stock == nil or stock <= 0 then " +
        "    return 0; " +  // 库存不足
        "end; " +

        // 4. 扣减库存
        "redis.call('decrby', KEYS[1], 1); " +

        // 5. 标记用户已购买（30分钟有效，对应支付超时时间）
        "redis.call('setex', KEYS[2], 1800, '1'); " +

        "return 1; ";  // 扣减成功

    Long result = redis.execute(
        new DefaultRedisScript<>(script, Long.class),
        Arrays.asList(stockKey, boughtKey)
    );

    if (result == null) {
        return false;
    }

    if (result == -1) {
        throw new BusinessException("您已参与过此活动，请勿重复抢购");
    }

    return result == 1;
}
```

**Redis库存预热（活动开始前）：**
```java
@Scheduled(cron = "0 0/5 * * * ?")  // 每5分钟检查
public void preloadSeckillStock() {
    List<SeckillActivity> activities = activityDao.getUpcomingActivities();

    for (SeckillActivity activity : activities) {
        // 活动开始前10分钟预热
        long startTime = activity.getStartTime().getTime();
        long now = System.currentTimeMillis();

        if (startTime - now <= 10 * 60 * 1000) {
            String stockKey = "seckill:stock:" + activity.getId();

            // 只有Redis中没有才预热
            if (!redis.exists(stockKey)) {
                redis.set(stockKey, String.valueOf(activity.getStock()));
                redis.expire(stockKey, 7200);  // 2小时过期

                log.info("预热秒杀库存: activityId={}, stock={}",
                    activity.getId(), activity.getStock());
            }
        }
    }
}
```

### 步骤5：发送消息到Kafka

```java
private void sendOrderMessage(Long userId, Long activityId) {
    SeckillMessage message = new SeckillMessage();
    message.setUserId(userId);
    message.setActivityId(activityId);
    message.setTimestamp(System.currentTimeMillis());
    message.setMsgId(generateMsgId());  // 消息唯一ID（用于幂等）

    // 发送到Kafka
    // 用userId做Key，保证同一用户的消息有序
    kafkaProducer.send(
        new ProducerRecord<>(
            "seckill-order-topic",
            userId.toString(),              // Key（路由到同一分区）
            JSON.toJSONString(message)      // Value
        ),
        (metadata, exception) -> {
            if (exception != null) {
                // 发送失败处理
                log.error("消息发送失败: userId={}", userId, exception);

                // 回滚Redis库存
                rollbackStock(userId, activityId);
            }
        }
    );
}

// 库存回滚
private void rollbackStock(Long userId, Long activityId) {
    String stockKey = "seckill:stock:" + activityId;
    String boughtKey = "seckill:bought:" + activityId + ":" + userId;

    // Lua脚本原子回滚
    String script =
        "redis.call('incr', KEYS[1]); " +
        "redis.call('del', KEYS[2]); " +
        "return 1;";

    redis.execute(
        new DefaultRedisScript<>(script, Long.class),
        Arrays.asList(stockKey, boughtKey)
    );

    log.info("库存回滚成功: userId={}, activityId={}", userId, activityId);
}
```

---

## 七、订单服务：消费消息创建订单

### 消费者设计

```java
@Component
public class SeckillOrderConsumer {

    @KafkaListener(
        topics = "seckill-order-topic",
        groupId = "seckill-order-group",
        concurrency = "8"  // 8个并发消费者（对应8个分区）
    )
    public void consume(ConsumerRecord<String, String> record,
                        Acknowledgment acknowledgment) {
        SeckillMessage message = JSON.parseObject(record.value(), SeckillMessage.class);

        try {
            // 处理消息
            processOrder(message);

            // 手动提交offset（处理成功后才提交）
            acknowledgment.acknowledge();

        } catch (BusinessException e) {
            // 业务异常（如重复购买），不重试
            log.warn("业务异常: {}", e.getMessage());
            acknowledgment.acknowledge();  // 直接提交，不重试

        } catch (Exception e) {
            // 系统异常，抛出让Kafka重试
            log.error("处理失败，等待重试", e);
            throw e;
        }
    }

    @Transactional
    private void processOrder(SeckillMessage message) {
        Long userId = message.getUserId();
        Long activityId = message.getActivityId();

        // 1. 幂等检查（防止重复处理）
        if (isAlreadyProcessed(message.getMsgId())) {
            log.warn("消息已处理，跳过: msgId={}", message.getMsgId());
            return;
        }

        // 2. 再次检查用户是否已购买（数据库级别兜底）
        if (orderDao.existsByUserAndActivity(userId, activityId)) {
            log.warn("订单已存在: userId={}, activityId={}", userId, activityId);
            return;
        }

        // 3. 获取活动信息
        SeckillActivity activity = activityDao.getById(activityId);

        // 4. 扣减数据库库存（乐观锁）
        int affected = activityDao.deductStock(activityId, activity.getVersion());
        if (affected == 0) {
            // 乐观锁冲突，重试
            throw new RetryException("库存扣减冲突，重试");
        }

        // 5. 创建订单
        Order order = createOrder(userId, activity);
        orderDao.insert(order);

        // 6. 标记消息已处理
        markAsProcessed(message.getMsgId());

        // 7. 通知用户（异步）
        notifyUser(userId, order);

        log.info("订单创建成功: userId={}, orderNo={}", userId, order.getOrderNo());
    }
}
```

### 幂等处理

```java
// 幂等表
@Mapper
public interface MessageDedupMapper {
    @Insert("INSERT IGNORE INTO message_dedup(msg_id, create_time) VALUES(#{msgId}, NOW())")
    int insert(@Param("msgId") String msgId);

    @Select("SELECT COUNT(1) FROM message_dedup WHERE msg_id = #{msgId}")
    int exists(@Param("msgId") String msgId);
}

// 检查并标记
private boolean isAlreadyProcessed(String msgId) {
    return messageDedupMapper.exists(msgId) > 0;
}

private void markAsProcessed(String msgId) {
    try {
        messageDedupMapper.insert(msgId);
    } catch (DuplicateKeyException e) {
        // 已存在，忽略
    }
}
```

### 数据库库存扣减（乐观锁防超卖）

```java
// Mapper
@Update("UPDATE seckill_activity " +
        "SET stock = stock - 1, version = version + 1 " +
        "WHERE id = #{id} AND stock > 0 AND version = #{version}")
int deductStock(@Param("id") Long id, @Param("version") Integer version);

// Service（带重试）
private void deductStockWithRetry(Long activityId) {
    int maxRetry = 3;

    for (int i = 0; i < maxRetry; i++) {
        SeckillActivity activity = activityDao.getById(activityId);

        if (activity.getStock() <= 0) {
            throw new BusinessException("库存已售罄");
        }

        int affected = activityDao.deductStock(activityId, activity.getVersion());

        if (affected > 0) {
            return;  // 扣减成功
        }

        // 乐观锁冲突，等待重试
        log.warn("乐观锁冲突，第{}次重试", i + 1);
        try {
            Thread.sleep(50 * (i + 1));  // 递增等待
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    throw new BusinessException("库存扣减失败，请重试");
}
```

### 订单创建

```java
private Order createOrder(Long userId, SeckillActivity activity) {
    Order order = new Order();

    // 全局唯一订单号（雪花算法）
    order.setOrderNo(snowflakeIdGenerator.nextId());
    order.setUserId(userId);
    order.setActivityId(activity.getId());
    order.setProductId(activity.getProductId());

    // 快照价格（不能引用商品当前价格，要用活动时的价格）
    order.setActivityPrice(activity.getActivityPrice());
    order.setProductName(activity.getProductName());  // 商品名称快照

    order.setStatus(OrderStatus.CREATED);
    order.setCreateTime(new Date());
    order.setExpireTime(new Date(System.currentTimeMillis() + 30 * 60 * 1000));  // 30分钟后过期

    return order;
}
```

---

## 八、超时取消：订单未支付自动关闭

### 延迟消息实现

```java
// 创建订单后，发送延迟消息
private void sendCancelMessage(Order order) {
    Message cancelMsg = new Message();
    cancelMsg.setTopic("order-cancel-topic");
    cancelMsg.setBody(JSON.toJSONString(order).getBytes());

    // RocketMQ延迟30分钟
    cancelMsg.setDelayTimeLevel(16);  // Level16 = 30分钟

    rocketMQProducer.send(cancelMsg);
}

// 取消消费者
@RocketMQMessageListener(
    topic = "order-cancel-topic",
    consumerGroup = "order-cancel-group"
)
public class OrderCancelConsumer implements RocketMQListener<String> {

    @Override
    public void onMessage(String message) {
        Order order = JSON.parseObject(message, Order.class);

        // 查询最新订单状态
        Order current = orderDao.getByOrderNo(order.getOrderNo());

        if (current == null) {
            return;
        }

        // 只取消未支付的订单
        if (current.getStatus() != OrderStatus.CREATED) {
            log.info("订单已支付或已取消，跳过: orderNo={}", order.getOrderNo());
            return;
        }

        // 取消订单（乐观锁）
        int affected = orderDao.cancelOrder(
            order.getOrderNo(),
            OrderStatus.CREATED,      // 期望的当前状态
            OrderStatus.CANCELLED     // 要变更的状态
        );

        if (affected > 0) {
            // 恢复库存
            restoreStock(order.getActivityId());
            log.info("订单超时取消: orderNo={}", order.getOrderNo());
        }
    }

    private void restoreStock(Long activityId) {
        // 1. 恢复DB库存
        activityDao.increaseStock(activityId);

        // 2. 恢复Redis库存
        String stockKey = "seckill:stock:" + activityId;
        redis.incr(stockKey);

        log.info("库存恢复: activityId={}", activityId);
    }
}
```

---

## 九、结果查询：用户如何知道抢没抢到

### 轮询方案

```java
// 前端轮询
async function pollResult(userId, activityId) {
    const maxAttempts = 10;
    let attempts = 0;

    const poll = setInterval(async () => {
        attempts++;

        const result = await fetch(`/api/seckill/result?userId=${userId}&activityId=${activityId}`);
        const data = await result.json();

        if (data.status === 'SUCCESS') {
            clearInterval(poll);
            showSuccess('抢购成功！订单号：' + data.orderNo);
        } else if (data.status === 'FAILED') {
            clearInterval(poll);
            showFail('很遗憾，未能抢到');
        } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            showFail('查询超时，请刷新页面查看结果');
        }
        // 否则继续轮询
    }, 1000);  // 每秒查一次
}

// 后端接口
@GetMapping("/api/seckill/result")
public Result getSeckillResult(Long userId, Long activityId) {
    // 1. 查Redis（快）
    String resultKey = "seckill:result:" + activityId + ":" + userId;
    String result = redis.get(resultKey);

    if ("SUCCESS".equals(result)) {
        // 查订单号
        String orderNo = redis.get("seckill:orderNo:" + activityId + ":" + userId);
        return Result.success(new SeckillResult("SUCCESS", orderNo));
    } else if ("FAILED".equals(result)) {
        return Result.success(new SeckillResult("FAILED", null));
    }

    // 2. 查DB（兜底）
    Order order = orderDao.getByUserAndActivity(userId, activityId);
    if (order != null) {
        return Result.success(new SeckillResult("SUCCESS", order.getOrderNo()));
    }

    return Result.success(new SeckillResult("PROCESSING", null));
}
```

**订单创建后通知结果：**
```java
private void notifyUser(Long userId, Order order) {
    // 写入结果到Redis
    String resultKey = "seckill:result:" + order.getActivityId() + ":" + userId;
    String orderNoKey = "seckill:orderNo:" + order.getActivityId() + ":" + userId;

    redis.setex(resultKey, 3600, "SUCCESS");
    redis.setex(orderNoKey, 3600, order.getOrderNo().toString());

    // 推送通知（WebSocket / 短信）
    notificationService.notify(userId, "恭喜！秒杀成功，订单号：" + order.getOrderNo());
}
```

### WebSocket实时推送（更好的体验）

```java
// WebSocket推送
@Component
public class SeckillResultPusher {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    public void pushResult(Long userId, SeckillResult result) {
        // 推送给指定用户
        messagingTemplate.convertAndSendToUser(
            userId.toString(),
            "/topic/seckill/result",
            result
        );
    }
}

// 订单创建后推送
private void notifyUser(Long userId, Order order) {
    SeckillResult result = new SeckillResult();
    result.setStatus("SUCCESS");
    result.setOrderNo(order.getOrderNo());

    // 实时推送
    seckillResultPusher.pushResult(userId, result);
}
```

---

## 十、防超卖的完整方案

### 三层防超卖

```
第一层：Redis Lua脚本（最快，内存级别）
  → 原子操作，库存不会扣成负数
  → 预扣库存

第二层：乐观锁（数据库级别）
  → stock > 0 AND version = #{version}
  → 确保DB不会超卖

第三层：唯一约束（最终兜底）
  → 订单表按用户+活动建唯一索引
  → 即使有Bug，DB层也能拦截重复订单
```

```sql
-- 唯一约束
ALTER TABLE order_info
ADD UNIQUE KEY uk_user_activity (user_id, activity_id);

-- 库存表
CREATE TABLE seckill_activity (
    id BIGINT NOT NULL,
    stock INT NOT NULL DEFAULT 0 COMMENT '剩余库存',
    version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    ...
);
```

### 超卖场景模拟与验证

```java
// 并发测试
@Test
public void testSeckillConcurrency() throws InterruptedException {
    int userCount = 10000;  // 1万用户
    int stock = 100;        // 100个库存

    // 预热库存
    redis.set("seckill:stock:1", String.valueOf(stock));

    CountDownLatch latch = new CountDownLatch(userCount);
    AtomicInteger successCount = new AtomicInteger(0);
    AtomicInteger failCount = new AtomicInteger(0);

    ExecutorService executor = Executors.newFixedThreadPool(200);

    for (int i = 0; i < userCount; i++) {
        final long userId = i + 1;
        executor.submit(() -> {
            try {
                boolean result = seckillService.seckill(userId, 1L);
                if (result) {
                    successCount.incrementAndGet();
                } else {
                    failCount.incrementAndGet();
                }
            } finally {
                latch.countDown();
            }
        });
    }

    latch.await(30, TimeUnit.SECONDS);

    System.out.println("成功数: " + successCount.get());  // 应该等于100
    System.out.println("失败数: " + failCount.get());    // 应该等于9900

    // 验证库存
    String stockLeft = redis.get("seckill:stock:1");
    System.out.println("剩余库存: " + stockLeft);  // 应该等于0

    // 验证不超卖
    Assert.assertEquals(stock, successCount.get());
}
```

---

## 十一、高可用保障

### Sentinel规则

```java
@Configuration
public class SeckillSentinelConfig {

    @PostConstruct
    public void initRules() {
        List<FlowRule> flowRules = new ArrayList<>();
        List<DegradeRule> degradeRules = new ArrayList<>();

        // 秒杀接口限流
        FlowRule seckillFlow = new FlowRule("seckill");
        seckillFlow.setGrade(RuleConstant.FLOW_GRADE_QPS);
        seckillFlow.setCount(10000);  // 1万QPS
        seckillFlow.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_WARM_UP);
        seckillFlow.setWarmUpPeriodSec(5);  // 5秒预热
        flowRules.add(seckillFlow);

        // Redis调用熔断
        DegradeRule redisDegrade = new DegradeRule("redis.deductStock");
        redisDegrade.setGrade(CircuitBreakerStrategy.ERROR_RATIO.getType());
        redisDegrade.setCount(0.5);   // 错误率50%触发熔断
        redisDegrade.setMinRequestAmount(10);
        redisDegrade.setTimeWindow(30);
        degradeRules.add(redisDegrade);

        // Kafka发送熔断
        DegradeRule kafkaDegrade = new DegradeRule("kafka.sendMessage");
        kafkaDegrade.setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType());
        kafkaDegrade.setCount(500);   // RT > 500ms算慢
        kafkaDegrade.setSlowRatioThreshold(0.3);
        kafkaDegrade.setMinRequestAmount(10);
        kafkaDegrade.setTimeWindow(60);
        degradeRules.add(kafkaDegrade);

        FlowRuleManager.loadRules(flowRules);
        DegradeRuleManager.loadRules(degradeRules);
    }
}
```

### Redis故障降级

```java
private boolean preDeductStock(Long userId, Long activityId) {
    try {
        return doPreDeductStock(userId, activityId);
    } catch (RedisException e) {
        log.error("Redis故障，降级到数据库扣减", e);

        // 降级：直接走数据库（性能差，但能保证正确性）
        return fallbackToDBDeduct(userId, activityId);
    }
}

private boolean fallbackToDBDeduct(Long userId, Long activityId) {
    // 加分布式锁（防止超卖）
    String lockKey = "seckill:lock:" + activityId;

    RLock lock = redisson.getLock(lockKey);
    try {
        boolean locked = lock.tryLock(1, 3, TimeUnit.SECONDS);
        if (!locked) {
            return false;
        }

        // 查DB库存
        SeckillActivity activity = activityDao.getById(activityId);
        if (activity.getStock() <= 0) {
            return false;
        }

        // 扣减
        int affected = activityDao.deductStock(activityId, activity.getVersion());
        return affected > 0;

    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return false;
    } finally {
        lock.unlock();
    }
}
```

### Kafka故障处理

```java
private void sendOrderMessage(Long userId, Long activityId) {
    try {
        doSendKafkaMessage(userId, activityId);
    } catch (Exception e) {
        log.error("Kafka发送失败，降级到本地消息表", e);

        // 降级：写本地消息表
        LocalMessage localMsg = new LocalMessage();
        localMsg.setTopic("seckill-order-topic");
        localMsg.setBody(buildMessageBody(userId, activityId));
        localMsg.setStatus("INIT");
        localMessageDao.insert(localMsg);

        // 后台线程定时重发
    }
}

// 后台重发任务
@Scheduled(fixedRate = 5000)
public void retryLocalMessages() {
    List<LocalMessage> messages = localMessageDao.findPending(100);

    for (LocalMessage msg : messages) {
        try {
            kafkaProducer.send(msg.getTopic(), msg.getBody());
            msg.setStatus("SENT");
        } catch (Exception e) {
            msg.setRetryCount(msg.getRetryCount() + 1);
            if (msg.getRetryCount() >= 5) {
                msg.setStatus("FAILED");
                // 人工处理
                alertService.notifyAdmin(msg);
            }
        }
        localMessageDao.update(msg);
    }
}
```

---

## 十二、数据库设计

### 秒杀活动表

```sql
CREATE TABLE `seckill_activity` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '活动ID',
    `activity_name` VARCHAR(128) NOT NULL COMMENT '活动名称',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `product_name` VARCHAR(255) NOT NULL COMMENT '商品名称（快照）',
    `original_price` DECIMAL(12,2) NOT NULL COMMENT '原价',
    `activity_price` DECIMAL(12,2) NOT NULL COMMENT '秒杀价',
    `total_stock` INT NOT NULL COMMENT '总库存',
    `stock` INT NOT NULL COMMENT '剩余库存',
    `version` INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态：0待开始 1进行中 2已结束',
    `start_time` DATETIME NOT NULL COMMENT '开始时间',
    `end_time` DATETIME NOT NULL COMMENT '结束时间',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_status_start_time` (`status`, `start_time`)
) ENGINE=InnoDB COMMENT='秒杀活动表';
```

### 秒杀订单表

```sql
CREATE TABLE `seckill_order` (
    `id` BIGINT UNSIGNED NOT NULL COMMENT '主键（雪花ID）',
    `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `activity_id` BIGINT UNSIGNED NOT NULL COMMENT '活动ID',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `product_name` VARCHAR(255) NOT NULL COMMENT '商品名称（快照）',
    `activity_price` DECIMAL(12,2) NOT NULL COMMENT '成交价格',
    `status` TINYINT NOT NULL DEFAULT 0 COMMENT '0待支付 1已支付 2已取消',
    `expire_time` DATETIME NOT NULL COMMENT '支付截止时间',
    `pay_time` DATETIME COMMENT '支付时间',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    UNIQUE KEY `uk_user_activity` (`user_id`, `activity_id`),  -- 防重复购买
    KEY `idx_user_id` (`user_id`),
    KEY `idx_activity_id` (`activity_id`)
) ENGINE=InnoDB COMMENT='秒杀订单表';
```

### 消息幂等表

```sql
CREATE TABLE `message_dedup` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `msg_id` VARCHAR(128) NOT NULL COMMENT '消息唯一ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_msg_id` (`msg_id`)
) ENGINE=InnoDB COMMENT='消息幂等表';
```

---

## 十三、完整流程串联

### 正常成功流程

```
1. 用户打开秒杀页面
   → CDN返回静态页面（不打源站）

2. 前端显示倒计时
   → 服务器时间（避免客户端时钟不准）

3. 秒杀开始，用户点击按钮
   → 按钮立即禁用（防重复）
   → 发送验证码（如有）

4. 请求到达Nginx
   → IP限流检查（每IP每秒5次）
   → 通过

5. 请求到达网关
   → 鉴权（Token验证）
   → 风控（行为检查）
   → 通过

6. 请求到达秒杀服务
   → 参数校验
   → 用户资格校验（是否已购买）
   → 活动校验（时间、状态）
   → Redis预扣库存（Lua脚本原子操作） -- 扣减成功
   → 发送消息到Kafka
   → 返回"排队中"

7. 订单服务消费Kafka消息
   → 幂等检查 -- 未处理
   → DB库存扣减（乐观锁）
   → 创建订单
   → 写入结果到Redis
   → 通知用户

8. 前端轮询结果
   → 查到"SUCCESS"
   → 显示"恭喜！抢购成功"
   → 跳转到订单页

9. RocketMQ延迟消息（30分钟后）
   → 检查订单是否支付
   → 未支付 → 取消订单，恢复库存
```

### 失败流程（库存不足）

```
6. 请求到达秒杀服务
   → Redis预扣库存（Lua脚本）→ 库存=0，返回失败
   → 立即返回"很遗憾，手慢了"

（不进入消息队列，不打数据库）
```

### 异常流程（消息发送失败）

```
6. Redis预扣成功
   → Kafka发送失败
   → 回滚Redis库存（Lua原子操作）
   → 返回"系统繁忙，请重试"
```

---

## 十四、容量评估

### 秒杀场景容量计算

```
假设：
  - 100万用户参与
  - 库存：1000个
  - 秒杀持续时间：1秒（极端）

峰值QPS = 1000000 / 1 = 100万

各层处理能力：
  Nginx：50万 QPS（限流到2万放进来）
  网关：2万 QPS（限流到5000放进来）
  秒杀服务：5000 QPS x N台
  Redis：10万 QPS（扛住）
  Kafka：1万 TPS（扛住）
  DB：5000 TPS（只接受Kafka来的消息，可控）

机器数量：
  秒杀服务：5000 QPS需要，单机1000 QPS，需要5台
  消费者：1000 TPS，单机200 TPS，需要5台
```

---

## 十五、面试答题模板

### "请设计一个秒杀系统"标准回答

**第一步：说清楚难点（30秒）**

```
秒杀系统的核心难点是：
1. 瞬时高并发：百万QPS打到系统
2. 超卖问题：多人抢到同一个库存
3. 数据一致性：Redis扣了但DB没扣
4. 用户体验：要快速给出结果

我会从接入层→服务层→数据层逐层讲解。
```

**第二步：说架构（2分钟）**

```
整体分为五层：
1. 前端层：页面静态化 + CDN，挡住90%的流量
2. 接入层：Nginx限流 + IP防刷
3. 网关层：鉴权 + 风控 + 用户级限流
4. 服务层：Redis预扣库存 + Kafka异步下单
5. 数据层：DB最终落库，乐观锁防超卖
```

**第三步：说核心（2分钟）**

```
核心是Redis预扣库存：
用Lua脚本原子执行三个操作：
1. 检查用户是否已购买
2. 检查库存是否充足
3. 扣减库存 + 标记用户已购

Lua保证原子性，彻底防止超卖。
```

**第四步：说一致性（1分钟）**

```
三层防超卖：
1. Redis Lua：内存层防超卖
2. DB乐观锁：stock > 0 AND version=#{version}
3. 唯一约束：uk_user_activity，DB兜底

Redis和DB的一致性：
通过Kafka消息 + 本地消息表保证最终一致
```

**第五步：说高可用（1分钟）**

```
限流：Sentinel 10000 QPS限制
熔断：Redis/Kafka故障时有降级方案
降级：Redis挂了→DB+分布式锁兜底
监控：消费延迟、库存变化、订单成功率
```

---

## 十六、核心结论

1. **秒杀核心：Redis Lua原子扣减库存，是防超卖的关键**
2. **三层防超卖：Redis Lua + DB乐观锁 + 唯一约束**
3. **流量层层削减：CDN → Nginx → 网关 → 服务层**
4. **异步下单：Kafka削峰，让DB从百万QPS降到几千TPS**
5. **幂等设计：消息唯一ID + 去重表，防止重复创建订单**
6. **延迟消息：30分钟未支付自动取消，恢复库存**
7. **降级兜底：Redis挂了走DB+锁，Kafka挂了走本地消息表**
8. **库存预热：活动开始前写入Redis，避免活动开始时打DB**

---

## 十七、练习题

### 练习1：Lua脚本

写一个Lua脚本，实现：
- 检查用户是否已购买（key: `seckill:bought:{activityId}:{userId}`）
- 检查库存（key: `seckill:stock:{activityId}`）
- 扣减库存
- 标记用户已购买（有效期30分钟）
- 返回：-1=已购买，0=库存不足，1=成功

### 练习2：超时取消

订单30分钟未支付要自动取消，并且恢复库存。

要求：
1. 取消时要保证幂等（多次取消不出错）
2. 恢复库存要同时恢复Redis和DB
3. 如果恢复失败怎么兜底？

### 练习3：架构思考

如果秒杀活动有10万个库存（不是100个），设计上有什么不同？

提示：
- Redis库存预扣还适合吗？
- 消息队列还需要吗？
- 数据库压力是什么量级？

### 练习4：故障场景

场景：秒杀进行到一半，Redis突然宕机，怎么办？

要求：
1. 用户正在秒杀的请求怎么处理？
2. 已经扣了Redis库存但还没发消息的怎么办？
3. 系统如何自动恢复？
