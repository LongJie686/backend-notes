---
name: backend-notes-update
description: backend-notes 项目专用 skill。用于创建课程笔记文件、更新 VitePress 侧边栏配置、新建目录。确保文件命名、路径、sidebar 格式全部符合项目约定。
---

# backend-notes 课程与目录更新

你是 backend-notes 项目的文档管理助手。所有操作必须严格遵循以下规则。

## 项目基本信息

- 项目路径: `E:/Project/backend-notes`
- 文档根目录: `E:/Project/backend-notes/docs/`
- VitePress 配置: `docs/.vitepress/config.mts`
- base path: `/backend-notes/`（不可删除）
- 语言: 中文内容，英文目录名/文件名
- 推送不需要手动操作，Obsidian 会自动同步

## 目录与分类映射

| 分类 key | 目录路径 | 侧边栏 text |
|----------|---------|-------------|
| backend | docs/backend/ | Backend |
| database | docs/database/ | Database |
| recommend-system | docs/recommend-system/ | Recommend System |
| ai-app | docs/ai-app/ | AI App |
| microservice | docs/microservice/ | Microservice |
| architecture | docs/architecture/ | Architecture |

## 文件命名规则

### 课程讲次文件
- 格式: `lecture-N.md`（N 从 1 开始，不补零）
- 路径: `docs/{category}/{topic}/lecture-N.md`
- 示例: `docs/database/mysql-notes/lecture-1.md`

### 普通笔记文件
- 格式: `{kebab-case-name}.md`
- 路径: `docs/{category}/{name}.md`
- 示例: `docs/backend/python.md`

### 目录首页文件
- 格式: `index.md`
- 路径: `docs/{category}/index.md` 或 `docs/{category}/{topic}/index.md`

## 讲次文件内容模板

创建新的 lecture 文件时，使用以下模板（根据实际内容调整）:

```markdown
# 第 N 讲：{中文标题}

## 核心结论（X 条必记）

1. **要点1** -- 简要说明
2. **要点2** -- 简要说明
...

---

## 一、{章节标题}

{内容}

---

## X、练习题

### 练习 1：{题目}

{描述}
```

标题格式统一为 `# 第 N 讲：中文标题` 或 `# LN: 英文标题`，根据已有文件风格保持一致。

## VitePress 侧边栏配置规则

### config.mts 位置
文件路径: `docs/.vitepress/config.mts`，sidebar 数组在 `themeConfig.sidebar` 中。

### 侧边栏结构格式

```typescript
sidebar: [
  {
    text: 'Category Name',           // 侧边栏分组名
    items: [
      { text: 'Page Title', link: '/category/page' },           // 普通页面
      {
        text: 'Topic Study Notes',     // 折叠分组（课程系列）
        collapsed: true,
        items: [
          { text: 'L1: Short Title', link: '/category/topic/lecture-1' },
          { text: 'L2: Short Title', link: '/category/topic/lecture-2' },
        ]
      }
    ]
  }
]
```

### 侧边栏条目命名规则

1. **课程讲次**: `L{N}: {English Short Title}`
   - 示例: `L1: Architecture Overview`, `L2: gRPC Basics`
2. **普通页面**: `{English Title}`
   - 示例: `Python`, `Redis`, `LLM`
3. **折叠分组**: `{English Topic} Study Notes` 或 `{English Topic}`
   - 示例: `MySQL Study Notes`, `Agent Architecture Analysis`

### link 格式规则

- 不带 `.md` 后缀
- 不带 `docs/` 前缀
- 以 `/` 开头
- 示例: `/database/mysql-notes/lecture-1`

### 新增课程讲次时的 sidebar 更新逻辑

1. 找到对应的分类分组（text 匹配）
2. 在分类分组内找到或创建折叠子分组
3. 在折叠子分组的 items 数组末尾追加新条目
4. 如果分类分组之前没有 `collapsed: true`，但内容超过 3 个 items，应考虑改为折叠式

### 新增分类时的 sidebar 更新逻辑

1. 在 sidebar 数组末尾追加新分组
2. 格式遵循现有分组风格
3. 同时检查 nav 数组是否需要更新

## 操作流程

### 场景 1: 新增一个课程讲次

用户说: "新增微服务第 3 讲，主题是服务治理"

执行步骤:
1. 确认目标目录: `docs/microservice/`
2. 检查已有 lecture 文件，确定下一个编号
3. 创建 `docs/microservice/lecture-3.md`，使用模板填充
4. 读取 `docs/.vitepress/config.mts`
5. 在 Microservice 分组的 items 中追加:
   `{ text: 'L3: Service Governance', link: '/microservice/lecture-3' }`
6. 确认修改无误

### 场景 2: 新增一个分类目录

用户说: "新建一个设计模式分类"

执行步骤:
1. 创建目录: `docs/design-pattern/`
2. 创建首页: `docs/design-pattern/index.md`
3. 读取 `docs/.vitepress/config.mts`
4. 在 sidebar 数组中追加新分组:
   ```typescript
   {
     text: 'Design Pattern',
     items: [
       { text: 'Learning Roadmap', link: '/design-pattern/' }
     ]
   }
   ```
5. 在 nav 数组中评估是否需要添加导航链接
6. 确认修改无误

### 场景 3: 新增普通笔记文件

用户说: "在 database 下新增 Redis 笔记"

执行步骤:
1. 创建文件: `docs/database/redis.md`
2. 读取 `docs/.vitepress/config.mts`
3. 在 Database 分组的 items 中追加:
   `{ text: 'Redis', link: '/database/redis' }`
4. 确认修改无误

### 场景 4: 批量新增多个课程讲次

用户说: "把微服务第 2-5 讲的内容加进来"并提供了内容

执行步骤:
1. 逐个创建 lecture-2.md 到 lecture-5.md
2. 一次性更新 config.mts，追加所有新条目
3. 确认文件编号连续，sidebar 顺序正确

## 校验清单

每次操作完成后，必须检查:

- [ ] 文件路径正确，在对应的 category 目录下
- [ ] 文件命名符合 `lecture-N.md` 或 `kebab-case.md` 规则
- [ ] lecture 编号连续，没有跳号
- [ ] config.mts 的 link 路径不带 `.md` 后缀，不带 `docs/` 前缀
- [ ] config.mts 的 sidebar text 格式正确（`LN: Title` 或 `Title`）
- [ ] config.mts 语法正确（TypeScript，注意逗号和括号）
- [ ] 折叠分组（collapsed）的 items 中，lecture 按编号顺序排列
- [ ] 没有重复的 sidebar 条目
