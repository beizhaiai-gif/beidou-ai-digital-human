/**
 * 北抖AI数字人 · 桌面端主进程
 *
 * 架构一句话：Electron 只当壳，后端照旧跑 server/index.js。
 *
 * 关键点：起后端时加 ELECTRON_RUN_AS_NODE=1，Electron 自带的 Node 就变成
 * 纯 Node 运行时 —— 后端、以及后端再 spawn 出去的 Remotion 渲染，
 * 全部复用这一份 Node，安装包里不用再塞一份 50MB 的 node 二进制。
 *
 * 数据目录：成片（每条 200MB+）和账号配置不能写在 .app 里（更新会覆盖），
 * 通过 BEIDOU_DATA_ROOT 指到 userData：
 *   mac  ~/Library/Application Support/北抖AI数字人/
 *   win  %APPDATA%/北抖AI数字人/
 */
// electron 的主入口是 CJS（动态导出），ESM 具名导入解析不到，必须 default 导入再拆
import electron from 'electron'
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = electron
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkRuntime, downloadRuntime } from './runtime-downloader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5181
const URL = `http://127.0.0.1:${PORT}`

/** 开发时跑项目根；打包后跑 resources/app */
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..')
const SERVER_ENTRY = path.join(APP_ROOT, 'server', 'index.js')

let win = null
let backend = null
let quitting = false

// userData 目录名跟产品名走，不然会落成 beizhai-workbench，用户找不到自己的成片
app.setName('北抖AI数字人')

/* ---------------- 运行环境准备（首次启动按需下载） ---------------- */

/**
 * 运行环境下载源（末尾不带斜杠）。
 *
 * 打包后是用户双击打开的，不会有环境变量 —— 所以必须内置默认地址，
 * 否则第一次启动就弹「未配置下载地址」直接退出。
 * 支持 BEIDOU_RUNTIME_BASE 覆盖（用于内网镜像 / 灰度验证）。
 */
const RUNTIME_BASE =
  process.env.BEIDOU_RUNTIME_BASE ||
  'https://github.com/beizhaiai-gif/beidou-ai-digital-human/releases/download/runtime-v1'
/** 运行环境落点：跟成片一样放 userData，更新装包不会被覆盖 */
const runtimeRoot = path.join(app.getPath('userData'), 'runtime')

/**
 * 打包态首次启动：检测 ffmpeg / python / 口型模型是否齐全，缺什么下载什么。
 * 开发态（未打包）信任本机 WorkBuddy 运行时，直接跳过，零打扰。
 * onProgress 把下载进度推给前端 bootstrap 页。
 */
async function prepareRuntime(onProgress) {
  if (!app.isPackaged) return
  const missing = checkRuntime(runtimeRoot)
  if (!missing.length) return
  if (!RUNTIME_BASE) {
    dialog.showErrorBox(
      '缺少运行环境',
      '首次使用需要下载数字人运行环境（约 1.6GB），但安装包未配置下载地址。\n\n请使用「完整版」安装包，或联系北北获取下载地址。'
    )
    app.quit()
    throw new Error('runtime base not configured')
  }
  await downloadRuntime(missing, runtimeRoot, RUNTIME_BASE, onProgress)
}

/* ---------------- 后端子进程 ---------------- */

function startBackend() {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1', // Electron 二进制此时按纯 Node 跑
    BEIDOU_DATA_ROOT: app.getPath('userData'),
    NODE_ENV: 'production',
    // 不让它读壳外那些开发机的运行时
    NODE_OPTIONS: '',
  }
  backend = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  backend.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`))
  backend.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`))
  backend.on('exit', (code) => {
    backend = null
    // 没在退出流程里却挂了 = 后端崩了，提示比静默白屏好
    if (!quitting && win && !win.isDestroyed()) {
      dialog.showErrorBox('后台服务退出了', `渲染服务异常退出（code ${code}）。\n重启应用试试，还出问题就把日志发给北北。`)
      app.quit()
    }
  })
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, { timeout: 800 }, (r) => {
      r.resume()
      resolve(r.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitBackend(tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await ping()) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: '北抖AI数字人',
    backgroundColor: '#f4f5fa',
    // 用户素材在本地，别让浏览器安全策略把 file:// 图片全拦了
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 打开外链走系统浏览器，不把工作台窗口拐跑
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  // 打包态先显示「环境准备」页，runtime 就绪后再切到工作台
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'bootstrap.html'))
  } else {
    win.loadURL(URL)
  }

  win.on('closed', () => (win = null))
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [{ role: 'close' }])] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---------------- 原生文件选择 ---------------- */

const KINDS = {
  video: {
    filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm'] }],
    title: '选择数字人原片',
  },
  audio: {
    filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac'] }],
    title: '选择配音文件',
  },
}

ipcMain.handle('pick-file', async (_e, kind) => {
  const def = KINDS[kind] || KINDS.video
  const r = await dialog.showOpenDialog(win, {
    title: def.title,
    filters: def.filters,
    properties: ['openFile'],
  })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})

/* ---------------- 生命周期 ---------------- */

if (!app.requestSingleInstanceLock()) {
  // 第二个实例直接退出，让第一个把窗口带到前台
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    buildMenu()
    if (app.isPackaged) {
      createWindow()
      try {
        await prepareRuntime((p) => {
          if (win && !win.isDestroyed()) win.webContents.send('runtime-progress', p)
        })
      } catch (e) {
        // 缺下载地址时上面已经弹过框了，这里只处理"真的下载失败"
        if (String(e?.message) !== 'runtime base not configured') {
          dialog.showErrorBox('运行环境下载失败', `${e?.message || e}\n\n请检查网络后重启应用，或联系北北。`)
        }
        app.quit()
        return
      }
    }
    startBackend()
    const ok = await waitBackend()
    if (!ok) {
      dialog.showErrorBox('启动失败', '后台服务 20 秒内没有就绪。\n大概率是端口 5181 被占了 —— 重启电脑，或关掉占用它的进程。')
      app.quit()
      return
    }
    if (app.isPackaged) {
      if (win && !win.isDestroyed()) win.loadURL(URL)
    } else {
      createWindow()
    }

    app.on('activate', () => {
      // mac 关窗口不退应用，点 Dock 图标要能再开一个窗
      if (!BrowserWindow.getAllWindows().length) createWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
    if (backend) {
      try {
        backend.kill()
      } catch {}
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// 打包漏了后端代码时，这里直接报清楚，比等端口超时好查
if (!fs.existsSync(SERVER_ENTRY)) {
  app.whenReady().then(() => {
    dialog.showErrorBox('安装包不完整', `找不到后端入口：\n${SERVER_ENTRY}\n重新下载安装包。`)
    app.quit()
  })
}
