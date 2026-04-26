<template>
  <div class="kg-wrapper" ref="wrapperRef">
    <!-- Header -->
    <div class="kg-header">
      <div class="kg-title">
        <span class="kg-title-name">LongJie's Notes</span>
        <span class="kg-title-sub">Backend / Recommend System / AI</span>
      </div>
      <div class="kg-actions">
        <button class="kg-btn" @click="toggleTheme">
          {{ isDark ? '浅色' : '深色' }}
        </button>
        <a class="kg-btn kg-btn-primary" href="/backend-notes/backend/python">
          进入文档
        </a>
      </div>
    </div>

    <!-- SVG Canvas -->
    <svg ref="svgRef" class="kg-svg"></svg>

    <!-- Legend -->
    <div class="kg-legend">
      <div class="kg-legend-item" v-for="(color, name) in categoryColors" :key="name">
        <span class="kg-legend-dot" :style="{ background: color }"></span>
        <span class="kg-legend-text">{{ name }}</span>
      </div>
    </div>

    <!-- Tooltip -->
    <div class="kg-tooltip" v-if="tooltip" :style="tooltipStyle">
      <div class="kg-tooltip-label">{{ tooltip.label }}</div>
      <div class="kg-tooltip-type" v-if="tooltip.type === 'category'">[分类]</div>
      <div class="kg-tooltip-hint">点击进入</div>
    </div>

    <!-- Node count -->
    <div class="kg-stats">{{ nodeCount }} 个节点</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useData } from 'vitepress'
import * as d3 from 'd3'

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  type: 'category' | 'article'
  link: string | null
  parent: string | null
  color: string
  z?: number
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  type: string
}

const { isDark, site } = useData()

const wrapperRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltip = ref<{ label: string; type: string } | null>(null)
const tooltipPos = ref({ x: 0, y: 0 })
const nodeCount = ref(0)

const categoryColors: Record<string, string> = {
  '后端': '#42A5F5',
  '数据库': '#66BB6A',
  'AI 应用': '#AB47BC',
  '微服务': '#FF7043',
  '架构设计': '#26A69A',
  '高并发': '#EF5350',
  '工程化': '#78909C',
  '大数据': '#FFA726',
  '数据分析': '#5C6BC0',
}

const tooltipStyle = computed(() => ({
  left: tooltipPos.value.x + 'px',
  top: tooltipPos.value.y + 'px',
}))

function toggleTheme() {
  isDark.value = !isDark.value
}

let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null

onMounted(async () => {
  if (!svgRef.value || !wrapperRef.value) return

  const base = site.value.base

  let graphData: { nodes: GraphNode[]; edges: GraphEdge[] }
  try {
    const res = await fetch(`${base}graph-data.json`)
    graphData = await res.json()
  } catch {
    return
  }

  const nodes: GraphNode[] = graphData.nodes
  const edges: GraphEdge[] = graphData.edges.map((e: any) => ({
    source: e.source,
    target: e.target,
    type: e.type,
  }))

  nodeCount.value = nodes.length

  const width = wrapperRef.value.clientWidth
  const height = wrapperRef.value.clientHeight

  const svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height)

  // Single zoom group (no nesting - fixes drag coordinate issues)
  const g = svg.append('g')
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
  svg.call(zoom)
  svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.25))

  // SVG Defs
  const defs = svg.append('defs')

  // Shadow filter
  defs.append('filter').attr('id', 'node-shadow')
    .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    .append('feDropShadow').attr('dx', 0).attr('dy', 2).attr('stdDeviation', 3)
    .attr('flood-color', 'rgba(0,0,0,0.3)')

  // Glow filter for category
  const glow = defs.append('filter').attr('id', 'node-glow')
    .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
  glow.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'blur')
  glow.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over')

  // Radial gradients per category
  Object.entries(categoryColors).forEach(([name, color]) => {
    const c = d3.color(color)!
    const grad = defs.append('radialGradient').attr('id', `grad-${name}`)
      .attr('cx', '35%').attr('cy', '35%').attr('r', '65%')
    grad.append('stop').attr('offset', '0%').attr('stop-color', c.brighter(1.2).toString())
    grad.append('stop').attr('offset', '50%').attr('stop-color', color)
    grad.append('stop').attr('offset', '100%').attr('stop-color', c.darker(1.0).toString())
  })

  // Force simulation
  simulation = d3.forceSimulation<GraphNode>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
      .id(d => d.id)
      .distance(d => d.type === 'cross-ref' ? 250 : 140)
      .strength(d => d.type === 'cross-ref' ? 0.1 : 0.5)
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(d =>
      d.type === 'category' ? -2500 : -100
    ))
    .force('center', d3.forceCenter(0, 0).strength(0.015))
    .force('collision', d3.forceCollide<GraphNode>().radius(d =>
      d.type === 'category' ? 150 : 25
    ))
    .force('x', d3.forceX(0).strength(0.008))
    .force('y', d3.forceY(0).strength(0.008))

  // Draw edges (cross-ref only; parent-child will become spike lines)
  const link = g.append('g')
    .selectAll('line')
    .data(edges.filter(e => e.type === 'cross-ref'))
    .join('line')
    .attr('stroke', 'rgba(255,152,0,0.15)')
    .attr('stroke-width', 0.8)
    .attr('stroke-dasharray', '4,4')

  // Spike lines (parent-child) - drawn behind nodes
  const parentChildEdges = edges.filter(e => e.type === 'parent-child')
  const spikes = g.append('g')
    .selectAll('line')
    .data(parentChildEdges)
    .join('line')
    .attr('stroke', d => {
      const src = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id
      const node = nodes.find(n => n.id === src)
      return node ? node.color : '#999'
    })
    .attr('stroke-width', 1.2)
    .attr('stroke-opacity', 0.25)

  // Node groups
  const nodeGroup = g.append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', 'kg-node')
    .style('cursor', 'pointer')

  // Main circles
  nodeGroup.append('circle')
    .attr('class', 'main-circle')
    .attr('r', d => d.type === 'category' ? 36 : 12)
    .attr('fill', d => {
      if (d.type === 'category') return `url(#grad-${d.label})`
      const p = nodes.find(n => n.id === d.parent)
      return p ? `url(#grad-${p.label})` : d.color
    })
    .attr('fill-opacity', d => d.type === 'category' ? 1 : 0.85)
    .attr('stroke', d => d.type === 'category' ? d3.color(d.color)!.brighter(0.5).toString() : d.color)
    .attr('stroke-width', d => d.type === 'category' ? 2 : 1)
    .attr('stroke-opacity', d => d.type === 'category' ? 0.6 : 0.4)
    .attr('filter', d => d.type === 'category' ? 'url(#node-glow)' : 'url(#node-shadow)')

  // Highlight spots
  nodeGroup.filter(d => d.type === 'category')
    .append('circle').attr('r', 10).attr('cx', -9).attr('cy', -9)
    .attr('fill', 'rgba(255,255,255,0.35)').style('pointer-events', 'none')

  nodeGroup.filter(d => d.type === 'article')
    .append('circle').attr('r', 3).attr('cx', -3).attr('cy', -3)
    .attr('fill', 'rgba(255,255,255,0.3)').style('pointer-events', 'none')

  // Category labels
  nodeGroup.filter(d => d.type === 'category')
    .append('text')
    .text(d => d.label)
    .attr('dy', 50).attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-1)').attr('font-size', '14px').attr('font-weight', '700')
    .style('pointer-events', 'none')

  // Article labels
  nodeGroup.filter(d => d.type === 'article')
    .append('text')
    .attr('class', 'art-label')
    .text(d => d.label.length > 6 ? d.label.slice(0, 6) + '..' : d.label)
    .attr('dy', -18).attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-2)').attr('font-size', '9px')
    .style('pointer-events', 'none')

  // Drag - works on all nodes, orbit mode preserves category positions
  let orbitStarted = false
  const drag = d3.drag<SVGGElement, GraphNode>()
    .on('start', (event, d) => {
      if (!orbitStarted && !event.active) simulation?.alphaTarget(0.3).restart()
      d.fx = d.x; d.fy = d.y
    })
    .on('drag', (event, d) => {
      d.fx = event.x; d.fy = event.y; d.x = event.x; d.y = event.y
    })
    .on('end', (event, d) => {
      if (!orbitStarted && !event.active) simulation?.alphaTarget(0)
      if (!orbitStarted) { d.fx = null; d.fy = null }
    })
  nodeGroup.call(drag)

  // Hover
  nodeGroup
    .on('mouseover', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = { label: d.label, type: d.type }
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 }
      const connectedIds = new Set<string>()
      connectedIds.add(d.id)
      edges.forEach((e: any) => {
        const s = typeof e.source === 'string' ? e.source : e.source.id
        const t = typeof e.target === 'string' ? e.target : e.target.id
        if (s === d.id) connectedIds.add(t)
        if (t === d.id) connectedIds.add(s)
      })
      nodeGroup.attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.15)
      spikes.attr('opacity', (e: any) => {
        const s = typeof e.source === 'string' ? e.source : e.source.id
        const t = typeof e.target === 'string' ? e.target : e.target.id
        return (s === d.id || t === d.id) ? 0.6 : 0.03
      })
    })
    .on('mousemove', (event: MouseEvent) => {
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 }
    })
    .on('mouseout', () => {
      tooltip.value = null
      nodeGroup.attr('opacity', 1)
      spikes.attr('opacity', 1)
    })

  // Click to navigate
  nodeGroup.on('click', (event: MouseEvent, d: GraphNode) => {
    if (d.link) window.location.href = base + d.link.replace(/^\//, '')
  })

  // Tick during force simulation
  simulation.on('tick', () => {
    spikes
      .attr('x1', d => (d.source as GraphNode).x ?? 0)
      .attr('y1', d => (d.source as GraphNode).y ?? 0)
      .attr('x2', d => (d.target as GraphNode).x ?? 0)
      .attr('y2', d => (d.target as GraphNode).y ?? 0)
    link
      .attr('x1', d => (d.source as GraphNode).x ?? 0)
      .attr('y1', d => (d.source as GraphNode).y ?? 0)
      .attr('x2', d => (d.target as GraphNode).x ?? 0)
      .attr('y2', d => (d.target as GraphNode).y ?? 0)
    nodeGroup.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
  })

  // === 3D Hedgehog Orbit Animation ===
  let animFrameId: number | null = null
  let mouseGraphX = Infinity
  let mouseGraphY = Infinity

  svg.on('mousemove.orbit', (event: MouseEvent) => {
    const t = d3.zoomTransform(svgRef.value!)
    const rect = svgRef.value!.getBoundingClientRect()
    mouseGraphX = (event.clientX - rect.left - t.x) / t.k
    mouseGraphY = (event.clientY - rect.top - t.y) / t.k
  })
  svg.on('mouseleave.orbit', () => { mouseGraphX = Infinity; mouseGraphY = Infinity })

  function startOrbits() {
    if (orbitStarted) return
    orbitStarted = true

    // Group articles by parent for Fibonacci sphere distribution
    const catArticles = new Map<string, GraphNode[]>()
    nodes.forEach(n => {
      if (n.type === 'category') catArticles.set(n.id, [])
    })
    nodes.forEach(n => {
      if (n.type === 'article' && n.parent && catArticles.has(n.parent)) {
        catArticles.get(n.parent)!.push(n)
      }
    })

    // Build 3D orbit data: distribute each parent's articles on a sphere
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const orbitData: {
      node: GraphNode
      parent: GraphNode
      radius: number
      theta: number
      phi: number
      speed: number
    }[] = []

    catArticles.forEach((articles, parentId) => {
      const parent = nodes.find(n => n.id === parentId)!
      const count = articles.length
      articles.forEach((art, i) => {
        // Fibonacci sphere distribution
        const theta = Math.acos(1 - 2 * (i + 0.5) / count)
        const phi = goldenAngle * i
        const radius = 55 + count * 4 + Math.random() * 10
        orbitData.push({
          node: art,
          parent,
          radius,
          theta,
          phi,
          speed: 0.0015 + Math.random() * 0.002
        })
      })
    })

    // Fix category positions
    nodes.forEach(n => {
      if (n.type === 'category') { n.fx = n.x; n.fy = n.y }
    })
    simulation?.stop()

    // Hide cross-ref links during orbit mode
    link.attr('stroke-opacity', 0.05)

    const PAUSE_DIST = 180

    function animate() {
      orbitData.forEach(o => {
        // Mouse proximity check
        const mdx = mouseGraphX - (o.parent.x ?? 0)
        const mdy = mouseGraphY - (o.parent.y ?? 0)
        const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy)

        if (mouseDist > PAUSE_DIST) {
          o.phi += o.speed
        }

        // 3D sphere -> 2D projection
        const x3d = o.radius * Math.sin(o.theta) * Math.cos(o.phi)
        const y3d = o.radius * Math.sin(o.theta) * Math.sin(o.phi)
        const z3d = o.radius * Math.cos(o.theta)

        o.node.x = (o.parent.x ?? 0) + x3d
        o.node.y = (o.parent.y ?? 0) + y3d
        o.node.z = z3d
      })

      // Update spike lines
      spikes
        .attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0)

      // Update cross-ref links
      link
        .attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0)

      // Update node positions + depth-based rendering
      nodeGroup.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)

      // Depth effect: front nodes bigger/brighter, back nodes smaller/dimmer
      nodeGroup.select('.main-circle')
        .attr('r', d => {
          if (d.type === 'category') return 36
          const depthFactor = 0.55 + 0.45 * ((d.z ?? 0) + 100) / 200
          return Math.max(6, 12 * depthFactor)
        })
        .attr('fill-opacity', d => {
          if (d.type === 'category') return 1
          return 0.35 + 0.65 * ((d.z ?? 0) + 100) / 200
        })

      animFrameId = requestAnimationFrame(animate)
    }

    animFrameId = requestAnimationFrame(animate)
  }

  simulation.on('end', startOrbits)
  setTimeout(() => { if (!orbitStarted) startOrbits() }, 7000)

  // Resize
  const resizeObserver = new ResizeObserver(() => {
    if (!wrapperRef.value) return
    svg.attr('width', wrapperRef.value.clientWidth).attr('height', wrapperRef.value.clientHeight)
  })
  resizeObserver.observe(wrapperRef.value)

  onUnmounted(() => {
    simulation?.stop()
    resizeObserver.disconnect()
    if (animFrameId) cancelAnimationFrame(animFrameId)
  })
})

onUnmounted(() => { simulation?.stop() })
</script>

<style scoped>
.kg-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 999;
  background: var(--vp-c-bg);
  overflow: hidden;
  font-family: var(--vp-font-family-base);
}

.kg-svg {
  width: 100%;
  height: 100%;
}

.kg-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  z-index: 10;
  pointer-events: none;
}

.kg-header > * {
  pointer-events: auto;
}

.kg-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kg-title-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.kg-title-sub {
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.kg-actions {
  display: flex;
  gap: 8px;
}

.kg-btn {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s;
}

.kg-btn:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

.kg-btn-primary {
  background: var(--vp-c-brand);
  color: #fff;
  border-color: var(--vp-c-brand);
}

.kg-btn-primary:hover {
  opacity: 0.9;
  color: #fff;
}

.kg-legend {
  position: absolute;
  bottom: 20px;
  left: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  z-index: 10;
  padding: 10px 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  max-width: 500px;
}

.kg-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.kg-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.kg-legend-text {
  font-size: 11px;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.kg-tooltip {
  position: fixed;
  z-index: 100;
  padding: 8px 12px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.kg-tooltip-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.kg-tooltip-type {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 2px;
}

.kg-tooltip-hint {
  font-size: 10px;
  color: var(--vp-c-brand);
  margin-top: 4px;
}

.kg-stats {
  position: absolute;
  bottom: 20px;
  right: 20px;
  font-size: 11px;
  color: var(--vp-c-text-3);
  z-index: 10;
}

@media (max-width: 768px) {
  .kg-legend {
    bottom: 10px;
    left: 10px;
    padding: 8px 10px;
    gap: 8px;
    max-width: 300px;
  }
  .kg-legend-text {
    font-size: 10px;
  }
  .kg-header {
    padding: 10px 16px;
  }
  .kg-title-name {
    font-size: 16px;
  }
}
</style>
