<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import Icon from '../Icon.vue'
import { readStore, writeStore } from '../../lib/store.js'

const props = defineProps({
  script: { type: String, default: '' },
})

/** 上次选的数字人和音色，切菜单回来不用重选 */
const SAVED = readStore('avatar', {}) || {}

/** 形象和音色都从蝉镜实时拉，不再写死 */
const avatars = ref([])
const voices = ref([])
const optsLoading = ref(true)
const optsError = ref('')
const bean = ref(null)

const pickedAvatar = ref(SAVED.pickedAvatar || '')

/** 我的形象 / 公用形象分开 */
const myPersons = computed(() => avatars.value.filter((a) => a.custom))
const publicPersons = computed(() => avatars.value.filter((a) => !a.custom))

/** 音色：我自己克隆的排前面，其余保持接口顺序 */
const sortedVoices = computed(() => {
  const arr = [...voices.value]
  return arr.sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0))
})

/** 缩略图按形象本身的宽高比算尺寸，高度统一 104px：横屏宽、竖屏窄，不留白 */
const THUMB_H = 104
function thumbStyle(p) {
  const f = p.figures?.[0]
  const w = Number(f?.width) || 16
  const h = Number(f?.height) || 9
  const ratio = Math.min(Math.max(w / h, 0.5), 2)
  return { width: `${Math.round(THUMB_H * ratio)}px` }
}
/** 选中态显示的尺寸 */
function sizeLabel(p) {
  const f = p.figures?.[0]
  return f ? `${f.width}×${f.height}` : ''
}

/** 当前形象（用于算尺寸），以及它的竖版形态 */
const curPerson = computed(() => avatars.value.find((a) => a.id === pickedAvatar.value) || null)
const curFigure = computed(() => {
  const p = curPerson.value
  if (!p?.figures?.length) return null
  return p.figures.find((f) => f.width < f.height) || p.figures[0]
})

async function loadOptions() {
  optsLoading.value = true
  optsError.value = ''
  try {
    const r = await fetch('/api/avatar/options')
    const d = await r.json()
    if (!d.ok) {
      optsError.value = d.error || '加载形象失败'
      return
    }
    avatars.value = d.data.persons || []
    voices.value = d.data.audios || []
    bean.value = d.data.bean || null
    // 存档里的形象/音色可能被删了，失效就回落
    if (pickedAvatar.value && !avatars.value.some((a) => a.id === pickedAvatar.value)) pickedAvatar.value = ''
    if (pickedVoice.value && !voices.value.some((v) => v.id === pickedVoice.value)) pickedVoice.value = ''
    if (!pickedAvatar.value && avatars.value[0]) pickedAvatar.value = avatars.value[0].id
    if (!pickedVoice.value && voices.value[0]) pickedVoice.value = voices.value[0].id
  } catch (e) {
    optsError.value = String(e.message || e)
  } finally {
    optsLoading.value = false
  }
}

/* ---- 训练自己的形象 ---- */
const trainOpen = ref(false)
const trainFile = ref(null)       // { name, dataUrl }
const trainName = ref('')
const trainBusy = ref(false)
const trainMsg = ref('')
const trainId = ref('')
const trainStatus = ref(0)        // 1 制作中 / 2 成功 / 4 失败
const trainProgress = ref(0)
let trainTimer = null

function pickTrainFile(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  if (!/^video\//.test(f.type)) {
    trainMsg.value = '要视频文件（mp4 / mov / webm）'
    return
  }
  if (f.size > 120 * 1024 * 1024) {
    trainMsg.value = '视频超过 120MB'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    trainFile.value = { name: f.name, dataUrl: reader.result }
    trainMsg.value = ''
    if (!trainName.value) trainName.value = f.name.replace(/\.[^.]+$/, '').slice(0, 12)
  }
  reader.readAsDataURL(f)
}

async function startTrain() {
  if (trainBusy.value || !trainFile.value) return
  if (!trainName.value.trim()) {
    trainMsg.value = '给这个形象起个名字'
    return
  }
  trainBusy.value = true
  trainMsg.value = '正在上传素材…'
  try {
    const up = await fetch('/api/avatar/material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: trainFile.value.name, dataUrl: trainFile.value.dataUrl }),
    })
    const ud = await up.json()
    if (!ud.ok) {
      trainMsg.value = ud.error || '上传失败'
      return
    }

    trainMsg.value = '正在提交训练…'
    const tr = await fetch('/api/avatar/train-person', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trainName.value.trim(), materialUrl: ud.data.url, isHighQuality: true }),
    })
    const td = await tr.json()
    if (!td.ok) {
      trainMsg.value = td.error || '提交失败'
      return
    }

    trainId.value = td.data.id
    trainStatus.value = 1
    trainMsg.value = '训练中，通常几十分钟…'
    if (trainTimer) clearInterval(trainTimer)
    trainTimer = setInterval(pollTrain, 20_000)
  } catch (e) {
    trainMsg.value = String(e.message || e)
  } finally {
    trainBusy.value = false
  }
}

async function pollTrain() {
  if (!trainId.value) return
  try {
    const r = await fetch(`/api/avatar/train/person/${trainId.value}`)
    const d = await r.json()
    if (!d.ok) return
    trainStatus.value = d.data.status
    trainProgress.value = d.data.progress || 0
    if (d.data.status === 2) {
      clearInterval(trainTimer)
      trainTimer = null
      trainMsg.value = '训练完成'
      await loadOptions()
    } else if (d.data.status === 4 || d.data.status === 5) {
      clearInterval(trainTimer)
      trainTimer = null
      trainMsg.value = `训练失败：${d.data.reason || '未知原因'}`
    } else {
      trainMsg.value = `训练中 ${trainProgress.value}%…`
    }
  } catch {}
}

onMounted(loadOptions)

const pickedVoice = ref(SAVED.pickedVoice || '')

const generating = ref(false)
/** 上次出的片也算「已完成」，刷新回来还能接着看/接着剪 */
const progress = ref(SAVED.videoUrl ? 100 : 0)
const stage = ref('')
const errorMsg = ref('')
const taskId = ref(SAVED.taskId || '')
const videoUrl = ref(SAVED.videoUrl || '')
const elapsed = ref(0)
const estimateMin = ref(0)
/** 成片元信息：读 <video> 的时长，播放器自己带出来 */
const doneDuration = ref('')
const doneSize = ref('')

watch([pickedAvatar, pickedVoice, videoUrl, taskId], () => {
  writeStore('avatar', {
    pickedAvatar: pickedAvatar.value,
    pickedVoice: pickedVoice.value,
    videoUrl: videoUrl.value,
    taskId: taskId.value,
  })
})

function onDoneMeta(e) {
  const v = e.target
  if (v?.duration && Number.isFinite(v.duration)) {
    const s = Math.round(v.duration)
    doneDuration.value = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
}

let tickTimer = null
let pollTimer = null

const stages = ['提交任务', '音频对齐', '口型驱动', '画面渲染', '封装输出']

const wordCount = computed(() => props.script.replace(/\s/g, '').length)
const estDur = computed(() => Math.round(wordCount.value / 4.2))

const elapsedText = computed(() => {
  const m = Math.floor(elapsed.value / 60)
  const s = elapsed.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

async function start() {
  if (generating.value) return
  generating.value = true
  progress.value = 0
  errorMsg.value = ''
  videoUrl.value = ''
  doneDuration.value = ''
  doneSize.value = ''
  elapsed.value = 0
  stage.value = '正在合成配音'

  try {
    const res0 = await fetch('/api/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: props.script,
        personId: pickedAvatar.value,
        figureType: curFigure.value?.type || '',
        audioMan: pickedVoice.value,
        model: 1,
      }),
    })
    const data = await res0.json()
    if (!data.ok) {
      errorMsg.value = data.error || '提交失败'
      generating.value = false
      stage.value = ''
      return
    }

    taskId.value = data.data.taskId
    estimateMin.value = data.data.estimateMinutes || 30
    stage.value = '排队生成中'

    // 计时器：按预估时间推进进度（最多到 95%）
    tickTimer = setInterval(() => {
      elapsed.value += 1
      const ratio = Math.min(0.95, elapsed.value / (estimateMin.value * 60))
      progress.value = Math.max(progress.value, Math.round(ratio * 100))
      if (progress.value > 20) stage.value = '口型驱动中'
      if (progress.value > 60) stage.value = '画面渲染中'
      if (progress.value > 85) stage.value = '封装输出中'
    }, 1000)

    // 轮询任务状态，20 秒一次
    const poll = async () => {
      try {
        const r = await fetch(`/api/avatar/${taskId.value}`)
        const d = await r.json()
        if (!d.ok) return
        const st = d.data.status
        if (d.data.desc) stage.value = d.data.desc
        if (st === 'completed') {
          clearInterval(tickTimer)
          clearInterval(pollTimer)
          progress.value = 100
          stage.value = '已完成'
          generating.value = false
          videoUrl.value = d.data.results?.[0]?.url || ''
        } else if (st === 'failed') {
          clearInterval(tickTimer)
          clearInterval(pollTimer)
          generating.value = false
          stage.value = '失败'
          errorMsg.value = d.data.msg || '任务失败'
        } else if (st === 'other') {
          // 蝉镜明确说 other 不是中间态，别一直等
          clearInterval(tickTimer)
          clearInterval(pollTimer)
          generating.value = false
          stage.value = '异常'
          errorMsg.value = `${d.data.desc || '任务状态异常'}${d.data.msg ? '：' + d.data.msg : ''}`
        }
      } catch {
        /* 网络抖动忽略，下轮再查 */
      }
    }
    pollTimer = setInterval(poll, 8_000)
    setTimeout(poll, 5_000)
  } catch (e) {
    errorMsg.value = String(e.message || e)
    generating.value = false
    stage.value = ''
  }
}

const emit = defineEmits(['next', 'back'])
</script>

<template>
  <div class="step">
    <!-- 左：形象 -->
    <section class="pane">
      <header class="pane-head">
        <h3>数字人形象</h3>
        <button class="link-btn" @click="trainOpen = !trainOpen">
          {{ trainOpen ? '收起' : '+ 新增形象' }}
        </button>
      </header>

      <!-- 训练自己的形象 -->
      <div v-if="trainOpen" class="train-box">
        <p class="train-tip">
          上传一段正面说话的竖版视频（mp4 / mov / webm），系统会训练成你自己的数字人。
        </p>
        <div class="train-row">
          <label class="train-file">
            <input type="file" accept="video/mp4,video/quicktime,video/webm" @change="pickTrainFile" />
            <span>{{ trainFile ? trainFile.name : '选择视频' }}</span>
          </label>
          <input v-model="trainName" class="train-name" placeholder="形象名字" maxlength="12" />
          <button
            class="primary sm"
            :disabled="trainBusy || !trainFile || !trainName.trim()"
            @click="startTrain"
          >
            {{ trainBusy ? '提交中…' : '开始训练' }}
          </button>
        </div>
        <p v-if="trainMsg" class="train-msg" :class="{ err: trainStatus === 4 || trainStatus === 5 }">
          {{ trainMsg }}
        </p>
      </div>

      <p v-if="optsError" class="err-line">{{ optsError }}</p>
      <p v-if="optsLoading" class="loading-line">正在加载形象和音色…</p>

      <!-- 我的形象：数量少，单独一块，不抢公用库的空间 -->
      <div v-if="!optsLoading && myPersons.length" class="my-scroll thin-scroll">
        <p class="group-title">
          我的形象<em>{{ myPersons.length }}</em>
        </p>
        <div class="avatar-strip">
          <button
            v-for="a in myPersons"
            :key="a.id"
            class="avatar-card"
            :class="{ on: pickedAvatar === a.id }"
            :style="thumbStyle(a)"
            :title="`${a.name} · ${sizeLabel(a)}`"
            @click="pickedAvatar = a.id"
          >
            <span class="avatar-thumb">
              <img v-if="a.cover" class="avatar-img" :src="a.cover" alt="" referrerpolicy="no-referrer" />
              <span v-if="pickedAvatar === a.id" class="chk">✓</span>
            </span>
            <span class="avatar-name">{{ a.name }}</span>
          </button>
        </div>
      </div>

      <!-- 公用形象库：吃剩余高度，内部滚动 -->
      <div v-if="!optsLoading && publicPersons.length" class="lib-scroll thin-scroll">
        <p class="group-title">
          公用形象库<em>{{ publicPersons.length }}</em>
        </p>
        <div class="avatar-strip">
          <button
            v-for="a in publicPersons"
            :key="a.id"
            class="avatar-card"
            :class="{ on: pickedAvatar === a.id }"
            :style="thumbStyle(a)"
            :title="`${a.name} · ${sizeLabel(a)}`"
            @click="pickedAvatar = a.id"
          >
            <span class="avatar-thumb">
              <img v-if="a.cover" class="avatar-img" :src="a.cover" alt="" referrerpolicy="no-referrer" />
              <span v-if="pickedAvatar === a.id" class="chk">✓</span>
            </span>
            <span class="avatar-name">{{ a.name }}</span>
          </button>
        </div>
      </div>

      <p v-if="!optsLoading && voices.length" class="field-label">
        配音音色
        <span class="voice-count">{{ voices.length }} 个可选</span>
      </p>
      <div v-if="!optsLoading" class="voice-scroll thin-scroll">
        <div class="voice-list">
          <button
            v-for="v in sortedVoices"
            :key="v.id"
            class="voice"
            :class="{ on: pickedVoice === v.id }"
            @click="pickedVoice = v.id"
          >
            <span class="voice-dot" :class="{ on: pickedVoice === v.id }"></span>
            <span class="voice-meta">
              <strong>{{ v.name }}<span v-if="v.custom" class="mine-tag">我的</span></strong>
              <em>{{ v.custom ? '我克隆的声音' : v.gender === 'male' ? '男声' : v.gender === 'female' ? '女声' : '通用音色' }}</em>
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- 右：出片 -->
    <section class="pane">
      <header class="pane-head">
        <h3>生成设置</h3>
        <span class="pane-note">数字人视频</span>
      </header>

      <div class="summary">
        <div class="sm-item">
          <span class="sm-k">稿子</span>
          <span class="sm-v">{{ wordCount }} 字</span>
        </div>
        <div class="sm-item">
          <span class="sm-k">预计时长</span>
          <span class="sm-v">≈ {{ estDur }} 秒</span>
        </div>
        <div class="sm-item">
          <span class="sm-k">分辨率</span>
          <span class="sm-v">{{ curFigure ? `${curFigure.width}×${curFigure.height}` : '—' }}</span>
        </div>
        <div class="sm-item">
          <span class="sm-k">帧率</span>
          <span class="sm-v">24 fps</span>
        </div>
      </div>

      <!-- 输出规格：跟着形象走，不给假选项 -->
      <p class="field-label">输出规格</p>
      <div class="spec-line">
        <strong>{{ curFigure ? `${curFigure.width}×${curFigure.height}` : '跟随形象' }}</strong>
        <em>
          {{ curFigure ? (curFigure.width >= curFigure.height ? '横屏' : '竖屏') : '' }}
          · 尺寸由所选形象决定
        </em>
      </div>

      <div class="run-box" :class="{ 'run-box--done': videoUrl && progress === 100 }">
        <!-- 出片完成：就在这儿看成片 -->
        <div v-if="videoUrl && progress === 100" class="run-done">
          <video
            class="done-video"
            :src="videoUrl"
            controls
            playsinline
            preload="metadata"
            referrerpolicy="no-referrer"
            @loadedmetadata="onDoneMeta"
          ></video>
          <div class="done-meta">
            <span class="dm-ok">✓ 已生成</span>
            <span v-if="curFigure" class="dm-dim">{{ curFigure.width }}×{{ curFigure.height }}</span>
            <span v-if="doneDuration" class="dm-dim">{{ doneDuration }}</span>
            <span v-if="doneSize" class="dm-dim">{{ doneSize }}</span>
          </div>
          <div class="done-acts">
            <a :href="videoUrl" target="_blank" rel="noopener" class="ghost sm">
              <Icon name="publish" :size="12" />
              下载 / 打开原片
            </a>
            <button class="ghost sm" :disabled="generating" @click="start">重新生成</button>
          </div>
          <p v-if="taskId" class="task-id">任务 {{ taskId }}</p>
        </div>

        <div v-else-if="!generating && progress === 0" class="run-idle">
          <Icon name="film" :size="26" class="run-ico" />
          <p class="run-title">准备好后开始生成</p>
          <p class="run-sub">30 秒口播约 25–40 分钟，按稿子长度递增</p>
          <p v-if="!script.trim()" class="need-hint">
            还没有口播稿 · 点「上一步」写一版，或直接在文案页自由输入
          </p>
          <button class="primary" :disabled="!script.trim()" @click="start">
            开始生成数字人视频
            <Icon name="arrowRight" :size="14" />
          </button>
        </div>

        <div v-else class="run-progress">
          <div class="pg-head">
            <span class="pg-stage">{{ stage }}</span>
            <span class="pg-right">
              <span v-if="generating" class="pg-time">{{ elapsedText }} / 约 {{ estimateMin }} 分钟</span>
              <span class="pg-pct">{{ progress }}%</span>
            </span>
          </div>
          <div class="bar"><span class="bar-fill" :style="{ width: progress + '%' }"></span></div>
          <div class="pg-stages">
            <span
              v-for="(s, i) in stages"
              :key="s"
              class="pg-step"
              :class="{ done: progress > (i + 1) * 18, on: stage.includes(s.slice(0, 2)) }"
            >
              {{ s }}
            </span>
          </div>
          <p v-if="taskId" class="task-id">任务 {{ taskId }}</p>
        </div>
      </div>

      <p v-if="errorMsg" class="err-line">{{ errorMsg }}</p>

      <div class="next-bar">
        <span class="next-hint">{{ progress === 100 ? '出片完成，可以去剪辑了' : '生成完成后自动进入下一步' }}</span>
        <div class="actions">
          <button class="ghost" @click="emit('back')">上一步</button>
          <button class="primary" :disabled="progress !== 100" @click="emit('next', videoUrl)">
            下一步 · 剪辑
            <Icon name="arrowRight" :size="14" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
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
  /* 固定高度：内容在内部滚，页面不被拉长 */
  height: clamp(480px, calc(100vh - 216px), 820px);
  overflow: hidden;
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

.link-btn {
  font-size: 10.5px;
  color: #6d8fc4;
  padding: 2px 6px;
  border-radius: 6px;
}

.link-btn:hover {
  background: rgba(109, 143, 196, 0.1);
}






.train-box {
  margin-bottom: 12px;
  padding: 10px 11px;
  border-radius: 11px;
  background: rgba(246, 247, 252, 0.9);
  border: 1px dashed rgba(79, 125, 243, 0.28);
}
.train-tip {
  font-size: 10px;
  color: #8c8ca4;
  line-height: 1.55;
  margin-bottom: 8px;
}
.train-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.train-file {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(30, 30, 60, 0.1);
  font-size: 11px;
  color: #5f5f78;
  cursor: pointer;
  max-width: 150px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.train-file input {
  display: none;
}
.train-name {
  width: 96px;
  height: 28px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 11px;
  border: 1px solid rgba(30, 30, 60, 0.1);
  background: #fff;
  outline: none;
}
.train-msg {
  margin-top: 7px;
  font-size: 10.5px;
  color: #6d7a99;
  line-height: 1.5;
}
.train-msg.err {
  color: #d0503a;
}
.mine-badge {
  position: absolute;
  left: 4px;
  top: 4px;
  font-size: 9px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(140deg, #7c9cf5, #4f7df3);
  padding: 1px 6px;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(79, 125, 243, 0.4);
}
.mine-tag {
  margin-left: 5px;
  font-size: 8.5px;
  font-weight: 500;
  color: #2f5cd6;
  background: rgba(79, 125, 243, 0.12);
  padding: 1px 5px;
  border-radius: 999px;
  vertical-align: middle;
}
/* ---- 形象库：按真实比例排，横屏就横着、竖屏就竖着 ---- */
.my-scroll {
  flex: 0 1 auto;
  max-height: 44%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}
.lib-scroll {
  flex: 1 1 0;
  min-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
  margin-bottom: 10px;
}
.voice-scroll {
  flex: 0 0 auto;
  max-height: 150px;   /* 正好 3 项整，别切半截 */
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}
.thin-scroll::-webkit-scrollbar {
  width: 6px;
}
.thin-scroll::-webkit-scrollbar-thumb {
  background: rgba(40, 40, 80, 0.14);
  border-radius: 999px;
}
.thin-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #8c8ca4;
  margin: 0 0 8px;
  padding: 2px 0 5px;
  position: sticky;
  top: -1px;
  z-index: 2;
  background: rgba(252, 252, 254, 0.97);
}
.group-title em {
  font-style: normal;
  font-size: 9.5px;
  color: #6d7a99;
  background: rgba(40, 40, 80, 0.06);
  padding: 1px 6px;
  border-radius: 999px;
}
.avatar-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 10px;
  align-items: flex-start;
}
.avatar-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  flex: 0 0 auto;
}
.avatar-thumb {
  position: relative;
  width: 100%;
  height: 104px;   /* 和 THUMB_H 一致；写 100% 会被下面的名字行挤扁 */
  border-radius: 8px;
  overflow: hidden;
  background: #eef0f6;
  box-shadow: 0 0 0 1px rgba(30, 30, 60, 0.06);
  transition: box-shadow 0.15s ease, transform 0.15s ease;
  display: block;
}
.avatar-card:hover .avatar-thumb {
  box-shadow: 0 0 0 1px rgba(79, 125, 243, 0.35);
}
.avatar-card.on .avatar-thumb {
  box-shadow: 0 0 0 2px #4f7df3;
}
.chk {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #4f7df3;
  color: #fff;
  font-size: 9px;
  display: grid;
  place-items: center;
  box-shadow: 0 1px 4px rgba(79, 125, 243, 0.5);
}
.avatar-name {
  font-size: 10px;
  line-height: 1.3;
  color: #5f5f78;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.avatar-card.on .avatar-name {
  color: #2f5cd6;
  font-weight: 500;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  border-radius: inherit;
}
.loading-line {
  font-size: 11px;
  color: #a0a0b4;
  padding: 8px 2px;
}
.voice-count {
  font-size: 9.5px;
  color: #b0b0c2;
  background: rgba(40, 40, 80, 0.05);
  padding: 1px 6px;
  border-radius: 999px;
}
.err-line {
  font-size: 10.5px;
  color: #d4756b;
  padding: 6px 2px;
}



.field-label {
  font-size: 11px;
  color: #8c8ca4;
  margin-bottom: 7px;
}

.voice-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.voice {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 11px;
  border-radius: 10px;
  border: 1px solid rgba(30, 30, 60, 0.06);
  background: rgba(255, 255, 255, 0.55);
  text-align: left;
  transition: all 0.16s ease;
}

.voice.on {
  border-color: rgba(79, 125, 243, 0.45);
  background: rgba(244, 249, 255, 0.95);
}

.voice-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid #cfcfdc;
  flex: 0 0 auto;
}

.voice-dot.on {
  border-color: #4f7df3;
  box-shadow: inset 0 0 0 2.5px #4f7df3;
}

.voice-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.voice-meta strong {
  font-size: 11.5px;
  font-weight: 500;
  color: #2c2c40;
}

.voice-meta em {
  font-style: normal;
  font-size: 9.5px;
  color: #a5a5b8;
}

.summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 11px 12px;
  border-radius: 11px;
  background: rgba(248, 249, 253, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.04);
  margin-bottom: 16px;
}

.sm-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.sm-k {
  font-size: 10.5px;
  color: #a0a0b4;
}

.sm-v {
  font-size: 11.5px;
  font-weight: 500;
  color: #33334a;
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.chip-btn {
  font-size: 11px;
  padding: 5px 11px;
  border-radius: 8px;
  border: 1px solid rgba(30, 30, 60, 0.07);
  color: #6f6f86;
  background: rgba(255, 255, 255, 0.6);
  transition: all 0.16s ease;
}

.chip-btn.on {
  border-color: rgba(79, 125, 243, 0.5);
  color: #3a63c0;
  background: rgba(240, 246, 255, 0.95);
}

.chip-btn.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.run-box {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px dashed rgba(30, 30, 60, 0.1);
  background: rgba(250, 250, 253, 0.5);
  padding: 20px;
  min-height: 0;
}
.run-box--done {
  border-style: solid;
  border-color: rgba(79, 125, 243, 0.22);
  background: rgba(246, 249, 255, 0.6);
  padding: 12px;
}
.run-done {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
}
.done-video {
  max-width: 100%;
  max-height: 246px;
  border-radius: 10px;
  background: #0d0d18;
  object-fit: contain;
  box-shadow: 0 6px 18px rgba(20, 24, 60, 0.16);
}
.done-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 10.5px;
  color: #8f8fa8;
}
.dm-ok {
  color: #2f7d52;
  font-weight: 600;
  background: rgba(70, 185, 138, 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}
.dm-dim {
  color: #8f8fa8;
}
.done-acts {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: center;
}
.ghost.sm,
.primary.sm {
  height: 28px;
  padding: 0 11px;
  font-size: 11.5px;
  border-radius: 8px;
}
a.ghost.sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
}

/* 输出规格：一行事实，不是按钮 */
.spec-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 9px;
  background: rgba(248, 249, 253, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.05);
  margin-bottom: 14px;
}
.spec-line strong {
  font-size: 12px;
  font-weight: 600;
  color: #33334a;
}
.spec-line em {
  font-style: normal;
  font-size: 10px;
  color: #a0a0b4;
}

.run-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.run-ico {
  color: #b8c6e4;
  margin-bottom: 2px;
}

.need-hint {
  font-size: 11px;
  color: #b07a2a;
  background: rgba(214, 158, 46, 0.09);
  border: 1px solid rgba(214, 158, 46, 0.2);
  border-radius: 8px;
  padding: 7px 11px;
  margin: 10px 0 4px;
  line-height: 1.45;
}
.run-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #4a4a60;
}

.run-sub {
  font-size: 10.5px;
  color: #a5a5b8;
  margin-bottom: 10px;
}

.run-progress {
  width: 100%;
  padding: 0 6px;
}

.pg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.pg-stage {
  font-size: 12px;
  font-weight: 600;
  color: #3a3a52;
}

.pg-pct {
  font-size: 12px;
  color: #4f7df3;
  font-weight: 600;
}

.pg-right {
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.pg-time {
  font-size: 10px;
  color: #a5a5b8;
}

.result-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 11px;
  font-size: 11.5px;
  color: #3a63c0;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(240, 246, 255, 0.95);
}

.result-link:hover {
  background: rgba(228, 239, 255, 1);
}

.task-id {
  font-size: 9.5px;
  color: #b9b9cb;
  margin-top: 8px;
}

.err-line {
  font-size: 10.5px;
  color: #d4756b;
  padding: 8px 2px 0;
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

.pg-stages {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  gap: 4px;
}

.pg-step {
  font-size: 9.5px;
  color: #b0b0c2;
  transition: color 0.2s ease;
}

.pg-step.done {
  color: #8f8fa8;
}

.pg-step.on {
  color: #4f7df3;
  font-weight: 600;
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
    height: auto;
    min-height: 340px;
  }
  .lib-scroll {
    max-height: 420px;
  }
  .voice-scroll {
    max-height: 320px;
  }
}
</style>
