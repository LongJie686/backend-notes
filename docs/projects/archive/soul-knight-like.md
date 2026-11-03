# Soul Knight Like

元气骑士 Like 的俯视角地牢射击小游戏，Web Canvas + TypeScript，
内容深度借鉴重生细胞（翻滚闪避已实装）。

- 本地：`D:\Aproject\soul-knight-like\`
- 仓库：`LongJie686/soul-knight-like`（master 分支，私有）

```bash
cd soul-knight-like/web
npm install && npm run build
npm run serve          # http://localhost:8765
```

操作：WASD 移动，鼠标瞄准，左键射击，空格翻滚闪避（带无敌帧）。

## 架构铁律：core 零引擎依赖

```
[Input] → core/GameSim.update(dt, inputs) → Snapshot → Canvas 渲染
```

`assets/scripts/core/` 是纯逻辑层，**禁止出现任何引擎或浏览器 API**：
不得 `import ... from 'cc'`，不得引用 `document` / `window` / `canvas` / `Image` /
`requestAnimationFrame`。

理由是 core 要能整体搬到 Node 服务端跑状态同步，也要能原样移植到微X小游戏。
渲染层（`web/src/`）**单向依赖** core，core 永远不反向依赖渲染层。

落到日常开发上就一条规矩：新增玩法逻辑一律进 core 的 `systems/`，
渲染层只消费 Snapshot 和事件。

## 这条铁律为什么值得单独记

它本质上是「把不确定的东西挡在门外」的架构模式，跟服务端项目里
[LLM 输出一律当不可信输入校验](/projects/production/tryon)是同一个思路：
把易变、不可控、平台相关的部分圈在边界外，核心层只处理确定的输入输出。

游戏这边圈的是渲染引擎，服务端那边圈的是模型输出，做法一致——
**定一条谁都不能破的单向依赖，然后靠 lint 或 review 守住它**。

相关笔记：[设计原则](/architecture/lecture-2)
