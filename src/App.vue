<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import HomeView from './views/HomeView.vue'
import DigitalHumanView from './views/DigitalHumanView.vue'
import ChatView from './views/ChatView.vue'
import LoginView from './views/LoginView.vue'
import Icon from './components/Icon.vue'
import SettingsPanel from './components/SettingsPanel.vue'

/* ---------------- 登录门 ----------------
 * 线上部署：所有 /api、/jobs、/uploads 都要登录态，前端启动先问一次 /api/auth/me。
 * authed = null 表示正在检查，别闪一下登录页又跳回来。
 */
const authed = ref(null)
const authUser = ref(null)


async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me')
    const d = await r.json().catch(() => ({}))
    if (d.ok) {
      authUser.value = d.data?.user || null
      authed.value = true
      // 确认登录了再拉配置，未登录时别白发一堆 401 请求
      loadSettings()
      return
    }
    authed.value = false
  } catch {
    authed.value = false
  }
}
checkAuth()

function onLogin(user) {
  authUser.value = user
  authed.value = true
  // 登录后把首屏数据重新拉一遍（之前 401 的都会补上）
  loadSettings()
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  authed.value = false
  authUser.value = null
}

/** 任何接口返回 401（cookie 过期 / 服务端改密码）→ 直接回登录页 */
function onAuthExpired() {
  if (authed.value) {
    authed.value = false
    authUser.value = null
  }
}
onMounted(() => window.addEventListener('auth:expired', onAuthExpired))
onUnmounted(() => window.removeEventListener('auth:expired', onAuthExpired))

const valid = ['home', 'avatar', 'chat', 'image', 'video', 'agent', 'works', 'bench', 'publish', 'square']
const validTab = ['basic', 'llm', 'svc']
const initial = window.location.hash.replace('#', '')
const active = ref(valid.includes(initial) ? initial : 'home')

watch(active, (v) => {
  window.location.hash = v === 'home' ? '' : v
})

const crumbs = {
  home: ['创作工作台', '首页'],
  avatar: ['创作工作台', '数字人台'],
  chat: ['开始创作', '文本对话'],
  image: ['开始创作', '图片创作'],
  video: ['开始创作', '视频创作'],
  agent: ['开始创作', '智能体与工具'],
  works: ['我的工作区', '我的作品'],
  bench: ['我的工作区', '工作台'],
  publish: ['内容发布'],
  square: ['作品广场'],
}

const crumb = computed(() => crumbs[active.value] || ['创作工作台', '首页'])

/* ---------------- 用户资料 + 设置 ---------------- */
/** ?settings=1 直接打开设置（也方便分享/深链） */
const showSettings = ref(new URLSearchParams(window.location.search).get('settings') === '1')
const settingsTab = ref(new URLSearchParams(window.location.search).get('tab') || 'llm')
const user = ref({ name: '北斋', role: 'AI 应用实战讲师', avatarText: '北' })

/** 任意子组件想开设置（比如「去配置 TikHub」）→ 派事件过来 */
function onOpenSettings(e) {
  const tab = e?.detail?.tab
  if (validTab.includes(tab)) settingsTab.value = tab
  showSettings.value = true
}
onMounted(() => window.addEventListener('open-settings', onOpenSettings))
onUnmounted(() => window.removeEventListener('open-settings', onOpenSettings))

async function loadSettings() {
  try {
    const r = await fetch('/api/settings')
    const d = await r.json()
    if (d.ok && d.data?.user) user.value = d.data.user
  } catch {
    /* 读不到就用默认 */
  }
}

function onSaved(data) {
  if (data?.user) user.value = data.user
}
</script>

<template>
  <!-- 检查登录态时就先别渲染，避免闪屏 -->
  <div v-if="authed === null" class="boot">
    <span class="boot-dot"></span>
    正在核对登录状态…
  </div>

  <LoginView v-else-if="!authed" @ok="onLogin" />

  <div v-else class="app">
    <div class="bg-mesh" aria-hidden="true"></div>

    <Sidebar :active="active" :user="user" @select="active = $event" @settings="showSettings = true" />

    <main class="main">
      <header class="topbar">
        <div class="crumb">
          <span class="crumb-strong">{{ crumb[0] }}</span>
          <template v-if="crumb[1]">
            <span class="crumb-sep">/</span>
            <span>{{ crumb[1] }}</span>
          </template>
        </div>
        <button class="topbar-btn">
          我的作品
          <Icon name="chevronDown" :size="13" />
        </button>
      </header>

      <HomeView v-if="active === 'home'" @go="active = $event" />
      <DigitalHumanView v-else-if="active === 'avatar'" />
      <ChatView v-else-if="active === 'chat'" />
      <div v-else class="placeholder">
        <div class="ph-box">
          <Icon name="sparkle" :size="22" />
          <p>{{ crumb[1] || crumb[0] }} · 建设中</p>
          <span>这个模块还在排队，先把数字人台走通</span>
        </div>
      </div>

      <footer class="bottombar">
        <span class="bottom-hint">按你的创作任务，直接开始</span>
        <button class="bottom-link">
          全部工具
          <Icon name="arrowRight" :size="13" />
        </button>
      </footer>
    </main>
    <SettingsPanel
      v-if="showSettings"
      :initial-tab="settingsTab"
      @close="showSettings = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
/* 核对登录态时的过渡屏：不闪内容，也不白屏 */
.boot {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font-size: 12px;
  color: #a0a0b4;
}
.boot-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6d9cfb;
  animation: bootPulse 1s ease-in-out infinite;
}
@keyframes bootPulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.app {
  position: relative;
  display: flex;
  gap: 0;
  height: 100%;
  padding: 10px;
  overflow: hidden;
}

.bg-mesh {
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(1100px 760px at 4% -4%, #f9e2f7 0%, rgba(249, 226, 247, 0) 55%),
    radial-gradient(1000px 700px at 102% -2%, #e3eafe 0%, rgba(227, 234, 254, 0) 55%),
    radial-gradient(900px 720px at 92% 104%, #ddeffc 0%, rgba(221, 239, 252, 0) 62%),
    radial-gradient(820px 560px at 34% 96%, #f2ebfd 0%, rgba(242, 235, 253, 0) 60%),
    linear-gradient(158deg, #fcf7fd 0%, #f9fbff 42%, #eef6fd 100%);
}

.main {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
  flex: 0 0 auto;
}

.crumb {
  font-size: 12.5px;
  color: #8a8a9e;
  display: flex;
  align-items: center;
  gap: 7px;
}

.crumb-strong {
  color: #3d3d52;
  font-weight: 500;
}

.crumb-sep {
  color: #c3c3d2;
}

.topbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: #6a6a80;
  padding: 5px 9px;
  border-radius: 8px;
  transition: background 0.16s ease;
}

.topbar-btn:hover {
  background: rgba(255, 255, 255, 0.75);
}

.placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 20px;
}

.ph-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 34px 44px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px dashed rgba(30, 30, 60, 0.12);
  color: #b0b0c2;
}

.ph-box p {
  font-size: 13px;
  font-weight: 600;
  color: #6a6a80;
}

.ph-box span {
  font-size: 10.5px;
  color: #a5a5b8;
}

.bottombar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 18px 11px;
  font-size: 11.5px;
  color: #9c9cb2;
}

.bottom-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: #8a8aa0;
  padding: 3px 6px;
  border-radius: 6px;
}

.bottom-link:hover {
  background: rgba(255, 255, 255, 0.75);
  color: #4a4a60;
}

@media (max-width: 720px) {
  .app {
    padding: 8px;
  }
  :deep(.sidebar) {
    display: none;
  }
  .topbar {
    padding: 12px 14px 8px;
  }
  .bottombar {
    padding: 9px 14px 10px;
  }
}
</style>
