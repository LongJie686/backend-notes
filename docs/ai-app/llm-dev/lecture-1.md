# 第1讲：大模型基础原理与 API 调用

## 核心结论（5 条必记）

1. **Transformer 核心是自注意力机制** -- 让模型处理每个词时都能"看到"序列中所有其他词，实现并行计算和长距离依赖
2. **Token 是模型处理文本的最小单位** -- 不是字符也不是词，英文约 4 字符 1 Token，中文约 1.5 汉字 1 Token
3. **生成参数控制输出特性** -- Temperature 控制随机性，Top-K/Top-P 控制采样范围，Penalty 控制重复
4. **大模型不是数据库** -- 基于概率生成文本，不"存储"事实，幻觉的根本原因是模型在"编造"概率最高的下一个 Token
5. **API 调用只是起点** -- 真正的工程挑战在后面，理解 Transformer 不需要手推公式，但要知道信息流怎么走

---

## 一、Transformer 架构核心

Transformer 的核心创新是**自注意力机制（Self-Attention）**，它让模型在处理每个词时都能"看到"序列中的所有其他词。

**关键组件：**

- **自注意力（Self-Attention）**：计算序列中每个位置对其他位置的关注程度，用 Q/K/V 三个矩阵实现
- **多头注意力（Multi-Head Attention）**：多组独立的 Q/K/V，让模型同时关注不同层面的信息
- **位置编码（Positional Encoding）**：Transformer 没有顺序概念，需要额外注入位置信息
- **前馈网络（Feed-Forward）**：每层的非线性变换能力
- **残差连接 + Layer Norm**：解决深层网络的梯度问题

**为什么比 RNN 好：**
- 并行计算，训练速度快
- 长距离依赖处理更好
- 可扩展性强

---

## 二、GPT 系列演进与 Tokenizer

### GPT 系列演进

| 模型 | 参数量 | 核心变化 |
|------|--------|----------|
| GPT | 1.17亿 | 验证预训练+微调范式 |
| GPT-2 | 15亿 | 验证规模效应，零样本能力 |
| GPT-3 | 1750亿 | Few-shot 能力，In-Context Learning |
| ChatGPT | - | RLHF 对齐，对话能力 |
| GPT-4 | - | 多模态，推理能力大幅提升 |

**Decoder-only 为什么成为主流：**
- 自回归生成天然适合文本生成任务
- 架构简单，扩展性好
- In-Context Learning 能力强

### Tokenizer 原理

**核心概念：** Token 是模型处理文本的最小单位，不是字符也不是词。

**常见方案：**

| 方案 | 代表模型 | 特点 |
|------|----------|------|
| BPE | GPT系列 | 按频率合并字节对 |
| WordPiece | BERT | 按似度合并子词 |
| SentencePiece | 多语言模型 | 语言无关，直接从原始文本学习 |

**实用经验：**
- 英文：1 Token 约 4 个字符
- 中文：1 Token 约 1.5 个汉字
- 代码：Token 消耗通常比纯文本高 2-3 倍

---

## 三、生成参数与 API 调用

### 生成参数

| 参数 | 作用 | 推荐值 |
|------|------|--------|
| Temperature | 控制随机性，越高越随机 | 分类任务 0，对话 0.7 |
| Top-K | 只从概率最高的 K 个 Token 中采样 | 40-50 |
| Top-P | 从累积概率不超过 P 的 Token 中采样 | 0.9 |
| Frequency Penalty | 降低已出现 Token 的概率 | 0-0.5 |
| Presence Penalty | 鼓励出现新 Token | 0-0.5 |

### 主流模型 API

**OpenAI API 调用：**

```python
from openai import OpenAI

client = OpenAI(api_key="your-api-key")

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "你是一个有帮助的助手。"},
        {"role": "user", "content": "解释 Transformer 的自注意力机制"}
    ],
    temperature=0.7
)
print(response.choices[0].message.content)
```

**流式输出：**

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "讲一个故事"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

**通义千问 API：**

```python
from dashscope import Generation

response = Generation.call(
    model="qwen-max",
    messages=[{"role": "user", "content": "你好"}],
    api_key="your-api-key"
)
print(response.output.choices[0].message.content)
```

### Token 计算与成本估算

**成本公式：**

```
总成本 = (输入Token数 x 输入单价 + 输出Token数 x 输出单价) / 1,000,000
```

**成本控制要点：**
- System Prompt 精简，避免冗余
- 对话历史做压缩和摘要
- 相似问题做语义缓存
- 简单任务用小模型

---

## 四、面试高频题

### 1. GPT 是 Encoder 还是 Decoder？
GPT 是 Decoder-only 架构 -> 自回归方式逐个生成 Token，天然适合文本生成任务 -> 理解 GPT 的设计选择

### 2. 一个汉字大概几个 Token？
大约 1-2 个 Token 对应一个汉字 -> 具体取决于 Tokenizer 和文字内容 -> 中文场景下 Token 消耗需要重点评估

### 3. Temperature 设为 0 就是确定性输出吗？
接近确定性，但不完全保证 -> 浮点数计算仍有微小随机性 -> 分类等需要确定性输出的场景建议设为 0

---

## 练习题（待完成）

- [ ] 练习1：用 OpenAI / 通义千问 API 构建一个命令行聊天机器人
- [ ] 练习2：实验不同 Temperature 对输出的影响，记录差异
- [ ] 练习3：实现流式输出功能
- [ ] 练习4：统计一次对话的 Token 消耗和成本
