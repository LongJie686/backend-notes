# 第 6 讲：分布式数据一致性（Python 版）— 分布式事务、幂等、最终一致性实战

这一讲是微服务**最难、最容易踩坑**的部分。

单体架构里，一个数据库事务就能解决所有一致性问题。微服务拆分后，数据分散在多个数据库，本地事务失效，一致性变成了系统设计的核心难题。

这一讲的目标是让你：
- **彻底理解 CAP 定理和 BASE 理论**
- **搞清楚微服务为什么不能用本地事务**
- **掌握分布式事务的五种方案**
- **能用 Python 实现本地消息表方案**
- **能用 Python 实现 Saga 模式**
- **掌握幂等性的完整设计方案**
- **理解补偿机制和对账设计**
- **规避大厂常见的数据一致性坑点**

---

## 一、从一个问题开始

### 下单扣库存扣余额，怎么保证一致性？

**场景：**
```
用户点击"下单"
   ↓
1. 订单服务：创建订单（order_db）
2. 库存服务：扣减库存（inventory_db）
3. 账户服务：扣减余额（account_db）
```

**问题：**
- 步骤 1 成功，步骤 2 失败 → 订单创建了，库存没扣
- 步骤 1、2 成功，步骤 3 失败 → 库存扣了，余额没扣
- 网络超时，不知道成没成功 → 要不要重试？重试会不会重复扣？

**在单体架构里：**
```python
with db.transaction():
    create_order()
    deduct_inventory()
    deduct_balance()
# 任何一步失败，全部回滚
```

**在微服务里：** 三个服务三个数据库，本地事务**管不了**跨库操作。

---

## 二、CAP 定理

### 1. 什么是 CAP？

**CAP 是分布式系统的三个核心属性：**

```
        C（一致性）
       Consistency
           ▲
           │
           │  只能三选二
           │
  ─────────┼─────────
 /          │          \
A ──────────┼────────── P
可用性      │         分区容错性
Availability│         Partition Tolerance
```

| 属性 | 说明 |
|------|------|
| **C（一致性）** | 所有节点同一时间看到的数据完全一致 |
| **A（可用性）** | 每个请求都能得到响应（不管数据是否最新） |
| **P（分区容错性）** | 网络分区（节点间通信断了）时系统仍然运行 |

---

### 2. 为什么只能三选二？

**网络分区在分布式系统中是必然发生的**（网络抖动、机房故障）。

所以 P 必须保留，实际上是在 **C 和 A 之间做取舍**：

| 选择 | 说明 | 代表系统 |
|------|------|---------|
| **CP** | 保证一致性，牺牲可用性 | Zookeeper、Consul、Etcd |
| **AP** | 保证可用性，牺牲一致性 | Eureka、Cassandra、DynamoDB |

**举例：**

**CP 场景：**
```
主节点和从节点网络断了
CP 系统：拒绝写入，保证数据一致
后果：系统不可用
```

**AP 场景：**
```
主节点和从节点网络断了
AP 系统：允许写入，两边数据可能不一样
后果：数据不一致，但系统可用
```

---

### 3. 微服务场景下怎么选？

**大多数互联网业务选 AP：**
- 用户宁愿看到稍旧的数据，也不愿意系统不可用
- 通过最终一致性弥补

**少数场景选 CP：**
- 注册中心（Consul）：服务地址错了会导致调用失败
- 分布式锁：必须强一致

---

## 三、BASE 理论

### 什么是 BASE？

**BASE 是 CAP 中 AP 的工程化落地：**

| 术语 | 全称 | 说明 |
|------|------|------|
| **BA** | Basically Available（基本可用） | 出故障时允许损失部分可用性 |
| **S** | Soft State（软状态） | 允许数据存在中间状态 |
| **E** | Eventually Consistent（最终一致） | 经过一段时间后数据最终一致 |

**生活类比：**
```
你给朋友转账 100 元
银行扣了你的钱（-100）
朋友收到的钱不是立刻到账
可能 T+1 到账（中间有软状态）
但最终两边的账目是一致的（最终一致）
```

---

### BASE 的核心思想

```
强一致性（ACID）
   ↓ 太难、性能差
放弃强一致性
   ↓
保证最终一致性
   ↓ 如何实现？
补偿机制 + 重试 + 对账
```

---

## 四、为什么微服务不能用本地事务？

### 1. 本地事务的工作原理

```python
# 单体架构，所有操作在同一个数据库连接内
with db.transaction():
    db.execute("INSERT INTO orders ...")     # 步骤1
    db.execute("UPDATE inventory ...")      # 步骤2
    db.execute("UPDATE account ...")        # 步骤3
# 全部成功：提交
# 任何失败：全部回滚
```

**ACID 保证由数据库引擎提供。**

---

### 2. 微服务的问题

```python
# 微服务，三个服务三个数据库
order_db.execute("INSERT INTO orders ...")       # 订单库
inventory_db.execute("UPDATE inventory ...")     # 库存库
account_db.execute("UPDATE account ...")         # 账户库
```

**三个数据库的事务完全独立，无法统一提交/回滚。**

你没有办法：
- 让三个数据库的操作原子性执行
- 任何一步失败时回滚另外两步

---

### 3. 分布式事务的难点

```
时序问题：
步骤1（订单服务）执行中 → 步骤2（库存服务）执行中
↓
网络超时
↓
步骤2 到底执行没有？
↓
重试步骤2 → 会不会重复扣库存？
不重试 → 订单有了，库存没扣
```

**这就是分布式事务最难的地方：不确定性。**

---

## 五、分布式事务的五种方案

### 方案对比

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|-------|------|-------|---------|
| **2PC** | 强一致 | 差 | 中 | 传统数据库跨库 |
| **TCC** | 强一致 | 中 | 高 | 金融、核心交易 |
| **Saga** | 最终一致 | 好 | 中 | 长事务、微服务 |
| **本地消息表** | 最终一致 | 好 | 中 | 跨服务异步 |
| **事务消息** | 最终一致 | 好 | 低 | MQ 场景 |

---

### 方案一：2PC（两阶段提交）

#### 原理

```
协调者（Coordinator）
   │
   ├──[准备阶段]──────────────────────────────────────────
   │    ├──> 参与者A："你能提交吗？" → A："能"（锁住资源）
   │    ├──> 参与者B："你能提交吗？" → B："能"（锁住资源）
   │    └──> 参与者C："你能提交吗？" → C："能"（锁住资源）
   │
   ├──[提交阶段]──────────────────────────────────────────
   │    ├──> 参与者A："提交！" → A：提交，释放锁
   │    ├──> 参与者B："提交！" → B：提交，释放锁
   │    └──> 参与者C："提交！" → C：提交，释放锁
   │
   └──[任何参与者说"不能"则全部回滚]
```

#### 问题

```
1. 同步阻塞：准备阶段所有参与者都在等，锁住资源
2. 协调者单点：协调者挂了，参与者一直等
3. 数据不一致：提交阶段协调者挂了，部分提交部分没提交
4. 性能差：锁持有时间长，吞吐量低
```

**结论：2PC 在高并发微服务场景基本不用。**

---

### 方案二：TCC（Try-Confirm-Cancel）

#### 原理

```
三个阶段：
Try（预留）→ Confirm（确认）→ Cancel（取消）

场景：下单扣库存

Try 阶段：
  订单服务 → 创建订单（状态：待确认）
  库存服务 → 冻结库存（不是真扣，只是标记冻结）
  账户服务 → 冻结余额

Confirm 阶段（Try 全部成功）：
  订单服务 → 订单状态改为"已创建"
  库存服务 → 真正扣减冻结的库存
  账户服务 → 真正扣减冻结的余额

Cancel 阶段（任何 Try 失败）：
  订单服务 → 删除待确认订单
  库存服务 → 释放冻结的库存
  账户服务 → 释放冻结的余额
```

#### Python 实现

```python
from enum import Enum
from dataclasses import dataclass
from typing import List, Callable
import uuid

class TransactionStatus(Enum):
    TRYING = "trying"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


@dataclass
class TCCParticipant:
    """TCC 参与者"""
    name: str
    try_func: Callable        # Try 阶段
    confirm_func: Callable    # Confirm 阶段
    cancel_func: Callable     # Cancel 阶段


class TCCCoordinator:
    """TCC 协调者"""
    
    def __init__(self):
        # 实际应存数据库，保证协调者重启后能继续
        self.transactions = {}
    
    def execute(self, participants: List[TCCParticipant], context: dict):
        """
        执行 TCC 事务
        context: 传递给每个阶段的上下文数据
        """
        tx_id = str(uuid.uuid4())
        
        # 记录事务
        self.transactions[tx_id] = {
            "status": TransactionStatus.TRYING,
            "participants": [p.name for p in participants]
        }
        
        # ===== Try 阶段 =====
        tried = []
        try:
            for participant in participants:
                print(f"[TCC] Try: {participant.name}")
                participant.try_func(tx_id, context)
                tried.append(participant)
            
            # 所有 Try 成功
            self.transactions[tx_id]["status"] = TransactionStatus.CONFIRMED
            
        except Exception as e:
            print(f"[TCC] Try failed: {e}, cancelling...")
            
            # Try 失败，Cancel 已经 Try 的参与者
            for participant in tried:
                try:
                    print(f"[TCC] Cancel: {participant.name}")
                    participant.cancel_func(tx_id, context)
                except Exception as cancel_error:
                    # Cancel 失败要记录，后续人工处理或定时重试
                    print(f"[TCC] Cancel failed for {participant.name}: {cancel_error}")
            
            self.transactions[tx_id]["status"] = TransactionStatus.CANCELLED
            raise
        
        # ===== Confirm 阶段 =====
        for participant in participants:
            try:
                print(f"[TCC] Confirm: {participant.name}")
                participant.confirm_func(tx_id, context)
            except Exception as e:
                # Confirm 失败要重试，必须保证最终成功
                print(f"[TCC] Confirm failed for {participant.name}: {e}")
                # 实际场景：加入重试队列
        
        return tx_id


# ============================================================
# 业务实现：下单扣库存扣余额
# ============================================================

class OrderParticipant:
    """订单服务 TCC 参与者"""
    
    def try_order(self, tx_id: str, context: dict):
        """预创建订单（状态：待确认）"""
        order_id = context["order_id"]
        print(f"  Order Try: create pending order {order_id}")
        # db.execute("INSERT INTO orders (id, status) VALUES (?, 'pending')", order_id)
    
    def confirm_order(self, tx_id: str, context: dict):
        """确认订单"""
        order_id = context["order_id"]
        print(f"  Order Confirm: confirm order {order_id}")
        # db.execute("UPDATE orders SET status='confirmed' WHERE id=?", order_id)
    
    def cancel_order(self, tx_id: str, context: dict):
        """取消订单"""
        order_id = context["order_id"]
        print(f"  Order Cancel: delete pending order {order_id}")
        # db.execute("DELETE FROM orders WHERE id=? AND status='pending'", order_id)


class InventoryParticipant:
    """库存服务 TCC 参与者"""
    
    def try_inventory(self, tx_id: str, context: dict):
        """冻结库存"""
        product_id = context["product_id"]
        quantity = context["quantity"]
        print(f"  Inventory Try: freeze {quantity} of product {product_id}")
        # 检查库存是否足够
        # db.execute("UPDATE inventory SET frozen=frozen+? WHERE product_id=? AND available>=?",
        #            quantity, product_id, quantity)
    
    def confirm_inventory(self, tx_id: str, context: dict):
        """真正扣减库存"""
        product_id = context["product_id"]
        quantity = context["quantity"]
        print(f"  Inventory Confirm: deduct {quantity} of product {product_id}")
        # db.execute("UPDATE inventory SET available=available-?, frozen=frozen-? WHERE product_id=?",
        #            quantity, quantity, product_id)
    
    def cancel_inventory(self, tx_id: str, context: dict):
        """释放冻结库存"""
        product_id = context["product_id"]
        quantity = context["quantity"]
        print(f"  Inventory Cancel: release {quantity} of product {product_id}")
        # db.execute("UPDATE inventory SET frozen=frozen-? WHERE product_id=?",
        #            quantity, product_id)


class AccountParticipant:
    """账户服务 TCC 参与者"""
    
    def try_account(self, tx_id: str, context: dict):
        """冻结余额"""
        user_id = context["user_id"]
        amount = context["amount"]
        print(f"  Account Try: freeze {amount} for user {user_id}")
        # db.execute("UPDATE accounts SET frozen=frozen+? WHERE user_id=? AND balance>=?",
        #            amount, user_id, amount)
    
    def confirm_account(self, tx_id: str, context: dict):
        """真正扣减余额"""
        user_id = context["user_id"]
        amount = context["amount"]
        print(f"  Account Confirm: deduct {amount} for user {user_id}")
        # db.execute("UPDATE accounts SET balance=balance-?, frozen=frozen-? WHERE user_id=?",
        #            amount, amount, user_id)
    
    def cancel_account(self, tx_id: str, context: dict):
        """释放冻结余额"""
        user_id = context["user_id"]
        amount = context["amount"]
        print(f"  Account Cancel: release {amount} for user {user_id}")
        # db.execute("UPDATE accounts SET frozen=frozen-? WHERE user_id=?",
        #            amount, user_id)


# 使用示例
def create_order_with_tcc():
    order = OrderParticipant()
    inventory = InventoryParticipant()
    account = AccountParticipant()
    
    coordinator = TCCCoordinator()
    
    participants = [
        TCCParticipant(
            name="order-service",
            try_func=order.try_order,
            confirm_func=order.confirm_order,
            cancel_func=order.cancel_order
        ),
        TCCParticipant(
            name="inventory-service",
            try_func=inventory.try_inventory,
            confirm_func=inventory.confirm_inventory,
            cancel_func=inventory.cancel_inventory
        ),
        TCCParticipant(
            name="account-service",
            try_func=account.try_account,
            confirm_func=account.confirm_account,
            cancel_func=account.cancel_account
        ),
    ]
    
    context = {
        "order_id": "order-001",
        "product_id": "product-001",
        "quantity": 2,
        "user_id": "user-001",
        "amount": 199.00
    }
    
    try:
        tx_id = coordinator.execute(participants, context)
        print(f"\n✅ TCC transaction succeeded: {tx_id}")
    except Exception as e:
        print(f"\n❌ TCC transaction failed: {e}")


if __name__ == "__main__":
    create_order_with_tcc()
```

---

#### TCC 的注意事项

```
1. 空回滚：Cancel 收到了，但 Try 还没执行
   解决：Cancel 时检查是否有 Try 记录，没有就直接返回成功

2. 幂等：Try/Confirm/Cancel 都要幂等
   解决：每个阶段用 tx_id 做幂等检查

3. 悬挂：Try 超时，Cancel 先到，Try 后到
   解决：Cancel 执行后，Try 不再执行
```

---

### 方案三：Saga 模式 ✅ 推荐

#### 原理

**Saga 把一个大事务拆分成一系列本地事务，每个本地事务有对应的补偿操作。**

```
正向流程：
T1（创建订单）→ T2（扣库存）→ T3（扣余额）→ 成功

补偿流程（T3 失败）：
T1 → T2 → T3 失败
         ↓
C2（恢复库存）← C1（取消订单）← 回滚完成
```

**两种实现方式：**

| 方式 | 说明 | 适用 |
|------|------|------|
| **编排式（Orchestration）** | 有中央协调者控制流程 | 流程复杂，需要统一管控 |
| **协同式（Choreography）** | 服务间通过事件驱动 | 服务松耦合，简单流程 |

---

#### Python 实现：编排式 Saga

```python
from dataclasses import dataclass, field
from typing import List, Callable, Optional
from enum import Enum
import uuid
import json


class StepStatus(Enum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    COMPENSATED = "compensated"


@dataclass
class SagaStep:
    """Saga 步骤"""
    name: str
    action: Callable           # 正向操作
    compensation: Callable     # 补偿操作
    status: StepStatus = StepStatus.PENDING


@dataclass
class SagaTransaction:
    """Saga 事务"""
    id: str
    steps: List[SagaStep]
    context: dict
    current_step: int = 0


class SagaOrchestrator:
    """
    Saga 编排者
    负责驱动整个 Saga 执行
    """
    
    def __init__(self):
        # 实际应存数据库（保证重启后能恢复）
        self.transactions = {}
    
    def execute(self, steps: List[SagaStep], context: dict) -> str:
        """执行 Saga 事务"""
        tx = SagaTransaction(
            id=str(uuid.uuid4()),
            steps=steps,
            context=context
        )
        self.transactions[tx.id] = tx
        
        print(f"\n[SAGA] Starting transaction {tx.id}")
        
        # 顺序执行每个步骤
        for i, step in enumerate(tx.steps):
            tx.current_step = i
            
            try:
                print(f"[SAGA] Executing step {i+1}/{len(steps)}: {step.name}")
                step.action(tx.id, context)
                step.status = StepStatus.SUCCEEDED
                print(f"[SAGA] Step {step.name} succeeded")
                
            except Exception as e:
                step.status = StepStatus.FAILED
                print(f"[SAGA] Step {step.name} failed: {e}")
                
                # 执行补偿
                self._compensate(tx, i - 1)
                raise Exception(f"Saga failed at step {step.name}: {e}")
        
        print(f"[SAGA] Transaction {tx.id} completed successfully")
        return tx.id
    
    def _compensate(self, tx: SagaTransaction, from_step: int):
        """
        从 from_step 开始，逆序执行补偿
        """
        print(f"[SAGA] Starting compensation from step {from_step + 1}")
        
        for i in range(from_step, -1, -1):
            step = tx.steps[i]
            if step.status == StepStatus.SUCCEEDED:
                try:
                    print(f"[SAGA] Compensating step: {step.name}")
                    step.compensation(tx.id, tx.context)
                    step.status = StepStatus.COMPENSATED
                    print(f"[SAGA] Compensation of {step.name} succeeded")
                except Exception as e:
                    # 补偿失败：记录，等待重试或人工处理
                    print(f"[SAGA] Compensation of {step.name} FAILED: {e}")
                    # 实际：存入重试队列
                    self._save_compensation_failure(tx, step, e)
    
    def _save_compensation_failure(self, tx, step, error):
        """记录补偿失败，等待人工或自动重试"""
        print(f"[SAGA] ⚠️ Need manual intervention: tx={tx.id}, step={step.name}")


# ============================================================
# 业务实现
# ============================================================

class OrderService:
    def create_order(self, tx_id: str, ctx: dict):
        print(f"  → Creating order {ctx['order_id']}")
        # INSERT INTO orders ...

    def cancel_order(self, tx_id: str, ctx: dict):
        print(f"  → Cancelling order {ctx['order_id']}")
        # UPDATE orders SET status='cancelled' WHERE id=?


class InventoryService:
    def deduct_inventory(self, tx_id: str, ctx: dict):
        print(f"  → Deducting {ctx['quantity']} from product {ctx['product_id']}")
        # UPDATE inventory SET stock=stock-? ...
        # 模拟库存不足
        if ctx.get("simulate_inventory_fail"):
            raise Exception("Insufficient inventory")
    
    def restore_inventory(self, tx_id: str, ctx: dict):
        print(f"  → Restoring {ctx['quantity']} to product {ctx['product_id']}")
        # UPDATE inventory SET stock=stock+? ...


class AccountService:
    def deduct_balance(self, tx_id: str, ctx: dict):
        print(f"  → Deducting {ctx['amount']} from user {ctx['user_id']}")
        # UPDATE accounts SET balance=balance-? ...
        if ctx.get("simulate_account_fail"):
            raise Exception("Insufficient balance")
    
    def restore_balance(self, tx_id: str, ctx: dict):
        print(f"  → Restoring {ctx['amount']} to user {ctx['user_id']}")
        # UPDATE accounts SET balance=balance+? ...


class NotificationService:
    def send_notification(self, tx_id: str, ctx: dict):
        print(f"  → Sending order confirmation to user {ctx['user_id']}")
    
    def send_failure_notification(self, tx_id: str, ctx: dict):
        print(f"  → Sending order failure notification to user {ctx['user_id']}")


# 使用示例
def run_saga_demo():
    order_svc = OrderService()
    inventory_svc = InventoryService()
    account_svc = AccountService()
    notification_svc = NotificationService()
    
    orchestrator = SagaOrchestrator()
    
    # 定义 Saga 步骤
    steps = [
        SagaStep(
            name="create-order",
            action=order_svc.create_order,
            compensation=order_svc.cancel_order
        ),
        SagaStep(
            name="deduct-inventory",
            action=inventory_svc.deduct_inventory,
            compensation=inventory_svc.restore_inventory
        ),
        SagaStep(
            name="deduct-balance",
            action=account_svc.deduct_balance,
            compensation=account_svc.restore_balance
        ),
        SagaStep(
            name="send-notification",
            action=notification_svc.send_notification,
            compensation=notification_svc.send_failure_notification
        ),
    ]
    
    # 测试 1：成功场景
    print("=" * 50)
    print("测试 1：正常下单")
    print("=" * 50)
    context = {
        "order_id": "order-001",
        "product_id": "product-001",
        "quantity": 2,
        "user_id": "user-001",
        "amount": 199.00
    }
    try:
        orchestrator.execute(steps, context)
    except Exception as e:
        print(f"❌ Failed: {e}")
    
    # 测试 2：库存不足，触发补偿
    print("\n" + "=" * 50)
    print("测试 2：库存不足，触发补偿")
    print("=" * 50)
    context_fail = {
        "order_id": "order-002",
        "product_id": "product-001",
        "quantity": 999,
        "user_id": "user-001",
        "amount": 199.00,
        "simulate_inventory_fail": True  # 模拟库存不足
    }
    try:
        orchestrator.execute(steps, context_fail)
    except Exception as e:
        print(f"❌ Transaction failed (expected): {e}")


if __name__ == "__main__":
    run_saga_demo()
```

---

### 方案四：本地消息表 ✅ 最常用

#### 原理

**核心思想：把分布式事务转换成本地事务 + 消息可靠投递。**

```
步骤：
1. 在同一个数据库里，业务操作 + 写消息表，用本地事务保证原子性
2. 定时任务扫描消息表，发送未处理的消息到 MQ
3. 消费者消费消息，处理成功后更新消息状态
4. 消息失败时重试，成功后标记完成
```

**关键点：**
```
订单库：
  orders 表（业务数据）
  outbox 表（消息表）← 和业务数据在同一个数据库

同一个本地事务：
  INSERT INTO orders ...
  INSERT INTO outbox ...
↑ 要么都成功，要么都失败，本地事务保证
```

---

#### Python 实现：完整本地消息表

```python
import sqlite3
import uuid
import json
import time
import threading
from datetime import datetime
from enum import Enum


class MessageStatus(Enum):
    PENDING = "pending"       # 待发送
    SENDING = "sending"       # 发送中
    SENT = "sent"             # 已发送
    FAILED = "failed"         # 发送失败


# ============================================================
# 数据库初始化
# ============================================================

def init_db(db_path: str):
    """初始化数据库（订单库 + 消息表在同一个库）"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 业务表：订单
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'created',
            created_at TEXT NOT NULL
        )
    """)
    
    # 本地消息表（Outbox）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY,
            topic TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retry INTEGER NOT NULL DEFAULT 3,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    
    conn.commit()
    conn.close()


# ============================================================
# 订单服务：业务操作 + 写消息表（同一个本地事务）
# ============================================================

class OrderService:
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def create_order(self, order_data: dict) -> str:
        """
        创建订单
        在同一个本地事务中：
        1. 写订单记录
        2. 写消息表（outbox）
        """
        order_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 开始本地事务
            cursor.execute("BEGIN")
            
            # 1. 写订单记录
            cursor.execute("""
                INSERT INTO orders 
                (id, user_id, product_id, quantity, amount, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'created', ?)
            """, (
                order_id,
                order_data["user_id"],
                order_data["product_id"],
                order_data["quantity"],
                order_data["amount"],
                now
            ))
            
            # 2. 写消息表（同一个事务！）
            message_id = str(uuid.uuid4())
            message_payload = json.dumps({
                "order_id": order_id,
                "user_id": order_data["user_id"],
                "product_id": order_data["product_id"],
                "quantity": order_data["quantity"],
                "amount": order_data["amount"],
                "event": "ORDER_CREATED"
            })
            
            cursor.execute("""
                INSERT INTO outbox
                (id, topic, payload, status, retry_count, max_retry, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', 0, 3, ?, ?)
            """, (
                message_id,
                "order.created",    # 消息主题
                message_payload,
                now,
                now
            ))
            
            # 提交本地事务
            # 如果这里失败，订单和消息都不会写入
            conn.commit()
            
            print(f"✅ Order created: {order_id}")
            print(f"✅ Message queued: {message_id}")
            return order_id
        
        except Exception as e:
            conn.rollback()
            print(f"❌ Order creation failed: {e}")
            raise
        finally:
            conn.close()


# ============================================================
# 消息发布者：定时扫描 outbox 表，发送消息
# ============================================================

class OutboxPublisher:
    """
    Outbox 消息发布者
    定时扫描 outbox 表，把 PENDING 的消息发送出去
    """
    
    def __init__(self, db_path: str, mq_client=None):
        self.db_path = db_path
        self.mq_client = mq_client  # 实际是 RabbitMQ/Kafka 客户端
        self.running = False
    
    def start(self, interval: float = 1.0):
        """启动定时发布"""
        self.running = True
        
        def run():
            while self.running:
                try:
                    self._publish_pending_messages()
                except Exception as e:
                    print(f"Publisher error: {e}")
                time.sleep(interval)
        
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        print("📤 Outbox publisher started")
    
    def stop(self):
        self.running = False
    
    def _publish_pending_messages(self):
        """发送待处理的消息"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 查询待发送的消息（批量处理）
            cursor.execute("""
                SELECT id, topic, payload, retry_count, max_retry
                FROM outbox
                WHERE status = 'pending'
                AND retry_count < max_retry
                ORDER BY created_at ASC
                LIMIT 10
            """)
            
            messages = cursor.fetchall()
            
            for msg_id, topic, payload, retry_count, max_retry in messages:
                # 标记为发送中（防止并发重复发送）
                cursor.execute("""
                    UPDATE outbox
                    SET status = 'sending', updated_at = ?
                    WHERE id = ? AND status = 'pending'
                """, (datetime.now().isoformat(), msg_id))
                
                if cursor.rowcount == 0:
                    continue  # 被其他进程抢先处理了
                
                conn.commit()
                
                # 发送消息到 MQ
                success = self._send_to_mq(topic, json.loads(payload))
                
                if success:
                    # 标记为已发送
                    cursor.execute("""
                        UPDATE outbox
                        SET status = 'sent', updated_at = ?
                        WHERE id = ?
                    """, (datetime.now().isoformat(), msg_id))
                    print(f"📨 Message sent: {msg_id[:8]}... topic={topic}")
                else:
                    # 发送失败，更新重试次数
                    cursor.execute("""
                        UPDATE outbox
                        SET status = 'pending',
                            retry_count = retry_count + 1,
                            updated_at = ?
                        WHERE id = ?
                    """, (datetime.now().isoformat(), msg_id))
                    print(f"⚠️ Message send failed, retry {retry_count + 1}: {msg_id[:8]}...")
                
                conn.commit()
        
        finally:
            conn.close()
    
    def _send_to_mq(self, topic: str, payload: dict) -> bool:
        """
        发送消息到 MQ
        实际项目用 RabbitMQ / Kafka / RocketMQ
        这里用打印模拟
        """
        if self.mq_client:
            return self.mq_client.publish(topic, payload)
        
        # 模拟发送（90% 成功率）
        import random
        success = random.random() > 0.1
        return success


# ============================================================
# 消息消费者：消费 MQ 消息，处理业务
# ============================================================

class InventoryConsumer:
    """
    库存服务：消费订单创建消息，扣减库存
    """
    
    def __init__(self):
        # 记录已处理的消息（幂等）
        self.processed_messages = set()
    
    def handle_order_created(self, message: dict):
        """
        处理订单创建消息
        必须保证幂等！消息可能被重复投递
        """
        order_id = message["order_id"]
        
        # 幂等检查（实际用 Redis 或数据库）
        if order_id in self.processed_messages:
            print(f"⚠️ Duplicate message for order {order_id}, skipping")
            return
        
        try:
            # 扣减库存（库存库本地事务）
            self._deduct_inventory(
                product_id=message["product_id"],
                quantity=message["quantity"],
                order_id=order_id
            )
            
            # 记录已处理
            self.processed_messages.add(order_id)
            print(f"✅ Inventory deducted for order {order_id}")
        
        except Exception as e:
            print(f"❌ Inventory deduction failed for order {order_id}: {e}")
            raise  # 抛出异常，MQ 会重试
    
    def _deduct_inventory(self, product_id: str, quantity: int, order_id: str):
        """实际扣减库存"""
        print(f"  Deducting {quantity} units of product {product_id}")
        # UPDATE inventory SET stock=stock-? WHERE product_id=? AND stock>=?


# ============================================================
# 完整演示
# ============================================================

def run_local_message_table_demo():
    db_path = "order.db"
    init_db(db_path)
    
    # 初始化服务
    order_svc = OrderService(db_path)
    publisher = OutboxPublisher(db_path)
    inventory_consumer = InventoryConsumer()
    
    # 启动消息发布者
    publisher.start(interval=2.0)
    
    # 创建几个订单
    for i in range(3):
        order_svc.create_order({
            "user_id": f"user-00{i+1}",
            "product_id": "product-001",
            "quantity": i + 1,
            "amount": (i + 1) * 99.0
        })
    
    # 等待消息发送
    print("\n⏳ Waiting for messages to be published...")
    time.sleep(5)
    
    publisher.stop()
    print("\n✅ Demo completed")


if __name__ == "__main__":
    run_local_message_table_demo()
```

---

### 方案五：事务消息（RocketMQ）

#### 原理

```
RocketMQ 事务消息流程：

1. 生产者发送"半消息"（消费者不可见）
2. RocketMQ 存储半消息，返回 OK
3. 生产者执行本地事务
4a. 本地事务成功 → 发送 COMMIT → 消费者可见
4b. 本地事务失败 → 发送 ROLLBACK → 消息删除
5. 如果生产者没响应（崩溃）→ RocketMQ 定期回查
```

**和本地消息表的区别：**

| 维度 | 本地消息表 | 事务消息 |
|------|----------|---------|
| 依赖 | 数据库 + 定时任务 | RocketMQ |
| 复杂度 | 中 | 低（框架支持） |
| 性能 | 好 | 好 |
| 适用 | 不限 MQ | 仅 RocketMQ |

---

## 六、幂等性完整方案

### 1. 为什么幂等性是分布式系统的基石？

**场景：**
```
订单服务 → 扣库存（超时，不知道成没成）
         → 重试扣库存
         → 又扣了一次！
```

**幂等性定义：**
同一个操作执行多次，结果和执行一次完全相同。

---

### 2. 幂等性实现方案

#### 方案 A：唯一请求 ID + Redis 去重

```python
import redis
import uuid
import json
import functools

redis_client = redis.from_url("redis://localhost:6379")


def idempotent(ttl: int = 86400):
    """
    幂等性装饰器
    要求请求中带 request_id
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(request_id: str, *args, **kwargs):
            # 幂等 Key
            idempotent_key = f"idempotent:{func.__name__}:{request_id}"
            
            # 1. 检查是否已处理
            cached = redis_client.get(idempotent_key)
            if cached:
                print(f"⚠️ Duplicate request {request_id}, returning cached result")
                return json.loads(cached)
            
            # 2. 用 SET NX 加锁（防并发）
            lock_key = f"idempotent:lock:{func.__name__}:{request_id}"
            locked = redis_client.set(lock_key, "1", ex=30, nx=True)
            
            if not locked:
                raise Exception("Request is being processed, please wait")
            
            try:
                # 3. 执行业务逻辑
                result = func(request_id, *args, **kwargs)
                
                # 4. 缓存结果
                redis_client.setex(
                    idempotent_key,
                    ttl,
                    json.dumps(result)
                )
                
                return result
            finally:
                redis_client.delete(lock_key)
        
        return wrapper
    return decorator


# 使用示例
@idempotent(ttl=3600)  # 结果缓存 1 小时
def create_order(request_id: str, order_data: dict):
    """创建订单（幂等）"""
    order_id = str(uuid.uuid4())
    print(f"Creating order {order_id} for request {request_id}")
    # 实际写数据库
    return {
        "order_id": order_id,
        "status": "created",
        "request_id": request_id
    }


# 测试
req_id = str(uuid.uuid4())
order_data = {"user_id": "user-001", "amount": 100}

result1 = create_order(req_id, order_data)
result2 = create_order(req_id, order_data)  # 重复请求

# 两次返回相同的 order_id
assert result1["order_id"] == result2["order_id"]
print(f"✅ Idempotency verified: {result1['order_id']}")
```

---

#### 方案 B：数据库唯一索引

```python
import sqlite3

def deduct_inventory_idempotent(order_id: str, product_id: str, quantity: int):
    """
    幂等的库存扣减
    用 order_id 做唯一约束
    """
    conn = sqlite3.connect("inventory.db")
    
    try:
        # 创建去重表（实际建在库存库里）
        conn.execute("""
            CREATE TABLE IF NOT EXISTS inventory_deductions (
                order_id TEXT PRIMARY KEY,    -- 唯一约束
                product_id TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        
        # 尝试插入去重记录（重复插入会失败）
        conn.execute("""
            INSERT OR IGNORE INTO inventory_deductions
            (order_id, product_id, quantity, created_at)
            VALUES (?, ?, ?, datetime('now'))
        """, (order_id, product_id, quantity))
        
        if conn.total_changes > 0:
            # 新记录，真正扣减库存
            conn.execute("""
                UPDATE inventory
                SET stock = stock - ?
                WHERE product_id = ? AND stock >= ?
            """, (quantity, product_id, quantity))
            print(f"✅ Inventory deducted: order={order_id}, qty={quantity}")
        else:
            # 已处理过，直接返回
            print(f"⚠️ Duplicate deduction for order {order_id}, skipped")
        
        conn.commit()
    finally:
        conn.close()
```

---

#### 方案 C：状态机

```python
from enum import Enum

class OrderStatus(Enum):
    CREATED = "created"
    PAYING = "paying"
    PAID = "paid"
    CANCELLED = "cancelled"

# 允许的状态转换
VALID_TRANSITIONS = {
    OrderStatus.CREATED: [OrderStatus.PAYING, OrderStatus.CANCELLED],
    OrderStatus.PAYING: [OrderStatus.PAID, OrderStatus.CANCELLED],
    OrderStatus.PAID: [],  # 终态
    OrderStatus.CANCELLED: [],  # 终态
}

def transition_order_status(order_id: str, new_status: OrderStatus):
    """
    幂等的状态转换
    非法转换直接忽略
    """
    # 获取当前状态
    current_status = get_order_status(order_id)
    
    if current_status == new_status:
        # 已经是目标状态，幂等
        print(f"Order {order_id} already in status {new_status}")
        return
    
    if new_status not in VALID_TRANSITIONS.get(current_status, []):
        raise Exception(
            f"Invalid transition: {current_status} → {new_status}"
        )
    
    # 执行状态转换
    update_order_status(order_id, new_status)
    print(f"Order {order_id}: {current_status} → {new_status}")


def get_order_status(order_id: str) -> OrderStatus:
    """查询订单状态"""
    return OrderStatus.CREATED  # 模拟

def update_order_status(order_id: str, status: OrderStatus):
    """更新订单状态"""
    pass  # 实际写数据库
```

---

## 七、补偿机制与对账

### 1. 补偿机制

**什么时候需要补偿？**
- Saga 中某个步骤失败，需要回滚前面的步骤
- 消息消费失败，需要重试
- 数据不一致，需要修正

---

### 2. 定时补偿任务

```python
import sqlite3
import time
import threading
from datetime import datetime, timedelta


class CompensationJob:
    """
    定时补偿任务
    扫描处于中间状态的数据，执行补偿
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.running = False
    
    def start(self, interval: float = 60.0):
        """每分钟执行一次补偿"""
        self.running = True
        
        def run():
            while self.running:
                try:
                    self._compensate_stuck_orders()
                    self._retry_failed_messages()
                except Exception as e:
                    print(f"Compensation error: {e}")
                time.sleep(interval)
        
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        print("🔄 Compensation job started")
    
    def _compensate_stuck_orders(self):
        """
        补偿卡住的订单
        超过 30 分钟还在 PAYING 状态的订单，标记为失败
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        threshold = (
            datetime.now() - timedelta(minutes=30)
        ).isoformat()
        
        cursor.execute("""
            SELECT id FROM orders
            WHERE status = 'paying'
            AND created_at < ?
        """, (threshold,))
        
        stuck_orders = cursor.fetchall()
        
        for (order_id,) in stuck_orders:
            print(f"🔄 Compensating stuck order: {order_id}")
            # 1. 查询支付状态（调用支付服务）
            # 2. 如果未支付，取消订单
            # 3. 如果已支付，更新订单状态为 PAID
        
        conn.close()
    
    def _retry_failed_messages(self):
        """重试发送失败的消息"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE outbox
            SET status = 'pending'
            WHERE status = 'failed'
            AND retry_count < max_retry
        """)
        
        count = cursor.rowcount
        conn.commit()
        conn.close()
        
        if count > 0:
            print(f"🔄 Reset {count} failed messages for retry")
```

---

### 3. 对账机制

```python
class ReconciliationJob:
    """
    对账任务
    定期对比各服务的数据，发现不一致并修正
    """
    
    def run_daily_reconciliation(self):
        """每天凌晨执行对账"""
        print("🔍 Starting daily reconciliation...")
        
        # 1. 对比订单服务和库存服务
        self._reconcile_orders_and_inventory()
        
        # 2. 对比订单服务和账户服务
        self._reconcile_orders_and_accounts()
        
        # 3. 对比支付记录和订单记录
        self._reconcile_payments_and_orders()
    
    def _reconcile_orders_and_inventory(self):
        """
        对账：订单 vs 库存
        找出已完成订单但库存未扣减的情况
        """
        # 查询已完成的订单
        completed_orders = self._get_completed_orders()
        
        # 查询对应的库存扣减记录
        for order in completed_orders:
            deduction = self._get_inventory_deduction(order["order_id"])
            
            if not deduction:
                # 发现不一致！
                print(f"⚠️ Discrepancy: Order {order['order_id']} completed but inventory not deducted")
                # 发送告警
                self._send_alert(order)
                # 触发补偿
                self._compensate_inventory(order)
    
    def _get_completed_orders(self):
        return []  # 实际查数据库
    
    def _get_inventory_deduction(self, order_id):
        return None  # 实际查数据库
    
    def _send_alert(self, order):
        print(f"📧 Alert sent for order: {order}")
    
    def _compensate_inventory(self, order):
        print(f"🔄 Compensating inventory for order: {order}")
```

---

## 八、面试高频题

### 1. CAP 定理是什么？微服务怎么选？

**参考答案：**

CAP：一致性（C）、可用性（A）、分区容错性（P）三者只能满足其二。

**微服务的选择：**
- P 是必须的（网络分区不可避免）
- 所以是 CP vs AP 的选择
- **大多数互联网业务选 AP**：用户宁愿看旧数据，也不愿服务不可用
- **通过 BASE 理论落地**：最终一致性

---

### 2. 分布式事务有哪些方案？各自适合什么场景？

**参考答案：**

| 方案 | 适用场景 |
|------|---------|
| 2PC | 强一致，但性能差，适合传统数据库 |
| TCC | 金融核心，强一致，实现复杂 |
| Saga | 长事务，微服务，最终一致 |
| 本地消息表 | 跨服务异步，最常用 |
| 事务消息 | 基于 RocketMQ，简单易用 |

**推荐：大多数场景用本地消息表或 Saga。**

---

### 3. 本地消息表方案的流程？

**参考答案：**

```
1. 业务操作 + 写 outbox 表，同一个本地事务
2. 定时任务扫描 outbox，发消息到 MQ
3. 消费者消费消息，处理业务
4. 失败时重试，成功后标记 sent
5. 消费者必须保证幂等
```

**优点：**
- 实现简单
- 不依赖特定 MQ
- 可靠性高（基于数据库持久化）

---

### 4. Saga 和 TCC 的区别？

**参考答案：**

| 维度 | TCC | Saga |
|------|-----|------|
| 一致性 | 强一致 | 最终一致 |
| 锁资源 | 预留（冻结） | 不预留 |
| 性能 | 中 | 好 |
| 实现复杂度 | 高 | 中 |
| 适用 | 金融核心 | 长事务 |

---

### 5. 怎么设计幂等性？

**参考答案：**

三种方案：
1. **唯一请求 ID + Redis**：客户端生成 UUID，服务端 Redis 去重
2. **数据库唯一索引**：关键字段建唯一索引
3. **状态机**：判断状态是否允许转换

**选型：**
- 对外接口：唯一请求 ID
- 内部服务：数据库唯一索引
- 状态变更：状态机

---

## 九、这一讲你必须记住的核心结论

1. **CAP 三选二**：微服务大多选 AP，通过最终一致性弥补
2. **BASE 理论**：基本可用、软状态、最终一致，是 AP 的工程化
3. **本地事务管不了跨库**：微服务必须用分布式事务方案
4. **本地消息表**：最常用，业务操作 + 写消息表用本地事务保证原子性
5. **Saga**：长事务首选，每步有补偿操作
6. **TCC**：金融场景，强一致，但复杂
7. **幂等性是基石**：有重试就必须有幂等
8. **补偿机制**：定时任务扫描中间状态，触发补偿
9. **对账机制**：定期对比多个服务数据，发现并修正不一致
10. **不要滥用分布式事务**：能用最终一致性就不用强一致

---

## 十、这一讲的练习题

### 练习 1：完善本地消息表

**要求：**
在本地消息表方案基础上，增加：
- 消息发送失败超过 3 次，标记为 DEAD（死信）
- 死信消息发送告警（打印日志即可）
- 提供查询死信消息的接口

---

### 练习 2：实现协同式 Saga

**要求：**
用事件驱动实现协同式 Saga：
- 订单服务发出 `OrderCreated` 事件
- 库存服务监听事件，扣减库存，发出 `InventoryDeducted` 事件
- 账户服务监听事件，扣减余额，发出 `BalanceDeducted` 事件
- 任何步骤失败，发出对应的失败事件，触发补偿

---

### 练习 3：设计对账方案

**场景：**
每天凌晨 2 点，对账订单服务和库存服务：
- 找出"订单已完成，但库存未扣减"的数据
- 找出"库存已扣减，但没有对应订单"的数据
- 输出对账报告

**思考：** 对账时怎么处理数据量大的问题？

---

## 十一、下一讲预告

下一讲我们进入微服务的"眼睛"：

**第 7 讲：可观测性（Python 版）— 链路追踪、日志、监控实战**

会讲：
- 可观测性三大支柱：Metrics、Logging、Tracing
- OpenTelemetry 标准和 Python 接入
- Jaeger 全链路追踪实战
- TraceID 跨服务透传
- ELK 日志体系搭建
- Prometheus + Grafana 监控
- 告警设计：怎么避免告警疲劳
- 大厂常见可观测性坑点

---

**如果你准备好了，我下一条直接开始第 7 讲。**

**或者先把练习 1~3 做出来，我帮你点评。**

你选哪个？
