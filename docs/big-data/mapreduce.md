# MapReduce 分布式计算

## 核心思想

MapReduce 将大规模数据处理分解为两个阶段：Map（映射）和 Reduce（归约），自动实现分布式并行计算。

```
输入数据 -> Map（分片处理） -> Shuffle（排序分组） -> Reduce（聚合输出） -> 结果
```

## 工作流程

```
1. Input Split：输入文件按 Block（128MB）切分为多个 Split
2. Map：每个 Split 分配一个 Map Task，输出 <key, value> 中间结果
3. Shuffle：按 Key 排序、分组、分区，传输到对应 Reducer
4. Reduce：对同一 Key 的 Value 列表做聚合
5. Output：结果写入 HDFS
```

## 经典示例：WordCount

```python
# Map 阶段
def mapper(line):
    for word in line.split():
        yield (word, 1)

# Reduce 阶段
def reducer(word, counts):
    yield (word, sum(counts))
```

## 适用场景

| 场景 | 说明 |
|------|------|
| 日志分析 | 统计 PV/UV、错误率 |
| 倒排索引 | 搜索引擎构建索引 |
| 数据去重 | 大规模数据集去重 |
| 排序 | TB 级数据全局排序 |
| Join 操作 | 大表关联 |

## 局限性

- **磁盘 IO 重**：每个阶段中间结果都写磁盘，迭代计算性能差
- **编程模型受限**：只有 Map 和 Reduce 两个阶段，复杂逻辑实现困难
- **延迟高**：Job 启动开销大，不适合实时处理
- **不适合迭代计算**：机器学习等需要多轮迭代的场景性能很差

## MapReduce vs Spark

| 维度 | MapReduce | Spark |
|------|-----------|-------|
| 编程复杂度 | 高，需写 Mapper/Reducer | 低，API 丰富 |
| 中间结果 | 写磁盘 | 内存缓存 |
| 迭代计算 | 每轮都写磁盘，极慢 | 内存迭代，快 10-100x |
| 实时处理 | 不支持 | Spark Streaming |
| 生态 | Hadoop 原生 | 统一平台（SQL/ML/流/图） |

> MapReduce 目前已逐渐被 Spark 替代，但理解其原理对掌握分布式计算思想仍有价值。
