# Spark 分布式计算

## 核心概念

Spark 是基于内存的分布式计算框架，比 MapReduce 快 10-100 倍。

| 对比项 | Spark | MapReduce |
|--------|-------|-----------|
| 计算模式 | 内存计算，迭代快 | 磁盘中间结果，迭代慢 |
| 编程模型 | RDD/DataFrame/SQL | Map + Reduce 两阶段 |
| 延迟 | 低（毫秒~秒级） | 高（分钟级） |
| 适用场景 | 迭代计算、机器学习、实时处理 | 批量离线处理 |

## 核心组件

| 组件 | 功能 |
|------|------|
| Spark Core | RDD 底层抽象，任务调度 |
| Spark SQL | 结构化数据处理，兼容 Hive |
| Spark Streaming | 实时流处理（微批模式） |
| MLlib | 机器学习算法库 |
| GraphX | 图计算 |

## RDD 与 DataFrame

```python
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("example") \
    .master("local[*]") \
    .getOrCreate()

# DataFrame 方式（推荐）
df = spark.read.parquet("hdfs://path/data.parquet")
df.filter(df["age"] > 20) \
  .groupBy("city") \
  .count() \
  .show()

# Spark SQL
df.createOrReplaceTempView("users")
spark.sql("SELECT city, COUNT(*) FROM users WHERE age > 20 GROUP BY city").show()
```

## 运行模式

| 模式 | 说明 |
|------|------|
| local | 本地单机调试 |
| standalone | Spark 自带集群 |
| YARN | 运行在 Hadoop YARN 上 |
| K8s | Kubernetes 部署 |

## 常用算子

| 类型 | 算子 | 说明 |
|------|------|------|
| 转换 | map、filter、flatMap | 懒执行，不触发计算 |
| 转换 | groupByKey、reduceByKey | 分组聚合 |
| 转换 | join、union | 多数据集操作 |
| 行动 | collect、count、show | 触发实际计算 |
| 行动 | saveAsTextFile、write | 输出结果 |

## 常见坑点

- **shuffle 开销大**：groupByKey 会全量 shuffle，优先用 reduceByKey
- **数据倾斜**：某 key 数据量远超其他，导致部分 Task 极慢
- **内存溢出**：数据量超内存时调大 executor-memory 或增加分区数
- **collect 风险**：大数据集 collect() 会把所有数据拉到 Driver，容易 OOM
