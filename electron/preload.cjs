/**
 * 渲染进程桥（.cjs：sandbox 模式下 preload 只认 CJS）：只暴露最小的能力面，不放开 nodeIntegration。
 * 前端用 window.__ELECTRON__ 判断「跑在桌面端里」，走本地文件直读。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__ELECTRON__', {
  desktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
  pickFile: (kind) => ipcRenderer.invoke('pick-file', kind),
  // 首次启动下载运行环境时，主进程通过这个通道推进度给 bootstrap 页
  onRuntimeProgress: (cb) => ipcRenderer.on('runtime-progress', (_e, p) => cb(p)),
})
