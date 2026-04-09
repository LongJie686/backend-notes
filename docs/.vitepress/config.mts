import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "LongJie's Knowledge Base",
  description: 'Backend / Recommend System / AI',
  lang: 'zh-CN',
  base: '/backend-notes/',

  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Backend', link: '/backend/python' },
      { text: 'Database', link: '/database/mysql' },
      { text: 'Recommend', link: '/recommend-system/collaborative-filtering' },
      { text: 'AI', link: '/ai-app/llm' },
      { text: 'Microservice', link: '/microservice/' },
      { text: 'Architecture', link: '/architecture/' }
    ],

    sidebar: [
      {
        text: 'Backend',
        items: [
          { text: 'Python', link: '/backend/python' },
          { text: 'Network', link: '/backend/network' }
        ]
      },
      {
        text: 'Database',
        items: [
          { text: 'MySQL', link: '/database/mysql' },
          {
            text: 'MySQL Study Notes',
            collapsed: true,
            items: [
              { text: 'L1: Table Design', link: '/database/mysql-notes/lecture-1' },
              { text: 'L2: Index', link: '/database/mysql-notes/lecture-2' },
              { text: 'L3: Transaction', link: '/database/mysql-notes/lecture-3' },
              { text: 'L4: Isolation', link: '/database/mysql-notes/lecture-4' },
              { text: 'L5: MVCC', link: '/database/mysql-notes/lecture-5' },
              { text: 'L6: Lock', link: '/database/mysql-notes/lecture-6' }
            ]
          },
          { text: 'Redis', link: '/database/redis' }
        ]
      },
      {
        text: 'Recommend System',
        items: [
          { text: 'Collaborative Filtering', link: '/recommend-system/collaborative-filtering' }
        ]
      },
      {
        text: 'AI App',
        items: [
          { text: 'LLM', link: '/ai-app/llm' },
          {
            text: 'Agent 架构分析',
            collapsed: true,
            items: [
              { text: 'Claude Code 学习笔记', link: '/ai-app/agent-analysis/learn-claude-code' },
              { text: 'NanoClaw 项目解析', link: '/ai-app/agent-analysis/nanoclaw' }
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
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/LongJie686' }
    ],

    footer: {
      message: 'Built with VitePress',
      copyright: 'MIT License'
    }
  }
})
