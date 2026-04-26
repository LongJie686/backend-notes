import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = path.resolve(__dirname, '../..')
const OUTPUT_FILE = path.resolve(__dirname, '../graph-data.json')

const CATEGORY_COLORS = {
  '后端': '#42A5F5',
  '数据库': '#66BB6A',
  'AI 应用': '#AB47BC',
  '微服务': '#FF7043',
  '架构设计': '#26A69A',
  '高并发系统设计': '#EF5350',
  '工程化': '#78909C',
  '大数据': '#FFA726',
  '数据分析': '#5C6BC0',
}

function slugify(text) {
  return text
    .replace(/[（）]/g, '')
    .replace(/[()]/g, '')
    .replace(/[/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9一-鿿-]/g, '')
}

function walkSidebar(items, parentId, parentColor, nodes, edges) {
  for (const item of items) {
    if (item.items) {
      // Sub-category node
      const catId = item.link || `cat-${slugify(item.text)}`
      const existingNode = nodes.find(n => n.id === catId)
      if (!existingNode) {
        nodes.push({
          id: catId,
          label: item.text.replace(/^L\d+:\s*/, ''),
          type: 'category',
          link: item.link || null,
          parent: parentId,
          color: parentColor,
        })
      }
      edges.push({ source: parentId, target: catId, type: 'parent-child' })
      walkSidebar(item.items, catId, parentColor, nodes, edges)
    } else if (item.link) {
      const nodeId = item.link
      const existingNode = nodes.find(n => n.id === nodeId)
      if (!existingNode) {
        nodes.push({
          id: nodeId,
          label: item.text.replace(/^L\d+:\s*/, ''),
          type: 'article',
          link: item.link,
          parent: parentId,
          color: parentColor,
        })
      }
      edges.push({ source: parentId, target: nodeId, type: 'parent-child' })
    }
  }
}

function parseSidebarForGraph() {
  const configPath = path.resolve(__dirname, '../config.mts')
  const configContent = fs.readFileSync(configPath, 'utf-8')

  // Extract sidebar JSON from config.mts
  const sidebarMatch = configContent.match(/sidebar:\s*\[([\s\S]*?)\n    \],/m)
  if (!sidebarMatch) {
    console.error('Could not parse sidebar from config.mts')
    return { nodes: [], edges: [] }
  }

  // Use eval-like approach: parse the sidebar structure
  // We'll use a simpler approach - directly parse the sidebar from the config
  const nodes = []
  const edges = []

  // Define sidebar structure inline (mirrors config.mts)
  const sidebar = [
    {
      text: '后端',
      items: [
        { text: 'Python', link: '/backend/python' },
        { text: 'FastAPI', link: '/backend/fastapi' },
        { text: 'Django', link: '/backend/django' },
        { text: 'Flask', link: '/backend/flask' },
        { text: 'WebSocket', link: '/backend/websocket' },
        { text: '网络基础', link: '/backend/network' },
        { text: 'RBAC 权限系统', link: '/backend/rbac' },
        { text: 'JWT 权限管理', link: '/backend/jwt' },
      ]
    },
    {
      text: '数据库',
      items: [
        { text: 'MySQL', link: '/database/mysql' },
        {
          text: 'MySQL 学习笔记',
          link: '/database/mysql-notes/',
          items: [
            { text: 'L1: 表设计', link: '/database/mysql-notes/lecture-1' },
            { text: 'L2: 索引', link: '/database/mysql-notes/lecture-2' },
            { text: 'L3: 事务', link: '/database/mysql-notes/lecture-3' },
            { text: 'L4: 隔离级别', link: '/database/mysql-notes/lecture-4' },
            { text: 'L5: MVCC', link: '/database/mysql-notes/lecture-5' },
            { text: 'L6: 锁机制', link: '/database/mysql-notes/lecture-6' },
            { text: 'L7: 慢查询优化', link: '/database/mysql-notes/lecture-7' },
            { text: 'L8: 主从复制', link: '/database/mysql-notes/lecture-8' },
            { text: 'L9: 分库分表', link: '/database/mysql-notes/lecture-9' },
            { text: 'L10: 高可用', link: '/database/mysql-notes/lecture-10' },
            { text: 'L11: 面试题-基础', link: '/database/mysql-notes/lecture-11' },
            { text: 'L12: 面试题-锁', link: '/database/mysql-notes/lecture-12' },
            { text: 'L13: 面试题-主从', link: '/database/mysql-notes/lecture-13' },
          ]
        },
        { text: 'Redis', link: '/database/redis' },
        { text: 'PostgreSQL', link: '/database/postgres' },
        { text: 'SQLite', link: '/database/sqlite' },
        { text: 'pgvector', link: '/database/pgvector' },
      ]
    },
    {
      text: 'AI 应用',
      items: [
        { text: 'LLM 概述', link: '/ai-app/llm' },
        {
          text: 'Agent 架构分析',
          items: [
            { text: 'Claude Code 学习', link: '/ai-app/agent-analysis/learn-claude-code' },
            { text: 'NanoClaw 项目', link: '/ai-app/agent-analysis/nanoclaw' },
            { text: 'Hermes Agent', link: '/ai-app/agent-analysis/hermes-agent' },
          ]
        },
        { text: 'Text-to-SQL', link: '/ai-app/text-to-sql/' },
        { text: 'MCP 协议', link: '/ai-app/mcp/' },
        { text: '语音交互', link: '/ai-app/voice-interaction/' },
        { text: 'Skills 技能系统', link: '/ai-app/skills/' },
        {
          text: '多智能体设计实战',
          link: '/ai-app/multi-agent/',
          items: [
            { text: 'L1: 多智能体基础', link: '/ai-app/multi-agent/lecture-1' },
            { text: 'L2: 角色设计', link: '/ai-app/multi-agent/lecture-2' },
            { text: 'L3: RAG 知识管理', link: '/ai-app/multi-agent/lecture-3' },
            { text: 'L4: 工具调用', link: '/ai-app/multi-agent/lecture-4' },
            { text: 'L5: Prompt 精调', link: '/ai-app/multi-agent/lecture-5' },
            { text: 'L6: 可观测性', link: '/ai-app/multi-agent/lecture-6' },
            { text: 'L7: 安全护栏', link: '/ai-app/multi-agent/lecture-7' },
            { text: 'L8: 生产部署', link: '/ai-app/multi-agent/lecture-8' },
            { text: 'L9: 数据飞轮', link: '/ai-app/multi-agent/lecture-9' },
            { text: '常见坑点', link: '/ai-app/multi-agent/pitfalls' },
            { text: '面试高频', link: '/ai-app/multi-agent/interview' },
          ]
        },
        {
          text: '大模型应用开发',
          link: '/ai-app/llm-dev/',
          items: [
            { text: 'L1: 大模型基础', link: '/ai-app/llm-dev/lecture-1' },
            { text: 'L2: Prompt 工程', link: '/ai-app/llm-dev/lecture-2' },
            { text: 'L3: RAG 系统', link: '/ai-app/llm-dev/lecture-3' },
            { text: 'L4: Agent 工具', link: '/ai-app/llm-dev/lecture-4' },
            { text: 'L5: 多轮对话', link: '/ai-app/llm-dev/lecture-5' },
            { text: 'L6: 模型微调', link: '/ai-app/llm-dev/lecture-6' },
            { text: 'L7: 部署运维', link: '/ai-app/llm-dev/lecture-7' },
            { text: 'L8: 安全进阶', link: '/ai-app/llm-dev/lecture-8' },
            { text: '常见坑点', link: '/ai-app/llm-dev/pitfalls' },
            { text: '面试高频', link: '/ai-app/llm-dev/interview' },
            { text: '练习题', link: '/ai-app/llm-dev/exercises' },
          ]
        },
      ]
    },
    {
      text: '微服务',
      items: [
        { text: '学习路线', link: '/microservice/' },
        { text: 'L1: 架构认知', link: '/microservice/lecture-1' },
        { text: 'L2: 服务通信', link: '/microservice/lecture-2' },
        { text: 'L3: 注册发现', link: '/microservice/lecture-3' },
        { text: 'L4: 服务治理', link: '/microservice/lecture-4' },
        { text: 'L5: API网关', link: '/microservice/lecture-5' },
        { text: 'L6: 数据一致性', link: '/microservice/lecture-6' },
        { text: 'L7: 可观测性', link: '/microservice/lecture-7' },
        { text: 'L8: 容器化', link: '/microservice/lecture-8' },
        { text: 'L9: Service Mesh', link: '/microservice/lecture-9' },
        { text: 'L10: 面试实战', link: '/microservice/lecture-10' },
      ]
    },
    {
      text: '架构设计',
      items: [
        { text: '学习路线', link: '/architecture/' },
        { text: 'L1: 架构定义', link: '/architecture/lecture-1' },
        { text: 'L2: 设计原则', link: '/architecture/lecture-2' },
        { text: 'L3: 高性能架构', link: '/architecture/lecture-3' },
        { text: 'L4: 高可用架构', link: '/architecture/lecture-4' },
        { text: 'L5: 高可用（上）', link: '/architecture/lecture-5' },
        { text: 'L6: 架构实战', link: '/architecture/lecture-6' },
        { text: 'L7: 面试题', link: '/architecture/lecture-7' },
        { text: 'L8: 练习题', link: '/architecture/lecture-8' },
      ]
    },
    {
      text: '高并发系统设计',
      items: [
        { text: '学习路线', link: '/high-concurrency/' },
        { text: 'L1: 基础认知', link: '/high-concurrency/lecture-1' },
        { text: 'L2: 缓存设计', link: '/high-concurrency/lecture-2' },
        { text: 'L3: 消息队列', link: '/high-concurrency/lecture-3' },
        { text: 'L4: 分库分表', link: '/high-concurrency/lecture-4' },
        { text: 'L5: 高可用', link: '/high-concurrency/lecture-5' },
        { text: 'L6: 服务治理', link: '/high-concurrency/lecture-6' },
        { text: 'L7: 场景实战', link: '/high-concurrency/lecture-7' },
      ]
    },
    {
      text: '工程化',
      items: [
        { text: 'Docker', link: '/engineering/docker' },
        { text: 'Git', link: '/engineering/git' },
        { text: '监控告警', link: '/engineering/monitoring' },
        { text: 'SNMP', link: '/engineering/snmp-iperf' },
        { text: 'OSGB', link: '/engineering/osgb-3dtiles' },
      ]
    },
    {
      text: '大数据',
      items: [
        { text: 'Hadoop', link: '/big-data/hadoop' },
        { text: 'Kafka', link: '/big-data/kafka' },
        { text: 'Flume', link: '/big-data/flume' },
        { text: 'Spark', link: '/big-data/spark' },
        { text: 'MapReduce', link: '/big-data/mapreduce' },
      ]
    },
    {
      text: '数据分析',
      items: [
        { text: '学习路线', link: '/data-analysis/' },
        { text: '数据获取', link: '/data-analysis/data-acquisition' },
        { text: '数据预处理', link: '/data-analysis/preprocessing' },
        { text: '数据可视化', link: '/data-analysis/visualization' },
        { text: '图像处理', link: '/data-analysis/image-processing' },
      ]
    },
  ]

  // Build nodes and edges from sidebar
  for (const group of sidebar) {
    const catId = `cat-${slugify(group.text)}`
    const color = CATEGORY_COLORS[group.text] || '#90A4AE'

    // Top-level category node
    nodes.push({
      id: catId,
      label: group.text,
      type: 'category',
      link: null,
      parent: null,
      color,
    })

    // Walk children
    if (group.items) {
      walkSidebar(group.items, catId, color, nodes, edges)
    }
  }

  // Deduplicate edges
  const edgeSet = new Set()
  const uniqueEdges = edges.filter(e => {
    const key = `${e.source}->${e.target}`
    if (edgeSet.has(key)) return false
    edgeSet.add(key)
    return true
  })

  // Scan markdown files for cross-references
  const crossRefEdges = scanMarkdownLinks(nodes, DOCS_DIR)
  for (const edge of crossRefEdges) {
    const key = `${edge.source}->${edge.target}`
    if (!edgeSet.has(key)) {
      edgeSet.add(key)
      uniqueEdges.push(edge)
    }
  }

  return { nodes, edges: uniqueEdges }
}

function getNodeCategory(nodeId, nodes) {
  let node = nodes.find(n => n.id === nodeId)
  if (!node) return null
  // Walk up to find top-level category
  while (node && node.parent && !node.parent.startsWith('cat-')) {
    node = nodes.find(n => n.id === node.parent)
  }
  return node ? node.parent : null
}

function scanMarkdownLinks(nodes, docsDir) {
  const edges = []
  const nodeIds = new Set(nodes.map(n => n.id))

  // Map file paths to node IDs
  function filePathToNodeId(filePath) {
    const relative = path.relative(docsDir, filePath)
    const withoutExt = relative.replace(/\.md$/, '')
    return '/' + withoutExt.replace(/\\/g, '/')
  }

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.name.endsWith('.md')) {
        const sourceId = filePathToNodeId(fullPath)
        if (!nodeIds.has(sourceId) && !nodeIds.has(sourceId + '/')) continue

        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          // Match markdown links: [text](/path)
          const linkRegex = /\[([^\]]*)\]\((\/[^)]+)\)/g
          let match
          while ((match = linkRegex.exec(content)) !== null) {
            let targetPath = match[2].replace(/\/$/, '')
            if (nodeIds.has(targetPath)) {
              const sourceCat = getNodeCategory(sourceId, nodes)
              const targetCat = getNodeCategory(targetPath, nodes)
              if (sourceCat && targetCat && sourceCat !== targetCat) {
                edges.push({
                  source: sourceId,
                  target: targetPath,
                  type: 'cross-ref',
                })
              }
            }
          }
          // Match wiki-links: [[path]]
          const wikiRegex = /\[\[([^\]]+)\]\]/g
          while ((match = wikiRegex.exec(content)) !== null) {
            let targetPath = match[1].replace(/\/$/, '')
            if (!targetPath.startsWith('/')) targetPath = '/' + targetPath
            if (nodeIds.has(targetPath)) {
              const sourceCat = getNodeCategory(sourceId, nodes)
              const targetCat = getNodeCategory(targetPath, nodes)
              if (sourceCat && targetCat && sourceCat !== targetCat) {
                edges.push({
                  source: sourceId,
                  target: targetPath,
                  type: 'cross-ref',
                })
              }
            }
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    }
  }

  try {
    scanDir(docsDir)
  } catch (e) {
    console.warn('Warning: could not scan markdown files for cross-references:', e.message)
  }

  return edges
}

// Main
const graphData = parseSidebarForGraph()
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(graphData, null, 2))
console.log(`Generated graph data: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`)
console.log(`Output: ${OUTPUT_FILE}`)
