<template>
  <div class="hp" ref="rootRef">
    <canvas class="hp-stars" ref="canvasRef"></canvas>
    <div class="hp-glow hp-glow-1"></div>
    <div class="hp-glow hp-glow-2"></div>

    <!-- Hero -->
    <section class="hp-hero">
      <div class="hp-hero-inner">
        <p class="hp-eyebrow reveal">求职意向 · AI 应用工程师 / Python 后端工程师</p>
        <h1 class="hp-name reveal">LongJie</h1>
        <p class="hp-name-cn reveal">龙杰 · 数据科学与大数据技术 · 2026 届</p>
        <div class="hp-roles reveal">
          <span class="hp-roles-static">专注于</span>
          <span class="hp-roles-rotate" :key="roleIndex">{{ roles[roleIndex] }}</span>
        </div>
        <p class="hp-intro reveal">
          从系统设计、模型集成到工程落地的完整 AI 应用开发 ——
          把理论沉淀为可运行的系统，把笔记连成一张知识图谱。
        </p>
        <div class="hp-hero-actions reveal">
          <a class="hp-btn hp-btn-primary" :href="graphLink">探索知识图谱</a>
          <a class="hp-btn hp-btn-ghost" href="https://github.com/LongJie686" target="_blank" rel="noopener">GitHub</a>
        </div>
      </div>
      <a class="hp-scroll-hint" href="#metrics" aria-label="向下滚动">
        <span class="hp-scroll-text">向下滑动</span>
        <span class="hp-scroll-arrow"></span>
      </a>
    </section>

    <!-- Metrics -->
    <section class="hp-metrics" id="metrics">
      <div class="hp-metric reveal" v-for="m in metrics" :key="m.label">
        <div class="hp-metric-num">{{ m.num }}</div>
        <div class="hp-metric-label">{{ m.label }}</div>
      </div>
    </section>

    <!-- About + Education -->
    <section class="hp-section">
      <h2 class="hp-section-title reveal"><span class="hp-hash">#</span> 关于我</h2>
      <div class="hp-about">
        <p class="hp-about-text reveal">
          具备 AI 应用系统与后端工程的综合能力，能独立完成从系统设计、模型集成到工程落地的完整流程。
          在<strong>多智能体系统、RAG、Text-to-SQL</strong> 等方向有实际项目经验，具备较强的工程实现能力与性能优化意识（缓存、异步、消息队列）。
          有良好的问题拆解能力与技术自驱力，长期跟进前沿技术，持续总结 AI 应用与后端架构实践。
        </p>
        <div class="hp-edu reveal">
          <div class="hp-edu-head">
            <span class="hp-edu-school">四川民族学院</span>
            <span class="hp-edu-date">2022.09 - 2026.06</span>
          </div>
          <div class="hp-edu-major">数据科学与大数据技术 · 本科 · 学委</div>
          <ul class="hp-edu-list">
            <li>省级大学生创新创业项目（小程序云部署），负责后端接口与部署环境</li>
            <li>协助教师维护实验环境、调试演示代码，长期为同学解决环境与依赖问题</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Skills -->
    <section class="hp-section">
      <h2 class="hp-section-title reveal"><span class="hp-hash">#</span> 技术栈</h2>
      <div class="hp-skills">
        <div class="hp-skill-group reveal" v-for="group in skills" :key="group.name" :style="{ '--accent': group.color }">
          <div class="hp-skill-head">
            <span class="hp-skill-dot"></span>
            <span class="hp-skill-name">{{ group.name }}</span>
          </div>
          <div class="hp-skill-tags">
            <span class="hp-tag" v-for="tag in group.items" :key="tag">{{ tag }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Experience timeline -->
    <section class="hp-section">
      <h2 class="hp-section-title reveal"><span class="hp-hash">#</span> 工作经历</h2>
      <div class="hp-timeline">
        <div class="hp-tl-item reveal" v-for="job in experience" :key="job.org">
          <div class="hp-tl-dot"></div>
          <div class="hp-tl-card">
            <div class="hp-tl-top">
              <span class="hp-tl-role">{{ job.role }}</span>
              <span class="hp-tl-date">{{ job.date }}</span>
            </div>
            <div class="hp-tl-org">{{ job.org }}</div>
            <ul class="hp-tl-points">
              <li v-for="(pt, i) in job.points" :key="i">{{ pt }}</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Delivery / field work -->
    <section class="hp-section">
      <h2 class="hp-section-title reveal"><span class="hp-hash">#</span> 落地交付</h2>
      <p class="hp-section-sub reveal">从需求调研、现场实施到培训与云端部署，覆盖项目落地的完整链路。</p>
      <div class="hp-delivery">
        <div class="hp-deliver-item reveal" v-for="d in delivery" :key="d.tag">
          <span class="hp-deliver-tag">{{ d.tag }}</span>
          <p class="hp-deliver-text">{{ d.text }}</p>
        </div>
      </div>
    </section>

    <!-- Projects -->
    <section class="hp-section">
      <h2 class="hp-section-title reveal"><span class="hp-hash">#</span> 实战项目</h2>
      <div class="hp-projects">
        <a
          class="hp-project reveal"
          v-for="p in projects"
          :key="p.title"
          :href="p.link"
          :target="p.external ? '_blank' : '_self'"
          :rel="p.external ? 'noopener' : undefined"
          :style="{ '--accent': p.color }"
        >
          <div class="hp-project-top">
            <span class="hp-project-tag">{{ p.tag }}</span>
            <span class="hp-project-arrow">{{ p.external ? '↗' : '→' }}</span>
          </div>
          <h3 class="hp-project-title">{{ p.title }}</h3>
          <p class="hp-project-desc">{{ p.desc }}</p>
          <div class="hp-project-metrics" v-if="p.highlight">{{ p.highlight }}</div>
          <div class="hp-project-stack">
            <span v-for="t in p.stack" :key="t">{{ t }}</span>
          </div>
        </a>
      </div>
    </section>

    <!-- More projects -->
    <section class="hp-section">
      <h2 class="hp-section-title reveal"><span class="hp-hash">#</span> 更多项目</h2>
      <div class="hp-more">
        <div class="hp-more-item reveal" v-for="mp in moreProjects" :key="mp.name">
          <div class="hp-more-name">{{ mp.name }}</div>
          <div class="hp-more-tech">{{ mp.tech }}</div>
          <div class="hp-more-metric">{{ mp.metric }}</div>
        </div>
      </div>
    </section>

    <!-- Explore / CTA -->
    <section class="hp-explore" id="explore">
      <div class="hp-explore-inner reveal">
        <h2 class="hp-explore-title">把全部笔记<br />连成一张<span class="hp-grad">知识图谱</span></h2>
        <p class="hp-explore-sub">9 大领域 · 100+ 节点 · 跨学科链接，点击节点即可进入对应笔记。</p>
        <a class="hp-btn hp-btn-primary hp-btn-lg" :href="graphLink">进入知识图谱 →</a>
        <div class="hp-social">
          <a href="mailto:longchengjie686@gmail.com">longchengjie686@gmail.com</a>
          <span class="hp-social-sep">·</span>
          <a href="https://github.com/LongJie686" target="_blank" rel="noopener">GitHub</a>
          <span class="hp-social-sep">·</span>
          <a href="https://github.com/LongJie686/backend-notes" target="_blank" rel="noopener">仓库</a>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { withBase } from 'vitepress'

const graphLink = withBase('/graph')

const roles = ['多智能体系统', 'RAG / Text-to-SQL', '高并发后端架构', 'AI 应用工程']
const roleIndex = ref(0)

const metrics = [
  { num: '1200+', label: '电商推荐压测 QPS（50 并发）' },
  { num: '42ms', label: '核心接口 P90 延迟' },
  { num: '100+', label: 'AI 数字人 WebSocket 并发' },
  { num: '40~60%', label: 'Token 成本下降' },
]

const skills = [
  { name: '编程语言', color: '#42A5F5', items: ['Python', 'Java', 'C'] },
  { name: '后端开发', color: '#29B6F6', items: ['FastAPI', 'Django', 'AsyncIO', 'RESTful API', 'WebSocket'] },
  { name: 'AI 应用', color: '#AB47BC', items: ['RAG / LangChain', 'AI Agent', '多智能体', 'Text-to-SQL', 'Prompt', 'LLM 集成'] },
  { name: '数据与存储', color: '#66BB6A', items: ['MySQL', 'PostgreSQL', 'Redis', 'pgvector'] },
  { name: '数据处理', color: '#26A69A', items: ['ETL', 'NumPy', 'OpenCV', 'PyMuPDF', '向量化'] },
  { name: '系统与架构', color: '#FF7043', items: ['微服务', '多级缓存', 'Kafka', 'Docker', 'AWS', '阿里云'] },
  { name: '多模态', color: '#FFA726', items: ['Whisper / FunASR', 'GPT-SoVITS', '情感分析', 'Live2D'] },
]

const experience = [
  {
    role: 'AI 全栈实习生',
    org: '四川奇点引擎科技有限公司',
    date: '2025.07 - 2025.10',
    points: [
      'AI 数字人 Open-LLM-VTuber：集成 8+ STT / 10+ TTS，情感分析 + Live2D 动作，WebSocket 100+ 并发',
      'APrint 智能印刷 CRM：Django 全栈 + AI 日报/异常预警，日订单 200+，效率提升 30%',
      'Compare-PDF 比对工具：OpenCV 像素级差异检测，准确率 98%，人工成本降低 60%',
    ],
  },
  {
    role: '后端开发实习生',
    org: '成都矢量科技有限公司',
    date: '2025.10 - 2026.03',
    points: [
      '智能问数 ChatBI：NL2SQL 多数据源（PG/MySQL/ClickHouse 等）+ 企微 OAuth + AI 看板 + PPT 导出',
      '链路监测 LinkMon：iperf3 带宽/丢包/抖动测量 + 分段健康指数 + SNMP v1/v2c/v3 + TRAP 告警',
      '气象局根因分析：5 维故障排查 + 天镜2.0 对接 + LangChain·DeepSeek 流式诊断助手',
      '疾控中心传染病防控：风险等级评估（非流行期/低/中/高）+ 防控建议智能生成',
    ],
  },
]

const delivery = [
  { tag: '需求调研', text: '走进印刷车间与一线工人面对面梳理需求，把模糊诉求转化为可落地的流程管理系统，上线后获车间好评' },
  { tag: '现场实施', text: '赴绵阳疾控中心驻场实施，完成数字人系统的线下部署与联调' },
  { tag: '企业培训', text: '受邀在国家超高清视频制作中心，为客户员工开展系统使用培训' },
  { tag: '接口设计', text: '为四川省气象局设计并对接监测接口（天镜2.0），打通故障诊断数据链路' },
  { tag: '云端部署', text: '在 AWS、阿里云等云服务器完成多个项目的部署上线与环境运维' },
]

const moreProjects = [
  { name: 'AI 简历助手 · resume-ai', tech: 'FastAPI · 多厂商 LLM · 微信小程序', metric: '五维评分 · STAR 润色 · 岗位匹配 · CI 覆盖 80%+' },
  { name: '商品信息智能分析推荐平台', tech: 'Flask · Hive · HDFS', metric: '爬虫 10万+/日 · 推荐准确率 85%+' },
  { name: '大数据电商数仓平台', tech: 'Hadoop · Kafka · Flume', metric: 'TB 级分布式存储与实时处理' },
  { name: '网站流量日志分析系统', tech: 'Hadoop 伪分布式', metric: '流量监控 + 用户行为预测' },
  { name: '智能人脸识别系统', tech: 'OpenCV · Tkinter · MySQL', metric: '采集→特征→认证，准确率 95%+' },
  { name: '图像拼接面积测算', tech: 'Computer Vision', metric: '多图智能拼接，测量精度 98%+' },
]

const projects = [
  {
    title: 'Synapse',
    tag: '多智能体 AI 平台',
    desc: '面向复杂任务的多智能体平台，支持任务规划、RAG 检索与工具调用的完整工作流。',
    highlight: '4 种编排模式 · MCP 15+ 工具 · Token -40~60%',
    stack: ['FastAPI', 'LangChain', 'pgvector', 'Docker'],
    link: 'https://github.com/LongJie686/synapse',
    color: '#AB47BC',
    external: true,
  },
  {
    title: '电商推荐微服务',
    tag: '高并发 · 微服务',
    desc: '6 服务独立部署的电商推荐系统，多级缓存 + 限流熔断 + Kafka 异步管道。',
    highlight: 'QPS 1200+ · P90 42ms · 缓存降延迟约 80%',
    stack: ['FastAPI', 'MySQL', 'Redis', 'Kafka'],
    link: 'https://github.com/LongJie686/ecommerce-microservices',
    color: '#42A5F5',
    external: true,
  },
  {
    title: '智能问数 ChatBI',
    tag: '企业级 NL2SQL',
    desc: '对话式数据分析系统，Text-to-SQL 多数据源 + 自动可视化 + AI 看板 + PPT 导出。',
    highlight: '多数据源 · pyecharts/G2 可视化 · 企微 OAuth',
    stack: ['FastAPI', 'PostgreSQL', 'pgvector', 'LangChain'],
    link: withBase('/ai-app/text-to-sql/'),
    color: '#26A69A',
    external: false,
  },
]

let roleTimer: ReturnType<typeof setInterval> | undefined
let rafId = 0
let cleanupReveal: (() => void) | undefined

const rootRef = ref<HTMLElement>()
const canvasRef = ref<HTMLCanvasElement>()

function startStarfield() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  let w = 0
  let h = 0
  let stars: { x: number; y: number; z: number; r: number }[] = []

  const resize = () => {
    w = canvas.width = window.innerWidth
    h = canvas.height = window.innerHeight
    const count = Math.min(180, Math.floor((w * h) / 11000))
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 0.8 + 0.2,
      r: Math.random() * 1.4 + 0.3,
    }))
  }
  resize()
  window.addEventListener('resize', resize)

  const draw = () => {
    ctx.clearRect(0, 0, w, h)
    for (const s of stars) {
      s.y += s.z * 0.25
      if (s.y > h) {
        s.y = 0
        s.x = Math.random() * w
      }
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(150, 200, 255, ${s.z * 0.7})`
      ctx.fill()
    }
    rafId = requestAnimationFrame(draw)
  }
  draw()

  return () => window.removeEventListener('resize', resize)
}

let cleanupStars: (() => void) | undefined

onMounted(() => {
  document.body.classList.add('hp-immersive')

  roleTimer = setInterval(() => {
    roleIndex.value = (roleIndex.value + 1) % roles.length
  }, 2600)

  cleanupStars = startStarfield()

  // Scroll-direction reveal driven by each element's LAYOUT position (offsetTop),
  // which is transform-independent — so the IN/OUT animations moving the element
  // around never feed back into the trigger logic (no flicker loop):
  //   - scroll down, element enters band -> meteor slam IN (.is-visible)
  //   - scroll up,   element leaves band -> reverse meteor OUT (.is-leaving)
  type RevealItem = { el: HTMLElement; visible: boolean; top: number; h: number }
  let items: RevealItem[] = []

  // layout position via offset chain — unaffected by CSS transforms (animations)
  const layoutTop = (el: HTMLElement) => {
    let y = 0
    let node: HTMLElement | null = el
    while (node) {
      y += node.offsetTop
      node = node.offsetParent as HTMLElement | null
    }
    return y
  }
  const measure = () => {
    items.forEach((it) => {
      it.top = layoutTop(it.el)
      it.h = it.el.offsetHeight
    })
  }

  const update = () => {
    const vTop = window.scrollY
    const vBottom = vTop + window.innerHeight
    const pad = window.innerHeight * 0.12
    for (const it of items) {
      const inBand = it.top < vBottom - pad && it.top + it.h > vTop + pad
      if (inBand && !it.visible) {
        it.visible = true
        it.el.classList.add('is-visible')
      } else if (!inBand && it.visible) {
        it.visible = false
        it.el.classList.remove('is-visible')
      }
    }
  }

  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      update()
      ticking = false
    })
  }
  const onResize = () => {
    measure()
    update()
  }

  // collect targets and run an initial pass (hero reveals immediately)
  items = Array.from(rootRef.value?.querySelectorAll<HTMLElement>('.reveal') ?? []).map(
    (el) => ({ el, visible: false, top: 0, h: 0 })
  )
  measure()
  update()
  // re-measure once more after layout/fonts settle
  setTimeout(() => { measure(); update() }, 300)

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  cleanupReveal = () => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
  }
})

onBeforeUnmount(() => {
  document.body.classList.remove('hp-immersive')
  if (roleTimer) clearInterval(roleTimer)
  if (rafId) cancelAnimationFrame(rafId)
  cleanupStars?.()
  cleanupReveal?.()
})
</script>

<style>
/* Immersive: hide VitePress chrome on the landing page */
body.hp-immersive .VPNav,
body.hp-immersive .VPLocalNav,
body.hp-immersive .VPSidebar {
  display: none !important;
}
body.hp-immersive .VPContent {
  padding: 0 !important;
}
body.hp-immersive .VPContent.has-sidebar {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
body.hp-immersive .VPPage {
  margin: 0 !important;
}
</style>

<style scoped>
.hp {
  position: relative;
  background: radial-gradient(120% 120% at 50% 0%, #0d1326 0%, #070a16 55%, #04060f 100%);
  color: #e6ecff;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.hp-stars {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.hp-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.4;
  pointer-events: none;
  z-index: 0;
}
.hp-glow-1 {
  width: 520px;
  height: 520px;
  background: #4f7bff;
  top: -160px;
  left: -120px;
}
.hp-glow-2 {
  width: 480px;
  height: 480px;
  background: #a64bff;
  top: 30%;
  right: -160px;
}

.hp section,
.hp-hero {
  position: relative;
  z-index: 1;
}

/* Hero */
.hp-hero {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 24px;
}
.hp-hero-inner {
  max-width: 860px;
}
.hp-eyebrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #5ad6ff;
  letter-spacing: 1px;
  font-size: 14px;
  margin-bottom: 18px;
}
.hp-name {
  font-size: clamp(56px, 12vw, 132px);
  line-height: 1;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(110deg, #7ad0ff 0%, #9d7bff 50%, #ff7ad9 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -2px;
}
.hp-name-cn {
  margin: 14px 0 0;
  color: #c4cdec;
  font-size: clamp(15px, 2.6vw, 19px);
  letter-spacing: 1px;
}
.hp-roles {
  margin-top: 18px;
  font-size: clamp(18px, 3.4vw, 30px);
  font-weight: 600;
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
}
.hp-roles-static {
  color: #8c97b8;
  font-weight: 400;
}
.hp-roles-rotate {
  color: #9d7bff;
  animation: hpFadeUp 0.5s ease;
}
.hp-intro {
  margin: 26px auto 0;
  max-width: 640px;
  color: #aab4d4;
  font-size: 16px;
  line-height: 1.8;
}
.hp-hero-actions {
  margin-top: 38px;
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}

.hp-btn {
  display: inline-flex;
  align-items: center;
  padding: 13px 28px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.hp-btn-primary {
  color: #fff;
  background: linear-gradient(110deg, #4f7bff, #9d4bff);
  box-shadow: 0 8px 30px rgba(99, 102, 241, 0.4);
}
.hp-btn-primary:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 40px rgba(99, 102, 241, 0.55);
}
.hp-btn-ghost {
  color: #cdd6f4;
  border: 1px solid rgba(160, 180, 255, 0.25);
  background: rgba(255, 255, 255, 0.03);
}
.hp-btn-ghost:hover {
  transform: translateY(-3px);
  border-color: rgba(160, 180, 255, 0.5);
}
.hp-btn-lg {
  padding: 16px 40px;
  font-size: 17px;
}

.hp-scroll-hint {
  position: absolute;
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #7a86ad;
  text-decoration: none;
  font-size: 12px;
  letter-spacing: 1px;
}
.hp-scroll-arrow {
  width: 22px;
  height: 22px;
  border-right: 2px solid #7a86ad;
  border-bottom: 2px solid #7a86ad;
  transform: rotate(45deg);
  animation: hpBounce 1.6s infinite;
}

/* Metrics band */
.hp-metrics {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 24px 10px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
}
.hp-metric {
  text-align: center;
  padding: 26px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
}
.hp-metric-num {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 800;
  background: linear-gradient(110deg, #7ad0ff, #9d7bff);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hp-metric-label {
  margin-top: 8px;
  color: #99a3c4;
  font-size: 13px;
  line-height: 1.5;
}

/* Sections */
.hp-section {
  max-width: 1080px;
  margin: 0 auto;
  padding: 80px 24px;
}
.hp-section-title {
  font-size: clamp(28px, 5vw, 42px);
  font-weight: 800;
  margin: 0 0 44px;
}
.hp-section-sub {
  margin: -32px 0 36px;
  color: #99a3c4;
  font-size: 15px;
}
.hp-hash {
  color: #5ad6ff;
  margin-right: 8px;
}

/* Delivery */
.hp-delivery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}
.hp-deliver-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
  border-radius: 14px;
  padding: 22px;
  transition: transform 0.22s ease, border-color 0.22s ease;
}
.hp-deliver-item:hover {
  transform: translateY(-4px);
  border-color: #5ad6ff;
}
.hp-deliver-tag {
  align-self: flex-start;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 13px;
  border-radius: 999px;
  color: #5ad6ff;
  background: rgba(90, 214, 255, 0.1);
  border: 1px solid rgba(90, 214, 255, 0.3);
}
.hp-deliver-text {
  margin: 0;
  color: #b6c0de;
  font-size: 14px;
  line-height: 1.7;
}

/* About */
.hp-about {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 28px;
}
.hp-about-text {
  color: #b6c0de;
  font-size: 16px;
  line-height: 1.95;
}
.hp-about-text strong {
  color: #7ad0ff;
  font-weight: 600;
}
.hp-edu {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
  border-radius: 16px;
  padding: 24px;
}
.hp-edu-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
.hp-edu-school {
  font-weight: 700;
  font-size: 18px;
}
.hp-edu-date {
  color: #8c97b8;
  font-size: 13px;
  font-family: ui-monospace, monospace;
}
.hp-edu-major {
  margin-top: 6px;
  color: #9d7bff;
  font-size: 14px;
}
.hp-edu-list {
  margin: 16px 0 0;
  padding-left: 18px;
  color: #99a3c4;
  font-size: 13.5px;
  line-height: 1.8;
}
/* More projects */
.hp-more {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}
.hp-more-item {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
  border-left: 3px solid #7986CB;
  border-radius: 12px;
  padding: 18px 20px;
  transition: transform 0.22s ease, border-color 0.22s ease;
}
.hp-more-item:hover {
  transform: translateX(4px);
  border-left-color: #7ad0ff;
}
.hp-more-name {
  font-weight: 700;
  font-size: 15px;
  color: #e6ecff;
}
.hp-more-tech {
  margin-top: 6px;
  font-size: 12px;
  color: #7ad0ff;
  font-family: ui-monospace, monospace;
}
.hp-more-metric {
  margin-top: 8px;
  font-size: 12.5px;
  color: #99a3c4;
}

/* Skills */
.hp-skills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}
.hp-skill-group {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
  border-radius: 16px;
  padding: 24px;
  transition: transform 0.25s ease, border-color 0.25s ease;
}
.hp-skill-group:hover {
  transform: translateY(-4px);
  border-color: var(--accent);
}
.hp-skill-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}
.hp-skill-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
}
.hp-skill-name {
  font-weight: 700;
  font-size: 17px;
}
.hp-skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hp-tag {
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(160, 180, 255, 0.12);
  color: #c4cdec;
}

/* Timeline */
.hp-timeline {
  position: relative;
  padding-left: 28px;
}
.hp-timeline::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: linear-gradient(180deg, #7ad0ff, #9d7bff, transparent);
}
.hp-tl-item {
  position: relative;
  margin-bottom: 26px;
}
.hp-tl-dot {
  position: absolute;
  left: -28px;
  top: 22px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #9d7bff;
  box-shadow: 0 0 12px #9d7bff;
  border: 3px solid #0a0e1a;
}
.hp-tl-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
  border-radius: 16px;
  padding: 22px 24px;
}
.hp-tl-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.hp-tl-role {
  font-weight: 700;
  font-size: 17px;
}
.hp-tl-date {
  color: #8c97b8;
  font-size: 13px;
  font-family: ui-monospace, monospace;
}
.hp-tl-org {
  margin-top: 4px;
  color: #7ad0ff;
  font-size: 14px;
}
.hp-tl-points {
  margin: 14px 0 0;
  padding-left: 18px;
  color: #aab4d4;
  font-size: 14px;
  line-height: 1.8;
}

/* Projects */
.hp-projects {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 22px;
}
.hp-project {
  display: block;
  text-decoration: none;
  color: inherit;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(160, 180, 255, 0.12);
  border-radius: 18px;
  padding: 28px;
  position: relative;
  overflow: hidden;
  transition: transform 0.25s ease, border-color 0.25s ease;
}
.hp-project::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 80% at 0% 0%, var(--accent) 0%, transparent 45%);
  opacity: 0.08;
  transition: opacity 0.25s ease;
}
.hp-project:hover {
  transform: translateY(-6px);
  border-color: var(--accent);
}
.hp-project:hover::before {
  opacity: 0.16;
}
.hp-project-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.hp-project-tag {
  font-size: 12px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 4px 12px;
}
.hp-project-arrow {
  font-size: 20px;
  color: #8c97b8;
}
.hp-project-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 10px;
}
.hp-project-desc {
  color: #aab4d4;
  font-size: 14px;
  line-height: 1.7;
  margin: 0 0 14px;
}
.hp-project-metrics {
  font-size: 12.5px;
  color: var(--accent);
  margin-bottom: 18px;
  font-family: ui-monospace, monospace;
}
.hp-project-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hp-project-stack span {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #c4cdec;
}

/* Explore CTA */
.hp-explore {
  padding: 110px 24px 130px;
  text-align: center;
}
.hp-explore-title {
  font-size: clamp(34px, 6vw, 62px);
  font-weight: 800;
  line-height: 1.2;
  margin: 0 0 22px;
}
.hp-grad {
  background: linear-gradient(110deg, #7ad0ff, #9d7bff, #ff7ad9);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hp-explore-sub {
  color: #aab4d4;
  font-size: 16px;
  margin: 0 0 40px;
}
.hp-social {
  margin-top: 36px;
  color: #7a86ad;
  font-size: 14px;
}
.hp-social a {
  color: #aab4d4;
  text-decoration: none;
  transition: color 0.2s ease;
}
.hp-social a:hover {
  color: #7ad0ff;
}
.hp-social-sep {
  margin: 0 12px;
}

/* Meteor reveal via transitions — interruption-safe and fully reversible:
   scroll down -> slam in (.is-visible); scroll up -> retrace back out.
   Transitions never get stuck mid-flight the way replayed keyframes can. */
.reveal {
  position: relative;
  opacity: 0;
  transform: translate3d(120px, -300px, 0) scale(1.1) rotate(2deg);
  filter: blur(5px);
  transition:
    opacity 0.55s ease,
    transform 0.9s cubic-bezier(0.34, 1.4, 0.5, 1),
    filter 0.5s ease;
  will-change: transform, opacity, filter;
}
.reveal.is-visible {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1) rotate(0);
  filter: blur(0);
}

@keyframes hpFadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes hpBounce {
  0%,
  100% {
    transform: rotate(45deg) translate(0, 0);
  }
  50% {
    transform: rotate(45deg) translate(6px, 6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    transition: none;
    opacity: 1;
    transform: none;
    filter: none;
  }
}

@media (max-width: 860px) {
  .hp-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .hp-about {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .hp-section {
    padding: 60px 20px;
  }
  .hp-hero-actions {
    flex-direction: column;
    width: 100%;
  }
  .hp-btn {
    justify-content: center;
  }
}
</style>
