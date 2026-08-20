# 内网快传

同一 WiFi 下电脑和手机互传文件。起一个本地 HTTP 服务，手机扫码或输地址就能收发，
不经过微信、不压缩、不限大小。

- 本地：`D:\Aproject\lan-share\`（未入 git）
- 技术栈：Python（`server.py` + `netutil.py`），PyInstaller 打包成 `内网快传.exe`
- 入口：`lan_share.pyw`（无控制台窗口）、`启动内网快传.bat`

## 两个小技巧

**取本机局域网出口 IP**，不实际发包：

```python
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("223.5.5.5", 80))   # UDP connect 不发包，只让内核选路由
return s.getsockname()[0]
```

比遍历网卡可靠——多网卡（有线 + WiFi + 虚拟网卡 + WSL 的 vEthernet）的机器上，
遍历很难判断哪个才是手机能访问到的那个地址。UDP connect 直接让内核按路由表选，
选出来的就是对外那张网卡。异常时兜底返回 `127.0.0.1`。

**端口范围固定在 18888-18897**（`PORT_START` + `PORT_TRIES = 10`）。
固定范围是为了防火墙规则能按段放行——如果随机取空闲端口，
每换一个端口就要重新弹一次 Windows 防火墙授权框。

## 为什么不用现成方案

微信传文件会压缩图片和视频；QQ 要登录；U 盘要插拔；
局域网共享文件夹（SMB）在 Windows 家庭版上配置麻烦且手机端支持差。
HTTP 是手机浏览器唯一零配置就能用的协议。

相关笔记：[网络基础](/backend/network)、[Python](/backend/python)
