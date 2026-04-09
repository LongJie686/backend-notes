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
