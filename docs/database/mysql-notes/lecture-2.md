# 第 2 讲：索引底层原理与索引设计

## 核心结论（12 条必记）

1. **MySQL InnoDB 主要使用 B+ 树索引**
2. **数据库索引的核心目标是减少磁盘 IO** -- 不是 CPU 比较次数
3. **主键索引是聚簇索引，叶子节点存整行数据**
4. **普通索引是二级索引，叶子节点存索引值 + 主键**
5. **通过二级索引再查主键索引叫回表** -- 多一次 IO
6. **查询字段都在索引中时可形成覆盖索引** -- 不用回表
7. **联合索引比多个单列索引更重要**
8. **联合索引必须理解最左前缀原则**
9. **等值条件常放前，范围条件通常靠后**
10. **函数、计算、隐式转换、前导 % 会导致索引利用变差**
11. **低区分度字段不适合单独建索引**
12. **索引不是越多越好，要围绕核心查询场景设计**

---

## 一、为什么 MySQL 选 B+ 树

### 排除法

| 数据结构 | 被淘汰原因 |
|---------|-----------|
| 链表 | 顺序遍历，时间复杂度高 |
| 二叉搜索树 | 极端情况退化为链表 |
| 平衡二叉树 | 树太高 -> 磁盘 IO 次数多 |
| **B+ 树** | **矮胖、叶子有序、非叶节点只存 key** |

### B+ 树三大优势

1. **层级少** -- 几百万到上千万数据通常 3~4 层，IO 少
2. **叶子节点链表连接** -- 天然适合范围查询、排序、分页
3. **非叶节点只存 key 不存数据** -- 每个节点容纳更多 key，树更矮

> 核心目标：减少磁盘 IO

---

## 二、聚簇索引 vs 二级索引

### 聚簇索引（主键索引）

- 叶子节点存**整行数据**
- InnoDB 表按主键组织存储
- 按主键查：直接定位，效率最高

### 二级索引（非主键索引）

- 叶子节点存**索引列值 + 主键值**
- 例：`idx_phone(phone)` -> 叶子存 `phone -> id`

### 回表

```
查询: select * from user where phone = '13800000000'

1. 查 idx_phone -> 找到 id
2. 再查主键索引 -> 取整行数据    <-- 这步就是回表
```

> 匹配行多 -> 回表次数多 -> 性能下降 -> 优化本质是减少回表

### 覆盖索引

查询所需字段**全部在索引中**，不需要回表。

```sql
-- 索引：idx_user_status_name(status, name)
select status, name from user where status = 1;
-- status 和 name 都在索引里 -> 覆盖索引，不回表
```

---

## 三、索引结构对比图

```
user 表: id(pk), phone, name, age
索引: idx_phone(phone)

主键索引:        id -> 整行数据(id, phone, name, age)
二级索引:        phone -> id

查询 select * from user where phone = '13800000000':
  idx_phone('13800000000') -> id=1001 -> 主键索引(1001) -> 整行数据
  ^^^^^^^^^^^^^^^^^^^^^^^^              ^^^^^^^^^^^^^^^^^^^^
  二级索引查找                         回表
```

---

## 四、联合索引与最左前缀原则

### 联合索引为什么重要？

业务查询往往多条件组合，单列索引不够用。

### 最左前缀原则

索引 `(a, b, c)` 底层按 a 排序 -> a 相同按 b -> b 相同按 c

| SQL 条件 | 能否用索引 | 原因 |
|---------|-----------|------|
| `where a = 1` | 能 | 匹配最左 |
| `where a = 1 and b = 2` | 能 | 匹配最左两个 |
| `where a = 1 and b = 2 and c = 3` | 能 | 完全匹配 |
| `where a = 1 and c = 3` | 部分 | a 能用，c 跳过 b 不能直接利用 |
| `where b = 2` | 不能 | 缺少最左 a |
| `where c = 3` | 不能 | 缺少最左 a |
| `where b = 2 and c = 3` | 不能 | 缺少最左 a |

---

## 五、联合索引字段顺序设计

### 核心经验

- **等值匹配字段放前面**
- **范围查询字段放后面**
- **排序字段看能否一起利用索引**
- **高频查询场景优先设计**

### 案例 1：订单列表

```sql
select id, order_no, order_status, create_time
from order_info
where user_id = ?
  and order_status = ?
order by create_time desc
limit 20;
```

推荐索引：`(user_id, order_status, create_time)`
- user_id：高频等值过滤
- order_status：进一步等值过滤
- create_time：支持排序

### 案例 2：范围查询要小心

```sql
where user_id = ? and create_time > ? and status = ?
```

| 索引方案 | 问题 |
|---------|------|
| `(user_id, create_time, status)` | create_time 范围后，status 利用受限 |
| `(user_id, status, create_time)` | **推荐** -- 等值在前，范围在后 |

---

## 六、索引失效的 8 大场景

| 场景 | 示例 | 修复 |
|------|------|------|
| 不符合最左前缀 | `where b = 1` 索引 `(a,b,c)` | 调整查询或索引 |
| 索引列做函数 | `where date(create_time) = '...'` | 改为范围 `>= ... AND < ...` |
| 索引列做计算 | `where age + 1 = 20` | 改为 `where age = 19` |
| 隐式类型转换 | `where phone = 13800000000`（phone 是 varchar） | 参数类型与字段类型一致 |
| like 前导 % | `where name like '%张三'` | 改为 `'张%'` 或用全文索引 |
| or 使用不当 | `where phone = 'x' or name = 'y'` | 确保两侧都有高效索引 |
| 低区分度字段 | `where is_deleted = 0`（99% 都是 0） | 结合其他字段做联合索引 |
| 范围查询后列受限 | `where a = 1 and b > 2 and c = 3` 索引 `(a,b,c)` | 调整索引顺序，把 c 放 b 前面 |

---

## 七、不适合单独建索引的字段

| 类型 | 原因 | 示例 |
|------|------|------|
| 低区分度 | 优化器认为扫表更快 | 性别、is_deleted |
| 超长字段 | 索引体积大、维护成本高 | 超长标题、URL |
| 更新频繁 | 索引越多写入越慢 | 频繁变更的计数字段 |
| 很少查询 | 纯浪费 | 几乎不出现在 where 中的字段 |

---

## 八、前缀索引

```sql
create index idx_email_prefix on user(email(20));
```

| 优点 | 缺点 |
|------|------|
| 节省索引空间 | 区分度可能不足 |
| 减少维护成本 | 无法覆盖索引 |
| | 排序/group by 支持有限 |

适用：邮箱、URL 等长字符串但前缀区分度高的场景

---

## 九、索引的代价（不是越多越好）

1. **占磁盘空间** -- 每个索引都是一棵 B+ 树
2. **影响写入性能** -- INSERT/UPDATE/DELETE 时索引也要同步维护
3. **增加页分裂** -- 更新频繁的表尤其明显
4. **优化器选择复杂化** -- 索引太多可能导致错误选择

> 索引要围绕核心查询场景来建，而不是围绕字段来建

---

## 十、EXPLAIN 使用指南

```sql
EXPLAIN SELECT * FROM order_info WHERE user_id = 1001;
```

### 关键字段

| 字段 | 含义 | 关注点 |
|------|------|--------|
| **type** | 访问类型 | ALL = 全表扫描，要警惕 |
| **key** | 实际使用的索引 | NULL = 没用索引 |
| **possible_keys** | 可能可用的索引 | |
| **rows** | 预估扫描行数 | 越大风险越高 |
| **Extra** | 额外信息 | 见下表 |

### type 性能排序（好 -> 差）

```
const > eq_ref > ref > range > index > ALL
```

### Extra 常见值

| 值 | 含义 |
|----|------|
| Using index | 使用覆盖索引 |
| Using where | 需要额外条件过滤 |
| Using filesort | 无法用索引排序，需额外排序 |
| Using temporary | 使用临时表，通常 group by/order by 时出现 |

---

## 十一、实战索引设计案例

### 案例 1：按手机号查用户

```sql
select id, name from user where phone = ?;
```

```sql
unique index uk_phone(phone)   -- 手机号唯一 + 等值高频
```

### 案例 2：用户订单列表

```sql
select id, order_no, order_status, create_time
from order_info where user_id = ?
order by create_time desc limit 20;
```

```sql
index idx_user_ctime(user_id, create_time)
-- 或带状态筛选：
index idx_user_status_ctime(user_id, order_status, create_time)
```

### 案例 3：后台查待支付订单

```sql
select id, order_no from order_info
where order_status = 1 and create_time >= ? and create_time < ?;
```

```sql
index idx_status_ctime(order_status, create_time)
```

### 案例 4：错误示范

```sql
select * from order_info where is_deleted = 0;
-- 99% 数据 is_deleted=0，单独建索引没意义
```

---

## 十二、大厂常见索引设计坑

| 坑点 | 问题 |
|------|------|
| 单列索引建一堆，没联合索引 | 不如一个联合索引有效 |
| 联合索引顺序拍脑袋 | 必须结合 where/order by/高频场景 |
| 低区分度字段放前面 | `(is_deleted, status, user_id)` 价值低 |
| 为"可能用到"而建索引 | 应服务当前高频核心查询 |
| 忽视覆盖索引价值 | 好的索引设计可避免回表 |

---

## 十三、工作中索引设计 5 步法

1. **找高频 SQL** -- 不要先看表结构，先看真实查询场景
2. **确定 where / order by / select 字段** -- 过滤、排序、返回
3. **优先设计联合索引** -- 围绕查询场景而非单个字段
4. **看是否能减少回表** -- 高频查询可设计成覆盖索引
5. **用 EXPLAIN 验证** -- 是否用目标索引、扫描行数、filesort、temporary

---

## 十四、面试高频题

### 1. MySQL 为什么用 B+ 树不用红黑树？

磁盘 IO 是核心成本 -> B+ 树矮胖层级少 -> 非叶节点只存 key 容纳更多分支 -> 叶子链表适合范围查询排序

### 2. 聚簇索引和二级索引区别？

聚簇索引叶子存整行数据 -> 二级索引叶子存索引列值+主键 -> InnoDB 按主键组织 -> 查二级索引通常需要回表

### 3. 什么是回表？

二级索引找主键 -> 主键索引查整行 -> 这个过程叫回表

### 4. 什么是覆盖索引？

查询字段都在索引中 -> 不需要回表 -> 减少 IO 提高性能

### 5. 最左前缀原则？

联合索引按最左字段匹配 -> `(a,b,c)` 支持 `(a)`/`(a,b)`/`(a,b,c)` -> 不能跳过 a 直接用 b/c

### 6. 索引失效有哪些情况？

不符合最左前缀 / 索引列函数计算 / 隐式类型转换 / like 前导% / or 不当 / 范围查询后受限 / 低区分度优化器放弃

---

## 补充：二级索引叶子节点为什么自动带主键

### 核心结论

> 二级索引里有主键值，是为了定位和覆盖；但联合索引的匹配规则，只认你显式建进去的那些列。

### 存储结构 vs 索引规则

```sql
CREATE TABLE user (
  id BIGINT PRIMARY KEY,
  name VARCHAR(50),
  age INT,
  city VARCHAR(50),
  phone VARCHAR(20),
  INDEX idx_name_age(name, age)
);
```

索引 `idx_name_age(name, age)` 的叶子节点实际存储：

```
(name, age, id)

例:
('张三', 20) -> id=1
('张三', 20) -> id=8
('张三', 22) -> id=3
('李四', 18) -> id=5
```

但排序规则仍然是**先 name 再 age**，id 只是附带信息。

### 两层能力对比

| 层面 | 决定因素 | 作用 |
|------|---------|------|
| **索引匹配/排序规则** | 显式定义的列 `(name, age)` | 最左匹配、范围查找、排序能力 |
| **叶子节点附带主键** | InnoDB 自动存 id | 覆盖索引返回 id、回表定位整行 |

### 回表判断速查

| SQL | 是否回表 | 原因 |
|-----|---------|------|
| `select id, name from user where name = '张三'` | 不回表 | id/name 都在索引里 |
| `select id, name, age from user where name = '张三'` | 不回表 | id/name/age 都在索引里 |
| `select city from user where name = '张三'` | 回表 | city 不在索引里 |
| `select * from user where name = '张三'` | 回表 | 需要所有字段 |
| `select * from user where age = 20` | 不能用索引 | 缺少最左列 name |

### 为什么不能当 `(name, age, id)` 用？

| 对比项 | `(name, age)` + 自动附带 id | 真正的 `(name, age, id)` 联合索引 |
|--------|---------------------------|--------------------------------|
| 排序规则 | 按 name -> age | 按 name -> age -> id |
| 最左匹配 | 只认 name, age | 认 name, age, id 三列 |
| id 用于查找 | 找到范围后再过滤 | 直接参与索引定位 |
| `where name=? and age=? and id=?` | 先按 name/age 找范围，再筛 id | 三列联合精确缩小范围 |

### 面试回答模板

> InnoDB 二级索引叶子节点确实存储主键值，这是为了回表定位和支持覆盖索引。但联合索引的匹配规则和排序规则由显式定义的索引列决定。主键 id 不参与最左匹配和排序语义，不能当成真正的 `(name, age, id)` 联合索引。

---

## 练习题（待完成）

- [ ] 练习 1：为订单列表 SQL 设计最合适的索引并说明原因
- [ ] 练习 2：联合索引 `(a,b,c)` 判断 5 条 SQL 能否用索引
- [ ] 练习 3：`where date(create_time) = '...'` 为什么索引失效，怎么改
