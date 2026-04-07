# MySQL 学习笔记

> 基于《MySQL 必知必会》自学路线，逐步记录每讲学习重点
> 开始日期：2026-04-07

---

# 第 1 讲：MySQL 表结构设计与字段类型选择

## 核心结论（10 条必记）

1. **表设计是数据库优化的起点** -- 错误的表设计，后面靠复杂 SQL、索引、缓存去补救
2. **字段类型要小而够用** -- 字段越小，索引越小，IO 越少，性能越好
3. **金额必须用 decimal 或最小货币单位整数** -- float/double 有精度问题
4. **大多数业务时间字段优先 datetime** -- timestamp 受时区影响
5. **每张表都要有显式主键** -- InnoDB 没主键会生成隐藏主键，不利维护
6. **主键尽量用 bigint unsigned，无业务含义** -- 业务字段单独建唯一索引
7. **不要滥用 NULL** -- 能 NOT NULL 就 NOT NULL，给合理默认值
8. **状态字段一字段一语义** -- 不要把多个维度混在一个 status 字段里
9. **互联网业务常常需要合理反范式** -- 适度冗余提升查询效率
10. **建表时就要考虑未来的查询方式** -- 查询模式决定索引设计

---

## 一、表设计 5 大原则

| 原则 | 要点 | 反面教材 |
|------|------|---------|
| 类型简单够用 | 年龄 tinyint，不要 bigint | 所有数字都用 bigint |
| 字段有明确语义 | order_status、pay_status | 模糊的 status、type、flag |
| 避免 NULL 泛滥 | NOT NULL + 合理默认值 | 所有字段允许 NULL |
| 先业务后范式 | 核心一致性 + 适度冗余 | 纯范式化导致十几张表 join |
| 想清查询模式 | 按什么查？列表多还是单条多？ | 建完表才发现没考虑索引 |

---

## 二、字段类型速查表

### 整数类型

| 类型 | 字节 | 典型用途 |
|------|------|---------|
| tinyint unsigned | 1 | 年龄、状态码 |
| smallint | 2 | 较小范围的计数 |
| int unsigned | 4 | 数量、外键关联 |
| bigint unsigned | 8 | 主键、大数量 |

> 注意：`int(11)` 里的 11 只是显示宽度，不是存储长度

### 字符串类型

| 类型 | 场景 | 示例 |
|------|------|------|
| char | 定长、变化不大 | MD5(32位)、国家码、性别代码 |
| varchar | 变长，最常用 | 用户名、手机号、地址、标题 |
| text | 大文本 | 文章内容、日志、JSON 报文 |

> 大部分业务字符串优先 varchar，固定长度再考虑 char，不要轻易上 text

### 金额字段

- **禁止**：float、double（精度问题，0.1 + 0.2 != 0.3）
- **推荐**：`decimal(10,2)` 或以"分"为单位存 `bigint`
- 所有金额相关（价格、余额、优惠）必须统一规范

### 时间字段

| 类型 | 特点 | 适用场景 |
|------|------|---------|
| datetime | 范围大、与时区关系弱 | 业务时间（create_time、update_time）|
| timestamp | 存储小、与时区相关、范围小 | 系统记录时间 |

> 跨时区部署或数据迁移时 timestamp 容易出问题，多数团队统一用 datetime

### 布尔值

- 用 `tinyint(1)`，0=否，1=是
- 不要用 Y/N 字符串或 true/false

### 枚举值

- 推荐 `tinyint/smallint + 业务字典定义`
- 不推荐 `enum`（扩展难、迁移成本高、跨语言兼容差）

---

## 三、主键设计要点

### 为什么主键设计很重要？

InnoDB 是**聚簇索引**，数据按主键组织，主键影响整张表和所有二级索引。

### 选型对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| bigint 自增 | 有序递增、插入性能好、页分裂少 | 分库分表全局唯一难、暴露数据量 | 单库单表 |
| 雪花 ID | 全局唯一、趋势递增 | 更大更复杂、时钟回拨风险 | 分布式系统 |

### 核心原则

- 主键最好**无业务含义**
- 不要用手机号、订单号字符串、身份证号做主键（长度大、二级索引胖、业务耦合）
- 业务字段单独建唯一索引

---

## 四、必备通用字段

```sql
id              -- 主键
create_time     -- 创建时间
update_time     -- 更新时间
is_deleted      -- 逻辑删除标记
-- 可选
creator_id      -- 创建人
updater_id      -- 更新人
version         -- 乐观锁版本号
remark          -- 备注
```

### 物理删除 vs 逻辑删除

| 方式 | 优点 | 缺点 |
|------|------|------|
| 物理删除 (DELETE) | 节省空间 | 恢复困难、审计不便 |
| 逻辑删除 (is_deleted) | 可恢复、方便审计 | 查询要过滤、数据膨胀 |

- 核心交易数据：谨慎物理删除
- 用户可恢复类数据：常用逻辑删除
- 归档数据：定期清理

---

## 五、反范式合理冗余

### 为什么互联网业务常反范式？

纯范式化 = 表多 + join 多 = 高并发下性能差

### 合理冗余场景

- 订单中的商品名称/价格快照
- 订单中的收货地址快照
- 用户表中的统计字段（订单数、粉丝数）
- 列表页需要的展示字段

### 冗余前要问

1. 这是为了性能还是为了历史快照？
2. 数据更新频率高吗？
3. 一致性怎么保证？
4. 是否有异步修正机制？

---

## 六、实战案例：订单表 + 订单明细表

### 订单表设计要点

```sql
CREATE TABLE `order_info` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `order_status` TINYINT NOT NULL COMMENT '订单状态',
  `pay_status` TINYINT NOT NULL DEFAULT 0 COMMENT '支付状态',
  `total_amount` DECIMAL(12,2) NOT NULL COMMENT '订单总金额',
  `pay_amount` DECIMAL(12,2) NOT NULL COMMENT '实付金额',
  `receiver_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '收货人姓名',
  `receiver_phone` VARCHAR(20) NOT NULL DEFAULT '' COMMENT '收货人手机号',
  `receiver_address` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '收货地址',
  `remark` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '订单备注',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `is_deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';
```

关键设计点：
- 主键 bigint，订单号单独唯一索引
- 金额 decimal，状态字段拆分（order_status / pay_status）
- 收货信息做快照，逻辑删除字段保留

### 订单明细表

```sql
CREATE TABLE `order_item` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_id` BIGINT UNSIGNED NOT NULL COMMENT '订单ID',
  `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
  `product_name` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '商品名称快照',
  `product_price` DECIMAL(12,2) NOT NULL COMMENT '商品单价快照',
  `quantity` INT UNSIGNED NOT NULL COMMENT '购买数量',
  `total_amount` DECIMAL(12,2) NOT NULL COMMENT '明细总金额',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单明细表';
```

> 冗余 product_name 和 product_price -- 订单必须保留当时交易快照

---

## 七、大厂常见坑点

| 坑点 | 问题 | 正确做法 |
|------|------|---------|
| 一个字段存多个值（tag_ids="1,2,3"） | 违反范式、无法索引、统计麻烦 | 单独建关联表 |
| 状态字段混用 | 一个 status 塞所有维度 | 一字段一语义 |
| 字段过度预留（field1/ext1） | 不可维护、可读性差 | 规范命名或引入扩展表 |
| 所有字段允许 NULL | 代码和 SQL 判断混乱 | NOT NULL + 默认值 |
| text 存结构化数据 | 后续查询优化几乎不可能 | 拆表或谨慎用 JSON |
| 不留审计字段 | 排查问题痛苦 | 必须有 create_time/update_time |

---

## 八、建表前必问 8 个问题

1. 这张表的核心业务是什么？
2. 一行数据代表什么实体？
3. 主键是什么？
4. 哪些字段必须有，哪些可选？
5. 哪些字段会频繁查询？
6. 哪些字段将来可能变化？
7. 哪些信息需要冗余快照？
8. 数据量大了以后，会不会成为热点表？

---

## 九、面试高频题

### 1. 为什么不建议用字符串做主键？

主键索引更大 -> 二级索引都存主键值 -> 索引膨胀 -> 比较效率低 -> 插入查询性能差 -> 业务字段可能变化不稳定

### 2. 金额为什么不用 double？

浮点数精度问题 -> 0.1+0.2!=0.3 -> 货币计算必须精确 -> 用 decimal 或最小货币单位存整数

### 3. datetime 和 timestamp 怎么选？

datetime 范围大适合业务时间，timestamp 依赖时区范围小，大多数场景推荐 datetime

### 4. 为什么一般不建议外键？

增加数据库层耦合 -> 影响高并发写入 -> 分库分表后难用 -> 应用层保证一致性

### 5. 为什么要有冗余字段？

减少 join -> 提升查询效率 -> 保留历史快照 -> 适应高并发（但增加一致性维护成本）

---

## 练习题（待完成）

- [ ] 练习 1：设计用户表（手机号注册、昵称、状态管理、逻辑删除）
- [ ] 练习 2：设计商品表（名称、价格、库存、上下架、分类）
- [ ] 练习 3：为什么订单表要冗余商品名称/价格/地址而不是关联查询？

---

---
---

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

## 练习题（待完成）

- [ ] 练习 1：为订单列表 SQL 设计最合适的索引并说明原因
- [ ] 练习 2：联合索引 `(a,b,c)` 判断 5 条 SQL 能否用索引
- [ ] 练习 3：`where date(create_time) = '...'` 为什么索引失效，怎么改

---

### 第 2 讲补充：二级索引叶子节点为什么自动带主键

#### 核心结论

> 二级索引里有主键值，是为了定位和覆盖；但联合索引的匹配规则，只认你显式建进去的那些列。

#### 存储结构 vs 索引规则

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

#### 两层能力对比

| 层面 | 决定因素 | 作用 |
|------|---------|------|
| **索引匹配/排序规则** | 显式定义的列 `(name, age)` | 最左匹配、范围查找、排序能力 |
| **叶子节点附带主键** | InnoDB 自动存 id | 覆盖索引返回 id、回表定位整行 |

#### 回表判断速查

| SQL | 是否回表 | 原因 |
|-----|---------|------|
| `select id, name from user where name = '张三'` | 不回表 | id/name 都在索引里 |
| `select id, name, age from user where name = '张三'` | 不回表 | id/name/age 都在索引里 |
| `select city from user where name = '张三'` | 回表 | city 不在索引里 |
| `select * from user where name = '张三'` | 回表 | 需要所有字段 |
| `select * from user where age = 20` | 不能用索引 | 缺少最左列 name |

#### 为什么不能当 `(name, age, id)` 用？

| 对比项 | `(name, age)` + 自动附带 id | 真正的 `(name, age, id)` 联合索引 |
|--------|---------------------------|--------------------------------|
| 排序规则 | 按 name -> age | 按 name -> age -> id |
| 最左匹配 | 只认 name, age | 认 name, age, id 三列 |
| id 用于查找 | 找到范围后再过滤 | 直接参与索引定位 |
| `where name=? and age=? and id=?` | 先按 name/age 找范围，再筛 id | 三列联合精确缩小范围 |

#### 面试回答模板

> InnoDB 二级索引叶子节点确实存储主键值，这是为了回表定位和支持覆盖索引。但联合索引的匹配规则和排序规则由显式定义的索引列决定。主键 id 不参与最左匹配和排序语义，不能当成真正的 `(name, age, id)` 联合索引。

---
---

# 第 3 讲：事务、ACID、redo log、undo log、binlog

## 核心结论（10 条必记）

1. **事务是一组要么全成功、要么全失败的操作**
2. **ACID 是事务的四大特性** -- 原子性、一致性、隔离性、持久性
3. **原子性主要依赖 undo log**
4. **持久性主要依赖 redo log**
5. **binlog 主要用于主从复制和恢复**
6. **redo log 是引擎层物理日志** -- InnoDB 特有
7. **binlog 是 Server 层逻辑日志** -- 所有引擎通用
8. **MySQL 用 WAL（Write-Ahead Logging）提高写性能** -- 先写日志再刷数据页
9. **两阶段提交保证 redo log 和 binlog 一致**
10. **大事务是线上高危问题，要尽量避免**

---

## 一、事务是什么

> 一组操作，要么全部成功，要么全部失败。保证数据从一个一致状态变到另一个一致状态。

```sql
-- 转账示例
BEGIN;
UPDATE account SET balance = balance - 100 WHERE user_id = A;
UPDATE account SET balance = balance + 100 WHERE user_id = B;
COMMIT;  -- 成功则提交
-- ROLLBACK;  -- 失败则回滚
```

---

## 二、ACID 四大特性

| 特性 | 含义 | 举例 |
|------|------|------|
| **A**tomicity 原子性 | 不可再分，要么全成功要么全失败 | 转账两步必须一起成功 |
| **C**onsistency 一致性 | 事务前后数据保持一致 | 转账前后 A+B 总金额不变 |
| **I**solation 隔离性 | 并发事务互不干扰 | 同时扣库存不会超卖 |
| **D**urability 持久性 | 提交后永久生效，宕机不丢 | 支付成功后状态不会变回 |

> 一致性是最终目标，原子性/隔离性/持久性都是为了帮助实现一致性

---

## 三、MySQL 整体架构：Server 层 vs 引擎层

```
+----------------------------------+
|          Server 层               |
|  连接管理 / SQL解析 / 优化器     |
|  执行器 / binlog                 |
+----------------------------------+
|        存储引擎层 (InnoDB)       |
|  数据存储 / 索引 / 事务 / 锁    |
|  Buffer Pool / redo log / undo log|
+----------------------------------+
```

- **Server 层**：接收 SQL、理解 SQL、决定怎么执行
- **InnoDB 引擎层**：真正存取数据、管事务、管锁、管索引、管日志

---

## 四、Buffer Pool -- 内存缓存区

> InnoDB 用来缓存数据页和索引页的内存区域，用于减少磁盘 IO

### 为什么需要？

磁盘慢、内存快 -> 把热点数据缓存到内存

### 工作方式

- 数据按**页**管理，通常 16KB 一页
- 读：先查 Buffer Pool，没有再从磁盘加载
- 写：先在 Buffer Pool 中修改，记录 redo log，后台线程择机刷盘

### 更新流程

```
1. 数据页加载到 Buffer Pool
2. 在内存中修改
3. 记录 redo log
4. 后台线程择机刷盘（不是立刻）
```

> Buffer Pool 大小和命中率直接影响性能

---

## 五、三种日志对比

| 维度 | undo log | redo log | binlog |
|------|----------|----------|--------|
| 所属层 | InnoDB 引擎层 | InnoDB 引擎层 | Server 层 |
| 日志类型 | 逻辑日志 | 物理日志 | 逻辑日志 |
| 记录内容 | 修改前的旧值 | 某页做了什么修改 | 执行了什么变更操作 |
| 核心作用 | 回滚 + MVCC 历史版本 | 崩溃恢复 | 主从复制 + 增量恢复 |
| 写入方式 | 事务中持续写 | 循环写 | 追加写 |
| 生活类比 | "后悔药" | "施工记录" | "业务流水账" |

### undo log -- 后悔药

修改前记录旧值，失败时按它回滚。同时也是 MVCC 的历史版本仓库。

### redo log -- 施工记录

记录已做但可能还没落盘的修改。宕机后按它重建。核心思路：**先写日志再刷数据页（WAL）**。

### binlog -- 业务流水账

记录所有变更操作。从库按它同步数据，也可按时间点恢复误删数据。

---

## 六、为什么不能直接刷数据页？

数据库页 16KB，每次改一行都把整页刷盘太慢。

解决：**WAL（Write-Ahead Logging）**

```
先写日志（redo log） -> 再慢慢刷数据页
```

- 性能好（日志是顺序写，数据页是随机写）
- 安全（日志落盘后，宕机能恢复）

---

## 七、事务提交流程

```sql
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

```
第1步: 写 undo log      -> 记录旧值，保证能回滚
第2步: 修改 Buffer Pool  -> 数据页在内存中修改
第3步: 写 redo log      -> 保证宕机可恢复
第4步: 写 binlog        -> 保证复制和恢复
第5步: 提交成功          -> 关键日志落盘后才算真正提交
```

---

## 八、两阶段提交（2PC）

### 为什么需要？

redo log 和 binlog 分属不同层，如果写入时机不一致：
- 主库数据和 binlog 不一致
- 主从复制出问题
- 恢复出问题

### 流程

```
1. prepare 阶段  -> redo log 写入并标记 prepare
2. 写 binlog     -> binlog 落盘
3. commit 阶段   -> redo log 标记 commit
```

> 即使中间宕机，也能根据 redo log 状态判断事务是否真正提交

---

## 九、大事务的危害

| 危害 | 原因 |
|------|------|
| 锁持有时间长 | 事务没提交，锁不释放，阻塞其他事务 |
| undo log 膨胀 | 事务越大，回滚代价越高，版本链更长 |
| redo log 压力大 | 短时间大量修改，日志刷盘压力大 |
| 主从复制延迟 | binlog 很大，从库回放变慢 |
| 回滚成本高 | 失败后回滚时间很长 |

### 典型错误

```sql
begin;
update order_info set status = 2 where create_time < '2024-01-01';  -- 几十万行
commit;
```

### 正确做法

分批处理 / 小事务提交 / 控制事务持续时间

---

## 十、自动提交机制

MySQL 默认 `autocommit = 1`，每条 SQL 是一个独立事务。

需要显式事务的场景：转账、下单+扣库存+写支付流水、批量一致性更新

---

## 十一、MVCC -- 多版本并发控制

> 通过数据的多个历史版本，让普通读在并发下也能读到一致数据，读不阻塞写，写不阻塞普通读

### 核心原理

一条记录不是只有当前值，而是保留历史版本链。不同事务根据可见性规则看到不同版本。

### 依赖组件

- **undo log** -- 提供历史版本
- **隐藏字段** -- 记录事务信息
- **Read View** -- 决定可见性

### undo log 与 MVCC 的关系

> undo log 既是"回滚工具"，也是"历史版本仓库"

数据更新时，旧值通过 undo log 串成版本链，事务读数据时沿版本链找自己能看到的版本。

---

## 十二、主从复制

### 架构

```
应用 -> 主库（写）
应用 -> 从库（读）
```

- **主库**：负责写操作
- **从库**：复制主库数据，提供读服务

### 复制流程（依赖 binlog）

```
1. 主库执行写操作 -> 记录到 binlog
2. 从库拉取主库的 binlog
3. 从库重放这些操作 -> 数据保持一致
```

### 读写分离

大多数业务读远多于写，把读分散到从库减轻主库压力。

### 主从延迟

主库刚写完，从库还没来得及拉取/执行 -> 主从数据暂时不一致

典型问题：刚下单写入主库，马上从从库查可能查不到。

---

## 十三、两种"恢复"的区别

| | redo log 恢复 | binlog 恢复 |
|--|-------------|-----------|
| 场景 | 宕机后已提交数据不丢 | 误删/误更新后的历史恢复 |
| 方式 | 重启后根据 redo log 补回修改 | 先恢复备份 + 按 binlog 重放到误操作前 |
| 类型 | 引擎级崩溃恢复 | 业务级增量恢复 |

---

## 十四、一条更新 SQL 的完整链路

```sql
update user set age = 20 where id = 1;
```

```
Server 层:
  解析 SQL -> 选择执行计划 -> 调用 InnoDB

InnoDB 层:
  找到数据页 -> 加载到 Buffer Pool
  -> 写 undo log（可回滚）
  -> 在 Buffer Pool 中修改
  -> 写 redo log（可崩溃恢复）

Server 层:
  写 binlog（给从库复制 + 恢复用）

两阶段提交保证 redo log 和 binlog 一致
```

---

## 十五、概念速记口诀

> **Buffer Pool 是内存缓存区；**
> **InnoDB 是真正存数据的引擎；**
> **undo log 负责回滚和历史版本；**
> **MVCC 负责并发读一致性；**
> **redo log 负责宕机恢复；**
> **binlog 负责主从复制和增量恢复；**
> **主从复制就是主库写、从库跟着抄。**

---

## 十六、面试高频题

### 1. ACID 是什么？

原子性(全成功/全失败) -> 一致性(前后数据一致) -> 隔离性(并发互不干扰) -> 持久性(提交后不丢)

### 2. undo log 和 redo log 区别？

undo log 记录修改前旧值 -> 用于回滚和 MVCC
redo log 记录修改后物理变更 -> 用于崩溃恢复，保证持久性

### 3. redo log 和 binlog 区别？

redo log: InnoDB 引擎层 / 物理日志 / 循环写 / 崩溃恢复
binlog: Server 层 / 逻辑日志 / 追加写 / 主从复制和恢复

### 4. 为什么需要两阶段提交？

redo log 和 binlog 分属不同层 -> 写入时机不一致会导致数据和复制日志不一致 -> 两阶段提交保证两者一致

---

## 练习题（待完成）

- [ ] 练习 1：转账场景为什么必须用事务？不用事务最坏会怎样？
- [ ] 练习 2：用一句话概括 undo log / redo log / binlog 各自作用
- [ ] 练习 3：为什么事务提交成功后 MySQL 崩溃数据不丢？
- [ ] 练习 4：为什么 MySQL 不能只要 redo log 不要 binlog？

---

---
---

# 第 4 讲：事务隔离级别、脏读、不可重复读、幻读

## 核心结论（10 条必记）

1. **事务隔离级别解决的是并发事务互相影响的问题**
2. **脏读是读到未提交数据**
3. **不可重复读是同一行前后读不一致**
4. **幻读是同条件范围查询结果集发生变化**
5. **Read Uncommitted 隔离性最差，生产几乎不用**
6. **Read Committed 可以避免脏读，但不能避免不可重复读**
7. **Repeatable Read 可以避免不可重复读，是 MySQL 默认级别**
8. **Serializable 隔离最强，但性能最差**
9. **MVCC 主要用于 RC、RR 下的快照读**
10. **MySQL 对幻读的处理是 MVCC + 锁机制共同完成的**

---

## 一、并发事务的 3 类经典问题

### 脏读（Dirty Read）

读到另一个事务**还没提交**的数据。如果对方回滚，读到的就是无效数据。

```
T2: update balance 1000->900 (未提交)
T1: select balance -> 读到 900 (脏数据)
T2: rollback -> 恢复成 1000
```

### 不可重复读（Non-repeatable Read）

同一事务内，**同一行**数据前后两次读取结果不同。

```
T1: select balance -> 1000
T2: update balance 1000->900; commit;
T1: select balance -> 900 (同一行变了)
```

### 幻读（Phantom Read）

同一事务内，**同条件范围查询**结果集行数变化（多了或少了行）。

```
T1: select count(*) where user_id=1001 -> 5
T2: insert user_id=1001 的新订单; commit;
T1: select count(*) where user_id=1001 -> 6 (多了一行)
```

### 区别速记

| 问题 | 核心表现 | 记忆法 |
|------|---------|--------|
| 脏读 | 读到未提交数据 | "不靠谱的数据" |
| 不可重复读 | 同一行前后不一致 | "同一行变了" |
| 幻读 | 范围查询行数变化 | "行的数量变了" |

---

## 二、四种事务隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 说明 |
|---------|------|-----------|------|------|
| Read Uncommitted | 可能 | 可能 | 可能 | 最弱，生产几乎不用 |
| Read Committed (RC) | 不会 | 可能 | 可能 | Oracle 默认 |
| Repeatable Read (RR) | 不会 | 不会 | 理论可能，MySQL 控制更强 | **MySQL InnoDB 默认** |
| Serializable | 不会 | 不会 | 不会 | 最强，但并发性能差 |

> 隔离级别越高，一致性越强，但并发性能越低

---

## 三、RC vs RR 的核心区别

### Read Committed (RC)

- 每次读取生成**新的 Read View**
- 读的是**当前最新已提交版本**
- 可能不可重复读（因为每次读都看最新）

### Repeatable Read (RR)

- 事务第一次快照读时生成 Read View，之后**一直复用**
- 事务内多次读取结果一致
- 避免不可重复读

```
RC: 每次读 -> 新 Read View -> 可能看到别人已提交的更新
RR: 首次读 -> 固定 Read View -> 事务内始终一致
```

---

## 四、MySQL 为什么默认用 RR？

1. **一致性更强** -- 比 RC 多解决不可重复读
2. **MVCC 支撑** -- InnoDB 能高效实现 RR，性能损失不大
3. **业务需要** -- 订单/库存/账户类业务希望事务内视图稳定

---

## 五、快照读 vs 当前读

| 类型 | SQL 示例 | 特点 |
|------|---------|------|
| **快照读** | `select * from user where id = 1` | 走 MVCC，不加锁，读某个可见版本 |
| **当前读** | `select ... for update` / `update` / `delete` / `insert` | 读最新版本，加锁，考虑锁冲突 |

### MVCC 服务的对象

- 主要服务于 RC、RR 下的**快照读**
- 当前读要靠**锁机制**

---

## 六、RR 下幻读的争议

### 快照读场景

RR 借助 MVCC，第二次普通 `select` 通常看不到别人后插入的新行 -> 看起来避免了幻读

### 当前读场景

`select ... for update` / `update` 等读最新数据，需要靠**间隙锁 + 临键锁**阻止范围内插入新行

### 面试回答

> 标准 SQL 角度 RR 不能完全解决幻读，Serializable 才能彻底解决。MySQL InnoDB 中，普通快照读靠 MVCC 很多场景下看起来避免了幻读；当前读场景还需通过间隙锁、临键锁防止范围内插入，进一步控制幻读问题。

---

## 七、MySQL 并发控制的两条线

```
普通读一致性问题 -> 靠 MVCC 解决
  RC: 每次读新快照
  RR: 事务内复用快照

当前读下的并发插入/修改问题 -> 靠锁解决
  行锁 / 间隙锁 / 临键锁
```

> MySQL 的事务隔离不是只靠 MVCC，也不是只靠锁，而是**两者结合**

---

## 八、面试高频题

### 1. 脏读/不可重复读/幻读区别？

脏读: 读到未提交数据
不可重复读: 同一事务内同一行前后读结果不同
幻读: 同一事务内同条件范围查询结果集行数变化

### 2. MySQL 默认隔离级别？

InnoDB 默认 Repeatable Read（RR）

### 3. RC 和 RR 区别？

RC 每次读已提交最新版本，可能不可重复读
RR 事务内复用同一个 Read View，避免不可重复读，一致性更强

### 4. RR 能完全解决幻读吗？

标准角度不能完全解决。MySQL 中快照读靠 MVCC，当前读靠间隙锁/临键锁共同控制。

---

## 练习题（待完成）

- [ ] 练习 1：用账户余额举例说明脏读
- [ ] 练习 2：不可重复读和幻读的区别
- [ ] 练习 3：为什么 RC 会出现不可重复读，而 RR 不会？
- [ ] 练习 4：MySQL 默认为什么用 RR 而不是 RC？

---

## 下一讲预告

**第 5 讲：MVCC、Read View、快照读、当前读**

- MVCC 具体实现机制
- 隐藏字段是什么
- undo log 版本链怎么形成
- Read View 是什么
- RC 和 RR 为什么行为不同
- 快照读和当前读到底怎么区分
