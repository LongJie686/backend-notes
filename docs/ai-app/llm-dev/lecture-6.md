# 第六讲：模型微调与优化

> 阶段目标：掌握模型微调的核心技术和决策方法，能够根据业务需求选择合适的适配方案

## 学习目标

1. 理解微调、Prompt 工程、RAG 三种方案的适用场景
2. 掌握 LoRA / QLoRA 的原理与实践
3. 学会准备高质量的 SFT 数据集
4. 了解 RLHF / DPO 的基本原理
5. 掌握模型量化的常用方法
6. 了解训练过程中的常见问题

## 核心内容

### 微调 vs Prompt vs RAG 决策框架

选择合适的适配方案是大模型应用的第一步，不同方案适用于不同场景。

#### 决策矩阵

| 维度 | Prompt 工程 | RAG | 微调 |
|------|------------|-----|------|
| 成本 | 最低 | 中等 | 最高 |
| 效果上线速度 | 最快 | 快 | 慢 |
| 知识更新 | 实时 | 准实时 | 需重新训练 |
| 定制化程度 | 低 | 中 | 高 |
| 数据需求 | 无 | 文档数据 | 标注数据 |
| 计算资源 | 无 | 向量库 | GPU |
| 适用场景 | 格式/风格调整 | 知识密集型任务 | 领域深度适配 |

#### 决策流程

```
问题是否需要外部知识？
  |-- 否 --> 尝试 Prompt 工程
  |           |
  |           |-- 效果满足 --> 使用 Prompt
  |           |-- 效果不满足 --> 考虑微调
  |
  |-- 是 --> 使用 RAG
              |
              |-- 效果满足 --> 使用 RAG
              |-- 效果不满足 --> RAG + 微调结合
```

#### 何时选择微调

1. **领域专业术语多**：医疗、法律、金融等垂直领域
2. **特定输出风格**：品牌语调、特定格式要求
3. **复杂推理模式**：模型需要学习特定的推理链条
4. **性能优化**：用小模型微调替代大模型，降低推理成本
5. **Prompt 无法解决**：已尝试多种 Prompt 策略仍不满足需求

### LoRA / QLoRA 原理与实践

#### LoRA（Low-Rank Adaptation）

LoRA 的核心思想：不修改原始模型参数，而是在旁边添加低秩矩阵来学习适配。

**数学原理**

原始权重矩阵 W 的维度是 d x d，参数量 d^2。
LoRA 将权重变化分解为两个小矩阵的乘积：

```
W' = W + B * A

其中：
- B 维度：d x r
- A 维度：r x d
- r << d（通常 r = 4, 8, 16）

参数量：从 d^2 降低到 2 * d * r
```

例如：d=4096, r=8
- 原始参数：16,777,216
- LoRA 参数：65,536
- 压缩比：约 256 倍

**优势**

- 训练参数量极少（通常只有原始模型的 0.1%-1%）
- 不修改原始模型，可以随时切换不同的 LoRA 适配器
- 训练速度快，显存需求低
- 推理时可以合并到原始权重，无额外开销

#### QLoRA

QLoRA 在 LoRA 基础上进一步优化：先将原始模型量化为 4-bit，然后在量化后的模型上训练 LoRA。

**关键创新**

1. **4-bit NormalFloat 量化**：专门为正态分布权重设计的量化格式
2. **双重量化**：对量化常数本身再次量化，进一步节省显存
3. **分页优化器**：使用 CPU 内存辅助 GPU 显存管理

**显存对比**

| 方法 | 7B 模型显存 | 13B 模型显存 |
|------|------------|------------|
| 全量微调 | 约 28 GB | 约 52 GB |
| LoRA | 约 16 GB | 约 30 GB |
| QLoRA | 约 6 GB | 约 10 GB |

#### 实践代码

```python
# 使用 Hugging Face PEFT 库进行 LoRA 微调
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer

# 加载基础模型
model_name = "Qwen/Qwen2.5-7B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype="auto",
    device_map="auto"
)

# LoRA 配置
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=8,                    # LoRA 秩
    lora_alpha=32,          # 缩放因子，通常设为 2*r 或 4*r
    lora_dropout=0.1,       # Dropout 防过拟合
    target_modules=[        # 要应用 LoRA 的模块
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ]
)

# 应用 LoRA
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# 输出类似：trainable params: 13,107,200 || all params: 7,000,000,000 || trainable%: 0.187%

# 训练参数
training_args = TrainingArguments(
    output_dir="./lora-output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=8,
    learning_rate=2e-4,
    warmup_steps=100,
    logging_steps=10,
    save_steps=200,
    fp16=True,
)

# 训练
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    tokenizer=tokenizer,
    max_seq_length=2048,
)

trainer.train()

# 保存 LoRA 权重（只有几十 MB）
model.save_pretrained("./lora-adapter")
```

### SFT 数据集准备

数据质量是微调效果的决定性因素。

#### 数据格式

```json
{
    "instruction": "根据以下症状描述，判断可能的疾病",
    "input": "患者持续咳嗽一周，伴有低烧和胸闷",
    "output": "根据症状描述，可能的情况包括：\n1. 上呼吸道感染：咳嗽伴低烧是典型症状\n2. 支气管炎：持续咳嗽加胸闷需要关注\n3. 肺炎：如果发烧持续或加重，建议拍片检查\n\n建议及时就医，进行血常规和胸部影像检查。"
}
```

#### 数据质量标准

| 维度 | 标准 | 说明 |
|------|------|------|
| 正确性 | 输出内容事实正确 | 不能教模型错误的知识 |
| 一致性 | 格式和风格统一 | 避免自相矛盾的样本 |
| 多样性 | 覆盖各种输入情况 | 不要全是简单场景 |
| 长度适中 | 输入输出长度合理 | 过短学不到模式，过长容易截断 |
| 无噪音 | 去除低质量样本 | 人工审核必不可少 |

#### 数据准备流程

```
1. 收集原始数据（业务日志、人工编写、模型生成初稿）
2. 数据清洗（去重、格式统一、过滤低质量样本）
3. 数据标注（人工审核修正，确保输出质量）
4. 数据增强（同义改写、逆向生成）
5. 数据划分（训练集 90% / 验证集 10%）
6. 质量验证（抽查验证，统计分布）
```

#### 数据集规模参考

| 任务类型 | 最少数据量 | 推荐数据量 |
|----------|-----------|-----------|
| 风格迁移 | 500 条 | 2000-5000 条 |
| 格式控制 | 200 条 | 500-1000 条 |
| 领域知识 | 2000 条 | 5000-20000 条 |
| 复杂推理 | 5000 条 | 10000-50000 条 |

### RLHF / DPO 基本原理

#### RLHF（基于人类反馈的强化学习）

RLHF 分为三个阶段：

**阶段一：SFT（监督微调）**

用高质量数据对模型进行基础微调。

**阶段二：训练奖励模型**

让人类标注者对模型的多个输出进行排序，训练一个能预测人类偏好的奖励模型。

```
Prompt: "解释量子计算"
输出A: [好回答] --> 评分 0.8
输出B: [一般回答] --> 评分 0.3
输出C: [差回答] --> 评分 0.1
```

**阶段三：PPO 强化学习**

使用奖励模型的评分作为奖励信号，通过 PPO 算法优化生成策略。

```
模型生成 --> 奖励模型评分 --> PPO 更新策略 --> 更好的生成
```

#### DPO（Direct Preference Optimization）

DPO 简化了 RLHF 的流程，直接用偏好数据优化模型，不需要单独训练奖励模型。

**核心思想**

给定一对偏好数据（好回答 vs 差回答），直接调整模型使好回答的概率增大，差回答的概率减小。

```python
# DPO 训练数据格式
{
    "prompt": "解释量子计算",
    "chosen": "好的回答...",      # 人类偏好
    "rejected": "差的回答..."     # 人类不偏好
}
```

**优势**

- 不需要训练奖励模型
- 训练更稳定，超参数更少
- 效果接近 RLHF

```python
from trl import DPOTrainer

dpo_trainer = DPOTrainer(
    model=model,
    ref_model=ref_model,
    args=training_args,
    train_dataset=preference_dataset,
    tokenizer=tokenizer,
    beta=0.1,  # DPO 的温度参数
)

dpo_trainer.train()
```

### 模型量化

量化是将模型参数从高精度（如 FP16）转换为低精度（如 INT8、INT4），降低显存需求。

#### 常用量化方法

| 方法 | 精度 | 显存节省 | 效果损失 | 适用场景 |
|------|------|----------|----------|----------|
| FP16 | 16-bit | 基准 | 无 | 训练和推理的默认选择 |
| INT8 | 8-bit | 约 50% | 很小 | 推理部署 |
| GPTQ-4bit | 4-bit | 约 75% | 较小 | 消费级 GPU 推理 |
| AWQ-4bit | 4-bit | 约 75% | 较小 | 兼顾速度和精度 |
| GGUF | 可变 | 可变 | 可变 | CPU 推理（Ollama） |

#### GPTQ 量化

```python
from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig

# 量化配置
quantize_config = BaseQuantizeConfig(
    bits=4,              # 量化位数
    group_size=128,      # 分组大小
    desc_act=True,       # 激活值排序
)

# 加载模型并量化
model = AutoGPTQForCausalLM.from_pretrained(
    model_name,
    quantize_config=quantize_config
)

# 需要校准数据
model.quantize(calibration_data)

# 保存量化模型
model.save_quantized("./model-gptq-4bit")
```

#### GGUF 格式（用于 Ollama）

GGUF 是 llama.cpp 使用的模型格式，支持 CPU 和混合推理。

```bash
# 转换为 GGUF 格式
python convert_hf_to_gguf.py ./model --outtype f16 --outfile model.gguf

# 量化为 4-bit
./llama-quantize model.gguf model-Q4_K_M.gguf Q4_K_M

# 使用 Ollama 运行
ollama create mymodel -f Modelfile
ollama run mymodel
```

### 训练常见问题

#### 过拟合

**表现**：训练 loss 持续下降，但验证集表现变差。

**解决方案**：
- 减小学习率（2e-5 -> 5e-6）
- 增加 dropout（0.1 -> 0.2）
- 减少训练轮数
- 增加数据量
- 使用早停（Early Stopping）

#### 欠拟合

**表现**：训练 loss 降不下来。

**解决方案**：
- 增大学习率
- 增加 LoRA 秩（r=8 -> r=16）
- 增加可训练模块数量
- 检查数据质量

#### 灾难性遗忘

**表现**：微调后模型在通用任务上表现下降。

**解决方案**：
- 降低学习率
- 混入通用数据进行联合训练
- 减少 LoRA 秩
- 使用较小的训练轮数（1-2 个 epoch）

#### 显存不足

**解决方案**：
- 使用 QLoRA（4-bit 量化）
- 减小 batch_size，增大 gradient_accumulation_steps
- 使用梯度检查点（gradient_checkpointing=True）
- 使用 DeepSpeed ZeRO 分布式训练

## 重点认知

1. **微调不是第一选择**：先尝试 Prompt 和 RAG，确实不够再考虑微调
2. **数据质量大于数量**：1000 条高质量数据比 10000 条低质量数据效果好
3. **LoRA 是性价比之王**：绝大多数场景下 LoRA 就够了，不需要全量微调
4. **量化是部署的必经之路**：从 FP16 到 INT4，模型大小缩小 4 倍，效果损失很小
5. **评估很重要**：微调后必须在独立测试集上评估，不能只看训练 loss

## 实战建议

1. 从 QLoRA 开始实验，硬件要求最低
2. 先用 100-200 条数据快速验证效果，再扩大数据规模
3. 保留基础模型的评估结果，方便对比微调效果
4. 使用 Weights & Biases 或 TensorBoard 跟踪训练过程
5. 微调后做 A/B 测试，对比微调前后的实际效果

## 常见问题

**Q：LoRA 的秩 r 设多大合适？**

A：通常从 r=8 开始。简单任务（格式控制）r=4 可能就够了；复杂任务（领域适配）可能需要 r=16 或更高。r 越大可学习的参数越多，但也更容易过拟合。建议通过实验选择。

**Q：微调需要多少 GPU？**

A：QLoRA 微调 7B 模型，单张 RTX 3090/4090（24GB）即可。13B 模型需要 2 张。全量微调 7B 至少需要 4 张 A100（80GB）。LoRA/QLoRA 大幅降低了硬件门槛。

**Q：如何评估微调效果？**

A：准备独立的测试集（不参与训练），从三个维度评估：(1) 任务准确率；(2) 通用能力保持度（用通用基准测试）；(3) 人工评估（抽样检查输出质量）。

## 小结

本讲系统学习了模型微调的核心技术：从决策框架到 LoRA/QLoRA 实践，从数据准备到 RLHF/DPO 对齐方法，从量化部署到训练排障。微调是让大模型深度适配业务场景的关键手段，但也要理性看待它的适用范围。下一讲将进入工程化部署，学习如何将模型从实验室带到生产环境。
