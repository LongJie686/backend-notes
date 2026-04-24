# 第 5 讲：高可用架构模式（上）——CAP 定理与 FMEA 分析

---

前四讲我们解决了**高性能**的问题。

这一讲开始解决**高可用**的问题。

高性能解决的是"快不快"，高可用解决的是"稳不稳"。

> **一个系统再快，如果经常宕机，也是不合格的。**

这一讲的核心：
- **CAP 定理**：理解分布式系统的根本约束
- **FMEA 分析**：系统化排查故障风险
- **高可用存储架构**：主备、主从、主主
- **Python 高可用实战**

---

## 一、为什么高可用这么难？

先看几个真实场景：

### 场景 1：数据库宕机

```
某天凌晨 3 点
MySQL 主库磁盘写满
数据库无法写入
所有写操作失败
系统报错

工程师紧急处理：
- 扩容磁盘（30 分钟）
- 恢复服务（10 分钟）
- 总共宕机 40 分钟

损失：
- 用户无法下单 40 分钟
- 预估损失：几十万
```

---

### 场景 2：服务雪崩

```
某电商大促
流量突增 10 倍
优惠券服务响应变慢（2秒）
↓
订单服务调用优惠券服务
线程全部阻塞等待
↓
订单服务线程池耗尽
订单服务也开始超时
↓
用户服务调用订单服务
用户服务也被拖垮
↓
整个系统瘫痪
```

一个慢服务，拖垮了整个系统链路。

---

### 场景 3：机房断电

```
某公司只有一个机房
机房因为电路故障断电
所有服务全部宕机
持续 2 小时

这期间：
- 用户无法访问
- 数据可能丢失
- 团队彻夜处理
```

---

这三个场景说明了高可用的三大挑战：

| 挑战 | 场景 | 解决思路 |
|------|------|---------|
| **单点故障** | 数据库宕机 | 主备、集群 |
| **服务雪崩** | 链路超时传播 | 熔断、降级、限流 |
| **机房故障** | 整个机房挂掉 | 异地多活 |

---

## 二、CAP 定理

### 1. CAP 是什么？

CAP 定理是分布式系统最重要的理论基础，由 Eric Brewer 在 2000 年提出。

> **在一个分布式系统中，以下三个属性最多只能同时满足两个：**
>
> - **C（Consistency，一致性）**：所有节点在同一时刻看到相同的数据
> - **A（Availability，可用性）**：每个请求都能得到响应（不管成功还是失败）
> - **P（Partition Tolerance，分区容忍性）**：系统在网络分区时仍能运行

---

### 2. 什么是网络分区？

```
┌──────────────────────────────────────────────────────┐
│ 正常情况                                              │
│                                                      │
│  节点 A ←───────────────────→ 节点 B                 │
│           网络正常，可以通信                          │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ 网络分区（Network Partition）                         │
│                                                      │
│  节点 A ×───────────────────× 节点 B                 │
│           网络故障，无法通信                          │
│           但两个节点都还在运行                        │
└──────────────────────────────────────────────────────┘
```

**网络分区在分布式系统中是必然会发生的：**
- 网线被挖断
- 交换机故障
- 机房之间网络抖动
- 服务器网卡故障

---

### 3. 为什么 CAP 只能取两个？

**P（分区容忍性）在分布式系统中是必选项。**

原因：
- 网络分区是客观存在的，无法避免
- 如果不容忍分区，分布式系统就没有意义

所以实际上，**分布式系统只能在 CP 和 AP 之间选择**。

---

### 4. CP vs AP：如何选择？

#### CP 系统（一致性 + 分区容忍）

```
网络分区时：
节点 A ×─────────× 节点 B

选择 C（一致性）：
节点 B 无法与 A 同步
→ 节点 B 拒绝所有请求（返回错误）
→ 保证一致性，但牺牲了可用性
```

**适用场景：**
- 强一致性要求的系统
- 金融交易、库存扣减、分布式锁
- 宁可不响应，也不能给错误数据

**代表系统：**
- ZooKeeper
- etcd
- HBase（选择了强一致性）

---

#### AP 系统（可用性 + 分区容忍）

```
网络分区时：
节点 A ×─────────× 节点 B

选择 A（可用性）：
节点 B 继续提供服务
→ 但可能返回过时的数据（不一致）
→ 保证可用性，但牺牲了一致性
```

**适用场景：**
- 允许短暂数据不一致的系统
- 社交内容、商品展示、用户行为数据
- 宁可数据短暂不一致，也要保证响应

**代表系统：**
- Cassandra
- CouchDB
- DynamoDB
- Redis（默认异步复制）

---

### 5. 一个具体的 Python 案例

```python
"""
用 Python 模拟 CP 和 AP 的选择

场景：分布式缓存集群
- 节点 A（主）和节点 B（从）
- 网络分区发生时，如何处理请求
"""
import asyncio
import time
from enum import Enum

class ConsistencyMode(Enum):
    CP = "CP"  # 一致性优先
    AP = "AP"  # 可用性优先


class DistributedCache:
    def __init__(self, mode: ConsistencyMode):
        self.mode = mode
        self.data_primary = {}    # 主节点数据
        self.data_secondary = {}  # 从节点数据
        self.is_partitioned = False  # 模拟网络分区

    async def write(self, key: str, value: str) -> dict:
        """写操作"""
        try:
            # 写主节点
            self.data_primary[key] = value

            if self.mode == ConsistencyMode.CP:
                if self.is_partitioned:
                    return {
                        "success": False,
                        "error": "网络分区，写入被拒绝（CP模式：保证一致性）"
                    }
                # 等待从节点确认（同步复制）
                self.data_secondary[key] = value
                return {"success": True, "mode": "CP（同步写入主从）"}

            else:  # AP 模式
                if not self.is_partitioned:
                    self.data_secondary[key] = value
                return {
                    "success": True,
                    "mode": "AP（主节点写入成功，从节点可能延迟）"
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def read(self, key: str, prefer_secondary: bool = True) -> dict:
        """读操作"""
        if self.mode == ConsistencyMode.CP:
            value = self.data_primary.get(key)
            return {
                "value": value,
                "source": "主节点（CP模式，强一致）"
            }
        else:  # AP 模式
            if self.is_partitioned and prefer_secondary:
                value = self.data_secondary.get(key)
                return {
                    "value": value,
                    "source": "从节点（AP模式，可能是旧数据）",
                    "warning": "网络分区中，数据可能不是最新"
                }
            value = self.data_primary.get(key)
            return {"value": value, "source": "主节点"}
```

---

### 6. CAP 的常见误解

#### 误解 1：CAP 是非 0 即 1 的选择

**真实情况：C 和 A 都是有程度的。**

```
一致性程度（从弱到强）：
弱一致性 → 最终一致性 → 强一致性

可用性程度（从低到高）：
0% → 99% → 99.9% → 99.99% → 99.999%
```

大多数系统选择的是：**有限度的一致性 + 有限度的可用性**

---

#### 误解 2：选了 AP 就不管一致性了

**真实情况：AP 系统通常追求"最终一致性"**

```
最终一致性：
- 某一时刻，各节点数据可能不同
- 但经过一段时间（通常毫秒~秒级），数据最终会一致

例子：
- 你发了一条微博
- 上海的用户立刻能看到
- 美国的用户可能 1 秒后才看到
- 但最终所有人都能看到
```

这是可以接受的，因为这不是金融交易，短暂不一致没关系。

---

#### 误解 3：CAP 是架构设计的全部

**真实情况：CAP 只是分区场景下的选择。**

```
正常运行（无分区）时：
C、A、P 都可以满足

只有网络分区发生时：
才需要在 C 和 A 之间做选择
```

系统大多数时间是正常运行的，分区是少数情况。

---

### 7. 实际系统的 CAP 定位

| 系统 | CAP 选择 | 原因 |
|------|---------|------|
| MySQL（单机） | CA | 单机不存在分区问题 |
| MySQL 主从 | AP（默认异步复制） | 优先可用，允许短暂延迟 |
| MySQL 主从（半同步）| CP 倾向 | 提高一致性，但写延迟增加 |
| Redis 单机 | CA | 单机 |
| Redis Sentinel | AP | 主挂了选新主，可能丢少量数据 |
| Redis Cluster | AP | 分片集群，优先可用 |
| ZooKeeper | CP | 选举期间不可用，但保证一致 |
| Kafka | AP | 优先可用，允许短暂不一致 |
| 支付系统（自研）| CP | 金融数据，强一致优先 |

---

## 三、FMEA 分析方法

### 1. 什么是 FMEA？

> **FMEA（Failure Mode and Effects Analysis，故障模式与影响分析）**
>
> 系统性地分析系统中可能出现的故障，评估故障影响，制定应对措施。

来自航空、汽车制造业，软件架构中用于**提前发现单点风险**。

---

### 2. FMEA 分析步骤

```
第一步：列出所有可能的故障点
    ↓
第二步：分析每个故障的影响
    ↓
第三步：评估故障概率（发生可能性）
    ↓
第四步：评估故障严重程度
    ↓
第五步：计算风险优先级（RPN = 概率 × 严重度 × 可检测性）
    ↓
第六步：制定应对措施
    ↓
第七步：评估改进后的效果
```

---

### 3. FMEA 评分标准

#### 故障发生概率（1-10分）

| 分值 | 含义 | 频率参考 |
|------|------|---------|
| 1-2 | 极低 | 几年一次 |
| 3-4 | 低 | 一年一次 |
| 5-6 | 中 | 一月一次 |
| 7-8 | 高 | 一周一次 |
| 9-10 | 极高 | 每天发生 |

#### 故障严重程度（1-10分）

| 分值 | 含义 |
|------|------|
| 1-2 | 几乎无影响 |
| 3-4 | 轻微影响，用户感知不到 |
| 5-6 | 中等影响，部分功能受影响 |
| 7-8 | 严重影响，核心功能不可用 |
| 9-10 | 灾难性，系统完全不可用 |

#### 可检测性（1-10分）

| 分值 | 含义 |
|------|------|
| 1-2 | 很容易检测，有监控报警 |
| 3-4 | 较容易检测 |
| 5-6 | 需要一定时间才能发现 |
| 7-8 | 难以检测，可能发现很慢 |
| 9-10 | 几乎无法检测 |

**RPN（风险优先级）= 概率 × 严重度 × 可检测性**

RPN 越高，越需要优先处理。

---

### 4. Python 实现 FMEA 分析工具

```python
"""
FMEA 分析工具
"""
from dataclasses import dataclass
from typing import List


@dataclass
class FailureMode:
    """故障模式"""
    component: str          # 组件/系统
    failure_mode: str       # 故障模式
    failure_cause: str      # 故障原因
    failure_effect: str     # 故障影响

    # 评分（1-10）
    probability: int        # 发生概率
    severity: int           # 严重程度
    detectability: int      # 可检测性

    # 应对措施
    current_controls: str   # 当前已有的控制措施
    recommended_actions: str # 建议改进措施

    @property
    def rpn(self) -> int:
        """风险优先级 = 概率 × 严重度 × 可检测性"""
        return self.probability * self.severity * self.detectability

    @property
    def risk_level(self) -> str:
        if self.rpn >= 200:
            return "[极高] "
        elif self.rpn >= 100:
            return "[高]   "
        elif self.rpn >= 50:
            return "[中]   "
        else:
            return "[低]   "


class FMEAAnalyzer:
    def __init__(self, system_name: str):
        self.system_name = system_name
        self.failure_modes: List[FailureMode] = []

    def add_failure_mode(self, failure_mode: FailureMode):
        self.failure_modes.append(failure_mode)

    def analyze(self) -> str:
        """生成分析报告"""
        sorted_modes = sorted(
            self.failure_modes,
            key=lambda x: x.rpn,
            reverse=True
        )

        report = []
        report.append(f"\n{'='*60}")
        report.append(f"FMEA 分析报告：{self.system_name}")
        report.append(f"{'='*60}")
        report.append(f"分析了 {len(self.failure_modes)} 个故障模式\n")

        high_risk = [m for m in self.failure_modes if m.rpn >= 100]
        mid_risk = [m for m in self.failure_modes if 50 <= m.rpn < 100]
        low_risk = [m for m in self.failure_modes if m.rpn < 50]

        report.append(f"风险分布:")
        report.append(f"  高风险（RPN>=100）: {len(high_risk)} 个")
        report.append(f"  中风险（50<=RPN<100）: {len(mid_risk)} 个")
        report.append(f"  低风险（RPN<50）: {len(low_risk)} 个\n")

        report.append("详细分析（按风险优先级排序）：")
        report.append("-" * 60)

        for i, mode in enumerate(sorted_modes, 1):
            report.append(f"\n{i}. {mode.risk_level} | RPN: {mode.rpn}")
            report.append(f"   组件: {mode.component}")
            report.append(f"   故障模式: {mode.failure_mode}")
            report.append(f"   故障原因: {mode.failure_cause}")
            report.append(f"   故障影响: {mode.failure_effect}")
            report.append(f"   评分: 概率={mode.probability} x "
                         f"严重度={mode.severity} x "
                         f"可检测性={mode.detectability}")
            report.append(f"   当前措施: {mode.current_controls}")
            report.append(f"   建议改进: {mode.recommended_actions}")

        return "\n".join(report)

    def get_top_risks(self, n: int = 5) -> List[FailureMode]:
        """获取 Top N 高风险故障"""
        return sorted(
            self.failure_modes,
            key=lambda x: x.rpn,
            reverse=True
        )[:n]
```

---

### 5. 实战：对电商系统做 FMEA 分析

```python
def analyze_ecommerce_system():
    analyzer = FMEAAnalyzer("电商系统")

    # ========== 数据库层 ==========
    analyzer.add_failure_mode(FailureMode(
        component="MySQL 主库",
        failure_mode="主库宕机",
        failure_cause="磁盘故障、OOM、硬件故障",
        failure_effect="所有写操作失败，部分读操作失败",
        probability=4,      # 一年几次
        severity=9,         # 核心业务完全不可用
        detectability=2,    # 有监控，很快发现
        current_controls="有从库，可以手动切换",
        recommended_actions="部署 MySQL MHA，实现自动故障切换；增加主库监控报警"
    ))

    analyzer.add_failure_mode(FailureMode(
        component="MySQL 从库",
        failure_mode="从库全部宕机",
        failure_cause="机房故障、网络分区",
        failure_effect="读操作全部打到主库，主库压力倍增",
        probability=2,
        severity=6,
        detectability=2,
        current_controls="有两个从库",
        recommended_actions="增加从库数量；读操作失败时自动切换到主库"
    ))

    analyzer.add_failure_mode(FailureMode(
        component="MySQL",
        failure_mode="磁盘空间写满",
        failure_cause="数据增长过快、日志未清理",
        failure_effect="数据库无法写入，服务报错",
        probability=6,
        severity=9,
        detectability=5,
        current_controls="定期手动检查",
        recommended_actions="设置磁盘使用率 70%/80%/90% 三级报警；配置自动清理日志"
    ))

    # ========== 缓存层 ==========
    analyzer.add_failure_mode(FailureMode(
        component="Redis",
        failure_mode="Redis 宕机",
        failure_cause="OOM、主机故障",
        failure_effect="缓存全部失效，请求全部打到数据库",
        probability=3,
        severity=8,
        detectability=2,
        current_controls="有 Redis Sentinel 主从",
        recommended_actions="升级为 Redis Cluster；增加本地缓存作为二级缓存"
    ))

    analyzer.add_failure_mode(FailureMode(
        component="Redis",
        failure_mode="热点 Key 导致单节点过热",
        failure_cause="大促活动，某个商品被大量访问",
        failure_effect="Redis 单节点 CPU 100%，响应变慢",
        probability=7,
        severity=7,
        detectability=4,
        current_controls="无",
        recommended_actions="热点 Key 检测；本地缓存热点数据；Key 加随机后缀分散"
    ))

    # ========== 应用层 ==========
    analyzer.add_failure_mode(FailureMode(
        component="订单服务",
        failure_mode="订单服务全部宕机",
        failure_cause="发布失误、依赖服务故障导致雪崩",
        failure_effect="用户无法下单",
        probability=5,
        severity=9,
        detectability=2,
        current_controls="多实例部署，健康检查",
        recommended_actions="增加熔断机制；灰度发布；自动回滚"
    ))

    analyzer.add_failure_mode(FailureMode(
        component="第三方支付",
        failure_mode="支付接口超时/不可用",
        failure_cause="第三方服务故障、网络问题",
        failure_effect="用户无法完成支付",
        probability=6,
        severity=8,
        detectability=3,
        current_controls="设置了超时时间",
        recommended_actions="接入多个支付渠道；支付失败时引导用户换渠道重试"
    ))

    # ========== 网络层 ==========
    analyzer.add_failure_mode(FailureMode(
        component="Nginx",
        failure_mode="Nginx 宕机",
        failure_cause="硬件故障、配置错误",
        failure_effect="所有请求无法到达后端",
        probability=2,
        severity=10,
        detectability=1,
        current_controls="单机部署",
        recommended_actions="双机热备（Keepalived + VIP）；DNS 自动切换"
    ))

    analyzer.add_failure_mode(FailureMode(
        component="机房",
        failure_mode="机房网络中断",
        failure_cause="光纤被挖断、运营商故障",
        failure_effect="整个系统不可访问",
        probability=2,
        severity=10,
        detectability=2,
        current_controls="单机房",
        recommended_actions="接入多个运营商；考虑同城双活"
    ))

    # 输出报告
    print(analyzer.analyze())

    # 输出 Top 5 风险
    print("\n" + "="*60)
    print("最需要优先处理的 5 个风险：")
    print("="*60)
    for i, risk in enumerate(analyzer.get_top_risks(5), 1):
        print(f"\n{i}. {risk.component} - {risk.failure_mode}")
        print(f"   RPN: {risk.rpn} | {risk.risk_level}")
        print(f"   建议: {risk.recommended_actions}")


analyze_ecommerce_system()
```

---

### 6. FMEA 分析结论

通过 FMEA，我们可以发现：

```
极高风险（需要立刻处理）：
1. MySQL 磁盘写满（RPN=270）→ 加磁盘监控报警
2. 热点Key（RPN=196）→ 加本地缓存 + Key 分散
3. Nginx 单点（RPN=180）→ 双机热备

高风险（近期处理）：
4. 第三方支付超时（RPN=144）→ 多支付渠道
5. 订单服务雪崩（RPN=90）→ 熔断 + 灰度发布

中风险（规划处理）：
6. MySQL 主库宕机（RPN=72）→ 自动故障切换
7. Redis 宕机（RPN=48）→ 升级为集群
```

**这就是 FMEA 的价值：把隐性风险显性化，用数据驱动优先级决策。**

---

## 四、高可用存储架构

解决了"知道哪里有风险"的问题，现在来看"如何解决单点问题"。

存储层是最容易出现单点的地方。

### 1. 主备架构（Master-Standby）

```
正常状态：
┌──────────┐         ┌──────────┐
│ 主库     │ ──复制──▶│ 备库     │
│（对外服务）│         │（不对外）  │
└──────────┘         └──────────┘
   ↑ 所有读写

故障状态：
┌──────────┐    ✗    ┌──────────┐
│ 主库     │ ──宕机──▶│ 备库     │
│（不可用）  │         │（切换为主）│
└──────────┘         └──────────┘
                         ↑ 切换后对外服务
```

**切换方式：**
- **手动切换**：运维人员发现故障后手动操作，慢（分钟级）
- **自动切换**：使用工具（MHA、Orchestrator）自动切换，快（秒级）

**问题：**
- 备库平时不服务，资源浪费
- 切换有时间窗口，期间不可用
- 可能丢失少量数据（主备数据不同步的部分）

---

### 2. 主从架构（Master-Slave）

```
┌──────────┐
│ 主库     │ ←── 所有写请求
│          │
└────┬─────┘
     │ 异步复制（binlog）
     │
     ├──────────────────────────────┐
     ▼                              ▼
┌──────────┐                  ┌──────────┐
│ 从库 1   │                  │ 从库 2   │
│          │ ←── 读请求       │          │ ←── 读请求
└──────────┘                  └──────────┘
```

**与主备的区别：**
- 从库对外提供读服务（不浪费资源）
- 可以有多个从库（扩展读能力）
- 主库故障时，可以从从库中选一个提升为主库

**主库故障切换流程：**

```python
"""
MySQL 主从切换流程（使用 MHA 或手动操作）

1. 检测主库故障
2. 从所有从库中选一个数据最新的
3. 让其他从库同步到选中的从库
4. 把选中的从库提升为主库
5. 更新配置，让应用连接新主库
6. 旧主库恢复后，以从库身份加入
"""
import time
import pymysql
import logging

class MySQLFailoverManager:
    def __init__(self):
        self.master = {
            "host": "master-host",
            "port": 3306,
            "user": "root",
            "password": "password"
        }
        self.slaves = [
            {"host": "slave1-host", "port": 3306, "user": "root", "password": "password"},
            {"host": "slave2-host", "port": 3306, "user": "root", "password": "password"},
        ]

    def check_master_alive(self) -> bool:
        """检测主库是否存活"""
        try:
            conn = pymysql.connect(**self.master, connect_timeout=3)
            conn.close()
            return True
        except:
            return False

    def get_slave_status(self, slave_config: dict) -> dict:
        """获取从库复制状态"""
        conn = pymysql.connect(**slave_config)
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute("SHOW SLAVE STATUS")
        status = cursor.fetchone()
        conn.close()
        return status

    def select_new_master(self) -> dict:
        """选择最新的从库作为新主库"""
        best_slave = None
        max_binlog_pos = -1

        for slave in self.slaves:
            try:
                status = self.get_slave_status(slave)
                pos = status.get("Exec_Master_Log_Pos", 0)
                if pos > max_binlog_pos:
                    max_binlog_pos = pos
                    best_slave = slave
            except Exception as e:
                logging.error(f"获取从库状态失败: {e}")

        return best_slave

    def promote_slave_to_master(self, slave_config: dict):
        """把从库提升为主库"""
        conn = pymysql.connect(**slave_config)
        cursor = conn.cursor()

        cursor.execute("STOP SLAVE")
        cursor.execute("RESET SLAVE ALL")
        cursor.execute("SET GLOBAL read_only = 0")

        conn.commit()
        conn.close()
        logging.info(f"从库 {slave_config['host']} 已提升为主库")

    def failover(self):
        """执行故障切换"""
        logging.warning("检测到主库故障，开始故障切换...")

        new_master = self.select_new_master()
        if not new_master:
            logging.error("没有可用的从库，切换失败！")
            return False

        self.promote_slave_to_master(new_master)
        self.master = new_master

        for slave in self.slaves:
            if slave["host"] != new_master["host"]:
                self._repoint_slave(slave, new_master)

        logging.info(f"故障切换完成，新主库: {new_master['host']}")
        return True
```

---

### 3. 主主架构（Master-Master）

```
┌──────────┐  ←──双向复制──▶  ┌──────────┐
│  主库 A  │                   │  主库 B  │
│（读 + 写）│                   │（读 + 写）│
└──────────┘                   └──────────┘
     ↑ 写请求                       ↑ 写请求
（部分用户）                    （部分用户）
```

**优点：**
- 任意一台宕机，另一台可以接管全部请求
- 可以双向读写，利用两台机器的写能力

**严重问题：写冲突！**

```
时刻 T1: 用户A 在主库A 修改 user_id=1 的余额：100 → 80
时刻 T2: 用户B 在主库B 修改 user_id=1 的余额：100 → 90
（双方都读到了 100，因为复制有延迟）

最终：
主库A 的余额：90（被主库B同步覆盖）
主库B 的余额：80（被主库A同步覆盖）

实际结果：余额 80 或 90，而正确结果应该是 70！
```

**解决写冲突的方法：**

| 方法 | 说明 |
|------|------|
| **业务层路由** | 同一用户的写请求，始终打到同一主库 |
| **全局序列** | 所有写操作通过全局序列号排序 |
| **只写一台** | 实际上退化为主备，B 库只读不写 |

**实际建议：主主架构慎用，处理写冲突很复杂。**

大多数场景用**主从 + 自动切换**就够了。

---

### 4. Python 实现高可用数据库连接

```python
"""
高可用数据库连接：
- 主库写，从库读
- 主库失败时，自动切换到从库（降级）
- 从库失败时，自动摘除，恢复后重新加入
"""
import asyncio
import aiomysql
import logging
import random
from typing import Optional
from contextlib import asynccontextmanager


class HighAvailabilityDBPool:
    def __init__(self):
        self.master_pool: Optional[aiomysql.Pool] = None
        self.slave_pools: list[aiomysql.Pool] = []
        self.failed_slaves: set = set()
        self._lock = asyncio.Lock()

    async def initialize(self):
        """初始化连接池"""
        self.master_pool = await aiomysql.create_pool(
            host="master-host",
            port=3306,
            user="app",
            password="password",
            db="mydb",
            minsize=5,
            maxsize=20,
            autocommit=False,
        )

        slave_configs = [
            {"host": "slave1-host", "port": 3306},
            {"host": "slave2-host", "port": 3306},
        ]

        for config in slave_configs:
            pool = await aiomysql.create_pool(
                host=config["host"],
                port=config["port"],
                user="app",
                password="password",
                db="mydb",
                minsize=3,
                maxsize=10,
                autocommit=True,
            )
            self.slave_pools.append(pool)

        asyncio.create_task(self._health_check_loop())

    async def _health_check_loop(self):
        """定期检查从库健康状态"""
        while True:
            await asyncio.sleep(30)

            for i, pool in enumerate(self.slave_pools):
                try:
                    async with pool.acquire() as conn:
                        async with conn.cursor() as cur:
                            await cur.execute("SELECT 1")

                    if i in self.failed_slaves:
                        self.failed_slaves.discard(i)
                        logging.info(f"从库 {i} 恢复正常")

                except Exception as e:
                    if i not in self.failed_slaves:
                        self.failed_slaves.add(i)
                        logging.error(f"从库 {i} 故障: {e}")

    def _get_healthy_slave_pools(self) -> list:
        """获取健康的从库连接池"""
        return [
            pool for i, pool in enumerate(self.slave_pools)
            if i not in self.failed_slaves
        ]

    @asynccontextmanager
    async def get_write_conn(self):
        """获取写连接（主库）"""
        try:
            async with self.master_pool.acquire() as conn:
                yield conn
        except Exception as e:
            logging.error(f"主库连接失败: {e}")
            raise

    @asynccontextmanager
    async def get_read_conn(self, force_master: bool = False):
        """
        获取读连接
        force_master=True: 强制走主库（解决主从延迟）
        force_master=False: 优先走从库
        """
        if force_master:
            async with self.master_pool.acquire() as conn:
                yield conn
            return

        healthy_slaves = self._get_healthy_slave_pools()

        if healthy_slaves:
            slave_pool = random.choice(healthy_slaves)
            try:
                async with slave_pool.acquire() as conn:
                    yield conn
                return
            except Exception as e:
                logging.error(f"从库连接失败，降级到主库: {e}")

        logging.warning("所有从库不可用，降级读主库")
        async with self.master_pool.acquire() as conn:
            yield conn


# ========== 使用示例 ==========
db = HighAvailabilityDBPool()

async def get_user(user_id: int, strong_consistency: bool = False) -> dict:
    """
    获取用户信息
    strong_consistency: 是否需要强一致性（读主库）
    """
    async with db.get_read_conn(force_master=strong_consistency) as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM user WHERE id = %s",
                (user_id,)
            )
            return await cur.fetchone()

async def create_user(name: str, email: str) -> int:
    """创建用户（写主库）"""
    async with db.get_write_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO user (name, email) VALUES (%s, %s)",
                (name, email)
            )
            await conn.commit()
            return cur.lastrowid
```

---

## 五、高可用计算架构

除了存储层，计算层（服务层）也需要高可用设计。

### 1. 主备计算

```
正常：
用户 ──▶ 主服务（处理请求）──▶ 数据库
         备服务（不服务，只心跳检测）

故障：
用户 ──▶ 主服务（宕机）
         备服务（接管，开始服务）──▶ 数据库
```

**实现：Keepalived + VIP（虚拟 IP）**

```
VIP: 10.0.0.100（对外服务的 IP）

正常：
10.0.0.100 → 主服务器（10.0.0.1）
备服务器（10.0.0.2）不提供服务

主服务器宕机：
Keepalived 检测到故障
VIP 漂移到备服务器
10.0.0.100 → 备服务器（10.0.0.2）
用户无感知（VIP 没变）
```

---

### 2. 集群计算（最常用）

```
                    ┌───────────────────────────┐
                    │     Nginx 负载均衡         │
用户 ─────────────▶ │                           │
                    └────────┬──────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ 服务实例1 │   │ 服务实例2 │   │ 服务实例3 │
        │ FastAPI  │   │ FastAPI  │   │ FastAPI  │
        └──────────┘   └──────────┘   └──────────┘
```

**Nginx 健康检查配置：**

```nginx
upstream python_backend {
    server 10.0.0.1:8000 max_fails=3 fail_timeout=30s;
    server 10.0.0.2:8000 max_fails=3 fail_timeout=30s;
    server 10.0.0.3:8000 max_fails=3 fail_timeout=30s;
}
```

**含义：**
- `max_fails=3`：3 次失败就标记为不可用
- `fail_timeout=30s`：30 秒后重新尝试

---

### 3. 接口级高可用：熔断、降级、限流

这是高可用最重要的实战内容。

#### 3.1 熔断（Circuit Breaker）

```
类比：家里的电路熔断器
- 正常：电流通过
- 电流过大（故障）：熔断器跳闸，断开电路
- 保护后面的电器不被损坏

软件熔断：
- 正常：请求正常转发
- 下游服务故障：熔断器断开，不再转发请求
- 保护系统不被拖垮
```

**熔断器三种状态：**

```
                    失败率超过阈值
   关闭（正常）  ───────────────────▶  打开（熔断）
      ↑                                    │
      │              半打开               │
      └────────────（试探请求）────────────┘
             成功                 失败
           （关闭）              （重新打开）
```

```python
"""
Python 实现熔断器
"""
import asyncio
import time
from enum import Enum
from functools import wraps


class CircuitState(Enum):
    CLOSED = "closed"       # 正常，允许请求
    OPEN = "open"           # 熔断，拒绝请求
    HALF_OPEN = "half_open" # 半开，试探请求


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        success_threshold: int = 2,
        timeout: float = 60.0,
        half_open_max_calls: int = 3,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self.half_open_max_calls = half_open_max_calls

        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None
        self.half_open_calls = 0
        self._lock = asyncio.Lock()

    async def call(self, func, *args, **kwargs):
        """执行被保护的函数"""
        async with self._lock:
            if self.state == CircuitState.OPEN:
                if time.time() - self.last_failure_time >= self.timeout:
                    self.state = CircuitState.HALF_OPEN
                    self.half_open_calls = 0
                    self.success_count = 0
                else:
                    raise CircuitBreakerOpenError(
                        f"[{self.name}] 熔断器已打开，拒绝请求"
                    )

            if self.state == CircuitState.HALF_OPEN:
                if self.half_open_calls >= self.half_open_max_calls:
                    raise CircuitBreakerOpenError(
                        f"[{self.name}] 半开状态试探次数已满"
                    )
                self.half_open_calls += 1

        try:
            result = await func(*args, **kwargs)
            await self._on_success()
            return result
        except CircuitBreakerOpenError:
            raise
        except Exception as e:
            await self._on_failure()
            raise

    async def _on_success(self):
        async with self._lock:
            if self.state == CircuitState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.success_threshold:
                    self.state = CircuitState.CLOSED
                    self.failure_count = 0
            else:
                self.failure_count = 0

    async def _on_failure(self):
        async with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.time()

            if self.state == CircuitState.HALF_OPEN:
                self.state = CircuitState.OPEN
            elif (self.state == CircuitState.CLOSED and
                  self.failure_count >= self.failure_threshold):
                self.state = CircuitState.OPEN


class CircuitBreakerOpenError(Exception):
    pass
```

---

#### 3.2 限流（Rate Limiting）

```python
"""
令牌桶限流算法（推荐）
"""
import time
import redis

redis_client = redis.from_url("redis://localhost:6379")


class TokenBucketRateLimiter:
    """
    令牌桶算法：
    - 桶里有一定数量的令牌
    - 请求来了，取走一个令牌
    - 没有令牌，拒绝请求
    - 系统以固定速率往桶里添加令牌

    优点：允许突发流量（桶里有令牌就可以处理）
    """

    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity
        self.refill_rate = refill_rate

    async def is_allowed(self, key: str) -> bool:
        """判断请求是否允许通过"""
        now = time.time()
        bucket_key = f"rate_limit:token_bucket:{key}"

        lua_script = """
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refill_rate = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])

        local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(bucket[1]) or capacity
        local last_refill = tonumber(bucket[2]) or now

        local elapsed = now - last_refill
        local new_tokens = math.min(capacity, tokens + elapsed * refill_rate)

        if new_tokens >= 1 then
            new_tokens = new_tokens - 1
            redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
            redis.call('EXPIRE', key, 3600)
            return 1
        else
            redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
            redis.call('EXPIRE', key, 3600)
            return 0
        end
        """

        result = redis_client.eval(
            lua_script, 1, bucket_key,
            str(self.capacity), str(self.refill_rate), str(now)
        )

        return bool(result)
```

---

#### 3.3 降级（Degradation）

```python
"""
降级：系统压力大时，关闭非核心功能，保证核心功能可用

例子：
- 正常：查询商品详情 + 用户评价 + 推荐商品
- 降级后：只查询商品详情（关闭评价和推荐）
"""
import asyncio
from functools import wraps


class DegradationManager:
    """降级开关管理"""

    def __init__(self):
        self._switches = {
            "comment": True,
            "recommendation": True,
            "search_suggest": True,
            "user_behavior": True,
        }

    def is_enabled(self, feature: str) -> bool:
        return self._switches.get(feature, True)

    def disable(self, feature: str):
        self._switches[feature] = False
        print(f"功能 [{feature}] 已降级（关闭）")

    def enable(self, feature: str):
        self._switches[feature] = True
        print(f"功能 [{feature}] 已恢复")


degradation_manager = DegradationManager()


def degradable(feature: str, default_value=None):
    """降级装饰器"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if not degradation_manager.is_enabled(feature):
                return default_value

            try:
                return await func(*args, **kwargs)
            except Exception as e:
                print(f"功能 [{feature}] 调用失败: {e}，返回默认值")
                return default_value

        return wrapper
    return decorator
```

---

## 六、高可用架构完整案例

把本讲内容整合，看一个完整的高可用设计：

```python
"""
高可用订单服务完整架构

包含：
1. 主从数据库 + 自动切换
2. Redis 缓存 + 降级
3. 熔断器（调用第三方服务）
4. 限流（保护自身）
5. 降级开关（压力大时关闭非核心）
"""
from fastapi import FastAPI, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import asyncio
import logging

app = FastAPI()

db = HighAvailabilityDBPool()
rate_limiter = TokenBucketRateLimiter(capacity=1000, refill_rate=100)
payment_breaker = CircuitBreaker("支付服务", failure_threshold=5, timeout=30)
degradation = DegradationManager()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        client_ip = request.client.host
        allowed = await rate_limiter.is_allowed(client_ip)

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"error": "请求过于频繁"}
            )

        return await call_next(request)

app.add_middleware(RateLimitMiddleware)


@app.post("/order/create")
async def create_order(user_id: int, product_id: int, quantity: int, amount: float):
    """创建订单（核心流程，全程高可用保护）"""

    # Step 1: 查库存（读从库）
    async with db.get_read_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT stock FROM product WHERE id = %s",
                (product_id,)
            )
            product = await cur.fetchone()

    if not product or product["stock"] < quantity:
        raise HTTPException(status_code=400, detail="库存不足")

    # Step 2: 扣库存 + 创建订单（写主库，事务）
    async with db.get_write_conn() as conn:
        async with conn.cursor() as cur:
            await conn.begin()
            try:
                await cur.execute(
                    "UPDATE product SET stock = stock - %s "
                    "WHERE id = %s AND stock >= %s",
                    (quantity, product_id, quantity)
                )

                if cur.rowcount == 0:
                    raise Exception("库存扣减失败")

                await cur.execute(
                    "INSERT INTO order_info (user_id, product_id, quantity, amount, status) "
                    "VALUES (%s, %s, %s, %s, 1)",
                    (user_id, product_id, quantity, amount)
                )

                order_id = cur.lastrowid
                await conn.commit()

            except Exception as e:
                await conn.rollback()
                raise HTTPException(status_code=500, detail=str(e))

    # Step 3: 调用支付服务（熔断保护）
    async def do_pay():
        return {"pay_url": f"https://pay.example.com/{order_id}"}

    try:
        pay_result = await payment_breaker.call(do_pay)
    except CircuitBreakerOpenError:
        pay_result = {"pay_url": f"/order/{order_id}/pay", "note": "支付服务繁忙"}

    # Step 4: 发送通知（可降级）
    if degradation.is_enabled("notification"):
        asyncio.create_task(send_order_notification(user_id, order_id))

    return {
        "order_id": order_id,
        "status": "created",
        "pay_info": pay_result
    }
```

---

## 七、面试高频题

### 1. CAP 定理是什么？为什么不能三者兼得？

**CAP：**
- C（一致性）：所有节点数据相同
- A（可用性）：每个请求都有响应
- P（分区容忍）：网络分区时系统仍运行

**为什么不能三者兼得：**

> 网络分区是必然发生的，P 是必选项。
>
> 分区发生时，节点 A 和节点 B 无法通信：
> - 要保证 C：节点 B 必须等待与 A 同步，期间不能响应 -> 牺牲 A
> - 要保证 A：节点 B 继续响应，但数据可能不是最新的 -> 牺牲 C

**CP 场景：** 金融交易、分布式锁（ZooKeeper）

**AP 场景：** 社交内容、商品展示（最终一致性）

---

### 2. FMEA 是什么？怎么用？

> 故障模式与影响分析，系统地列出所有可能的故障点，评估影响，制定应对措施。

**步骤：**
1. 列出所有组件和故障模式
2. 评估概率（1-10）、严重度（1-10）、可检测性（1-10）
3. 计算 RPN = 概率 x 严重度 x 可检测性
4. 按 RPN 排序，优先处理高分项
5. 制定改进措施

---

### 3. 熔断器的原理和三种状态？

| 状态 | 说明 | 转换条件 |
|------|------|---------|
| 关闭（正常）| 请求正常转发 | 失败次数达到阈值 -> 打开 |
| 打开（熔断）| 拒绝所有请求 | 超过熔断时间 -> 半开 |
| 半开（试探）| 允许少量请求 | 成功 -> 关闭；失败 -> 打开 |

---

### 4. 限流算法有哪些？

| 算法 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| 固定窗口 | 时间窗口内计数 | 简单 | 临界问题 | 简单场景 |
| 滑动窗口 | 滑动时间窗口计数 | 解决临界问题 | 实现稍复杂 | 大多数场景 |
| 漏桶 | 固定速率输出 | 平滑流量 | 不允许突发 | 后端保护 |
| 令牌桶 | 固定速率放入令牌 | 允许突发 | 实现较复杂 | 接口限流（推荐）|

---

### 5. 什么是服务降级？和熔断有什么区别？

| 维度 | 熔断 | 降级 |
|------|------|------|
| **触发原因** | 下游服务故障/超时 | 系统压力大 |
| **作用对象** | 对某个下游服务 | 对某个功能/模块 |
| **触发方式** | 自动（失败次数触发）| 手动或自动 |
| **恢复方式** | 自动（半开试探）| 手动恢复 |
| **目标** | 防止雪崩 | 保核心，弃非核心 |

---

## 八、本讲核心要点总结

### 必须记住的 12 条

1. **CAP：分布式系统最多同时满足两个，P 是必选，实际在 CP/AP 中选**
2. **CP 适合强一致场景（金融），AP 适合高可用场景（社交）**
3. **AP 不是不管一致性，而是追求最终一致性**
4. **FMEA：用概率 x 严重度 x 可检测性 = RPN 量化风险，驱动优先级**
5. **主备架构：备库平时不服务，故障时切换，资源有些浪费**
6. **主从架构：从库提供读服务，扩展读能力，主库故障时选从库升主**
7. **主主架构：写冲突难处理，慎用**
8. **从库读需注意主从延迟，强一致场景读主库**
9. **熔断器三状态：关闭（正常）-> 打开（熔断）-> 半开（试探）**
10. **限流推荐令牌桶：允许突发，平均速率受控**
11. **降级：系统压力大时关闭非核心功能，保证核心可用**
12. **高可用不是单点解决，是多层防御：存储层 + 计算层 + 接口层**

---

## 九、课后练习

### 练习 1：FMEA 分析
对你熟悉的一个系统（公司项目或假想系统）做 FMEA 分析：
1. 列出至少 10 个故障点
2. 给每个故障打分
3. 找出 Top 3 风险
4. 给出改进建议

### 练习 2：熔断器实战
使用本讲的 CircuitBreaker 代码：
1. 模拟一个不稳定的下游服务（随机失败）
2. 观察熔断器的状态变化
3. 验证熔断后不再发请求

### 练习 3：限流测试
实现一个 FastAPI 接口，集成令牌桶限流：
1. 配置每秒 10 个请求
2. 用并发测试工具验证限流效果
3. 观察 429 响应

### 练习 4：综合设计
设计一个高可用的用户认证服务：
1. FMEA 分析找出风险点
2. 数据库层：主从 + 自动切换
3. 缓存层：Redis Session 存储
4. 接口层：限流 + 熔断
5. 画出架构图

---

## 十、下一讲预告

**第 6 讲：高可用架构模式（下）——异地多活与微服务拆分**

会讲：
- 异地多活架构：同城双活、跨城异地
- 异地多活的核心挑战：数据同步、流量调度
- 异地多活的四个设计步骤
- 微服务拆分原则：三个火枪手、DDD
- 微服务粒度如何把控
- 微服务的基础设施：注册发现、配置中心、链路追踪
- Python 微服务实战
- 面试高频题
