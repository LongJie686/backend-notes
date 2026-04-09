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
| 性能好 | 中小数据量下读写性能优秀 |

## 局限性

| 局限 | 说明 |
|------|------|
| 并发写入 | 只允许一个写入者（WAL 模式下可并发读） |
| 无用户管理 | 没有用户权限系统，依赖文件系统权限 |
| 不适合分布式 | 单机数据库，无法做主从复制 |
| 数据规模 | 建议不超过几十 GB |

## 基本操作

```sql
-- 创建表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    age INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- CRUD
INSERT INTO users (name, email, age) VALUES ('张三', 'test@example.com', 25);
SELECT * FROM users WHERE age > 18;
UPDATE users SET age = 26 WHERE name = '张三';
DELETE FROM users WHERE id = 1;
```

## WAL 模式

```sql
-- 开启 WAL（推荐，允许并发读）
PRAGMA journal_mode = WAL;

-- WAL 模式优势：
-- 1. 读写不阻塞（读不阻塞写，写不阻塞读）
-- 2. 性能更好
-- 3. 更安全（不会因为崩溃损坏数据库）
```

## Python 操作

### sqlite3 标准库

```python
import sqlite3

# 连接数据库（文件不存在会自动创建）
conn = sqlite3.connect("app.db")
conn.row_factory = sqlite3.Row  # 让结果可以用列名访问

cursor = conn.cursor()

# 建表
cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE
    )
""")

# 插入
cursor.execute("INSERT INTO users (name, email) VALUES (?, ?)", ("张三", "a@b.com"))
conn.commit()

# 查询
rows = cursor.execute("SELECT * FROM users").fetchall()
for row in rows:
    print(row["name"], row["email"])

# 批量插入
users = [("李四", "c@d.com"), ("王五", "e@f.com")]
cursor.executemany("INSERT INTO users (name, email) VALUES (?, ?)", users)
conn.commit()

# 上下文管理器（自动事务）
with conn:
    conn.execute("UPDATE users SET name = ? WHERE id = ?", ("张三三", 1))

conn.close()
```

### aiosqlite（异步）

```python
import aiosqlite

async def get_users():
    async with aiosqlite.connect("app.db") as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users") as cursor:
            return await cursor.fetchall()
```

## SQLAlchemy + SQLite

```python
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, Session

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True)

# 连接
engine = create_engine("sqlite:///app.db", echo=True)
Base.metadata.create_all(engine)

# 使用
with Session(engine) as session:
    user = User(name="张三", email="a@b.com")
    session.add(user)
    session.commit()
```

## 适用场景

- 本地工具和脚本
- 移动端 / 桌面应用数据存储
- 单元测试（替代真实数据库）
- 原型开发
- 嵌入式设备
- 中小型网站（日活 < 10 万）
