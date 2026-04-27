---
layout: page
---

<style>
.home-container {
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 24px 64px;
}
.home-title {
  font-size: 2.4rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 8px;
}
.home-subtitle {
  font-size: 1.1rem;
  color: var(--vp-c-text-2);
  margin-bottom: 40px;
  line-height: 1.6;
}
.section-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 48px;
}
@media (max-width: 640px) {
  .section-grid { grid-template-columns: 1fr; }
}
.section-card {
  display: block;
  padding: 20px 24px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.section-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}
.section-card h3 {
  margin: 0 0 6px;
  font-size: 1.1rem;
  font-weight: 600;
}
.section-card p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
.section-card .tag {
  display: inline-block;
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--vp-c-brand);
}
</style>

<div class="home-container">

<h1 class="home-title">LongJie 的知识库</h1>

<p class="home-subtitle">
  后端开发 / 数据库 / AI 应用 / 微服务 / 架构设计 / 高并发系统设计<br>
  系统性学习笔记，覆盖面试高频考点与实战经验
</p>

<div class="section-grid">

  <a class="section-card" href="/backend-notes/backend/python">
    <h3>后端</h3>
    <p>Python、FastAPI、Django、Flask、WebSocket、网络基础、RBAC/JWT 权限系统</p>
    <span class="tag">8 篇文章</span>
  </a>

  <a class="section-card" href="/backend-notes/database/mysql">
    <h3>数据库</h3>
    <p>MySQL 学习笔记（表设计/索引/事务/MVCC/锁/分库分表）、Redis、PostgreSQL、SQLite</p>
    <span class="tag">13+ 篇文章</span>
  </a>

  <a class="section-card" href="/backend-notes/ai-app/llm-dev/lecture-1">
    <h3>AI</h3>
    <p>大模型应用开发、多智能体设计实战、Agent 架构分析、MCP 协议、Text-to-SQL、语音交互</p>
    <span class="tag">20+ 篇文章</span>
  </a>

  <a class="section-card" href="/backend-notes/microservice/">
    <h3>微服务</h3>
    <p>架构认知、gRPC 通信、注册发现与配置中心、限流熔断降级、API 网关、分布式事务</p>
    <span class="tag">10 篇文章</span>
  </a>

  <a class="section-card" href="/backend-notes/architecture/">
    <h3>架构设计</h3>
    <p>架构复杂度分析、高性能/高可用模式、实战案例分析、面试题总结</p>
    <span class="tag">8 篇文章</span>
  </a>

  <a class="section-card" href="/backend-notes/high-concurrency/">
    <h3>高并发系统设计</h3>
    <p>缓存设计、消息队列、分库分表、限流熔断降级、服务治理、秒杀系统全链路设计</p>
    <span class="tag">7 篇文章</span>
  </a>

</div>

</div>
