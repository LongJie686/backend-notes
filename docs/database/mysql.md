# MySQL

## 索引

### B+ 树

- InnoDB 默认的索引结构
- 所有数据存储在叶子节点，通过双向链表连接
- 非叶子节点仅存储键值用于路由

### 索引类型

- 主键索引（聚簇索引）
- 二级索引（非聚簇索引）
- 联合索引（最左前缀原则）
- 覆盖索引（索引包含所有查询列）

### EXPLAIN

关键字段：

| 字段 | 含义 |
|------|------|
| type | 访问类型（ALL < index < range < ref < eq_ref < const） |
| key | 实际使用的索引 |
| rows | 预估扫描行数 |
| Extra | Using index 表示命中覆盖索引 |

## 事务

### ACID

- **A**tomicity 原子性：undo log
- **C**onsistency 一致性：应用层保证
- **I**solation 隔离性：MVCC + 锁
- **D**urability 持久性：redo log

### 隔离级别

| 级别 | 脏读 | 不可重复读 | 幻读 |
|------|------|-----------|------|
| READ UNCOMMITTED | 是 | 是 | 是 |
| READ COMMITTED | 否 | 是 | 是 |
| REPEATABLE READ | 否 | 否 | 部分* |
| SERIALIZABLE | 否 | 否 | 否 |

*InnoDB 在 RR 级别下使用 Next-Key Lock 防止幻读。

## MVCC

- 每行数据包含隐藏列：`DB_TRX_ID`、`DB_ROLL_PTR`
- Undo log 形成版本链
- Read View 决定版本的可见性

---

> **实战项目**: MySQL 相关知识点（表设计、复合索引、覆盖索引、逻辑删除、事务、读写分离、EXPLAIN）已在 [Ecommerce Microservices](https://github.com/LongJie686/ecommerce-microservices) 项目中落地实现。
