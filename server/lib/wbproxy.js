import http from 'node:http'
import net from 'node:net'

/**
 * 把工作台（独立 vite dev server）反代到主服务下
 *
 * 为什么必须反代：线上部署时工作台跑在服务器上，浏览器里的 127.0.0.1:5199
 * 指的是用户自己那台电脑，直接开这个地址必然是打不开的。
 *
 * 反代两条：
 *   /wb/*           → 工作台页面与资源（vite 以 --base=/wb/ 启动）
 *   /api/pipeline/* → 实时看板（SSE，要支持流式）
 *   /api/export*    → 导出成片（工作台前端写死了绝对路径）
 *
 * 会话 cookie 不转发给工作台：没必要，工作台自己不做鉴权，门禁在我们这层。
 */

export function makeProxy(port) {
  return (req, res) => {
    const opts = {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: req.originalUrl || req.url,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    }
    delete opts.headers.cookie
    delete opts.headers.authorization

    const up = http.request(opts, (ur) => {
      // SSE 要立刻把 header 吐出去，不能被缓冲
      res.writeHead(ur.statusCode || 502, ur.headers)
      ur.pipe(res)
    })
    up.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      res.end('工作台还没起来，等几秒刷新一下')
    })
    req.pipe(up)
  }
}

/** vite 的 HMR 走 WebSocket，必须单独处理 upgrade */
export function attachWsProxy(server, port, guard) {
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || ''
    if (!url.startsWith('/wb')) return // 不是工作台的连接，交回默认行为
    if (guard && !guard(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    const up = net.connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${url} HTTP/1.1`]
      for (const [k, v] of Object.entries(req.headers)) {
        if (k.toLowerCase() === 'host') continue
        if (k.toLowerCase() === 'cookie') continue
        lines.push(`${k}: ${v}`)
      }
      lines.push(`host: 127.0.0.1:${port}`)
      up.write(lines.join('\r\n') + '\r\n\r\n')
      if (head?.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })
}
