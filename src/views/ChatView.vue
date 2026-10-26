<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import ChatThread from '../components/ChatThread.vue'
import Icon from '../components/Icon.vue'
import { useChat } from '../composables/useChat.js'
import { chatBridge } from '../lib/chatBridge.js'

const chat = useChat()
const draft = ref('')
const inputEl = ref(null)
const info = ref({ model: '', ready: true })

const SUGS = [
  '帮我起 5 条抖音女装带货的爆款选题',
  '这段口播稿帮我改得更有钩子：……',
  '薛辉八大爆款元素，怎么配到女装带货上？',
  'AI 数字人口播视频，抖音上有哪些限流坑？',
]

const MODEL_LABEL = {
  'deepseek-v4-pro': 'V4-Pro',
  'deepseek-flash': 'V4.1-Flash',
}
const modelLabel = computed(() => MODEL_LABEL[chat.model.value] || MODEL_LABEL[info.value.model] || 'DeepSeek')
const canSend = computed(() => draft.value.trim() && !chat.streaming.value)

onMounted(async () => {
  try {
    const r = await fetch('/api/chat/info')
    const d = await r.json()
    if (d.ok) info.value = d.data
  } catch {
    /* 忽略 */
  }
  // 从首页内嵌框带过来的对话，接着聊
  if (chatBridge.messages?.length) {
    chat.load(chatBridge.messages)
    chatBridge.messages = null
  }
  // ?q=xxx 直接开聊（方便深链 / 从别处跳过来）
  const q = new URLSearchParams(window.location.search).get('q')
  if (q && !chat.hasChat.value) chat.send(q)
  nextTick(() => inputEl.value?.focus())
})

function submit() {
  if (!canSend.value) return
  const t = draft.value.trim()
  draft.value = ''
  chat.send(t)
  autosize()
}

function pick(text) {
  draft.value = text
  nextTick(() => inputEl.value?.focus())
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
  el.style.height = Math.min(el.scrollHeight, 168) + 'px'
}

function newChat() {
  chat.reset()
  draft.value = ''
  nextTick(() => {
    autosize()
    inputEl.value?.focus()
  })
}
</script>

<template>
  <div class="chat-view">
    <header class="cv-head">
      <div class="cv-title">
        <span class="cv-ico"><Icon name="chat" :size="15" /></span>
        <div>
          <h2>文本对话</h2>
          <p>写文案 · 理思路 · 做脚本</p>
        </div>
      </div>
      <div class="cv-right">
        <span class="model-tag">
          <span class="mt-dot"></span>
          {{ modelLabel }}
        </span>
        <button class="ghost" :disabled="!chat.hasChat.value" @click="newChat">
          <Icon name="sparkle" :size="12" />
          新对话
        </button>
      </div>
    </header>

    <ChatThread
      :messages="chat.messages.value"
      :streaming="chat.streaming.value"
      :suggestions="SUGS"
      empty-title="今天想聊点什么？"
      empty-sub="北北在。写稿、拆爆款、算账、理思路，说一句就行"
      @pick="pick"
    />

    <div class="composer">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="ta"
        rows="1"
        placeholder="说你要做什么，Enter 发送 · Shift+Enter 换行"
        @input="autosize"
        @keydown="onKeydown"
      />
      <div class="cf-foot">
        <span class="cf-hint">
          <template v-if="chat.errorMsg.value">
            <button class="retry" @click="chat.retry()">重试</button>
            <span class="cf-err">{{ chat.errorMsg.value }}</span>
          </template>
          <template v-else>内容由 AI 生成，注意甄别</template>
        </span>
        <button v-if="chat.streaming.value" class="send stop" @click="chat.stop()" title="停止生成">
          <Icon name="close" :size="15" />
        </button>
        <button v-else class="send" :class="{ ready: canSend }" :disabled="!canSend" @click="submit" title="发送">
          <Icon name="send" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 18px 6px;
}

.cv-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 11px;
  border-bottom: 1px solid rgba(30, 30, 60, 0.06);
}
.cv-title {
  display: flex;
  align-items: center;
  gap: 9px;
}
.cv-ico {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: #5b6ef0;
  background: linear-gradient(150deg, #eef2fe, #e6e9fd);
  border: 1px solid rgba(255, 255, 255, 0.9);
}
.cv-title h2 {
  font-size: 13.5px;
  font-weight: 600;
  color: #26263a;
}
.cv-title p {
  font-size: 10.5px;
  color: #9a9ab0;
  margin-top: 2px;
}
.cv-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: #6d7a99;
  padding: 4px 9px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(30, 30, 60, 0.07);
}
.mt-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #46b98a;
}
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 27px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 11.5px;
  color: #6f6f86;
  border: 1px solid rgba(30, 30, 60, 0.09);
  background: rgba(255, 255, 255, 0.7);
}
.ghost:hover:not(:disabled) {
  background: #fff;
  color: #33334a;
}
.ghost:disabled {
  opacity: 0.45;
}

.composer {
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 10px 28px rgba(60, 60, 110, 0.07);
  padding: 10px 12px 8px;
}
.ta {
  width: 100%;
  min-height: 26px;
  max-height: 168px;
  font-size: 13px;
  line-height: 1.65;
  color: #22222f;
  resize: none;
  background: transparent;
  overflow-y: auto;
}
.ta::placeholder {
  color: #a8a8ba;
}
.cf-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}
.cf-hint {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  color: #b2b2c4;
  min-width: 0;
}
.cf-err {
  color: #d0503a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 460px;
}
.retry {
  font-size: 10.5px;
  color: #4f7df3;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(79, 125, 243, 0.09);
  flex: 0 0 auto;
}
.send {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #d8e6fa;
  color: #8ba8cf;
  transition: all 0.18s ease;
}
.send.ready {
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  color: #fff;
  box-shadow: 0 3px 10px rgba(79, 125, 243, 0.35);
}
.send.stop {
  background: #f0eef8;
  color: #6a6a86;
}
.send:disabled {
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .chat-view {
    padding: 0 12px 6px;
  }
}
</style>
