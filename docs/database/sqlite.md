# SQLite

## 简介

SQLite 是嵌入式关系型数据库，无需独立服务进程，整个数据库就是一个文件。轻量、零配置、可靠，适合小型应用、移动端、嵌入式、测试、本地工具等场景。

## 核心优势

| 优势 | 说明 |
|------|------|
| 零配置 | 无需安装服务，无需连接字符串 |
| 单文件 | 整个数据库一个文件，方便备份和迁移 |
| 跨平台 | 同一个数据库文件可在不同系统使用 |
| 可靠 | ACID 事务，WAL 模式支持并发读 |
| 体积小 | 库文件几百 KB |

## 局限性

| 局限 | 说明 |
|------|------|
| 并发写入 | 只允许一个写入者（WAL 模式下可并发读） |
| 无用户管理 | 依赖文件系统权限 |
| 不适合分布式 | 单机数据库，无法做主从复制 |
| 数据规模 | 建议不超过几十 GB |

## 基本操作

```sql
-- 建表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE
);

-- 开启 WAL 模式（推荐，允许并发读）
PRAGMA journal_mode = WAL;

-- CRUD
INSERT INTO users (name, email) VALUES ('张三', 'test@example.com');
SELECT * FROM users WHERE age > 18;
UPDATE users SET age = 26 WHERE name = '张三';
DELETE FROM users WHERE id = 1;
```

## Python 操作

### sqlite3 标准库

```python
import sqlite3

conn = sqlite3.connect("app.db")
conn.row_factory = sqlite3.Row  # 结果可用列名访问

# 建表 + 插入 + 查询
conn.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)")
conn.execute("INSERT INTO users (name) VALUES (?)", ("张三",))
conn.commit()

rows = conn.execute("SELECT * FROM users").fetchall()

# 批量插入
conn.executemany("INSERT INTO users (name) VALUES (?)", [("李四",), ("王五",)])

# 上下文管理器（自动事务）
with conn:
    conn.execute("UPDATE users SET name = ? WHERE id = ?", ("张三三", 1))
```

| 操作 | 方法 |
|------|------|
| 单条插入 | `execute(sql, params)` |
| 批量插入 | `executemany(sql, params_list)` |
| 自动事务 | `with conn: ...` |

### aiosqlite（异步）

```python
import aiosqlite

async def get_users():
    async with aiosqlite.connect("app.db") as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users") as cursor:
            return await cursor.fetchall()
```

### SQLAlchemy + SQLite

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, Session

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)

engine = create_engine("sqlite:///app.db")
Base.metadata.create_all(engine)

with Session(engine) as session:
    session.add(User(name="张三"))
    session.commit()
```

## 适用场景

- 本地工具和脚本
- 移动端 / 桌面应用
- 单元测试（替代真实数据库）
- 原型开发
- 嵌入式设备
- 中小型网站（日活 < 10 万）
