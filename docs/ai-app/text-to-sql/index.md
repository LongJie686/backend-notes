# Text-to-SQL 智能查询

将自然语言问题自动转换为 SQL 查询并执行，返回结构化结果。

## 核心流程

```
用户提问 → Schema 感知 Prompt → LLM 生成 SQL → 校验 → 执行 → 结果/图表返回
```

1. **意图理解**：解析用户自然语言，提取查询目标
2. **SQL 生成**：基于数据库 Schema 生成对应方言的 SQL
3. **安全校验**：语法检查、防注入、权限控制
4. **执行返回**：只读执行，超时保护，结果格式化

## 关键技术点

### Schema 理解

将数据库元信息传给 LLM，让它"看懂"表结构：

```python
schema_prompt = """
数据库类型: PostgreSQL
表: orders (id, user_id, amount, status, created_at)
表: users (id, name, department, join_date)
关系: orders.user_id -> users.id

字段说明:
- status: pending/paid/cancelled
- amount: 订单金额，单位元
"""
```

### Prompt 设计

```python
prompt = f"""你是一个 SQL 专家。根据用户问题和表结构生成 SQL。

规则:
1. 只生成 SELECT 语句，禁止 INSERT/UPDATE/DELETE
2. 使用表别名提高可读性
3. 日期函数使用数据库对应方言
4. 中文列名需要映射到实际英文字段名

{schema_prompt}

Few-shot 示例:
Q: 上个月销售额最高的前10个客户
A: SELECT u.name, SUM(o.amount) AS total
   FROM orders o JOIN users u ON o.user_id = u.id
   WHERE o.created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
     AND o.status = 'paid'
   GROUP BY u.name ORDER BY total DESC LIMIT 10

用户问题: {user_question}
"""
```

### 多数据源支持

| 数据库 | 方言差异 | 注意事项 |
|--------|---------|---------|
| PostgreSQL | `DATE_TRUNC`、`::type` | JSONB 查询 |
| MySQL | `DATE_FORMAT`、`` `反引号` `` | 分页用 LIMIT |
| SQL Server | `TOP`、`FORMAT()` | NOLOCK 提示 |
| Oracle | `ROWNUM`、`TO_DATE` | 序列语法 |
| ClickHouse | `toDate()`、`MergeTree` | 聚合性能优 |

### SQL 校验与安全

```python
import sqlparse
import re

def validate_sql(sql: str) -> bool:
    """校验生成的 SQL 安全性"""
    # 禁止写操作
    forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE']
    upper_sql = sql.upper()
    for keyword in forbidden:
        if keyword in upper_sql:
            return False
    # 禁止多语句
    statements = sqlparse.parse(sql)
    if len(statements) > 1:
        return False
    # 必须是 SELECT
    if not statements[0].get_type() == 'SELECT':
        return False
    return True
```

### 结果可视化

查询结果可自动转换为图表，嵌入 PPT 报告：
- 数值对比 → 柱状图/条形图
- 趋势分析 → 折线图
- 占比分布 → 饼图

## LangChain 集成

```python
from langchain_community.utilities import SQLDatabase
from langchain.chains import create_sql_query_chain
from langchain_community.agent_toolkits import create_sql_agent

db = SQLDatabase.from_uri("postgresql://user:pass@localhost:5432/mydb")

# 方式1: Chain 模式（单次查询）
chain = create_sql_query_chain(llm, db)
sql = chain.invoke({"question": "各部门平均薪资"})
result = db.run(sql)

# 方式2: Agent 模式（多轮推理）
agent = create_sql_agent(llm, db=db, agent_type="openai-tools", verbose=True)
result = agent.invoke({"input": "分析去年每个季度的销售趋势"})
```

## 常见坑点

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 中文表名映射 | 数据库用英文名，用户用中文问 | 维护中文-英文字段映射表 |
| 复杂 JOIN | 多表关联关系不清 | Schema 中明确外键关系 |
| 聚合查询 | GROUP BY 字段遗漏 | Prompt 中强调聚合规则 |
| 日期函数差异 | 不同数据库方言不同 | 根据数据库类型动态替换函数 |
| 幻觉字段 | LLM 编造不存在的列 | 执行前校验字段是否在 Schema 中 |
