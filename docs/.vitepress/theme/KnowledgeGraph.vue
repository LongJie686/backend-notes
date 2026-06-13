<template>
  <div class="kg-wrapper" ref="wrapperRef">
    <div class="kg-bg-glow kg-bg-glow-1"></div>
    <div class="kg-bg-glow kg-bg-glow-2"></div>

    <div class="kg-header">
      <div class="kg-title">
        <span class="kg-title-name">LongJie's Notes</span>
        <span class="kg-title-sub">Backend / Database / AI / Architecture</span>
      </div>
      <div class="kg-actions">
        <div class="kg-search">
          <svg class="kg-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="searchQuery"
            class="kg-search-input"
            type="text"
            placeholder="搜索节点…"
            spellcheck="false"
          />
          <button v-if="searchQuery" class="kg-search-clear" @click="searchQuery = ''" title="清除">×</button>
        </div>
        <a class="kg-btn" href="https://github.com/LongJie686/backend-notes" target="_blank" rel="noopener" title="GitHub">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: -2px;">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
              -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
              .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
              -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
              .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
              .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
              0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
        <a class="kg-btn kg-btn-home" :href="homeLink">← 返回首页</a>
      </div>
    </div>

    <svg ref="svgRef" class="kg-svg"></svg>

    <div class="kg-zoom-controls">
      <button class="kg-zoom-btn" @click="zoomBy(1.4)" title="放大">＋</button>
      <button class="kg-zoom-btn" @click="zoomBy(0.72)" title="缩小">－</button>
      <button class="kg-zoom-btn" @click="resetView" title="重置视图">⟳</button>
    </div>

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

    <div class="kg-stats">
      <span v-if="searchQuery">{{ matchCount }} / {{ nodeCount }} 命中</span>
      <span v-else>{{ nodeCount }} nodes</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useData, withBase } from 'vitepress'
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

const { site } = useData()
const homeLink = withBase('/')

const wrapperRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltip = ref<{ label: string; type: string } | null>(null)
const tooltipPos = ref({ x: 0, y: 0 })
const nodeCount = ref(0)
const searchQuery = ref('')
const matchCount = ref(0)

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

let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null

// Lifted refs for interaction controls (zoom / search)
let svgSel: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null
let nodeGroupSel: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null = null
let linkPathSel: d3.Selection<SVGPathElement, GraphEdge, SVGGElement, unknown> | null = null
let allEdges: GraphEdge[] = []
let initialTransform: d3.ZoomTransform | null = null

function edgeId(end: any): string {
  return typeof end === 'string' ? end : end.id
}

function defaultEdgeOpacity(e: GraphEdge): number {
  return e.type === 'cross-ref' ? 0.15 : 0.18
}
function defaultEdgeWidth(e: GraphEdge): number {
  return e.type === 'cross-ref' ? 0.6 : 1
}

function zoomBy(k: number) {
  if (!svgSel || !zoomBehavior) return
  svgSel.transition().duration(300).call(zoomBehavior.scaleBy, k)
}

function resetView() {
  if (!svgSel || !zoomBehavior || !initialTransform) return
  svgSel.transition().duration(500).call(zoomBehavior.transform, initialTransform)
}

function applySearch() {
  if (!nodeGroupSel || !linkPathSel) return
  const q = searchQuery.value.trim().toLowerCase()

  if (!q) {
    matchCount.value = 0
    nodeGroupSel.transition().duration(250).attr('opacity', 1)
    linkPathSel.transition().duration(250)
      .attr('stroke-opacity', d => defaultEdgeOpacity(d))
      .attr('stroke-width', d => defaultEdgeWidth(d))
    return
  }

  const matched = new Set<string>()
  nodeGroupSel.each((d) => {
    if (d.label.toLowerCase().includes(q)) matched.add(d.id)
  })
  matchCount.value = matched.size

  nodeGroupSel.transition().duration(250)
    .attr('opacity', d => (matched.has(d.id) ? 1 : 0.07))

  linkPathSel.transition().duration(250)
    .attr('stroke-opacity', (e) => {
      const s = edgeId((e as any).source)
      const t = edgeId((e as any).target)
      return matched.has(s) && matched.has(t) ? 0.6 : 0.03
    })
    .attr('stroke-width', (e) => {
      const s = edgeId((e as any).source)
      const t = edgeId((e as any).target)
      return matched.has(s) && matched.has(t) ? 1.6 : 0.5
    })
}

watch(searchQuery, () => applySearch())

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
  allEdges = edges

  nodeCount.value = nodes.length

  const width = wrapperRef.value.clientWidth
  const height = wrapperRef.value.clientHeight

  const svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height)
  svgSel = svg

  const g = svg.append('g')
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
  zoomBehavior = zoom
  svg.call(zoom)
  initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.65)
  svg.call(zoom.transform, initialTransform)

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

  // === Geometric Layout: center ring + fan children ===
  const topCats = nodes.filter(n => n.type === 'category' && !n.parent)
  const subCats = nodes.filter(n => n.type === 'category' && n.parent)
  const allArticles = nodes.filter(n => n.type === 'article')

  const R = 100           // top category ring radius
  const BASE = 80         // child base distance from parent
  const STEP = 60         // distance increment per layer
  const FAN_HALF = Math.PI / 8  // ±22.5°, gap between fans with slight edge overlap

  const nodeTargets = new Map<string, { x: number; y: number }>()

  // Layer capacity: layer 0 = 3, layer 1 = 5, layer 2 = 7, then keep 7
  const LAYER_CAP = [3, 5, 7]

  function distributeLayers(count: number): number[] {
    const result: number[] = []
    let remaining = count
    let idx = 0
    while (remaining > 0) {
      const cap = LAYER_CAP[Math.min(idx, LAYER_CAP.length - 1)]
      const take = Math.min(cap, remaining)
      result.push(take)
      remaining -= take
      idx++
    }
    return result
  }

  // 1. Top categories evenly on circle
  topCats.forEach((cat, i) => {
    const theta = (2 * Math.PI * i) / topCats.length - Math.PI / 2
    nodeTargets.set(cat.id, { x: R * Math.cos(theta), y: R * Math.sin(theta) })
  })

  // 2. Direct children of each top category
  topCats.forEach(cat => {
    const catPos = nodeTargets.get(cat.id)!
    const dir = Math.atan2(catPos.y, catPos.x)
    const catSubs = subCats.filter(s => s.parent === cat.id)
    const catArts = allArticles.filter(a => a.parent === cat.id)

    const SUB_CAT_HALF = Math.PI / 9  // ±20° for sub-cats
    if (catSubs.length > 0) {
      const subDist = BASE + 2 * STEP
      catSubs.forEach((sub, si) => {
        const t = catSubs.length <= 1 ? 0.5 : si / (catSubs.length - 1)
        const angle = dir - SUB_CAT_HALF + t * 2 * SUB_CAT_HALF
        nodeTargets.set(sub.id, {
          x: catPos.x + subDist * Math.cos(angle),
          y: catPos.y + subDist * Math.sin(angle)
        })
      })
    }

    if (catArts.length > 0) {
      const layers = distributeLayers(catArts.length)
      let offset = 0
      layers.forEach((count, li) => {
        const layerIdx = li < 2 ? li : li + 1
        const dist = BASE + layerIdx * STEP
        const layerNodes = catArts.slice(offset, offset + count)
        layerNodes.forEach((art, ci) => {
          const t = count <= 1 ? 0.5 : ci / (count - 1)
          const angle = dir - FAN_HALF + t * 2 * FAN_HALF
          nodeTargets.set(art.id, {
            x: catPos.x + dist * Math.cos(angle),
            y: catPos.y + dist * Math.sin(angle)
          })
        })
        offset += count
      })
    }
  })

  // 3. Sub-cat articles: fan out from sub-cat position
  const SUB_ART_CAP = [3, 3, 5]
  subCats.forEach(sub => {
    const subPos = nodeTargets.get(sub.id)
    if (!subPos) return
    const dir = Math.atan2(subPos.y, subPos.x)
    const subArts = allArticles.filter(a => a.parent === sub.id)

    const caps: number[] = []
    let rem = subArts.length
    let ci = 0
    while (rem > 0) {
      const cap = SUB_ART_CAP[Math.min(ci, SUB_ART_CAP.length - 1)]
      const take = Math.min(cap, rem)
      caps.push(take)
      rem -= take
      ci++
    }

    const SUB_ART_HALF = Math.PI / 14
    const ART_PAD = 0.02
    let offset = 0
    caps.forEach((count, li) => {
      const dist = BASE + li * STEP
      const layerNodes = subArts.slice(offset, offset + count)
      layerNodes.forEach((art, ci) => {
        const t = count <= 1 ? 0.5 : ci / (count - 1)
        const angle = dir - SUB_ART_HALF + ART_PAD + t * (2 * SUB_ART_HALF - 2 * ART_PAD)
        nodeTargets.set(art.id, {
          x: subPos.x + dist * Math.cos(angle),
          y: subPos.y + dist * Math.sin(angle)
        })
      })
      offset += count
    })
  })

  // Set fixed positions (fx/fy lock nodes in place)
  nodes.forEach(n => {
    const t = nodeTargets.get(n.id)
    if (t) {
      n.x = t.x
      n.y = t.y
      n.fx = t.x
      n.fy = t.y
    }
  })

  // Minimal simulation — only used for tick rendering and drag, no layout forces
  simulation = d3.forceSimulation<GraphNode>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
      .id(d => d.id).distance(60).strength(0)
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength(0))
    .force('center', d3.forceCenter(0, 0).strength(0))
    .alphaDecay(1)

  // Curved edge paths
  const linkPath = g.append('g')
    .selectAll<SVGPathElement, GraphEdge>('path')
    .data(edges)
    .join('path')
    .attr('class', d => `kg-edge kg-edge-${d.type}`)
    .attr('fill', 'none')
    .attr('stroke', d => {
      if (d.type === 'cross-ref') return 'rgba(255,200,100,0.18)'
      const src = typeof d.source === 'string' ? d.source : (d.source as GraphNode)
      return (src as GraphNode).color || '#999'
    })
    .attr('stroke-width', d => defaultEdgeWidth(d))
    .attr('stroke-opacity', d => defaultEdgeOpacity(d))
    .attr('stroke-dasharray', d => d.type === 'cross-ref' ? '3,3' : 'none')
  linkPathSel = linkPath

  // Sort nodes: articles first, categories last (SVG render order)
  nodes.sort((a, b) => (a.type === 'category' ? 1 : 0) - (b.type === 'category' ? 1 : 0))

  // Node groups
  const nodeGroup = g.append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', d => `kg-node kg-node-${d.type}`)
    .style('cursor', 'pointer')
  nodeGroupSel = nodeGroup

  // Category nodes: transparent drag hit area
  nodeGroup.filter(d => d.type === 'category')
    .append('circle')
    .attr('r', 35)
    .attr('fill', 'transparent')
    .style('pointer-events', 'all')

  // Category nodes: outer glow ring
  nodeGroup.filter(d => d.type === 'category')
    .append('circle')
    .attr('r', 28)
    .attr('fill', 'none')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.25)
    .style('pointer-events', 'none')

  // Main circles
  nodeGroup.append('circle')
    .attr('class', 'node-circle')
    .attr('r', d => d.type === 'category' ? 22 : 8)
    .attr('fill', d => {
      if (d.type === 'category') return `url(#g-${d.label})`
      return d3.color(d.color)!.brighter(0.1).toString()
    })
    .attr('fill-opacity', d => d.type === 'category' ? 0.95 : 0.9)
    .attr('stroke', d => d.type === 'category' ? d3.color(d.color)!.brighter(0.3).toString() : d.color)
    .attr('stroke-width', d => d.type === 'category' ? 1.5 : 0.6)
    .attr('stroke-opacity', d => d.type === 'category' ? 0.8 : 0.5)
    .attr('filter', d => d.type === 'category' ? 'url(#glow)' : 'url(#shadow)')

  // Category labels (explicit light color — page is always dark)
  nodeGroup.filter(d => d.type === 'category')
    .append('text')
    .text(d => d.label)
    .attr('dy', 38).attr('text-anchor', 'middle')
    .attr('fill', '#eef2ff')
    .attr('font-size', '12.5px').attr('font-weight', '700')
    .attr('letter-spacing', '0.5px')
    .style('pointer-events', 'none')
    .style('text-shadow', '0 1px 4px rgba(0,0,0,0.6)')

  // Article labels
  nodeGroup.filter(d => d.type === 'article')
    .append('text')
    .text(d => d.label.length > 8 ? d.label.slice(0, 8) + '..' : d.label)
    .attr('dy', -13).attr('text-anchor', 'middle')
    .attr('fill', '#b8c2e0')
    .attr('font-size', '9.5px')
    .style('pointer-events', 'none')
    .style('text-shadow', '0 1px 3px rgba(0,0,0,0.55)')

  // Drag
  let dragged = false
  const drag = d3.drag<SVGGElement, GraphNode>()
    .on('start', (event) => {
      dragged = false
      if (!event.active) simulation?.alphaTarget(0.3).restart()
    })
    .on('drag', (event, d) => {
      dragged = true
      d.x = event.x; d.y = event.y
      d.fx = event.x; d.fy = event.y
    })
    .on('end', (event, d) => {
      if (!event.active) simulation?.alphaTarget(0)
      const t = nodeTargets.get(d.id)
      if (t) {
        d.fx = t.x; d.fy = t.y
        d.x = t.x; d.y = t.y
      }
    })
  nodeGroup.call(drag)

  // Hover
  nodeGroup
    .on('mouseover', (event: MouseEvent, d: GraphNode) => {
      if (searchQuery.value) return
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
      if (searchQuery.value) return
      nodeGroup.transition().duration(300).attr('opacity', 1)
      linkPath.transition().duration(300)
        .attr('stroke-opacity', d => defaultEdgeOpacity(d as GraphEdge))
        .attr('stroke-width', d => defaultEdgeWidth(d as GraphEdge))
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
  background: radial-gradient(120% 120% at 50% 0%, #0d1326 0%, #070a16 55%, #04060f 100%);
  overflow: hidden;
  font-family: var(--vp-font-family-base);
}

.kg-bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(130px);
  opacity: 0.35;
  pointer-events: none;
  z-index: 0;
}
.kg-bg-glow-1 {
  width: 540px;
  height: 540px;
  background: #4f7bff;
  top: -180px;
  left: -120px;
}
.kg-bg-glow-2 {
  width: 500px;
  height: 500px;
  background: #a64bff;
  bottom: -180px;
  right: -140px;
}

.kg-svg {
  position: relative;
  z-index: 1;
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
  gap: 12px;
  flex-wrap: wrap;
  padding: 20px 28px;
  z-index: 10;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(7, 10, 22, 0.9) 0%, transparent 100%);
}

.kg-header > *,
.kg-actions > * {
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
  background: linear-gradient(110deg, #7ad0ff, #9d7bff);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.kg-title-sub {
  font-size: 12px;
  color: #8c97b8;
  letter-spacing: 0.5px;
}

.kg-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

/* Search */
.kg-search {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid rgba(160, 180, 255, 0.2);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(8px);
  transition: border-color 0.2s;
}
.kg-search:focus-within {
  border-color: #7ad0ff;
}
.kg-search-icon {
  color: #7a86ad;
  flex-shrink: 0;
}
.kg-search-input {
  background: transparent;
  border: none;
  outline: none;
  color: #e6ecff;
  font-size: 13px;
  width: 130px;
}
.kg-search-input::placeholder {
  color: #6b7699;
}
.kg-search-clear {
  background: none;
  border: none;
  color: #8c97b8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
.kg-search-clear:hover {
  color: #ff7ad9;
}

.kg-btn {
  display: inline-flex;
  align-items: center;
  padding: 7px 16px;
  border: 1px solid rgba(160, 180, 255, 0.2);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  color: #c4cdec;
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.25s;
  letter-spacing: 0.3px;
  backdrop-filter: blur(8px);
}

.kg-btn:hover {
  border-color: #7ad0ff;
  color: #7ad0ff;
}

.kg-btn-home {
  background: linear-gradient(110deg, #4f7bff, #9d4bff);
  color: #fff;
  border-color: transparent;
  font-weight: 600;
}
.kg-btn-home:hover {
  color: #fff;
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45);
}

/* Zoom controls */
.kg-zoom-controls {
  position: absolute;
  right: 24px;
  bottom: 56px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
}
.kg-zoom-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid rgba(160, 180, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: #c4cdec;
  font-size: 18px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kg-zoom-btn:hover {
  border-color: #7ad0ff;
  color: #7ad0ff;
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
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(160, 180, 255, 0.15);
  border-radius: 12px;
  max-width: 520px;
  backdrop-filter: blur(10px);
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
  color: #c4cdec;
  white-space: nowrap;
}

.kg-tooltip {
  position: fixed;
  z-index: 100;
  padding: 10px 14px;
  background: rgba(13, 19, 38, 0.92);
  border: 1px solid rgba(160, 180, 255, 0.22);
  border-radius: 10px;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
}

.kg-tooltip-label {
  font-size: 13px;
  font-weight: 600;
  color: #eef2ff;
}

.kg-tooltip-type {
  font-size: 10px;
  color: #8c97b8;
  margin-top: 3px;
}

.kg-tooltip-hint {
  font-size: 10px;
  color: #7ad0ff;
  margin-top: 4px;
  letter-spacing: 0.3px;
}

.kg-stats {
  position: absolute;
  bottom: 20px;
  right: 24px;
  font-size: 11px;
  color: #8c97b8;
  z-index: 10;
  letter-spacing: 0.5px;
}

@media (max-width: 768px) {
  .kg-legend {
    bottom: 10px;
    left: 10px;
    padding: 8px 12px;
    gap: 8px 10px;
    max-width: 240px;
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
  .kg-search-input {
    width: 90px;
  }
  .kg-zoom-controls {
    bottom: 90px;
    right: 14px;
  }
}
</style>
