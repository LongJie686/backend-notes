# MCP 协议（Model Context Protocol）

Anthropic 提出的开放协议，让 LLM 通过标准化接口调用外部工具和数据源。

## 什么是 MCP

MCP（Model Context Protocol）定义了 LLM 与外部世界交互的统一标准。类比 USB-C 接口 -- 任何设备都可以通过同一协议连接，MCP 让任何工具都能通过同一协议被 LLM 调用。

核心价值：
- **统一接口**：一次开发，所有支持 MCP 的 LLM 都能用
- **双向通信**：支持请求-响应和流式推送
- **安全可控**：工具声明权限，用户审批执行

## 核心架构

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│   Host    │     │    Client     │     │    Server    │
│ (Claude)  │────>│  (MCP Client) │────>│ (Tool Server)│
│           │<────│               │<────│              │
└──────────┘     └──────────────┘     └──────────────┘
                  JSON-RPC 2.0 通信
```

- **Host**：LLM 应用（如 Claude Desktop、Claude Code）
- **Client**：协议客户端，维护与 Server 的连接
- **Server**：工具服务端，暴露具体能力（文件操作、数据库查询等）

通信方式：stdio（本地进程）或 SSE（远程服务），消息格式为 JSON-RPC 2.0。

## 工具定义格式

每个 MCP Server 通过 `tools/list` 暴露可用工具：

```json
{
  "name": "query_database",
  "description": "执行 SQL 查询并返回结果",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sql": {
        "type": "string",
        "description": "要执行的 SQL 语句"
      },
      "database": {
        "type": "string",
        "enum": ["postgres", "mysql"],
        "description": "目标数据库类型"
      }
    },
    "required": ["sql"]
  }
}
```

调用时通过 `tools/call` 发送参数：

```json
{
  "method": "tools/call",
  "params": {
    "name": "query_database",
    "arguments": {
      "sql": "SELECT COUNT(*) FROM users",
      "database": "postgres"
    }
  }
}
```

## Skills 技能系统

Skills 是基于 MCP 的高层封装，用 `SKILL.md` 定义工具使用规范：

```markdown
# Skill: MySQL 查询助手

## 触发条件
当用户询问数据库相关问题时激活

## 工具调用规则
1. 先调用 describe_table 了解表结构
2. 生成的 SQL 必须通过 validate_sql 校验
3. 查询结果超过 1000 行时自动分页

## 约束
- 只允许 SELECT 语句
- 超时时间 30 秒
```

Skills 支持**自动发现**（扫描目录结构）和**热加载**（运行时更新无需重启）。

## 与 Function Calling 的区别

| 维度 | MCP | Function Calling |
|------|-----|-----------------|
| 本质 | 协议标准，定义通信方式 | 模型能力，结构化输出 |
| 作用层 | 应用层，连接工具 | 模型层，生成参数 |
| 工具来源 | 任意 MCP Server | 开发者硬编码 |
| 跨模型 | 支持，协议无关 | 绑定具体模型 |
| 扩展性 | 插件化，动态注册 | 需修改代码 |

简单理解：Function Calling 是 LLM "能调用函数"的能力，MCP 是"怎么调用、调用谁"的协议。

## 实战：用 Claude Code 调用 MCP 工具

在 Claude Code 的 `settings.json` 中配置 MCP Server：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "/path/to/db.sqlite"]
    }
  }
}
```

Python 编写自定义 MCP Server：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-tools")

@mcp.tool()
def search_docs(query: str) -> str:
    """搜索项目文档"""
    # 实现搜索逻辑
    return f"找到 3 条与 '{query}' 相关的结果"

@mcp.tool()
def run_sql(sql: str) -> list[dict]:
    """执行 SQL 查询"""
    # 实现查询逻辑
    return [{"id": 1, "name": "example"}]

if __name__ == "__main__":
    mcp.run()
```

配置完成后，Claude Code 会自动发现工具并在对话中使用。

---

## 工具链管理

### 1. JSON 配置管理

生产环境中，工具信息以 JSON 配置文件持久化，支持动态增删。核心接口：

| 方法 | 说明 |
|------|------|
| `add_tool(config)` | 添加工具到注册表（自动去重），持久化到文件 |
| `remove_tool(name)` | 移除指定工具 |
| `enable_tool(name)` | 启用工具（热加载，无需重启） |
| `disable_tool(name)` | 禁用工具（热加载，无需重启） |
| `get_enabled_tools()` | 获取所有已启用的工具列表 |

实现要点：基于 JSON 文件读写（`json.loads`/`json.dumps`），每次变更后调用 `_save_config()` 持久化。

配置文件示例：

```json
{
  "tools": [
    {
      "name": "weather_query",
      "description": "查询城市天气信息",
      "transport": "sse",
      "url": "http://mcp-server:8080/sse",
      "category": "weather",
      "enabled": true,
      "expires_at": null
    },
    {
      "name": "map_search",
      "description": "地图搜索和导航",
      "transport": "rest",
      "url": "http://mcp-server:8081/api/tools/call",
      "category": "map",
      "enabled": true,
      "expires_at": "2026-04-09T15:30:00"
    }
  ]
}
```

### 2. 工具搜索与自动获取

从外部 API 搜索新的 MCP 工具，自动添加到配置中。核心流程：

**`search_and_acquire(query)` 执行步骤：**
1. 冷却检查（30 秒内不重复搜索同一 query）
2. 相似度检查（词重叠率 >= 0.8 视为相同查询，直接返回缓存）
3. API 调用（带重试 + 指数退避：1s、2s、4s）
4. 自动添加到工具注册表，设置 15 分钟 TTL
5. 启动异步定时任务，到期自动清理

关键实现细节：使用 `_cache` 字典做查询结果缓存，`_cooldown` 字典防止重复调用，`_word_overlap()` 用 Jaccard 相似度判断查询是否等价。

### 3. SSE 与 REST 传输模式

| 模式 | 通信方式 | 流程 | 适用场景 |
|------|---------|------|---------|
| SSE | 长连接 + 轮询 | 发起会话 → 生成 session_id → 轮询获取结果（最多30次，间隔1s）| 耗时操作、流式结果 |
| REST | HTTP POST | 直接 POST JSON → 同步返回结果 | 快速查询、短耗时操作 |

### 4. 设备级会话管理

每个用户设备的工具调用独立管理，避免会话冲突。以 `(user_id, client_uid, tool_name)` 三元组作为会话 key，提供 `get_session`/`set_session`/`clear_session` 三个方法，底层用字典存储。

### 5. 工具编排（智能匹配与执行）

工具编排器负责根据用户查询自动匹配和调度工具。

**匹配评分公式：** `name匹配度 x 40% + description匹配度 x 30% + category权重 x 30%`

**执行策略：**
- 单个工具匹配：直接执行
- 多个不同类别工具：并行执行（`asyncio.gather`）
- 多个同类工具：串行执行，取第一个成功结果

类别权重预设：search=10, weather=5, map=5, other=1。

### 6. 中文 NLP 参数提取

从中文自然语言中提取工具调用参数：

```python
import re

def extract_parameters(query: str) -> dict:
    """
    从中文查询中提取参数

    支持的模式：
    - 城市：XX市、XX区（如 "北京市"、"海淀区"）
    - 位置：在XX、从XX到XX
    - 查询关键词：查XX、搜索XX
    """
    params = {}

    # 城市提取
    city_pattern = r"([\u4e00-\u9fa5]{2,}(?:市|区|县|省))"
    cities = re.findall(city_pattern, query)
    if cities:
        params["city"] = cities[0]
        if len(cities) > 1:
            params["destination"] = cities[1]

    # 位置提取
    location_pattern = r"(?:在|从|到)([\u4e00-\u9fa5]{2,})"
    locations = re.findall(location_pattern, query)
    if locations and "city" not in params:
        params["location"] = locations[0]

    # 查询关键词
    query_pattern = r"(?:查|搜索|查找|问)([\u4e00-\u9fa5]{2,})"
    keywords = re.findall(query_pattern, query)
    if keywords:
        params["query"] = keywords[0]

    return params


# 示例
extract_parameters("北京市今天天气怎么样")
# {"city": "北京市"}

extract_parameters("从海淀区到朝阳区的导航路线")
# {"city": "海淀区", "destination": "朝阳区"}

extract_parameters("搜索附近的餐厅")
# {"query": "附近的餐厅"}
```

### 7. Langchain 工具集成

将 MCP 工具封装为 Langchain BaseTool，直接接入 Agent：

```python
from langchain_core.tools import BaseTool
from pydantic import Field
from typing import Optional, Type
from pydantic import BaseModel

class MCPToolInput(BaseModel):
    """MCP 工具输入 schema"""
    query: str = Field(description="查询内容")

class MCPTool(BaseTool):
    """将 MCP 工具封装为 Langchain BaseTool"""

    name: str = "mcp_tool"
    description: str = "MCP 工具"
    args_schema: Type[BaseModel] = MCPToolInput
    tool_config: dict = {}
    caller: MCPToolCaller = None

    def _run(self, query: str) -> str:
        """同步调用"""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(
            self._arun(query)
        )

    async def _arun(self, query: str) -> str:
        """异步调用"""
        transport = self.tool_config.get("transport", "rest")
        url = self.tool_config.get("url", "")

        if transport == "sse":
            result = await self.caller.call_sse(url, self.name, {"query": query})
        else:
            result = await self.caller.call_rest(url, self.name, {"query": query})

        return json.dumps(result, ensure_ascii=False)


class MCPToolkit:
    """从配置文件加载所有 MCP 工具为 Langchain Tools"""

    def __init__(self, config_path: str):
        self.manager = MCPToolManager(config_path)
        self.caller = MCPToolCaller()

    def get_langchain_tools(self) -> list[BaseTool]:
        """返回所有已启用的 Langchain Tools"""
        tools = []
        for tool_config in self.manager.get_enabled_tools():
            tool = MCPTool(
                name=tool_config["name"],
                description=tool_config.get("description", ""),
                tool_config=tool_config,
                caller=self.caller,
            )
            tools.append(tool)
        return tools
```

---

## 工具链管理架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                     MCP 工具链管理系统                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  用户请求（中文自然语言）                                          │
│      ↓                                                           │
│  参数提取（中文 NLP：城市/位置/关键词）                             │
│      ↓                                                           │
│  工具匹配（name 40% + desc 30% + category 30% 加权评分）         │
│      ↓                                                           │
│  ┌─────────────────────────────────────┐                         │
│  │         JSON 配置工具注册表           │                         │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │                         │
│  │  │天气  │ │地图  │ │搜索  │ │...  │  │                         │
│  │  └──┬──┘ └──┬──┘ └──┬──┘ └─────┘  │                         │
│  └─────┼───────┼───────┼──────────────┘                         │
│        ↓       ↓       ↓                                         │
│  SSE / REST 传输调用                                              │
│        ↓                                                         │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │  设备会话管理  │  │  工具搜索 API  │                              │
│  │ (per device) │  │ (自动获取新工具)│                              │
│  └──────────────┘  └──────────────┘                              │
│                          ↓                                       │
│                    15 分钟 TTL 自动过期                            │
│                                                                  │
│  ┌────────────────────────────────────┐                          │
│  │ Langchain Agent (BaseTool 集成)    │                          │
│  └────────────────────────────────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```
