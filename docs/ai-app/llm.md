# 大语言模型（LLM）

## 架构概览

- Transformer: Self-Attention + 前馈网络
- Decoder-only: GPT 系列
- Encoder-Decoder: T5、BART

## 核心概念

### 分词

- BPE（Byte Pair Encoding）: GPT 使用此方法
- SentencePiece: 与语言无关的分词器
- 粗略估算: 1 token 约 4 个英文字符 或 约 1.5 个中文字符

### 上下文窗口

| 模型 | 上下文长度 |
|------|-----------|
| GPT-4o | 128K |
| Claude 3.5 Sonnet | 200K |
| Gemini 1.5 Pro | 1M |

### 温度参数

- 0: 确定性输出
- 0.7: 创造性与准确性的平衡
- 1.0+: 更随机 / 更有创造力

## Prompt 工程

### 核心模式

1. **Zero-shot**: 直接给出指令
2. **Few-shot**: 提供示例
3. **Chain-of-Thought**: 逐步推理
4. **ReAct**: 推理 + 行动循环

### 示例：Few-shot 分类

```
分类情感倾向：

Text: "This product is amazing!" -> Positive
Text: "Terrible experience" -> Negative
Text: "It's okay, nothing special" -> Neutral
Text: "{user_input}" ->
```

## RAG 检索增强生成

```
用户提问
    -> 向量化（Embedding）
    -> 向量数据库检索
    -> 上下文 + 问题
    -> LLM 生成
    -> 响应
```

### 核心组件

1. 文档分块策略
2. Embedding 模型选择
3. 向量数据库（Milvus / Pinecone / Chroma）
4. 重排序（Reranking）
5. Prompt 模板设计

## Agent 智能体

### 核心循环

```
while not done:
    1. 观察: 读取环境/工具输出
    2. 思考: LLM 推理
    3. 行动: 调用工具 / 返回响应
```

### 工具调用

```python
tools = [
    {"name": "search", "description": "搜索网页"},
    {"name": "calculator", "description": "数学计算"},
]

# LLM 根据上下文决定调用哪个工具及参数
```

## 微调 vs RAG vs Prompt

| 方式 | 成本 | 延迟 | 知识更新 |
|------|------|------|----------|
| Prompt 工程 | 低 | 快 | 实时 |
| RAG | 中 | 中 | 实时（更新数据库） |
| 微调 | 高 | 快 | 需要重新训练 |
