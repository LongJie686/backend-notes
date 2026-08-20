# Meta 商品列表一键全选

在 Meta 商务管理平台的商品列表里自动滚动加载全部商品并全选。

- 本地：`D:\Aproject\meta-select-all\`（未入 git）
- 版本 1.1.0，Chrome MV3

## 解决的问题

Meta 商务管理平台的商品列表是虚拟滚动的：列表头的「全选」只能选中当前已渲染的那一屏，
要选全部就得手动往下滚到底，等每一批加载完再点。商品几百个时这件事完全没法做。

插件做的就是把「滚到底 → 等加载 → 再滚」这个循环自动化，滚完再触发全选。

## 实现

`content_scripts` 注入到四个域名：

```
business.facebook.com
www.facebook.com
web.facebook.com
adsmanager.facebook.com
```

`run_at: document_idle`，加载 `config.js` + `content.js`。
权限只申请了 `storage`（存快捷键配置），没有其他权限。

交互上给了三种入口：自定义快捷键、页面上的悬浮按钮、popup 面板。
**Esc 可以随时中断**——虚拟列表滚动过程中页面是卡的，没有中断手段会很难受。

## 这类脚本的通用注意

- 判断「加载完了」不能只看滚动到底，要看列表项数量在若干轮里不再增长。
- 全选的勾选框往往不响应直接改 `checked`，要派发真实的 click 事件让框架的监听器收到。
- 域名要写全。Facebook 同一个页面在 `www` / `web` / `business` 三个域名下都能打开，
  漏一个用户就会觉得「插件时灵时不灵」。
