import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import KnowledgeGraph from './KnowledgeGraph.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('KnowledgeGraph', KnowledgeGraph)
  }
} satisfies Theme
