import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PY_BIN, FFMPEG_BIN } from './env.js'

const PY = PY_BIN
const FFMPEG = FFMPEG_BIN

const VOICES = {
  v1: { voice: 'zh-CN-YunxiNeural', label: '云希 · 男声（默认）' },
  v2: { voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声' },
  v3: { voice: 'zh-CN-YunjianNeural', label: '云健 · 男声浑厚' },
  v4: { voice: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声甜' },
}

/** 用 edge-tts 把稿子合成 wav（24k 单声道，喂给口型模型最稳） */
export function tts(text, outWav, voiceKey = 'v1') {
  return new Promise((resolve) => {
    const v = VOICES[voiceKey] || VOICES.v1
    const mp3 = outWav.replace(/\.wav$/, '.mp3')

    const ttsProc = spawn(PY, ['-m', 'edge_tts', '--voice', v.voice, '--text', text, '--write-media', mp3])
    let err = ''
    ttsProc.stderr.on('data', (d) => (err += d.toString()))

    ttsProc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(mp3)) {
        resolve({ ok: false, error: `TTS 失败: ${err.slice(-300)}` })
        return
      }
      // 转 24k 单声道 wav
      const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-i', mp3, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', outWav])
      let ferr = ''
      ff.stderr.on('data', (d) => (ferr += d.toString()))
      ff.on('close', (fcode) => {
        if (fcode !== 0 || !fs.existsSync(outWav)) {
          resolve({ ok: false, error: `转码失败: ${ferr.slice(-300)}` })
          return
        }
        resolve({ ok: true, data: { wav: outWav, mp3, voice: v.label } })
      })
    })
  })
}

/** 读音频时长（秒） */
export function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('/Users/mac/.workbuddy/bin/ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ])
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('close', () => resolve(Number(out.trim()) || 0))
  })
}

/** 估算时长（中文口播 4.3 字/秒，实测值，见 xuehui.CHARS_PER_SEC） */
export function estimateSeconds(text) {
  const chars = text.replace(/\s/g, '').length
  return Math.round(chars / 4.3)
}
