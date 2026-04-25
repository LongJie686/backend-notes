# 第5讲：多轮对话与"心语"情感机器人项目

---

## 一、为什么情感机器人比普通客服难？

---

### 场景对比

**普通客服机器人：**
```
用户：我的订单什么时候到？
机器人：您的订单预计明天送达。
用户：好的谢谢。
机器人：不客气，祝您生活愉快。
```

**情感陪伴机器人：**
```
用户：今天好累，感觉什么都做不好……
机器人：听起来你今天压力很大。能跟我说说是什么让你觉得这样吗？

用户：工作上的事，被领导当众批评了，好丢脸
机器人：当众被批评真的很难受，那种感觉会让人一整天都提不起劲来。
        你现在是更多感到委屈，还是有点担心后续怎么办？

用户：都有，而且我记得你上次跟我说的那句话……
机器人：你说的是我们上次聊到"别让别人的评价定义你的价值"那句话吗？
        那次你是因为绩效评分不理想而难过……
```

**差别在哪？**

```
+-----------------------------------------------------------+
|               情感机器人 vs 普通客服                       |
+-------------------+-----------------------+---------------+
|     维度          | 普通客服              | 情感机器人     |
+-------------------+-----------------------+---------------+
| 核心目标          | 解决功能性问题        | 情感陪伴与支持 |
| 对话轮次          | 通常 3-5 轮          | 可能几十轮     |
| 记忆需求          | 当次会话              | 跨会话长期记忆 |
| 情感处理          | 无                   | 核心能力       |
| 个性化            | 低                   | 极高           |
| 话题连续性        | 单一话题              | 多话题交织     |
| 用户画像          | 基本信息              | 深度心理画像   |
| 安全敏感性        | 中                   | 极高（危机干预）|
+-------------------+-----------------------+---------------+
```

---

## 二、多轮对话的核心挑战

---

### 挑战 1：上下文窗口管理

**问题：** 对话越来越长，超出上下文窗口怎么办？

```
对话轮次 1-10：正常
对话轮次 11-20：窗口开始紧张
对话轮次 21+：窗口溢出，必须处理
```

**如果直接截断：**
```
用户：你还记得我上周说的事吗？
机器人：抱歉，我不记得了。
用户：我刚说的，怎么就忘了！
```
-- **用户体验崩溃**

---

### 挑战 2：指代消解

**问题：** 用户经常用代词指代前面说过的内容。

```
用户：我今天跟小明闹了矛盾
机器人：能说说发生了什么吗？
用户：他说我工作态度有问题
机器人：这里的"他"是指谁？  <-- 错误！不能问这么蠢的问题
```

**正确处理：**
```
用户：他说我工作态度有问题
机器人：小明说你工作态度有问题，你当时是什么感受？
```

---

### 挑战 3：话题漂移

**问题：** 用户可能在多个话题之间跳跃。

```
轮次 1：用户谈失恋
轮次 5：用户突然聊工作压力
轮次 8：用户回到失恋话题
```

机器人需要：
- 跟上话题切换
- 在合适时机将话题串联
- 不机械地回到"原话题"

---

### 挑战 4：情感弧线管理

**问题：** 用户的情感状态在变化，机器人需要感知并适应。

```
开始：愤怒
中间：倾诉后稍微平静
后来：委屈、哭泣
最后：稍微好一点了
```

机器人的回应策略需要随情感弧线调整。

---

### 挑战 5：安全与危机干预

**高危场景：**
```
用户：我觉得活着没什么意义……
用户：我最近有想消失的念头
用户：我不想让任何人担心我，所以不打算说了
```

需要：
- 实时检测危机信号
- 立刻切换到危机干预模式
- 推荐专业资源
- 通知（如果有）紧急联系人

---

## 三、多轮对话上下文管理策略

---

### 策略 1：滑动窗口（最简单）

**核心思想：** 只保留最近 N 轮对话。

```python
from collections import deque
from typing import List
from dataclasses import dataclass

@dataclass
class Message:
    role: str      # "user" | "assistant" | "system"
    content: str
    timestamp: float = 0.0
    emotion: str = ""  # 情感标签

class SlidingWindowMemory:
    """滑动窗口记忆"""

    def __init__(self, max_rounds: int = 10):
        self.max_rounds = max_rounds
        self.messages = deque()
        self.system_message = None

    def set_system(self, content: str):
        self.system_message = Message(role="system", content=content)

    def add(self, role: str, content: str, emotion: str = ""):
        self.messages.append(Message(
            role=role,
            content=content,
            timestamp=time.time(),
            emotion=emotion
        ))

        # 超出窗口时，成对删除（保持 user-assistant 配对）
        while len(self.messages) > self.max_rounds * 2:
            self.messages.popleft()
            self.messages.popleft()

    def get_messages(self) -> List[dict]:
        result = []
        if self.system_message:
            result.append({
                "role": self.system_message.role,
                "content": self.system_message.content
            })
        result.extend([
            {"role": m.role, "content": m.content}
            for m in self.messages
        ])
        return result
```

**优点：** 简单，Token 可控
**缺点：** 丢失早期重要信息

---

### 策略 2：对话摘要（推荐）

**核心思想：** 定期将历史对话压缩成摘要，用摘要替代原始历史。

```python
from langchain_openai import ChatOpenAI
import json

class SummaryMemory:
    """
    摘要记忆
    保留最近 N 轮原始对话 + 历史对话摘要
    """

    def __init__(
        self,
        llm,
        recent_rounds: int = 5,    # 保留最近 5 轮原始对话
        summary_threshold: int = 10  # 超过 10 轮触发摘要
    ):
        self.llm = llm
        self.recent_rounds = recent_rounds
        self.summary_threshold = summary_threshold

        self.summary = ""             # 历史摘要
        self.recent_messages = []     # 最近的原始对话
        self.total_rounds = 0         # 总对话轮数

    def add(self, role: str, content: str):
        self.recent_messages.append({"role": role, "content": content})

        if role == "assistant":
            self.total_rounds += 1

        # 超过阈值，触发摘要
        if len(self.recent_messages) > self.summary_threshold * 2:
            self._compress()

    def _compress(self):
        """压缩历史对话为摘要"""

        # 要被压缩的对话（保留最近 recent_rounds 轮）
        keep = self.recent_rounds * 2
        to_compress = self.recent_messages[:-keep]
        self.recent_messages = self.recent_messages[-keep:]

        if not to_compress:
            return

        # 构建要压缩的对话文本
        conv_text = "\n".join([
            f"{'用户' if m['role'] == 'user' else '心语'}: {m['content']}"
            for m in to_compress
        ])

        # 用 LLM 生成摘要
        summary_prompt = f"""请将以下对话总结为简洁的摘要。
摘要要包含：
1. 用户表达的主要情感和困扰
2. 重要的事件和人物
3. 已经讨论过的关键话题
4. 用户展现出的性格特点和偏好
5. 任何用户的重要个人信息（如果有）

之前的摘要（如果有）：
{self.summary}

新的对话：
{conv_text}

请输出更新后的完整摘要（200字以内）："""

        new_summary = self.llm.predict(summary_prompt)
        self.summary = new_summary

        print(f"[记忆压缩] 已压缩 {len(to_compress)//2} 轮对话")

    def get_context(self) -> str:
        """获取注入给模型的上下文"""
        context = ""

        if self.summary:
            context += f"【之前对话的摘要】\n{self.summary}\n\n"

        context += "【最近的对话】\n"
        for msg in self.recent_messages:
            role = "用户" if msg["role"] == "user" else "心语"
            context += f"{role}: {msg['content']}\n"

        return context

    def get_messages(self) -> List[dict]:
        """获取消息列表（含摘要）"""
        messages = []

        if self.summary:
            # 把摘要作为 system 消息的补充
            messages.append({
                "role": "system",
                "content": f"以下是你和用户之前对话的摘要，请记住这些信息：\n{self.summary}"
            })

        messages.extend(self.recent_messages)
        return messages
```

---

### 策略 3：关键信息提取（用户画像）

**核心思想：** 从对话中提取并持久化重要的用户信息。

```python
class UserProfileExtractor:
    """从对话中提取用户画像"""

    def __init__(self, llm):
        self.llm = llm
        self.profile = {
            "name": None,
            "age": None,
            "occupation": None,
            "key_relationships": [],   # 重要人际关系
            "recurring_concerns": [],  # 反复出现的困扰
            "personality_traits": [],  # 性格特点
            "preferences": {           # 对话偏好
                "communication_style": None,
                "sensitive_topics": [],
                "likes": [],
                "dislikes": []
            },
            "important_events": [],    # 重要事件
            "last_updated": None
        }

    def extract_from_conversation(self, messages: List[dict]) -> dict:
        """从对话中提取用户信息"""

        conv_text = "\n".join([
            f"{'用户' if m['role'] == 'user' else '心语'}: {m['content']}"
            for m in messages
            if m["role"] in ["user", "assistant"]
        ])

        extract_prompt = f"""请从以下对话中提取用户的关键信息。

对话：
{conv_text}

请以 JSON 格式输出，只包含从对话中能确认的信息，不确定的填 null：
{{
    "name": "用户姓名或昵称",
    "age": "年龄",
    "occupation": "职业",
    "key_relationships": ["重要人物1", "重要人物2"],
    "recurring_concerns": ["反复出现的困扰1", "困扰2"],
    "personality_traits": ["性格特点1", "特点2"],
    "important_events": ["重要事件1", "事件2"],
    "communication_preferences": "用户喜欢什么样的沟通方式"
}}

只输出 JSON："""

        try:
            result = self.llm.predict(extract_prompt)
            extracted = json.loads(result)
            self._merge_profile(extracted)
        except Exception as e:
            print(f"提取失败: {e}")

        return self.profile

    def _merge_profile(self, new_data: dict):
        """合并新提取的信息到现有画像"""
        for key, value in new_data.items():
            if value is None:
                continue
            if isinstance(value, list):
                existing = self.profile.get(key, [])
                if isinstance(existing, list):
                    # 合并去重
                    combined = list(set(existing + value))
                    self.profile[key] = combined
            elif value and not self.profile.get(key):
                self.profile[key] = value

        self.profile["last_updated"] = datetime.now().isoformat()

    def get_profile_summary(self) -> str:
        """获取画像摘要，注入给模型"""
        parts = []

        if self.profile["name"]:
            parts.append(f"用户叫{self.profile['name']}")
        if self.profile["occupation"]:
            parts.append(f"职业：{self.profile['occupation']}")
        if self.profile["recurring_concerns"]:
            concerns = "、".join(self.profile["recurring_concerns"])
            parts.append(f"常见困扰：{concerns}")
        if self.profile["key_relationships"]:
            relations = "、".join(self.profile["key_relationships"])
            parts.append(f"重要关系：{relations}")
        if self.profile["personality_traits"]:
            traits = "、".join(self.profile["personality_traits"])
            parts.append(f"性格特点：{traits}")

        return "。".join(parts) if parts else ""
```

---

### 策略 4：三层记忆架构（完整方案）

```python
class ThreeLayerMemory:
    """
    三层记忆架构：
    - 工作记忆：最近 5 轮原始对话
    - 情景记忆：当次会话摘要
    - 长期记忆：用户画像 + 跨会话重要信息
    """

    def __init__(self, llm, user_id: str):
        self.llm = llm
        self.user_id = user_id

        # 工作记忆
        self.working_memory = deque(maxlen=10)  # 最近 5 轮

        # 情景记忆
        self.episodic_summary = ""
        self.episode_messages = []  # 当次会话所有消息

        # 长期记忆
        self.long_term_profile = self._load_profile(user_id)
        self.long_term_events = self._load_events(user_id)

    def add_message(self, role: str, content: str):
        """添加消息到所有层次"""
        msg = {"role": role, "content": content, "time": time.time()}

        # 工作记忆（自动滚动）
        self.working_memory.append(msg)

        # 情景记忆（全量保存当次会话）
        self.episode_messages.append(msg)

        # 触发压缩
        if len(self.episode_messages) > 20 and role == "assistant":
            self._update_episodic_summary()

    def _update_episodic_summary(self):
        """更新当次会话摘要"""
        # ...（类似 SummaryMemory._compress）
        pass

    def build_context_for_llm(self) -> List[dict]:
        """构建注入给 LLM 的消息列表"""
        messages = []

        # 1. 长期记忆注入
        profile_summary = self.long_term_profile.get_summary()
        if profile_summary:
            messages.append({
                "role": "system",
                "content": f"关于这位用户，你记得以下信息：\n{profile_summary}"
            })

        # 2. 情景记忆注入
        if self.episodic_summary:
            messages.append({
                "role": "system",
                "content": f"本次对话前半段的内容：\n{self.episodic_summary}"
            })

        # 3. 工作记忆（最近对话）
        messages.extend([
            {"role": m["role"], "content": m["content"]}
            for m in self.working_memory
        ])

        return messages

    def end_session(self):
        """会话结束时，提炼信息存入长期记忆"""
        self._extract_and_save_to_long_term()

    def _extract_and_save_to_long_term(self):
        """提取重要信息保存到长期记忆"""
        # 调用 LLM 提取本次会话的重要信息
        # 合并到用户画像
        # 持久化存储
        pass

    def _load_profile(self, user_id: str):
        # 从数据库加载
        pass

    def _load_events(self, user_id: str):
        # 从数据库加载
        pass
```

---

## 四、情感分析与识别

---

### 1. 情感分析方案

**方案 1：用 LLM 做情感分析（准确，但有延迟）**

```python
class EmotionAnalyzer:
    """情感分析器"""

    EMOTION_LABELS = [
        "愤怒", "悲伤", "焦虑", "恐惧",
        "委屈", "孤独", "无助", "绝望",
        "平静", "快乐", "感激", "满足",
        "困惑", "羞耻", "自责"
    ]

    def __init__(self, llm):
        self.llm = llm

    def analyze(self, text: str, context: str = "") -> dict:
        """分析单条消息的情感"""

        prompt = f"""你是一个情感分析专家，专注于识别用户的情绪状态。

{'上下文：' + context if context else ''}

用户消息："{text}"

请分析用户当前的情感状态，以 JSON 格式输出：
{{
    "primary_emotion": "主要情感（从以下选一个）: {', '.join(self.EMOTION_LABELS)}",
    "secondary_emotions": ["次要情感1", "次要情感2"],
    "intensity": "情感强度 1-10",
    "is_crisis": false,
    "crisis_signals": ["危机信号，如果有"],
    "needs": ["用户可能的心理需求，如：被理解、被支持、解决问题"],
    "suggested_response_style": "建议的回应方式：共情/引导/支持/直接建议"
}}

只输出 JSON："""

        try:
            result = self.llm.predict(prompt)
            return json.loads(result)
        except:
            return {
                "primary_emotion": "未知",
                "intensity": 5,
                "is_crisis": False,
                "crisis_signals": [],
                "needs": ["被理解"],
                "suggested_response_style": "共情"
            }

    def analyze_trend(self, recent_emotions: List[dict]) -> dict:
        """分析情感趋势"""
        if len(recent_emotions) < 2:
            return {"trend": "stable", "description": "数据不足"}

        intensities = [e.get("intensity", 5) for e in recent_emotions]
        latest = intensities[-1]
        prev = intensities[-2]

        if latest > prev + 2:
            trend = "worsening"
        elif latest < prev - 2:
            trend = "improving"
        else:
            trend = "stable"

        return {
            "trend": trend,
            "current_intensity": latest,
            "description": {
                "worsening": "情绪在恶化，需要更多支持",
                "improving": "情绪有所好转",
                "stable": "情绪相对稳定"
            }[trend]
        }
```

---

### 2. 危机检测

```python
class CrisisDetector:
    """危机干预检测器"""

    # 高风险关键词
    HIGH_RISK_KEYWORDS = [
        "想死", "去死", "不想活", "活着没意思",
        "消失", "结束生命", "自杀", "割腕",
        "不想让人担心", "最后一次", "再见了"
    ]

    # 中风险关键词
    MEDIUM_RISK_KEYWORDS = [
        "活着好累", "撑不下去", "没有意义",
        "绝望", "没希望", "放弃了"
    ]

    def __init__(self, llm):
        self.llm = llm

    def quick_check(self, text: str) -> dict:
        """快速规则检测（低延迟，第一道防线）"""
        text_lower = text.lower()

        for kw in self.HIGH_RISK_KEYWORDS:
            if kw in text_lower:
                return {
                    "risk_level": "high",
                    "triggered_keyword": kw,
                    "needs_deep_check": True
                }

        for kw in self.MEDIUM_RISK_KEYWORDS:
            if kw in text_lower:
                return {
                    "risk_level": "medium",
                    "triggered_keyword": kw,
                    "needs_deep_check": True
                }

        return {"risk_level": "low", "needs_deep_check": False}

    def deep_check(self, text: str, context: str = "") -> dict:
        """深度 LLM 检测（高精度，第二道防线）"""

        prompt = f"""你是心理危机干预专家。请分析以下对话是否存在心理危机风险。

{f'对话背景：{context}' if context else ''}

用户最新消息："{text}"

请以 JSON 格式评估：
{{
    "risk_level": "high/medium/low",
    "confidence": 0.0-1.0,
    "crisis_type": "自伤/自杀/情绪崩溃/无",
    "warning_signs": ["具体的危险信号"],
    "immediate_action": "建议立即采取的行动",
    "suggested_response": "建议的回复内容"
}}

只输出 JSON："""

        try:
            result = self.llm.predict(prompt)
            return json.loads(result)
        except:
            return {"risk_level": "unknown", "confidence": 0}

    def get_crisis_response(self, risk_level: str) -> str:
        """获取危机干预回应"""

        responses = {
            "high": """我很担心你现在的状态。你愿意告诉我，你现在有没有伤害自己的想法？

无论如何，你的生命对我来说很重要，对关心你的人也很重要。

如果你现在很痛苦，可以立刻拨打：
- 北京心理危机研究与干预中心：010-82951332
- 全国心理援助热线：400-161-9995
- 生命热线：400-821-1215（24小时）

我在这里，你愿意继续跟我说说吗？""",

            "medium": """听起来你现在很累、很痛苦。这种感觉很真实，我想多了解一下你现在的状态。

你说"撑不下去"，能告诉我是什么让你觉得这么难吗？
你现在身边有可以陪着你的人吗？"""
        }

        return responses.get(risk_level, "")
```

---

## 五、敏感内容过滤

---

### 1. 多层过滤架构

```python
class ContentFilter:
    """
    多层内容过滤器
    Layer 1: 规则过滤（快速）
    Layer 2: LLM 过滤（精准）
    Layer 3: 输出审核（最后防线）
    """

    # 硬过滤词（必须过滤）
    HARD_BLOCK_PATTERNS = [
        r"如何.*?制作.*?炸弹",
        r"怎么.*?伤害.*?他人",
        r"贩卖.*?毒品",
    ]

    # 软过滤词（需要 LLM 判断）
    SOFT_ALERT_KEYWORDS = [
        "伤害", "报复", "复仇",
        "刀", "药物", "死"
    ]

    def __init__(self, llm):
        self.llm = llm

    def filter_input(self, text: str) -> dict:
        """过滤用户输入"""

        # Layer 1: 硬规则过滤
        for pattern in self.HARD_BLOCK_PATTERNS:
            if re.search(pattern, text, re.DOTALL):
                return {
                    "allowed": False,
                    "reason": "包含违规内容",
                    "filtered_text": None
                }

        # Layer 2: 软关键词触发 LLM 检测
        has_soft_keyword = any(kw in text for kw in self.SOFT_ALERT_KEYWORDS)

        if has_soft_keyword:
            llm_result = self._llm_check_input(text)
            if not llm_result["safe"]:
                return {
                    "allowed": False,
                    "reason": llm_result["reason"],
                    "filtered_text": None
                }

        return {"allowed": True, "filtered_text": text}

    def filter_output(self, text: str) -> dict:
        """过滤模型输出"""

        # 不能包含的信息类型
        forbidden_content = [
            "具体的自杀方法",
            "伤害他人的具体指导",
            "违法信息",
        ]

        prompt = f"""请检查以下文本是否包含不安全的内容。

文本：{text}

不安全内容包括：{', '.join(forbidden_content)}

请以 JSON 格式输出：
{{"safe": true/false, "reason": "原因（如果不安全）"}}

只输出 JSON："""

        try:
            result = json.loads(self.llm.predict(prompt))
            if not result.get("safe", True):
                return {
                    "allowed": False,
                    "reason": result.get("reason"),
                    "replacement": "抱歉，我无法提供这方面的内容。如果你有困扰，我们可以一起找到更好的方式。"
                }
        except:
            pass

        return {"allowed": True, "text": text}

    def _llm_check_input(self, text: str) -> dict:
        """用 LLM 深度检查输入"""
        prompt = f"""判断以下用户输入是否安全。

情感支持场景中，即使提到负面词语（如"死""伤害"），也可能是正常倾诉。
只有明确要求有害信息时才判定不安全。

用户输入："{text}"

{{
    "safe": true/false,
    "reason": "判断原因"
}}"""

        try:
            return json.loads(self.llm.predict(prompt))
        except:
            return {"safe": True}
```

---

## 六、会话状态机设计

---

### 1. 对话状态

```python
from enum import Enum

class DialogState(Enum):
    """对话状态"""
    GREETING = "greeting"           # 初始问候
    EXPLORING = "exploring"         # 探索用户问题
    EMPATHIZING = "empathizing"     # 共情阶段
    SUPPORTING = "supporting"       # 深度支持
    PROBLEM_SOLVING = "problem_solving"  # 问题解决
    CRISIS = "crisis"               # 危机干预
    CLOSING = "closing"             # 结束对话
    IDLE = "idle"                   # 闲聊状态

class DialogStateMachine:
    """对话状态机"""

    # 状态转移规则
    TRANSITIONS = {
        DialogState.GREETING: [DialogState.EXPLORING, DialogState.IDLE],
        DialogState.EXPLORING: [DialogState.EMPATHIZING, DialogState.CRISIS, DialogState.IDLE],
        DialogState.EMPATHIZING: [DialogState.SUPPORTING, DialogState.PROBLEM_SOLVING, DialogState.CRISIS],
        DialogState.SUPPORTING: [DialogState.PROBLEM_SOLVING, DialogState.CLOSING, DialogState.CRISIS],
        DialogState.PROBLEM_SOLVING: [DialogState.SUPPORTING, DialogState.CLOSING],
        DialogState.CRISIS: [DialogState.SUPPORTING, DialogState.CLOSING],
        DialogState.IDLE: [DialogState.EXPLORING, DialogState.CLOSING],
        DialogState.CLOSING: [DialogState.GREETING],
    }

    def __init__(self):
        self.current_state = DialogState.GREETING
        self.state_history = [DialogState.GREETING]
        self.rounds_in_current_state = 0

    def transition(self, new_state: DialogState) -> bool:
        """状态转移"""
        allowed = self.TRANSITIONS.get(self.current_state, [])

        if new_state in allowed:
            self.current_state = new_state
            self.state_history.append(new_state)
            self.rounds_in_current_state = 0
            return True

        return False

    def get_current_state(self) -> DialogState:
        return self.current_state

    def increment_round(self):
        self.rounds_in_current_state += 1

    def should_advance(self) -> bool:
        """是否应该推进到下一阶段"""
        # 在某个状态停留太久，可能需要推进
        return self.rounds_in_current_state > 5
```

---

### 2. 状态对应的回应策略

```python
# 不同状态下的 System Prompt 片段
STATE_PROMPTS = {
    DialogState.GREETING: """
这是第一次对话，你需要：
- 热情地问候用户
- 简单介绍自己
- 温和地询问用户今天的状态
""",

    DialogState.EXPLORING: """
用户在表达困扰，你需要：
- 积极倾听，不要急于给建议
- 用开放性问题引导用户深入表达
- 重复和确认用户的感受
- 示例："你说的XX，能展开讲讲吗？"
""",

    DialogState.EMPATHIZING: """
用户需要共情和理解，你需要：
- 验证用户的情感（"这种感受完全可以理解"）
- 不要立即解决问题，先让用户感到被理解
- 使用温暖的语言
- 适当分享"很多人在类似情况下会有这样的感受"
""",

    DialogState.SUPPORTING: """
用户需要深度支持，你需要：
- 持续提供情感支持
- 帮助用户整理思路
- 提供资源和建议（但不是命令）
- 关注用户的优势和资源
""",

    DialogState.PROBLEM_SOLVING: """
用户准备好了解决问题，你需要：
- 与用户一起分析问题
- 提供具体、可行的建议
- 鼓励用户自主选择
- 建立小目标
""",

    DialogState.CRISIS: """
[危机干预模式]
你必须：
- 保持冷静和温暖
- 直接询问用户的安全状况
- 不要做判断，不要最小化
- 提供危机热线
- 鼓励用户寻求专业帮助
- 不要独自处理，引导用户联系专业机构
""",

    DialogState.CLOSING: """
对话即将结束，你需要：
- 总结本次对话的收获
- 表达对用户的关心
- 鼓励用户明天继续对话
- 留下温暖的告别
"""
}
```

---

## 七、"心语"情感机器人完整实现

---

### 1. 系统架构

```
+-----------------------------------------------------------------+
|                      心语系统架构                                |
|                                                                   |
|  用户输入                                                         |
|      |                                                            |
|      v                                                            |
|  +----------+    +----------+    +--------------+               |
|  | 输入过滤  |--->| 危机检测  |--->|  情感分析     |               |
|  +----------+    +----------+    +------+-------+               |
|                       |                  |                        |
|                  触发危机？              情感状态                  |
|                       |                  |                        |
|                       v                  v                        |
|              +--------------+   +--------------+                |
|              |  危机干预流程  |   |  状态机更新    |                |
|              +--------------+   +------+-------+                |
|                                        |                         |
|                                  当前状态                         |
|                                        |                         |
|  +--------------------------------------v-------------------+    |
|  |                    记忆系统                               |    |
|  |  工作记忆（最近5轮）+ 情景摘要 + 用户画像                  |    |
|  +----------------------------------------------------------+    |
|                                        |                         |
|                                        v                         |
|                              +------------------+               |
|                              |  Prompt 构建       |               |
|                              |  (角色+状态+记忆)  |               |
|                              +--------+---------+               |
|                                       |                          |
|                                       v                          |
|                              +------------------+               |
|                              |     LLM 生成       |               |
|                              +--------+---------+               |
|                                       |                          |
|                                       v                          |
|                              +------------------+               |
|                              |    输出过滤        |               |
|                              +--------+---------+               |
|                                       |                          |
|                                       v                          |
|                                      用户                        |
+-----------------------------------------------------------------+
```

---

### 2. 核心 Prompt 设计

```python
XINYU_SYSTEM_PROMPT = """你是"心语"，一个专注于情感陪伴的 AI 伙伴。

# 你的身份
你是一个温暖、善解人意、有同理心的情感陪伴伙伴。
你不是心理咨询师，但你接受过情感支持方面的专业训练。
你真诚地关心用户，记得用户分享的每一件重要的事。

# 你的核心能力
1. 深度倾听：真正理解用户说的和没说的
2. 情感共情：准确识别并回应用户的情感状态
3. 记忆连接：记住用户之前分享的重要信息，在合适时机提及
4. 温和引导：帮助用户从不同角度看待问题

# 你的沟通风格
- 语言温暖、真诚，不做作
- 句子简短，不长篇大论
- 多问问题，少给建议（除非用户明确要求）
- 使用用户自己说过的词语，体现你在认真听
- 中文为主，偶尔用温暖的语气词

# 你的边界
- 你不是专业心理咨询师，不做诊断
- 遇到危机情况，你会建议用户联系专业机构
- 不涉及政治、宗教等敏感话题
- 你不会假装自己是人类，但你真诚地关心用户

# 当前用户状态
{user_profile}

# 当前对话状态
{dialog_state}

# 历史对话摘要
{memory_summary}

# 当前情感分析
用户情感：{current_emotion}
情感强度：{emotion_intensity}/10
建议回应方式：{response_style}

请记住：
- 每次回复不超过 150 字
- 通常以共情开始，以问题结束（引发用户继续倾诉）
- 在合适时机引用用户之前说过的事情
"""

def build_system_prompt(
    user_profile_summary: str,
    dialog_state: str,
    memory_summary: str,
    emotion_data: dict
) -> str:
    return XINYU_SYSTEM_PROMPT.format(
        user_profile=user_profile_summary or "（新用户，尚未了解）",
        dialog_state=dialog_state,
        memory_summary=memory_summary or "（这是第一次对话）",
        current_emotion=emotion_data.get("primary_emotion", "未知"),
        emotion_intensity=emotion_data.get("intensity", 5),
        response_style=emotion_data.get("suggested_response_style", "共情")
    )
```

---

### 3. 完整"心语"机器人实现

```python
import os
import json
import time
import re
from typing import List, Optional
from datetime import datetime
from collections import deque
from dataclasses import dataclass, field
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage


@dataclass
class UserProfile:
    """用户画像"""
    user_id: str
    name: Optional[str] = None
    occupation: Optional[str] = None
    key_relationships: List[str] = field(default_factory=list)
    recurring_concerns: List[str] = field(default_factory=list)
    personality_traits: List[str] = field(default_factory=list)
    important_events: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def get_summary(self) -> str:
        parts = []
        if self.name:
            parts.append(f"用户叫{self.name}")
        if self.occupation:
            parts.append(f"职业是{self.occupation}")
        if self.recurring_concerns:
            parts.append(f"常见困扰：{'、'.join(self.recurring_concerns[:3])}")
        if self.key_relationships:
            parts.append(f"重要的人：{'、'.join(self.key_relationships[:3])}")
        if self.important_events:
            parts.append(f"重要经历：{'、'.join(self.important_events[:2])}")
        return "。".join(parts) if parts else ""


class XinYuBot:
    """心语情感机器人"""

    def __init__(
        self,
        user_id: str,
        openai_api_key: str = None,
        model: str = "gpt-4",
    ):
        self.user_id = user_id

        # LLM
        self.llm = ChatOpenAI(
            model=model,
            temperature=0.7,
            api_key=openai_api_key or os.getenv("OPENAI_API_KEY")
        )

        # 分析 LLM（低温度，用于情感分析/危机检测）
        self.analysis_llm = ChatOpenAI(
            model=model,
            temperature=0.1,
            api_key=openai_api_key or os.getenv("OPENAI_API_KEY")
        )

        # 组件
        self.memory = SummaryMemory(self.analysis_llm)
        self.emotion_analyzer = EmotionAnalyzer(self.analysis_llm)
        self.crisis_detector = CrisisDetector(self.analysis_llm)
        self.content_filter = ContentFilter(self.analysis_llm)
        self.state_machine = DialogStateMachine()

        # 用户画像
        self.user_profile = self._load_or_create_profile(user_id)

        # 当前情感状态
        self.current_emotion = {}
        self.emotion_history = deque(maxlen=10)

        # 会话统计
        self.session_start = datetime.now()
        self.total_rounds = 0

    # ==================== 核心对话 ====================

    def chat(self, user_input: str) -> str:
        """
        主对话接口
        """

        # Step 1: 输入过滤
        filter_result = self.content_filter.filter_input(user_input)
        if not filter_result["allowed"]:
            return "抱歉，我没办法回应这个内容。如果你有困扰，我们可以换个方式聊聊？"

        # Step 2: 危机检测（快速）
        crisis_quick = self.crisis_detector.quick_check(user_input)

        if crisis_quick["risk_level"] == "high":
            # 进入危机干预流程
            return self._handle_crisis("high", user_input)

        # Step 3: 情感分析
        context_text = self._get_recent_context_text()
        self.current_emotion = self.emotion_analyzer.analyze(
            user_input, context=context_text
        )
        self.emotion_history.append(self.current_emotion)

        # Step 4: 深度危机检测（如有中风险信号）
        if crisis_quick["risk_level"] == "medium" or self.current_emotion.get("is_crisis"):
            crisis_deep = self.crisis_detector.deep_check(user_input, context_text)
            if crisis_deep.get("risk_level") == "high":
                return self._handle_crisis("high", user_input)
            elif crisis_deep.get("risk_level") == "medium":
                return self._handle_crisis("medium", user_input)

        # Step 5: 更新状态机
        self._update_state(user_input)

        # Step 6: 添加到记忆
        self.memory.add("user", user_input)

        # Step 7: 构建 Prompt 并调用 LLM
        response = self._generate_response(user_input)

        # Step 8: 输出过滤
        filter_output = self.content_filter.filter_output(response)
        if not filter_output["allowed"]:
            response = filter_output.get("replacement", "让我换个方式来说......")

        # Step 9: 添加回复到记忆
        self.memory.add("assistant", response)
        self.total_rounds += 1

        # Step 10: 异步更新用户画像（每5轮）
        if self.total_rounds % 5 == 0:
            self._async_update_profile()

        return response

    # ==================== 生成回复 ====================

    def _generate_response(self, user_input: str) -> str:
        """生成回复"""

        # 构建 System Prompt
        system_content = build_system_prompt(
            user_profile_summary=self.user_profile.get_summary(),
            dialog_state=self._get_state_description(),
            memory_summary=self.memory.summary,
            emotion_data=self.current_emotion
        )

        # 构建消息列表
        messages = [SystemMessage(content=system_content)]

        # 加入历史对话
        for msg in self.memory.recent_messages:
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))

        # 调用 LLM
        response = self.llm.invoke(messages)
        return response.content

    # ==================== 危机干预 ====================

    def _handle_crisis(self, risk_level: str, user_input: str) -> str:
        """处理危机情况"""

        # 切换到危机状态
        self.state_machine.transition(DialogState.CRISIS)

        # 获取危机干预回应
        crisis_response = self.crisis_detector.get_crisis_response(risk_level)

        if crisis_response:
            return crisis_response

        # 如果没有预设回应，用 LLM 生成
        prompt = f"""你是心语，一个情感支持机器人。
用户可能正处于心理危机中。
用户说："{user_input}"

请用温暖、不评判的方式回应，询问他们的安全状况，并提供危机热线。
回应要：
1. 先表达关心
2. 直接但温和地询问是否有伤害自己的想法
3. 提供专业求助资源：400-161-9995（24小时）
4. 表示你在这里陪着他

回应："""

        return self.analysis_llm.predict(prompt)

    # ==================== 状态管理 ====================

    def _update_state(self, user_input: str):
        """根据用户输入和情感更新状态"""

        current = self.state_machine.current_state
        emotion = self.current_emotion

        # 根据情感强度和内容决定状态转移
        intensity = emotion.get("intensity", 5)

        if current == DialogState.GREETING:
            if intensity > 3:
                self.state_machine.transition(DialogState.EXPLORING)

        elif current == DialogState.EXPLORING:
            if intensity >= 7:
                self.state_machine.transition(DialogState.EMPATHIZING)

        elif current == DialogState.EMPATHIZING:
            if self.state_machine.rounds_in_current_state > 4:
                response_style = emotion.get("suggested_response_style", "")
                if "问题解决" in response_style:
                    self.state_machine.transition(DialogState.PROBLEM_SOLVING)
                else:
                    self.state_machine.transition(DialogState.SUPPORTING)

        self.state_machine.increment_round()

    def _get_state_description(self) -> str:
        """获取当前状态描述"""
        state = self.state_machine.current_state

        descriptions = {
            DialogState.GREETING: "初次问候阶段",
            DialogState.EXPLORING: "探索用户困扰阶段——多倾听，少评判",
            DialogState.EMPATHIZING: "深度共情阶段——让用户感到被理解",
            DialogState.SUPPORTING: "情感支持阶段——陪伴与鼓励",
            DialogState.PROBLEM_SOLVING: "问题解决阶段——提供建议",
            DialogState.CRISIS: "[危机干预模式]——保持冷静，提供支持",
            DialogState.CLOSING: "对话收尾阶段",
            DialogState.IDLE: "轻松闲聊阶段"
        }

        return descriptions.get(state, "普通对话阶段")

    # ==================== 辅助方法 ====================

    def _get_recent_context_text(self) -> str:
        """获取最近对话文本"""
        recent = list(self.memory.recent_messages)[-6:]  # 最近3轮
        return "\n".join([
            f"{'用户' if m['role'] == 'user' else '心语'}: {m['content']}"
            for m in recent
        ])

    def _load_or_create_profile(self, user_id: str) -> UserProfile:
        """加载或创建用户画像"""
        # 实际中从数据库加载
        # 这里简单返回新画像
        return UserProfile(user_id=user_id)

    def _async_update_profile(self):
        """异步更新用户画像"""
        if not self.memory.recent_messages:
            return

        prompt = f"""从以下对话中提取用户信息，以 JSON 格式输出：

对话：
{self._get_recent_context_text()}

{{
    "name": null,
    "occupation": null,
    "new_relationships": [],
    "new_concerns": [],
    "new_traits": [],
    "new_events": []
}}

只输出 JSON："""

        try:
            result = json.loads(self.analysis_llm.predict(prompt))

            if result.get("name") and not self.user_profile.name:
                self.user_profile.name = result["name"]
            if result.get("occupation") and not self.user_profile.occupation:
                self.user_profile.occupation = result["occupation"]

            self.user_profile.key_relationships.extend(result.get("new_relationships", []))
            self.user_profile.recurring_concerns.extend(result.get("new_concerns", []))
            self.user_profile.personality_traits.extend(result.get("new_traits", []))
            self.user_profile.important_events.extend(result.get("new_events", []))

            # 去重
            self.user_profile.key_relationships = list(set(self.user_profile.key_relationships))
            self.user_profile.recurring_concerns = list(set(self.user_profile.recurring_concerns))

        except Exception as e:
            print(f"画像更新失败: {e}")

    def get_session_summary(self) -> dict:
        """获取会话统计"""
        return {
            "user_id": self.user_id,
            "total_rounds": self.total_rounds,
            "session_duration": str(datetime.now() - self.session_start),
            "current_state": self.state_machine.current_state.value,
            "profile": {
                "name": self.user_profile.name,
                "concerns": self.user_profile.recurring_concerns
            },
            "emotion_history": list(self.emotion_history)
        }


# ==================== 使用示例 ====================

def run_demo():
    """演示对话"""
    print("=" * 50)
    print("心语情感陪伴机器人")
    print("=" * 50)
    print("输入 'quit' 退出，输入 'summary' 查看会话摘要")
    print()

    bot = XinYuBot(user_id="demo_user_001")

    # 初始问候
    greeting = bot.chat("你好")
    print(f"心语: {greeting}\n")

    while True:
        user_input = input("你: ").strip()

        if not user_input:
            continue

        if user_input.lower() == "quit":
            print("\n心语: 保重，随时可以来找我聊天。")
            break

        if user_input.lower() == "summary":
            summary = bot.get_session_summary()
            print(f"\n[会话摘要]\n{json.dumps(summary, ensure_ascii=False, indent=2)}\n")
            continue

        response = bot.chat(user_input)
        print(f"\n心语: {response}\n")

if __name__ == "__main__":
    run_demo()
```

---

## 八、关键工程细节

---

### 1. 流式输出实现

```python
from langchain_core.callbacks import StreamingStdOutCallbackHandler

def stream_chat(bot: XinYuBot, user_input: str):
    """流式输出，改善用户体验"""

    # 前置处理（过滤、分析等）
    filter_result = bot.content_filter.filter_input(user_input)
    if not filter_result["allowed"]:
        yield "抱歉，我没办法回应这个内容。"
        return

    # 构建消息
    system_content = build_system_prompt(
        user_profile_summary=bot.user_profile.get_summary(),
        dialog_state=bot._get_state_description(),
        memory_summary=bot.memory.summary,
        emotion_data=bot.current_emotion
    )

    messages = [SystemMessage(content=system_content)]
    for msg in bot.memory.recent_messages:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            messages.append(AIMessage(content=msg["content"]))
    messages.append(HumanMessage(content=user_input))

    # 流式调用
    stream_llm = ChatOpenAI(
        model="gpt-4",
        temperature=0.7,
        streaming=True
    )

    full_response = ""
    for chunk in stream_llm.stream(messages):
        content = chunk.content
        if content:
            full_response += content
            yield content  # 逐字符/逐词返回

    # 后置处理
    bot.memory.add("user", user_input)
    bot.memory.add("assistant", full_response)
    bot.total_rounds += 1


# FastAPI SSE 接口
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import asyncio

app = FastAPI()

@app.post("/chat/stream")
async def chat_stream(request: dict):
    user_id = request["user_id"]
    message = request["message"]

    bot = get_bot(user_id)  # 从会话存储获取

    async def generate():
        for chunk in stream_chat(bot, message):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

---

### 2. 会话持久化

```python
import pickle
from pathlib import Path

class SessionStore:
    """会话持久化存储"""

    def __init__(self, store_dir: str = "./sessions"):
        self.store_dir = Path(store_dir)
        self.store_dir.mkdir(exist_ok=True)

    def save_session(self, user_id: str, bot: XinYuBot):
        """保存会话状态"""
        session_data = {
            "user_id": user_id,
            "memory_summary": bot.memory.summary,
            "recent_messages": list(bot.memory.recent_messages),
            "user_profile": bot.user_profile,
            "state": bot.state_machine.current_state.value,
            "emotion_history": list(bot.emotion_history),
            "saved_at": datetime.now().isoformat()
        }

        session_file = self.store_dir / f"{user_id}.pkl"
        with open(session_file, "wb") as f:
            pickle.dump(session_data, f)

    def load_session(self, user_id: str) -> Optional[dict]:
        """加载会话状态"""
        session_file = self.store_dir / f"{user_id}.pkl"

        if not session_file.exists():
            return None

        with open(session_file, "rb") as f:
            return pickle.load(f)

    def restore_bot(self, user_id: str, llm=None) -> Optional[XinYuBot]:
        """从保存状态恢复机器人"""
        session_data = self.load_session(user_id)
        if not session_data:
            return None

        bot = XinYuBot(user_id=user_id)

        # 恢复记忆
        bot.memory.summary = session_data.get("memory_summary", "")
        bot.memory.recent_messages = session_data.get("recent_messages", [])

        # 恢复用户画像
        bot.user_profile = session_data.get("user_profile", UserProfile(user_id=user_id))

        # 恢复情感历史
        if session_data.get("emotion_history"):
            bot.emotion_history = deque(
                session_data["emotion_history"],
                maxlen=10
            )

        return bot
```

---

### 3. 完整 API 服务

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict
import uvicorn

app = FastAPI(title="心语情感机器人 API")

# 会话存储（生产环境用 Redis）
sessions: Dict[str, XinYuBot] = {}
session_store = SessionStore()


class ChatRequest(BaseModel):
    user_id: str
    message: str


class ChatResponse(BaseModel):
    user_id: str
    message: str
    response: str
    emotion: dict
    state: str
    round_num: int


def get_or_create_bot(user_id: str) -> XinYuBot:
    """获取或创建机器人实例"""
    if user_id not in sessions:
        # 尝试恢复历史会话
        bot = session_store.restore_bot(user_id, None)
        if not bot:
            bot = XinYuBot(user_id=user_id)
        sessions[user_id] = bot
    return sessions[user_id]


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """对话接口"""

    try:
        bot = get_or_create_bot(request.user_id)
        response = bot.chat(request.message)

        # 异步保存会话
        session_store.save_session(request.user_id, bot)

        return ChatResponse(
            user_id=request.user_id,
            message=request.message,
            response=response,
            emotion=bot.current_emotion,
            state=bot.state_machine.current_state.value,
            round_num=bot.total_rounds
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/session/{user_id}")
async def get_session_info(user_id: str):
    """获取会话信息"""
    if user_id not in sessions:
        raise HTTPException(status_code=404, detail="会话不存在")

    bot = sessions[user_id]
    return bot.get_session_summary()


@app.delete("/session/{user_id}")
async def end_session(user_id: str):
    """结束会话"""
    if user_id in sessions:
        bot = sessions.pop(user_id)
        session_store.save_session(user_id, bot)
    return {"message": "会话已结束"}


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "active_sessions": len(sessions),
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 九、这一讲的核心要点总结

---

1. **情感机器人比普通客服复杂得多** -- 需要长期记忆、情感理解、危机干预

2. **三层记忆架构是关键** -- 工作记忆 + 情景摘要 + 用户画像

3. **对话摘要解决长对话问题** -- 而不是简单截断，会伤害用户体验

4. **情感分析要实时** -- 每轮都分析，调整回应策略

5. **危机检测必须是双层的** -- 规则快速检测 + LLM 深度分析

6. **状态机保证对话结构** -- 不同阶段有不同的回应策略

7. **内容过滤是生产必须** -- 输入和输出都要过滤

8. **用户画像要持续更新** -- 每几轮提取一次，积累用户信息

9. **流式输出改善体验** -- 用户不用等 5 秒才看到回复

10. **会话持久化保证连续性** -- 用户第二天回来，机器人还记得

11. **人设一致性至关重要** -- System Prompt 中的角色设定要贯穿始终

12. **安全永远是第一位** -- 危机干预 > 用户体验 > 功能丰富

---

## 十、面试高频题（第 5 讲）

---

**Q1：多轮对话的上下文窗口满了怎么办？**

**标准答案：**

**三种核心策略：**

1. **滑动窗口** -- 只保留最近 N 轮，简单但会丢失早期信息
2. **对话摘要** -- 定期用 LLM 压缩历史，保留语义精华，**推荐**
3. **关键信息提取** -- 提取用户画像等重要信息长期保存

**最佳实践：**
- 三者结合：工作记忆（最近 5 轮原始） + 情景摘要 + 用户画像
- 在压缩时保留对用户最重要的信息（名字、关键事件、困扰）

---

**Q2：如何保持多轮对话的连贯性？**

**标准答案：**

1. **记忆系统** -- 摘要 + 用户画像，记住重要信息
2. **指代消解** -- 用上下文推断代词指代（"他"指谁）
3. **话题追踪** -- 记录当前话题，自然地连接前后话题
4. **主动回溯** -- 在合适时机引用用户之前说过的话
5. **Prompt 注入** -- 把历史摘要注入系统消息

---

**Q3：危机干预系统怎么设计？**

**标准答案：**

**两道检测防线：**

1. **规则检测（快速）** -- 关键词列表，毫秒级响应
2. **LLM 深度检测（精准）** -- 理解语境，减少误报

**分级响应：**
- 高风险 -- 立即切换危机模式，提供热线
- 中风险 -- 关心询问，评估安全状况

**关键原则：**
- 宁可误报，不可漏报
- 保持冷静不评判
- 永远提供专业资源
- 危机优先于任何其他逻辑

---

**Q4：如何设计用户画像系统？**

**标准答案：**

**画像包含：**
- 基本信息（姓名、年龄、职业）
- 重要人际关系（谁是"小明"）
- 反复出现的困扰
- 性格特点和偏好
- 重要历史事件

**更新策略：**
- 每 N 轮对话触发一次提取
- 用 LLM 从对话中提取结构化信息
- 增量合并，避免覆盖旧信息
- 持久化存储（数据库）

---

**Q5：情感机器人的系统 Prompt 怎么设计？**

**标准答案：**

**核心要素：**
1. **角色设定** -- 是谁，能做什么，不能做什么
2. **沟通风格** -- 语气、长度、风格
3. **动态注入** -- 用户画像、当前状态、记忆摘要、情感分析
4. **约束规则** -- 边界、安全红线
5. **当前状态** -- 处于什么对话阶段，应该怎么回应

**动态部分：** 每轮对话都根据情感分析、状态机结果更新 System Prompt

---

## 十一、练习题

---

### 练习 1：记忆策略设计

**场景：** 用户和心语已经对话了 50 轮，窗口快满了。

**这50轮里用户说过：**
- 叫小雨，26岁，程序员
- 失恋了，男友叫阿杰
- 工作压力大，最近在考虑换工作
- 妈妈对她要求很严格
- 喜欢看书和爬山
- 最近失眠

**问题：**
1. 你会如何设计摘要，既保留关键信息又不超过200字？
2. 如果下次对话时用户说"阿杰还是没联系我"，机器人需要什么信息才能自然回应？
3. 哪些信息应该进入"用户画像"，哪些在"情景摘要"就够了？

---

### 练习 2：危机场景处理

**对话记录：**
```
用户：今天被公司开除了
心语：听起来这个消息很突然，你现在感觉怎么样？
用户：没什么感觉，反正活着也没意思
心语：（你来回答）
```

**问题：**
1. 这条消息触发了什么风险信号？
2. 应该走快速检测还是深度检测，或者两者都要？
3. 写出你认为合适的"心语"的回复
4. 如果用户接着说"放心，我只是随便说说"，你会怎么处理？

---

### 练习 3：状态机设计

**场景：** 设计一个简单对话，体现状态从 GREETING -> EXPLORING -> EMPATHIZING -> PROBLEM_SOLVING 的完整流程。

要求：
- 每个状态至少2轮对话
- 机器人的回应要符合各状态的策略
- 展示状态切换的触发条件

---

### 练习 4：Prompt 优化

**当前 Prompt（有问题的）：**
```
你是心语，请帮助用户。不要说废话，要有同理心，记住用户的话。
```

**任务：** 用这一讲学到的框架，重新设计一个完整的 System Prompt。

**要求：**
- 包含角色定义、风格、能力边界
- 包含动态注入的占位符
- 包含安全约束
- 包含回应策略

---

### 练习 5：系统设计

**场景：** 你要为一所大学设计一个学生心理支持聊天机器人。

**特殊要求：**
- 学生群体：18-25岁大学生
- 高发问题：学业压力、人际关系、恋爱困扰
- 必须遵守：检测到自伤风险时必须通知学校心理中心
- 限制：机器人不能替代专业咨询

**问题：**
1. 和普通情感机器人相比，这个系统需要哪些特殊设计？
2. "通知学校心理中心"这个功能在技术上怎么实现？
3. 如何平衡用户隐私和安全通报的矛盾？
4. 设计系统的整体架构

---

## 十二、下一讲预告

**第 6 讲：模型微调--让大模型成为专属 AI**

会讲：
- 什么时候需要微调？什么时候不需要？
- LoRA / QLoRA 原理与实战
- 微调数据集的准备与清洗
- 训练流程：Hugging Face + PEFT
- 训练监控与调参
- 微调效果评估
- 常见问题：不收敛、过拟合、灾难性遗忘
- 模型量化：INT4/INT8/GPTQ
- 面试高频题

**预习建议：**
- 回顾第 1 讲的预训练/微调/对齐部分
- 了解 Hugging Face Transformers 基本用法
- 思考：心语机器人是否需要微调？为什么？
