import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PY_BIN, FFMPEG_BIN, FFPROBE_BIN } from './env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PY = PY_BIN
const FFMPEG = FFMPEG_BIN
const FFPROBE = FFPROBE_BIN
const TRANSCRIBE = path.join(__dirname, '..', 'scripts', 'transcribe.py')

/* ---------------- whisper 逐词转写 ---------------- */
export function transcribe(mediaPath) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const p = spawn(PY, [TRANSCRIBE, mediaPath, 'small'])
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', () => {
      try {
        const line = out.trim().split('\n').filter(Boolean).pop()
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, error: `转写失败: ${(err || out).slice(-300)}` })
      }
    })
  })
}

/* ---------------- 时间格式化 ---------------- */
function assTime(t) {
  const cs = Math.floor((t % 1) * 100)
  const total = Math.floor(t)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/* ---------------- 断句：按标点 + 停顿 ---------------- */
const PUNCT = /[。！？!?；;，,、：:]$/

function splitLines(words) {
  const lines = []
  let cur = []

  const flush = () => {
    if (cur.length) {
      lines.push(cur)
      cur = []
    }
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    cur.push(w)
    const next = words[i + 1]
    const gap = next ? next.s - w.e : 99
    const textLen = cur.reduce((n, x) => n + x.w.length, 0)

    if (PUNCT.test(w.w) || gap > 0.55 || textLen >= 15) flush()
  }
  flush()
  return lines
}

/* ---------------- 生成 ASS 字幕 ---------------- */
const HEAD = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,PingFang SC,62,&H00FFFFFF,&H000000FF,&H00141414,&H82000000,-1,0,0,0,100,100,1,0,1,3.2,1.6,2,80,80,86,1
Style: CapBold,PingFang SC,74,&H00FFFFFF,&H000000FF,&H00101010,&H96000000,-1,0,0,0,100,100,1,0,1,4.2,2,2,70,70,80,1
Style: Key,PingFang SC,58,&H002ED6FF,&H000000FF,&H00101218,&H6E000000,-1,0,0,0,100,100,2,0,1,3,1.4,8,80,80,140,1
Style: CapPip,PingFang SC,52,&H00FFFFFF,&H000000FF,&H00141414,&H82000000,-1,0,0,0,100,100,0.5,0,1,2.8,1.4,1,110,110,84,1
Style: KeyPip,PingFang SC,54,&H002ED6FF,&H000000FF,&H00101218,&H6E000000,-1,0,0,0,100,100,1.5,0,1,2.8,1.4,8,80,80,150,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

const C_HI = '\\c&H002ED6FF&' // 橙黄（BGR）
const C_DIM = '\\c&H00A8A8A8&'
const C_WHITE = '\\c&H00FFFFFF&'

/**
 * 生成 ASS
 * @param words 词级时间戳
 * @param style word | line | bold
 * @param broll 是否生成关键词强调卡
 */
export function buildAss(words, style = 'word', broll = false, layout = 'full') {
  const lines = splitLines(words)
  const events = []
  const pip = layout === 'pip'
  const capName = pip ? 'CapPip' : style === 'bold' ? 'CapBold' : 'Cap'
  const keyName = pip ? 'KeyPip' : 'Key'

  for (const line of lines) {
    const text = line.map((w) => w.w).join('')
    const start = line[0].s
    const end = line[line.length - 1].e

    if (style === 'word') {
      // 句首到第一个词：全句灰显
      if (line[0].s > 0.02) {
        const preStart = Math.max(0, start - 0.001)
        events.push(`Dialogue: 0,${assTime(preStart)},${assTime(start)},${capName},,0,0,0,,{${C_DIM}}${text}`)
      }
      // 逐词高亮
      for (let i = 0; i < line.length; i++) {
        const cur = line[i]
        const before = line.slice(0, i).map((x) => x.w).join('')
        const now = cur.w
        const after = line.slice(i + 1).map((x) => x.w).join('')
        const body = `${before}{${C_WHITE}}${now}{${C_HI}}${after}`
        const t1 = assTime(cur.s)
        const t2 = assTime(i === line.length - 1 ? Math.max(cur.e, end) : line[i + 1].s)
        events.push(`Dialogue: 1,${t1},${t2},${capName},,0,0,0,,${body}`)
      }
    } else {
      const body = style === 'bold' ? `{\\fscx105\\fscy105}${text}` : text
      events.push(`Dialogue: 0,${assTime(start)},${assTime(Math.max(end, start + 0.6))},${capName},,0,0,0,,${body}`)
    }
  }

  // 关键词强调卡：含数字的短句在画面上方弹一条
  if (broll) {
    for (const line of lines) {
      const text = line.map((w) => w.w).join('')
      if (!/\d|[零一二三四五六七八九十百千万亿]{2,}/.test(text)) continue
      if (text.length > 16) continue
      const start = line[0].s
      const end = line[line.length - 1].e
      if (end - start < 0.5) continue
      events.push(`Dialogue: 2,${assTime(start)},${assTime(end)},${keyName},,0,0,0,,${text}`)
    }
  }

  return HEAD + events.join('\n') + '\n'
}

/* ---------------- 探规格 ---------------- */
export function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate',
      '-show_entries', 'format=duration,size',
      '-of', 'json',
      file,
    ])
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('close', () => {
      try {
        const j = JSON.parse(out)
        const s = j.streams?.[0] || {}
        const f = j.format || {}
        const [num, den] = (s.r_frame_rate || '24/1').split('/').map(Number)
        resolve({
          width: s.width,
          height: s.height,
          fps: den ? Math.round(num / den) : 24,
          duration: Number(f.duration) || 0,
          size: Number(f.size) || 0,
        })
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * 烧字幕 + 放大到 1080p
 * @returns {Promise<{ok:boolean, out?:string, error?:string}>}
 */
export function renderVideo({ input, assPath, outPath, targetW = 1920, targetH = 1080 }) {
  return new Promise((resolve) => {
    const vf = [
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `subtitles='${assPath}'`,
    ].join(',')

    const p = spawn(FFMPEG, [
      '-y', '-v', 'error',
      '-i', input,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outPath,
    ])

    let err = ''
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve({ ok: true, out: outPath })
      else resolve({ ok: false, error: (err || `ffmpeg exit ${code}`).slice(-500) })
    })
  })
}

/* ---------------- 画中画版式：卡片背景 + 人物缩角 ---------------- */

/** 生成圆角遮罩 */
export function makeMask(w, h, r, outPath) {
  return new Promise((resolve) => {
    const p = spawn(PY, [path.join(__dirname, '..', 'scripts', 'gen_mask.py'), String(w), String(h), String(r), outPath])
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(outPath)))
  })
}

/** 按 timeline 生成背景 concat 清单 */
export function buildBgList(timeline, cardsDir, listPath) {
  const lines = []
  for (const it of timeline) {
    const dur = Math.max(0.4, it.end - it.start)
    lines.push(`file '${path.join(cardsDir, it.img)}'`)
    lines.push(`duration ${dur.toFixed(3)}`)
  }
  if (timeline.length) {
    lines.push(`file '${path.join(cardsDir, timeline[timeline.length - 1].img)}'`)
  }
  fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf8')
  return listPath
}

/** 生成信息卡背景（调 python） */
export function genCards(wordsPath, outDir) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const p = spawn(PY, [path.join(__dirname, '..', 'scripts', 'gen_bg_cards.py'), wordsPath, outDir])
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', () => {
      try {
        const line = out.trim().split('\n').filter(Boolean).pop()
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, error: (err || out).slice(-400) })
      }
    })
  })
}

/**
 * 画中画合成：背景卡片 + 人物缩到角落（圆角）+ 字幕
 * @param pos 'br' 右下 | 'bl' 左下
 */
export function renderPip({ bgList, person, assPath, maskPath, outPath, pos = 'br', pw = 760, ph = 428, margin = 72 }) {
  return new Promise((resolve) => {
    const overlayPos = pos === 'bl' ? `${margin}:H-h-${margin}` : `W-w-${margin}:H-h-${margin}`
    const fc = [
      `[0:v]scale=1920:1080,fps=24[bg]`,
      `[1:v]scale=${pw}:${ph}:force_original_aspect_ratio=decrease,pad=${pw}:${ph}:(ow-iw)/2:(oh-ih)/2:color=black,fps=24,format=rgba[p]`,
      `[2:v]format=gray,scale=${pw}:${ph}[m]`,
      `[p][m]alphamerge[pa]`,
      `[bg][pa]overlay=${overlayPos}:shortest=1,subtitles='${assPath}'[v]`,
    ].join(';')

    const p = spawn(FFMPEG, [
      '-y', '-v', 'error',
      '-f', 'concat', '-safe', '0', '-i', bgList,
      '-i', person,
      '-loop', '1', '-i', maskPath,
      '-filter_complex', fc,
      '-map', '[v]', '-map', '1:a',
      '-shortest',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outPath,
    ])

    let err = ''
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve({ ok: true, out: outPath })
      else resolve({ ok: false, error: (err || `ffmpeg exit ${code}`).slice(-600) })
    })
  })
}
