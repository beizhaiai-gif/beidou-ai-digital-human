/**
 * 工作台设置（用户资料 + 大模型配置）
 *
 * 存本地文件 server/config/settings.json（0600），不进环境变量、不返给前端明文：
 * 读取时 apiKey 一律脱敏成 `sk-abc1…c86e`，前端保存时传 `__KEEP__` 表示"不改"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
import { dataDir } from './env.js'
const DIR = dataDir('config', ROOT)
const FILE = path.join(DIR, 'settings.json')

/** 首次运行写入的默认值（DeepSeek 官方 OpenAI 兼容端点） */
const DEFAULTS = {
  user: { name: '北斋', role: 'AI 应用实战讲师', avatarText: '北', avatarUrl: '' },
  llm: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-v4-pro',
    effort: 'low',
    temperature: 0.85,
    maxTokens: 8192,
  },
  /** 第三方服务（RunningHub / 火山 / 蝉镜 …），由 lib/services.js 管结构 */
  services: {},
}

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    modelLabels: { 'deepseek-v4-pro': 'DeepSeek-V4-Pro', 'deepseek-flash': 'DeepSeek-V4.1-Flash' },
    efforts: ['low', 'high', 'max'],
  },
  openai: {
    label: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
  custom: {
    label: '自定义（任何 OpenAI 兼容网关）',
    baseUrl: '',
    model: '',
    models: [],
  },
}

const merge = (a, b) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a?.[k] || {}, v) : v
  }
  return out
}

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 })
  }
}

/** 内部用：完整配置（含明文 key） */
export function readSettings() {
  ensure()
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

/** 前端用：key 脱敏 */
export function publicSettings() {
  const s = readSettings()
  const k = s.llm?.apiKey || ''
  return {
    user: s.user,
    llm: {
      ...s.llm,
      apiKey: k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '',
      hasKey: Boolean(k),
    },
    providers: PROVIDERS,
  }
}

/** 保存：apiKey 传空或 __KEEP__ 表示沿用旧值 */
export function saveSettings(patch) {
  const cur = readSettings()
  const next = merge(cur, patch || {})
  if (!patch?.llm || patch.llm.apiKey === undefined || patch.llm.apiKey === '__KEEP__' || patch.llm.apiKey === '') {
    next.llm = { ...next.llm, apiKey: cur.llm.apiKey }
  }
  ensure()
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
  try { fs.chmodSync(FILE, 0o600) } catch {}
  return publicSettings()
}

/** 整份覆盖写（第三方服务配置用，调用方自己负责合并） */
export function writeSettings(next) {
  ensure()
  const merged = merge(DEFAULTS, next || {})
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2), { mode: 0o600 })
  try { fs.chmodSync(FILE, 0o600) } catch {}
  return merged
}

/** 给 LLM 调用方用：拿可用的连接参数（配置优先，其次 ~/.workbuddy/models.json） */
export function resolveLlm() {
  const s = readSettings()
  if (s.llm?.apiKey && s.llm?.baseUrl) {
    return {
      url: s.llm.baseUrl,
      apiKey: s.llm.apiKey,
      model: s.llm.model || 'deepseek-v4-pro',
      effort: s.llm.effort || 'low',
      temperature: Number(s.llm.temperature) || 0.85,
      maxTokens: Number(s.llm.maxTokens) || 8192,
      source: 'settings',
    }
  }
  // 回退：WorkBuddy 自带的模型清单（老路径，保持兼容）
  try {
    const list = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.workbuddy', 'models.json'), 'utf8'))
    const m = Array.isArray(list) ? list[0] : null
    if (m?.url && m?.apiKey) {
      return {
        url: m.url,
        apiKey: m.apiKey,
        model: 'deepseek-v4-pro',
        effort: 'low',
        temperature: 0.85,
        maxTokens: 8192,
        source: 'models.json',
      }
    }
  } catch {}
  return null
}

/** 试连接：发一句最小请求，返回延迟与模型回显 */
export async function testLlm(override) {
  const base = resolveLlm() || {}
  // 前端可能只改模型/强度、不动 key —— 空值不覆盖已存配置
  const patch = {}
  for (const [k, v] of Object.entries(override || {})) {
    if (v !== undefined && v !== null && v !== '' && v !== '__KEEP__') patch[k] = v
  }
  const cfg = { ...base, ...patch }
  if (!cfg?.url || !cfg?.apiKey) return { ok: false, error: '还没配置 API Key' }

  const model = cfg.model || 'deepseek-v4-pro'
  const body = {
    model,
    messages: [{ role: 'user', content: '只回复两个字：在线' }],
    // 推理模型要先想再答，给少了会全被 reasoning 吃掉、正文为空
    max_tokens: 1024,
  }
  if (['deepseek-v4-pro', 'deepseek-flash'].includes(model)) {
    body.reasoning_effort = ['low', 'high', 'max'].includes(cfg.effort) ? cfg.effort : 'low'
  }

  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 40_000)
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} · ${text.slice(0, 200)}`, ms: Date.now() - t0 }
    let data = {}
    try { data = JSON.parse(text) } catch {}
    const msg = data?.choices?.[0]?.message || {}
    return {
      ok: true,
      ms: Date.now() - t0,
      model: data?.model || model,
      reply: (msg.content || '').trim(),
      reasoning: (msg.reasoning_content || '').slice(0, 200),
      usage: data?.usage || null,
    }
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, error: e.name === 'AbortError' ? '超时（40s）' : String(e.message || e), ms: Date.now() - t0 }
  }
}
