/**
 * 对话流（前端）
 * 消费 /api/chat 的 SSE：reasoning 单独攒、content 单独攒，正文打字机。
 */
import { ref, computed } from 'vue'

const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function useChat({ system = '', temperature } = {}) {
  /** { id, role:'user'|'assistant', content, reasoning, error, streaming, ts } */
  const messages = ref([])
  const streaming = ref(false)
  const model = ref('')
  const errorMsg = ref('')
  let ctrl = null

  const hasChat = computed(() => messages.value.length > 0)

  /** 承接上一处（首页内嵌框）的对话 */
  function load(list = []) {
    stop()
    messages.value = (Array.isArray(list) ? list : []).map((m) => ({
      id: m.id || uid(),
      role: m.role,
      content: m.content || '',
      reasoning: m.reasoning || '',
      error: m.error || '',
      streaming: false,
      ts: m.ts || Date.now(),
    }))
  }

  function reset() {
    stop()
    messages.value = []
    errorMsg.value = ''
  }

  function stop() {
    if (ctrl) {
      ctrl.abort()
      ctrl = null
    }
    streaming.value = false
  }

  /** 只把 user/assistant 的正文带给后端，思考过程不回传 */
  function history() {
    return messages.value
      .filter((m) => !m.error && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }))
  }

  async function send(text) {
    const q = String(text || '').trim()
    if (!q || streaming.value) return

    errorMsg.value = ''
    messages.value.push({ id: uid(), role: 'user', content: q, ts: Date.now() })

    const reply = {
      id: uid(),
      role: 'assistant',
      content: '',
      reasoning: '',
      streaming: true,
      ts: Date.now(),
    }
    messages.value.push(reply)
    const bag = history().slice(0, -1) // 去掉刚推入的助手空壳
    bag.push({ role: 'user', content: q })

    streaming.value = true
    ctrl = new AbortController()

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages: bag, system, temperature }),
        signal: ctrl.signal,
      })

      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${t.slice(0, 160)}`)
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder('utf-8')
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })

        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i)
          buf = buf.slice(i + 2)
          for (const line of frame.split('\n')) {
            const s = line.trim()
            if (!s.startsWith('data:')) continue
            let ev
            try {
              ev = JSON.parse(s.slice(5).trim())
            } catch {
              continue
            }
            if (ev.type === 'meta') model.value = ev.model || ''
            else if (ev.type === 'reasoning') reply.reasoning += ev.text || ''
            else if (ev.type === 'content') reply.content += ev.text || ''
            else if (ev.type === 'error') reply.error = ev.error || '出错了'
            else if (ev.type === 'stopped') reply.stopped = true
          }
        }
      }

      if (reply.error) errorMsg.value = reply.error
      if (!reply.content && !reply.error) {
        reply.error = '模型没有返回正文'
        errorMsg.value = reply.error
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        reply.stopped = true
      } else {
        reply.error = String(e.message || e)
        errorMsg.value = reply.error
      }
    } finally {
      reply.streaming = false
      streaming.value = false
      ctrl = null
    }
  }

  /** 重试最后一条（删掉失败/中断的那版再发） */
  async function retry() {
    if (streaming.value) return
    const list = messages.value
    const lastUser = [...list].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    // 砍掉这条 user 之后的所有内容
    const idx = list.lastIndexOf(lastUser)
    messages.value = list.slice(0, idx)
    await send(lastUser.content)
  }

  return { messages, streaming, model, errorMsg, hasChat, send, stop, reset, retry, load }
}
