# Flume 日志采集

## 核心架构

Flume 基于 **Agent** 运行，每个 Agent 由三部分组成：

```
Source → Channel → Sink

Source  ：接收数据（从文件、网络、Syslog 等）
Channel ：暂存数据（内存 / 文件 / JDBC），缓冲 Source 和 Sink 的速度差
Sink    ：发送数据（到 HDFS、Kafka、HBase 等）
```

支持多个 Agent 串联：`Agent1.Sink → Agent2.Source → Agent2.Channel → Agent2.Sink`

## 常用 Source / Channel / Sink

| 类型 | 组件 | 说明 |
|------|------|------|
| Source | **exec** | 监听命令输出，如 `tail -F /var/log/app.log` |
| Source | **avro** | 接收 Avro RPC 数据，用于 Agent 串联 |
| Source | **kafka** | 从 Kafka Topic 消费数据 |
| Channel | **memory** | 内存通道，速度快但 Agent 崩溃会丢数据 |
| Channel | **file** | 文件通道，持久化存储，可靠性高 |
| Sink | **hdfs** | 写入 HDFS，支持按时间/大小切分文件 |
| Sink | **kafka** | 发送到 Kafka Topic |
| Sink | **avro** | 通过 Avro RPC 发送到下游 Agent |

## 与 Kafka 集成

典型架构：`应用日志 → Flume → Kafka → Flink/Spark Streaming → 存储`

```properties
# flume-kafka.conf：采集日志文件发送到 Kafka

# 定义 Agent
agent.sources = src1
agent.channels = ch1
agent.sinks = sk1

# Source: 监听日志文件
agent.sources.src1.type = exec
agent.sources.src1.command = tail -F /var/log/app.log

# Channel: 内存缓冲
agent.channels.ch1.type = memory
agent.channels.ch1.capacity = 10000
agent.channels.ch1.transactionCapacity = 1000

# Sink: 发送到 Kafka
agent.sinks.sk1.type = org.apache.flume.sink.kafka.KafkaSink
agent.sinks.sk1.kafka.topic = app-logs
agent.sinks.sk1.kafka.bootstrap.servers = kafka1:9092,kafka2:9092,kafka3:9092
agent.sinks.sk1.kafka.producer.acks = all

# 绑定
agent.sources.src1.channels = ch1
agent.sinks.sk1.channel = ch1
```

**启动命令**：

```bash
flume-ng agent \
  --conf conf \
  --conf-file flume-kafka.conf \
  --name agent \
  -Dflume.root.logger=INFO,console
```

## 配置要点

- **Channel 容量**：根据峰值流量设置 `capacity`，过小会丢数据，过大占内存
- **文件通道**：对可靠性要求高的场景使用 `file channel`，防止 Agent 崩溃数据丢失
- **Source 批次**：`batchSize` 控制每次提交的事件数，影响吞吐和延迟
- **Sink 重试**：配置重试策略，Kafka 不可用时自动重连
