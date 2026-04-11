# 第5讲：高可用设计（限流、熔断、降级）

## 核心结论（5条必记）

1. **限流保护系统不被压垮** -- 超出容量的请求直接拒绝，令牌桶和漏桶是常用算法
2. **熔断防止故障扩散** -- 下游异常时快速失败，避免线程池耗尽，熔断器有三种状态
3. **降级保障核心功能** -- 非核心功能降级返回默认值，确保核心链路可用
4. **超时控制避免无限等待** -- 设置合理的超时时间，配合重试机制
5. **负载均衡分发流量** -- 随机、轮询、加权、最少连接，按场景选择

---

## 一、限流

### 为什么需要限流

```
系统容量：1万QPS
实际流量：5万QPS
-> 不限流系统会崩溃
```

### 限流算法

| 算法 | 原理 | 优点 | 缺点 | 场景 |
|------|------|------|------|------|
| 固定窗口 | 统计固定时间窗口请求数 | 简单 | 边界突发 | 基础限流 |
| 滑动窗口 | 窗口切分，滑动统计 | 平滑 | 复杂 | 精确限流 |
| 令牌桶 | 恒定速率放入令牌 | 允许突发 | 参数调优 | 通用 |
| 漏桶 | 恒定速率流出 | 强制平滑 | 无突发 | 削峰 |

### Sentinel限流

```java
@GetMapping("/order/create")
@SentinelResource(value = "createOrder", blockHandler = "handleBlock")
public Result createOrder(@RequestParam Long userId) {
    return orderService.createOrder(userId);
}

public Result handleBlock(Long userId, BlockException ex) {
    return Result.error("当前访问人数过多，请稍后再试");
}
```

---

## 二、熔断

### 为什么需要熔断

```
下游服务响应慢
  -> 上游线程阻塞
  -> 线程池耗尽
  -> 雪崩
```

### 熔断器状态机

```
关闭 -> 打开 -> 半开 -> 关闭
正常   熔断   探测   恢复
```

### Hystrix熔断

```java
@HystrixCommand(
    fallbackMethod = "getUserFallback",
    commandProperties = {
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "3000"),
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50")
    }
)
public User getUser(Long userId) {
    return remoteClient.getUser(userId);
}

public User getUserFallback(Long userId) {
    return User.getDefault();
}
```

---

## 三、降级

### 降级策略

| 策略 | 说明 | 示例 |
|------|------|------|
| 返回默认值 | 返回空或默认 | 推荐列表为空 |
| 返回缓存 | 返回过期缓存 | 商品详情缓存 |
| 关闭功能 | 直接关闭 | 评论、点赞 |

### 降级开关

```java
@GetMapping("/product/detail")
public Product getProductDetail(Long productId) {
    Product product = productService.getProduct(productId);

    if (!FeatureToggle.isOn("comment")) {
        product.setComments(Collections.emptyList());
    }

    return product;
}
```

---

## 四、面试高频题

### 1. 限流、熔断、降级的区别？
限流：超出容量直接拒绝 -> 熔断：下游异常快速失败 -> 降级：牺牲非核心功能 -> 三者结合形成防护体系

### 2. 令牌桶和漏桶的区别？
令牌桶：允许突发 -> 漏桶：强制平滑 -> 令牌桶适合大多数场景 -> 漏桶适合削峰填谷

---

## 练习题

- [ ] 练习1：使用Sentinel实现接口限流
- [ ] 练习2：实现降级开关
- [ ] 练习3：设计一个秒杀系统的限流方案

---

## 下讲预告

第6讲将学习服务治理：注册发现、配置中心、分布式锁、链路追踪等内容。
