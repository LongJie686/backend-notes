# Hadoop 大数据平台

## 核心组件

| 组件 | 职责 |
|------|------|
| **HDFS** | 分布式文件存储，提供高吞吐量的数据访问 |
| **MapReduce** | 分布式计算框架，将任务拆分为 Map 和 Reduce 阶段 |
| **YARN** | 资源管理和任务调度，协调集群计算资源 |

## HDFS 架构

```
NameNode（主节点）
  ├── 管理文件系统命名空间和元数据
  ├── 维护数据块到 DataNode 的映射
  └── 单点故障 → 配置 SecondaryNameNode 或 HA 方案

DataNode（从节点）
  ├── 存储实际数据块（默认 128MB/块）
  └── 3 副本机制：同一节点 → 同机架不同节点 → 不同机架节点

读写流程：Client → NameNode（获取块位置）→ DataNode（读/写数据）
```

## Hive 数仓

基于 HDFS 的 SQL 查询引擎，将 HQL 转换为 MapReduce/Tez/Spark 任务执行。

```sql
-- 建库建表
CREATE DATABASE IF NOT EXISTS analytics;
USE analytics;

CREATE TABLE IF NOT EXISTS user_log (
    user_id    BIGINT,
    action     STRING,
    item_id    BIGINT,
    ts         TIMESTAMP
)
PARTITIONED BY (dt STRING)              -- 按日期分区
CLUSTERED BY (user_id) INTO 32 BUCKETS  -- 按 user_id 分桶
STORED AS ORC                           -- 列式存储
;

-- 分区查询（分区裁剪，只扫描目标分区）
SELECT action, COUNT(*) AS cnt
FROM user_log
WHERE dt = '2026-04-09'
GROUP BY action
;

-- 分桶采样
SELECT * FROM user_log TABLESAMPLE(BUCKET 1 OUT OF 32 ON user_id);
```

**Hive vs MySQL 对比**：

| 维度 | Hive | MySQL |
|------|------|-------|
| 数据规模 | PB 级 | TB 级 |
| 查询延迟 | 分钟级 | 毫秒级 |
| 适用场景 | 离线批处理分析 | 在线事务处理 |
| 数据更新 | 批量追加，不支持行级更新 | 支持增删改查 |

## Zookeeper

分布式协调服务，为 Hadoop 生态组件提供一致性保障。

| 功能 | 说明 |
|------|------|
| **配置管理** | 集中存储集群配置，变更实时通知 |
| **Leader 选举** | 保证集群中只有一个主节点活跃 |
| **分布式锁** | 通过临时有序节点实现互斥访问 |
| **命名服务** | 为分布式节点提供统一命名 |

```
# 典型应用
HDFS HA → NameNode 主备切换依赖 Zookeeper 选举
Kafka   → Broker 注册、Consumer Group 协调
HBase   → Master 选举、Region 状态管理
```
