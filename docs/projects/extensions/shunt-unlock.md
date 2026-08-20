# 斗篷解锁插件（Shunt Unlock）

绕过竞对站点的斗篷分流，让浏览器看到真实落地页而不是给广告审核看的假页。

- 本地：`D:\Aproject\shunt-unlock-extension\`（未入 git）
- 版本 1.1.0，Chrome MV3
- 目标域名：`gamedayunion.com`、`teamwlord.com`、`resistprint.com`

## 竞对的斗篷机制

以 gamedayunion.com 为例，分流逻辑是：

1. 首次访问时按三个条件判定访客是「审核」还是「真实点击」
2. 判定结果写进 `shopab_shunt_result` Cookie（`1` = 假页，`0` = 真页），有效期 90 天
3. **之后就钉死不再重判**——后续访问直接读 Cookie 决定给哪个页面

这个设计的弱点很明显：判定结果存在客户端。既然存在客户端，就可以翻转。

## 插件做的事

| 权限 | 用途 |
|------|------|
| `cookies` | 翻转 `shopab_shunt_result` 分流 Cookie |
| `declarativeNetRequestWithHostAccess` | 对指定域名改写语言、UA、Referer 等请求头 |
| `storage` / `tabs` | 保存配置、按标签页生效 |

`host_permissions` 只写死了三个已知竞对域名，另有 `optional_host_permissions: *://*/*`
供临时授权其他站点，不默认申请全站权限。

这里用的是 `declarativeNetRequest` 而不是 `webRequest`——因为要**改写**请求头，
MV3 下阻塞式 `webRequest` 已经不可用，改流量只能走 DNR 规则。
与之相对，[平台识别插件](/projects/extensions/platform-detect)只需要「看」流量，
所以仍然用 `webRequest` 观察模式。

## 配套取证

分析过程和证据链见[广告斗篷取证](/projects/archive/cloaking-report)——
按 Meta 广告规范「Circumventing Systems / Cloaking」条款整理的举报材料，
所有文件带 SHA-256 哈希（`MANIFEST.txt`）。

相关笔记：[数据获取](/data-analysis/data-acquisition)
