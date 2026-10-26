/**
 * 蝉镜 AI 开放平台客户端
 *
 * 文档：https://doc.chanjing.cc/
 * 规范：https://doc.chanjing.cc/openapi/chanjing-openapi.yaml
 * 基础地址：https://open-api.chanjing.cc/open/v1
 *
 * 约定（来自规范，别凭直觉改）：
 *  - HTTP 永远 200，业务成功看 body.code === 0
 *  - 鉴权：POST /access_token {app_id, secret_key} → data.access_token，
 *    之后每个请求带请求头 `access_token`
 *  - data.expire_in 是整数秒；这里提前 5 分钟刷新
 *
 * 凭证只从环境变量读（CHANJING_APP_ID / CHANJING_SECRET_KEY），
 * 严禁打印、严禁下发到前端。
 */
import './env.js'

const BASE = 'https://open-api.chanjing.cc/open/v1'
const REFRESH_AHEAD = 300 // 秒

let cache = { token: '', exp: 0 }
let pending = null

export function hasCredentials() {
  return Boolean(process.env.CHANJING_APP_ID && process.env.CHANJING_SECRET_KEY)
}

/** 只回显 app_id（标识），绝不回显 secret / token */
export function appId() {
  return process.env.CHANJING_APP_ID || ''
}

async function post(pathname, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.access_token = token
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  })
  const json = await res.json().catch(() => null)
  return { http: res.status, json }
}

async function get(pathname, query, token) {
  const qs = new URLSearchParams(
    Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  const res = await fetch(`${BASE}${pathname}${qs.toString() ? `?${qs}` : ''}`, {
    headers: token ? { access_token: token } : {},
  })
  const json = await res.json().catch(() => null)
  return { http: res.status, json }
}

/** 拿 token（带缓存 + 并发去重） */
export async function getToken(force = false) {
  if (!hasCredentials()) {
    return { ok: false, error: '缺少 CHANJING_APP_ID / CHANJING_SECRET_KEY 环境变量' }
  }
  const now = Math.floor(Date.now() / 1000)
  if (!force && cache.token && now < cache.exp - REFRESH_AHEAD) {
    return { ok: true, token: cache.token, cached: true }
  }
  if (pending) return pending

  pending = (async () => {
    const { http, json } = await post('/access_token', {
      app_id: process.env.CHANJING_APP_ID,
      secret_key: process.env.CHANJING_SECRET_KEY,
    })
    if (!json || json.code !== 0) {
      return {
        ok: false,
        error: `换 token 失败 code=${json?.code} msg=${json?.msg || ''}`,
        trace: json?.trace_id,
        http,
      }
    }
    const token = json.data?.access_token
    // 规范里写了 data.expire_in，但实测这个接口没返回该字段 → 兜底 2 小时，
    // 万一提前过期，业务调用里检测到 token 相关错误会自动强制刷新一次。
    const ttl = Number(json.data?.expire_in) || 7200
    if (!token) return { ok: false, error: '返回里没有 data.access_token', trace: json.trace_id }
    cache = { token, exp: Math.floor(Date.now() / 1000) + ttl }
    return { ok: true, token, ttl, trace: json.trace_id }
  })()

  try {
    return await pending
  } finally {
    pending = null
  }
}

/**
 * 统一业务调用：自动带 token，过期自动重取一次。
 * 返回 { ok, data, code, msg, trace, http }
 */
async function call(method, pathname, payload) {
  const t = await getToken()
  if (!t.ok) return t

  const send = (token) =>
    method === 'GET' ? get(pathname, payload, token) : post(pathname, payload, token)

  let { http, json } = await send(t.token)

  // token 失效：强制刷新一次再试
  if (json && json.code !== 0 && /token/i.test(json.msg || '')) {
    const t2 = await getToken(true)
    if (t2.ok) ({ http, json } = await send(t2.token))
  }

  if (!json) return { ok: false, error: `响应不是 JSON（HTTP ${http}）`, http }
  return {
    ok: json.code === 0,
    data: json.data,
    code: json.code,
    msg: json.msg,
    trace: json.trace_id,
    http,
  }
}

/* ---------------- 业务接口 ---------------- */

/** 公共音色列表 */
export function listCommonAudio(page = 1, size = 20) {
  return call('GET', '/list_common_audio', { page, size })
}

/** 公共数字人列表 */
export function listCommonDp(page = 1, size = 20) {
  return call('GET', '/list_common_dp', { page, size })
}

/** 创建 TTS 任务 */
export function createAudioTask({ audioMan, text, speed = 1 }) {
  return call('POST', '/create_audio_task', {
    audio_man: audioMan,
    speed,
    text: { text, plain_text: text },
  })
}

/** 查询 TTS 任务状态 */
export function audioTaskState(taskId) {
  return call('POST', '/audio_task_state', { task_id: taskId })
}

/** 创建数字人视频任务（data 是任务 ID 字符串本身） */
export function createVideo(payload) {
  return call('POST', '/create_video', payload)
}

/** 查询视频详情 */
export function videoDetail(id) {
  return call('GET', '/video', { id })
}

/* ---------------- 定制形象 / 定制声音 ---------------- */

/** 拿 OSS 预签名上传地址。service: customised_person（素材视频，仅 mp4/mov/webm） */
export function createUploadUrl(service, name) {
  return call('GET', '/common/create_upload_url', { service, name })
}

/** 把文件 PUT 到预签名地址，返回去掉 query 的公网 URL（后面当 material_video 用） */
export async function uploadToSignedUrl(signUrl, buffer, contentType) {
  const res = await fetch(signUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: buffer,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    return { ok: false, error: `上传 OSS 失败 HTTP ${res.status} ${t.slice(0, 120)}` }
  }
  return { ok: true, url: signUrl.split('?')[0] }
}

/** 提交定制数字人（status: 1制作中 2成功 4失败 5系统错误） */
export function createCustomisedPerson(payload) {
  return call('POST', '/create_customised_person', payload)
}

export function customisedPersonDetail(id) {
  return call('GET', '/customised_person', { id })
}

/**
 * 定制数字人列表
 * source: 0=API 定制，1=Web 定制（**不传默认只查 0，网页端训练的在 1 里，很容易漏**）
 */
export function listCustomisedPerson(page = 1, pageSize = 50, source = 1) {
  return call('POST', '/list_customised_person', { page, page_size: pageSize, source })
}

/** 提交定制声音（doc 未列出 url 的格式要求，传公网可访问的音频地址） */
export function createCustomisedAudio(payload) {
  return call('POST', '/create_customised_audio', payload)
}

export function customisedAudioDetail(id) {
  return call('GET', '/customised_audio', { id })
}

export function listCustomisedAudio(page = 1, pageSize = 50, source = 1) {
  return call('POST', '/list_customised_audio', { page, page_size: pageSize, source })
}

/** 蝉豆余额（用于判断额度够不够，不产生费用） */
export function userDuration() {
  return call('GET', '/user_duration')
}
