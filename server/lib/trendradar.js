import { spawn } from 'node:child_process'
import path from 'node:path'

const WECHAT_ROOT = '/Users/mac/WorkBuddy/微信公众号AI创作平台'
const HOME = path.join(WECHAT_ROOT, 'TrendRadar')
const PYTHON = path.join(HOME, '.venv', 'bin', 'python')
const BRIDGE = path.join(WECHAT_ROOT, 'scripts', 'trendradar-bridge.py')

/**
 * 调 TrendRadar 桥接脚本（stdin 传参，stdout 收 JSON）
 * action: status | latest | search | aggregate | trending | viral | predict | lifecycle | ...
 */
export function runBridge(action, params = {}, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false

    const child = spawn(PYTHON, [BRIDGE, action], {
      cwd: WECHAT_ROOT,
      env: {
        ...process.env,
        TRENDRADAR_HOME: HOME,
        DOCKER_CONTAINER: 'true',
        TZ: 'Asia/Shanghai',
        PYTHONWARNINGS: 'ignore',
      },
    })

    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill('SIGKILL')
      resolve({ ok: false, error: 'TrendRadar 超时' })
    }, timeoutMs)

    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))

    child.on('close', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      // 桥接输出可能是多行（前面有库的 warning），取最后一个 JSON 行
      const lines = out.trim().split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (!line.startsWith('{')) continue
        try {
          resolve(JSON.parse(line))
          return
        } catch {
          /* keep looking */
        }
      }
      resolve({ ok: false, error: '无法解析 TrendRadar 输出', raw: (err || out).slice(-500) })
    })

    child.stdin.write(JSON.stringify(params))
    child.stdin.end()
  })
}

/**
 * 触发一次 TrendRadar 抓取（约 2–4 分钟）。
 * 用于「今日没有数据」时补抓 —— 不用人去终端敲命令。
 */
export function crawlTrends(timeoutMs = 600000) {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, ['-m', 'trendradar'], {
      cwd: HOME,
      env: {
        ...process.env,
        TRENDRADAR_HOME: HOME,
        DOCKER_CONTAINER: 'true',
        TZ: 'Asia/Shanghai',
        PYTHONWARNINGS: 'ignore',
      },
    })
    let out = ''
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { p.kill('SIGKILL') } catch {}
      resolve({ ok: false, error: '抓取超时（10 分钟）' })
    }, timeoutMs)
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (out += d.toString()))
    p.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, error: 'spawn 失败：' + String(e.message || e) })
    })
    p.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: code === 0, code, tail: out.slice(-600) })
    })
  })
}
