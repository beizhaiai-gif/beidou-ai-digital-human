<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import Icon from './Icon.vue'

const emit = defineEmits(['close', 'saved'])

const props = defineProps({
  /** 打开时落在哪个 Tab：basic / llm / svc */
  initialTab: { type: String, default: '' },
})

const tab = ref(
  props.initialTab || new URLSearchParams(window.location.search).get('tab') || 'llm',
)
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const toast = ref({ type: '', text: '' })
const testResult = ref(null)

const form = reactive({
  user: { name: '北斋', role: '', avatarText: '北', avatarUrl: '' },
  llm: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-v4-pro',
    effort: 'low',
    temperature: 0.85,
  },
})
/** 用户是否改过 key（没改就传 __KEEP__，避免把脱敏串写回去） */
const keyTouched = ref(false)

/* ---------------- 账号安全 ---------------- */
const pwdOpen = ref(false)
const pwd = reactive({ old: '', next: '', repeat: '' })
const pwdBusy = ref(false)
const pwdMsg = ref('')
const pwdErr = ref(false)

async function changePassword() {
  if (pwdBusy.value) return
  pwdMsg.value = ''
  pwdErr.value = false
  if (pwd.next.length < 6) {
    pwdMsg.value = '新密码至少 6 位'
    pwdErr.value = true
    return
  }
  if (pwd.next !== pwd.repeat) {
    pwdMsg.value = '两次输入的新密码不一样'
    pwdErr.value = true
    return
  }
  pwdBusy.value = true
  try {
    const r = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: pwd.old, newPassword: pwd.next }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.ok) {
      pwdMsg.value = d.error || '修改失败'
      pwdErr.value = true
      return
    }
    pwdMsg.value = '改好了，正在回到登录页…'
    pwdErr.value = false
    setTimeout(() => window.dispatchEvent(new Event('auth:expired')), 900)
  } catch (e) {
    pwdMsg.value = String(e.message || e)
    pwdErr.value = true
  } finally {
    pwdBusy.value = false
  }
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  window.dispatchEvent(new Event('auth:expired'))
}

const providers = ref({})
const hasKey = ref(false)

const providerList = computed(() =>
  Object.entries(providers.value || {}).map(([k, v]) => ({ key: k, ...v })),
)

/** 当前服务商可选的模型（自定义网关则留空，退回手填） */
const modelOptions = computed(() => {
  const p = providers.value[form.llm.provider]
  const list = p?.models || []
  return list.map((id) => ({ id, label: p?.modelLabels?.[id] || id }))
})

const efforts = computed(() => providers.value[form.llm.provider]?.efforts || [])

const EFFORT_LABEL = { low: '快', high: '均衡', max: '深想' }

function flash(type, text) {
  toast.value = { type, text }
  setTimeout(() => (toast.value = { type: '', text: '' }), 3200)
}

/* ---------------- 读取 ---------------- */
async function load() {
  loading.value = true
  try {
    const r = await fetch('/api/settings')
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '读取失败')
    const s = d.data
    providers.value = s.providers || {}
    hasKey.value = s.llm.hasKey
    form.user = { avatarUrl: '', ...s.user }
    form.llm = {
      provider: s.llm.provider || 'deepseek',
      baseUrl: s.llm.baseUrl || '',
      apiKey: '',
      model: s.llm.model || 'deepseek-v4-pro',
      effort: s.llm.effort || 'low',
      temperature: Number(s.llm.temperature) || 0.85,
    }
  } catch (e) {
    flash('err', String(e.message || e))
  } finally {
    loading.value = false
  }
}

/* ---------------- 头像 ---------------- */
const fileEl = ref(null)
const uploading = ref(false)

function pickAvatar() {
  fileEl.value?.click()
}

/** 居中裁正方形 + 压到 256，避免传几 MB 原图 */
function toSquareDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const s = Math.min(img.width, img.height)
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读不出来，换个格式试试'))
    }
    img.src = url
  })
}

async function onPickAvatar(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  if (!/^image\//.test(f.type)) return flash('err', '只能选图片')
  if (f.size > 8 * 1024 * 1024) return flash('err', '图片太大了（8MB 以内）')

  uploading.value = true
  try {
    const dataUrl = await toSquareDataUrl(f)
    const r = await fetch('/api/avatar/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '上传失败')
    form.user.avatarUrl = d.data.url
    emit('saved', { user: { ...form.user } })
    flash('ok', '头像已换')
  } catch (err) {
    flash('err', String(err.message || err))
  } finally {
    uploading.value = false
  }
}

async function clearAvatar() {
  form.user.avatarUrl = ''
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { avatarUrl: '' } }),
  })
  emit('saved', { user: { ...form.user } })
  flash('ok', '已改回文字头像')
}

/* ---------------- 第三方服务 ---------------- */
const services = ref([])
const openSvc = reactive({})
const edits = reactive({})
const svcBusy = reactive({})
const svcResult = reactive({})

async function loadServices() {
  try {
    const r = await fetch('/api/services')
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '读取服务配置失败')
    services.value = d.data.list || []
    for (const s of services.value) {
      if (!edits[s.id]) edits[s.id] = {}
      for (const f of s.fields) {
        // 非密钥字段（音色 ID / 模型 / App ID）直接回填，看得见才好改；
        // 密钥只给脱敏占位，留空表示沿用旧值
        if (!f.secret) edits[s.id][f.key] = s.values[f.key] || ''
        else if (edits[s.id][f.key] === undefined) edits[s.id][f.key] = ''
      }
    }
  } catch (e) {
    flash('err', String(e.message || e))
  }
}

function toggleSvc(id) {
  openSvc[id] = !openSvc[id]
}

function svcPlaceholder(s, f) {
  if (f.secret && s.values[`${f.key}__has`]) return `${s.values[f.key]} · 留空不改`
  return f.placeholder || ''
}

async function saveSvc(s) {
  if (svcBusy[s.id]) return
  svcBusy[s.id] = 'save'
  svcResult[s.id] = null
  try {
    const patch = {}
    for (const f of s.fields) {
      const v = String(edits[s.id][f.key] || '').trim()
      // secret 留空 = 不改
      patch[f.key] = f.secret && !v ? '__KEEP__' : v
    }
    const r = await fetch('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [s.id]: patch }),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '保存失败')
    await loadServices()
    // 只清密钥输入框，非密钥字段已回填成新值
    for (const f of s.fields) if (f.secret) edits[s.id][f.key] = ''
    svcResult[s.id] = { ok: true, text: '已保存' }
    flash('ok', `${s.label} 已保存`)
  } catch (e) {
    svcResult[s.id] = { ok: false, text: String(e.message || e) }
  } finally {
    svcBusy[s.id] = ''
  }
}

async function testSvc(s) {
  if (svcBusy[s.id]) return
  svcBusy[s.id] = 'test'
  svcResult[s.id] = null
  try {
    const values = {}
    for (const f of s.fields) {
      const v = String(edits[s.id][f.key] || '').trim()
      if (v) values[f.key] = v
    }
    const r = await fetch('/api/services/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, values }),
    })
    const d = await r.json()
    svcResult[s.id] = d.ok
      ? { ok: true, text: `✓ ${d.data.detail || '连接正常'} · ${d.data.ms}ms` }
      : { ok: false, text: `✗ ${d.error}` }
  } catch (e) {
    svcResult[s.id] = { ok: false, text: `✗ ${String(e.message || e)}` }
  } finally {
    svcBusy[s.id] = ''
  }
}

/* ---------------- 大模型 ---------------- */
function onProvider() {
  const p = providers.value[form.llm.provider]
  if (!p) return
  if (p.baseUrl) form.llm.baseUrl = p.baseUrl
  if (p.model) form.llm.model = p.model
  if (p.efforts?.length && !p.efforts.includes(form.llm.effort)) form.llm.effort = p.efforts[0]
  testResult.value = null
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const payload = {
      user: { ...form.user },
      llm: {
        provider: form.llm.provider,
        baseUrl: form.llm.baseUrl.trim(),
        model: form.llm.model.trim(),
        effort: form.llm.effort,
        temperature: Number(form.llm.temperature),
        apiKey: keyTouched.value ? form.llm.apiKey.trim() : '__KEEP__',
      },
    }
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '保存失败')
    hasKey.value = d.data.llm.hasKey
    keyTouched.value = false
    form.llm.apiKey = ''
    emit('saved', d.data)
    flash('ok', '已保存，从下一步起生效')
  } catch (e) {
    flash('err', String(e.message || e))
  } finally {
    saving.value = false
  }
}

async function test() {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  try {
    const body = keyTouched.value && form.llm.apiKey.trim()
      ? {
          baseUrl: form.llm.baseUrl.trim(),
          model: form.llm.model.trim(),
          effort: form.llm.effort,
          apiKey: form.llm.apiKey.trim(),
        }
      : { baseUrl: form.llm.baseUrl.trim(), model: form.llm.model.trim(), effort: form.llm.effort }
    const r = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json()
    testResult.value = d.data
  } catch (e) {
    testResult.value = { ok: false, error: String(e.message || e) }
  } finally {
    testing.value = false
  }
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  load()
  loadServices()
  window.addEventListener('keydown', onKey)
})
watch(() => form.llm.apiKey, (v) => {
  if (v) keyTouched.value = true
})
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="sheet">
      <header class="sheet-head">
        <h2>设置</h2>
        <button class="x" @click="emit('close')"><Icon name="close" :size="16" /></button>
      </header>

      <div class="sheet-body">
        <nav class="tabs">
          <button class="tab" :class="{ on: tab === 'basic' }" @click="tab = 'basic'">
            <Icon name="user" :size="14" />
            基本设置
          </button>
          <button class="tab" :class="{ on: tab === 'llm' }" @click="tab = 'llm'">
            <Icon name="sparkle" :size="14" />
            大模型
          </button>
          <button class="tab" :class="{ on: tab === 'svc' }" @click="tab = 'svc'">
            <Icon name="grid" :size="14" />
            第三方服务
          </button>
        </nav>

        <div class="pane">
          <div v-if="loading" class="loading">读取配置…</div>

          <!-- 基本设置 -->
          <template v-else-if="tab === 'basic'">
            <p class="field-label">头像</p>
            <div class="avatar-row">
              <button class="avatar-pick" :disabled="uploading" @click="pickAvatar">
                <img v-if="form.user.avatarUrl" class="av-img" :src="form.user.avatarUrl" alt="头像" />
                <span v-else class="av-txt">{{ form.user.avatarText || '北' }}</span>
                <span class="av-mask">
                  <Icon name="image" :size="16" />
                  <em>{{ uploading ? '上传中' : '换图' }}</em>
                </span>
              </button>
              <div class="avatar-side">
                <button class="ghost-btn sm" :disabled="uploading" @click="pickAvatar">
                  <Icon name="image" :size="12" />
                  {{ uploading ? '上传中…' : '上传图片' }}
                </button>
                <button v-if="form.user.avatarUrl" class="text-btn" @click="clearAvatar">改回文字头像</button>
                <p class="hint-line">jpg / png / webp，自动居中裁成方形，256px</p>
              </div>
              <input ref="fileEl" type="file" accept="image/*" class="file-inp" @change="onPickAvatar" />
            </div>

            <p class="field-label">昵称</p>
            <input v-model="form.user.name" class="inp" placeholder="你的名字" />

            <p class="field-label">身份 / 一句话介绍</p>
            <input v-model="form.user.role" class="inp" placeholder="例：AI 应用实战讲师" />

            <p class="field-label">文字头像（没上传图片时用）</p>
            <input
              v-model="form.user.avatarText"
              class="inp inp--sm"
              maxlength="1"
              placeholder="北"
            />

            <p class="field-label">账号安全</p>
            <div class="acct-box">
              <div class="acct-row">
                <span class="acct-meta">
                  <strong>登录密码</strong>
                  <em>改完所有设备都要重新登录</em>
                </span>
                <button class="ghost-btn sm" @click="pwdOpen = !pwdOpen">
                  {{ pwdOpen ? '收起' : '修改密码' }}
                </button>
              </div>
              <div v-if="pwdOpen" class="pwd-form">
                <input v-model="pwd.old" class="inp inp--sm" type="password" placeholder="当前密码" autocomplete="current-password" />
                <input v-model="pwd.next" class="inp inp--sm" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" />
                <input v-model="pwd.repeat" class="inp inp--sm" type="password" placeholder="再输一次新密码" autocomplete="new-password" />
                <button class="primary-btn sm" :disabled="pwdBusy || !pwd.old || !pwd.next" @click="changePassword">
                  {{ pwdBusy ? '提交中…' : '确认修改' }}
                </button>
                <p v-if="pwdMsg" class="hint-line" :class="{ bad: pwdErr }">{{ pwdMsg }}</p>
              </div>
              <div class="acct-row acct-row--sep">
                <span class="acct-meta">
                  <strong>退出登录</strong>
                  <em>公共电脑上用完记得退</em>
                </span>
                <button class="ghost-btn sm" @click="doLogout">退出</button>
              </div>
            </div>
          </template>

          <!-- 大模型 -->
          <template v-else-if="tab === 'llm'">
            <p class="field-label">服务商</p>
            <div class="chips">
              <button
                v-for="p in providerList"
                :key="p.key"
                class="chip"
                :class="{ on: form.llm.provider === p.key }"
                @click="form.llm.provider = p.key; onProvider()"
              >
                {{ p.label }}
              </button>
            </div>

            <p class="field-label">Base URL</p>
            <input v-model="form.llm.baseUrl" class="inp" placeholder="https://api.deepseek.com/v1/chat/completions" />

            <p class="field-label">
              API Key
              <span v-if="hasKey && !keyTouched" class="keep">已保存 · 不改就留空</span>
            </p>
            <input
              v-model="form.llm.apiKey"
              class="inp"
              type="password"
              :placeholder="hasKey ? 'sk-…（已保存，留空表示不变）' : 'sk-…'"
              autocomplete="off"
            />

            <p class="field-label">模型</p>
            <div v-if="modelOptions.length" class="model-list">
              <button
                v-for="m in modelOptions"
                :key="m.id"
                class="model-btn"
                :class="{ on: form.llm.model === m.id }"
                @click="form.llm.model = m.id"
              >
                <span class="mb-name">{{ m.label }}</span>
                <span class="mb-id">{{ m.id }}</span>
              </button>
            </div>
            <div v-else class="row">
              <input v-model="form.llm.model" class="inp" placeholder="模型 ID" />
            </div>

            <template v-if="efforts.length">
              <p class="field-label">
                思考强度
                <span class="num">{{ EFFORT_LABEL[form.llm.effort] || form.llm.effort }}</span>
              </p>
              <div class="chips">
                <button
                  v-for="e in efforts"
                  :key="e"
                  class="chip"
                  :class="{ on: form.llm.effort === e }"
                  @click="form.llm.effort = e"
                >
                  {{ EFFORT_LABEL[e] || e }}
                </button>
              </div>
              <p class="hint-line">V4 是推理模型：先想再写。选「快」出稿最快，写长稿或拆复杂逻辑选「深想」</p>
            </template>

            <p class="field-label">温度 <span class="num">{{ Number(form.llm.temperature).toFixed(2) }}</span></p>
            <input v-model.number="form.llm.temperature" type="range" min="0" max="1.4" step="0.05" class="range" />
            <p class="hint-line">写稿建议 0.8–0.9；需要稳定输出结构化内容时调低到 0.3–0.5</p>

            <div class="test-row">
              <button class="ghost-btn" :disabled="testing" @click="test">
                <Icon name="sparkle" :size="12" />
                {{ testing ? '测试中…' : '测试连接' }}
              </button>
              <span v-if="testResult" class="test-out" :class="testResult.ok ? 'ok' : 'err'">
                <template v-if="testResult.ok">
                  ✓ {{ testResult.model }} · {{ testResult.ms }}ms · 回「{{ testResult.reply }}」
                </template>
                <template v-else>✗ {{ testResult.error }}</template>
              </span>
            </div>
          </template>

          <!-- 第三方服务 -->
          <template v-else>
            <p class="svc-intro">
              这些 Key 存在本机 <code>server/config/settings.json</code>（权限 0600），不会同步到任何地方。
              保存后各功能直接读这里，不用改代码。
            </p>

            <div v-for="s in services" :key="s.id" class="svc" :class="{ ready: s.ready }">
              <header class="svc-head" @click="toggleSvc(s.id)">
                <span class="svc-dot"></span>
                <span class="svc-meta">
                  <strong>{{ s.label }}</strong>
                  <em>{{ s.desc }}</em>
                </span>
                <span v-if="s.ready" class="svc-tag">已配置</span>
                <Icon name="chevronDown" :size="12" class="svc-caret" :class="{ open: openSvc[s.id] }" />
              </header>

              <div v-if="openSvc[s.id]" class="svc-body">
                <template v-for="f in s.fields" :key="f.key">
                  <p class="field-label">
                    {{ f.label }}
                    <span v-if="f.required" class="req">必填</span>
                    <span v-if="f.secret && s.values[`${f.key}__has`]" class="keep">已保存</span>
                  </p>
                  <input
                    v-model="edits[s.id][f.key]"
                    class="inp"
                    :type="f.secret ? 'password' : 'text'"
                    :placeholder="svcPlaceholder(s, f)"
                    autocomplete="off"
                  />
                  <p v-if="f.hint" class="hint-line">{{ f.hint }}</p>
                </template>

                <div class="svc-foot">
                  <button
                    v-if="s.testable"
                    class="ghost-btn sm"
                    :disabled="Boolean(svcBusy[s.id])"
                    @click="testSvc(s)"
                  >
                    {{ svcBusy[s.id] === 'test' ? '测试中…' : '测试连接' }}
                  </button>
                  <button class="primary-btn sm" :disabled="Boolean(svcBusy[s.id])" @click="saveSvc(s)">
                    {{ svcBusy[s.id] === 'save' ? '保存中…' : '保存' }}
                  </button>
                  <a v-if="s.docs" class="svc-doc" :href="s.docs" target="_blank" rel="noreferrer">
                    控制台
                    <Icon name="arrowUpRight" :size="11" />
                  </a>
                  <span v-if="svcResult[s.id]" class="svc-res" :class="svcResult[s.id].ok ? 'ok' : 'err'">
                    {{ svcResult[s.id].text }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <footer class="sheet-foot">
        <span v-if="toast.text" class="toast" :class="toast.type">{{ toast.text }}</span>
        <div class="foot-actions">
          <button class="ghost-btn" @click="emit('close')">关闭</button>
          <button v-if="tab !== 'svc'" class="primary-btn" :disabled="saving || loading" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(16, 16, 32, 0.32);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 24px;
}
.sheet {
  width: min(680px, 100%);
  max-height: min(88vh, 800px);
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(30px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  box-shadow: 0 30px 90px rgba(30, 30, 70, 0.24);
  overflow: hidden;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(24, 24, 48, 0.06);
}
.sheet-head h2 {
  font-size: 15px;
  font-weight: 700;
  color: #1a1a2e;
}
.x {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #8a8aa0;
  border: none;
  background: transparent;
}
.x:hover {
  background: rgba(24, 24, 48, 0.06);
  color: #33334d;
}
.sheet-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.tabs {
  width: 148px;
  flex: 0 0 148px;
  padding: 12px 8px;
  border-right: 1px solid rgba(24, 24, 48, 0.06);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 10px;
  border-radius: 9px;
  border: none;
  background: transparent;
  font-size: 12.5px;
  color: #5f5f78;
  text-align: left;
}
.tab:hover {
  background: rgba(24, 24, 48, 0.045);
}
.tab.on {
  background: rgba(79, 125, 243, 0.1);
  color: #2f5cd6;
  font-weight: 600;
}
.pane {
  flex: 1;
  min-width: 0;
  padding: 16px 20px 20px;
  overflow-y: auto;
}
.loading {
  font-size: 12px;
  color: #8c8ca4;
  padding: 20px 0;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #8c8ca4;
  margin: 14px 0 6px;
}
.field-label:first-child {
  margin-top: 0;
}
.keep {
  font-size: 10px;
  color: #46b98a;
  background: rgba(70, 185, 138, 0.1);
  padding: 2px 7px;
  border-radius: 999px;
}
.req {
  font-size: 9.5px;
  color: #c98a3f;
  background: rgba(214, 158, 46, 0.12);
  padding: 1px 6px;
  border-radius: 999px;
}
.num {
  color: #4f7df3;
  font-weight: 600;
}

/* ---- 头像 ---- */
.avatar-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar-pick {
  position: relative;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid rgba(30, 30, 60, 0.1);
  background: linear-gradient(150deg, #dfe6f7, #c9d6f0);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.av-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.av-txt {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
}
.av-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: rgba(20, 20, 40, 0.5);
  color: #fff;
  opacity: 0;
  transition: opacity 0.16s ease;
}
.av-mask em {
  font-style: normal;
  font-size: 9.5px;
}
.avatar-pick:hover .av-mask {
  opacity: 1;
}
.avatar-side {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.text-btn {
  font-size: 10.5px;
  color: #9a9ab0;
  padding: 1px 4px;
  margin-left: -4px;
}
.text-btn:hover {
  color: #d0503a;
}
.file-inp {
  display: none;
}

/* ---- 表单 ---- */
.inp {
  width: 100%;
  height: 34px;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 12.5px;
  color: #22223a;
  background: #fff;
  border: 1px solid rgba(30, 30, 60, 0.11);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.inp:focus {
  border-color: rgba(79, 125, 243, 0.5);
  box-shadow: 0 0 0 3px rgba(79, 125, 243, 0.1);
}
.inp--sm {
  width: 88px;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.row .inp {
  flex: 1;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 11.5px;
  color: #5f5f78;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(30, 30, 60, 0.1);
}
.chip.on {
  color: #2f5cd6;
  background: rgba(79, 125, 243, 0.1);
  border-color: rgba(79, 125, 243, 0.34);
  font-weight: 600;
}
.range {
  width: 100%;
  accent-color: #4f7df3;
}
.hint-line {
  margin-top: 6px;
  font-size: 10.5px;
  color: #a0a0b4;
  line-height: 1.5;
}
.hint-line.bad {
  color: #d0503a;
}

/* ---- 账号安全 ---- */
.acct-box {
  border: 1px solid rgba(30, 30, 60, 0.07);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.6);
  overflow: hidden;
}
.acct-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}
.acct-row--sep {
  border-top: 1px solid rgba(30, 30, 60, 0.06);
}
.acct-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.acct-meta strong {
  font-size: 11.5px;
  font-weight: 600;
  color: #2c2c40;
}
.acct-meta em {
  font-style: normal;
  font-size: 9.5px;
  color: #a5a5b8;
}
.pwd-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 2px 12px 12px;
}

/* ---- 模型选择 ---- */
.model-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.model-btn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 11px;
  border-radius: 10px;
  text-align: left;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(30, 30, 60, 0.1);
  transition: all 0.16s ease;
}
.model-btn:hover {
  border-color: rgba(79, 125, 243, 0.32);
}
.model-btn.on {
  border-color: rgba(79, 125, 243, 0.55);
  background: linear-gradient(100deg, rgba(240, 246, 255, 0.96), rgba(250, 245, 255, 0.92));
  box-shadow: 0 2px 10px rgba(79, 125, 243, 0.1);
}
.mb-name {
  font-size: 12px;
  font-weight: 600;
  color: #2c2c40;
}
.mb-id {
  font-size: 10px;
  color: #a5a5b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ---- 测试 ---- */
.test-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.test-out {
  font-size: 11px;
  line-height: 1.45;
}
.test-out.ok {
  color: #2f9e6f;
}
.test-out.err {
  color: #d0503a;
}

/* ---- 第三方服务 ---- */
.svc-intro {
  font-size: 11px;
  color: #8c8ca4;
  line-height: 1.6;
  background: rgba(246, 247, 252, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.05);
  border-radius: 9px;
  padding: 9px 11px;
  margin-bottom: 12px;
}
.svc-intro code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #b5459b;
  background: rgba(40, 40, 80, 0.05);
  padding: 1px 4px;
  border-radius: 4px;
}
.svc {
  border-radius: 11px;
  border: 1px solid rgba(30, 30, 60, 0.07);
  background: rgba(255, 255, 255, 0.65);
  margin-bottom: 8px;
  overflow: hidden;
  transition: border-color 0.16s ease;
}
.svc.ready {
  border-color: rgba(70, 185, 138, 0.28);
  background: rgba(250, 254, 252, 0.8);
}
.svc-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
}
.svc-head:hover {
  background: rgba(246, 247, 252, 0.8);
}
.svc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d0d0de;
  flex: 0 0 auto;
}
.svc.ready .svc-dot {
  background: #46b98a;
}
.svc-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.svc-meta strong {
  font-size: 12.5px;
  font-weight: 600;
  color: #2a2a40;
}
.svc-meta em {
  font-style: normal;
  font-size: 10px;
  color: #a0a0b4;
}
.svc-tag {
  font-size: 9.5px;
  color: #2f9e6f;
  background: rgba(70, 185, 138, 0.12);
  padding: 2px 7px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.svc-caret {
  color: #b0b0c2;
  transition: transform 0.2s ease;
  flex: 0 0 auto;
}
.svc-caret.open {
  transform: rotate(180deg);
}
.svc-body {
  padding: 2px 12px 12px;
  border-top: 1px solid rgba(30, 30, 60, 0.05);
}
.svc-body .field-label:first-child {
  margin-top: 12px;
}
.svc-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.svc-doc {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: #8a8aa2;
}
.svc-doc:hover {
  color: #4f7df3;
}
.svc-res {
  font-size: 10.5px;
  line-height: 1.45;
}
.svc-res.ok {
  color: #2f9e6f;
}
.svc-res.err {
  color: #d0503a;
}

/* ---- 底部 ---- */
.sheet-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid rgba(24, 24, 48, 0.06);
  background: rgba(250, 250, 253, 0.8);
}
.toast {
  font-size: 11.5px;
}
.toast.ok {
  color: #2f9e6f;
}
.toast.err {
  color: #d0503a;
}
.foot-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 12px;
  color: #5f5f78;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(30, 30, 60, 0.1);
}
.ghost-btn:hover:not(:disabled) {
  background: #fff;
  color: #2c2c40;
}
.ghost-btn:disabled {
  opacity: 0.55;
}
.ghost-btn.sm {
  height: 30px;
  padding: 0 11px;
  font-size: 11.5px;
}
.primary-btn {
  height: 32px;
  padding: 0 18px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  border: none;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  box-shadow: 0 5px 14px rgba(79, 125, 243, 0.28);
}
.primary-btn.sm {
  height: 30px;
  padding: 0 14px;
  font-size: 11.5px;
}
.primary-btn:disabled {
  opacity: 0.6;
  box-shadow: none;
}
</style>
