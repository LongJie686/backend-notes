# SNMP 与 iperf3 网络监控

## 核心结论

1. **SNMP 是网络设备监控的标准协议** -- NMS（网络管理系统）通过 SNMP 采集设备状态
2. **iperf3 是网络性能测量的事实标准** -- 测量带宽、延迟、丢包率、抖动
3. **SNMPv3 是生产环境唯一选择** -- v1/v2c 社区字符串明文传输，v3 支持认证+加密
4. **OID 是 SNMP 的核心概念** -- 每个监控指标对应一个唯一的对象标识符
5. **健康指数 = 加权评分模型** -- 丢包率 + 延迟 + 抖动的分段评分加权平均

---

## 一、SNMP 协议基础

### 1. SNMP 是什么？

SNMP（Simple Network Management Protocol），简单网络管理协议。用于网络设备（路由器、交换机、服务器）的监控和管理。

```
┌──────────────┐     SNMP GET/SET      ┌──────────────┐
│   NMS 管理站  │ ◄──────────────────► │  Agent 代理   │
│  (Zabbix等)   │     UDP 161/162      │  (设备端)     │
└──────────────┘                       └──────────────┘
```

**核心组件：**
- **NMS（Network Management Station）**：管理站，发起请求
- **Agent**：代理进程，运行在被管设备上，响应请求
- **MIB（Management Information Base）**：管理信息库，定义可管理的对象
- **OID（Object Identifier）**：对象标识符，唯一标识 MIB 中的每个节点

### 2. SNMP 版本对比

| 维度 | SNMPv1 | SNMPv2c | SNMPv3 |
|------|--------|---------|--------|
| 认证 | 社区字符串（明文） | 社区字符串（明文） | USM（用户名+密码） |
| 加密 | 无 | 无 | AES/DES |
| 安全性 | 极低 | 低 | 高 |
| 批量获取 | 不支持 | 支持 GetBulk | 支持 GetBulk |
| 适用场景 | 测试/内网 | 内网监控 | **生产环境** |

### 3. SNMPv3 安全级别

| 安全级别 | 认证 | 加密 | 说明 |
|----------|------|------|------|
| noAuthNoPriv | 无 | 无 | 仅用户名 |
| authNoPriv | SHA/MD5 | 无 | 认证但不加密 |
| authPriv | SHA/MD5 | AES/DES | 认证+加密（推荐） |

**生产环境推荐：** authPriv + SHA + AES-128

### 4. OID 结构

```
1.3.6.1.4.1.50000.1.1.1
│ │ │ │ │   │    │ │ └─ 链路索引（link1）
│ │ │ │ │   │    │ └─── 指标类型（1=健康指数）
│ │ │ │ │   │    └───── linkmonObjects
│ │ │ │ │   └────────── 企业号（50000 = 自定义）
│ │ │ │ └────────────── enterprises
│ │ │ └──────────────── dod
│ │ └────────────────── internet
│ └────────────────---- org
└────────────────------ iso

常用系统 OID：
1.3.6.1.2.1.1.1.0    sysDescr         系统描述
1.3.6.1.2.1.1.3.0    sysUpTime        运行时间
1.3.6.1.2.1.2.2.1.10 ifInOctets       入站流量（字节）
1.3.6.1.2.1.2.2.1.16 ifOutOctets      出站流量（字节）
1.3.6.1.2.1.25.3.3.1 hrProcessorLoad  CPU 使用率
```

### 5. SNMP 操作类型

| 操作 | 说明 | 用途 |
|------|------|------|
| GET | 获取单个 OID 的值 | 查询特定指标 |
| GETNEXT | 获取下一个 OID 的值 | 遍历 MIB 树 |
| GETBULK | 批量获取（v2c/v3） | 高效遍历大量数据 |
| SET | 设置 OID 的值 | 配置设备参数 |
| TRAP | Agent 主动上报事件 | 告警通知 |
| INFORM | 需确认的 TRAP（v2c/v3） | 可靠告警 |

---

## 二、iperf3 网络性能测试

### 1. iperf3 是什么？

iperf3 是网络带宽和性能测试工具，支持 TCP/UDP 协议，可测量带宽、延迟、丢包率和抖动。

```bash
# 服务端（被测目标）
iperf3 -s

# 客户端（发起测试）
iperf3 -c 192.168.1.100          # TCP 带宽测试
iperf3 -c 192.168.1.100 -u       # UDP 测试（测丢包+抖动）
iperf3 -c 192.168.1.100 -J       # JSON 格式输出
```

### 2. 测量指标

| 指标 | 协议 | 说明 | 单位 |
|------|------|------|------|
| 带宽 | TCP | 吞吐量 | Mbps |
| 丢包率 | UDP | 丢失数据包比例 | % |
| 抖动 | UDP | 延迟变化量 | ms |
| 延迟 | ICMP/Ping | 往返时间（RTT） | ms |

### 3. TCP 带宽测试

```bash
# 基本测试（默认 10 秒）
iperf3 -c 192.168.1.100

# 指定时长和端口
iperf3 -c 192.168.1.100 -t 30 -p 5201

# 指定带宽目标
iperf3 -c 192.168.1.100 -b 100M

# 多线程测试
iperf3 -c 192.168.1.100 -P 4
```

**TCP 测量原理：** 通过调整发送窗口大小，逐渐增加发送速率直到链路饱和，最终稳定速率即为可用带宽。

### 4. UDP 丢包/抖动测试

```bash
# UDP 测试（指定发送速率）
iperf3 -c 192.168.1.100 -u -b 10M -t 3

# 输出关键信息：
# [ ID] Interval       Transfer     Bitrate    Jitter    Lost/Total
# [  5] 0.00-3.00 sec  3.57 MBytes  10.0 Mbps  2.345 ms  12/2512 (0.5%)
```

**UDP 测量原理：** 以固定速率发送数据包，接收端统计丢失的包数和到达时间差，计算出丢包率和抖动。

### 5. Python 调用 iperf3

```python
import subprocess
import json

def measure_bandwidth(server: str, port: int = 5201, duration: int = 10) -> float:
    """TCP 模式测量带宽（Mbps）"""
    cmd = ["iperf3", "-c", server, "-p", str(port), "-t", str(duration), "-J"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=duration + 10)

    if result.returncode != 0:
        raise RuntimeError(f"iperf3 failed: {result.stderr}")

    data = json.loads(result.stdout)
    bps = data["end"]["sum_sent"]["bits_per_second"]
    return bps / 1e6  # 转 Mbps

def measure_udp_metrics(server: str, bandwidth: str = "10M", duration: int = 3) -> dict:
    """UDP 模式测量丢包率和抖动"""
    cmd = ["iperf3", "-c", server, "-u", "-b", bandwidth, "-t", str(duration), "-J"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=duration + 8)

    data = json.loads(result.stdout)
    udp = data["end"]["streams"][0]["udp"]

    return {
        "loss_rate": udp.get("lost_percent", 0) / 100.0,
        "jitter_ms": udp.get("jitter_ms", 0.0),
        "lost_packets": udp.get("lost_packets", 0),
        "total_packets": udp.get("packets", 0),
    }
```

---

## 三、健康指数算法

### 1. 加权评分模型

网络链路健康指数采用**分段评分 + 加权平均**方法：

```
健康指数 = 丢包评分 x 30% + 延迟评分 x 40% + 抖动评分 x 30%
```

### 2. 分段评分标准（微波链路示例）

| 指标 | 优秀(100分) | 良好(90分) | 可接受(70分) | 较差(40分) |
|------|------------|-----------|-------------|-----------|
| 丢包率 | <0.1% | 0.1-0.5% | 0.5-2% | 2-5% |
| 延迟 | <20ms | 20-50ms | 50-100ms | >100ms |
| 抖动 | <5ms | 5-20ms | 20-50ms | >50ms |

### 3. 标准化评分公式

```python
import math

def calculate_health(link_type, loss_rate, latency_ms, jitter_ms):
    """
    计算链路健康指数

    丢包率：指数衰减模型 Score = 100 * e^(-k * loss)
    延迟/抖动：线性模型 Score = 100 * (1 - value / max_value)
    """
    config = SCORING_CONFIG.get(link_type, SCORING_CONFIG["generic"])

    # 1. 丢包率评分（指数衰减）
    k = config["loss_decay_factor"]  # 衰减系数，典型值30
    loss_score = 100 * math.exp(-k * loss_rate)

    # 2. 延迟评分（线性）
    if latency_ms <= config["latency_min_full"]:
        latency_score = 100
    else:
        latency_score = max(0, 100 * (1 - (latency_ms - config["latency_min_full"])
                                       / (config["latency_max"] - config["latency_min_full"])))

    # 3. 抖动评分（线性）
    if jitter_ms <= config["jitter_min_full"]:
        jitter_score = 100
    else:
        jitter_score = max(0, 100 * (1 - (jitter_ms - config["jitter_min_full"])
                                     / (config["jitter_max"] - config["jitter_min_full"])))

    # 4. 加权平均
    health = loss_score * 0.3 + latency_score * 0.4 + jitter_score * 0.3
    return round(max(0, min(100, health)), 1)
```

### 4. 不同链路类型的参数差异

| 链路类型 | 典型延迟 | latency_max | jitter_max | 适用场景 |
|----------|---------|-------------|------------|---------|
| microwave | 20-50ms | 300ms | 50ms | 城市骨干网、基站回传 |
| terahertz | <1ms | 20ms | 10ms | 短距离高速、6G 研究 |
| satellite | 100-600ms | 1000ms | 200ms | 远洋通信、偏远地区 |
| generic | 20-50ms | 300ms | 50ms | 通用（默认） |

### 5. 健康指数分级

| 等级 | 分数范围 | 状态 | 说明 |
|------|---------|------|------|
| Excellent | >= 85 | 绿色 | 链路质量优秀 |
| Good | 70-84 | 橙色 | 链路质量良好 |
| Warning | 60-69 | 红色 | 需要关注 |
| Critical | < 60 | 深红 | 需要立即处理 |

---

## 四、SNMP Agent 实现（Python）

### 1. pysnmp 核心 API

```python
from pysnmp.entity import engine, config
from pysnmp.entity.rfc3413 import cmdrsp, context
from pysnmp.carrier.asyncio.dgram import udp
from pysnmp.proto.rfc1902 import Integer32

# 创建 SNMP 引擎
snmpEngine = engine.SnmpEngine()

# 配置传输（UDP）
config.addTransport(
    snmpEngine,
    udp.domainName,
    udp.UdpTransport().openServerMode(('0.0.0.0', 1610))
)

# 配置 v2c 社区字符串
config.addV1System(snmpEngine, 'my-area', 'public')

# 配置 v3 用户（SHA + AES-128）
config.addV3User(
    snmpEngine,
    userName='admin',
    authProtocol=config.usmHMACSHAAuthProtocol,
    authKey='authpass123',
    privProtocol=config.usmAesCfb128Protocol,
    privKey='privpass123'
)

# 注册命令响应器
snmpContext = context.SnmpContext(snmpEngine)
cmdrsp.GetCommandResponder(snmpEngine, snmpContext)
cmdrsp.NextCommandResponder(snmpEngine, snmpContext)
cmdrsp.SetCommandResponder(snmpEngine, snmpContext)

# 启动
snmpEngine.openDispatcher()
```

### 2. 自定义 MIB 控制器

```python
from pysnmp.smi import instrum
from pysnmp.smi.exval import noSuchInstance

class CustomMibController(instrum.MibInstrumController):
    """自定义 OID 查询控制器"""

    def readVars(self, varBinds, acInfo=(None, None)):
        """处理 GET 请求"""
        result = []
        for oid, val in varBinds:
            oid_str = '.'.join(str(x) for x in tuple(oid))

            if oid_str.startswith('1.3.6.1.4.1.50000.1.1.'):
                # 健康指数
                link_id = f"link{oid_str.split('.')[-1]}"
                metric = metrics.get(link_id)
                value = int(metric.health_index) if metric else 0
                result.append((oid, Integer32(value)))
            else:
                result.append((oid, noSuchInstance))

        return result

    def writeVars(self, varBinds, acInfo=(None, None)):
        """处理 SET 请求"""
        result = []
        for oid, val in varBinds:
            oid_str = '.'.join(str(x) for x in tuple(oid))
            # 只允许写入配置类 OID
            if oid_str.startswith('1.3.6.1.4.1.50000.2.'):
                save_config(oid_str, int(val))
                result.append((oid, val))
            else:
                result.append((oid, noSuchInstance))
        return result
```

### 3. MIB 文件定义

```asn1
LINKMON-MIB DEFINITIONS ::= BEGIN

IMPORTS
    MODULE-IDENTITY, OBJECT-TYPE, Integer32
        FROM SNMPv2-SMI;

linkmon MODULE-IDENTITY
    LAST-UPDATED "202511100000Z"
    ORGANIZATION "LinkMon Project"
    DESCRIPTION "Link Health Monitoring MIB"
    ::= { enterprises 50000 }

linkmonObjects OBJECT IDENTIFIER ::= { linkmon 1 }

-- 1.3.6.1.4.1.50000.1.1.{index} 健康指数
linkHealthIndex OBJECT-TYPE
    SYNTAX      Integer32 (0..100)
    MAX-ACCESS  read-only
    STATUS      current
    DESCRIPTION "Link health index (0-100)"
    ::= { linkmonObjects 1 }

-- 1.3.6.1.4.1.50000.1.2.{index} 带宽
linkBandwidthMbps OBJECT-TYPE
    SYNTAX      Integer32
    MAX-ACCESS  read-only
    STATUS      current
    DESCRIPTION "Bandwidth in Mbps"
    ::= { linkmonObjects 2 }

END
```

### 4. TRAP 告警发送

```python
from pysnmp.entity.rfc3413 import ntforg
from pysnmp.proto import rfc1902

def send_trap(snmpEngine, trap_oid, var_binds=None):
    """发送 SNMP TRAP 告警"""
    ntfOrg = ntforg.NotificationOriginator()

    ntfOrg.sendVarBinds(
        snmpEngine,
        'trap-target',
        None, '',
        [
            (rfc1902.ObjectName('1.3.6.1.2.1.1.3.0'), rfc1902.TimeTicks(0)),
            (rfc1902.ObjectName('1.3.6.1.6.3.1.1.4.1.0'), rfc1902.ObjectName(trap_oid))
        ] + (var_binds or [])
    )
```

---

## 五、链路监控系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    链路健康监测系统                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  config.yaml（链路配置）                                     │
│      ↓                                                      │
│  LinkMonitor（监控引擎）                                     │
│      ├─ Ping        → 延迟（ms）                             │
│      ├─ iperf3 TCP  → 带宽（Mbps）                           │
│      └─ iperf3 UDP  → 丢包率 + 抖动                         │
│      ↓                                                      │
│  健康指数计算（分段评分 + 加权平均）                          │
│      ↓                                                      │
│  ┌──────────┬──────────────┬──────────────┐                 │
│  │ SQLite   │ SNMP Agent   │ AlertManager │                 │
│  │ 数据存储  │ 对外暴露指标  │ 告警/TRAP    │                 │
│  └──────────┴──────────────┴──────────────┘                 │
│      ↓              ↓              ↓                         │
│  历史回放      Zabbix 采集    邮件/Webhook                    │
│                                                             │
│  ┌──────────────────────────────────────┐                   │
│  │         Web 可视化看板（Vue3）         │                   │
│  └──────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**测量流程（三步走）：**

1. **Ping 测延迟**（最快，2-3 秒）→ 立即更新延迟数据
2. **UDP 测丢包+抖动**（3-8 秒）→ 计算健康指数
3. **TCP 测带宽**（5-20 秒）→ 完成所有指标

---

## 六、SNMP 测试命令

```bash
# v2c 查询
snmpget -v2c -c public localhost:1610 1.3.6.1.4.1.50000.1.1.1

# v2c 遍历
snmpwalk -v2c -c public localhost:1610 1.3.6.1.4.1.50000

# v3 查询（authPriv）
snmpget -v3 -u admin -l authPriv -a SHA -A authpass123 -x AES -X privpass123 \
    localhost:1610 1.3.6.1.4.1.50000.1.1.1

# v3 遍历
snmpwalk -v3 -u admin -l authPriv -a SHA -A authpass123 -x AES -X privpass123 \
    localhost:1610 1.3.6.1.4.1.50000

# SET 操作（修改配置）
snmpset -v2c -c public localhost:1610 1.3.6.1.4.1.50000.2.1.1 i 30
```

---

## 七、常见面试题

### Q1：SNMP v1/v2c/v3 的主要区别？

v1/v2c 用明文社区字符串认证，无加密；v3 支持 USM 用户认证（SHA/MD5）和加密（AES/DES），是生产环境唯一安全选择。

### Q2：iperf3 TCP 和 UDP 模式分别测什么？

TCP 模式测**带宽**（吞吐量），UDP 模式测**丢包率和抖动**。两者测的指标不同，需要分别运行。

### Q3：OID 是什么？怎么自定义？

OID（Object Identifier）是 MIB 树中的唯一标识符，类似文件路径。自定义 OID 使用企业号 `1.3.6.1.4.1.{企业号}` 下的子树。IANA 分配的企业号以外的范围可自行使用（如 50000）。

### Q4：TRAP 和 INFORM 的区别？

TRAP 是单向通知（不确认），INFORM 需要接收方确认。INFORM 更可靠但开销更大。

### Q5：网络链路健康指数怎么设计？

采用**分段评分 + 加权平均**：每个指标独立评分（0-100），然后加权平均。不同链路类型（微波、卫星、太赫兹）使用不同的评分阈值，反映物理特性差异。
