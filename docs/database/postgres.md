# PostgreSQL

## 简介

PostgreSQL 是功能最强大的开源关系型数据库，以扩展性、标准兼容性和数据完整性著称。适合中大型项目、复杂查询、地理数据、JSON 数据等场景。

## 核心优势

| 优势 | 说明 |
|------|------|
| 扩展性强 | 支持自定义类型、函数、索引方法、扩展（如 pgvector、PostGIS） |
| 标准兼容 | 最接近 SQL 标准的开源数据库 |
| 数据类型丰富 | JSONB、数组、UUID、HSTORE、范围类型、几何类型 |
| 并发控制 | MVCC，读写不阻塞 |
| 窗口函数 / CTE | 复杂分析查询能力强 |
| 分区表 | 原生支持范围、列表、哈希分区 |

## 常用数据类型

```sql
-- 基本类型
id SERIAL PRIMARY KEY          -- 自增主键
name VARCHAR(100) NOT NULL     -- 变长字符串
price DECIMAL(10, 2)           -- 精确小数
created_at TIMESTAMPTZ DEFAULT NOW()  -- 带时区时间戳

-- 高级类型
tags TEXT[]                     -- 数组
config JSONB DEFAULT '{}'      -- JSON（二进制存储，支持索引和查询）
location POINT                 -- 几何类型
uid UUID DEFAULT gen_random_uuid()  -- UUID
```

## JSONB 操作

```sql
-- 插入 JSON 数据
INSERT INTO users (name, metadata)
VALUES ('张三', '{"age": 25, "tags": ["python", "backend"]}');

-- 查询 JSON 字段
SELECT name, metadata->>'age' AS age FROM users;
SELECT name FROM users WHERE metadata @> '{"tags": ["python"]}';

-- 更新 JSON 字段
UPDATE users SET metadata = jsonb_set(metadata, '{age}', '26');

-- JSONB 索引（GIN）
CREATE INDEX idx_users_metadata ON users USING GIN (metadata);
```

## 窗口函数

```sql
-- 按部门排名
SELECT name, dept, salary,
       RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rank
FROM employees;

-- 累计求和
SELECT date, amount,
       SUM(amount) OVER (ORDER BY date) AS running_total
FROM daily_sales;

-- 环比增长
SELECT date, amount,
       LAG(amount, 1) OVER (ORDER BY date) AS prev_amount,
       amount - LAG(amount, 1) OVER (ORDER BY date) AS diff
FROM daily_sales;
```

## Python 操作

```python
import asyncpg

# 异步连接
async def main():
    conn = await asyncpg.connect("postgresql://user:pass@localhost/mydb")

    # 查询
    rows = await conn.fetch("SELECT id, name FROM users WHERE age > $1", 18)

    # 插入（返回自增 ID）
    user_id = await conn.fetchval(
        "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
        "张三", "test@example.com"
    )

    # 事务
    async with conn.transaction():
        await conn.execute("UPDATE accounts SET balance = balance - $1", 100)
        await conn.execute("UPDATE accounts SET balance = balance + $1", 100)

    await conn.close()
```

## 与 MySQL 对比

| 维度 | PostgreSQL | MySQL |
|------|-----------|-------|
| 数据类型 | 更丰富（JSONB、数组、UUID） | 基本够用 |
| 扩展性 | 极强（pgvector、PostGIS） | 一般 |
| 复杂查询 | 更强（窗口函数、CTE） | 够用 |
| 性能 | 复杂查询更优 | 简单读写更优 |
| 社区 | 企业级/数据密集型 | Web 应用主流 |
| JSON 支持 | JSONB 原生索引+查询 | JSON 类型，功能较少 |

## 适用场景

- 需要复杂查询和数据分析的应用
- 需要 JSONB 灵活存储的业务
- 地理空间数据（PostGIS）
- 向量检索（pgvector）
- 对数据完整性要求高的金融/企业系统
