<script setup>
import { ref, computed, watch } from 'vue'
import Icon from '../Icon.vue'
import { readStore, writeStore } from '../../lib/store.js'
import {
  FRAMEWORKS,
  ELEMENTS,
  normalizeFw,
  toggleElement,
  CHARS_PER_SEC,
  countChars,
} from '../../constants/xuehui.js'

const props = defineProps({
  topic: { type: Object, default: null },
})

/** 上次的写作参数和草稿，切菜单 / 刷新回来接着写 */
const SAVED = readStore('script', {}) || {}

/** 第一步带来的脚本模型（晒过程/讲故事/教知识/说观点要正确还原，别再一律压成教知识） */
const fw = ref(normalizeFw(props.topic?.fw || SAVED.fw))
/** 第一步选过的爆款元素，带到这一步可以继续改 */
const els = ref([...(props.topic?.els?.length ? props.topic.els : SAVED.els || [])])
const srcOpen = ref(Boolean(props.topic?.why))

const tone = ref(SAVED.tone || 'direct')
const duration = ref(SAVED.duration || 45)
const writing = ref(false)
const writeSec = ref(0)
let writeTimer = null
/** 没走第一步也能用：直接手填一个题目 */
const manualTopic = ref(SAVED.manualTopic || '')
const errorMsg = ref('')

/** 复刻模式：第一步提取来的原文案，先铺在右边，点生成才改写成自己的 */
const original = computed(() => props.topic?.original || '')
const script = ref(props.topic?.original || SAVED.script || '')

const topicTitle = computed(() => props.topic?.title || manualTopic.value.trim())

/** 现场存档：切菜单、刷新回来稿子和参数都还在 */
watch(
  [fw, els, tone, duration, manualTopic, script],
  () => {
    writeStore('script', {
      fw: fw.value,
      els: els.value,
      tone: tone.value,
      duration: duration.value,
      manualTopic: manualTopic.value,
      script: script.value,
    })
  },
  { deep: true },
)

const placeholder = computed(() => `「${topicTitle.value || '你的题目'}」的口播稿会出现在这里。

点右上「生成口播稿」，薛辉智能体会按「${FRAMEWORKS.find((f) => f.key === fw.value)?.label}」模型写一版可直接念的稿子。
也可以直接在右侧空白处手写稿子，写完就能进下一步。`)

const wordCount = computed(() => countChars(script.value))
const estSeconds = computed(() => Math.round(wordCount.value / CHARS_PER_SEC))
/** 目标时长换成字数区间，让用户知道该写多少 */
const targetChars = computed(() => Math.round(duration.value * CHARS_PER_SEC))
const overSec = computed(() => estSeconds.value - duration.value)
/** 偏差在 ±15% 内算达标 */
const durOk = computed(() => script.value && Math.abs(overSec.value) <= duration.value * 0.15)

const toggleEl = (name) => {
  els.value = toggleElement(els.value, name, 3)
}

const thinkLen = ref(0)   // 思考阶段已经想了多少字，用来给用户「在动」的反馈
const compressedTip = ref('')
const streaming = ref(false)

/** 流式写稿：边生成边往编辑器里写 */
async function generate() {
  if (!topicTitle.value || writing.value) return
  writing.value = true
  streaming.value = false
  errorMsg.value = ''
  writeSec.value = 0
  thinkLen.value = 0
  compressedTip.value = ''
  clearInterval(writeTimer)
  writeTimer = setInterval(() => { writeSec.value += 1 }, 1000)

  let acc = ''
  try {
    const res = await fetch('/api/script/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: topicTitle.value,
        framework: fw.value,
        tone: tone.value,
        duration: duration.value,
        extra: props.topic?.why || '',
        elements: els.value,
        original: original.value,
      }),
    })
    if (!res.ok || !res.body) {
      errorMsg.value = `生成失败 HTTP ${res.status}`
      return
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder('utf-8')
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })

      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of frame.split('\n')) {
          const t2 = line.trim()
          if (!t2.startsWith('data:')) continue
          let ev
          try {
            ev = JSON.parse(t2.slice(5).trim())
          } catch {
            continue
          }

          if (ev.type === 'content') {
            if (!streaming.value) {
              streaming.value = true
              script.value = '' // 正文开始时清掉原文案
            }
            acc += ev.text
            script.value = acc
          } else if (ev.type === 'thinking') {
            thinkLen.value = ev.len
          } else if (ev.type === 'compressed') {
            script.value = ev.text
            acc = ev.text
            compressedTip.value = `超出目标字数，已自动压缩到 ${ev.chars} 字`
          } else if (ev.type === 'error') {
            errorMsg.value = ev.error || '生成失败'
          }
        }
      }
    }

    if (!acc) errorMsg.value = errorMsg.value || '模型没写出正文，换个短一点的时长再试'
  } catch (e) {
    errorMsg.value = String(e.message || e)
  } finally {
    writing.value = false
    streaming.value = false
    clearInterval(writeTimer)
    writeTimer = null
  }
}

const emit = defineEmits(['next', 'back'])
</script>

<template>
  <div class="step">
    <!-- 左：参数（模型和元素来自第一步，这里只做微调） -->
    <section class="pane pane--left">
      <header class="pane-head">
        <h3>写作参数</h3>
        <span v-if="topic" class="from-step1">已从选题带过来</span>
      </header>

      <div v-if="topic" class="topic-card">
        <span class="tc-label">当前选题</span>
        <p class="tc-title">{{ topic.title }}</p>
        <span v-if="topic.hook" class="tc-hook">钩子 · {{ topic.hook }}</span>
      </div>
      <div v-else class="manual-topic">
        <span class="tc-label">没走第一步？直接填题目</span>
        <input v-model="manualTopic" class="mt-input" placeholder="例：AI 数字人三步就能开播" />
        <span class="mt-hint">填完点右上「生成口播稿」即可</span>
      </div>

      <!-- 模型：一行小 tab（原来是四张大卡片，跟第一步重复） -->
      <p class="field-label">
        脚本模型
        <span class="label-hint">决定这条怎么讲</span>
      </p>
      <div class="fw-tabs">
        <button
          v-for="f in FRAMEWORKS"
          :key="f.key"
          class="fw-tab"
          :class="{ on: fw === f.key }"
          :title="f.hint"
          @click="fw = f.key"
        >
          {{ f.label }}
        </button>
      </div>

      <!-- 元素：和上面模型是并列的两个维度，都在这步选 -->
      <p class="field-label">
        爆款元素
        <span class="num">{{ els.length }}/3</span>
        <span class="label-hint">选填，不选就让 AI 自己挑</span>
      </p>

      <div class="el-chips">
        <button
          v-for="e in ELEMENTS"
          :key="e.name"
          class="el-chip"
          :class="{ on: els.includes(e.name) }"
          :title="e.desc"
          @click="toggleEl(e.name)"
        >
          {{ e.name }}
        </button>
      </div>

      <p class="field-label">语气</p>
      <div class="chips">
        <button
          v-for="t in [{ k: 'direct', l: '直接犀利' }, { k: 'warm', l: '温和亲切' }, { k: 'dry', l: '干货理性' }]"
          :key="t.k"
          class="chip-btn"
          :class="{ on: tone === t.k }"
          @click="tone = t.k"
        >
          {{ t.l }}
        </button>
      </div>

      <p class="field-label">目标时长</p>
      <div class="dur-row">
        <input v-model.number="duration" type="range" min="30" max="120" step="15" class="range" />
        <span class="dur-val">{{ duration }}s</span>
        <span class="dur-chars">≈ {{ targetChars }} 字</span>
      </div>

      <template v-if="topic?.why">
        <button class="src-toggle" @click="srcOpen = !srcOpen">
          <Icon name="chevronDown" :size="11" class="src-caret" :class="{ open: srcOpen }" />
          参考素材
        </button>
        <p v-if="srcOpen" class="src-body">{{ topic.why }}</p>
      </template>

      <p class="inherit-note">
        模型和元素只决定「这一条怎么讲」，不影响第①步出选题。
      </p>
    </section>

    <!-- 右：稿子 -->
    <section class="pane">
      <header class="pane-head">
        <h3>口播稿<span v-if="original" class="rewrite-tag">复刻改写</span></h3>
        <div class="head-right">
          <span v-if="script" class="stat" :class="{ ok: durOk, over: !durOk && overSec > 0 }">
            {{ wordCount }} 字 · 约 {{ estSeconds }}s
            <em>目标 {{ duration }}s</em>
          </span>
          <span v-else class="stat">目标 {{ duration }}s ≈ {{ targetChars }} 字</span>
          <button class="primary sm" :disabled="!topicTitle || writing" @click="generate">
            <Icon name="sparkle" :size="13" />
            {{ writing ? `写作中… ${writeSec}s` : '生成口播稿' }}
          </button>
        </div>
      </header>

      <p v-if="compressedTip" class="compressed-note">{{ compressedTip }}</p>

      <p v-if="writing" class="writing-note">
        <span class="wn-dot"></span>
        <template v-if="!streaming">
          正在起笔（{{ writeSec }}s）…通常 1 秒内就开始出字
        </template>
        <template v-else>正在写，已有 {{ script.length }} 字…</template>
      </p>

      <p v-if="original" class="rewrite-note">
        右边现在是<b>原文案</b>（别人视频里说的）。点右上「生成口播稿」，会按左边的模型 / 元素 / 语气重写成你的版本，不照抄。
      </p>

      <textarea v-model="script" class="editor" :placeholder="placeholder" />

      <p v-if="errorMsg" class="err-line">{{ errorMsg }}</p>

      <div class="next-bar">
        <span class="next-hint">
          {{ script ? '稿子可直接改，改完进下一步' : '还没有稿子' }}
        </span>
        <div class="actions">
          <button class="ghost" @click="emit('back')">上一步</button>
          <button class="primary" :disabled="!script.trim()" @click="emit('next', script)">
            下一步 · 出片
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
  grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr);
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

.from-step1 {
  font-size: 9.5px;
  color: #8a7aa8;
  background: rgba(143, 123, 240, 0.1);
  padding: 2px 7px;
  border-radius: 999px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat {
  font-size: 10.5px;
  color: #a5a5b8;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.stat em {
  font-style: normal;
  font-size: 9.5px;
  color: #b8b8ca;
  background: rgba(40, 40, 80, 0.05);
  padding: 1px 6px;
  border-radius: 999px;
}
.stat.ok {
  color: #2f9e6f;
}
.stat.ok em {
  color: #2f9e6f;
  background: rgba(70, 185, 138, 0.12);
}
.stat.over {
  color: #c98a3f;
}
.stat.over em {
  color: #c98a3f;
  background: rgba(214, 158, 46, 0.14);
}
.dur-chars {
  font-size: 9.5px;
  color: #b0b0c2;
  min-width: 52px;
}

.topic-card {
  padding: 11px 12px;
  border-radius: 11px;
  background: linear-gradient(100deg, rgba(255, 240, 250, 0.9), rgba(244, 247, 255, 0.9));
  border: 1px solid rgba(255, 226, 244, 0.9);
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 16px;
}

.tc-label {
  font-size: 9.5px;
  color: #b58ba8;
  letter-spacing: 0.5px;
}

.tc-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #2a2233;
  line-height: 1.45;
}

.tc-hook {
  font-size: 10px;
  color: #a08fa8;
}

.manual-topic {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 13px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.66);
  border: 1px dashed rgba(79, 125, 243, 0.28);
  margin-bottom: 4px;
}
.mt-input {
  height: 32px;
  padding: 0 11px;
  border-radius: 8px;
  font-size: 12px;
  color: #22223a;
  border: 1px solid rgba(30, 30, 60, 0.1);
  background: #fff;
  outline: none;
}
.mt-input:focus {
  border-color: rgba(79, 125, 243, 0.5);
  box-shadow: 0 0 0 3px rgba(79, 125, 243, 0.1);
}
.mt-hint {
  font-size: 10.5px;
  color: #9a9ab0;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: #8c8ca4;
  margin-bottom: 7px;
}
.num {
  color: #4f7df3;
  font-weight: 600;
}
.label-hint {
  font-size: 9.5px;
  color: #b3b3c4;
}
.mini-link {
  margin-left: auto;
  font-size: 10.5px;
  color: #6d8fc4;
  padding: 1px 6px;
  border-radius: 6px;
}
.mini-link:hover {
  background: rgba(109, 143, 196, 0.1);
}

/* ---- 模型：一行小 tab ---- */
.fw-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(244, 244, 250, 0.95);
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.fw-tab {
  font-size: 11.5px;
  padding: 5px 11px;
  border-radius: 7px;
  color: #6f6f86;
  transition: all 0.16s ease;
}
.fw-tab:hover {
  color: #33334a;
}
.fw-tab.on {
  background: #fff;
  color: #1d1d2b;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(40, 40, 80, 0.1);
}

/* ---- 元素 chips ---- */
.el-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 16px;
}
.el-chip {
  height: 26px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 11px;
  color: #5f5f78;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.1);
  transition: all 0.14s ease;
}
.el-chip:hover {
  border-color: rgba(79, 125, 243, 0.3);
  color: #3a5fc9;
}
.el-chip.on {
  color: #fff;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  border-color: transparent;
  box-shadow: 0 3px 9px rgba(79, 125, 243, 0.26);
}

.chips {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  flex-wrap: wrap;
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

.dur-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.range {
  flex: 1;
  height: 3px;
  border-radius: 99px;
  appearance: none;
  background: linear-gradient(90deg, #b8cdf8, #e4e9f7);
  outline: none;
}

.range::-webkit-slider-thumb {
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #4f7df3;
  box-shadow: 0 2px 6px rgba(79, 125, 243, 0.4);
  cursor: pointer;
}

.dur-val {
  font-size: 11.5px;
  color: #45455c;
  min-width: 32px;
  text-align: right;
}

/* ---- 参考素材 ---- */
.src-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 16px;
  font-size: 10.5px;
  color: #8a8aa2;
}
.src-toggle:hover {
  color: #4f7df3;
}
.src-caret {
  transition: transform 0.2s ease;
}
.src-caret.open {
  transform: rotate(180deg);
}
.inherit-note {
  margin-top: auto;
  padding-top: 14px;
  font-size: 10px;
  line-height: 1.6;
  color: #b3b3c4;
  border-top: 1px dashed rgba(30, 30, 60, 0.07);
}
.src-body {
  margin-top: 6px;
  font-size: 10.5px;
  line-height: 1.6;
  color: #9a9ab0;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 8px;
  padding: 8px 10px;
}

.rewrite-tag {
  margin-left: 7px;
  font-size: 9px;
  font-weight: 500;
  color: #8a5cc4;
  background: rgba(143, 123, 240, 0.12);
  padding: 2px 6px;
  border-radius: 999px;
  vertical-align: middle;
}
.compressed-note {
  font-size: 10.5px;
  color: #8a6d3b;
  background: rgba(255, 248, 235, 0.95);
  border: 1px solid rgba(214, 158, 46, 0.25);
  border-radius: 9px;
  padding: 7px 10px;
  margin-bottom: 8px;
}
.writing-note {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  line-height: 1.6;
  color: #6d7a99;
  background: rgba(240, 244, 255, 0.9);
  border: 1px solid rgba(79, 125, 243, 0.18);
  border-radius: 9px;
  padding: 8px 10px;
  margin-bottom: 9px;
}
.wn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4f7df3;
  flex: 0 0 auto;
  animation: wn-pulse 1.2s ease-in-out infinite;
}
@keyframes wn-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}
.rewrite-note {
  font-size: 10.5px;
  line-height: 1.6;
  color: #8a8aa2;
  background: rgba(246, 243, 255, 0.9);
  border: 1px solid rgba(143, 123, 240, 0.16);
  border-radius: 9px;
  padding: 8px 10px;
  margin-bottom: 9px;
}
.rewrite-note b {
  color: #6b4a9e;
}
.editor {
  flex: 1;
  min-height: 340px;
  font-size: 13px;
  line-height: 1.85;
  color: #26263a;
  background: rgba(250, 250, 253, 0.7);
  border: 1px solid rgba(30, 30, 60, 0.05);
  border-radius: 11px;
  padding: 14px;
}

.editor::placeholder {
  color: #b0b0c2;
  line-height: 1.7;
}

.err-line {
  font-size: 10.5px;
  color: #d4756b;
  padding: 6px 2px 0;
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

.primary.sm {
  height: 28px;
  padding: 0 11px;
  font-size: 11.5px;
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
</style>
