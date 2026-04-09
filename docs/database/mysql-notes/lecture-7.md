# 第 7 讲：慢查询优化与性能调优

## 核心结论（10 条必记）

1. **慢查询日志是定位慢 SQL 的主要工具** -- 线上排查的第一步
2. **EXPLAIN 是分析执行计划的核心命令** -- type/key/rows/Extra 四个字段必看
3. **深分页慢是因为要扫描并丢弃前面的行** -- 不是只扫你要的那 20 条
4. **覆盖索引 + 子查询 / 游标翻页是深分页常见优化方案** -- 减少回表
5. **count(*) 在大表上慢，可以用索引、缓存、近似值优化** -- InnoDB 没存总行数
6. **JOIN 慢通常是索引问题或数据量问题** -- 关联字段必须有索引
7. **大批量操作要分批处理，避免大事务** -- 每次处理一小部分
8. **索引失效的常见原因：函数、类型转换、前导%、or、不符合最左前缀** -- 避开这些坑
9. **大事务会导致锁等待、主从延迟、undo 膨胀** -- 线上高危问题
10. **排查流程：发现 → EXPLAIN → 判断 → 优化 → 验证** -- 系统化思维

---

## 一、慢查询优化的整体思路

### 排查三步法

| 步骤 | 做什么 | 工具 |
|------|--------|------|
| 第一步：发现慢 SQL | 定位问题 SQL | 慢查询日志、监控告警、APM、SHOW PROCESSLIST |
| 第二步：分析为什么慢 | 看执行计划 | EXPLAIN |
| 第三步：针对性优化 | 加索引、改 SQL、拆查询 | 具体问题具体分析 |

---

## 二、怎么定位慢 SQL？

### 1. 开启慢查询日志

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = 'ON';

-- 设置慢查询阈值（比如 1 秒）
SET GLOBAL long_query_time = 1;

-- 日志文件路径
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow.log';
```

查看慢查询日志：

```bash
# 实时查看
tail -f /var/log/mysql/slow.log

# 列出最慢的 10 条 SQL
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

---

### 2. 实时查看正在执行的 SQL

```sql
SHOW PROCESSLIST;
-- 或
SHOW FULL PROCESSLIST;
```

能看到：
- 当前连接
- 执行的 SQL
- 执行时间
- 状态（Sending data / Locked / Sorting result ...）

---

### 3. 用 EXPLAIN 分析执行计划

```sql
EXPLAIN SELECT * FROM order_info WHERE user_id = 1001;
```

重点看：`type`、`key`、`rows`、`Extra`

---

## 三、EXPLAIN 各字段详解

### 1. type（访问类型）

从好到坏：

| type | 说明 | 常见场景 |
|------|------|---------|
| system | 表只有一行 | 极少见 |
| const | 主键或唯一索引等值查询 | `WHERE id = 1` |
| eq_ref | 唯一索引扫描 | 常见于 JOIN |
| ref | 非唯一索引等值查询 | `WHERE user_id = 1001` |
| range | 范围查询 | `WHERE id > 10 AND id < 25` |
| index | 索引全扫描 | 扫描整个索引 |
| ALL | 全表扫描 | 没走索引 |

**看到 `ALL` 要警惕，通常需要优化。**

---

### 2. key（实际使用的索引）

如果是 `NULL`，说明没用索引。

---

### 3. rows（预估扫描行数）

扫描行数越大，通常性能越差。

---

### 4. Extra（额外信息）

| Extra | 含义 | 好坏 |
|-------|------|------|
| Using index | 覆盖索引 | 好 |
| Using where | 需要额外过滤 | 一般 |
| Using filesort | 无法利用索引排序 | 可能很慢 |
| Using temporary | 使用了临时表 | 可能很慢 |
| Using index condition | 索引下推 | 好 |

---

## 四、典型慢查询场景与优化

### 场景 1：深分页

**问题 SQL：**

```sql
SELECT * FROM order_info
ORDER BY create_time DESC
LIMIT 100000, 20;
```

**为什么慢？**

虽然只要 20 条，但 MySQL 要：
1. 先扫描并排序前 100020 行
2. 丢弃前 100000 行
3. 返回后 20 行

前 10 万行是白白扫描的。如果没有索引支持排序，还会 filesort，更慢。

**优化方案 1：覆盖索引 + 子查询**

```sql
SELECT a.* FROM order_info a
INNER JOIN (
  SELECT id FROM order_info
  ORDER BY create_time DESC
  LIMIT 100000, 20
) b ON a.id = b.id;
```

核心：让子查询走覆盖索引，减少回表。

**优化方案 2：游标翻页**

不用 OFFSET，记录上次最后一条的主键或时间：

```sql
-- 基于主键
SELECT * FROM order_info
WHERE id < last_max_id
ORDER BY id DESC
LIMIT 20;

-- 基于时间
SELECT * FROM order_info
WHERE create_time < '2025-01-01 12:00:00'
ORDER BY create_time DESC
LIMIT 20;
```

每次从上次结束位置继续，不需要跳过前面的行。

**优化方案 3：ES / 缓存 / 异步处理**

如果深翻页是常态（后台导出、报表）：
- Elasticsearch 做分页
- Redis 缓存列表
- 异步任务 + 分页导出

---

### 场景 2：count(*) 慢

**为什么慢？**

InnoDB 没有像 MyISAM 那样存储表的总行数，需要实际扫描符合条件的行。

**优化方案：**

| 方案 | 说明 |
|------|------|
| 用最小索引扫描 | InnoDB 会选最小的索引，比主键索引快 |
| 用覆盖索引 | 条件字段建索引 |
| 缓存 / 计数表 | 定期统计存到 Redis |
| 近似值 | 业务能接受的话用近似算法 |

**`COUNT(*)` vs `COUNT(1)` vs `COUNT(字段)`：**

- `COUNT(*)`：统计行数，MySQL 会优化，推荐
- `COUNT(1)`：和 `COUNT(*)` 基本一样
- `COUNT(字段)`：统计该字段非 NULL 的行数，可能更慢

---

### 场景 3：JOIN 慢

**可能原因：**
1. 关联字段没有索引
2. 数据量太大
3. 驱动表选择不当
4. 结果集很大

**优化方案：**

| 方案 | 说明 |
|------|------|
| 确保关联字段有索引 | `user_id` 和 `id` 都要有索引 |
| 小表驱动大表 | 优化器会尝试自动选择 |
| 拆分查询 | 分两次查，代码层做关联 |
| 冗余字段 | 空间换时间，减少 JOIN |

拆分查询示例：

```sql
-- 第一步
SELECT id, user_id FROM order_info WHERE status = 1;

-- 第二步（代码层拼接）
SELECT id, name FROM user WHERE id IN (...);
```

---

### 场景 4：大批量插入慢

**优化方案：**

| 方案 | 说明 |
|------|------|
| 分批插入 | 每次 1000 条，避免一条 SQL 太大 |
| 用事务包裹 | `BEGIN; ... COMMIT;` 避免逐条自动提交 |
| `LOAD DATA INFILE` | 从文件导入，比逐条 INSERT 快很多 |
| 临时关闭索引维护 | 先删索引 → 导入 → 重建索引（离线场景） |

---

### 场景 5：大批量更新 / 删除

**问题：**

```sql
DELETE FROM order_info WHERE create_time < '2023-01-01';
```

涉及几十万行可能导致：锁持有时间长、主从延迟、undo log 膨胀、超时。

**优化方案：**

```sql
-- 方案 1：LIMIT 分批删
DELETE FROM order_info
WHERE create_time < '2023-01-01'
LIMIT 1000;

-- 方案 2：按主键范围分批
DELETE FROM order_info
WHERE id >= 1000000 AND id < 1001000;
```

循环执行，每次处理一小部分。

---

### 场景 6：索引失效

| 写法 | 问题 | 优化 |
|------|------|------|
| `WHERE DATE(create_time) = '2025-01-01'` | 对索引列做函数 | 改成范围查询 |
| `WHERE age + 1 = 20` | 对索引列做计算 | 改成 `WHERE age = 19` |
| `WHERE phone = 13800000000`（phone 是 varchar） | 隐式类型转换 | 保持类型一致 |
| `WHERE name LIKE '%张三'` | 前导 % | 改成前缀匹配 `LIKE '张三%'` |
| `WHERE a = 1 OR b = 2` | or 使用不当 | 改成 UNION |
| `WHERE b = 1 AND c = 2`（索引是 `a,b,c`） | 不符合最左前缀 | 加上 a 或重新设计索引 |

函数改写示例：

```sql
-- 不好
WHERE DATE(create_time) = '2025-01-01'

-- 好
WHERE create_time >= '2025-01-01 00:00:00'
  AND create_time < '2025-01-02 00:00:00'
```

OR 改写示例：

```sql
-- 不好
SELECT * FROM t WHERE a = 1 OR b = 2;

-- 好
SELECT * FROM t WHERE a = 1
UNION
SELECT * FROM t WHERE b = 2;
```

---

## 五、线上慢查询排查流程

```
发现慢 SQL
    ↓
EXPLAIN 分析（type / key / rows / Extra）
    ↓
判断问题（没走索引？扫描太多？filesort？锁等待？）
    ↓
针对性优化（加索引 / 改 SQL / 拆查询 / 优化表结构）
    ↓
验证效果（再次 EXPLAIN）
    ↓
上线观察（监控慢查询、CPU / IO / 并发）
```

---

## 六、大事务问题

### 什么是大事务？

一个事务里：
- 修改了大量数据
- 持续时间很长
- 锁持有时间长

### 大事务的危害

| 危害 | 说明 |
|------|------|
| 锁持有时间长 | 阻塞其他事务 |
| undo log 膨胀 | 占用大量空间，回滚代价高 |
| 主从延迟 | 从库重放 binlog 时间长 |
| 超时风险 | 事务执行时间过长，可能被超时机制中断 |

### 怎么避免大事务？

1. **拆分成小事务** -- 不要一次更新几十万行
2. **控制事务持续时间** -- 尽快提交
3. **批量操作分批处理** -- 每次处理一小部分，提交后再继续
4. **异步化** -- 不需要立刻完成的用消息队列异步处理

---

## 七、面试高频题

### 1. 深分页为什么慢？怎么优化？

- MySQL 要扫描并丢弃前面的行
- 优化方法：覆盖索引 + 子查询 / 游标翻页 / ES

### 2. count(*) 为什么慢？

- InnoDB 没有存储总行数，需要扫描
- 优化：用索引 / 缓存 / 近似值

### 3. JOIN 为什么慢？怎么优化？

- 关联字段没索引 / 数据量大 / 驱动表选择不当
- 优化：加索引 / 拆分查询 / 冗余字段

### 4. 为什么不建议在生产环境用 SELECT *？

- 增加网络传输
- 影响覆盖索引
- 可能读取无用字段
- 表结构变更影响大

### 5. 大批量更新/删除怎么处理？

- 分批处理
- 控制事务大小
- 避免大事务
- 归档后删除

---

## 八、练习题

### 练习 1
有一张订单表 100 万数据，执行：

```sql
SELECT * FROM order_info
ORDER BY create_time DESC
LIMIT 500000, 20;
```

很慢。请说出至少 2 种优化方案。

---

### 练习 2
为什么不建议这样写：

```sql
SELECT * FROM user WHERE DATE(create_time) = '2025-01-01';
```

应该怎么改？

---

### 练习 3
为什么大事务危险？应该怎么避免？

---

## 下一讲预告

**第 8 讲：主从复制、读写分离、主从延迟**

- 主从复制原理
- binlog 三种格式
- 主从延迟原因与解决
- 读写分离怎么做
- 读写分离的一致性问题
- 主库挂了怎么办
