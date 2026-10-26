import '../lib/env.js'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {getService} from '../lib/services.js'

/** 本地音频直接走方舟转录（transcribeVideo 要 URL 会重复下载） */
const FILE = process.argv[2]
if (!FILE || !fs.existsSync(FILE)) {
  console.error('用法: node asr_local.mjs <音频文件>')
  process.exit(1)
}

const FFMPEG = path.join(process.env.HOME, '.workbuddy/bin/ffmpeg')
const tmp = path.join('/tmp', `asr-${Date.now()}.mp3`)
// 压到 16k 单声道 48k：2.9MB → 约 700KB，省一个数量级的 token
spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', FILE, '-ac', '1', '-ar', '16000', '-b:a', '48k', tmp])
const buf = fs.readFileSync(tmp)
const cfg = getService('arkAsr') || {}
console.log(`音频 ${(buf.length / 1024).toFixed(0)} KB，model=${cfg.model || '默认'}`)

const t0 = Date.now()
const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
  method: 'POST',
  headers: {Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json'},
  body: JSON.stringify({
    model: cfg.model || 'doubao-seed-2-1-lite-260915',
    messages: [
      {
        role: 'user',
        content: [
          {type: 'input_audio', input_audio: {data: buf.toString('base64'), format: 'mp3'}},
          {
            type: 'text',
            text: '把这段音频里说的话完整转录成中文文字，保留正常的标点（逗号、句号、问号）。只输出转录结果，不要解释，不要分段标题。',
          },
        ],
      },
    ],
    temperature: 0.1,
    thinking: {type: 'disabled'},
  }),
})

const d = await res.json().catch(() => null)
if (!res.ok) {
  console.error('失败', res.status, JSON.stringify(d).slice(0, 400))
  process.exit(1)
}
const text = (d?.choices?.[0]?.message?.content || '').trim()
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，${text.length} 字\n`)
console.log(text)
fs.writeFileSync(process.argv[3] || '/tmp/asr-text.txt', text)
fs.unlinkSync(tmp)
