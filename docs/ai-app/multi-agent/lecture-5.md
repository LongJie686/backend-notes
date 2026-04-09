# 第 5 讲：Prompt 精调与模型优化

## 核心结论（6 条必记）

1. **System Prompt 是 Agent 行为的基础约束** -- 必须包含角色定义、行为规则、输出格式、示例和边界处理五部分
2. **Few-shot 示例要精而全** -- 3-5 个覆盖正常、边界、异常三种情况，过多反而分散注意力
3. **CoT 能显著提升推理质量，但要控制 Token 消耗** -- 显式 CoT 直接要求推理，隐式 CoT 通过示例引导
4. **输出格式控制有多种手段** -- Prompt 指定 Schema < response_format 参数 < Pydantic 校验 + 自动重试
5. **Prompt 需要版本管理，每次变更记录效果指标** -- 像代码一样管理 Prompt，支持回滚和对比
6. **国产模型替代的关键是建立模型抽象层** -- 按任务复杂度分级路由，灰度切换，降级回退

---

## 一、System Prompt 设计

### 设计原则

- **角色定义**：明确 Agent 的身份和职责
- **行为约束**：规定 Agent 能做什么、不能做什么
- **输出规范**：定义输出的格式、长度、风格
- **示例引导**：提供正确行为的示例
- **异常处理**：说明遇到不确定情况时的处理方式

### 模板结构

```
# 角色定义
你是一个{角色名称}，专门负责{职责描述}。

# 核心能力
- {能力1}
- {能力2}
- {能力3}

# 行为规则
1. 必须基于提供的信息回答，不要编造内容
2. 如果信息不足，明确告知用户缺少什么信息
3. 输出必须使用 JSON 格式
4. 回答长度控制在{字数}字以内

# 输出格式
{
  "answer": "回答内容",
  "confidence": 0.0-1.0,
  "sources": ["来源1", "来源2"]
}

# 边界情况处理
- 如果无法确定答案，返回 confidence < 0.5 并说明原因
- 如果检测到潜在风险，添加 warning 字段
```

### 反面案例

```markdown
# 不好的 Prompt
你是一个助手，帮我写文章。

# 问题：角色模糊、无约束、无格式要求、无边界处理
```

---

## 二、Few-shot 示例构造

### 示例选择原则

- **代表性**：覆盖主要输入类型的典型场景
- **多样性**：包含正常、边界、异常三种情况
- **简洁性**：示例不宜过长，每个示例聚焦一个要点
- **数量控制**：3-5 个示例通常效果最佳

### 构造方法

```python
few_shot_examples = [
    {
        "input": "分析一下昨天的销售数据",
        "output": {
            "intent": "data_analysis",
            "time_range": "yesterday",
            "data_source": "sales",
            "action": "query_and_analyze"
        }
    },
    {
        "input": "帮我生成一份周报",
        "output": {
            "intent": "report_generation",
            "time_range": "last_week",
            "data_source": "all",
            "action": "aggregate_and_generate"
        }
    },
    {
        "input": "今天天气怎么样",
        "output": {
            "intent": "out_of_scope",
            "reason": "天气查询不在系统功能范围内",
            "action": "reject_with_explanation"
        }
    }
]
```

### 动态 Few-shot

根据输入内容动态选择最相关的示例：

```python
def select_few_shot_examples(query: str, examples: list, top_k: int = 3):
    """基于语义相似度选择最相关的示例"""
    query_embedding = embed(query)
    similarities = [
        (ex, cosine_similarity(query_embedding, embed(ex["input"])))
        for ex in examples
    ]
    similarities.sort(key=lambda x: x[1], reverse=True)
    return [ex for ex, _ in similarities[:top_k]]
```

---

## 三、Chain of Thought 引导

### 显式 CoT

直接要求 LLM 展示推理过程：

```python
prompt = """
请按以下步骤分析：
1. 首先识别问题类型
2. 然后列出已知条件
3. 接着推理可能的答案
4. 最后验证答案的合理性

问题：{question}

请逐步分析：
"""
```

### 隐式 CoT

通过示例展示推理过程，不显式要求：

```python
examples = """
问题：订单量下降了20%，可能的原因是什么？
分析：首先查看下降的时间段，然后检查该时间段内是否有系统故障、
促销活动结束、竞品动作等因素。结合历史同期数据进行对比。
结论：最可能的原因是上个月的大促活动结束后，购买力回归正常水平。

问题：{question}
分析：
"""
```

### 自洽性检查 (Self-Consistency)

多次生成推理链，取出现次数最多的结论：

```python
def self_consistency_check(question: str, n_samples: int = 5):
    results = []
    for _ in range(n_samples):
        reasoning = llm.generate(f"请逐步推理：{question}")
        conclusion = extract_conclusion(reasoning)
        results.append(conclusion)

    from collections import Counter
    most_common = Counter(results).most_common(1)[0]
    return most_common[0], most_common[1] / n_samples
```

---

## 四、输出格式控制

### JSON 输出

```python
# 方式一：Prompt 中指定 JSON Schema
prompt = """
请以 JSON 格式输出，必须包含以下字段：
{
  "summary": "string - 内容摘要",
  "key_points": ["string - 要点1", "string - 要点2"],
  "sentiment": "positive | negative | neutral",
  "confidence": "float (0-1)"
}

仅输出 JSON，不要包含其他内容。
"""

# 方式二：使用 response_format 参数
response = client.chat.completions.create(
    model="qwen-plus",
    messages=messages,
    response_format={"type": "json_object"}
)

# 方式三：Pydantic 校验 + 自动重试
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    summary: str
    key_points: list[str]
    sentiment: str
    confidence: float

def get_structured_output(prompt: str, max_retries: int = 3):
    for attempt in range(max_retries):
        try:
            response = llm.invoke(prompt)
            return AnalysisResult.model_validate_json(response)
        except ValidationError:
            prompt += "\n上次输出格式有误，请严格按照 JSON Schema 输出。"
    raise Exception("无法获取有效格式输出")
```

---

## 五、Prompt 版本管理

### 版本管理方案

```python
# prompt_registry.py
PROMPTS = {
    "researcher_v1": {
        "version": "1.0",
        "created_at": "2024-03-01",
        "system_prompt": "你是一个专业的研究员...",
        "metrics": {"accuracy": 0.75, "latency_ms": 2000}
    },
    "researcher_v2": {
        "version": "2.0",
        "created_at": "2024-03-15",
        "system_prompt": "你是一个拥有10年经验的研究员...",
        "metrics": {"accuracy": 0.82, "latency_ms": 2200}
    }
}

def get_prompt(name: str, version: str = "latest"):
    if version == "latest":
        key = max(k for k in PROMPTS if k.startswith(name))
    else:
        key = f"{name}_v{version}"
    return PROMPTS[key]
```

### Prompt 变更日志

| 版本 | 日期 | 变更内容 | 效果变化 |
|------|------|---------|---------|
| v1.0 | 2024-03-01 | 初始版本 | 准确率 75% |
| v1.1 | 2024-03-05 | 添加 Few-shot 示例 | 准确率 78% |
| v2.0 | 2024-03-15 | 重写角色定义 + CoT | 准确率 82% |

---

## 六、SFT 数据集构造

### 何时需要 SFT

- Prompt 工程已达瓶颈，优化空间有限
- 需要特定领域的专业输出风格
- 需要稳定输出特定格式
- 需要显著降低推理成本（小模型+精调 > 大模型+Prompt）

### 数据集构造流程

```
1. 收集种子数据（100-500条高质量输入输出对）
2. 数据清洗（去重、格式统一、质量筛选）
3. 数据增强（同义改写、反向构造）
4. 人工审核（确保质量和一致性）
5. 训练集/验证集划分（8:2）
```

### 数据格式

```json
{
    "instruction": "分析以下客户反馈的情感倾向，并提取关键问题",
    "input": "产品功能很强大，但是界面太复杂了，上手成本很高",
    "output": "{\"sentiment\": \"mixed\", \"positive\": [\"功能强大\"], \"negative\": [\"界面复杂\", \"上手成本高\"], \"priority\": \"medium\"}"
}
```

---

## 七、国产模型替代 GPT

### 替代策略

```
1. 模型抽象层：封装统一的模型调用接口
2. 能力分级：不同任务使用不同级别的模型
3. 灰度切换：新模型先在小流量验证
4. 回退机制：国产模型不可用时回退到备用模型
```

### 模型抽象层实现

```python
class ModelProvider:
    """统一的模型调用抽象层"""

    def __init__(self):
        self.providers = {
            "openai": OpenAIProvider(),
            "qwen": QwenProvider(),
            "deepseek": DeepSeekProvider(),
            "glm": GLMProvider()
        }
        self.default_provider = "qwen"

    def chat(self, messages: list, model_tier: str = "standard", **kwargs):
        provider_name = self._route(model_tier)
        return self.providers[provider_name].chat(messages, **kwargs)

    def _route(self, tier: str) -> str:
        routing = {
            "premium": "openai",
            "standard": "qwen",
            "economy": "deepseek",
            "code": "deepseek"
        }
        return routing.get(tier, self.default_provider)
```

---

## 八、A/B 测试

### 测试设计

```python
import random

def ab_test_prompt(prompt_a: str, prompt_b: str, test_cases: list, sample_ratio: float = 0.5):
    """对两组 Prompt 进行 A/B 测试"""
    results = {"a": [], "b": []}

    for case in test_cases:
        group = "a" if random.random() < sample_ratio else "b"
        prompt = prompt_a if group == "a" else prompt_b

        output = llm.invoke(prompt.format(**case))
        score = evaluate_output(output, case["expected"])

        results[group].append({
            "case": case,
            "output": output,
            "score": score
        })

    avg_a = sum(r["score"] for r in results["a"]) / len(results["a"])
    avg_b = sum(r["score"] for r in results["b"]) / len(results["b"])

    return {
        "prompt_a_avg_score": avg_a,
        "prompt_b_avg_score": avg_b,
        "winner": "a" if avg_a > avg_b else "b",
        "improvement": abs(avg_a - avg_b) / min(avg_a, avg_b) * 100
    }
```

### 评估指标

| 指标 | 说明 | 计算方式 |
|------|------|---------|
| 准确率 | 输出与预期的匹配度 | 匹配数 / 总数 |
| 格式合规率 | 输出格式的正确率 | 合规数 / 总数 |
| 平均延迟 | 响应时间 | 毫秒 |
| Token 消耗 | 平均每次调用的 Token 数 | input + output tokens |
| 成本效益 | 单位成本的效果 | 准确率 / 单次成本 |

---

## 九、实战项目：文案 Agent Prompt 优化

**目标**：通过系统化的 Prompt 优化，将文案 Agent 的输出质量从 70 分提升到 85 分。

**优化路径**：
1. 基线测试：记录当前 Prompt 的效果
2. System Prompt 重写：明确角色、约束和格式
3. 添加 Few-shot 示例：3 个正面 + 2 个反面示例
4. 引入 CoT：要求先分析目标受众再写文案
5. A/B 测试：对比每个版本的改进效果
6. 国产模型适配：分别用 Qwen 和 DeepSeek 测试

---

## 练习题（待完成）

- [ ] 练习1：为"代码审查 Agent"设计一个完整的 System Prompt
- [ ] 练习2：构造 5 个 Few-shot 示例，覆盖正常、边界和异常场景
- [ ] 练习3：设计一个 A/B 测试方案，对比两个 Prompt 版本的效果
- [ ] 练习4：实现模型抽象层，支持按任务复杂度路由到不同模型
