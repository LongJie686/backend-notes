# dsh 启动闸门（dsh-guard）

`dsh`（DeepSeek 的 profile 启动器）启动前的自检工具。
把踩过的坑固化成检查项，每次启动前扫一遍：能修的直接修，
修不了的点名报告是哪个插件出的问题。

- 本地：`D:\Aproject\dsh-guard\`（未入 git）
- 文件：`dsh_guard.py`（主体）、`unbundle.py`（拆插件 bundle）

```bash
python dsh_guard.py              # 检查 + 自动修复安全项
python dsh_guard.py --check      # 只检查，不改任何文件
python dsh_guard.py --profile web
```

退出码：`0` = 可以启动；`1` = 存在会导致启动失败的问题且无法自动修复。

## 解决的问题

dsh 的 profile 是「插件 bundle 补丁层的有序堆叠」，用户自己的覆盖在最上面。
这个模型很灵活，代价是**装完某个插件后 dsh 起不来，而报错不告诉你是哪个插件干的**。

闸门做的事就是把排查前置：启动前先扫，在还没进入启动流程时就把问题定位到具体插件。

## 值得复用的设计

- **`--check` 与默认模式分离**。默认会自动修，但必须留一个只读模式——
  自动修改配置文件的工具，如果没法先看它打算改什么，就没人敢用。
- **退出码承载语义**，不靠解析 stdout。这样能直接串进启动脚本：
  `python dsh_guard.py && dsh` 。
- **只自动修「安全项」**。能确定无副作用的才动手，有歧义的一律只报告。
  自动修复的边界划错，工具本身就成了新的故障源。

这个思路和服务器上的 `safe_restart.sh` 是一样的：把「每次都要人工检查一遍」的事
固化成脚本，并且**让检查和动作在同一条命令里**，中间不留人为窗口。

相关笔记：[Python](/backend/python)、[Claude Code 实战笔记](/ai-app/claude-code-practice)
