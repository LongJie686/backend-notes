# 第 6 讲：秒杀系统全链路设计

这一讲是整个高并发系列的**集大成之作**。

秒杀系统是高并发面试中**最高频的场景题**，也是检验你是否真正掌握高并发设计的试金石。

很多人被问到"如何设计秒杀系统"时，只会说：
- "用Redis存库存"
- "用消息队列异步下单"

但面试官真正想听的是：
- 为什么要这样设计？
- 每一层怎么防护？
- 超卖怎么彻底解决？
- 数据一致性怎么保证？
- 极端场景下怎么兜底？

这一讲会带你从**零开始完整设计**一个可以支撑百万QPS的秒杀系统。

---

## 一、秒杀系统的核心难点

### 先理解秒杀的本质

**秒杀的特征：**
```
时间极短：可能只有1秒
库存极少：可能只有100个
用户极多：可能有100万用户同时抢

本质：
100万个并发请求，争抢100个库存
成功率 = 100 / 1000000 = 0.01%
99.99%的请求注定失败
```

**这带来了几个核心问题：**

---

### 难点1：瞬时高并发

```
平时QPS：1000
秒杀开始瞬间QPS：1000000

1000倍的流量突增
-> 数据库直接挂
-> 应用服务器直接挂
-> 全站崩溃
```

---

### 难点2：超卖问题

```
库存：100
并发请求：10000

如果没有并发控制：
-> 多个请求同时读到库存=1
-> 多个请求同时扣减
-> 库存扣成负数
-> 超卖了
```

---

### 难点3：数据一致性

```
Redis库存扣了，但数据库订单没创建
-> 用户扣了但没订单

数据库订单创建了，但库存没有正确扣减
-> 超卖
```

---

### 难点4：用户体验

```
99.99%的用户抢不到
-> 但不能给他们很差的体验
-> 不能让他们等很久
-> 要快速告诉他们结果
```

---

### 难点5：恶意请求

```
黄牛用脚本刷
-> 一个用户发几千个请求
-> 占用系统资源
-> 正常用户被挤出去
```

---

## 二、秒杀系统整体架构

### 架构总览

```
[用户]
  |
[CDN] --- 静态页面缓存
  |
[Nginx] --- 接入层限流、IP防刷
  |
[API网关] --- 鉴权、用户级限流、风控
  |
[秒杀服务] --- 核心逻辑
  |         |
[Redis]  [Kafka]
预扣库存   异步下单
  |         |
         [订单服务]
           |
         [MySQL] --- 最终落库
```

**核心思想：**
```
1. 用CDN + 静态化把大部分流量挡在最外层
2. 用多级限流把流量层层削减
3. 用Redis在内存中预扣库存（不打DB）
4. 用消息队列异步创建订单（削峰）
5. DB只做最终一致性保障
```

---

## 三、前端层：把流量挡在最外层

### 1. 页面静态化 + CDN

**商品详情页静态化：**
```
动态页面：
  用户请求 -> 服务器 -> 查DB -> 渲染 -> 返回HTML

静态化：
  用户请求 -> CDN节点（就近） -> 直接返回HTML文件
```

**实现：**
```
1. 商品信息提前生成静态HTML
2. 推送到CDN各节点
3. 用户访问直接命中CDN
4. 不打到源站
```

**效果：**
```
100万请求 -> CDN拦截95万 -> 只有5万打到源站
```

---

### 2. 按钮防重 + 前端限流

> 以下为前端 JavaScript 参考代码（仅标注逻辑，非本项目的 Python 实现）：

```javascript
// 点击按钮后禁用，防止重复点击
let isSubmitting = false;

function seckill(activityId) {
    if (isSubmitting) return;  // 防重复提交

    isSubmitting = true;
    document.getElementById('seckillBtn').disabled = true;
    document.getElementById('seckillBtn').innerText = '抢购中...';

    fetch('/api/seckill', {
        method: 'POST',
        body: JSON.stringify({ activityId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showResult('恭喜！抢购成功，订单号：' + data.orderNo);
        } else {
            showResult(data.message);
            isSubmitting = false;
            document.getElementById('seckillBtn').disabled = false;
        }
    });
}
```

---

### 3. 验证码（防刷）

```
秒杀开始前要求用户输入验证码
-> 人工验证通过才能发起请求
-> 刷子脚本无法自动识别验证码
-> 把请求分散到几秒内（削峰）
```

```python
def validate_captcha(user_id: str, captcha: str) -> bool:
    """验证码校验"""
    key = f"captcha:{user_id}"
    correct = redis.get(key)

    if correct is None:
        return False  # 验证码过期
    if captcha.lower() != correct.decode().lower():
        return False  # 验证码错误

    redis.delete(key)  # 用过即删
    return True
```

---

### 4. 秒杀令牌（分散流量）

**思路：**
```
不直接开放秒杀接口
-> 先发放令牌（有限数量）
-> 只有拿到令牌的用户才能参与秒杀
-> 令牌数量 = 库存 x 3（多一点冗余）
-> 提前过滤掉大部分请求
```

```python
import uuid

# 发放令牌（秒杀开始前5秒）
def distribute_tokens(activity_id: int):
    activity = activity_dao.get_by_id(activity_id)
    token_count = activity["stock"] * 3  # 库存的3倍令牌

    for i in range(token_count):
        token = f"{activity_id}_{uuid.uuid4().hex[:8]}_{i}"
        redis.sadd(f"seckill:tokens:{activity_id}", token)

    redis.expire(f"seckill:tokens:{activity_id}", 3600)


# 用户获取令牌
def get_token(activity_id: int, user_id: int) -> str | None:
    token = redis.spop(f"seckill:tokens:{activity_id}")
    if token is None:
        return None  # 没有令牌了

    # 绑定到用户
    redis.setex(f"seckill:user:token:{user_id}:{activity_id}", 300, token)
    return token


# 秒杀时校验令牌
def validate_token(user_id: int, activity_id: int, token: str) -> bool:
    key = f"seckill:user:token:{user_id}:{activity_id}"
    valid_token = redis.get(key)
    return valid_token and valid_token.decode() == token
```

---

## 四、接入层：Nginx多维度限流

### Nginx配置

```nginx
http {
    # 按IP限流（防止单IP刷）
    limit_req_zone $binary_remote_addr
        zone=ip_seckill:10m
        rate=5r/s;          # 单IP每秒5个请求

    # 按接口限流（全局流量控制）
    limit_req_zone $server_name
        zone=global_seckill:10m
        rate=2000r/s;       # 全局每秒2000个

    # 按用户ID限流
    limit_req_zone $http_user_id
        zone=user_seckill:50m
        rate=1r/s;          # 单用户每秒1个

    server {
        location /api/seckill {
            # IP限流，突发允许5个，无延迟直接拒绝
            limit_req zone=ip_seckill burst=5 nodelay;

            # 全局限流
            limit_req zone=global_seckill burst=500 nodelay;

            # 用户限流
            limit_req zone=user_seckill burst=2 nodelay;

            # 限流后返回429
            limit_req_status 429;

            proxy_pass http://seckill_backend;

            # 超时控制
            proxy_connect_timeout 1s;
            proxy_read_timeout 3s;
        }
    }
}
```

---

## 五、网关层：鉴权 + 风控

### 鉴权（FastAPI 中间件）

```python
from fastapi import FastAPI, Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

class AuthMiddleware(BaseHTTPMiddleware):
    """网关鉴权中间件"""

    async def dispatch(self, request: Request, call_next):
        # 1. 获取Token
        token = request.headers.get("Authorization")
        if not token:
            return JSONResponse({"code": 401, "message": "未登录"}, status_code=401)

        # 2. 验证Token（Redis中查）
        user_id = redis.get(f"token:{token}")
        if user_id is None:
            return JSONResponse({"code": 401, "message": "Token失效"}, status_code=401)

        # 3. 透传用户ID到下游（注入请求scope）
        request.state.user_id = user_id.decode()
        return await call_next(request)
```

---

### 风控（防刷）

```python
class RiskControlMiddleware(BaseHTTPMiddleware):
    """风控中间件"""

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/seckill"):
            return await call_next(request)

        user_id = request.state.user_id
        ip = request.client.host

        # 1. 黑名单检查
        if redis.sismember("risk:blacklist", user_id) or redis.sismember("risk:blacklist:ip", ip):
            return JSONResponse({"code": 403, "message": "账号异常"}, status_code=403)

        # 2. 用户行为检查（短时间内请求太多）
        count = redis.incr(f"risk:behavior:{user_id}")
        redis.expire(f"risk:behavior:{user_id}", 60)  # 1分钟窗口

        if count > 20:  # 1分钟内超过20次请求
            redis.sadd("risk:flagged", user_id)
            return JSONResponse({"code": 429, "message": "操作过于频繁"}, status_code=429)

        # 3. 设备指纹检查
        device_id = request.headers.get("X-Device-Id")
        if device_id and redis.get(f"risk:device:{device_id}") and \
           redis.get(f"risk:device:{device_id}").decode() != user_id:
            return JSONResponse({"code": 403, "message": "设备异常"}, status_code=403)

        return await call_next(request)
```

---

## 六、秒杀服务：核心逻辑

### 整体流程（FastAPI）

```python
from fastapi import FastAPI, Request, HTTPException, Depends

app = FastAPI()


@app.post("/api/seckill")
@rate_limit  # 限流装饰器
async def seckill(request: SeckillRequest, user_id: int = Depends(get_user_id)):
    """秒杀核心接口"""

    # 1. 参数校验
    validate_request(request, user_id)

    # 2. 用户资格校验
    check_user_eligibility(user_id, request.activity_id)

    # 3. 活动校验（时间、状态）
    check_activity(request.activity_id)

    # 4. Redis预扣库存（核心）
    deducted = pre_deduct_stock(user_id, request.activity_id)
    if not deducted:
        return {"code": 400, "message": "库存不足，手慢了"}

    # 5. 发送消息到Kafka（异步下单）
    send_order_message(user_id, request.activity_id)

    # 6. 返回排队中
    return {"code": 200, "message": "正在为您抢购，请稍候查看结果"}
```

---

### 步骤1：参数校验

```python
def validate_request(request: SeckillRequest, user_id: int) -> None:
    if not request:
        raise HTTPException(400, "参数不能为空")
    if not request.activity_id or request.activity_id <= 0:
        raise HTTPException(400, "活动ID非法")
    if not user_id or user_id <= 0:
        raise HTTPException(400, "用户ID非法")
```

---

### 步骤2：用户资格校验

```python
def check_user_eligibility(user_id: int, activity_id: int) -> None:
    # 1. 是否已经参与过这个活动（防止重复购买）
    if redis.exists(f"seckill:bought:{activity_id}:{user_id}"):
        raise HTTPException(400, "您已参与过此活动")

    # 2. 账号是否正常
    if redis.sismember("risk:blacklist", user_id):
        raise HTTPException(400, "账号异常，无法参与")
```

---

### 步骤3：活动校验

```python
import time

def check_activity(activity_id: int) -> None:
    # 活动信息缓存在Redis（避免每次查DB）
    activity_key = f"seckill:activity:{activity_id}"
    activity = redis.get(activity_key)

    if activity is None:
        activity = activity_dao.get_by_id(activity_id)
        if activity:
            redis.setex(activity_key, 300, json.dumps(activity))

    if activity is None:
        raise HTTPException(400, "活动不存在")

    activity = json.loads(activity) if isinstance(activity, bytes) else activity

    if activity["status"] != "RUNNING":
        raise HTTPException(400, "活动未开始或已结束")

    now_ms = int(time.time() * 1000)
    if now_ms < activity["start_time"]:
        raise HTTPException(400, "活动尚未开始")
    if now_ms > activity["end_time"]:
        raise HTTPException(400, "活动已结束")
```

---

### 步骤4：Redis预扣库存（核心中的核心）

**为什么用Lua脚本？**
```
普通操作：
  GET stock -> 判断 -> DECR stock

这三步不是原子的：
  线程A：GET stock = 1（库存还有1个）
  线程B：GET stock = 1（库存还有1个）
  线程A：DECR stock = 0
  线程B：DECR stock = -1  <- 超卖！

Lua脚本：在Redis中原子执行，不会被其他命令打断
```

```python
LUA_DEDUCT_STOCK = """
-- 1. 检查用户是否已购买
if redis.call('exists', KEYS[2]) == 1 then
    return -1  -- 已购买
end

-- 2. 获取当前库存
local stock = tonumber(redis.call('get', KEYS[1]))

-- 3. 判断库存
if stock == nil or stock <= 0 then
    return 0  -- 库存不足
end

-- 4. 扣减库存
redis.call('decrby', KEYS[1], 1)

-- 5. 标记用户已购买（30分钟有效）
redis.call('setex', KEYS[2], 1800, '1')

return 1  -- 扣减成功
"""


def pre_deduct_stock(user_id: int, activity_id: int) -> bool:
    stock_key = f"seckill:stock:{activity_id}"
    bought_key = f"seckill:bought:{activity_id}:{user_id}"

    result = redis.eval(LUA_DEDUCT_STOCK, 2, stock_key, bought_key)

    if result == -1:
        raise HTTPException(400, "您已参与过此活动，请勿重复抢购")
    if result == 0:
        return False

    return True
```

**Redis库存预热（活动开始前）：**

```python
from apscheduler.schedulers.background import BackgroundScheduler


def preload_seckill_stock() -> None:
    """每5分钟检查，提前预热即将开始的秒杀库存"""
    activities = activity_dao.get_upcoming_activities()
    now_ms = int(time.time() * 1000)

    for activity in activities:
        start_time = activity["start_time"]
        if start_time - now_ms <= 10 * 60 * 1000:  # 10分钟内开始
            stock_key = f"seckill:stock:{activity['id']}"

            if not redis.exists(stock_key):
                redis.set(stock_key, activity["stock"])
                redis.expire(stock_key, 7200)  # 2小时过期
                logger.info(f"预热秒杀库存: activityId={activity['id']}, stock={activity['stock']}")


scheduler = BackgroundScheduler()
scheduler.add_job(preload_seckill_stock, 'interval', minutes=5)
scheduler.start()
```

---

### 步骤5：发送消息到Kafka

```python
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers=['localhost:9092'],
    acks='all',
    retries=3,
    value_serializer=lambda v: json.dumps(v).encode()
)


def send_order_message(user_id: int, activity_id: int) -> None:
    message = {
        "user_id": user_id,
        "activity_id": activity_id,
        "timestamp": int(time.time() * 1000),
        "msg_id": generate_msg_id(),  # 消息唯一ID（用于幂等）
    }

    try:
        # 用user_id做Key，保证同一用户的消息有序
        future = producer.send(
            "seckill-order-topic",
            key=str(user_id).encode(),
            value=message
        )
        future.get(timeout=5)  # 同步等待确认

    except Exception as e:
        logger.error(f"消息发送失败: userId={user_id}", exc_info=True)
        # 回滚Redis库存
        rollback_stock(user_id, activity_id)
        raise HTTPException(500, "系统繁忙，请重试")


def rollback_stock(user_id: int, activity_id: int) -> None:
    """库存回滚（Lua原子操作）"""
    stock_key = f"seckill:stock:{activity_id}"
    bought_key = f"seckill:bought:{activity_id}:{user_id}"

    script = """
    redis.call('incr', KEYS[1])
    redis.call('del', KEYS[2])
    return 1
    """
    redis.eval(script, 2, stock_key, bought_key)
    logger.info(f"库存回滚成功: userId={user_id}, activityId={activity_id}")
```

---

## 七、订单服务：消费消息创建订单

### 消费者设计

```python
from kafka import KafkaConsumer


class SeckillOrderConsumer:
    """秒杀订单消费者"""

    def __init__(self):
        self.consumer = KafkaConsumer(
            'seckill-order-topic',
            bootstrap_servers=['localhost:9092'],
            group_id='seckill-order-group',
            enable_auto_commit=False,
            max_poll_records=10,
            value_deserializer=lambda v: json.loads(v)
        )

    def run(self) -> None:
        for message in self.consumer:
            try:
                self.process_order(message.value)
                self.consumer.commit()  # 手动提交
            except BusinessException as e:
                logger.warning(f"业务异常: {e}")
                self.consumer.commit()  # 业务异常不重试
            except Exception as e:
                logger.error("处理失败，等待重试", exc_info=True)
                # 不提交，Kafka会重试

    def process_order(self, message: dict) -> None:
        user_id = message["user_id"]
        activity_id = message["activity_id"]
        msg_id = message["msg_id"]

        # 1. 幂等检查
        if message_dedup_dao.exists(msg_id):
            logger.warning(f"消息已处理，跳过: msgId={msg_id}")
            return

        # 2. DB级别兜底检查
        if order_dao.exists_by_user_and_activity(user_id, activity_id):
            logger.warning(f"订单已存在: userId={user_id}, activityId={activity_id}")
            return

        # 3. 获取活动信息
        activity = activity_dao.get_by_id(activity_id)

        # 4. 扣减数据库库存（乐观锁）
        affected = activity_dao.deduct_stock(activity_id, activity["version"])
        if affected == 0:
            raise RetryException("库存扣减冲突，重试")

        # 5. 创建订单
        order = self._create_order(user_id, activity)
        order_dao.insert(order)

        # 6. 标记消息已处理
        message_dedup_dao.insert(msg_id)

        # 7. 通知用户
        notify_user(user_id, order)

        logger.info(f"订单创建成功: userId={user_id}, orderNo={order['order_no']}")

    def _create_order(self, user_id: int, activity: dict) -> dict:
        return {
            "id": snowflake_id_gen.next_id(),
            "order_no": str(snowflake_id_gen.next_id()),
            "user_id": user_id,
            "activity_id": activity["id"],
            "product_id": activity["product_id"],
            "product_name": activity["product_name"],
            "activity_price": activity["activity_price"],
            "status": "CREATED",
            "create_time": datetime.now(),
            "expire_time": datetime.now() + timedelta(minutes=30),
        }
```

---

### 幂等处理

```python
def is_already_processed(msg_id: str) -> bool:
    return message_dedup_dao.exists(msg_id)

def mark_as_processed(msg_id: str) -> None:
    try:
        message_dedup_dao.insert(msg_id)
    except IntegrityError:
        pass  # 已存在，忽略
```

---

### 数据库库存扣减（乐观锁防超卖）

```python
def deduct_stock_with_retry(activity_id: int, max_retry: int = 3) -> None:
    """乐观锁扣库存，支持重试"""
    for i in range(max_retry):
        activity = activity_dao.get_by_id(activity_id)

        if activity["stock"] <= 0:
            raise BusinessException("库存已售罄")

        affected = activity_dao.deduct_stock(activity_id, activity["version"])

        if affected > 0:
            return  # 扣减成功

        logger.warning(f"乐观锁冲突，第{i + 1}次重试")
        time.sleep(0.05 * (i + 1))  # 递增等待

    raise BusinessException("库存扣减失败，请重试")
```

对应的 SQL：
```sql
-- 乐观锁扣减
UPDATE seckill_activity
SET stock = stock - 1, version = version + 1
WHERE id = :id AND stock > 0 AND version = :version;
```

---

## 八、超时取消：订单未支付自动关闭

### 延迟消息实现（RocketMQ）

```python
def send_cancel_message(order: dict) -> None:
    """创建订单后，发送延迟取消消息"""
    msg = Message(
        topic="order-cancel-topic",
        body=json.dumps(order).encode()
    )
    msg.set_delay_time_level(16)  # Level16 = 30分钟
    rocketmq_producer.send(msg)


def on_cancel_message(message: dict) -> None:
    """取消消费者：30分钟后检查"""
    order = order_dao.get_by_order_no(message["order_no"])

    if order is None:
        return

    # 只取消未支付的订单
    if order["status"] != "CREATED":
        logger.info(f"订单已支付或已取消，跳过: orderNo={order['order_no']}")
        return

    # 取消订单
    affected = order_dao.cancel_order(
        order["order_no"],
        expected_status="CREATED",
        new_status="CANCELLED"
    )

    if affected > 0:
        restore_stock(order["activity_id"])
        logger.info(f"订单超时取消: orderNo={order['order_no']}")


def restore_stock(activity_id: int) -> None:
    """恢复库存"""
    # 1. 恢复DB库存
    activity_dao.increase_stock(activity_id)
    # 2. 恢复Redis库存
    redis.incr(f"seckill:stock:{activity_id}")
    logger.info(f"库存恢复: activityId={activity_id}")
```

---

## 九、结果查询：用户如何知道抢没抢到

### 轮询方案

> 前端 JavaScript 参考代码：

```javascript
async function pollResult(userId, activityId) {
    let attempts = 0;
    const maxAttempts = 10;

    const poll = setInterval(async () => {
        attempts++;
        const resp = await fetch(`/api/seckill/result?userId=${userId}&activityId=${activityId}`);
        const data = await resp.json();

        if (data.status === 'SUCCESS') {
            clearInterval(poll);
            showSuccess('抢购成功！订单号：' + data.orderNo);
        } else if (data.status === 'FAILED') {
            clearInterval(poll);
            showFail('很遗憾，未能抢到');
        } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            showFail('查询超时，请刷新页面查看结果');
        }
    }, 1000);
}
```

**后端接口和结果通知：**

```python
from fastapi import FastAPI

@app.get("/api/seckill/result")
async def get_seckill_result(user_id: int, activity_id: int):
    # 1. 查Redis（快）
    result = redis.get(f"seckill:result:{activity_id}:{user_id}")

    if result and result.decode() == "SUCCESS":
        order_no = redis.get(f"seckill:orderNo:{activity_id}:{user_id}")
        return {"code": 200, "data": {"status": "SUCCESS", "order_no": order_no.decode()}}
    elif result and result.decode() == "FAILED":
        return {"code": 200, "data": {"status": "FAILED", "order_no": None}}

    # 2. 查DB（兜底）
    order = order_dao.get_by_user_and_activity(user_id, activity_id)
    if order:
        return {"code": 200, "data": {"status": "SUCCESS", "order_no": order["order_no"]}}

    return {"code": 200, "data": {"status": "PROCESSING", "order_no": None}}


def notify_user(user_id: int, order: dict) -> None:
    """订单创建后通知结果"""
    activity_id = order["activity_id"]

    # 写入结果到Redis
    redis.setex(f"seckill:result:{activity_id}:{user_id}", 3600, "SUCCESS")
    redis.setex(f"seckill:orderNo:{activity_id}:{user_id}", 3600, order["order_no"])

    # 推送通知（WebSocket / 短信）
    notification_service.notify(user_id, f"恭喜！秒杀成功，订单号：{order['order_no']}")
```

---

### WebSocket实时推送（更好的体验）

```python
from fastapi import WebSocket
from collections import defaultdict


class SeckillResultPusher:
    """WebSocket 结果推送"""

    def __init__(self):
        self.connections: dict[int, WebSocket] = {}

    async def register(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.connections[user_id] = ws

    async def push_result(self, user_id: int, result: dict):
        ws = self.connections.get(user_id)
        if ws:
            await ws.send_json(result)

    def unregister(self, user_id: int):
        self.connections.pop(user_id, None)


# 订单创建后推送
async def notify_user_realtime(user_id: int, order: dict) -> None:
    result = {"status": "SUCCESS", "order_no": order["order_no"]}
    await result_pusher.push_result(user_id, result)
```

---

## 十、防超卖的完整方案

### 三层防超卖

```
第一层：Redis Lua脚本（最快，内存级别）
  -> 原子操作，库存不会扣成负数
  -> 预扣库存

第二层：乐观锁（数据库级别）
  -> stock > 0 AND version = #{version}
  -> 确保DB不会超卖

第三层：唯一约束（最终兜底）
  -> 订单表按用户+活动建唯一索引
  -> 即使有Bug，DB层也能拦截重复订单
```

```sql
-- 唯一约束
ALTER TABLE order_info
ADD UNIQUE KEY uk_user_activity (user_id, activity_id);

-- 库存表
CREATE TABLE seckill_activity (
    id BIGINT NOT NULL,
    stock INT NOT NULL DEFAULT 0 COMMENT '剩余库存',
    version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    ...
);
```

---

### 超卖场景模拟与验证

```python
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed


def test_seckill_concurrency():
    """并发测试秒杀"""
    user_count = 10000  # 1万用户
    stock = 100         # 100个库存

    # 预热库存
    redis.set("seckill:stock:1", stock)

    success_count = 0
    fail_count = 0
    lock = threading.Lock()

    def do_seckill(user_id: int) -> bool:
        try:
            return seckill_service.seckill(user_id, 1)
        except Exception:
            return False

    with ThreadPoolExecutor(max_workers=200) as executor:
        futures = {executor.submit(do_seckill, i + 1): i for i in range(user_count)}
        for future in as_completed(futures):
            if future.result():
                with lock:
                    nonlocal success_count
                    success_count += 1
            else:
                with lock:
                    nonlocal fail_count
                    fail_count += 1

    print(f"成功数: {success_count}")    # 应该等于100
    print(f"失败数: {fail_count}")      # 应该等于9900

    # 验证库存
    stock_left = redis.get("seckill:stock:1")
    print(f"剩余库存: {stock_left}")     # 应该等于0

    assert success_count == stock, f"超卖了! 成功数={success_count}, 库存={stock}"
```

---

## 十一、高可用保障

### 限流和熔断配置

```python
# 使用自定义 TokenBucket + CircuitBreaker

# 秒杀接口限流：10000 QPS
seckill_token_bucket = TokenBucket(rate=10000, capacity=20000)

# Redis调用熔断器
redis_breaker = CircuitBreaker(
    failure_threshold=5,
    timeout=30,       # 熔断30秒
    half_open_limit=3
)

# Kafka发送熔断器
kafka_breaker = CircuitBreaker(
    failure_threshold=10,
    timeout=60,
    half_open_limit=5
)

# 使用装饰器组合
@app.post("/api/seckill")
@rate_limit(seckill_token_bucket)
@circuit_breaker(redis_breaker)
async def seckill(request: SeckillRequest, user_id: int = Depends(get_user_id)):
    ...
```

---

### Redis故障降级

```python
def pre_deduct_stock(user_id: int, activity_id: int) -> bool:
    try:
        return _redis_deduct_stock(user_id, activity_id)
    except redis.RedisError:
        logger.error("Redis故障，降级到数据库扣减")
        return _fallback_db_deduct(user_id, activity_id)


def _fallback_db_deduct(user_id: int, activity_id: int) -> bool:
    """降级：直接走数据库（加锁防超卖）"""
    lock_key = f"seckill:lock:{activity_id}"
    lock_value = str(uuid.uuid4())

    # Redis分布式锁（SETNX，超时3秒）
    acquired = redis.set(lock_key, lock_value, nx=True, ex=3)

    if not acquired:
        return False

    try:
        activity = activity_dao.get_by_id(activity_id)
        if activity["stock"] <= 0:
            return False

        affected = activity_dao.deduct_stock(activity_id, activity["version"])
        return affected > 0
    finally:
        # Lua脚本安全释放锁
        redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                   1, lock_key, lock_value)
```

---

### Kafka故障处理

```python
def send_order_message(user_id: int, activity_id: int) -> None:
    try:
        _send_kafka_message(user_id, activity_id)
    except Exception as e:
        logger.error("Kafka发送失败，降级到本地消息表")

        # 写本地消息表
        local_msg = {
            "topic": "seckill-order-topic",
            "body": json.dumps({"user_id": user_id, "activity_id": activity_id}),
            "status": "INIT",
            "retry_count": 0,
        }
        local_message_dao.insert(local_msg)


# 后台重发任务
def retry_local_messages() -> None:
    messages = local_message_dao.find_pending(limit=100)

    for msg in messages:
        try:
            producer.send(msg["topic"], msg["body"].encode())
            msg["status"] = "SENT"
        except Exception:
            msg["retry_count"] += 1
            if msg["retry_count"] >= 5:
                msg["status"] = "FAILED"
                alert_service.notify_admin(msg)

        local_message_dao.update(msg)


scheduler.add_job(retry_local_messages, 'interval', seconds=5)
```

---

## 十二、数据库设计

### 秒杀活动表

```sql
CREATE TABLE `seckill_activity` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '活动ID',
    `activity_name` VARCHAR(128) NOT NULL COMMENT '活动名称',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `product_name` VARCHAR(255) NOT NULL COMMENT '商品名称（快照）',
    `original_price` DECIMAL(12,2) NOT NULL COMMENT '原价',
    `activity_price` DECIMAL(12,2) NOT NULL COMMENT '秒杀价',
    `total_stock` INT NOT NULL COMMENT '总库存',
    `stock` INT NOT NULL COMMENT '剩余库存',
    `version` INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态：0待开始 1进行中 2已结束',
    `start_time` DATETIME NOT NULL COMMENT '开始时间',
    `end_time` DATETIME NOT NULL COMMENT '结束时间',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_status_start_time` (`status`, `start_time`)
) ENGINE=InnoDB COMMENT='秒杀活动表';
```

---

### 秒杀订单表

```sql
CREATE TABLE `seckill_order` (
    `id` BIGINT UNSIGNED NOT NULL COMMENT '主键（雪花ID）',
    `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `activity_id` BIGINT UNSIGNED NOT NULL COMMENT '活动ID',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `product_name` VARCHAR(255) NOT NULL COMMENT '商品名称（快照）',
    `activity_price` DECIMAL(12,2) NOT NULL COMMENT '成交价格',
    `status` TINYINT NOT NULL DEFAULT 0 COMMENT '0待支付 1已支付 2已取消',
    `expire_time` DATETIME NOT NULL COMMENT '支付截止时间',
    `pay_time` DATETIME COMMENT '支付时间',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    UNIQUE KEY `uk_user_activity` (`user_id`, `activity_id`),  -- 防重复购买
    KEY `idx_user_id` (`user_id`),
    KEY `idx_activity_id` (`activity_id`)
) ENGINE=InnoDB COMMENT='秒杀订单表';
```

---

### 消息幂等表

```sql
CREATE TABLE `message_dedup` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `msg_id` VARCHAR(128) NOT NULL COMMENT '消息唯一ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_msg_id` (`msg_id`)
) ENGINE=InnoDB COMMENT='消息幂等表';
```

---

## 十三、完整流程串联

### 正常成功流程

```
1. 用户打开秒杀页面
   -> CDN返回静态页面（不打源站）

2. 前端显示倒计时
   -> 服务器时间（避免客户端时钟不准）

3. 秒杀开始，用户点击按钮
   -> 按钮立即禁用（防重复）
   -> 发送验证码（如有）

4. 请求到达Nginx
   -> IP限流检查（每IP每秒5次）
   -> 通过

5. 请求到达网关
   -> 鉴权（Token验证）
   -> 风控（行为检查）
   -> 通过

6. 请求到达秒杀服务
   -> 参数校验 [OK]
   -> 用户资格校验（是否已购买）[OK]
   -> 活动校验（时间、状态）[OK]
   -> Redis预扣库存（Lua脚本原子操作）[OK] 扣减成功
   -> 发送消息到Kafka [OK]
   -> 返回"排队中"

7. 订单服务消费Kafka消息
   -> 幂等检查 [OK] 未处理
   -> DB库存扣减（乐观锁）[OK]
   -> 创建订单 [OK]
   -> 写入结果到Redis
   -> 通知用户

8. 前端轮询结果
   -> 查到"SUCCESS"
   -> 显示"恭喜！抢购成功"
   -> 跳转到订单页

9. RocketMQ延迟消息（30分钟后）
   -> 检查订单是否支付
   -> 未支付 -> 取消订单，恢复库存
```

---

### 失败流程（库存不足）

```
6. 请求到达秒杀服务
   -> Redis预扣库存（Lua脚本）-> 库存=0，返回失败
   -> 立即返回"很遗憾，手慢了"

（不进入消息队列，不打数据库）
```

---

### 异常流程（消息发送失败）

```
6. Redis预扣成功
   -> Kafka发送失败
   -> 回滚Redis库存（Lua原子操作）
   -> 返回"系统繁忙，请重试"
```

---

## 十四、容量评估

### 秒杀场景容量计算

```
假设：
  - 100万用户参与
  - 库存：1000个
  - 秒杀持续时间：1秒（极端）

峰值QPS = 1000000 / 1 = 100万

各层处理能力：
  Nginx：50万 QPS（限流到2万放进来）
  网关：2万 QPS（限流到5000放进来）
  秒杀服务：5000 QPS x N台
  Redis：10万 QPS（扛住）
  Kafka：1万 TPS（扛住）
  DB：5000 TPS（只接受Kafka来的消息，可控）

机器数量：
  秒杀服务：5000 QPS需要，单机1000 QPS，需要5台
  消费者：1000 TPS，单机200 TPS，需要5台
```

---

## 十五、面试答题模板

### "请设计一个秒杀系统"标准回答

**第一步：说清楚难点（30秒）**

```
秒杀系统的核心难点是：
1. 瞬时高并发：百万QPS打到系统
2. 超卖问题：多人抢到同一个库存
3. 数据一致性：Redis扣了但DB没扣
4. 用户体验：要快速给出结果

我会从接入层->服务层->数据层逐层讲解。
```

**第二步：说架构（2分钟）**

```
整体分为五层：
1. 前端层：页面静态化 + CDN，挡住90%的流量
2. 接入层：Nginx限流 + IP防刷
3. 网关层：鉴权 + 风控 + 用户级限流
4. 服务层：Redis预扣库存 + Kafka异步下单
5. 数据层：DB最终落库，乐观锁防超卖
```

**第三步：说核心（2分钟）**

```
核心是Redis预扣库存：
用Lua脚本原子执行三个操作：
1. 检查用户是否已购买
2. 检查库存是否充足
3. 扣减库存 + 标记用户已购

Lua保证原子性，彻底防止超卖。
```

**第四步：说一致性（1分钟）**

```
三层防超卖：
1. Redis Lua：内存层防超卖
2. DB乐观锁：stock > 0 AND version=#{version}
3. 唯一约束：uk_user_activity，DB兜底

Redis和DB的一致性：
通过Kafka消息 + 本地消息表保证最终一致
```

**第五步：说高可用（1分钟）**

```
限流、熔断、降级三级保护
Redis/Kafka故障时有降级方案
监控：消费延迟、库存变化、订单成功率
```

---

## 十六、这一讲你必须记住的核心结论

1. **秒杀核心：Redis Lua原子扣减库存，是防超卖的关键**
2. **三层防超卖：Redis Lua + DB乐观锁 + 唯一约束**
3. **流量层层削减：CDN -> Nginx -> 网关 -> 服务层**
4. **异步下单：Kafka削峰，让DB从百万QPS降到几千TPS**
5. **幂等设计：消息唯一ID + 去重表，防止重复创建订单**
6. **延迟消息：30分钟未支付自动取消，恢复库存**
7. **降级兜底：Redis挂了走DB+锁，Kafka挂了走本地消息表**
8. **库存预热：活动开始前写入Redis，避免活动开始时打DB**

---

## 十七、练习题

### 练习1：Lua脚本

写一个Lua脚本，实现：
- 检查用户是否已购买
- 检查库存
- 扣减库存
- 标记用户已购买（有效期30分钟）
- 返回：-1=已购买，0=库存不足，1=成功

---

### 练习2：超时取消

订单30分钟未支付要自动取消，并且恢复库存。

要求：
1. 取消时要保证幂等（多次取消不出错）
2. 恢复库存要同时恢复Redis和DB
3. 如果恢复失败怎么兜底？

---

### 练习3：架构思考

如果秒杀活动有10万个库存（不是100个），设计上有什么不同？

提示：
- Redis库存预扣还适合吗？
- 消息队列还需要吗？
- 数据库压力是什么量级？

---

### 练习4：故障场景

场景：秒杀进行到一半，Redis突然宕机，怎么办？

要求：
1. 用户正在秒杀的请求怎么处理？
2. 已经扣了Redis库存但还没发消息的怎么办？
3. 系统如何自动恢复？

---

## 十八、下一讲预告

下一讲我们进入：

**第 7 讲：信息流系统设计——Feed流、未读数、计数系统**

会讲：
- 信息流三种模式：推模式 vs 拉模式 vs 推拉结合
- 什么时候用推，什么时候用拉
- 大V发微博如何处理（写扩散问题）
- 未读数系统的设计方案
- 计数系统（点赞数、粉丝数、评论数）
- 信息流的缓存策略
- 大厂实际案例解析

---

**你可以先做练习题，我帮你批改。**

**或者直接开始第7讲。**

**你想怎么安排？**
