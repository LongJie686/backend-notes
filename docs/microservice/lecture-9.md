# 第9讲：Service Mesh（服务网格）

## 核心结论（5条必记）

1. **Service Mesh将服务治理下沉** -- 服务间通信的复杂度从业务代码剥离到Sidecar代理，业务代码更纯粹
2. **Sidecar模式是Service Mesh的核心** -- 每个服务实例旁部署一个代理，拦截所有进出流量，无侵入实现治理
3. **Istio由数据面和控制面组成** -- Envoy做数据面代理流量，Istiod做控制面统一配置下发
4. **Service Mesh解决了SDK治理的痛点** -- 多语言一致性、功能快速迭代、治理逻辑统一
5. **Service Mesh有代价** -- 增加运维复杂度、性能损耗、延迟增加，中小团队慎重选择

---

## 一、什么是Service Mesh

### 传统SDK治理的问题

**每个服务需要集成SDK：**
```
用户服务 -> [RPC SDK + 服务发现SDK + 限流SDK + 熔断SDK + 链路追踪SDK]
订单服务 -> [RPC SDK + 服务发现SDK + 限流SDK + 熔断SDK + 链路追踪SDK]
```

**问题：**
- 多语言需要多套SDK（Go、Java、Python...）
- SDK升级需要所有服务重新部署
- 治理逻辑分散在各个服务中
- 业务代码和治理逻辑耦合

### Service Mesh架构

**Mesh模式：**
```
用户服务 -> Sidecar代理 <-> Sidecar代理 <- 订单服务
         (Envoy)               (Envoy)
```

**核心思想：**
- 服务间通信全部通过Sidecar代理
- 业务代码只关心业务逻辑
- 治理功能全部在Sidecar实现

---

## 二、Sidecar模式

### Sidecar是什么

**定义：**
- 和业务容器部署在同一个Pod中
- 拦截所有进出流量
- 对业务服务透明

**部署模式：**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: user-service
spec:
  containers:
  - name: user-service  # 业务容器
    image: user-service:1.0.0
  - name: istio-proxy   # Sidecar容器
    image: istio/proxyv2:1.15.0
```

### 流量拦截

**流量路径：**
```
服务A调用服务B：
  1. 服务A发送请求到localhost
  2. iptables规则拦截流量
  3. 转发到Sidecar（Envoy）
  4. Sidecar处理：限流、熔断、路由
  5. Sidecar转发到服务B的Sidecar
  6. 服务B的Sidecar处理后转发给服务B
```

**透明劫持：**
```bash
# iptables规则
iptables -t nat -A PREROUTING -p tcp -j ISTIO_REDIRECT
```

---

## 三、Istio架构

### 架构组成

```
控制面（Istiod）：
  - Pilot：服务发现、流量管理
  - Citadel：证书签发、身份认证
  - Galley：配置验证、分发

数据面（Envoy）：
  - Sidecar代理
  - 流量拦截和转发
  - 治理策略执行
```

### 核心组件

**Pilot（流量管理）：**
- 服务发现：从注册中心获取服务信息
- 流量规则：路由、超时、重试、熔断
- 配置下发：将配置推送给Envoy

**Citadel（安全）：**
- 身份认证：为每个服务分配身份
- 证书签发：自动签发和轮换证书
- mTLS：服务间加密通信

**Galley（配置）：**
- 配置验证：检查配置合法性
- 配置分发：将配置推送到各组件
- 配置格式：支持多种配置格式

---

## 四、Istio核心功能

### 流量管理

**VirtualService（路由规则）：**
```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: user-service
spec:
  hosts:
  - user-service
  http:
  - match:
    - headers:
        version:
          exact: v2
    route:
    - destination:
        host: user-service
        subset: v2
  - route:
    - destination:
        host: user-service
        subset: v1
      weight: 90
    - destination:
        host: user-service
        subset: v2
      weight: 10
```

**DestinationRule（服务子集）：**
```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: user-service
spec:
  host: user-service
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

**功能：**
- 灰度发布：按权重分配流量
- 金丝雀发布：小流量验证
- 蓝绿发布：两套环境切换
- 流量镜像：复制流量到测试环境

### 安全

**mTLS（双向TLS）：**
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
spec:
  mtls:
    mode: STRICT  # 强制mTLS
```

**功能：**
- 服务间加密通信
- 身份认证和授权
- 基于角色的访问控制

### 可观测性

**Metrics（指标）：**
- 自动收集黄金信号（延迟、流量、错误、饱和度）
- 支持Prometheus抓取

**Logging（日志）：**
- 访问日志自动记录
- 支持自定义日志格式

**Tracing（追踪）：**
- 自动生成TraceID
- 集成Jaeger/Zipkin

---

## 五、Service Mesh vs SDK治理

| 维度 | SDK治理 | Service Mesh |
|------|---------|-------------|
| 语言绑定 | 每种语言需要独立SDK | 语言无关，所有语言统一 |
| 升级成本 | 需要所有服务重新部署 | 升级Mesh即可 |
| 功能迭代 | 慢，需要各服务配合 | 快速，控制面统一配置 |
| 业务侵入 | 业务代码包含治理逻辑 | 业务代码纯粹 |
| 运维复杂度 | 低 | 高，需要运维Mesh |
| 性能损耗 | 低 | 中（多一跳代理） |
| 延迟 | 低 | 中等增加 |

---

## 六、Service Mesh的代价

### 性能损耗

**增加的延迟：**
```
无Mesh: 服务A -> 服务B (5ms)
有Mesh: 服务A -> Envoy -> Envoy -> 服务B (8ms)
```

**资源占用：**
- 每个Pod额外运行一个Envoy
- 内存占用约50-100MB
- CPU占用约5-10%

### 运维复杂度

**新增组件：**
- Istio控制面（Istiod）
- Envoy数据面
- 监控和告警

**配置复杂：**
- VirtualService、DestinationRule等
- 需要理解Istio配置模型
- 故障排查难度增加

### 学习曲线

**需要掌握：**
- Kubernetes
- Istio配置
- Envoy原理
- 网络和协议

---

## 七、适用场景

### 适合上Mesh的场景

**团队规模：**
- 多个团队协作
- 多技术栈（Go、Java、Python...）
- 微服务数量>20

**业务需求：**
- 复杂的流量管理（灰度、蓝绿、金丝雀）
- 严格的安全要求（mTLS、细粒度权限）
- 统一的可观测性

**技术能力：**
- 团队有K8s运维经验
- 有专门的平台团队
- 能承担额外的复杂度

### 不适合上Mesh的场景

**团队规模：**
- 小团队（<10人）
- 单一技术栈
- 微服务数量<10

**业务需求：**
- 流量管理简单
- 安全要求不高
- 快速迭代，没时间折腾

**技术能力：**
- K8s经验不足
- 没有专门的平台团队
- 更关注业务而非基础设施

---

## 八、面试高频题

### 1. 什么是Service Mesh？
将服务治理逻辑从业务代码剥离到Sidecar代理 -> 业务代码纯粹，治理功能统一 -> 多语言一致性，功能快速迭代 -> 但增加运维复杂度和性能损耗

### 2. Sidecar模式是什么？
每个服务实例旁部署一个代理容器 -> 拦截所有进出流量 -> 对业务服务透明 -> 通过iptables劫持流量到Sidecar

### 3. Istio的核心组件有哪些？
控制面：Pilot（流量管理）、Citadel（安全）、Galley（配置） -> 数据面：Envoy代理 -> 控制面统一配置，数据面执行策略

### 4. Service Mesh和SDK治理的区别？
SDK需要多语言实现，升级需要所有服务配合 -> Mesh语言无关，升级Mesh即可 -> SDK性能好但业务侵入 -> Mesh有性能损耗但业务纯粹

---

## 练习题

- [ ] 练习1：本地搭建Istio环境
- [ ] 练习2：实现灰度发布（v1/v2版本按权重分配流量）
- [ ] 练习3：配置mTLS，实现服务间加密通信
- [ ] 练习4：对比有Mesh和无Mesh的延迟差异
- [ ] 练习5：分析是否适合在当前团队引入Service Mesh

---

## 下讲预告

第10讲将总结微服务面试高频问题和项目实战复盘。
