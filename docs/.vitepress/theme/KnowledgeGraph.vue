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

  // Load graph data
  let graphData: { nodes: GraphNode[]; edges: GraphEdge[] }
  try {
    const res = await fetch(`${base}graph-data.json`)
    graphData = await res.json()
  } catch {
    // Fallback: try direct import
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

  // Zoom - outer group for zoom/pan, inner group for rotation
  const g = svg.append('g') // zoom container
  const gInner = g.append('g') // rotation container
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
  svg.call(zoom)

  // Initial transform - fit whole graph in viewport
  svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.35))

  // SVG Defs: gradients, shadows for 3D effect
  const defs = svg.append('defs')

  // Drop shadow filter
  const shadowFilter = defs.append('filter')
    .attr('id', 'node-shadow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%')
  shadowFilter.append('feDropShadow')
    .attr('dx', 0).attr('dy', 2)
    .attr('stdDeviation', 3)
    .attr('flood-color', 'rgba(0,0,0,0.3)')

  // Glow filter for category nodes
  const glowFilter = defs.append('filter')
    .attr('id', 'node-glow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%')
  glowFilter.append('feGaussianBlur')
    .attr('stdDeviation', 4)
    .attr('result', 'blur')
  glowFilter.append('feComposite')
    .attr('in', 'SourceGraphic')
    .attr('in2', 'blur')
    .attr('operator', 'over')

  // Create radial gradients for each category color (3D sphere effect)
  Object.entries(categoryColors).forEach(([name, color]) => {
    const gradId = `grad-${name}`
    const grad = defs.append('radialGradient')
      .attr('id', gradId)
      .attr('cx', '35%').attr('cy', '35%')
      .attr('r', '65%')
    const baseColor = d3.color(color)!
    grad.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', baseColor.brighter(1.2).toString())
    grad.append('stop')
      .attr('offset', '50%')
      .attr('stop-color', color)
    grad.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', baseColor.darker(1.0).toString())
  })

  // Force simulation - strong repulsion to spread category nodes apart
  simulation = d3.forceSimulation<GraphNode>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
      .id(d => d.id)
      .distance(d => d.type === 'cross-ref' ? 200 : 120)
      .strength(d => d.type === 'cross-ref' ? 0.2 : 0.6)
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(d =>
      d.type === 'category' ? -2000 : -150
    ))
    .force('center', d3.forceCenter(0, 0).strength(0.02))
    .force('collision', d3.forceCollide<GraphNode>().radius(d =>
      d.type === 'category' ? 120 : 35
    ))
    .force('x', d3.forceX(0).strength(0.01))
    .force('y', d3.forceY(0).strength(0.01))

  // Draw edges
  const link = gInner.append('g')
    .selectAll('line')
    .data(edges)
    .join('line')
    .attr('class', d => `kg-edge kg-edge-${d.type}`)
    .attr('stroke', d => d.type === 'cross-ref' ? 'rgba(255,152,0,0.25)' : 'rgba(128,128,128,0.15)')
    .attr('stroke-width', d => d.type === 'cross-ref' ? 1 : 0.8)
    .attr('stroke-dasharray', d => d.type === 'cross-ref' ? '4,4' : 'none')

  // Draw node groups
  const nodeGroup = gInner.append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', 'kg-node')
    .style('cursor', 'pointer')

  // Node circles - 3D sphere effect with radial gradients
  nodeGroup.append('circle')
    .attr('r', d => d.type === 'category' ? 32 : 14)
    .attr('fill', d => {
      if (d.type === 'category') {
        return `url(#grad-${d.label})`
      }
      // Article nodes: use parent category gradient or solid
      const parentCat = nodes.find(n => n.id === d.parent)
      if (parentCat) {
        return `url(#grad-${parentCat.label})`
      }
      return d3.color(d.color)?.darker(0.5)?.toString() || d.color
    })
    .attr('fill-opacity', d => d.type === 'category' ? 1 : 0.85)
    .attr('stroke', d => d.type === 'category' ? d3.color(d.color)!.brighter(0.5).toString() : d.color)
    .attr('stroke-width', d => d.type === 'category' ? 2 : 1)
    .attr('stroke-opacity', d => d.type === 'category' ? 0.6 : 0.4)
    .attr('filter', d => d.type === 'category' ? 'url(#node-glow)' : 'url(#node-shadow)')

  // 3D highlight spot on category nodes (white specular)
  nodeGroup.filter(d => d.type === 'category')
    .append('circle')
    .attr('r', 10)
    .attr('cx', -8)
    .attr('cy', -8)
    .attr('fill', 'rgba(255,255,255,0.35)')
    .style('pointer-events', 'none')

  // 3D highlight spot on article nodes
  nodeGroup.filter(d => d.type === 'article')
    .append('circle')
    .attr('r', 4)
    .attr('cx', -4)
    .attr('cy', -4)
    .attr('fill', 'rgba(255,255,255,0.3)')
    .style('pointer-events', 'none')

  // Category labels
  nodeGroup.filter(d => d.type === 'category')
    .append('text')
    .text(d => d.label)
    .attr('dy', 45)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-1)')
    .attr('font-size', '14px')
    .attr('font-weight', '700')
    .style('pointer-events', 'none')

  // Article labels (always visible)
  nodeGroup.filter(d => d.type === 'article')
    .append('text')
    .text(d => d.label.length > 8 ? d.label.slice(0, 8) + '..' : d.label)
    .attr('dy', -20)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-2)')
    .attr('font-size', '10px')
    .style('pointer-events', 'none')

  // Drag behavior (orbit-aware: only category nodes draggable after orbits start)
  let orbitStarted = false
  const drag = d3.drag<SVGGElement, GraphNode>()
    .on('start', (event, d) => {
      if (orbitStarted && d.type === 'article') return
      if (!orbitStarted && !event.active) simulation?.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    })
    .on('drag', (event, d) => {
      if (orbitStarted && d.type === 'article') return
      d.fx = event.x
      d.fy = event.y
      d.x = event.x
      d.y = event.y
    })
    .on('end', (event, d) => {
      if (!orbitStarted && !event.active) simulation?.alphaTarget(0)
      if (!orbitStarted || d.type === 'article') {
        d.fx = null
        d.fy = null
      }
    })

  nodeGroup.call(drag)

  // Hover interactions
  nodeGroup
    .on('mouseover', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = { label: d.label, type: d.type }
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 }

      // Highlight connected
      const connectedIds = new Set<string>()
      connectedIds.add(d.id)
      edges.forEach((e: any) => {
        const s = typeof e.source === 'string' ? e.source : e.source.id
        const t = typeof e.target === 'string' ? e.target : e.target.id
        if (s === d.id) connectedIds.add(t)
        if (t === d.id) connectedIds.add(s)
      })

      nodeGroup.attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.15)
      link.attr('opacity', (e: any) => {
        const s = typeof e.source === 'string' ? e.source : e.source.id
        const t = typeof e.target === 'string' ? e.target : e.target.id
        return (s === d.id || t === d.id) ? 1 : 0.05
      })
    })
    .on('mousemove', (event: MouseEvent) => {
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 }
    })
    .on('mouseout', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = null
      nodeGroup.attr('opacity', 1)
      link.attr('opacity', 1)
    })

  // Click to navigate
  nodeGroup.on('click', (event: MouseEvent, d: GraphNode) => {
    if (d.link) {
      const href = base + d.link.replace(/^\//, '')
      window.location.href = href
    }
  })

  // Tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => (d.source as GraphNode).x ?? 0)
      .attr('y1', d => (d.source as GraphNode).y ?? 0)
      .attr('x2', d => (d.target as GraphNode).x ?? 0)
      .attr('y2', d => (d.target as GraphNode).y ?? 0)

    nodeGroup.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
  })

  // Orbit animation - article nodes orbit around their parent category node
  let animFrameId: number | null = null
  let mouseGraphX = Infinity
  let mouseGraphY = Infinity

  // Track mouse position converted to graph coordinates
  svg.on('mousemove.orbit', (event: MouseEvent) => {
    const transform = d3.zoomTransform(svgRef.value!)
    const rect = svgRef.value!.getBoundingClientRect()
    mouseGraphX = (event.clientX - rect.left - transform.x) / transform.k
    mouseGraphY = (event.clientY - rect.top - transform.y) / transform.k
  })
  svg.on('mouseleave.orbit', () => {
    mouseGraphX = Infinity
    mouseGraphY = Infinity
  })

  function startOrbits() {
    if (orbitStarted) return
    orbitStarted = true

    // Build orbit parameters from current node positions
    const orbitData: { node: GraphNode; parent: GraphNode; radius: number; angle: number; speed: number }[] = []
    nodes.forEach(node => {
      if (node.type === 'article' && node.parent) {
        const parent = nodes.find(n => n.id === node.parent)
        if (parent && parent.x != null && parent.y != null && node.x != null && node.y != null) {
          const dx = node.x - parent.x
          const dy = node.y - parent.y
          orbitData.push({
            node,
            parent,
            radius: Math.max(Math.sqrt(dx * dx + dy * dy), 60),
            angle: Math.atan2(dy, dx),
            speed: (0.0008 + Math.random() * 0.002) * (Math.random() > 0.5 ? 1 : -1)
          })
        }
      }
    })

    // Fix category node positions
    nodes.forEach(n => {
      if (n.type === 'category') {
        n.fx = n.x
        n.fy = n.y
      }
    })

    simulation?.stop()

    const PAUSE_DIST = 150

    function animate() {
      orbitData.forEach(o => {
        // Check mouse proximity to parent (category) node
        const mdx = mouseGraphX - (o.parent.x ?? 0)
        const mdy = mouseGraphY - (o.parent.y ?? 0)
        const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy)

        if (mouseDist > PAUSE_DIST) {
          o.angle += o.speed
        }

        o.node.x = (o.parent.x ?? 0) + o.radius * Math.cos(o.angle)
        o.node.y = (o.parent.y ?? 0) + o.radius * Math.sin(o.angle)
      })

      // Update SVG positions
      link
        .attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0)

      nodeGroup.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)

      animFrameId = requestAnimationFrame(animate)
    }

    animFrameId = requestAnimationFrame(animate)
  }

  // Start orbits when force simulation naturally cools down
  simulation.on('end', startOrbits)

  // Fallback: start after 6 seconds even if simulation is slow
  setTimeout(() => { if (!orbitStarted) startOrbits() }, 6000)

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    if (!wrapperRef.value) return
    const w = wrapperRef.value.clientWidth
    const h = wrapperRef.value.clientHeight
    svg.attr('width', w).attr('height', h)
  })
  resizeObserver.observe(wrapperRef.value)

  onUnmounted(() => {
    simulation?.stop()
    resizeObserver.disconnect()
    if (animFrameId) cancelAnimationFrame(animFrameId)
  })
})

onUnmounted(() => {
  simulation?.stop()
})
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
