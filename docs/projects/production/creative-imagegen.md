# 创意生图

投放岗和买手岗共用的「大白话生图」站点：用户用日常话描述想要什么，
LLM 翻成专业提示词再送去生图。附带 Etsy / TikTok 创意趋势采集。

- 本地：`D:\Aproject\工作流\创意生图\`
- 仓库：`LongJie686/creative-imagegen`（私有）
- 线上：`extract.xingjilong.top/gen/`，pm2 `creative_imagegen`，端口 7863
- 数据目录：`/opt/creative_imagegen_data/`（`creative_history.db`，启用 WAL）

## 版本控制的特殊情况

本目录被 `.gitignore` 排除，但它是服务器上的 pm2 生产服务。
所以**动文件前必须先 ssh 到服务器备份线上版本，scp 覆盖前先拉下来 diff**——
本地和线上是否一致没有 git 兜底，只能靠人工比对。

## 生图渠道比价

toapis 比 kie 便宜约 25%~40%：

| 模型 | toapis | kie |
|------|--------|-----|
| nano-banana | $0.012 | $0.02 |
| nano-banana-2 | $0.03 | $0.04 起 |
| nano-banana-pro | $0.06 | $0.09 |

生图双渠道兜底用 nano-banana-2 + gpt-image-2（两家都有）。
注意 **gemini-3-flash / 3.5-flash 是纯文本/识图模型，不能生图**，
Gemini 系最新生图模型是 3.1 Flash Image。

LLM 兜底链：主 gemini-3-flash@toapis → 兜底 gemini-3-flash@kie（key 自动复用）。
kie 的聊天接口只有 gemini-2.5/3 系可用；sonnet-5 不遵循结构化人设，不可用。

成本基准与元素提取 v3 共用同一套通道，见
[元素提取](/projects/production/element-extract#成本基准-跨项目可复用)。

## toapis 的限制（踩过的）

- 单价查 `https://toapis.com/api/pricing`，是倍率制。
- 上传图片 ≤10MB，超限返回 HTTP 400 "Image too large"，属 4xx 业务错误**不该重试**。
- 查余额用账户级 `/v1/user/balance`（key 级 `/v1/balance` 会误导）。
- 限频极严，70 秒间隔仍可能被拒；限流按用户 ID 共享。
- `rate_limit_check_failed` 全线拒绝时，可能是平台侧故障而不是你超限。
- 别拿 kie 的标价推算 toapis，会高估 42%。

## 创意趋势采集

**TikTok 双轨方案**：本机 Windows 计划任务 `CreativeImagegenTrends` 每天 9:00
带登录态采完整榜单，服务器 cron 9:15 匿名兜底（检测到今日已产出就跳过）。

为什么要双轨——TikTok Creative Center 匿名只给 3 条、登录能拿 50 条，
而**登录态没法导出到服务器**：Chrome 137+ 的 cookie 用 v20 App-Bound Encryption，
DPAPI 解密、复制 profile、抓包全部失效。绕过办法是不导出，
用 opencli 扩展在 Chrome 进程内带着登录态直接请求目标 API。

其他坑：TikTok One 新版需要伪装 UA，否则 SPA 白屏；`GetHashtagList` 无签名可以在页面内重放，
但匿名硬限每榜 top3。

**Etsy 这条路不通**：无头 + 伪装仍被 DataDome 403 拦死（403 + JS 挑战 + CAPTCHA）。

相关笔记：[数据获取](/data-analysis/data-acquisition)、[LLM 概述](/ai-app/llm)

## 鉴权

`/gen/` 挂 nginx `auth_request _cs_auth`，回源 `127.0.0.1:3000/api/auth/verify`，
未登录 302 到门户。`auth_request` 拦的是整个 location 前缀，
包括 Gradio 的 `/queue/join`、`/run/predict`，所以不会被绕过。

## 运维

- 上线健康判据：curl 得 200 **且 PID 必须变化**——只看 HTTP 会漏掉 pm2 空转。
  不满足就回滚备份重启，重启后查 pm2 error 日志（有些问题只在那里现形）。
- 端口这类环境事实要从 `start.sh` / nginx 配置读出来确认，不能凭印象。
- Gradio 的 `/tmp/gradio` 有两条清理 cron（04:15 `cleanup_gradio_tmp.py` +
  04:30 删 mtime 超 1 天），新部署 Gradio 服务后要确认覆盖到。
