# 第4讲：服务治理（限流、熔断、降级）

## 核心结论（5条必记）

1. **限流保护系统不被压垮** -- 超出容量的请求直接拒绝，避免雪崩，令牌桶和漏桶是常用算法
2. **熔断防止故障扩散** -- 下游服务异常时快速失败，避免线程池耗尽，熔断器有关闭/打开/半开三种状态
3. **降级保障核心功能** -- 非核心功能降级返回默认值，确保系统核心链路可用
4. **超时控制避免无限等待** -- 设置合理的超时时间，超时后立即失败，配合重试机制
5. **幂等性设计是重试的前提** -- 没有幂等的重试会导致重复下单、重复扣款，幂等通过唯一ID或状态机保证

---

## 一、限流

### 为什么需要限流

**场景：**
- 秒杀活动：流量瞬间爆发
- 恶意攻击：爬虫、DDoS
- 下游故障：依赖服务响应变慢

**限流的价值：**
- 保护系统不被压垮
- 保证核心用户可用
- 争取故障恢复时间

### 限流算法

#### 固定窗口

**原理：** 统计固定时间窗口内的请求数，超过阈值则拒绝。

```
时间窗口：1秒
阈值：100请求
9:00:00 - 9:00:01  90请求  通过
9:00:01 - 9:00:02  100请求 通过
9:00:02 - 9:00:03  100请求 通过
```

**问题：** 边界突发流量，窗口切换瞬间可能2倍流量。

#### 滑动窗口

**原理：** 将时间窗口切分为多个小格，滑动统计。

```
时间窗口：1秒，切分为10格，每格100ms
当前窗口 = 最近10格的请求总和
```

**优点：** 更平滑，解决边界突发问题。

#### 令牌桶算法

**原理：**
- 以恒定速率向桶中放入令牌
- 请求到达时从桶中取令牌
- 桶满则丢弃令牌，桶空则拒绝请求

**特点：**
- 平均速率受限，允许突发流量
- 桶容量 = 最大突发流量

**应用：** Nginx限流、Sentinel

#### 漏桶算法

**原理：**
- 请求先进入桶中
- 以恒定速率从桶中流出处理
- 桶满则拒绝请求

**特点：**
- 强制恒定流出，完全平滑流量
- 无法应对突发流量

**应用：** 消息队列削峰填谷

### 限流维度

| 维度 | 说明 | 示例 |
|------|------|------|
| 全局限流 | 整个系统的请求上限 | 防止系统过载 |
| 接口限流 | 单个接口的请求上限 | 核心接口保护 |
| 用户限流 | 单个用户的请求上限 | 防止单用户刷接口 |
| IP限流 | 单个IP的请求上限 | 防止恶意攻击 |

### Sentinel限流实战

```java
@RestController
public class OrderController {

    @GetMapping("/order/create")
    @SentinelResource(value = "createOrder", blockHandler = "handleBlock")
    public Result createOrder(@RequestParam Long userId) {
        // 业务逻辑
        return Result.success();
    }

    public Result handleBlock(Long userId, BlockException ex) {
        return Result.error("当前访问人数过多，请稍后再试");
    }
}
```

**限流规则配置：**
```java
// 通过代码配置
List<FlowRule> rules = new ArrayList<>();
FlowRule rule = new FlowRule();
rule.setResource("createOrder");
rule.setGrade(RuleConstant.FLOW_GRADE_QPS);
rule.setCount(100); // QPS阈值
rules.add(rule);
FlowRuleManager.loadRules(rules);
```

---

## 二、熔断

### 为什么需要熔断

**场景：**
- 下游服务响应变慢或超时
- 下游服务异常率升高

**不熔断的后果：**
- 线程池耗尽
- 服务雪崩
- 整个系统不可用

**熔断的价值：**
- 快速失败，释放资源
- 防止故障扩散
- 下游恢复后自动恢复

### 熔断器状态机

```
     关闭 ----熔断打开----> 打开
       ^                      |
       |                      | 半开超时
       |                      v
       <----半开检测成功---- 半开
```

**状态说明：**

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| 关闭 | 正常请求通过 | 异常率未超阈值 |
| 打开 | 直接拒绝请求 | 异常率超阈值持续一段时间 |
| 半开 | 放行少量请求探测 | 打开状态持续一段时间后 |

**Hystrix参数：**
- 熔断触发：异常率 > 50%，且请求数 > 20
- 熔断时长：5秒（可配置）
- 半开放行：3个请求（可配置）

### 熔断降级实战

```java
@Service
public class UserService {

    @HystrixCommand(
        fallbackMethod = "getUserFallback",
        commandProperties = {
            @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "3000"),
            @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "20"),
            @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50"),
            @HystrixProperty(name = "circuitBreaker.sleepWindowInMilliseconds", value = "5000")
        }
    )
    public User getUser(Long userId) {
        // 调用远程服务
        return remoteClient.getUser(userId);
    }

    public User getUserFallback(Long userId) {
        // 降级逻辑
        return User.getDefault();
    }
}
```

---

## 三、降级

### 什么是降级

降级是从**功能维度**牺牲非核心功能，保障核心功能可用。

**与熔断的区别：**
- 熔断：自动触发，异常时降级
- 降级：人工触发，主动牺牲部分功能

### 降级策略

| 策略 | 说明 | 示例 |
|------|------|------|
| 返回默认值 | 返回空值或默认数据 | 推荐列表返回空 |
| 返回缓存 | 返回过期缓存数据 | 商品详情缓存5分钟 |
| 关闭非核心功能 | 直接关闭非核心接口 | 评论、点赞服务 |
| 延迟处理 | 消息队列异步处理 | 非实时通知 |

### 降级场景

**高峰期降级：**
- 双11零点：关闭推荐、搜索历史
- 优先保障下单、支付核心链路

**依赖故障降级：**
- 推荐服务挂了：返回热门商品
- 评分服务挂了：不显示评分

**功能开关降级：**
```java
@GetMapping("/product/detail")
public Product getProductDetail(Long productId) {
    Product product = productService.getProduct(productId);

    // 评论功能降级
    if (!FeatureToggle.isOn("comment")) {
        product.setComments(Collections.emptyList());
    }

    // 推荐功能降级
    if (!FeatureToggle.isOn("recommend")) {
        product.setRecommendations(Collections.emptyList());
    }

    return product;
}
```

---

## 四、超时与重试

### 超时控制

**为什么需要超时：**
- 避免无限等待
- 快速失败，释放资源
- 配合熔断机制

**超时设置建议：**
- 读操作：3-5秒
- 写操作：5-10秒
- 跨服务调用：2-3秒

```java
@HystrixCommand(
    commandProperties = {
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "3000")
    }
)
public User getUser(Long userId) {
    return remoteClient.getUser(userId);
}
```

### 重试机制

**重试的场景：**
- 网络抖动
- 临时故障
- 依赖服务短暂不可用

**重试的风险：**
- 重复消费：重复下单、重复扣款
- 重试风暴：大量请求同时重试
- 放大压力：下游本来就弱，重试加重压力

**重试策略：**

| 策略 | 说明 |
|------|------|
| 固定间隔 | 每次间隔固定时间重试 |
| 指数退避 | 间隔时间指数增长：1s, 2s, 4s, 8s |
| 限制次数 | 最多重试3次 |

```java
@Retryable(
    value = {TimeoutException.class, ConnectException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 1000, multiplier = 2)
)
public User getUser(Long userId) {
    return remoteClient.getUser(userId);
}
```

---

## 五、负载均衡

### 负载均衡算法

| 算法 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| 随机 | 随机选择一个服务器 | 简单 | 分布不均 |
| 轮询 | 按顺序依次选择 | 分布均匀 | 不考虑服务器性能 |
| 加权轮询 | 按权重分配 | 考虑性能差异 | 权重难调优 |
| 最少连接 | 选择连接数最少的 | 动态适应 | 需要维护连接数 |
| 一致性哈希 | 相同请求路由到相同服务器 | 保持会话 | 增减服务器影响大 |

### Ribbon负载均衡

```yaml
# application.yml
user-service:
  ribbon:
    NFLoadBalancerRuleClassName: com.netflix.loadbalancer.RandomRule
    ConnectTimeout: 3000
    ReadTimeout: 5000
    MaxAutoRetries: 1
    MaxAutoRetriesNextServer: 1
```

---

## 六、面试高频题

### 1. 限流算法有哪些？各有什么优缺点？
固定窗口简单但边界突发，滑动窗口平滑但实现复杂 -> 令牌桶允许突发流量，适合大多数场景 -> 漏桶强制恒定流出，适合削峰填谷

### 2. 熔断和降级的区别？
熔断是自动触发，异常时降级，保护系统 -> 降级是主动选择，牺牲非核心功能保障核心 -> 熔断是技术手段，降级是业务策略

### 3. 重试有什么风险？如何避免？
重试可能导致重复消费（重复下单扣款） -> 先做幂等再加重试，幂等手段：唯一请求ID、数据库唯一索引、状态机 -> 控制重试次数，用指数退避避免重试风暴

### 4. 限流、熔断、降级的顺序？
先限流挡住超出容量的流量 -> 再熔断快速失败避免雪崩 -> 最后降级保证核心功能 -> 三者结合形成完整防护体系

---

## 练习题

- [ ] 练习1：使用Sentinel实现接口限流，体验令牌桶算法
- [ ] 练习2：模拟下游服务故障，观察熔断器状态变化
- [ ] 练习3：实现降级开关，动态关闭非核心功能
- [ ] 练习4：对比不同负载均衡算法的请求分布
- [ ] 练习5：设计一个秒杀场景的限流方案

---

## 下讲预告

第5讲将学习API网关：统一流量入口、路由转发、鉴权认证、限流熔断等核心功能。
