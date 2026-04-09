# 第 3 讲：RAG 知识管理实战

## 核心结论（5 条必记）

1. **文档解析要保留元数据** -- 便于后续过滤和溯源，每个文档片段都应携带来源、页码、日期等信息
2. **递归字符切片是大多数场景的最佳选择** -- chunk_size=500 是通用起点，overlap 设为 10% 防止语义断裂
3. **中文场景优先使用 bge/M3E 系列模型** -- bge-large-zh-v1.5 本地部署，gte-Qwen2 性价比高
4. **混合检索 + Rerank 是当前精度最高的检索方案** -- 向量检索捕获语义，BM25 捕获关键词，Rerank 精排
5. **知识库需要建立增量更新和版本管理机制** -- 文档指纹法识别变更，按版本管理集合，支持灰度切换

---

## 一、文档加载与解析

### 支持的文档格式

| 格式 | 加载工具 | 注意事项 |
|------|---------|---------|
| PDF | PyPDF2 / pdfplumber / Unstructured | 扫描件需 OCR |
| Word | python-docx / Unstructured | 注意表格和图片 |
| HTML | BeautifulSoup / Unstructured | 去除标签噪声 |
| Markdown | LangChain MarkdownLoader | 保留标题层级 |
| CSV/Excel | pandas / LangChain DataFrameLoader | 结构化数据处理 |
| PPT | python-pptx / Unstructured | 提取文本和备注 |

### 文档加载最佳实践

```python
from langchain_community.document_loaders import (
    PyPDFLoader,
    UnstructuredWordDocumentLoader,
    DirectoryLoader
)

# 加载单个 PDF
loader = PyPDFLoader("report.pdf")
pages = loader.load()

# 批量加载目录下所有文档
loader = DirectoryLoader(
    "./docs",
    glob="**/*.{pdf,docx,md}",
    show_progress=True,
    use_multithreading=True
)
documents = loader.load()
```

### 元数据管理

每个文档片段都应携带元数据，便于后续过滤和溯源：

```python
metadata = {
    "source": "report.pdf",
    "page": 5,
    "title": "2024年度报告",
    "author": "张三",
    "date": "2024-03-01",
    "department": "技术部",
    "doc_type": "annual_report"
}
```

---

## 二、文本切片策略

### 切片策略对比

| 策略 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| 固定长度 | 按字符数切割 | 简单可控 | 可能切断语义 | 通用场景 |
| 递归字符 | 按分隔符层级切割 | 保留段落结构 | 切片大小不均匀 | 大多数场景 |
| 语义切片 | 基于语义相似度切割 | 语义完整 | 计算成本高 | 高精度场景 |
| 文档结构 | 按标题/章节切割 | 保留文档结构 | 依赖文档格式 | 结构化文档 |

### 推荐配置

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "！", "？", ".", " ", ""],
    length_function=len,
    keep_separator=True
)

chunks = splitter.split_documents(documents)
```

### 切片大小的选择

- **200-300 字符**：问答场景，需要精准匹配
- **500-800 字符**：通用场景，平衡精度和上下文
- **1000-2000 字符**：摘要场景，需要更多上下文

---

## 三、Embedding 模型选择

### 模型对比

| 模型 | 维度 | 中文支持 | 性能 | 部署方式 |
|------|------|---------|------|---------|
| text-embedding-3-small (OpenAI) | 1536 | 一般 | 高 | API |
| text-embedding-3-large (OpenAI) | 3072 | 一般 | 高 | API |
| bge-large-zh-v1.5 (BAAI) | 1024 | 优秀 | 中 | 本地/API |
| M3E-large | 1024 | 优秀 | 中 | 本地 |
| bce-embedding-base | 768 | 优秀 | 中 | 本地 |
| gte-Qwen2 | 1536 | 优秀 | 高 | 本地/API |

### 选择建议

- **内部系统、数据敏感**：本地部署 bge-large-zh-v1.5
- **追求效果、预算充足**：OpenAI text-embedding-3-large
- **中文为主、性价比优先**：M3E-large 或 gte-Qwen2

```python
from langchain_community.embeddings import HuggingFaceEmbeddings

embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-large-zh-v1.5",
    model_kwargs={"device": "cuda"},
    encode_kwargs={"normalize_embeddings": True}
)
```

---

## 四、向量数据库搭建

### 向量数据库选型

| 数据库 | 特点 | 适用场景 | 部署难度 |
|--------|------|---------|---------|
| Chroma | 轻量、嵌入式 | 开发测试 | 低 |
| FAISS | 高性能、纯内存 | 高速检索 | 低 |
| Qdrant | Rust 实现、功能丰富 | 中等规模生产 | 中 |
| Milvus | 分布式、高可用 | 大规模生产 | 高 |
| Weaviate | 混合检索、GraphQL | 多模态场景 | 中 |

### 使用 Qdrant 搭建向量库

```python
from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient

client = QdrantClient(url="http://localhost:6333")

vectorstore = Qdrant.from_documents(
    documents=chunks,
    embedding=embeddings,
    url="http://localhost:6333",
    collection_name="knowledge_base",
    force_recreate=True
)
```

---

## 五、检索策略

### 基础检索：Top-K

返回与查询最相似的 K 个文档片段。

```python
results = vectorstore.similarity_search(
    query="什么是RAG？",
    k=5,
    filter={"department": "技术部"}
)
```

### 多样性检索：MMR (Maximal Marginal Relevance)

在相关性和多样性之间取平衡，减少重复内容。

```python
results = vectorstore.max_marginal_relevance_search(
    query="什么是RAG？",
    k=5,
    fetch_k=20,
    lambda_mult=0.7   # 0=最大多样性，1=最大相关性
)
```

### 混合检索：向量 + 关键词

结合语义检索和关键词匹配，提升召回率。

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 10})
bm25_retriever = BM25Retriever.from_documents(chunks, k=10)

ensemble_retriever = EnsembleRetriever(
    retrievers=[vector_retriever, bm25_retriever],
    weights=[0.7, 0.3]
)
```

### Rerank 重排序

使用 Cross-Encoder 对初筛结果进行精排。

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain_cohere import CohereRerank

compressor = CohereRerank(top_n=5)
compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=ensemble_retriever
)
```

### 检索策略选择

```
简单场景 -> Top-K (k=5)
需要多样性 -> MMR (fetch_k=20, k=5)
需要高召回 -> 混合检索 (向量 + BM25)
追求精度 -> 混合检索 + Rerank
```

---

## 六、长文本处理

### Map-Reduce 策略

将长文本分成多个片段，分别处理后合并。

```
文档 -> 切片 -> 每个切片独立生成摘要 -> 合并所有摘要 -> 最终摘要
```

### Refine 策略

逐步精炼，每一步基于已有结果和新片段进行优化。

```
片段1 -> 摘要1 -> (摘要1 + 片段2) -> 摘要2 -> ... -> 最终摘要
```

### 策略选择

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Map-Reduce | 可并行、速度快 | 可能丢失跨片段信息 | 大量独立片段 |
| Refine | 上下文连贯、质量高 | 无法并行、较慢 | 需要连贯性的场景 |
| Stuff | 简单直接 | Token 限制 | 短文本 |

---

## 七、知识库更新管理

### 增量更新策略

```python
import hashlib

def get_doc_hash(content: str) -> str:
    return hashlib.md5(content.encode()).hexdigest()

def update_knowledge_base(new_docs, existing_hashes):
    for doc in new_docs:
        doc_hash = get_doc_hash(doc.page_content)
        if doc_hash not in existing_hashes:
            chunks = splitter.split_documents([doc])
            vectorstore.add_documents(chunks)
            existing_hashes.add(doc_hash)
```

### 版本管理

```python
collection_version = "v2_20240301"
collection_name = f"knowledge_base_{collection_version}"
# 灰度切换：新旧版本并行，逐步切流
```

---

## 八、实战项目：企业知识库问答系统

**目标**：搭建一个支持多文档格式的知识库问答系统。

**功能要求**：
1. 支持 PDF、Word、Markdown 格式的文档导入
2. 使用语义切片策略，chunk_size=500
3. 使用 bge-large-zh-v1.5 作为 Embedding 模型
4. 使用 Qdrant 作为向量数据库
5. 采用混合检索 + Rerank 策略
6. 支持基于元数据的过滤（按部门、文档类型）
7. 支持增量更新

**测试方案**：
- 导入 50 篇真实文档
- 准备 20 个测试问题及标准答案
- 对比不同切片策略和检索策略的准确率

---

## 练习题（待完成）

- [ ] 练习1：使用 LangChain 搭建一个完整的 RAG 管道，从文档加载到检索回答
- [ ] 练习2：对比 chunk_size=200 和 chunk_size=800 的检索效果差异
- [ ] 练习3：实现增量更新功能，能自动识别新增和变更的文档
- [ ] 练习4：对比 Top-K、MMR、混合检索三种策略在同一测试集上的准确率
