# 第 9 讲：高可用架构——同城双活与容灾设计

这一讲是整个高并发系列**最顶层**的内容。

前面八讲我们解决的是**性能问题**：
- 如何让系统更快
- 如何让系统扛更多流量
- 如何让数据更好扩展

这一讲解决的是**可靠性问题**：
- 机房停电怎么办？
- 光缆被挖断怎么办？
- 地震怎么办？
- 如何做到5分钟内恢复？
- 如何做到用户完全无感知？

**一个系统能扛住高并发不叫成熟，能在各种灾难场景下依然正常服务才叫真正的高可用。**

---

## 一、高可用的度量：几个9是什么意思？

### 可用性计算

**可用性 = 正常运行时间 / 总时间**

```
99%    （2个9）：全年宕机 = 365 × 24 × 0.01    = 87.6 小时
99.9%  （3个9）：全年宕机 = 365 × 24 × 0.001   = 8.76 小时
99.99% （4个9）：全年宕机 = 365 × 24 × 0.0001  = 52.56 分钟
99.999%（5个9）：全年宕机 = 365 × 24 × 0.00001 = 5.26 分钟
```

**直观感受：**
```
2个9：每天允许宕机14分钟 → 不可接受
3个9：每天允许宕机86秒   → 一般系统勉强接受
4个9：每天允许宕机8.6秒  → 大厂核心系统目标
5个9：每天允许宕机0.86秒 → 金融/电信级别
```

---

### 影响可用性的因素

```
可用性 = 1 - (故障时间 / 总时间)

故障时间 = 故障频率 × 每次故障恢复时间（MTTR）

提升可用性的两个方向：
1. 降低故障频率（MTBF：平均无故障时间）
2. 降低恢复时间（MTTR：平均恢复时间）
```

**故障分类：**
```
硬件故障：服务器宕机、磁盘损坏、网卡故障
网络故障：机房网络中断、IDC间光缆故障、DDoS
软件故障：Bug、内存泄漏、死锁、OOM
人为故障：误操作、错误发布、配置错误
自然灾害：地震、洪水、火灾
```

---

### 系统可用性的串并联模型

**串联（所有组件都正常才正常）：**
```
系统可用性 = A × B × C × D

假设每个组件可用性 99.9%：
  4个组件串联 = 0.999 × 0.999 × 0.999 × 0.999 = 99.6%

串联越多，整体可用性越低
```

**并联（至少一个正常就正常）：**
```
系统不可用性 = (1-A) × (1-B)
系统可用性  = 1 - (1-A) × (1-B)

假设每个组件可用性 99%：
  2个组件并联 = 1 - 0.01 × 0.01 = 99.99%

并联越多，整体可用性越高
```

**启示：**
```
消除单点（串联）→ 改为冗余（并联）
→ 整体可用性大幅提升
```

---

## 二、单点故障的排查与消除

### 什么是单点故障（SPOF）？

```
Single Point Of Failure
系统中某个组件故障 → 整个系统不可用
这个组件就是单点
```

**典型的单点：**
```
× 单台应用服务器
× 单台数据库（无主从）
× 单台Redis（无主从）
× 单台Nginx
× 单台注册中心
× 单台消息队列Broker
× 单台API网关
```

---

### 逐层消除单点

#### 1. 应用层：集群化

```
单台应用服务器 → 多台集群 + 负载均衡

  [Nginx]
  ↓     ↓     ↓
[App1] [App2] [App3]  ← 任意一台挂了，其他正常

健康检查：
Nginx自动检测后端健康状态
不健康的实例自动摘除，流量自动转移
```

```nginx
upstream app_cluster {
    server app1:8080 max_fails=3 fail_timeout=30s;
    server app2:8080 max_fails=3 fail_timeout=30s;
    server app3:8080 max_fails=3 fail_timeout=30s;
}

server {
    location / {
        proxy_pass http://app_cluster;
        
        # 失败重试
        proxy_next_upstream error timeout http_500;
        proxy_next_upstream_tries 2;
    }
}
```

---

#### 2. 数据库：主从复制

```
单机MySQL → 主从 + 自动切换

  [Master] ← 写
     ↓ 同步
  [Slave1] ← 读
  [Slave2] ← 读

Master宕机：
  MHA / Orchestrator 自动检测
  → 选举新Master（从Slave中选）
  → 更新所有应用的数据库连接
  → 恢复时间：30~60秒
```

---

#### 3. 缓存：Redis哨兵/集群

```
单机Redis → 主从 + 哨兵

  [Redis Master]
        ↓
  [Redis Slave1] [Redis Slave2]

  [Sentinel1] [Sentinel2] [Sentinel3] ← 监控

Master宕机：
  哨兵集群检测到（超过半数确认）
  → 选举新Master
  → 通知客户端更新连接
  → 恢复时间：10~30秒
```

---

#### 4. 负载均衡：Nginx高可用

```
单台Nginx → Nginx + Keepalived（主备）

  [Nginx-Master] + [VIP: 192.168.1.100]
        ↓ 心跳检测
  [Nginx-Backup]

Nginx-Master宕机：
  Keepalived检测到（1~2秒）
  → VIP漂移到Nginx-Backup
  → Nginx-Backup接管流量
  → 用户无感知（VIP不变）
```

```bash
# Keepalived配置（主节点）
vrrp_instance VI_1 {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 100              # 优先级，主节点更高
    
    authentication {
        auth_type PASS
        auth_pass secret123
    }
    
    virtual_ipaddress {
        192.168.1.100         # 虚拟IP（VIP）
    }
    
    # Nginx健康检查脚本
    track_script {
        check_nginx
    }
}

vrrp_script check_nginx {
    script "/etc/keepalived/check_nginx.sh"
    interval 2                # 每2秒检查一次
    weight -20                # 检查失败，权重-20（触发切换）
}
```

---

#### 5. 消息队列：多Broker副本

```
Kafka多副本：
  每个Partition有3个副本
  分布在不同Broker
  
  Topic: order-topic
  Partition0: Leader(Broker1), Follower(Broker2), Follower(Broker3)
  
  Broker1宕机：
  → Broker2或Broker3成为新Leader
  → 生产者/消费者自动感知
  → 恢复时间：秒级
```

---

#### 6. 注册中心：集群部署

```
Nacos集群（奇数台，Raft协议）：
  [Nacos1] [Nacos2] [Nacos3]
  
  任意一台宕机：
  → 剩余节点重新选举Leader
  → 服务继续可用
  → 客户端本地缓存兜底
```

---

### 单点检查清单

**上线前必做的高可用检查：**

```
□ 应用服务器是否有至少2台？
□ 数据库是否有主从？主从切换是否自动？
□ Redis是否有主从/哨兵/集群？
□ 负载均衡（Nginx）是否有主备？
□ 注册中心是否是集群？
□ 消息队列是否有副本？
□ 配置中心是否是集群？
□ DNS是否有容灾记录？
□ 外部依赖（第三方API）是否有降级方案？
```

---

## 三、同城双活架构

### 什么是同城双活？

```
在同一城市建两个数据中心（IDC）
两个IDC都承载业务流量（都"活着"）
任意一个IDC故障，另一个接管全部流量
用户几乎无感知（切换时间 < 30秒）
```

**同城双活 vs 主备：**
```
主备模式：
  IDC-A（主）：承载100%流量
  IDC-B（备）：不承载流量，等待切换
  问题：IDC-B资源浪费；切换时间较长

同城双活：
  IDC-A：承载50%流量
  IDC-B：承载50%流量
  优点：资源充分利用；任意IDC故障，另一个快速接管
```

---

### 同城双活架构设计

```
[用户]
  ↓
[DNS / 全局负载均衡（GLB）]
  ↓                  ↓
[IDC-A]            [IDC-B]
  - 完整的应用集群     - 完整的应用集群
  - 完整的缓存集群     - 完整的缓存集群
  - 数据库主库   ←→   - 数据库从库（同步）
  
  [专线网络连接两个IDC]
```

---

### 关键设计：数据同步

**同城双活最难的是数据层。**

#### MySQL数据同步

**方案：一主多从（跨IDC主从）**

```
IDC-A: MySQL Master（写入）
  ↓ binlog同步（专线，延迟 < 1ms）
IDC-B: MySQL Slave（读取）

写请求：只打IDC-A的Master
读请求：两个IDC都可以处理（从库读）
```

**如果IDC-A故障：**
```
1. IDC-B的Slave升级为Master
2. 所有写请求切换到IDC-B
3. 数据可能有极少量丢失（专线延迟内的数据）
```

---

#### Redis数据同步

**方案：Redis主从跨IDC**

```
IDC-A: Redis Master
  ↓ 同步（专线）
IDC-B: Redis Slave

IDC-A故障：IDC-B的Slave自动升为Master
```

**更好的方案：Redis Cluster跨IDC**

```
Redis Cluster：
  IDC-A: Slot 0~8191 的 Master
  IDC-B: Slot 8192~16383 的 Master
  
  IDC-A有IDC-B分片的Slave
  IDC-B有IDC-A分片的Slave
  
  任意IDC故障，另一个IDC的Slave升为Master
  流量全部切到存活的IDC
```

---

### 关键设计：流量调度

**如何把用户请求路由到合适的IDC？**

#### DNS调度

```
域名：api.example.com
  ↓
DNS服务器：
  50%流量 → IDC-A的VIP: 1.2.3.4
  50%流量 → IDC-B的VIP: 1.2.3.5

IDC-A故障：
  DNS更新：100%流量 → IDC-B
  
缺点：DNS有TTL缓存（5分钟~1小时）
→ 切换不够快（受TTL限制）
→ 适合切换时间要求不严格的场景
```

---

#### GLB（全局负载均衡）

```
[用户]
  ↓
[GLB（全局负载均衡）]  ← 实时检测IDC健康状态
  ↓                  ↓
[IDC-A]            [IDC-B]

GLB功能：
  - 实时健康检查（秒级）
  - 智能流量调度
  - 故障自动切换（< 30秒）
  - 支持按地域、权重、会话分配

实现方案：
  - F5（硬件负载均衡）
  - Nginx + Keepalived + DNS
  - 云厂商的GLB产品（阿里云GTM、AWS Route53）
```

---

#### OSPF路由协议

```
利用网络层路由协议
多条网络路径同时工作
链路故障自动切换（秒级）

企业级方案，需要专业网络团队支撑
```

---

### 同城双活的会话处理

**问题：**
```
用户第一次请求到IDC-A（已登录）
第二次请求路由到IDC-B
→ IDC-B没有用户的Session
→ 用户需要重新登录
```

**解决：Session集中存储**

```
Session不存在应用服务器本地
→ 存在跨IDC的Redis集群
→ 任何IDC都能读取Session
→ 用户无感知

IDC-A [App] → Redis Cluster（跨IDC）← IDC-B [App]
```

---

### 同城双活的数据一致性

**问题：**
```
用户在IDC-A下单（写Master）
马上查订单 → 路由到IDC-B（读Slave）
→ 主从同步还没完成
→ 用户看不到刚才的订单
```

**解决方案：**

**方案1：读写都走同一个IDC（会话粘连）**
```
用户的所有请求都路由到同一个IDC
→ 读写在同一个IDC
→ 不存在跨IDC读问题

实现：
  按用户ID的hash决定路由的IDC
  userId % 2 == 0 → IDC-A
  userId % 2 == 1 → IDC-B
```

**方案2：关键读走主库**
```java
public Order getOrder(Long orderId, boolean fromMaster) {
    if (fromMaster) {
        // 关键读（刚写完就读）→ 走主库
        return orderDao.getFromMaster(orderId);
    }
    // 一般查询 → 走从库
    return orderDao.getFromSlave(orderId);
}

// 下单后，标记需要强读
public Result createOrder(OrderRequest request) {
    Order order = orderService.create(request);
    
    // 在ThreadLocal或Cookie中标记：接下来3秒内读主库
    ReadConsistencyContext.setMasterRead(3);
    
    return Result.success(order);
}
```

**方案3：接受短暂不一致**
```
对于非关键读，接受最终一致
→ 订单列表：允许1秒延迟
→ 余额：必须强一致（走主库）
→ 商品详情：允许几秒延迟
```

---

### 完整同城双活架构

```
[用户请求]
    ↓
[DNS解析] → 拿到GLB的VIP
    ↓
[GLB（全局负载均衡）]
  ↓ 50%              ↓ 50%
[IDC-A机房]         [IDC-B机房]
  ├─ Nginx集群         ├─ Nginx集群
  ├─ API网关集群        ├─ API网关集群
  ├─ 应用服务集群       ├─ 应用服务集群
  ├─ Redis Master  ←→  ├─ Redis Slave（同步）
  └─ MySQL Master  ←→  └─ MySQL Slave（同步）
       ↑                      ↑
  [专线网络，延迟 < 1ms]
       ↑
[运维监控中心]
  ├─ 健康检查
  ├─ 自动切换
  └─ 告警通知
```

---

## 四、异地多活架构

### 什么是异地多活？

```
在不同城市（甚至不同国家）建多个数据中心
每个数据中心都承载业务流量
任意数据中心故障（包括整个城市）
→ 其他数据中心接管，用户基本无感知
```

**和同城双活的区别：**
```
同城双活：
  城市内两个IDC，专线连接，延迟 < 1ms
  数据强一致性相对容易
  主要解决：IDC级故障

异地多活：
  跨城市/跨地域，公网/专线，延迟 10ms ~ 100ms
  数据一致性极难保证
  主要解决：城市级灾难（地震、洪水）
```

---

### 异地多活的三大挑战

#### 挑战1：网络延迟

```
同城：1ms
跨城市（北京-上海）：20~30ms
跨地域（中国-美国）：150~200ms

影响：
→ 数据同步有延迟（最终一致）
→ 跨地域调用慢
→ 分布式事务几乎不可能强一致
```

---

#### 挑战2：数据冲突

```
问题：两个数据中心同时写同一条数据
  北京用户：修改个人信息（name = 张三）
  上海用户：同一用户，修改个人信息（name = 李四）
  → 两个数据中心各自写
  → 数据同步后：哪个值是正确的？
  → 冲突！
```

**解决：数据分区（核心思想）**

```
核心原则：每份数据只在一个数据中心写入
→ 从根本上避免写冲突
```

---

#### 挑战3：业务改造成本

```
异地多活要求：
→ 应用完全无状态
→ 数据分区路由
→ 全局唯一ID（不依赖单库自增）
→ 分布式事务变为最终一致
→ 中间件全部分布式化

改造成本极高！
通常需要：
→ 专门的架构团队
→ 6~12个月的改造时间
→ 大量的测试验证
```

---

### 异地多活的数据分区策略

**核心思路：按业务维度分区，保证一个用户的数据只在一个数据中心写入。**

#### 按用户ID分区

```
用户ID哈希取模：
  userId % 3 = 0 → 北京IDC
  userId % 3 = 1 → 上海IDC
  userId % 3 = 2 → 广州IDC

同一个用户的所有写操作 → 路由到同一个IDC
→ 从根本上避免同一用户数据的写冲突
```

**流量路由：**
```
用户A（userId=1001）→ 1001 % 3 = 1 → 上海IDC
用户B（userId=1002）→ 1002 % 3 = 2 → 广州IDC
用户C（userId=1003）→ 1003 % 3 = 0 → 北京IDC
```

---

#### 按地域分区

```
用户所在地：
  北方用户 → 北京IDC
  华东用户 → 上海IDC
  华南用户 → 广州IDC

优点：就近访问，延迟低
缺点：地域分布不均，容易热点
```

---

### 异地多活数据同步架构

```
[北京IDC]               [上海IDC]               [广州IDC]
  MySQL Master-BJ         MySQL Master-SH         MySQL Master-GZ
  Redis Cluster-BJ        Redis Cluster-SH        Redis Cluster-GZ
      ↓                       ↓                       ↓
  [DTS同步组件]           [DTS同步组件]           [DTS同步组件]
      ↓                       ↓                       ↓
  ←————————————— 数据双向同步（有冲突检测）————————————→

说明：
1. 每个IDC有自己的Master数据库（处理本IDC用户的写）
2. 各IDC的数据通过DTS（数据传输服务）互相同步
3. 同步是异步的（有延迟，最终一致）
4. 有冲突检测机制（按时间戳/版本号解决冲突）
```

---

### 异地多活的路由层

**这是实现异地多活的关键基础设施。**

```java
// 路由规则（决定请求打到哪个IDC）
public class GeoRouter {
    
    // 路由表（可从配置中心动态获取）
    private Map<Integer, String> routeTable = new HashMap<>();
    
    public void init() {
        routeTable.put(0, "beijing");   // userId % 3 = 0 → 北京
        routeTable.put(1, "shanghai");  // userId % 3 = 1 → 上海
        routeTable.put(2, "guangzhou"); // userId % 3 = 2 → 广州
    }
    
    // 根据userId获取应该路由到哪个IDC
    public String getTargetIDC(Long userId) {
        int partition = (int)(userId % 3);
        return routeTable.get(partition);
    }
    
    // 判断当前请求是否应该在本IDC处理
    public boolean isLocalRequest(Long userId, String currentIDC) {
        String targetIDC = getTargetIDC(userId);
        return targetIDC.equals(currentIDC);
    }
}

// 请求拦截器：如果不是本IDC处理的请求，转发到正确的IDC
@Component
public class IDCRoutingFilter implements Filter {
    
    @Autowired
    private GeoRouter geoRouter;
    
    @Value("${current.idc}")
    private String currentIDC;  // 当前IDC标识（从配置中心获取）
    
    @Override
    public void doFilter(ServletRequest request, 
                          ServletResponse response, 
                          FilterChain chain) throws IOException, ServletException {
        
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        Long userId = getUserIdFromRequest(httpRequest);
        
        if (userId != null && !geoRouter.isLocalRequest(userId, currentIDC)) {
            // 不是本IDC的请求，转发到正确的IDC
            String targetIDC = geoRouter.getTargetIDC(userId);
            String targetUrl = buildTargetUrl(targetIDC, httpRequest);
            
            // 302重定向 或 直接转发
            ((HttpServletResponse) response).sendRedirect(targetUrl);
            return;
        }
        
        chain.doFilter(request, response);
    }
    
    private String buildTargetUrl(String idc, HttpServletRequest request) {
        // 根据IDC构建目标URL
        String idcDomain = getIDCDomain(idc);
        return "https://" + idcDomain + request.getRequestURI() + 
               (request.getQueryString() != null ? "?" + request.getQueryString() : "");
    }
}
```

---

### 异地多活的容灾切换

**切换流程：**

```
1. 监控发现上海IDC故障（Prometheus告警）

2. 运维人员（或自动）执行切换：
   → 更新路由表：上海的流量切到北京或广州
   → 更新DNS（指向其他IDC的入口）
   → 上海用户的数据开始在新IDC写入

3. 上海IDC数据迁移：
   → 恢复后，把故障期间在其他IDC写入的上海用户数据同步回上海

4. 验证后，逐步把上海流量切回
```

**切换时间目标：**
```
从发现故障到切换完成：< 5分钟（手动）
自动切换：< 1分钟
```

---

### 全球化异地多活（国际化场景）

```
[中国用户] → [北京/上海/广州IDC]
[美国用户] → [弗吉尼亚/旧金山IDC]
[欧洲用户] → [法兰克福/都柏林IDC]

用户就近访问，延迟最优
各地数据中心定期同步
本地用户的数据在本地IDC存储
```

---

## 五、容灾恢复（DR）

### RTO 和 RPO

**两个关键指标：**

```
RTO（Recovery Time Objective）= 恢复时间目标
→ 从故障发生到恢复服务需要多长时间
→ 越小越好

RPO（Recovery Point Objective）= 恢复点目标
→ 最多允许丢失多少数据（时间维度）
→ RPO=0 表示数据零丢失
→ RPO=1小时 表示最多丢失1小时的数据
```

**不同业务的要求：**
```
金融交易：RTO < 1分钟，RPO = 0（数据绝对不能丢）
电商下单：RTO < 5分钟，RPO < 1分钟
内容平台：RTO < 30分钟，RPO < 10分钟
内部系统：RTO < 4小时，RPO < 1小时
```

---

### 容灾级别

**从低到高：**

```
Level 0：数据备份（离线备份）
  → 只有数据备份，没有备用系统
  → RTO: 天级别
  → RPO: 备份周期（每天一次 = 1天数据丢失）
  → 成本：低

Level 1：冷备（Cold Standby）
  → 有备用系统，但平时不运行
  → 故障后启动备用系统，恢复数据
  → RTO: 小时级别
  → 成本：中

Level 2：温备（Warm Standby）
  → 备用系统持续同步数据，但不承载流量
  → 故障后切换流量到备用系统
  → RTO: 分钟级别
  → 成本：较高

Level 3：热备（Hot Standby）
  → 两套系统都运行，持续同步
  → 故障后立刻切换
  → RTO: 秒级别
  → 成本：高（2倍资源）

Level 4：双活（Active-Active）
  → 两套系统都承载流量
  → 故障后另一个接管
  → RTO: 秒级别，近乎无感知
  → 成本：高，但资源利用率高
```

---

### 数据备份策略

**三-二-一原则：**
```
3：保存3份数据备份
2：使用2种不同的存储介质
1：至少1份在异地

举例：
  本地磁盘（1份）
  + 本地备份服务器（2份，不同介质）
  + 异地对象存储（3份，OSS/S3）
```

**备份类型：**

```
全量备份：完整备份所有数据
  → 每天一次（凌晨低峰期）
  → 工具：mysqldump / Percona XtraBackup

增量备份：只备份变化的数据
  → 每小时一次（基于binlog）
  → 工具：binlog备份

差量备份：基于上次全量备份的变化
  → 每天一次
```

**MySQL备份实践：**

```bash
# 全量备份（使用XtraBackup，不锁表）
innobackupex --user=root --password=xxx \
    --host=localhost \
    /backup/mysql/full/$(date +%Y%m%d)

# binlog增量备份
# 实时复制binlog到备份服务器
mysqlbinlog --read-from-remote-server \
    --host=master-host \
    --raw \
    --to-last-log \
    > /backup/binlog/binlog.$(date +%Y%m%d%H%M%S)

# 自动化备份脚本
cat > /etc/cron.d/mysql-backup << 'EOF'
0 2 * * * root /scripts/mysql_full_backup.sh     # 每天凌晨2点全量
0 * * * * root /scripts/mysql_incremental_backup.sh  # 每小时增量
EOF
```

**备份验证（最容易被忽视的）：**

```bash
# 每周验证一次备份是否可以成功恢复
cat > /scripts/verify_backup.sh << 'EOF'
#!/bin/bash

# 恢复到测试环境
innobackupex --apply-log /backup/mysql/full/latest
innobackupex --copy-back /backup/mysql/full/latest --datadir=/var/lib/mysql-test

# 启动测试MySQL
mysqld_safe --datadir=/var/lib/mysql-test &

# 验证数据
mysql -h localhost -P 3307 -e "SELECT COUNT(*) FROM order_info"

# 记录结果
echo "备份验证完成: $(date)" >> /var/log/backup_verify.log
EOF
```

---

## 六、故障演练（混沌工程）

### 什么是混沌工程？

```
主动在生产环境（或模拟生产的环境）注入故障
→ 验证系统的容错能力
→ 发现意想不到的弱点
→ 建立系统稳定性的信心
```

**核心思想：**
```
不要等故障自然发生再发现问题
→ 主动制造故障，提前发现
→ "每次演练都比真实故障便宜"
```

---

### Netflix的混沌猴（Chaos Monkey）

**Netflix是混沌工程的鼻祖。**

```
Chaos Monkey（混沌猴）：
→ 随机关闭生产环境的服务器
→ 验证系统是否能自动恢复

Chaos Gorilla（混沌大猩猩）：
→ 随机关闭整个可用区
→ 验证跨可用区容灾能力

Chaos Kong（混沌金刚）：
→ 模拟整个Region故障
→ 验证跨Region容灾能力
```

---

### 混沌工程实践框架

**常用工具：**
```
ChaosBlade（阿里开源）：
→ 支持应用、容器、主机级别的故障注入
→ 支持CPU、内存、网络、磁盘等故障类型

Chaos Mesh（PingCAP开源）：
→ Kubernetes原生混沌工程平台
→ 图形化操作界面

Litmus（CNCF项目）：
→ Kubernetes生态混沌工程
```

---

### 故障演练实践

#### 演练类型

**1. 网络故障演练**
```bash
# 使用ChaosBlade注入网络延迟
blade create network delay \
    --time 1000 \           # 延迟1000ms
    --percent 50 \          # 50%的包
    --interface eth0 \      # 网卡
    --destination-ip 192.168.1.10  # 目标IP（模拟某个服务延迟）

# 验证：系统是否正确触发熔断、超时控制是否生效

# 恢复
blade destroy {uid}
```

**2. CPU满负载演练**
```bash
# 注入CPU高负载
blade create cpu load --cpu-percent 80

# 验证：系统是否触发限流、是否影响业务

# 恢复
blade destroy {uid}
```

**3. 磁盘满演练**
```bash
# 注入磁盘写满
blade create disk fill --path /data --size 1024

# 验证：磁盘满时日志是否告警、业务是否正常降级
```

**4. 服务Kill演练**
```bash
# 随机Kill某个服务的进程
blade create process kill --process order-service

# 验证：服务是否自动重启、流量是否自动切走
```

**5. 数据库连接中断演练**
```bash
# 模拟数据库连接失败
blade create network loss \
    --percent 100 \
    --destination-port 3306

# 验证：应用是否正确使用缓存降级、是否正确报错
```

---

### 演练流程规范

```
1. 明确演练目标
   "我们想验证：Redis宕机时，商品详情页是否能正常访问（降级到DB）"

2. 制定假设
   "如果Redis宕机，系统会降级到数据库，响应时间增加但不超过2秒"

3. 最小化爆炸半径
   "先在测试环境验证，再在生产环境小范围演练"

4. 执行演练
   "注入Redis宕机故障，观察监控和告警"

5. 验证结果
   是否符合假设？
   发现了哪些意外？

6. 恢复
   立刻恢复故障，回到正常状态

7. 总结输出
   演练报告 + 优化项 + 下次演练计划
```

---

### 演练最佳实践

```
原则1：先在测试环境，再在生产环境
原则2：从小范围开始（1台机器 → 1个集群 → 整个服务）
原则3：有随时终止的能力（kill switch）
原则4：有足够的监控和告警
原则5：定期演练（至少每季度一次）
原则6：演练结果要形成报告和改进计划
```

---

## 七、监控告警体系

### 监控四大黄金指标（Google SRE）

```
1. 延迟（Latency）：请求处理时间
   → P50, P95, P99, P999

2. 流量（Traffic）：系统负载
   → QPS, TPS

3. 错误率（Errors）：请求失败率
   → 5xx错误率, 超时率

4. 饱和度（Saturation）：资源使用率
   → CPU, 内存, 磁盘, 连接数
```

---

### 监控体系架构

```
[应用/中间件/主机]
    ↓ 指标上报
[Prometheus] ← 采集指标
    ↓
[Grafana] ← 可视化展示
    ↓
[AlertManager] ← 告警规则
    ↓
[钉钉/企微/电话] ← 通知
```

---

### 关键监控指标

**应用层：**
```yaml
# Prometheus指标
http_request_total{method, path, status}        # 请求总数
http_request_duration_seconds{quantile}         # 请求耗时
http_request_error_rate                         # 错误率
jvm_memory_used_bytes{area}                     # JVM内存使用
jvm_gc_pause_seconds_sum                        # GC暂停时间
```

**数据库层：**
```yaml
mysql_connections_total                          # 连接数
mysql_slow_query_total                           # 慢查询数
mysql_replication_lag_seconds                    # 主从延迟
```

**缓存层：**
```yaml
redis_connected_clients                          # 连接数
redis_memory_used_bytes                          # 内存使用
redis_keyspace_hits_total                        # 命中数
redis_keyspace_misses_total                      # 未命中数
redis_cache_hit_rate                             # 命中率
```

**消息队列：**
```yaml
kafka_consumer_lag                               # 消费延迟
kafka_messages_in_per_sec                        # 生产速率
kafka_bytes_in_per_sec                           # 流量
```

---

### 告警规则设计

```yaml
# Prometheus AlertManager规则
groups:
  - name: application-alerts
    rules:
      # 错误率告警
      - alert: HighErrorRate
        expr: |
          sum(rate(http_request_total{status=~"5.."}[5m])) 
          / sum(rate(http_request_total[5m])) > 0.01
        for: 2m         # 持续2分钟才告警（避免抖动）
        labels:
          severity: critical
        annotations:
          summary: "错误率超过1%"
          description: "当前错误率: {{ $value | humanizePercentage }}"
      
      # P99延迟告警
      - alert: HighLatencyP99
        expr: |
          histogram_quantile(0.99, 
            rate(http_request_duration_seconds_bucket[5m])
          ) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P99延迟超过500ms"
      
      # MySQL主从延迟告警
      - alert: MysqlReplicationLag
        expr: mysql_replication_lag_seconds > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "MySQL主从延迟超过10秒"
      
      # Redis内存告警
      - alert: RedisMemoryHigh
        expr: |
          redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis内存使用超过85%"
      
      # Kafka消费延迟告警
      - alert: KafkaConsumerLag
        expr: kafka_consumer_lag > 10000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Kafka消费延迟超过1万条"
```

---

### 告警分级

```
P0（致命）：
  → 核心功能不可用
  → 立即电话通知 + 自动处理
  → 5分钟内必须响应

P1（严重）：
  → 核心功能降级
  → 短信 + 钉钉通知
  → 15分钟内响应

P2（警告）：
  → 非核心功能异常
  → 钉钉通知
  → 1小时内响应

P3（提示）：
  → 需要关注的指标
  → 邮件通知
  → 工作时间处理
```

---

## 八、完整的高可用演练案例

### 场景：模拟机房A故障

**准备阶段：**
```
1. 确认监控和告警正常
2. 确认值班人员就位
3. 确认回滚方案
4. 确认演练范围（只影响测试集群）
```

**执行阶段：**
```
T+0s：切断机房A的网络（模拟机房故障）

T+10s：监控告警触发
  → 机房A的服务健康检查失败
  → 告警发送到值班群

T+30s：自动切换启动
  → GLB检测到机房A故障
  → 将机房A的流量切到机房B
  → DNS更新（如果是DNS方式）

T+60s：验证机房B
  → 检查机房B的QPS是否翻倍
  → 检查机房B的错误率是否正常
  → 检查用户是否可以正常访问

T+5min：数据验证
  → 检查机房B的数据库是否接管写入
  → 检查缓存是否正常
  → 检查消息队列是否正常消费
```

**总结阶段：**
```
恢复：恢复机房A的网络

记录：
  - 从故障发生到检测到：10s
  - 从检测到到流量切换完成：30s
  - 是否有数据丢失：无/有（记录详情）
  - 用户是否有感知：无/有（记录详情）
  - 发现的问题：...
  - 改进计划：...
```

---

## 九、大厂高可用实践案例

### 阿里巴巴的单元化架构

**背景：**
```
双11有极端高并发
→ 单城市的IDC撑不住
→ 需要多个城市分担流量
```

**单元化设计：**
```
每个"单元"是一个完整的业务闭环
  - 有自己的应用服务器
  - 有自己的数据库（分片的一部分）
  - 有自己的缓存集群

用户请求根据userID路由到对应单元
→ 所有操作在本单元内完成（不跨单元）
→ 故障只影响本单元
→ 其他单元不受影响
```

```
[用户]
  ↓
[路由层] → 根据userID决定打到哪个单元
  ↓              ↓              ↓
[杭州单元]   [北京单元]   [上海单元]
  - 用户A-C      - 用户D-F     - 用户G-I
  - 完整服务     - 完整服务    - 完整服务
  - 分片数据     - 分片数据    - 分片数据
```

---

### 微信的SET化架构

**背景：**
```
微信用户10亿+
→ 不可能所有用户用同一个后端
→ 需要按用户分组，每组独立
```

**SET（逻辑集合）：**
```
把用户分成N个SET
每个SET包含完整的服务和数据
SET之间相互独立

优点：
→ 故障只影响一个SET（<10%用户）
→ 可以按SET进行灰度发布
→ 横向扩展非常容易（增加SET）
```

---

### 美团的同城双活实践

**架构：**
```
北京主机房 ←→ 北京备机房（同城双活）
  ↕
上海主机房 ←→ 上海备机房（同城双活）

北京↔上海：异地互备（非双活，主要容灾）
```

**核心数据同步：**
```
MySQL：北京主、上海从（异步同步）
Redis：各自独立，定期快照同步
消息队列：双向同步，幂等消费
```

---

## 十、面试高频题

### 1. 什么是高可用？怎么度量？

**标准回答：**
```
高可用 = 系统在大多数时间内都能正常提供服务

度量：可用性 = 正常时间 / 总时间
  3个9：99.9%，全年宕机8.76小时
  4个9：99.99%，全年宕机52分钟
  5个9：99.999%，全年宕机5分钟

提升方向：
1. 消除单点（主从、集群、冗余）
2. 降低故障频率（监控、测试、灰度发布）
3. 降低恢复时间（自动化、混沌演练）
```

---

### 2. 同城双活和异地多活的区别？

**标准回答：**
```
同城双活：
  同一城市两个IDC，专线连接（<1ms）
  数据强一致性相对容易
  解决：IDC级故障
  成本：中等

异地多活：
  不同城市多个IDC（10~200ms延迟）
  数据只能最终一致
  数据分区（每份数据只在一个IDC写）
  解决：城市级灾难
  成本：高，改造复杂

选择：
  大多数公司：同城双活（性价比高）
  超大规模互联网：异地多活
```

---

### 3. 异地多活如何解决数据一致性？

**标准回答：**
```
核心思路：数据分区，避免写冲突

1. 按用户ID分区：
   userId % N 决定路由到哪个IDC
   同一用户的写只在一个IDC
   从根本上避免冲突

2. 异步同步：
   各IDC通过DTS同步数据
   最终一致性
   有冲突按时间戳/版本号解决

3. 关键数据：
   如资金，只在主IDC写
   其他IDC只读
   宁可性能差，不允许冲突
```

---

### 4. 混沌工程是什么？为什么要做？

**标准回答：**
```
混沌工程：主动在系统中注入故障
→ 验证系统的容错能力
→ 提前发现薄弱环节

为什么要做：
→ 故障不可避免，提前演练比被动应对好
→ 验证限流、熔断、降级等机制是否真的有效
→ 建立团队处理故障的信心和能力

实践：
→ 从小范围开始（测试环境）
→ 有监控和kill switch
→ 定期执行（每季度）
→ 结果输出改进计划
```

---

### 5. RTO和RPO是什么？

**标准回答：**
```
RTO（恢复时间目标）：
  从故障发生到系统恢复的时间
  越小越好
  
RPO（恢复点目标）：
  最多丢失多少数据（时间维度）
  RPO=0 = 数据零丢失
  RPO=1小时 = 最多丢1小时数据

关系：
  RTO和RPO越小，成本越高
  需要根据业务重要性权衡

典型场景：
  支付系统：RTO<1min, RPO=0
  电商系统：RTO<5min, RPO<1min
  内容系统：RTO<30min, RPO<10min
```

---

### 6. 如何设计MySQL的高可用方案？

**标准回答：**
```
方案一：主从 + MHA（中小规模）
  Master + 2个Slave
  MHA自动检测故障并切换
  RTO: 30~60秒
  RPO: 少量数据丢失（异步复制延迟）

方案二：主从 + 半同步复制（降低RPO）
  半同步：至少一个Slave收到binlog才返回给客户端
  RPO接近0
  性能略有下降

方案三：MGR（MySQL Group Replication）
  Paxos协议，多主
  强一致性，RPO=0
  性能有损耗

方案四：分库分表 + 每个分片高可用
  数据量大时采用
  每个分片独立做主从高可用
```

---

## 十一、这一讲你必须记住的核心结论

1. **高可用的度量：几个9，4个9=全年宕机52分钟是大厂目标**
2. **消除单点：应用集群、数据库主从、Redis哨兵、Nginx主备**
3. **同城双活解决IDC级故障，异地多活解决城市级灾难**
4. **异地多活核心：数据分区，每份数据只在一个IDC写入**
5. **备份三二一原则：3份、2种介质、1份异地**
6. **混沌工程：主动注入故障，提前发现问题**
7. **监控四黄金指标：延迟、流量、错误率、饱和度**
8. **RTO和RPO越小成本越高，根据业务重要性权衡**

---

## 十二、练习题

### 练习1：高可用设计

为一个日订单100万的电商系统设计高可用方案：

要求：
1. 可用性目标：4个9
2. 消除所有单点
3. 数据库高可用方案
4. 缓存高可用方案
5. 画出架构图

---

### 练习2：容灾演练方案

设计一个Redis宕机的容灾演练方案：

要求：
1. 演练目标是什么？
2. 演练步骤
3. 验证指标（什么算通过？）
4. 回滚方案
5. 预期发现的问题

---

### 练习3：监控告警

为订单服务设计监控告警方案：

要求：
1. 哪些指标需要监控？
2. 每个指标的告警阈值是多少？
3. 告警分级（P0/P1/P2/P3）
4. 告警通知方式

---

### 练习4：思考题

**为什么说"异地多活是架构上的最大挑战之一"？**

从数据一致性、网络延迟、业务改造三个角度分析。

---

## 十三、下一讲预告

**第 10 讲：高并发系统设计面试全攻略**

最后一讲，我们回归面试，把所有知识串联：
- 高并发面试的答题框架
- 10个最高频的系统设计题详解
- 大厂面试官真正想考察什么
- 如何在30分钟内完整回答一道系统设计题
- 面试中的加分点和减分点
- 简历如何体现高并发经验
- 完整的复习路线和查漏补缺清单

---

**你可以先做练习题，我帮你批改。**

**或者直接开始第10讲。**

**你想怎么安排？**
