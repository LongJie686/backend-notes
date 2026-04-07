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
