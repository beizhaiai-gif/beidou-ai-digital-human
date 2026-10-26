<script setup>
import { ref, watch } from 'vue'
import StepRail from '../components/dh/StepRail.vue'
import StepTopic from '../components/dh/StepTopic.vue'
import StepScript from '../components/dh/StepScript.vue'
import StepAvatar from '../components/dh/StepAvatar.vue'
import StepEdit from '../components/dh/StepEdit.vue'
import Icon from '../components/Icon.vue'
import { readStore, writeStore, clearStore } from '../lib/store.js'

const steps = [
  { key: 'topic', title: '爆款选题', desc: '热榜 / 对标博主' },
  { key: 'script', title: '薛辉文案', desc: '四模型改写' },
  { key: 'avatar', title: '数字人出片', desc: '口型驱动' },
  { key: 'edit', title: '智能剪辑', desc: '字幕 / B-roll' },
]

/** 进来先把上次走到哪一步、写了什么稿摆回来 —— 切菜单不该丢进度 */
const SAVED = readStore('flow', {}) || {}
const qs = new URLSearchParams(window.location.search)
const startStep = Math.min(3, Math.max(0, Number(qs.get('step') ?? SAVED.cur ?? 0)))

const cur = ref(startStep)
const done = ref(SAVED.done || [])
const topic = ref(SAVED.topic || null)
const script = ref(SAVED.script || '')
const videoUrl = ref(qs.get('video') || SAVED.videoUrl || '')

watch(
  [cur, done, topic, script, videoUrl],
  () => {
    writeStore('flow', {
      cur: cur.value,
      done: done.value,
      topic: topic.value,
      script: script.value,
      videoUrl: videoUrl.value,
    })
  },
  { deep: true },
)

function markDone(i) {
  if (!done.value.includes(i)) done.value = [...done.value, i]
}

function onTopicNext(t) {
  topic.value = t
  markDone(0)
  cur.value = 1
}

function onScriptNext(s) {
  script.value = s
  markDone(1)
  cur.value = 2
}

function onAvatarNext(url) {
  videoUrl.value = url || ''
  markDone(2)
  cur.value = 3
}

/** 四步全开放：想从哪步进就从哪步进，缺前置时各步骤自己给提示，不做硬锁 */
function jump(i) {
  if (i >= 0 && i < steps.length) cur.value = i
}

function restart() {
  cur.value = 0
  done.value = []
  topic.value = null
  script.value = ''
  videoUrl.value = ''
  // 新建任务只清「这一单」的进度；采集到的博主和作品是资产，保留
  clearStore('flow')
  clearStore('script')
  clearStore('avatar')
}
</script>

<template>
  <div class="scroll">
    <div class="dh">
      <header class="dh-head">
        <div class="dh-title">
          <h1>数字人台</h1>
          <p>一条流水线：找选题 → 写文案 → 出数字人 → 剪成片</p>
        </div>
        <div class="dh-actions">
          <button class="ghost sm">历史任务</button>
          <button class="ghost sm" @click="restart">
            <Icon name="sparkle" :size="12" />
            新建任务
          </button>
        </div>
      </header>

      <StepRail :steps="steps" :current="cur" :done="done" @jump="jump" />

      <!-- KeepAlive：来回切步骤时组件不销毁，热榜/选题/稿子都留着 -->
      <KeepAlive>
        <StepTopic v-if="cur === 0" key="topic" @next="onTopicNext" />
        <StepScript
          v-else-if="cur === 1"
          key="script"
          :topic="topic"
          @next="onScriptNext"
          @back="cur = 0"
        />
        <StepAvatar
          v-else-if="cur === 2"
          key="avatar"
          :script="script"
          @next="onAvatarNext"
          @back="cur = 1"
        />
        <StepEdit
          v-else
          key="edit"
          :script="script"
          :video-url="videoUrl"
          @back="cur = 2"
          @restart="restart"
        />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 18px 22px;
}

.dh {
  width: 100%;
}

.dh-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.dh-title h1 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: #17172a;
}

.dh-title p {
  margin-top: 6px;
  font-size: 12px;
  color: #86869c;
}

.dh-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 11.5px;
  color: #5f5f78;
  border: 1px solid rgba(30, 30, 60, 0.09);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(10px);
  transition: all 0.16s ease;
}

.ghost:hover {
  background: #fff;
  color: #2c2c40;
  box-shadow: 0 3px 10px rgba(60, 60, 110, 0.08);
}

@media (max-width: 720px) {
  .scroll {
    padding: 6px 14px 18px;
  }
  .dh-title h1 {
    font-size: 19px;
  }
}
</style>
