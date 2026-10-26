<script setup>
import { ref, computed, watch } from 'vue'
import Icon from '../Icon.vue'
import StoryboardPanel from './StoryboardPanel.vue'
import WorksPanel from './WorksPanel.vue'
import ShotEditor from './ShotEditor.vue'
import { readStore, writeStore } from '../../lib/store.js'

/** 上次选的字幕样式 / 版式，切菜单或刷新回来还在 */
const SAVED_E = readStore('edit', {}) || {}
const upVideo = ref(SAVED_E.upVideo || null)
const upAudio = ref(SAVED_E.upAudio || null)

/** 两个视图：分镜稿（只出文本）/ 后期成片（真渲染，要蝉豆） */
const mode = ref(SAVED_E.mode || 'sheet')
watch(mode, (v) => writeStore('edit', { ...SAVED_E, capStyle: capStyle.value, layout: layout.value, smartPlan: smartPlan.value, mode: v }))

const props = defineProps({
  script: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
})

const opts = ref({
  caption: true,
  broll: true,
  bgm: false,
  cta: true,
})

const capStyle = ref(SAVED_E.capStyle || 'word')
/** key 跟后端 Subtitles 的 variant 对齐：karaoke / line / punch */
const capStyles = [
  { key: 'word', label: '逐字高亮', desc: '说到哪亮到哪 · 没说的压暗', sample: '说到哪亮哪', variant: 'karaoke' },
  { key: 'line', label: '整句上屏', desc: '整句硬现硬走，稳重不抢戏', sample: '整句上屏不抢戏', variant: 'line' },
  { key: 'bold', label: '大字冲击', desc: '无底框大字 + 回弹入场', sample: '大字冲击', variant: 'punch' },
]

/** 前端 key → 后端 variant */
const capVariant = computed(() => capStyles.find((c) => c.key === capStyle.value)?.variant || 'line')

const layout = ref(SAVED_E.layout || 'pip')
/** 智能分镜：大模型读稿子决定切点 + 卡片文案 */
const smartPlan = ref(SAVED_E.smartPlan !== false)
/** 完成后回报这次用了哪种分镜 */
const planMode = ref('')
const planNote = ref('')
const cards = ref(null)
const layouts = [
  { key: 'full', label: '全屏口播', desc: '人物铺满画面' },
  { key: 'pip', label: '人物右下', desc: '配信息卡' },
  { key: 'pip-bl', label: '人物左下', desc: '配信息卡' },
]

watch([capStyle, layout, smartPlan], () => {
  writeStore('edit', { capStyle: capStyle.value, layout: layout.value, smartPlan: smartPlan.value })
})

const rendering = ref(false)
const done = ref(false)
const progress = ref(0)
const stage = ref('')
const errorMsg = ref('')
const outputUrl = ref('')
const spec = ref(null)
/** 改分镜需要 jobId 响应式（jobId 本身是普通变量，模板读不到变化） */
const curJobId = ref('')
const shotOpen = ref(false)
let jobId = ''
let pollTimer = null

function editShots() {
  if (!curJobId.value) return
  shotOpen.value = true
}

function onShotsDone(e) {
  if (e?.pending) return
  // 同一个文件路径被覆盖，不加时间戳浏览器会用旧缓存
  if (outputUrl.value) outputUrl.value = outputUrl.value.split('?')[0] + '?v=' + Date.now()
}

/** 管线：必须和后端 talkcraft.doRun 的 up() 阶段名一一对应，不然状态对不上 */
const PIPE = [
  { key: 'audio', label: '音频提取', desc: '从数字人原片抽原声 · 口型与声音同源', stage: '音频提取' },
  { key: 'mat', label: '素材采集', desc: '按音频长度裁人物 · 抽静帧和波形', stage: '素材采集' },
  { key: 'ts', label: '字级时间戳', desc: 'FireRed 逐字对齐到 20–40ms', stage: '字级时间戳' },
  { key: 'plan', label: '分镜规划', desc: '按句边界切镜 + 卡库动效 + 音效落点', stage: '分镜规划' },
  { key: 'render', label: '画面渲染', desc: 'Remotion 逐帧渲 1080p', stage: 'Remotion 渲染' },
  { key: 'gate', label: '质量闸', desc: '静止 / 抖动 / 响度检测，不过闸不放行', stage: '质量闸' },
]

/** 当前跑到第几条（-1 = 还在排队或没开始） */
const curIdx = computed(() => PIPE.findIndex((p) => stage.value.includes(p.stage)))

function pipeState(i) {
  if (done.value) return 'done'
  if (!rendering.value) return 'idle'
  if (curIdx.value < 0) return 'idle'
  if (i < curIdx.value) return 'done'
  if (i === curIdx.value) return 'run'
  return 'idle'
}

/** 标签上写真实数字，不写死 */
function pipeTag(i) {
  const st = pipeState(i)
  const m = spec.value || {}
  // 后端 meta.shots 是镜头数组，数量要取 length
  const shotN = Array.isArray(m.shots) ? m.shots.length : m.shots
  if (st === 'run') return '进行中'
  if (st === 'done') {
    if (PIPE[i].key === 'plan' && shotN) return `${shotN} 镜`
    if (PIPE[i].key === 'gate') return m.gate || '通过'
    return '✓'
  }
  if (PIPE[i].key === 'plan' && shotN) return `${shotN} 镜`
  if (PIPE[i].key === 'gate' && m.gate) return m.gate
  return '待开始'
}

const stages = ['音频提取', '素材采集', '字级时间戳', '分镜规划', 'Remotion 渲染', '质量闸']

/** 选素材：无声视频 + 独立配音。
 *  桌面端（window.__ELECTRON__）：弹原生文件框，只交本地路径，后端硬链接零拷贝；
 *  网页端：还是 <input type=file> 二进制上传。 */
const uploading = ref('')      // 'video' | 'audio' | ''

async function acceptAsset(kind, d, name) {
  if (!d.ok) throw new Error(d.error || '上传失败')
  const rec = { file: d.data.file, mb: d.data.mb, name: name || d.data.name || d.data.file }
  if (kind === 'video') upVideo.value = rec
  else upAudio.value = rec
  writeStore('edit', { upVideo: upVideo.value, upAudio: upAudio.value })
}

async function pickAsset(kind) {
  uploading.value = kind
  errorMsg.value = ''
  try {
    // 桌面端：原生文件框 + 路径直读，154MB 的片子一秒都不用等
    if (window.__ELECTRON__) {
      const p = await window.__ELECTRON__.pickFile(kind)
      if (!p) return
      const r = await fetch('/api/edit/asset-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, path: p }),
      })
      acceptAsset(kind, await r.json(), p.split(/[\\/]/).pop())
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = kind === 'video' ? 'video/*' : 'audio/*'
    const picked = await new Promise((resolve) => {
      input.onchange = () => resolve(input.files?.[0] || null)
      input.click()
    })
    if (!picked) return
    const r = await fetch(`/api/edit/asset?kind=${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: picked,
    })
    acceptAsset(kind, await r.json(), picked.name)
  } catch (e) {
    errorMsg.value = String(e.message || e)
  } finally {
    uploading.value = ''
  }
}

async function render() {
  if (rendering.value) return
  if (!props.videoUrl && !upVideo.value) {
    errorMsg.value = '还没有数字人视频 —— 上传一个无声视频，或回上一步出片'
    return
  }
  rendering.value = true
  progress.value = 0
  errorMsg.value = ''
  done.value = false
  stage.value = '提交剪辑任务'

  try {
    const res = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 上传的文件优先；没有就用上一步出片的地址
        videoFile: upVideo.value?.file || '',
        audioFile: upAudio.value?.file || '',
        videoUrl: props.videoUrl || '',
        options: {
          engine: 'talkcraft',
          mode: 'shotlist',
          script: props.script,
          layout: layout.value,
          capStyle: capVariant.value,
          smartPlan: smartPlan.value,
        },
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      errorMsg.value = data.error || '提交失败'
      rendering.value = false
      return
    }
    jobId = data.data.jobId

    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`/api/edit/${jobId}`)
        const d = await r.json()
        if (!d.ok) return
        progress.value = d.data.progress
        stage.value = d.data.step

        if (d.data.status === 'SUCCESS') {
          clearInterval(pollTimer)
          rendering.value = false
          done.value = true
          outputUrl.value = d.data.output
          curJobId.value = jobId
          spec.value = d.data.meta || d.data.spec
          planMode.value = d.data.meta?.planMode || ''
          planNote.value = d.data.meta?.planNote || ''
          cards.value = d.data.meta?.cards || null
        } else if (d.data.status === 'FAILED') {
          clearInterval(pollTimer)
          rendering.value = false
          errorMsg.value = d.data.error || '剪辑失败'
        }
      } catch {
        /* 忽略抖动 */
      }
    }, 2000)
  } catch (e) {
    errorMsg.value = String(e.message || e)
    rendering.value = false
  }
}

const wordCount = computed(() => props.script.replace(/\s/g, '').length)

/* ---- 轨道工作台：视频-talkcraft 技能自带的剪映式多轨编辑器 ---- */
const wbBusy = ref(false)
const wbMsg = ref('')

async function openWorkbench() {
  if (wbBusy.value) return
  wbBusy.value = true
  wbMsg.value = ''
  try {
    const r = await fetch('/api/workbench/start', { method: 'POST' })
    const d = await r.json()
    if (!d.ok) {
      wbMsg.value = d.error || '工作台没起来'
      return
    }
    window.open(d.data.url, '_blank', 'noopener')  } catch (e) {
    wbMsg.value = String(e.message || e)
  } finally {
    wbBusy.value = false
  }
}

const emit = defineEmits(['back', 'restart'])
</script>

<template>
  <div class="step-wrap">
    <div class="mode-tabs">
      <button class="mt" :class="{ on: mode === 'sheet' }" @click="mode = 'sheet'">
        分镜稿
        <i>逐段配卡 · 只出文本</i>
      </button>
      <button class="mt" :class="{ on: mode === 'render' }" @click="mode = 'render'">
        后期成片
        <i>真渲染 · 需要成片素材</i>
      </button>
      <button class="mt" :class="{ on: mode === 'works' }" @click="mode = 'works'">
        历史作品
        <i>回看 / 下载 / 重跑</i>
      </button>
    </div>

    <StoryboardPanel v-if="mode === 'sheet'" :script="script" />
    <WorksPanel v-else-if="mode === 'works'" />

    <div v-else class="step">
    <!-- 左：后期选项 -->
    <section class="pane">
      <header class="pane-head">
        <h3>后期处理</h3>
        <span class="pane-note">video-talkcraft · FireRed + 卡库动效 + 音效</span>
      </header>

      <p class="field-label">
        引擎流水线
        <span class="pipe-hint">{{ rendering ? (curIdx < 0 ? '排队中…' : `跑到第 ${curIdx + 1} / ${PIPE.length} 步`) : done ? '已全部通过' : '点右下「开始后期」后逐步点亮' }}</span>
      </p>      <div class="pipe-list">
        <div
          v-for="(p, i) in PIPE"
          :key="p.key"
          class="pipe-row"
          :class="pipeState(i)"
        >
          <span class="pipe-no">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="pipe-meta">
            <strong>{{ p.label }}</strong>
            <em>{{ p.desc }}</em>
          </span>
          <span class="pipe-tag" :class="pipeState(i)">{{ pipeTag(i) }}</span>
        </div>
      </div>

      <div class="sw" @click="smartPlan = !smartPlan">
        <span class="sw-meta">
          <strong>智能分镜</strong>
          <em>让大模型读稿子，决定四镜怎么切、卡片上写什么</em>
        </span>
        <span class="toggle" :class="{ on: smartPlan }"></span>
      </div>
      <p v-if="done && planMode" class="plan-note" :class="{ rule: planMode !== 'llm' }">
        <template v-if="planMode === 'llm'">
          大模型分镜已生效 · 钩子「{{ cards?.s01 }}」· 章节「{{ cards?.s02 }}」· 列举「{{ cards?.s03 }}」
        </template>
        <template v-else>
          {{ planNote || '这次走的是规则分镜（按时间均分），卡片文案可能是通用默认值' }}
        </template>
      </p>

      <p class="field-label">字幕样式</p>
      <div class="cap-list">
        <button
          v-for="c in capStyles"
          :key="c.key"
          class="cap"
          :class="{ on: capStyle === c.key }"
          @click="capStyle = c.key"
        >
          <span class="cap-preview" :class="c.key">
            <template v-if="c.key === 'word'"><b>说到哪</b>亮哪</template>
            <template v-else>{{ c.sample }}</template>
          </span>
          <span class="cap-meta">
            <strong>{{ c.label }}</strong>
            <em>{{ c.desc }}</em>
          </span>
        </button>
      </div>
      <p class="cap-note">已选「{{ capStyles.find((c) => c.key === capStyle)?.label }}」· 点开始后期时生效</p>

      <div class="wb-entry">
        <div class="we-meta">
          <strong>轨道微调</strong>
          <span>剪映式多轨时间线 · 拖片段 / 改文案 / 换音效，108 张动效卡</span>
        </div>
        <button class="ghost sm" :disabled="wbBusy" @click="openWorkbench">
          {{ wbBusy ? '正在拉起…' : '打开工作台' }}
        </button>
      </div>
      <p v-if="wbMsg" class="err-line">{{ wbMsg }}</p>

      <p class="soft-note">
        <Icon name="sparkle" :size="12" />
        全流程无人工介入，从稿子到成片一次跑完
      </p>
    </section>

    <!-- 右：成片 -->
    <section class="pane">
      <header class="pane-head">
        <h3>成片</h3>
        <span class="pane-note" v-if="done">1920×1080 · H.264</span>
      </header>

      <div class="stage-box">
        <div v-if="!done && !rendering" class="stage-idle">
          <!-- 素材来源：无声视频 + 独立配音（口型与配音同源，天然对齐） -->
          <div class="asset-row">
            <button class="asset-btn" :class="{ on: upVideo }" :disabled="!!uploading" @click="pickAsset('video')">
              <Icon name="film" :size="13" />
              {{ upVideo ? `视频 ${upVideo.mb}MB` : '上传无声视频' }}
            </button>
            <button class="asset-btn" :class="{ on: upAudio }" :disabled="!!uploading" @click="pickAsset('audio')">
              <Icon name="publish" :size="13" />
              {{ upAudio ? `配音 ${upAudio.mb}MB` : '上传配音 mp3' }}
            </button>
          </div>
          <p v-if="uploading" class="asset-tip">正在上传{{ uploading === 'video' ? '视频' : '配音' }}…</p>
          <p v-else-if="upVideo && upAudio" class="asset-tip ok">两个素材都齐了，点右下「开始后期」</p>
          <p v-else-if="upVideo && !upAudio" class="asset-tip warn">视频有声轨吗？没有的话必须再传一个配音 mp3</p>

          <video v-if="videoUrl" class="idle-video" :src="videoUrl" muted playsinline controls></video>
          <p class="si-title">{{ videoUrl || upVideo ? '素材已就绪' : '还没素材' }}</p>
          <p class="si-sub">
            {{ videoUrl || upVideo ? '点下方「开始后期」：切分镜 → 逐镜配卡 → 渲染 1080p' : '上传无声视频和配音，或先回上一步出片' }}
          </p>
        </div>
        <div v-else-if="rendering" class="stage-run">
          <div class="sr-head">
            <span class="sr-stage">{{ stage }}</span>
            <span class="sr-pct">{{ progress }}%</span>
          </div>
          <div class="bar"><span class="bar-fill" :style="{ width: progress + '%' }"></span></div>
          <p class="sr-sub">正在处理 {{ wordCount }} 字口播稿</p>
        </div>
        <div v-else class="stage-done">
          <video v-if="outputUrl" class="player-video" :src="outputUrl" controls playsinline></video>
          <div v-else class="player">
            <span class="play-btn"><Icon name="arrowRight" :size="18" /></span>
            <span class="player-meta">成片预览</span>
          </div>
          <div class="specs">
            <template v-if="spec">
              <span>{{ spec.width }}×{{ spec.height }}</span><i>·</i>
              <span>{{ spec.fps }} fps</span><i>·</i>
              <span>{{ Math.round(spec.duration) }}s</span><i>·</i>
              <span>{{ (spec.size / 1024 / 1024).toFixed(1) }} MB</span>
            </template>
            <template v-else>
              <span>1920×1080</span><i>·</i><span>24 fps</span><i>·</i><span>H.264</span>
            </template>
          </div>
        </div>
      </div>

      <p v-if="errorMsg" class="err-line">{{ errorMsg }}</p>

      <div class="next-bar">
        <span class="next-hint">{{ done ? '成片好了，可直接下载或发布' : '合成后可下载、发抖音、进作品库' }}</span>
        <div class="actions">
          <button class="ghost" @click="emit('back')">上一步</button>
          <span v-if="!videoUrl" class="need-hint-sm">先在第 ③ 步出数字人视频</span>
          <button v-if="!done" class="primary" :disabled="rendering || (!videoUrl && !upVideo)" @click="render">
            <Icon name="sparkle" :size="13" />
            {{ rendering ? '合成中…' : '开始后期' }}
          </button>
          <template v-else>
            <button class="ghost" @click="editShots">改分镜卡片</button>
            <button class="ghost" @click="emit('restart')">再来一条</button>
            <a class="primary" :href="outputUrl" download>
              <Icon name="publish" :size="13" />
              下载成片
            </a>
          </template>
        </div>
      </div>

      <ShotEditor
        :job-id="curJobId"
        :open="shotOpen"
        @close="shotOpen = false"
        @done="onShotsDone"
      />
    </section>
    </div>
  </div>
</template>

<style scoped>
.step-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.mode-tabs {
  display: inline-flex;
  gap: 8px;
  flex: 0 0 auto;
}
.mt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid rgba(30, 30, 60, 0.08);
  background: rgba(255, 255, 255, 0.6);
  font-size: 12.5px;
  font-weight: 600;
  color: #5f5f78;
  cursor: pointer;
  transition: all 0.16s ease;
}
.mt i {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 400;
  color: #a8a8bd;
}
.mt:hover {
  border-color: rgba(79, 125, 243, 0.28);
}
.mt.on {
  background: linear-gradient(100deg, rgba(240, 246, 255, 0.96), rgba(250, 245, 255, 0.92));
  border-color: rgba(79, 125, 243, 0.4);
  color: #2b4a8f;
  box-shadow: inset 0 0 0 1px rgba(79, 125, 243, 0.14);
}
.mt.on i {
  color: #6d8ac0;
}

.step {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.pane {
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 10px 28px rgba(60, 60, 110, 0.06);
  padding: 14px;
  display: flex;
  flex-direction: column;
  min-height: clamp(440px, calc(100vh - 330px), 760px);
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.pane-head h3 {
  font-size: 13.5px;
  font-weight: 600;
  color: #26263a;
}

.pane-note {
  font-size: 10.5px;
  color: #a3a3b7;
}

.switches {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 18px;
}

.sw {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(30, 30, 60, 0.06);
  background: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: all 0.16s ease;
}

.sw:hover {
  border-color: rgba(79, 125, 243, 0.25);
}

.sw-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sw-meta strong {
  font-size: 11.5px;
  font-weight: 500;
  color: #2c2c40;
}

.sw-meta em {
  font-style: normal;
  font-size: 9.5px;
  color: #a5a5b8;
}

.toggle {
  width: 30px;
  height: 17px;
  border-radius: 99px;
  background: rgba(30, 30, 60, 0.12);
  position: relative;
  flex: 0 0 auto;
  transition: background 0.2s ease;
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  transition: transform 0.2s ease;
}

.toggle.on {
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
}

.toggle.on::after {
  transform: translateX(13px);
}

.field-label {
  font-size: 11px;
  color: #8c8ca4;
  margin-bottom: 7px;
}

.layout-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  margin-bottom: 16px;
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(30, 30, 60, 0.07);
  background: rgba(255, 255, 255, 0.6);
  text-align: left;
  transition: all 0.16s ease;
}

.layout:hover {
  border-color: rgba(79, 125, 243, 0.3);
}

.layout.on {
  border-color: rgba(79, 125, 243, 0.55);
  background: rgba(244, 249, 255, 0.95);
}

.layout-thumb {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  overflow: hidden;
  background: linear-gradient(150deg, #2a2f52, #161a30);
}

.lt-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 80% at 60% 25%, rgba(120, 160, 255, 0.45), transparent 70%),
    linear-gradient(140deg, #262b4a, #14172a);
}

.lt-person {
  position: absolute;
  border-radius: 2px;
  background: linear-gradient(150deg, #dfe8fb, #a9bfe0);
}

/* 全屏：人物铺满 */
.layout-thumb.full .lt-person {
  inset: 0;
  border-radius: 0;
  opacity: 0.85;
}

/* 右下 */
.layout-thumb.pip .lt-person {
  right: 4px;
  bottom: 4px;
  width: 34%;
  height: 42%;
}

/* 左下 */
.layout-thumb.pip-bl .lt-person {
  left: 4px;
  bottom: 4px;
  width: 34%;
  height: 42%;
}

.layout-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.layout-meta strong {
  font-size: 10.5px;
  font-weight: 500;
  color: #3a3a52;
}

.layout-meta em {
  font-style: normal;
  font-size: 9px;
  color: #a9a9bc;
}

.pipe-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 18px;
}
.pipe-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 12px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(24, 24, 48, 0.06);
  transition: background 0.2s ease, border-color 0.2s ease;
}
/* 真状态：未开始灰、进行中蓝、完成绿 */
.pipe-row.run {
  background: rgba(240, 246, 255, 0.95);
  border-color: rgba(79, 125, 243, 0.32);
}
.pipe-row.done {
  background: rgba(246, 250, 247, 0.8);
  border-color: rgba(70, 185, 138, 0.2);
}
.pipe-row.idle {
  opacity: 0.62;
}
.pipe-no {
  font-family: Georgia, serif;
  font-size: 14px;
  font-weight: 700;
  color: #b9b9cc;
  flex: 0 0 auto;
}
.pipe-row.run .pipe-no {
  color: #4f7df3;
}
.pipe-row.done .pipe-no {
  color: #4aa87a;
}
.pipe-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.pipe-meta strong {
  font-size: 12px;
  font-weight: 600;
  color: #1c1c30;
}
.pipe-row.idle .pipe-meta strong {
  color: #7d7d94;
  font-weight: 500;
}
.pipe-meta em {
  font-style: normal;
  font-size: 10px;
  color: #8c8ca4;
  line-height: 1.35;
}
.pipe-tag {
  flex: 0 0 auto;
  font-size: 9.5px;
  padding: 3px 8px;
  border-radius: 999px;
  color: #9a9ab0;
  background: rgba(30, 30, 60, 0.05);
  font-weight: 600;
}
.pipe-tag.run {
  color: #4f7df3;
  background: rgba(79, 125, 243, 0.12);
}
.pipe-tag.done {
  color: #2f7d52;
  background: rgba(70, 185, 138, 0.14);
}
.pipe-hint {
  margin-left: 6px;
  font-size: 9.5px;
  color: #b0b0c2;
}
.cap-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.cap {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid rgba(30, 30, 60, 0.07);
  background: rgba(255, 255, 255, 0.6);
  text-align: left;
  transition: all 0.16s ease;
}

.cap:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cap.on {
  border-color: rgba(79, 125, 243, 0.5);
  background: rgba(244, 249, 255, 0.95);
}

.cap-preview {
  display: block;
  text-align: center;
  font-size: 10px;
  padding: 8px 4px;
  border-radius: 6px;
  background: #1c1c2b;
  color: #fff;
  letter-spacing: 0.3px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
}

/* 逐字高亮：说过的字压暗、当前字亮黄 */
.cap-preview.word {
  background: #1c1c2b;
  color: rgba(255, 255, 255, 0.36);
}
.cap-preview.word b {
  color: #ffd86e;
  font-weight: 800;
}

/* 整句上屏：整句同色 */
.cap-preview.line {
  background: #1c1c2b;
  color: #fff;
  font-size: 9px;
  letter-spacing: 0;
}

/* 大字冲击：无底框 + 大号粗体 + 投影 */
.cap-preview.bold {
  background: linear-gradient(150deg, #2b2f45, #1a1d2e);
  font-size: 13px;
  font-weight: 900;
  color: #fff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
  letter-spacing: 0;
}
.cap-note {
  margin-top: 8px;
  font-size: 10px;
  color: #a5a5b8;
}
.plan-note {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 10.5px;
  line-height: 1.5;
  color: #2f7d52;
  background: rgba(70, 185, 138, 0.1);
  border: 1px solid rgba(70, 185, 138, 0.2);
}
.plan-note.rule {
  color: #a0702a;
  background: rgba(214, 158, 46, 0.09);
  border-color: rgba(214, 158, 46, 0.2);
}
/* 智能分镜开关（复用 .sw / .toggle 骨架） */
.sw {
  margin-bottom: 12px;
}

.cap-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cap-meta strong {
  font-size: 10.5px;
  font-weight: 500;
  color: #3a3a52;
}

.cap-meta em {
  font-style: normal;
  font-size: 9px;
  color: #a9a9bc;
}

.soft-note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
  padding-top: 14px;
  font-size: 10.5px;
  color: #a8a8bd;
}
.wb-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 11px;
  background: rgba(246, 248, 253, 0.9);
  border: 1px dashed rgba(79, 125, 243, 0.28);
}
.we-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.we-meta strong {
  font-size: 12px;
  font-weight: 600;
  color: #2c2c40;
}
.we-meta span {
  font-size: 10px;
  color: #8c8ca4;
  line-height: 1.4;
}
.ghost.sm {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 11px;
  font-size: 11.5px;
  border-radius: 8px;
}

.soft-note svg {
  color: #c3b0dd;
}

.stage-box {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(24, 24, 40, 0.03);
  border: 1px dashed rgba(30, 30, 60, 0.1);
  padding: 18px;
  min-height: 260px;
}

.stage-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  text-align: center;
}

.si-ico {
  color: #b8c6e4;
}

.idle-video {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: #0d0d18;
  object-fit: contain;
  margin-bottom: 10px;
}

.si-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #4a4a60;
}

.si-sub {
  font-size: 10.5px;
  color: #a5a5b8;
}

.stage-run {
  width: 100%;
}

.sr-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.sr-stage {
  font-size: 12px;
  font-weight: 600;
  color: #3a3a52;
}

.sr-pct {
  font-size: 12px;
  font-weight: 600;
  color: #4f7df3;
}

.bar {
  height: 6px;
  border-radius: 99px;
  background: rgba(30, 30, 60, 0.06);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #8fb6fb, #4f7df3);
  transition: width 0.3s ease;
}

.sr-sub {
  margin-top: 9px;
  font-size: 10.5px;
  color: #a5a5b8;
}

.stage-done {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: linear-gradient(155deg, #20203a, #101020);
  display: grid;
  place-items: center;
}

.player-video {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: #0d0d18;
  object-fit: contain;
}

.err-line {
  font-size: 10.5px;
  color: #d4756b;
  padding: 8px 2px 0;
}

a.primary {
  text-decoration: none;
}

.play-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #fff;
  backdrop-filter: blur(6px);
}

.play-btn svg {
  transform: rotate(180deg);
}

.player-meta {
  position: absolute;
  left: 12px;
  bottom: 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
}

.specs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 10.5px;
  color: #8f8fa8;
}

.specs i {
  font-style: normal;
  color: #c9c9d8;
}

.next-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid rgba(30, 30, 60, 0.06);
}

.need-hint-sm {
  font-size: 10.5px;
  color: #b07a2a;
}
.next-hint {
  font-size: 11px;
  color: #a5a5b8;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ghost {
  height: 32px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 12px;
  color: #6f6f86;
  border: 1px solid rgba(30, 30, 60, 0.09);
  background: rgba(255, 255, 255, 0.7);
}

.ghost:hover {
  background: #fff;
  color: #33334a;
}

.primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  box-shadow: 0 3px 10px rgba(79, 125, 243, 0.28);
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

.primary:disabled {
  opacity: 0.42;
  box-shadow: none;
  cursor: not-allowed;
}

@media (max-width: 1100px) {
  .step {
    grid-template-columns: minmax(0, 1fr);
  }
  .pane {
    min-height: 340px;
  }
}

/* ---- 素材上传（无声视频 + 独立配音） ---- */
.asset-row {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
}
.asset-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 9px;
  border: 1px dashed rgba(30, 30, 60, 0.18);
  background: rgba(255, 255, 255, 0.6);
  font-size: 11.5px;
  color: #5f5f78;
  cursor: pointer;
  transition: all 0.16s ease;
}
.asset-btn:hover:not(:disabled) {
  border-color: rgba(79, 125, 243, 0.5);
  color: #3a5fd0;
  background: rgba(240, 246, 255, 0.9);
}
.asset-btn.on {
  border-style: solid;
  border-color: rgba(70, 185, 138, 0.45);
  background: rgba(237, 249, 240, 0.9);
  color: #2f7d5c;
}
.asset-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.asset-tip {
  font-size: 10.5px;
  color: #8c8ca4;
  margin: 0 0 10px;
  text-align: center;
}
.asset-tip.ok {
  color: #2f7d5c;
}
.asset-tip.warn {
  color: #b07a2a;
}
</style>
