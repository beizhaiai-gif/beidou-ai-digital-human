import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
      '/jobs': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
      // 轨道工作台：后端把它反代到 /wb/，dev 时也要走一遍（含 HMR 的 ws）
      '/wb': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
        ws: true,
      },
      '/api/pipeline': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
      '/api/export': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
    },
  },
})
