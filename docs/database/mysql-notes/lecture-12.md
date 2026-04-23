# L12: MySQL 大厂面试题 - 锁与并发、性能调优（Q51-Q80）

---

# 专题四：锁与并发（15 题）

---

## Q51：InnoDB 有哪些锁？

### 答案

#### 表级锁
- **IS（意向共享锁）**：准备对行加 S 锁
- **IX（意向排他锁）**：准备对行加 X 锁

#### 行级锁
- **Record Lock（记录锁）**：锁住单条记录
- **Gap Lock（间隙锁）**：锁住索引间隙，防止插入
- **Next-Key Lock（临键锁）**：记录锁 + 间隙锁，RR 下范围查询默认用这个

---

## Q52：行锁是锁在哪里的？

### 答案

InnoDB 行锁是加在**索引**上的，不是加在数据行上。

这意味着：
- 如果查询没有走索引，可能锁住大量索引记录
- 极端情况下接近"锁表"效果

例如：
```sql
UPDATE user SET age = 20 WHERE name = '张三';
```

如果 `name` 没有索引，
InnoDB 需要扫描所有行，
可能给很多行都加锁。

---

## Q53：什么是间隙锁？为什么需要它？

### 答案

#### 什么是间隙锁
锁住索引记录之间的间隙，防止新记录插入到这个间隙。

#### 为什么需要
防止 RR 下当前读出现幻读。

#### 例子
索引值有：`10, 20, 30`

事务 A：
```sql
SELECT * FROM t WHERE id > 10 AND id < 25 FOR UPDATE;
```

InnoDB 会锁住 `(10, 20]` 和 `(20, 25)` 区间，
事务 B 无法插入 `id = 15` 或 `id = 22`。

---

## Q54：间隙锁和临键锁有什么区别？

### 答案

#### 间隙锁（Gap Lock）
只锁住索引记录之间的间隙。
不锁记录本身。

```text
(10, 20)  -- 只锁这个区间，不包含 10 和 20
```

#### 临键锁（Next-Key Lock）
= 记录锁 + 该记录前面的间隙锁。

```text
(10, 20]  -- 锁这个区间，包含 20
```

#### 关系
临键锁是间隙锁的超集，覆盖范围更大。
RR 下范围当前读通常用临键锁。

---

## Q55：什么情况下会发生死锁？

### 答案

死锁 = 两个事务互相等待对方释放锁。

#### 经典场景
```text
T1 持有 A 的锁，等待 B 的锁
T2 持有 B 的锁，等待 A 的锁
```

#### 具体例子
```sql
-- T1
UPDATE t SET ... WHERE id = 1;  -- 拿到 id=1 的锁
UPDATE t SET ... WHERE id = 2;  -- 等待 id=2 的锁

-- T2
UPDATE t SET ... WHERE id = 2;  -- 拿到 id=2 的锁
UPDATE t SET ... WHERE id = 1;  -- 等待 id=1 的锁
```

T1 等 T2，T2 等 T1，死锁。

---

## Q56：InnoDB 怎么处理死锁？

### 答案

InnoDB 有死锁检测机制。

#### 检测到死锁时
选择代价较小的事务回滚（通常是修改行数少的那个），
让另一个事务继续执行。

#### 如何排查死锁
```sql
SHOW ENGINE INNODB STATUS;
```

看 `LATEST DETECTED DEADLOCK` 部分。

---

## Q57：怎么避免死锁？

### 答案

1. **保持资源获取顺序一致**
   所有事务按相同顺序获取锁（比如永远先锁小 ID）。

2. **缩短事务时间**
   减少持锁时间，降低冲突概率。

3. **让查询走索引**
   避免锁范围过大。

4. **减少锁的粒度**
   尽量精确定位，减少不必要的行锁。

5. **失败重试**
   遇到死锁捕获异常，做幂等重试。

---

## Q58：select for update 加的是什么锁？

### 答案

加的是**排他锁（X 锁）**。

其他事务：
- 不能对同一行加 S 锁（读锁）
- 不能对同一行加 X 锁（写锁）

只能等当前事务释放。

锁的范围取决于查询条件和索引：
- 等值 + 唯一索引：记录锁（单行）
- 范围查询：临键锁 / 间隙锁
- 没有索引：可能锁大量行

---

## Q59：什么是乐观锁和悲观锁？

### 答案

#### 悲观锁
认为并发冲突一定会发生，
操作前先加锁，用完再释放。

```sql
SELECT * FROM goods WHERE id = 1 FOR UPDATE;
UPDATE goods SET stock = stock - 1 WHERE id = 1;
```

适合：并发冲突频繁的场景。

#### 乐观锁
认为并发冲突很少发生，
不加锁，更新时检查版本号。

```sql
-- 先查版本
SELECT stock, version FROM goods WHERE id = 1;

-- 更新时检查版本
UPDATE goods
SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = #{oldVersion};
```

如果影响行数是 0，说明被别人更新了，重试。

适合：并发冲突不频繁的场景。

---

## Q60：如何实现高并发下的库存扣减？

### 答案

库存扣减是高并发经典问题。

#### 方案 1：悲观锁
```sql
BEGIN;
SELECT stock FROM goods WHERE id = 1 FOR UPDATE;
-- 检查库存 > 0
UPDATE goods SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

缺点：并发高时锁竞争严重。

#### 方案 2：乐观锁（CAS）
```sql
UPDATE goods
SET stock = stock - 1
WHERE id = 1 AND stock > 0;
```

利用数据库原子性，不加锁。
如果 `stock = 0`，更新失败。

#### 方案 3：Redis + 异步落库
先在 Redis 里原子扣减：

```text
DECR stock:goods:1
```

如果结果 >= 0，扣减成功，异步写 MySQL。

高并发场景下性能最好。

---

## Q61：什么是 MVCC 和锁的关系？

### 答案

MVCC 和锁不是互斥的，而是配合使用。

#### MVCC 解决的问题
普通读（快照读）不加锁，
通过历史版本实现并发读一致性。

#### 锁解决的问题
当前读（for update / update / delete）需要加锁，
防止并发写冲突和幻读。

#### 简单说
- **普通 SELECT**：MVCC，不加锁
- **加锁读 / 写操作**：加锁，防并发冲突

---

## Q62：RC 和 RR 在加锁上有什么区别？

### 答案

#### RC
- 快照读：每次生成新 Read View
- 当前读：只加记录锁，不加间隙锁

#### RR
- 快照读：复用 Read View
- 当前读：加记录锁 + 间隙锁 / 临键锁（防幻读）

所以 RR 比 RC 加锁范围更大，并发度相对低一些，但一致性更强。

---

## Q63：FOR UPDATE 和 LOCK IN SHARE MODE 有什么区别？

### 答案

#### FOR UPDATE（排他锁 X）
- 其他事务不能加任何锁
- 适合：读后要修改的场景

```sql
SELECT * FROM goods WHERE id = 1 FOR UPDATE;
```

#### LOCK IN SHARE MODE（共享锁 S）
- 其他事务可以加 S 锁，但不能加 X 锁
- 适合：读后不修改，只是防止别人修改

```sql
SELECT * FROM goods WHERE id = 1 LOCK IN SHARE MODE;
```

---

## Q64：什么情况下 InnoDB 会锁表？

### 答案

InnoDB 默认行锁，通常不会锁整张表。

但以下情况会导致"接近锁表"的效果：

1. **查询没有走索引**
   需要扫全表，给大量行加锁。

2. **全表 UPDATE / DELETE**
   没有 where 条件，给所有行加锁。

3. **显式 LOCK TABLES**
   ```sql
   LOCK TABLES t WRITE;
   ```

4. **DDL 操作（MDL 锁）**
   ALTER TABLE 会申请元数据写锁，
   阻塞所有读写。

---

## Q65：为什么 delete 全表数据比 truncate 慢？

### 答案

#### DELETE
- 逐行删除
- 每行都要写 undo log
- 每行都要记录 binlog
- 要维护索引
- 支持事务回滚

#### TRUNCATE
- 直接删除整个表的数据文件
- 不写 undo log（不支持回滚）
- 速度很快
- 相当于重建表

所以大表清空用 TRUNCATE 更快，
但要注意 TRUNCATE 不能回滚。

---

# 专题五：性能调优（15 题）

---

## Q66：深分页为什么慢？怎么优化？

### 答案

#### 为什么慢
```sql
SELECT * FROM order_info LIMIT 100000, 20;
```

MySQL 需要先扫描并丢弃前 10 万行，
再返回后 20 行。
扫描行数 = offset + limit。

#### 优化方案

**方案 1：覆盖索引 + 子查询**
```sql
SELECT * FROM order_info
WHERE id >= (
  SELECT id FROM order_info ORDER BY id LIMIT 100000, 1
)
LIMIT 20;
```

子查询走覆盖索引，只取主键，
再用主键回表取数据。

**方案 2：游标翻页**
```sql
SELECT * FROM order_info
WHERE id > last_max_id
ORDER BY id
LIMIT 20;
```

记录上次最后一条主键，下次从这里继续。

**方案 3：ES 做分页**
数据同步到 Elasticsearch，用 ES 分页。

---

## Q67：join 查询慢的原因和优化方法？

### 答案

#### 原因
1. 关联字段没有索引
2. 驱动表选择不当（大表驱动小表）
3. 数据量太大
4. join 过多

#### 优化

1. **确保关联字段有索引**
2. **小表驱动大表**（MySQL 优化器通常自动选）
3. **拆分查询**：两次查询，应用层关联
4. **冗余字段**：避免 join
5. **控制 join 表数量**

---

## Q68：如何优化 GROUP BY 慢查询？

### 答案

GROUP BY 慢通常因为：
- 没有索引支持排序
- 数据量大
- 使用了临时表（`Using temporary`）

#### 优化

1. **加索引**
   GROUP BY 的字段加索引，避免临时表和 filesort。

2. **先过滤再聚合**
   用 WHERE 减少参与聚合的数据量。

3. **避免 `ORDER BY NULL`**
   默认 GROUP BY 会排序，
   加 `ORDER BY NULL` 可以避免不必要的排序。

4. **用汇总表**
   提前聚合存到汇总表，查询直接读汇总表。

---

## Q69：什么是 Buffer Pool？怎么调优？

### 答案

#### 什么是 Buffer Pool
InnoDB 在内存中开辟的缓存区，
缓存数据页和索引页，减少磁盘 IO。

#### 调优

**1. 调大 Buffer Pool**
一般设置为物理内存的 50%~75%：
```sql
innodb_buffer_pool_size = 4G
```

**2. 多实例**
大内存时，设置多个 Buffer Pool 实例减少锁竞争：
```sql
innodb_buffer_pool_instances = 8
```

**3. 监控命中率**
```sql
SHOW STATUS LIKE 'Innodb_buffer_pool%';
```

命中率应该在 99% 以上。

---

## Q70：什么是 Change Buffer？

### 答案

Change Buffer 是 InnoDB 的一种优化机制。

对于**非唯一普通索引**的写操作，
如果数据页不在 Buffer Pool 中，
不立即加载数据页，
而是把变更记录到 Change Buffer，
等下次该数据页被读取时再合并。

#### 好处
- 减少随机磁盘 IO
- 提升写入性能

#### 为什么唯一索引不能用 Change Buffer
因为唯一索引写入时需要检查唯一性，
必须把数据页加载到内存才能判断，
所以无法延迟。

---

## Q71：如何定位 MySQL CPU 过高的问题？

### 答案

#### 第一步：查看正在执行的 SQL
```sql
SHOW FULL PROCESSLIST;
```

找执行时间长、state 异常的 SQL。

#### 第二步：看慢查询日志
找近期出现的慢 SQL。

#### 第三步：用 EXPLAIN 分析
对嫌疑 SQL 分析执行计划。

#### 常见原因
- 全表扫描
- filesort
- 索引失效
- 大量小 SQL 并发（连接数太多）
- 锁等待

---

## Q72：MySQL 连接数太多怎么处理？

### 答案

#### 表现
`Too many connections` 错误。

#### 原因
- 连接没有及时释放
- 连接池配置不合理
- 短连接模式且并发高

#### 处理方法

1. **配置连接池**
   使用数据库连接池，控制最大连接数。

2. **调整 max_connections**
```sql
SET GLOBAL max_connections = 1000;
```

3. **排查连接泄漏**
   找到没有释放连接的代码。

4. **减少慢查询**
   慢查询会长时间占用连接。

5. **使用连接复用**
   长连接代替短连接。

---

## Q73：如何优化大表的 count 查询？

### 答案

#### 方案 1：用最小索引
MySQL 会自动选择最小索引做 count，
但数据量大时仍然慢。

#### 方案 2：Redis 计数器
写入时 +1，删除时 -1：
```text
INCR count:order_info
```

查 count 直接读 Redis。

#### 方案 3：汇总表
定期统计写入汇总表：
```sql
INSERT INTO stat_table(stat_date, order_count)
SELECT DATE(create_time), COUNT(*)
FROM order_info
GROUP BY DATE(create_time);
```

#### 方案 4：近似值
```sql
EXPLAIN SELECT * FROM order_info;
```

EXPLAIN 里的 rows 是近似值，
如果业务接受误差，可以用这个。

---

## Q74：批量插入如何优化？

### 答案

#### 方案 1：合并 INSERT
```sql
-- 不好
INSERT INTO t VALUES(1, 'a');
INSERT INTO t VALUES(2, 'b');

-- 好
INSERT INTO t VALUES(1, 'a'), (2, 'b'), (3, 'c');
```

#### 方案 2：事务包裹
```sql
BEGIN;
INSERT INTO t VALUES(...);
INSERT INTO t VALUES(...);
...
COMMIT;
```

避免每条都自动提交事务。

#### 方案 3：LOAD DATA INFILE
```sql
LOAD DATA INFILE '/path/data.csv' INTO TABLE t;
```

比逐条 INSERT 快很多。

#### 方案 4：关闭唯一检查（导入时临时）
```sql
SET UNIQUE_CHECKS = 0;
-- 批量插入
SET UNIQUE_CHECKS = 1;
```

---

## Q75：如何做 MySQL 参数调优？

### 答案

#### 关键参数

**1. innodb_buffer_pool_size**
缓冲池大小，建议设为物理内存的 50%~75%。

**2. innodb_flush_log_at_trx_commit**
- 0：每秒刷盘，性能最好，可能丢 1 秒数据
- 1：每次提交刷盘，最安全（默认）
- 2：提交写 OS 缓存，每秒刷磁盘，折中

**3. sync_binlog**
- 0：OS 控制刷盘
- 1：每次提交刷盘，最安全
- N：每 N 次提交刷盘

**4. max_connections**
最大连接数，根据业务调整。

**5. innodb_log_file_size**
redo log 文件大小，太小会频繁切换。

---

## Q76：如何排查主从延迟？

### 答案

#### 第一步：查看延迟
```sql
SHOW SLAVE STATUS\G
```

看 `Seconds_Behind_Master`。

#### 第二步：分析原因
- 主库写入 TPS 高？
- 从库硬件差？
- 有大事务？
- 从库有慢查询？
- 网络延迟？

#### 第三步：优化
- 减少大事务
- 开启并行复制
- 升级从库硬件
- 优化慢查询

---

## Q77：什么是 Online DDL？什么情况下会锁表？

### 答案

#### Online DDL
MySQL 5.6+ 支持在不阻塞读写的情况下做部分 DDL 操作。

#### 不同操作的影响

- **加列（ADD COLUMN）**：通常不锁表
- **加索引**：通常不锁表
- **修改列类型**：可能锁表
- **删列**：可能锁表
- **修改主键**：会锁表

#### 安全方案
用 `pt-online-schema-change` 做大表 DDL，
通过触发器同步增量，零停机变更。

---

## Q78：如何分析一条 SQL 的执行过程？

### 答案

SQL 执行流程：

1. **连接管理**：客户端连接，权限验证

2. **查询缓存**
   （MySQL 8.0 已移除）

3. **解析器**
   词法分析 + 语法分析，生成语法树

4. **优化器**
   选择执行计划（走哪个索引、join 顺序等）

5. **执行器**
   调用存储引擎接口，按计划执行

6. **存储引擎**
   InnoDB 读取 / 修改数据，
   走 Buffer Pool、undo log、redo log

---

## Q79：为什么有时候加了索引反而变慢？

### 答案

#### 原因 1：写入变慢
加了索引后，INSERT / UPDATE / DELETE 都要维护索引，
写入性能下降。

#### 原因 2：优化器选错索引
有时优化器会选一个不合适的索引，
导致查询变慢。

可以用 `FORCE INDEX` 强制指定，
或删掉无效索引让优化器选择更准确。

#### 原因 3：索引区分度低
如果新加的索引区分度很低，
不如全表扫描，优化器可能放弃索引。

#### 原因 4：Buffer Pool 被占用
新索引占用 Buffer Pool 空间，
其他热点数据命中率下降。

---

## Q80：如何优化 ORDER BY 慢查询？

### 答案

ORDER BY 慢通常因为：

- 没有索引支持排序（出现 filesort）
- 排序数据量太大

#### 优化方案

**1. 利用索引排序**
建立能覆盖 WHERE + ORDER BY 的联合索引：

```sql
-- 查询
WHERE user_id = 1001 ORDER BY create_time DESC

-- 索引
INDEX(user_id, create_time)
```

**2. 减少排序数据量**
先用 WHERE 过滤，减少需要排序的行。

**3. 调大 sort_buffer_size**
排序需要内存缓冲区，太小会用磁盘临时文件：
```sql
sort_buffer_size = 4M
```
