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

**适用场景：**
```
粉丝数量不多（<10万）
对读性能要求极高
普通社交网络
```

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
    int fetchCount = pageSize * 3;  // 多拉一些，合并后再截取

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
            // 超时跳过，避免一个慢查询拖垮整体
            log.warn("发件箱查询超时，跳过");
        }
    }

    if (allPostIds.isEmpty()) {
        return Collections.emptyList();
    }

    // 4. 批量查帖子详情（带时间戳）
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

**适用场景：**
```
关注数量少（<100人）
写操作极频繁
内容量极大的场景
```

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

**什么叫"大V"？**
```
粉丝数 > 阈值（比如：10万）的用户
```

**详细流程：**

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
        }, executor).orTimeout(100, TimeUnit.MILLISECONDS)  // 100ms超时
         .exceptionally(e -> Collections.emptyList()))      // 超时返回空
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
            // 从Redis缓存读取粉丝数（避免查DB）
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
// 收件箱只保留最近N条（防止无限增长）
private static final int INBOX_MAX_SIZE = 1000;

private void addToInbox(Long userId, Long postId, long timestamp) {
    String key = "feed:inbox:" + userId;

    redis.zadd(key, timestamp, String.valueOf(postId));

    // 超出限制，删除最旧的
    long size = redis.zcard(key);
    if (size > INBOX_MAX_SIZE) {
        redis.zremrangeByRank(key, 0, size - INBOX_MAX_SIZE - 1);
    }

    // 设置过期时间
    redis.expire(key, 7 * 24 * 3600);
}
```

---

### 用户长期不登录的处理

**问题：**
```
用户1个月没登录
→ 收件箱的推送早就过期了
→ 用户再次登录，收件箱是空的
→ 首页没有内容
```

**解决方案：**

```java
public List<Post> getHomeFeed(Long userId, int page, int pageSize) {
    String inboxKey = "feed:inbox:" + userId;

    // 检查收件箱是否存在
    if (!redis.exists(inboxKey)) {
        // 收件箱为空（长期未登录）
        // 重建收件箱（从DB拉取最新内容）
        rebuildInbox(userId);
    }

    // 正常读取
    return readFromInbox(userId, page, pageSize);
}

private void rebuildInbox(Long userId) {
    log.info("重建收件箱: userId={}", userId);

    // 获取关注列表
    List<Long> following = followDao.getFollowing(userId);

    // 从每个关注者的发件箱拉取最新内容
    String inboxKey = "feed:inbox:" + userId;

    redis.executePipelined((RedisCallback<?>) connection -> {
        for (Long followId : following) {
            // 从DB查最新的帖子
            List<Post> recentPosts = postDao.getRecentByUserId(followId, 20);
            for (Post post : recentPosts) {
                connection.zAdd(
                    inboxKey.getBytes(),
                    post.getCreateTime().getTime(),
                    String.valueOf(post.getId()).getBytes()
                );
            }
        }
        return null;
    });

    // 截断到最大条数
    redis.zremrangeByRank(inboxKey, 0, -(INBOX_MAX_SIZE + 1));
    redis.expire(inboxKey, 7 * 24 * 3600);
}
```

---

### 关注/取关时的处理

**关注新用户时：**
```java
public void follow(Long userId, Long targetId) {
    // 1. 保存关注关系
    followDao.insert(userId, targetId);

    // 2. 更新关注数/粉丝数
    redis.incr("user:following:count:" + userId);
    redis.incr("user:follower:count:" + targetId);

    // 3. 如果目标是普通用户，把他的历史内容推到收件箱
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
    // 大V：读取时从发件箱实时拉取
}
```

**取关时：**
```java
public void unfollow(Long userId, Long targetId) {
    // 1. 删除关注关系
    followDao.delete(userId, targetId);

    // 2. 更新计数
    redis.decr("user:following:count:" + userId);
    redis.decr("user:follower:count:" + targetId);

    // 3. 从收件箱清除该用户的内容
    // 获取该用户发过的帖子ID列表
    List<Long> postIds = postDao.getPostIdsByUserId(targetId);

    if (!postIds.isEmpty()) {
        String inboxKey = "feed:inbox:" + userId;
        // 从收件箱中移除
        String[] members = postIds.stream()
            .map(String::valueOf)
            .toArray(String[]::new);
        redis.zrem(inboxKey, members);
    }
}
```

---

## 四、未读数系统设计

### 什么是未读数？

```
微信：消息未读数（右上角红点）
微博：@我、评论、点赞、新关注的未读数
抖音：私信未读数
```

**未读数的分类：**
```
1. 会话未读数：某个聊天会话里有多少条未读消息
2. 总未读数：所有会话的未读数之和
3. 功能模块未读数：@我、评论、点赞各自的未读数
```

---

### 方案一：数据库计数（简单但慢）

```sql
-- 查询未读数
SELECT COUNT(*)
FROM message
WHERE receiver_id = #{userId}
AND is_read = 0;
```

**问题：**
```
用户每次打开APP都要COUNT(*)
→ 全表扫描（即使有索引，高并发下也慢）
→ 数据库压力大
→ QPS高时扛不住
```

---

### 方案二：Redis计数器

**最常用的方案。**

**设计：**
```
Key: unread:{userId}:{type}
Value: 未读数（整数）

type类型：
  total    → 总未读数
  comment  → 评论未读
  at       → @我的未读
  like     → 点赞未读
  follow   → 新关注未读
  msg:{conversationId} → 某个会话的未读数
```

**写操作（收到新消息时）：**
```java
public void onNewMessage(Long receiverId, String type, Long conversationId) {
    // 1. 消息总未读数+1
    redis.incr("unread:" + receiverId + ":total");

    // 2. 特定类型未读数+1
    redis.incr("unread:" + receiverId + ":" + type);

    // 3. 如果是会话消息，会话未读数+1
    if (conversationId != null) {
        redis.incr("unread:" + receiverId + ":msg:" + conversationId);
    }

    // 设置过期时间（防止僵尸数据）
    redis.expire("unread:" + receiverId + ":total", 30 * 24 * 3600);
}
```

**读操作（用户打开APP）：**
```java
public UnreadCount getUnreadCount(Long userId) {
    UnreadCount count = new UnreadCount();

    // 批量读取（Pipeline减少网络往返）
    List<Object> results = redis.executePipelined((RedisCallback<?>) connection -> {
        connection.get(("unread:" + userId + ":total").getBytes());
        connection.get(("unread:" + userId + ":comment").getBytes());
        connection.get(("unread:" + userId + ":at").getBytes());
        connection.get(("unread:" + userId + ":like").getBytes());
        connection.get(("unread:" + userId + ":follow").getBytes());
        return null;
    });

    count.setTotal(parseCount(results.get(0)));
    count.setComment(parseCount(results.get(1)));
    count.setAt(parseCount(results.get(2)));
    count.setLike(parseCount(results.get(3)));
    count.setFollow(parseCount(results.get(4)));

    return count;
}

// 清零（用户点进去看了）
public void markAsRead(Long userId, String type) {
    redis.set("unread:" + userId + ":" + type, "0");

    // 重新计算总未读数
    recalcTotal(userId);
}
```

---

### 方案三：会话未读数的精确设计

**IM系统中，会话未读数是最复杂的。**

**关键概念：**
```
用户A和用户B的会话
A看到的：B发的消息中，A没读过的
B看到的：A发的消息中，B没读过的
```

**设计：**
```
每个会话维护：
  - 最新消息序号（maxSeq）
  - 用户A的已读序号（readSeq_A）
  - 用户B的已读序号（readSeq_B）

A的未读数 = maxSeq - readSeq_A
B的未读数 = maxSeq - readSeq_B
```

**代码实现：**
```sql
-- 消息表
CREATE TABLE message (
    id BIGINT NOT NULL,
    conversation_id VARCHAR(64) NOT NULL,
    sender_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    seq BIGINT NOT NULL,  -- 会话内的消息序号（递增）
    create_time DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_conv_seq (conversation_id, seq)
);

-- 会话表
CREATE TABLE conversation (
    id VARCHAR(64) NOT NULL,  -- conversationId = min(userId1, userId2) + "_" + max(...)
    max_seq BIGINT NOT NULL DEFAULT 0,  -- 最新消息序号
    PRIMARY KEY (id)
);

-- 用户已读记录
CREATE TABLE user_read (
    user_id BIGINT NOT NULL,
    conversation_id VARCHAR(64) NOT NULL,
    read_seq BIGINT NOT NULL DEFAULT 0,  -- 已读到的序号
    PRIMARY KEY (user_id, conversation_id)
);
```

```java
// 发送消息
@Transactional
public void sendMessage(Long senderId, Long receiverId, String content) {
    String conversationId = buildConversationId(senderId, receiverId);

    // 1. 获取并递增序号（原子操作）
    String seqKey = "conv:seq:" + conversationId;
    long seq = redis.incr(seqKey);

    // 2. 保存消息
    Message msg = new Message();
    msg.setConversationId(conversationId);
    msg.setSenderId(senderId);
    msg.setContent(content);
    msg.setSeq(seq);
    messageDao.insert(msg);

    // 3. 更新会话最大序号
    redis.set("conv:maxSeq:" + conversationId, String.valueOf(seq));

    // 4. 接收方未读数+1
    redis.incr("unread:" + receiverId + ":msg:" + conversationId);
    redis.incr("unread:" + receiverId + ":total");
}

// 标记已读
public void markRead(Long userId, String conversationId) {
    String maxSeqKey = "conv:maxSeq:" + conversationId;
    String maxSeq = redis.get(maxSeqKey);

    if (maxSeq == null) return;

    // 更新已读序号
    String readSeqKey = "userRead:" + userId + ":" + conversationId;
    redis.set(readSeqKey, maxSeq);

    // 清零该会话的未读数
    redis.set("unread:" + userId + ":msg:" + conversationId, "0");

    // 重新计算总未读数
    recalcTotalUnread(userId);
}

// 获取未读数
public long getConversationUnread(Long userId, String conversationId) {
    String unreadKey = "unread:" + userId + ":msg:" + conversationId;
    String unread = redis.get(unreadKey);
    return unread == null ? 0 : Long.parseLong(unread);
}
```

---

### 未读数的精度问题

**问题：**
```
Redis不是100%可靠的
→ Redis宕机 → 未读数数据丢失
→ 重启后全部变成0
→ 用户看不到未读提示
```

**解决方案：**

**方案1：定期持久化**
```java
// 定时任务，每分钟把Redis的未读数同步到DB
@Scheduled(fixedRate = 60000)
public void persistUnreadCount() {
    // 扫描所有用户的未读数Key
    Set<String> keys = redis.keys("unread:*:total");

    for (String key : keys) {
        Long userId = extractUserId(key);
        String count = redis.get(key);

        if (count != null) {
            userUnreadDao.upsert(userId, Long.parseLong(count));
        }
    }
}

// Redis宕机恢复后，从DB加载
public long getUnreadCount(Long userId) {
    String key = "unread:" + userId + ":total";
    String cached = redis.get(key);

    if (cached != null) {
        return Long.parseLong(cached);
    }

    // Redis没有，从DB读
    Long dbCount = userUnreadDao.getCount(userId);
    if (dbCount != null) {
        redis.set(key, String.valueOf(dbCount));
        return dbCount;
    }

    return 0;
}
```

**方案2：允许近似（用户可以接受）**
```
对于点赞、评论这种非关键场景：
→ 精度要求不高
→ 丢几个未读数无所谓
→ Redis+定期DB同步就够了

对于IM消息这种关键场景：
→ 精度要求高
→ 需要可靠存储（MySQL）
→ Redis只做加速，DB是真相
```

---

## 五、计数系统设计

### 常见计数场景

```
内容类：帖子点赞数、评论数、转发数、收藏数、阅读数
用户类：粉丝数、关注数、获赞总数
互动类：私信未读数、消息未读数
```

---

### 方案一：数据库直接计数（不推荐）

```sql
-- 每次点赞更新帖子表
UPDATE post SET like_count = like_count + 1 WHERE id = #{postId};

-- 查询
SELECT like_count FROM post WHERE id = #{postId};
```

**问题：**
```
高并发点赞 → 频繁UPDATE → 行锁竞争 → 性能差
```

---

### 方案二：Redis计数器

**核心设计：**

```java
// Redis Key设计
// post:like:{postId}     → 帖子点赞数
// post:comment:{postId}  → 帖子评论数
// post:view:{postId}     → 帖子阅读数
// user:follower:{userId} → 用户粉丝数
// user:following:{userId}→ 用户关注数

public class CounterService {

    // 增加计数
    public long increment(String type, Long id) {
        String key = buildKey(type, id);
        return redis.incr(key);
    }

    // 减少计数
    public long decrement(String type, Long id) {
        String key = buildKey(type, id);
        return redis.decr(key);
    }

    // 获取计数
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

    // 批量获取计数（用于列表页）
    public Map<Long, Long> batchGetCount(String type, List<Long> ids) {
        // Pipeline批量查询
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

### 计数器的持久化（防止数据丢失）

**异步批量落库：**

```java
// 定时任务，每10秒把Redis计数批量同步到DB
@Scheduled(fixedRate = 10000)
public void syncCountsToDB() {
    // 找出有变化的计数（通过dirty标记）
    Set<String> dirtyKeys = redis.smembers("counter:dirty");

    if (dirtyKeys.isEmpty()) return;

    List<CounterUpdate> updates = new ArrayList<>();

    for (String key : dirtyKeys) {
        String value = redis.get(key);
        if (value != null) {
            CounterUpdate update = parseKey(key, Long.parseLong(value));
            updates.add(update);
        }
    }

    // 批量更新DB
    counterDao.batchUpdate(updates);

    // 清除dirty标记
    redis.srem("counter:dirty", dirtyKeys.toArray(new String[0]));

    log.info("同步计数到DB: {}条", updates.size());
}

// 计数变化时，打上dirty标记
public long increment(String type, Long id) {
    String key = buildKey(type, id);
    long newValue = redis.incr(key);

    // 标记需要同步
    redis.sadd("counter:dirty", key);

    return newValue;
}
```

---

### 防刷：确保计数准确

**问题：**
```
用户可以不停点赞、取消点赞
→ 刷阅读数
→ 刷点赞数
→ 计数失去意义
```

**解决方案：**

**点赞去重（用Set记录）：**
```java
public boolean like(Long userId, Long postId) {
    String likeKey = "post:liked:users:" + postId;  // 记录点过赞的用户
    String countKey = "count:like:" + postId;

    // Lua脚本原子操作：判断是否已点赞 + 点赞
    String script =
        "if redis.call('sismember', KEYS[1], ARGV[1]) == 1 then " +
        "    return 0; " +  // 已点赞
        "end; " +
        "redis.call('sadd', KEYS[1], ARGV[1]); " +
        "redis.call('incr', KEYS[2]); " +
        "return 1;";  // 点赞成功

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
        "    return 0; " +  // 未点赞
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

**阅读数防刷（滑动窗口）：**
```java
public void addView(Long userId, Long postId) {
    // 用滑动窗口判断：1小时内同一用户对同一帖子只计一次阅读
    String viewKey = "post:viewed:" + postId + ":" + userId;

    // setnx：如果不存在才创建
    Boolean isNew = redis.setnx(viewKey, "1");

    if (Boolean.TRUE.equals(isNew)) {
        // 新的阅读，计数
        redis.expire(viewKey, 3600);  // 1小时内不重复计
        redis.incr("count:view:" + postId);
        redis.sadd("counter:dirty", "count:view:" + postId);
    }
    // 否则：1小时内重复阅读，不计数
}
```

---

### 大数值计数的精度问题

**问题：**
```
百万量级的帖子都有计数
→ Redis内存占用大
→ 内存不够怎么办？
```

**解决方案：**

**方案1：只缓存热点数据**
```java
public long getCount(String type, Long id) {
    String key = buildKey(type, id);
    String cached = redis.get(key);

    if (cached != null) {
        return Long.parseLong(cached);
    }

    // 从DB读（冷数据）
    return loadFromDB(type, id);
    // 不写回Redis（避免冷数据占内存）
}
```

**方案2：计数数据压缩存储**
```java
// 使用Redis Hash把多个计数合并存储（节省Key开销）
// HSET post:counts:{postId} like 100 comment 50 view 10000

public Map<String, Long> getPostCounts(Long postId) {
    String key = "post:counts:" + postId;
    Map<Object, Object> raw = redis.hGetAll(key);

    Map<String, Long> counts = new HashMap<>();
    raw.forEach((k, v) -> counts.put(k.toString(), Long.parseLong(v.toString())));
    return counts;
}

public void incrementCount(Long postId, String type) {
    redis.hIncrBy("post:counts:" + postId, type, 1);
}
```

---

## 六、信息流的翻页设计

### 问题：时间线翻页

**场景：**
```
用户刷到第10页
→ 在这期间，有人发了新内容
→ 数据往前移了
→ 翻下一页时，内容重复或跳过
```

**图示：**
```
第1页时（10:00）：
  [帖子E: 09:50]
  [帖子D: 09:40]
  [帖子C: 09:30]
  ...

第2页时（10:05）：
  同时有新帖子F(10:03)、G(10:01)加入

  如果用LIMIT OFFSET：
  LIMIT 10 OFFSET 10
  → 由于新内容插入，原来第11条变成第13条
  → 出现重复或遗漏
```

---

### 解决方案：时间戳游标

```java
// 第一页（没有游标）
public FeedPage getHomeFeed(Long userId, Long lastTimestamp, int pageSize) {
    String inboxKey = "feed:inbox:" + userId;

    Set<Tuple> tuples;

    if (lastTimestamp == null) {
        // 第一页：从最新开始
        tuples = redis.zrevrangeWithScores(inboxKey, 0, pageSize - 1);
    } else {
        // 翻页：从上次的时间戳开始（不包含）
        tuples = redis.zrevrangeByScoreWithScores(
            inboxKey,
            lastTimestamp - 1,  // 不包含上次最后一条的时间戳
            0,
            0,
            pageSize
        );
    }

    if (tuples.isEmpty()) {
        return FeedPage.empty();
    }

    // 提取帖子ID
    List<Long> postIds = tuples.stream()
        .map(t -> Long.valueOf(t.getElement()))
        .collect(Collectors.toList());

    // 获取最小时间戳（下次翻页的游标）
    long newLastTimestamp = (long) tuples.stream()
        .mapToDouble(Tuple::getScore)
        .min()
        .orElse(0);

    // 查帖子详情
    List<Post> posts = postDao.getByIds(postIds);

    return FeedPage.of(posts, newLastTimestamp, posts.size() == pageSize);
}
```

**前端调用：**
```javascript
let lastTimestamp = null;

async function loadMore() {
    const params = lastTimestamp ? `?lastTimestamp=${lastTimestamp}` : '';
    const response = await fetch(`/api/feed${params}`);
    const page = await response.json();

    appendPosts(page.posts);
    lastTimestamp = page.lastTimestamp;

    if (!page.hasMore) {
        hideLoadMoreButton();
    }
}
```

---

## 七、大V普通用户关系的特殊处理

### 大V发内容时的写扩散控制

```java
// 大V发内容后，异步推送给活跃粉丝
public void onBigVPost(Long bigVId, Post post) {
    // 大V只写发件箱
    writeToOutbox(bigVId, post);

    // 异步：给"活跃粉丝"推送（不是所有粉丝）
    executor.submit(() -> {
        // 活跃粉丝 = 最近7天有登录的粉丝
        List<Long> activeFollowers = getActiveFollowers(bigVId);

        // 分批推送，避免一次性太多
        for (List<Long> batch : partition(activeFollowers, 1000)) {
            pushToFollowerBatch(post, batch);
            Thread.sleep(10);  // 控制速率
        }
    });
}

private List<Long> getActiveFollowers(Long bigVId) {
    // 从关注表+活跃用户表联合查询
    return followerDao.getActiveFollowers(bigVId, 7);  // 7天内活跃
}
```

---

### 读取时的大V识别

```java
// 缓存大V列表（避免每次查DB）
private static final long BIG_V_THRESHOLD = 100000L;

public boolean isBigV(Long userId) {
    String key = "user:isBigV:" + userId;
    String cached = redis.get(key);

    if (cached != null) {
        return "1".equals(cached);
    }

    long followerCount = followerCountDao.getCount(userId);
    boolean bigV = followerCount >= BIG_V_THRESHOLD;

    // 缓存1小时（粉丝数变化不频繁）
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
不推送给所有粉丝，而是：

1. 大V只写自己的发件箱
2. 异步推送给"活跃粉丝"（最近登录的）
3. 不活跃的粉丝：等他们登录时从发件箱拉取
4. 分批推送，控制速率，避免对Redis造成压力

这就是推拉结合的核心思想。
```

---

### 3. 未读数系统怎么设计？

**标准回答：**

```
用Redis计数器：
INCR unread:{userId}:{type}  → 收到新消息时

用户打开APP：Pipeline批量读取所有类型的未读数

用户查看：SET unread:{userId}:{type} 0

持久化：
→ 定时任务同步到DB
→ Redis宕机后从DB恢复
→ 关键场景（IM消息）以DB为准，Redis加速
```

---

### 4. 点赞数怎么防止重复计数？

**标准回答：**

```
用Redis Set记录点赞用户：
post:liked:users:{postId} → 点过赞的用户集合

点赞时Lua脚本原子操作：
1. SISMEMBER 检查是否已点赞
2. 未点赞 → SADD + INCR计数
3. 已点赞 → 返回失败

取消点赞：
1. SISMEMBER 检查是否已点赞
2. 已点赞 → SREM + DECR计数
```

---

### 5. 用户长期不登录，再次登录信息流怎么处理？

**标准回答：**

```
收件箱过期（Redis TTL到期）
→ 用户登录时收件箱为空
→ 触发收件箱重建：
  1. 拉取所有关注者的最新内容（从DB）
  2. 写入收件箱（最近N条）
→ 正常显示信息流

注意：重建可以异步进行，先返回空页面，重建完成后刷新
```

---

### 6. 信息流翻页为什么要用时间戳游标，而不是LIMIT OFFSET？

**标准回答：**

```
LIMIT OFFSET的问题：
→ 翻页期间，新内容插入
→ 数据整体后移
→ 出现重复或遗漏

时间戳游标：
→ 每次以上次最后一条的时间戳为起点
→ ZREVRANGEBYSCORE score < lastTimestamp
→ 不受新内容影响
→ 翻页内容连续不重复
```

---

## 十、这一讲你必须记住的核心结论

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

设计一个社交平台的信息流系统：
- 普通用户（粉丝 < 10万）：推模式
- 大V（粉丝 >= 10万）：拉模式

要求：
1. 画出写流程（普通用户发帖、大V发帖）
2. 画出读流程（用户刷首页）
3. 关注一个大V后，历史内容如何处理？

---

### 练习2：未读数

设计一个微博的未读数系统：
- 评论未读
- @我的未读
- 新粉丝未读
- 私信未读

要求：
1. Redis Key设计
2. 写操作（收到新评论时）
3. 读操作（用户打开APP）
4. 清零操作（用户点进评论列表）
5. Redis宕机后如何恢复？

---

### 练习3：计数系统

设计帖子的点赞系统：
- 点赞数显示
- 防止重复点赞
- 支持取消点赞
- 点赞数持久化

要求：
1. 数据结构设计（Redis Key）
2. 点赞代码（Lua脚本）
3. 取消点赞代码
4. 持久化方案

---

### 练习4：思考题

**为什么微博/抖音的信息流，有时候刷新会看到"重复的内容"？**

从系统设计角度分析原因。

---

## 十二、下一讲预告

**第 8 讲：分布式服务治理——注册发现、分布式锁、链路追踪**

会讲：
- 服务注册发现原理（Nacos vs Eureka vs etcd）
- 分布式锁三种实现（Redis / ZooKeeper / 数据库）
- 分布式锁的坑（死锁、误删、续期）
- Redisson看门狗机制
- 分布式链路追踪原理（TraceID如何跨服务传递）
- 配置中心的动态配置
- API网关的核心功能
- 面试高频题解析
