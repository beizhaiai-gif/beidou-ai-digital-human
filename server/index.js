import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runBridge, crawlTrends } from './lib/trendradar.js'
import {
  generateScript, generateTopics, ELEMENTS,
  buildScriptPrompt, countChars, CHARS_PER_SEC, SYSTEM as XUEHUI_SYSTEM,
} from './lib/xuehui.js'
import { uploadFile, submitAvatar, queryTask, getKey } from './lib/runninghub.js'
import { tts, probeDuration, estimateSeconds } from './lib/tts.js'
import { transcribe, buildAss, probe, renderVideo, genCards, buildBgList, makeMask, renderPip } from './lib/edit.js'
import { runTalkcraft, splitSentences, readShotlist, rerenderJob } from './lib/talkcraft.js'
import { cardList } from './lib/cards.js'
import { dataDir } from './lib/env.js'
import { planShotList, estimateSentences, availableCards } from './lib/shotlist.js'
import { publicSettings, saveSettings, testLlm, resolveLlm } from './lib/settings.js'
import { streamChat, DEFAULT_SYSTEM } from './lib/chat.js'
import { publicServices, saveServices, testService } from './lib/services.js'
import { searchVideos, fetchOneVideo } from './lib/tikhub.js'
import * as cj from './lib/chanjing.js'
import * as auth from './lib/auth.js'
import { makeProxy, attachWsProxy } from './lib/wbproxy.js'
import {
  listBloggers, addBlogger, syncBloggers, removeBlogger, fetchVideoByUrl, extractScript, storeUpdatedAt,
  login, qrPath, qrState, hasSession, channel, clearSession,
} from './lib/douyin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JOBS = dataDir('jobs', __dirname)
fs.mkdirSync(JOBS, { recursive: true })

// 数字人形象库（本地图，稍后由前端上传替换）
const AVATARS = [
  { id: 'a1', name: '北斋 · 横版工位', ratio: '16:9', file: 'photo_1920x1080.jpg' },
]

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const PORT = 5181

/* ---------------- 管理员登录 / 会话 ---------------- */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    runninghub: !!getKey(),
    llm: !!resolveLlm(),
    ts: Date.now(),
  })
})

app.post('/api/auth/login', (req, res) => {
  const { username = '', password = '' } = req.body || {}
  const r = auth.login(username, password, auth.clientIp(req))
  if (!r.ok) {
    const code = r.code === 'LOCKED' ? 429 : r.code === 'NOT_INIT' ? 503 : 401
    return res.status(code).json({ ok: false, code: r.code, error: r.error })
  }
  auth.setSessionCookie(req, res, r.token)
  res.json({ ok: true, data: { user: r.user } })
})

app.get('/api/auth/me', (req, res) => {
  const token = auth.parseCookies(req.headers.cookie || '')[auth.COOKIE_NAME]
  const s = auth.verify(token)
  // 未登录不抛 401：这是首屏的正常询问，用 200 + ok:false 免得控制台一片红
  if (!s) return res.json({ ok: false, code: 'UNAUTH' })
  res.json({ ok: true, data: { user: { name: s.user } } })
})

app.post('/api/auth/logout', (req, res) => {
  const token = auth.parseCookies(req.headers.cookie || '')[auth.COOKIE_NAME]
  auth.logout(token)
  auth.clearSessionCookie(req, res)
  res.json({ ok: true })
})

/**
 * 首次初始化：桌面端装完打开就能建账号，不用再 ssh 跑 set_admin.mjs。
 * 只在「还没有管理员」时放行 —— 有账号后这个口子就是死的，不存在绕过。
 */
app.get('/api/auth/status', (req, res) => {
  res.json({ ok: true, data: { initialized: !!auth.readAdmin() } })
})

app.post('/api/auth/init', (req, res) => {
  if (auth.readAdmin()) return res.status(403).json({ ok: false, error: '已初始化过，请直接登录' })
  const { username = '', password = '' } = req.body || {}
  if (!username.trim() || !password || password.length < 8) {
    return res.json({ ok: false, error: '账号不能为空，密码至少 8 位' })
  }
  try {
    const r = auth.saveAdmin({ username: username.trim(), password })
    const login = auth.login(r.username, password, auth.clientIp(req))
    if (login.ok) auth.setSessionCookie(req, res, login.token)
    res.json({ ok: true, data: { user: { name: r.username } } })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

// 改密码：必须已登录 + 输对旧密码
app.post('/api/auth/password', (req, res) => {
  const { oldPassword = '', newPassword = '' } = req.body || {}
  const admin = auth.readAdmin()
  if (!admin) return res.status(503).json({ ok: false, error: '账号还没初始化' })
  const chk = auth.login(admin.username, oldPassword, auth.clientIp(req))
  if (!chk.ok) return res.status(401).json({ ok: false, error: '旧密码不对' })
  try {
    auth.saveAdmin({ username: admin.username, password: newPassword })
    auth.logout(chk.token)
    res.json({ ok: true, data: { relogin: true } })
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) })
  }
})

/** 从这里往后，所有 /api、/jobs、/uploads 都要登录态 */
app.use(auth.authGuard)

/* ---------------- 设置（用户资料 + 大模型） ---------------- */
app.get('/api/settings', (req, res) => {
  res.json({ ok: true, data: publicSettings() })
})

app.post('/api/settings', (req, res) => {
  try {
    const data = saveSettings(req.body || {})
    res.json({ ok: true, data })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

app.post('/api/settings/test', async (req, res) => {
  const r = await testLlm(req.body || {})
  res.json({ ok: r.ok, data: r, error: r.ok ? '' : r.error })
})

/* ---------------- 头像上传 ---------------- */
/**
 * 前端用 canvas 压到 256×256 后传 dataURL，后端落盘返回路径。
 * 没上 multer 是因为只此一处，base64 走 express.json 足够（限 8MB）。
 */
const UPLOADS = path.join(__dirname, 'data', 'uploads')
fs.mkdirSync(UPLOADS, { recursive: true })
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }))

app.post('/api/avatar/upload', async (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '')
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return res.json({ ok: false, error: '只支持 png / jpg / webp' })

  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 3 * 1024 * 1024) return res.json({ ok: false, error: '图片太大（超过 3MB）' })

  const name = `avatar-${Date.now()}.${ext}`
  fs.writeFileSync(path.join(UPLOADS, name), buf)

  // 顺手清掉旧头像，别让目录无限长
  const cur = publicSettings().user?.avatarUrl || ''
  if (cur.startsWith('/uploads/')) {
    const old = path.join(UPLOADS, path.basename(cur))
    if (fs.existsSync(old) && path.basename(cur) !== name) {
      try { fs.unlinkSync(old) } catch {}
    }
  }

  const url = `/uploads/${name}`
  saveSettings({ user: { avatarUrl: url } })
  res.json({ ok: true, data: { url } })
})

/* ---------------- 第三方服务（RunningHub / 火山 / 蝉镜） ---------------- */
app.get('/api/services', (req, res) => {
  res.json({ ok: true, data: publicServices() })
})

app.post('/api/services', (req, res) => {
  try {
    res.json({ ok: true, data: saveServices(req.body || {}) })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

app.post('/api/services/test', async (req, res) => {
  const { id, ...rest } = req.body || {}
  if (!id) return res.json({ ok: false, error: '缺少服务 id' })
  const r = await testService(id, rest.values || rest)
  res.json({ ok: r.ok, data: r, error: r.ok ? '' : r.error })
})

/* ---------------- 通用文本对话（SSE 流式） ---------------- */
/**
 * 前端拿到的是逐帧 SSE：
 *   {type:'meta', model}          连接就绪，把模型名显示出来
 *   {type:'reasoning', text}      思考过程（可折叠）
 *   {type:'content', text}        正文增量
 *   {type:'done', usage, finish}  收尾
 *   {type:'error'|'stopped'}      异常/中断
 */
app.post('/api/chat', async (req, res) => {
  const { messages = [], system = '', temperature, effort, maxTokens } = req.body || {}
  if (!Array.isArray(messages) || !messages.length) {
    return res.json({ ok: false, error: '消息为空' })
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const ctrl = new AbortController()
  // 注意：req 上的 close 在 body 读完后就会触发，必须听 res
  res.on('close', () => { if (!res.writableEnded) ctrl.abort() })

  const send = (ev) => {
    if (res.writableEnded) return
    try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {}
  }

  await streamChat({ messages, system, temperature, effort, maxTokens }, send, ctrl.signal)
  if (!res.writableEnded) res.end()
})

/** 供前端展示模型名 / 人设预览 */
app.get('/api/chat/info', (req, res) => {
  const cfg = resolveLlm()
  res.json({
    ok: true,
    data: {
      model: cfg?.model || '',
      effort: cfg?.effort || 'low',
      ready: Boolean(cfg?.apiKey),
      system: DEFAULT_SYSTEM,
    },
  })
})

/* ---------------- 对标博主（抖音采集） ---------------- */
let loginTask = { running: false, result: null }

app.get('/api/blogger/list', (req, res) => {
  // updatedAt 让前端能显示「上次采集时间」，刷新后也知道数据是什么时候的
  res.json({ ok: true, data: listBloggers(), channel: channel(), updatedAt: storeUpdatedAt() })
})

app.get('/api/blogger/status', (req, res) => {
  res.json({
    ok: true,
    loggedIn: hasSession(),
    login: loginTask,
    qrState: qrState(),
    hasQr: !!qrPath(),
    // tikhub = 走 API 免登录；browser = 回退到浏览器采集（需要扫码）
    channel: channel(),
    ts: Date.now(),
  })
})

/** 起扫码登录（后台跑，前端轮询 status 看结果、拉 /qr 图） */
app.post('/api/blogger/login', (req, res) => {
  if (loginTask.running) return res.json({ ok: true, running: true })
  loginTask = { running: true, result: null, startedAt: Date.now() }
  res.json({ ok: true, running: true })
  login(req.body?.mode || 'headful')
    .then((r) => { loginTask = { running: false, result: r, endedAt: Date.now() } })
    .catch((e) => { loginTask = { running: false, result: { ok: false, reason: String(e.message || e) }, endedAt: Date.now() } })
})

/** 清掉登录态，下次重新扫码 */
app.post('/api/blogger/logout', (req, res) => {
  res.json(clearSession())
})

app.get('/api/blogger/qr', (req, res) => {
  const f = qrPath()
  if (!f) return res.status(404).end()
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(f)
})

app.post('/api/blogger/add', async (req, res) => {
  const { url, limit } = req.body || {}
  if (!url) return res.json({ ok: false, error: '请填博主主页链接或 sec_uid' })
  const r = await addBlogger(String(url).trim(), limit || 20)
  res.json(r)
})

app.post('/api/blogger/sync', async (req, res) => {
  // days 默认 1 = 只留近一天发布的
  const r = await syncBloggers(req.body?.ids || null, Number(req.body?.days ?? 1))
  res.json(r)
})

/**
 * 视频代理播放
 *
 * 为什么不直接给前端抖音的 CDN 地址：实测 <video src="https://...zjcdn.com/..."> 会报
 * MEDIA_ELEMENT_ERROR: Format error，而同一份文件下载到本地又能播（readyState=4）。
 * 说明是 CDN 对浏览器请求（Referer / Range / CORS）有限制。
 * 走同源代理就没这些问题，顺便还能带正确的 Referer。
 */
app.get('/api/blogger/stream/:awemeId', async (req, res) => {
  const { awemeId } = req.params
  try {
    const d = await fetchOneVideo(awemeId)
    if (!d.ok || !d.data.playUrl) {
      return res.status(404).json({ ok: false, error: d.error || '拿不到播放地址' })
    }

    const upstream = await fetch(d.data.playUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://www.douyin.com/',
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
    })

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ ok: false, error: `上游返回 ${upstream.status}` })
    }

    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }
    const cl = upstream.headers.get('content-length')
    const cr = upstream.headers.get('content-range')
    if (cl) headers['Content-Length'] = cl
    if (cr) headers['Content-Range'] = cr

    res.writeHead(upstream.status, headers)
    if (!upstream.body) return res.end()

    const { Readable } = await import('node:stream')
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(e.message || e) })
    else res.end()
  }
})

/** 取一条作品的实时播放地址（存下来的 x-expires 会过期，点开时现拿） */
app.get('/api/blogger/play/:awemeId', async (req, res) => {
  const { awemeId } = req.params
  try {
    const r = await fetchOneVideo(awemeId)
    if (!r.ok) return res.json({ ok: false, error: r.error })
    if (!r.data.playUrl) return res.json({ ok: false, error: '这条拿不到播放地址' })
    res.json({
      ok: true,
      data: { url: r.data.playUrl, title: r.data.title, durationMs: r.data.durationMs },
    })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/** 提取一条作品的口播文案（下载 + 本地 ASR，十几秒） */
app.post('/api/blogger/script', async (req, res) => {
  const r = await extractScript(req.body?.awemeId)
  res.json(r)
})

/** 单条视频：贴分享链接直接采 */
app.post('/api/blogger/video', async (req, res) => {
  const r = await fetchVideoByUrl(req.body?.url)
  res.json(r)
})

app.delete('/api/blogger/:id', (req, res) => {
  res.json(removeBlogger(req.params.id))
})

/* ---------------- ① 热榜采集 ---------------- */
/**
 * 热榜：bridge 每次要 spawn python 读盘，单次 9–16 秒。
 * 策略 = 5 分钟缓存 + 刷新时 stale-while-revalidate（先秒回旧数据，后台换新）。
 */
let trendsCache = { at: 0, payload: null }
let refreshing = false
const TRENDS_TTL = 5 * 60 * 1000

async function buildTrendsPayload(limit) {
  // status 与 latest 并行，省一半时间
  const [status, latest] = await Promise.all([
    runBridge('status', {}, 45_000),
    runBridge('latest', { days: 3, limit }, 90_000),
  ])
  if (!latest.ok) return null

  const raw = latest.data?.data || []
  const items = raw.map((it, i) => ({
    id: `t${i}`,
    rank: it.rank || i + 1,
    title: it.title || '',
    src: it.platform_name || it.platform || '',
    platform: it.platform || '',
    heat: '',
    time: (it.timestamp || '').slice(11, 16),
    url: it.url || '',
  })).filter((it) => it.title)

  return { ok: true, data: { items, total: items.length, stale: status?.data || null } }
}

app.get('/api/trends', async (req, res) => {
  const limit = Number(req.query.limit || 30)
  const platform = req.query.platform || ''
  const force = req.query.force === '1'

  // ① 缓存命中
  if (!force && trendsCache.payload && Date.now() - trendsCache.at < TRENDS_TTL) {
    return res.json({ ...trendsCache.payload, cached: true })
  }

  // ② 刷新：有旧数据就秒回，后台换新
  if (force && trendsCache.payload) {
    if (!refreshing) {
      refreshing = true
      buildTrendsPayload(limit)
        .then((pl) => { if (pl) trendsCache = { at: Date.now(), payload: pl } })
        .catch(() => {})
        .finally(() => { refreshing = false })
    }
    return res.json({ ...trendsCache.payload, cached: true, refreshing: true })
  }

  // ③ 冷启动：等一次
  const built = await buildTrendsPayload(limit)
  if (!built) {
    const st = await runBridge('status', {}, 45_000)
    return res.json({
      ok: false,
      stale: st?.data || null,
      error: '暂无今日数据',
      hint: st?.data?.latestDate
        ? `最近一次抓取是 ${st.data.latestDate}（${st.data.staleDays} 天前），正在自动补抓…`
        : 'TrendRadar 还没抓过数据，正在自动补抓…',
    })
  }
  trendsCache = { at: Date.now(), payload: built }
  const out = platform
    ? { ...built, data: { ...built.data, items: built.data.items.filter((i) => i.platform === platform) } }
    : built
  res.json(out)
})

/** 手动触发一次抓取（前端「获取今日热榜」发现没今日数据时调它） */
let crawlTask = { running: false, startedAt: 0, result: null }
app.post('/api/trends/crawl', (req, res) => {
  if (crawlTask.running) return res.json({ ok: true, running: true, startedAt: crawlTask.startedAt })
  crawlTask = { running: true, startedAt: Date.now(), result: null }
  res.json({ ok: true, running: true, startedAt: crawlTask.startedAt })

  crawlTrends().then((r) => {
    crawlTask = { running: false, startedAt: crawlTask.startedAt, result: r }
    trendsCache = { at: 0, payload: null }
  })
})

app.get('/api/trends/crawl', (req, res) => {
  res.json({ ok: true, ...crawlTask })
})

/* ---------------- ① 对标博主（占位：需扫码登录态） ---------------- */
app.get('/api/bench', (req, res) => {
  res.json({
    ok: false,
    error: '对标博主采集需要抖音登录态',
    hint: '公众号项目里的浏览器采集方案要先扫码登录；也可以改用 TikHub（需 token）',
    data: { bloggers: [] },
  })
})

/* ---------------- ① AI 生成选题 ---------------- */
app.get('/api/xuehui/elements', (req, res) => {
  res.json({ ok: true, data: Object.entries(ELEMENTS).map(([name, desc]) => ({ name, desc })) })
})

app.post('/api/topics', async (req, res) => {
  const { source = '', framework = 'teach', count = 5, elements = [], search = false, effort } = req.body || {}
  if (!source.trim()) return res.json({ ok: false, error: '缺少素材（热榜条目或对标视频）' })

  let enriched = source
  let searched = null

  // 热榜出题前先去抖音搜真实作品，别让模型凭空编
  if (search) {
    const lines = String(source).split('\n').map((x) => x.trim()).filter(Boolean)
    const mi = lines.findIndex((l) => l.includes('必须用来出题'))
    const raw = mi >= 0 && lines[mi + 1] ? lines[mi + 1] : lines[0]

    const strip = (x) =>
      x
        .replace(/^\s*\d+\s*[.、)）]\s*/, '') // 去掉榜单序号
        .replace(/[#【】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const segs = raw
      .split(/[！？!?，,。.、|｜:：]/)
      .map(strip)
      .filter((x) => x.length >= 3)
      .sort((a, b) => b.length - a.length)
    const cands = [
      ...new Set([
        strip(raw).slice(0, 30),
        segs[0],
        strip(raw).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 6),
      ]),
    ]
      .filter(Boolean)
      .slice(0, 3)

    for (const kw of cands) {
      const sr = await searchVideos(kw, { publishTime: '7', limit: 12 })
      if (sr.ok && sr.data.length) {
        searched = { keyword: kw, items: sr.data }
        enriched = `${source}

【抖音上关于「${kw}」的真实作品（近一周，综合排序）】
${sr.data.map((x, i) => `${i + 1}. ${x.title}${x.like ? `（♥${x.like}）` : ''}`).join('\n')}

【用法】这些是已存在的选题方向，用来判断「观众已经看过什么」以避免撞题；
但**出题对象仍然是上面那一条**，不许换成这些。`
        break
      }
    }
  }

  const result = await generateTopics({ source: enriched, framework, count, elements, effort })
  res.json({ ...result, searched })
})

/* ---------------- ② 薛辉文案 ---------------- */
app.post('/api/script', async (req, res) => {
  const {
    topic, framework = 'teach', tone = 'direct', duration = 45,
    extra = '', elements = [], original = '',
  } = req.body || {}
  // 复刻模式：有原文案就不需要 topic
  if (!topic && !original) return res.json({ ok: false, error: '缺少选题' })

  const result = await generateScript({ topic: topic || '（复刻改写）', framework, tone, duration, extra, elements, original })
  if (result.ok) {
    result.data.estimate = estimateSeconds(result.data.script)
  }
  res.json(result)
})

/**
 * 流式写稿（SSE）
 *
 * 为什么不复用 /api/script：长稿要 40–90 秒，非流式用户只能干等。
 * 这里把增量的 content 实时推给前端，第一句话几秒就能看到。
 * 事件：meta / reasoning / content / chars / compressed / done / error
 */
app.post('/api/script/stream', async (req, res) => {
  const {
    topic, framework = 'teach', tone = 'direct', duration = 45,
    extra = '', elements = [], original = '',
  } = req.body || {}
  if (!topic && !original) return res.json({ ok: false, error: '缺少选题' })

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const ctrl = new AbortController()
  // 听 res 不听 req：req 的 close 在 body 读完就触发，会秒 abort
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort()
  })

  const send = (ev) => {
    if (res.writableEnded) return
    try {
      res.write(`data: ${JSON.stringify(ev)}\n\n`)
    } catch {}
  }

  const { prompt, low, high } = buildScriptPrompt({
    topic, framework, tone, duration, extra, elements, original,
  })

  let content = ''
  let thinkLen = 0
  send({ type: 'meta', low, high, target: Math.round(duration * CHARS_PER_SEC) })

  const r = await streamChat(
    {
      messages: [{ role: 'user', content: prompt }],
      system: XUEHUI_SYSTEM,
      temperature: 0.85,
      maxTokens: 16384,
      effort: 'none', // 写稿不需要深度思考，实测 68s → 4s
    },
    (ev) => {
      if (ev.type === 'content') {
        content += ev.text
        send({ type: 'content', text: ev.text })
      } else if (ev.type === 'reasoning') {
        // 思考阶段是大头（实测 60s 稿要 30 秒思考），只推长度当心跳，不推正文
        thinkLen += ev.text.length
        if (thinkLen % 40 < ev.text.length) send({ type: 'thinking', len: thinkLen })
      } else if (ev.type === 'error' || ev.type === 'stopped') {
        send(ev)
      }
      // 其余（meta / done / usage）由下面自己发，避免前端收到重复帧
    },
    ctrl.signal,
  )

  if (!r.ok) {
    send({ type: 'error', error: r.error || '生成失败' })
    if (!res.writableEnded) res.end()
    return
  }

  const chars = countChars(content)
  send({ type: 'chars', chars, low, high, seconds: Math.round(chars / CHARS_PER_SEC) })

  // 超了自动重写一次（非流式，直接覆盖）
  if (chars > high * 1.03) {
    const fixed = await generateScript({ topic, framework, tone, duration, extra, elements, original })
    if (fixed.ok && countChars(fixed.data.script) < chars) {
      send({ type: 'compressed', text: fixed.data.script, chars: countChars(fixed.data.script) })
    }
  }

  send({ type: 'done' })
  if (!res.writableEnded) res.end()
})

/* ---------------- ③ 数字人出片 ---------------- */
/* ---------------- ③ 数字人出片 ---------------- */
/** 取形象/音色选项（带缓存，供 /options 和 /avatar 复用） */
let avatarOptsCache = { at: 0, data: null }

/**
 * 形象封面缩略图
 *
 * 公共形象的 cover 是 1.4MB 的 PNG，41 张 50MB+，浏览器加载不完（实测只成功 7 张）。
 * 图托管在阿里云 OSS，支持 x-oss-process 实时处理 —— 压成 320 宽 webp 只要 8KB。
 */
function thumbUrl(u) {
  if (!u) return ''
  if (!/res\.chanjing\.cc/.test(u)) return u
  const sep = u.includes('?') ? '&' : '?'
  return `${u}${sep}x-oss-process=image/resize,w_320/format,webp`
}

async function getAvatarOptions(force = false) {
  if (!force && avatarOptsCache.data && Date.now() - avatarOptsCache.at < 5 * 60 * 1000) {
    return avatarOptsCache.data
  }
  const [dp, au, bean] = await Promise.all([cj.listCommonDp(1, 40), cj.listCommonAudio(1, 40), cj.userDuration()])
  if (!dp.ok) throw new Error(`加载形象失败：${dp.msg || dp.error || dp.code}`)
  if (!au.ok) throw new Error(`加载音色失败：${au.msg || au.error || au.code}`)

  // 我训练好的形象排在最前面
  // source 很关键：0=API 渠道定制，1=蝉镜主站（网页/App）定制。
  // create_video 默认只在 source=0 里找，网页端训练的形象不传 source=1 就会报「该数字人不存在」
  let customPersons = []
  try {
    const [c0, c1] = await Promise.all([cj.listCustomisedPerson(1, 50, 0), cj.listCustomisedPerson(1, 50, 1)])
    const pack = (list, src) =>
      (list || [])
        .filter((x) => x.status === 2 && x.width && x.height) // 2=训练成功
        .map((x) => ({
          id: x.id,
          name: x.name,
          custom: true,
          source: src,
          figures: [{ type: 'person', width: x.width, height: x.height, cover: thumbUrl(x.pic_url) }],
          cover: thumbUrl(x.pic_url),
        }))
    customPersons = [...pack(c0.data?.list, 0), ...pack(c1.data?.list, 1)]
  } catch (e) {
    console.warn('[avatar/options] 拉定制形象失败:', e.message)
  }
  if (process.env.DEBUG_OPTS) console.log('[avatar/options] 定制形象', customPersons.length, '公共形象', (dp.data?.list || []).length)

  const persons = [
    ...customPersons,
    ...(dp.data?.list || [])
      .filter((p) => Array.isArray(p.figures) && p.figures.length)
      .map((p) => ({
        id: p.id,
        name: p.name,
        custom: false,
        source: 0,
        figures: p.figures.map((f) => ({ type: f.type, width: f.width, height: f.height, cover: thumbUrl(f.cover) })),
        cover: thumbUrl(
          p.figures.find((f) => f.type === 'sit_body' || f.type === 'whole_body')?.cover || p.figures[0].cover,
        ),
      })),
  ]
  let customAudios = []
  try {
    const [v0, v1] = await Promise.all([cj.listCustomisedAudio(1, 50, 0), cj.listCustomisedAudio(1, 50, 1)])
    const pack = (list, src) =>
      (list || [])
        .filter((x) => x.status === 2)
        .map((x) => ({ id: x.id, name: x.name, gender: '', audition: '', custom: true, source: src }))
    customAudios = [...pack(v0.data?.list, 0), ...pack(v1.data?.list, 1)]
  } catch {}

  const audios = [
    ...customAudios,
    ...(au.data?.list || []).map((a) => ({
      id: a.id,
      name: a.name,
      gender: a.gender,
      audition: a.audition || '',
      custom: false,
      source: 0,
    })),
  ]

  const data = { persons, audios, bean: bean.ok ? bean.data : null }
  avatarOptsCache = { at: Date.now(), data }
  return data
}

app.get('/api/avatar/options', async (req, res) => {
  if (req.query.force) avatarOptsCache = { at: 0, data: null }
  if (!cj.hasCredentials()) {
    return res.json({
      ok: false,
      error: '数字人服务还没配置 —— 联系管理员',
    })
  }
  try {
    res.json({ ok: true, data: await getAvatarOptions() })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/* ---- 定制形象 / 定制声音（训练自己的数字人） ---- */

/** 上传训练素材（视频）→ 返回蝉镜 OSS 上的公网 URL
 *  注意：路由不能叫 /api/avatar/upload —— 那个是设置页的头像上传，先注册会把它盖掉 */
app.post('/api/avatar/material', async (req, res) => {
  const { filename = 'material.mp4', dataUrl = '' } = req.body || {}
  if (!cj.hasCredentials()) return res.json({ ok: false, error: '数字人服务还没配置' })

  const m = /^data:(video\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)
  if (!m) return res.json({ ok: false, error: '只接受视频文件（mp4 / mov / webm）' })
  const mime = m[1]
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 120 * 1024 * 1024) return res.json({ ok: false, error: '视频超过 120MB' })

  const ext = (filename.split('.').pop() || 'mp4').toLowerCase()
  if (!['mp4', 'mov', 'webm'].includes(ext)) {
    return res.json({ ok: false, error: '只接受 mp4 / mov / webm 视频' })
  }

  try {
    const up = await cj.createUploadUrl('customised_person', `wb_${Date.now()}.${ext}`)
    if (!up.ok) return res.json({ ok: false, error: `拿上传地址失败 code=${up.code} ${up.msg || ''}` })
    const signUrl = up.data?.sign_url
    if (!signUrl) return res.json({ ok: false, error: '没有返回 sign_url' })

    const put = await cj.uploadToSignedUrl(signUrl, buf, mime)
    if (!put.ok) return res.json({ ok: false, error: put.error })

    res.json({ ok: true, data: { url: put.url, size: buf.length } })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/** 提交定制数字人训练 */
app.post('/api/avatar/train-person', async (req, res) => {
  const { name, materialUrl, isHighQuality = true, version = '1.0' } = req.body || {}
  if (!cj.hasCredentials()) return res.json({ ok: false, error: '数字人服务还没配置' })
  if (!name || !materialUrl) return res.json({ ok: false, error: '需要名字和素材视频地址' })

  try {
    const r = await cj.createCustomisedPerson({
      name: String(name).slice(0, 20),
      material_video: materialUrl,
      is_high_quality: Boolean(isHighQuality),
      version,
    })
    if (!r.ok) return res.json({ ok: false, error: `提交失败 code=${r.code} ${r.msg || ''}`, trace: r.trace })
    res.json({ ok: true, data: { id: typeof r.data === 'string' ? r.data : r.data?.id, trace: r.trace } })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/** 提交定制声音训练 */
app.post('/api/avatar/train-audio', async (req, res) => {
  const { name, audioUrl, text = '', modelType = 'cicada1.0' } = req.body || {}
  if (!cj.hasCredentials()) return res.json({ ok: false, error: '数字人服务还没配置' })
  if (!name || !audioUrl) return res.json({ ok: false, error: '需要名字和音频地址' })

  try {
    const r = await cj.createCustomisedAudio({
      name: String(name).slice(0, 20),
      url: audioUrl,
      text: text || undefined,
      model_type: modelType,
      denoise_flag: true,
    })
    if (!r.ok) {
      return res.json({
        ok: false,
        error: `提交失败 code=${r.code} ${r.msg || ''}`,
        trace: r.trace,
      })
    }
    res.json({ ok: true, data: { id: typeof r.data === 'string' ? r.data : r.data?.id, trace: r.trace } })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/** 训练进度：type=person | audio */
app.get('/api/avatar/train/:type/:id', async (req, res) => {
  const { type, id } = req.params
  try {
    const r = type === 'audio' ? await cj.customisedAudioDetail(id) : await cj.customisedPersonDetail(id)
    if (!r.ok) return res.json({ ok: false, error: `查询失败 code=${r.code} ${r.msg || ''}` })
    const d = r.data || {}
    res.json({
      ok: true,
      data: {
        // 数字人：1制作中 2成功 4失败 5系统错误；声音 status 枚举文档未列，按同样语义处理
        status: d.status,
        progress: d.progress || 0,
        reason: d.err_reason || d.reason || d.err_msg || '',
        name: d.name,
        picUrl: d.pic_url || '',
        width: d.width,
        height: d.height,
      },
    })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/** 我训练出来的形象和声音 */
app.get('/api/avatar/custom', async (req, res) => {
  if (!cj.hasCredentials()) return res.json({ ok: false, error: '数字人服务还没配置' })
  try {
    // source 0=API 定制 1=Web 定制，网页端训练的都在 1 里，两边都要查
    const [p0, p1, a0, a1] = await Promise.all([
      cj.listCustomisedPerson(1, 50, 0),
      cj.listCustomisedPerson(1, 50, 1),
      cj.listCustomisedAudio(1, 50, 0),
      cj.listCustomisedAudio(1, 50, 1),
    ])
    const p = { data: { list: [...(p0.data?.list || []), ...(p1.data?.list || [])] } }
    const a = { data: { list: [...(a0.data?.list || []), ...(a1.data?.list || [])] } }
    const persons = (p.data?.list || []).map((x) => ({
      id: x.id,
      name: x.name,
      cover: x.pic_url || '',
      width: x.width,
      height: x.height,
      status: x.status, // 1 制作中 / 2 成功
      progress: x.progress || 0,
      audioId: x.audio_man_id || '',
    }))
    const audios = (a.data?.list || []).map((x) => ({
      id: x.id,
      name: x.name,
      status: x.status,
      progress: x.progress || 0,
    }))
    res.json({ ok: true, data: { persons, audios } })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/**
 * 第三步：稿子 → 数字人视频（蝉镜）
 *
 * 走 audio.type = 'tts'：稿子直接给蝉镜，它自己合成语音再驱动口型，
 * 不用我们在本地跑 TTS，也就不会出现「选了复刻音色、出来是微软云希」那种错。
 */
app.post('/api/avatar', async (req, res) => {
  const { script, personId, figureType, audioMan, model = 1 } = req.body || {}
  if (!script || !script.trim()) return res.json({ ok: false, error: '缺少稿子' })
  if (!cj.hasCredentials()) {
    return res.json({
      ok: false,
      error: '数字人服务还没配置 —— 联系管理员',
    })
  }

  try {
    const opts = await getAvatarOptions()
    if (!opts.persons.length) return res.json({ ok: false, error: '没有可用的数字人形象' })
    if (!opts.audios.length) return res.json({ ok: false, error: '没有可用的配音音色' })

    const person = opts.persons.find((p) => p.id === personId) || opts.persons[0]
    const fig =
      person.figures.find((f) => f.type === figureType) ||
      person.figures.find((f) => f.width < f.height) ||
      person.figures[0]
    const audio = opts.audios.find((a) => a.id === audioMan) || opts.audios[0]

    // 定制形象/音色分两个渠道：source=1 是蝉镜主站（网页/App）训练的。
    // 不传 source 时接口只在 API 渠道里找，网页训练的形象就会报「该数字人不存在」。
    const personSrc = person.source === 1 ? 1 : 0
    const audioSrc = audio.source === 1 ? 1 : 0
    const personBody = { id: person.id, width: fig.width, height: fig.height }
    // figure_type 只对公共数字人有效，定制形象传了反而可能报错
    if (!personSrc) personBody.figure_type = fig.type

    const cv = await cj.createVideo({
      person: personBody,
      // 规范里 tts.text 是「字符串数组」，不是字符串 —— 传字符串会直接 400 参数错误
      // volume 必传且不能小于 1（不传按 0 算，会报「音量不能小于1」）
      audio: { type: 'tts', volume: 100, tts: { audio_man: audio.id, text: [script], speed: 1 } },
      screen_width: fig.width,
      screen_height: fig.height,
      source: personSrc,
      audio_source: audioSrc,
      model: Number(model) === 0 ? 0 : 1,
      hide_subtitle: false,
    })

    if (!cv.ok) {
      return res.json({
        ok: false,
        error: `提交失败 code=${cv.code} ${cv.msg || ''}`,
        trace: cv.trace,
      })
    }

    // 规范：create_video 的 data 就是任务 ID 字符串本身
    const videoId = typeof cv.data === 'string' ? cv.data : cv.data?.id
    if (!videoId) return res.json({ ok: false, error: '没有拿到任务 ID', trace: cv.trace })

    const jobId = `job_${Date.now()}`
    try {
      const dir = path.join(JOBS, jobId)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'job.json'),
        JSON.stringify(
          {
            jobId,
            provider: 'chanjing',
            videoId,
            person: { id: person.id, name: person.name, figure: fig.type, w: fig.width, h: fig.height },
            audio: { id: audio.id, name: audio.name },
            chars: script.replace(/\s/g, '').length,
            createdAt: Date.now(),
          },
          null,
          2,
        ),
      )
    } catch {}

    res.json({
      ok: true,
      data: {
        jobId,
        taskId: videoId,
        provider: 'chanjing',
        person: person.name,
        audio: audio.name,
        size: `${fig.width}x${fig.height}`,
      },
    })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/* ---------------- ③ 查询出片状态（蝉镜） ---------------- */
app.get('/api/avatar/:id', async (req, res) => {
  const { id } = req.params
  try {
    const st = await cj.videoDetail(id)
    if (!st.ok) {
      return res.json({ ok: false, error: `查询失败 code=${st.code} ${st.msg || ''}`, trace: st.trace })
    }
    const d = st.data || {}
    res.json({
      ok: true,
      data: {
        // queued / processing / completed / failed / other
        status: d.queue_status,
        desc: d.queue_desc || '',
        msg: d.msg || '',
        duration: d.duration || null,
        results: d.video_url ? [{ url: d.video_url, type: 'video' }] : [],
      },
    })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/* ---------------- ④ 智能剪辑（真链路） ---------------- */
const editTasks = new Map()

app.use('/jobs', express.static(JOBS))

/**
 * 素材上传：直接把二进制 PUT 上来，走 express.raw，不引 multipart 依赖。
 * 视频动辄 150MB+，用 JSON base64 会把体积撑大 33%，所以单独开一个接口。
 *
 * 前端：fetch('/api/edit/asset?kind=video', {method:'POST', body: file})
 */
app.post('/api/edit/asset', express.raw({ type: '*/*', limit: '800mb' }), (req, res) => {
  const kind = String(req.query.kind || 'video')
  if (!['video', 'audio'].includes(kind)) return res.json({ ok: false, error: 'kind 只能是 video / audio' })
  if (!req.body || !req.body.length) return res.json({ ok: false, error: '没有收到文件内容' })

  const dir = path.join(JOBS, '_uploads')
  fs.mkdirSync(dir, { recursive: true })
  const ext = kind === 'audio' ? 'mp3' : 'mp4'
  const name = `${kind}_${Date.now()}.${ext}`
  fs.writeFileSync(path.join(dir, name), req.body)
  const mb = (req.body.length / 1048576).toFixed(1)
  res.json({ ok: true, data: { file: name, mb: Number(mb) } })
})

/**
 * 本地路径直读（桌面端专用）。
 *
 * 桌面端里素材就在用户自己电脑上 —— 让他把 154MB 视频先传一遍，
 * 纯属浪费；直接把绝对路径交给后端，同盘硬链接（零拷贝）、跨盘才复制。
 * 网页端没有这个接口（浏览器拿不到本地路径），所以做成独立路由。
 */
const PATH_EXT = {
  video: ['.mp4', '.mov', '.m4v', '.webm'],
  audio: ['.mp3', '.wav', '.m4a', '.aac'],
}

app.post('/api/edit/asset-path', (req, res) => {
  const kind = String(req.body?.kind || 'video')
  const src = String(req.body?.path || '')
  if (!['video', 'audio'].includes(kind)) return res.json({ ok: false, error: 'kind 只能是 video / audio' })
  if (!src) return res.json({ ok: false, error: '没有收到文件路径' })

  // 只收绝对路径 + 白名单扩展名，防止被当成任意文件读取的口子
  const p = path.resolve(src)
  const ext = path.extname(p).toLowerCase()
  if (!path.isAbsolute(p)) return res.json({ ok: false, error: '必须是绝对路径' })
  if (!PATH_EXT[kind].includes(ext)) {
    return res.json({ ok: false, error: `不支持的格式 ${ext || '(无后缀)'}，${kind === 'video' ? '视频' : '音频'}支持 ${PATH_EXT[kind].join(' / ')}` })
  }
  let st
  try {
    st = fs.statSync(p)
  } catch {
    return res.json({ ok: false, error: '文件不存在（或刚被移动）' })
  }
  if (!st.isFile()) return res.json({ ok: false, error: '这不是一个文件' })

  const dir = path.join(JOBS, '_uploads')
  fs.mkdirSync(dir, { recursive: true })
  const name = `${kind}_${Date.now()}${ext}`
  const dst = path.join(dir, name)
  try {
    fs.linkSync(p, dst) // 同盘硬链接：零拷贝、零耗时
  } catch {
    fs.copyFileSync(p, dst) // 跨盘才真复制
  }
  res.json({ ok: true, data: { file: name, mb: Number((st.size / 1048576).toFixed(1)), name: path.basename(p) } })
})

/**
 * 历史作品：直接扫 jobs 目录（重启不丢，因为盘上就是真相）。
 * 内存里的 editTasks 只是运行时状态，重启后为空，所以优先看有没有成片文件。
 */
app.get('/api/works', (req, res) => {
  try {
    const items = fs
      .readdirSync(JOBS)
      .filter((n) => n.startsWith('edit_'))
      .map((n) => {
        const dir = path.join(JOBS, n)
        let st
        try {
          st = fs.statSync(dir)
        } catch {
          return null
        }
        const final = path.join(dir, 'final_1080p.mp4')
        const has = fs.existsSync(final)
        const t = editTasks.get(n)
        // 有分镜底稿才能「改卡重渲」；老作品只要工程文件还在，读的时候会自动反推
        const hasShotlist =
          fs.existsSync(path.join(dir, 'shotlist.json')) ||
          (fs.existsSync(path.join(dir, 'engine/src/shots.ts')) &&
            fs.existsSync(path.join(dir, 'engine/src/content.json')))
        let revision = 1
        let totalSec = 0
        if (hasShotlist) {
          try {
            const doc = JSON.parse(fs.readFileSync(path.join(dir, 'shotlist.json'), 'utf8'))
            revision = doc.revision || 1
            totalSec = doc.totalSec || 0
          } catch {}
        }
        return {
          jobId: n,
          at: Math.round(st.mtimeMs),
          size: has ? fs.statSync(final).size : 0,
          video: has ? `/jobs/${n}/final_1080p.mp4` : '',
          status: t?.status || (has ? 'SUCCESS' : 'UNKNOWN'),
          step: t?.step || '',
          progress: t?.progress || 0,
          error: t?.error || '',
          // 服务重启后内存里的 meta 没了，时长从分镜底稿兜回来
          duration: t?.meta?.duration || t?.duration || totalSec || 0,
          hasShotlist,
          revision,
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at)
      .slice(0, 60)
    res.json({ ok: true, data: items })
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

/**
 * 分镜底稿：前端「改卡」界面的数据源。
 *
 * 一起把可用卡片清单带回去，省一次请求 —— 清单里带 slots（每张卡要填哪几个字），
 * 前端才知道换卡之后该弹几个输入框。
 */
app.get('/api/works/:jobId/shotlist', (req, res) => {
  const r = readShotlist(req.params.jobId)
  if (!r.ok) return res.json({ ok: false, error: r.error })
  const cards = cardList().map(({ id, name, category, dur, usable, tail, person, slots, note }) => ({
    id, name, category, dur, usable, tail, person, slots, note,
  }))
  res.json({
    ok: true,
    data: {
      jobId: r.data.jobId || req.params.jobId,
      totalSec: r.data.totalSec,
      capStyle: r.data.capStyle,
      revision: r.data.revision || 1,
      shots: r.data.shots,
      cards,
    },
  })
})

/**
 * 改卡重渲：只动「这一镜用哪张卡 / 卡上写什么」，时间轴一帧不改。
 * 排进同一个渲染队列，和正在跑的任务串行，不会互相抢 CPU。
 */
app.post('/api/works/:jobId/rerender', (req, res) => {
  const jobId = path.basename(String(req.params.jobId))
  const src = path.join(JOBS, jobId)
  if (!fs.existsSync(src)) return res.json({ ok: false, error: '作品目录不存在' })
  const patches = Array.isArray(req.body?.shots) ? req.body.shots : null
  if (!patches || !patches.length) return res.json({ ok: false, error: '没有要改的分镜' })
  if (patches.length > 200) return res.json({ ok: false, error: '一次改太多了' })

  const t = editTasks.get(jobId) || {}
  if (t.status === 'RUNNING') return res.json({ ok: false, error: '这条还在渲染，等它跑完再改' })

  editTasks.set(jobId, { ...t, status: 'RUNNING', progress: 10, step: '排队重渲', error: '', output: t.output || '' })
  res.json({ ok: true, data: { jobId } })

  ;(async () => {
    const cur = editTasks.get(jobId)
    try {
      const out = await rerenderJob(jobId, patches, ({ stage, progress }) => {
        Object.assign(cur, { progress, step: stage })
      })
      if (!out.ok) throw new Error(out.error || '重渲失败')
      if (!out.data.changed) {
        Object.assign(cur, { status: 'SUCCESS', progress: 100, step: '没有改动' })
        return
      }
      Object.assign(cur, {
        status: 'SUCCESS',
        progress: 100,
        step: '已完成',
        output: out.data.video,
        revision: out.data.revision,
        meta: { ...(cur.meta || {}), gate: out.data.gate, revision: out.data.revision },
      })
    } catch (e) {
      Object.assign(cur, { status: 'FAILED', step: '失败', error: String(e.message || e) })
    }
  })()
})

/** 重试：复用原任务的素材重跑（不动分镜参数，只重跑渲染） */
app.post('/api/works/:jobId/retry', async (req, res) => {
  const src = path.join(JOBS, path.basename(req.params.jobId))
  const video = path.join(src, 'source.mp4')
  const audio = path.join(src, 'voice.mp3')
  if (!fs.existsSync(video)) return res.json({ ok: false, error: '原任务的视频已不存在' })

  const jobId = `edit_${Date.now()}`
  const dir = path.join(JOBS, jobId)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(video, path.join(dir, 'source.mp4'))
  const hasAudio = fs.existsSync(audio)
  if (hasAudio) fs.copyFileSync(audio, path.join(dir, 'voice.mp3'))
  // 时间戳是最贵的一步（123 秒音频约 10 分钟），重试直接复用
  const tsFile = path.join(src, 'timestamps.json')
  const hasTs = fs.existsSync(tsFile)
  if (hasTs) fs.copyFileSync(tsFile, path.join(dir, 'timestamps.json'))
  // 口播稿也要带过来，否则对齐会报「口播稿为空」
  let retryScript = ''
  const sj = path.join(src, 'script.json')
  if (fs.existsSync(sj)) {
    try {
      retryScript = (JSON.parse(fs.readFileSync(sj, 'utf8')).sentences || []).join('')
    } catch {}
    fs.copyFileSync(sj, path.join(dir, 'script.json'))
  }

  editTasks.set(jobId, { status: 'PENDING', progress: 0, step: '排队中', output: '', error: '', startedAt: Date.now() })
  res.json({ ok: true, data: { jobId } })

  ;(async () => {
    const t = editTasks.get(jobId)
    try {
      t.status = 'RUNNING'
      const out = await runTalkcraft(
        jobId,
        {
          videoPath: path.join(dir, 'source.mp4'),
          audioPath: hasAudio ? path.join(dir, 'voice.mp3') : '',
          mode: 'shotlist',
          script: retryScript,
        },
        ({ stage, progress }) => {
          Object.assign(t, { progress, step: stage })
        },
      )
      if (!out.ok) throw new Error(out.error || '重试失败')
      Object.assign(t, { status: 'SUCCESS', progress: 100, step: '已完成', output: out.video, meta: out })
    } catch (e) {
      Object.assign(t, { status: 'FAILED', step: '失败', error: String(e.message || e) })
    }
  })()
})

app.post('/api/edit', async (req, res) => {
  const { videoUrl, videoFile, audioFile, options = {} } = req.body || {}
  if (!videoUrl && !videoFile) return res.json({ ok: false, error: '缺少视频（videoFile 或 videoUrl）' })

  const jobId = `edit_${Date.now()}`
  const dir = path.join(JOBS, jobId)
  fs.mkdirSync(dir, { recursive: true })

  editTasks.set(jobId, { status: 'PENDING', progress: 0, step: '排队中', output: '', error: '', startedAt: Date.now() })
  res.json({ ok: true, data: { jobId } })

  /* ---- talkcraft 引擎：8 步规范流水线（语义分镜 + 卡库动效 + 音效 + 机器闸） ---- */
  if (options.engine === 'talkcraft') {
    ;(async () => {
      const t = editTasks.get(jobId)
      try {
        // 先把数字人原片落到 job 目录
        const srcPath = path.join(dir, 'source.mp4')
        if (videoFile) {
          const up = path.join(JOBS, '_uploads', path.basename(String(videoFile)))
          if (!fs.existsSync(up)) throw new Error('上传的视频已失效，请重新上传')
          fs.copyFileSync(up, srcPath)
        } else {
          const r = await fetch(videoUrl)
          if (!r.ok) throw new Error(`下载失败 ${r.status}`)
          fs.writeFileSync(srcPath, Buffer.from(await r.arrayBuffer()))
        }
        // 单独上传的配音（无声视频必须走这条）
        let audioPath = ''
        if (audioFile) {
          const up = path.join(JOBS, '_uploads', path.basename(String(audioFile)))
          if (fs.existsSync(up)) {
            audioPath = path.join(dir, 'voice.mp3')
            fs.copyFileSync(up, audioPath)
          }
        }

        t.status = 'RUNNING'
        const out = await runTalkcraft(jobId, {
          videoPath: srcPath,
          audioPath,
          mode: options.mode || 'shotlist',
          script: options.script || '',
          content: options.content,
          previousVideo: options.previousVideo,
          capStyle: options.capStyle,
          smartPlan: options.smartPlan,
        }, ({ stage, progress }) => {
          t.step = stage
          t.progress = progress
        })

        if (!out.ok) throw new Error(out.error || '后期失败')
        let size = 0
        try {
          size = fs.statSync(path.join(__dirname, out.video.replace(/^\/jobs\//, 'jobs/'))).size
        } catch {
          /* 拿不到就算了，前端会隐藏 */
        }
        Object.assign(t, {
          status: 'SUCCESS',
          progress: 100,
          step: '已完成',
          output: out.video,
          engine: 'talkcraft',
          meta: {
            duration: out.duration,
            shots: out.shots,
            cues: out.cues,
            gate: out.gate,
            width: 1920,
            height: 1080,
            fps: 30,
            size,
            planMode: out.planMode || 'rule',
            planNote: out.planNote || '',
            cards: out.cards || null,
          },
        })
      } catch (e) {
        Object.assign(t, { status: 'FAILED', error: e.message, step: '失败' })
      }
    })()
    return
  }

  // 后台跑，不阻塞响应
  ;(async () => {
    const t = editTasks.get(jobId)
    const upd = (patch) => Object.assign(t, patch)

    try {
      /* 1. 下载数字人原片 */
      upd({ status: 'RUNNING', progress: 8, step: '下载原片' })
      const srcPath = path.join(dir, 'source.mp4')
      const r = await fetch(videoUrl)
      if (!r.ok) throw new Error(`下载失败 ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      fs.writeFileSync(srcPath, buf)

      /* 2. 逐词转写 */
      upd({ progress: 22, step: '逐词转写（faster-whisper）' })
      const tr = await transcribe(srcPath)
      if (!tr.ok) throw new Error(tr.error || '转写失败')
      const words = tr.data.words || []
      if (!words.length) throw new Error('没有识别到语音，无法加字幕')
      fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(tr.data, null, 2))

      /* 3. 生成 ASS 字幕 */
      const layout = options.layout || 'full'
      const pip = layout.startsWith('pip')
      const pos = layout === 'pip-bl' ? 'bl' : 'br'

      upd({ progress: 38, step: pip ? '生成信息卡背景' : '生成字幕时间轴' })

      let bgList = ''
      if (pip) {
        const wordsPath = path.join(dir, 'words.json')
        const cardsOut = path.join(dir, 'bg')
        fs.mkdirSync(cardsOut, { recursive: true })
        const cards = await genCards(wordsPath, cardsOut)
        if (!cards.ok) throw new Error(cards.error || '背景卡生成失败')
        const timeline = JSON.parse(
          fs.readFileSync(path.join(cardsOut, 'cards', 'timeline.json'), 'utf8'),
        )
        bgList = buildBgList(timeline, path.join(cardsOut, 'cards'), path.join(dir, 'bg.txt'))
      }

      upd({ progress: 50, step: '生成字幕时间轴' })
      const capStyle = options.capStyle || 'word'
      const broll = options.broll !== false
      const ass = buildAss(words, capStyle, broll, layout)
      const assPath = path.join(dir, 'sub.ass')
      fs.writeFileSync(assPath, ass, 'utf8')

      // 同时落一份 SRT，方便外部用
      fs.writeFileSync(path.join(dir, 'sub.srt'), toSrt(words), 'utf8')

      /* 4. 渲染 */
      const outPath = path.join(dir, 'final_1080p.mp4')

      if (pip) {
        upd({ progress: 62, step: '合成画中画 / 烧字幕' })
        const maskPath = path.join(dir, 'mask.png')
        const okMask = await makeMask(760, 428, 26, maskPath)
        if (!okMask) throw new Error('圆角遮罩生成失败')

        const ren = await renderPip({
          bgList,
          person: srcPath,
          assPath,
          maskPath,
          outPath,
          pos,
        })
        if (!ren.ok) throw new Error(ren.error || '画中画渲染失败')
      } else {
        upd({ progress: 62, step: '烧字幕 / 渲染 1080p' })
        const ren = await renderVideo({
          input: srcPath,
          assPath,
          outPath,
          targetW: 1920,
          targetH: 1080,
        })
        if (!ren.ok) throw new Error(ren.error || '渲染失败')
      }

      /* 5. 探规格 */
      upd({ progress: 95, step: '校验成片' })
      const spec = await probe(outPath)

      upd({
        status: 'SUCCESS',
        progress: 100,
        step: '完成',
        output: `/jobs/${jobId}/final_1080p.mp4`,
        spec,
        finishedAt: Date.now(),
      })
    } catch (e) {
      upd({ status: 'FAILED', error: String(e.message || e), progress: 0 })
    }
  })()
})

app.get('/api/edit/:jobId', (req, res) => {
  const t = editTasks.get(req.params.jobId)
  if (!t) return res.json({ ok: false, error: '任务不存在' })
  res.json({ ok: true, data: t })
})

/* ---------------- 轨道工作台（TalkCraft Workbench） ----------------
 * 剪映式的多轨时间线编辑器，来自 video-talkcraft 技能自带的 workbench。
 * 我们只做「拉起 + 探活」，编辑和导出都在它自己那边跑。
 */
const WB_DIR = process.env.WB_DIR || path.join(process.env.HOME || '', '.workbuddy/skills/video-talkcraft/workbench')
const WB_PORT = Number(process.env.WB_PORT || 5199)
let wbProc = null

/* 反代：线上用户浏览器里的 127.0.0.1 是他自己电脑，工作台必须挂在主域名下才打得开 */
const wbProxy = makeProxy(WB_PORT)
app.use('/wb', wbProxy)
app.use('/api/pipeline', wbProxy)
app.use('/api/export', wbProxy)
// 工作台的素材文件用的是根路径（Remotion staticFile + 素材库缩略图都写死 /stills/xxx），
// 这些目录只有它用，跟着一起反代；不然预览区和素材库全是空白
for (const p of ['/stills', '/video', '/sfx', '/cardpreviews', '/cardthumbs']) {
  app.use(p, wbProxy)
}

function wbReady() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: WB_PORT, path: '/', timeout: 1200 }, (r) => {
      r.resume()
      resolve(r.statusCode >= 200 && r.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/* ---------------- 分镜口播稿（只出文本，不渲染） ----------------
 * 输入一段口播稿，输出「逐段台词 + 配哪张卡 + 卡上写什么」。
 * 时间轴：有配音就用真实时间戳，没有就按 4.3 字/秒估。
 */
app.get('/api/storyboard/cards', (req, res) => {
  res.json({ ok: true, data: availableCards() })
})

app.post('/api/storyboard', async (req, res) => {
  try {
    const { script, sentences, total } = req.body || {}
    if (!script || !String(script).trim()) return res.json({ ok: false, error: '还没有口播稿' })

    let sents = Array.isArray(sentences) && sentences.length ? sentences : null
    let tot = Number(total) || 0
    if (!sents) {
      const est = estimateSentences(script)
      sents = est.sentences
      tot = est.total
    }
    if (!tot) tot = sents[sents.length - 1]?.end || 0

    const r = await planShotList({ sentences: sents, total: tot, script })
    res.json(r)
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) })
  }
})

app.get('/api/workbench/status', async (req, res) => {
  const ok = fs.existsSync(path.join(WB_DIR, 'package.json'))
  res.json({ ok: true, data: { available: ok, dir: WB_DIR, port: WB_PORT, running: ok ? await wbReady() : false } })
})

app.post('/api/workbench/start', async (req, res) => {
  const r = await startWorkbench()
  res.json(r.ok ? { ok: true, data: { url: r.url, already: r.already } } : { ok: false, error: r.error })
})

/** 把工作台拉起来（幂等）：已在跑就直接返回地址 */
async function startWorkbench() {
  if (!fs.existsSync(path.join(WB_DIR, 'package.json'))) {
    return { ok: false, error: `工作台没装好：${WB_DIR} 里没有 package.json` }
  }
  if (await wbReady()) return { ok: true, url: '/wb/', already: true }

  const vite = path.join(WB_DIR, 'node_modules/vite/bin/vite.js')
  if (!fs.existsSync(vite)) {
    return { ok: false, error: '工作台依赖没装全（缺 node_modules/vite）—— 先在 workbench 目录跑一次 npm install' }
  }

  try {
    wbProc = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(WB_PORT), '--strictPort', '--base=/wb/'], {
      cwd: WB_DIR,
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
    const logPath = path.join(JOBS, 'workbench.log')
    wbProc.stdout.on('data', (d) => fs.appendFileSync(logPath, d))
    wbProc.stderr.on('data', (d) => fs.appendFileSync(logPath, d))
    wbProc.on('exit', () => { wbProc = null })

    // 等它起来（首次 bundle 要几秒）
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 700))
      if (await wbReady()) return { ok: true, url: '/wb/', already: false }
    }
    return { ok: false, error: '工作台启动超时，看 server/jobs/workbench.log' }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

/* 词级 -> SRT（按句） */
function toSrt(words) {
  const lines = []
  let cur = []
  const flush = () => {
    if (cur.length) {
      lines.push(cur)
      cur = []
    }
  }
  const PUNCT = /[。！？!?；;，,、：:]$/
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i])
    const next = words[i + 1]
    const gap = next ? next.s - words[i].e : 99
    const len = cur.reduce((n, x) => n + x.w.length, 0)
    if (PUNCT.test(words[i].w) || gap > 0.55 || len >= 15) flush()
  }
  flush()

  const fmt = (t) => {
    const ms = Math.floor((t % 1) * 1000)
    const total = Math.floor(t)
    const s = total % 60
    const m = Math.floor(total / 60) % 60
    const h = Math.floor(total / 3600)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }

  return lines
    .map((ln, i) => {
      const text = ln.map((w) => w.w).join('')
      return `${i + 1}\n${fmt(ln[0].s)} --> ${fmt(ln[ln.length - 1].e)}\n${text}\n`
    })
    .join('\n')
}

/**
 * 生产模式：托管前端构建产物。
 *
 * 只有 dist 存在才挂，开发时（vite dev server 5180）不受影响。
 * SPA 回退要排除后端前缀，否则 /api/xxx 打错会被返回 index.html，
 * 前端拿到一坨 HTML 去 JSON.parse，报的错会非常难查。
 */
const PROJECT_ROOT = path.join(__dirname, '..')
const DIST = path.join(PROJECT_ROOT, 'dist')
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST, { index: false, maxAge: '7d' }))
  app.get(/^\/(?!api\/|jobs\/|uploads\/|wb\/|events\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
  console.log('[static] 前端构建产物已托管', DIST)
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[workbench-api] http://127.0.0.1:${PORT}`)

  // 启动即预热热榜缓存：用户点「获取今日热榜」时直接命中（bridge 单次要 10 秒）
  setTimeout(() => {
    buildTrendsPayload(300)
      .then((pl) => {
        if (pl) {
          trendsCache = { at: Date.now(), payload: pl }
          console.log(`[warmup] 热榜缓存就绪 ${pl.data.items.length} 条`)
        }
      })
      .catch(() => {})
  }, 800)

  // 轨道工作台跟着后端一起起来：部署时只要起这一个服务，不用另开进程
  setTimeout(() => {
    startWorkbench()
      .then((r) => console.log(r.ok ? `[workbench] 就绪 ${r.url}` : `[workbench] 未启动：${r.error}`))
      .catch(() => {})
  }, 1500)
})

// HMR 的 WebSocket 也要反代（vite 以 /wb/ 为 base，连接路径落在这个前缀下）
attachWsProxy(server, WB_PORT, (req) => {
  const token = auth.parseCookies(req.headers.cookie || '')[auth.COOKIE_NAME]
  return !!auth.verify(token)
})
