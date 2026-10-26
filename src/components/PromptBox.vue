<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import Icon from './Icon.vue'
import ChatThread from './ChatThread.vue'
import { useChat } from '../composables/useChat.js'
import { chatBridge } from '../lib/chatBridge.js'

const emit = defineEmits(['go'])

const tabs = [
  { key: 'auto', label: '自动', icon: 'sparkle' },
  { key: 'chat', label: '对话' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'assistant', label: '助手', caret: true },
]

const activeTab = ref('auto')
const draft = ref('')
const inputEl = ref(null)
const wrapEl = ref(null)
const notice = ref('')

const chat = useChat()

const SUGS = [
  '帮我起 5 条抖音女装带货选题',
  '拆解这条爆款视频的结构',
  '把这段话改成口播稿',
]

/** 只有「自动 / 对话」真的会回话，其他能力还没接 */
const CHATTY = ['auto', 'chat']
const canSend = computed(() => draft.value.trim() && !chat.streaming.value)

const expanded = computed(() => chat.hasChat.value)

watch(expanded, async (v) => {
  if (v) {
    await nextTick()
    // 只在对话区超出视口时才滚，别把上面的内容顶飞
    wrapEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
})

function submit() {
  const text = draft.value.trim()
  if (!text) return
  if (!CHATTY.includes(activeTab.value)) {
    notice.value = `「${tabs.find((t) => t.key === activeTab.value)?.label}」还在接，先用对话问北北`
    activeTab.value = 'chat'
    setTimeout(() => (notice.value = ''), 3200)
    return
  }
  notice.value = ''
  draft.value = ''
  chat.send(text)
  autosize()
}

function pick(text) {
  draft.value = text
  nextTick(() => {
    inputEl.value?.focus()
    autosize()
  })
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

function autosize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 132) + 'px'
}

function expandFull() {
  // 把首页这轮对话原样搬到完整页，过去就能接着聊
  chatBridge.messages = chat.messages.value.map((m) => ({ ...m, streaming: false }))
  emit('go', 'chat')
}
</script>

<template>
  <section ref="wrapEl" class="composer-wrap">
    <div v-if="!expanded" class="composer-head">
      <h3 class="composer-title">从一句话开始创作</h3>
      <span v-if="notice" class="head-notice">{{ notice }}</span>
    </div>

    <!-- 对话区（提交后展开） -->
    <div v-if="expanded" class="inline-chat">
      <div class="ic-head">
        <span class="ic-title">
          <Icon name="chat" :size="12" />
          和北北对话
        </span>
        <div class="ic-actions">
          <button class="ic-link" @click="expandFull">展开到全屏</button>
          <button class="ic-link" @click="chat.reset()">
            <Icon name="close" :size="11" />
            清空
          </button>
        </div>
      </div>
      <ChatThread
        :messages="chat.messages.value"
        :streaming="chat.streaming.value"
        compact
        :suggestions="SUGS"
        @pick="pick"
      />
    </div>

    <div class="composer" :class="{ 'composer--live': expanded }">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="{ on: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          <Icon v-if="t.icon" :name="t.icon" :size="14" />
          <span>{{ t.label }}</span>
          <Icon v-if="t.caret" name="chevronDown" :size="12" class="tab-caret" />
        </button>
      </div>

      <textarea
        ref="inputEl"
        v-model="draft"
        class="composer-input"
        :rows="expanded ? 1 : 3"
        :placeholder="expanded ? '继续说… Enter 发送 · Shift+Enter 换行' : 'Hi~有什么想问小助手的'"
        @input="autosize"
        @keydown="onKeydown"
      />

      <div class="composer-foot">
        <button class="icon-btn" title="添加附件">
          <Icon name="paperclip" :size="17" />
        </button>
        <div class="foot-right">
          <button class="icon-btn" title="语音输入">
            <Icon name="mic" :size="17" />
          </button>
          <button v-if="chat.streaming.value" class="send-btn stop" title="停止生成" @click="chat.stop()">
            <Icon name="close" :size="14" />
          </button>
          <button v-else class="send-btn" :class="{ ready: canSend }" title="发送" @click="submit">
            <Icon name="send" :size="15" />
          </button>
        </div>
      </div>
    </div>

    <p class="disclaimer">内容由 AI 生成，请注意甄别</p>
  </section>
</template>

<style scoped>
.composer-wrap {
  margin-top: 22px;
}

.composer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.composer-title {
  font-size: 13px;
  font-weight: 600;
  color: #3a3a4d;
  letter-spacing: 0.2px;
}

.head-notice {
  font-size: 10.5px;
  color: #b08a6a;
  background: rgba(255, 246, 235, 0.95);
  border: 1px solid rgba(255, 226, 198, 0.9);
  border-radius: 7px;
  padding: 3px 9px;
}

/* ---- 内嵌对话区 ---- */
.inline-chat {
  height: clamp(220px, 38vh, 400px);
  display: flex;
  flex-direction: column;
  margin-bottom: 11px;
  padding: 10px 12px 4px;
  border-radius: 14px;
  background: rgba(248, 249, 254, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: inset 0 1px 2px rgba(40, 40, 80, 0.02);
  animation: rise 0.28s ease;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ic-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  margin-bottom: 2px;
  border-bottom: 1px solid rgba(30, 30, 60, 0.05);
}

.ic-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #6d7a99;
}

.ic-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ic-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: #8a8aa2;
  padding: 3px 7px;
  border-radius: 6px;
}

.ic-link:hover {
  background: rgba(255, 255, 255, 0.9);
  color: #4f5f80;
}

/* ---- 输入区 ---- */
.composer {
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 10px 30px rgba(60, 60, 110, 0.07);
  padding: 12px 14px 10px;
  transition: box-shadow 0.2s ease;
}

.composer--live {
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.04), 0 12px 32px rgba(79, 125, 243, 0.12);
  border-color: rgba(79, 125, 243, 0.22);
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 99px;
  background: rgba(245, 245, 250, 0.9);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 11px;
  border-radius: 99px;
  font-size: 12.5px;
  color: #6e6e82;
  transition: all 0.16s ease;
}

.tab svg {
  color: #8f8fa6;
}

.tab:hover {
  color: #33334a;
}

.tab.on {
  background: #fff;
  color: #1d1d2b;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(40, 40, 80, 0.1);
}

.tab.on svg {
  color: #4f7df3;
}

.tab-caret {
  margin-left: -1px;
  opacity: 0.6;
}

.composer-input {
  width: 100%;
  min-height: 26px;
  max-height: 132px;
  margin-top: 10px;
  font-size: 13.5px;
  line-height: 1.6;
  color: #22222f;
  resize: none;
  overflow-y: auto;
}

.composer-input::placeholder {
  color: #a8a8ba;
}

.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 2px;
}

.foot-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #9a9aae;
  transition: background 0.16s ease, color 0.16s ease;
}

.icon-btn:hover {
  background: rgba(240, 240, 248, 0.9);
  color: #5e5e78;
}

.send-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #d8e6fa;
  color: #8ba8cf;
  transition: all 0.18s ease;
}

.send-btn.ready {
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  color: #fff;
  box-shadow: 0 3px 10px rgba(79, 125, 243, 0.35);
}

.send-btn.stop {
  background: #f0eef8;
  color: #6a6a86;
}

.disclaimer {
  text-align: center;
  font-size: 11px;
  color: #b2b2c4;
  margin-top: 12px;
}
</style>
