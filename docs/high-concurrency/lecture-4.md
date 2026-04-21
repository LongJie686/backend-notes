# 第 4 讲：分库分表——数据层的水平扩展

这一讲是高并发系统设计中**难度最高、坑最多**的一讲。

核心问题：
- 拆之前要不要拆？什么时候拆？
- 怎么拆？按什么拆？
- 拆完之后分页怎么做？
- 跨库查询怎么处理？
- 分布式事务怎么解决？
- 数据怎么迁移不停机？
- 扩容怎么做？

---

## 一、什么时候该分库分表？

### 先问自己三个问题

**很多人一遇到性能问题就想分库分表，这是错的。**

分库分表是有代价的：
- 系统复杂度大幅上升
- 跨库查询变难
- 分布式事务变复杂
- 运维成本增加
- 扩容代价大

**所以分库分表是最后手段，不是第一选择。**

### 优先考虑这些手段

**第一步：SQL和索引优化**
```
加索引、优化SQL、覆盖索引
-> 能解决大部分慢查询
-> 成本最低
```

**第二步：引入缓存**
```
Redis缓存热点数据
-> 读QPS从打DB变成打Redis
-> DB压力大幅降低
```

**第三步：读写分离**
```
主库写 + 从库读
-> 读QPS扩展到N倍
-> 相对简单
```

**第四步：归档历史数据**
```
3年前的订单迁移到归档库
-> 当前库数据量大幅减少
-> 不需要拆分
```

**这四步都做了还不够，再考虑分库分表。**

### 什么时候必须分库分表？

**信号 1：单表数据量过大**
```
经验值：单表超过2000万行
-> 即使有索引，B+树层数增加
-> 查询性能下降
-> 需要分表
```

**信号 2：单库 QPS/TPS 过高**
```
单库写入TPS > 5000
单库读QPS > 10000（加了缓存还不够）
-> 需要分库
```

**信号 3：单库磁盘容量不够**
```
单库磁盘 > 1TB
-> 备份慢、恢复慢
-> 需要分库
```

**信号 4：单库连接数打满**
```
MySQL最大连接数 = 2000（一般配置）
应用服务器多 x 连接池大
-> 连接数不够
-> 需要分库
```

### 数据量和 QPS 参考阈值

```
单表行数：建议不超过2000万
单表大小：建议不超过50GB
单库TPS：写入超过5000考虑分库
单库QPS：读超过10000（缓存后）考虑分库
```

---

## 二、垂直拆分 vs 水平拆分

### 1. 垂直拆分

#### 垂直分库

**按业务模块拆分数据库。**

**拆分前：**
```
[单一数据库]
  - 用户表 (user)
  - 订单表 (order)
  - 商品表 (product)
  - 库存表 (inventory)
  - 支付表 (payment)
  - 评论表 (comment)
```

**拆分后：**
```
[用户库 user_db]
  - user
  - user_address
  - user_account

[订单库 order_db]
  - order_info
  - order_item

[商品库 product_db]
  - product
  - product_sku
  - category

[库存库 inventory_db]
  - inventory

[支付库 payment_db]
  - payment_record

[评论库 comment_db]
  - comment
```

**优点：**
- 按业务隔离，故障不相互影响
- 每个库独立优化
- 配合微服务架构

**缺点：**
- 跨库join不方便
- 分布式事务问题
- 不解决单表数据量大的问题

#### 垂直分表

**把一张宽表拆成多张窄表。**

**拆分前：**
```sql
CREATE TABLE user (
    id BIGINT,
    name VARCHAR(50),
    phone VARCHAR(20),
    email VARCHAR(100),
    avatar VARCHAR(255),
    bio TEXT,           -- 个人简介，大字段
    settings TEXT,      -- 用户设置，大字段
    last_login DATETIME,
    create_time DATETIME
);
```

**拆分后：**
```sql
-- 用户基础表（频繁查询的字段）
CREATE TABLE user_base (
    id BIGINT,
    name VARCHAR(50),
    phone VARCHAR(20),
    email VARCHAR(100),
    last_login DATETIME,
    create_time DATETIME
);

-- 用户详情表（不常查询的大字段）
CREATE TABLE user_detail (
    user_id BIGINT,
    avatar VARCHAR(255),
    bio TEXT,
    settings TEXT
);
```

**原理：**
```
MySQL的InnoDB按页存储（16KB/页）
宽表一行数据大 -> 一页存的行数少 -> 查询IO多
窄表一行数据小 -> 一页存的行数多 -> 查询IO少
```

---

### 2. 水平拆分

**把同一张表的数据分散到多个库/表。**

#### 水平分表（不分库）

```
order_info_0
order_info_1
order_info_2
order_info_3
```

**优点：** 解决单表数据量大的问题，实现简单
**缺点：** 不解决单库连接数/IO瓶颈

#### 水平分库分表

```
order_db_0
  order_info_0
  order_info_1

order_db_1
  order_info_2
  order_info_3

order_db_2
  order_info_4
  order_info_5

order_db_3
  order_info_6
  order_info_7
```

**既解决了单表数据量问题，也解决了单库瓶颈。**

### 垂直 vs 水平 对比

| 维度 | 垂直拆分 | 水平拆分 |
|------|---------|---------|
| **解决问题** | 业务耦合、表宽度 | 数据量大、QPS高 |
| **拆分维度** | 按列（字段）/ 按业务 | 按行（数据） |
| **实现难度** | 低 | 高 |
| **跨库join** | 有问题 | 有问题 |
| **数据量** | 不减少 | 减少 |
| **适用场景** | 业务初期架构优化 | 数据量/QPS到瓶颈 |

---

## 三、分片策略：数据路由怎么做？

**这是分库分表最核心的设计决策。**

### 1. Hash 取模分片

**原理：**
```
分片编号 = hash(分片键) % 分片数量
```

**示例：**
```java
// 4个分片
int shardCount = 4;
int shardIndex = (int)(userId % shardCount);

// userId=1001 -> 1001 % 4 = 1 -> 分片1
// userId=1002 -> 1002 % 4 = 2 -> 分片2
// userId=1003 -> 1003 % 4 = 3 -> 分片3
// userId=1004 -> 1004 % 4 = 0 -> 分片0
```

**优点：** 数据分布均匀、路由简单
**缺点：** 扩容时要迁移大量数据、范围查询效率低

### 2. Range 范围分片

**示例：**
```
order_info_0: orderId 1 ~ 1000000
order_info_1: orderId 1000001 ~ 2000000
order_info_2: orderId 2000001 ~ 3000000
...
```

**优点：** 范围查询效率高、扩容方便
**缺点：** 数据分布不均匀（热点问题）

### 3. 一致性 Hash

**原理：**
```
构建一个虚拟Hash环（0 ~ 2^32）
节点映射到环上的某个位置
数据路由到顺时针方向最近的节点
```

**优点：**
- 扩容时只迁移部分数据（1/N）
- 删除节点时也只影响部分数据

**缺点：** 数据分布可能不均匀、实现复杂

**代码示例：**
```java
public class ConsistentHash {
    private static final int VIRTUAL_NODES = 150;
    private final TreeMap<Long, String> ring = new TreeMap<>();

    public void addNode(String node) {
        for (int i = 0; i < VIRTUAL_NODES; i++) {
            long hash = hash(node + "-virtual-" + i);
            ring.put(hash, node);
        }
    }

    public String getNode(String key) {
        if (ring.isEmpty()) return null;
        long hash = hash(key);
        Map.Entry<Long, String> entry = ring.ceilingEntry(hash);
        if (entry == null) {
            entry = ring.firstEntry();
        }
        return entry.getValue();
    }

    private long hash(String key) {
        return Hashing.murmur3_32().hashString(key, Charsets.UTF_8).padToLong();
    }
}
```

### 4. 分片策略对比

| 策略 | 数据均匀 | 范围查询 | 扩容难度 | 适用场景 |
|------|---------|---------|---------|---------|
| Hash取模 | 均匀 | 差 | 难 | 最常用 |
| Range范围 | 不均匀 | 好 | 容易 | 时序数据 |
| 一致性Hash | 较均匀 | 差 | 较容易 | 缓存场景 |

---

## 四、分片键怎么选？这是最重要的决策

### 分片键选择原则

**原则 1：查询频率最高的字段**
```
90%的查询都用user_id查询
-> 选user_id做分片键
-> 查询时能直接定位分片
```

**原则 2：数据分布尽量均匀**
```
user_id分布均匀
订单状态（3个值）分布不均
```

**原则 3：尽量避免跨分片查询**

**原则 4：分片键一旦确定，不能修改**

### 常见业务的分片键选择

#### 订单系统

**方案一：按 user_id 分片**
```
优点：查用户的订单列表，命中单个分片
缺点：按订单号查，不知道在哪个分片（需要另建索引）
```

**方案二：按 order_id 分片**
```
优点：按订单号查，命中单个分片
缺点：查某用户的所有订单，需要扫描多个分片
```

**大厂方案：双维度索引**
```
主表：按user_id分片（保证用户查询高效）
索引表：按order_id -> user_id（通过order_id找到user_id，再找主表）
```

```java
// 查询流程
public Order getByOrderNo(String orderNo) {
    // 1. 查索引表（按order_no查user_id）
    Long userId = orderIndexDao.getUserIdByOrderNo(orderNo);
    // 2. 用user_id定位分片，查主表
    return orderDao.getByOrderNoAndUserId(orderNo, userId);
}
```

### 热点问题

**问题：** 某个分片键的数据访问频率远高于其他 -> 该分片成为热点

**解决方案：**

**方案 1：热点数据单独处理**
```java
if (isHotUser(userId)) {
    return getHotUserShard(userId);
}
return getNormalShard(userId);
```

**方案 2：分片键加随机后缀**
```java
String shardKey = userId + "_" + ThreadLocalRandom.current().nextInt(10);
int shardIndex = shardKey.hashCode() % shardCount;
```

**方案 3：本地缓存**

---

## 五、全局唯一 ID：分库分表后主键怎么生成？

分库分表后，不能再用数据库自增ID（会冲突）。

### 方案 1：UUID

**优点：** 实现简单，本地生成，无依赖
**缺点：** 32位字符串索引大、无序导致B+树页分裂严重、可读性差
**通常不推荐做主键**

### 方案 2：数据库自增（步长方案）

```sql
-- 数据库1
SET auto_increment_offset = 1;
SET auto_increment_increment = 4;
-- 生成：1, 5, 9, 13...

-- 数据库2
SET auto_increment_offset = 2;
SET auto_increment_increment = 4;
-- 生成：2, 6, 10, 14...
```

**优点：** 简单、数字ID
**缺点：** 扩容时步长难以调整、依赖数据库

### 方案 3：号段模式

**原理：** 号段发号器集中管理 ID 段，应用本地批量领取。

```sql
CREATE TABLE `id_segment` (
    `biz_type` VARCHAR(64) NOT NULL,
    `max_id` BIGINT NOT NULL,
    `step` INT NOT NULL,
    `version` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`biz_type`)
);
```

```java
public class SegmentIdGenerator {
    private long currentId;
    private long maxId;
    private final int step = 1000;

    public synchronized long nextId() {
        if (currentId >= maxId) {
            fetchSegment();
        }
        return currentId++;
    }

    private void fetchSegment() {
        // 乐观锁更新 max_id
        // UPDATE id_segment SET max_id = max_id + step, version = version + 1
        // WHERE biz_type = 'order' AND version = #{version}
    }
}
```

**美团 Leaf 就是这个方案的生产实现。**

### 方案 4：雪花算法（Snowflake）-- 最推荐

**ID 结构（64 位）：**

```
|  1位  |      41位      |   10位   |   12位   |
| 符号位 |    时间戳      |  机器ID  |  序列号  |
|  0    | 毫秒级时间戳   | 数据中心+机器 | 同毫秒内序列 |
```

**各部分含义：**
```
41位时间戳：约69年
10位机器ID：5位数据中心 + 5位机器 = 32 x 32 = 1024台
12位序列号：同毫秒内最多4096个ID
```

**QPS上限：** 每毫秒 4096 x 1000ms = 400万 ID/秒

**代码实现：**
```java
public class SnowflakeIdGenerator {
    private final long epoch = 1577836800000L; // 2020-01-01

    private final long workerIdBits = 5L;
    private final long datacenterIdBits = 5L;
    private final long sequenceBits = 12L;

    private final long maxWorkerId = ~(-1L << workerIdBits);       // 31
    private final long maxDatacenterId = ~(-1L << datacenterIdBits); // 31
    private final long maxSequence = ~(-1L << sequenceBits);         // 4095

    private final long workerIdShift = sequenceBits;                 // 12
    private final long datacenterIdShift = sequenceBits + workerIdBits; // 17
    private final long timestampShift = sequenceBits + workerIdBits + datacenterIdBits; // 22

    private final long workerId;
    private final long datacenterId;
    private long lastTimestamp = -1L;
    private long sequence = 0L;

    public SnowflakeIdGenerator(long workerId, long datacenterId) {
        this.workerId = workerId;
        this.datacenterId = datacenterId;
    }

    public synchronized long nextId() {
        long currentTimestamp = System.currentTimeMillis();

        if (currentTimestamp < lastTimestamp) {
            throw new RuntimeException("时钟回拨，拒绝生成ID");
        }

        if (currentTimestamp == lastTimestamp) {
            sequence = (sequence + 1) & maxSequence;
            if (sequence == 0) {
                currentTimestamp = waitNextMillis(lastTimestamp);
            }
        } else {
            sequence = 0L;
        }

        lastTimestamp = currentTimestamp;

        return ((currentTimestamp - epoch) << timestampShift)
                | (datacenterId << datacenterIdShift)
                | (workerId << workerIdShift)
                | sequence;
    }

    private long waitNextMillis(long lastTimestamp) {
        long timestamp = System.currentTimeMillis();
        while (timestamp <= lastTimestamp) {
            timestamp = System.currentTimeMillis();
        }
        return timestamp;
    }
}
```

### 时钟回拨问题

**问题：** 服务器时钟同步时可能出现回拨 -> 会生成重复 ID

**解决方案：**

1. **直接报错**：回拨时抛异常停止生成
2. **等待恢复**：回拨 5ms 以内则等待恢复
3. **备用位**（美团 Leaf 方案）：用 1 位作为时钟回拨标记位

### 全局 ID 方案对比

| 方案 | 性能 | 趋势递增 | 依赖 | 适用场景 |
|------|------|---------|------|---------|
| UUID | 高 | 否 | 无 | 非主键场景 |
| 数据库步长 | 低 | 是 | 数据库 | 小规模 |
| 号段模式 | 高 | 是 | 数据库 | 通用 |
| **雪花算法** | **极高** | **是** | **无** | **最推荐** |

---

## 六、分库分表后的查询难题

### 1. 分页排序问题

**场景：** 订单表按 user_id 分片成 4 个库，查询所有"待支付"订单按创建时间排序第 2 页。

**问题：** 查询不包含分片键 -> 需要扫描所有分片 -> 如何合并排序？

#### 方案 1：全局排序归并（适合小数据量）

```java
// 查询第2页（skip=10, limit=10）
// 每个分片要查前20条（skip + limit）
int skip = 10;
int limit = 10;

List<Order> shard0Orders = query("order_db_0", "status=1 ORDER BY create_time DESC LIMIT 0, 20");
List<Order> shard1Orders = query("order_db_1", "status=1 ORDER BY create_time DESC LIMIT 0, 20");
List<Order> shard2Orders = query("order_db_2", "status=1 ORDER BY create_time DESC LIMIT 0, 20");
List<Order> shard3Orders = query("order_db_3", "status=1 ORDER BY create_time DESC LIMIT 0, 20");

// 应用层合并排序
List<Order> allOrders = merge(shard0Orders, shard1Orders, shard2Orders, shard3Orders);
allOrders.sort(Comparator.comparing(Order::getCreateTime).reversed());

return allOrders.subList(skip, skip + limit);
```

**问题：** 第 100 页 -> 每个分片要查前 1010 条 -> 越翻页越慢

#### 方案 2：禁止深翻页，改用游标翻页（推荐）

**原理：** 不用 LIMIT offset，而是用时间戳/ID做游标。

```java
// 第1页
List<Order> firstPage = query(
    "status=1 AND create_time < NOW() ORDER BY create_time DESC LIMIT 10"
);

// 第2页（用第1页最后一条的时间做游标）
Order lastOrder = firstPage.get(firstPage.size() - 1);
List<Order> secondPage = query(
    "status=1 AND create_time < ? ORDER BY create_time DESC LIMIT 10",
    lastOrder.getCreateTime()
);
```

**优点：** 每个分片只返回 pageSize 条数据，性能不随翻页增加而下降
**缺点：** 不支持跳页，前端需要"加载更多"而不是页码翻页

#### 方案 3：异构索引

**原理：** 专门为非分片键的查询维护一张索引表。

```sql
CREATE TABLE order_index (
    id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,   -- 用于定位主表分片
    status TINYINT NOT NULL,
    create_time DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_status_time (status, create_time)
);
```

```java
public List<Order> getOrdersByStatus(int status, int page, int pageSize) {
    // 1. 查索引表（不跨分片）
    List<OrderIndex> indexes = orderIndexDao.query(
        "status = ? ORDER BY create_time DESC LIMIT ?, ?",
        status, (page-1) * pageSize, pageSize
    );

    // 2. 根据user_id和id，查各分片主表
    Map<Integer, List<Long>> shardOrders = new HashMap<>();
    for (OrderIndex index : indexes) {
        int shardIndex = (int)(index.getUserId() % 4);
        shardOrders.computeIfAbsent(shardIndex, k -> new ArrayList<>())
                   .add(index.getId());
    }

    List<Order> result = new ArrayList<>();
    for (Map.Entry<Integer, List<Long>> entry : shardOrders.entrySet()) {
        List<Order> orders = query("order_db_" + entry.getKey(),
            "id IN (" + join(entry.getValue()) + ")");
        result.addAll(orders);
    }

    result.sort(Comparator.comparing(Order::getCreateTime).reversed());
    return result;
}
```

### 2. 跨分片聚合问题

**方案 1：应用层合并**
```java
Map<Integer, Long> result = new HashMap<>();
for (Map<Integer, Long> stats : Arrays.asList(shard0Stats, shard1Stats, shard2Stats, shard3Stats)) {
    stats.forEach((status, cnt) ->
        result.merge(status, cnt, Long::sum)
    );
}
```

**方案 2：异步统计（推荐）**
```java
@Consumer("order.status.changed")
public void onStatusChanged(OrderStatusChangedEvent event) {
    orderStatsDao.increment(event.getNewStatus(), 1);
    orderStatsDao.decrement(event.getOldStatus(), 1);
}
```

### 3. 跨库 Join 问题

**方案 1：应用层拼装（最常用）**
```java
// 1. 查订单
List<Order> orders = orderDao.getByStatus(1);
// 2. 收集user_id
Set<Long> userIds = orders.stream().map(Order::getUserId).collect(Collectors.toSet());
// 3. 批量查用户
Map<Long, User> userMap = userDao.getByIds(userIds).stream()
    .collect(Collectors.toMap(User::getId, u -> u));
// 4. 拼装结果
```

**方案 2：字段冗余** -- 下单时冗余用户名，查询时不需要 join

**方案 3：宽表（ElasticSearch）** -- 复杂查询走 ES

---

## 七、分布式事务

### 为什么需要分布式事务？

```
下单：
1. 扣库存（库存库）
2. 创建订单（订单库）
3. 扣余额（用户库）
要求：三步要么全部成功，要么全部失败
```

### 方案 1：2PC（两阶段提交）

**流程：**
```
协调者：
  第一阶段（Prepare）：通知所有参与者准备好了吗？各参与者锁定资源，写undo log
  第二阶段（Commit）：所有OK则提交，有失败则回滚
```

**优点：** 强一致性
**缺点：** 性能差（同步阻塞）、协调者单点故障、资源锁定时间长

### 方案 2：TCC（Try-Confirm-Cancel）

**三个阶段：**
```
Try：预留资源（不实际扣减）
Confirm：确认操作（实际执行）
Cancel：撤销操作（释放预留）
```

```java
public class InventoryTCC {
    @TccTry
    public boolean tryDeduct(Long productId, int quantity) {
        inventoryDao.freeze(productId, quantity);
        return true;
    }

    @TccConfirm
    public void confirmDeduct(Long productId, int quantity) {
        inventoryDao.deductFrozen(productId, quantity);
    }

    @TccCancel
    public void cancelDeduct(Long productId, int quantity) {
        inventoryDao.unfreeze(productId, quantity);
    }
}
```

**三大问题：**
- **空回滚**：Try没执行，Cancel却被调用 -> 记录Try执行状态
- **幂等**：Confirm/Cancel可能被重复调用 -> 检查当前状态
- **悬挂**：Cancel先于Try执行 -> Try时检查是否已Cancel

### 方案 3：Saga

**原理：** 把长事务拆成一系列短事务，每个短事务都有对应的补偿操作。

```
T1 -> T2 -> T3 -> T4

如果T3失败：
T3失败 -> C3(补偿T3) -> C2(补偿T2) -> C1(补偿T1)
```

### 方案 4：本地消息表（最常用）

**原理：** 利用本地数据库事务 + 消息队列实现跨服务的最终一致性。

```java
// 服务A：下单
@Transactional
public void createOrder(Order order) {
    orderDao.insert(order);

    LocalMessage msg = new LocalMessage();
    msg.setTopic("inventory.deduct");
    msg.setBody(JSON.toJSONString(new DeductRequest(order)));
    msg.setStatus("INIT");
    localMessageDao.insert(msg);
    // 事务提交：order和message同时成功或失败
}

// 后台扫描线程
@Scheduled(fixedRate = 1000)
public void scan() {
    List<LocalMessage> messages = localMessageDao.findByStatus("INIT", 100);
    for (LocalMessage msg : messages) {
        try {
            mq.send(msg.getTopic(), msg.getBody());
            msg.setStatus("SENT");
        } catch (Exception e) {
            msg.setRetryCount(msg.getRetryCount() + 1);
        }
        localMessageDao.update(msg);
    }
}

// 服务B：扣库存
@Consumer("inventory.deduct")
public void onDeductMessage(DeductRequest request) {
    if (inventoryDao.isDeducted(request.getOrderId())) {
        return;  // 幂等
    }
    inventoryDao.deduct(request.getProductId(), request.getQuantity());
    inventoryDao.markDeducted(request.getOrderId());
}
```

### 分布式事务方案对比

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|---------|
| 2PC | 强一致 | 低 | 低 | 数据库层，性能不敏感 |
| TCC | 强一致 | 中 | 高 | 核心交易 |
| Saga | 最终一致 | 高 | 中 | 长流程业务 |
| **本地消息表** | **最终一致** | **高** | **低** | **最常用** |

**大厂实践：**
- 强一致：核心资金操作（转账）用 2PC/TCC
- 最终一致：非核心操作（通知、积分、统计）用本地消息表

---

## 八、不停机数据迁移

### 全量迁移 + 增量同步方案

```
阶段1：双写准备
阶段2：全量迁移
阶段3：数据校验
阶段4：灰度切读
阶段5：切写
阶段6：下线旧库
```

#### 阶段 1：双写准备

```java
public void createOrder(Order order) {
    newOrderDao.insert(order);   // 写新库（分库分表）
    oldOrderDao.insert(order);   // 同时写旧库（兜底）
}
```

#### 阶段 2：全量数据迁移

```java
public void migrateAll() {
    long lastId = 0;
    int batchSize = 1000;

    while (true) {
        List<Order> orders = oldOrderDao.getAfter(lastId, batchSize);
        if (orders.isEmpty()) break;

        for (Order order : orders) {
            int shardIndex = (int)(order.getUserId() % 4);
            newOrderDao.insert("order_db_" + shardIndex, order);
        }

        lastId = orders.get(orders.size() - 1).getId();
    }
}
```

#### 阶段 3：数据校验

```java
public void validate() {
    List<Long> sampleIds = oldOrderDao.randomSample(1000);
    int inconsistentCount = 0;
    for (Long id : sampleIds) {
        Order oldOrder = oldOrderDao.getById(id);
        Order newOrder = newOrderDao.getById(id);
        if (!oldOrder.equals(newOrder)) {
            inconsistentCount++;
        }
    }
    log.info("不一致率: {}/{}", inconsistentCount, sampleIds.size());
}
```

#### 阶段 4：灰度切读

```java
// 先10%用户走新库
if (userId % 10 == 0) {
    return newOrderDao.getById(id);
}
return oldOrderDao.getById(id);
```

#### 阶段 5：切写

观察新库稳定后，停止双写，只写新库。

#### 使用 binlog 同步（更成熟的方案）

```
旧库 -> Canal -> 解析binlog -> 写入新库（分片）
```

---

## 九、扩容方案

### Hash 取模分片的扩容难题

```
原来4个分片：userId % 4
扩容到8个分片：userId % 8

userId=1005：
  原来 -> 1005 % 4 = 1 -> 分片1
  现在 -> 1005 % 8 = 5 -> 分片5（变了！）
```

### 解决方案：翻倍扩容

**每次扩容都翻倍（4 -> 8 -> 16 -> 32）。**

```
原来4个分片，扩容到8个：
分片0的数据拆成两半 -> 新分片0和新分片4
分片1的数据拆成两半 -> 新分片1和新分片5
...
每个原分片只需迁移一半数据
```

### 预分片方案（最推荐）

**一开始就分成足够多的虚拟分片，后续只改映射关系。**

```
一开始建1024个虚拟分片
路由：shardIndex = userId % 1024

初始（4个物理节点）：
  DB0 -> 虚拟分片 0~255
  DB1 -> 虚拟分片 256~511
  DB2 -> 虚拟分片 512~767
  DB3 -> 虚拟分片 768~1023

扩容（8个物理节点）：
  DB0 -> 虚拟分片 0~127
  DB4 -> 虚拟分片 128~255  <- 从DB0迁移
  ...
```

**优点：** 扩容只需迁移部分数据，路由规则不变

---

## 十、分库分表中间件

### ShardingSphere（Apache）

```yaml
dataSources:
  ds0:
    url: jdbc:mysql://localhost:3306/order_db_0
  ds1:
    url: jdbc:mysql://localhost:3306/order_db_1
  ds2:
    url: jdbc:mysql://localhost:3306/order_db_2
  ds3:
    url: jdbc:mysql://localhost:3306/order_db_3

rules:
  - !SHARDING
    tables:
      order_info:
        actualDataNodes: ds${0..3}.order_info_${0..3}
        databaseStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: order_db_inline
        tableStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: order_table_inline
        keyGenerateStrategy:
          column: id
          keyGeneratorName: snowflake
    shardingAlgorithms:
      order_db_inline:
        type: INLINE
        props:
          algorithm-expression: ds${user_id % 4}
      order_table_inline:
        type: INLINE
        props:
          algorithm-expression: order_info_${user_id % 4}
    keyGenerators:
      snowflake:
        type: SNOWFLAKE
    broadcastTables:
      - province
      - city
      - dictionary
```

使用时和普通 JDBC 完全一样，中间件透明路由。

---

## 十一、大厂分库分表实战案例

### 美图订单系统演进

```
阶段1：单库（日订单 < 10万）
  单个MySQL实例，AUTO_INCREMENT主键

阶段2：读写分离（日订单 10万~100万）
  主库写 + 从库读 + Redis缓存

阶段3：垂直分库（日订单 100万~1000万）
  order_db / inventory_db / user_db / payment_db

阶段4：水平分库分表（日订单 > 1000万）
  4库 x 4表 = 16张表，按user_id分片
```

### 关键数字

```
单表建议：不超过2000万行
分片数量：建议是2的N次方（4, 8, 16, 32...）
初始分片：建议多分一些（64或1024个虚拟分片）
```

---

## 十二、常见坑点

### 坑 1：分片键选错
订单表按 order_status 分片（只有几个值）-> 数据分布不均 -> 性能更差

### 坑 2：扩容没规划
初始分4个库，扩到8个库 -> 50%数据需要迁移

### 坑 3：分布式事务滥用
所有跨库操作都用 2PC -> 性能极差 -> 死锁频繁

### 坑 4：查询没有带分片键
```java
orderDao.getByOrderNo(orderNo); // 没带user_id -> 扫描所有分片
```

### 坑 5：数据迁移没有校验
全量迁移完成直接切换 -> 发现数据不一致 -> 线上问题

### 坑 6：全局表处理不当
省份表、字典表 -> 每个分片都需要 -> 用广播表配置

---

## 十三、面试高频题

### 1. 什么时候该分库分表？
优先考虑：索引优化 -> 缓存 -> 读写分离 -> 归档。分库分表信号：单表超2000万、写入TPS超5000、磁盘不够、连接数打满。

### 2. 垂直拆分和水平拆分的区别？
垂直：按业务/按列拆分，解决耦合和宽表问题。水平：按行拆分，解决数据量和QPS问题。

### 3. 分片键怎么选？
查询频率最高、数据分布均匀（高基数）、尽量避免跨分片查询、一旦确定不能修改。

### 4. 雪花算法原理？有什么问题？
64位整数：1位符号 + 41位时间戳 + 10位机器ID + 12位序列号。每毫秒可生成4096个ID，趋势递增。问题：时钟回拨。

### 5. 分库分表后分页怎么做？
全局排序归并（小数据量）、游标翻页（推荐）、异构索引（复杂查询）。

### 6. 分布式事务有哪些方案？
2PC（强一致性能差）、TCC（强一致代码复杂）、Saga（最终一致）、本地消息表（最终一致，最常用）。

### 7. 不停机数据迁移怎么做？
双写 -> 全量迁移 -> 数据校验 -> 灰度切读 -> 切写 -> 下线旧库。

### 8. 分库分表后如何扩容？
翻倍扩容（只迁移一半数据）、一致性Hash（添加节点只迁移1/N数据）、预分片（最推荐，扩容只改映射关系）。

---

## 十四、核心结论

1. **分库分表是最后手段，先做索引优化、缓存、读写分离**
2. **垂直拆分解决耦合，水平拆分解决数据量**
3. **分片键要查询频率高、分布均匀、不能修改**
4. **雪花算法是最推荐的全局ID方案**
5. **分页优先用游标翻页，而不是 LIMIT offset**
6. **分布式事务优先用本地消息表（最终一致性）**
7. **数据迁移用双写+校验+灰度切换，不能停服**
8. **扩容提前规划，翻倍扩容或预分片**
9. **中间件用 ShardingSphere，对业务透明**

---

## 十五、练习题

### 练习 1：分片设计
电商平台，订单表日新增 100 万条，主要查询按 user_id 查订单列表、按 order_no 查详情，预计运营 5 年。设计分片策略、分片数量、按 order_no 查询的解决方案、全局 ID 方案。

### 练习 2：分页方案
分库分表后（4库 x 4表 = 16张表），需要查询"待支付"订单列表，按创建时间倒序，支持翻页。分析 LIMIT offset 方案的问题，设计游标翻页方案。

### 练习 3：迁移方案
单库单表订单数据 5000 万条，不能停服，需要迁移到 4库16表。写出完整迁移步骤、数据校验方案、回滚方案。

### 练习 4：思考题
为什么分片键一旦确定就不能修改？如果真的要修改分片键，应该怎么做？
