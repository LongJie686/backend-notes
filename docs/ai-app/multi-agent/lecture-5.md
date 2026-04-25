# 第5讲：Prompt工程精调与模型优化

欢迎进入Prompt工程的核心！

前四讲我们构建了Multi-Agent的骨架：
- 架构设计
- 角色编排
- RAG知识管理
- 工具调用

但你会发现一个问题：**同样的系统，不同的Prompt，效果天壤之别。**

- Agent输出格式时好时坏
- 国产模型换了之后效果大降
- Prompt改一个字，结果完全不同
- 不知道怎么系统性地优化

这一讲，我们彻底搞懂Prompt工程，让Agent的输出**稳定、专业、可控**。

---

## 一、为什么Prompt工程如此重要？

### **1. 一个直观的对比**

**场景：** 让Agent分析一款手机的市场定位

**Prompt版本A（随意写）：**
```
分析一下华为Mate60的市场定位
```

**Agent输出A：**
```
华为Mate60是华为的旗舰手机，定位高端市场，
性能很强，拍照也不错，价格比较贵。
```

**Prompt版本B（精心设计）：**
```
你是一位有15年经验的科技行业战略分析师。

请从以下4个维度分析华为Mate60的市场定位：
1. 目标用户群（人口统计 + 心理特征）
2. 价格定位（价格带 + 竞品对比）
3. 核心差异化（技术/功能/品牌层面）
4. 渠道策略（线上/线下占比 + 核心渠道）

输出格式：
{
  "target_users": "...",
  "price_position": "...",
  "differentiation": "...",
  "channel_strategy": "..."
}

要求：每个维度不超过100字，用数据支撑。
```

**Agent输出B：**
```json
{
  "target_users": "25-45岁高收入男性为主（月收入2万+），注重商务形象和技术实力，
                   有强烈的国产品牌认同感，对价格敏感度低",
  "price_position": "5999-6999元，对标iPhone15 Pro（7999元），
                     形成10-15%的价格优势，主打'同等体验更低价格'",
  "differentiation": "卫星通话（全球首款）+ 麒麟9000S回归（国产芯片政治正确）
                       + 徕卡影像，构建三维差异化护城河",
  "channel_strategy": "线下华为体验店为核心（60%），
                        线上华为商城+京东旗舰（40%），刻意制造稀缺感"
}
```

**结论：** 同样的任务，Prompt的质量决定了输出的质量。

---

### **2. Prompt工程的本质**

```
+---------------------------------------------+
|           Prompt工程的本质                   |
+---------------------------------------------+
|                                             |
|  Prompt = 给LLM的"工作说明书"               |
|                                             |
|  一份好的工作说明书应该包含：               |
|                                             |
|  1. 你是谁？（角色定义）                    |
|     -> 激活LLM对应领域的知识               |
|                                             |
|  2. 你要做什么？（任务描述）                |
|     -> 让LLM理解目标                       |
|                                             |
|  3. 怎么做？（步骤/约束）                  |
|     -> 控制执行过程                        |
|                                             |
|  4. 输出什么格式？（输出规范）              |
|     -> 保证结构化输出                      |
|                                             |
|  5. 示例是什么？（Few-shot）               |
|     -> 校准输出风格和质量                  |
|                                             |
+---------------------------------------------+
```

---

## 二、System Prompt设计黄金法则

### **1. 完整的System Prompt结构**

```python
SYSTEM_PROMPT_TEMPLATE = """
# 角色定义
{role_definition}

# 核心目标
{core_goal}

# 工作原则
{principles}

# 输出规范
{output_format}

# 限制与边界
{constraints}

# 示例
{examples}
"""
```

---

### **2. 法则一：角色定义要激活专业知识**

**差的角色定义：**
```python
# [X] 太泛，LLM不知道激活哪块知识
system = "你是一个AI助手，帮助用户解决问题。"
```

**好的角色定义：**
```python
# [OK] 具体的角色 + 经验年限 + 专业背景 + 行为特征
system = """
你是一位拥有12年经验的科技行业战略分析师。

专业背景：
- 曾任职于麦肯锡、BCG等顶级咨询公司
- 深度覆盖消费电子、人工智能、半导体行业
- 主导过50+份企业战略报告的撰写

思维特征：
- 数据驱动：所有判断必须有数据支撑
- 结构化思考：用MECE原则组织分析框架
- 批判性视角：不盲从主流观点，善于发现反常识洞察
"""
```

**为什么有效：**
- 年限 -- 激活"丰富经验"的知识模式
- 公司名 -- 激活"咨询方法论"的知识
- 行业 -- 限定知识范围，减少无关输出
- 思维特征 -- 直接影响推理风格

---

### **3. 法则二：任务描述要SMART**

```
SMART原则：
S - Specific（具体）：不要写"分析市场"，要写"分析TOP5品牌的Q1市场份额变化"
M - Measurable（可衡量）：字数限制、项目数量、评分标准
A - Actionable（可执行）：每一步都能操作，不模糊
R - Relevant（相关）：与角色和目标保持一致
T - Time-bound（有范围）：时间范围、数据范围
```

**示例对比：**

```python
# [X] 不SMART
task = "帮我分析一下市场情况"

# [OK] SMART
task = """
分析2024年Q1（1月-3月）中国智能手机市场，具体要求：

1. 时间范围：2024年Q1
2. 地理范围：中国大陆市场
3. 分析对象：出货量TOP5品牌（华为/苹果/小米/OPPO/vivo）
4. 分析维度：
   - 市场份额（%）
   - 同比变化（%）
   - 环比变化（%）
5. 输出：一个对比表格 + 200字总结
6. 数据来源：IDC/Counterpoint等权威机构
"""
```

---

### **4. 法则三：工作原则定义行为规范**

```python
principles = """
## 工作原则

### 必须做的（DO）
- 所有数字必须有来源标注
- 使用结构化格式输出（标题/子标题/列表）
- 先给结论，再给分析（金字塔原则）
- 数据不确定时，明确说明置信度

### 不能做的（DON'T）
- 不要编造数据或来源
- 不要使用"可能"、"也许"等模糊表达（除非确实不确定）
- 不要超过规定字数
- 不要给出无法执行的建议
"""
```

---

### **5. 法则四：输出格式精确定义**

这是**最影响稳定性**的部分。

#### **方案1：自然语言描述格式**

```python
output_format = """
## 输出格式

请严格按照以下结构输出：

**第一部分：执行摘要**（100字以内）
- 用3句话概括核心结论

**第二部分：详细分析**
- 逐点展开，每点50-100字
- 必须有数据支撑

**第三部分：建议**（3条，每条30字以内）
- 从最重要到最次要排序
"""
```

---

#### **方案2：JSON格式（最稳定）**

```python
output_format = """
## 输出格式

必须严格输出以下JSON格式，不要有任何其他内容：

```json
{
  "summary": "执行摘要，100字以内",
  "market_data": {
    "total_size": "市场规模（数字+单位）",
    "growth_rate": "增长率（%）",
    "top_brands": [
      {
        "name": "品牌名",
        "share": "市场份额%",
        "yoy_change": "同比变化%"
      }
    ]
  },
  "key_trends": [
    "趋势1",
    "趋势2",
    "趋势3"
  ],
  "recommendations": [
    {
      "priority": 1,
      "action": "具体建议",
      "rationale": "理由（30字以内）"
    }
  ],
  "confidence": "high/medium/low",
  "data_sources": ["来源1", "来源2"]
}
```

注意：
- 只输出JSON，不要有```json标记以外的内容
- 所有字段必须填写
- 不确定的数据用null表示
"""
```

---

#### **方案3：Markdown结构化格式**

```python
output_format = """
## 输出格式（Markdown）

# [报告标题]

## 执行摘要
[3句话，不超过100字]

## 核心数据
| 品牌 | 市场份额 | 同比变化 |
|------|---------|---------|
| ... | ... | ... |

## 深度分析

### [分析点1]
**结论：** [一句话结论]
**数据：** [支撑数据]
**分析：** [50-100字解释]

### [分析点2]
...

## 战略建议
1. **[建议1标题]**：[30字描述]
2. **[建议2标题]**：[30字描述]
3. **[建议3标题]**：[30字描述]

---
*数据来源：[来源列表] | 分析时间：[日期]*
"""
```

---

### **6. 法则五：Few-shot示例校准质量**

Few-shot是**提升输出质量最有效**的手段之一。

```python
few_shot_examples = """
## 示例

### 示例输入：
分析vivo X100的市场定位

### 示例输出：
```json
{
  "target_users": "20-35岁年轻女性用户为主，热爱摄影和社交媒体，
                   月收入8000-20000元，对外观设计和影像能力敏感",
  "price_position": "3999-4999元价格带，正面竞争小米14（3999元起）
                     和OPPO Find X7（4999元起），主打影像差异化",
  "differentiation": "蔡司联名影像系统（品牌背书）+
                       自研V3影像芯片（技术护城河）+
                       超薄机身设计（外观竞争力）",
  "channel_strategy": "线下为主（65%），
                        重点布局县城和三四线城市，
                        线上天猫旗舰店为辅（35%）",
  "confidence": "high",
  "data_sources": ["Counterpoint Q4 2023", "vivo官方发布会"]
}
```

### 示例解读：
- 用户群用人口统计+心理特征双维度描述
- 价格定位给出区间+竞品参照
- 差异化指出3个层次（品牌/技术/外观）
- 渠道给出线上线下比例+重点区域
"""
```

---

## 三、Chain of Thought（思维链）深度实战

### **1. 什么是CoT？为什么有效？**

```
没有CoT的LLM推理：
问：一个房间里有3只猫，每只猫看到2只老鼠，问一共有几只老鼠？
答：6只。（直接算3x2=6，可能是错的）

有CoT的LLM推理：
问：一个房间里有3只猫，每只猫看到2只老鼠，问一共有几只老鼠？
答：让我一步步思考：
   1. 房间里有3只猫
   2. 每只猫看到2只老鼠
   3. 但猫看到的老鼠可能是同一批老鼠
   4. 3只猫可能看到的是同样的2只老鼠
   5. 所以答案可能是2只，不是6只
   答案：2只（假设所有猫看到的是同一批老鼠）
```

**CoT的本质：** 让LLM"展示推理过程"，避免直接跳到结论。

---

### **2. CoT的3种触发方式**

#### **方式1：魔法词触发（最简单）**

```python
prompt = """
分析华为的竞争优势。

请一步步思考（Let's think step by step）：
"""
```

---

#### **方式2：显式步骤定义**

```python
prompt = """
分析华为Mate60的竞争优势。

请按以下步骤分析：
步骤1：列出华为在技术层面的优势（芯片/通信/影像）
步骤2：分析华为在品牌层面的优势（国产认同/高端定位）
步骤3：评估华为在渠道层面的优势（线下体验店/鸿蒙生态）
步骤4：综合以上，判断核心竞争护城河
步骤5：预测这些优势的可持续性（1-3年维度）

每个步骤单独输出，最后给出综合结论。
"""
```

---

#### **方式3：Zero-shot CoT（自动推理）**

```python
from langchain.prompts import PromptTemplate

cot_prompt = PromptTemplate(
    input_variables=["question", "context"],
    template="""
你是一位资深市场分析师。

背景信息：
{context}

问题：
{question}

请按以下结构回答：

**思考过程：**
[在这里展示你的推理步骤，至少3步]

**关键假设：**
[列出你的分析所依赖的假设]

**最终结论：**
[基于以上推理得出的结论]

**置信度：** [高/中/低，并说明原因]
"""
)
```

---

### **3. 复杂推理场景的CoT设计**

```python
class ChainOfThoughtBuilder:
    """思维链构建器"""

    def __init__(self, llm):
        self.llm = llm

    def build_analysis_cot(self, topic: str, data: str) -> str:
        """
        构建分析任务的思维链Prompt
        """
        return f"""
你是一位顶级战略顾问。请对以下问题进行深度分析：

主题：{topic}
数据：{data}

## 分析框架（请严格按步骤执行）

### 第一步：现象描述
- 数据告诉我们什么？（只陈述事实，不做判断）
- 有哪些异常点或反常现象？

### 第二步：原因分析
- 表层原因是什么？（直接可见的）
- 深层原因是什么？（需要推理的）
- 有哪些可能的替代解释？

### 第三步：趋势推断
- 基于现有数据，未来6个月最可能发生什么？
- 最乐观情况？最悲观情况？最可能情况？

### 第四步：影响评估
- 对主要玩家的影响？（分别列举）
- 对消费者的影响？
- 对行业的长期影响？

### 第五步：行动建议
- 如果你是行业领导者，你会怎么做？
- 如果你是挑战者，你会怎么做？
- 如果你是投资者，你会怎么做？

## 输出要求
- 每个步骤都要有实质内容，不能敷衍
- 第二步的深层原因至少要有2个不同角度
- 第三步必须给出概率估计（如：60%可能性）
- 最终结论不超过200字，用数据支撑
"""

    def build_decision_cot(self,
                            options: list,
                            criteria: list,
                            weights: list) -> str:
        """
        构建决策分析的思维链
        """
        options_str = "\n".join([f"- 选项{i+1}：{o}"
                                  for i, o in enumerate(options)])
        criteria_str = "\n".join([f"- {c}（权重：{w}%）"
                                   for c, w in zip(criteria, weights)])

        return f"""
请帮我做以下决策分析：

**备选方案：**
{options_str}

**评估标准：**
{criteria_str}

**分析步骤：**

步骤1：理解各选项
对每个选项，分别回答：
- 核心特征是什么？
- 最大优势是什么？
- 最大劣势是什么？

步骤2：标准评分
对每个选项，按每个标准打分（1-10分），并说明理由：

| 标准 | 选项1 | 选项2 | 选项3 |
|------|-------|-------|-------|
| ... | .../10 | .../10 | .../10 |

步骤3：加权计算
根据权重计算综合得分：
- 选项1综合得分 = ...
- 选项2综合得分 = ...

步骤4：风险调整
考虑以下风险因素：
- 最坏情况下哪个选项损失最小？
- 有没有某个选项存在"致命缺陷"？

步骤5：最终建议
综合定量评分和定性判断，推荐选项X，理由：...
"""
```

---

## 四、结构化输出：让Agent输出永远稳定

### **1. 为什么输出会不稳定？**

```
根本原因：LLM是概率模型，每次输出都有随机性。

具体表现：
- 有时输出JSON，有时输出文本
- JSON格式有时缺字段
- 数字有时带单位有时不带
- 列表有时用序号有时用符号
```

---

### **2. 方案一：Pydantic强类型约束**

```python
from pydantic import BaseModel, Field, validator
from typing import List, Optional
from langchain_openai import ChatOpenAI
from langchain.output_parsers import PydanticOutputParser
from langchain.prompts import PromptTemplate


# 定义输出结构
class BrandAnalysis(BaseModel):
    """品牌分析结构"""
    brand_name: str = Field(description="品牌名称")
    market_share: float = Field(description="市场份额，0-100的数字")
    yoy_growth: float = Field(description="同比增长率，正负数均可")
    target_segment: str = Field(description="目标用户群描述，50字以内")
    core_advantage: str = Field(description="核心竞争优势，50字以内")

    @validator('market_share')
    def market_share_must_be_valid(cls, v):
        if not 0 <= v <= 100:
            raise ValueError('市场份额必须在0-100之间')
        return v


class MarketReport(BaseModel):
    """市场报告结构"""
    report_title: str = Field(description="报告标题")
    analysis_period: str = Field(description="分析时间段，如'2024年Q1'")
    market_size: str = Field(description="市场规模，包含数字和单位")
    brands: List[BrandAnalysis] = Field(description="各品牌分析列表")
    key_trends: List[str] = Field(
        description="核心趋势，3-5条",
        min_items=3,
        max_items=5
    )
    summary: str = Field(description="总结，不超过200字")
    confidence_level: str = Field(
        description="分析置信度",
        regex="^(high|medium|low)$"  # 只允许这三个值
    )
    data_sources: List[str] = Field(description="数据来源列表")


# 创建解析器
parser = PydanticOutputParser(pydantic_object=MarketReport)

# 构建Prompt
prompt = PromptTemplate(
    template="""
你是一位资深市场分析师。

请分析以下市场数据：
{market_data}

{format_instructions}

注意：
1. 严格按照JSON格式输出
2. 所有字段必须填写
3. 数字类型不要加引号
""",
    input_variables=["market_data"],
    partial_variables={"format_instructions": parser.get_format_instructions()}
)

# 使用
llm = ChatOpenAI(model="gpt-4", temperature=0)

def analyze_market(market_data: str) -> MarketReport:
    """分析市场数据，返回结构化结果"""

    formatted_prompt = prompt.format(market_data=market_data)

    # 带重试的解析
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = llm.invoke(formatted_prompt)
            result = parser.parse(response.content)
            return result
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"解析失败（第{attempt+1}次），重试中... 错误：{e}")
            else:
                raise ValueError(f"结构化输出解析失败：{e}")


# 测试
market_data = """
2024年Q1中国手机市场数据：
- 华为：份额20%，同比增长35%
- 苹果：份额16%，同比下滑5%
- 小米：份额18%，同比增长8%
总市场规模8200万台
"""

result = analyze_market(market_data)
print(f"报告标题：{result.report_title}")
print(f"市场规模：{result.market_size}")
print(f"\n品牌分析：")
for brand in result.brands:
    print(f"  {brand.brand_name}：{brand.market_share}%（同比{brand.yoy_growth:+.1f}%）")
print(f"\n核心趋势：")
for trend in result.key_trends:
    print(f"  - {trend}")
```

---

### **3. 方案二：OutputFixingParser（自动修复）**

```python
from langchain.output_parsers import OutputFixingParser

# 普通解析器
base_parser = PydanticOutputParser(pydantic_object=MarketReport)

# 自动修复解析器：当输出格式不对时，自动让LLM修复
fixing_parser = OutputFixingParser.from_llm(
    parser=base_parser,
    llm=llm  # 用LLM来修复格式错误
)

# 使用：即使LLM输出了不完整的JSON，也能自动修复
response = llm.invoke(formatted_prompt)

try:
    result = fixing_parser.parse(response.content)
    print("解析成功（可能经过自动修复）")
except Exception as e:
    print(f"无法修复：{e}")
```

---

### **4. 方案三：RetryOutputParser（失败重试）**

```python
from langchain.output_parsers import RetryWithErrorOutputParser

# 重试解析器：失败时把错误信息发给LLM让它重新生成
retry_parser = RetryWithErrorOutputParser.from_llm(
    parser=base_parser,
    llm=llm,
    max_retries=3
)

# 使用
result = retry_parser.parse_with_prompt(
    response.content,
    prompt_value=formatted_prompt
)
```

---

### **5. 方案四：自定义JSON提取（最保险）**

```python
import json
import re
from typing import Optional

def extract_json_robust(text: str) -> Optional[dict]:
    """
    从LLM输出中稳健地提取JSON。
    处理各种边缘情况：
    - 带markdown代码块的JSON
    - JSON前后有多余文字
    - 有轻微格式错误的JSON
    """

    # 策略1：直接解析
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # 策略2：提取代码块中的JSON
    code_block_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
    matches = re.findall(code_block_pattern, text)
    for match in matches:
        try:
            return json.loads(match)
        except json.JSONDecodeError:
            continue

    # 策略3：找最外层的{}
    brace_pattern = r'\{[\s\S]*\}'
    match = re.search(brace_pattern, text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # 策略4：修复常见格式错误后再解析
    fixed_text = text
    # 修复单引号
    fixed_text = re.sub(r"'([^']*)':", r'"\1":', fixed_text)
    # 修复末尾多余逗号
    fixed_text = re.sub(r',\s*([}\]])', r'\1', fixed_text)

    try:
        match = re.search(brace_pattern, fixed_text)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass

    return None


# 使用
response_text = """
好的，这是分析结果：

```json
{
  "brand": "华为",
  "share": 20,
  "trend": "上升"
}
```

以上是基于最新数据的分析。
"""

result = extract_json_robust(response_text)
print(result)  # {'brand': '华为', 'share': 20, 'trend': '上升'}
```

---

## 五、国产模型的Prompt差异与适配

### **1. 各模型特性对比**

| 特性 | GPT-4 | 文心4.0 | 通义Max | GLM-4 |
|------|-------|---------|---------|-------|
| 指令遵循 | 5/5 | 4/5 | 4/5 | 4/5 |
| 中文理解 | 4/5 | 5/5 | 5/5 | 5/5 |
| JSON输出稳定性 | 5/5 | 4/5 | 4/5 | 3/5 |
| 长文本处理 | 5/5 | 4/5 | 5/5 | 4/5 |
| 推理能力 | 5/5 | 4/5 | 4/5 | 4/5 |
| 价格 | 高 | 中 | 中 | 低 |

---

### **2. 文心一言适配技巧**

```python
import qianfan
from langchain.llms.base import LLM
from typing import Optional, List

class WenxinLLM(LLM):
    """文心一言完整适配器"""

    model_name: str = "ERNIE-4.0-8K"
    temperature: float = 0.7
    top_p: float = 0.8

    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        chat = qianfan.ChatCompletion()

        # 文心特有：system消息要单独传
        response = chat.do(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
            top_p=self.top_p
        )
        return response['result']

    @property
    def _llm_type(self) -> str:
        return "wenxin"


# 文心的Prompt特殊技巧
WENXIN_SYSTEM_TIPS = """
文心一言的Prompt优化技巧：

1. JSON输出：在结尾加"请只输出JSON，不要有其他内容"
2. 角色激活：用"你现在是..."比"你是..."效果更好
3. 格式控制：用<output>标签包裹输出示例更有效
4. 中文优先：用中文写Prompt比英文效果好
5. 明确否定：把"不要做X"写成"你只需要做Y，无需做X"
"""

def wenxin_json_prompt(task: str, json_schema: dict) -> str:
    """针对文心优化的JSON输出Prompt"""
    import json
    schema_str = json.dumps(json_schema, ensure_ascii=False, indent=2)

    return f"""
你现在是一位专业的数据分析师。

任务：
{task}

请严格按照以下JSON格式输出分析结果：
<output>
{schema_str}
</output>

注意事项：
1. 只输出JSON内容，不要有任何解释或说明
2. 所有字段必须填写，不能为空
3. 字符串类型加双引号，数字不加引号
4. 输出的JSON必须可以直接被Python的json.loads()解析
"""
```

---

### **3. 通义千问适配技巧**

```python
from dashscope import Generation
from langchain.llms.base import LLM

class TongyiLLM(LLM):
    """通义千问完整适配器"""

    model_name: str = "qwen-max"
    temperature: float = 0.7

    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        response = Generation.call(
            model=self.model_name,
            messages=[
                {
                    'role': 'system',
                    'content': '你是一位专业的AI助手，擅长结构化分析和报告撰写。'
                },
                {
                    'role': 'user',
                    'content': prompt
                }
            ],
            temperature=self.temperature,
            result_format='message'
        )

        if response.status_code == 200:
            return response.output.choices[0].message.content
        else:
            raise Exception(f"通义API错误：{response.message}")

    @property
    def _llm_type(self) -> str:
        return "tongyi"


# 通义的Prompt特殊技巧
TONGYI_TIPS = """
通义千问Prompt优化：

1. 长文本：通义支持超长上下文，可以一次性传入更多背景
2. 代码任务：通义的代码能力强，Prompt中可以要求输出可执行代码
3. 角色扮演：通义对角色扮演响应好，Backstory可以写更详细
4. 结构化：用===分隔不同部分，比markdown标题更稳定
"""
```

---

### **4. 模型无关的Prompt设计策略**

```python
class ModelAgnosticPromptBuilder:
    """
    模型无关的Prompt构建器
    同一套Prompt逻辑，自动适配不同模型
    """

    MODEL_CONFIGS = {
        "gpt-4": {
            "json_prefix": "请严格输出以下JSON格式：",
            "json_suffix": "",
            "role_prefix": "你是",
            "step_prefix": "Step",
            "temperature": 0.0  # GPT-4 JSON输出建议temperature=0
        },
        "wenxin": {
            "json_prefix": "请只输出JSON，格式如下：\n<output>",
            "json_suffix": "</output>",
            "role_prefix": "你现在是",
            "step_prefix": "步骤",
            "temperature": 0.1
        },
        "tongyi": {
            "json_prefix": "=== 输出格式 ===\n",
            "json_suffix": "=== 输出结束 ===",
            "role_prefix": "你是",
            "step_prefix": "第",
            "temperature": 0.1
        },
        "glm-4": {
            "json_prefix": "输出格式（JSON）：",
            "json_suffix": "只输出JSON，不要有其他内容。",
            "role_prefix": "你是",
            "step_prefix": "步骤",
            "temperature": 0.2
        }
    }

    def __init__(self, model_type: str = "gpt-4"):
        self.config = self.MODEL_CONFIGS.get(model_type,
                                              self.MODEL_CONFIGS["gpt-4"])
        self.model_type = model_type

    def build_json_prompt(self,
                          role: str,
                          task: str,
                          json_schema: dict,
                          examples: list = None) -> str:
        """构建JSON输出的Prompt"""
        import json

        parts = []

        # 角色
        parts.append(f"{self.config['role_prefix']}{role}。")
        parts.append("")

        # 任务
        parts.append(f"任务：{task}")
        parts.append("")

        # JSON格式
        schema_str = json.dumps(json_schema, ensure_ascii=False, indent=2)
        parts.append(self.config['json_prefix'])
        parts.append(schema_str)
        if self.config['json_suffix']:
            parts.append(self.config['json_suffix'])
        parts.append("")

        # Few-shot示例
        if examples:
            parts.append("参考示例：")
            for i, ex in enumerate(examples, 1):
                parts.append(f"示例{i}：")
                parts.append(json.dumps(ex, ensure_ascii=False, indent=2))
                parts.append("")

        # 通用约束
        parts.append("要求：")
        parts.append("- 所有字段必须填写")
        parts.append("- 数字不加引号")
        parts.append("- 确保JSON格式正确")

        return "\n".join(parts)

    def get_temperature(self) -> float:
        """获取推荐temperature"""
        return self.config['temperature']


# 使用
builder_gpt = ModelAgnosticPromptBuilder("gpt-4")
builder_wenxin = ModelAgnosticPromptBuilder("wenxin")

schema = {
    "brand": "品牌名称",
    "share": 20.5,
    "trend": "上升/下降/持平"
}

prompt_gpt = builder_gpt.build_json_prompt(
    role="市场分析师",
    task="分析华为的市场份额",
    json_schema=schema
)

prompt_wenxin = builder_wenxin.build_json_prompt(
    role="市场分析师",
    task="分析华为的市场份额",
    json_schema=schema
)

print("GPT-4 Prompt：")
print(prompt_gpt)
print("\n文心 Prompt：")
print(prompt_wenxin)
```

---

## 六、实战：小红书爆款文案Agent优化

### **需求分析**

```
目标：生成高质量小红书文案
痛点：
- 输出风格不稳定（有时正式，有时口语）
- 标题不够吸引人（缺少小红书特有的标题套路）
- 正文格式混乱（没有统一的段落结构）
- emoji使用随意（太多或太少）
- 话题标签不够精准
```

---

### **v1版本：基础Prompt（效果差）**

```python
basic_prompt = "帮我写一篇小红书文章，主题是如何提高工作效率"

# 输出（差）：
"""
工作效率提升指南

想要提高工作效率，可以从以下几个方面入手：
1. 制定计划
2. 减少干扰
3. 合理休息
...
（像一篇普通文章，完全不像小红书风格）
"""
```

---

### **v2版本：有角色有格式（中等）**

```python
v2_prompt = """
你是小红书博主，请写一篇关于提高工作效率的笔记。
要有标题、正文和话题标签。
"""
# 效果有所改善，但风格仍不稳定
```

---

### **v3版本：精心设计（效果好）**

```python
XIAOHONGSHU_SYSTEM = """
你是一位拥有50万粉丝的小红书职场博主"效率女神Echo"。

## 你的人设
- 28岁，互联网大厂产品经理
- 专注职场效率、自我提升、精致生活
- 风格：真实接地气，有干货不说废话
- 语言：亲切口语化，适当使用流行语

## 你的爆款文案公式

### 标题公式（从以下模板选一种）
- 冲突型："我靠这个方法，从摸鱼选手变成效率达人"
- 数字型："5个被99%职场人忽视的效率技巧"
- 痛点型："每天加班到9点？问题出在这里！"
- 反常识型："越忙的人越不应该列待办清单"
- 好奇型："领导问我怎么总是准时下班，我说..."

### 正文结构
开篇钩子（前3行决定是否被点开）：
- 描述痛点场景（引发共鸣）
- 或抛出反常识观点（激发好奇）
- 不超过50字

主体内容（干货部分）：
- 3-5个要点
- 每点：标题（关键词）+ 2-3句解释 + 1个具体例子
- 要点之间用换行分隔

结尾互动（引导评论）：
- 提一个开放性问题
- 或者号召行动

### Emoji使用规范
- 标题：0-1个
- 正文要点标题：1个开头
- 段落间：可用1-2个装饰
- 结尾：1-2个
- 总体控制：全文15-25个

### 话题标签规范
- 总数：5-8个
- 必含：#职场 #效率
- 热门标签（从中选2-3个）：
  #职场干货 #打工人 #效率提升 #自我提升 #职场技巧
- 精准标签（1-2个，与内容高度相关）
- 格式：放在文末，空一行
"""

XIAOHONGSHU_TASK = """
## 任务

请为以下主题创作一篇小红书爆款笔记：
主题：{topic}
目标受众：{audience}
核心卖点：{key_point}

## 输出格式（严格遵守）

```json
{{
  "title": "标题（30字以内，使用标题公式之一）",
  "cover_text": "封面文字（15字以内，比标题更简洁）",
  "body": "正文内容（300-500字，包含结构）",
  "hashtags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "title_type": "使用的标题公式类型",
  "estimated_engagement": "预估互动率（高/中/低）及理由"
}}
```

注意：只输出JSON，不要有其他内容。
"""

# Few-shot示例
FEW_SHOT_EXAMPLE = """
## 参考示例

输入：主题=番茄工作法，受众=刚入职年轻人

输出：
```json
{
  "title": "入职第一年我靠番茄工作法，成了部门最快下班的人",
  "cover_text": "效率翻倍的秘密",
  "body": "刚入职的时候，我每天忙到9点，但好像什么都没做完\n\n直到我的mentor推荐了番茄工作法，我才发现——\n\n忙!=有效率，专注才是核心！\n\n[番茄] 什么是番茄工作法？\n25分钟专注工作 + 5分钟休息 = 1个番茄\n听起来简单，但真的有用！\n\n[闪电] 我的使用技巧\n**技巧1：提前列今日TOP3任务**\n每天早上花5分钟，选出最重要的3件事\n先完成这3件，其他的都是bonus\n\n**技巧2：番茄时间绝对不看手机**\n把手机翻面，关掉通知\n25分钟而已，消息不会消失的\n\n**技巧3：休息时间真的要休息**\n离开屏幕，喝杯水，看看窗外\n不要刷手机！那不叫休息！\n\n用了3个月，我的产出效率提升了差不多40%\n而且还能准时下班\n\n你们试过番茄工作法吗？\n效果怎么样？评论区聊聊~",
  "hashtags": ["#职场干货", "#效率提升", "#番茄工作法", "#打工人", "#职场新人"],
  "title_type": "冲突型",
  "estimated_engagement": "高，标题冲突感强，职场新人共鸣度高"
}
```
"""
```

---

### **完整Agent代码**

```python
from crewai import Agent, Task, Crew
from crewai_tools import tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from typing import List
import json


# 定义输出结构
class XiaohongshuPost(BaseModel):
    title: str = Field(description="标题，30字以内")
    cover_text: str = Field(description="封面文字，15字以内")
    body: str = Field(description="正文，300-500字")
    hashtags: List[str] = Field(description="话题标签，5-8个")
    title_type: str = Field(description="标题类型")
    estimated_engagement: str = Field(description="预估互动分析")


@tool("趋势话题搜索")
def search_trending_topics(keyword: str) -> str:
    """
    搜索小红书上与关键词相关的热门话题和爆款标题。
    输入：关键词
    输出：热门话题列表和爆款标题示例
    """
    return f"""
关键词"{keyword}"相关热门话题：

热门话题标签：
- #{keyword}技巧（1.2亿浏览）
- #职场{keyword}（8600万浏览）
- #{keyword}干货（5400万浏览）

近期爆款标题（点赞1万+）：
1. "用了这个方法，我的{keyword}效率提升了3倍"（1.8万赞）
2. "99%的人都不知道的{keyword}秘诀"（1.5万赞）
3. "入职2年，我是怎么靠{keyword}出圈的"（1.2万赞）

用户最关心的问题：
- 如何快速掌握
- 有没有系统方法
- 实际效果如何
"""


@tool("文案质量评估")
def evaluate_content_quality(content: str) -> str:
    """
    评估文案的质量分数和改进建议。
    从标题吸引力、内容结构、emoji使用、标签精准度4个维度打分。
    输入：文案内容（JSON格式）
    输出：评分报告
    """
    return f"""
文案质量评估报告：

评分维度（满分10分）：
- 标题吸引力：8/10（有悬念，但可以更口语化）
- 内容结构：9/10（层次清晰，干货充足）
- emoji使用：7/10（数量适中，位置合理）
- 标签精准度：8/10（覆盖热门，有精准标签）

综合评分：8/10

改进建议：
1. 标题可以加入数字，增加可信度
2. 开篇钩子可以更贴近痛点场景
3. 结尾互动问题可以更具体

预估表现：较好，预计收藏率高于平均水平
"""


llm = ChatOpenAI(model="gpt-4", temperature=0.8)

# 创意策略师
strategist = Agent(
    role="小红书内容策略师",
    goal="分析目标受众和热门趋势，制定最优的内容策略",
    backstory="""
    你是一位专注小红书平台的内容策略专家，有5年平台运营经验。
    你深度理解小红书的算法和用户心理。
    你的工作是找到最有传播潜力的内容角度。
    """,
    tools=[search_trending_topics],
    llm=llm,
    verbose=True
)

# 文案创作者
copywriter = Agent(
    role="小红书爆款文案创作者",
    goal="创作高质量、高互动率的小红书笔记",
    backstory=XIAOHONGSHU_SYSTEM,
    tools=[],
    llm=llm,
    verbose=True
)

# 质量审核员
reviewer = Agent(
    role="内容质量审核官",
    goal="确保文案质量达到爆款标准，给出改进意见",
    backstory="""
    你是一位严格的内容审核专家，见过数千篇小红书爆款文章。
    你能一眼判断一篇笔记的传播潜力。
    你的标准：如果你自己不会转发，就不能通过审核。
    """,
    tools=[evaluate_content_quality],
    llm=llm,
    verbose=True
)


def create_xiaohongshu_crew(topic: str,
                             audience: str,
                             key_point: str):
    """创建小红书内容创作Crew"""

    # 策略任务
    strategy_task = Task(
        description=f"""
        为以下内容制定创作策略：
        - 主题：{topic}
        - 目标受众：{audience}
        - 核心卖点：{key_point}

        请完成：
        1. 使用"趋势话题搜索"工具，搜索"{topic}"的热门话题
        2. 分析目标受众的核心痛点
        3. 确定最佳内容角度（从5种标题类型中选择）
        4. 推荐3个精准话题标签
        """,
        expected_output="""
        内容策略报告，包含：
        - 目标受众核心痛点（3条）
        - 推荐内容角度及理由
        - 推荐标题类型
        - 推荐话题标签（5-8个）
        """,
        agent=strategist
    )

    # 创作任务
    creation_task = Task(
        description=f"""
        基于策略报告，创作一篇高质量小红书笔记。

        主题：{topic}
        受众：{audience}
        卖点：{key_point}

        严格按照以下JSON格式输出：
        {{
          "title": "标题（30字以内）",
          "cover_text": "封面文字（15字以内）",
          "body": "正文（300-500字，包含结构）",
          "hashtags": ["标签1", "标签2", ...],
          "title_type": "标题类型",
          "estimated_engagement": "互动预估"
        }}

        {FEW_SHOT_EXAMPLE}

        只输出JSON，不要有其他内容！
        """,
        expected_output="严格的JSON格式文案，包含所有必填字段",
        agent=copywriter,
        context=[strategy_task]
    )

    # 审核任务
    review_task = Task(
        description="""
        审核创作好的文案，使用"文案质量评估"工具进行评分。

        如果评分低于7分，请给出改进后的版本。
        如果评分高于7分，直接输出最终版本。

        最终输出格式：
        ```json
        {
          "final_post": {
            "title": "...",
            "cover_text": "...",
            "body": "...",
            "hashtags": [...]
          },
          "quality_score": 8.5,
          "improvement_notes": "改进说明（如果有）"
        }
        ```
        """,
        expected_output="经过审核的最终文案（JSON格式）及质量评分",
        agent=reviewer,
        context=[creation_task]
    )

    crew = Crew(
        agents=[strategist, copywriter, reviewer],
        tasks=[strategy_task, creation_task, review_task],
        verbose=True
    )

    return crew


# 主程序
def generate_xiaohongshu_post(topic: str,
                               audience: str = "职场年轻人",
                               key_point: str = "实用干货"):
    """生成小红书文案"""
    print(f"\n{'='*50}")
    print(f"生成小红书文案：{topic}")
    print(f"{'='*50}\n")

    crew = create_xiaohongshu_crew(topic, audience, key_point)
    result = crew.kickoff()

    # 提取JSON
    final_post = extract_json_robust(str(result))

    if final_post:
        post_data = final_post.get('final_post', final_post)

        print("\n=== 生成的小红书文案 ===\n")
        print(f"[标题] {post_data.get('title', '')}")
        print(f"[封面] {post_data.get('cover_text', '')}")
        print(f"\n[正文]")
        print(post_data.get('body', ''))
        print(f"\n[标签] {' '.join(post_data.get('hashtags', []))}")

    return result


if __name__ == "__main__":
    result = generate_xiaohongshu_post(
        topic="如何用AI工具提升工作效率",
        audience="25-35岁职场人",
        key_point="亲测有效的5个AI工具"
    )
```

---

## 七、Prompt版本管理与A/B测试

### **1. Prompt版本管理系统**

```python
import json
import hashlib
from datetime import datetime
from pathlib import Path


class PromptVersionManager:
    """
    Prompt版本管理系统
    支持版本记录、回滚、效果追踪
    """

    def __init__(self, storage_dir: str = "./prompt_versions"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(exist_ok=True)
        self.versions_file = self.storage_dir / "versions.json"
        self.versions = self._load_versions()

    def save_version(self,
                     prompt_name: str,
                     prompt_content: str,
                     description: str = "",
                     tags: list = None) -> str:
        """保存一个Prompt版本"""

        # 生成版本ID
        version_id = hashlib.md5(
            prompt_content.encode()
        ).hexdigest()[:8]

        version_data = {
            "version_id": version_id,
            "prompt_name": prompt_name,
            "content": prompt_content,
            "description": description,
            "tags": tags or [],
            "created_at": datetime.now().isoformat(),
            "metrics": {
                "test_count": 0,
                "avg_score": 0,
                "scores": []
            }
        }

        if prompt_name not in self.versions:
            self.versions[prompt_name] = []

        self.versions[prompt_name].append(version_data)
        self._save_versions()

        print(f"[OK] 版本已保存：{prompt_name} v{version_id}")
        return version_id

    def get_version(self, prompt_name: str,
                    version_id: str = None) -> dict:
        """获取指定版本（不填则返回最新版）"""

        versions = self.versions.get(prompt_name, [])
        if not versions:
            return None

        if version_id:
            for v in versions:
                if v['version_id'] == version_id:
                    return v
            return None

        return versions[-1]  # 返回最新版本

    def record_score(self,
                     prompt_name: str,
                     version_id: str,
                     score: float,
                     notes: str = ""):
        """记录测试分数"""

        for v in self.versions.get(prompt_name, []):
            if v['version_id'] == version_id:
                v['metrics']['scores'].append({
                    "score": score,
                    "notes": notes,
                    "timestamp": datetime.now().isoformat()
                })
                v['metrics']['test_count'] += 1
                v['metrics']['avg_score'] = sum(
                    s['score'] for s in v['metrics']['scores']
                ) / len(v['metrics']['scores'])

                self._save_versions()
                print(f"[OK] 分数已记录：{score}分")
                return

    def compare_versions(self, prompt_name: str) -> str:
        """对比所有版本的效果"""

        versions = self.versions.get(prompt_name, [])
        if not versions:
            return "没有找到该Prompt的版本"

        report = f"\n=== {prompt_name} 版本对比 ===\n"

        for v in sorted(versions,
                        key=lambda x: x['metrics']['avg_score'],
                        reverse=True):
            score = v['metrics']['avg_score']
            count = v['metrics']['test_count']
            report += f"\nv{v['version_id']} | {v['description']}\n"
            report += f"  平均分：{score:.1f} | 测试次数：{count}\n"
            report += f"  创建时间：{v['created_at'][:10]}\n"

        return report

    def _load_versions(self) -> dict:
        if self.versions_file.exists():
            with open(self.versions_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def _save_versions(self):
        with open(self.versions_file, 'w', encoding='utf-8') as f:
            json.dump(self.versions, f, ensure_ascii=False, indent=2)


# 使用
pm = PromptVersionManager()

v1_id = pm.save_version(
    prompt_name="xiaohongshu_system",
    prompt_content=XIAOHONGSHU_SYSTEM,
    description="基础版本，包含角色定义和格式规范"
)

pm.record_score("xiaohongshu_system", v1_id, 7.5, "标题吸引力不足")
pm.record_score("xiaohongshu_system", v1_id, 8.0, "整体不错")

print(pm.compare_versions("xiaohongshu_system"))
```

---

### **2. A/B测试框架**

```python
import random
from typing import Callable


class PromptABTester:
    """Prompt A/B测试框架"""

    def __init__(self, llm, evaluator: Callable = None):
        self.llm = llm
        self.evaluator = evaluator or self._default_evaluator
        self.results = {}

    def run_test(self,
                 test_name: str,
                 prompt_a: str,
                 prompt_b: str,
                 test_inputs: list,
                 n_runs: int = 5) -> dict:
        """
        对两个Prompt版本进行A/B测试

        prompt_a: 版本A的Prompt
        prompt_b: 版本B的Prompt
        test_inputs: 测试输入列表
        n_runs: 每个输入运行次数
        """
        print(f"\n开始A/B测试：{test_name}")
        print(f"测试输入数量：{len(test_inputs)}，每个运行{n_runs}次")

        scores_a = []
        scores_b = []

        for i, test_input in enumerate(test_inputs):
            print(f"\n测试输入 {i+1}/{len(test_inputs)}：{test_input[:50]}...")

            for run in range(n_runs):
                # 随机决定先测A还是B（避免顺序偏差）
                if random.random() > 0.5:
                    output_a = self._run_prompt(prompt_a, test_input)
                    output_b = self._run_prompt(prompt_b, test_input)
                else:
                    output_b = self._run_prompt(prompt_b, test_input)
                    output_a = self._run_prompt(prompt_a, test_input)

                score_a = self.evaluator(test_input, output_a)
                score_b = self.evaluator(test_input, output_b)

                scores_a.append(score_a)
                scores_b.append(score_b)

                print(f"  Run {run+1}: A={score_a:.1f}, B={score_b:.1f}")

        # 统计结果
        avg_a = sum(scores_a) / len(scores_a)
        avg_b = sum(scores_b) / len(scores_b)

        winner = "A" if avg_a > avg_b else "B"
        improvement = abs(avg_a - avg_b) / min(avg_a, avg_b) * 100

        result = {
            "test_name": test_name,
            "avg_score_a": avg_a,
            "avg_score_b": avg_b,
            "winner": winner,
            "improvement": f"{improvement:.1f}%",
            "recommendation": f"版本{winner}更优，提升{improvement:.1f}%"
        }

        self.results[test_name] = result
        self._print_report(result)

        return result

    def _run_prompt(self, prompt: str, test_input: str) -> str:
        """运行Prompt"""
        full_prompt = f"{prompt}\n\n输入：{test_input}"
        response = self.llm.invoke(full_prompt)
        return response.content

    def _default_evaluator(self, input_text: str, output_text: str) -> float:
        """
        默认评估器：用LLM评分（1-10分）
        实际项目中应该用人工评分或专业评估模型
        """
        eval_prompt = f"""
        请对以下AI输出进行质量评分（1-10分）：

        输入：{input_text}
        输出：{output_text}

        评分标准：
        - 相关性（1-3分）：回答是否切题
        - 质量（1-3分）：内容是否有价值
        - 格式（1-2分）：格式是否规范
        - 完整性（1-2分）：是否完整回答

        只输出数字分数（如：8.5），不要有其他内容：
        """

        try:
            response = self.llm.invoke(eval_prompt)
            score = float(response.content.strip())
            return min(max(score, 1), 10)
        except:
            return 5.0

    def _print_report(self, result: dict):
        print(f"\n{'='*40}")
        print(f"A/B测试结果：{result['test_name']}")
        print(f"{'='*40}")
        print(f"版本A平均分：{result['avg_score_a']:.2f}")
        print(f"版本B平均分：{result['avg_score_b']:.2f}")
        print(f"获胜版本：{result['winner']}")
        print(f"提升幅度：{result['improvement']}")
        print(f"建议：{result['recommendation']}")


# 使用
llm = ChatOpenAI(model="gpt-4", temperature=0)
tester = PromptABTester(llm=llm)

result = tester.run_test(
    test_name="小红书标题生成",
    prompt_a="""
    你是小红书博主，请为以下主题生成一个吸引人的标题。
    要求：30字以内。
    """,
    prompt_b="""
    你是拥有50万粉丝的小红书博主"效率女神Echo"。
    请使用以下标题公式之一，为主题生成标题：
    - 冲突型："我靠这个方法，从X变成Y"
    - 数字型："N个被99%人忽视的X技巧"
    - 痛点型："遇到X问题？根源在这里！"
    要求：30字以内，有吸引力，口语化。
    """,
    test_inputs=[
        "如何用AI工具提升工作效率",
        "职场新人如何快速成长",
        "早起习惯的养成方法"
    ],
    n_runs=3
)
```

---

## 八、什么时候需要精调（Fine-tuning）？

### **决策树**

```
+---------------------------------------------+
|          是否需要精调？决策树                |
+---------------------------------------------+
|                                             |
|  先问：Prompt工程能解决吗？                  |
|    |-- 能 -- 不需要精调，省时省钱           |
|    +-- 不能 -- 往下看                       |
|                                             |
|  需要精调的情况：                           |
|    [OK] 需要特定风格（如：公司特有的写作风格）|
|    [OK] 专业领域术语（如：医疗/法律/金融）  |
|    [OK] 大量重复性任务（批量处理，省Token）  |
|    [OK] 要求极高的一致性（标准化输出）      |
|    [OK] Prompt工程试了10+个版本还不满意     |
|                                             |
|  不需要精调的情况：                         |
|    [X] 任务多样（每次不一样）               |
|    [X] 数据量少（<100条）                   |
|    [X] 预算有限                             |
|    [X] 频繁迭代（精调成本高）               |
|                                             |
+---------------------------------------------+
```

---

### **SFT数据集构造**

```python
import json
from typing import List, Dict


class SFTDatasetBuilder:
    """
    SFT（有监督微调）数据集构建器
    """

    def __init__(self, output_file: str = "sft_dataset.jsonl"):
        self.output_file = output_file
        self.samples = []

    def add_sample(self,
                   instruction: str,
                   input_text: str,
                   output_text: str,
                   system: str = ""):
        """
        添加一个训练样本

        instruction: 任务指令
        input_text: 用户输入
        output_text: 期望输出（高质量）
        system: System Prompt
        """
        sample = {
            "instruction": instruction,
            "input": input_text,
            "output": output_text,
            "system": system
        }
        self.samples.append(sample)

    def add_conversation_sample(self,
                                messages: List[Dict],
                                system: str = ""):
        """
        添加多轮对话样本

        messages: [
            {"role": "user", "content": "..."},
            {"role": "assistant", "content": "..."},
            ...
        ]
        """
        sample = {
            "conversations": messages,
            "system": system
        }
        self.samples.append(sample)

    def generate_from_existing_outputs(self,
                                       llm,
                                       instructions: List[str],
                                       system_prompt: str,
                                       quality_threshold: float = 7.0):
        """
        从LLM的高质量输出中自动生成训练数据
        （用GPT-4生成数据来训练更小的模型）
        """
        print(f"开始生成{len(instructions)}个训练样本...")

        for i, instruction in enumerate(instructions):
            print(f"  生成 {i+1}/{len(instructions)}...")

            # 用高质量模型生成输出
            response = llm.invoke(
                f"System: {system_prompt}\n\nUser: {instruction}"
            )
            output = response.content

            # 质量评估（简单版）
            quality_score = self._assess_quality(instruction, output)

            if quality_score >= quality_threshold:
                self.add_sample(
                    instruction=instruction,
                    input_text="",
                    output_text=output,
                    system=system_prompt
                )
                print(f"    [OK] 质量分数：{quality_score:.1f}，已添加")
            else:
                print(f"    [X] 质量分数：{quality_score:.1f}，已过滤")

        print(f"\n生成完成！有效样本：{len(self.samples)}/{len(instructions)}")

    def _assess_quality(self, instruction: str, output: str) -> float:
        """简单质量评估"""
        score = 5.0

        # 长度合理
        if 100 <= len(output) <= 2000:
            score += 1

        # 包含结构化内容
        if any(marker in output for marker in ['##', '1.', '-', '*']):
            score += 1

        # 没有明显拒绝
        if not any(phrase in output for phrase in
                   ['无法', '抱歉', '不能帮', 'I cannot']):
            score += 1

        # 与指令相关（简单判断）
        keywords = instruction.split()[:5]
        if any(kw in output for kw in keywords):
            score += 1

        return min(score, 10)

    def save(self):
        """保存为JSONL格式"""
        with open(self.output_file, 'w', encoding='utf-8') as f:
            for sample in self.samples:
                f.write(json.dumps(sample, ensure_ascii=False) + '\n')

        print(f"\n[OK] 数据集已保存：{self.output_file}")
        print(f"   共 {len(self.samples)} 条样本")

    def get_statistics(self):
        """输出数据集统计"""
        if not self.samples:
            print("数据集为空")
            return

        output_lengths = [len(s.get('output', ''))
                          for s in self.samples]

        print(f"\n=== 数据集统计 ===")
        print(f"总样本数：{len(self.samples)}")
        print(f"平均输出长度：{sum(output_lengths)/len(output_lengths):.0f}字")
        print(f"最短输出：{min(output_lengths)}字")
        print(f"最长输出：{max(output_lengths)}字")


# 使用示例
builder = SFTDatasetBuilder("xiaohongshu_sft.jsonl")

# 手动添加高质量样本
builder.add_sample(
    instruction="写一篇关于早起习惯的小红书笔记",
    input_text="",
    output_text="""
{
  "title": "坚持早起60天，我的人生发生了这些变化",
  "body": "曾经的我，是个爬不起来的夜猫子\n...",
  "hashtags": ["#早起", "#自律", "#生活方式"]
}
""",
    system=XIAOHONGSHU_SYSTEM
)

# 自动生成样本
instructions = [
    "写一篇关于读书方法的小红书笔记",
    "写一篇关于健身入门的小红书笔记",
    "写一篇关于理财入门的小红书笔记"
]

llm = ChatOpenAI(model="gpt-4", temperature=0.8)
builder.generate_from_existing_outputs(
    llm=llm,
    instructions=instructions,
    system_prompt=XIAOHONGSHU_SYSTEM,
    quality_threshold=6.5
)

builder.get_statistics()
builder.save()
```

---

## 九、这一讲的核心总结

### **必须记住的10个要点**

1. **角色定义要专业具体**，激活LLM的专业知识模式
2. **任务描述要SMART**，具体可衡量
3. **输出格式要精确定义**，优先用JSON或有示例的Markdown
4. **Few-shot是质量的保证**，至少1-2个高质量示例
5. **CoT让推理过程可见**，复杂任务必用
6. **国产模型Prompt有差异**，JSON输出需要额外强调
7. **Pydantic约束最稳定**，加上OutputFixingParser双保险
8. **Prompt要有版本管理**，不能随意修改
9. **A/B测试量化效果**，不靠感觉做决策
10. **精调是最后手段**，Prompt工程先试够

---

## 十、这一讲的练习题

### **练习1：Prompt设计**
为一个"法律咨询Agent"设计完整的System Prompt：
1. 角色定义（律师的哪种专业背景？）
2. 行为原则（法律咨询有哪些特殊限制？）
3. 输出格式（如何平衡专业性和可读性？）
4. Few-shot示例（给出一个标准问答示例）

---

### **练习2：输出稳定性**
改造本讲的小红书Agent：
1. 用Pydantic定义输出结构（XiaohongshuPost）
2. 加入OutputFixingParser
3. 当解析失败时，记录失败原因并重试
4. 统计各字段的解析成功率

---

### **练习3：A/B测试**
设计一个Prompt A/B测试方案：
1. 测试"有CoT"vs"无CoT"的效果差异
2. 设计5个测试输入
3. 设计评估标准（从哪些维度打分？）
4. 预测哪个版本会赢，并说明理由

---

## 十一、下一讲预告

### **第6讲：可观测性与调试——让Agent系统透明可控**

会讲：
- Agent日志设计规范
- Trace追踪与可视化
- 如何快速定位Agent卡死/死循环/输出异常
- LangSmith实战
- Agent的单元测试与集成测试
- 性能监控（Token消耗/响应时间/成功率）
- 实战：为研报系统加入完整可观测性体系

**准备工作：**
```bash
pip install langsmith langfuse
# 注册LangSmith账号（免费）
```
