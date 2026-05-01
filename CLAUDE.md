# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# backend-notes

VitePress 静态知识库站点，部署在 GitHub Pages。`docs/` 目录同时也是 Obsidian vault。

## 常用命令

```bash
# 本地开发预览
npm run docs:dev

# 构建（会自动生成 graph-data.json）
npm run docs:build

# 推送到 GitHub（需要代理）
git -c http.proxy=http://127.0.0.1:7890 -c http.postBuffer=524288000 push origin main
```

## 架构

```
docs/
  .vitepress/
    config.mts              -- VitePress 配置（导航栏 + 侧边栏）
    theme/
      index.ts              -- 注册 KnowledgeGraph 组件
      KnowledgeGraph.vue    -- D3 知识图谱可视化（d3 依赖）
    scripts/
      generate-graph-data.mts -- 构建时解析 sidebar 生成 graph-data.json
  public/
    graph-data.json         -- 自动生成的知识图谱数据（勿手动编辑）
  backend/                  -- 后端笔记
  database/                 -- 数据库笔记（含 mysql-notes/ 按讲拆分）
  ai-app/                   -- AI 应用笔记（multi-agent/, llm-dev/, agent-analysis/ 等）
  microservice/             -- 微服务笔记
  architecture/             -- 架构设计笔记
  high-concurrency/         -- 高并发系统设计笔记
  engineering/              -- 工程化（Docker, Git, 监控等）
  big-data/                 -- 大数据笔记
  data-analysis/            -- 数据分析笔记
```

## 关键约束

- `base: '/backend-notes/'` 已在 config.mts 中配置，不要删除
- Obsidian 自动同步到 git，通常不需要手动 commit/push
- 推送需要代理 `http://127.0.0.1:7890`
- graph-data.json 由 `generate-graph-data.mts` 从 sidebar 定义生成，不要手动编辑

## 新增笔记流程

1. 在 `docs/` 对应目录下新增 `.md` 文件
2. 在 `config.mts` 的 sidebar 中添加条目
3. **如果修改了 sidebar 结构**，需要同步更新 `generate-graph-data.mts` 中的 sidebar 定义（该脚本内嵌了一份 sidebar 副本用于图谱生成）
4. sidebar 命名规则：文件 `lecture-N.md`，侧边栏显示 `LN: Short Title`
5. 多讲内容使用 `collapsed: true` 折叠分组

## 笔记同步映射

用户在 `E:\Project\Astudy\` 写笔记，需要复制到 `docs/` 对应目录：

| 来源 | 目标目录 |
|------|---------|
| MySQL 笔记 | docs/database/ |
| Python / 网络笔记 | docs/backend/ |
| Redis 笔记 | docs/database/ |
| AI/LLM 笔记 | docs/ai-app/ |

## 关键链接

- 网站：https://longjie686.github.io/backend-notes/
- 仓库：https://github.com/LongJie686/backend-notes
