# 第 7 讲：信息流系统设计——Feed流、未读数、计数系统

这一讲我们进入另一个高频场景题。

如果说秒杀系统考验的是**写的极限**，那信息流系统考验的是**读的极限**。

---

## 一、信息流系统的核心概念

### 什么是信息流（Feed流）？

**Feed流 = 用户关注的人发布的内容，按时间倒序排列**

### 为什么信息流难设计？

**难点1：写放大** — 大V发一条内容（1次写）→ 1000万粉丝的收件箱各写一份 → 1000万次写操作

**难点2：读聚合** — 用户关注了1000个人 → 查每个人最新内容 → 合并排序 → 1000次查询，太慢了

**难点3：实时性** — 大V刚发的内容 → 粉丝刷新后立刻要看到 → 不能有太长延迟

---

## 二、三种模式深度剖析

### 模式一：推模式（写扩散 / Push）

**原理：** 发布者发内容时 → 主动推送到所有粉丝的"收件箱" → 粉丝刷新时只读自己收件箱

**数据结构：** Redis ZSet，Key: `feed:inbox:{userId}`，Value: 帖子ID，Score: 发布时间戳

**代码实现：**

```python
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=10)


# 发布帖子（写扩散）
def publish_post(user_id: int, post: dict) -> None:
    post_dao.insert(post)

    followers = follow_dao.get_followers(user_id)
    executor.submit(push_to_followers, post, followers)


def push_to_followers(post: dict, followers: list[int]) -> None:
    timestamp = post["create_time"].timestamp()
    post_id = str(post["id"])
    batch_size = 100
    pipe = redis.pipeline()

    for i in range(0, len(followers), batch_size):
        batch = followers[i:i + batch_size]
        for follower_id in batch:
            key = f"feed:inbox:{follower_id}"
            pipe.zadd(key, {post_id: timestamp})
            pipe.zremrangebyrank(key, 0, -1001)  # 只保留最新1000条
            pipe.expire(key, 7 * 24 * 3600)
        pipe.execute()
        pipe = redis.pipeline()


# 读取首页信息流
def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    key = f"feed:inbox:{user_id}"
    start = page * page_size
    end = start + page_size - 1

    post_ids = redis.zrevrange(key, start, end)
    if not post_ids:
        return []

    return post_dao.get_by_ids([int(pid) for pid in post_ids])
```

**优点：** 读性能极好 → 只读自己的收件箱 → 一次Redis查询 → 毫秒级响应

**缺点：** 写放大严重 → 大V发一条要写1000万次

**适用场景：** 粉丝不多（<10万），普通社交网络

---

### 模式二：拉模式（读扩散 / Pull）

**原理：** 发布者只写自己的"发件箱"，粉丝刷新时拉取所有关注者的最新内容并合并

**代码实现：**

```python
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

executor = ThreadPoolExecutor(max_workers=20)


def publish_post(user_id: int, post: dict) -> None:
    """发布帖子（只写自己的发件箱）"""
    post_dao.insert(post)

    outbox_key = f"feed:outbox:{user_id}"
    redis.zadd(outbox_key, {str(post["id"]): post["create_time"].timestamp()})
    redis.zremrangebyrank(outbox_key, 0, -1001)


def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    """读取首页信息流（读扩散）"""
    following_ids = follow_dao.get_following(user_id)
    if not following_ids:
        return []

    fetch_count = page_size * 3
    all_post_ids: list[int] = []

    def fetch_from_outbox(follow_id: int) -> list[int]:
        outbox_key = f"feed:outbox:{follow_id}"
        return [int(pid) for pid in redis.zrevrange(outbox_key, 0, fetch_count - 1)]

    futures = {executor.submit(fetch_from_outbox, fid): fid for fid in following_ids}
    for future in futures:
        try:
            all_post_ids.extend(future.result(timeout=0.2))
        except FutureTimeoutError:
            pass

    if not all_post_ids:
        return []

    all_posts = post_dao.get_by_ids(all_post_ids)
    all_posts.sort(key=lambda p: p["create_time"], reverse=True)

    start = page * page_size
    return all_posts[start:start + page_size]
```

**优点：** 写性能极好，大V无压力
**缺点：** 读性能差，关注越多越慢

---

### 模式三：推拉结合（混合模式）

**这是大厂（微博、微信、抖音）实际使用的方案。** 大V和普通用户采用不同策略。

```python
BIG_V_THRESHOLD = 100_000


def publish_post(user_id: int, post: dict) -> None:
    """发布帖子（推拉结合）"""
    post_dao.insert(post)
    write_to_outbox(user_id, post)

    follower_count = follow_dao.get_follower_count(user_id)

    if follower_count <= BIG_V_THRESHOLD:
        # 普通用户：推模式
        followers = follow_dao.get_followers(user_id)
        executor.submit(push_to_followers, post, followers)


def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    """读取首页（推拉结合）"""
    # 1. 读收件箱（普通用户推送的内容）
    inbox_posts = read_from_inbox(user_id, page_size * 2)

    # 2. 并行拉取关注的大V内容
    big_v_ids = _get_following_big_vs(user_id)
    big_v_posts = _pull_from_big_vs(big_v_ids, page_size)

    # 3. 合并 + 去重 + 排序
    all_posts = {p["id"]: p for p in (inbox_posts + big_v_posts)}.values()
    sorted_posts = sorted(all_posts, key=lambda p: p["create_time"], reverse=True)

    start = page * page_size
    return list(sorted_posts)[start:start + page_size]


def _get_following_big_vs(user_id: int) -> list[int]:
    following = follow_dao.get_following(user_id)
    return [
        fid for fid in following
        if int(redis.get(f"user:follower:count:{fid}") or 0) > BIG_V_THRESHOLD
    ]


def _pull_from_big_vs(big_v_ids: list[int], page_size: int) -> list[dict]:
    if not big_v_ids:
        return []

    def fetch_one(vid: int):
        return read_from_outbox(vid, page_size)

    all_posts = []
    futures = {executor.submit(fetch_one, vid): vid for vid in big_v_ids}
    for future in futures:
        try:
            all_posts.extend(future.result(timeout=0.1))
        except Exception:
            pass
    return all_posts
```

---

### 三种模式对比

| 维度 | 推模式 | 拉模式 | 推拉结合 |
|------|--------|--------|---------|
| **写性能** | 差（写N份） | 好（写1份） | 中 |
| **读性能** | 好（读1次） | 差（读N次） | 好 |
| **大V支持** | 写放大严重 | 好 | 好 |
| **适用场景** | 普通用户 | 大V内容 | **大厂首选** |

---

## 三、Feed流的缓存策略

### 冷热数据分层

```
热数据（最近7天）→ Redis
温数据（7天~1个月）→ MySQL（有索引）
冷数据（1个月以前）→ 归档存储
```

**收件箱设计：**

```python
INBOX_MAX_SIZE = 1000

def add_to_inbox(user_id: int, post_id: int, timestamp: float) -> None:
    key = f"feed:inbox:{user_id}"
    redis.zadd(key, {str(post_id): timestamp})

    size = redis.zcard(key)
    if size > INBOX_MAX_SIZE:
        redis.zremrangebyrank(key, 0, size - INBOX_MAX_SIZE - 1)

    redis.expire(key, 7 * 24 * 3600)
```

---

### 用户长期不登录的处理

```python
def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    inbox_key = f"feed:inbox:{user_id}"

    if not redis.exists(inbox_key):
        rebuild_inbox(user_id)

    return read_from_inbox(user_id, page, page_size)


def rebuild_inbox(user_id: int) -> None:
    following = follow_dao.get_following(user_id)
    inbox_key = f"feed:inbox:{user_id}"

    pipe = redis.pipeline()
    for follow_id in following:
        recent_posts = post_dao.get_recent_by_user_id(follow_id, 20)
        for post in recent_posts:
            pipe.zadd(inbox_key, {str(post["id"]): post["create_time"].timestamp()})
    pipe.execute()

    redis.zremrangebyrank(inbox_key, 0, -(INBOX_MAX_SIZE + 1))
    redis.expire(inbox_key, 7 * 24 * 3600)
```

---

### 关注/取关时的处理

```python
def follow(user_id: int, target_id: int) -> None:
    follow_dao.insert(user_id, target_id)
    redis.incr(f"user:following:count:{user_id}")
    redis.incr(f"user:follower:count:{target_id}")

    target_follower_count = int(redis.get(f"user:follower:count:{target_id}") or 0)

    if target_follower_count <= BIG_V_THRESHOLD:
        recent_posts = post_dao.get_recent_by_user_id(target_id, 50)
        inbox_key = f"feed:inbox:{user_id}"
        for post in recent_posts:
            redis.zadd(inbox_key, {str(post["id"]): post["create_time"].timestamp()})


def unfollow(user_id: int, target_id: int) -> None:
    follow_dao.delete(user_id, target_id)
    redis.decr(f"user:following:count:{user_id}")
    redis.decr(f"user:follower:count:{target_id}")

    post_ids = post_dao.get_post_ids_by_user_id(target_id)
    if post_ids:
        redis.zrem(f"feed:inbox:{user_id}", *[str(pid) for pid in post_ids])
```

---

## 四、未读数系统设计

### 方案二：Redis计数器（最常用）

**Key设计：**
```
unread:{userId}:total       → 总未读数
unread:{userId}:comment    → 评论未读
unread:{userId}:at         → @我的未读
unread:{userId}:like       → 点赞未读
unread:{userId}:msg:{conv} → 某个会话的未读数
```

```python
# 收到新消息
def on_new_message(receiver_id: int, msg_type: str, conversation_id: int = None) -> None:
    redis.incr(f"unread:{receiver_id}:total")
    redis.incr(f"unread:{receiver_id}:{msg_type}")
    if conversation_id is not None:
        redis.incr(f"unread:{receiver_id}:msg:{conversation_id}")
    redis.expire(f"unread:{receiver_id}:total", 30 * 24 * 3600)


# 用户打开APP
def get_unread_count(user_id: int) -> dict:
    pipe = redis.pipeline()
    for t in ("total", "comment", "at", "like", "follow"):
        pipe.get(f"unread:{user_id}:{t}")
    results = pipe.execute()
    return {"total": int(results[0] or 0), "comment": int(results[1] or 0),
            "at": int(results[2] or 0), "like": int(results[3] or 0),
            "follow": int(results[4] or 0)}


# 清零
def mark_as_read(user_id: int, msg_type: str) -> None:
    redis.set(f"unread:{user_id}:{msg_type}", "0")
    recalc_total(user_id)
```

---

### 会话未读数的精确设计

```
每个会话维护：maxSeq, readSeq_A, readSeq_B
A的未读数 = maxSeq - readSeq_A
```

```python
def send_message(sender_id: int, receiver_id: int, content: str) -> None:
    conversation_id = f"{min(sender_id, receiver_id)}_{max(sender_id, receiver_id)}"

    seq = redis.incr(f"conv:seq:{conversation_id}")

    message = {"conversation_id": conversation_id, "sender_id": sender_id,
               "content": content, "seq": seq}
    message_dao.insert(message)

    redis.set(f"conv:maxSeq:{conversation_id}", seq)
    redis.incr(f"unread:{receiver_id}:msg:{conversation_id}")
    redis.incr(f"unread:{receiver_id}:total")


def mark_read(user_id: int, conversation_id: str) -> None:
    max_seq = redis.get(f"conv:maxSeq:{conversation_id}")
    if max_seq is None:
        return

    redis.set(f"userRead:{user_id}:{conversation_id}", max_seq)
    redis.set(f"unread:{user_id}:msg:{conversation_id}", "0")
    recalc_total_unread(user_id)
```

---

### 未读数的精度问题

**方案1：定期持久化到DB**

```python
from apscheduler.schedulers.background import BackgroundScheduler


def persist_unread_count() -> None:
    keys = redis.keys("unread:*:total") or []
    for key in keys:
        user_id = extract_user_id(key)
        count = redis.get(key)
        if count is not None:
            user_unread_dao.upsert(user_id, int(count))


scheduler = BackgroundScheduler()
scheduler.add_job(persist_unread_count, 'interval', seconds=60)
scheduler.start()
```

**方案2：允许近似** — 点赞评论等非关键场景精度要求不高；IM消息关键场景以DB为准，Redis只做加速。

---

## 五、计数系统设计

### Redis计数器

```python
class CounterService:
    @staticmethod
    def _key(type_: str, id_: int) -> str:
        return f"count:{type_}:{id_}"

    def increment(self, type_: str, id_: int) -> int:
        result = redis.incr(self._key(type_, id_))
        redis.sadd("counter:dirty", self._key(type_, id_))
        return result

    def decrement(self, type_: str, id_: int) -> int:
        return redis.decr(self._key(type_, id_))

    def get_count(self, type_: str, id_: int) -> int:
        value = redis.get(self._key(type_, id_))
        if value is not None:
            return int(value)
        count = counter_dao.load(type_, id_)
        redis.set(self._key(type_, id_), count)
        return count

    def batch_get_count(self, type_: str, ids: list[int]) -> dict[int, int]:
        pipe = redis.pipeline()
        for id_ in ids:
            pipe.get(self._key(type_, id_))
        values = pipe.execute()
        return {ids[i]: int(v or 0) for i, v in enumerate(values)}
```

---

### 计数器持久化

```python
def sync_counts_to_db() -> None:
    dirty_keys = redis.smembers("counter:dirty")
    if not dirty_keys:
        return

    pipe = redis.pipeline()
    for key in dirty_keys:
        pipe.get(key)
    values = pipe.execute()

    updates = []
    for key, value in zip(dirty_keys, values):
        if value is not None:
            type_, id_ = parse_key(key)
            updates.append({"type": type_, "id": id_, "count": int(value)})

    if updates:
        counter_dao.batch_update(updates)
        redis.srem("counter:dirty", *dirty_keys)


scheduler.add_job(sync_counts_to_db, 'interval', seconds=10)
```

---

### 点赞去重（Set记录）

```python
LUA_LIKE = """
if redis.call('sismember', KEYS[1], ARGV[1]) == 1 then
    return 0
end
redis.call('sadd', KEYS[1], ARGV[1])
redis.call('incr', KEYS[2])
return 1
"""

LUA_UNLIKE = """
if redis.call('sismember', KEYS[1], ARGV[1]) == 0 then
    return 0
end
redis.call('srem', KEYS[1], ARGV[1])
redis.call('decr', KEYS[2])
return 1
"""


def like(user_id: int, post_id: int) -> bool:
    return redis.eval(LUA_LIKE, 2,
        f"post:liked:users:{post_id}",
        f"count:like:{post_id}",
        str(user_id)) == 1


def unlike(user_id: int, post_id: int) -> bool:
    return redis.eval(LUA_UNLIKE, 2,
        f"post:liked:users:{post_id}",
        f"count:like:{post_id}",
        str(user_id)) == 1
```

---

### 阅读数防刷（滑动窗口）

```python
def add_view(user_id: int, post_id: int) -> None:
    view_key = f"post:viewed:{post_id}:{user_id}"

    is_new = redis.set(view_key, "1", nx=True)
    if is_new:
        redis.expire(view_key, 3600)  # 1小时内不重复计
        redis.incr(f"count:view:{post_id}")
        redis.sadd("counter:dirty", f"count:view:{post_id}")
```

---

### 大数值计数的优化

```python
# 方案1：只缓存热点数据
def get_count(type_: str, id_: int) -> int:
    cached = redis.get(f"count:{type_}:{id_}")
    if cached is not None:
        return int(cached)
    return counter_dao.load(type_, id_)  # 冷数据不写回Redis


# 方案2：Hash合并存储
def get_post_counts(post_id: int) -> dict[str, int]:
    raw = redis.hgetall(f"post:counts:{post_id}")
    return {k.decode(): int(v) for k, v in raw.items()}

def increment_count(post_id: int, type_: str) -> int:
    return redis.hincrby(f"post:counts:{post_id}", type_, 1)
```

---

## 六、信息流的翻页设计

### 问题：时间线翻页偏移

```
LIMIT OFFSET → 翻页期间新内容插入 → 数据后移 → 重复或遗漏
```

### 解决方案：时间戳游标

```python
def get_home_feed(user_id: int, last_timestamp: float | None, page_size: int) -> dict:
    inbox_key = f"feed:inbox:{user_id}"

    if last_timestamp is None:
        tuples = redis.zrevrange(inbox_key, 0, page_size - 1, withscores=True)
    else:
        tuples = redis.zrevrangebyscore(
            inbox_key, last_timestamp - 1, 0,
            start=0, num=page_size, withscores=True
        )

    if not tuples:
        return {"posts": [], "last_timestamp": None, "has_more": False}

    post_ids = [int(t[0]) for t in tuples]
    new_last_timestamp = min(t[1] for t in tuples)

    return {
        "posts": post_dao.get_by_ids(post_ids),
        "last_timestamp": new_last_timestamp,
        "has_more": len(post_ids) == page_size,
    }
```

> 前端 JavaScript 参考代码（非本项目实现）：

```javascript
let lastTimestamp = null;

async function loadMore() {
    const params = lastTimestamp ? `?lastTimestamp=${lastTimestamp}` : '';
    const response = await fetch(`/api/feed${params}`);
    const page = await response.json();

    appendPosts(page.posts);
    lastTimestamp = page.lastTimestamp;

    if (!page.hasMore) hideLoadMoreButton();
}
```

---

## 七、大V的写扩散控制

```python
def on_big_v_post(big_v_id: int, post: dict) -> None:
    write_to_outbox(big_v_id, post)  # 大V只写发件箱

    # 异步：只给"活跃粉丝"推送
    executor.submit(_push_to_active_followers, big_v_id, post)


def _push_to_active_followers(big_v_id: int, post: dict) -> None:
    active_followers = follower_dao.get_active_followers(big_v_id, days=7)
    for batch in chunked(active_followers, 1000):
        push_to_follower_batch(post, batch)
        time.sleep(0.01)  # 控制速率


def is_big_v(user_id: int) -> bool:
    """缓存大V判断"""
    key = f"user:isBigV:{user_id}"
    cached = redis.get(key)
    if cached is not None:
        return cached == b"1"

    is_big = follower_count_dao.get_count(user_id) >= BIG_V_THRESHOLD
    redis.setex(key, 3600, "1" if is_big else "0")
    return is_big
```

---

## 八、完整的Feed流系统架构

```
[用户发布帖子]
      ↓
[帖子服务] → 写DB → 写发件箱 → 发Kafka消息
      ↓
[Feed分发服务] ← 消费Kafka
  → 普通用户 → 查粉丝列表 → 批量写收件箱
  → 大V → 只写发件箱（不推送）

[用户刷首页]
      ↓
[Feed服务]
  → 读收件箱 + 拉取大V发件箱（并行）
  → 合并 + 去重 + 排序 → 返回
```

---

## 九、面试高频题

### 1. 推模式和拉模式的区别？
推模式读快写慢（大V写放大），拉模式读慢写快，大厂推拉结合。

### 2. 微博大V如何处理1000万粉丝推送？
大V只写发件箱，异步推送给活跃粉丝，不活跃的登录时拉取。

### 3. 未读数系统怎么设计？
Redis计数器 + 定时持久化 + 关键场景以DB为准。

### 4. 点赞去重？
Redis Set记录点赞用户 + Lua脚本原子操作（SISMEMBER + SADD + INCR）。

### 5. 长期不登录怎么处理？
收件箱过期后登录时重建，拉取关注者最新内容写入。

### 6. 翻页为什么用时间戳游标？
避免新内容插入导致的重复/遗漏，ZREVRANGEBYSCORE不受影响。

---

## 十、核心结论

1. **推模式读快写慢，拉模式读慢写快，大厂用推拉结合**
2. **大V用拉模式，普通用户用推模式，读取时合并**
3. **收件箱用Redis ZSet，只保留最近1000条**
4. **长期不登录：登录时重建收件箱**
5. **未读数用Redis计数器，定期持久化到DB**
6. **计数系统Redis+异步落库，点赞用Set去重**
7. **翻页用时间戳游标，不用LIMIT OFFSET**
8. **关注/取关要同步更新收件箱**

---

## 十一、练习题

### 练习1：推拉结合
设计社交平台信息流系统：普通用户推模式，大V拉模式。

### 练习2：未读数
设计微博未读数系统：评论/@我/新粉丝/私信，含Key设计和Redis宕机恢复。

### 练习3：计数系统
设计帖子点赞系统：点赞/去重/取消/持久化。

### 练习4：思考题
**为什么微博/抖音刷新有时会看到"重复的内容"？**

---

## 十二、下一讲预告

**第 8 讲：分布式服务治理——注册发现、分布式锁、链路追踪**
