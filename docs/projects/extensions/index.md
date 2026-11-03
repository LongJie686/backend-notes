# 浏览器插件

四个 Chrome MV3 扩展，都是为了解决「网页上拿不到的东西」——
要么是页面不肯给（竞对斗篷），要么是通用工具看不见（动态注入的投放像素），
要么是操作太繁琐（Meta 商品列表逐个勾选、广告逐条建草稿）。

| 插件 | 版本 | 解决什么 |
|------|------|---------|
| [平台识别插件](/projects/extensions/platform-detect) | 0.1.0 | 识别目标站的建站平台与投放平台，提取像素 ID |
| [斗篷解锁插件](/projects/extensions/shunt-unlock) | 1.1.0 | 绕过竞对站点的斗篷分流，看到真实落地页 |
| [Meta 一键全选](/projects/extensions/meta-select-all) | 1.1.0 | Meta 商务管理平台商品列表自动滚动加载并全选 |
| [广告投放助手](/projects/extensions/ad-publish) | 0.1.14 | ERP 选品批量生成 Meta 草稿广告，只建草稿不发布 |

## MV3 的两个常识

- **`webRequest` 的观察模式在 MV3 里仍然可用**，被 `declarativeNetRequest` 取代的
  只是阻塞式拦截。想「看」流量不需要迁移，想「改」流量才需要。
- **content script 按需注入比常驻更合适**。`chrome.scripting.executeScript` 可以指定
  MAIN world（读页面全局变量）或 ISOLATED world（读渲染后 DOM 与 Cookie），
  只在用户打开面板时才注入，日常浏览零开销。

装完扩展**必须刷新已经打开的标签页**——网络监听从装载后才开始，之前打开的页面采集不到请求。

相关笔记：[数据获取](/data-analysis/data-acquisition)
