# 第1讲：大模型基础原理与 API 调用

> 阶段目标：理解大模型本质，能熟练调用主流模型 API。

## 学习目标

- 理解 Transformer 架构核心思想
- 掌握 Tokenizer 工作原理
- 理解生成参数对输出的影响
- 能调用主流模型 API 并实现流式输出

## 核心内容

### Transformer 架构核心

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

## 重点认知

1. **大模型不是数据库**，它基于概率生成文本，不"存储"事实
2. **幻觉的根本原因**是模型在"编造"概率最高的下一个 Token
3. **API 调用只是起点**，真正的工程挑战在后面
4. **理解 Transformer 不需要手推公式**，但要知道信息流怎么走的

## 实战建议

1. 用 OpenAI / 通义千问 API 构建一个命令行聊天机器人
2. 实验不同 Temperature 对输出的影响
3. 实现流式输出
4. 统计一次对话的 Token 消耗和成本

## 常见问题

**Q: GPT 是 Encoder 还是 Decoder？**
A: GPT 是 Decoder-only 架构，只使用了 Transformer 的解码器部分。

**Q: 一个汉字大概几个 Token？**
A: 大约 1-2 个 Token 对应一个汉字，具体取决于 Tokenizer 和文字内容。

**Q: Temperature 设为 0 就是确定性输出吗？**
A: 接近确定性，但不完全保证，因为浮点数计算仍有微小随机性。

## 小结

本讲建立了对大模型的基础认知：Transformer 是核心架构，Token 是基本处理单位，生成参数控制输出特性，API 调用是与模型交互的起点。下一讲将深入学习 Prompt Engineering。
