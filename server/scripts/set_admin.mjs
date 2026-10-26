/**
 * 设置 / 重置管理员账号
 *
 *   node server/scripts/set_admin.mjs <用户名> <密码>
 *
 * 密码只以 scrypt 派生值落盘（server/config/admin.json，0600），
 * 不写进源码、不进 git（server/config/ 已 gitignore）。
 */
import { saveAdmin, readAdmin, hashPassword } from '../lib/auth.js'

const [, , username, password] = process.argv

if (!username || !password) {
  const cur = readAdmin()
  console.log('用法: node server/scripts/set_admin.mjs <用户名> <密码>')
  console.log(cur ? `当前账号: ${cur.username}（改密码同样用这条命令）` : '当前还没设置账号')
  process.exit(1)
}

try {
  const r = saveAdmin({ username, password })
  console.log(`已设置管理员：${r.username}`)
  console.log('密码已用 scrypt 派生后存到 server/config/admin.json（0600），改密码会让所有已登录会话失效。')
} catch (e) {
  console.error('设置失败：', e.message)
  process.exit(1)
}
