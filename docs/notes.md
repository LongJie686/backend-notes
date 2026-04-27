---
layout: page
---

<style>
.notes-container {
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 24px 64px;
}
.notes-title {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 8px;
}
.notes-subtitle {
  font-size: 1.1rem;
  color: var(--vp-c-text-2);
  margin-bottom: 40px;
  line-height: 1.6;
}
.notes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
@media (max-width: 640px) {
  .notes-grid { grid-template-columns: 1fr; }
}
.notes-card {
  display: block;
  padding: 24px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
}
.notes-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  transform: translateY(-2px);
}
.notes-card h3 {
  margin: 0 0 8px;
  font-size: 1.15rem;
  font-weight: 600;
}
.notes-card p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
.notes-card .tag {
  display: inline-block;
  margin-top: 12px;
  font-size: 0.8rem;
  color: var(--vp-c-brand);
}
</style>

<div class="notes-container">

<h1 class="notes-title">学习笔记</h1>

<p class="notes-subtitle">
  6 个系列，系统性覆盖后端开发核心知识<br>
  每个系列包含理论讲解、代码实战、面试题与练习
</p>

<div class="notes-grid">

  <a class="notes-card" href="/backend-notes/database/mysql-notes/lecture-1">
    <h3>MySQL 学习笔记</h3>
    <p>表设计、索引原理、事务与隔离级别、MVCC、锁机制、慢查询优化、主从复制、分库分表、高可用，13 讲完整覆盖 MySQL 核心知识</p>
    <span class="tag">13 讲</span>
  </a>

  <a class="notes-card" href="/backend-notes/ai-app/multi-agent/lecture-1">
    <h3>多智能体设计实战</h3>
    <p>多智能体基础认知、角色设计与任务编排、RAG 知识管理、工具调用与 CrewAI 实战、Prompt 精调、可观测性与调试、安全护栏</p>
    <span class="tag">9 讲 + 面试题</span>
  </a>

  <a class="notes-card" href="/backend-notes/ai-app/llm-dev/lecture-1">
    <h3>大模型应用开发</h3>
    <p>大模型基础与 API、Prompt 工程、RAG 系统设计、Agent 与工具调用、多轮对话实战、模型微调（LoRA/QLoRA）、部署与运维、安全与进阶</p>
    <span class="tag">8 讲 + 面试题</span>
  </a>

  <a class="notes-card" href="/backend-notes/architecture/lecture-1">
    <h3>架构设计</h3>
    <p>架构定义与复杂度、设计三原则与四步法、高性能架构模式、高可用架构模式（异地多活与微服务拆分）、实战案例分析、面试题总结</p>
    <span class="tag">8 讲</span>
  </a>

  <a class="notes-card" href="/backend-notes/high-concurrency/lecture-1">
    <h3>高并发系统设计</h3>
    <p>基础认知与架构演进、缓存设计与防护、消息队列（Kafka/RocketMQ）、分库分表、高可用设计、服务治理、秒杀系统全链路设计</p>
    <span class="tag">6 讲</span>
  </a>

  <a class="notes-card" href="/backend-notes/microservice/lecture-1">
    <h3>微服务</h3>
    <p>架构认知、服务通信与 gRPC、注册发现与配置中心、限流熔断降级、API 网关、分布式数据一致性、可观测性、容器化与 CI/CD、Service Mesh</p>
    <span class="tag">10 讲</span>
  </a>

</div>

</div>
