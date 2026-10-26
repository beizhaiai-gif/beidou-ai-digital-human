/**
 * 抖音对标博主采集
 *
 * 两条通道，谁配了走谁：
 *  ① **TikHub**（首选）—— 纯 API，不碰浏览器，不需要登录。
 *  ② 真实浏览器（兜底）—— Playwright 打开主页拦 /aweme/post/，必须先扫码登录；
 *     缺点很实在：headless 容易被风控认出来，二维码不出/扫了不认，所以只当兜底。
 *
 * 队列要串行：同一个 Chrome profile 不能被两个实例同时打开。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as tikhub from './tikhub.js'
import { transcribeVideo } from './asr.js'
import { PY_BIN, dataDir } from './env.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PY = PY_BIN
const SCRIPTS = path.join(ROOT, 'scripts')
const DATA = dataDir('data', ROOT)
const DY_ROOT = path.join(DATA, 'douyin')
const STORE = path.join(DATA, 'bloggers.json')

/**
 * Chromium 的 --user-data-dir 不能带中文，而这个项目目录叫「数字人」，
 * 直接用 data/douyin/profile 会让浏览器启动卡死（实测 headful 卡在 starting 50 秒没反应）。
 * 所以登录 profile 单独丢到英文路径，两个 python 脚本都读这个环境变量。
 */
const PROFILE_DIR = path.join(process.env.HOME, '.cache', 'beizhai-workbench', 'dy-profile')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(DY_ROOT, { recursive: true })
fs.mkdirSync(path.dirname(PROFILE_DIR), { recursive: true })

/** 子进程统一环境 */
const childEnv = () => ({ ...process.env, DY_ROOT, DY_PROFILE: PROFILE_DIR })

/* ---------------- 串行队列 ---------------- */
let chain = Promise.resolve()
const enqueue = (fn) => {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

function runScript(args, timeout = 180000) {
  return new Promise((resolve) => {
    const p = spawn(PY, [path.join(SCRIPTS, 'douyin_fetch.py'), ...args], {
      cwd: ROOT,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, timeout)
    p.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: 'spawn 失败：' + String(e.message || e) })
    })
    p.on('close', () => {
      clearTimeout(timer)
      try {
        const line = out.trim().split('\n').filter(Boolean).pop()
        resolve({ ok: true, data: JSON.parse(line), err })
      } catch {
        resolve({ ok: false, error: (err || out || '脚本无输出').slice(-400) })
      }
    })
  })
}

/* ---------------- 本地存储 ---------------- */
function readStore() {
  try {
    const d = JSON.parse(fs.readFileSync(STORE, 'utf8'))
    return Array.isArray(d.bloggers) ? d : { bloggers: [] }
  } catch {
    return { bloggers: [] }
  }
}

function writeStore(d) {
  d.updatedAt = Date.now()
  fs.writeFileSync(STORE, JSON.stringify(d, null, 2))
}

/* ---------------- 对外能力 ---------------- */
export function whoami() {
  return enqueue(() => runScript(['whoami'], 60000))
}

const NEED_TIKHUB = '还没配 TikHub —— 打开 设置 → 第三方服务 → TikHub 填个 Token 就能采集'

/** 主页链接 / 分享文案 / sec_uid → { secUserId } */
export function resolve(text) {
  if (!tikhub.tikhubReady()) return Promise.resolve({ ok: false, error: NEED_TIKHUB })
  return tikhub.resolveSecUserId(text).then((r) => ({
    ok: r.ok,
    data: { secUserId: r.secUserId, nickname: '' },
    error: r.error,
  }))
}

/** 采集一个博主的作品（含点赞/评论/时长/发布时间） */
export async function fetchProfile(secUserId, limit = 20) {
  if (!tikhub.tikhubReady()) return { ok: false, error: NEED_TIKHUB }

  // 串行而不是并发：TikHub 对瞬时并发不友好，并发两个请求容易一起超时
  const u = await tikhub.fetchProfile(secUserId)
  if (!u.ok) return { ok: false, error: u.error }
  const v = await tikhub.fetchVideos(secUserId, limit)
  if (!v.ok) return { ok: false, error: v.error }
  return {
    ok: true,
    data: {
      loggedIn: true, // TikHub 不需要登录，保持字段兼容
      via: 'tikhub',
      user: {
        nickname: u.data.nickname,
        avatar: u.data.avatar,
        signature: u.data.signature,
        followerCount: u.data.followerCount,
        awemeCount: u.data.awemeCount,
      },
      videos: v.data,
    },
  }
}

/** 当前采集通道：tikhub（已配 Token）/ none（没配，什么都采不了） */
export function channel() {
  return tikhub.tikhubReady() ? 'tikhub' : 'none'
}

/** 单条视频采集：贴分享链接就行，不入博主库，直接返回视频信息 */
export async function fetchVideoByUrl(url) {
  if (!tikhub.tikhubReady()) return { ok: false, error: NEED_TIKHUB }
  const raw = String(url || '').trim()
  if (!raw) return { ok: false, error: '请贴抖音视频链接' }
  // 从分享文案里抠链接
  const m = raw.match(/https?:\/\/[^\s，,]+/)
  const link = m ? m[0] : raw
  if (!/douyin\.com|iesdouyin\.com/.test(link)) {
    return { ok: false, error: '看起来不是抖音链接' }
  }
  return tikhub.fetchOneVideoByUrl(link)
}

/**
 * 提取一条作品的口播文案（复刻用）
 * 播放地址有时效，必须现拉详情
 */
export async function extractScript(awemeId) {
  if (!tikhub.tikhubReady()) return { ok: false, error: NEED_TIKHUB }
  if (!awemeId) return { ok: false, error: '缺少作品 id' }

  const detail = await tikhub.fetchOneVideo(awemeId)
  if (!detail.ok) return { ok: false, error: detail.error }

  const playUrl = detail.data.playUrl
  if (!playUrl) return { ok: false, error: '这条视频拿不到播放地址' }

  const asr = await transcribeVideo(playUrl)
  if (!asr.ok) return { ok: false, error: asr.error }

  return {
    ok: true,
    data: {
      text: asr.text,
      provider: asr.provider,
      ms: asr.ms,
      title: detail.data.title,
      durationMs: detail.data.durationMs,
      awemeId,
    },
  }
}

/** 添加博主：解析 → 首次采集 → 入库 */
export async function addBlogger(input, limit = 20) {
  const r = await resolve(input)
  if (!r.ok) return { ok: false, error: r.error }
  const sec = r.data?.secUserId || r.data?.sec_uid
  if (!sec) return { ok: false, error: r.data?.error || '没能解析出 sec_uid，确认是主页链接而不是单条视频' }

  const prof = await fetchProfile(sec, limit)
  if (!prof.ok) return { ok: false, error: prof.error }
  if (!prof.data?.loggedIn) {
    return { ok: false, error: '抖音登录态失效 —— 先在热榜页扫一次码', needLogin: true }
  }
  const u = prof.data.user || {}
  const store = readStore()
  const exist = store.bloggers.find((b) => b.secUserId === sec)
  const now = Date.now()
  const item = {
    id: exist?.id || `b_${now.toString(36)}`,
    secUserId: sec,
    nickname: u.nickname || r.data?.nickname || '未命名',
    avatar: u.avatar || '',
    signature: u.signature || '',
    followerCount: u.followerCount || 0,
    awemeCount: u.awemeCount || 0,
    addedAt: exist?.addedAt || now,
    lastSync: now,
    via: prof.data.via || 'browser',
    videos: (() => {
      const map = new Map()
      for (const v of [...(prof.data.videos || []).map(normalizeVideo), ...(exist?.videos || [])]) {
        if (v.awemeId && !map.has(v.awemeId)) map.set(v.awemeId, v)
      }
      return [...map.values()].sort((x, y) => (y.createTime || 0) - (x.createTime || 0)).slice(0, 120)
    })(),
  }
  store.bloggers = exist
    ? store.bloggers.map((b) => (b.id === exist.id ? item : b))
    : [item, ...store.bloggers]
  writeStore(store)
  return { ok: true, data: item, count: item.videos.length }
}

/**
 * 重新采集（全部或指定）
 *
 * days = 1 表示只留近一天发布的（默认）。TikHub 单次最多 50 条，
 * 拉满再按 create_time 过滤，比只拉 20 条漏得少。
 */
export async function syncBloggers(ids = null, days = 1) {
  const store = readStore()
  const targets = ids?.length ? store.bloggers.filter((b) => ids.includes(b.id)) : store.bloggers
  if (!targets.length) return { ok: true, synced: 0, items: [] }

  const since = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0
  const limit = days > 0 ? 50 : 20

  /**
   * 采一个博主
   *
   * 只拉作品列表，不再拉用户资料 —— 昵称/粉丝在「添加博主」时已经存过了。
   * fetchProfile 内部是 2 次请求（profile + videos），这里 1 次就够，直接省一半。
   */
  const syncOne = async (b) => {
    let v = await tikhub.fetchVideos(b.secUserId, limit)
    // TikHub 会偶发「Request failed. Please retry.」，隔一秒再试一次基本都能过
    if (!v.ok) {
      await new Promise((r) => setTimeout(r, 1200))
      v = await tikhub.fetchVideos(b.secUserId, limit)
    }
    if (!v.ok) return { id: b.id, ok: false, error: v.error }

    const all = (v.data || []).map(normalizeVideo)
    // 合并而不是覆盖：抖音号可能几个月不发，覆盖会把历史记录清空
    const map = new Map()
    for (const x of [...all, ...(b.videos || [])]) {
      if (x.awemeId && !map.has(x.awemeId)) map.set(x.awemeId, x)
    }
    const merged = [...map.values()]
      .sort((x, y) => (y.createTime || 0) - (x.createTime || 0))
      .slice(0, 120)
    const newOnes = all.filter((x) => !(b.videos || []).some((o) => o.awemeId === x.awemeId))
    const inRange = since ? merged.filter((x) => (x.createTime || 0) >= since) : merged

    b.videos = merged
    b.lastSync = Date.now()
    b.via = 'tikhub'
    return { id: b.id, ok: true, total: inRange.length, added: newOnes.length, fetched: all.length, stored: merged.length }
  }

  // 并发 2：TikHub 对瞬时并发不友好（3 个以上容易一起超时），
  // 但全串行 6 个博主得等 15 秒，折中开 2 条线
  const CONCURRENCY = 3
  const results = []
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY)
    const rs = await Promise.all(chunk.map(syncOne))
    results.push(...rs)
  }

  writeStore(store)
  return { ok: true, synced: results.filter((x) => x.ok).length, items: results, channel: channel() }
}

export function listBloggers() {
  const store = readStore()
  return store.bloggers || []
}

/** 采集库最后一次写入的时间（前端显示「上次采集」用） */
export function storeUpdatedAt() {
  const t = readStore().updatedAt
  if (t) return t
  // 老数据没有这个字段，退回文件修改时间
  try {
    return Math.round(fs.statSync(STORE).mtimeMs)
  } catch {
    return 0
  }
}

export function removeBlogger(id) {
  const store = readStore()
  const before = store.bloggers.length
  store.bloggers = store.bloggers.filter((b) => b.id !== id)
  writeStore(store)
  return { ok: true, removed: before - store.bloggers.length }
}

/** 扫码登录：headless 出二维码（前端展示），或 headful 弹窗（本机用） */
export function login(mode = 'headless') {
  return new Promise((resolve) => {
    const p = spawn(PY, [path.join(SCRIPTS, 'douyin_login.py'), mode], {
      cwd: ROOT,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => {
      err += d.toString()
      process.stderr.write('[dy-login] ' + d.toString())
    })
    p.on('error', (e) => resolve({ ok: false, loggedIn: false, reason: 'spawn 失败：' + String(e.message || e) }))
    p.on('close', (code) => {
      try {
        resolve(JSON.parse(out.trim().split('\n').filter(Boolean).pop()))
      } catch {
        resolve({ ok: false, loggedIn: false, reason: `脚本退出 ${code}：` + (err || out || '无输出').slice(-300) })
      }
    })
  })
}

export function qrPath() {
  const f = path.join(DY_ROOT, 'qr.png')
  return fs.existsSync(f) ? f : null
}

/** 登录过程状态：starting / waiting / scanned / expired / verify / ok / timeout */
export function qrState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DY_ROOT, 'qr_state.json'), 'utf8'))
  } catch {
    return { state: 'idle' }
  }
}

function normalizeVideo(v) {
  return {
    awemeId: v.awemeId,
    title: v.title || '',
    cover: v.cover || '',
    durationMs: v.durationMs || 0,
    createTime: v.createTime || null,
    likeCount: v.likeCount || 0,
    commentCount: v.commentCount || 0,
    collectCount: v.collectCount || 0,
    shareCount: v.shareCount || 0,
    isImageAlbum: !!v.isImageAlbum,
  }
}

/**
 * 登录态快速检查（不启浏览器）
 *
 * 坑：抖音给游客也发 sessionid，光看 cookie 会误判成「已登录」。
 * 所以登录脚本成功时会写一个 login_ok.json 标记，两个都满足才算真登录。
 */
export function hasSession() {
  try {
    if (!fs.existsSync(path.join(DY_ROOT, 'login_ok.json'))) return false
    const f = path.join(PROFILE_DIR, 'Default', 'Cookies')
    if (!fs.existsSync(f)) return false
    const buf = fs.readFileSync(f)
    return buf.includes(Buffer.from('sessionid'))
  } catch {
    return false
  }
}

/** 清掉登录标记（用户点「重新登录」时用） */
export function clearSession() {
  try {
    fs.unlinkSync(path.join(DY_ROOT, 'login_ok.json'))
    return { ok: true }
  } catch {
    return { ok: true }
  }
}
