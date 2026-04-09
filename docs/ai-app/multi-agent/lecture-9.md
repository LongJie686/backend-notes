# 第 9 讲：数据飞轮与持续迭代

## 核心结论（6 条必记）

1. **用户反馈是迭代的燃料** -- 设计多种收集方式覆盖显式（评分、文字）和隐式（复制、停留时间）反馈
2. **标注数据质量直接决定优化效果** -- 标注一致性 > 0.8，审核通过率 > 85%，数据质量 > 数据数量 > 精调方法
3. **A/B 测试是科学决策的基础** -- 避免凭直觉优化，基于用户 ID 确定性分流，统计显著性检验
4. **效果评估要建立多维度指标体系** -- 质量、效率、成本、体验四个维度，全面衡量系统表现
5. **迭代要有节奏感** -- Prompt 每周、策略每两周、模型每月、架构每季度
6. **版本管理是安全迭代的保障** -- 支持快速回滚，每次变更记录效果指标

---

## 一、用户反馈收集

### 反馈类型设计

| 反馈类型 | 收集方式 | 数据格式 | 用途 |
|---------|---------|---------|------|
| 显式评分 | 点赞/点踩、1-5星打分 | {score: int, item_id: str} | 效果量化评估 |
| 隐式行为 | 是否复制、是否编辑、停留时间 | {action: str, duration: int} | 行为分析 |
| 文字反馈 | 意见框、纠错提交 | {text: str, category: str} | 问题定位 |
| 对比选择 | 多个结果中选最佳 | {selected: int, options: list} | 模型对比 |

### 反馈收集实现

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class UserFeedback(BaseModel):
    task_id: str
    user_id: str
    feedback_type: str
    score: Optional[float]
    is_positive: Optional[bool]
    comment: Optional[str]
    selected_option: Optional[int]
    context: dict
    created_at: datetime = datetime.now()

class FeedbackCollector:
    """用户反馈收集器"""

    async def collect(self, feedback: UserFeedback):
        await self.db.insert("user_feedbacks", feedback.model_dump())
        await self.update_stats(feedback)

        if feedback.score and feedback.score <= 2:
            await self.alert_low_score(feedback)

    async def update_stats(self, feedback: UserFeedback):
        key = f"feedback_stats:{feedback.task_id}"
        stats = await self.redis.get(key) or {"count": 0, "total_score": 0, "positive": 0}

        stats["count"] += 1
        if feedback.score:
            stats["total_score"] += feedback.score
        if feedback.is_positive:
            stats["positive"] += 1

        await self.redis.set(key, stats)
```

---

## 二、标注数据构建

### 标注数据类型

| 数据类型 | 用途 | 标注方式 | 示例 |
|---------|------|---------|------|
| 问答对 | RAG 效果优化 | 人工编写 | Q: xxx, A: xxx |
| 排序数据 | Rerank 模型训练 | 人工排序 | [doc1 > doc2 > doc3] |
| 偏好数据 | RLHF / DPO 训练 | 人工对比 | 回答A > 回答B |
| 实体标注 | NER 任务 | 人工标注 | {text, entities} |
| 分类数据 | 意图识别 | 人工分类 | {text, intent} |

### 标注流程

```
1. 数据采样 -> 2. 标注任务分配 -> 3. 标注执行 -> 4. 质量审核 -> 5. 数据入库
```

```python
class AnnotationManager:
    """标注数据管理"""

    def sample_data_for_annotation(self, strategy: str, count: int) -> list:
        if strategy == "random":
            return self._random_sample(count)
        elif strategy == "hard_cases":
            return self._sample_low_confidence(count)
        elif strategy == "diverse":
            return self._diverse_sample(count)

    def validate_annotation(self, annotation: dict, gold_standard: dict) -> dict:
        agreement = self._calc_inter_annotator_agreement(annotation, gold_standard)
        return {
            "quality": "high" if agreement > 0.8 else "medium" if agreement > 0.6 else "low",
            "agreement_score": agreement,
            "needs_review": agreement < 0.7
        }
```

### 标注质量管理

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 标注一致性 | > 0.8 | 多人标注的 Cohen's Kappa |
| 标注速度 | > 20条/小时 | 每个标注员的效率 |
| 审核通过率 | > 85% | 一次审核通过的占比 |
| 数据覆盖率 | > 90% | 标注数据覆盖的场景比例 |

---

## 三、A/B 测试

### Agent 系统的 A/B 测试设计

```python
class AgentABTest:
    """Agent 系统的 A/B 测试框架"""

    def create_experiment(self, name: str, variants: dict, traffic_pct: float = 0.1):
        self.experiments[name] = {
            "name": name,
            "variants": variants,
            "traffic_pct": traffic_pct,
            "results": {k: [] for k in variants},
            "created_at": datetime.now()
        }

    def get_variant(self, experiment_name: str, user_id: str) -> str:
        exp = self.experiments[experiment_name]
        hash_val = hash(f"{experiment_name}:{user_id}") % 100

        if hash_val < exp["traffic_pct"] * 100:
            if hash_val < exp["traffic_pct"] * 50:
                return "control"
            else:
                return "treatment"
        else:
            return "control"

    def analyze(self, experiment_name: str) -> dict:
        exp = self.experiments[experiment_name]
        control = exp["results"]["control"]
        treatment = exp["results"]["treatment"]

        control_scores = [r["metrics"].get("score", 0) for r in control]
        treatment_scores = [r["metrics"].get("score", 0) for r in treatment]

        return {
            "control_avg": sum(control_scores) / len(control_scores) if control_scores else 0,
            "treatment_avg": sum(treatment_scores) / len(treatment_scores) if treatment_scores else 0,
            "is_significant": self._statistical_test(control_scores, treatment_scores),
            "recommendation": self._recommend(control_scores, treatment_scores)
        }
```

### 测试场景

| 测试对象 | 对照组 | 实验组 | 关键指标 |
|---------|--------|--------|---------|
| Prompt 版本 | v2 Prompt | v3 Prompt | 准确率、用户评分 |
| 模型切换 | Qwen-Plus | DeepSeek-V3 | 效果、延迟、成本 |
| 检索策略 | Top-K | 混合检索+Rerank | 召回率、准确率 |
| 工具配置 | 3个工具 | 5个工具 | 任务完成率、效率 |

---

## 四、效果评估体系

### 评估维度与指标

```python
class EffectEvaluator:
    """效果评估体系"""

    def evaluate_system(self, test_set: list, predictions: list) -> dict:
        return {
            "quality": {
                "accuracy": self._accuracy(predictions, test_set),
                "relevance": self._relevance(predictions, test_set),
                "hallucination_rate": self._hallucination(predictions, test_set),
            },
            "efficiency": {
                "avg_latency_ms": self._avg_latency(),
                "p95_latency_ms": self._p95_latency(),
                "avg_tokens_per_request": self._avg_tokens(),
            },
            "cost": {
                "avg_cost_per_request": self._avg_cost(),
                "cost_per_correct_answer": self._cost_per_correct(predictions, test_set)
            },
            "user_experience": {
                "avg_user_score": self._avg_user_score(),
                "positive_feedback_rate": self._positive_rate(),
            }
        }
```

### 评估体系总览

| 维度 | 指标 | 合格线 | 优秀线 |
|------|------|--------|--------|
| 质量 - 准确率 | 与标准答案匹配度 | > 80% | > 90% |
| 质量 - 幻觉率 | 编造内容占比 | < 10% | < 3% |
| 效率 - 延迟 | P95 端到端延迟 | < 30s | < 15s |
| 效率 - Token效率 | 有效输出占比 | > 70% | > 85% |
| 成本 - 单次成本 | 平均每次调用成本 | < 0.5元 | < 0.2元 |
| 体验 - 用户评分 | 用户平均评分 | > 3.5/5 | > 4.2/5 |

---

## 五、数据驱动迭代

### 迭代闭环

```
收集数据 -> 分析问题 -> 制定优化方案 -> A/B测试 -> 效果评估 -> 上线发布
     ^                                                          |
     +----------------------------------------------------------+
```

### 迭代管理

```python
class IterationManager:
    """迭代管理器"""

    def run_iteration(self, iteration_id: str):
        iteration = self.get_iteration(iteration_id)

        ab_result = self.ab_test.run(iteration["changes"])
        evaluation = self.evaluator.evaluate(iteration_id)
        is_improved = self._check_improvement(evaluation, iteration["metrics_target"])

        if is_improved:
            self.deploy(iteration_id)
            iteration["status"] = "deployed"
        else:
            iteration["status"] = "rolled_back"
            self.rollback(iteration_id)

        return {
            "iteration_id": iteration_id,
            "is_improved": is_improved,
            "evaluation": evaluation,
            "action": "deployed" if is_improved else "rolled_back"
        }
```

### 迭代节奏

| 迭代类型 | 频率 | 变更范围 | 风险等级 |
|---------|------|---------|---------|
| Prompt 微调 | 每周 | 单个 Prompt | 低 |
| 策略调整 | 每两周 | 检索/编排策略 | 中 |
| 模型升级 | 每月 | 模型版本切换 | 中高 |
| 架构变更 | 每季度 | 系统架构调整 | 高 |

---

## 六、版本管理

### Prompt 版本管理

```python
class PromptVersionManager:
    """Prompt 版本管理"""

    def save_version(self, prompt_id: str, content: str, changelog: str):
        version = {
            "prompt_id": prompt_id,
            "version": self._get_next_version(prompt_id),
            "content": content,
            "changelog": changelog,
            "created_at": datetime.now(),
            "hash": hashlib.md5(content.encode()).hexdigest()
        }
        self._store(version)
        return version

    def rollback(self, prompt_id: str, target_version: str):
        version = self._get_version(prompt_id, target_version)
        self._activate(prompt_id, version)
        return version

    def compare(self, prompt_id: str, version_a: str, version_b: str):
        va = self._get_version(prompt_id, version_a)
        vb = self._get_version(prompt_id, version_b)
        return {
            "diff": self._compute_diff(va["content"], vb["content"]),
            "metrics_diff": {"a": va.get("metrics"), "b": vb.get("metrics")}
        }
```

### 系统版本管理

| 版本号 | 规则 | 示例 |
|--------|------|------|
| 主版本 | 架构变更 | v1.x -> v2.x |
| 次版本 | 功能变更 | v1.1 -> v1.2 |
| 修订版 | Bug 修复 | v1.1.0 -> v1.1.1 |
| Prompt 版本 | Prompt 调优 | prompt_v1 -> prompt_v2 |

---

## 七、实战项目：研报生成系统 v4（数据飞轮）

**目标**：为研报生成系统建立完整的数据飞轮。

**功能要求**：
1. 用户反馈收集：每次生成报告后收集评分和意见
2. 标注数据构建：每周从低分报告中抽取样本进行标注
3. A/B 测试：对比不同 Prompt 和模型版本的效果
4. 效果评估：建立自动化评估管道，每日输出效果报告
5. 版本管理：所有 Prompt 和配置纳入版本控制
6. 自动化迭代：基于评估结果自动触发优化流程

---

## 练习题（待完成）

- [ ] 练习1：设计一个用户反馈收集系统，包含评分、点赞/点踩和文字反馈三种方式
- [ ] 练习2：实现一个 A/B 测试框架，支持分流、记录和分析三个核心功能
- [ ] 练习3：建立一套完整的效果评估指标，涵盖质量、效率、成本和体验四个维度
- [ ] 练习4：设计一个迭代闭环流程，从反馈收集到版本上线全自动化
