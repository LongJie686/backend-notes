# 第 3 讲：RAG 系统设计与实现

---

## 一、为什么需要 RAG？

先从一个真实场景开始。

---

### 场景 1：企业知识库问答

**你的老板说：**
> "我们有 5000 份内部文档，想让员工直接问 AI 就能得到答案，不用自己翻文档。"

**你的第一反应：**
> "好的，我把文档塞进 Prompt 里就行了。"

**现实问题：**

- GPT-4 的上下文窗口是 128K Token
- 5000 份文档 × 平均 2000 字 = 1000 万字
- 1000 万字 ≈ 1500 万 Token
- **远远超过上下文限制**

即使上下文够大：
- 每次查询都要发送 1500 万 Token
- 成本：1500 万 Token × $0.01/1000 Token = **$150/次查询**
- 完全不可行

---

### 场景 2：实时知识更新

**问题：**
- GPT-4 的训练数据截止到某个时间点
- 企业的政策、产品、数据每天都在变化
- 微调模型太慢、太贵
- 怎么让模型知道最新的信息？

---

### 场景 3：幻觉问题

**用户问：** "我们公司 2024 年的年假政策是什么？"

**没有 RAG 的模型：**
```
根据一般企业惯例，年假通常是 5-15 天，具体根据工作年限而定......
```
**（完全是编造的，不是你们公司的政策）**

**有 RAG 的模型：**
```
根据公司 2024 年人力资源政策文件第 3 条：
- 工作 1-3 年：10 天年假
- 工作 3-5 年：12 天年假
- 工作 5 年以上：15 天年假
```
**（基于真实文档回答）**

---

### RAG 解决的核心问题

```
+-------------------------------------------------------------+
|                    RAG 解决的问题                            |
+-------------------------------------------------------------+
|                                                              |
|  没有 RAG                       有 RAG                       |
|                                                              |
|  模型只知道训练数据              知道私有/最新知识            |
|  上下文长度限制                  按需检索，突破限制           |
|  幻觉严重                       基于真实文档，幻觉少         |
|  成本高                         只传相关片段，成本低         |
|  知识不可更新                    实时更新知识库               |
|                                                              |
+-------------------------------------------------------------+
```

---

## 二、RAG 的完整架构

RAG（Retrieval-Augmented Generation，检索增强生成）分为两个阶段：

```
+-------------------------------------------------------------+
|                         RAG 完整架构                         |
|                                                              |
|  +-------------------------------------------------------+  |
|  |                  阶段 1：索引构建                       |  |
|  |                                                        |  |
|  |  文档  ->  加载  ->  切分  ->  Embedding  ->  向量数据库 |  |
|  |                                                        |  |
|  +-------------------------------------------------------+  |
|                                                              |
|  +-------------------------------------------------------+  |
|  |                  阶段 2：查询生成                       |  |
|  |                                                        |  |
|  |  用户问题                                               |  |
|  |      |                                                  |  |
|  |  查询处理（改写/扩展）                                  |  |
|  |      |                                                  |  |
|  |  向量检索 + 关键词检索                                  |  |
|  |      |                                                  |  |
|  |  重排序                                                 |  |
|  |      |                                                  |  |
|  |  上下文构建                                             |  |
|  |      |                                                  |  |
|  |  大模型生成                                             |  |
|  |      |                                                  |  |
|  |  最终答案                                               |  |
|  |                                                        |  |
|  +-------------------------------------------------------+  |
|                                                              |
+-------------------------------------------------------------+
```

---

## 三、阶段 1：文档加载

---

### 1. 常见文档格式

| 格式 | 特点 | 处理难度 |
|------|------|---------|
| TXT | 纯文本，最简单 | 低 |
| Markdown | 有结构标记 | 低 |
| HTML | 网页内容 | 低 |
| PDF | 最常见，但解析复杂 | 高 |
| Word（DOCX） | Office 文档 | 中 |
| Excel（XLSX） | 表格数据 | 中 |
| PowerPoint | 幻灯片 | 中 |
| 图片（含文字） | 需要 OCR | 很高 |

---

### 2. 主流加载库

**Python 生态最常用的工具：**

```python
# LangChain 文档加载器（最全）
from langchain.document_loaders import (
    TextLoader,           # TXT
    PyPDFLoader,          # PDF（简单）
    PDFPlumberLoader,     # PDF（复杂，支持表格）
    UnstructuredPDFLoader,# PDF（非结构化）
    Docx2txtLoader,       # Word
    UnstructuredExcelLoader, # Excel
    WebBaseLoader,        # 网页
    DirectoryLoader,      # 整个目录
    CSVLoader,            # CSV
)

# 独立库
import pdfplumber    # PDF 处理，支持表格
import pypdf         # PDF 处理
import python-docx   # Word 处理
import pandas        # Excel/CSV
```

---

### 3. 各类文档的加载实践

#### TXT 文档

```python
from langchain.document_loaders import TextLoader

loader = TextLoader("document.txt", encoding="utf-8")
documents = loader.load()

# documents 是 List[Document]
# 每个 Document 有两个属性：
# - page_content: str （文本内容）
# - metadata: dict （元数据，如来源、页码等）

print(documents[0].page_content)
print(documents[0].metadata)
# {'source': 'document.txt'}
```

---

#### PDF 文档（重点）

PDF 是企业中最常见的格式，但也是最难处理的。

**常见问题：**
- 扫描版 PDF（图片 PDF，需要 OCR）
- 复杂布局（多栏、图表）
- 表格解析（行列关系丢失）
- 页眉页脚干扰

**方法 1：PyPDF（简单、快速）**

```python
from langchain.document_loaders import PyPDFLoader

loader = PyPDFLoader("company_policy.pdf")
pages = loader.load()

# 每页是一个 Document
for page in pages:
    print(f"页码: {page.metadata['page']}")
    print(f"内容: {page.page_content[:100]}")
```

**方法 2：PDFPlumber（支持表格）**

```python
import pdfplumber

def load_pdf_with_tables(pdf_path: str) -> list:
    documents = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            # 提取文本
            text = page.extract_text() or ""

            # 提取表格
            tables = page.extract_tables()
            for table in tables:
                # 把表格转成文本描述
                table_text = table_to_text(table)
                text += "\n" + table_text

            documents.append({
                "content": text,
                "metadata": {
                    "source": pdf_path,
                    "page": page_num + 1
                }
            })

    return documents

def table_to_text(table: list) -> str:
    """把表格数据转成文字描述"""
    if not table:
        return ""

    headers = table[0]
    rows = table[1:]

    text_parts = []
    for row in rows:
        row_text = " | ".join([
            f"{headers[i]}: {cell}"
            for i, cell in enumerate(row)
            if cell and i < len(headers)
        ])
        text_parts.append(row_text)

    return "\n".join(text_parts)
```

**方法 3：扫描 PDF（需要 OCR）**

```python
# 使用 pytesseract OCR
import pytesseract
from pdf2image import convert_from_path
from PIL import Image

def load_scanned_pdf(pdf_path: str) -> list:
    # 把 PDF 转成图片
    images = convert_from_path(pdf_path)

    documents = []
    for page_num, image in enumerate(images):
        # OCR 识别
        text = pytesseract.image_to_string(image, lang='chi_sim+eng')

        documents.append({
            "content": text,
            "metadata": {
                "source": pdf_path,
                "page": page_num + 1,
                "is_ocr": True
            }
        })

    return documents
```

---

#### Markdown 文档

```python
from langchain.document_loaders import TextLoader
import re

def load_markdown(file_path: str) -> list:
    """加载 Markdown 并保留结构信息"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 按标题切分，保留层级信息
    sections = []
    current_section = {"title": "", "level": 0, "content": ""}

    for line in content.split('\n'):
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading_match:
            if current_section["content"].strip():
                sections.append(current_section.copy())

            level = len(heading_match.group(1))
            current_section = {
                "title": heading_match.group(2),
                "level": level,
                "content": line + "\n"
            }
        else:
            current_section["content"] += line + "\n"

    if current_section["content"].strip():
        sections.append(current_section)

    return sections
```

---

#### 整个目录批量加载

```python
from langchain.document_loaders import DirectoryLoader
from langchain.document_loaders import TextLoader

def load_directory(dir_path: str) -> list:
    """批量加载目录下的所有文档"""

    # 加载 TXT 文件
    txt_loader = DirectoryLoader(
        dir_path,
        glob="**/*.txt",
        loader_cls=TextLoader,
        loader_kwargs={"encoding": "utf-8"}
    )

    # 加载 PDF 文件
    from langchain.document_loaders import PyPDFLoader
    pdf_loader = DirectoryLoader(
        dir_path,
        glob="**/*.pdf",
        loader_cls=PyPDFLoader
    )

    # 加载 Markdown 文件
    md_loader = DirectoryLoader(
        dir_path,
        glob="**/*.md",
        loader_cls=TextLoader,
        loader_kwargs={"encoding": "utf-8"}
    )

    documents = []
    for loader in [txt_loader, pdf_loader, md_loader]:
        try:
            docs = loader.load()
            documents.extend(docs)
            print(f"加载了 {len(docs)} 个文档")
        except Exception as e:
            print(f"加载失败: {e}")

    return documents
```

---

### 4. 文档加载的最佳实践

```python
class DocumentLoader:
    """统一的文档加载器"""

    def __init__(self):
        self.supported_formats = {
            '.txt': self._load_txt,
            '.pdf': self._load_pdf,
            '.md': self._load_markdown,
            '.docx': self._load_docx,
        }

    def load(self, file_path: str) -> list:
        """根据文件类型选择合适的加载器"""
        suffix = Path(file_path).suffix.lower()

        if suffix not in self.supported_formats:
            raise ValueError(f"不支持的文件格式: {suffix}")

        # 加载文档
        documents = self.supported_formats[suffix](file_path)

        # 统一添加元数据
        for doc in documents:
            doc.metadata.update({
                'file_path': file_path,
                'file_name': Path(file_path).name,
                'file_type': suffix,
                'load_time': datetime.now().isoformat()
            })

        # 清洗内容
        documents = [self._clean(doc) for doc in documents]

        # 过滤空文档
        documents = [doc for doc in documents if doc.page_content.strip()]

        return documents

    def _clean(self, doc) -> Document:
        """清洗文档内容"""
        content = doc.page_content

        # 去除多余空白
        content = re.sub(r'\n{3,}', '\n\n', content)
        content = re.sub(r' {2,}', ' ', content)

        # 去除页眉页脚（可根据具体文档调整）
        content = re.sub(r'第\d+页.*?\n', '', content)

        # 去除特殊字符
        content = content.strip()

        doc.page_content = content
        return doc
```

---

## 四、阶段 2：文档切分（Chunking）

**这是 RAG 中最关键、最容易出问题的环节。**

---

### 1. 为什么需要切分？

**问题 1：文档太长，超过 Embedding 模型的限制**
- 大多数 Embedding 模型最多处理 512-8192 Token
- 一篇 5 万字的文档无法直接 Embedding

**问题 2：检索精度问题**
- 文档太长 -> Embedding 太笼统 -> 检索不精准
- 需要切成粒度合适的小块

**问题 3：上下文窗口限制**
- 检索结果会放入上下文
- 太大的块会占满上下文

---

### 2. 切分的核心矛盾

```
切太细                              切太粗
  |                                   |
信息碎片化                          信息冗余
单个块缺少上下文                    检索不精准
检索结果可能不完整                  Token 消耗大
                    |
               需要找平衡点
```

**关键指标：**
- **Chunk Size（块大小）**：每个块的 Token 数
- **Chunk Overlap（重叠）**：相邻块之间重叠的 Token 数

---

### 3. 切分策略详解

---

#### 策略 1：固定长度切分（Fixed Size Chunking）

**最简单的方式：按固定 Token 数切分。**

```python
from langchain.text_splitter import CharacterTextSplitter, TokenTextSplitter

# 按字符数切分
char_splitter = CharacterTextSplitter(
    chunk_size=500,      # 每块 500 字符
    chunk_overlap=50,    # 重叠 50 字符
    separator="\n"       # 优先在换行处切分
)

# 按 Token 数切分（更精准）
token_splitter = TokenTextSplitter(
    chunk_size=512,      # 每块 512 Token
    chunk_overlap=50,    # 重叠 50 Token
)

chunks = char_splitter.split_documents(documents)
```

| 优点 | 缺点 |
|------|------|
| 实现简单 | 可能在句子中间切断 |
| 块大小可控 | 不考虑语义边界 |

**适用场景：** 结构比较规整的文档、快速验证

---

#### 策略 2：递归字符切分（Recursive Character Splitter）

**LangChain 最推荐的默认切分方式。**

**核心思想：** 按照优先级依次尝试不同的分隔符。

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=[
        "\n\n",   # 优先在段落处切
        "\n",     # 其次在换行处切
        "。",     # 再次在句号处切
        "！",     # 感叹号
        "？",     # 问号
        "；",     # 分号
        "，",     # 逗号
        " ",      # 空格
        "",       # 最后按字符切
    ]
)

chunks = splitter.split_documents(documents)
```

**工作流程：**

```
文档
  |
尝试按 \n\n 切分
  |
如果某块还是太大
  |
尝试按 \n 切分
  |
还是太大
  |
按句号切分
  |
......依此类推
```

| 优点 | 缺点 |
|------|------|
| 尽量保持语义完整 | 块大小不完全一致 |
| 优先在自然边界切分 | 配置稍复杂 |

**适用场景：** 大多数文本文档，**最常用的默认方案**

---

#### 策略 3：按语义切分（Semantic Chunking）

**核心思想：** 通过计算句子之间的 Embedding 相似度，在语义断点处切分。

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain.embeddings import OpenAIEmbeddings

# 需要 Embedding 模型
embeddings = OpenAIEmbeddings()

semantic_splitter = SemanticChunker(
    embeddings=embeddings,
    breakpoint_threshold_type="percentile",  # 断点判断方式
    breakpoint_threshold_amount=95           # 阈值
)

chunks = semantic_splitter.split_documents(documents)
```

| 优点 | 缺点 |
|------|------|
| 语义完整性最好 | 需要额外的 Embedding 计算（慢、有成本） |
| 切分位置最合理 | 块大小不可控 |

**适用场景：** 叙事性文本、对检索质量要求极高的场景

---

#### 策略 4：按文档结构切分

**核心思想：** 利用文档本身的结构（标题、章节）切分。

```python
from langchain.text_splitter import MarkdownHeaderTextSplitter

# 按 Markdown 标题层级切分
markdown_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "H1"),     # 一级标题
        ("##", "H2"),    # 二级标题
        ("###", "H3"),   # 三级标题
    ]
)

# 切分结果会在 metadata 中记录标题层级
chunks = markdown_splitter.split_text(markdown_content)

# 每个 chunk 的 metadata 类似：
# {"H1": "产品介绍", "H2": "功能特性", "H3": "核心功能"}
```

| 优点 | 适用场景 |
|------|---------|
| 保留文档结构信息 | Markdown 技术文档 |
| 检索结果附带章节信息 | HTML 网页 |
| 对结构化文档效果最好 | 有明确章节结构的文档 |

---

#### 策略 5：父子切分（Parent Document Retriever）

**核心思想：** 存储小块用于检索，返回大块用于生成。

```
文档
  |
切成父块（大块，500-1000 Token）
  |
再切成子块（小块，100-200 Token）
  |
索引子块的 Embedding（小块检索更精准）
  |
检索时：用子块 Embedding 找到相关子块
  |
返回时：返回子块对应的父块（信息更完整）
```

```python
from langchain.retrievers import ParentDocumentRetriever
from langchain.storage import InMemoryStore
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import Chroma

# 父块切分器（大块）
parent_splitter = RecursiveCharacterTextSplitter(
    chunk_size=2000,
    chunk_overlap=200
)

# 子块切分器（小块）
child_splitter = RecursiveCharacterTextSplitter(
    chunk_size=400,
    chunk_overlap=50
)

# 向量存储（存子块的 Embedding）
vectorstore = Chroma(
    collection_name="child_chunks",
    embedding_function=embeddings
)

# 文档存储（存父块的原文）
docstore = InMemoryStore()

# 父子检索器
retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,
    docstore=docstore,
    child_splitter=child_splitter,
    parent_splitter=parent_splitter,
)

# 添加文档
retriever.add_documents(documents)

# 检索（用子块找，返回父块）
results = retriever.get_relevant_documents("用户的问题")
```

**优点：** 检索精准度和信息完整性兼顾
**缺点：** 实现复杂，存储需求翻倍
**适用场景：** 高质量要求的知识库

---

### 4. 切分参数怎么选？

**Chunk Size 选择指南：**

| 场景 | 建议 Chunk Size | 原因 |
|------|----------------|------|
| 技术文档/FAQ | 300-500 Token | 答案通常简短精确 |
| 报告/分析文章 | 500-800 Token | 需要一定上下文 |
| 书籍/长文 | 800-1200 Token | 内容连贯性强 |
| 代码文件 | 按函数/类切分 | 保持代码完整性 |

**Chunk Overlap 选择指南：**

- 通常是 Chunk Size 的 10%-20%
- Chunk Size 500 -> Overlap 50-100
- Overlap 太小：相邻块之间信息断裂
- Overlap 太大：冗余信息多，浪费空间

---

### 5. 切分质量评估

```python
def evaluate_chunks(chunks: list) -> dict:
    """评估切分质量"""

    sizes = [len(chunk.page_content) for chunk in chunks]

    return {
        "total_chunks": len(chunks),
        "avg_size": sum(sizes) / len(sizes),
        "min_size": min(sizes),
        "max_size": max(sizes),
        "empty_chunks": sum(1 for s in sizes if s < 50),
        "huge_chunks": sum(1 for s in sizes if s > 2000),
    }

# 输出示例
# {
#   "total_chunks": 856,
#   "avg_size": 423,
#   "min_size": 12,      <- 太小，可能是噪音
#   "max_size": 1823,    <- 太大，可能切分不合理
#   "empty_chunks": 3,   <- 空块，需要过滤
#   "huge_chunks": 12    <- 超大块，需要检查
# }
```

---

## 五、阶段 3：Embedding 与向量化

---

### 1. Embedding 的工作原理（回顾）

```python
from langchain.embeddings import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    model="text-embedding-3-small",
    api_key="your-api-key"
)

# 单个文本 Embedding
vector = embeddings.embed_query("今天天气怎么样？")
print(f"向量维度: {len(vector)}")  # 1536

# 批量 Embedding（推荐，更高效）
texts = ["文本1", "文本2", "文本3"]
vectors = embeddings.embed_documents(texts)
```

---

### 2. 主流 Embedding 模型对比

#### OpenAI 系列

```python
from langchain.embeddings import OpenAIEmbeddings

# text-embedding-3-small（推荐，性价比高）
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
# 维度：1536，价格：$0.02/1M Token

# text-embedding-3-large（效果最好，较贵）
embeddings = OpenAIEmbeddings(model="text-embedding-3-large")
# 维度：3072，价格：$0.13/1M Token
```

#### BGE 系列（中文首选）

```python
from langchain.embeddings import HuggingFaceEmbeddings

# BGE-large-zh（中文效果最好）
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-large-zh-v1.5",
    model_kwargs={"device": "cuda"},
    encode_kwargs={"normalize_embeddings": True}
)
# 维度：1024，本地运行，无 API 费用

# BGE-m3（多语言，支持长文本）
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-m3",
    model_kwargs={"device": "cuda"}
)
# 维度：1024，最大 8192 Token
```

#### M3E（中文优化）

```python
from langchain.embeddings import HuggingFaceEmbeddings

embeddings = HuggingFaceEmbeddings(
    model_name="moka-ai/m3e-base",
    model_kwargs={"device": "cpu"},  # CPU 也能跑
)
# 维度：768，轻量级
```

---

### 3. Embedding 模型选型决策

```
是否需要私有化部署？
  |
  +-- 是 --> 开源模型
  |          中文为主：BGE
  |          多语言：BGE-m3
  |          轻量：M3E
  |
  +-- 否 --> 是否以中文为主？
              |
              +-- 是 --> BGE 系列 或 混合 OpenAI
              +-- 否 --> OpenAI text-embedding-3-small
```

---

### 4. Embedding 的工程优化

#### 批量处理

```python
def batch_embed_documents(
    texts: List[str],
    embeddings_model,
    batch_size: int = 100
) -> List[List[float]]:
    """批量 Embedding，避免一次性发太多请求"""

    all_vectors = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]

        try:
            vectors = embeddings_model.embed_documents(batch)
            all_vectors.extend(vectors)
            print(f"进度: {min(i + batch_size, len(texts))}/{len(texts)}")
            time.sleep(0.1)  # 防止 API 限流
        except Exception as e:
            print(f"第 {i} 批失败: {e}")
            time.sleep(5)
            vectors = embeddings_model.embed_documents(batch)
            all_vectors.extend(vectors)

    return all_vectors
```

#### 缓存

```python
import hashlib
import pickle
from pathlib import Path

class CachedEmbeddings:
    """带缓存的 Embedding，避免重复计算"""

    def __init__(self, embeddings_model, cache_dir: str = ".embedding_cache"):
        self.model = embeddings_model
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

    def _get_cache_key(self, text: str) -> str:
        return hashlib.md5(text.encode()).hexdigest()

    def embed_query(self, text: str) -> List[float]:
        cache_key = self._get_cache_key(text)
        cache_file = self.cache_dir / f"{cache_key}.pkl"

        if cache_file.exists():
            with open(cache_file, 'rb') as f:
                return pickle.load(f)

        vector = self.model.embed_query(text)
        with open(cache_file, 'wb') as f:
            pickle.dump(vector, f)

        return vector
```

---

## 六、阶段 4：向量数据库

---

### 1. 向量数据库是什么？

**传统数据库：** 精确匹配（WHERE id = 123）

**向量数据库：** 相似度检索（找出最像这个向量的 TOP-K 个向量）

**核心能力：** 存储向量、高效的近似最近邻（ANN）搜索、元数据过滤、支持海量数据

---

### 2. 主流向量数据库对比

| 数据库 | 类型 | 优点 | 缺点 | 适用场景 |
|--------|------|------|------|---------|
| **FAISS** | 本地库 | 极快、轻量 | 无持久化、无分布式 | 本地实验 |
| **Chroma** | 本地/服务 | 简单易用、Python友好 | 大规模性能一般 | 开发测试 |
| **Milvus** | 分布式 | 企业级、高性能 | 部署复杂 | 生产大规模 |
| **Weaviate** | 分布式 | 功能全、GraphQL | 资源消耗大 | 生产中规模 |
| **Pinecone** | 云服务 | 全托管、简单 | 收费、数据出境 | 快速上线 |
| **Qdrant** | 本地/云 | 高性能、Rust实现 | 社区相对小 | 生产部署 |
| **PGVector** | PostgreSQL插件 | 无需新系统 | 性能不如专业向量库 | 已有PG的项目 |

---

### 3. FAISS（本地实验首选）

```python
from langchain.vectorstores import FAISS
from langchain.embeddings import OpenAIEmbeddings

embeddings = OpenAIEmbeddings()

# 从文档创建
vectorstore = FAISS.from_documents(
    documents=chunks,
    embedding=embeddings
)

# 保存到本地
vectorstore.save_local("faiss_index")

# 从本地加载
vectorstore = FAISS.load_local(
    "faiss_index",
    embeddings=embeddings,
    allow_dangerous_deserialization=True
)

# 相似度搜索
results = vectorstore.similarity_search(query="用户的问题", k=5)

# 带分数的搜索
results_with_scores = vectorstore.similarity_search_with_score(
    query="用户的问题", k=5
)
```

---

### 4. Chroma（开发测试推荐）

```python
from langchain.vectorstores import Chroma

vectorstore = Chroma(
    collection_name="my_knowledge_base",
    embedding_function=embeddings,
    persist_directory="./chroma_db"
)

# 添加文档
vectorstore.add_documents(chunks)
vectorstore.persist()

# 相似度搜索
results = vectorstore.similarity_search(
    query="年假政策是什么？",
    k=5,
    filter={"department": "HR"}  # 元数据过滤
)

# 最大边际相关性搜索（减少冗余结果）
results = vectorstore.max_marginal_relevance_search(
    query="年假政策是什么？",
    k=5,
    fetch_k=20,
    lambda_mult=0.5
)
```

---

### 5. Milvus（生产环境推荐）

```python
from pymilvus import connections, Collection, FieldSchema, CollectionSchema, DataType

# 连接 Milvus
connections.connect(alias="default", host="localhost", port="19530")

# 定义 Schema
fields = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
    FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=65535),
    FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=255),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
]

schema = CollectionSchema(fields=fields, description="知识库")
collection = Collection(name="knowledge_base", schema=schema)

# 创建索引
index_params = {
    "metric_type": "COSINE",
    "index_type": "IVF_FLAT",
    "params": {"nlist": 1024}
}
collection.create_index(field_name="embedding", index_params=index_params)
```

---

## 七、阶段 5：检索策略

**这是 RAG 质量的核心决定因素。**

---

### 1. 三种检索方式

| 方式 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **稠密检索 (Dense)** | 向量相似度 | 理解语义、处理同义词 | 专有名词效果差 |
| **稀疏检索 (Sparse/BM25)** | 关键词匹配 | 精确词匹配、效率高 | 不理解语义 |
| **混合检索 (Hybrid)** | 两者融合 | 优势互补，效果最好 | 实现稍复杂 |

---

### 2. 稠密检索（Dense Retrieval）

就是向量相似度搜索。

**例子：**
- 查询："怎么请假"
- 能找到："年假申请流程"（虽然词不同，但语义相关）

---

### 3. 稀疏检索（BM25）

**BM25（Best Match 25）** 是经典的关键词检索算法。

```python
from langchain.retrievers import BM25Retriever

bm25_retriever = BM25Retriever.from_documents(
    documents=chunks,
    k=5
)

results = bm25_retriever.get_relevant_documents("年假申请")
```

**例子：**
- 查询："API 接口文档"
- 精确找到包含"API"、"接口"、"文档"的内容

---

### 4. 混合检索（Hybrid Search）

```python
from langchain.retrievers import EnsembleRetriever

# 稠密检索器
dense_retriever = vectorstore.as_retriever(search_kwargs={"k": 10})

# 稀疏检索器
bm25_retriever = BM25Retriever.from_documents(documents=chunks, k=10)

# 混合检索器
hybrid_retriever = EnsembleRetriever(
    retrievers=[dense_retriever, bm25_retriever],
    weights=[0.6, 0.4]  # 向量检索权重 0.6，BM25 权重 0.4
)

results = hybrid_retriever.get_relevant_documents("用户问题")
```

**Reciprocal Rank Fusion（RRF）融合算法：**

```python
def reciprocal_rank_fusion(results_list: List[List[Document]], k: int = 60) -> List[Document]:
    scores = {}
    for results in results_list:
        for rank, doc in enumerate(results):
            doc_id = doc.page_content
            if doc_id not in scores:
                scores[doc_id] = {"doc": doc, "score": 0}
            scores[doc_id]["score"] += 1 / (k + rank + 1)

    sorted_results = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
    return [item["doc"] for item in sorted_results]
```

**实践中，混合检索几乎总是比单一检索效果好。**

---

### 5. 查询改写与扩展

#### 查询改写

```python
def rewrite_query(query: str, llm) -> str:
    prompt = f"""将以下问题改写为更适合文档检索的查询。
保留关键信息，使用专业术语，去掉无关词语。
只输出改写后的查询，不要解释。

原始问题：{query}
改写后的查询："""
    return llm.predict(prompt)
```

#### 多查询扩展

```python
def generate_multiple_queries(query: str, llm, n: int = 3) -> List[str]:
    prompt = f"""请从不同角度改写以下问题，生成 {n} 个不同的查询表达。

原始问题：{query}

请生成 {n} 个不同的查询（每行一个，不要编号）："""
    response = llm.predict(prompt)
    queries = [q.strip() for q in response.strip().split('\n') if q.strip()]
    return queries[:n]
```

#### HyDE（假设文档嵌入）

**核心思想：** 先让 LLM 生成一个假设的答案文档，用这个文档去检索。

```python
def hyde_retrieval(query: str, llm, vectorstore) -> List[Document]:
    # 让 LLM 生成假设答案
    hypothesis_prompt = f"""请根据以下问题，写一段假设性的答案文档。
这个文档可能不是完全准确的，但要涵盖关键概念和术语。

问题：{query}

假设文档："""
    hypothetical_doc = llm.predict(hypothesis_prompt)

    # 用假设文档的 Embedding 去检索
    results = vectorstore.similarity_search(hypothetical_doc, k=5)
    return results
```

---

## 八、阶段 6：重排序（Reranking）

---

### 1. 为什么需要重排序？

向量检索只能保证大致相关，排名第 1 的不一定是最相关的。用更强大的模型对结果重新排序可以显著提升准确率。

**两阶段流程：**

```
用户查询
    |
向量检索（快，召回 TOP-20）
    |
Cross-Encoder 重排序（精准，从 20 选 5）
    |
TOP-5 最终结果
```

---

### 2. Cross-Encoder 重排序

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-large", device="cuda")

def rerank(query: str, documents: List[Document], top_k: int = 5) -> List[Document]:
    pairs = [(query, doc.page_content) for doc in documents]
    scores = reranker.predict(pairs)
    scored_docs = list(zip(documents, scores))
    scored_docs.sort(key=lambda x: x[1], reverse=True)
    return [doc for doc, score in scored_docs[:top_k]]

# 使用
candidates = vectorstore.similarity_search(query, k=20)  # 先召回 20 个
final_results = rerank(query, candidates, top_k=5)       # 重排序取前 5
```

---

### 3. Cohere Rerank（API 服务）

```python
import cohere

co = cohere.Client("your-api-key")

def cohere_rerank(query: str, documents: List[str], top_k: int = 5) -> list:
    results = co.rerank(
        query=query,
        documents=documents,
        top_n=top_k,
        model="rerank-multilingual-v2.0"  # 支持中文
    )
    return results.results
```

---

### 4. 什么时候必须用重排序？

- 对检索准确率要求高的场景（法律、医疗、金融）
- 知识库文档量大（> 10 万块）
- 用户反馈"找不到想要的答案"
- 检索结果中有明显的不相关内容

---

## 九、阶段 7：上下文构建与生成

---

### 1. 上下文构建

```python
def build_context(retrieved_docs: List[Document], max_tokens: int = 3000) -> str:
    context_parts = []
    total_length = 0

    for i, doc in enumerate(retrieved_docs):
        source = doc.metadata.get("source", "未知来源")
        chunk_text = f"""【参考资料 {i+1}】
来源：{source}
内容：{doc.page_content}
"""
        if total_length + len(chunk_text) > max_tokens * 4:
            break

        context_parts.append(chunk_text)
        total_length += len(chunk_text)

    return "\n".join(context_parts)
```

---

### 2. RAG Prompt 设计

```python
RAG_PROMPT = """你是一个知识库问答助手。

请根据以下参考资料回答用户的问题。

# 参考资料
{context}

# 回答规则
1. 只根据参考资料中的信息回答
2. 如果参考资料中没有相关信息，明确说"根据现有资料，我无法回答这个问题"
3. 回答时标注信息来自哪个参考资料
4. 不要编造参考资料中没有的信息
5. 回答要简洁、准确

# 用户问题
{question}

# 回答
"""
```

---

### 3. 完整 RAG 流水线

```python
class RAGPipeline:
    """完整的 RAG 流水线"""

    def __init__(self, vectorstore, llm, embeddings, reranker=None,
                 top_k_retrieve=20, top_k_rerank=5):
        self.vectorstore = vectorstore
        self.llm = llm
        self.embeddings = embeddings
        self.reranker = reranker
        self.top_k_retrieve = top_k_retrieve
        self.top_k_rerank = top_k_rerank

    def retrieve(self, query: str) -> List[Document]:
        rewritten_query = self._rewrite_query(query)

        dense_results = self.vectorstore.similarity_search(
            rewritten_query, k=self.top_k_retrieve
        )
        bm25_results = self.bm25_retriever.get_relevant_documents(rewritten_query)

        candidates = reciprocal_rank_fusion([dense_results, bm25_results])

        if self.reranker:
            candidates = rerank(query, candidates, self.top_k_rerank)
        else:
            candidates = candidates[:self.top_k_rerank]

        return candidates

    def generate(self, question: str, retrieved_docs: List[Document]) -> str:
        context = build_context(retrieved_docs)
        return generate_answer(question, context, self.llm)

    def run(self, question: str) -> dict:
        retrieved_docs = self.retrieve(question)
        answer = self.generate(question, retrieved_docs)

        return {
            "question": question,
            "answer": answer,
            "sources": [
                {
                    "content": doc.page_content[:200],
                    "source": doc.metadata.get("source", ""),
                }
                for doc in retrieved_docs
            ]
        }
```

---

## 十、RAG 常见问题与解决方案

---

### 问题 1：检索到了，但答案不对

**原因：**
1. 检索结果里相关内容被不相关内容稀释
2. 上下文顺序不对
3. Prompt 没有强调要基于资料回答
4. 文档切分把关键信息切断了

**解决方案：**

```python
# 相关内容放在显著位置
def build_context_ordered(docs: List[Document]) -> str:
    """最相关的放在开头"""
    return "\n\n".join([doc.page_content for doc in docs])

# 加强 Prompt 约束
prompt = """严格基于以下参考资料回答，不允许使用参考资料之外的信息：

{context}

问题：{question}

请先找到参考资料中与问题最相关的句子，然后基于这些句子回答。"""

# 让模型先引用再回答
prompt = """根据参考资料回答问题。
回答格式：
1. 引用：[引用参考资料中的原文]
2. 回答：[基于引用的回答]

参考资料：{context}
问题：{question}"""
```

---

### 问题 2：检索结果不相关

| 原因 | 解决 |
|------|------|
| Embedding 模型选错了 | 换更适合业务领域的模型 |
| 文档切分粒度不合适 | 调整 chunk_size |
| 查询太短或太模糊 | 查询改写/扩展 |
| 只用了向量检索 | 改用混合检索 |
| 知识库质量问题 | 清洗文档，去除噪音 |

---

### 问题 3：模型不根据检索结果回答，还在编造

**原因：** Prompt 约束不够强、检索结果不够相关、Temperature 太高

```python
strict_prompt = """
你是一个知识库问答助手，必须且只能根据提供的参考资料回答问题。

# 严格规则（必须遵守）
1. 如果参考资料中包含答案，请直接引用相关内容并回答
2. 如果参考资料中没有答案，必须回复："根据现有资料，我没有找到相关信息"
3. 绝对禁止根据自己的知识编造答案
4. 绝对禁止假设或推测资料中没有的内容

# 参考资料
{context}

# 问题
{question}

# 你的回答（必须基于参考资料）
"""
```

---

### 问题 4：上下文太长导致超出窗口

```python
def smart_context_truncation(docs: List[Document], max_tokens: int) -> List[Document]:
    """智能截断：保留最相关的内容"""
    selected_docs = []
    total_tokens = 0

    for doc in docs:
        doc_tokens = len(doc.page_content) // 4

        if total_tokens + doc_tokens > max_tokens:
            remaining = max_tokens - total_tokens
            if remaining > 200:
                doc.page_content = doc.page_content[:remaining * 4]
                selected_docs.append(doc)
            break

        selected_docs.append(doc)
        total_tokens += doc_tokens

    return selected_docs
```

---

### 问题 5：RAG 响应太慢

**性能分析：**

```
RAG 延迟组成：
1. 查询 Embedding：50-200ms
2. 向量检索：10-100ms
3. 重排序：200-500ms（如果有）
4. LLM 生成：1000-5000ms
总计：1.5-6秒
```

**优化策略：**

```python
# 策略 1：并行化
async def parallel_retrieve(query: str) -> List[Document]:
    dense_task = asyncio.create_task(dense_search(query))
    bm25_task = asyncio.create_task(bm25_search(query))
    dense_results, bm25_results = await asyncio.gather(dense_task, bm25_task)
    return reciprocal_rank_fusion([dense_results, bm25_results])

# 策略 2：查询 Embedding 缓存
embedding_cache = {}

def cached_embed_query(query: str) -> List[float]:
    if query not in embedding_cache:
        embedding_cache[query] = embeddings.embed_query(query)
    return embedding_cache[query]

# 策略 3：流式输出（改善体验）
def stream_answer(question: str, context: str):
    for chunk in llm.stream(prompt.format(context=context, question=question)):
        yield chunk
```

---

## 十一、高级 RAG 技术

---

### 1. Self-RAG

**核心思想：** 让模型自己判断是否需要检索，以及检索结果是否可用。

```
用户问题
    |
模型判断：需要检索吗？
    +-- 不需要 -> 直接回答（简单常识问题）
    +-- 需要 -> 执行检索
                |
            模型判断：检索结果相关吗？
                +-- 相关 -> 基于结果生成答案
                |           |
                |       模型评估：答案支持度高吗？
                |           +-- 高 -> 输出
                |           +-- 低 -> 重新检索
                +-- 不相关 -> 重新检索或拒绝回答
```

---

### 2. 知识图谱增强 RAG

```
文档
  |
实体提取（人名、公司、产品、事件）
  |
关系提取（A 是 B 的产品，C 收购了 D）
  |
构建知识图谱
  |
查询时：向量检索 + 图谱遍历 -> 更丰富的上下文
```

**优点：** 处理多跳推理问题，关系查询更准确

---

### 3. 多轮对话 RAG

```python
class ConversationalRAG:
    """支持多轮对话的 RAG"""

    def __init__(self, rag_pipeline, llm):
        self.pipeline = rag_pipeline
        self.llm = llm
        self.history = []

    def chat(self, user_message: str) -> str:
        # 结合对话历史，重写当前问题
        standalone_question = self._create_standalone_question(
            user_message, self.history
        )

        result = self.pipeline.run(standalone_question)

        self.history.append({
            "human": user_message,
            "ai": result["answer"]
        })

        return result["answer"]

    def _create_standalone_question(self, question: str, history: list) -> str:
        """把对话历史中的指代词还原为完整问题"""
        if not history:
            return question

        history_text = "\n".join([
            f"用户：{h['human']}\n助手：{h['ai']}"
            for h in history[-3:]
        ])

        prompt = f"""根据以下对话历史，将用户的最新问题改写为独立的、完整的问题。

对话历史：
{history_text}

用户最新问题：{question}

改写后的独立问题（只输出问题，不要解释）："""

        return self.llm.predict(prompt).strip()
```

---

## 十二、RAG 评估体系

---

### 1. 评估维度

| 维度 | 含义 |
|------|------|
| **检索相关性** (Context Relevance) | 检索到的文档和问题的相关程度 |
| **答案忠实度** (Faithfulness) | 答案是否严格基于检索到的内容 |
| **答案相关性** (Answer Relevance) | 答案是否真正回答了用户的问题 |
| **答案正确性** (Answer Correctness) | 答案是否在事实上正确 |

---

### 2. 使用 RAGAS 评估

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_relevancy, context_recall
from datasets import Dataset

eval_data = {
    "question": ["公司年假政策是什么？", "如何申请报销？"],
    "answer": ["根据公司政策，工作1-3年有10天年假......", "报销需要填写费用报销单......"],
    "contexts": [["公司年假规定：工作1-3年......"], ["费用报销流程：1. 填写报销单......"]],
    "ground_truth": ["工作1-3年10天，3-5年12天，5年以上15天", "填写费用报销单并获得主管审批"]
}

dataset = Dataset.from_dict(eval_data)
result = evaluate(
    dataset,
    metrics=[faithfulness, answer_relevancy, context_relevancy, context_recall]
)

print(result)
# {'faithfulness': 0.85, 'answer_relevancy': 0.92,
#  'context_relevancy': 0.78, 'context_recall': 0.89}
```

---

## 十三、完整代码实战：企业知识库问答系统

```python
import os
from pathlib import Path
from typing import List
from langchain.document_loaders import DirectoryLoader, PyPDFLoader, TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import Chroma
from langchain.retrievers import BM25Retriever, EnsembleRetriever
from langchain.chat_models import ChatOpenAI
from langchain.schema import Document


class EnterpriseKnowledgeBase:
    """企业知识库问答系统"""

    def __init__(self, docs_dir: str, persist_dir: str = "./knowledge_base",
                 openai_api_key: str = None):
        self.docs_dir = docs_dir
        self.persist_dir = persist_dir

        self.embeddings = OpenAIEmbeddings(
            api_key=openai_api_key or os.getenv("OPENAI_API_KEY")
        )
        self.llm = ChatOpenAI(
            model="gpt-4",
            temperature=0.1,
            api_key=openai_api_key or os.getenv("OPENAI_API_KEY")
        )

        self.vectorstore = None
        self.bm25_retriever = None
        self.chunks = []

    # ==================== 索引构建 ====================

    def build_index(self, force_rebuild: bool = False):
        persist_path = Path(self.persist_dir)

        if persist_path.exists() and not force_rebuild:
            print("加载已有索引...")
            self._load_existing_index()
            return

        print("构建新索引...")
        documents = self._load_documents()
        print(f"加载了 {len(documents)} 个文档")

        self.chunks = self._split_documents(documents)
        print(f"切分为 {len(self.chunks)} 个块")

        self.vectorstore = Chroma.from_documents(
            documents=self.chunks,
            embedding=self.embeddings,
            persist_directory=self.persist_dir
        )
        self.vectorstore.persist()

        self.bm25_retriever = BM25Retriever.from_documents(self.chunks, k=10)
        print("索引构建完成！")

    def _load_documents(self) -> List[Document]:
        documents = []
        docs_path = Path(self.docs_dir)

        for pdf_file in docs_path.glob("**/*.pdf"):
            try:
                loader = PyPDFLoader(str(pdf_file))
                documents.extend(loader.load())
            except Exception as e:
                print(f"加载 PDF 失败 {pdf_file}: {e}")

        for text_file in docs_path.glob("**/*.txt"):
            try:
                loader = TextLoader(str(text_file), encoding="utf-8")
                documents.extend(loader.load())
            except Exception as e:
                print(f"加载文本失败 {text_file}: {e}")

        return [doc for doc in documents
                if doc.page_content.strip() and len(doc.page_content) > 50]

    def _split_documents(self, documents: List[Document]) -> List[Document]:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
            separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
        )
        return splitter.split_documents(documents)

    # ==================== 检索 ====================

    def retrieve(self, query: str, top_k: int = 5) -> List[Document]:
        refined_query = self._rewrite_query(query)

        dense_retriever = self.vectorstore.as_retriever(search_kwargs={"k": 15})

        if self.bm25_retriever:
            ensemble_retriever = EnsembleRetriever(
                retrievers=[dense_retriever, self.bm25_retriever],
                weights=[0.6, 0.4]
            )
            candidates = ensemble_retriever.get_relevant_documents(refined_query)
        else:
            candidates = dense_retriever.get_relevant_documents(refined_query)

        return candidates[:top_k]

    def _rewrite_query(self, query: str) -> str:
        prompt = f"""将以下问题改写为更适合文档检索的查询。
只输出改写后的查询，不要解释。

原始问题：{query}
改写后的查询："""
        try:
            return self.llm.predict(prompt).strip()
        except Exception:
            return query

    # ==================== 生成 ====================

    def generate(self, question: str, retrieved_docs: List[Document]) -> str:
        context_parts = []
        for i, doc in enumerate(retrieved_docs):
            source = doc.metadata.get("source", "未知")
            source_name = Path(source).name if source else "未知"
            context_parts.append(
                f"【资料{i+1}】（来源：{source_name}）\n{doc.page_content}"
            )

        context = "\n\n".join(context_parts)

        prompt = f"""你是企业知识库助手，请严格基于以下参考资料回答问题。

# 参考资料
{context}

# 回答规则
1. 只使用参考资料中的信息
2. 如果资料中没有答案，回复"根据现有资料，我没有找到相关信息，建议咨询相关部门"
3. 回答要简洁准确，适当引用原文
4. 不要编造任何信息

# 问题
{question}

# 回答"""

        return self.llm.predict(prompt)

    # ==================== 对话接口 ====================

    def ask(self, question: str) -> dict:
        if not self.vectorstore:
            raise RuntimeError("请先调用 build_index() 构建索引")

        retrieved_docs = self.retrieve(question)
        answer = self.generate(question, retrieved_docs)

        return {
            "question": question,
            "answer": answer,
            "sources": [
                {
                    "content": doc.page_content[:200] + "...",
                    "source": doc.metadata.get("source", ""),
                }
                for doc in retrieved_docs
            ]
        }

    def add_document(self, file_path: str):
        """动态添加文档"""
        if file_path.endswith(".pdf"):
            loader = PyPDFLoader(file_path)
        else:
            loader = TextLoader(file_path, encoding="utf-8")

        new_docs = loader.load()
        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
        new_chunks = splitter.split_documents(new_docs)

        self.vectorstore.add_documents(new_chunks)
        self.vectorstore.persist()
        print(f"成功添加文档：{file_path}，共 {len(new_chunks)} 个块")


# ==================== 使用示例 ====================

if __name__ == "__main__":
    kb = EnterpriseKnowledgeBase(
        docs_dir="./company_docs",
        persist_dir="./chroma_db",
    )

    kb.build_index()

    result = kb.ask("公司的年假政策是什么？")

    print(f"问题：{result['question']}")
    print(f"答案：{result['answer']}")
    for source in result['sources']:
        print(f"  - {source['source']}")
        print(f"    {source['content']}")
```

---

## 十四、核心要点总结

1. **RAG 解决三个核心问题** -- 私有知识、实时更新、幻觉控制

2. **RAG 两个阶段** -- 索引构建（离线）和查询生成（在线）

3. **文档切分是最关键的环节** -- 切得好坏直接影响检索质量

4. **递归切分是默认最优选择** -- 大多数场景用 RecursiveCharacterTextSplitter

5. **Chunk Size 影响检索精度** -- 太大太细都有问题，通常 300-800 Token

6. **Overlap 保证信息连续性** -- 通常是 Chunk Size 的 10-20%

7. **混合检索几乎总是比单一检索好** -- 稠密 + 稀疏，优势互补

8. **重排序大幅提升准确率** -- 两阶段：召回 20 个，重排取 5 个

9. **查询改写解决用户输入质量问题** -- 用户的问题往往模糊、简短

10. **RAG Prompt 要强约束** -- 明确告诉模型只用参考资料

11. **上下文构建要控制长度** -- 不能超出模型窗口，要保留最相关的

12. **用 RAGAS 量化评估效果** -- 不能只靠人工主观感受

13. **幻觉无法完全消除，但 RAG 能大幅降低** -- 基于真实文档的约束

14. **知识库要支持动态更新** -- 企业文档是不断变化的

---

## 十五、面试高频题

---

### Q1：什么是 RAG？为什么需要它？

> RAG（检索增强生成）是一种将信息检索和大模型生成结合的技术框架。
>
> **为什么需要：**
> 1. **私有知识** -- 大模型训练数据不包含企业内部知识
> 2. **知识截止** -- 模型不知道训练后的新信息
> 3. **幻觉问题** -- 纯大模型会编造信息
> 4. **成本控制** -- 比把所有文档塞进上下文便宜
>
> **核心流程：** 离线：文档 -> 切分 -> Embedding -> 向量数据库；在线：问题 -> 检索 -> 构建上下文 -> 生成答案

---

### Q2：文档切分有哪些策略？怎么选？

> | 策略 | 适用场景 | 特点 |
> |------|---------|------|
> | 固定长度 | 均匀文本 | 简单但可能切断语义 |
> | 递归切分 | 大多数场景（默认） | 优先在自然边界切 |
> | 语义切分 | 叙事性文本 | 效果好但慢、贵 |
> | 结构切分 | Markdown/HTML | 保留文档结构 |
> | 父子切分 | 高质量需求 | 精准+完整，但复杂 |
>
> **选型原则：** 默认用递归切分，有明显结构用结构切分，追求最佳质量用父子切分

---

### Q3：混合检索是什么？为什么比纯向量检索好？

> **混合检索：** 同时使用稠密检索（向量相似度）和稀疏检索（BM25 关键词），融合两种结果。
>
> 稠密检索优点：理解语义，处理同义词；缺点：专有名词效果差。
> 稀疏检索优点：精确词匹配；缺点：不理解语义。
>
> **混合之后优势互补，覆盖两类查询需求。** 融合算法通常用 RRF（Reciprocal Rank Fusion）。

---

### Q4：重排序是什么？为什么需要？

> **重排序：** 在初始检索后，用更强大的模型（Cross-Encoder）对候选结果重新排序。
>
> 向量检索是 Bi-Encoder（查询和文档分开编码，粒度粗），Cross-Encoder 把查询+文档拼接输入，交互更充分，精度高。
>
> **两阶段流程：** 向量检索召回 TOP-20（快）-> Cross-Encoder 重排序取 TOP-5（精）

---

### Q5：RAG 系统里检索到了但答案还是不对，怎么排查？

> **排查步骤：**
> 1. **确认检索质量** -- 打印检索结果，看是否包含答案。如果不包含是检索问题，如果包含是生成问题
> 2. **检索问题排查** -- 检查 Embedding 模型、切分粒度、是否需要查询改写、是否需要混合检索
> 3. **生成问题排查** -- Prompt 约束是否够强、上下文顺序、Temperature 是否太高
> 4. **常见解决** -- 加强 Prompt 约束、重排序提升结果质量、让模型先引用再回答

---

### Q6：向量数据库怎么选型？

> | 场景 | 推荐 | 原因 |
> |------|------|------|
> | 本地实验 | FAISS | 轻量、无需部署 |
> | 开发测试 | Chroma | 简单易用、有持久化 |
> | 生产小规模 | Qdrant | 高性能、易部署 |
> | 生产大规模 | Milvus | 企业级、分布式 |
> | 快速上线 | Pinecone | 全托管，无需运维 |
> | 已有 PostgreSQL | PGVector | 无需引入新系统 |

---

### Q7：如何评估 RAG 系统的效果？

> **四个核心指标：** 检索相关性、答案忠实度、答案相关性、答案正确性
>
> **评估方法：** 自动评估用 RAGAS 框架，LLM 评估用另一个模型打分，人工评估用黄金测试集
>
> **关键流程：** 构建测试集（问题+标准答案）-> 运行 RAG 系统 -> 对比输出和标准答案 -> 量化各项指标

---

### Q8：RAG 和微调怎么选？

> **用 RAG 的场景：** 需要访问大量外部知识、知识会频繁更新、需要引用来源、预算有限、快速上线
>
> **用微调的场景：** 需要改变模型的"风格"或"能力"、特定格式的输出、领域专有推理能力
>
> **两者结合：** 先微调让模型理解领域语言，再用 RAG 注入具体知识，效果最好

---

## 十六、练习题

---

### 练习 1：切分策略选择

**场景：** 你有以下几种文档需要构建 RAG 系统：

1. 一本 500 页的技术手册（PDF）
2. 公司内部 Wiki（Markdown 格式，有层级标题）
3. 客服历史对话记录（TXT，每行一段对话）
4. 法律合同文本（PDF，高度结构化）

**问题：** 对每种文档，你会选择什么切分策略？Chunk Size 大概设置多少？为什么？

---

### 练习 2：系统设计

**场景：** 你需要为一个律师事务所构建法律文件问答系统。

**要求：**
- 文档：5000 份合同、判例、法规（PDF）
- 答案必须准确，引用原文
- 需要支持多轮对话
- 每秒查询量：50 QPS

**请设计：** 整体架构、文档处理流程、检索策略、生成策略、评估方案

---

### 练习 3：问题排查

**场景：** 你的 RAG 系统上线后，用户反馈以下问题：

1. "问公司年假，结果给我返回了一堆出差报销的内容"
2. "明明文档里有答案，但 AI 说不知道"
3. "AI 的答案里有些信息在文档里根本没有"
4. "回答太慢了，要等 8 秒"

**请分析每个问题的最可能原因、排查思路和解决方案。**

---

### 练习 4：代码实现

**任务：** 实现一个简单的 RAG 系统，要求：

1. 支持 TXT 文件加载
2. 使用递归切分（Chunk Size = 500，Overlap = 50）
3. 使用 OpenAI Embedding
4. 使用 Chroma 向量数据库
5. 支持相似度检索（TOP-5）
6. 实现一个简单的问答 Prompt
7. 输出答案和来源

---

### 练习 5：开放题

1. 有人说"上下文窗口越来越大，RAG 以后就没用了"，你怎么看？

2. 如果你的用户问的是"张总最近说了什么"（需要实时信息），RAG 能解决吗？不能的话，怎么办？

3. 设计一个 RAG 系统的"冷启动"方案：刚开始文档只有 10 篇，怎么保证系统可用？

---

## 十七、下一讲预告

**第 4 讲：Agent 智能体与工具调用**

会讲：
- Agent 的本质与 ReAct 范式
- Function Calling 原理与实现
- 常用工具集成（搜索、数据库、代码执行）
- LangChain Agent 实战
- LangGraph 工作流编排
- 多 Agent 协作架构
- Agent 的可控性与护栏设计
- 面试高频题

**预习建议：**
- 熟悉 OpenAI Function Calling API
- 了解 LangChain 基本用法
- 思考：Agent 和 RAG 有什么区别？什么时候用 Agent？
