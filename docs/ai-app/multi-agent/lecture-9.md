# 第九讲：数据飞轮与持续迭代

> 阶段目标：建立数据驱动的持续优化体系，让 Agent 系统"越用越聪明"。

## 学习目标

- 掌握用户反馈收集机制的设计方法
- 学会构建和管理标注数据集
- 掌握 A/B 测试在 Agent 系统中的应用
- 能建立完整的效果评估体系
- 理解数据驱动迭代的闭环流程
- 掌握 Prompt 和模型的版本管理方法

---

## 核心内容

### 1. 用户反馈收集

#### 反馈类型设计

| 反馈类型 | 收集方式 | 数据格式 | 用途 |
|---------|---------|---------|------|
| 显式评分 | 点赞/点踩、1-5星打分 | {score: int, item_id: str} | 效果量化评估 |
| 隐式行为 | 是否复制、是否编辑、停留时间 | {action: str, duration: int} | 行为分析 |
| 文字反馈 | 意见框、纠错提交 | {text: str, category: str} | 问题定位 |
| 对比选择 | 多个结果中选最佳 | {selected: int, options: list} | 模型对比 |

#### 反馈收集实现

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class UserFeedback(BaseModel):
    task_id: str
    user_id: str
    feedback_type: str          # rating / thumbs / text / comparison
    score: Optional[float]      # 评分 1-5
    is_positive: Optional[bool] # 点赞/点踩
    comment: Optional[str]      # 文字反馈
    selected_option: Optional[int]  # 对比选择
    context: dict               # 上下文信息（问题、回答、Agent版本等）
    created_at: datetime = datetime.now()

class FeedbackCollector:
    """用户反馈收集器"""

    async def collect(self, feedback: UserFeedback):
        """收集反馈"""
        # 1. 存储原始反馈
        await self.db.insert("user_feedbacks", feedback.model_dump())

        # 2. 实时统计更新
        await self.update_stats(feedback)

        # 3. 触发低分告警
        if feedback.score and feedback.score <= 2:
            await self.alert_low_score(feedback)

    async def update_stats(self, feedback: UserFeedback):
        """更新实时统计"""
        key = f"feedback_stats:{feedback.task_id}"
        stats = await self.redis.get(key) or {"count": 0, "total_score": 0, "positive": 0}

        stats["count"] += 1
        if feedback.score:
            stats["total_score"] += feedback.score
        if feedback.is_positive:
            stats["positive"] += 1

        await self.redis.set(key, stats)

    async def alert_low_score(self, feedback: UserFeedback):
        """低评分告警"""
        alert = {
            "type": "low_score_alert",
            "task_id": feedback.task_id,
            "score": feedback.score,
            "comment": feedback.comment,
            "timestamp": datetime.now().isoformat()
        }
        await self.notification.send(alert)
```

---

### 2. 标注数据构建

#### 标注数据类型

| 数据类型 | 用途 | 标注方式 | 示例 |
|---------|------|---------|------|
| 问答对 | RAG 效果优化 | 人工编写 | Q: xxx, A: xxx |
| 排序数据 | Rerank 模型训练 | 人工排序 | [doc1 > doc2 > doc3] |
| 偏好数据 | RLHF / DPO 训练 | 人工对比 | 回答A > 回答B |
| 实体标注 | NER 任务 | 人工标注 | {text, entities} |
| 分类数据 | 意图识别 | 人工分类 | {text, intent} |

#### 标注流程

```
1. 数据采样 -> 2. 标注任务分配 -> 3. 标注执行 -> 4. 质量审核 -> 5. 数据入库
```

```python
class AnnotationManager:
    """标注数据管理"""

    def create_annotation_task(self, data: list, task_type: str, guidelines: str):
        """创建标注任务"""
        task = {
            "task_id": str(uuid.uuid4()),
            "type": task_type,
            "guidelines": guidelines,
            "data": data,
            "status": "pending",
            "created_at": datetime.now()
        }
        return task

    def sample_data_for_annotation(self, strategy: str, count: int) -> list:
        """采样数据用于标注"""
        if strategy == "random":
            return self._random_sample(count)
        elif strategy == "hard_cases":
            # 优先标注模型表现差的样本
            return self._sample_low_confidence(count)
        elif strategy == "diverse":
            # 覆盖多种类型的样本
            return self._diverse_sample(count)

    def validate_annotation(self, annotation: dict, gold_standard: dict) -> dict:
        """验证标注质量"""
        agreement = self._calc_inter_annotator_agreement(annotation, gold_standard)
        return {
            "quality": "high" if agreement > 0.8 else "medium" if agreement > 0.6 else "low",
            "agreement_score": agreement,
            "needs_review": agreement < 0.7
        }
```

#### 标注质量管理

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 标注一致性 | > 0.8 | 多人标注的 Cohen's Kappa |
| 标注速度 | > 20条/小时 | 每个标注员的效率 |
| 审核通过率 | > 85% | 一次审核通过的占比 |
| 数据覆盖率 | > 90% | 标注数据覆盖的场景比例 |

---

### 3. A/B 测试

#### Agent 系统的 A/B 测试设计

```python
class AgentABTest:
    """Agent 系统的 A/B 测试框架"""

    def __init__(self):
        self.experiments = {}

    def create_experiment(self, name: str, variants: dict, traffic_pct: float = 0.1):
        """
        创建实验
        Args:
            name: 实验名称
            variants: 变体配置 {"control": config_a, "treatment": config_b}
            traffic_pct: 实验流量比例
        """
        self.experiments[name] = {
            "name": name,
            "variants": variants,
            "traffic_pct": traffic_pct,
            "results": {k: [] for k in variants},
            "created_at": datetime.now()
        }

    def get_variant(self, experiment_name: str, user_id: str) -> str:
        """确定用户属于哪个变体"""
        exp = self.experiments[experiment_name]

        # 基于用户ID的确定性分流
        hash_val = hash(f"{experiment_name}:{user_id}") % 100

        if hash_val < exp["traffic_pct"] * 100:
            # 进入实验
            if hash_val < exp["traffic_pct"] * 50:
                return "control"
            else:
                return "treatment"
        else:
            # 不进入实验，使用对照组
            return "control"

    def record_result(self, experiment_name: str, variant: str, metrics: dict):
        """记录实验结果"""
        exp = self.experiments[experiment_name]
        exp["results"][variant].append({
            "metrics": metrics,
            "timestamp": datetime.now()
        })

    def analyze(self, experiment_name: str) -> dict:
        """分析实验结果"""
        exp = self.experiments[experiment_name]
        control = exp["results"]["control"]
        treatment = exp["results"]["treatment"]

        control_scores = [r["metrics"].get("score", 0) for r in control]
        treatment_scores = [r["metrics"].get("score", 0) for r in treatment]

        return {
            "control_avg": sum(control_scores) / len(control_scores) if control_scores else 0,
            "treatment_avg": sum(treatment_scores) / len(treatment_scores) if treatment_scores else 0,
            "sample_size": {"control": len(control), "treatment": len(treatment)},
            "is_significant": self._statistical_test(control_scores, treatment_scores),
            "recommendation": self._recommend(control_scores, treatment_scores)
        }
```

#### 测试场景

| 测试对象 | 对照组 | 实验组 | 关键指标 |
|---------|--------|--------|---------|
| Prompt 版本 | v2 Prompt | v3 Prompt | 准确率、用户评分 |
| 模型切换 | Qwen-Plus | DeepSeek-V3 | 效果、延迟、成本 |
| 检索策略 | Top-K | 混合检索+Rerank | 召回率、准确率 |
| 工具配置 | 3个工具 | 5个工具 | 任务完成率、效率 |

---

### 4. 效果评估体系

#### 评估维度与指标

```python
class EffectEvaluator:
    """效果评估体系"""

    def evaluate_system(self, test_set: list, predictions: list) -> dict:
        """全面评估系统效果"""
        return {
            # 质量指标
            "quality": {
                "accuracy": self._accuracy(predictions, test_set),
                "relevance": self._relevance(predictions, test_set),
                "completeness": self._completeness(predictions, test_set),
                "hallucination_rate": self._hallucination(predictions, test_set),
                "format_compliance": self._format_compliance(predictions)
            },
            # 效率指标
            "efficiency": {
                "avg_latency_ms": self._avg_latency(),
                "p95_latency_ms": self._p95_latency(),
                "avg_tokens_per_request": self._avg_tokens(),
                "tool_call_success_rate": self._tool_success_rate()
            },
            # 成本指标
            "cost": {
                "avg_cost_per_request": self._avg_cost(),
                "cost_per_correct_answer": self._cost_per_correct(predictions, test_set)
            },
            # 用户体验指标
            "user_experience": {
                "avg_user_score": self._avg_user_score(),
                "positive_feedback_rate": self._positive_rate(),
                "retry_rate": self._retry_rate()
            }
        }
```

#### 评估体系总览

| 维度 | 指标 | 合格线 | 优秀线 |
|------|------|--------|--------|
| 质量 - 准确率 | 与标准答案匹配度 | > 80% | > 90% |
| 质量 - 幻觉率 | 编造内容占比 | < 10% | < 3% |
| 效率 - 延迟 | P95 端到端延迟 | < 30s | < 15s |
| 效率 - Token效率 | 有效输出占比 | > 70% | > 85% |
| 成本 - 单次成本 | 平均每次调用成本 | < 0.5元 | < 0.2元 |
| 体验 - 用户评分 | 用户平均评分 | > 3.5/5 | > 4.2/5 |

---

### 5. 数据驱动迭代

#### 迭代闭环

```
收集数据 -> 分析问题 -> 制定优化方案 -> A/B测试 -> 效果评估 -> 上线发布
     ^                                                          |
     +----------------------------------------------------------+
```

#### 迭代管理

```python
class IterationManager:
    """迭代管理器"""

    def create_iteration(self, iteration_config: dict) -> dict:
        """创建迭代计划"""
        return {
            "id": str(uuid.uuid4()),
            "version": iteration_config["version"],
            "changes": iteration_config["changes"],
            "hypothesis": iteration_config["hypothesis"],
            "metrics_target": iteration_config["metrics_target"],
            "status": "planned",
            "created_at": datetime.now()
        }

    def run_iteration(self, iteration_id: str):
        """执行迭代"""
        iteration = self.get_iteration(iteration_id)

        # 1. 运行 A/B 测试
        ab_result = self.ab_test.run(iteration["changes"])

        # 2. 评估效果
        evaluation = self.evaluator.evaluate(iteration_id)

        # 3. 判断是否达标
        is_improved = self._check_improvement(
            evaluation,
            iteration["metrics_target"]
        )

        # 4. 决策
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

#### 迭代节奏

| 迭代类型 | 频率 | 变更范围 | 风险等级 |
|---------|------|---------|---------|
| Prompt 微调 | 每周 | 单个 Prompt | 低 |
| 策略调整 | 每两周 | 检索/编排策略 | 中 |
| 模型升级 | 每月 | 模型版本切换 | 中高 |
| 架构变更 | 每季度 | 系统架构调整 | 高 |

---

### 6. 版本管理

#### Prompt 版本管理

```python
class PromptVersionManager:
    """Prompt 版本管理"""

    def __init__(self, storage_backend="git"):
        self.backend = storage_backend

    def save_version(self, prompt_id: str, content: str, changelog: str):
        """保存 Prompt 版本"""
        version = {
            "prompt_id": prompt_id,
            "version": self._get_next_version(prompt_id),
            "content": content,
            "changelog": changelog,
            "created_at": datetime.now(),
            "created_by": get_current_user(),
            "hash": hashlib.md5(content.encode()).hexdigest()
        }
        self._store(version)
        return version

    def rollback(self, prompt_id: str, target_version: str):
        """回滚到指定版本"""
        version = self._get_version(prompt_id, target_version)
        self._activate(prompt_id, version)
        return version

    def compare(self, prompt_id: str, version_a: str, version_b: str):
        """对比两个版本"""
        va = self._get_version(prompt_id, version_a)
        vb = self._get_version(prompt_id, version_b)
        return {
            "diff": self._compute_diff(va["content"], vb["content"]),
            "metrics_diff": {
                "a": va.get("metrics"),
                "b": vb.get("metrics")
            }
        }
```

#### 系统版本管理

| 版本号 | 规则 | 示例 |
|--------|------|------|
| 主版本 | 架构变更 | v1.x -> v2.x |
| 次版本 | 功能变更 | v1.1 -> v1.2 |
| 修订版 | Bug 修复 | v1.1.0 -> v1.1.1 |
| Prompt 版本 | Prompt 调优 | prompt_v1 -> prompt_v2 |

---

## 实战项目

### 项目：研报生成系统 v4（数据飞轮）

**目标**：为研报生成系统建立完整的数据飞轮。

**功能要求**：
1. 用户反馈收集：每次生成报告后收集评分和意见
2. 标注数据构建：每周从低分报告中抽取样本进行标注
3. A/B 测试：对比不同 Prompt 和模型版本的效果
4. 效果评估：建立自动化评估管道，每日输出效果报告
5. 版本管理：所有 Prompt 和配置纳入版本控制
6. 自动化迭代：基于评估结果自动触发优化流程

---

## 练习题

### 概念题

1. 数据飞轮的核心思想是什么？为什么说它能实现"越用越好"？
2. A/B 测试中，如何确定样本量是否足够大？
3. 版本管理中，什么情况下需要回滚？

### 实践题

1. 设计一个用户反馈收集系统，包含评分、点赞/点踩和文字反馈三种方式。
2. 实现一个 A/B 测试框架，支持分流、记录和分析三个核心功能。
3. 建立一套完整的效果评估指标，涵盖质量、效率、成本和体验四个维度。

---

## 小结

本讲学习了数据飞轮与持续迭代的完整体系。关键要点：

- 用户反馈是迭代的燃料，要设计多种收集方式覆盖显式和隐式反馈
- 标注数据质量直接决定优化效果，需要严格的质量管理流程
- A/B 测试是科学决策的基础，避免凭直觉优化
- 效果评估要建立多维度指标体系，全面衡量系统表现
- 迭代要有节奏感，不同类型的变更采用不同的迭代频率
- 版本管理是安全迭代的保障，支持快速回滚

至此，九个阶段的学习内容全部完成。从基础认知到生产部署再到持续迭代，你已经具备了搭建企业级 Multi-Agent 系统的完整能力。
