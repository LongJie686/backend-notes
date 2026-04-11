# 第5讲：API网关

## 核心结论（5条必记）

1. **API网关是微服务的统一入口** -- 所有外部请求通过网关路由到后端服务，实现统一鉴权、限流、日志
2. **网关核心职责是路由转发** -- 根据请求路径、Header、Query参数将请求路由到不同的后端服务
3. **网关层做统一的鉴权认证** -- JWT验证、权限校验在网关完成，后端服务信任网关透传的用户信息
4. **网关做协议转换和聚合** -- 外部HTTP请求转为内部gRPC调用，聚合多个后端服务的返回结果
5. **网关是性能瓶颈需要高可用** -- 部署多实例，通过LVS/Nginx负载均衡，配置合理的超时和熔断

---

## 一、为什么需要API网关

### 没有网关的问题

**客户端直连后端服务：**
```
客户端 -> 用户服务
       -> 订单服务
       -> 商品服务
       -> 支付服务
```

**问题：**
- 客户端需要知道每个服务地址
- 鉴权逻辑在每个服务重复实现
- 跨域、限流、日志分散处理
- 协议不统一（HTTP/gRPC混用）

### 有网关的架构

```
客户端 -> API网关 -> 后端服务集群
```

**网关解决的问题：**
- 统一入口，客户端只需知道网关地址
- 鉴权、限流、日志统一处理
- 协议转换、聚合多个服务
- 灰度发布、AB测试

---

## 二、网关核心功能

### 1. 路由转发

**根据路径路由：**
```
/api/user/*    -> 用户服务
/api/order/*   -> 订单服务
/api/product/* -> 商品服务
```

**根据Header路由：**
```
Header: version=v1 -> v1版本服务
Header: version=v2 -> v2版本服务
```

**根据参数路由：**
```
?region=cn -> 国内服务
?region=us -> 海外服务
```

### 2. 鉴权认证

**JWT验证流程：**
```
客户端请求（携带Token）
  -> 网关验证Token签名和有效期
  -> 解析Token获取用户信息
  -> 将用户信息写入Header透传
  -> 后端服务信任网关透传的用户信息
```

**网关验证，后端信任：**
- 网关和后端服务在内网，外部无法直接访问后端
- 后端服务只处理业务，不再验证Token
- 用户信息通过Request Header传递

### 3. 限流熔断

**网关层限流：**
- 全局限流：保护整个系统
- 接口限流：不同接口不同限制
- 用户限流：防止单用户刷接口

**网关层熔断：**
- 后端服务异常时快速返回
- 避免网关线程池耗尽
- 保护网关自身可用性

### 4. 协议转换

**场景：**
```
外部: HTTP/JSON
内部: gRPC/Protobuf
```

**网关转换：**
- 接收HTTP请求
- 转为gRPC调用后端
- 将gRPC响应转为HTTP返回

### 5. 聚合编排

**场景：**
```
客户端请求 /api/home
  -> 网关并行调用：用户信息、推荐商品、订单状态
  -> 网关聚合三个服务的返回结果
  -> 一次性返回给客户端
```

**价值：**
- 减少客户端请求次数
- 降低网络开销
- 优化用户体验

---

## 三、主流网关对比

| 网关 | 语言 | 特点 | 适用场景 |
|------|------|------|----------|
| Zuul 1.x | Java | 阻塞IO，基于Servlet | 简单场景，已不推荐 |
| Zuul 2.x | Java | 非阻塞IO，基于Netty | 需要高性能 |
| Spring Cloud Gateway | Java | 响应式编程，WebFlux | Spring生态首选 |
| Kong | Lua | 基于OpenResty（Nginx） | 高性能，插件丰富 |
| APISIX | Lua | 基于OpenResty，云原生 | 动态配置，高性能 |
| Envoy | C++ | 服务网格数据平面 | Service Mesh |

### Spring Cloud Gateway

**特点：**
- 基于Spring WebFlux（非阻塞）
- 响应式编程
- 动态路由配置
- 与Spring生态深度集成

**优势：**
- 无需额外部署，集成在Spring Boot应用
- 配置简单，YAML或代码配置
- 支持动态路由

**局限：**
- 性能不如Nginx系网关
- 需要JVM运行时

### Kong / APISIX

**特点：**
- 基于OpenResty（Nginx + Lua）
- 高性能，低延迟
- 丰富的插件生态

**优势：**
- 性能优秀
- 插件系统强大
- 支持动态配置
- 语言无关

**局限：**
- 需要单独部署运维
- Lua开发插件有门槛

---

## 四、Spring Cloud Gateway实战

### 路由配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/user/**
          filters:
            - StripPrefix=2

        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - StripPrefix=2
```

### 动态路由

```java
@Component
public class DynamicRouteService {

    @Autowired
    private RouteDefinitionWriter routeDefinitionWriter;

    public void addRoute(String id, String path, String uri) {
        RouteDefinition definition = new RouteDefinition();
        definition.setId(id);
        definition.setUri(URI.create(uri));

        PredicateDefinition predicate = new PredicateDefinition();
        predicate.setName("Path");
        predicate.addArg("pattern", path);
        definition.setPredicates(Collections.singletonList(predicate));

        routeDefinitionWriter.save(Mono.just(definition)).subscribe();
    }
}
```

### 全局过滤器

```java
@Component
public class AuthFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");

        if (StringUtils.isEmpty(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        // 验证Token
        Claims claims = JwtUtil.parseToken(token);
        if (claims == null) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        // 将用户信息写入Header
        ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
            .header("X-User-Id", claims.getSubject())
            .build();

        return chain.filter(exchange.mutate().request(mutatedRequest).build());
    }

    @Override
    public int getOrder() {
        return -100; // 优先级
    }
}
```

### 限流配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10  # 令牌放入速率
                redis-rate-limiter.burstCapacity: 20   # 令牌桶容量
```

---

## 五、网关高可用部署

### 部署架构

```
                LVS/Nginx
               /    |    \
          网关1  网关2  网关3
               \    |    /
                后端服务集群
```

**关键点：**
- 网关多实例部署
- 前置LVS/Nginx负载均衡
- 网关无状态，可水平扩展
- 配置中心动态路由

### 网关性能优化

| 优化点 | 说明 |
|--------|------|
| 连接池 | 复用HTTP连接，减少握手开销 |
| 超时配置 | 合理设置连接超时、读取超时 |
| 熔断降级 | 后端服务异常时快速失败 |
| 缓存 | 网关层缓存热点数据 |
| 压缩 | 启用Gzip压缩减少传输量 |

### 网关监控

**核心监控指标：**
- QPS、响应时间、错误率
- 网关实例健康状态
- 路由规则命中率
- 限流熔断触发次数
- JVM性能（堆内存、GC）

---

## 六、BFF（Backend For Frontend）

### 什么是BFF

**BFF是针对前端的后端服务：**
```
Web前端 -> Web BFF -> 后端服务
App前端 -> App BFF -> 后端服务
小程序  -> 小程序BFF -> 后端服务
```

**BFF的价值：**
- 不同端有不同的数据结构需求
- 聚合多个后端服务调用
- 减少前端网络请求次数
- 前端团队可以维护BFF代码

### BFF vs 网关

| 维度 | API网关 | BFF |
|------|---------|-----|
| 定位 | 通用流量入口 | 特定端的后端 |
| 功能 | 路由、鉴权、限流 | 数据聚合、裁剪 |
| 维护者 | 后端团队 | 前端团队或联合 |
| 数量 | 一个系统一个 | 每个端一个 |

---

## 七、面试高频题

### 1. 网关和Zuul的区别？
网关是微服务架构的统一入口，Zuul是Netflix开源的网关组件 -> Zuul 1.x是阻塞IO，性能有限 -> Zuul 2.x和Spring Cloud Gateway都是非阻塞，性能更好 -> Spring Cloud Gateway是Spring生态推荐方案

### 2. 网关层做鉴权有什么好处？
统一鉴权逻辑，后端服务不需要重复实现 -> 后端服务信任网关，简化业务代码 -> 鉴权策略集中管理，易于维护和升级 -> 网关可以集成多种鉴权方式

### 3. 网关的性能瓶颈在哪里？
网关是所有请求的必经之路，可能成为性能瓶颈 -> 部署多实例水平扩展 -> 前置LVS/Nginx负载均衡 -> 优化连接池、启用缓存、合理超时 -> 选择高性能网关（Kong/APISIX）

### 4. BFF和网关有什么区别？
网关是通用流量入口，处理路由、鉴权、限流 -> BFF是针对特定端的后端，做数据聚合、裁剪 -> 一个系统一个网关，每个端一个BFF -> 网关由后端维护，BFF可由前端维护

---

## 练习题

- [ ] 练习1：搭建Spring Cloud Gateway，实现路由转发
- [ ] 练习2：实现JWT鉴权过滤器
- [ ] 练习3：配置限流规则，体验限流效果
- [ ] 练习4：实现灰度发布路由（按Header路由到不同版本）
- [ ] 练习5：对比Spring Cloud Gateway和Kong的性能差异

---

## 下讲预告

第6讲将学习分布式数据一致性：CAP定理、BASE理论、分布式事务方案、幂等性设计等核心问题。
