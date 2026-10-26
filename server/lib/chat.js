/**
 * 通用文本对话（流式）
 *
 * DeepSeek-V4 系列是**推理模型**：返回里先吐 `reasoning_content`（思考），再吐 `content`（正文）。
 * 所以这里两条流分开回调，前端可以折叠「思考过程」，正文照样打字机。
 *
 * 坑位备忘：
 *  - max_tokens 必须给足，否则全被 reasoning 吃掉，content 为空（v4-pro 实测 20 tokens 就这德行）
 *  - `reasoning_effort` 只认 low / high / max
 */
import { resolveLlm } from './settings.js'

export const DEFAULT_SYSTEM = `你是「北北」，北斋的 AI 创作搭子。

## 你是谁
- 北斋是 AI 应用实战讲师、18 年电商老兵，做短视频内容和 AI 产品落地
- 你说话温柔、偶尔撒娇调皮，但**干活极利索**，不说废话、不铺垫、不客套

## 怎么回答
- 直接给答案，先结论后理由。别写"好的，我来帮你分析一下"这种开场
- 中文回答，口语化。技术概念用大白话打比方
- 需要列选项就给 A / B / C，并标出你推荐哪个
- 内容创作相关的问题，脑子里要装着「薛辉体系」：内容 > 情绪 > 文案 > 技术；
  四大脚本模型（晒过程 / 讲故事 / 教知识 / 说观点）；八大爆款元素（特定人群 / 成本 / 名人 / 奇葩 / 女人 / 最差 / 反差 / 怀旧）
- 不确定的事直接说不确定，别编
- 不主动输出 emoji`

const MODELS = {
  'deepseek-v4-pro': { label: 'DeepSeek-V4-Pro', effort: true },
  'deepseek-flash': { label: 'DeepSeek-V4.1-Flash', effort: true },
}

/**
 * 流式对话
 * @param {object} o
 * @param {Array<{role:string,content:string}>} o.messages 完整历史（不含 system）
 * @param {string} [o.system]
 * @param {number} [o.temperature]
 * @param {string} [o.effort] low | high | max
 * @param {number} [o.maxTokens]
 * @param {(ev:object)=>void} onEvent 回调：{type:'reasoning'|'content'|'meta'|'done'|'error', ...}
 * @param {AbortSignal} [signal]
 */
export async function streamChat(
  { messages = [], system = '', temperature, effort = 'low', maxTokens = 8192 } = {},
  onEvent = () => {},
  signal,
) {
  const cfg = resolveLlm()
  if (!cfg) {
    onEvent({ type: 'error', error: '还没配置大模型 —— 左下角「设置 → 大模型」填 API Key' })
    return { ok: false, error: '未配置模型' }
  }

  const model = cfg.model || 'deepseek-v4-pro'
  const sys = system?.trim() || DEFAULT_SYSTEM

  const body = {
    model,
    messages: [{ role: 'system', content: sys }, ...normalize(messages)],
    temperature: Number.isFinite(temperature) ? temperature : 0.8,
    max_tokens: Math.max(512, Number(maxTokens) || 8192),
    stream: true,
  }
  if (MODELS[model]?.effort && ['none', 'low', 'high', 'max'].includes(effort)) {
    body.reasoning_effort = effort
  }

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), 180_000)

  let content = ''
  let reasoning = ''
  let usage = null
  let finish = ''

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })

    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      const msg = `HTTP ${res.status} · ${t.slice(0, 300)}`
      onEvent({ type: 'error', error: msg })
      return { ok: false, error: msg }
    }

    onEvent({ type: 'meta', model, effort: body.reasoning_effort || null })

    const reader = res.body.getReader()
    const dec = new TextDecoder('utf-8')
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })

      // SSE 以空行分帧
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of frame.split('\n')) {
          const s = line.trim()
          if (!s.startsWith('data:')) continue
          const payload = s.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          let j
          try {
            j = JSON.parse(payload)
          } catch {
            continue
          }
          if (j.usage) usage = j.usage
          const ch = j.choices?.[0]
          if (!ch) continue
          const d = ch.delta || {}
          if (d.reasoning_content) {
            reasoning += d.reasoning_content
            onEvent({ type: 'reasoning', text: d.reasoning_content })
          }
          if (d.content) {
            content += d.content
            onEvent({ type: 'content', text: d.content })
          }
          if (ch.finish_reason) finish = ch.finish_reason
        }
      }
    }

    clearTimeout(timer)
    if (!content && !reasoning) {
      const msg = '模型没有返回内容（可能 max_tokens 被推理吃光了）'
      onEvent({ type: 'error', error: msg })
      return { ok: false, error: msg }
    }

    onEvent({ type: 'done', usage, finish, model })
    return { ok: true, content, reasoning, usage, finish, model }
  } catch (e) {
    clearTimeout(timer)
    const aborted = e.name === 'AbortError'
    const msg = aborted ? '已停止' : String(e.message || e)
    onEvent({ type: aborted ? 'stopped' : 'error', error: msg })
    return { ok: false, error: msg, content, reasoning, aborted }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    clearTimeout(timer)
  }
}

/** 只保留合法的 role + content，防止前端塞奇怪结构 */
function normalize(list = []) {
  const out = []
  for (const m of Array.isArray(list) ? list : []) {
    const role = m?.role
    const content = String(m?.content ?? '')
    if (!['user', 'assistant'].includes(role) || !content.trim()) continue
    out.push({ role, content })
  }
  return out
}

/** 非流式，给内部脚本用 */
export async function chatOnce({ messages, system, temperature, effort = 'low', maxTokens = 8192 } = {}) {
  const r = await streamChat({ messages, system, temperature, effort, maxTokens })
  return r.ok ? { ok: true, text: r.content, reasoning: r.reasoning, usage: r.usage } : r
}
