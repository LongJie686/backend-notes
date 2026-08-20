# 素材制作工作流

故事想法 → 脚本方案 → 人物四视图 → 场景背景图 → 逐片段视频 → TTS → 人工剪辑
的整条生成流程。Web 前台给使用者操作（提交/确认/打回/看产物），
飞书多维表格是后台数据资产台账，供管理者审计，使用者不直接进表。

- 本地：`D:\Aproject\素材制作工作流\`
- 仓库：`LongJie686/material-workflow`（master 分支，私有）
- 线上：`material.xingjilong.top`，pm2 `material_workflow`（worker）+ `material_web`（前台 7870）
- 建表：`python setup_table.py`（素材任务 / 人物库 / 场景库三张表）

## LLM 脚本的四段结构

人物设定 / 场景清单 / 分段脚本 / 口播文案。

前端的画幅选择**不传给提示词 LLM**：`auto` 表示由 AI 建议画幅，没有建议时透传原图比例。

## veo3 生成红线（硬规则）

素材制作用 veo3.1。有些东西模型就是做不到，必须在脚本节点就从源头规避，
而不是生成完了再挑：

- **不可实现项**：多人互动、手部特写、画面内文字。画面内文字一律后期贴字。
- **公众人物会被安全过滤**：veo / sora 提示词里带真实公众人物姓名会被
  "prominent public figure" 过滤掉，而且**失败被包装成成功**——接口回「已完成」但视频字段是 null。
  只描述衣服，不点名。
- **首帧提示词要写死裤鞋款式**，否则帧间会漂（白球鞋变棕皮鞋）。
- 非翻面镜头要显式写 `never turns around`；翻面镜头需要末帧真图锚定、首尾帧同机位平滑过渡。

## veo3 API 的三个坑

1. 含音频指令的请求会被安全过滤拒单，必须完全撤除音频相关描述。
2. `resultUrls` 的路径格式与文档不一致。
3. `errorMessage` 的字段名与文档不同。

结论：**以实际响应为准，不要照文档写解析代码**。

另外 `REFERENCE_2_VIDEO` 模式恒出 8 秒（`duration` 参数无效），已弃用；
改用 `FIRST_AND_LAST_FRAMES_2_VIDEO`，只喂首帧 + duration，时长只准 4/6/8 秒。

## 架构

可靠性机制整套沿用[上身图工作流](/projects/production/tryon)：
操作列/状态列双列单写者、孤儿恢复、失败扣费入账、kie 主用 + toapis 兜底、LLM 三级通道链。

两个进程：`run.py`（worker 状态机）、`webapp.py`（FastAPI 前台）。
相关笔记：[FastAPI](/backend/fastapi)、[AI 工作流工程化](/ai-app/ai-workflow-engineering)

## 飞书注意事项

- 素材三表用 **B 应用**（`.env` 的 `FEISHU_APP_ID_B`，有 wiki 权限）落 wiki 大表格。
  主应用 A 对这个 base 没有权限。
- **本地 worker 绝对不能启动**：会和服务器 worker 双写同一张飞书表。
- 给单选列加选项时，PUT 重写选项如果不带原有选项的 id，会**清空全表已有值**。

## 容易误删的资产

`static/demo/` 下的 3 个 mp4（664K）是功能资产，被 `webapp._demo_task` 引用，
不是垃圾，不能当缓存清掉。

入库前要排除 `walkbyfaith视频资产/`（257MB），漏排会让 `.git` 膨胀。
相关笔记：[Git](/engineering/git)

## 凭证

会话签名密钥 `WEB_SECRET` 只存在服务器 `.env` 里，本机没有。
换机器时按 `.env` 复制会断掉，要以凭证台账为准（台账不写明文）。
