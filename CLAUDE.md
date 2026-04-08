# backend-notes

VitePress 静态知识库站点，部署在 GitHub Pages。

## 项目结构

```
backend-notes/
  docs/                        -- VitePress 文档根目录（也是 Obsidian vault）
    .vitepress/config.mts      -- VitePress 配置（导航栏、侧边栏）
    index.md                   -- 首页
    backend/                   -- 后端笔记
      python.md
      network.md
    database/                  -- 数据库笔记
      mysql.md
      mysql.md
      mysql-notes/             -- MySQL 学习笔记（按讲拆分）
        lecture-1.md
        lecture-2.md
        ...
      redis.md
    recommend-system/          -- 推荐系统笔记
    ai-app/                    -- AI 应用笔记
  .github/workflows/deploy.yml -- GitHub Actions 自动部署
```

## 常用命令

```bash
# 本地开发预览
npm run docs:dev

# 构建
npm run docs:build

# 推送到 GitHub（需要代理）
git -c http.proxy=http://127.0.0.1:7890 -c http.postBuffer=524288000 push origin main
```

## 工作流

1. 在 `docs/` 下编辑或新增 .md 文件
2. 更新 `docs/.vitepress/config.mts` 的 sidebar（如有新文件）
3. `git add -A && git commit -m "docs: 描述" && git push`
4. GitHub Actions 自动构建部署，1-2 分钟后网站更新

## 笔记拆分规则

当单个 .md 包含多个"第 N 讲"时，拆分为独立文件：

- 创建子目录：`docs/{category}/{topic}/lecture-N.md`
- 原文件改为目录页，链接到各讲
- sidebar 使用 `collapsed: true` 折叠分组
- 命名：文件 `lecture-N.md`，侧边栏 `LN: Short Title`

## 同步笔记

用户在 `E:\Project\Astudy\` 写笔记，需要复制到 `docs/` 对应目录：

| 来源 | 目标目录 |
|------|---------|
| MySQL 笔记 | docs/database/ |
| Python 笔记 | docs/backend/ |
| 网络笔记 | docs/backend/ |
| Redis 笔记 | docs/database/ |
| 推荐系统笔记 | docs/recommend-system/ |
| AI/LLM 笔记 | docs/ai-app/ |

## 关键链接

- 网站地址：https://longjie686.github.io/backend-notes/
- GitHub 仓库：https://github.com/LongJie686/backend-notes
- GitHub 分支：main（push 到 main 触发自动部署）

## 注意事项

- base path 已设为 `/backend-notes/`，不要删除
- Obsidian vault 就是 `docs/` 目录
- 推送需要代理 `http://127.0.0.1:7890`
- 不要把 token/密钥提交到仓库
