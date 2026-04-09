# 第一讲：大模型基础原理与 API 调用

> 阶段目标：理解大模型底层原理，掌握主流模型 API 的调用方式

## 学习目标

1. 理解 Transformer 架构的核心组件
2. 掌握 GPT 系列模型的演进脉络
3. 理解 Tokenizer 的工作原理
4. 熟练使用生成参数控制输出质量
5. 能够调用主流大模型 API 并处理响应

## 核心内容

### Transformer 架构核心

Transformer 是当前所有主流大模型的底层架构，理解它的工作原理是后续所有学习的基础。

#### 自注意力机制（Self-Attention）

自注意力机制让模型在处理每个 Token 时，能够关注输入序列中的所有其他 Token，从而捕获长距离依赖关系。

核心计算公式：

```
Attention(Q, K, V) = softmax(Q * K^T / sqrt(d_k)) * V
```

- Q（Query）：当前 Token 的查询向量，表示"我在找什么"
- K（Key）：每个 Token 的键向量，表示"我能提供什么"
- V（Value）：每个 Token 的值向量，表示"我的实际内容"
- d_k：键向量的维度，除以 sqrt(d_k) 是为了防止点积过大导致梯度消失

直觉理解：自注意力就像在一个会议上，每个人同时听所有人的发言，然后根据相关性决定重点关注谁的内容。

#### 多头注意力（Multi-Head Attention）

多头注意力将 Q、K、V 投影到多个不同的子空间，每个"头"学习不同的注意力模式：

- 每个头独立计算注意力
- 拼接所有头的输出
- 通过线性变换得到最终结果

优势：不同头可以关注不同类型的关系（语法、语义、位置等），增强模型的表达能力。

#### 位置编码（Positional Encoding）

Transformer 本身没有顺序概念，位置编码为每个位置生成唯一的向量，让模型感知 Token 的顺序：

- **正弦位置编码**：原始 Transformer 使用，通过正弦和余弦函数生成
- **旋转位置编码（RoPE）**：Llama 等模型使用，将位置信息融入注意力计算
- **ALiBi**：BLOOM 等模型使用，在注意力分数上添加距离惩罚

### GPT 系列演进

| 模型 | 时间 | 参数量 | 关键改进 |
|------|------|--------|----------|
| GPT-1 | 2018 | 1.17 亿 | 预训练 + 微调范式 |
| GPT-2 | 2019 | 15 亿 | 更大数据集，零样本能力 |
| GPT-3 | 2020 | 1750 亿 | In-context learning，少样本学习 |
| InstructGPT | 2022 | 1750 亿 | RLHF 对齐人类意图 |
| GPT-4 | 2023 | 未公开 | 多模态，推理能力大幅提升 |
| GPT-4o | 2024 | 未公开 | 原生多模态，实时语音 |
| o1/o3 | 2024-2025 | 未公开 | 推理链（Chain of Thought）强化 |

核心趋势：模型规模增长 + 训练数据质量提升 + 对齐技术改进 + 多模态融合。

### Tokenizer 原理

Tokenizer 将原始文本转换为模型能理解的数字序列，直接影响模型的理解粒度和成本。

#### BPE（Byte Pair Encoding）

- 从字符级别开始，迭代合并最高频的字符对
- GPT-2/GPT-3/GPT-4 使用 BPE 的变体
- 平衡了词级别和字符级别的优缺点

#### WordPiece

- 类似 BPE，但选择合并对时基于似然增益而非频率
- BERT 系列模型使用
- 更适合处理子词的最优分割

#### SentencePiece

- 语言无关的 Tokenizer，直接从原始文本训练
- 支持中文等没有明确分词边界的语言
- Llama、ChatGLM 等模型使用

实际影响：不同 Tokenizer 对中文的支持差异很大，中文一个字可能是 1-3 个 Token，直接影响成本和上下文利用率。

### 生成参数详解

生成参数控制模型的输出行为，理解它们对调试和优化至关重要。

#### Temperature

- 范围：0 - 2（通常 0-1）
- 值越低，输出越确定、保守
- 值越高，输出越随机、多样
- 建议：事实性任务用 0-0.3，创意任务用 0.7-1.0

#### Top-K

- 只从概率最高的 K 个 Token 中采样
- K=1 等同于贪心解码
- K 越大，多样性越高

#### Top-P（核采样 Nucleus Sampling）

- 从累积概率超过 P 的最小 Token 集合中采样
- 比固定 K 更灵活，自适应调整候选范围
- 通常设为 0.9-0.95

#### 频率惩罚与存在惩罚

- **频率惩罚（Frequency Penalty）**：对已出现过的 Token 按出现次数惩罚
- **存在惩罚（Presence Penalty）**：只要出现过就惩罚，不管次数
- 合理使用可以减少重复，提高输出多样性

#### 停止词（Stop Sequences）

- 指定遇到特定字符串时停止生成
- 常用于控制输出格式，如遇到 "\n\n" 或 "Human:" 时停止

### 主流模型 API 调用

#### OpenAI API

```python
from openai import OpenAI

client = OpenAI(api_key="your-api-key")

# 基本调用
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "你是一个有帮助的助手。"},
        {"role": "user", "content": "解释什么是 Transformer。"}
    ],
    temperature=0.7,
    max_tokens=1000
)

print(response.choices[0].message.content)

# 流式响应
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "写一首诗"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

#### 通义千问 API

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

response = client.chat.completions.create(
    model="qwen-plus",
    messages=[{"role": "user", "content": "你好"}]
)
```

#### 文心一言 API

```python
import requests

url = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions"
params = {"access_token": "your-access-token"}
data = {
    "messages": [{"role": "user", "content": "你好"}]
}

response = requests.post(url, params=params, json=data)
print(response.json()["result"])
```

#### Claude API

```python
from anthropic import Anthropic

client = Anthropic(api_key="your-api-key")

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "解释什么是 Transformer。"}]
)

print(response.content[0].text)
```

#### Kimi API

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.moonshot.cn/v1"
)

response = client.chat.completions.create(
    model="moonshot-v1-8k",
    messages=[{"role": "user", "content": "你好"}]
)
```

### Token 计算与成本估算

#### Token 计算方式

```python
import tiktoken

encoding = tiktoken.encoding_for_model("gpt-4o")

text = "你好，世界！Hello World!"
tokens = encoding.encode(text)
print(f"Token 数量: {len(tokens)}")
```

#### 成本估算要点

1. **输入 Token**：Prompt 部分消耗的 Token
2. **输出 Token**：模型生成部分消耗的 Token
3. **计费公式**：总成本 = 输入 Token 数 * 输入单价 + 输出 Token 数 * 输出单价
4. **注意事项**：输出 Token 的价格通常是输入 Token 的 2-3 倍

| 模型 | 输入价格（每百万 Token） | 输出价格（每百万 Token） |
|------|--------------------------|--------------------------|
| GPT-4o | $2.50 | $10.00 |
| GPT-4o-mini | $0.15 | $0.60 |
| Claude Sonnet 4 | $3.00 | $15.00 |
| Qwen-Plus | 约 2 元 | 约 6 元 |

## 重点认知

1. **大模型不是万能的**：它是一个统计语言模型，擅长模式匹配和文本生成，不擅长精确计算和实时信息
2. **上下文窗口是核心资源**：所有信息都必须塞进上下文窗口，合理利用它是系统设计的关键
3. **Token 是成本单位**：理解 Token 的计算方式，是控制成本的基础
4. **生成参数影响巨大**：同样的 Prompt，不同的参数组合可能产生截然不同的结果
5. **API 调用是网络请求**：需要考虑超时、重试、错误处理等工程问题

## 实战建议

1. 先用 Playground（各平台提供的在线调试工具）实验参数效果，再写代码
2. 建立一个 Token 计算工具函数，在每次调用前估算成本
3. 对不同任务建立参数模板（如翻译用 temperature=0.3，创意写作用 0.8）
4. 始终处理 API 调用的异常情况（限流、超时、内容过滤）
5. 使用流式响应提升用户体验，尤其是长文本生成场景

## 常见问题

**Q：Temperature 设为 0 就能保证输出完全一致吗？**

A：不能完全保证。Temperature=0 只是选择了概率最高的 Token，但浮点数精度、系统负载等因素仍可能导致微小差异。如果需要严格一致性，应使用 seed 参数（如果 API 支持）。

**Q：BPE 和 SentencePiece 哪个对中文更好？**

A：没有绝对优劣。SentencePiece 对中日韩等语言支持更好，因为它是从字节级别训练的。但 OpenAI 的 BPE 经过大量中文数据训练，中文表现也不错。关键看具体模型使用的 Tokenizer 训练数据。

**Q：如何选择合适的模型？**

A：根据任务复杂度和成本预算选择。简单任务（分类、提取）用小模型，复杂推理用大模型。先从最便宜的模型开始测试，效果不满足再升级。

## 小结

本讲涵盖了大模型开发的基础知识：从 Transformer 架构理解模型原理，到 Tokenizer 和生成参数掌握输出控制，再到主流 API 的实际调用。这些是后续所有高级应用的基石。下一讲将深入 Prompt Engineering，学习如何设计高质量的提示词。
