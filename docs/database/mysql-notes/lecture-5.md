# 第 5 讲：MVCC、Read View、快照读、当前读

## 核心结论（10 条必记）

1. **MVCC 是通过隐藏字段、undo log、Read View 组合实现的** -- 不是某个单独模块
2. **每行记录有 DB_TRX_ID 和 DB_ROLL_PTR 两个隐藏字段** -- 记录修改者和历史位置
3. **undo log 形成版本链** -- 通过 DB_ROLL_PTR 把历史版本串起来
4. **Read View 用于判断版本可见性** -- 决定当前事务能看到哪个版本
5. **RC 每次快照读都生成新 Read View** -- 所以每次读到的都是最新已提交版本
6. **RR 复用第一次快照读的 Read View** -- 所以事务内多次读保持一致
7. **快照读不加锁，走 MVCC** -- 普通 select
8. **当前读加锁，读最新版本** -- select for update / update / delete / insert
9. **RR 下快照读可以避免不可重复读** -- 因为 Read View 固定
10. **RR 下当前读还需要间隙锁防止幻读** -- MVCC 无法完全覆盖当前读场景

---

## 一、MVCC 是什么？

MVCC 不是某个具体的功能模块，而是由多个机制组合实现的**设计思想**：

1. 数据行的隐藏字段
2. undo log 形成的版本链
3. Read View（读视图）
4. 可见性判断算法

> InnoDB 通过"多版本 + 可见性规则"，实现了读写并发不阻塞的机制

---

## 二、MVCC 要解决的核心问题

```sql
CREATE TABLE account (
  id INT PRIMARY KEY,
  balance INT
);
```

两个事务并发：
- T1：读取余额
- T2：修改余额

传统做法：T2 加写锁，T1 要等锁释放 -> 读写阻塞，并发差

MVCC 目标：**让 T1 读时不加锁，也能读到一致数据，不被 T2 影响**

---

## 三、InnoDB 行记录的隐藏字段

建表时你以为一行就是定义的列：

```text
id, name, age
```

实际上 InnoDB 还会自动加隐藏列：

```text
id, name, age, DB_TRX_ID, DB_ROLL_PTR, DB_ROW_ID（无主键时）
```

### 关键隐藏字段

| 字段 | 含义 | 作用 |
|------|------|------|
| `DB_TRX_ID` | 最近一次修改这行的事务 ID | 判断"这一行是谁修改的" |
| `DB_ROLL_PTR` | 回滚指针，指向上一版本（undo log） | 找到历史版本，形成版本链 |
| `DB_ROW_ID` | 隐藏自增主键（无主键时才有） | InnoDB 自动生成聚簇索引 |

> DB_TRX_ID 和 DB_ROLL_PTR 是 MVCC 的基础

---

## 四、undo log 版本链怎么形成的

### 初始记录

```text
id=1, balance=1000, DB_TRX_ID=10
```

### 事务 20 修改余额

```sql
begin; -- 事务 ID = 20
update account set balance = 900 where id = 1;
commit;
```

过程：
1. 旧版本 `balance=1000, DB_TRX_ID=10` 写入 undo log
2. 当前行变成 `balance=900, DB_TRX_ID=20, DB_ROLL_PTR -> 旧版本`

### 事务 30 再修改

```sql
begin; -- 事务 ID = 30
update account set balance = 800 where id = 1;
commit;
```

版本链：

```text
当前行: balance=800, DB_TRX_ID=30, DB_ROLL_PTR -> 900 版本

undo log 链:
  balance=900, DB_TRX_ID=20, DB_ROLL_PTR -> 1000 版本
  balance=1000, DB_TRX_ID=10, DB_ROLL_PTR -> NULL
```

```
800 (TRX_ID=30) -> 900 (TRX_ID=20) -> 1000 (TRX_ID=10)
```

> 每次修改都会把旧版本保存到 undo log，通过 DB_ROLL_PTR 串成链

---

## 五、Read View 是什么

数据行可能有多个版本，**Read View 就是用来判断当前事务能看到哪个版本的"可见性快照"**。

### Read View 包含的信息

| 字段 | 含义 |
|------|------|
| `m_ids` | 当前活跃（未提交）事务的 ID 列表 |
| `min_trx_id` | 活跃事务中最小的事务 ID |
| `max_trx_id` | 下一个即将分配的事务 ID（当前最大 + 1） |
| `creator_trx_id` | 创建这个 Read View 的事务 ID |

### 工作流程

1. 拿到当前行的 `DB_TRX_ID`
2. 对比 Read View 的可见性规则
3. 如果当前版本不可见 -> 沿 `DB_ROLL_PTR` 找上一个版本
4. 重复判断，直到找到可见版本

---

## 六、可见性判断规则

假设读到一行的 `DB_TRX_ID = trx_id`，判断流程：

```
trx_id < min_trx_id ?
  YES -> 可见（在所有活跃事务之前就已提交）

trx_id >= max_trx_id ?
  YES -> 不可见（在 Read View 创建之后才生成）

min_trx_id <= trx_id < max_trx_id ?
  trx_id 在 m_ids 里 ?
    YES -> 未提交事务
      trx_id == creator_trx_id ?
        YES -> 可见（自己修改的）
        NO  -> 不可见（别人的未提交）
    NO  -> 可见（已提交）
```

### 规则速记

| 条件 | 结论 | 原因 |
|------|------|------|
| trx_id < min_trx_id | 可见 | 在所有活跃事务之前已提交 |
| trx_id >= max_trx_id | 不可见 | Read View 之后才生成 |
| trx_id 在 m_ids 中 | 不可见（除非是自己） | 别人的未提交事务 |
| trx_id 不在 m_ids 中 | 可见 | 已提交事务 |

> 如果当前版本不可见，就沿 DB_ROLL_PTR 找上一个版本继续判断

---

## 七、RC 和 RR 的 Read View 生成时机

这是 RC 和 RR **最本质的区别**。

| 隔离级别 | Read View 生成时机 | 结果 |
|---------|-------------------|------|
| RC | 每次执行 select 都生成新的 | 每次读到最新已提交版本 |
| RR | 事务第一次快照读时生成，之后复用 | 事务内多次读保持一致 |

```
RC: 每次 select -> 新 Read View -> 可能看到新提交的更新
RR: 第一次 select -> 固定 Read View -> 事务内始终一致
```

---

## 八、完整场景演示：RC vs RR

### 初始数据

```text
id=1, balance=1000, DB_TRX_ID=10
```

### RC 隔离级别

```
T1 (trx_id=100)                    T2 (trx_id=101)
begin;
select balance -> 生成 Read View
  m_ids=[100], min=100, max=101
  DB_TRX_ID=10 < min=100
  可见 -> 读到 1000
                                   begin;
                                   update balance=900;
                                   commit;
                                   行变成: balance=900, TRX_ID=101

select balance -> 重新生成 Read View
  m_ids=[100], min=100, max=102
  DB_TRX_ID=101, 不在 m_ids 中
  可见 -> 读到 900

两次读结果不同 -> 不可重复读
```

### RR 隔离级别

```
T1 (trx_id=100)                    T2 (trx_id=101)
begin;
select balance -> 生成 Read View
  m_ids=[100], min=100, max=101
  DB_TRX_ID=10 < min=100
  可见 -> 读到 1000
                                   begin;
                                   update balance=900;
                                   commit;
                                   行变成: balance=900, TRX_ID=101

select balance -> 复用之前的 Read View
  DB_TRX_ID=101 >= max=101
  不可见 -> 沿版本链找
  balance=1000, TRX_ID=10 < min=100
  可见 -> 读到 1000

两次读结果相同 -> 避免不可重复读
```

---

## 九、快照读 vs 当前读

### 快照读（Snapshot Read）

普通 `select`，不加锁：

```sql
select * from user where id = 1;
```

特点：不加锁、走 MVCC、读历史快照版本

### 当前读（Current Read）

读取**最新已提交版本**并加锁：

```sql
select * from user where id = 1 for update;
select * from user where id = 1 lock in share mode;
update ...
delete ...
insert ...
```

特点：加锁、读最新版本、不走 MVCC 历史版本

### 为什么修改时必须当前读？

```sql
update account set balance = balance - 100 where id = 1;
```

必须读到当前最新的 balance 才能正确计算，不能基于旧快照。

### 对比总结

| 类型 | 是否加锁 | 读取版本 | 走 MVCC | SQL 示例 |
|------|---------|---------|---------|---------|
| 快照读 | 不加锁 | 历史一致版本 | 是 | `select ...` |
| 当前读 | 加锁 | 最新版本 | 否 | `select ... for update` / `update` / `delete` |

---

## 十、RR 下快照读 vs 当前读对幻读的不同处理

### 快照读场景

RR 下 Read View 固定，普通 `select` 看不到别人后来插入的新行 -> 看起来避免了幻读

### 当前读场景

`select ... for update` 读最新数据，如果别的事务插入了新行就可能看到

所以 MySQL 需要**间隙锁 + 临键锁**防止范围内插入新行

---

## 十一、间隙锁和临键锁（预告）

这是下一讲重点，这里先建立认知。

### 间隙锁（Gap Lock）

锁住索引之间的间隙，防止插入：

```
索引值: 10, 20, 30
间隙锁可锁住: (10, 20), (20, 30)
别人无法在这些间隙插入新行
```

### 临键锁（Next-Key Lock）

行锁 + 间隙锁的组合，既锁住行，也锁住它前面的间隙。

> 间隙锁和临键锁是为了在 RR 下的当前读场景中防止幻读

---

## 十二、RC 和 RR 的完整组合理解

| 隔离级别 | 快照读 | 当前读 | 间隙锁 |
|---------|--------|--------|--------|
| RC | 每次新 Read View，读最新已提交 | 加行锁 | 不使用 |
| RR | 复用 Read View，多次读一致 | 加行锁 + 间隙锁/临键锁 | 使用 |

> MySQL 的事务隔离不是只靠 MVCC，也不是只靠锁，而是**两者结合**

---

## 十三、面试高频题

### 1. MVCC 是什么？

MVCC 是多版本并发控制。InnoDB 通过行记录的隐藏字段（事务 ID、回滚指针）、undo log 版本链、Read View 和可见性判断算法，实现了普通读在并发下不加锁也能读到一致数据。

### 2. RC 和 RR 在 MVCC 上有什么区别？

RC 每次快照读都生成新 Read View，每次读到最新已提交版本；RR 复用第一次快照读的 Read View，事务内多次读保持一致。

### 3. 快照读和当前读有什么区别？

快照读是普通 select，不加锁，走 MVCC，读历史版本；当前读如 select for update / update / delete，加锁，读最新版本。

### 4. RR 下为什么还可能有幻读？

快照读通过复用 Read View 可以避免看到新行；但当前读读最新数据，需要间隙锁/临键锁防止范围内插入新行。

---

## 练习题（待完成）

- [ ] 练习 1：什么是 Read View？RC 和 RR 下生成时机有什么不同？
- [ ] 练习 2：快照读和当前读有什么区别？各自适用什么场景？
- [ ] 练习 3：为什么 RR 下快照读可以避免不可重复读，但当前读还可能遇到幻读？

---

## 下一讲预告

**第 6 讲：InnoDB 锁机制 -- 行锁、表锁、间隙锁、临键锁、死锁**

- InnoDB 有哪些锁
- 行锁是怎么加的
- 什么是间隙锁
- 什么是临键锁
- 什么情况会锁表
- 死锁怎么产生
- 怎么排查和避免死锁
