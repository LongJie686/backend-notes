# 第 7 讲：信息流系统设计——Feed流、未读数、计数系统

这一讲我们进入另一个高频场景题。

如果说秒杀系统考验的是**写的极限**，那信息流系统考验的是**读的极限**。

微博、朋友圈、抖音首页、微信公众号——这些都是信息流系统。

信息流系统的核心挑战是：
- 用户关注了1000个人，每人每天发10条内容
- 用户每次刷新首页，要立刻看到最新的、个性化的内容
- 系统有1亿用户同时在刷
- **如何在毫秒内返回正确的内容？**

这一讲会带你彻底搞懂：
- 推模式、拉模式、推拉结合的区别和选型
- 大V发帖的写扩散问题怎么解决
- 未读数系统怎么设计
- 计数系统（点赞、评论、粉丝数）怎么设计
- 大厂的实际做法

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

**难点3：实时性**

```
大V刚发的内容
→ 粉丝刷新后立刻要看到
→ 不能有太长延迟
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

```java
// 发布帖子（写扩散）
public void publishPost(Long userId, Post post) {
    // 1. 保存帖子到DB
    postDao.insert(post);

    // 2. 查询所有粉丝
    List<Long> followers = followDao.getFollowers(userId);

    // 3. 推送到所有粉丝的收件箱（异步）
    executor.submit(() -> {
        pushToFollowers(post, followers);
    });
}

private void pushToFollowers(Post post, List<Long> followers) {
    String score = String.valueOf(post.getCreateTime().getTime());
    String postId = String.valueOf(post.getId());

    // 批量推送（分批，避免一次太多）
    int batchSize = 100;
    for (int i = 0; i < followers.size(); i += batchSize) {
        List<Long> batch = followers.subList(i,
            Math.min(i + batchSize, followers.size()));

        // Pipeline批量写Redis（减少网络往返）
        redis.executePipelined((RedisCallback<?>) connection -> {
            for (Long followerId : batch) {
                String key = "feed:inbox:" + followerId;
                connection.zAdd(key.getBytes(),
                    Double.parseDouble(score),
                    postId.getBytes());

                // 只保留最新1000条（防止收件箱无限增长）
                connection.zRemRangeByRank(key.getBytes(), 0, -1001);

                // 设置过期时间（7天）
                connection.expire(key.getBytes(), 7 * 24 * 3600);
            }
            return null;
        });

        log.info("推送进度: {}/{}", i + batchSize, followers.size());
    }
}

// 读取首页信息流
public List<Post> getHomeFeed(Long userId, int page, int pageSize) {
    String key = "feed:inbox:" + userId;
    int start = page * pageSize;
    int end = start + pageSize - 1;

    // 1. 从收件箱读取帖子ID（按时间倒序）
    Set<String> postIds = redis.zrevrange(key, start, end);

    if (postIds.isEmpty()) {
        return Collections.emptyList();
    }

    // 2. 批量查帖子详情
    List<Long> ids = postIds.stream()
        .map(Long::valueOf)
        .collect(Collectors.toList());

    return postDao.getByIds(ids);
}
```

**优点：**

```
读性能极好
→ 只读自己的收件箱
→ 一次Redis查询
→ 毫秒级响应
```

**缺点：**

```
写放大严重
→ 大V（1000万粉丝）发一条内容
→ 要写1000万次
→ 延迟高，存储大
→ Redis内存压力大
```

**适用场景：** 粉丝数量不多（<10万），对读性能要求极高，普通社交网络

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

→ 查A的关注列表：[B, C, D, ...]

→ 从每个人的发件箱拉取最新N条：
  ZREVRANGE feed:outbox:B 0 19
  ZREVRANGE feed:outbox:C 0 19
  ZREVRANGE feed:outbox:D 0 19
  ... (1000次Redis查询)

→ 内存中合并排序（归并排序）
→ 返回最新20条
```

**代码实现：**

```java
// 发布帖子（只写自己的发件箱）
public void publishPost(Long userId, Post post) {
    // 1. 保存到DB
    postDao.insert(post);

    // 2. 写自己的发件箱（1次操作）
    String outboxKey = "feed:outbox:" + userId;
    redis.zadd(outboxKey, post.getCreateTime().getTime(),
        String.valueOf(post.getId()));

    // 只保留最近1000条
    redis.zremrangeByRank(outboxKey, 0, -1001);
}

// 读取首页信息流（读扩散）
public List<Post> getHomeFeed(Long userId, int page, int pageSize) {
    // 1. 获取关注列表
    List<Long> followingIds = followDao.getFollowing(userId);

    if (followingIds.isEmpty()) {
        return Collections.emptyList();
    }

    // 2. 并行从每个人的发件箱拉取内容
    int fetchCount = pageSize * 3;

    List<CompletableFuture<List<String>>> futures = followingIds.stream()
        .map(followId -> CompletableFuture.supplyAsync(() -> {
            String outboxKey = "feed:outbox:" + followId;
            return new ArrayList<>(redis.zrevrange(outboxKey, 0, fetchCount - 1));
        }, executor))
        .collect(Collectors.toList());

    // 3. 等待所有结果
    List<String> allPostIds = new ArrayList<>();
    for (CompletableFuture<List<String>> future : futures) {
        try {
            allPostIds.addAll(future.get(200, TimeUnit.MILLISECONDS));
        } catch (TimeoutException e) {
            log.warn("发件箱查询超时，跳过");
        }
    }

    if (allPostIds.isEmpty()) {
        return Collections.emptyList();
    }

    // 4. 批量查帖子详情
    List<Post> allPosts = postDao.getByIds(
        allPostIds.stream().map(Long::valueOf).collect(Collectors.toList())
    );

    // 5. 按时间排序
    allPosts.sort(Comparator.comparing(Post::getCreateTime).reversed());

    // 6. 分页截取
    int start = page * pageSize;
    if (start >= allPosts.size()) {
        return Collections.emptyList();
    }
    return allPosts.subList(start, Math.min(start + pageSize, allPosts.size()));
}
```

**优点：**

```
写性能极好
→ 只写自己的发件箱
→ 1次操作
→ 大V发内容不会有压力
存储空间小
→ 每条内容只存一份
```

**缺点：**

```
读性能差
→ 关注1000人 → 1000次查询 → 归并排序
→ 关注越多越慢
→ 大量Redis查询，延迟高
```

**适用场景：** 关注数量少（<100人），写操作极频繁，内容量极大的场景

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

**写流程：**

```
普通用户B（1000粉丝）发帖：
→ 写自己的发件箱
→ 推送到所有1000个粉丝的收件箱（推模式）

大V C（1000万粉丝）发帖：
→ 只写自己的发件箱（不推送）
→ 等粉丝来拉取（拉模式）
```

**读流程：**

```
用户A刷新首页（关注了普通用户B、大V C、大V D）：

→ 从自己的收件箱读（已有普通用户推过来的内容）
  ZREVRANGE feed:inbox:A 0 99

→ 从关注的大V的发件箱拉（C、D）
  ZREVRANGE feed:outbox:C 0 19
  ZREVRANGE feed:outbox:D 0 19

→ 合并排序
→ 返回最新20条
```

**代码实现：**

```java
// 发布帖子（推拉结合）
public void publishPost(Long userId, Post post) {
    // 1. 保存到DB
    postDao.insert(post);

    // 2. 写自己的发件箱（所有人都写）
    writeToOutbox(userId, post);

    // 3. 判断是否是普通用户
    long followerCount = followDao.getFollowerCount(userId);

    if (followerCount <= BIG_V_THRESHOLD) {
        // 普通用户：推模式
        List<Long> followers = followDao.getFollowers(userId);
        asyncPushToFollowers(post, followers);
    }
    // 大V不推送，等粉丝来拉
}

// 读取首页信息流（推拉结合）
public List<Post> getHomeFeed(Long userId, int page, int pageSize) {
    // 1. 读自己的收件箱（来自普通用户的推送）
    List<PostEntry> inboxPosts = readFromInbox(userId, pageSize * 2);

    // 2. 拉取关注的大V的最新内容
    List<Long> bigVIds = getFollowingBigVs(userId);
    List<PostEntry> bigVPosts = pullFromBigVs(bigVIds, pageSize);

    // 3. 合并
    List<PostEntry> allPosts = new ArrayList<>();
    allPosts.addAll(inboxPosts);
    allPosts.addAll(bigVPosts);

    // 4. 去重（同一个帖子可能出现两次）
    allPosts = dedup(allPosts);

    // 5. 按时间排序
    allPosts.sort(Comparator.comparing(PostEntry::getTimestamp).reversed());

    // 6. 截取
    int start = page * pageSize;
    List<PostEntry> pageData = allPosts.subList(
        Math.min(start, allPosts.size()),
        Math.min(start + pageSize, allPosts.size())
    );

    // 7. 批量查帖子详情
    return enrichWithDetails(pageData);
}

private List<PostEntry> pullFromBigVs(List<Long> bigVIds, int pageSize) {
    if (bigVIds.isEmpty()) {
        return Collections.emptyList();
    }

    // 并行拉取（有超时控制）
    List<CompletableFuture<List<PostEntry>>> futures = bigVIds.stream()
        .map(bigVId -> CompletableFuture.supplyAsync(() -> {
            return readFromOutbox(bigVId, pageSize);
        }, executor).orTimeout(100, TimeUnit.MILLISECONDS)
         .exceptionally(e -> Collections.emptyList()))
        .collect(Collectors.toList());

    return futures.stream()
        .flatMap(f -> {
            try {
                return f.get().stream();
            } catch (Exception e) {
                return Stream.empty();
            }
        })
        .collect(Collectors.toList());
}

// 判断是否是大V
private List<Long> getFollowingBigVs(Long userId) {
    List<Long> following = followDao.getFollowing(userId);

    return following.stream()
        .filter(id -> {
            String countKey = "user:follower:count:" + id;
            String count = redis.get(countKey);
            return count != null && Long.parseLong(count) > BIG_V_THRESHOLD;
        })
        .collect(Collectors.toList());
}
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

### 何时用什么模式？

```
用户数 < 100万，且没有大V → 推模式
只有大V，粉丝少关注多 → 拉模式
大型社交平台，有普通用户也有大V → 推拉结合
```

---

## 三、Feed流的缓存策略

### 冷热数据分层

```
热数据（最近7天的内容）→ Redis
温数据（7天~1个月）→ MySQL（有索引）
冷数据（1个月以前）→ 归档存储（MySQL Archive / HBase）
```

**收件箱设计：**

```java
private static final int INBOX_MAX_SIZE = 1000;

private void addToInbox(Long userId, Long postId, long timestamp) {
    String key = "feed:inbox:" + userId;

    redis.zadd(key, timestamp, String.valueOf(postId));

    long size = redis.zcard(key);
    if (size > INBOX_MAX_SIZE) {
        redis.zremrangeByRank(key, 0, size - INBOX_MAX_SIZE - 1);
    }

    redis.expire(key, 7 * 24 * 3600);
}
```

---

### 用户长期不登录的处理

```java
public List<Post> getHomeFeed(Long userId, int page, int pageSize) {
    String inboxKey = "feed:inbox:" + userId;

    if (!redis.exists(inboxKey)) {
        // 收件箱为空（长期未登录）→ 重建
        rebuildInbox(userId);
    }

    return readFromInbox(userId, page, pageSize);
}

private void rebuildInbox(Long userId) {
    log.info("重建收件箱: userId={}", userId);

    List<Long> following = followDao.getFollowing(userId);
    String inboxKey = "feed:inbox:" + userId;

    redis.executePipelined((RedisCallback<?>) connection -> {
        for (Long followId : following) {
            List<Post> recentPosts = postDao.getRecentByUserId(followId, 20);
            for (Post post : recentPosts) {
                connection.zAdd(inboxKey.getBytes(),
                    post.getCreateTime().getTime(),
                    String.valueOf(post.getId()).getBytes());
            }
        }
        return null;
    });

    redis.zremrangeByRank(inboxKey, 0, -(INBOX_MAX_SIZE + 1));
    redis.expire(inboxKey, 7 * 24 * 3600);
}
```

---

### 关注/取关时的处理

```java
public void follow(Long userId, Long targetId) {
    followDao.insert(userId, targetId);
    redis.incr("user:following:count:" + userId);
    redis.incr("user:follower:count:" + targetId);

    long targetFollowerCount = getFollowerCount(targetId);

    if (targetFollowerCount <= BIG_V_THRESHOLD) {
        // 普通用户：拉取最近内容推入收件箱
        List<Post> recentPosts = postDao.getRecentByUserId(targetId, 50);
        String inboxKey = "feed:inbox:" + userId;
        for (Post post : recentPosts) {
            redis.zadd(inboxKey, post.getCreateTime().getTime(),
                String.valueOf(post.getId()));
        }
    }
}

public void unfollow(Long userId, Long targetId) {
    followDao.delete(userId, targetId);
    redis.decr("user:following:count:" + userId);
    redis.decr("user:follower:count:" + targetId);

    List<Long> postIds = postDao.getPostIdsByUserId(targetId);
    if (!postIds.isEmpty()) {
        String inboxKey = "feed:inbox:" + userId;
        String[] members = postIds.stream()
            .map(String::valueOf).toArray(String[]::new);
        redis.zrem(inboxKey, members);
    }
}
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

**代码实现：**

```java
// 收到新消息
public void onNewMessage(Long receiverId, String type, Long conversationId) {
    redis.incr("unread:" + receiverId + ":total");
    redis.incr("unread:" + receiverId + ":" + type);
    if (conversationId != null) {
        redis.incr("unread:" + receiverId + ":msg:" + conversationId);
    }
    redis.expire("unread:" + receiverId + ":total", 30 * 24 * 3600);
}

// 用户打开APP
public UnreadCount getUnreadCount(Long userId) {
    UnreadCount count = new UnreadCount();
    List<Object> results = redis.executePipelined((RedisCallback<?>) connection -> {
        connection.get(("unread:" + userId + ":total").getBytes());
        connection.get(("unread:" + userId + ":comment").getBytes());
        connection.get(("unread:" + userId + ":at").getBytes());
        connection.get(("unread:" + userId + ":like").getBytes());
        connection.get(("unread:" + userId + ":follow").getBytes());
        return null;
    });
    // 解析结果...
}

// 清零
public void markAsRead(Long userId, String type) {
    redis.set("unread:" + userId + ":" + type, "0");
    recalcTotal(userId);
}
```

---

### 会话未读数的精确设计

**IM系统中最复杂的场景。**

**关键概念：**

```
每个会话维护：
  - 最新消息序号（maxSeq）
  - 用户A的已读序号（readSeq_A）
  - 用户B的已读序号（readSeq_B）

A的未读数 = maxSeq - readSeq_A
B的未读数 = maxSeq - readSeq_B
```

```java
// 发送消息
@Transactional
public void sendMessage(Long senderId, Long receiverId, String content) {
    String conversationId = buildConversationId(senderId, receiverId);

    String seqKey = "conv:seq:" + conversationId;
    long seq = redis.incr(seqKey);

    Message msg = new Message();
    msg.setConversationId(conversationId);
    msg.setSenderId(senderId);
    msg.setContent(content);
    msg.setSeq(seq);
    messageDao.insert(msg);

    redis.set("conv:maxSeq:" + conversationId, String.valueOf(seq));
    redis.incr("unread:" + receiverId + ":msg:" + conversationId);
    redis.incr("unread:" + receiverId + ":total");
}

// 标记已读
public void markRead(Long userId, String conversationId) {
    String maxSeq = redis.get("conv:maxSeq:" + conversationId);
    if (maxSeq == null) return;

    redis.set("userRead:" + userId + ":" + conversationId, maxSeq);
    redis.set("unread:" + userId + ":msg:" + conversationId, "0");
    recalcTotalUnread(userId);
}
```

---

### 未读数的精度问题

**Redis宕机 → 未读数丢失 → 重启后全部变成0**

**解决方案：**

**方案1：定期持久化到DB**

```java
@Scheduled(fixedRate = 60000)
public void persistUnreadCount() {
    Set<String> keys = redis.keys("unread:*:total");
    for (String key : keys) {
        Long userId = extractUserId(key);
        String count = redis.get(key);
        if (count != null) {
            userUnreadDao.upsert(userId, Long.parseLong(count));
        }
    }
}
```

**方案2：允许近似**
- 点赞、评论等非关键场景：精度要求不高
- IM消息关键场景：需要可靠存储（MySQL），Redis只做加速

---

## 五、计数系统设计

### 常见计数场景

```
内容类：帖子点赞数、评论数、转发数、收藏数、阅读数
用户类：粉丝数、关注数、获赞总数
互动类：私信未读数、消息未读数
```

---

### Redis计数器

```java
public class CounterService {

    public long increment(String type, Long id) {
        return redis.incr(buildKey(type, id));
    }

    public long decrement(String type, Long id) {
        return redis.decr(buildKey(type, id));
    }

    public long getCount(String type, Long id) {
        String key = buildKey(type, id);
        String value = redis.get(key);
        if (value != null) {
            return Long.parseLong(value);
        }
        // 缓存未命中，从DB加载
        long count = loadFromDB(type, id);
        redis.set(key, String.valueOf(count));
        return count;
    }

    public Map<Long, Long> batchGetCount(String type, List<Long> ids) {
        List<Object> values = redis.executePipelined((RedisCallback<?>) connection -> {
            for (Long id : ids) {
                connection.get(buildKey(type, id).getBytes());
            }
            return null;
        });
        Map<Long, Long> result = new HashMap<>();
        for (int i = 0; i < ids.size(); i++) {
            Object value = values.get(i);
            result.put(ids.get(i), value == null ? 0L : Long.parseLong(value.toString()));
        }
        return result;
    }

    private String buildKey(String type, Long id) {
        return "count:" + type + ":" + id;
    }
}
```

---

### 点赞去重（用Set记录）

```java
public boolean like(Long userId, Long postId) {
    String likeKey = "post:liked:users:" + postId;
    String countKey = "count:like:" + postId;

    // Lua脚本原子操作
    String script =
        "if redis.call('sismember', KEYS[1], ARGV[1]) == 1 then " +
        "    return 0; " +
        "end; " +
        "redis.call('sadd', KEYS[1], ARGV[1]); " +
        "redis.call('incr', KEYS[2]); " +
        "return 1;";

    Long result = redis.execute(
        new DefaultRedisScript<>(script, Long.class),
        Arrays.asList(likeKey, countKey),
        String.valueOf(userId)
    );

    return result != null && result == 1L;
}

public boolean unlike(Long userId, Long postId) {
    String likeKey = "post:liked:users:" + postId;
    String countKey = "count:like:" + postId;

    String script =
        "if redis.call('sismember', KEYS[1], ARGV[1]) == 0 then " +
        "    return 0; " +
        "end; " +
        "redis.call('srem', KEYS[1], ARGV[1]); " +
        "redis.call('decr', KEYS[2]); " +
        "return 1;";

    Long result = redis.execute(
        new DefaultRedisScript<>(script, Long.class),
        Arrays.asList(likeKey, countKey),
        String.valueOf(userId)
    );

    return result != null && result == 1L;
}
```

---

### 阅读数防刷（滑动窗口）

```java
public void addView(Long userId, Long postId) {
    String viewKey = "post:viewed:" + postId + ":" + userId;

    Boolean isNew = redis.setnx(viewKey, "1");

    if (Boolean.TRUE.equals(isNew)) {
        redis.expire(viewKey, 3600);  // 1小时内不重复计
        redis.incr("count:view:" + postId);
        redis.sadd("counter:dirty", "count:view:" + postId);
    }
}
```

---

### 计数器的持久化

```java
// 每10秒同步到DB
@Scheduled(fixedRate = 10000)
public void syncCountsToDB() {
    Set<String> dirtyKeys = redis.smembers("counter:dirty");
    if (dirtyKeys.isEmpty()) return;

    List<CounterUpdate> updates = new ArrayList<>();
    for (String key : dirtyKeys) {
        String value = redis.get(key);
        if (value != null) {
            updates.add(parseKey(key, Long.parseLong(value)));
        }
    }

    counterDao.batchUpdate(updates);
    redis.srem("counter:dirty", dirtyKeys.toArray(new String[0]));
}
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

```java
public FeedPage getHomeFeed(Long userId, Long lastTimestamp, int pageSize) {
    String inboxKey = "feed:inbox:" + userId;

    Set<Tuple> tuples;

    if (lastTimestamp == null) {
        tuples = redis.zrevrangeWithScores(inboxKey, 0, pageSize - 1);
    } else {
        tuples = redis.zrevrangeByScoreWithScores(
            inboxKey,
            lastTimestamp - 1,
            0,
            0,
            pageSize
        );
    }

    if (tuples.isEmpty()) {
        return FeedPage.empty();
    }

    List<Long> postIds = tuples.stream()
        .map(t -> Long.valueOf(t.getElement()))
        .collect(Collectors.toList());

    long newLastTimestamp = (long) tuples.stream()
        .mapToDouble(Tuple::getScore)
        .min()
        .orElse(0);

    List<Post> posts = postDao.getByIds(postIds);
    return FeedPage.of(posts, newLastTimestamp, posts.size() == pageSize);
}
```

---

## 七、大V的写扩散控制

```java
public void onBigVPost(Long bigVId, Post post) {
    writeToOutbox(bigVId, post);  // 只写发件箱

    // 异步：只给"活跃粉丝"推送（不是所有粉丝）
    executor.submit(() -> {
        List<Long> activeFollowers = getActiveFollowers(bigVId);  // 7天内登录
        for (List<Long> batch : partition(activeFollowers, 1000)) {
            pushToFollowerBatch(post, batch);
            Thread.sleep(10);
        }
    });
}

// 缓存大V判断
public boolean isBigV(Long userId) {
    String key = "user:isBigV:" + userId;
    String cached = redis.get(key);
    if (cached != null) return "1".equals(cached);

    long followerCount = followerCountDao.getCount(userId);
    boolean bigV = followerCount >= BIG_V_THRESHOLD;
    redis.setex(key, 3600, bigV ? "1" : "0");
    return bigV;
}
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

**标准回答：**

```
推模式（写扩散）：
→ 发布时写入所有粉丝收件箱
→ 读时只读自己收件箱（快）
→ 大V写放大严重（1000万粉丝 = 1000万次写）

拉模式（读扩散）：
→ 发布时只写自己发件箱
→ 读时需要拉取所有关注者的内容（慢）
→ 写性能好

大厂选择：推拉结合
→ 普通用户：推模式
→ 大V：拉模式
→ 读时合并
```

---

### 2. 微博大V发微博，如何处理1000万粉丝的推送？

**标准回答：**

```
不推送给所有粉丝：
1. 大V只写自己的发件箱
2. 异步推送给"活跃粉丝"（最近登录的）
3. 不活跃的粉丝：等他们登录时从发件箱拉取
4. 分批推送，控制速率
```

---

### 3. 未读数系统怎么设计？

**标准回答：**

```
用Redis计数器：INCR unread:{userId}:{type}
用户打开APP：Pipeline批量读取所有类型的未读数
用户查看：SET unread:{userId}:{type} 0

持久化：定时任务同步到DB
Redis宕机后从DB恢复
关键场景（IM消息）以DB为准，Redis加速
```

---

### 4. 点赞数怎么防止重复计数？

**标准回答：**

```
用Redis Set记录点赞用户：
post:liked:users:{postId}

点赞时Lua脚本原子操作：
1. SISMEMBER检查是否已点赞
2. 未点赞 → SADD + INCR
3. 已点赞 → 返回失败
```

---

### 5. 用户长期不登录，再登录怎么处理？

**标准回答：**

```
收件箱过期（Redis TTL到期）
→ 用户登录时触发收件箱重建
→ 拉取所有关注者的最新内容（从DB）
→ 写入收件箱（最近N条）
→ 正常显示
```

---

### 6. 信息流翻页为什么用时间戳游标，不用LIMIT OFFSET？

**标准回答：**

```
LIMIT OFFSET：
→ 翻页期间新内容插入
→ 数据后移 → 重复或遗漏

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

设计社交平台信息流系统：普通用户（粉丝<10万）推模式，大V（粉丝>=10万）拉模式

要求：画出写流程、读流程，关注大V后历史内容如何处理

### 练习2：未读数

设计微博未读数系统：评论/@我的/新粉丝/私信

要求：Redis Key设计、写操作、读操作、清零、Redis宕机恢复

### 练习3：计数系统

设计帖子点赞系统：显示点赞数、去重、取消点赞、持久化

要求：数据结构、点赞Lua脚本、取消点赞、持久化方案

### 练习4：思考题

**为什么微博/抖音的信息流，有时候刷新会看到"重复的内容"？**

---

## 十二、下讲预告

**第 8 讲：分布式服务治理——注册发现、分布式锁、链路追踪**

会讲：服务注册发现原理、分布式锁三种实现、Redisson看门狗、链路追踪TraceID传递、配置中心、API网关。
