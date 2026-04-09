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
            text: 'Agent Architecture Analysis',
            collapsed: true,
            items: [
              { text: 'Learn Claude Code', link: '/ai-app/agent-analysis/learn-claude-code' },
              { text: 'NanoClaw', link: '/ai-app/agent-analysis/nanoclaw' }
            ]
          },
          {
            text: 'Multi-Agent Design',
            collapsed: true,
            items: [
              { text: 'Learning Roadmap', link: '/ai-app/multi-agent/' },
              { text: 'L1: Multi-Agent Basics', link: '/ai-app/multi-agent/lecture-1' },
              { text: 'L2: Role Design & Orchestration', link: '/ai-app/multi-agent/lecture-2' },
              { text: 'L3: RAG Knowledge Management', link: '/ai-app/multi-agent/lecture-3' },
              { text: 'L4: Tool Calling & CrewAI', link: '/ai-app/multi-agent/lecture-4' },
              { text: 'L5: Prompt Tuning & Model Opt', link: '/ai-app/multi-agent/lecture-5' },
              { text: 'L6: Observability & Debugging', link: '/ai-app/multi-agent/lecture-6' },
              { text: 'L7: Safety & Governance', link: '/ai-app/multi-agent/lecture-7' },
              { text: 'L8: Production Deployment', link: '/ai-app/multi-agent/lecture-8' },
              { text: 'L9: Data Flywheel & Iteration', link: '/ai-app/multi-agent/lecture-9' },
              { text: 'Pitfalls', link: '/ai-app/multi-agent/pitfalls' },
              { text: 'Interview Q&A', link: '/ai-app/multi-agent/interview' }
            ]
          },
          {
            text: 'LLM Development',
            collapsed: true,
            items: [
              { text: 'Learning Roadmap', link: '/ai-app/llm-dev/' },
              { text: 'L1: LLM Basics & API', link: '/ai-app/llm-dev/lecture-1' },
              { text: 'L2: Prompt Engineering', link: '/ai-app/llm-dev/lecture-2' },
              { text: 'L3: RAG System', link: '/ai-app/llm-dev/lecture-3' },
              { text: 'L4: Agent & Tools', link: '/ai-app/llm-dev/lecture-4' },
              { text: 'L5: Chat & Emotion Bot', link: '/ai-app/llm-dev/lecture-5' },
              { text: 'L6: Fine-tuning', link: '/ai-app/llm-dev/lecture-6' },
              { text: 'L7: Deployment & Ops', link: '/ai-app/llm-dev/lecture-7' },
              { text: 'L8: Security & Advanced', link: '/ai-app/llm-dev/lecture-8' },
              { text: 'Pitfalls', link: '/ai-app/llm-dev/pitfalls' },
              { text: 'Interview Q&A', link: '/ai-app/llm-dev/interview' },
              { text: 'Exercises', link: '/ai-app/llm-dev/exercises' }
            ]
          }
        ]
      },
      {
        text: 'Microservice',
        collapsed: true,
        items: [
          { text: 'Learning Roadmap', link: '/microservice/' },
          { text: 'L1: Architecture Overview', link: '/microservice/lecture-1' }
        ]
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Learning Roadmap', link: '/architecture/' }
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
