<template>
  <div class="kg-wrapper" ref="wrapperRef">
    <div class="kg-header">
      <div class="kg-title">
        <span class="kg-title-name">LongJie's Notes</span>
        <span class="kg-title-sub">Backend / Database / AI / Architecture</span>
      </div>
      <div class="kg-actions">
        <button class="kg-btn" @click="toggleTheme">
          {{ isDark ? 'Light' : 'Dark' }}
        </button>
        <a class="kg-btn kg-btn-primary" href="/backend-notes/notes">
          进入文档
        </a>
      </div>
    </div>

    <svg ref="svgRef" class="kg-svg"></svg>

    <div class="kg-legend">
      <div class="kg-legend-item" v-for="(color, name) in categoryColors" :key="name">
        <span class="kg-legend-dot" :style="{ background: color, boxShadow: `0 0 6px ${color}` }"></span>
        <span class="kg-legend-text">{{ name }}</span>
      </div>
    </div>

    <div class="kg-tooltip" v-if="tooltip" :style="tooltipStyle">
      <div class="kg-tooltip-label">{{ tooltip.label }}</div>
      <div class="kg-tooltip-type" v-if="tooltip.type === 'category'">[ 分类 ]</div>
      <div class="kg-tooltip-hint">click to open</div>
    </div>

    <div class="kg-stats">{{ nodeCount }} nodes</div>
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
  '后端': '#4FC3F7',
  '数据库': '#81C784',
  'AI 应用': '#CE93D8',
  '微服务': '#FF8A65',
  '架构设计': '#4DB6AC',
  '高并发': '#E57373',
  '工程化': '#90A4AE',
  '大数据': '#FFB74D',
  '数据分析': '#7986CB',
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

  const g = svg.append('g')
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
  svg.call(zoom)
  svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.65))

  // SVG Defs
  const defs = svg.append('defs')

  // Glow filter for category nodes
  const glow = defs.append('filter').attr('id', 'glow')
    .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
  glow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
  const glowMerge = glow.append('feMerge')
  glowMerge.append('feMergeNode').attr('in', 'blur')
  glowMerge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Subtle shadow for article nodes
  const shadow = defs.append('filter').attr('id', 'shadow')
    .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
  shadow.append('feDropShadow').attr('dx', 0).attr('dy', 1).attr('stdDeviation', 2)
    .attr('flood-color', 'rgba(0,0,0,0.25)')

  // Per-category radial gradients
  Object.entries(categoryColors).forEach(([name, color]) => {
    const c = d3.color(color)!
    const grad = defs.append('radialGradient').attr('id', `g-${name}`)
      .attr('cx', '40%').attr('cy', '35%').attr('r', '60%')
    grad.append('stop').attr('offset', '0%').attr('stop-color', c.brighter(0.8).toString())
    grad.append('stop').attr('offset', '100%').attr('stop-color', c.darker(0.4).toString())
  })

  // Position categories: biggest at center, others on circle
  const topCats = nodes.filter(n => n.type === 'category' && !n.parent)
  const subCats = nodes.filter(n => n.type === 'category' && n.parent)

  function countDescendants(nodeId: string): number {
    return nodes
      .filter(n => n.parent === nodeId)
      .reduce((sum, child) => sum + 1 + (child.type === 'category' ? countDescendants(child.id) : 0), 0)
  }

  function findTopAncestor(nodeId: string): string | null {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return null
    if (!node.parent) return node.id
    return findTopAncestor(node.parent)
  }

  const sortedTopCats = [...topCats].sort((a, b) => countDescendants(b.id) - countDescendants(a.id))

  const catTargets = new Map<string, { x: number; y: number }>()

  // Biggest category at center
  catTargets.set(sortedTopCats[0].id, { x: 0, y: 0 })

  // Other top-level categories on surrounding circle
  const circleRadius = 320
  sortedTopCats.slice(1).forEach((cat, i) => {
    const angle = (2 * Math.PI * i) / (sortedTopCats.length - 1) - Math.PI / 2
    catTargets.set(cat.id, {
      x: circleRadius * Math.cos(angle),
      y: circleRadius * Math.sin(angle),
    })
  })

  // Sub-categories: position near their top-level ancestor
  subCats.forEach((sub, idx) => {
    const ancestorId = findTopAncestor(sub.id)
    const baseTarget = catTargets.get(ancestorId!) || { x: 0, y: 0 }
    const subAngle = (2 * Math.PI * idx) / subCats.length
    catTargets.set(sub.id, {
      x: baseTarget.x + 70 * Math.cos(subAngle),
      y: baseTarget.y + 70 * Math.sin(subAngle),
    })
  })

  // Force simulation
  simulation = d3.forceSimulation<GraphNode>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
      .id(d => d.id)
      .distance(d => d.type === 'cross-ref' ? 180 : 80)
      .strength(d => d.type === 'cross-ref' ? 0.06 : 0.8)
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(d =>
      d.type === 'category' ? -400 : -40
    ))
    .force('center', d3.forceCenter(0, 0).strength(0.005))
    .force('collision', d3.forceCollide<GraphNode>().radius(d =>
      d.type === 'category' ? 45 : 15
    ))
    .force('x', d3.forceX<GraphNode>(d => {
      const key = d.type === 'article' ? d.parent! : d.id
      const t = catTargets.get(key)
      return t ? t.x : 0
    }).strength(d => d.type === 'category' ? 0.15 : 0.12))
    .force('y', d3.forceY<GraphNode>(d => {
      const key = d.type === 'article' ? d.parent! : d.id
      const t = catTargets.get(key)
      return t ? t.y : 0
    }).strength(d => d.type === 'category' ? 0.15 : 0.12))

  // Curved edge paths
  const linkPath = g.append('g')
    .selectAll('path')
    .data(edges)
    .join('path')
    .attr('class', d => `kg-edge kg-edge-${d.type}`)
    .attr('fill', 'none')
    .attr('stroke', d => {
      if (d.type === 'cross-ref') return 'rgba(255,200,100,0.12)'
      const src = typeof d.source === 'string' ? d.source : (d.source as GraphNode)
      return (src as GraphNode).color || '#999'
    })
    .attr('stroke-width', d => d.type === 'cross-ref' ? 0.6 : 1)
    .attr('stroke-opacity', d => d.type === 'cross-ref' ? 0.15 : 0.18)
    .attr('stroke-dasharray', d => d.type === 'cross-ref' ? '3,3' : 'none')

  // Sort nodes: articles first, categories last (SVG render order)
  nodes.sort((a, b) => (a.type === 'category' ? 1 : 0) - (b.type === 'category' ? 1 : 0))

  // Node groups
  const nodeGroup = g.append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', d => `kg-node kg-node-${d.type}`)
    .style('cursor', 'pointer')

  // Category nodes: outer glow ring
  nodeGroup.filter(d => d.type === 'category')
    .append('circle')
    .attr('r', 28)
    .attr('fill', 'none')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.2)
    .style('pointer-events', 'none')

  // Main circles
  nodeGroup.append('circle')
    .attr('class', 'node-circle')
    .attr('r', d => d.type === 'category' ? 22 : 8)
    .attr('fill', d => {
      if (d.type === 'category') return `url(#g-${d.label})`
      return d3.color(d.color)!.darker(0.2).toString()
    })
    .attr('fill-opacity', d => d.type === 'category' ? 0.95 : 0.75)
    .attr('stroke', d => d.type === 'category' ? d3.color(d.color)!.brighter(0.3).toString() : d.color)
    .attr('stroke-width', d => d.type === 'category' ? 1.5 : 0.5)
    .attr('stroke-opacity', d => d.type === 'category' ? 0.8 : 0.3)
    .attr('filter', d => d.type === 'category' ? 'url(#glow)' : 'url(#shadow)')

  // Category labels
  nodeGroup.filter(d => d.type === 'category')
    .append('text')
    .text(d => d.label)
    .attr('dy', 38).attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-1)')
    .attr('font-size', '12px').attr('font-weight', '600')
    .attr('letter-spacing', '0.5px')
    .style('pointer-events', 'none')
    .style('text-shadow', '0 1px 3px rgba(0,0,0,0.3)')

  // Article labels
  nodeGroup.filter(d => d.type === 'article')
    .append('text')
    .text(d => d.label.length > 8 ? d.label.slice(0, 8) + '..' : d.label)
    .attr('dy', -13).attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-3)')
    .attr('font-size', '9px')
    .style('pointer-events', 'none')

  // Drag
  let dragged = false
  const drag = d3.drag<SVGGElement, GraphNode>()
    .on('start', (event, d) => {
      dragged = false
      if (!event.active) simulation?.alphaTarget(0.3).restart()
      d.fx = d.x; d.fy = d.y
    })
    .on('drag', (event, d) => {
      dragged = true
      d.fx = event.x; d.fy = event.y; d.x = event.x; d.y = event.y
    })
    .on('end', (event, d) => {
      if (!event.active) simulation?.alphaTarget(0)
      d.fx = null; d.fy = null
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

      nodeGroup.transition().duration(200)
        .attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.08)

      linkPath.transition().duration(200)
        .attr('stroke-opacity', (e: any) => {
          const s = typeof e.source === 'string' ? e.source : e.source.id
          const t = typeof e.target === 'string' ? e.target : e.target.id
          return (s === d.id || t === d.id) ? 0.7 : 0.02
        })
        .attr('stroke-width', (e: any) => {
          const s = typeof e.source === 'string' ? e.source : e.source.id
          const t = typeof e.target === 'string' ? e.target : e.target.id
          return (s === d.id || t === d.id) ? 2 : 0.6
        })

      // Highlight connected node circles
      d3.selectAll('.node-circle')
        .transition().duration(200)
        .attr('r', function(this: SVGCircleElement, n: any) {
          if (!connectedIds.has(n.id)) return n.type === 'category' ? 22 : 8
          return n.type === 'category' ? 26 : 11
        })
    })
    .on('mousemove', (event: MouseEvent) => {
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 }
    })
    .on('mouseout', () => {
      tooltip.value = null
      nodeGroup.transition().duration(300).attr('opacity', 1)
      linkPath.transition().duration(300)
        .attr('stroke-opacity', d => (d as GraphEdge).type === 'cross-ref' ? 0.15 : 0.18)
        .attr('stroke-width', d => (d as GraphEdge).type === 'cross-ref' ? 0.6 : 1)
      d3.selectAll('.node-circle')
        .transition().duration(300)
        .attr('r', (n: any) => n.type === 'category' ? 22 : 8)
    })

  // Click to navigate (only if not a drag)
  nodeGroup.on('click', (event: MouseEvent, d: GraphNode) => {
    if (dragged) return
    if (d.link) window.location.href = base + d.link.replace(/^\//, '')
  })

  // Tick - curved edges + node positions
  simulation.on('tick', () => {
    linkPath.attr('d', d => {
      const sx = (d.source as GraphNode).x ?? 0
      const sy = (d.source as GraphNode).y ?? 0
      const tx = (d.target as GraphNode).x ?? 0
      const ty = (d.target as GraphNode).y ?? 0
      const dx = tx - sx
      const dy = ty - sy
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2
      return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`
    })

    nodeGroup.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
  })

  // Resize
  const resizeObserver = new ResizeObserver(() => {
    if (!wrapperRef.value) return
    svg.attr('width', wrapperRef.value.clientWidth).attr('height', wrapperRef.value.clientHeight)
  })
  resizeObserver.observe(wrapperRef.value)

  onUnmounted(() => {
    simulation?.stop()
    resizeObserver.disconnect()
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
  transition: background 0.3s;
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
  padding: 20px 28px;
  z-index: 10;
  pointer-events: none;
  background: linear-gradient(to bottom, var(--vp-c-bg) 0%, transparent 100%);
}

.kg-header > * {
  pointer-events: auto;
}

.kg-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kg-title-name {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--vp-c-text-1);
}

.kg-title-sub {
  font-size: 12px;
  color: var(--vp-c-text-3);
  letter-spacing: 0.5px;
}

.kg-actions {
  display: flex;
  gap: 8px;
}

.kg-btn {
  padding: 7px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.25s;
  letter-spacing: 0.3px;
}

.kg-btn:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.08);
}

.kg-btn-primary {
  background: var(--vp-c-brand);
  color: #fff;
  border-color: var(--vp-c-brand);
  font-weight: 500;
}

.kg-btn-primary:hover {
  opacity: 0.85;
  color: #fff;
  box-shadow: 0 0 16px color-mix(in srgb, var(--vp-c-brand) 40%, transparent);
}

.kg-legend {
  position: absolute;
  bottom: 20px;
  left: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  z-index: 10;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  max-width: 520px;
  backdrop-filter: blur(8px);
}

.kg-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.kg-legend-dot {
  width: 8px;
  height: 8px;
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
  padding: 10px 14px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(8px);
}

.kg-tooltip-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.kg-tooltip-type {
  font-size: 10px;
  color: var(--vp-c-text-3);
  margin-top: 3px;
}

.kg-tooltip-hint {
  font-size: 10px;
  color: var(--vp-c-brand);
  margin-top: 4px;
  letter-spacing: 0.3px;
}

.kg-stats {
  position: absolute;
  bottom: 20px;
  right: 24px;
  font-size: 11px;
  color: var(--vp-c-text-3);
  z-index: 10;
  letter-spacing: 0.5px;
}

@media (max-width: 768px) {
  .kg-legend {
    bottom: 10px;
    left: 10px;
    padding: 8px 12px;
    gap: 8px 10px;
    max-width: 280px;
  }
  .kg-legend-text {
    font-size: 10px;
  }
  .kg-header {
    padding: 14px 16px;
  }
  .kg-title-name {
    font-size: 18px;
  }
}
</style>
