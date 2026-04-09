# pgvector 向量数据库

## 什么是 pgvector

pgvector 是 PostgreSQL 的开源扩展，支持向量存储和相似度检索，让 PostgreSQL 兼具关系型数据库和向量数据库的能力。

## 为什么选 pgvector

| 对比项 | pgvector | Milvus | Pinecone | Chroma |
|--------|----------|--------|----------|--------|
| 部署方式 | PG 扩展，无额外运维 | 独立服务，运维复杂 | 云服务 | 嵌入式 |
| ACID 事务 | 支持 | 不支持 | 不支持 | 不支持 |
| 数据规模 | 百万级 | 亿级 | 亿级 | 十万级 |
| 查询能力 | SQL + 向量混合 | 仅向量 | 仅向量 | 仅向量 |
| 适用场景 | 中小规模、快速集成 | 大规模生产 | 免运维 | 原型开发 |

**优势**：复用 PostgreSQL 生态、ACID 事务、SQL + 向量混合查询、运维简单

**劣势**：超大规模数据（亿级以上）性能不如 Milvus

## 安装与配置

```sql
-- 安装扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建带向量列的表
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding VECTOR(1536),  -- OpenAI text-embedding-3 输出维度
    metadata JSONB
);
```

## 向量操作

```sql
-- 插入向量
INSERT INTO documents (content, embedding)
VALUES ('Hello world', '[0.1, 0.2, 0.3, ...]');

-- 余弦相似度查询（越小越相似）
SELECT content, embedding <=> '[0.1, 0.2, 0.3, ...]' AS distance
FROM documents
ORDER BY embedding <=> '[0.1, 0.2, 0.3, ...]'
LIMIT 5;

-- 距离运算符
-- <=>  余弦距离
-- <->  L2 距离（欧几里得）
-- <#>  内积（负值，越大越相似）
```

## 索引类型

| 索引 | 原理 | 适用场景 | 构建速度 |
|------|------|---------|---------|
| IVFFlat | 聚类分区 + 暴力搜索 | 数据量适中、精度要求高 | 快 |
| HNSW | 图结构近似搜索 | 大数据量、低延迟需求 | 慢 |

```sql
-- HNSW 索引（推荐）
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);

-- IVFFlat 索引
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

## 与 RAG 集成

```python
from langchain_community.vectorstores import PGVector
from langchain_openai import OpenAIEmbeddings

# 连接 pgvector
vectorstore = PGVector.from_documents(
    documents=docs,
    embedding=OpenAIEmbeddings(),
    connection_string="postgresql://user:pass@localhost:5432/mydb",
    collection_name="knowledge_base"
)

# 相似度检索
results = vectorstore.similarity_search("用户查询内容", k=5)
```

## 实际应用场景

- **语义搜索**：用户输入自然语言，返回语义最相关的文档
- **相似度推荐**：基于内容 Embedding 找相似商品/文章
- **AI 记忆存储**：对话历史向量化存储，多轮对话时检索相关记忆
- **混合查询**：SQL 条件过滤 + 向量相似度排序，同时满足结构化和语义化需求
