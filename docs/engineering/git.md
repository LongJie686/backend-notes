# Git 协作开发

## 常用命令

```bash
# 基本操作
git add .                              # 暂存所有变更
git commit -m "feat: 添加用户接口"       # 提交
git push origin main                   # 推送
git pull --rebase origin main          # 拉取并变基（保持线性历史）

# 分支操作
git checkout -b feature/login          # 创建并切换分支
git merge feature/login                # 合并到当前分支
git rebase main                        # 变基到 main

# 暂存与恢复
git stash                              # 暂存未提交的修改
git stash pop                          # 恢复暂存的修改

# 查看历史
git log --oneline --graph --all        # 图形化查看提交历史
git diff HEAD~1                        # 查看最近一次提交的变更
```

## 分支策略

| 策略 | 模式 | 适用场景 |
|------|------|---------|
| **Git Flow** | main / develop / feature / release / hotfix | 有计划发布周期的项目 |
| **GitHub Flow** | main + feature 分支，PR 合并 | 持续部署的 Web 项目 |
| **Trunk-based** | 只在 main 上开发，短生命周期分支 + Feature Flag | 高频发布团队 |

```
# GitHub Flow 示例
main ─── feature/login ─── main
              PR 评审 → 合并 → 自动部署
```

## Commit 规范

```
<type>(<scope>): <subject>

<body>
```

| Type | 说明 | 示例 |
|------|------|------|
| feat | 新功能 | feat(auth): 添加 JWT 登录接口 |
| fix | 修复 Bug | fix(api): 修复分页参数越界 |
| docs | 文档变更 | docs: 更新部署文档 |
| refactor | 重构 | refactor: 抽取公共日志模块 |
| test | 测试 | test: 补充用户模块单元测试 |
| chore | 杂项 | chore: 升级依赖版本 |

## 冲突解决

```bash
# 合并时产生冲突
git merge feature/login
# <<<<<<< HEAD
# 当前分支代码
# =======
# 被合并分支代码
# >>>>>>> feature/login

# 手动编辑冲突文件后
git add <resolved-file>
git commit

# 放弃合并
git merge --abort
```

## .gitignore 配置

```gitignore
# Python
__pycache__/
*.pyc
.venv/
.env

# IDE
.vscode/
.idea/

# 系统文件
.DS_Store
Thumbs.db

# 构建产物
dist/
build/
*.egg-info/
```
