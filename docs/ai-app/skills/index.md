# Skills 技能系统

## 什么是 Skills

Skills 是 AI Agent 的可复用能力单元，将特定任务的知识（Prompt、工具、流程）封装为标准化模块，让 Agent 按需调用。

类比：**Skills 对 Agent 就像函数对程序** -- 封装、复用、组合。

## Skills vs Tools vs Plugins

| 维度 | Skills | Tools (Function Calling) | Plugins |
|------|--------|--------------------------|---------|
| 粒度 | 任务级（完整流程） | 函数级（单个操作） | 应用级（功能扩展） |
| 内容 | Prompt + 工具 + 流程 | 仅函数签名和参数 | 配置 + 权限 + 工具 |
| 复用性 | 高，跨 Agent 复用 | 中，需配合 Prompt | 低，绑定平台 |
| 典型例子 | "生成周报"技能 | 搜索 API 调用 | ChatGPT 插件 |

## Skills 的核心结构

一个标准 Skill 通常包含：

```
skills/
└── generate-report/
    ├── SKILL.md          # 技能描述（名称、用途、触发条件）
    ├── prompt.md         # 核心 Prompt 模板
    ├── tools.py          # 依赖的工具函数
    └── examples/         # 示例输入输出
        └── example-1.json
```

**SKILL.md 示例：**

```markdown
---
name: generate-report
description: 根据数据生成分析报告
trigger: 用户要求生成报告、周报、月报时
tools: [database-query, chart-generator]
---

## 使用说明
1. 从数据库查询指定时间范围的数据
2. 生成图表可视化
3. 输出结构化报告
```

## 技能发现与匹配

```
用户输入 -> 意图识别 -> 匹配 Skills -> 加载 Skill -> 执行
```

**匹配策略：**
- **关键词匹配**：技能名称和描述中包含关键词
- **语义匹配**：用 Embedding 计算用户输入与技能描述的相似度
- **规则匹配**：预设触发条件和正则表达式

## 技能组合与编排

复杂任务可以组合多个 Skill：

```
用户: "帮我做一份竞品分析报告"

执行流程:
  1. Skill: web-search（搜索竞品信息）
  2. Skill: data-extract（提取关键数据）
  3. Skill: chart-generator（生成对比图表）
  4. Skill: report-writer（撰写分析报告）
```

## 技能热加载

生产环境中技能需要支持动态更新，不重启服务：

```python
class SkillRegistry:
    def __init__(self, skill_dir: str):
        self.skill_dir = skill_dir
        self.skills = {}
        self._load_all()

    def reload(self):
        """热加载：重新扫描技能目录"""
        self.skills.clear()
        self._load_all()

    def match(self, user_input: str) -> list:
        """根据用户输入匹配最相关的技能"""
        matched = []
        for name, skill in self.skills.items():
            if skill.match(user_input):
                matched.append(skill)
        return sorted(matched, key=lambda s: s.relevance, reverse=True)
```

## 与 MCP 的关系

- **MCP** 是通信协议，定义了 Agent 如何调用外部工具
- **Skills** 是能力封装，定义了 Agent 能做什么、怎么做
- 两者互补：Skills 编排流程，MCP 提供工具通道

```
Skills（做什么、怎么做）
   |
   v
MCP（调用外部工具的协议）
   |
   v
外部工具（搜索、数据库、API）
```

## 设计原则

1. **单一职责**：每个 Skill 只做一件事
2. **自描述**：SKILL.md 要写清楚触发条件和使用方式
3. **可测试**：提供示例输入输出，方便验证
4. **可组合**：Skill 之间通过输入输出衔接，不直接耦合
5. **幂等性**：相同输入产生相同结果，可安全重试

## 常见坑点

- **技能描述不清晰**：导致匹配错误，触发不相关的 Skill
- **技能粒度不当**：太细碎增加编排复杂度，太粗失去复用性
- **缺少兜底机制**：没有 Skill 匹配时，Agent 应有默认处理策略
- **技能冲突**：多个 Skill 同时匹配，需要优先级排序
