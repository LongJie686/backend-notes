# 第 7 讲：可扩展架构模式——分层、SOA、微服务、微内核

---

前六讲我们解决了**高性能**和**高可用**的问题。

这一讲解决**可扩展**的问题。

> **可扩展性决定了一个系统能走多远。**
>
> 业务增长、团队扩大、需求变更时，系统是越改越乱，还是越改越清晰？

可扩展的本质只有一个字：**拆**。

但怎么拆？按什么维度拆？拆到什么程度？

这一讲会给你一套完整的答案，并结合 **Python 生态**给出可落地的实践。

---

## 一、可扩展的本质：拆分

### 1. 为什么系统会"长胖"？

```
初期：
用户模块 + 商品模块 + 订单模块 = 1 个工程，3 个人开发

1年后：
代码 50 万行，15 个人开发
改一个功能要动 8 个文件
发布一次要测试 3 天
新人入职 2 个月才能看懂代码
```

**根本原因：复杂度没有边界。**

所有逻辑耦合在一起，改 A 影响 B，加 C 要动 D。

### 2. 拆分是唯一的解法

> **可扩展 = 通过合理的拆分，让系统的复杂度被隔离、被控制、被独立演进。**

拆分的三个经典维度：

| 拆分维度 | 对应架构 | 核心思想 |
|---------|---------|---------|
| **按职责/流程拆** | 分层架构 | 表现层、业务层、数据层分离 |
| **按服务/部署拆** | SOA / 微服务 | 独立进程、独立部署、独立数据库 |
| **按功能/扩展拆** | 微内核架构 | 核心稳定，功能插件化 |

---

## 二、分层架构：最基础的可扩展模式

### 1. 什么是分层架构？

把系统按**职责**划分成不同的层次，每一层只和相邻层交互。

```
┌─────────────────────────────────────┐
│         表现层 / API 层              │  ← 接收请求、参数校验、返回响应
├─────────────────────────────────────┤
│         业务逻辑层 / Service 层      │  ← 核心业务规则、流程编排
├─────────────────────────────────────┤
│         领域模型层 / Domain 层       │  ← 实体、值对象、领域服务
├─────────────────────────────────────┤
│         数据访问层 / Repository 层   │  ← 数据库 CRUD、缓存操作
├─────────────────────────────────────┤
│         基础设施层 / Infrastructure  │  ← 外部 API、消息队列、配置
└─────────────────────────────────────┘
```

**依赖方向：上层依赖下层，下层不依赖上层。**

---

### 2. 为什么分层能提升可扩展性？

| 问题 | 不分层 | 分层后 |
|------|--------|--------|
| 换数据库 | 改业务代码里的 SQL | 只改 Repository 层 |
| 加新接口 | 复制粘贴业务逻辑 | 只加 API 层路由 |
| 团队分工 | 所有人改同一个文件 | 前端/后端/DBA 各司其职 |
| 单元测试 | 要 mock 整个系统 | 只测 Service 层即可 |

---

### 3. 分层架构的常见陷阱

#### 陷阱 1：贫血模型（Anemic Domain Model）

```python
# 错误：实体只有 getter/setter，没有业务逻辑
class User:
    def __init__(self, id, balance):
        self.id = id
        self.balance = balance

# 业务逻辑全在 Service 里
class UserService:
    def deduct_balance(self, user_id, amount):
        user = repo.get(user_id)
        if user.balance < amount:
            raise ValueError("余额不足")
        user.balance -= amount
        repo.save(user)
```

**问题：** 实体退化成数据结构，业务规则散落各处，难以维护。

**正确做法（充血模型）：**

```python
# 正确：实体包含业务规则
class User:
    def __init__(self, id, balance):
        self.id = id
        self.balance = balance

    def deduct(self, amount: float):
        if self.balance < amount:
            raise InsufficientBalanceError(f"余额不足: {self.balance}")
        self.balance -= amount
        return self
```

---

#### 陷阱 2：层间循环依赖

```
API 层 ──▶ Service 层
   ▲            │
   └────────────┘  （Service 调用了 API 层的 DTO 或异常）
```

**解决：依赖倒置原则（DIP）**

```
高层模块（Service）不依赖低层模块（API/DB）
两者都依赖抽象（接口/协议）
```

---

#### 陷阱 3：过度分层

```
Controller → Service → Manager → Facade → DAO → Repository → Mapper
```

**问题：** 调用链太长，调试困难，性能损耗。

**原则：** 层数不是越多越好，通常 3~4 层足够。

---

## 三、SOA vs 微服务：本质区别

很多人把 SOA 和微服务混为一谈，其实它们有本质区别。

### 1. 核心对比表

| 维度 | SOA（面向服务架构） | 微服务架构 |
|------|-------------------|-----------|
| **通信协议** | SOAP/XML、WS-* 标准 | REST/JSON、gRPC/Protobuf |
| **服务治理** | 中心化 ESB（企业服务总线） | 去中心化，智能端点+哑管道 |
| **数据管理** | 常共享数据库 | 每个服务独立数据库 |
| **部署粒度** | 较大（粗粒度服务） | 较小（细粒度服务） |
| **团队模式** | 中心化架构团队管控 | 跨职能小团队自治 |
| **适用场景** | 大型企业系统集成 | 云原生、敏捷迭代、互联网 |

---

### 2. 一句话理解本质区别

> **SOA 是"中心化治理"，微服务是"去中心化自治"。**

```
SOA：
所有服务通过 ESB 通信，ESB 负责路由、转换、监控、安全
ESB 成为单点，且越来越重

微服务：
服务直接通信，治理逻辑下沉到服务自身或 Sidecar
轻量、灵活、适合快速迭代
```

---

### 3. 演进路线

```
单体应用
  ↓（团队扩大，部署困难）
SOA（ESB 整合遗留系统）
  ↓（云原生兴起，敏捷需求）
微服务（独立部署、独立数据）
  ↓（服务太多，治理复杂）
服务网格（Service Mesh，Istio/Linkerd）
```

**实际建议：**
- 中小团队/互联网项目：直接微服务
- 传统企业/遗留系统整合：SOA 过渡
- 微服务超过 50 个：考虑 Service Mesh

---

## 四、微内核架构（插件化）：何时用？怎么用？

### 1. 什么是微内核架构？

> **核心系统保持稳定，业务功能以插件形式动态加载。**

```
┌─────────────────────────────────────────┐
│              微内核（Core）              │
│  生命周期管理 │ 插件注册 │ 事件总线      │
└────────────────────┬────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │ 插件 A  │  │ 插件 B  │  │ 插件 C  │
   │(支付)   │  │(物流)   │  │(营销)   │
   └─────────┘  └─────────┘  └─────────┘
```

**类比：**
- VS Code：核心是编辑器，语言支持、调试、主题都是插件
- Chrome：浏览器核心 + 扩展程序
- WordPress：CMS 核心 + 插件生态

---

### 2. 适用场景

| 场景 | 说明 |
|------|------|
| **高度可定制产品** | SaaS 多租户，不同客户需要不同功能 |
| **规则引擎** | 风控、定价、审批流，规则频繁变化 |
| **开放平台** | 第三方开发者接入，不能改核心代码 |
| **核心稳定，边缘多变** | 支付核心不变，但支付方式（微信/支付宝/银联）经常加 |

---

### 3. Python 实现插件系统

```python
"""
Python 微内核插件系统实现
使用 importlib + entry_points 实现动态加载
"""
import importlib
import pkgutil
from abc import ABC, abstractmethod
from typing import Dict, Type
import logging


class Plugin(ABC):
    """插件基类"""

    @property
    @abstractmethod
    def name(self) -> str:
        """插件名称"""
        pass

    @abstractmethod
    def execute(self, context: dict) -> dict:
        """执行插件逻辑"""
        pass


class PluginManager:
    """插件管理器（微内核核心）"""

    def __init__(self):
        self._plugins: Dict[str, Plugin] = {}
        self._hooks: Dict[str, list] = {}  # 事件钩子

    def register(self, plugin: Plugin):
        """注册插件"""
        if plugin.name in self._plugins:
            raise ValueError(f"插件已存在: {plugin.name}")
        self._plugins[plugin.name] = plugin
        logging.info(f"[OK] 插件注册成功: {plugin.name}")

    def unregister(self, name: str):
        """注销插件"""
        if name in self._plugins:
            del self._plugins[name]
            logging.info(f"[--] 插件已注销: {name}")

    def get_plugin(self, name: str) -> Plugin:
        """获取插件"""
        if name not in self._plugins:
            raise KeyError(f"插件不存在: {name}")
        return self._plugins[name]

    def execute_plugin(self, name: str, context: dict) -> dict:
        """执行插件"""
        plugin = self.get_plugin(name)
        return plugin.execute(context)

    def discover_plugins(self, package_name: str):
        """自动发现并加载插件（基于包扫描）"""
        package = importlib.import_module(package_name)
        for importer, modname, ispkg in pkgutil.iter_modules(package.__path__):
            try:
                module = importlib.import_module(f"{package_name}.{modname}")
                # 查找继承自 Plugin 的类
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (isinstance(attr, type) and
                        issubclass(attr, Plugin) and
                        attr != Plugin):
                        self.register(attr())
            except Exception as e:
                logging.error(f"加载插件失败 {modname}: {e}")


# ========== 插件实现示例 ==========

class WechatPaymentPlugin(Plugin):
    @property
    def name(self) -> str:
        return "wechat_pay"

    def execute(self, context: dict) -> dict:
        order_id = context["order_id"]
        amount = context["amount"]
        print(f"[微信支付] 处理订单 {order_id}, 金额 {amount}")
        return {"status": "success", "channel": "wechat"}


class AlipayPaymentPlugin(Plugin):
    @property
    def name(self) -> str:
        return "alipay"

    def execute(self, context: dict) -> dict:
        order_id = context["order_id"]
        amount = context["amount"]
        print(f"[支付宝] 处理订单 {order_id}, 金额 {amount}")
        return {"status": "success", "channel": "alipay"}


# ========== 使用演示 ==========
manager = PluginManager()

# 手动注册
manager.register(WechatPaymentPlugin())
manager.register(AlipayPaymentPlugin())

# 执行插件
result = manager.execute_plugin("wechat_pay", {
    "order_id": "ORD-1001",
    "amount": 99.00
})
print(f"结果: {result}")

# 动态扩展：新增银联支付只需加一个类，无需改核心代码
```

---

## 五、Python 项目分层设计实战

### 1. 标准 FastAPI 项目结构

```
my_project/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口
│   ├── config.py            # 配置管理
│   ├── dependencies.py      # 全局依赖注入
│   │
│   ├── api/                 # 表现层（路由）
│   │   ├── __init__.py
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── users.py
│   │   │   └── orders.py
│   │   └── router.py        # 路由聚合
│   │
│   ├── services/            # 业务逻辑层
│   │   ├── __init__.py
│   │   ├── user_service.py
│   │   └── order_service.py
│   │
│   ├── domain/              # 领域模型层
│   │   ├── __init__.py
│   │   ├── user.py
│   │   └── order.py
│   │
│   ├── repositories/        # 数据访问层
│   │   ├── __init__.py
│   │   ├── base.py          # 通用 Repository
│   │   ├── user_repo.py
│   │   └── order_repo.py
│   │
│   ├── infrastructure/      # 基础设施层
│   │   ├── __init__.py
│   │   ├── database.py      # DB 连接
│   │   ├── cache.py         # Redis
│   │   └── external_api.py  # 第三方服务
│   │
│   └── core/                # 核心工具
│       ├── __init__.py
│       ├── exceptions.py    # 自定义异常
│       ├── security.py      # JWT/权限
│       └── logging.py       # 日志配置
│
├── tests/                   # 测试
├── alembic/                 # 数据库迁移
├── pyproject.toml
└── README.md
```

---

### 2. 层间交互示例（依赖注入）

```python
# app/repositories/user_repo.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.domain.user import User

class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: int) -> User | None:
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def save(self, user: User):
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)


# app/services/user_service.py
from app.repositories.user_repo import UserRepository
from app.domain.user import User
from app.core.exceptions import UserNotFoundError

class UserService:
    def __init__(self, user_repo: UserRepository):
        self.user_repo = user_repo

    async def get_user_profile(self, user_id: int) -> dict:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise UserNotFoundError(user_id)

        # 业务逻辑：组装返回数据
        return {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "status": "active"
        }


# app/api/v1/users.py
from fastapi import APIRouter, Depends
from app.services.user_service import UserService
from app.dependencies import get_user_service

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/{user_id}")
async def get_user(
    user_id: int,
    service: UserService = Depends(get_user_service)
):
    return await service.get_user_profile(user_id)


# app/dependencies.py
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.database import get_db
from app.repositories.user_repo import UserRepository
from app.services.user_service import UserService

async def get_user_service(db: AsyncSession = Depends(get_db)):
    repo = UserRepository(db)
    return UserService(repo)
```

**为什么这样设计？**
1. **依赖注入**：Service 不直接创建 Repository，通过构造函数注入，方便测试和替换
2. **清晰边界**：API 层只负责路由和校验，Service 负责业务，Repository 负责数据
3. **可测试**：单元测试 Service 时，mock Repository 即可
4. **可扩展**：加缓存、换数据库、加日志，只需改对应层

---

## 六、从单体到微服务的平滑迁移路径

### 1. 绝对不要"推倒重来"

```
错误做法：
停掉单体 → 重写微服务 → 切换流量 → 祈祷不出错
结果：90% 失败，业务中断，团队崩溃
```

### 2. 绞杀者模式（Strangler Fig Pattern）

> **像绞杀榕一样，慢慢包裹、替代原有系统，直到完全取代。**

```
步骤：
1. 在单体前加 API 网关
2. 识别要迁移的模块（高变更、高独立）
3. 新建微服务，实现相同功能
4. 网关路由：新请求 → 微服务，旧请求 → 单体
5. 数据双写 / 同步
6. 验证稳定后，关闭单体对应模块
7. 重复，直到单体被完全替代
```

---

### 3. 数据迁移策略（最难的部分）

```python
"""
数据库拆分迁移方案
"""

# 阶段 1：共享数据库（过渡期）
# 单体和微服务都连同一个 DB，但微服务只操作自己的表
# 风险：耦合仍在，但可快速验证

# 阶段 2：双写 + 读新
# 单体写旧表 + 新表
# 微服务读新表
# 使用 CDC（Canal/Debezium）或 binlog 同步

# 阶段 3：切读 + 停旧写
# 流量全切到微服务
# 旧表只读不写，保留 30 天
# 确认无误后，下线旧表
```

---

### 4. Python 迁移实战技巧

```python
# 使用特性开关（Feature Flags）控制新旧逻辑
from typing import Optional
import os

class FeatureFlags:
    @staticmethod
    def is_enabled(flag: str) -> bool:
        return os.getenv(f"FF_{flag.upper()}", "false").lower() == "true"

async def get_user(user_id: int):
    if FeatureFlags.is_enabled("user_service_v2"):
        # 新微服务逻辑
        return await user_service_v2.get(user_id)
    else:
        # 旧单体逻辑
        return await legacy_user_logic.get(user_id)

# 部署时通过环境变量控制：
# FF_USER_SERVICE_V2=true
```

---

## 七、面试高频题

### 1. 分层架构的优缺点是什么？

**答题框架：**

**优点：**
- 职责清晰，团队可并行开发
- 层间解耦，替换某一层不影响其他层
- 易于测试（可单独测 Service 层）
- 符合关注点分离原则

**缺点：**
- 过度分层导致调用链长、性能损耗
- 层间依赖管理不当会产生循环依赖
- 容易变成"贫血模型"，业务逻辑散落

**如何避免：**
- 控制层数（3~4层）
- 依赖倒置（DIP）
- 领域驱动设计（充血模型）

---

### 2. SOA 和微服务的核心区别？

**答题框架：**

| 维度 | SOA | 微服务 |
|------|-----|--------|
| 治理方式 | 中心化 ESB | 去中心化，智能端点 |
| 通信协议 | SOAP/XML（重） | REST/gRPC（轻） |
| 数据管理 | 常共享数据库 | 独立数据库 |
| 部署粒度 | 粗粒度 | 细粒度 |
| 团队模式 | 架构团队管控 | 小团队自治 |

**一句话总结：**
> SOA 是"企业级集成方案"，微服务是"云原生敏捷架构"。核心区别在治理中心化和数据独立性。

---

### 3. 什么是微内核架构？适用场景？

**答题框架：**

**定义：**
> 核心系统保持稳定，功能以插件形式动态加载。核心负责生命周期、插件管理、事件总线。

**适用场景：**
- 高度可定制的 SaaS 产品
- 规则引擎（风控、定价）
- 开放平台/第三方接入
- 核心稳定但边缘功能频繁变化的系统

**优点：** 扩展性极强，核心稳定，支持热插拔
**缺点：** 插件兼容性管理复杂，调试困难，性能有开销

---

### 4. 如何从单体平滑迁移到微服务？

**答题框架：**

**核心原则：绞杀者模式（Strangler Fig）**

**步骤：**
1. 加 API 网关，统一入口
2. 识别高内聚、低耦合模块优先拆分
3. 新建微服务，实现相同功能
4. 网关按路由分流（新旧并存）
5. 数据双写/CDC 同步，逐步切读
6. 验证稳定后，下线单体模块
7. 重复直到完全替代

**关键技巧：**
- 不要推倒重来
- 用特性开关控制新旧逻辑
- 数据迁移最难，先拆服务再拆库
- 充分监控，随时可回滚

---

### 5. 依赖倒置原则（DIP）在架构中怎么体现？

**答题框架：**

**定义：**
> 高层模块不应依赖低层模块，两者都应依赖抽象。

**架构体现：**
- Service 层不直接依赖具体数据库驱动，依赖 `Repository` 接口
- 业务逻辑不依赖具体 HTTP 框架，依赖抽象的 `Request/Response`
- 通过依赖注入（DI）在运行时绑定具体实现

**好处：**
- 替换底层实现（MySQL→PostgreSQL）无需改业务代码
- 单元测试可轻松 mock 依赖
- 架构更稳定，细节可变化

---

## 八、本讲核心要点总结

### 必须记住的 10 条

1. **可扩展的本质是拆分，拆分是为了控制复杂度**
2. **分层架构是最基础的可扩展手段，3~4 层足够**
3. **避免贫血模型，业务逻辑应放在领域层**
4. **依赖倒置（DIP）是保持层间解耦的核心原则**
5. **SOA 是中心化治理（ESB），微服务是去中心化自治**
6. **微服务的核心特征：独立部署、独立数据库、小团队负责**
7. **微内核 = 核心稳定 + 插件扩展，适合高度定制场景**
8. **从单体到微服务：用绞杀者模式，绝对不要推倒重来**
9. **数据拆分最难，先服务拆分，再数据库拆分，用 CDC 过渡**
10. **特性开关（Feature Flags）是平滑迁移的利器**

---

## 九、课后练习

### 练习 1：分层设计
为你熟悉的一个 Python 项目设计分层结构：
1. 画出层间依赖图
2. 明确每一层的职责
3. 找出当前项目违反分层原则的地方

### 练习 2：插件系统
实现一个支持热加载的插件管理器：
1. 定义插件接口
2. 支持从指定目录自动发现 `.py` 文件并加载
3. 支持插件启用/禁用
4. 测试插件执行

### 练习 3：绞杀者模式演练
假设你有一个 50 万行的 Django 单体项目：
1. 识别出最适合第一个拆分的模块
2. 设计 API 网关路由策略
3. 设计数据双写方案
4. 写出迁移 Checklist

### 练习 4：架构评审
评审以下设计是否合理：
```
Controller → Service → Manager → DAO → Model
```
指出问题并给出改进方案。

---

## 十、下一讲预告

**第 8 讲：架构实战与文档编写——从理论到落地**

会讲：
- 架构设计文档怎么写（标准模板+实例）
- 真实案例拆解：微博 Feed 流架构演进
- 真实案例拆解：支付系统高可用设计
- 如何用四步法驱动架构设计
- 架构评审怎么做？如何推动落地？
- 面试终极题：请画出你做过最复杂的系统架构

这是整个课程的**收官之战**，把前面所有知识串联起来，形成真正的架构师能力。