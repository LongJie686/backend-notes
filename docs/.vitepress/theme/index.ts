import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import KnowledgeGraph from './KnowledgeGraph.vue'
import HomePage from './HomePage.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('KnowledgeGraph', KnowledgeGraph)
    app.component('HomePage', HomePage)
  }
} satisfies Theme
