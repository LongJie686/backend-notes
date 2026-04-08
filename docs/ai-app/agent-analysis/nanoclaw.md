# NanoClaw -- 个人 AI 助手平台架构分析

> 多渠道消息 -> SQLite 存储 -> 轮询循环 -> Docker 容器 (Claude Agent) -> 回复用户
> 项目地址: E:\Project\Astudy\nanoclaw-analysis

---

## 核心结论

1. **单进程架构** -- 整个系统运行在一个 Python 进程中，没有微服务
2. **文件系统 IPC** -- 容器通过文件系统与主进程通信，避免网络复杂度
3. **插件式渠道** -- WhatsApp/Telegram/Slack/Discord/Gmail 通过注册表自动发现
4. **容器级安全隔离** -- 不同组有不同的文件系统挂载权限
5. **信号量并发控制** -- 全局最多 5 个容器，每组最多 1 个活跃
6. **游标模式容错** -- 出错回滚游标，指数退避重试

---

## 一、项目结构

```
nanoclaw_python/
  nanoclaw/
    __init__.py              -- 数据模型 (dataclass)
    orchestrator.py          -- 主编排器 (核心流程)
    config.py                -- 配置管理
    database.py              -- SQLite 操作
    container_runner.py      -- 容器运行器
    container_runtime.py     -- 容器运行时抽象
    group_queue.py           -- 组队列并发控制
    ipc.py                   -- IPC 监听器
    router.py                -- 消息路由
    task_scheduler.py        -- 定时任务调度
    mount_security.py        -- 挂载安全校验
    sender_allowlist.py      -- 发送者白名单
    remote_control.py        -- 远程控制
    session_cleanup.py       -- 会话清理
    channels/
      registry.py            -- 渠道注册表
      base.py                -- 渠道抽象基类
      console.py             -- 控制台渠道实现
    main.py                  -- 程序入口
  tests/                     -- 测试目录
```

---

## 二、核心数据流

```
1. 消息接收
   WhatsApp/Telegram/... -> Channel.on_message() -> store_message() -> SQLite

2. 消息轮询
   startMessageLoop() -> get_new_messages() -> 按组分组 -> 触发词检查

3. Agent 调用
   format_messages() -> GroupQueue -> run_container_agent() -> Docker spawn

4. 响应返回
   容器流式输出 -> parse_streaming_output() -> channel.send_message()
```

---

## 三、数据模型

### 核心实体

```python
@dataclass(frozen=True)
class RegisteredGroup:
    name: str                # 组名称
    folder: str              # 文件系统文件夹名
    trigger: str             # 触发词 (如 "@Andy")
    container_config: Optional[ContainerConfig]  # 容器配置
    requires_trigger: bool = True  # 是否需要触发词
    is_main: bool = False    # 是否为主控组

@dataclass
class NewMessage:
    id: str
    chat_jid: str            # 聊天组 ID
    sender: str              # 发送者 ID
    sender_name: str         # 发送者名称
    content: str             # 消息内容
    timestamp: str           # 时间戳
    is_from_me: bool = False
```

> 使用 `frozen=True` dataclass 保证数据不可变性

---

## 四、单进程架构设计

### 为什么不用微服务？

- 个人助手，流量有限
- 单进程足够处理所有渠道
- SQLite 够用，不需要分布式数据库
- 部署简单，一个 Python 进程 + Docker

### 文件系统 IPC

容器与主进程通过文件系统通信：

```
/data/ipc/{group}/
  input.json     -- 主进程写入，容器读取
  output.json    -- 容器写入，主进程轮询读取
```

**原子写入机制：**

```python
# 先写临时文件，再 rename 保证原子性
tmp_file = f"{file}.tmp"
with open(tmp_file, 'w') as f:
    json.dump(data, f)
os.rename(tmp_file, file)  # 原子操作
```

---

## 五、安全隔离模型

### 挂载策略

| 组类型 | 挂载权限 |
|--------|---------|
| 主控组 | 项目根目录只读 + store 读写 + .env 遮蔽 |
| 非主控组 | 仅自己的组目录读写 + 全局共享只读 |

### 安全校验

```python
# 黑名单模式匹配
BLOCKED_PATTERNS = [".ssh", ".gnupg", ".aws", ...]

# 路径白名单验证
def validate_mount(source, dest, readonly):
    if any(p in source for p in BLOCKED_PATTERNS):
        raise SecurityError(f"Blocked mount: {source}")
    if not is_main_group and not readonly:
        raise SecurityError("Non-main group must use readonly mounts")
```

---

## 六、并发控制设计

### GroupQueue 信号量模式

```
全局并发上限: 5 个容器
每组并发上限: 1 个活跃容器
任务优先级: task > message
```

### 指数退避重试

```
失败 -> 5s -> 10s -> 20s -> 40s -> 80s -> 放弃
```

### 游标模式

```python
# 全局游标 (已见消息)
_last_timestamp = "2024-01-01T00:00:00Z"

# 组级游标 (已处理消息)
_last_agent_timestamp[chat_jid] = "2024-01-01T00:00:00Z"

# 出错回滚
if output == "error":
    _last_agent_timestamp[chat_jid] = previous_cursor
```

---

## 七、流式输出处理

容器输出使用标记协议实现实时回复：

```
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"你好！"}
---NANOCLAW_OUTPUT_END---
```

主进程边接收边解析，不需要等容器执行完毕再回复。

---

## 八、插件式渠道注册

```python
# 注册渠道
def register_channel(name: str, factory: ChannelFactory) -> None:
    _channel_registry[name] = factory

# 自动发现所有渠道
for name in get_registered_channel_names():
    factory = get_channel_factory(name)
    channel = factory(channel_opts)
```

### 渠道抽象基类

```python
class Channel(ABC):
    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def send_message(self, chat_jid, text) -> None: ...

    @abstractmethod
    async def on_message(self, msg: NewMessage) -> None: ...
```

> 核心代码不依赖具体渠道实现，新渠道只需实现接口并注册

---

## 九、容错与恢复

| 场景 | 处理方式 |
|------|---------|
| Agent 执行出错 | 游标回滚 + 指数退避重试 |
| 容器超时 | 记录错误，返回 error 状态 |
| 会话过期 | 自动清除，下次重新创建 |
| 启动崩溃 | 恢复未处理消息，重新入队 |
| 输出发送后出错 | 不回滚 (避免重复发送) |

---

## 十、架构亮点总结

| 亮点 | 设计 |
|------|------|
| 极致精简 | 单进程 + 3 个核心依赖 |
| 安全隔离 | 容器级 + 文件系统级访问控制 |
| 高并发 | 信号量 + 任务优先级 + 空闲复用 |
| 流式响应 | 标记协议边处理边返回 |
| 容错恢复 | 游标回滚 + 会话过期 + 启动恢复 |
| 插件化 | 渠道自动发现，核心不依赖具体实现 |
