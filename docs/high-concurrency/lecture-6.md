# 第6讲：服务治理（注册发现、配置中心、分布式锁）

## 核心结论（5条必记）

1. **服务注册发现是微服务基础** -- 服务启动时注册，调用方动态获取地址，解耦服务提供方和消费方
2. **配置中心实现统一管理** -- 不同环境配置集中管理，变更后实时推送到服务
3. **分布式锁控制并发访问** -- Redis SETNX实现互斥，注意锁超时和释放
4. **链路追踪定位问题** -- TraceID关联所有日志，快速定位问题环节
5. **服务治理要持续优化** -- 监控服务状态，及时发现问题

---

## 一、服务注册发现

### 为什么需要

**没有注册中心：**
```
服务地址硬编码
  -> 部署环境变化需要修改代码
  -> 无法自动感知服务健康状态
```

### Nacos实战

**服务注册：**
```yaml
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848
```

**服务调用：**
```java
@Autowired
private DiscoveryClient discoveryClient;

public User getUser(Long userId) {
    List<ServiceInstance> instances = discoveryClient.getInstances("user-service");
    ServiceInstance instance = loadBalancer.choose(instances);
    return restTemplate.getForObject(instance.getUri() + "/user/" + userId, User.class);
}
```

---

## 二、配置中心

### 为什么需要

**本地配置的问题：**
- 配置分散
- 环境差异
- 修改麻烦

**配置中心价值：**
- 集中管理
- 动态推送
- 环境隔离

### Nacos配置

```yaml
spring:
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        file-extension: yaml
```

```java
@RefreshScope
@RestController
public class ConfigController {

    @Value("${user.limit:100}")
    private Integer userLimit;

    @GetMapping("/config/limit")
    public Integer getLimit() {
        return userLimit;
    }
}
```

---

## 三、分布式锁

### 为什么需要

```
多个服务实例同时修改数据
  -> 并发冲突
  -> 数据不一致
```

### Redis分布式锁

```java
public boolean lock(String key, long expireTime) {
    return redisTemplate.opsForValue()
        .setIfAbsent("lock:" + key, "1", expireTime, TimeUnit.SECONDS);
}

public void unlock(String key) {
    redisTemplate.delete("lock:" + key);
}
```

### 注意事项

1. **锁超时**：避免业务执行时间超过锁超时
2. **锁释放**：finally中释放，避免死锁
3. **可重入锁**：同一线程可重入

---

## 四、链路追踪

### TraceID传递

```java
@Component
public class TraceIdFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
        String traceId = request.getHeader("X-Trace-Id");
        if (StringUtils.isEmpty(traceId)) {
            traceId = UUID.randomUUID().toString();
        }
        MDC.put("traceId", traceId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

### 日志输出

```xml
<pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} [traceId=%X{traceId}] - %msg%n</pattern>
```

---

## 五、面试高频题

### 1. 注册中心选CP还是AP？
大多数场景选AP，可用性优先 -> 注册中心短暂故障不影响已有调用 -> 本地缓存兜底

### 2. 分布式锁怎么实现？
Redis SETNX实现 -> 注意锁超时和释放 -> Lua脚本保证原子性

---

## 练习题

- [ ] 练习1：本地搭建Nacos
- [ ] 练习2：实现服务注册与发现
- [ ] 练习3：实现Redis分布式锁

---

## 下讲预告

第7讲将学习场景实战：秒杀系统、Feed流、计数系统等真实场景的设计方案。
