<template>
  <div class="works">
    <header class="wk-head">
      <div>
        <h3>历史作品</h3>
        <p class="wk-sub">扫描服务器上的任务目录，重启也不会丢</p>
      </div>
      <button class="wk-btn" :disabled="loading" @click="load()">
        <Icon name="arrowRight" :size="12" />
        {{ loading ? '读取中…' : '刷新' }}
      </button>
    </header>

    <p v-if="error" class="wk-err">{{ error }}</p>

    <div v-if="!loading && !items.length" class="wk-empty">
      <p class="we-t">还没有作品</p>
      <p class="we-s">切到「后期成片」跑一条，这里就会出现</p>
    </div>

    <div class="wk-list thin-scroll">
      <article v-for="w in items" :key="w.jobId" class="wk-item" :class="w.status.toLowerCase()">
        <div class="wk-thumb">
          <video v-if="w.video" :src="w.video" muted preload="metadata" playsinline></video>
          <span v-else class="wk-noVideo">{{ w.status === 'FAILED' ? '!' : '…' }}</span>
        </div>

        <div class="wk-meta">
          <strong>{{ fmtAt(w.at) }}</strong>
          <span class="wk-tags">
            <i class="tag" :class="w.status.toLowerCase()">{{ statusText(w.status) }}</i>
            <i v-if="w.size" class="tag">{{ (w.size / 1048576).toFixed(1) }} MB</i>
            <i v-if="w.duration" class="tag">{{ Math.round(w.duration) }}s</i>
            <i v-if="w.hasShotlist" class="tag">可改</i>
          </span>
          <em v-if="w.error" class="wk-errline">{{ w.error.slice(0, 60) }}</em>
          <span v-else-if="w.status === 'RUNNING'" class="wk-id">{{ w.step || '渲染中' }} · {{ w.progress || 0 }}%</span>
          <span v-else class="wk-id">{{ w.jobId }}</span>
        </div>

        <div class="wk-acts">
          <a v-if="w.video" class="wk-btn" :href="w.video" download>
            <Icon name="publish" :size="12" />
            下载
          </a>
          <button v-if="w.hasShotlist" class="wk-btn" :disabled="w.status === 'RUNNING'" @click="edit(w)">
            <Icon name="grid" :size="12" />
            改分镜
          </button>
          <button class="wk-btn" :disabled="busy === w.jobId" @click="retry(w)">
            {{ busy === w.jobId ? '提交中…' : '重跑' }}
          </button>
        </div>
      </article>
    </div>

    <p v-if="msg" class="wk-msg">{{ msg }}</p>

    <ShotEditor :job-id="editing" :open="Boolean(editing)" @close="editing = ''" @done="onEdited" />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from '../Icon.vue'
import ShotEditor from './ShotEditor.vue'

const items = ref([])
const loading = ref(false)
const error = ref('')
const msg = ref('')
const busy = ref('')
const editing = ref('')
let timer = null

async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const r = await fetch('/api/works')
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '读取失败')
    items.value = d.data || []
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    if (!silent) loading.value = false
  }
}

/** 有任务在跑时自动刷新，用户不用手动点 */
function autoTick() {
  if (items.value.some((w) => w.status === 'RUNNING' || w.status === 'PENDING')) load(true)
}

function edit(w) {
  editing.value = w.jobId
}

function onEdited(e) {
  // 提交重渲那一刻就把列表刷成「渲染中」，进度靠自动轮询接上
  load(true)
  if (e?.pending) msg.value = '已提交重渲，跑完这条会自己更新'
}

async function retry(w) {
  busy.value = w.jobId
  msg.value = ''
  try {
    const r = await fetch(`/api/works/${w.jobId}/retry`, { method: 'POST' })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '重跑失败')
    msg.value = `已重新排队：${d.data.jobId}（复用原素材和字幕时间，跳过最慢的对齐步骤）`
    await load()
  } catch (e) {
    msg.value = String(e.message || e)
  } finally {
    busy.value = ''
  }
}

function fmtAt(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function statusText(s) {
  return { SUCCESS: '已完成', FAILED: '失败', RUNNING: '渲染中', PENDING: '排队中' }[s] || '未知'
}

onMounted(() => {
  load()
  timer = setInterval(autoTick, 3000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.works {
  display: flex;
  flex-direction: column;
  height: clamp(480px, calc(100vh - 240px), 820px);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 10px 28px rgba(60, 60, 110, 0.06);
  padding: 16px;
  overflow: hidden;
}

.wk-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.wk-head h3 {
  font-size: 14px;
  font-weight: 700;
  color: #1c1c30;
  margin: 0 0 3px;
}
.wk-sub {
  font-size: 10.5px;
  color: #a0a0b4;
  margin: 0;
}

.wk-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(30, 30, 60, 0.1);
  background: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  color: #5f5f78;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.14s ease;
}
.wk-btn:hover:not(:disabled) {
  border-color: rgba(79, 125, 243, 0.4);
  color: #3a5fd0;
}
.wk-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.wk-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-right: 3px;
}

.wk-item {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 9px;
  border-radius: 11px;
  border: 1px solid rgba(30, 30, 60, 0.07);
  background: rgba(255, 255, 255, 0.55);
}
.wk-item.failed {
  border-color: rgba(224, 69, 44, 0.25);
  background: rgba(255, 247, 245, 0.7);
}

.wk-thumb {
  width: 96px;
  height: 54px;
  border-radius: 7px;
  overflow: hidden;
  background: #eef0f6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wk-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.wk-noVideo {
  font-size: 16px;
  color: #b9b9cc;
}

.wk-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.wk-meta strong {
  font-size: 12px;
  color: #1c1c30;
}
.wk-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.tag {
  font-style: normal;
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(40, 40, 80, 0.06);
  color: #6d7a99;
}
.tag.success {
  background: rgba(70, 185, 138, 0.12);
  color: #2f7d5c;
}
.tag.failed {
  background: rgba(224, 69, 44, 0.1);
  color: #b23a22;
}
.tag.running {
  background: rgba(79, 125, 243, 0.1);
  color: #3a5fd0;
}
.wk-id {
  font-size: 9.5px;
  color: #b0b0c2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-errline {
  font-style: normal;
  font-size: 9.5px;
  color: #c0563a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wk-acts {
  display: flex;
  gap: 6px;
}

.wk-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.we-t {
  font-size: 12.5px;
  font-weight: 600;
  color: #5f5f78;
  margin: 0;
}
.we-s {
  font-size: 10.5px;
  color: #a8a8bd;
  margin: 0;
}

.wk-err {
  font-size: 11px;
  color: #c0563a;
  margin: 0 0 8px;
}
.wk-msg {
  font-size: 10.5px;
  color: #2f7d5c;
  margin: 10px 0 0;
}
</style>
