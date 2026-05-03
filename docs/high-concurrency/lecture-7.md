# 第 7 讲：信息流系统设计——Feed流、未读数、计数系统

这一讲我们进入另一个高频场景题。

如果说秒杀系统考验的是**写的极限**，那信息流系统考验的是**读的极限**。

微博、朋友圈、抖音首页、微信公众号——这些都是信息流系统。

信息流系统的核心挑战是：
- 用户关注了1000个人，每人每天发10条内容
- 用户每次刷新首页，要立刻看到最新的、个性化的内容
- 系统有1亿用户同时在刷
- **如何在毫秒内返回正确的内容？**

---

## 一、信息流系统的核心概念

### 什么是信息流（Feed流）？

**Feed流 = 用户关注的人发布的内容，按时间倒序排列**

```
用户A 关注了：
  - 用户B（普通用户，100个粉丝）
  - 明星C（大V，1000万粉丝）
  - 新闻账号D（大V，500万粉丝）

用户A的首页信息流：
  [明星C: 09:00 发的帖子]
  [用户B: 08:50 发的帖子]
  [新闻D: 08:30 发的新闻]
  [明星C: 08:00 发的帖子]
  ...
```

---

### 信息流的两个核心操作

**写操作：**

```
用户发布一条内容
→ 所有关注他的人，下次刷新能看到
```

**读操作：**

```
用户刷新首页
→ 看到关注的所有人发的最新内容
→ 按时间倒序
→ 要快（<100ms）
```

---

### 为什么信息流难设计？

**难点1：写放大**

```
大V发一条内容（1次写）
→ 1000万粉丝的收件箱各写一份
→ 1000万次写操作
```

**难点2：读聚合**

```
用户关注了1000个人
→ 查每个人最新内容
→ 合并排序
→ 1000次查询，然后排序
→ 太慢了
```

---

## 二、三种模式深度剖析

### 模式一：推模式（写扩散 / Push）

**原理：**

```
发布者发内容时
→ 主动把内容推送到所有粉丝的"收件箱"
→ 粉丝刷新时，只需读自己的收件箱
```

**数据结构：**

```
每个用户有一个"收件箱"（时间线）
收件箱：按时间排序的内容ID列表

用Redis ZSet实现：
Key: feed:inbox:{userId}
Value: 帖子ID
Score: 发布时间戳
```

**写流程：**

```
用户B发了一条帖子（postId=1001）

→ 查询B的所有粉丝列表
  [粉丝A, 粉丝C, 粉丝D, ...]（假设1万个粉丝）

→ 遍历每个粉丝，写入他们的收件箱
  ZADD feed:inbox:A {timestamp} 1001
  ZADD feed:inbox:C {timestamp} 1001
  ZADD feed:inbox:D {timestamp} 1001
  ... (1万次写操作)
```

**读流程：**

```
用户A刷新首页

→ 只需读自己的收件箱
  ZREVRANGE feed:inbox:A 0 19  （取最新20条）

→ 根据帖子ID批量查帖子详情
→ 返回

极快！一次Redis查询搞定
```

**代码实现：**

```python
from concurrent.futures import ThreadPoolExecutor
import redis

executor = ThreadPoolExecutor(max_workers=10)

# 发布帖子（写扩散）
def publish_post(user_id: int, post: dict) -> None:
    # 1. 保存帖子到DB
    post_dao.insert(post)

    # 2. 查询所有粉丝
    followers = follow_dao.get_followers(user_id)

    # 3. 推送到所有粉丝的收件箱（异步）
    executor.submit(push_to_followers, post, followers)


def push_to_followers(post: dict, followers: list[int]) -> None:
    """批量推送到粉丝收件箱"""
    timestamp = post["create_time"].timestamp()
    post_id = str(post["id"])

    batch_size = 100
    pipe = redis.pipeline()

    for i in range(0, len(followers), batch_size):
        batch = followers[i: i + batch_size]
        for follower_id in batch:
            key = f"feed:inbox:{follower_id}"
            pipe.zadd(key, {post_id: timestamp})
            # 只保留最新1000条
            pipe.zremrangebyrank(key, 0, -1001)
            # 设置过期时间（7天）
            pipe.expire(key, 7 * 24 * 3600)

        pipe.execute()
        pipe = redis.pipeline()


# 读取首页信息流
def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    key = f"feed:inbox:{user_id}"
    start = page * page_size
    end = start + page_size - 1

    # 1. 从收件箱读取帖子ID（按时间倒序）
    post_ids = redis.zrevrange(key, start, end)

    if not post_ids:
        return []

    # 2. 批量查帖子详情
    post_ids_int = [int(pid) for pid in post_ids]
    return post_dao.get_by_ids(post_ids_int)
```

**优点：** 读性能极好 → 只读自己的收件箱 → 一次Redis查询 → 毫秒级响应

**缺点：** 写放大严重 → 大V发一条要写1000万次 → 延迟高、存储大

**适用场景：** 粉丝不多（<10万），普通社交网络

---

### 模式二：拉模式（读扩散 / Pull）

**原理：**

```
发布者只把内容写到自己的"发件箱"
粉丝刷新时，主动拉取所有关注者的最新内容，在内存中合并
```

**数据结构：**

```
每个用户有一个"发件箱"（自己发的内容）
Key: feed:outbox:{userId}
Value: 帖子ID
Score: 发布时间戳
```

**写流程：**

```
用户B发了一条帖子（postId=1001）
→ 只写自己的发件箱（1次写）
  ZADD feed:outbox:B {timestamp} 1001
```

**读流程：**

```
用户A刷新首页（关注了B、C、D等1000人）

→ 查A的关注列表 → 从每个人的发件箱拉取最新N条（1000次查询）
→ 内存中合并排序 → 返回最新20条
```

**代码实现：**

```python
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

# 发布帖子（只写自己的发件箱）
def publish_post(user_id: int, post: dict) -> None:
    post_dao.insert(post)
    outbox_key = f"feed:outbox:{user_id}"
    redis.zadd(outbox_key, {str(post["id"]): post["create_time"].timestamp()})
    redis.zremrangebyrank(outbox_key, 0, -1001)  # 只保留最近1000条


# 读取首页信息流（读扩散）
def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    following_ids = follow_dao.get_following(user_id)
    if not following_ids:
        return []

    fetch_count = page_size * 3
    all_post_ids: list[int] = []

    # 并行从每个人的发件箱拉取内容
    def fetch_from_outbox(follow_id: int) -> list[int]:
        outbox_key = f"feed:outbox:{follow_id}"
        return [int(pid) for pid in redis.zrevrange(outbox_key, 0, fetch_count - 1)]

    futures = {executor.submit(fetch_from_outbox, fid): fid for fid in following_ids}
    for future in futures:
        try:
            all_post_ids.extend(future.result(timeout=0.2))
        except FutureTimeoutError:
            pass  # 超时跳过

    if not all_post_ids:
        return []

    # 批量查帖子详情 + 按时间排序 + 分页
    all_posts = post_dao.get_by_ids(all_post_ids)
    all_posts.sort(key=lambda p: p["create_time"], reverse=True)

    start = page * page_size
    return all_posts[start:start + page_size]
```

**优点：** 写性能极好、大V无压力
**缺点：** 读性能差 → 关注越多越慢
**适用场景：** 关注少、写操作频繁

---

### 模式三：推拉结合（混合模式）

**这是大厂（微博、微信、抖音）实际使用的方案。**

**核心思想：**

```
普通用户（粉丝少）→ 推模式（写扩散）
大V（粉丝多）     → 拉模式（读扩散）

读取时：
收件箱（普通用户推过来的）+ 关注的大V的发件箱 → 合并
```

**什么叫"大V"？** 粉丝数 > 阈值（比如：10万）的用户

**代码实现：**

```python
BIG_V_THRESHOLD = 100_000


def publish_post(user_id: int, post: dict) -> None:
    """发布帖子（推拉结合）"""
    post_dao.insert(post)

    # 写自己的发件箱（所有人都写）
    write_to_outbox(user_id, post)

    # 判断是否是普通用户
    follower_count = follow_dao.get_follower_count(user_id)

    if follower_count <= BIG_V_THRESHOLD:
        # 普通用户：推模式
        followers = follow_dao.get_followers(user_id)
        executor.submit(push_to_followers, post, followers)


def get_home_feed(user_id: int, page: int, page_size: int) -> list[dict]:
    """读取首页信息流（推拉结合）"""
    # 1. 读自己的收件箱（来自普通用户的推送）
    inbox_posts = read_from_inbox(user_id, page_size * 2)

    # 2. 拉取关注的大V的最新内容
    big_v_ids = _get_following_big_vs(user_id)
    big_v_posts = _pull_from_big_vs(big_v_ids, page_size)

    # 3. 合并 + 去重 + 排序
    all_posts = {p["id"]: p for p in (inbox_posts + big_v_posts)}.values()
    sorted_posts = sorted(all_posts, key=lambda p: p["create_time"], reverse=True)

    start = page * page_size
    return list(sorted_posts)[start:start + page_size]


def _get_following_big_vs(user_id: int) -> list[int]:
    """获取关注列表中的大V"""
    following = follow_dao.get_following(user_id)
    return [
        fid for fid in following
        if int(redis.get(f"user:follower:count:{fid}") or 0) > BIG_V_THRESHOLD
    ]


def _pull_from_big_vs(big_v_ids: list[int], page_size: int) -> list[dict]:
    """并行拉取大V内容"""
    if not big_v_ids:
        return []

    def fetch_one(big_v_id: int) -> list[dict]:
        return read_from_outbox(big_v_id, page_size)

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
| **写性能** | 差（写N份） | 好（写1份） | 中（普通用户写N份） |
| **读性能** | 好（读1次） | 差（读N次） | 好 |
| **存储空间** | 大 | 小 | 中 |
| **大V支持** | 写放大严重 | 好 | 好 |
| **实时性** | 好 | 中 | 好 |
| **复杂度** | 低 | 低 | 高 |
| **适用场景** | 普通用户 | 大V内容 | **大厂首选** |

---

## 三、Feed流的缓存策略

### 冷热数据分层

```
热数据（最近7天的内容）→ Redis
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
        # 收件箱为空（长期未登录）→ 重建
        rebuild_inbox(user_id)

    return read_from_inbox(user_id, page, page_size)


def rebuild_inbox(user_id: int) -> None:
    """重建收件箱"""
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
        # 普通用户：拉取最近内容推入收件箱
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
        inbox_key = f"feed:inbox:{user_id}"
        redis.zrem(inbox_key, *[str(pid) for pid in post_ids])
```

---

## 四、未读数系统设计

### 方案一：数据库计数（简单但慢）

```sql
SELECT COUNT(*) FROM message WHERE receiver_id = #{userId} AND is_read = 0;
```

**问题：** 用户每次打开APP都要COUNT(*)，高并发下扛不住。

---

### 方案二：Redis计数器（最常用）

**Key 设计：**

```
unread:{userId}:total       → 总未读数
unread:{userId}:comment    → 评论未读
unread:{userId}:at         → @我的未读
unread:{userId}:like       → 点赞未读
unread:{userId}:follow     → 新关注未读
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

    return {
        "total": int(results[0] or 0),
        "comment": int(results[1] or 0),
        "at": int(results[2] or 0),
        "like": int(results[3] or 0),
        "follow": int(results[4] or 0),
    }


# 清零
def mark_as_read(user_id: int, msg_type: str) -> None:
    redis.set(f"unread:{user_id}:{msg_type}", "0")
    recalc_total(user_id)
```

---

### 会话未读数的精确设计

**IM系统中最复杂的场景。**

```
每个会话维护：
  - 最新消息序号（maxSeq）
  - 用户A的已读序号（readSeq_A）
  - 用户B的已读序号（readSeq_B）

A的未读数 = maxSeq - readSeq_A
B的未读数 = maxSeq - readSeq_B
```

```python
def send_message(sender_id: int, receiver_id: int, content: str) -> None:
    conversation_id = f"{min(sender_id, receiver_id)}_{max(sender_id, receiver_id)}"

    seq_key = f"conv:seq:{conversation_id}"
    seq = redis.incr(seq_key)

    message = {
        "conversation_id": conversation_id,
        "sender_id": sender_id,
        "content": content,
        "seq": seq,
    }
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

**Redis宕机 → 未读数丢失 → 重启后全部变成0**

**方案1：定期持久化到DB**

```python
from apscheduler.schedulers.background import BackgroundScheduler


def persist_unread_count() -> None:
    """每分钟持久化未读数"""
    keys = redis.keys("unread:*:total")
    if not keys:
        return
    for key in keys:
        user_id = extract_user_id(key)
        count = redis.get(key)
        if count is not None:
            user_unread_dao.upsert(user_id, int(count))


scheduler = BackgroundScheduler()
scheduler.add_job(persist_unread_count, 'interval', seconds=60)
scheduler.start()
```

**方案2：允许近似** -- 点赞、评论等非关键场景精度要求不高；IM消息关键场景以DB为准，Redis只做加速

---

## 五、计数系统设计

### Redis计数器

```python
class CounterService:
    @staticmethod
    def _build_key(type_: str, id_: int) -> str:
        return f"count:{type_}:{id_}"

    def increment(self, type_: str, id_: int) -> int:
        return redis.incr(self._build_key(type_, id_))

    def decrement(self, type_: str, id_: int) -> int:
        return redis.decr(self._build_key(type_, id_))

    def get_count(self, type_: str, id_: int) -> int:
        key = self._build_key(type_, id_)
        value = redis.get(key)
        if value is not None:
            return int(value)
        # 缓存未命中，从DB加载
        count = counter_dao.load(type_, id_)
        redis.set(key, count)
        return count

    def batch_get_count(self, type_: str, ids: list[int]) -> dict[int, int]:
        pipe = redis.pipeline()
        for id_ in ids:
            pipe.get(self._build_key(type_, id_))
        values = pipe.execute()
        return {ids[i]: int(v or 0) for i, v in enumerate(values)}
```

---

### 点赞去重（用Set记录）

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
    like_key = f"post:liked:users:{post_id}"
    count_key = f"count:like:{post_id}"
    return redis.eval(LUA_LIKE, 2, like_key, count_key, str(user_id)) == 1


def unlike(user_id: int, post_id: int) -> bool:
    like_key = f"post:liked:users:{post_id}"
    count_key = f"count:like:{post_id}"
    return redis.eval(LUA_UNLIKE, 2, like_key, count_key, str(user_id)) == 1
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

### 计数器的持久化

```python
def sync_counts_to_db() -> None:
    """每10秒同步到DB"""
    dirty_keys = redis.smembers("counter:dirty")
    if not dirty_keys:
        return

    updates = []
    pipe = redis.pipeline()
    for key in dirty_keys:
        pipe.get(key)
    values = pipe.execute()

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

## 六、信息流的翻页设计

### 问题：时间线翻页偏移

```
第1页时（10:00）：
  [帖子E: 09:50]
  [帖子D: 09:40]
  [帖子C: 09:30]

第2页时（10:05）：
  新帖子F(10:03)、G(10:01)加入
  LIMIT OFFSET → 出现重复或遗漏
```

### 解决方案：时间戳游标

```python
def get_home_feed(user_id: int, last_timestamp: float | None, page_size: int) -> dict:
    """时间戳游标翻页"""
    inbox_key = f"feed:inbox:{user_id}"

    if last_timestamp is None:
        # 第一页
        tuples = redis.zrevrange(inbox_key, 0, page_size - 1, withscores=True)
    else:
        # 后续页面：游标翻页
        tuples = redis.zrevrangebyscore(
            inbox_key, last_timestamp - 1, 0,
            start=0, num=page_size, withscores=True
        )

    if not tuples:
        return {"posts": [], "last_timestamp": None, "has_more": False}

    post_ids = [int(t[0]) for t in tuples]
    new_last_timestamp = min(t[1] for t in tuples)

    posts = post_dao.get_by_ids(post_ids)
    return {
        "posts": posts,
        "last_timestamp": new_last_timestamp,
        "has_more": len(posts) == page_size,
    }
```

---

## 七、大V的写扩散控制

```python
def on_big_v_post(big_v_id: int, post: dict) -> None:
    write_to_outbox(big_v_id, post)  # 只写发件箱

    # 异步：只给"活跃粉丝"推送
    executor.submit(_push_to_active_followers, big_v_id, post)


def _push_to_active_followers(big_v_id: int, post: dict) -> None:
    active_followers = get_active_followers(big_v_id)  # 7天内登录的粉丝
    for batch in chunked(active_followers, 1000):
        push_to_follower_batch(post, batch)
        time.sleep(0.01)  # 控制推送速率


def is_big_v(user_id: int) -> bool:
    key = f"user:isBigV:{user_id}"
    cached = redis.get(key)
    if cached is not None:
        return cached == b"1"

    follower_count = follower_count_dao.get_count(user_id)
    is_big = follower_count >= BIG_V_THRESHOLD
    redis.setex(key, 3600, "1" if is_big else "0")
    return is_big
```

---

## 八、完整的Feed流系统架构

```
[用户发布帖子]
      ↓
[帖子服务]
  ↓ 写DB
  ↓ 写发件箱（所有用户）
  ↓ 发消息到Kafka（topic: post.created）
      ↓
[Feed分发服务] ← 消费Kafka
  ↓ 判断是普通用户还是大V
  ↓ 普通用户 → 查粉丝列表 → 批量写收件箱
  ↓ 大V → 只写发件箱（不推送）

[用户刷首页]
      ↓
[Feed服务]
  ↓ 读收件箱（来自普通用户的推送）
  ↓ 拉取关注的大V的发件箱（并行）
  ↓ 合并 + 去重 + 排序
  ↓ 批量查帖子详情
  ↓ 返回
```

---

## 九、面试高频题

### 1. 推模式和拉模式的区别？

```
推模式（写扩散）：
→ 发布时写入所有粉丝收件箱
→ 读时只读自己收件箱（快）
→ 大V写放大严重

拉模式（读扩散）：
→ 发布时只写自己发件箱
→ 读时需要拉取所有关注者的内容（慢）
→ 写性能好

大厂选择：推拉结合
→ 普通用户：推模式
→ 大V：拉模式
→ 读时合并
```

### 2. 微博大V发微博，如何处理1000万粉丝的推送？

```
不推送给所有粉丝：
1. 大V只写自己的发件箱
2. 异步推送给"活跃粉丝"（最近登录的）
3. 不活跃的粉丝：等他们登录时从发件箱拉取
4. 分批推送，控制速率
```

### 3. 未读数系统怎么设计？

```
用Redis计数器：INCR unread:{userId}:{type}
用户打开APP：Pipeline批量读取所有类型的未读数
持久化：定时任务同步到DB
关键场景（IM消息）以DB为准，Redis加速
```

### 4. 点赞数怎么防止重复计数？

```
用Redis Set记录点赞用户：post:liked:users:{postId}
点赞时Lua脚本原子操作：
1. SISMEMBER检查是否已点赞
2. 未点赞 → SADD + INCR
3. 已点赞 → 返回失败
```

### 5. 用户长期不登录，再登录怎么处理？

```
收件箱过期（Redis TTL到期）
→ 用户登录时触发收件箱重建
→ 拉取所有关注者的最新内容（从DB）
→ 写入收件箱（最近N条）
→ 正常显示
```

### 6. 信息流翻页为什么用时间戳游标，不用LIMIT OFFSET？

```
LIMIT OFFSET：
→ 翻页期间新内容插入 → 数据后移 → 重复或遗漏

时间戳游标：
→ 以最后一条的时间戳为起点
→ ZREVRANGEBYSCORE score < lastTimestamp
→ 不受新内容影响
```

---

## 十、核心结论

1. **推模式读快写慢，拉模式读慢写快，大厂用推拉结合**
2. **大V用拉模式，普通用户用推模式，读取时合并**
3. **收件箱用Redis ZSet（Score=时间戳），只保留最近1000条**
4. **用户长期不登录：登录时重建收件箱**
5. **未读数用Redis计数器，定期持久化到DB**
6. **计数系统Redis+异步落库，点赞用Set去重**
7. **信息流翻页用时间戳游标，不用LIMIT OFFSET**
8. **关注/取关要同步更新收件箱**

---

## 十一、练习题

### 练习1：推拉结合
设计社交平台信息流系统：普通用户推模式，大V拉模式。画出写流程、读流程。

### 练习2：未读数
设计微博未读数系统：评论/@我的/新粉丝/私信。设计Key、读写操作、Redis宕机恢复。

### 练习3：计数系统
设计帖子点赞系统：显示点赞数、去重、取消点赞、持久化。

### 练习4：思考题
**为什么微博/抖音的信息流，有时候刷新会看到"重复的内容"？**

---

## 十二、下讲预告

**第 8 讲：分布式服务治理——注册发现、分布式锁、链路追踪**
