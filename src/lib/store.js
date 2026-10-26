/**
 * 极简本地状态持久化
 *
 * 解决的问题：数字人台是 v-if 切换的，切到别的菜单再回来组件会重建；
 * 刷新页面同理。以前采集到的作品、选中的那条、时间范围全都归零，
 * 用户得重新采一遍。这里统一存 localStorage。
 *
 * 用法：
 *   const saved = readStore('topic', {})
 *   const rangeDays = ref(saved.rangeDays || 1)
 *   watch([...], () => writeStore('topic', { rangeDays: rangeDays.value }), { deep: true })
 */

const PREFIX = 'dh.'

export function readStore(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return fallback
    const box = JSON.parse(raw)
    // 统一包一层 { v, at }，坏数据直接回落
    if (!box || typeof box !== 'object' || !('v' in box)) return fallback
    return box.v ?? fallback
  } catch {
    return fallback
  }
}

export function writeStore(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, at: Date.now() }))
  } catch {
    /* 配额满了就算了，别影响主流程 */
  }
}

export function clearStore(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* 忽略 */
  }
}
