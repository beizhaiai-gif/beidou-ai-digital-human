<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['ok'])

const username = ref('')
const password = ref('')
const password2 = ref('')
const busy = ref(false)
const err = ref('')
const notInit = ref(false)

onMounted(async () => {
  // 首次打开（桌面端装完 / 新服务器）：没有管理员 → 直接走「创建账号」，不用 ssh 跑脚本
  try {
    const r = await fetch('/api/auth/status')
    const d = await r.json()
    if (d.ok && d.data && !d.data.initialized) notInit.value = true
  } catch {}
})

async function submit() {
  if (busy.value || !username.value.trim()) return

  /* 首次初始化：建账号并直接登录 */
  if (notInit.value) {
    if (!password.value || password.value.length < 8) {
      err.value = '密码至少 8 位'
      return
    }
    if (password.value !== password2.value) {
      err.value = '两次输入的密码不一样'
      return
    }
    busy.value = true
    err.value = ''
    try {
      const r = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value.trim(), password: password.value }),
      })
      const d = await r.json().catch(() => ({}))
      if (!d.ok) {
        err.value = d.error || '初始化失败'
        return
      }
      emit('ok', d.data?.user)
    } catch (e) {
      err.value = String(e.message || e)
    } finally {
      busy.value = false
    }
    return
  }

  if (!password.value) return
  busy.value = true
  err.value = ''
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.ok) {
      err.value = d.error || (r.status === 429 ? '输错太多次，等 5 分钟' : '登录失败')
      notInit.value = d.code === 'NOT_INIT'
      password.value = ''
      return
    }
    emit('ok', d.data?.user)
  } catch (e) {
    err.value = String(e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="lg-brand">
        <span class="lg-mark">北</span>
        <span class="lg-name">北抖AI数字人</span>
      </div>
      <h1>{{ notInit ? '创建管理员账号' : '登录后台' }}</h1>
      <p class="lg-sub">{{ notInit ? '第一次打开，先给自己建一个账号' : '一条流水线：找选题 → 写文案 → 出数字人 → 剪成片' }}</p>

      <form class="lg-form" @submit.prevent="submit">
        <label class="lg-field">
          <span>账号</span>
          <input
            v-model="username"
            autocomplete="username"
            placeholder="管理员账号"
            :disabled="busy"
            autofocus
          />
        </label>
        <label class="lg-field">
          <span>密码{{ notInit ? '（至少 8 位）' : '' }}</span>
          <input
            v-model="password"
            type="password"
            :autocomplete="notInit ? 'new-password' : 'current-password'"
            placeholder="密码"
            :disabled="busy"
          />
        </label>
        <label v-if="notInit" class="lg-field">
          <span>再输一遍密码</span>
          <input
            v-model="password2"
            type="password"
            autocomplete="new-password"
            placeholder="确认密码"
            :disabled="busy"
          />
        </label>

        <p v-if="err" class="lg-err">{{ err }}</p>

        <button class="lg-btn" type="submit" :disabled="busy || !username.trim() || !password">
          {{ busy ? (notInit ? '创建中…' : '登录中…') : notInit ? '创建账号' : '登录' }}
        </button>
      </form>

      <p class="lg-foot">仅供内部使用 · 连续输错 5 次会锁 5 分钟</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  z-index: 60;
}

.login-card {
  width: 100%;
  max-width: 360px;
  padding: 26px 26px 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(22px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 4px rgba(40, 40, 80, 0.03), 0 20px 50px rgba(60, 60, 110, 0.12);
}

.lg-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 20px;
}
.lg-mark {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(150deg, #7c9cf5, #4f7df3);
  box-shadow: 0 4px 12px rgba(79, 125, 243, 0.35);
}
.lg-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #26263a;
}

h1 {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c30;
  letter-spacing: -0.2px;
}
.lg-sub {
  margin-top: 6px;
  font-size: 11.5px;
  color: #9494a8;
  line-height: 1.5;
}

.lg-form {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lg-field span {
  font-size: 11px;
  color: #8c8ca4;
}
.lg-field input {
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
  color: #26263a;
  background: #fff;
  border: 1px solid rgba(30, 30, 60, 0.1);
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.lg-field input:focus {
  border-color: rgba(79, 125, 243, 0.5);
  box-shadow: 0 0 0 3px rgba(79, 125, 243, 0.1);
}

.lg-err {
  font-size: 11.5px;
  color: #d0503a;
  background: rgba(208, 80, 58, 0.07);
  border: 1px solid rgba(208, 80, 58, 0.16);
  border-radius: 8px;
  padding: 7px 10px;
}
.lg-hint {
  font-size: 10.5px;
  color: #8c8ca4;
  line-height: 1.6;
}
.lg-hint code {
  font-size: 10px;
  background: rgba(40, 40, 80, 0.06);
  padding: 2px 5px;
  border-radius: 5px;
}

.lg-btn {
  margin-top: 4px;
  height: 40px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  box-shadow: 0 6px 18px rgba(79, 125, 243, 0.3);
  transition: filter 0.16s ease, opacity 0.16s ease;
}
.lg-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}
.lg-btn:disabled {
  opacity: 0.45;
  box-shadow: none;
  cursor: not-allowed;
}

.lg-foot {
  margin-top: 16px;
  text-align: center;
  font-size: 10px;
  color: #b4b4c6;
}
</style>
