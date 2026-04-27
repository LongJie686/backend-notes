# 第 6 讲：高可用架构模式（下）——异地多活与微服务拆分

---

上一讲我们解决了单机房内的高可用问题。

这一讲解决两个更难的问题：

1. **机房级别的故障怎么办？** -> 异地多活
2. **系统越来越大怎么拆？** -> 微服务拆分

这两个都是大厂架构师必须掌握的核心能力，也是面试中最能拉开差距的考点。

---

## 一、为什么单机房不够？

先看一个真实场景：

```
某公司只有一个机房（北京）

某天发生：
- 机房所在楼层发生火灾
- 机房断电
- 运营商光纤被施工队挖断
- 机房遭受 DDoS 攻击

结果：
- 整个系统完全不可用
- 持续 2~4 小时
- 数据可能丢失
- 损失无法估量
```

**单机房的问题：**

| 风险 | 说明 |
|------|------|
| 自然灾害 | 洪水、地震、火灾 |
| 电力故障 | 断电、UPS 失效 |
| 网络故障 | 运营商故障、光纤被挖 |
| 硬件故障 | 大规模硬件同时损坏 |
| 人为故障 | 误操作、安全攻击 |

---

## 二、异地多活架构

### 1. 什么是异地多活？

> **异地多活（Multi-Active）：**
> 在不同地理位置部署多套完整的服务，每套都能独立对外提供服务，任意一个机房故障，其他机房可以接管全部流量。

**与灾备（备份）的区别：**

```
灾备（传统方案）：
主机房（正常服务）--单向复制--> 备机房（平时不服务）
主机房故障 -> 手动切换到备机房（分钟~小时级）
备机房平时是浪费的

异地多活：
机房 A（正常服务）<--双向同步--> 机房 B（正常服务）
任意机房故障 -> 流量自动切换（秒级）
两个机房都在创造价值
```

---

### 2. 异地多活的三种模式

#### 模式一：同城双活

```
+-----------------------------------------------------------+
|                      同一城市                              |
|                                                           |
|   +-------------------+        +-------------------+       |
|   |    机房 A         |        |    机房 B         |       |
|   |   （朝阳区）       |<------>|   （海淀区）       |       |
|   |                   |  专线  |                   |       |
|   |  对外服务         |  连接  |  对外服务         |       |
|   +-------------------+ 延迟<1ms+-------------------+       |
+-----------------------------------------------------------+
```

**特点：**
- 同城之间延迟极低（< 1ms）
- 专线连接，带宽大、稳定
- 数据同步简单（几乎实时）
- 能应对单机房故障

**不能解决：**
- 城市级别的灾难（大地震、大范围断网）

---

#### 模式二：跨城异地多活

```
+-------------------+                    +-------------------+
|    北京机房        |<---- 专线 30ms --->|    上海机房        |
|   （正常服务）     |                    |   （正常服务）     |
+-------------------+                    +-------------------+
         ^                                      ^
         | 30ms                                 | 30ms
         v                                      v
+-------------------+
|    深圳机房        |
|   （正常服务）     |
+-------------------+
```

**特点：**
- 跨城延迟 30~100ms
- 能应对城市级别的灾难
- 数据同步更复杂

**挑战：**
- 网络延迟高，强一致性难保证
- 数据同步复杂，可能冲突

---

#### 模式三：跨国异地多活

```
+----------+     >100ms<     +----------+     >200ms<     +----------+
|  中国     |<-------------->|  美国     |<-------------->|  欧洲     |
|  机房     |               |  机房     |               |  机房     |
+----------+               +----------+               +----------+
```

**特点：**
- 就近服务，用户访问延迟低
- 能应对跨国网络中断
- 复杂度极高

**适用：** 面向全球用户的产品（Uber、Airbnb 等）

---

### 3. 异地多活的核心挑战

异地多活听起来很美，但实现起来极难。核心挑战是：

#### 挑战一：数据同步问题

```
用户 A 在北京机房下单：
- 北京机房：订单创建成功
- 同步到上海机房（需要 30ms）
- 用户 A 立刻查询（请求被路由到上海）
- 上海机房：订单还没同步过来！

这就是跨机房的数据一致性问题。
```

---

#### 挑战二：数据写冲突

```
用户 A 和用户 B 同时抢一件库存为 1 的商品

北京机房：用户 A 扣减库存 1->0（成功）
上海机房：用户 B 扣减库存 1->0（成功）（还没收到北京的同步）

同步后：两个机房都认为成功，实际超卖了！
```

---

#### 挑战三：网络分区问题

```
北京机房 X-----------------X 上海机房
         网络分区，无法通信

问题：
- 两个机房都还在运行
- 都在接受写请求
- 数据无法同步
- 网络恢复后，如何合并冲突的数据？
```

---

### 4. 异地多活的设计四步法

这是《从0开始学架构》课程里最核心的方法论之一。

```
第一步：业务分级
    |
第二步：数据分类
    |
第三步：数据同步
    |
第四步：异常处理
```

---

#### 第一步：业务分级

**不是所有业务都需要异地多活。**

按业务重要性分级：

| 级别 | 业务 | 策略 |
|------|------|------|
| **核心业务** | 用户登录、下单、支付 | 异地多活，两个机房都能处理 |
| **重要业务** | 订单查询、商品详情 | 异地多活 |
| **一般业务** | 推荐、评论、活动 | 单机房即可，故障时降级 |
| **边缘业务** | 数据统计、日志分析 | 不需要多活 |

---

#### 第二步：数据分类

按数据特性分类，决定同步策略：

```python
"""
数据分类示例
"""

# 类型一：可以丢失的数据
# 重新生成成本低，不需要严格同步
lose_ok_data = [
    "用户操作日志",
    "搜索热词统计",
    "页面点击事件",
]

# 类型二：低价值、允许短暂不一致的数据
# 异步同步即可
low_consistency_data = [
    "用户个人资料",
    "商品详情",
    "用户收藏",
]

# 类型三：高价值、必须一致的数据
# 需要同步复制或特殊处理
high_consistency_data = [
    "账户余额",
    "订单数据",
    "库存数量",
    "优惠券使用状态",
]
```

---

#### 第三步：数据同步方案

**不同数据用不同同步方案：**

```
方案 A：异步复制（适合低一致性要求数据）
+------+              +------+
|机房A |--异步复制-->|机房B |
+------+  有延迟      +------+

方案 B：实时同步（适合高一致性要求数据）
+------+              +------+
|机房A |<--双向同步-->|机房B |
+------+  延迟极低     +------+

方案 C：只在一个机房写（最可靠，适合强一致数据）
用户路由：根据用户 ID，始终路由到同一机房
+------+              +------+
|机房A |  各写各的    |机房B |
|用户A写|              |用户B写|
+------+              +------+
```

---

#### 第四步：异常处理

提前设计各种故障场景的处理方案：

```python
"""
异常场景处理预案
"""

# 场景 1：机房 A 完全故障
# 处理：DNS 切换，所有流量转到机房 B

# 场景 2：机房 A 和 B 之间网络分区
# 处理：各自继续服务，等网络恢复后合并

# 场景 3：同步延迟过高
# 处理：关键操作降级到单机房处理

# 场景 4：数据冲突
# 处理：以某个机房为准，或业务规则解决
```

---

### 5. 核心解决方案：用户分区路由

**这是解决大多数异地多活问题的关键思路。**

```
核心思想：
同一个用户的所有请求，始终路由到同一个机房
不同用户路由到不同机房

这样：
- 同一用户的数据只在一个机房写
- 不存在同一数据被两个机房同时修改的问题
- 数据同步只需要异步复制（最终一致就行）
```

**实现：**

```python
"""
用户分区路由实现
"""
import hashlib
from enum import Enum


class Region(Enum):
    BEIJING = "beijing"
    SHANGHAI = "shanghai"
    SHENZHEN = "shenzhen"


class UserRegionRouter:
    """
    用户分区路由器

    根据用户 ID，将用户路由到固定的机房
    同一用户始终去同一机房（除非故障切换）
    """

    def __init__(self):
        # 机房配置
        self.regions = [
            Region.BEIJING,
            Region.SHANGHAI,
            Region.SHENZHEN,
        ]

        # 每个机房负责的用户比例（权重）
        self.weights = {
            Region.BEIJING: 40,   # 40% 用户
            Region.SHANGHAI: 35,  # 35% 用户
            Region.SHENZHEN: 25,  # 25% 用户
        }

        # 故障机房集合（故障时从这里移除）
        self.failed_regions: set = set()

    def get_region(self, user_id: int) -> Region:
        """
        根据用户 ID 获取所属机房

        使用一致性哈希确保：
        1. 同一用户始终路由到同一机房
        2. 机房故障时，只有该机房的用户受影响
        """
        # 过滤掉故障机房
        available_regions = [
            r for r in self.regions
            if r not in self.failed_regions
        ]

        if not available_regions:
            raise Exception("所有机房都故障了！")

        # 根据 user_id 计算哈希，路由到固定机房
        hash_val = int(hashlib.md5(str(user_id).encode()).hexdigest(), 16)

        # 计算权重总和
        total_weight = sum(
            self.weights[r] for r in available_regions
        )

        # 按权重路由
        hash_mod = hash_val % total_weight
        cumulative = 0

        for region in available_regions:
            cumulative += self.weights[region]
            if hash_mod < cumulative:
                return region

        return available_regions[-1]

    def mark_region_failed(self, region: Region):
        """标记机房故障"""
        self.failed_regions.add(region)
        print(f"[WARN] 机房 {region.value} 标记为故障，"
              f"其用户将被路由到其他机房")

    def mark_region_recovered(self, region: Region):
        """标记机房恢复"""
        self.failed_regions.discard(region)
        print(f"[OK] 机房 {region.value} 已恢复")

    def get_region_distribution(self, total_users: int = 1000) -> dict:
        """查看用户分布情况"""
        distribution = {r: 0 for r in self.regions}

        for user_id in range(total_users):
            try:
                region = self.get_region(user_id)
                distribution[region] += 1
            except Exception:
                pass

        return distribution


# ========== 演示 ==========
router = UserRegionRouter()

print("正常情况下的用户分布：")
dist = router.get_region_distribution(10000)
for region, count in dist.items():
    print(f"  {region.value}: {count} 用户 ({count/100:.1f}%)")

print("\n模拟北京机房故障：")
router.mark_region_failed(Region.BEIJING)

dist_after = router.get_region_distribution(10000)
print("故障后用户分布（北京用户被分配到其他机房）：")
for region, count in dist_after.items():
    if region not in router.failed_regions:
        print(f"  {region.value}: {count} 用户 ({count/100:.1f}%)")
```

---

### 6. 异地多活数据同步实现

```python
"""
跨机房数据同步方案

使用 MySQL binlog + 消息队列实现异步跨机房同步
"""
import asyncio
import json
import aioredis
from datetime import datetime


class CrossRegionDataSyncer:
    """
    跨机房数据同步器

    原理：
    1. 本机房写数据库时，同时写入 sync_log 表
    2. 同步服务读取 sync_log，通过消息队列发送到其他机房
    3. 其他机房消费消息，执行同步
    4. 幂等处理（防止重复同步）
    """

    def __init__(self, current_region: str, target_regions: list):
        self.current_region = current_region
        self.target_regions = target_regions
        self.redis = None

    async def initialize(self):
        self.redis = await aioredis.from_url(
            "redis://localhost:6379",
            decode_responses=True
        )

    async def publish_change(
        self,
        table: str,
        operation: str,  # INSERT / UPDATE / DELETE
        data: dict,
        user_id: int = None
    ):
        """
        发布数据变更事件到其他机房

        关键：只同步归属本机房的数据
        （避免 A->B->A 的循环同步）
        """
        # 判断数据是否归属本机房（避免循环同步）
        if user_id and self._get_user_region(user_id) != self.current_region:
            return  # 不是本机房的数据，不同步

        event = {
            "id": self._generate_event_id(),
            "source_region": self.current_region,
            "table": table,
            "operation": operation,
            "data": data,
            "timestamp": datetime.now().isoformat(),
            "user_id": user_id,
        }

        # 发布到每个目标机房的队列
        for target_region in self.target_regions:
            queue_key = f"sync_queue:{target_region}"
            await self.redis.rpush(queue_key, json.dumps(event))

    async def consume_changes(self):
        """消费其他机房发来的数据变更"""
        queue_key = f"sync_queue:{self.current_region}"

        print(f"[{self.current_region}] 开始消费同步队列...")

        while True:
            # 阻塞等待消息
            result = await self.redis.blpop(queue_key, timeout=5)

            if not result:
                continue

            _, message = result
            event = json.loads(message)

            try:
                await self._apply_change(event)
            except Exception as e:
                print(f"[{self.current_region}] 同步失败: {e}")
                # 写入失败队列，人工处理
                await self.redis.rpush(
                    f"sync_failed:{self.current_region}",
                    message
                )

    async def _apply_change(self, event: dict):
        """
        应用数据变更（幂等操作）
        """
        # 幂等检查：是否已经处理过这个事件
        idempotent_key = f"sync_applied:{event['id']}"

        already_applied = await self.redis.set(
            idempotent_key, "1",
            nx=True,      # 只有不存在时才设置
            ex=86400      # 24 小时过期
        )

        if not already_applied:
            print(f"[{self.current_region}] 事件已处理过，跳过: {event['id']}")
            return

        print(f"[{self.current_region}] 应用变更: "
              f"{event['operation']} {event['table']} "
              f"from {event['source_region']}")

        # 执行实际的数据库操作
        if event['operation'] == 'INSERT':
            await self._sync_insert(event['table'], event['data'])
        elif event['operation'] == 'UPDATE':
            await self._sync_update(event['table'], event['data'])
        elif event['operation'] == 'DELETE':
            await self._sync_delete(event['table'], event['data'])

    def _get_user_region(self, user_id: int) -> str:
        """获取用户归属机房"""
        # 简化版：按 user_id 奇偶分配
        if user_id % 2 == 0:
            return "beijing"
        return "shanghai"

    def _generate_event_id(self) -> str:
        import uuid
        return str(uuid.uuid4())

    async def _sync_insert(self, table: str, data: dict):
        """同步插入操作"""
        pass

    async def _sync_update(self, table: str, data: dict):
        """同步更新操作"""
        pass

    async def _sync_delete(self, table: str, data: dict):
        """同步删除操作"""
        pass
```

---

### 7. 什么时候需要异地多活？

**不是所有公司都需要异地多活。**

| 条件 | 说明 |
|------|------|
| **日活 > 100 万** | 规模足够，故障影响够大 |
| **业务强度高** | 7x24 不能停 |
| **有足够资金** | 异地多活成本是单机房的 2~3 倍 |
| **团队足够强** | 需要专门的技术人员维护 |
| **有明确 RTO 要求** | 故障恢复时间要求秒级 |

**大多数中小公司，先做好以下工作就够了：**

```
优先级：
1. 单机房内主从复制 + 自动切换
2. 同城双机房（低成本）
3. 完善监控报警
4. 灾备（定期备份）

等业务到了一定规模再考虑异地多活
```

---

## 三、微服务架构

### 1. 从单体到微服务的演进

```
阶段 1：单体应用（1-10人团队）
+----------------------------------------------+
|             单体应用                          |
|  用户模块 + 商品模块 + 订单模块 + ...          |
|             一个进程                          |
+----------------------------------------------+

问题：
- 代码越来越多，100 万行
- 10 个团队一起改一个代码库
- 一个小改动要整体测试和发布
- 一个模块故障可能影响全局

阶段 2：微服务（10人以上团队）
+----------+  +----------+  +----------+
| 用户服务  |  | 商品服务  |  | 订单服务  |
| 独立进程  |  | 独立进程  |  | 独立进程  |
| 独立部署  |  | 独立部署  |  | 独立部署  |
+----------+  +----------+  +----------+
       |              |              |
  用户团队        商品团队        订单团队
  独立开发        独立开发        独立开发
```

---

### 2. 微服务的优缺点

| 维度 | 优点 | 缺点 |
|------|------|------|
| **团队** | 独立开发、独立部署 | 需要更强的协调能力 |
| **技术** | 不同服务可选不同技术栈 | 技术多样性带来运维成本 |
| **扩展** | 按需扩展单个服务 | 分布式系统复杂度高 |
| **故障** | 故障隔离 | 分布式故障更难排查 |
| **数据** | 数据边界清晰 | 跨服务数据一致性难 |

---

### 3. 微服务拆分原则

#### 原则一：三个火枪手原则

> **一个微服务，最好由 3 个人负责维护。**

```
3 个人 -> 1 个服务（推荐）
6 个人 -> 2 个服务
12 个人 -> 4 个服务
30 个人 -> 10 个服务

反例：
3 个人 -> 15 个服务 [FAIL]（每人维护 5 个，太多了）
```

**为什么是 3 个人？**
- 1 个人：太少，离职就没人懂了
- 2 个人：轮换休假时无法独立工作
- 3 个人：可以轮换，形成三角稳定结构
- 太多人：一个服务太大，又需要拆分了

---

#### 原则二：高内聚、低耦合

```python
"""
判断服务拆分是否合理：

好的拆分：
- 服务内部：功能高度相关（高内聚）
- 服务之间：依赖尽量少（低耦合）
- 修改一个服务，不需要修改其他服务

坏的拆分：
"""

# [FAIL] 坏的拆分：按技术层拆分
# 这会导致一个业务功能分散在多个服务里
class ServiceByLayer:
    controller_service = "处理所有控制器"   # 坏
    dao_service = "处理所有数据访问"         # 坏
    business_service = "处理所有业务逻辑"    # 坏

# [OK] 好的拆分：按业务领域拆分
class ServiceByDomain:
    user_service = "用户注册、登录、信息管理"
    product_service = "商品上下架、价格、库存"
    order_service = "下单、取消、订单状态"
    payment_service = "支付、退款、对账"
```

---

#### 原则三：DDD（领域驱动设计）指导拆分

DDD 不是必须的，但是个很好的参考框架。

```python
"""
DDD 核心概念：

领域（Domain）：整个业务范围
子域（Subdomain）：业务的某个方面
限界上下文（Bounded Context）：一个服务的边界

电商系统的领域划分：
"""

domains = {
    "用户域": {
        "服务": "用户服务",
        "职责": ["注册", "登录", "权限", "个人信息"],
        "数据": ["用户表", "角色表", "权限表"],
    },
    "商品域": {
        "服务": "商品服务",
        "职责": ["商品管理", "分类管理", "库存管理"],
        "数据": ["商品表", "分类表", "库存表"],
    },
    "订单域": {
        "服务": "订单服务",
        "职责": ["创建订单", "取消订单", "订单状态流转"],
        "数据": ["订单表", "订单明细表"],
    },
    "支付域": {
        "服务": "支付服务",
        "职责": ["支付", "退款", "对账"],
        "数据": ["支付记录表", "退款表"],
    },
    "营销域": {
        "服务": "营销服务",
        "职责": ["优惠券", "活动", "积分"],
        "数据": ["优惠券表", "活动表", "积分表"],
    },
}
```

---

### 4. 微服务粒度如何把控？

这是最难的问题，没有标准答案，但有判断方法。

#### 拆太粗的问题

```
用户服务（太粗）：
- 注册/登录
- 用户信息
- 用户地址
- 用户行为
- 用户积分
- 用户等级
- 用户评价
...
```

问题：
- 一个服务承担太多职责
- 团队协作困难
- 发布影响范围大

---

#### 拆太细的问题

```
拆成 20 个服务：
- 注册服务
- 登录服务
- 头像服务
- 昵称服务
- 地址查询服务
- 地址修改服务
...
```

问题：
- 服务间调用链太长
- 分布式事务噩梦
- 运维复杂度爆炸
- 3 个人维护 20 个服务

---

#### 合理粒度的判断标准

```python
"""
微服务粒度判断清单
"""

def evaluate_service_granularity(service_name: str) -> dict:
    checklist = {
        "团队规模": {
            "问题": "这个服务需要几个人维护？",
            "合理范围": "2~5 人",
            "警告": "< 2 人（太细）或 > 10 人（太粗）"
        },
        "发布频率": {
            "问题": "这个服务多久发一次版本？",
            "合理范围": "独立发布，不影响其他服务",
            "警告": "每次发布都要联动 5+ 个服务"
        },
        "数据库边界": {
            "问题": "这个服务有自己的数据库吗？",
            "合理范围": "有独立的数据库",
            "警告": "和其他服务共用同一个数据库"
        },
        "接口稳定性": {
            "问题": "这个服务的接口频繁变更吗？",
            "合理范围": "接口相对稳定",
            "警告": "接口频繁变更，导致大量联动修改"
        },
        "故障隔离": {
            "问题": "这个服务故障时，影响范围是多少？",
            "合理范围": "只影响相关功能，不影响核心流程",
            "警告": "故障导致整个系统不可用"
        },
    }
    return checklist
```

---

### 5. 微服务基础设施

微服务不只是把代码拆开，还需要配套的基础设施。

```
+----------------------------------------------------------+
|                  微服务基础设施全景                         |
+----------------------------------------------------------+
|  API 网关          | 统一入口、认证、限流、路由              |
|  服务注册发现       | 服务在哪里？怎么找到它？               |
|  配置中心          | 配置统一管理、动态生效                 |
|  链路追踪          | 一个请求经过了哪些服务？                |
|  服务监控          | 每个服务的健康状态、性能指标             |
|  日志聚合          | 所有服务的日志统一收集分析               |
|  消息队列          | 服务间异步通信                         |
|  分布式事务        | 跨服务的数据一致性                     |
+----------------------------------------------------------+
```

---

### 6. Python 微服务实战

#### API 网关（用 FastAPI 实现）

```python
"""
API 网关：统一入口
职责：
1. 认证鉴权
2. 限流
3. 路由转发
4. 请求日志
5. 协议转换
"""
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
import jwt
import time
import logging

app = FastAPI(title="API Gateway")
security = HTTPBearer()

# 服务路由配置
SERVICE_ROUTES = {
    "/user": "http://user-service:8001",
    "/product": "http://product-service:8002",
    "/order": "http://order-service:8003",
    "/payment": "http://payment-service:8004",
}

JWT_SECRET = "your-secret-key"


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """JWT Token 验证"""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")


def get_target_service(path: str) -> str:
    """根据路径获取目标服务地址"""
    for prefix, service_url in SERVICE_ROUTES.items():
        if path.startswith(prefix):
            return service_url
    raise HTTPException(status_code=404, detail="服务不存在")


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"]
)
async def gateway(
    path: str,
    request: Request,
    user_info: dict = Depends(verify_token),
):
    """
    API 网关核心转发逻辑
    """
    start_time = time.time()

    # 获取目标服务
    target_url = get_target_service(f"/{path}")

    # 构建转发请求
    forward_url = f"{target_url}/{path}"
    headers = dict(request.headers)

    # 注入用户信息（下游服务不需要再做认证）
    headers["X-User-Id"] = str(user_info.get("user_id"))
    headers["X-User-Role"] = str(user_info.get("role"))
    headers.pop("authorization", None)  # 不转发原始 token

    # 转发请求
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            body = await request.body()
            response = await client.request(
                method=request.method,
                url=forward_url,
                headers=headers,
                content=body,
                params=request.query_params,
            )

            # 记录请求日志
            elapsed = (time.time() - start_time) * 1000
            logging.info(
                f"Gateway: {request.method} /{path} -> {target_url} "
                f"| status={response.status_code} | {elapsed:.1f}ms"
            )

            return response.json()

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="下游服务超时")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="下游服务不可用")
```

---

#### 服务注册与发现

```python
"""
服务注册与发现

使用 Redis 实现简化版（生产环境用 Consul/Etcd/Nacos）

原理：
1. 服务启动时，注册自己的地址到注册中心
2. 服务定期发送心跳，证明自己还活着
3. 调用方从注册中心获取服务地址列表
4. 注册中心检测到心跳超时，自动移除服务
"""
import asyncio
import json
import socket
import aioredis
import uuid
from datetime import datetime


class ServiceRegistry:
    """服务注册中心"""

    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis_url = redis_url
        self.redis = None
        self.heartbeat_interval = 10   # 心跳间隔（秒）
        self.service_timeout = 30      # 服务超时时间（秒）

    async def initialize(self):
        self.redis = await aioredis.from_url(
            self.redis_url, decode_responses=True
        )

    async def register(
        self,
        service_name: str,
        host: str,
        port: int,
        metadata: dict = None
    ) -> str:
        """注册服务实例"""
        instance_id = str(uuid.uuid4())
        instance_key = f"service:{service_name}:{instance_id}"

        instance_info = {
            "instance_id": instance_id,
            "service_name": service_name,
            "host": host,
            "port": port,
            "address": f"http://{host}:{port}",
            "metadata": metadata or {},
            "registered_at": datetime.now().isoformat(),
            "status": "UP",
        }

        # 写入注册表（带过期时间）
        await self.redis.setex(
            instance_key,
            self.service_timeout,
            json.dumps(instance_info)
        )

        print(f"[OK] 服务注册成功: {service_name} -> {host}:{port} "
              f"[{instance_id[:8]}...]")

        # 启动心跳任务
        asyncio.create_task(
            self._heartbeat_loop(instance_key, instance_info)
        )

        return instance_id

    async def _heartbeat_loop(
        self, instance_key: str, instance_info: dict
    ):
        """心跳循环：定期续约"""
        while True:
            await asyncio.sleep(self.heartbeat_interval)
            try:
                # 续约（重置过期时间）
                await self.redis.setex(
                    instance_key,
                    self.service_timeout,
                    json.dumps(instance_info)
                )
            except Exception as e:
                print(f"心跳失败: {e}")

    async def discover(self, service_name: str) -> list[dict]:
        """发现服务实例列表"""
        pattern = f"service:{service_name}:*"
        instances = []

        async for key in self.redis.scan_iter(match=pattern):
            value = await self.redis.get(key)
            if value:
                instances.append(json.loads(value))

        return instances

    async def get_one(self, service_name: str) -> dict:
        """获取一个可用的服务实例（随机）"""
        import random
        instances = await self.discover(service_name)

        if not instances:
            raise Exception(f"没有可用的 {service_name} 实例")

        return random.choice(instances)

    async def deregister(self, service_name: str, instance_id: str):
        """注销服务实例"""
        instance_key = f"service:{service_name}:{instance_id}"
        await self.redis.delete(instance_key)
        print(f"[FAIL] 服务注销: {service_name} [{instance_id[:8]}...]")


# ========== 服务客户端（带发现功能）==========
class ServiceClient:
    """
    服务调用客户端
    自动从注册中心获取地址
    """

    def __init__(self, registry: ServiceRegistry):
        self.registry = registry
        self._client = httpx.AsyncClient(timeout=10.0)

    async def call(
        self,
        service_name: str,
        path: str,
        method: str = "GET",
        **kwargs
    ):
        """调用指定服务"""
        # 从注册中心获取服务地址
        instance = await self.registry.get_one(service_name)
        url = f"{instance['address']}{path}"

        try:
            response = await self._client.request(
                method=method,
                url=url,
                **kwargs
            )
            return response.json()
        except Exception as e:
            print(f"调用 {service_name} 失败: {e}")
            raise


# ========== 在 FastAPI 应用中使用 ==========
registry = ServiceRegistry()

async def startup():
    """应用启动时注册服务"""
    await registry.initialize()

    # 获取本机 IP
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)

    await registry.register(
        service_name="order-service",
        host=local_ip,
        port=8003,
        metadata={"version": "1.2.0", "region": "beijing"}
    )

async def shutdown():
    """应用关闭时注销服务"""
    pass

order_app = FastAPI(on_startup=[startup], on_shutdown=[shutdown])
```

---

#### 链路追踪

```python
"""
链路追踪：追踪一个请求经过了哪些服务

使用 OpenTelemetry（标准化的链路追踪框架）
"""
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.jaeger.thrift import JaegerExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor


def setup_tracing(service_name: str):
    """
    配置链路追踪
    traces 会发送到 Jaeger，可以在 UI 上可视化查看
    """
    # 配置 Jaeger 导出器
    jaeger_exporter = JaegerExporter(
        agent_host_name="jaeger-host",
        agent_port=6831,
    )

    # 配置 Tracer Provider
    provider = TracerProvider()
    provider.add_span_processor(
        BatchSpanProcessor(jaeger_exporter)
    )
    trace.set_tracer_provider(provider)

    # 自动 instrument（自动追踪 FastAPI 请求）
    FastAPIInstrumentor.instrument()
    HTTPXClientInstrumentor.instrument()
    SQLAlchemyInstrumentor.instrument()

    print(f"[OK] 链路追踪已配置: {service_name}")


# 手动创建 Span（追踪自定义操作）
tracer = trace.get_tracer("order-service")


async def create_order_with_tracing(order_data: dict):
    """带链路追踪的下单流程"""

    with tracer.start_as_current_span("create_order") as span:
        # 记录请求属性
        span.set_attribute("user_id", order_data["user_id"])
        span.set_attribute("product_id", order_data["product_id"])

        # 子操作 1：查询库存
        with tracer.start_as_current_span("check_stock"):
            stock = await check_stock(order_data["product_id"])

        # 子操作 2：扣减库存
        with tracer.start_as_current_span("deduct_stock"):
            await deduct_stock(
                order_data["product_id"],
                order_data["quantity"]
            )

        # 子操作 3：创建订单记录
        with tracer.start_as_current_span("save_order"):
            order_id = await save_order(order_data)

        span.set_attribute("order_id", order_id)
        return order_id
```

---

### 7. 服务间通信：同步 vs 异步

```python
"""
微服务间通信的两种方式
"""

# ========== 同步通信（HTTP/RPC）==========
"""
适合：
- 需要立即知道结果的场景
- 简单的查询操作
- 用户等待结果的操作

缺点：
- 强依赖：被调用服务不可用，调用方也失败
- 性能：等待链路上所有服务处理完
"""

async def sync_order_flow(order_data: dict):
    client = ServiceClient(registry)

    # 同步调用：调用方等待结果
    stock = await client.call("product-service", "/stock/check",
                              method="GET",
                              params={"product_id": order_data["product_id"]})

    if stock["available"] < order_data["quantity"]:
        raise Exception("库存不足")

    # 继续下一步
    order = await client.call("order-service", "/order/create",
                               method="POST", json=order_data)
    return order


# ========== 异步通信（消息队列）==========
"""
适合：
- 不需要立即知道结果的场景
- 耗时操作（发邮件、生成报表）
- 服务解耦（下单后通知多个系统）

优点：
- 松耦合：被调用服务不可用，消息积压，恢复后继续处理
- 性能：不需要等待
"""
from celery import Celery

celery = Celery("myapp", broker="redis://localhost:6379/0")


async def async_order_flow(order_data: dict):
    # 异步发送：发出后立刻返回，不等结果

    # 发短信
    celery.send_task("tasks.send_sms", kwargs={
        "phone": order_data["user_phone"],
        "content": "您的订单已创建"
    })

    # 更新用户积分
    celery.send_task("tasks.update_points", kwargs={
        "user_id": order_data["user_id"],
        "points": 100
    })

    # 同步等待核心结果，异步处理非核心
    return {"status": "processing"}
```

---

### 8. 微服务的数据一致性

```python
"""
微服务最难的问题之一：跨服务的数据一致性

场景：
下单成功 -> 扣减库存 -> 扣减余额

这三个操作在三个不同服务、三个不同数据库

如何保证要么全成功，要么全失败？

方案：Saga 模式（最常用）
"""


class OrderSaga:
    """
    下单 Saga

    正向流程：创建订单 -> 扣库存 -> 扣余额 -> 完成
    补偿流程：取消订单 <-- 恢复库存 <-- 恢复余额（失败时）
    """

    def __init__(self, service_client: ServiceClient):
        self.client = service_client
        self.steps_completed = []  # 记录已完成步骤，用于回滚

    async def execute(self, order_data: dict) -> dict:
        """执行下单 Saga"""
        order_id = None

        try:
            # Step 1: 创建订单（待支付状态）
            order_result = await self.client.call(
                "order-service", "/order/create",
                method="POST", json=order_data
            )
            order_id = order_result["order_id"]
            self.steps_completed.append(("order", order_id))

            # Step 2: 扣减库存
            await self.client.call(
                "product-service", "/stock/deduct",
                method="POST", json={
                    "product_id": order_data["product_id"],
                    "quantity": order_data["quantity"],
                    "order_id": order_id  # 幂等性标识
                }
            )
            self.steps_completed.append(("stock", order_data["product_id"]))

            # Step 3: 扣减余额
            await self.client.call(
                "payment-service", "/balance/deduct",
                method="POST", json={
                    "user_id": order_data["user_id"],
                    "amount": order_data["amount"],
                    "order_id": order_id  # 幂等性标识
                }
            )
            self.steps_completed.append(("balance", order_data["user_id"]))

            # Step 4: 确认订单
            await self.client.call(
                "order-service", f"/order/{order_id}/confirm",
                method="POST"
            )

            return {"status": "success", "order_id": order_id}

        except Exception as e:
            # 执行补偿操作
            print(f"下单失败，开始回滚: {e}")
            await self.compensate()
            raise Exception(f"下单失败: {e}")

    async def compensate(self):
        """执行补偿（逆序回滚）"""
        for step, data in reversed(self.steps_completed):
            try:
                if step == "balance":
                    await self.client.call(
                        "payment-service", "/balance/restore",
                        method="POST", json={"user_id": data}
                    )
                    print(f"[OK] 余额已恢复: user={data}")

                elif step == "stock":
                    await self.client.call(
                        "product-service", "/stock/restore",
                        method="POST", json={"product_id": data}
                    )
                    print(f"[OK] 库存已恢复: product={data}")

                elif step == "order":
                    await self.client.call(
                        "order-service", f"/order/{data}/cancel",
                        method="POST"
                    )
                    print(f"[OK] 订单已取消: order_id={data}")

            except Exception as e:
                print(f"[FAIL] 补偿失败: step={step}, error={e}")
                # 记录到人工处理队列
```

---

## 四、异地多活与微服务的结合

实际的大型系统，往往是两者结合：

```
                    +------------------------------------+
                    |     DNS / 全局负载均衡              |
                    +------------------+-----------------+
                                       |
              +------------------------+------------------------+
              |                        |                        |
              v                        v                        v
    +-------------------+  +-------------------+  +-----------+
    |    北京机房        |  |    上海机房        |  |  深圳机房  |
    |                   |  |                   |  |           |
    |  +-------------+  |  |  +-------------+  |  |  ...      |
    |  | API Gateway |  |  |  | API Gateway |  |  |           |
    |  +------+------+  |  |  +------+------+  |  |           |
    |         |         |  |         |         |  |           |
    |  +------v------+  |  |  +------v------+  |  |           |
    |  | 微服务集群   |  |  |  | 微服务集群   |  |  |           |
    |  | 用户服务    |  |  |  | 用户服务    |  |  |           |
    |  | 商品服务    |  |  |  | 商品服务    |  |  |           |
    |  | 订单服务    |  |  |  | 订单服务    |  |  |           |
    |  +------+------+  |  |  +------+------+  |  |           |
    |         |         |  |         |         |  |           |
    |  +------v------+  |  |  +------v------+  |  |           |
    |  | 数据层      |<-+--+->| 数据层      |  |  |           |
    |  | MySQL       |  |  |  | MySQL       |  |  |           |
    |  | Redis       |  |  |  | Redis       |  |  |           |
    |  +-------------+  |  |  +-------------+  |  |           |
    +-------------------+  +-------------------+  +-----------+
           ^                        ^
           +---- 双向数据同步 ------+
```

---

## 五、面试高频题

### 1. 异地多活的核心挑战是什么？怎么解决？

**答题框架：**

**三大挑战：**

1. **数据同步延迟**
   - 问题：用户在 A 机房写，立刻在 B 机房读，读不到
   - 解决：用户路由到固定机房，同一用户始终读写同一机房

2. **数据写冲突**
   - 问题：同一数据被两个机房同时修改
   - 解决：按用户分区，同一用户的数据只在一个机房写

3. **网络分区**
   - 问题：机房间网络断了，数据无法同步
   - 解决：CAP 取 AP，各机房继续服务，网络恢复后合并

**核心解决思路：用户分区路由**
> 同一用户的所有请求，始终路由到同一机房，从根本上避免跨机房写冲突。

---

### 2. 微服务拆分的原则是什么？

**答题框架：**

1. **三个火枪手原则**：一个服务 2~5 人维护，太少太多都不对

2. **高内聚低耦合**：服务内部功能高度相关，服务间依赖尽量少

3. **按业务领域拆**（DDD）：不要按技术层拆（controller/service/dao）

4. **独立部署原则**：修改一个服务，不需要修改其他服务

5. **数据库私有**：每个服务有自己的数据库，不共享

**判断拆分合不合理：**
> 如果改这个功能，需要同时修改 3 个以上服务，说明拆错了。

---

### 3. 微服务拆太细会有什么问题？

**答题框架：**

| 问题 | 说明 |
|------|------|
| **链路太长** | A->B->C->D，任意一环故障全链路失败 |
| **分布式事务** | 跨服务数据一致性极难保证 |
| **运维复杂** | 100 个服务的部署、监控、告警 |
| **网络开销** | 服务间 HTTP 调用比进程内调用慢 10~100 倍 |
| **人力成本** | 3 个人维护 20 个服务，精力分散 |

**结论：** 微服务不是越细越好，合适才是最好。

---

### 4. 微服务的数据一致性怎么保证？

**答题框架：**

**不能用传统分布式事务（2PC）的原因：**
- 性能差（参与者需要锁定资源）
- 可用性低（协调者故障全局锁定）

**主流解决方案：Saga 模式**

- 把大事务拆成多个本地事务
- 每个本地事务完成后发消息，触发下一步
- 失败时执行补偿操作（逆序回滚）

**关键：补偿操作必须是幂等的**

---

### 5. 服务注册发现是什么？为什么需要？

**答题框架：**

**为什么需要：**
- 微服务实例动态增减（扩容、缩容、故障）
- 不能把地址硬编码
- 需要动态感知哪些实例可用

**工作原理：**

```
服务启动 -> 注册到注册中心（地址、健康状态）
           |
服务运行 -> 定期发送心跳
           |
调用方  -> 从注册中心获取地址列表
           |
注册中心 -> 检测心跳超时，自动摘除
```

**Python 生态常用：**
- Consul（最成熟）
- etcd（Kubernetes 用）
- Nacos（阿里开源，Java 生态多）
- 自研（Redis 简化版）

---

### 6. 同步调用和异步调用怎么选择？

**答题框架：**

| 场景 | 推荐 | 理由 |
|------|------|------|
| 用户等待结果 | 同步（HTTP/RPC）| 需要立即返回 |
| 数据查询 | 同步 | 简单直接 |
| 发邮件/短信 | 异步（消息队列）| 不影响主流程 |
| 下单后通知多系统 | 异步 | 解耦，下游故障不影响主流程 |
| 耗时任务（报表）| 异步 | 不阻塞用户 |
| 日志/统计 | 异步 | 非核心，不影响业务 |

---

## 六、本讲核心要点总结

### 必须记住的 15 条

1. **异地多活：多机房都对外服务，任意机房故障自动切换**
2. **同城双活延迟 < 1ms，跨城 30~100ms，复杂度依次递增**
3. **异地多活四步法：业务分级 -> 数据分类 -> 数据同步 -> 异常处理**
4. **解决写冲突的核心：用户分区路由，同一用户始终去同一机房**
5. **不是所有公司都需要异地多活，先把单机房做好**
6. **微服务的本质是：独立部署、独立扩展、故障隔离**
7. **三个火枪手原则：一个服务 2~5 人维护**
8. **按业务领域拆，不要按技术层拆**
9. **拆太细的代价：链路长、事务难、运维复杂**
10. **每个微服务有自己的数据库，不共享**
11. **跨服务数据一致性：用 Saga 模式，不用 2PC**
12. **服务注册发现：动态感知服务实例，支持扩缩容**
13. **API 网关：统一入口、认证、限流、路由**
14. **链路追踪：用 OpenTelemetry，可视化请求链路**
15. **同步适合用户等待场景，异步适合解耦和非核心操作**

---

## 七、课后练习

### 练习 1：用户分区路由
运行本讲的 UserRegionRouter 代码：
1. 观察 10000 个用户的分布情况
2. 模拟北京机房故障，观察用户如何被重新分配
3. 思考：如果是按 user_id % 3 直接分配，和一致性哈希有什么区别？

### 练习 2：服务注册发现
用 Redis 实现本讲的 ServiceRegistry：
1. 启动 3 个模拟服务实例（不同端口）
2. 验证注册、发现、心跳、自动摘除功能
3. 测试：关掉一个实例，注册中心多久后自动摘除？

### 练习 3：Saga 模式
实现一个简化版的下单 Saga：
1. 创建订单服务（模拟）
2. 创建库存服务（模拟）
3. 创建支付服务（模拟，随机失败）
4. 实现 Saga 编排，支付失败时自动回滚订单和库存

### 练习 4：架构设计
假设你是某互联网公司的架构师：
- 公司在北京有一个机房
- 日活 500 万，订单量 100 万/天
- 老板要求系统可用性达到 99.99%
- 预算有限，不能无限扩张

请设计高可用方案：
1. 是否需要异地多活？为什么？
2. 如果要做，选哪种模式？
3. 数据同步方案是什么？
4. 故障切换流程是什么？
5. 画出架构图

---

## 八、下一讲预告

**第 7 讲：可扩展架构模式——分层、SOA、微服务、微内核**

会讲：
- 可扩展的本质：拆分
- 分层架构：最基础的可扩展方式
- SOA vs 微服务：有什么本质区别
- 微内核（插件化）架构：什么场景用
- Python 项目的分层设计实践
- 如何从单体平滑迁移到微服务
- 可扩展架构的面试高频题

---

**你想继续第 7 讲，还是对这一讲有疑问？**
