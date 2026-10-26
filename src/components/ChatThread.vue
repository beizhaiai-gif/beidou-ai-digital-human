<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  /** 紧凑模式（首页内嵌） */
  compact: { type: Boolean, default: false },
  /** 空态文案 */
  emptyTitle: { type: String, default: '从一句话开始' },
  emptySub: { type: String, default: '说你要做什么，北北直接给你结果' },
  suggestions: { type: Array, default: () => [] },
})

const emit = defineEmits(['pick'])

const scroller = ref(null)
const openReason = ref({})

const toggleReason = (id) => {
  openReason.value = { ...openReason.value, [id]: !openReason.value[id] }
}

/* ---------- 极简 Markdown（先转义再替换，防注入） ---------- */
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function render(md) {
  if (!md) return ''
  const blocks = []
  let text = String(md).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(
      `<pre class="code"><code>${esc(code.replace(/\n$/, ''))}</code></pre>`,
    )
    return `\u0000${blocks.length - 1}\u0000`
  })

  let html = esc(text)

  // 行内代码
  html = html.replace(/`([^`\n]+)`/g, '<code class="ic">$1</code>')
  // 加粗
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  // 标题
  html = html.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>')
  // 列表
  html = html.replace(/^(?:-|\*)\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, '')}</ul>`)
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<oli><i>$1</i>$2</oli>')
  html = html.replace(/(?:<oli>[\s\S]*?<\/oli>\n?)+/g, (m) => `<ol>${m.replace(/\n/g, '')}</ol>`)
  // 分隔线
  html = html.replace(/^---+$/gm, '<hr/>')
  // 段落
  html = html
    .split(/\n{2,}/)
    .map((p) => {
      const t = p.trim()
      if (!t) return ''
      if (/^<(pre|ul|ol|h3|h4|hr|blockquote)/.test(t)) return t
      return `<p>${t.replace(/\n/g, '<br/>')}</p>`
    })
    .join('')

  // 回填代码块
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)] || '')
  return html
}

/* ---------- 自动滚到底 ---------- */
function scrollToEnd(smooth = false) {
  const el = scroller.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

watch(
  () => props.messages.map((m) => (m.content || '').length + (m.reasoning || '').length).join(','),
  () => nextTick(() => scrollToEnd()),
)
onMounted(() => nextTick(() => scrollToEnd()))

/** 助手气泡只有在真有东西时才占位，否则留一个空白块很难看 */
const visible = (m) =>
  m.role === 'user' || Boolean(m.content || m.reasoning || m.error || m.stopped || m.streaming)
</script>

<template>
  <div ref="scroller" class="thread" :class="{ 'thread--compact': compact }">
    <!-- 空态 -->
    <div v-if="!messages.length" class="empty">
      <span class="empty-ico"><Icon name="sparkle" :size="20" /></span>
      <p class="empty-title">{{ emptyTitle }}</p>
      <p class="empty-sub">{{ emptySub }}</p>
      <div v-if="suggestions.length" class="sugs">
        <button v-for="s in suggestions" :key="s" class="sug" @click="emit('pick', s)">{{ s }}</button>
      </div>
    </div>

    <!-- 消息 -->
    <div v-for="m in messages" :key="m.id" class="msg" :class="`msg--${m.role}`">
      <span v-if="m.role === 'assistant'" class="ava">北</span>

      <div v-if="visible(m)" class="bubble">
        <!-- 思考过程 -->
        <div v-if="m.reasoning" class="reason" :class="{ open: openReason[m.id] }">
          <button class="reason-head" @click="toggleReason(m.id)">
            <span class="dot-pulse" :class="{ on: m.streaming && !m.content }"></span>
            <span>{{ m.streaming && !m.content ? '正在思考…' : '思考过程' }}</span>
            <em>{{ m.reasoning.length }} 字</em>
            <Icon name="chevronDown" :size="11" class="reason-caret" />
          </button>
          <pre v-if="openReason[m.id]" class="reason-body">{{ m.reasoning }}</pre>
        </div>

        <!-- 正文：用户说的话原样显示，助手走极简 markdown -->
        <div v-if="m.role === 'user'" class="body body--plain">{{ m.content }}</div>
        <div v-else-if="m.content" class="body" v-html="render(m.content)"></div>

        <!-- 等第一个字 -->
        <span v-if="m.streaming && !m.content && !m.reasoning" class="dots"><i></i><i></i><i></i></span>

        <!-- 流式光标 -->
        <span v-if="m.streaming && m.content" class="caret"></span>

        <!-- 错误 -->
        <p v-if="m.error" class="msg-error">{{ m.error }}</p>
        <p v-else-if="m.stopped && !m.content" class="msg-stopped">已停止</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 2px 8px;
  scroll-behavior: smooth;
}

/* ---- 空态 ---- */
.empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 34px 16px;
}
.empty-ico {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #4f7df3;
  background: rgba(79, 125, 243, 0.08);
  border: 1px solid rgba(79, 125, 243, 0.16);
  margin-bottom: 13px;
}
.empty-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #2a2a40;
}
.empty-sub {
  margin-top: 6px;
  font-size: 11.5px;
  color: #9494ab;
  line-height: 1.55;
  max-width: 340px;
}
.sugs {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  justify-content: center;
  margin-top: 16px;
  max-width: 460px;
}
.sug {
  font-size: 11.5px;
  color: #5a6a8c;
  padding: 6px 11px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(30, 30, 60, 0.08);
  transition: all 0.15s ease;
}
.sug:hover {
  color: #3358c4;
  border-color: rgba(79, 125, 243, 0.35);
  transform: translateY(-1px);
}

/* ---- 消息 ---- */
.msg {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  max-width: 100%;
  min-width: 0;
}
.msg--user {
  justify-content: flex-end;
}
.ava {
  width: 25px;
  height: 25px;
  flex: 0 0 auto;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(150deg, #8f7bf0, #5b6ef0);
  box-shadow: 0 3px 9px rgba(91, 110, 240, 0.28);
  margin-top: 2px;
}
.bubble {
  max-width: min(88%, 760px);
  min-width: 0;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.72;
  color: #26263a;
  overflow-wrap: anywhere;
}
.msg--assistant .bubble {
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 6px 18px rgba(60, 60, 110, 0.05);
  padding: 10px 13px;
}
.msg--user .bubble {
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  color: #fff;
  padding: 9px 13px;
  border-radius: 12px 12px 4px 12px;
  box-shadow: 0 4px 14px rgba(79, 125, 243, 0.24);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: min(78%, 620px);
}

/* 用户原话不走 markdown，别被全局 p 的颜色吃掉 */
.body--plain {
  font-size: 13px;
  line-height: 1.7;
  color: #fff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ---- 思考过程 ---- */
.reason {
  margin-bottom: 8px;
  border-radius: 9px;
  background: rgba(246, 246, 252, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.06);
  overflow: hidden;
}
.reason-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 9px;
  font-size: 10.5px;
  color: #7d7d95;
  text-align: left;
}
.reason-head em {
  font-style: normal;
  color: #b0b0c2;
  font-size: 9.5px;
}
.reason-caret {
  margin-left: auto;
  color: #b6b6c8;
  transition: transform 0.2s ease;
}
.reason.open .reason-caret {
  transform: rotate(180deg);
}
.reason-body {
  margin: 0;
  padding: 2px 10px 9px;
  font-size: 11px;
  line-height: 1.65;
  color: #8a8aa2;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
  font-family: inherit;
}
.dot-pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c8c8d8;
  flex: 0 0 auto;
}
.dot-pulse.on {
  background: #4f7df3;
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

/* ---- 正文排版 ---- */
.body :deep(p) {
  margin: 0 0 8px;
}
.body :deep(p:last-child) {
  margin-bottom: 0;
}
.body :deep(strong) {
  font-weight: 600;
  color: #1b1b2e;
}
.body :deep(h3),
.body :deep(h4) {
  font-size: 13px;
  font-weight: 700;
  margin: 10px 0 6px;
  color: #1f1f33;
}
.body :deep(ul),
.body :deep(ol) {
  margin: 4px 0 9px;
  padding-left: 18px;
}
.body :deep(li) {
  margin-bottom: 3px;
}
.body :deep(ol) {
  list-style: none;
  padding-left: 2px;
}
.body :deep(oli) {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}
.body :deep(oli i) {
  font-style: normal;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 3px;
  border-radius: 5px;
  font-size: 9.5px;
  font-weight: 700;
  display: grid;
  place-items: center;
  color: #5b6ef0;
  background: rgba(91, 110, 240, 0.1);
}
.body :deep(code.ic) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(40, 40, 80, 0.06);
  color: #b5459b;
}
.body :deep(pre.code) {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 9px;
  background: #1e1e2e;
  overflow-x: auto;
}
.body :deep(pre.code code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  color: #e4e4f0;
  white-space: pre;
}
.body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(30, 30, 60, 0.08);
  margin: 10px 0;
}

/* ---- 光标 / 等待 / 错误 ---- */
.caret {
  display: inline-block;
  width: 2px;
  height: 13px;
  margin-left: 2px;
  vertical-align: -2px;
  background: #4f7df3;
  animation: blink 0.9s steps(2) infinite;
}
@keyframes blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}
.dots {
  display: inline-flex;
  gap: 4px;
  padding: 3px 0;
}
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #b9c3e0;
  animation: bounce 1.1s ease-in-out infinite;
}
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-3px); opacity: 1; }
}
.msg-error {
  margin-top: 6px;
  font-size: 11px;
  color: #d0503a;
  line-height: 1.5;
}
.msg-stopped {
  font-size: 11px;
  color: #a5a5b8;
}

/* ---- 紧凑模式（首页内嵌） ---- */
.thread--compact {
  gap: 11px;
}
.thread--compact .bubble {
  font-size: 12.5px;
  line-height: 1.68;
}
</style>
