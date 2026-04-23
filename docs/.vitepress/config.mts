import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "LongJie 的知识库",
  description: '后端 / 推荐系统 / AI',
  lang: 'zh-CN',
  base: '/backend-notes/',

  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: '首页', link: '/ai-app/llm-dev/' },
      { text: '后端', link: '/backend/python' },
      { text: '数据库', link: '/database/mysql' },
      { text: 'AI', link: '/ai-app/llm' },
      { text: '微服务', link: '/microservice/' },
      { text: '架构设计', link: '/architecture/' },
      { text: '高并发', link: '/high-concurrency/' }
    ],

    sidebar: [
      {
        text: '后端',
        collapsed: true,
        items: [
          { text: 'Python', link: '/backend/python' },
          { text: 'FastAPI', link: '/backend/fastapi' },
          { text: 'Django', link: '/backend/django' },
          { text: 'Flask', link: '/backend/flask' },
          { text: 'WebSocket', link: '/backend/websocket' },
          { text: '网络基础', link: '/backend/network' },
          { text: 'RBAC 权限系统', link: '/backend/rbac' },
          { text: 'JWT 权限管理', link: '/backend/jwt' }
        ]
      },
      {
        text: '数据库',
        collapsed: true,
        items: [
          { text: 'MySQL', link: '/database/mysql' },
          {
            text: 'MySQL 学习笔记',
            collapsed: false,
            items: [
              { text: 'L1: 表设计', link: '/database/mysql-notes/lecture-1' },
              { text: 'L2: 索引', link: '/database/mysql-notes/lecture-2' },
              { text: 'L3: 事务', link: '/database/mysql-notes/lecture-3' },
              { text: 'L4: 隔离级别', link: '/database/mysql-notes/lecture-4' },
              { text: 'L5: MVCC', link: '/database/mysql-notes/lecture-5' },
              { text: 'L6: 锁机制', link: '/database/mysql-notes/lecture-6' },
              { text: 'L7: 慢查询优化', link: '/database/mysql-notes/lecture-7' },
              { text: 'L8: 主从复制与读写分离', link: '/database/mysql-notes/lecture-8' },
              { text: 'L9: 分库分表', link: '/database/mysql-notes/lecture-9' },
              { text: 'L10: 高可用与备份恢复', link: '/database/mysql-notes/lecture-10' },
              { text: 'L11: 面试题-基础/索引/事务', link: '/database/mysql-notes/lecture-11' },
              { text: 'L12: 面试题-锁与并发/调优', link: '/database/mysql-notes/lecture-12' },
              { text: 'L13: 面试题-主从复制/分库分表', link: '/database/mysql-notes/lecture-13' }
            ]
          },
          { text: 'Redis', link: '/database/redis' },
          { text: 'PostgreSQL', link: '/database/postgres' },
          { text: 'SQLite', link: '/database/sqlite' },
          { text: 'pgvector', link: '/database/pgvector' }
        ]
      },
      {
        text: 'AI 应用',
        collapsed: true,
        items: [
          { text: 'LLM 概述', link: '/ai-app/llm' },
          {
            text: 'Agent 架构分析',
            collapsed: true,
            items: [
              { text: 'Claude Code 学习笔记', link: '/ai-app/agent-analysis/learn-claude-code' },
              { text: 'NanoClaw 项目解析', link: '/ai-app/agent-analysis/nanoclaw' },
              { text: 'Hermes Agent 框架分析', link: '/ai-app/agent-analysis/hermes-agent' }
            ]
          },
          {
            text: 'Text-to-SQL',
            collapsed: true,
            items: [
              { text: '概述', link: '/ai-app/text-to-sql/' }
            ]
          },
          {
            text: 'MCP 协议',
            collapsed: true,
            items: [
              { text: '概述', link: '/ai-app/mcp/' }
            ]
          },
          {
            text: '语音交互',
            collapsed: true,
            items: [
              { text: 'STT/TTS 概述', link: '/ai-app/voice-interaction/' }
            ]
          },
          {
            text: 'Skills 技能系统',
            collapsed: true,
            items: [
              { text: '概述', link: '/ai-app/skills/' }
            ]
          },
          {
            text: '多智能体设计实战',
            collapsed: false,
            items: [
              { text: '学习路线', link: '/ai-app/multi-agent/' },
              { text: 'L1: 多智能体基础认知', link: '/ai-app/multi-agent/lecture-1' },
              { text: 'L2: 角色设计与任务编排', link: '/ai-app/multi-agent/lecture-2' },
              { text: 'L3: RAG 知识管理实战', link: '/ai-app/multi-agent/lecture-3' },
              { text: 'L4: 工具调用与 CrewAI 实战', link: '/ai-app/multi-agent/lecture-4' },
              { text: 'L5: Prompt 精调与模型优化', link: '/ai-app/multi-agent/lecture-5' },
              { text: 'L6: 可观测性与调试', link: '/ai-app/multi-agent/lecture-6' },
              { text: 'L7: 安全护栏与治理', link: '/ai-app/multi-agent/lecture-7' },
              { text: 'L8: 生产环境部署', link: '/ai-app/multi-agent/lecture-8' },
              { text: 'L9: 数据飞轮与迭代', link: '/ai-app/multi-agent/lecture-9' },
              { text: '常见坑点', link: '/ai-app/multi-agent/pitfalls' },
              { text: '面试高频问题', link: '/ai-app/multi-agent/interview' }
            ]
          },
          {
            text: '大模型应用开发',
            collapsed: false,
            items: [
              { text: '学习路线', link: '/ai-app/llm-dev/' },
              { text: 'L1: 大模型基础与 API', link: '/ai-app/llm-dev/lecture-1' },
              { text: 'L2: Prompt 工程', link: '/ai-app/llm-dev/lecture-2' },
              { text: 'L3: RAG 系统设计', link: '/ai-app/llm-dev/lecture-3' },
              { text: 'L4: Agent 与工具调用', link: '/ai-app/llm-dev/lecture-4' },
              { text: 'L5: 多轮对话实战', link: '/ai-app/llm-dev/lecture-5' },
              { text: 'L6: 模型微调', link: '/ai-app/llm-dev/lecture-6' },
              { text: 'L7: 部署与运维', link: '/ai-app/llm-dev/lecture-7' },
              { text: 'L8: 安全与进阶', link: '/ai-app/llm-dev/lecture-8' },
              { text: '常见坑点', link: '/ai-app/llm-dev/pitfalls' },
              { text: '面试高频问题', link: '/ai-app/llm-dev/interview' },
              { text: '练习题', link: '/ai-app/llm-dev/exercises' }
            ]
          }
        ]
      },
      {
        text: '微服务',
        collapsed: false,
        items: [
          { text: '学习路线', link: '/microservice/' },
          { text: 'L1: 微服务架构认知', link: '/microservice/lecture-1' },
          { text: 'L2: 服务通信与 gRPC 实战', link: '/microservice/lecture-2' },
          { text: 'L3: 服务注册发现与配置中心', link: '/microservice/lecture-3' },
          { text: 'L4: 服务治理（限流/熔断/降级）', link: '/microservice/lecture-4' },
          { text: 'L5: API网关', link: '/microservice/lecture-5' },
          { text: 'L6: 分布式数据一致性', link: '/microservice/lecture-6' },
          { text: 'L7: 可观测性（监控/日志/追踪）', link: '/microservice/lecture-7' },
          { text: 'L8: 容器化与CI/CD', link: '/microservice/lecture-8' },
          { text: 'L9: Service Mesh', link: '/microservice/lecture-9' },
          { text: 'L10: 面试题与项目实战', link: '/microservice/lecture-10' }
        ]
      },
      {
        text: '架构设计',
        collapsed: false,
        items: [
          { text: '学习路线', link: '/architecture/' },
          { text: 'L1: 架构定义与复杂度', link: '/architecture/lecture-1' },
          { text: 'L2: 架构设计三原则与四步法', link: '/architecture/lecture-2' },
          { text: 'L3: 高性能架构模式', link: '/architecture/lecture-3' },
          { text: 'L4: 高可用架构模式', link: '/architecture/lecture-4' },
          { text: 'L5: 可扩展架构模式', link: '/architecture/lecture-5' },
          { text: 'L6: 架构实战与案例分析', link: '/architecture/lecture-6' },
          { text: 'L7: 面试题总结', link: '/architecture/lecture-7' },
          { text: 'L8: 练习题库', link: '/architecture/lecture-8' }
        ]
      },
      {
        text: '高并发系统设计',
        collapsed: true,
        items: [
          { text: '学习路线', link: '/high-concurrency/' },
          { text: 'L1: 基础认知与架构演进', link: '/high-concurrency/lecture-1' },
          { text: 'L2: 缓存设计与防护方案', link: '/high-concurrency/lecture-2' },
          { text: 'L3: 消息队列（Kafka/RocketMQ）', link: '/high-concurrency/lecture-3' },
          { text: 'L4: 分库分表', link: '/high-concurrency/lecture-4' },
          { text: 'L5: 高可用设计（限流/熔断/降级）', link: '/high-concurrency/lecture-5' },
          { text: 'L6: 服务治理（注册发现/配置中心/分布式锁）', link: '/high-concurrency/lecture-6' },
          { text: 'L7: 场景实战（秒杀/Feed流/计数）', link: '/high-concurrency/lecture-7' }
        ]
      },
      {
        text: '工程化',
        collapsed: true,
        items: [
          { text: 'Docker', link: '/engineering/docker' },
          { text: 'Git', link: '/engineering/git' },
          { text: '监控告警', link: '/engineering/monitoring' },
          { text: 'SNMP 与 iperf3', link: '/engineering/snmp-iperf' },
          { text: 'OSGB 到 3D Tiles', link: '/engineering/osgb-3dtiles' }
        ]
      },
      {
        text: '大数据',
        collapsed: true,
        items: [
          { text: 'Hadoop', link: '/big-data/hadoop' },
          { text: 'Kafka', link: '/big-data/kafka' },
          { text: 'Flume', link: '/big-data/flume' },
          { text: 'Spark', link: '/big-data/spark' },
          { text: 'MapReduce', link: '/big-data/mapreduce' }
        ]
      },
      {
        text: '数据分析',
        collapsed: true,
        items: [
          { text: '学习路线', link: '/data-analysis/' },
          { text: '数据获取', link: '/data-analysis/data-acquisition' },
          { text: '数据预处理', link: '/data-analysis/preprocessing' },
          { text: '数据可视化', link: '/data-analysis/visualization' },
          { text: '图像处理', link: '/data-analysis/image-processing' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/LongJie686' }
    ],

    footer: {
      message: '基于 VitePress 构建',
      copyright: 'MIT 许可证'
    }
  }
})
