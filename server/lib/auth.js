import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 管理员账号 + 会话（部署线上基线）
 *
 * 设计取舍：
 * - 密码只存 scrypt 派生值，永不存明文、永不下发前端
 * - 会话表落盘（server/config/sessions.json），服务重启不掉登录
 * - Cookie 用 HttpOnly + SameSite=Lax，线上强制 Secure（靠 x-forwarded-proto 判断）
 * - 登录失败按 IP 限流：5 次 / 5 分钟，防爆破
 * - admin.json 缺失 = 系统未初始化，此时所有 /api 直接拒绝（不会裸奔）
 */

import { dataDir } from './env.js'
const CONFIG_DIR = dataDir('config', path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const ADMIN_FILE = path.join(CONFIG_DIR, 'admin.json')
const SESS_FILE = path.join(CONFIG_DIR, 'sessions.json')

const SESSION_TTL = 7 * 24 * 3600 * 1000 // 7 天
const COOKIE = 'bh_sess'

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
}

/* ---------------- 密码 ---------------- */

const scryptHex = (password, salt) =>
  crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex')

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return { algo: 'scrypt-n16384', salt, hash: scryptHex(password, salt) }
}

function sameHash(a, b) {
  const ba = Buffer.from(String(a), 'hex')
  const bb = Buffer.from(String(b), 'hex')
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

/* ---------------- 账号 ---------------- */

export function readAdmin() {
  try {
    const d = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'))
    return d && d.username && d.hash ? d : null
  } catch {
    return null
  }
}

export function saveAdmin({ username, password }) {
  if (!username || !password) throw new Error('账号和密码都要填')
  if (String(password).length < 6) throw new Error('密码至少 6 位')
  ensureDir()
  const { algo, salt, hash } = hashPassword(password)
  const rec = { username: String(username).trim(), algo, salt, hash, updatedAt: Date.now() }
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(rec, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(ADMIN_FILE, 0o600)
  } catch {}
  // 改密码 = 全部会话作废
  writeSessions({})
  return { username: rec.username }
}

/* ---------------- 会话 ---------------- */

let sessions = null

function loadSessions() {
  if (sessions) return sessions
  try {
    const d = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8'))
    sessions = d && typeof d === 'object' ? d : {}
  } catch {
    sessions = {}
  }
  // 清过期
  const now = Date.now()
  for (const [k, v] of Object.entries(sessions)) {
    if (!v || now - v.at > SESSION_TTL) delete sessions[k]
  }
  return sessions
}

function writeSessions(next) {
  ensureDir()
  sessions = next
  try {
    fs.writeFileSync(SESS_FILE, JSON.stringify(sessions, null, 2), { mode: 0o600 })
    fs.chmodSync(SESS_FILE, 0o600)
  } catch {}
}

// 登录失败限流：ip → { n, until }
const fails = new Map()

function tooMany(ip) {
  const f = fails.get(ip)
  if (!f) return false
  if (Date.now() > f.until) {
    fails.delete(ip)
    return false
  }
  return f.n >= 5
}

function noteFail(ip) {
  const now = Date.now()
  const f = fails.get(ip) || { n: 0, until: 0 }
  if (now > f.until) {
    f.n = 0
    f.until = now + 5 * 60 * 1000
  }
  f.n += 1
  fails.set(ip, f)
}

/** 校验账号密码 → 成功返回 token */
export function login(username, password, ip = '') {
  const admin = readAdmin()
  if (!admin) return { ok: false, code: 'NOT_INIT', error: '系统还没设置管理员账号，先在服务器上跑一次 set_admin' }
  if (tooMany(ip)) return { ok: false, code: 'LOCKED', error: '输错太多次，等 5 分钟再试' }

  const okUser = String(username || '').trim() === admin.username
  const okPass = sameHash(scryptHex(password || '', admin.salt), admin.hash)
  if (!okUser || !okPass) {
    noteFail(ip)
    return { ok: false, code: 'BAD', error: '账号或密码不对' }
  }

  fails.delete(ip)
  const token = crypto.randomBytes(32).toString('hex')
  const all = loadSessions()
  all[token] = { user: admin.username, at: Date.now(), ip: String(ip || '').slice(0, 60) }
  writeSessions(all)
  return { ok: true, token, user: { name: admin.username } }
}

export function verify(token) {
  if (!token) return null
  const all = loadSessions()
  const s = all[token]
  if (!s) return null
  if (Date.now() - s.at > SESSION_TTL) {
    delete all[token]
    writeSessions(all)
    return null
  }
  // 滑动续期：用一次延一天，别让人干活干到一半掉线
  s.at = Date.now()
  return { user: s.user }
}

export function logout(token) {
  if (!token) return
  const all = loadSessions()
  if (all[token]) {
    delete all[token]
    writeSessions(all)
  }
}

/* ---------------- cookie ---------------- */

export const COOKIE_NAME = COOKIE

export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

/** 线上（https）必须带 Secure，否则 cookie 在明文链路上可被截获 */
export function isSecureReq(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  if (proto) return proto === 'https'
  return !!req.secure
}

export function setSessionCookie(req, res, token) {
  const bits = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL / 1000)}`,
  ]
  if (isSecureReq(req)) bits.push('Secure')
  res.setHeader('Set-Cookie', bits.join('; '))
}

export function clearSessionCookie(req, res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (isSecureReq(req)) bits.push('Secure')
  res.setHeader('Set-Cookie', bits.join('; '))
}

/* ---------------- 中间件 ---------------- */

/** 不需要登录的路径（登录本身、探活、前端首屏判断、首次建号） */
const OPEN = [
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/me$/,
  /^\/api\/auth\/status$/,
  /^\/api\/auth\/init$/, // 只在「还没有管理员」时才真正做事，见 index.js 里的二次校验
  /^\/api\/health$/,
]

export function authGuard(req, res, next) {
  const url = (req.path || req.url || '').split('?')[0]
  if (OPEN.some((re) => re.test(url))) return next()

  // 只保护 API 和用户产物；前端静态资源不拦（不然登录页自己都加载不出来）
  const guarded =
    url.startsWith('/api/') ||
    url.startsWith('/jobs/') ||
    url.startsWith('/uploads/') ||
    url.startsWith('/wb') || // 轨道工作台（反代进来的）
    // 工作台素材目录（同样是反代进去的）
    ['/stills/', '/video/', '/sfx/', '/cardpreviews/', '/cardthumbs/'].some((p) => url.startsWith(p))
  if (!guarded) return next()

  const token = parseCookies(req.headers.cookie || '')[COOKIE]
  const s = verify(token)
  if (!s) {
    return res.status(401).json({ ok: false, code: 'UNAUTH', error: '请先登录' })
  }
  req.user = s
  next()
}

export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return xff || req.socket?.remoteAddress || ''
}

export function status() {
  const a = readAdmin()
  return { initialized: !!a, username: a?.username || '', sessions: Object.keys(loadSessions()).length }
}
