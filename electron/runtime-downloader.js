/**
 * 运行环境下载器：把缺失的 runtime 组件从 BEIDOU_RUNTIME_BASE 拉到本地 runtime 根并解压。
 *
 * 依赖系统 tar 解压（mac / win10+ 都自带 tar / tar.exe），不引第三方包。
 * 进度通过 onProgress({key,label,downloaded,total}) 回调推给 UI。
 */
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getComponents } from './runtime-manifest.js'

/** 返回缺失组件列表 */
export function checkRuntime(root) {
  const missing = []
  for (const c of getComponents()) {
    if (!c.check(root)) missing.push(c)
  }
  return missing
}

/** 下载并解压所有缺失组件 */
export async function downloadRuntime(missing, root, base, onProgress) {
  fs.mkdirSync(root, { recursive: true })
  for (const c of missing) {
    await downloadOne(c, root, base, onProgress)
  }
}

function downloadOne(c, root, base, onProgress) {
  return new Promise((resolve, reject) => {
    const baseUrl = base.replace(/\/+$/, '')
    const tmp = path.join(root, `.${c.key}.tar.gz`)
    const dest = c.dest ? c.dest(root) : root
    let done = 0

    const onData = (res) => {
      const total = Number(res.headers['content-length']) || c.size || 0
      const out = fs.createWriteStream(tmp)
      res.on('data', (chunk) => {
        done += chunk.length
        onProgress?.({ key: c.key, label: c.label, downloaded: done, total })
      })
      res.on('error', (e) => reject(e))
      out.on('error', (e) => reject(e))
      out.on('finish', () => {
        try {
          fs.mkdirSync(dest, { recursive: true })
        } catch {}
        extractTar(tmp, dest)
          .then(() => {
            try {
              fs.unlinkSync(tmp)
            } catch {}
            resolve()
          })
          .catch(reject)
      })
      res.pipe(out)
    }

    const get = (urlStr, redirects = 0) => {
      const lib = urlStr.startsWith('https') ? https : http
      const req = lib.get(urlStr, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects > 5) return reject(new Error(`${c.label} 重定向过多`))
          return get(new URL(res.headers.location, urlStr).href, redirects + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`${c.label} 下载失败（HTTP ${res.statusCode}）`))
        }
        onData(res)
      })
      req.on('error', reject)
    }

    get(`${baseUrl}/${c.archive}`)
  })
}

function extractTar(file, root) {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'tar.exe' : 'tar'
    const t = spawn(bin, ['-xzf', file, '-C', root], { windowsHide: true })
    let err = ''
    t.stderr?.on('data', (d) => (err += d))
    t.on('error', reject)
    t.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`解压 ${path.basename(file)} 失败（${err || `code ${code}`}）`))
    )
  })
}
