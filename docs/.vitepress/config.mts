import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "LongJie 的知识库",
  description: '后端 / 推荐系统 / AI',
  lang: 'zh-CN',
  base: '/backend-notes/',

  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '后端', link: '/backend/python' },
      { text: '数据库', link: '/database/mysql' },
      { text: '推荐系统', link: '/recommend-system/collaborative-filtering' },
      { text: 'AI', link: '/ai-app/llm' },
      { text: '微服务', link: '/microservice/' },
      { text: '架构设计', link: '/architecture/' },
      { text: '高并发', link: '/high-concurrency/' }
    ],

    sidebar: [
      {
        text: '后端',
        items: [
          { text: 'Python', link: '/backend/python' },
          { text: 'FastAPI', link: '/backend/fastapi' },
          { text: 'Django', link: '/backend/django' },
          { text: 'Flask', link: '/backend/flask' },
          { text: 'WebSocket', link: '/backend/websocket' },
          { text: '网络基础', link: '/backend/network' },
          { text: 'RBAC 权限系统', link: '/backend/rbac' }
        ]
      },
      {
        text: '数据库',
        items: [
          { text: 'MySQL', link: '/database/mysql' },
          {
            text: 'MySQL 学习笔记',
            collapsed: true,
            items: [
              { text: 'L1: 表设计', link: '/database/mysql-notes/lecture-1' },
              { text: 'L2: 索引', link: '/database/mysql-notes/lecture-2' },
              { text: 'L3: 事务', link: '/database/mysql-notes/lecture-3' },
              { text: 'L4: 隔离级别', link: '/database/mysql-notes/lecture-4' },
              { text: 'L5: MVCC', link: '/database/mysql-notes/lecture-5' },
              { text: 'L6: 锁机制', link: '/database/mysql-notes/lecture-6' },
              { text: 'L7: 慢查询优化', link: '/database/mysql-notes/lecture-7' }
            ]
          },
          { text: 'Redis', link: '/database/redis' },
          { text: 'PostgreSQL', link: '/database/postgres' },
          { text: 'SQLite', link: '/database/sqlite' },
          { text: 'pgvector', link: '/database/pgvector' }
        ]
      },
      {
        text: '推荐系统',
        items: [
          { text: '协同过滤', link: '/recommend-system/collaborative-filtering' }
        ]
      },
      {
        text: 'AI 应用',
        items: [
          { text: 'LLM 概述', link: '/ai-app/llm' },
          {
            text: 'Agent 架构分析',
            collapsed: true,
            items: [
              { text: 'Claude Code 学习笔记', link: '/ai-app/agent-analysis/learn-claude-code' },
              { text: 'NanoClaw 项目解析', link: '/ai-app/agent-analysis/nanoclaw' }
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
            collapsed: true,
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
            collapsed: true,
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
        collapsed: true,
        items: [
          { text: '学习路线', link: '/microservice/' },
          { text: 'L1: 微服务架构认知', link: '/microservice/lecture-1' }
        ]
      },
      {
        text: '架构设计',
        collapsed: true,
        items: [
          { text: '学习路线', link: '/architecture/' },
          { text: 'L1: 架构定义与复杂度', link: '/architecture/lecture-1' }
        ]
      },
      {
        text: '高并发系统设计',
        collapsed: true,
        items: [
          { text: '学习路线', link: '/high-concurrency/' },
          { text: 'L1: 基础认知与架构演进', link: '/high-concurrency/lecture-1' }
        ]
      },
      {
        text: '工程化',
        collapsed: true,
        items: [
          { text: 'Docker', link: '/engineering/docker' },
          { text: 'Git', link: '/engineering/git' },
          { text: '监控告警', link: '/engineering/monitoring' }
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
