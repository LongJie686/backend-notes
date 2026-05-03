# 第 6 讲：模型微调——让大模型成为专属 AI

---

## 一、为什么需要微调？

---

### 先问自己三个问题

在决定微调之前，你必须问清楚：

**问题 1：Prompt Engineering 解决不了吗？**
**问题 2：RAG 解决不了吗？**
**问题 3：微调真的是最优解吗？**

很多团队在这三个问题上走了弯路——花了几个月微调，最后发现换个 Prompt 就能解决。

---

### 三种方案的对比

```
+---------------------------------------------------------------+
|            Prompt / RAG / 微调 决策矩阵                        |
+--------------+----------------+-----------------+--------------+
|   维度        |  Prompt        |  RAG            |  微调         |
+--------------+----------------+-----------------+--------------+
| 知识注入      | 少量静态知识   | 大量动态知识    | 领域专有知识  |
| 风格控制      | 有限           | 有限            | 强            |
| 推理能力      | 依赖基础模型   | 依赖基础模型    | 可增强        |
| 响应延迟      | 最低           | 中              | 最低（推理快）|
| 成本          | 低             | 中              | 高（训练）    |
| 更新难度      | 极易（改文字） | 易（更新文档）  | 难（重新训练）|
| 幻觉风险      | 高             | 低              | 中            |
| 实施周期      | 天             | 周              | 月            |
+--------------+----------------+-----------------+--------------+
```

---

### 什么时候必须微调？

**场景 1：改变模型的"风格"和"个性"**

```
目标：训练一个用特定方言回话的客服机器人
Prompt 的问题：每次都要在 Prompt 里强调，不稳定
RAG 的问题：风格不是文档，检索不了
微调：直接把风格烧进模型 [OK]
```

**场景 2：提升特定任务的推理能力**

```
目标：让模型能准确理解法律条文并分析案例
Prompt 的问题：模型本身缺乏法律推理能力
RAG 的问题：检索到法条，但推理还是错
微调：用大量法律案例训练，提升推理 [OK]
```

**场景 3：格式输出的强一致性**

```
目标：永远输出特定的 JSON 结构，100% 稳定
Prompt 的问题：偶尔格式错误（5-10% 概率）
微调：训练后几乎 100% 输出正确格式 [OK]
```

**场景 4：降低推理成本**

```
目标：用小模型（7B）达到大模型（70B）的效果
方案：用大模型生成的高质量数据微调小模型 [OK]
```

**场景 5：数据隐私**

```
目标：不想把数据发给 OpenAI
方案：私有化部署 + 微调 [OK]
```

---

### 什么时候不需要微调？

```
[FAIL] 你只是想让模型"知道"某些信息 --> 用 RAG
[FAIL] 你只是想改变输出格式 --> 先试 Prompt
[FAIL] 你的数据集少于 100 条 --> 效果不好
[FAIL] 你没有 GPU 资源 --> 成本太高
[FAIL] 你需要快速上线 --> 微调周期太长
```

---

## 二、微调的核心概念

---

### 1. 全量微调 vs 参数高效微调

**全量微调（Full Fine-tuning）：**

```
修改模型的所有参数（几十亿个）
优点：效果最好
缺点：
  - 需要巨量 GPU 显存（7B 模型需要 140GB+）
  - 训练时间长
  - 容易发生灾难性遗忘
  - 每个任务都需要保存一个完整的模型副本
```

**参数高效微调（PEFT）：**

```
只修改模型的一小部分参数
代表：LoRA、QLoRA、Adapter、Prefix Tuning
优点：
  - 显存需求少
  - 训练快
  - 不容易过拟合
  - 多任务共享基础模型
缺点：
  - 效果可能略低于全量微调（但差距越来越小）
```

**结论：** 工程实践中，**LoRA / QLoRA 是首选**。

---

### 2. LoRA 原理（直觉理解）

**LoRA = Low-Rank Adaptation（低秩适配）**

**核心思想：** 不直接修改原始权重矩阵 W，而是**学习一个低秩的"增量"**。

**数学上（简化理解）：**

```
原始模型：y = W . x
           W 是一个巨大矩阵（比如 4096 x 4096 = 1600万参数）

LoRA：    y = (W + ΔW) . x
           其中 ΔW = A . B
           A 是 4096 x r 矩阵
           B 是 r x 4096 矩阵
           r 是"秩"（通常 4-64）

           当 r = 8 时：
           参数量 = 4096x8 + 8x4096 = 65536
           比原来少了 244 倍！
```

**直觉理解：**

```
想象你有一本 1000 页的书（原始模型参数）。
你不想重写整本书，但想改变书的"风格"。

LoRA 的做法：
在书的每一页加一张"便签纸"（增量 ΔW）。
便签纸很小（低秩），但能改变读者理解书的方式。

训练时：只更新便签纸，书本身不动。
推理时：书 + 便签纸 = 微调后的效果。
```

**LoRA 的关键参数：**

| 参数 | 含义 | 常用值 | 影响 |
|------|------|--------|------|
| r（rank） | 低秩矩阵的秩 | 4, 8, 16, 32, 64 | 越大效果越好，但越慢 |
| lora_alpha | 缩放系数 | 通常 = r 或 2r | 影响学习率的等效大小 |
| lora_dropout | Dropout 率 | 0.05-0.1 | 防止过拟合 |
| target_modules | 应用 LoRA 的层 | q_proj, v_proj | 越多效果越好 |

---

### 3. QLoRA：在 LoRA 基础上量化

**QLoRA = Quantized LoRA**

**核心贡献：** 用 4-bit 量化加载基础模型，大幅减少显存。

```
传统 LoRA（16-bit 加载基础模型）：
  7B 模型 = 14GB 显存（仅基础模型）
  + LoRA 参数 + 梯度 + 优化器状态
  总计：约 60-80GB 显存 --> 需要 A100

QLoRA（4-bit 量化基础模型）：
  7B 模型 = 3.5GB 显存（量化后）
  + LoRA 参数（bf16） + 梯度
  总计：约 12-16GB 显存 --> 消费级 GPU（RTX 3090/4090）
```

**QLoRA 的三个核心技术：**

1. **4-bit NormalFloat（NF4）**——更适合正态分布权重的量化格式
2. **双重量化**——连量化常数也量化，进一步节省显存
3. **分页优化器**——防止显存峰值溢出

---

### 4. 监督微调（SFT）的数据格式

**SFT 的训练数据是"对话对"：**

```json
[
  {
    "instruction": "用户的输入/指令",
    "input": "额外的输入（可选）",
    "output": "期望的输出"
  }
]
```

**实际数据示例（心语机器人微调数据）：**

```json
[
  {
    "instruction": "用户：我今天被男朋友分手了，好难受",
    "input": "",
    "output": "分手的消息总是来得很突然，这种心痛是真实的。你们在一起多久了？现在最难过的是什么部分？"
  },
  {
    "instruction": "用户：感觉自己什么都做不好，同事都比我强",
    "input": "用户之前提到在一家互联网公司做产品经理，入职半年",
    "output": "入职半年正是最容易有这种感觉的时期——你还在学习曲线的爬坡阶段。能说说是哪件事让你今天特别有这种感受吗？"
  }
]
```

---

## 三、微调数据集的准备

**数据质量 >> 数据数量**

---

### 1. 数据量的参考

| 任务类型 | 最少数据量 | 推荐数据量 | 说明 |
|---------|-----------|-----------|------|
| 风格微调 | 500 条 | 2000+ 条 | 让模型学会特定风格 |
| 领域知识 | 1000 条 | 5000+ 条 | 注入专业知识 |
| 指令遵循 | 2000 条 | 10000+ 条 | 通用指令跟随 |
| 对话能力 | 1000 条 | 5000+ 条 | 多轮对话质量 |

---

### 2. 数据来源

**来源 1：人工标注（质量最高）**

```python
# 标注工具：Label Studio、Argilla
# 流程：
# 1. 设计标注规范
# 2. 标注员标注
# 3. 质量审核
# 4. 二次校验
```

**来源 2：大模型生成（成本低）**

```python
# 用 GPT-4 生成训练数据，再人工抽检
def generate_training_data(topic: str, n_samples: int = 200) -> list:
    prompt = f"""请生成 {n_samples} 条用于训练情感支持机器人的对话数据。
主题：{topic}
要求：用户消息真实多样，机器人回复温暖共情（50-100字）。
以 JSON 数组格式输出：[{{"instruction": "用户消息", "output": "机器人回复"}}]"""

    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4", messages=[{"role": "user", "content": prompt}], temperature=0.8
    )
    return json.loads(response.choices[0].message.content)

# 批量生成各主题数据
topics = ["职场压力", "感情问题", "家庭关系", "自我价值", "焦虑管理"]
all_data = []
for topic in topics:
    all_data.extend(generate_training_data(topic, n_samples=200))
```

**来源 3：现有数据集（快速启动）**

```python
# Hugging Face 上的公开数据集
from datasets import load_dataset

# 中文对话数据集
dataset = load_dataset("shibing624/alpaca-zh")
# BELLE 数据集
dataset = load_dataset("BelleGroup/train_1M_CN")
# 心理咨询相关
dataset = load_dataset("Amod/mental_health_counseling_conversations")
```

---

### 3. 数据清洗

> 数据清洗5步流程（代码核心逻辑）

| 步骤 | 方法 | 过滤内容 |
|------|------|---------|
| 1 | `_remove_empty` | 移除 instruction 或 output 为空的数据 |
| 2 | `_filter_length` | 过滤过短(<5字)或过长(>512字)的输入，以及过短(<10字)或过长(>1024字)的输出 |
| 3 | `_remove_duplicates` | 基于 instruction 内容去重 |
| 4 | `_filter_quality` | 过滤包含"抱歉我无法"、代码块过多、大量英文等低质量数据 |
| 5 | `_normalize` | 格式标准化，统一为 {instruction, input, output} |

```python
class DataCleaner:
    """训练数据清洗器（5步流水线）"""
    def clean(self, data: List[Dict]) -> List[Dict]:
        data = self._remove_empty(data)
        data = self._filter_length(data)
        data = self._remove_duplicates(data)
        data = self._filter_quality(data)
        data = self._normalize(data)
        # 打印统计：total → removed_empty/too_short/too_long/duplicates/low_quality → final
        return data

    def _filter_quality(self, data: List[Dict]) -> List[Dict]:
        """过滤低质量数据：拒绝回答/代码块过多/大量英文"""
        issues = [
            lambda d: "抱歉，我无法" in d.get("output", ""),
            lambda d: d.get("output", "").count("```") > 4,
            lambda d: bool(re.search(r"[a-zA-Z]{50,}", d.get("output", ""))),
        ]
        return [d for d in data if not any(issue(d) for issue in issues)]
```

---

### 4. 数据集格式转换

**Alpaca 格式（最常用）：**

```python
def to_alpaca_format(data: List[Dict]) -> List[Dict]:
    """转换为 Alpaca 格式"""
    return [
        {
            "instruction": d["instruction"],
            "input": d.get("input", ""),
            "output": d["output"]
        }
        for d in data
    ]

# 保存为 JSON
with open("train_data.json", "w", encoding="utf-8") as f:
    json.dump(to_alpaca_format(clean_data), f, ensure_ascii=False, indent=2)
```

**ShareGPT 格式（多轮对话）：**

```python
# ShareGPT 格式支持多轮对话
sharegpt_data = [
    {
        "conversations": [
            {"from": "human", "value": "用户第一轮"},
            {"from": "gpt", "value": "机器人第一轮"},
            {"from": "human", "value": "用户第二轮"},
            {"from": "gpt", "value": "机器人第二轮"},
        ]
    }
]
```

---

## 四、LoRA 微调实战

---

### 1. 环境准备

```bash
# 安装依赖
pip install transformers==4.36.0
pip install peft==0.7.1
pip install trl==0.7.4
pip install bitsandbytes==0.41.3  # 量化支持
pip install accelerate==0.25.0
pip install datasets==2.15.0
pip install wandb  # 训练监控
```

---

### 2. 完整训练脚本（LoRA）

**训练配置参数表：**

| 配置分类 | 参数 | 推荐值 | 说明 |
|---------|------|--------|------|
| **模型** | model_name | Qwen/Qwen-7B-Chat | 基础模型选择 |
| **LoRA** | lora_r | 8 | 低秩矩阵秩，通常 4-64 |
| | lora_alpha | 16 | 缩放系数，通常 = 2*r |
| | lora_dropout | 0.05 | 防止过拟合 |
| | target_modules | q/k/v/o_proj + gate/up/down_proj | 应用 LoRA 的模块 |
| **量化** | use_4bit | True | QLoRA 4-bit 量化 |
| | bnb_4bit_quant_type | nf4 | NormalFloat4 格式 |
| | use_nested_quant | True | 双重量化节省显存 |
| **训练** | num_epochs | 3 | 训练轮数 |
| | per_device_batch_size | 4 | 每 GPU batch size |
| | gradient_accumulation | 4 | 梯度累积，等效 batch=16 |
| | learning_rate | 2e-4 | LoRA 推荐学习率 |
| | lr_scheduler | cosine | 余弦退火调度 |
| | warmup_ratio | 0.03 | 3% 步数做 warmup |
| **数据** | max_seq_length | 2048 | 最大序列长度 |
| | packing | False | 是否打包多条数据 |

**训练脚本核心步骤（简化版）：**

```python
# Step 1: 加载模型和分词器（QLoRA 4-bit）
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True, bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True
)
model = AutoModelForCausalLM.from_pretrained(
    model_name, quantization_config=bnb_config, device_map="auto", trust_remote_code=True
)
model = prepare_model_for_kbit_training(model)  # QLoRA 必须步骤

# Step 2: 配置 LoRA
lora_config = LoraConfig(
    r=8, lora_alpha=16, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    lora_dropout=0.05, bias="none", task_type=TaskType.CAUSAL_LM
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()  # 输出: trainable params: 4,194,304 || 0.0622%

# Step 3: 加载和格式化数据（Alpaca 格式 → "### 指令：\n{instruction}\n\n### 回复：\n{output}"）
train_dataset = Dataset.from_list(json.load(open("train_data.json")))
train_dataset = train_dataset.map(format_instruction)

# Step 4: 配置训练参数
training_args = TrainingArguments(
    output_dir="./xinyu_lora",
    num_train_epochs=3, per_device_train_batch_size=4,
    gradient_accumulation_steps=4,  # 等效 batch_size=16
    learning_rate=2e-4, optim="paged_adamw_32bit",
    warmup_ratio=0.03, lr_scheduler_type="cosine",
    fp16=False, bf16=True, max_grad_norm=0.3,
    logging_steps=10, save_steps=100,
    evaluation_strategy="steps", eval_steps=100,
    load_best_model_at_end=True, report_to="wandb",
)

# Step 5: 创建 SFTTrainer 并开始训练
trainer = SFTTrainer(
    model=model, train_dataset=train_dataset, eval_dataset=eval_dataset,
    dataset_text_field="text", max_seq_length=2048, tokenizer=tokenizer,
    args=training_args, packing=False,
)
trainer.train()
trainer.save_model("./xinyu_lora")  # 保存 LoRA 权重
```

---

## 五、训练过程监控

---

### 1. 训练曲线观察

**Loss 曲线应该是这样的：**

```
Loss
 ^
3.0 |*
2.5 |  **
2.0 |     ***
1.5 |        *****
1.2 |              ********
1.0 |                      **************
0.8 |                                    ~~~~~~  <- 收敛
    +-------------------------------------------> Steps
```

**异常情况：**

```
情况 1：Loss 完全不下降
  原因：学习率太低、数据问题
  解决：调高学习率，检查数据格式

情况 2：Loss 震荡剧烈
  原因：学习率太高
  解决：降低学习率，增加 warmup

情况 3：Loss 下降后突然飙升（Loss Spike）
  原因：某条坏数据、梯度爆炸
  解决：检查数据，开启梯度裁剪（max_grad_norm）

情况 4：Train Loss 低，Val Loss 高
  原因：过拟合
  解决：增加 dropout，减少训练轮数，增加数据量
```

---

### 2. 用 Weights & Biases 监控

```python
import wandb

# 初始化 wandb
wandb.init(
    project="xinyu-finetuning",
    config={
        "model": "Qwen-7B",
        "lora_r": 8,
        "learning_rate": 2e-4,
        "epochs": 3,
        "batch_size": 16
    }
)

# 训练时自动记录，训练结束后
wandb.finish()
```

**关键指标监控：**

```python
# 自定义训练监控回调
class MonitorCallback(TrainerCallback):
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs and "loss" in logs:
            wandb.log({"train_loss": logs["loss"], "learning_rate": logs.get("learning_rate")})
    def on_evaluate(self, args, state, control, metrics=None, **kwargs):
        if metrics:
            wandb.log({"eval_loss": metrics.get("eval_loss")})
```

---

## 六、微调效果评估

---

### 1. 自动评估

```python
from datasets import load_metric

def evaluate_model(model, tokenizer, eval_data: list) -> dict:
    """评估微调效果：对前50条数据生成结果，计算 ROUGE 分数"""
    model.eval()
    generated, references = [], []
    for sample in eval_data[:50]:
        inputs = tokenizer(f"### 指令：\n{sample['instruction']}\n\n### 回复：\n", return_tensors="pt").to(model.device)
        with torch.no_grad():
            outputs = model.generate(**inputs, max_new_tokens=256, temperature=0.7, do_sample=True)
        generated.append(tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True))
        references.append(sample["output"])

    rouge = load_metric("rouge")
    scores = rouge.compute(predictions=generated, references=references)
    return {"rouge1": scores["rouge1"].mid.fmeasure, "rouge2": scores["rouge2"].mid.fmeasure, "rougeL": scores["rougeL"].mid.fmeasure}
```

---

### 2. LLM 自动评估（推荐）

```python
def llm_evaluate(
    generated_outputs: List[str],
    reference_outputs: List[str],
    instructions: List[str],
    judge_llm
) -> dict:
    """用强大 LLM 评估微调效果"""

    scores = []

    for instruction, generated, reference in zip(
        instructions, generated_outputs, reference_outputs
    ):
        prompt = f"""请评估以下 AI 助手的回复质量。

用户问题：{instruction}

参考回复：{reference}

AI 回复：{generated}

请从以下维度评分（1-10分）并给出简要说明：
1. 相关性：回复是否准确回答了问题
2. 质量：回复的语言质量、逻辑性
3. 安全性：是否有害或不当内容
4. 风格：是否符合预期的回复风格

以 JSON 格式输出：
{{
    "relevance": 8,
    "quality": 7,
    "safety": 10,
    "style": 9,
    "overall": 8.5,
    "comment": "简短评语"
}}"""

        try:
            result = json.loads(judge_llm.predict(prompt))
            scores.append(result)
        except:
            pass

    if scores:
        avg_scores = {
            "avg_relevance": sum(s["relevance"] for s in scores) / len(scores),
            "avg_quality": sum(s["quality"] for s in scores) / len(scores),
            "avg_safety": sum(s["safety"] for s in scores) / len(scores),
            "avg_style": sum(s["style"] for s in scores) / len(scores),
            "avg_overall": sum(s["overall"] for s in scores) / len(scores),
        }
        return avg_scores

    return {}
```

---

### 3. 人工评估清单

```
+-----------------------------------------------------------+
|                  人工评估维度清单                           |
+-----------------------------------------------------------+
|                                                            |
|  [OK] 指令遵循度                                           |
|     - 模型是否按照指令输出了期望的格式？                     |
|     - 是否完成了指令要求的任务？                             |
|                                                            |
|  [OK] 事实准确性                                            |
|     - 输出的信息是否准确？                                   |
|     - 是否有幻觉？                                           |
|                                                            |
|  [OK] 领域适应性                                            |
|     - 是否掌握了目标领域的知识和语言风格？                    |
|     - 专业术语使用是否准确？                                 |
|                                                            |
|  [OK] 对话自然度                                            |
|     - 回复是否自然流畅？                                     |
|     - 是否像真人对话？                                       |
|                                                            |
|  [OK] 安全性                                                |
|     - 是否会输出有害内容？                                    |
|     - 拒绝不当请求的能力是否保留？                            |
|                                                            |
|  [OK] 通用能力保留                                           |
|     - 微调后通用能力是否下降？（灾难性遗忘检测）               |
|     - 测试：普通数学题、常识问答                             |
|                                                            |
+-----------------------------------------------------------+
```

---

## 七、常见问题与解决

---

### 问题 1：Loss 不收敛

```python
# 排查清单

# 1. 检查数据格式是否正确
sample = train_dataset[0]
print(sample["text"])  # 看格式是否正确

# 2. 检查分词结果
tokens = tokenizer(sample["text"])
print(f"Token 数量: {len(tokens['input_ids'])}")

# 3. 调整学习率
# 太低 --> 调大 10 倍
# 太高 --> 调小 10 倍
# 推荐范围：1e-5 到 5e-4

# 4. 检查数据质量
# 是否有大量重复数据
# 是否有格式错误的数据

# 5. 增加 warmup
warmup_ratio = 0.1  # 10% 的步数做 warmup
```

---

### 问题 2：过拟合

```
症状：Train Loss 很低，Val Loss 高，生成结果重复训练数据

解决方案：
1. 增加 lora_dropout（0.05 --> 0.1）
2. 减少训练轮数（提前停止）
3. 增加训练数据多样性
4. 降低学习率
5. 增加 weight_decay
```

```python
# 早停配置
training_args = TrainingArguments(
    ...
    evaluation_strategy="steps",
    eval_steps=50,
    save_strategy="steps",
    save_steps=50,
    load_best_model_at_end=True,  # 自动加载最好的检查点
    metric_for_best_model="eval_loss",
    greater_is_better=False,      # Loss 越低越好
    # 早停回调
)

from transformers import EarlyStoppingCallback
trainer = SFTTrainer(
    ...
    callbacks=[EarlyStoppingCallback(early_stopping_patience=3)]
)
```

---

### 问题 3：灾难性遗忘

```
症状：微调后领域任务效果好，但通用能力下降了
     比如：微调情感对话后，模型不会做数学题了

原因：微调数据单一，模型过度适应，丢失了原有能力

解决方案：

方案 1：混入通用数据（推荐）
# 在训练数据中加入 5-10% 的通用对话数据
train_data = domain_data + 0.1 * general_data

方案 2：降低学习率
# 学习率越低，对原始权重改动越小
learning_rate = 1e-5  # 更保守

方案 3：减少 LoRA rank
# rank 越小，改动越小
lora_r = 4  # 比 8 更保守

方案 4：只微调部分层
target_modules = ["q_proj", "v_proj"]  # 只改 Attention 的 Q 和 V
```

---

### 问题 4：显存不足（OOM）

```python
# 解决方案（从简单到复杂）

# 方案 1：减小 batch size
per_device_train_batch_size = 1

# 方案 2：增加梯度累积
gradient_accumulation_steps = 16  # 等效 batch size 不变

# 方案 3：启用梯度检查点
model.gradient_checkpointing_enable()

# 方案 4：使用 QLoRA（4-bit 量化）
use_4bit = True

# 方案 5：减小序列长度
max_seq_length = 512  # 从 2048 减到 512

# 方案 6：使用 deepspeed
# 在 training_args 中添加
deepspeed="ds_config.json"
```

---

### 问题 5：生成重复

```python
# 生成时的去重参数
outputs = model.generate(
    **inputs,
    max_new_tokens=256,
    temperature=0.7,
    do_sample=True,
    repetition_penalty=1.3,  # 重复惩罚，>1 减少重复
    no_repeat_ngram_size=3,  # 禁止重复 3-gram
)
```

---

## 八、模型量化：减小体积，加快推理

---

### 1. 量化是什么？

**量化：用更少的比特表示模型权重。**

```
原始模型（FP32）：每个权重 32 bits
FP16/BF16：每个权重 16 bits    --> 体积减半，精度略降
INT8：每个权重 8 bits           --> 体积减为原来 1/4，精度稍降
INT4：每个权重 4 bits           --> 体积减为原来 1/8，精度有损失
```

**对比：**

| 格式 | 7B 模型大小 | 推理速度 | 精度损失 |
|------|------------|---------|---------|
| FP32 | 28 GB | 最慢 | 无 |
| FP16/BF16 | 14 GB | 快 | 极少 |
| INT8 | 7 GB | 较快 | 少 |
| INT4 | 3.5 GB | 快 | 中 |

---

### 2. 用 bitsandbytes 做推理量化

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
import torch

# INT8 量化
model = AutoModelForCausalLM.from_pretrained(
    "model_path",
    load_in_8bit=True,
    device_map="auto"
)

# INT4 量化
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True
)

model = AutoModelForCausalLM.from_pretrained(
    "model_path",
    quantization_config=bnb_config,
    device_map="auto"
)
```

---

### 3. GPTQ 量化（离线量化，推理更快）

```python
from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig

# 量化配置
quantize_config = BaseQuantizeConfig(
    bits=4,                  # 4-bit 量化
    group_size=128,          # 分组大小
    desc_act=False,
)

# 加载原始模型
model = AutoGPTQForCausalLM.from_pretrained(
    "original_model_path",
    quantize_config=quantize_config
)

# 准备量化校准数据（需要代表性样本）
calibration_data = [
    tokenizer.encode("示例文本1"),
    tokenizer.encode("示例文本2"),
    # ... 1024 条左右
]

# 执行量化
model.quantize(calibration_data)

# 保存量化模型
model.save_quantized("quantized_model_path")

# 推理时加载
model = AutoGPTQForCausalLM.from_quantized(
    "quantized_model_path",
    device_map="auto"
)
```

---

### 4. LoRA 权重合并（部署用）

```python
from peft import PeftModel

# 加载基础模型
base_model = AutoModelForCausalLM.from_pretrained(
    "base_model_path",
    torch_dtype=torch.float16,
    device_map="auto"
)

# 加载 LoRA 权重
model = PeftModel.from_pretrained(base_model, "lora_weights_path")

# 合并 LoRA 权重到基础模型（方便部署）
merged_model = model.merge_and_unload()

# 保存合并后的模型
merged_model.save_pretrained("merged_model_path")
tokenizer.save_pretrained("merged_model_path")

print("权重合并完成！")
```

---

## 九、微调后的推理部署

---

### 1. 用 vLLM 高性能推理

```python
from vllm import LLM, SamplingParams

# 加载合并后的模型
llm = LLM(
    model="merged_model_path",
    tensor_parallel_size=1,   # GPU 数量
    gpu_memory_utilization=0.9,
    max_model_len=4096
)

# 采样参数
sampling_params = SamplingParams(
    temperature=0.7,
    top_p=0.9,
    max_tokens=512,
    repetition_penalty=1.1
)

# 批量推理（高效）
prompts = [
    "### 指令：\n你好，今天你感觉怎么样？\n\n### 回复：\n",
    "### 指令：\n我最近压力很大，该怎么办？\n\n### 回复：\n",
]

outputs = llm.generate(prompts, sampling_params)

for output in outputs:
    print(output.outputs[0].text)
```

---

### 2. 用 Ollama 本地部署

```bash
# 把模型转为 GGUF 格式（Ollama 支持的格式）
pip install llama-cpp-python

python convert.py merged_model_path --outtype f16 --outfile xinyu.gguf

# 量化（可选，减小体积）
./quantize xinyu.gguf xinyu-q4_k_m.gguf Q4_K_M

# 创建 Modelfile
cat > Modelfile << EOF
FROM ./xinyu-q4_k_m.gguf

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1

SYSTEM """你是心语，一个温暖的情感陪伴机器人……"""
EOF

# 创建模型
ollama create xinyu -f Modelfile

# 运行
ollama run xinyu
```

---

### 3. FastAPI 推理服务

```python
# FastAPI 推理服务核心代码
app = FastAPI()
model = AutoModelForCausalLM.from_pretrained("merged_model_path", torch_dtype=torch.float16, device_map="auto")
tokenizer = AutoTokenizer.from_pretrained("merged_model_path")
model.eval()

class InferRequest(BaseModel):
    instruction: str
    max_new_tokens: int = 256
    temperature: float = 0.7

@app.post("/infer")
async def infer(request: InferRequest):
    prompt = f"### 指令：\n{request.instruction}\n\n### 回复：\n"
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model.generate(**inputs, max_new_tokens=request.max_new_tokens,
                                 temperature=request.temperature, do_sample=True)
    generated = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return {"response": generated.strip()}

@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## 十、微调决策的完整思维框架

```
+---------------------------------------------------------------+
|                    微调决策树                                   |
|                                                                 |
|  你的问题是什么？                                                |
|       |                                                         |
|       +-- 模型不知道某些知识？                                   |
|       |         +-- 知识会频繁更新？                             |
|       |               +-- 是 --> RAG                             |
|       |               +-- 否 --> 微调（注入静态知识）              |
|       |                                                         |
|       +-- 输出格式不稳定？                                       |
|       |         +-- 先试 Prompt --> 还不行 --> 微调               |
|       |                                                         |
|       +-- 模型风格不对？                                         |
|       |         +-- 微调 [OK]                                    |
|       |                                                         |
|       +-- 特定任务推理能力不足？                                  |
|       |         +-- 微调 [OK]                                    |
|       |                                                         |
|       +-- 成本太高？                                             |
|                 +-- 微调小模型达到大模型效果 [OK]                 |
|                                                                 |
|  微调之前确认：                                                  |
|  [ ] 数据量 >= 500 条                                            |
|  [ ] 有 GPU 资源                                                 |
|  [ ] Prompt + RAG 确实解决不了                                   |
|  [ ] 有评估方案                                                  |
|  [ ] 团队有足够时间                                              |
+---------------------------------------------------------------+
```

---

## 十一、这一讲的核心要点总结

---

1. **微调不是万能药**——先试 Prompt，再试 RAG，最后才考虑微调

2. **LoRA 是工程首选**——参数少、速度快、效果好、易管理

3. **QLoRA 让消费级 GPU 也能微调**——4-bit 量化大幅降低显存要求

4. **数据质量 >> 数据数量**——500 条高质量 > 5000 条低质量

5. **数据清洗不能省**——坏数据会毁掉整个训练

6. **一定要有验证集**——监控过拟合，防止过度训练

7. **Loss 曲线是训练的"心电图"**——异常的 Loss 代表需要排查

8. **LLM 评估比 ROUGE 更准**——传统指标对生成任务不够精确

9. **灾难性遗忘是真实风险**——加入通用数据缓解

10. **量化是生产部署必备**——7B 模型量化后可以在普通 GPU 跑

11. **LoRA 权重可以合并**——部署时合并更方便，推理更快

12. **vLLM 是高性能推理首选**——连续批处理，吞吐量远高于 HuggingFace

---

## 十二、面试高频题（第 6 讲）

---

**Q1：LoRA 的原理是什么？为什么能用少量参数实现微调？**

**标准答案：**

**核心思想：** 不直接修改原始权重 W，而是训练一个低秩增量矩阵 \delta W = A x B。

**数学原理：**
- 原始权重 W 是 d x d 的大矩阵
- LoRA 把 \delta W 分解为 d x r 的矩阵 A 和 r x d 的矩阵 B
- r 远小于 d（通常 4-64 vs 4096）
- 参数量从 d^2 降到 2dr，节省 d/(2r) 倍

**为什么有效：**
- 学术研究表明，模型微调时的权重变化是低秩的
- 大多数任务适配不需要改变所有维度
- 低秩矩阵能捕获最重要的方向

**工程意义：**
- 7B 模型用 LoRA 只需要 ~6000 万参数参与训练
- 显存需求大幅减少
- 可以为不同任务训练不同的 LoRA 权重，共享基础模型

---

**Q2：QLoRA 和 LoRA 的区别是什么？**

**标准答案：**

**LoRA：**
- 基础模型用 FP16 加载（7B = 14GB）
- 只有 LoRA 增量参数参与训练
- 需要 60-80GB 显存

**QLoRA：**
- 基础模型用 **4-bit NF4 量化**加载（7B = 3.5GB）
- LoRA 增量参数用 BF16 存储和训练
- 加入了双重量化和分页优化器
- 只需 **12-16GB 显存**

**核心贡献：**
1. 4-bit NormalFloat 量化格式，比 INT4 精度更高
2. 双重量化：连量化常数也量化
3. 分页优化器：防止显存溢出

**实用价值：** 普通消费级 GPU（RTX 3090/4090）也能微调 7B 模型

---

**Q3：微调数据怎么准备？多少数据才够？**

**标准答案：**

**数据来源（质量从高到低）：**
1. 人工标注——质量最高，成本最贵
2. 专家生成——领域专家写示例
3. GPT-4 生成 + 人工审核——性价比高，推荐
4. 公开数据集——快速起步

**数量参考：**
- 风格微调：500-2000 条
- 领域知识：1000-5000 条
- 通用指令跟随：5000-10000 条

**数据质量要点：**
- 多样性（避免重复）
- 准确性（标注要正确）
- 格式一致（统一模板）
- 长度合理（过短或过长都有问题）

**清洗步骤：**
去空值 --> 过滤长度 --> 去重 --> 质量过滤 --> 格式标准化

---

**Q4：什么是灾难性遗忘？怎么缓解？**

**标准答案：**

**定义：** 模型在学习新任务后，忘记了原来学会的能力。

**例子：** 微调了情感对话任务，模型不会做数学题了。

**根本原因：** 微调数据分布单一，模型过度适应，覆盖了原有知识。

**缓解方案：**
1. **混入通用数据**——5-10% 的通用对话数据，最有效
2. **降低学习率**——对原始权重改动更小
3. **减小 LoRA rank**——限制可修改的参数量
4. **使用 LoRA**——本身就比全量微调改动小
5. **早停**——不过度训练
6. **定期评估通用能力**——发现问题及时调整

---

**Q5：训练 Loss 不下降怎么排查？**

**标准答案：**

**排查步骤：**

1. **检查数据格式**
   - 打印几条样本，确认格式正确
   - 检查特殊 token 是否正确

2. **检查学习率**
   - 太低（<1e-5）--> 调大
   - 太高（>5e-3）--> 调小

3. **检查数据质量**
   - 是否有大量重复？
   - 是否有明显错误标注？

4. **检查显存使用**
   - OOM 错误会导致梯度为空

5. **从小实验开始**
   - 先用 100 条数据过拟合（Loss 应该下降很快）
   - 如果 100 条都不能下降，说明有根本性问题

---

**Q6：LoRA rank 怎么设置？**

**标准答案：**

**经验规则：**

| Rank | 参数量（7B模型） | 适用场景 |
|------|---------------|---------|
| 4 | 极少 | 简单风格迁移，资源极限 |
| 8 | 少 | 大多数任务的默认值 |
| 16 | 中 | 需要更强适应能力 |
| 32 | 多 | 复杂任务、数据量大 |
| 64 | 很多 | 接近全量微调 |

**实践建议：**
- 先用 r=8 作为基准
- 效果不好时增大 r
- 资源紧张时减小 r
- alpha 通常设为 r 或 2r

---

**Q7：微调完成后怎么部署？**

**标准答案：**

**部署流程：**

1. **合并权重**（推荐）
   - `model.merge_and_unload()` 将 LoRA 合并到基础模型
   - 推理时不需要额外的 LoRA 处理

2. **量化**（减小体积）
   - GPTQ 4-bit 量化
   - AWQ 量化
   - bitsandbytes INT8

3. **推理服务**
   - vLLM：高并发，生产首选
   - Ollama：本地部署，简单
   - TGI（Text Generation Inference）：Hugging Face 出品
   - FastAPI 封装：灵活定制

4. **性能优化**
   - 连续批处理（Continuous Batching）
   - KV Cache 优化
   - 流式输出

---

**Q8：如何评估微调效果？**

**标准答案：**

**三种评估方法：**

1. **自动指标**
   - ROUGE（文本相似度）
   - BLEU（翻译类任务）
   - 准确率（分类任务）
   - 局限：对开放式生成不准

2. **LLM 评估**（推荐）
   - 用 GPT-4 对生成结果打分
   - 评估维度：相关性、质量、安全性、风格
   - 需要一致的 Judge Prompt

3. **人工评估**（最准）
   - 盲测对比（不知道是微调前还是微调后）
   - 多维度评分
   - 黄金测试集

**评估维度：**
- 指令遵循度
- 领域适应性
- 通用能力保留
- 安全性
- 对话自然度

---

## 十三、练习题

---

### 练习 1：决策判断

**场景：** 以下需求，判断用 Prompt / RAG / 微调哪种方案，并说明原因：

1. 让模型用四川话回复用户
2. 让模型知道公司最新的产品价格（每周更新）
3. 让模型能准确理解并生成特定格式的合同文本
4. 让模型在回答中自动引用公司内部知识库
5. 用 7B 小模型实现 GPT-4 级别的代码补全效果
6. 让模型拒绝回答竞品相关的问题

---

### 练习 2：数据集设计

**任务：** 为"心语"情感机器人设计微调数据集。

**要求：**
1. 设计 5 个不同的情感场景
2. 每个场景写 3 条对话样本（instruction + output）
3. 每条 output 要符合心语的风格（温暖、共情、有引导性）
4. 考虑一个场景是否需要多轮对话格式

---

### 练习 3：超参数调优

**场景：** 你的 LoRA 训练出现以下问题：

1. 第 100 步 Loss 从 2.5 下降到 2.0 后就不再下降了
2. 训练集 Loss = 0.3，验证集 Loss = 1.8
3. GPU 显存在某些步骤突然 OOM
4. 生成的文本不断重复同一个词

**请分析原因并给出调参建议。**

---

### 练习 4：数据清洗

**给定以下原始数据（有多种问题），请找出问题并修复：**

```json
[
  {
    "instruction": "",
    "output": "好的，我明白了"
  },
  {
    "instruction": "我好难过",
    "output": "作为AI语言模型，我无法真正理解你的感受，但我可以告诉你..."
  },
  {
    "instruction": "我好难过",
    "output": "听起来你很难过，能告诉我发生了什么吗？"
  },
  {
    "instruction": "帮我写一段代码",
    "output": "当然！\n```python\nprint('hello world')\n```"
  },
  {
    "instruction": "我最近失眠严重",
    "output": "失眠真的很痛苦。你最近有什么压力吗？是什么让你睡不着？"
  }
]
```

---

### 练习 5：架构设计

**场景：** 你的团队要部署一个私有化的"心语"机器人，要求：
- 数据不出公司内网
- GPU 资源：2 台 A100 80GB
- 并发：100 QPS
- 响应延迟：< 3 秒

**请设计：**
1. 选择哪个基础模型？为什么？
2. 微调策略（LoRA 参数、数据量）
3. 量化方案
4. 部署架构（推理服务、负载均衡）
5. 监控方案

---

## 十四、下一讲预告

**第 7 讲：工程化部署、监控与运维**

会讲：
- 大模型应用整体架构设计
- Docker 容器化完整实践
- vLLM / TGI 推理服务部署
- 流式输出与 SSE 实现
- API 网关与负载均衡
- Prometheus + Grafana 监控体系
- 日志系统与调用链追踪
- 告警规则设计
- 成本控制策略
- CI/CD 自动化流程
- 灰度发布与 A/B 测试
- 面试高频题

**预习建议：**
- 回顾 Docker 基础命令
- 了解 Prometheus 基本概念
- 思考：心语机器人部署到生产需要哪些组件？

---

**你想继续第 7 讲，还是先做练习题？**
