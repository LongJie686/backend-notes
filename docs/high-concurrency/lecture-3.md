# 第 3 讲：消息队列——削峰填谷与系统解耦的利器

如果说缓存解决的是**读的问题**，那消息队列解决的就是**写的问题**。

---

## 一、消息队列解决什么问题？

### 1. 三大核心作用

#### 作用1：异步处理

**没有消息队列：**
```
用户下单 -> 扣库存 -> 创建订单 -> 发短信 -> 发邮件 -> 加积分 -> 返回
总耗时：50 + 50 + 50 + 100 + 100 + 50 = 400ms
```

**有消息队列：**
```
用户下单 -> 扣库存 -> 创建订单 -> 发消息 -> 返回
总耗时：50 + 50 + 10 = 110ms

消息队列异步处理：
  -> 发短信
  -> 发邮件
  -> 加积分
```

**效果：** 响应时间从 400ms 降到 110ms，用户体验大幅提升

---

#### 作用2：流量削峰

**没有消息队列：**
```
秒杀开始 -> 瞬间100万请求 -> 直接打到数据库 -> 数据库扛不住 -> 系统崩溃
```

**有消息队列：**
```
秒杀开始 -> 瞬间100万请求 -> 进入消息队列（缓冲）
-> 消费者按自己的速度消费（每秒5000）-> 数据库平稳处理
```

**类比：**
```
没有消息队列 = 洪水直接冲城市
有消息队列  = 洪水先进水库，再缓慢放水
```

---

#### 作用3：系统解耦

**没有消息队列：**
```java
// 订单服务直接调用多个下游
public void createOrder(Order order) {
    orderDao.insert(order);
    inventoryService.deduct(order);    // 调库存
    smsService.send(order);            // 发短信
    emailService.send(order);          // 发邮件
    pointService.add(order);           // 加积分
    // 新增一个下游就要改代码...
}
```

**问题：** 强耦合、一个下游挂了整个失败、新增下游要改代码、响应时间叠加

**有消息队列：**
```java
// 订单服务只发消息
public void createOrder(Order order) {
    orderDao.insert(order);
    mq.send("order.created", order);  // 发一条消息就够了
}

// 各下游独立消费
@Consumer(topic = "order.created")
public void onOrderCreated_SMS(Order order) { smsService.send(order); }

@Consumer(topic = "order.created")
public void onOrderCreated_Email(Order order) { emailService.send(order); }

@Consumer(topic = "order.created")
public void onOrderCreated_Point(Order order) { pointService.add(order); }
```

**好处：** 不关心多少下游、新增只需加消费者、互不影响、独立扩缩容

---

### 2. 什么时候不该用消息队列？

| 不适合的场景 | 原因 |
|-------------|------|
| 需要同步结果 | 如查询用户余额，必须立即返回 |
| 逻辑简单、调用少 | 加MQ反而增加复杂度 |
| 对一致性要求极高 | 转账必须同一事务，不适合异步 |

**原则：** 核心链路同步，非核心链路异步，有明确削峰/解耦需求才引入

---

## 二、消息队列核心概念

### 1. 基本模型

```
[生产者 Producer] -> 发送消息 -> [消息队列 Broker] -> 拉取/推送 -> [消费者 Consumer]
```

---

### 2. 两种消息模型

#### 点对点（Queue）

```
[Producer] -> [Queue] -> [Consumer]
```

一条消息只能被一个消费者消费，消费后从队列删除。

#### 发布/订阅（Pub/Sub）

```
[Producer] -> [Topic] -> [Consumer Group A]
                     -> [Consumer Group B]
                     -> [Consumer Group C]
```

一条消息可以被多个消费者组消费，每个消费者组独立消费。**Kafka和RocketMQ都采用此模型。**

---

### 3. 核心术语

| 术语 | 含义 |
|------|------|
| **Topic** | 消息主题，逻辑分类 |
| **Partition/Queue** | 分区，物理存储单元 |
| **Producer** | 消息生产者 |
| **Consumer** | 消息消费者 |
| **Consumer Group** | 消费者组，组内分摊消费 |
| **Offset** | 消费位移，记录消费到哪了 |
| **Broker** | 消息服务器节点 |

---

## 三、Kafka 核心原理

### 1. Kafka 整体架构

```
[Producer1] [Producer2]
     |           |
[Kafka Cluster]
  [Broker1]  [Broker2]  [Broker3]
  - Topic A    - Topic A    - Topic A
    Partition0   Partition1   Partition2
     |           |           |
[Consumer Group]
  [Consumer1] [Consumer2] [Consumer3]
  消费P0       消费P1       消费P2
```

---

### 2. Topic 与 Partition

**Topic：** 逻辑概念，一类消息的集合（如 order-topic、payment-topic）

**Partition：** 物理概念，一个Topic分成多个Partition，每个Partition是一个有序的、不可变的消息序列

**为什么要分Partition？**
- **并行消费**：多个消费者并行处理
- **水平扩展**：分布在不同Broker上
- **吞吐量提升**：单Partition写入可达100MB/s

```
Topic: order-topic
  Partition 0: [msg0, msg1, msg2, msg3, ...]  -> Broker1
  Partition 1: [msg4, msg5, msg6, msg7, ...]  -> Broker2
  Partition 2: [msg8, msg9, msg10, msg11, ...] -> Broker3
```

---

### 3. 消息路由：消息发到哪个Partition？

| 方式 | 做法 | 特点 |
|------|------|------|
| 指定Partition | 直接指定Partition编号 | 精确控制 |
| 按Key哈希 | 相同Key -> 同一Partition | **保证同Key有序** |
| 轮询（默认） | 依次发到各Partition | 最均匀 |

```java
// 按Key哈希（最常用）
producer.send(new ProducerRecord<>("order-topic", orderId, value));
// 相同orderId的消息会发到同一个Partition
```

---

### 4. Consumer Group

**核心规则：同一个Consumer Group内，一个Partition只能被一个Consumer消费**

```
Topic: order-topic (3个Partition)

Consumer Group A (3个消费者):
  Consumer1 -> Partition0, Consumer2 -> Partition1, Consumer3 -> Partition2
  每个消费者处理一个Partition

Consumer Group A (2个消费者):
  Consumer1 -> Partition0 + Partition1, Consumer2 -> Partition2
  消费者不够，一个消费者处理多个Partition

Consumer Group A (4个消费者):
  Consumer1 -> Partition0, Consumer2 -> Partition1, Consumer3 -> Partition2, Consumer4 -> 闲置
  消费者多于Partition数量，多出来的闲置
```

**结论：** 消费者数量 > Partition数量 -> 有消费者闲置

**不同Consumer Group独立消费：**
```
Consumer Group A (订单服务) -> 消费所有消息
Consumer Group B (积分服务) -> 消费所有消息
Consumer Group C (通知服务) -> 消费所有消息
```

---

### 5. Kafka 存储原理

**日志存储：**
```
Partition0/
  00000000000000000000.log      # 第1个日志段
  00000000000000000000.index    # 稀疏索引
  00000000000000000000.timeindex  # 时间索引
  00000000000000065536.log      # 第2个日志段
  ...
```

**为什么Kafka吞吐量高？**

| 原因 | 说明 |
|------|------|
| **顺序写磁盘** | 追加写而非随机写，SSD上可达 500-1000 MB/s |
| **零拷贝** | sendfile 系统调用，4次拷贝+4次上下文切换 -> 2次拷贝+2次切换 |
| **批量+压缩** | batch.size=16KB + linger.ms=5ms + LZ4压缩 |
| **Partition并行** | 8个Partition = 8路并行写入，吞吐量翻8倍 |

---

### 6. Kafka 副本机制

```
Partition0:
  Leader: Broker1    (读写都走Leader)
  Follower: Broker2  (同步副本)
  Follower: Broker3  (同步副本)
```

**ISR（In-Sync Replicas）：** 和Leader保持同步的副本集合，只有ISR中的副本才有资格被选为新Leader

```
ISR = {Leader(Broker1), Follower(Broker2), Follower(Broker3)}

如果Broker3同步太慢：
ISR = {Leader(Broker1), Follower(Broker2)}  # Broker3被踢出ISR

如果Broker1宕机：
从ISR中选新Leader -> Broker2成为新Leader
```

---

## 四、RocketMQ 核心原理

### 1. RocketMQ 整体架构

```
[Producer]
    |
[NameServer集群] <- 注册中心（无状态，互不通信）
    |
[Broker集群]
  Master-A <--> Slave-A
  Master-B <--> Slave-B
    |
[Consumer]
```

**和Kafka的关键区别：** Kafka依赖ZooKeeper（新版本用KRaft），RocketMQ依赖NameServer（更轻量）

---

### 2. RocketMQ 特色功能

#### 事务消息

**场景：** 下单时需要同时扣库存，且两边要一致。

```
1. 发送半消息（Half Message）-> Broker暂存，不投递
2. 执行本地事务（扣库存）
3a. 本地事务成功 -> 提交半消息 -> 消费者可见
3b. 本地事务失败 -> 回滚半消息 -> 消费者不可见
4. 如果Producer宕机 -> Broker回查本地事务状态
```

```java
// 发送事务消息
TransactionSendResult result = producer.sendMessageInTransaction(
    new Message("order-topic", JSON.toJSONString(order).getBytes()),
    new LocalTransactionExecuter() {
        @Override
        public LocalTransactionState executeLocalTransactionBranch(Message msg, Object arg) {
            try {
                orderDao.insert(order);
                inventoryDao.deduct(order.getProductId(), order.getQuantity());
                return LocalTransactionState.COMMIT_MESSAGE;
            } catch (Exception e) {
                return LocalTransactionState.ROLLBACK_MESSAGE;
            }
        }
    },
    null
);
```

---

#### 延迟消息

**场景：** 订单30分钟未支付自动取消。

```java
Message msg = new Message("order-cancel-topic",
    JSON.toJSONString(order).getBytes());

// 延迟级别：1s 5s 10s 30s 1m 2m 3m 4m 5m 6m 7m 8m 9m 10m 20m 30m 1h 2h
msg.setDelayTimeLevel(16);  // 30分钟

producer.send(msg);
```

```java
// 消费者在30分钟后收到消息
@Consumer(topic = "order-cancel-topic")
public void onMessage(Order order) {
    if (order.getPayStatus() == UNPAID) {
        orderService.cancel(order.getOrderNo());
    }
}
```

---

#### 顺序消息

**场景：** 订单状态变更：创建 -> 支付 -> 发货 -> 完成，必须有序。

```java
// 发送顺序消息：相同orderId发到同一个Queue
producer.send(msg, new MessageQueueSelector() {
    @Override
    public MessageQueue select(List<MessageQueue> mqs, Message msg, Object orderId) {
        int index = orderId.hashCode() % mqs.size();
        return mqs.get(index);
    }
}, order.getOrderId());

// 顺序消费
consumer.registerMessageListener(new MessageListenerOrderly() {
    @Override
    public ConsumeOrderlyStatus consumeMessage(List<MessageExt> msgs,
                                                ConsumeOrderlyContext context) {
        for (MessageExt msg : msgs) {
            processOrder(msg);
        }
        return ConsumeOrderlyStatus.SUCCESS;
    }
});
```

---

## 五、Kafka vs RocketMQ 怎么选？

| 维度 | Kafka | RocketMQ |
|------|-------|----------|
| **吞吐量** | 极高（百万级） | 高（十万级） |
| **事务消息** | 不原生支持 | 原生支持 |
| **延迟消息** | 不原生支持 | 原生支持 |
| **顺序消息** | Partition级有序 | Queue级有序 |
| **消息过滤** | 不支持 | Tag/SQL过滤 |
| **运维复杂度** | 中（依赖ZK/KRaft） | 中（依赖NameServer） |
| **社区生态** | 全球最活跃 | 国内活跃 |
| **适用场景** | 大数据/日志/流处理 | 业务消息/电商/金融 |

**一句话总结：** 大数据选Kafka，业务消息选RocketMQ

---

## 六、消息可靠性：如何保证消息不丢失？

### 消息丢失的三个环节

```
[Producer] -> 发送阶段 -> [Broker] -> 存储阶段 -> [Consumer] -> 消费阶段
     ^                       ^                        ^
   可能丢                  可能丢                    可能丢
```

---

### 1. 生产端：发送不丢

#### 同步发送 + 确认

```java
// Kafka
props.put("acks", "all");            // 所有ISR副本确认
props.put("retries", 3);             // 重试3次
props.put("retry.backoff.ms", 100);  // 重试间隔100ms

RecordMetadata metadata = producer.send(record).get();
```

**acks参数：**
```
acks=0  -> 不等确认，最快但可能丢
acks=1  -> Leader确认，Leader挂了可能丢
acks=all -> 所有ISR确认，最安全
```

```java
// RocketMQ
SendResult result = producer.send(msg);
if (result.getSendStatus() == SendStatus.SEND_OK) {
    // 发送成功
} else {
    retry(msg);
}
```

#### 本地消息表（最可靠）

```java
@Transactional
public void createOrder(Order order) {
    orderDao.insert(order);

    // 插入本地消息表（同一个事务）
    LocalMessage msg = new LocalMessage();
    msg.setTopic("order-created");
    msg.setBody(JSON.toJSONString(order));
    msg.setStatus("INIT");
    localMessageDao.insert(msg);
}

// 后台线程定时扫描，发送消息
@Scheduled(fixedRate = 1000)
public void sendPendingMessages() {
    List<LocalMessage> messages = localMessageDao.findByStatus("INIT");
    for (LocalMessage msg : messages) {
        try {
            mq.send(msg.getTopic(), msg.getBody());
            msg.setStatus("SENT");
            localMessageDao.update(msg);
        } catch (Exception e) {
            msg.setRetryCount(msg.getRetryCount() + 1);
            localMessageDao.update(msg);
        }
    }
}
```

```sql
CREATE TABLE `local_message` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `topic` VARCHAR(128) NOT NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'INIT',
    `retry_count` INT NOT NULL DEFAULT 0,
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB;
```

---

### 2. Broker端：存储不丢

**Kafka：**
```properties
default.replication.factor=3       # 副本数 >= 2
min.insync.replicas=2              # 最小ISR数
unclean.leader.election.enable=false  # 不允许从非ISR选Leader
```

**RocketMQ：**
```properties
flushDiskType=SYNC_FLUSH    # 同步刷盘（可靠）
brokerRole=SYNC_MASTER      # 同步复制（可靠）
```

| 可靠性要求 | 刷盘 | 复制 |
|-----------|------|------|
| 最高 | 同步刷盘 | 同步复制 |
| 折中 | 异步刷盘 | 同步复制 |
| 高性能 | 异步刷盘 | 异步复制 |

---

### 3. 消费端：消费不丢

**核心：** 关闭自动提交，业务处理成功后手动提交

**Kafka：**
```java
props.put("enable.auto.commit", "false");

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        try {
            processMessage(record);
            consumer.commitSync();  // 手动提交
        } catch (Exception e) {
            // 不提交offset，下次重新消费
        }
    }
}
```

**RocketMQ：**
```java
consumer.registerMessageListener(new MessageListenerConcurrently() {
    @Override
    public ConsumeConcurrentlyStatus consumeMessage(List<MessageExt> msgs,
                                                     ConsumeConcurrentlyContext context) {
        try {
            for (MessageExt msg : msgs) {
                processMessage(msg);
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        } catch (Exception e) {
            return ConsumeConcurrentlyStatus.RECONSUME_LATER;  // 稍后重试
        }
    }
});
```

---

### 完整的消息不丢方案总结

```
生产端：
  1. 同步发送 + acks=all（Kafka）
  2. 发送失败重试
  3. 极端场景用本地消息表

Broker端：
  4. 多副本
  5. 同步刷盘（或至少异步刷盘 + 同步复制）

消费端：
  6. 关闭自动提交
  7. 业务处理成功后手动提交
  8. 消费失败重试（死信队列兜底）
```

---

## 七、消息重复：如何做幂等？

### 为什么会有重复消息？

| 场景 | 原因 |
|------|------|
| 生产者重试 | 发送成功但ACK超时，Producer重试 |
| 消费者重试 | 处理成功但提交offset失败 |
| Rebalance | Consumer Group重新分配，可能重复消费 |

**结论：** 消息重复几乎不可避免，核心是做幂等

---

### 幂等性设计

#### 方案1：唯一ID + 去重表（最通用）

```sql
CREATE TABLE `message_dedup` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `msg_id` VARCHAR(128) NOT NULL COMMENT '消息唯一ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_msg_id` (`msg_id`)
) ENGINE=InnoDB;
```

```java
@Transactional
public void onMessage(Message msg) {
    String msgId = msg.getMsgId();

    try {
        messageDedupDao.insert(msgId);
    } catch (DuplicateKeyException e) {
        log.warn("消息已处理: {}", msgId);
        return;
    }

    orderService.createOrder(msg);  // 和去重插入在同一事务
}
```

---

#### 方案2：业务状态判断

```java
public void deductStock(Long productId, int quantity) {
    Order order = orderDao.getByProductId(productId);

    if (order.getStatus() == OrderStatus.PAID) {
        log.warn("订单已支付，跳过");
        return;
    }

    int affected = inventoryDao.deduct(productId, quantity, order.getVersion());
    if (affected == 0) {
        log.warn("并发冲突，跳过");
    }
}
```

---

#### 方案3：Redis Set去重

```java
@Consumer(topic = "order-created")
public void onMessage(Message msg) {
    String msgId = msg.getMsgId();

    Boolean isNew = redis.setnx("msg:dedup:" + msgId, "1");
    redis.expire("msg:dedup:" + msgId, 86400);

    if (!isNew) {
        return;
    }

    processOrder(msg);
}
```

**风险：** Redis和DB不在同一事务，Redis宕机可能丢去重记录

---

#### 方案4：数据库唯一约束

```java
public void createOrder(Order order) {
    try {
        orderDao.insert(order);  // 订单号唯一约束
    } catch (DuplicateKeyException e) {
        log.warn("订单已存在: {}", order.getOrderNo());
    }
}
```

---

### 幂等方案对比

| 方案 | 可靠性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|----------|
| 唯一ID+去重表 | 最高 | 中 | 中 | 通用 |
| 业务状态判断 | 高 | 高 | 低 | 有明确状态的业务 |
| Redis去重 | 中 | 最高 | 低 | 允许极小概率重复 |
| 数据库唯一约束 | 最高 | 中 | 低 | 有唯一业务键 |

---

## 八、消息顺序性

### 为什么会乱序？

多Partition并行消费时，不同Partition的消费速度不同，可能导致消息乱序。

---

### 解决方案

#### 方案1：单Partition（全局有序）

```bash
kafka-topics.sh --create --topic order-topic --partitions 1
```

**缺点：** 吞吐量受限，只能一个消费者

---

#### 方案2：按Key分区（局部有序，推荐）

相同业务Key的消息发到同一个Partition：

```java
producer.send(new ProducerRecord<>(
    "order-topic",
    order.getOrderId(),     // 用orderId做Key
    JSON.toJSONString(order)
));
```

```
orderId=1001 -> hash(1001) % 3 = Partition1 -> [创建, 支付, 发货] 按顺序
orderId=1002 -> hash(1002) % 3 = Partition0 -> [创建, 支付, 发货] 按顺序
```

**效果：** 同一订单内有序，不同订单间并行，吞吐量高

---

#### 方案3：消费端排序

```java
@Consumer
public void onMessage(OrderMessage msg) {
    int lastSeq = getLastSequence(msg.getOrderId());

    if (msg.getSequence() <= lastSeq) {
        return;  // 已处理
    }

    if (msg.getSequence() > lastSeq + 1) {
        throw new RetryLaterException();  // 乱序，放回队列
    }

    processOrder(msg);
    updateLastSequence(msg.getOrderId(), msg.getSequence());
}
```

---

## 九、消息积压怎么处理？

### 积压的常见原因

| 原因 | 表现 |
|------|------|
| 消费者处理慢 | 慢SQL、接口超时、Bug导致重试 |
| 消费者挂了 | 宕机、重启来不及消费 |
| 流量突增 | 活动期间流量暴涨 |
| 消费者数量不足 | Partition多但消费者少 |

---

### 紧急方案

#### 方案1：增加消费者实例

```
原本：2个消费者 <- 8个Partition
现在：8个消费者 <- 8个Partition
消费速度翻4倍
```

**注意：** 消费者数量不能超过Partition数量

---

#### 方案2：消费者内部线程池

```java
ExecutorService executor = Executors.newFixedThreadPool(20);

@Consumer
public void onMessage(List<MessageExt> msgs) {
    List<Future<?>> futures = new ArrayList<>();
    for (MessageExt msg : msgs) {
        futures.add(executor.submit(() -> processMessage(msg)));
    }
    for (Future<?> future : futures) {
        future.get(30, TimeUnit.SECONDS);
    }
}
```

**注意：** 对顺序有要求不能用多线程，需要保证幂等

---

#### 方案3：跳过非核心消息（降级）

```java
@Consumer
public void onMessage(Message msg) {
    if (emergencyMode && !isCriticalMessage(msg)) {
        return;  // 紧急模式跳过非核心
    }
    processMessage(msg);
}
```

---

#### 方案4：临时队列转储

```
1. 新建临时Topic（Partition多）
2. 简单消费者把积压消息搬到临时Topic
3. 部署大量消费者消费临时Topic
4. 积压清零后恢复正常
```

```java
// 转储：只搬运不处理
@Consumer(topic = "order-topic")
public void transferMessage(Message msg) {
    producer.send(new Message("order-topic-temp", msg.getBody()));
}

// 大量消费者消费临时Topic
@Consumer(topic = "order-topic-temp", concurrency = 50)
public void processMessage(Message msg) {
    orderService.process(msg);
}
```

---

### 预防方案

| 措施 | 做法 |
|------|------|
| 监控告警 | Consumer Lag > 10000 时告警 |
| 合理Partition数 | 预估QPS / 单消费者处理能力，留余量 |
| 消费端优化 | 批量处理、异步化、减少IO |

---

## 十、死信队列

### 什么是死信队列？

消费失败达到最大重试次数后，消息进入死信队列（Dead Letter Queue）。

```
消费失败 -> 重试1s -> 重试5s -> 重试30s -> ... -> 重试2h -> 还是失败 -> 死信队列
```

### RocketMQ 死信队列

```java
// 最大重试次数
consumer.setMaxReconsumeTimes(16);

// 死信Topic命名：%DLQ% + 消费者组名
// 原始Topic: order-topic, 消费者组: order-group
// 死信Topic: %DLQ%order-group

@Consumer(topic = "%DLQ%order-group")
public void onDeadLetter(Message msg) {
    log.error("死信消息: {}", msg);
    alertService.notifyAdmin("死信消息", msg);
    deadLetterDao.insert(msg);
}
```

### Kafka 死信队列

Kafka没有原生死信队列，需要自己实现：

```java
@Consumer(topic = "order-topic")
public void onMessage(ConsumerRecord<String, String> record) {
    int retryCount = getRetryCount(record);
    try {
        processMessage(record);
    } catch (Exception e) {
        if (retryCount >= MAX_RETRY) {
            producer.send(new ProducerRecord<>("order-topic-dlq",
                record.key(), record.value()));
        } else {
            producer.send(new ProducerRecord<>("order-topic-retry",
                record.key(), addRetryHeader(record.value(), retryCount + 1)));
        }
    }
}
```

---

## 十一、消息队列在秒杀系统中的实战

### 完整秒杀流程

```
[前端]
  | 秒杀请求
[Nginx] <- 限流（10万QPS -> 放过1万）
  |
[API网关] <- 鉴权、限流
  |
[秒杀服务]
  | 1. Redis预扣库存（Lua脚本原子性）
  | 2. 库存不足 -> 直接返回"已抢完"
  | 3. 库存充足 -> 发送消息到MQ
  | 4. 立即返回"排队中"
  |
[消息队列] <- 削峰缓冲
  |
[订单服务] <- 消费消息
  | 1. 创建订单
  | 2. 扣减DB库存（乐观锁）
  | 3. 更新订单状态
  |
[用户轮询/WebSocket查结果]
```

---

### 秒杀接口代码

```java
@PostMapping("/seckill")
@RateLimiter(qps = 10000)
public Result seckill(@RequestBody SeckillRequest request) {
    Long userId = request.getUserId();
    Long activityId = request.getActivityId();

    // 1. 防重复
    String dedupKey = "seckill:dedup:" + activityId + ":" + userId;
    if (!redis.setnx(dedupKey, "1", 3600)) {
        return Result.fail("不能重复秒杀");
    }

    // 2. Redis预扣库存
    String script =
        "local stock = redis.call('get', KEYS[1]); " +
        "if tonumber(stock) > 0 then " +
        "    redis.call('decr', KEYS[1]); " +
        "    return 1; " +
        "else return 0; end";

    Long result = redis.eval(script,
        Collections.singletonList("seckill:stock:" + activityId));

    if (result == 0) {
        redis.del(dedupKey);
        return Result.fail("已抢完");
    }

    // 3. 发送消息到MQ
    SeckillMessage msg = new SeckillMessage(userId, activityId);
    mq.send("seckill-topic", JSON.toJSONString(msg));

    return Result.success("排队中，请稍后查询结果");
}
```

---

### 订单消费者代码

```java
@Consumer(topic = "seckill-topic")
public void onSeckillMessage(SeckillMessage msg) {
    try {
        // 1. 幂等检查
        if (orderDao.existsByUserAndActivity(msg.getUserId(), msg.getActivityId())) {
            return;
        }

        // 2. 扣减DB库存（乐观锁）
        int affected = activityDao.deductStock(msg.getActivityId());
        if (affected == 0) {
            notifyUser(msg.getUserId(), "秒杀失败");
            return;
        }

        // 3. 创建订单
        Order order = new Order();
        order.setOrderNo(generateOrderNo());
        order.setUserId(msg.getUserId());
        order.setActivityId(msg.getActivityId());
        order.setStatus(OrderStatus.CREATED);
        orderDao.insert(order);

        notifyUser(msg.getUserId(), "秒杀成功，订单号：" + order.getOrderNo());

        // 4. 发送延迟消息（30分钟未支付自动取消）
        Message cancelMsg = new Message("order-cancel-topic",
            JSON.toJSONString(order).getBytes());
        cancelMsg.setDelayTimeLevel(16);
        producer.send(cancelMsg);

    } catch (Exception e) {
        throw e;  // 抛异常让MQ重试
    }
}
```

---

### 超时取消消费者

```java
@Consumer(topic = "order-cancel-topic")
public void onOrderCancel(Order order) {
    Order current = orderDao.getByOrderNo(order.getOrderNo());

    if (current.getStatus() == OrderStatus.CREATED) {
        orderDao.updateStatus(order.getOrderNo(), OrderStatus.CANCELLED);
        activityDao.increaseStock(order.getActivityId());
        redis.incr("seckill:stock:" + order.getActivityId());
    }
}
```

---

## 十二、面试高频题

### 1. 消息队列有什么用？

> 三大核心作用：**异步处理**（提升响应速度）、**流量削峰**（缓冲高峰流量）、**系统解耦**（降低依赖）

---

### 2. Kafka 和 RocketMQ 怎么选？

> 大数据/日志/流处理选Kafka，业务消息/电商/金融选RocketMQ。需要事务消息和延迟消息选RocketMQ，超高吞吐量选Kafka。

---

### 3. 如何保证消息不丢失？

> 三个环节：**生产端**同步发送+acks=all+重试+本地消息表；**Broker端**多副本+同步刷盘/同步复制；**消费端**关闭自动提交+业务处理成功后手动提交。

---

### 4. 消息重复了怎么办？

> 消息重复不可避免，核心是做幂等：唯一ID+去重表（最通用）、业务状态判断、数据库唯一约束、Redis去重。

---

### 5. 如何保证消息顺序？

> **全局有序**：单Partition，性能差；**局部有序**（推荐）：相同Key发到同一Partition，同一订单内有序，不同订单间并行。

---

### 6. 消息积压了怎么办？

> 紧急：增加消费者数量、消费者内部多线程、降级跳过非核心消息、临时队列转储。预防：监控Consumer Lag、合理设置Partition数量、消费端性能优化。

---

### 7. 事务消息的原理？

> 1.发送半消息（暂不投递）-> 2.执行本地事务 -> 3a.成功则提交半消息 / 3b.失败则回滚 -> 4.Producer宕机则Broker定时回查本地事务状态

---

### 8. Kafka 为什么吞吐量高？

> 四个原因：**顺序写磁盘**（比随机写快5-10倍）、**零拷贝**（减少数据拷贝和上下文切换）、**批量+压缩**（减少网络传输）、**Partition并行**（多路并行读写）

---

### 9. Kafka 的 ISR 机制是什么？

> ISR = In-Sync Replicas，与Leader保持同步的副本集合。副本落后太多被踢出ISR，Leader宕机只从ISR中选新Leader，unclean.leader.election.enable=false保证数据不丢。

---

### 10. 死信队列是什么？什么时候用？

> 消费失败达到最大重试次数后，消息进入死信队列。用于人工排查消费失败原因、后续补偿处理、避免失败消息阻塞正常消费。

---

## 十三、核心结论

1. **消息队列三大作用：异步、削峰、解耦**
2. **大数据选Kafka，业务消息选RocketMQ**
3. **消息不丢：生产端确认 + Broker持久化+多副本 + 消费端手动提交**
4. **消息重复不可避免，核心是做幂等**
5. **消息顺序：相同Key发到同一Partition**
6. **消息积压紧急处理：加消费者 + 多线程 + 降级**
7. **事务消息：半消息 + 本地事务 + 回查**
8. **死信队列是消费失败的兜底方案**

---

## 十四、练习题

### 练习1：方案设计

设计一个订单系统的消息方案：
- 下单后需要：扣库存、发短信、发邮件、加积分
- 要求：下单接口 < 200ms
- 要求：消息不能丢

要求：画出架构图，说明哪些是同步/异步，说明消息不丢的保证

---

### 练习2：幂等设计

场景：消费者收到"扣减库存"消息，可能重复收到。商品ID: 1001，扣减数量: 1

要求：设计幂等方案，写出消费代码，说明能覆盖哪些重复场景

---

### 练习3：积压处理

场景：Topic有8个Partition，当前2个消费者，积压100万条消息，每条处理需要50ms

要求：估算消费完需要多长时间，制定紧急处理方案和预防方案

---

### 练习4：思考题

为什么不建议用消息队列来实现"查询用户余额"这个功能？
