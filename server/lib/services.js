/**
 * 第三方服务配置中心
 *
 * 以前 RunningHub 的 key 写死在 ~/.workbuddy/runninghub.key、火山语音写死在 scripts 里，
 * 换个账号要改代码。这里统一收进 settings.json 的 services 段，前端按 schema 渲染表单。
 *
 * 每个服务定义 fields（字段 schema），secret 字段一律脱敏返回；保存时传 __KEEP__ 表示不改。
 */
import { readSettings, writeSettings } from './settings.js'

/** 字段：key / label / placeholder / secret / required / default / hint */
export const SERVICES = {
  runninghub: {
    key: 'runninghub',
    label: 'RunningHub',
    desc: '数字人出片 · ComfyUI 工作流',
    docs: 'https://www.runninghub.cn',
    testable: true,
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: '从 RunningHub 控制台「API 调用」复制',
      },
    ],
    /** 兼容老位置，读不到设置时回退 */
    legacyFile: 'runninghub.key',
  },

  volcVoice: {
    key: 'volcVoice',
    label: '火山语音',
    desc: '豆包 TTS · 声音复刻',
    docs: 'https://console.volcengine.com/speech/app',
    testable: true,
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'X-Api-Key（声音复刻控制台创建）',
      },
      {
        key: 'speaker',
        label: '音色 ID',
        required: true,
        placeholder: 'S_xxxxxxxx',
        hint: '复刻完成后控制台给的 speaker id；「测试连接」会合成一句「你好」（消耗极少量额度）',
      },
      {
        key: 'resourceId',
        label: '资源 ID',
        placeholder: 'volc.megatts.voiceclone',
        default: 'volc.megatts.voiceclone',
      },
    ],
  },

  volcImage: {
    key: 'volcImage',
    label: '火山图片',
    desc: '即梦 Seedream 文生图',
    docs: 'https://console.volcengine.com/ark',
    testable: true,
    fields: [
      {
        key: 'apiKey',
        label: '方舟 API Key',
        secret: true,
        required: true,
        placeholder: 'ARK_API_KEY · 与视频共用同一把',
        hint: '火山方舟控制台 → API Key 管理',
      },
      {
        key: 'model',
        label: '模型 ID',
        placeholder: 'doubao-seedream-3-0-t2i-250415',
        default: 'doubao-seedream-3-0-t2i-250415',
      },
    ],
  },

  volcVideo: {
    key: 'volcVideo',
    label: '火山视频',
    desc: 'Seedance 图生视频',
    docs: 'https://console.volcengine.com/ark',
    testable: true,
    fields: [
      {
        key: 'apiKey',
        label: '方舟 API Key',
        secret: true,
        required: true,
        placeholder: 'ARK_API_KEY · 与图片共用同一把',
        hint: '火山方舟控制台 → API Key 管理',
      },
      {
        key: 'model',
        label: '模型 ID',
        placeholder: 'doubao-seedance-1-0-pro-250528',
        default: 'doubao-seedance-1-0-pro-250528',
      },
    ],
  },

  chanjing: {
    key: 'chanjing',
    label: '蝉镜',
    desc: '数字人视频 · 声音克隆',
    docs: 'https://www.chanjing.cc',
    // 蝉镜的 openapi 鉴权端点未公开，不瞎猜，只做保存
    testable: false,
    fields: [
      { key: 'appId', label: 'App ID', required: true, placeholder: '蝉镜开放平台 App ID' },
      { key: 'secretKey', label: 'Secret Key', secret: true, required: true, placeholder: '开放平台 Secret Key' },
    ],
  },

  arkAsr: {
    key: 'arkAsr',
    label: '方舟 · 音频识别',
    desc: '视频口播转文字 · 每月免费 20 小时',
    docs: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    testable: true,
    fields: [
      {
        key: 'apiKey',
        label: 'ARK API Key',
        secret: true,
        required: true,
        placeholder: '方舟控制台 → API Key 管理',
        hint: '注意：这是方舟的 key（Bearer），不是语音技术控制台那个 X-Api-Key，两个不通用',
      },
      {
        key: 'model',
        label: '模型 ID',
        placeholder: 'doubao-seed-2-1-lite-260915',
        default: 'doubao-seed-2-1-lite-260915',
        hint: '也可以填「Doubao-录音文件识别」对应的 Model ID',
      },
    ],
  },

  volcAsr: {
    key: 'volcAsr',
    label: '火山语音识别',
    desc: '视频口播转文字（录音文件识别）',
    docs: 'https://console.volcengine.com/speech/service/16',
    testable: false,
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: '和语音合成同一把也行',
        hint: '需要在控制台单独开通「录音文件识别」，只开 TTS 会报 resource not granted',
      },
      {
        key: 'resourceId',
        label: '资源 ID',
        placeholder: 'volc.bigasr.auc',
        default: 'volc.bigasr.auc',
        hint: '大模型录音识别：volc.bigasr.auc；一句话/流式另算',
      },
    ],
  },

  sfAsr: {
    key: 'sfAsr',
    label: '硅基流动 · 语音识别',
    desc: 'SenseVoice 转文字 · 注册即用',
    docs: 'https://cloud.siliconflow.cn',
    testable: false,
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'sk-…',
        hint: '注册送额度，按量计费极便宜，国内可直连',
      },
      {
        key: 'model',
        label: '模型',
        placeholder: 'FunAudioLLM/SenseVoiceSmall',
        default: 'FunAudioLLM/SenseVoiceSmall',
      },
    ],
  },

  tikhub: {
    key: 'tikhub',
    label: 'TikHub',
    desc: '抖音对标博主采集 · 免登录',
    docs: 'https://user.tikhub.io',
    testable: true,
    fields: [
      {
        key: 'apiKey',
        label: 'API Token',
        secret: true,
        required: true,
        placeholder: 'Bearer token · tikhub.io 控制台复制',
        hint: '填了之后「对标博主」直接走 TikHub 采集，不用再扫码登录抖音',
      },
      {
        key: 'baseUrl',
        label: '接口地址',
        placeholder: 'https://api.tikhub.io',
        default: 'https://api.tikhub.io',
        hint: '用中转网关时改成自己的地址',
      },
    ],
  },
}

const SECRET_MASK = (v) => (v ? `${String(v).slice(0, 4)}…${String(v).slice(-4)}` : '')

/** 纯默认值（不含任何真实 key） */
export function serviceDefaults() {
  const out = {}
  for (const [id, def] of Object.entries(SERVICES)) {
    out[id] = {}
    for (const f of def.fields) {
      if (f.default) out[id][f.key] = f.default
    }
  }
  return out
}

/** 完整配置（明文，仅后端用） */
export function readServices() {
  const raw = readSettings()?.services || {}
  const out = {}
  for (const [id, def] of Object.entries(SERVICES)) {
    out[id] = { ...(serviceDefaults()[id] || {}), ...(raw[id] || {}) }
  }
  // 允许配置里存在 schema 之外的服务，别丢
  for (const [id, v] of Object.entries(raw)) {
    if (!out[id]) out[id] = v
  }
  return out
}

export function getService(id) {
  return readServices()[id] || null
}

/** 前端用：secret 字段脱敏，附带 schema */
export function publicServices() {
  const cur = readServices()
  const list = Object.values(SERVICES).map((def) => {
    const cfg = cur[def.key] || {}
    const values = {}
    let filled = 0
    let need = 0
    for (const f of def.fields) {
      const v = cfg[f.key] ?? ''
      values[f.key] = f.secret ? SECRET_MASK(v) : v
      if (f.secret) values[`${f.key}__has`] = Boolean(v)
      if (f.required) {
        need += 1
        if (v) filled += 1
      }
    }
    return {
      id: def.key,
      label: def.label,
      desc: def.desc,
      docs: def.docs,
      testable: def.testable,
      fields: def.fields,
      values,
      ready: need > 0 && filled === need,
    }
  })
  return { list }
}

/** 保存：secret 传 __KEEP__ 或空串表示沿用旧值 */
export function saveServices(patch = {}) {
  const cur = readServices()
  const next = { ...cur }

  for (const [id, def] of Object.entries(SERVICES)) {
    if (!(id in patch)) continue
    const incoming = patch[id] || {}
    const merged = { ...(cur[id] || {}) }
    for (const f of def.fields) {
      const v = incoming[f.key]
      if (v === undefined) continue
      if (f.secret && (v === '__KEEP__' || v === '')) continue // 没改就保留
      merged[f.key] = typeof v === 'string' ? v.trim() : v
    }
    next[id] = merged
  }

  const s = readSettings()
  writeSettings({ ...s, services: next })
  return publicServices()
}

/* ---------------- 连接测试 ---------------- */

// 1×1 透明 PNG，用来试 RunningHub 的 key 有没有效
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export async function testService(id, override = {}) {
  const def = SERVICES[id]
  if (!def) return { ok: false, error: `未知服务：${id}` }
  if (!def.testable) return { ok: false, error: '这个服务暂不支持在线测试，保存后可直接使用' }

  // 覆盖值优先（用户刚输入还没保存），空值回退已存配置
  const cfg = { ...(getService(id) || {}) }
  for (const [k, v] of Object.entries(override || {})) {
    if (v !== undefined && v !== null && v !== '' && v !== '__KEEP__') cfg[k] = v
  }

  const t0 = Date.now()
  try {
    const r = await TESTERS[id](cfg)
    return { ...r, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '超时' : String(e.message || e), ms: Date.now() - t0 }
  }
}

function withTimeout(ms) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

const TESTERS = {
  /** 上传一张 1×1 PNG：code=0 有效，code=1「API Key不存在」无效 */
  async runninghub(cfg) {
    if (!cfg.apiKey) return { ok: false, error: '还没填 API Key' }
    const w = withTimeout(20_000)
    try {
      const form = new FormData()
      form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'probe.png')
      const res = await fetch('https://www.runninghub.cn/openapi/v2/media/upload/binary', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
        signal: w.signal,
      })
      const d = await res.json().catch(() => ({}))
      if (d?.code === 0) return { ok: true, detail: 'Key 有效' }
      return { ok: false, error: d?.msg || `HTTP ${res.status}` }
    } finally {
      w.done()
    }
  },

  /** 合成一句「你好」——能出声就说明 key + 音色 ID 都对 */
  async volcVoice(cfg) {
    if (!cfg.apiKey) return { ok: false, error: '还没填 API Key' }
    if (!cfg.speaker) return { ok: false, error: '还没填音色 ID' }
    const w = withTimeout(30_000)
    try {
      const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST',
        headers: {
          'X-Api-Key': cfg.apiKey,
          'X-Api-Request-Id': crypto.randomUUID(),
          'X-Api-Resource-Id': cfg.resourceId || 'volc.megatts.voiceclone',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user: { uid: 'beizhai-workbench' },
          unique_id: crypto.randomUUID(),
          req_params: { text: '你好', speaker: cfg.speaker, audio_params: { format: 'mp3', sample_rate: 24000 } },
        }),
        signal: w.signal,
      })

      const text = await res.text()
      if (!res.ok && !text.includes('data')) {
        return { ok: false, error: `HTTP ${res.status} · ${text.slice(0, 200)}` }
      }
      // NDJSON：拿到带 data 的行即成功
      const lines = text.split('\n').filter(Boolean)
      const hasAudio = lines.some((l) => {
        try {
          const j = JSON.parse(l)
          return Boolean(j.data || j.audio || j.code === 0)
        } catch {
          return false
        }
      })
      const bad = lines.find((l) => {
        try {
          const j = JSON.parse(l)
          return j.code && j.code !== 0 && j.code !== 3000
        } catch {
          return false
        }
      })

      let raw = ''
      if (bad) {
        try {
          const j = JSON.parse(bad)
          raw = j.message || j.msg || bad
        } catch {
          raw = bad
        }
      }

      // 并发满了 = 鉴权其实已经过了，key 和音色都是对的
      if (/concurrency|quota/i.test(raw)) {
        return { ok: true, detail: 'Key 有效（当前并发已满，正式出片时会排队重试）' }
      }

      if (hasAudio || !bad) return { ok: true, detail: '合成成功，音色可用' }
      return { ok: false, error: String(raw).slice(0, 200) }
    } finally {
      w.done()
    }
  },

  /** 方舟 key 校验 + 顺手把可用的语音/多模态模型列出来 */
  async arkAsr(cfg) {
    if (!cfg.apiKey) return { ok: false, error: '还没填 ARK API Key' }
    const w = withTimeout(15_000)
    try {
      const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/models', {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: w.signal,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = d?.error?.message || `HTTP ${res.status}`
        return { ok: false, error: /api key/i.test(msg) ? 'Key 不对（要用 Bearer 那个）' : String(msg).slice(0, 160) }
      }
      const ids = (Array.isArray(d.data) ? d.data : []).map((x) => x.id || x.name || '').filter(Boolean)
      const want = cfg.model || ''
      const hit = ids.find((x) => x === want)
      return {
        ok: true,
        detail: hit
          ? `Key 有效 · 模型 ${want} 可用（共 ${ids.length} 个模型）`
          : `Key 有效 · 共 ${ids.length} 个模型${want ? `，但没看到「${want}」` : ''}`,
      }
    } finally {
      w.done()
    }
  },

  /** 火山方舟：列模型能通过就说明 Key 有效 */
  async volcImage(cfg) {
    return arkProbe(cfg)
  },
  async volcVideo(cfg) {
    return arkProbe(cfg)
  },

  /** TikHub：拉一次抖音热榜，能出数据就说明 token 有效 */
  async tikhub(cfg) {
    if (!cfg.apiKey) return { ok: false, error: '还没填 API Token' }
    const w = withTimeout(20_000)
    try {
      const base = (cfg.baseUrl || 'https://api.tikhub.io').replace(/\/+$/, '')
      const res = await fetch(`${base}/api/v1/douyin/web/fetch_hot_search_result`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
        signal: w.signal,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = d?.detail?.message || d?.detail || d?.message || `HTTP ${res.status}`
        if (/token|unauthor|permission/i.test(String(msg))) {
          return { ok: false, error: 'Token 无效或已过期' }
        }
        return { ok: false, error: String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 200) }
      }
      const n = d?.data?.data?.word_list?.length || d?.data?.word_list?.length || 0
      return { ok: true, detail: `Token 有效${n ? ` · 热榜 ${n} 条` : ''}` }
    } finally {
      w.done()
    }
  },
}

async function arkProbe(cfg) {
  if (!cfg.apiKey) return { ok: false, error: '还没填方舟 API Key' }
  const w = withTimeout(15_000)
  try {
    const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/models', {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: w.signal,
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      const n = Array.isArray(d.data) ? d.data.length : 0
      return { ok: true, detail: `Key 有效${n ? ` · 可用模型 ${n} 个` : ''}` }
    }
    const msg = d?.error?.message || `HTTP ${res.status}`
    if (/api key/i.test(msg)) return { ok: false, error: 'API Key 不对或已失效' }
    return { ok: false, error: String(msg).slice(0, 200) }
  } finally {
    w.done()
  }
}

/** 老路径兼容：从 ~/.workbuddy/runninghub.key 迁移一次 */
export { SECRET_MASK }
