# 星吉珑官网首页

成都星吉珑网络科技有限公司官网首页，对外 + 对内合一的一个页面：

- **未登录访客**：看到公司官网（公司介绍、业务展示、品牌形象）—— 待实现
- **登录后**：看到内部服务入口（CrossSail 看板 + 元素提取 v2/v3 + 各工作流）—— 已完成

登录采用钉钉扫码，只校验公司 ID。看板仅注册用户可访问，元素提取对本公司钉钉成员开放。

- 本地：`D:\Aproject\xingjilong-home\`（未入 git）
- 内容：只有 `README.md` + `home.html` 两个文件

## 单文件前端

`home.html` 是单文件，内联 CSS + JS，无构建步骤。跟
[CrossSail](/projects/production/crosssail) 的 `index.html` / `monitor.html` 同一路子。

这个选择是有意的：页面依赖的后端 API 和 nginx 配置都不在本项目里
（API 在 CrossSail，nginx 在服务器上），本项目就只是一个静态文件。
引入构建工具会让「改一行文案要走一遍构建再 scp」，得不偿失。

## 它在整个门户里的位置

这个页面是所有服务的入口枢纽。首页的六张卡片分别指向各个工作流服务，
而所有服务的 nginx `auth_request` 都回源到 CrossSail 的 `/api/auth/verify`。
换句话说：**首页负责导航，CrossSail 负责鉴权，各工作流只管自己的业务**。

前端文案有一条铁律：**不向最终用户暴露内部版本、架构、迁移、合并细节**，
这些只进代码注释。指标和字段的解释一律用小问号（`.qm` class，`cursor: help`）
悬浮 title 提示，不在页面上堆大段说明文字。

相关笔记：[生产工作流索引](/projects/production/)、[云服务器运维](/engineering/cloud-server-ops)
