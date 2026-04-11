# 第3讲：消息队列（Kafka/RocketMQ）

## 核心结论（5条必记）

1. **消息队列的三大作用** -- 异步处理提升响应速度，削峰填谷应对峰值流量，解耦服务降低依赖
2. **消息可靠性是核心** -- 生产端Confirm、Broker持久化、消费端ACK，三层保障确保不丢消息
3. **幂等性是重试的前提** -- 没有幂等的重试会导致重复消费，通过唯一ID或状态机保证幂等
4. **消息有序需要权衡** -- 全局有序牺牲性能，分区有序是折中，按业务场景选择
5. **消息积压要及时处理** -- 监控消费延迟，积压时增加消费者或优化消费逻辑

---

## 一、为什么需要消息队列

### 异步处理

**场景：** 用户注册后发送欢迎邮件

**同步方式：**
```
用户注册
  -> 写入用户表（50ms）
  -> 发送邮件（500ms）
  -> 发送短信（200ms）
  -> 初始化数据（100ms）
总耗时：850ms
```

**异步方式：**
```
用户注册
  -> 写入用户表（50ms）
  -> 发送MQ消息（5ms）
总耗时：55ms

消费者异步：
  -> 发送邮件
  -> 发送短信
  -> 初始化数据
```

### 削峰填谷

**场景：** 秒杀活动

**问题：**
```
峰值流量：10万QPS
系统容量：1万QPS
```

**方案：**
```
请求 -> MQ（缓冲）
  -> 系统按能力消费（1万QPS）
  -> 削峰：峰值流量进入队列
  -> 填谷：系统按能力平滑处理
```

### 解耦

**场景：** 订单系统调用库存、支付、物流

**耦合问题：**
```
订单系统 -> 库存系统（强依赖）
          -> 支付系统（强依赖）
          -> 物流系统（强依赖）

库存系统故障 -> 订单系统受影响
```

**解耦方案：**
```
订单系统 -> MQ
          -> 库存系统（独立）
          -> 支付系统（独立）
          -> 物流系统（独立）

库存系统故障 -> 不影响订单创建
           -> 消息堆积，恢复后处理
```

---

## 二、消息队列选型

### 主流MQ对比

| MQ | 优点 | 缺点 | 适用场景 |
|----|------|------|----------|
| RabbitMQ | 功能完善、可靠性高 | 吞吐量低（1-2万） | 任务队列、复杂路由 |
| RocketMQ | 高吞吐（10万）、事务消息 | 运维复杂 | 电商、金融 |
| Kafka | 极高吞吐（百万级）、持久化 | 实时性稍差、不支持事务消息 | 日志收集、大数据 |
| ActiveMQ | 简单、JMS规范 | 性能一般（5千） | 传统应用 |

### RocketMQ核心概念

**核心组件：**
```
NameServer：注册中心，Broker注册到NameServer
Broker：消息存储，接收Producer消息，提供Consumer消费
Producer：消息生产者
Consumer：消息消费者
Topic：消息主题，一类消息的集合
Queue：消息队列，Topic的分片
```

**消息模型：**
```
Producer -> Topic（订单）
           -> Queue1（Broker1）
           -> Queue2（Broker2）
           -> Queue3（Broker3）

Consumer Group：消费者组
  -> 多个Consumer组成一个组
  -> 订阅同一个Topic
  -> 消息负载均衡消费
```

---

## 三、消息可靠性保证

### 不丢消息

**生产端：**
```
1. 发送前：消息持久化（本地表）
   CREATE TABLE `mq_message` (
     `id` bigint NOT NULL,
     `topic` varchar(255),
     `body` text,
     `status` tinyint, -- 0待发送 1已发送 2发送失败
     `create_time` datetime
   );

2. 发送时：Confirm机制
   -> Broker收到消息后返回确认
   -> 生产端更新消息状态

3. 发送后：Return机制
   -> 消息无法路由时返回
   -> 生产端记录失败

4. 补偿：定时任务
   -> 扫描status=0的消息
   -> 重新发送
```

**Broker端：**
```
1. 消息持久化
   -> 写入CommitLog（追加写，性能好）
   -> 异步刷盘（可配同步刷盘）

2. 主从复制
   -> Master同步到Slave
   -> Slave提供读服务

3. 多副本存储
   -> 同步复制：强一致但性能差
   -> 异步复制：性能好但可能丢数据
```

**消费端：**
```
1. 手动ACK
   -> 消费成功后确认
   -> 消费失败不确认

2. 业务成功后才ACK
   -> 先处理业务
   -> 业务成功再ACK

3. 失败重试
   -> 有限次数重试（如3次）
   -> 超过次数进入死信队列
```

### 代码示例

**生产端：**
```java
@Service
public class OrderProducer {

    @Autowired
    private RocketMQTemplate rocketMQTemplate;

    @Autowired
    private MqMessageMapper mqMessageMapper;

    public void sendOrderMessage(Order order) {
        // 1. 持久化到本地
        MqMessage message = new MqMessage();
        message.setTopic("order-created");
        message.setBody(JSON.toJSONString(order));
        message.setStatus(0);
        mqMessageMapper.insert(message);

        try {
            // 2. 发送到MQ
            SendResult sendResult = rocketMQTemplate.syncSend(
                "order-created",
                order
            );

            // 3. 更新状态
            if (sendResult.getSendStatus() == SendStatus.SEND_OK) {
                message.setStatus(1);
                mqMessageMapper.updateById(message);
            }
        } catch (Exception e) {
            // 4. 记录失败，等待定时任务重试
            message.setStatus(2);
            mqMessageMapper.updateById(message);
        }
    }
}
```

**消费端：**
```java
@Service
@RocketMQMessageListener(
    topic = "order-created",
    consumerGroup = "order-consumer-group"
)
public class OrderConsumer implements RocketMQListener<Order> {

    @Autowired
    private OrderService orderService;

    @Override
    public void onMessage(Order order) {
        try {
            // 处理业务
            orderService.handleOrder(order);

            // 业务成功，ACK自动确认
        } catch (Exception e) {
            // 业务失败，重试
            throw new RuntimeException("处理失败，重试");
        }
    }
}
```

---

## 四、幂等性设计

### 为什么需要幂等

**场景：**
```
Consumer消费消息
  -> 处理业务（创建订单）
  -> ACK前宕机
  -> 消息重新投递
  -> 重复创建订单
```

### 幂等方案

**方案1：唯一ID**
```java
@Service
public class OrderService {

    @Autowired
    private RedisTemplate redisTemplate;

    public void createOrder(Order order) {
        String messageId = order.getMessageId();

        // 检查是否已处理
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent("order:" + messageId, "1", 24, TimeUnit.HOURS);

        if (Boolean.FALSE.equals(success)) {
            // 已处理，直接返回
            return;
        }

        // 创建订单
        doCreateOrder(order);
    }
}
```

**方案2：数据库唯一索引**
```sql
CREATE TABLE `order` (
  `id` bigint NOT NULL,
  `message_id` varchar(255) NOT NULL,
  `user_id` bigint,
  `amount` decimal,
  `create_time` datetime,
  UNIQUE KEY `uk_message_id` (`message_id`)
);
```

**方案3：状态机**
```
订单状态：
  待支付 -> 已支付 -> 已发货 -> 已完成

只有"待支付"才能创建
重复创建时状态不对，拒绝
```

---

## 五、消息有序

### 为什么需要有序

**场景：**
```
订单消息：
  创建 -> 支付 -> 发货

如果乱序：
  创建 -> 发货 -> 支付（不合理）
```

### 有序方案

**方案1：单分区单消费者**
```
Topic只有一个分区
  -> 一个消费者
  -> 有序但吞吐量低
```

**方案2：分区有序**
```
Topic有多个分区
  -> 相同订单ID的消息发到同一分区
  -> 分区内有序
  -> 不同分区无序

实现：
  -> 发送时指定分区键（如orderId）
  -> Hash(orderId) % 分区数 = 分区编号
```

**RocketMQ示例：**
```java
SendResult sendResult = rocketMQTemplate.syncSend(
    "order-topic",
    MessageBuilder
        .withPayload(order)
        .setHeader(MessageConst.PROPERTY_KEYS, orderId.toString()) // 分区键
        .build()
);
```

---

## 六、消息积压处理

### 积压原因

**生产速度 > 消费速度**
```
生产端：1万QPS
消费端：5千QPS
-> 每秒积压5千条
```

**排查：**
```
1. 消费逻辑慢（性能瓶颈）
2. 消费者数量不足
3. 数据库/Redis慢（依赖瓶颈）
4. 消费者异常（频繁重试）
```

### 解决方案

**方案1：增加消费者**
```
消费者扩容（横向）
  -> 注意：消费者数 <= 分区数
  -> 分区数不足先扩分区
```

**方案2：优化消费逻辑**
```
1. 批量处理：一次处理多条消息
2. 异步处理：非核心逻辑异步
3. 并发处理：多线程处理
```

**方案3：临时扩容**
```
1. 增加消费者（紧急）
2. 跳过非核心消息
3. 降低消费逻辑复杂度
```

**监控告警：**
```
监控指标：
  -> 消息堆积量（消费延迟）
  -> 消费TPS
  -> 消费失败率

告警阈值：
  -> 堆积量 > 10万
  -> 消费延迟 > 5分钟
```

---

## 七、面试高频题

### 1. 消息队列的三大作用是什么？
异步处理：提升响应速度 -> 削峰填谷：应对峰值流量 -> 解耦：降低服务依赖 -> 三者结合让系统更灵活

### 2. 怎么保证消息不丢失？
生产端：消息持久化 + Confirm机制 -> Broker端：消息持久化 + 主从复制 -> 消费端：手动ACK + 业务成功才ACK -> 三层保障

### 3. 怎么保证消息幂等？
唯一请求ID -> 处理前检查是否已处理 -> 数据库唯一索引 -> 状态机控制状态流转 -> 幂等是重试的前提

### 4. 怎么保证消息有序？
单分区单消费者：有序但吞吐低 -> 分区有序：相同业务发到同一分区 -> 发送时指定分区键（如orderId） -> 分区内有序，全局可能无序

### 5. 消息积压怎么处理？
原因：生产速度 > 消费速度 -> 解决：增加消费者、优化消费逻辑、临时扩容 -> 监控：堆积量、消费延迟、失败率

---

## 练习题

- [ ] 练习1：本地搭建RocketMQ
- [ ] 练习2：实现不丢消息的生产者
- [ ] 练习3：实现幂等的消费者
- [ ] 练习4：实现分区有序发送
- [ ] 练习5：模拟消息积压并处理

---

## 下讲预告

第4讲将学习分库分表：拆分策略、分片键选择、分布式事务、数据迁移等核心内容。
