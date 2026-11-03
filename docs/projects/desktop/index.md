# 桌面工具

三个自用工具，不上云服务器。共同点是都解决「现成软件不好用或者没有」的具体麻烦，
不追求通用性。Pocket 和内网快传跑在本机；字幕高亮 2026-10-20 已迁到
[辅助电脑](/projects/infra/aux-pc)常驻。

| 工具 | 技术栈 | 解决什么 |
|------|--------|---------|
| [Pocket 口袋浏览器](/projects/desktop/pocket) | Electron | 悬浮球 dock，鼠标碰球即开的多会话浏览器 |
| [内网快传](/projects/desktop/lan-share) | Python + PyInstaller | 同一 WiFi 下电脑手机互传文件，不走微信 |
| [字幕高亮](/projects/desktop/subtitle-karaoke) | Python + faster-whisper + ffmpeg | 给短视频加卡拉OK式逐词高亮字幕 |

相关笔记：[Python](/backend/python)

## 本机部署的共性

这几个工具都不是「双击运行」就算完，都做了常驻：

- **开机自启走 Windows 计划任务**（登录时触发），不是启动文件夹——计划任务能配重试和条件。
- **单实例锁**：重复启动时不是再起一个进程，而是把已有窗口亮出来。
- **重启前查忙闲**：字幕高亮的 `start.ps1 -Restart` 会先查 `/api/metrics`，
  有任务在跑就拒绝重启。这个思路和服务器上的
  [safe_restart 空闲闸门](/projects/production/)是同一个——
  检查和动作必须在同一个条件里，中间不留窗口。
