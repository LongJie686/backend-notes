# 第3讲：RAG知识管理完整链路（让Agent拥有企业知识）

欢迎进入RAG的世界！

前两讲我们学会了如何设计Multi-Agent系统，但你会发现一个问题：

**Agent的知识是有边界的。**

- GPT的训练数据截止到某个时间点
- 企业内部文档、产品手册、规章制度，模型根本不知道
- 让Agent回答"我们公司的退款政策是什么"，它只能靠猜

这就是RAG要解决的问题。

---

## 一、什么是RAG？为什么它是企业AI的核心？

### **1. RAG的本质**

RAG = **R**etrieval **A**ugmented **G**eneration（检索增强生成）

**一句话解释：**
> 先从知识库里找到相关内容，再把找到的内容喂给LLM，让LLM基于这些内容回答问题。

**类比：**
- 没有RAG的LLM：闭卷考试（只能靠记忆）
- 有RAG的LLM：开卷考试（可以查资料）

---

### **2. 为什么需要RAG？**

| 问题 | 没有RAG | 有RAG |
|------|---------|-------|
| 企业内部知识 | 不知道 | 能回答 |
| 实时信息 | 训练截止日期 | 随时更新 |
| 幻觉问题 | 编造答案 | 基于真实文档 |
| 可溯源性 | 不知道从哪来 | 能标注来源 |
| 数据隐私 | 数据上传第三方 | 本地知识库 |

---

### **3. RAG完整流程**

```
+-------------------------------------------------------------+
|              RAG 完整流程                                     |
+----------------------------+--------------------------------+
|   离线阶段                  |      在线阶段                  |
|  （构建知识库）             |     （查询回答）               |
+----------------------------+--------------------------------+
|                             |                                |
|  +------------+             |  +------------------+          |
|  | 文档加载   |             |  |   用户提问        |          |
|  +-----+------+             |  +--------+---------+          |
|        |                    |           |                    |
|  +-----v------+             |  +--------v---------+          |
|  | 文本切片   |             |  |   问题Embedding   |          |
|  +-----+------+             |  +--------+---------+          |
|        |                    |           |                    |
|  +-----v------+             |  +--------v---------+          |
|  | Embedding  |             |  |   向量检索        |          |
|  +-----+------+             |  +--------+---------+          |
|        |                    |           |                    |
|  +-----v------+             |  +--------v---------+          |
|  | 存入向量库 |             |  |   Rerank精排      |          |
|  +------------+             |  +--------+---------+          |
|                             |           |                    |
|                             |  +--------v---------+          |
|                             |  |   LLM生成答案     |          |
|                             |  +------------------+          |
|                             |                                |
+----------------------------+--------------------------------+
```

---

## 二、RAG第一步：文档加载与解析

### **1. 支持的文档类型**

```python
from langchain.document_loaders import (
    PyPDFLoader,          # PDF文档
    Docx2txtLoader,       # Word文档
    TextLoader,           # 纯文本
    CSVLoader,            # CSV数据
    UnstructuredHTMLLoader,  # HTML网页
    UnstructuredMarkdownLoader,  # Markdown
    JSONLoader            # JSON数据
)
```

---

### **2. 各类文档加载实战**

**PDF文档加载：**
```python
from langchain.document_loaders import PyPDFLoader

loader = PyPDFLoader("公司规章制度.pdf")
documents = loader.load()

print(f"加载了 {len(documents)} 页")
print(f"第一页内容：{documents[0].page_content[:200]}")
print(f"元数据：{documents[0].metadata}")
```

**批量加载多个文件：**
```python
import os
from langchain.document_loaders import DirectoryLoader, PyPDFLoader

def load_all_documents(docs_dir: str):
    all_documents = []

    for filename in os.listdir(docs_dir):
        filepath = os.path.join(docs_dir, filename)

        try:
            if filename.endswith('.pdf'):
                loader = PyPDFLoader(filepath)
            elif filename.endswith('.docx'):
                loader = Docx2txtLoader(filepath)
            elif filename.endswith('.txt'):
                loader = TextLoader(filepath, encoding='utf-8')
            else:
                print(f"跳过不支持的文件：{filename}")
                continue

            docs = loader.load()
            for doc in docs:
                doc.metadata['filename'] = filename

            all_documents.extend(docs)
            print(f"加载成功：{filename}（{len(docs)} 页）")

        except Exception as e:
            print(f"加载失败：{filename}，错误：{e}")

    print(f"\n共加载 {len(all_documents)} 个文档片段")
    return all_documents

docs = load_all_documents("./knowledge_base")
```

---

### **3. 文档加载的常见坑**

**坑1：PDF解析乱码**

```python
# 扫描版PDF需要OCR
from langchain.document_loaders import UnstructuredPDFLoader

loader = UnstructuredPDFLoader(
    "扫描版文件.pdf",
    mode="elements",
    strategy="hi_res"  # 高精度模式，支持OCR
)
```

**坑2：表格数据丢失**

```python
loader = UnstructuredPDFLoader(
    "含表格文档.pdf",
    mode="elements"  # 按元素提取，表格单独处理
)
documents = loader.load()

# 过滤出表格元素
tables = [doc for doc in documents
          if doc.metadata.get('category') == 'Table']
```

**坑3：文档编码问题**

```python
loader = TextLoader(
    "中文文档.txt",
    encoding='utf-8',    # 或 'gbk', 'gb2312'
    autodetect_encoding=True
)
```

---

## 三、RAG第二步：文本切片

这是RAG中**最关键、最容易出错**的一步。

### **1. 为什么要切片？**

- LLM有上下文长度限制（如4K、8K Token）
- 一篇文档可能有几万字
- 不可能把整篇文档都塞给LLM

---

### **2. 切片的核心参数**

```
chunk_size：每个片段的大小
chunk_overlap：相邻片段的重叠大小

示例：chunk_size=500, overlap=50

片段1：[0    ....    500]
片段2：       [450  ....  950]
片段3：              [900 .. 1400]

重叠是为了避免切断完整语义
```

---

### **3. 主流切片策略详解**

#### **策略1：固定长度切片（最简单）**

```python
from langchain.text_splitter import CharacterTextSplitter

splitter = CharacterTextSplitter(
    chunk_size=500,      # 每片500字符
    chunk_overlap=50,    # 重叠50字符
    separator="\n"       # 按换行切
)

chunks = splitter.split_documents(documents)
```

| 优点 | 缺点 |
|------|------|
| 简单、快 | 可能切断完整语义 |

**适用场景：** 快速验证、格式统一的文档

---

#### **策略2：递归切片（推荐默认用这个）**

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    # 按优先级依次切分
    separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""]
)

chunks = splitter.split_documents(documents)
```

**核心思想：** 先尝试用段落分割，如果还是太长，再用换行分割，再长用句号分割，依此类推。

| 优点 | 缺点 |
|------|------|
| 尽量保持语义完整 | 切片大小不均匀 |

**适用场景：** 大多数业务文档

---

#### **策略3：语义切片（效果最好，成本最高）**

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

splitter = SemanticChunker(
    embeddings=OpenAIEmbeddings(),
    breakpoint_threshold_type="percentile",
    breakpoint_threshold_amount=95
)

chunks = splitter.split_documents(documents)
```

**核心思想：** 计算相邻句子的语义相似度，相似度突然下降的地方就是切片边界。

| 优点 | 缺点 |
|------|------|
| 语义完整性最好 | 需要调用Embedding API，成本高 |

**适用场景：** 对检索精度要求极高的场景

---

#### **策略4：按章节切片（结构化文档）**

```python
def split_by_chapter(text: str) -> list[str]:
    """按章节切片"""
    import re
    chapter_pattern = r'(第[一二三四五六七八九十]+章|第\d+章|\d+\.\d+|\n##\s)'
    chapters = re.split(chapter_pattern, text)
    return [c.strip() for c in chapters if c.strip()]
```

**适用场景：** 规章制度、产品手册、技术文档

---

### **4. 切片策略对比**

| 策略 | 语义完整性 | 速度 | 成本 | 适用场景 |
|------|-----------|------|------|----------|
| 固定长度 | 低 | 极快 | 低 | 快速验证 |
| 递归切片 | 高 | 快 | 低 | 大多数场景 |
| 语义切片 | 最高 | 慢 | 高 | 高精度要求 |
| 按章节切 | 最高 | 快 | 低 | 结构化文档 |

**实战建议：**
- **默认用递归切片**，chunk_size=500，overlap=50
- **结构化文档**先按章节切，再递归切
- **高精度场景**用语义切片

---

### **5. 切片参数怎么选？**

```python
# 短问答（如FAQ）
splitter = RecursiveCharacterTextSplitter(chunk_size=200, chunk_overlap=20)

# 长文档（如研报）
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)

# 代码文档
from langchain.text_splitter import Language, RecursiveCharacterTextSplitter
splitter = RecursiveCharacterTextSplitter.from_language(
    language=Language.PYTHON, chunk_size=500, chunk_overlap=50
)
```

**黄金公式：**
- chunk_size 约等于你希望LLM每次看到的内容量
- chunk_overlap 约等于 chunk_size 的 10%

---

## 四、RAG第三步：Embedding（向量化）

### **1. 什么是Embedding？**

> 把文字转成一串数字，意思相近的文字，数字也相近。

```
"苹果手机" -> [0.2, 0.8, 0.1, 0.5, ...]
"iPhone"   -> [0.21, 0.79, 0.12, 0.48, ...]  （相近）
"香蕉"     -> [0.9, 0.1, 0.7, 0.2, ...]      （不相近）
```

---

### **2. 主流Embedding模型对比**

| 模型 | 提供方 | 维度 | 中文效果 | 成本 | 是否本地 |
|------|--------|------|---------|------|---------|
| text-embedding-3-large | OpenAI | 3072 | 高 | 高 | 否 |
| text-embedding-3-small | OpenAI | 1536 | 中 | 低 | 否 |
| BGE-large-zh | 北航 | 1024 | 最高 | 免费 | 是 |
| M3E-large | 北京AI研究所 | 1024 | 高 | 免费 | 是 |

**实战建议：**
- **数据不能出境** -> 用BGE本地部署
- **快速开发** -> 用OpenAI Embedding
- **中文效果优先** -> BGE-large-zh

---

### **3. Embedding实战**

#### **方案1：OpenAI Embedding**

```python
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    model="text-embedding-3-small",
    openai_api_key="your_key"
)

vector = embeddings.embed_query("苹果手机市场份额")
print(f"向量维度：{len(vector)}")
```

#### **方案2：BGE本地Embedding（推荐企业用）**

```python
from langchain_community.embeddings import HuggingFaceBgeEmbeddings

embeddings = HuggingFaceBgeEmbeddings(
    model_name="BAAI/bge-large-zh-v1.5",
    model_kwargs={"device": "cpu"},
    encode_kwargs={"normalize_embeddings": True}
)

vector = embeddings.embed_query("苹果手机市场份额")
print(f"向量维度：{len(vector)}")
```

**注意：** 首次运行会自动下载模型（约600MB），需要等待

#### **方案3：通义千问Embedding（阿里云）**

```python
from langchain_community.embeddings import DashScopeEmbeddings

embeddings = DashScopeEmbeddings(
    model="text-embedding-v1",
    dashscope_api_key="your_key"
)
```

---

## 五、RAG第四步：向量数据库

### **1. 为什么需要向量数据库？**

- 普通数据库（MySQL）：擅长精确查找
- 向量数据库：擅长相似度查找

```
问题：  "手机的价格"
  | Embedding
向量：  [0.3, 0.7, 0.2, ...]

知识库中：
片段1："手机售价"      -> [0.31, 0.69, 0.21, ...]  相似
片段2："手机颜色"      -> [0.5, 0.3, 0.8, ...]     不相似
片段3："手机价格区间"  -> [0.29, 0.72, 0.19, ...]  相似
```

---

### **2. 主流向量数据库对比**

| 数据库 | 部署方式 | 规模 | 特点 | 适用场景 |
|--------|---------|------|------|---------|
| **Chroma** | 本地 | 小 | 简单易用，零配置 | 开发测试 |
| **FAISS** | 本地 | 中 | Facebook开源，速度快 | 中小规模 |
| **Qdrant** | 本地/云 | 大 | 功能完整，性能好 | 企业生产 |
| **Milvus** | 本地/云 | 超大 | 高性能，功能丰富 | 大规模生产 |
| **Pinecone** | 云端 | 超大 | 全托管，无运维 | 快速上线 |
| **Weaviate** | 本地/云 | 大 | 支持混合检索 | 企业生产 |

**选型建议：**
- 开发测试阶段 -> Chroma（零配置）
- 中小规模生产 -> Qdrant（部署简单，功能完整）
- 大规模生产   -> Milvus（性能最强）
- 不想运维     -> Pinecone（全托管）

---

### **3. Chroma实战（开发测试首选）**

```python
from langchain.vectorstores import Chroma

# 创建向量数据库
vectorstore = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="./chroma_db"
)

# 加载已有知识库
vectorstore = Chroma(
    persist_directory="./chroma_db",
    embedding_function=embeddings
)

# 基础检索
results = vectorstore.similarity_search(query="年假政策", k=3)

for i, doc in enumerate(results):
    print(f"--- 第{i+1}个相关片段 ---")
    print(f"内容：{doc.page_content[:200]}")
    print(f"来源：{doc.metadata}")
```

---

### **4. Qdrant实战（生产环境推荐）**

```bash
docker run -p 6333:6333 qdrant/qdrant
```

```python
from langchain_community.vectorstores import Qdrant

vectorstore = Qdrant.from_documents(
    documents=chunks,
    embedding=embeddings,
    host="localhost",
    port=6333,
    collection_name="enterprise_knowledge"
)

results = vectorstore.similarity_search(query, k=3)
```

---

### **5. 向量库的CRUD操作**

```python
class KnowledgeBaseManager:
    """知识库管理器"""

    def __init__(self, vectorstore):
        self.vectorstore = vectorstore

    def add_documents(self, new_docs: list):
        """新增文档"""
        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
        chunks = splitter.split_documents(new_docs)
        self.vectorstore.add_documents(chunks)
        print(f"成功新增 {len(chunks)} 个片段")

    def search(self, query: str, k: int = 3):
        """检索"""
        return self.vectorstore.similarity_search(query, k=k)

    def delete_by_source(self, source_file: str):
        """按来源文件删除"""
        self.vectorstore._collection.delete(where={"source": source_file})

    def get_stats(self):
        """查看统计"""
        count = self.vectorstore._collection.count()
        print(f"知识库共有 {count} 个片段")
        return count
```

---

## 六、RAG第五步：检索策略优化

**这是RAG效果的关键！**

### **策略1：基础相似度检索**

```python
results = vectorstore.similarity_search(query="年假政策", k=3)
```

**问题：** 可能返回重复内容，无法处理复杂问题

---

### **策略2：MMR检索（最大边际相关）**

```python
results = vectorstore.max_marginal_relevance_search(
    query="年假政策",
    k=3,           # 最终返回3个
    fetch_k=20,    # 先检索20个候选
    lambda_mult=0.5  # 0=最多样，1=最相关
)
```

**适用场景：** 避免返回内容高度重复的片段

---

### **策略3：带分数的检索**

```python
results_with_scores = vectorstore.similarity_search_with_score(
    query="年假政策", k=5
)

# 过滤低相似度结果（分数越小越相似，范围0-2）
threshold = 0.5
filtered_results = [
    (doc, score) for doc, score in results_with_scores if score < threshold
]
```

---

### **策略4：混合检索（关键词+向量）**

```python
from langchain.retrievers import BM25Retriever, EnsembleRetriever

# 关键词检索器（BM25算法）
bm25_retriever = BM25Retriever.from_documents(chunks)
bm25_retriever.k = 3

# 向量检索器
vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# 组合检索器
ensemble_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.4, 0.6]  # 关键词40%，向量60%
)

results = ensemble_retriever.get_relevant_documents("年假政策")
```

**优点：** 向量检索善于语义匹配，BM25善于精确关键词匹配，两者互补

---

### **策略5：Rerank精排（效果最好）**

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import CrossEncoderReranker
from langchain_community.cross_encoders import HuggingFaceCrossEncoder

rerank_model = HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-large")

reranker = CrossEncoderReranker(model=rerank_model, top_n=3)

compression_retriever = ContextualCompressionRetriever(
    base_compressor=reranker,
    base_retriever=vectorstore.as_retriever(search_kwargs={"k": 20})
)

results = compression_retriever.get_relevant_documents("年假政策")
```

**效果对比：**
```
基础检索 -> 相关性一般
MMR检索 -> 多样性更好
混合检索 -> 关键词+语义
Rerank精排 -> 效果最好，但速度稍慢
```

---

### **策略6：Query改写（提升召回率）**

```python
from langchain.retrievers import MultiQueryRetriever
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(temperature=0)

multi_query_retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
    llm=llm,
    prompt=PromptTemplate.from_template("""
    你是一个查询优化专家。
    对于以下问题，生成3个不同角度的查询语句，用于检索相关文档：

    原始问题：{question}

    请输出3个查询（每行一个）：
    """)
)

results = multi_query_retriever.get_relevant_documents("公司病假期间工资怎么算")
```

**效果：**
```
原始问题：公司病假期间工资怎么算
  | 自动生成：
查询1：员工病假工资标准
查询2：病假期间薪资待遇规定
查询3：医疗期工资发放规则

-> 三个查询都去检索，合并结果，召回率更高
```

---

## 七、RAG第六步：生成答案

### **1. 基础问答链**

```python
from langchain.chains import RetrievalQA
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate

QA_PROMPT = PromptTemplate(
    input_variables=["context", "question"],
    template="""
你是一位专业的企业知识助手。
请基于以下提供的上下文内容回答问题。

要求：
1. 只基于提供的上下文回答，不要编造内容
2. 如果上下文中没有相关信息，明确说"文档中未找到相关信息"
3. 回答要简洁清晰
4. 如有必要，标注信息来源

上下文：
{context}

问题：{question}

回答：
"""
)

llm = ChatOpenAI(model="gpt-4", temperature=0)

qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",
    retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
    chain_type_kwargs={"prompt": QA_PROMPT, "verbose": True},
    return_source_documents=True
)

result = qa_chain.invoke({"query": "公司年假有多少天？"})

print("答案：", result['result'])
for doc in result['source_documents']:
    print(f"  - {doc.metadata.get('source', '未知')}：{doc.page_content[:100]}")
```

---

### **2. 多轮对话RAG**

```python
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory

memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True,
    output_key="answer"
)

conv_chain = ConversationalRetrievalChain.from_llm(
    llm=llm,
    retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
    memory=memory,
    return_source_documents=True,
    verbose=True
)

# 第一轮
result1 = conv_chain.invoke({"question": "公司年假有多少天？"})
print("第一轮答案：", result1['answer'])

# 第二轮（能记住上下文）
result2 = conv_chain.invoke({"question": "那病假呢？"})
print("第二轮答案：", result2['answer'])
```

---

## 八、实战项目：企业知识库问答Agent

### **项目需求**

- 能回答公司制度相关问题
- 支持多轮对话
- 回答需标注来源
- 不知道的明确说不知道
- 支持知识库更新

### **完整代码**

```python
class EnterpriseKnowledgeBase:
    """企业知识库问答系统 -- BGE Embedding + Chroma + MMR检索 + 多轮对话"""

    def __init__(self, docs_dir="./docs", db_dir="./knowledge_db"):
        self.embeddings = HuggingFaceBgeEmbeddings(
            model_name="BAAI/bge-large-zh-v1.5", encode_kwargs={"normalize_embeddings": True}
        )
        self.vectorstore = None
        self.qa_chain = None

    # ========== 知识库构建（加载 → 切片 → 向量化）==========
    def build_knowledge_base(self):
        docs = self._load_documents()  # rglob *.pdf/*.docx/*.txt, 按扩展名选择 loader
        chunks = RecursiveCharacterTextSplitter(
            chunk_size=500, chunk_overlap=50,
            separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""]
        ).split_documents(docs)
        self.vectorstore = Chroma.from_documents(chunks, self.embeddings, persist_directory=self.db_dir)

    def load_knowledge_base(self):
        """从持久化目录加载已有索引"""
        self.vectorstore = Chroma(persist_directory=self.db_dir, embedding_function=self.embeddings)

    # ========== 问答系统（MMR 检索 + 多轮记忆）==========
    def setup_qa_chain(self, llm=None):
        llm = llm or ChatOpenAI(model="gpt-4", temperature=0)
        memory = ConversationBufferWindowMemory(k=5, return_messages=True)
        retriever = self.vectorstore.as_retriever(search_type="mmr", search_kwargs={"k": 5, "fetch_k": 20})

        qa_prompt = PromptTemplate.from_template("""
对话历史：{chat_history}
参考文档：{context}
员工问题：{question}
要求：只基于文档回答，不知道就说"未找到相关信息"。""")

        self.qa_chain = ConversationalRetrievalChain.from_llm(
            llm=llm, retriever=retriever, memory=memory,
            return_source_documents=True, combine_docs_chain_kwargs={"prompt": qa_prompt}
        )

    def ask(self, question: str) -> dict:
        """返回 {answer, sources, question}"""
        result = self.qa_chain.invoke({"question": question})
        sources = []
        for doc in result.get('source_documents', []):
            src = doc.metadata.get('filename', '未知')
            if doc.metadata.get('page'): src += f" 第{doc.metadata['page']+1}页"
            if src not in sources: sources.append(src)
        return {"answer": result['answer'], "sources": sources, "question": question}
```

---

## 九、RAG效果优化技巧

### **优化1：提升检索精度**

```python
def add_context_to_chunks(chunks, window_size=1):
    """给每个片段加入前后文"""
    enriched_chunks = []

    for i, chunk in enumerate(chunks):
        prev_text = chunks[i-1].page_content if i > 0 else ""
        next_text = chunks[i+1].page_content if i < len(chunks)-1 else ""

        enriched_content = f"""
前文：{prev_text[-100:] if prev_text else "无"}

当前内容：{chunk.page_content}

后文：{next_text[:100] if next_text else "无"}
""".strip()

        enriched_chunk = Document(
            page_content=enriched_content,
            metadata=chunk.metadata
        )
        enriched_chunks.append(enriched_chunk)

    return enriched_chunks
```

---

### **优化2：处理长文档（Map-Reduce）**

```python
from langchain.chains.summarize import load_summarize_chain

long_doc_chain = load_summarize_chain(
    llm=llm,
    chain_type="map_reduce",
    verbose=True
)

summary = long_doc_chain.run(chunks)
```

---

### **优化3：自动评估RAG质量**

```python
from ragas.metrics import faithfulness, answer_relevancy, context_precision
from ragas import evaluate
from datasets import Dataset

eval_data = {
    "question": ["年假有多少天？", "病假怎么处理？"],
    "answer": [result1['answer'], result2['answer']],
    "contexts": [
        [doc.page_content for doc in result1['source_documents']],
        [doc.page_content for doc in result2['source_documents']]
    ],
    "ground_truth": ["5-15天", "需提供医院证明"]
}

dataset = Dataset.from_dict(eval_data)

scores = evaluate(
    dataset,
    metrics=[faithfulness, answer_relevancy, context_precision]
)

print(scores)
# faithfulness: 0.95（答案基于文档的程度）
# answer_relevancy: 0.87（答案和问题的相关性）
# context_precision: 0.91（检索结果的精确度）
```

---

## 十、把RAG集成到Multi-Agent中

把RAG和CrewAI结合起来：

```python
from crewai import Agent, Task, Crew
from crewai_tools import tool

# 把知识库封装成工具
@tool("企业知识库查询")
def query_knowledge_base(question: str) -> str:
    """
    查询企业内部知识库
    适用于：公司制度、员工手册、产品手册等内部文档的问答
    """
    result = kb.ask(question)

    answer = result['answer']
    sources = result.get('sources', [])

    if sources:
        return f"答案：{answer}\n来源：{', '.join(sources)}"
    return f"答案：{answer}"

# 创建带知识库的Agent
hr_assistant = Agent(
    role="HR知识助手",
    goal="准确回答员工关于公司制度和政策的问题",
    backstory="""
    你是公司HR部门的专业助手，熟悉所有公司制度和政策。
    你总是基于官方文档回答问题，确保信息准确可靠。
    """,
    tools=[query_knowledge_base],
    llm=llm,
    verbose=True
)

hr_task = Task(
    description="""
    回答员工问题：{question}

    要求：
    1. 必须通过知识库工具查询，不要凭记忆回答
    2. 回答要准确、完整
    3. 标注信息来源
    """,
    expected_output="准确的政策解答，包含来源文档",
    agent=hr_assistant
)
```

---

## 十一、核心总结

### **必须记住的10个要点**

1. **RAG = 检索 + 生成**，先找相关文档，再基于文档回答
2. **切片是RAG的关键**，推荐递归切片，chunk_size=500
3. **中文场景优先BGE**，效果最好且免费
4. **开发测试用Chroma**，生产环境用Qdrant/Milvus
5. **MMR检索减少重复**，比基础相似度检索效果好
6. **Rerank精排效果最好**，但速度慢，按需使用
7. **混合检索（关键词+向量）**比单一检索召回率更高
8. **Prompt要明确说"不知道就说不知道"**，避免幻觉
9. **必须返回来源**，让用户能验证答案
10. **RAG质量要定期评估**，用RAGAS等工具

---

## 十二、练习题

### **练习1：概念理解**
1. 为什么RAG比单纯增大LLM上下文窗口更适合企业场景？
2. chunk_size太大和太小分别有什么问题？
3. 什么时候用Rerank，什么时候不需要？

---

### **练习2：场景设计**
为一个"法律咨询系统"设计RAG方案：
1. 知识库包含哪些文档？
2. 切片策略怎么设计？（法律条文有其特殊性）
3. 检索策略选什么？
4. Prompt怎么设计？（要注意什么风险）

---

### **练习3：代码实战**
改造本讲的企业知识库系统：
1. 加入相似度分数过滤（低于阈值的不返回）
2. 回答中标注具体页码
3. 加入"不确定度"提示（当相关片段少于2个时，提示用户答案可能不完整）

```python
def ask_with_confidence(self, question: str) -> dict:
    """带置信度的问答"""
    # 获取检索结果和分数
    results_with_scores = self.vectorstore.similarity_search_with_score(
        question, k=5
    )

    # 过滤低相似度结果
    threshold = 0.5
    filtered = [(doc, score)
                for doc, score in results_with_scores
                if score < threshold]

    # 判断置信度
    if len(filtered) == 0:
        return {
            "answer": "很抱歉，知识库中没有找到相关信息",
            "confidence": "低",
            "sources": []
        }
    elif len(filtered) < 2:
        confidence = "中"
        hint = "（注：仅找到少量相关信息，答案可能不完整）"
    else:
        confidence = "高"
        hint = ""

    # TODO: 生成答案并返回
```

---

## 十三、下一讲预告

**第4讲：工具调用与CrewAI工具链深度实战**

会讲：
- Function Calling完整原理
- 如何设计高质量工具Schema
- 工具链的组合编排
- 异常处理与重试机制
- 实战：**市场调研Agent**（搜索+爬虫+分析）
- 工具调用的成本控制
- 防止工具滥用的策略

**准备工作：**
```bash
pip install requests beautifulsoup4 pandas
# 申请Serper API Key（免费额度够用）
```
