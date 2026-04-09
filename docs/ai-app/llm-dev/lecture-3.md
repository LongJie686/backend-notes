# 第三讲：RAG 系统设计与实现

> 阶段目标：掌握 RAG 系统的完整流程，能够独立设计和实现高质量的知识增强生成系统

## 学习目标

1. 理解 RAG 的完整流程和核心组件
2. 掌握文档加载与切分策略
3. 了解 Embedding 模型的选型要点
4. 熟悉主流向量数据库的特点和使用场景
5. 掌握多种检索策略和重排序技术
6. 了解 RAG 系统的高级优化技术

## 核心内容

### RAG 完整流程

RAG（Retrieval-Augmented Generation）通过检索外部知识来增强大模型的回答质量，解决模型知识过时和幻觉问题。

#### 基本流程

```
用户提问
   |
   v
查询处理 --> 向量检索 --> 上下文组装 --> 大模型生成 --> 回答
   |              |              |
   v              v              v
查询改写     相关文档片段    Prompt + 检索结果
```

#### 离线流程（索引构建）

1. **文档收集**：收集业务相关的文档、手册、FAQ 等
2. **文档解析**：提取文本内容，处理表格、图片等
3. **文本切分**：将长文档切分为合适大小的片段
4. **向量生成**：使用 Embedding 模型将文本转为向量
5. **向量存储**：将向量和元数据存入向量数据库

#### 在线流程（查询处理）

1. **查询理解**：理解用户意图，必要时改写查询
2. **向量检索**：将查询转为向量，检索相关文档片段
3. **重排序**：对检索结果进行精细排序
4. **上下文组装**：将检索结果组装进 Prompt
5. **生成回答**：大模型基于检索到的上下文生成回答

### 文档加载

#### 支持的文档格式

| 格式 | 工具 | 说明 |
|------|------|------|
| PDF | PyPDF2, pdfplumber, PyMuPDF | 注意扫描件需要 OCR |
| Word | python-docx | 提取文本和表格 |
| Excel | openpyxl, pandas | 按行或按 sheet 处理 |
| HTML | BeautifulSoup | 去除标签，提取正文 |
| Markdown | 直接读取 | 天然适合切分 |
| PPT | python-pptx | 提取文本和备注 |

#### 加载示例

```python
from langchain_community.document_loaders import PyPDFLoader, TextLoader, DirectoryLoader

# 加载单个 PDF
loader = PyPDFLoader("document.pdf")
pages = loader.load()

# 加载目录下所有文件
loader = DirectoryLoader("./docs", glob="**/*.md", loader_cls=TextLoader)
docs = loader.load()
```

#### 元数据管理

每个文档片段应保留元数据：

```python
{
    "content": "文档内容...",
    "metadata": {
        "source": "product_manual_v2.pdf",
        "page": 15,
        "chapter": "第3章 安装指南",
        "doc_type": "manual",
        "updated_at": "2024-01-15"
    }
}
```

### 切分策略

切分是 RAG 系统中最关键的环节之一，直接影响检索质量。

#### 切分方法

**固定长度切分**

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "！", "？", ".", " ", ""]
)
chunks = splitter.split_text(text)
```

- 优点：简单可控
- 缺点：可能切断语义完整性
- chunk_overlap：片段重叠，减少边界信息丢失

**按语义切分**

- 按段落、章节等自然边界切分
- 更好的语义完整性
- 需要根据文档结构定制切分逻辑

**递归切分**

- 优先按大分隔符切分（如双换行）
- 片段仍然过长则按小分隔符切分（如单换行、句号）
- 兼顾语义完整性和长度控制

#### 切分参数选择

| 参数 | 建议 | 说明 |
|------|------|------|
| chunk_size | 300-1000 | 根据模型上下文窗口和 Embedding 能力调整 |
| chunk_overlap | chunk_size 的 10%-20% | 过大浪费存储，过小丢失边界信息 |
| separators | 按文档语言选择 | 中文优先用句号、换行；英文优先用段落、句号 |

#### 特殊场景处理

- **表格**：保留完整的行，不要在行中间切分
- **代码**：按函数/类切分，保留完整的代码块
- **列表**：保留完整的列表项，不要拆散

### Embedding 模型选型

Embedding 模型将文本转换为高维向量，质量直接影响检索效果。

#### 主流模型对比

| 模型 | 维度 | 最大长度 | 特点 |
|------|------|----------|------|
| text-embedding-3-small | 1536 | 8191 Token | OpenAI，性价比高 |
| text-embedding-3-large | 3072 | 8191 Token | OpenAI，效果最好 |
| bge-large-zh-v1.5 | 1024 | 512 Token | 中文效果优秀，可本地部署 |
| m3e-base | 768 | 512 Token | 中文开源，适合初学 |
| Cohere embed-v3 | 1024 | 512 Token | 多语言，搜索优化 |

#### 选型考虑

1. **语言支持**：中文为主选 bge/m3e，多语言选 OpenAI/Cohere
2. **部署方式**：有隐私要求选本地模型，否则 API 更方便
3. **成本**：本地模型免费但需要 GPU，API 按 Token 计费
4. **维度**：维度越高表达能力越强，但存储和计算成本也越高
5. **一致性**：查询和文档必须使用同一个 Embedding 模型

### 向量数据库

向量数据库专门存储和检索高维向量，是 RAG 系统的核心基础设施。

#### 主流方案对比

| 数据库 | 类型 | 特点 | 适用场景 |
|--------|------|------|----------|
| FAISS | 本地库 | Meta 开源，速度快 | 原型开发，小规模数据 |
| Chroma | 嵌入式 | 轻量级，Python 原生 | 快速原型，本地开发 |
| Milvus | 分布式 | 高性能，支持亿级向量 | 生产环境，大规模数据 |
| Pinecone | 云服务 | 全托管，免运维 | 快速上线，不想管基础设施 |
| Weaviate | 独立部署 | 支持混合搜索 | 需要关键词+向量联合检索 |
| Qdrant | 独立部署 | Rust 实现，性能好 | 注重性能的生产环境 |

#### 基本操作

```python
# Chroma 示例
import chromadb

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_or_create_collection("documents")

# 添加文档
collection.add(
    documents=["文档内容1", "文档内容2"],
    metadatas=[{"source": "file1.txt"}, {"source": "file2.txt"}],
    ids=["doc1", "doc2"]
)

# 检索
results = collection.query(
    query_texts=["查询内容"],
    n_results=5
)
```

### 检索策略

#### 稠密检索（Dense Retrieval）

基于向量相似度的检索，最常用的方式。

- 使用 Embedding 模型将查询和文档都转为向量
- 通过余弦相似度或点积计算相关性
- 优点：能理解语义相似性
- 缺点：可能遗漏关键词精确匹配的结果

#### 稀疏检索（Sparse Retrieval）

基于关键词的检索，如 BM25。

```python
from rank_bm25 import BM25Okapi

tokenized_corpus = [doc.split() for doc in documents]
bm25 = BM25Okapi(tokenized_corpus)

query_tokens = query.split()
scores = bm25.get_scores(query_tokens)
```

- 优点：精确匹配关键词，计算快
- 缺点：不理解语义，"汽车"和"轿车"无法关联

#### 混合检索（Hybrid Retrieval）

结合稠密检索和稀疏检索的优势。

```python
# 混合检索策略
def hybrid_search(query, alpha=0.7):
    # alpha 控制稠密检索的权重，1-alpha 为稀疏检索权重
    dense_scores = dense_search(query)      # 向量检索
    sparse_scores = sparse_search(query)    # BM25 检索

    # 归一化后加权融合
    final_scores = alpha * normalize(dense_scores) + (1 - alpha) * normalize(sparse_scores)
    return rank_by_scores(final_scores)
```

- 实践证明混合检索效果通常优于单一策略
- alpha 参数需要根据具体数据调优

### 重排序（Reranking）

初始检索后，使用更精细的模型对结果重新排序。

#### 为什么需要重排序

- 初始检索追求速度，使用的是双塔模型（查询和文档独立编码）
- 重排序使用交叉编码器（同时处理查询和文档），精度更高但速度慢
- 两阶段策略：先用快速检索缩小范围，再用精细模型排序

#### 常用重排序模型

| 模型 | 特点 |
|------|------|
| bge-reranker-large | 中文效果好，可本地部署 |
| Cohere Rerank | API 调用，效果好 |
| Jina Reranker | 支持长文档 |

#### 使用示例

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder('BAAI/bge-reranker-large')

pairs = [[query, doc] for doc in retrieved_docs]
scores = reranker.predict(pairs)

# 按分数重新排序
ranked_docs = sorted(zip(retrieved_docs, scores), key=lambda x: x[1], reverse=True)
```

### 高级技术

#### 查询改写（Query Rewriting）

将用户的原始查询改写为更适合检索的形式。

```python
# 使用 LLM 改写查询
rewrite_prompt = """
将以下用户查询改写为更适合搜索引擎的查询。
保留原始意图，但使用更精确的关键词。

原始查询：{query}
改写后的查询：
"""
```

#### HyDE（Hypothetical Document Embeddings）

先让大模型生成一个"假设性答案"，再用这个答案的向量去检索。

```python
# HyDE 流程
hypothetical_answer = llm.generate(f"请回答：{query}")
results = vector_db.search(embed(hypothetical_answer))
```

原理：假设性答案的向量比原始查询的向量更接近真实文档的向量分布。

#### Self-RAG

让模型自己判断是否需要检索、检索结果是否有用。

```
1. 模型判断：这个问题我能否直接回答？
   - 能：直接回答
   - 不能：触发检索

2. 获取检索结果后，模型判断：检索结果是否相关？
   - 相关：基于检索结果回答
   - 不相关：重新检索或直接回答
```

#### 多路召回与融合

```python
def multi_recall_search(query):
    results = []

    # 路径1：向量检索
    results.extend(vector_search(query, top_k=10))

    # 路径2：关键词检索
    results.extend(keyword_search(query, top_k=10))

    # 路径3：知识图谱检索
    results.extend(kg_search(query, top_k=5))

    # 去重、融合、重排序
    merged = deduplicate(results)
    reranked = rerank(query, merged)

    return reranked[:5]
```

## 重点认知

1. **切分策略决定上限**：再好的检索算法，切分不好也白搭
2. **检索质量可量化**：用命中率（Hit Rate）和 MRR 评估检索效果
3. **混合检索是标配**：生产环境几乎都应该使用混合检索
4. **重排序提升显著**：加入重排序通常能提升 10-20% 的效果
5. **RAG 不是银弹**：对于需要复杂推理的问题，RAG 的帮助有限

## 实战建议

1. 先用小数据集（100-500 条）验证流程，再扩大规模
2. 建立检索评估数据集：人工标注"查询-相关文档"对
3. 对比不同切分策略和 Embedding 模型的效果
4. 生产环境优先选择 Milvus 或 Qdrant，开发阶段用 Chroma
5. 实现检索日志，记录每次查询的检索结果和用户反馈

## 常见问题

**Q：chunk_size 设多大合适？**

A：没有标准答案，需要根据具体场景实验。一般建议 300-500 字用于精确检索，800-1000 字用于需要更多上下文的场景。关键是在语义完整性和检索精度之间找平衡。

**Q：向量数据库怎么选？**

A：开发阶段用 Chroma/FAISS 快速验证。生产环境根据数据量选择：百万级以内 Milvus/Qdrant 单节点即可；亿级数据需要分布式方案。如果不想运维基础设施，Pinecone 是好选择。

**Q：RAG 系统效果不好怎么排查？**

A：按环节排查：先看切分是否合理（抽查片段是否语义完整），再看检索是否准确（手动验证 top-5 命中率），最后看生成是否正确（检查 Prompt 是否有效利用了检索结果）。

## 小结

本讲系统学习了 RAG 的完整技术栈：从文档处理到向量存储，从检索策略到重排序优化。RAG 是目前大模型应用最成熟的技术模式，掌握它是开发大模型应用的必备技能。下一讲将进入 Agent 世界，学习如何让大模型自主调用工具完成复杂任务。
