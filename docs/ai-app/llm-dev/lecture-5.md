# 第五讲：多轮对话与情感机器人项目

> 阶段目标：掌握多轮对话管理技术，综合运用 RAG 和 Agent 完成情感机器人实战项目

## 学习目标

1. 掌握多轮对话的上下文管理策略
2. 理解对话历史的存储、压缩与摘要技术
3. 学会设计会话状态机
4. 了解情感分析与识别的基本方法
5. 掌握敏感内容检测与过滤技术
6. 完成"心语"情感机器人项目

## 核心内容

### 多轮对话上下文管理

多轮对话是大模型应用最常见的交互形式，核心挑战是如何在有限的上下文窗口内管理大量历史信息。

#### 上下文窗口的困境

假设模型上下文窗口为 8K Token：
- 系统提示词：约 500 Token
- 每轮对话（用户+助手）：约 300-800 Token
- 可承载的对话轮数：约 10-20 轮

当对话超过这个限制，就需要策略来管理上下文。

#### 上下文管理策略

**滑动窗口**

保留最近的 N 轮对话，丢弃更早的。

```python
def sliding_window(messages, max_rounds=10):
    """只保留最近 max_rounds 轮对话"""
    system_msg = [m for m in messages if m["role"] == "system"]
    conversation = [m for m in messages if m["role"] != "system"]

    if len(conversation) > max_rounds * 2:
        conversation = conversation[-(max_rounds * 2):]

    return system_msg + conversation
```

优点：实现简单，效果可控
缺点：丢失早期重要信息

**摘要压缩**

对较早的对话生成摘要，用摘要替代原文。

```python
def compress_with_summary(messages, llm):
    """将早期对话压缩为摘要"""
    recent = messages[-6:]  # 保留最近3轮
    old = messages[:-6]

    if not old:
        return messages

    # 生成摘要
    summary_text = "\n".join([f"{m['role']}: {m['content']}" for m in old])
    summary = llm.generate(f"请简洁总结以下对话的关键信息：\n{summary_text}")

    summary_msg = {
        "role": "system",
        "content": f"之前的对话摘要：{summary}"
    }

    return [summary_msg] + recent
```

优点：保留关键信息
缺点：摘要可能丢失细节，额外的 Token 消耗

**Token 预算分配**

按预算分配不同类型内容的 Token 配额。

```python
class ContextManager:
    def __init__(self, total_budget=8000):
        self.budget = {
            "system": 500,
            "summary": 1000,
            "rag_context": 2000,
            "conversation": 3500,
            "response": 1000
        }
        self.total_budget = total_budget

    def build_context(self, system_prompt, summary, rag_context, conversation):
        """按预算构建上下文"""
        context = []

        # 系统提示词
        context.append({"role": "system", "content": system_prompt})

        # 摘要
        if summary:
            truncated = truncate_to_tokens(summary, self.budget["summary"])
            context.append({"role": "system", "content": f"历史摘要：{truncated}"})

        # RAG 上下文
        if rag_context:
            truncated = truncate_to_tokens(rag_context, self.budget["rag_context"])
            context.append({"role": "system", "content": f"参考资料：{truncated}"})

        # 对话历史（从最新的开始填充）
        remaining = self.budget["conversation"]
        for msg in reversed(conversation):
            msg_tokens = count_tokens(msg["content"])
            if remaining < msg_tokens:
                break
            context.insert(-1 if rag_context else -1, msg)  # 插入到参考材料前
            remaining -= msg_tokens

        return context
```

### 对话历史存储

#### 存储方案

```python
class ConversationStore:
    def __init__(self, db):
        self.db = db

    def save_message(self, session_id, role, content, metadata=None):
        """保存一条消息"""
        self.db.insert("messages", {
            "session_id": session_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "created_at": datetime.now()
        })

    def get_history(self, session_id, limit=50):
        """获取对话历史"""
        return self.db.query(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?",
            [session_id, limit]
        )

    def get_summary(self, session_id):
        """获取会话摘要"""
        result = self.db.query(
            "SELECT summary FROM session_summaries WHERE session_id = ?",
            [session_id]
        )
        return result[0]["summary"] if result else None

    def update_summary(self, session_id, summary):
        """更新会话摘要"""
        self.db.upsert("session_summaries", {
            "session_id": session_id,
            "summary": summary,
            "updated_at": datetime.now()
        })
```

#### 数据模型

```sql
CREATE TABLE sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    title VARCHAR(200),
    status VARCHAR(20) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    role VARCHAR(20) NOT NULL,  -- system/user/assistant/tool
    content TEXT NOT NULL,
    token_count INTEGER,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE session_summaries (
    session_id VARCHAR(36) PRIMARY KEY,
    summary TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 会话状态机设计

对于有明确流程的对话场景（如客服、问卷、引导），状态机可以精确控制对话走向。

#### 基本概念

```
状态（State）：对话当前所处的阶段
转移（Transition）：从一个状态到另一个状态的条件和动作
事件（Event）：触发状态转移的用户输入或系统事件
```

#### 状态机实现

```python
from enum import Enum
from typing import Dict, Callable

class SessionState(Enum):
    GREETING = "greeting"           # 开场问候
    COLLECTING_INFO = "collecting"  # 收集信息
    ANALYZING = "analyzing"         # 分析处理
    PROVIDING_ADVICE = "advising"   # 提供建议
    CLOSING = "closing"             # 结束对话

class ConversationStateMachine:
    def __init__(self):
        self.state = SessionState.GREETING
        self.data = {}
        self.transitions = self._define_transitions()

    def _define_transitions(self):
        return {
            SessionState.GREETING: {
                "next": SessionState.COLLECTING_INFO,
                "handler": self._handle_greeting
            },
            SessionState.COLLECTING_INFO: {
                "next": SessionState.ANALYZING,
                "handler": self._handle_collecting,
                "condition": self._info_complete
            },
            SessionState.ANALYZING: {
                "next": SessionState.PROVIDING_ADVICE,
                "handler": self._handle_analyzing
            },
            SessionState.PROVIDING_ADVICE: {
                "next": SessionState.CLOSING,
                "handler": self._handle_advising
            },
        }

    def process(self, user_input):
        """处理用户输入"""
        current = self.transitions[self.state]
        handler = current["handler"]
        response = handler(user_input)

        # 检查是否满足转移条件
        condition = current.get("condition")
        if condition is None or condition():
            self.state = current["next"]

        return response

    def _info_complete(self):
        """判断信息是否收集完整"""
        required_fields = ["mood", "situation", "duration"]
        return all(field in self.data for field in required_fields)
```

### 情感分析与识别

#### 基本方法

**基于 Prompt 的情感分析**

```python
def analyze_emotion(text):
    """使用 LLM 进行情感分析"""
    prompt = f"""分析以下文本中的情感状态，返回 JSON 格式：

文本：{text}

请分析：
1. 主要情感（开心/悲伤/愤怒/焦虑/平静/恐惧/惊讶/厌恶）
2. 情感强度（1-10分）
3. 情感原因（简要描述触发因素）
4. 紧急程度（低/中/高）

返回格式：
{{"emotion": "...", "intensity": N, "reason": "...", "urgency": "..."}}"""

    return llm.generate(prompt)
```

**多维度情感模型**

```
情感维度：
- 效价（Valence）：积极 <-> 消极
- 唤醒度（Arousal）：平静 <-> 激动
- 支配度（Dominance）：受控 <-> 掌控

示例：
- 开心：高积极、高唤醒、高支配
- 悲伤：低积极、低唤醒、低支配
- 愤怒：低积极、高唤醒、高支配
- 焦虑：低积极、高唤醒、低支配
```

#### 情感追踪

```python
class EmotionTracker:
    def __init__(self):
        self.history = []

    def track(self, session_id, emotion_data):
        """记录情感变化"""
        self.history.append({
            "session_id": session_id,
            "timestamp": datetime.now(),
            "emotion": emotion_data["emotion"],
            "intensity": emotion_data["intensity"],
            "urgency": emotion_data["urgency"]
        })

    def get_trend(self, session_id):
        """获取情感趋势"""
        session_data = [h for h in self.history if h["session_id"] == session_id]
        if len(session_data) < 2:
            return "stable"

        latest = session_data[-1]["intensity"]
        previous = session_data[-2]["intensity"]

        if latest - previous > 2:
            return "worsening"
        elif previous - latest > 2:
            return "improving"
        else:
            return "stable"

    def is_crisis(self, emotion_data):
        """判断是否处于危机状态"""
        crisis_emotions = ["极度悲伤", "绝望", "自我伤害倾向"]
        return (emotion_data["emotion"] in crisis_emotions or
                emotion_data["intensity"] >= 9 or
                emotion_data["urgency"] == "高")
```

### 敏感内容检测与过滤

#### 检测维度

```python
class ContentFilter:
    def __init__(self):
        self.keyword_rules = self._load_keyword_rules()
        self.pattern_rules = self._load_pattern_rules()

    def check(self, text):
        """检测敏感内容"""
        results = {
            "safe": True,
            "flags": [],
            "action": "allow"
        }

        # 关键词检测
        for category, keywords in self.keyword_rules.items():
            for keyword in keywords:
                if keyword in text:
                    results["flags"].append({
                        "category": category,
                        "keyword": keyword,
                        "method": "keyword"
                    })

        # 正则模式检测
        for category, patterns in self.pattern_rules.items():
            for pattern in patterns:
                if re.search(pattern, text):
                    results["flags"].append({
                        "category": category,
                        "pattern": pattern,
                        "method": "regex"
                    })

        # LLM 检测（用于复杂场景）
        llm_result = self._llm_check(text)
        if llm_result["flagged"]:
            results["flags"].append(llm_result)

        # 决策
        if any(f["category"] == "self_harm" for f in results["flags"]):
            results["action"] = "crisis"
            results["safe"] = False
        elif len(results["flags"]) >= 2:
            results["action"] = "review"
            results["safe"] = False
        elif results["flags"]:
            results["action"] = "warn"
            results["safe"] = True

        return results

    def _llm_check(self, text):
        """使用 LLM 进行内容审核"""
        prompt = f"""判断以下文本是否包含敏感内容。
检查维度：暴力、自伤、歧视、色情、违法
文本：{text}
返回 JSON：{{"flagged": true/false, "category": "...", "reason": "..."}}"""
        return json.loads(llm.generate(prompt))
```

#### 处理策略

| 级别 | 触发条件 | 处理方式 |
|------|----------|----------|
| 通过 | 未检测到敏感内容 | 正常处理 |
| 警告 | 检测到轻微敏感 | 允许通过但记录日志 |
| 审核 | 检测到多项敏感标记 | 暂停并请求人工审核 |
| 危机 | 检测到自伤等严重内容 | 触发危机干预流程 |

### "心语"情感机器人项目实战

#### 项目概述

"心语"是一个情感陪伴机器人，能够识别用户情感、提供倾听和建议、引导积极情绪。

#### 技术架构

```
用户输入
   |
   v
内容安全检测 --> 敏感内容 --> 危机干预
   |
   v
情感分析 --> 情感状态
   |
   v
状态机 --> 决定响应策略
   |
   v
上下文管理 --> 组装 Prompt
   |
   v
LLM 生成 --> 响应
   |
   v
输出过滤 --> 最终回复
```

#### 核心代码

```python
class XinYuBot:
    def __init__(self, llm, store, vector_db):
        self.llm = llm
        self.store = store
        self.vector_db = vector_db
        self.state_machine = ConversationStateMachine()
        self.emotion_tracker = EmotionTracker()
        self.content_filter = ContentFilter()
        self.context_manager = ContextManager()

    def chat(self, session_id, user_input):
        """处理用户消息"""
        # 1. 内容安全检测
        safety = self.content_filter.check(user_input)
        if safety["action"] == "crisis":
            return self._crisis_response()

        # 2. 情感分析
        emotion = analyze_emotion(user_input)
        self.emotion_tracker.track(session_id, emotion)

        # 3. 状态机处理
        state_response = self.state_machine.process(user_input)

        # 4. 检索相关知识
        rag_context = self._retrieve_knowledge(emotion, user_input)

        # 5. 构建上下文
        history = self.store.get_history(session_id)
        context = self.context_manager.build_context(
            system_prompt=self._build_system_prompt(emotion),
            summary=self.store.get_summary(session_id),
            rag_context=rag_context,
            conversation=history
        )

        # 6. 生成回复
        context.append({"role": "user", "content": user_input})
        response = self.llm.chat(context)

        # 7. 保存消息
        self.store.save_message(session_id, "user", user_input)
        self.store.save_message(session_id, "assistant", response)

        return response

    def _build_system_prompt(self, emotion):
        """根据情感状态构建系统提示词"""
        return f"""你是"心语"，一个温暖、专业的情感陪伴助手。

当前用户的情感状态：{emotion["emotion"]}，强度 {emotion["intensity"]}/10

请遵循以下原则：
1. 先倾听，后建议，不要急于给解决方案
2. 用共情的方式回应，让用户感到被理解
3. 如果用户情绪低落，不要说"不要难过"这样的话
4. 适时引导用户表达更多，而不是一直提问
5. 当用户情绪改善时，给予肯定和鼓励"""

    def _crisis_response(self):
        """危机干预响应"""
        return ("我感受到你现在可能正在经历一些困难的时刻。"
                "请知道，你不是一个人，有人愿意帮助你。\n"
                "全国24小时心理援助热线：400-161-9995\n"
                "北京心理危机研究与干预中心：010-82951332\n"
                "如果你愿意，可以和我聊聊你的感受。")

    def _retrieve_knowledge(self, emotion, query):
        """检索情感支持相关知识"""
        search_query = f"{emotion['emotion']} 情绪调节方法"
        results = self.vector_db.search(search_query, top_k=3)
        return "\n".join([r["content"] for r in results])
```

## 重点认知

1. **上下文管理是系统工程**：不是简单的截断，需要综合考虑信息优先级和预算分配
2. **情感分析要结合上下文**：单句话的情感判断往往不准确，需要结合对话历史
3. **安全是底线**：情感机器人直接面对脆弱的用户群体，内容安全检测不能有侥幸心理
4. **状态机让对话可控**：自由对话容易失控，状态机提供结构化的对话框架
5. **项目实战串联知识点**：情感机器人项目综合运用了 Prompt、RAG、Agent 等多项技术

## 实战建议

1. 先实现基础的对话功能，再逐步加入情感分析和状态机
2. 准备充足的测试用例，覆盖各种情感状态和边界情况
3. 内容安全检测要分层：快速过滤（关键词）+ 精细检测（LLM）
4. 情感分析结果要人工抽检，持续优化准确率
5. 实现完善的日志系统，记录情感变化轨迹便于分析

## 常见问题

**Q：情感分析的准确率如何提升？**

A：三个方向：(1) 使用专门微调过的情感分析模型；(2) 结合对话上下文而非单句分析；(3) 建立标注数据集，持续迭代。实际项目中，基于 Prompt 的方案在大多数场景下已经够用。

**Q：对话摘要的质量如何保证？**

A：摘要质量的关键在于明确摘要的目标。不是"总结对话"，而是"提取关键事实和用户偏好"。使用结构化的摘要模板比自由摘要更可靠。

**Q：情感机器人如何避免产生不当建议？**

A：(1) 在系统提示词中明确禁止提供专业心理咨询建议；(2) 输出过滤检测不恰当内容；(3) 对严重情况强制转人工；(4) 定期审核对话日志。

## 小结

本讲系统学习了多轮对话管理技术，并通过"心语"情感机器人项目将前几讲的知识串联起来。从上下文管理到情感分析，从状态机到内容安全，这些技术在实际项目中都是必需的。下一讲将进入模型微调领域，学习如何让模型更好地适配特定任务。
