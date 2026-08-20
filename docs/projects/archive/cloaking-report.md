# 广告斗篷取证

对竞对站点 gamedayunion.com 与 teamwlord.com 的广告斗篷（Cloaking）行为做的取证与举报材料。

- 本地：`D:\Aproject\举报证据\`（未入 git）
- 证据固定日期：2026-07-31 (UTC)
- 违规条款：Meta Advertising Standards — Circumventing Systems / Cloaking

## 什么是斗篷

给广告审核员看一个页面，给真实点击广告的用户看另一个页面。
审核看到的是合规内容，实际投放的是别的东西。

## 查明的分流机制

以 gamedayunion.com 为例：

1. **首访时按三个条件判定**访客身份（审核 or 真实点击）
2. 判定结果写进 `shopab_shunt_result` Cookie：`1` = 假页，`0` = 真页
3. Cookie 有效期 **90 天**，之后**钉死不再重判**

关键弱点是第 2 步：判定结果存在客户端。既然存在客户端就可以翻转，
这也是[斗篷解锁插件](/projects/extensions/shunt-unlock)的实现基础——
装上插件后能稳定看到真实落地页，从而固定证据。

## 证据链

所有文件的 SHA-256 哈希记录在 `MANIFEST.txt` 里。
取证材料要能自证未被篡改，哈希清单是最低成本的做法——
截图和 HAR 文件本身没有可信度，能对上哈希的截图才有。

## 产出

- 分析报告（分流条件、Cookie 生命周期、真假页对比）
- Chrome 解锁插件（复现手段，让第三方能自行验证）
- 按 Meta 举报格式整理的证据包

相关笔记：[数据获取](/data-analysis/data-acquisition)
