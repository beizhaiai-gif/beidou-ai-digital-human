import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

/**
 * 全局 401 拦截（线上部署基线）
 *
 * 各个组件里散落着原生 fetch，一个个加判断不现实。
 * 这里包一层：任何接口回 401 且不是登录相关请求 → 派事件让 App 回登录页。
 * 登录页自己发的 /api/auth/ 请求不拦（否则登录失败会把自己踢出去）。
 */
const origFetch = window.fetch.bind(window)
window.fetch = async (...args) => {
  const res = await origFetch(...args)
  if (res.status === 401) {
    const url = String(typeof args[0] === 'string' ? args[0] : args[0]?.url || '')
    if (!url.includes('/api/auth/')) {
      window.dispatchEvent(new Event('auth:expired'))
    }
  }
  return res
}

createApp(App).mount('#app')
