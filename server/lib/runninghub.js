import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getService } from './services.js'

const RH = 'https://www.runninghub.cn'
const LEGACY_KEY_PATH = path.join(os.homedir(), '.workbuddy', 'runninghub.key')
const APP_ID = '2091910069079339009' // x 单人口播

/**
 * key 来源优先级：设置面板 → 老的 ~/.workbuddy/runninghub.key
 * 老文件只在设置里没填时兜底，迁移完可以不管它。
 */
export function getKey() {
  const fromSettings = getService('runninghub')?.apiKey
  if (fromSettings) return fromSettings
  try {
    return fs.readFileSync(LEGACY_KEY_PATH, 'utf8').trim()
  } catch {
    return null
  }
}

/** 上传本地文件，返回 RunningHub 的 fileName */
export async function uploadFile(filePath) {
  const key = getKey()
  if (!key) throw new Error('缺少 runninghub.key')

  const buf = fs.readFileSync(filePath)
  const name = path.basename(filePath)
  const form = new FormData()
  form.append('file', new Blob([buf]), name)

  const res = await fetch(`${RH}/openapi/v2/media/upload/binary`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  const data = await res.json()
  if (data?.code !== 0) throw new Error(`上传失败: ${JSON.stringify(data).slice(0, 200)}`)
  return data.data.fileName
}

/** 提交数字人任务 */
export async function submitAvatar({ imageName, audioName, maxEdge = '1280', prompt }) {
  const key = getKey()
  if (!key) throw new Error('缺少 runninghub.key')

  const nodes = [
    { nodeId: '356', fieldName: 'image', fieldValue: imageName },
    { nodeId: '359', fieldName: 'audio', fieldValue: audioName },
    { nodeId: '351', fieldName: 'value', fieldValue: String(maxEdge) },
    {
      nodeId: '355',
      fieldName: 'positive_prompt',
      fieldValue: prompt || '面带微笑，眼神专注自信地说话，手臂动作自然，固定镜头，主播看向镜头位置',
    },
  ]

  const res = await fetch(`${RH}/openapi/v2/run/ai-app/${APP_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      nodeInfoList: nodes,
      instanceType: 'default',
      usePersonalQueue: false,
    }),
  })
  const data = await res.json()
  const taskId = data?.taskId || data?.data?.taskId
  if (!taskId) throw new Error(`提交失败: ${JSON.stringify(data).slice(0, 300)}`)
  return taskId
}

/** 查询任务状态 */
export async function queryTask(taskId) {
  const key = getKey()
  if (!key) throw new Error('缺少 runninghub.key')

  const res = await fetch(`${RH}/openapi/v2/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ taskId }),
  })
  return res.json()
}
