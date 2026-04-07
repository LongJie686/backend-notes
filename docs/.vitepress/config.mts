import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "LongJie's Knowledge Base",
  description: 'Backend / Recommend System / AI',
  lang: 'zh-CN',

  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Backend', link: '/backend/python' },
      { text: 'Database', link: '/database/mysql' },
      { text: 'Recommend', link: '/recommend-system/collaborative-filtering' },
      { text: 'AI', link: '/ai-app/llm' }
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
          { text: 'MySQL Study Notes', link: '/database/mysql-notes' },
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
          { text: 'LLM', link: '/ai-app/llm' }
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
