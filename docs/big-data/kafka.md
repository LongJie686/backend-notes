# Kafka 消息队列

## 核心概念

| 概念 | 说明 |
|------|------|
| **Topic** | 消息分类，逻辑上的消息队列 |
| **Partition** | Topic 的物理分片，有序且不可变日志，并行度由分区数决定 |
| **Consumer Group** | 消费者组，组内消费者各消费不同分区，实现负载均衡 |
| **Broker** | Kafka 服务节点，一个集群由多个 Broker 组成 |
| **Offset** | 消息在分区中的唯一偏移量，消费者通过 Offset 标记消费位置 |

```
Topic: user-events (3 partitions)
  Partition 0: [msg0] [msg1] [msg2] ...  → Consumer A
  Partition 1: [msg0] [msg1] [msg2] ...  → Consumer B
  Partition 2: [msg0] [msg1] [msg2] ...  → Consumer C
```

## 消息可靠性保证

**三层保障：生产端不丢、Broker 不丢、消费端不丢不重。**

| 环节 | 策略 | 说明 |
|------|------|------|
| 生产端 | `acks=all` | 等待所有 ISR 副本确认后才返回成功 |
| Broker | 副本机制 | `replication.factor=3`，`min.insync.replicas=2` |
| 消费端 | 手动提交 Offset | `enable.auto.commit=false`，处理完成后手动 ack |
| 消费端 | 幂等消费 | 业务层去重（唯一键 / 数据库唯一约束） |

```python
from kafka import KafkaProducer, KafkaConsumer
import json

# 生产者
producer = KafkaProducer(
    bootstrap_servers=["localhost:9092"],
    acks="all",                          # 等待所有副本确认
    retries=3,                           # 发送失败重试
    value_serializer=lambda v: json.dumps(v).encode(),
)

producer.send("user-events", {"user_id": 1, "action": "click"})
producer.flush()

# 消费者
consumer = KafkaConsumer(
    "user-events",
    bootstrap_servers=["localhost:9092"],
    group_id="analytics-service",
    enable_auto_commit=False,            # 手动提交 Offset
    auto_offset_reset="earliest",
    value_deserializer=lambda m: json.loads(m.decode()),
)

for msg in consumer:
    process(msg.value)                   # 处理消息
    consumer.commit()                    # 处理成功后手动提交
```

## 消息积压处理

1. **紧急扩容**：增加 Consumer 实例数量（不超过 Partition 数）
2. **增加分区**：长期方案，提高并行度
3. **临时消费者**：新建 Consumer Group 消费积压数据转储到其他存储
4. **根因排查**：消费端处理慢（慢查询 / 外部服务超时）或生产端突增

## Kafka vs RabbitMQ vs RocketMQ

| 维度 | Kafka | RabbitMQ | RocketMQ |
|------|-------|----------|----------|
| 定位 | 高吞吐日志/事件流 | 通用消息队列 | 金融级消息队列 |
| 吞吐量 | 百万级/s | 万级/s | 十万级/s |
| 延迟 | ms 级 | us 级 | ms 级 |
| 消息可靠性 | 高（副本） | 高（确认机制） | 极高（双写） |
| 消息顺序 | 分区内有序 | 队列有序 | 队列有序 |
| 适用场景 | 日志采集、流处理 | 业务解耦、RPC | 交易、订单 |
