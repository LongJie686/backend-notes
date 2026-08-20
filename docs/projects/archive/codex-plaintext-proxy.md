# Codex 明文代理

在 Codex 与 DeepSeek 之间转发流量的 SSE 改写代理，
让 Codex MultiAgent V2 的父任务能把正文明文投递给子代理。

- 本地：`D:\Aproject\codex-plaintext-proxy\`（未入 git）
- 文件：`proxy.py`（asyncio），监听 `127.0.0.1:8323`

```bash
python proxy.py
```

配套 codex 配置：`base_url = "http://127.0.0.1:8323/"`

## 问题背景

Codex MultiAgent V2 的父 → 子任务正文默认走服务端加密投递。
官方的明文路径（PR #35845）要求 `function_call` 响应项显式携带
`encrypted_function_args: []` 且 `namespace == "collaboration"`。

DeepSeek 官方的 `/responses` 端点不返回这两个字段，
结果是**子代理收到一个空壳任务**——有调用，没内容。

## 做法

代理只对 SSE 事件 `response.output_item.added` 和 `response.output_item.done`
里的协作类 `function_call` 项注入上述两个字段，**其余字节原样透传**。

改写面控制到最小是有意的：这类兼容层最大的风险是「顺手多改了点别的」，
一旦上游协议演进，多改的部分就成了新 bug 的来源。
只碰必须碰的字段，上游修好之后整个代理可以直接删掉。

## 教训

这个项目本身就是一条经验的产物：**第三方工具、桥接、协议兼容类报错，
先搜社区再动手**。

拿报错原文里最独特的字段名或短语去搜上游 issue
（`gh search issues --repo 上游仓库 "关键词"`），再查 release notes，
对比本机版本的构建日期决定是升级还是打补丁。

**禁止猜配置键、monkey-patch、牺牲功能绕行**。
同期的另一个案例：codex thinking 报 400，搜到 issue #3710 上游已经修了，
升级即解决，完全不需要写代码。

本项目是搜完确认上游没修、且短期内不会修，才动手写的。

相关笔记：[Claude Code 实战笔记](/ai-app/claude-code-practice)、
[Python](/backend/python)、[MCP 协议基础](/ai-app/multi-agent/lecture-4)
