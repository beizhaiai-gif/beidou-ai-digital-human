/**
 * 视频 → 口播文案
 *
 * 线上部署不能依赖本机模型，所以优先走云端语音识别：
 *   ① 火山录音文件识别（volcAsr）—— 需要控制台单独开通，只开 TTS 会报 resource not granted
 *   ② 硅基流动 SenseVoice（sfAsr）—— 注册即用，国内直连，按量计费极便宜
 *   ③ 本地 faster-whisper —— 只在两种都没配时兜底（开发机用）
 *
 * TikHub 本身没有口播提取接口（1050 个路径全量查过，只有 YouTube / B 站有字幕）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getService } from './services.js'
import { PY_BIN, FFMPEG_BIN } from './env.js'

// 坑：import.meta.url 的 pathname 会把中文目录编码成 %E6%95%B0…，必须过 fileURLToPath
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PY = PY_BIN
const FFMPEG = FFMPEG_BIN
const ASR_PY = path.join(HERE, '..', 'scripts', 'asr.py')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** 当前用哪个通道：方舟（免费额度）> 火山 auc > 硅基流动 > 本地 */
export function asrProvider() {
  if (getService('arkAsr')?.apiKey) return 'ark'
  if (getService('volcAsr')?.apiKey) return 'volc'
  if (getService('sfAsr')?.apiKey) return 'siliconflow'
  return 'local'
}

function run(cmd, args, timeout = 180000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL')
      } catch {}
    }, timeout)
    p.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out, err: String(e.message || e) })
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

async function download(url, dest) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 90000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 20000) throw new Error('下载到的文件太小，可能被拦了')
    if (buf.length > 80 * 1024 * 1024) throw new Error('视频超过 80MB，太大了')
    fs.writeFileSync(dest, buf)
    return buf.length
  } finally {
    clearTimeout(timer)
  }
}

/** 抽音轨（云端 ASR 都吃 16k 单声道，mp3 体积小；本地 whisper 用 wav） */
async function toAudio(input, out, codec) {
  const r = await run(
    FFMPEG,
    ['-y', '-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', ...codec, out],
    120000,
  )
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`抽音轨失败：${(r.err || '').slice(-160)}`)
  return out
}

/* ---------------- 方舟音频理解（OpenAI 兼容 chat，每月免费 20 小时） ---------------- */

async function arkAsr(audioBuf, cfg) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120000)
  try {
    const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model || 'doubao-seed-2-1-lite-260915',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'input_audio', input_audio: { data: audioBuf.toString('base64'), format: 'mp3' } },
              {
                type: 'text',
                text: '把这段音频里说的话完整转录成中文文字，保留正常的标点符号（逗号、句号）。只输出转录结果，不要解释。',
              },
            ],
          },
        ],
        temperature: 0.1,
        // 关掉思考：这段音频实测 2061 token → 197 token，省 90%，免费额度更耐用
        thinking: { type: 'disabled' },
      }),
      signal: ctrl.signal,
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = (d && d.error && d.error.message) || `HTTP ${res.status}`
      if (/api key/i.test(msg)) return { ok: false, error: '方舟 API Key 不对（要用 Bearer 那个，不是 X-Api-Key）' }
      if (/model/i.test(msg) && /not found|invalid/i.test(msg)) {
        return { ok: false, error: `模型 ID 不可用：${msg}` }
      }
      return { ok: false, error: `方舟识别失败：${String(msg).slice(0, 160)}` }
    }
    const text = ((d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim()
    if (!text) return { ok: false, error: '方舟没返回文字（可能是纯音乐或模型不支持音频）' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '方舟识别超时' : String(e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- 火山录音文件识别（异步 submit / query） ---------------- */

async function volcAsr(audioBuf, cfg) {
  const rid = crypto.randomUUID()
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': cfg.apiKey,
    'X-Api-Resource-Id': cfg.resourceId || 'volc.bigasr.auc',
    'X-Api-Request-Id': rid,
    'X-Api-Sequence': '-1',
  }

  const submit = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user: { uid: 'beizhai-workbench' },
      audio: { format: 'mp3', data: audioBuf.toString('base64') },
      request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
    }),
  })

  const code = submit.headers.get('X-Api-Status-Code') || ''
  if (code !== '20000000') {
    const msg = submit.headers.get('X-Api-Message') || `HTTP ${submit.status}`
    if (/not granted/i.test(msg)) {
      return {
        ok: false,
        error: '火山这个 Key 没开通「录音文件识别」—— 去控制台开通一下（只开语音合成不行）',
      }
    }
    return { ok: false, error: `火山识别提交失败：${msg}` }
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const q = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/query', {
      method: 'POST',
      headers: { ...headers, 'X-Api-Request-Id': rid },
      body: '{}',
    })
    let d = null
    try {
      d = JSON.parse(await q.text())
    } catch {
      continue
    }
    const result = d && d.result
    if (result) {
      const utts = result.utterances || []
      const merged = utts.length ? utts.map((u) => u.text).join('') : result.text || ''
      if (merged.trim()) return { ok: true, text: merged.trim() }
    }
    if (d && d.message && /fail|error/i.test(d.message)) return { ok: false, error: d.message }
  }
  return { ok: false, error: '火山识别超时' }
}

/* ---------------- 硅基流动 SenseVoice ---------------- */

async function siliconAsr(audioBuf, cfg) {
  const form = new FormData()
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'a.mp3')
  form.append('model', cfg.model || 'FunAudioLLM/SenseVoiceSmall')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: ctrl.signal,
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = (d && (d.message || d.error)) || `HTTP ${res.status}`
      return { ok: false, error: `硅基流动识别失败：${msg}` }
    }
    const text = ((d && d.text) || '').trim()
    if (!text) return { ok: false, error: '没识别出人声（可能是纯音乐）' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '硅基流动识别超时' : String(e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- 本地 whisper（兜底） ---------------- */

async function localAsr(wavPath) {
  const r = await run(PY, [ASR_PY, wavPath], 240000)
  const line = r.out.trim().split('\n').filter(Boolean).pop()
  if (!line) return { ok: false, error: `本地识别没输出：${(r.err || '').slice(-160)}` }
  let d
  try {
    d = JSON.parse(line)
  } catch {
    return { ok: false, error: '本地识别结果不是 JSON' }
  }
  if (!d.ok) return { ok: false, error: d.error || '本地识别失败' }
  if (!d.text || d.text.length < 4) return { ok: false, error: '这条视频几乎没有人声' }
  return { ok: true, text: d.text, seconds: d.seconds }
}

/* ---------------- 对外 ---------------- */

export async function transcribeVideo(videoUrl) {
  if (!videoUrl) return { ok: false, error: '没有可用的播放地址' }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-asr-'))
  const mp4 = path.join(tmp, 'v.mp4')
  const mp3 = path.join(tmp, 'a.mp3')
  const wav = path.join(tmp, 'a.wav')
  const t0 = Date.now()

  try {
    await download(videoUrl, mp4)
    const provider = asrProvider()

    if (provider !== 'local') {
      await toAudio(mp4, mp3, ['-b:a', '48k'])
      const buf = fs.readFileSync(mp3)
      let r
      if (provider === 'ark') r = await arkAsr(buf, getService('arkAsr') || {})
      else if (provider === 'volc') r = await volcAsr(buf, getService('volcAsr') || {})
      else r = await siliconAsr(buf, getService('sfAsr') || {})
      return r.ok ? { ok: true, text: r.text, provider, ms: Date.now() - t0 } : { ok: false, error: r.error, provider }
    }

    await toAudio(mp4, wav, ['-c:a', 'pcm_s16le'])
    const r = await localAsr(wav)
    return r.ok ? { ok: true, text: r.text, provider: 'local', ms: Date.now() - t0 } : r
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {}
  }
}
