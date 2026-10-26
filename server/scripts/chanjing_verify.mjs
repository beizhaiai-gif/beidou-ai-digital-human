/**
 * 蝉镜接入验收脚本（一次性，跑完 8 步）
 *
 * 用法：node server/scripts/chanjing_verify.mjs
 *
 * 安全：只从环境变量读凭证；不打印 secret_key / access_token；
 *      不打印完整凭证，只回显 app_id（标识）。
 */
import * as cj from '../lib/chanjing.js'

const T0 = Date.now()
const el = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`
const log = (...a) => console.log(...a)
const warn = (...a) => console.warn(...a)

/** 轮询参数（按接入要求固定） */
const TTS = { first: 3000, max: 10000, timeout: 5 * 60 * 1000 }
const VID = { first: 5000, max: 15000, timeout: 20 * 60 * 1000 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function show(tag, r) {
  log(
    `[${tag}] http=${r.http ?? '-'} code=${r.code ?? '-'} trace=${r.trace || '-'} msg=${r.msg || ''}`,
  )
}

async function main() {
  /* ---- 0. 凭证与规范 ---- */
  if (!cj.hasCredentials()) {
    warn('缺少 CHANJING_APP_ID / CHANJING_SECRET_KEY，已停止。请配置后重跑。')
    process.exit(2)
  }
  log(`app_id = ${cj.appId()}（secret 不显示）`)
  log('OpenAPI 规范已核对：字段名取自 chanjing-openapi.yaml')

  /* ---- 0.5 额度检查（不产生费用） ---- */
  const dur = await cj.userDuration()
  if (!dur.ok) {
    show('user_duration', dur)
    warn('额度查询失败，停止（不继续消耗）。')
    const r = await cj.getToken()
    log('token 是否可用:', r.ok ? '是' : '否')
    process.exit(3)
  }
  log(`[user_duration] code=0 trace=${dur.trace} data=${JSON.stringify(dur.data)}`)

  /* ---- 1. token ---- */
  const tk = await cj.getToken()
  if (!tk.ok) {
    warn('取 token 失败:', tk.error, 'trace=', tk.trace)
    process.exit(4)
  }
  log(`[access_token] ok  ttl=${tk.ttl}s  trace=${tk.trace}  (${el()})`)

  /* ---- 2. 选音色 ---- */
  const au = await cj.listCommonAudio(1, 20)
  show('list_common_audio', au)
  if (!au.ok) process.exit(5)
  const audios = au.data?.list || []
  if (!audios.length) {
    warn('公共音色列表为空')
    process.exit(5)
  }
  log(`候选音色 ${audios.length} 个：`)
  for (const a of audios) log(`  - id=${a.id} name=${a.name} lang=${a.language || '-'}`)

  const pickAudio =
    audios.find((a) => /女|男|通用|标准|普通话/.test(a.name || '')) || audios.find((a) => a.name) || audios[0]
  log(`选用音色：${pickAudio.name}（id=${pickAudio.id}）`)

  /* ---- 3. 创建 TTS ---- */
  const TTS_TEXT = '这是一条蝉镜开放平台接入验收语音。'
  const ct = await cj.createAudioTask({ audioMan: pickAudio.id, text: TTS_TEXT, speed: 1 })
  show('create_audio_task', ct)
  if (!ct.ok) process.exit(6)
  const ttsTaskId = ct.data?.task_id
  if (!ttsTaskId) {
    warn('没有拿到 data.task_id')
    process.exit(6)
  }
  log(`TTS 任务: ${ttsTaskId}  (${el()})`)

  /* ---- 4. 轮询 TTS ---- */
  let audio = null
  let ttsLast = null
  let wait = TTS.first
  const ttsEnd = Date.now() + TTS.timeout
  while (Date.now() < ttsEnd) {
    await sleep(wait)
    wait = Math.min(wait * 1.5, TTS.max)
    const st = await cj.audioTaskState(ttsTaskId)
    ttsLast = st
    const d = st.data || {}
    log(
      `  [audio_task_state] code=${st.code} status=${d.status} url=${d.full?.url ? '有' : '无'} trace=${st.trace} (${el()})`,
    )

    if (d.errMsg || d.errReason) {
      warn('TTS 失败，原文报告：')
      warn('  errMsg =', d.errMsg)
      warn('  errReason =', d.errReason)
      warn('  status =', d.status, 'trace =', st.trace)
      process.exit(7)
    }
    if (d.status === 9 && d.full?.url) {
      audio = d.full
      break
    }
  }
  if (!audio) {
    const d = ttsLast?.data || {}
    warn('TTS 轮询超时，最后状态：')
    warn(`  status=${d.status} errMsg=${d.errMsg || '-'} errReason=${d.errReason || '-'} trace=${ttsLast?.trace || '-'}`)
    process.exit(7)
  }
  log(`TTS 完成：duration=${audio.duration}s  (${el()})`)
  log(`音频 URL: ${audio.url}`)

  /* ---- 5. 选数字人 ---- */
  const dp = await cj.listCommonDp(1, 20)
  show('list_common_dp', dp)
  if (!dp.ok) process.exit(8)
  const dps = dp.data?.list || []
  if (!dps.length) {
    warn('公共数字人列表为空')
    process.exit(8)
  }
  log(`候选数字人 ${dps.length} 个：`)
  for (const d of dps) {
    const figs = (d.figures || []).map((f) => `${f.type}(${f.width}x${f.height})`).join(', ')
    log(`  - id=${d.id} name=${d.name} figures=[${figs}]`)
  }

  const pickDp = dps.find((d) => Array.isArray(d.figures) && d.figures.length) || dps[0]
  const fig = (pickDp.figures || [])[0]
  if (!fig) {
    warn('这个数字人没有 figures，无法确定画布尺寸')
    process.exit(8)
  }
  log(`选用数字人：${pickDp.name}（id=${pickDp.id}）形态 type=${fig.type} ${fig.width}x${fig.height}`)

  /* ---- 6. 创建视频 ---- */
  const payload = {
    person: {
      id: pickDp.id,
      figure_type: fig.type,
      width: fig.width,
      height: fig.height,
    },
    audio: { type: 'audio', wav_url: audio.url, volume: 100 },
    screen_width: fig.width,
    screen_height: fig.height,
    model: 1,
    hide_subtitle: false,
  }
  const cv = await cj.createVideo(payload)
  show('create_video', cv)
  if (!cv.ok) {
    warn('创建视频失败，payload 关键字段：', {
      person: payload.person,
      audio: { type: payload.audio.type, wav_url: '（已传本次 TTS URL）' },
      screen: `${payload.screen_width}x${payload.screen_height}`,
    })
    process.exit(9)
  }
  // 规范：data 就是任务 ID 字符串本身
  const videoId = typeof cv.data === 'string' ? cv.data : cv.data?.id
  if (!videoId) {
    warn('create_video 没返回任务 ID，data =', JSON.stringify(cv.data).slice(0, 120))
    process.exit(9)
  }
  log(`视频任务: ${videoId}  (${el()})`)

  /* ---- 7. 轮询视频 ---- */
  let video = null
  let vLast = null
  let vwait = VID.first
  const vEnd = Date.now() + VID.timeout
  while (Date.now() < vEnd) {
    await sleep(vwait)
    vwait = Math.min(vwait * 1.3, VID.max)
    const st = await cj.videoDetail(videoId)
    vLast = st
    const d = st.data || {}
    log(
      `  [video] code=${st.code} queue_status=${d.queue_status} desc=${(d.queue_desc || '').slice(0, 40)} (${el()})`,
    )

    if (d.queue_status === 'failed') {
      warn('视频生成失败，data.msg =', d.msg)
      warn('trace =', st.trace)
      process.exit(10)
    }
    if (d.queue_status === 'other') {
      warn('视频进入 other 状态，停止等待：')
      warn(`  queue_status=${d.queue_status}`)
      warn(`  msg=${d.msg}`)
      warn(`  queue_desc=${d.queue_desc}`)
      warn(`  trace=${st.trace}`)
      process.exit(10)
    }
    if (d.queue_status === 'completed' && d.video_url) {
      video = d
      break
    }
  }
  if (!video) {
    const d = vLast?.data || {}
    warn('视频轮询超时，最后状态：')
    warn(`  queue_status=${d.queue_status} msg=${d.msg || '-'} queue_desc=${d.queue_desc || '-'} trace=${vLast?.trace || '-'}`)
    process.exit(10)
  }
  log(`视频完成 (${el()})`)
  log(`视频 URL: ${video.video_url}`)

  /* ---- 8. 验收 ---- */
  log('\n===== 验收 =====')
  const head = async (u) => {
    try {
      const r = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-1023' } })
      const len = r.headers.get('content-length')
      const cr = r.headers.get('content-range')
      return { status: r.status, len: len || cr || '', ok: r.status === 200 || r.status === 206 }
    } catch (e) {
      return { status: 0, len: '', ok: false, err: String(e.message || e) }
    }
  }
  const aChk = await head(audio.url)
  const vChk = await head(video.video_url)
  log(`① 音频可访问: HTTP ${aChk.status}  Content-Length/Range=${aChk.len}  → ${aChk.ok ? 'PASS' : 'FAIL'}`)
  log(`① 视频可访问: HTTP ${vChk.status}  Content-Length/Range=${vChk.len}  → ${vChk.ok ? 'PASS' : 'FAIL'}`)

  const aDur = Number(audio.duration) || 0
  const vDur = Number(video.duration) || 0
  const diff = Math.abs(vDur - aDur)
  log(`② 音频时长=${aDur}s  视频时长=${vDur}s  差值=${diff.toFixed(2)}s  → ${diff <= 2 ? 'PASS' : 'FAIL'}`)
  log('③ 两个 URL 均非永久存储，请尽快转存')

  log('\n--- 结果 ---')
  log(`token: ok  ttl=${tk.ttl}s`)
  log(`音色: ${pickAudio.name} (${pickAudio.id})`)
  log(`TTS 任务: ${ttsTaskId}`)
  log(`视频任务: ${videoId}`)
  log(`总耗时: ${el()}`)
  log(`音频: ${audio.url}`)
  log(`视频: ${video.video_url}`)
}

main().catch((e) => {
  warn('未捕获异常:', e?.message || e)
  process.exit(99)
})
