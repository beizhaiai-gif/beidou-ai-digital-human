<script setup>
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import Icon from '../Icon.vue'
import { FRAMEWORKS } from '../../constants/xuehui.js'
import { readStore, writeStore } from '../../lib/store.js'

/** 进来先把上次的现场摆回来：切菜单 / 刷新都不该丢 */
const SAVED = readStore('topic', {}) || {}

/** 热榜缓存：切步骤靠 KeepAlive，刷新页面靠这块（sessionStorage，关标签即清） */
const TREND_CACHE = 'dh.trend.cache'
const cacheGet = () => {
  try {
    const d = JSON.parse(sessionStorage.getItem(TREND_CACHE) || 'null')
    if (!d || Date.now() - d.at > 6 * 3600 * 1000) return null
    return d
  } catch {
    return null
  }
}
const cacheSet = (payload) => {
  try {
    sessionStorage.setItem(TREND_CACHE, JSON.stringify({ ...payload, at: Date.now() }))
  } catch {
    /* 存不下就算了 */
  }
}

/** ?dy=1 直接落在「对标博主」Tab */
const tab = ref(
  SAVED.tab || (new URLSearchParams(window.location.search).get('dy') === '1' ? 'blogger' : 'trend'),
)
const picked = ref(SAVED.picked || null)

/* ---------------- 热榜（真实数据） ---------------- */
const allItems = ref([])
const trendsLoading = ref(false)
const trendsError = ref('')
const lastSync = ref('')
const platforms = ref([])
const platform = ref('weibo')
const trendLoaded = ref(false)

const PLATFORM_LABEL = {
  weibo: '微博',
  douyin: '抖音',
  zhihu: '知乎',
  'bilibili-hot-search': 'B站',
  baidu: '百度',
  toutiao: '头条',
  tieba: '贴吧',
  thepaper: '澎湃',
  'wallstreetcn-hot': '华尔街',
  'cls-hot': '财联社',
  ifeng: '凤凰',
}

// 内容创作视角下，这几家更适合找大众话题
const CONTENT_PLATFORMS = ['weibo', 'douyin', 'zhihu', 'bilibili-hot-search', 'baidu', 'toutiao']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchTrends(force = false) {
  const r = await fetch(`/api/trends?limit=300${force ? '&force=1' : ''}`)
  return r.json()
}

async function loadTrends(force = false) {
  trendsLoading.value = true
  trendsError.value = ''
  try {
    let data = await fetchTrends(force)

    // 今日还没抓过 → 自动补抓一次（约 2–4 分钟），再取
    if (!data.ok) {
      trendsError.value = data.hint || '正在抓取今日热榜…'
      await fetch('/api/trends/crawl', { method: 'POST' })
      for (let i = 0; i < 45; i++) {
        await sleep(6000)
        const st = await (await fetch('/api/trends/crawl')).json()
        if (!st.running) break
        trendsError.value = `正在抓取今日热榜… 已等 ${(i + 1) * 6}s`
      }
      data = await fetchTrends(true)
      if (!data.ok) {
        trendsError.value = data.hint || data.error || '抓取后仍没有今日数据'
        return
      }
    }

    const all = data.data?.items || []
    allItems.value = all

    const seen = new Map()
    for (const it of all) if (it.platform) seen.set(it.platform, it.src)
    const list = [...seen.entries()]
      .map(([k, v]) => ({ key: k, label: PLATFORM_LABEL[k] || v }))
      .filter((p) => CONTENT_PLATFORMS.includes(p.key))

    platforms.value = list
    if (list.length && !list.some((p) => p.key === platform.value)) {
      platform.value = list[0].key
    }
    lastSync.value = data.data?.stale?.latest?.lastUpdated || ''
    trendLoaded.value = true
    trendsError.value = ''
    cacheSet({ items: all, platforms: list, platform: platform.value, lastSync: lastSync.value, picked: picked.value })
  } catch (e) {
    trendsError.value = String(e.message || e)
  } finally {
    trendsLoading.value = false
  }
}

/** 进页面先把上次看的热榜摆回来，没有才显示空态按钮 */
function restoreTrends() {
  const c = cacheGet()
  if (!c?.items?.length) return false
  allItems.value = c.items
  platforms.value = c.platforms || []
  if (c.platform) platform.value = c.platform
  lastSync.value = c.lastSync || ''
  if (c.picked) picked.value = c.picked
  trendLoaded.value = true
  return true
}

const shownTrends = computed(() =>
  allItems.value.filter((it) => it.platform === platform.value).slice(0, 40),
)



/** 后端挂掉或返回非 JSON 时，r.json() 会抛「Unexpected end of JSON input」，
 *  这里统一兜成一句人话，别把原始异常丢给用户看 */
async function safeJson(res) {
  const text = await res.text().catch(() => '')
  if (!text) {
    return { ok: false, error: `后端没响应（HTTP ${res.status}）—— 可能服务刚重启，稍等两秒再试` }
  }
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, error: `后端返回异常（HTTP ${res.status}）` }
  }
}

/* ---------------- 对标博主（TikHub 直采） ---------------- */
const bloggers = ref([])
const selectedBloggers = ref(SAVED.selectedBloggers || [])   // 多选采集
const pickedVideo = ref(SAVED.pickedVideo || null)          // 选中的那一条作品
const extraVideos = ref(SAVED.extraVideos || [])            // 单条链接采进来的
/** 上次采集成功的时间戳，0 = 本机没记录 */
const lastSyncAt = ref(SAVED.lastSyncAt || 0)
const oneUrl = ref('')
const oneBusy = ref(false)
const adding = ref(false)
const newUrl = ref('')
const bloggerBusy = ref(false)
const bloggerError = ref('')
const syncing = ref(false)
const syncSec = ref(0)
let syncTimer = null
const extracting = ref(false)
const extractMsg = ref('')
/** 正在提取的那一行，按钮上转圈用 */
const extractKey = ref('')
/** 正在播放的作品 { key, title, url } */
const playing = ref(null)
const playLoading = ref('')
/** 采集时间范围（天）：1 / 3 / 7 / 30 */
const rangeDays = ref(SAVED.rangeDays || 1)
const RANGES = [
  { days: 1, label: '近一天' },
  { days: 3, label: '近三天' },
  { days: 7, label: '近一周' },
  { days: 30, label: '近一月' },
]
/** tikhub = 配好可用；none = 还没填 Token，什么都采不了 */
const channelInfo = ref('none')

const openSettings = (tab = 'svc') => {
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab } }))
}

const fmtFans = (n) => {
  const v = Number(n) || 0
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  return String(v)
}
const fmtDur = (ms) => {
  const s = Math.round((Number(ms) || 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const fmtWhen = (ts) => {
  if (!ts) return ''
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} 分钟前`
  if (sec < 86400) return `${Math.round(sec / 3600)} 小时前`
  const d = Math.floor(sec / 86400)
  if (d === 1) return '昨天'
  if (d < 30) return `${d} 天前`
  return new Date(ts * 1000).toLocaleDateString('zh-CN')
}

/** 选中博主的作品 + 单条采集的，合成一个列表 */
const DAY = 86400
const sinceTs = () => Math.floor(Date.now() / 1000) - rangeDays.value * DAY
/** 某博主在当前时间范围内有多少条 */
const recentCount = (b) =>
  (b.videos || []).filter((v) => (v.createTime || 0) >= sinceTs()).length
const feedVideos = computed(() => {
  const since = sinceTs()
  const out = []
  for (const b of bloggers.value) {
    if (!selectedBloggers.value.includes(b.id)) continue
    for (const v of b.videos || []) {
      if ((v.createTime || 0) < since) continue
      out.push({ ...v, key: `${b.id}_${v.awemeId}`, bloggerId: b.id, nickname: b.nickname })
    }
  }
  // 单条采集的不受时间限制，你想采哪条就哪条
  for (const v of extraVideos.value) out.push({ ...v, key: `one_${v.awemeId}`, bloggerId: 'one', nickname: '单条采集' })
  return out.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
})

/** 已采集数据里最新的一条（用来在空态里说人话：最近一条是几号） */
const latestTs = computed(() => {
  let mx = 0
  for (const b of bloggers.value) {
    if (!selectedBloggers.value.includes(b.id)) continue
    for (const v of b.videos || []) {
      const t = v.createTime || 0
      if (t > mx) mx = t
    }
  }
  for (const v of extraVideos.value) {
    const t = v.createTime || 0
    if (t > mx) mx = t
  }
  return mx
})
const hasAnyVideo = computed(
  () =>
    extraVideos.value.length > 0 ||
    bloggers.value.some((b) => selectedBloggers.value.includes(b.id) && (b.videos || []).length),
)
/** 空态里推荐放宽到哪一档 */
const suggestDays = computed(() => {
  if (!latestTs.value) return 0
  const diff = (Date.now() / 1000 - latestTs.value) / DAY
  if (diff <= 1) return 1
  if (diff <= 3) return 3
  if (diff <= 7) return 7
  return 30
})
const latestText = computed(() =>
  latestTs.value ? new Date(latestTs.value * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '',
)

/** 上次采集时间 + 已入库总条数，让「数据还在」这件事看得见 */
const lastSyncText = computed(() => {
  if (!lastSyncAt.value) return ''
  const d = new Date(lastSyncAt.value)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}-${d.getDate()} ${hm}`
})
const totalCollected = computed(() =>
  bloggers.value.reduce(
    (n, b) => n + (selectedBloggers.value.includes(b.id) ? (b.videos || []).length : 0),
    0,
  ) + extraVideos.value.length,
)

/** 现场存档：切菜单、刷新页面回来都还在 */
watch(
  [tab, rangeDays, selectedBloggers, pickedVideo, extraVideos, picked, lastSyncAt],
  () => {
    writeStore('topic', {
      tab: tab.value,
      rangeDays: rangeDays.value,
      selectedBloggers: selectedBloggers.value,
      pickedVideo: pickedVideo.value,
      extraVideos: extraVideos.value,
      picked: picked.value,
      lastSyncAt: lastSyncAt.value,
    })
  },
  { deep: true },
)

async function loadBloggers() {
  try {
    const r = await fetch('/api/blogger/list')
    const d = await safeJson(r)
    if (!d.ok) return
    bloggers.value = d.data || []
    if (d.channel) channelInfo.value = d.channel
    // 本机没存过采集时间，就用后端文件最后写入的时间，刷新后也有据可依
    if (d.updatedAt && !lastSyncAt.value) lastSyncAt.value = d.updatedAt
    // 首次进来默认全选，省得手动勾
    if (!selectedBloggers.value.length) selectedBloggers.value = bloggers.value.map((b) => b.id)
    // 选中的博主被删了要剔除
    selectedBloggers.value = selectedBloggers.value.filter((id) => bloggers.value.some((b) => b.id === id))
  } catch {
    /* 忽略 */
  }
}

function toggleBlogger(id) {
  const i = selectedBloggers.value.indexOf(id)
  if (i >= 0) selectedBloggers.value.splice(i, 1)
  else selectedBloggers.value.push(id)
  pickedVideo.value = null
}

function pickVideo(v) {
  pickedVideo.value = pickedVideo.value?.key === v.key ? null : v
}

/** 采集选中博主的近一天作品 */
async function syncSelected() {
  if (syncing.value) return
  if (!selectedBloggers.value.length) {
    bloggerError.value = '先勾选要采集的博主'
    return
  }
  syncing.value = true
  bloggerError.value = ''
  syncSec.value = 0
  clearInterval(syncTimer)
  syncTimer = setInterval(() => { syncSec.value += 1 }, 1000)
  try {
    const r = await fetch('/api/blogger/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedBloggers.value, days: rangeDays.value }),
    })
    const d = await safeJson(r)
    if (!d.ok) bloggerError.value = d.error || '采集失败'
    else if (!d.synced) bloggerError.value = '这几位博主在这个时间段内没有新作品'
    else lastSyncAt.value = Date.now()
    await loadBloggers()
    pickedVideo.value = null
  } catch (e) {
    bloggerError.value = String(e.message || e)
  } finally {
    syncing.value = false
    clearInterval(syncTimer)
    syncTimer = null
  }
}

async function addBlogger() {
  const url = newUrl.value.trim()
  if (!url || bloggerBusy.value) return
  bloggerBusy.value = true
  bloggerError.value = ''
  try {
    const r = await fetch('/api/blogger/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const d = await safeJson(r)
    if (!d.ok) {
      bloggerError.value = d.error || '添加失败'
      return
    }
    newUrl.value = ''
    adding.value = false
    await loadBloggers()
    if (!selectedBloggers.value.includes(d.data.id)) selectedBloggers.value.push(d.data.id)
  } catch (e) {
    bloggerError.value = String(e.message || e)
  } finally {
    bloggerBusy.value = false
  }
}

/** 单条视频：贴分享链接直接采 */
async function fetchOne() {
  const url = oneUrl.value.trim()
  if (!url || oneBusy.value) return
  oneBusy.value = true
  bloggerError.value = ''
  try {
    const r = await fetch('/api/blogger/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const d = await safeJson(r)
    if (!d.ok) {
      bloggerError.value = d.error || '采集失败'
      return
    }
    const v = d.data
    if (!extraVideos.value.some((x) => x.awemeId === v.awemeId)) extraVideos.value.unshift(v)
    oneUrl.value = ''
    lastSyncAt.value = Date.now()
    pickedVideo.value = { ...v, key: `one_${v.awemeId}`, bloggerId: 'one', nickname: '单条采集' }
  } catch (e) {
    bloggerError.value = String(e.message || e)
  } finally {
    oneBusy.value = false
  }
}

/** 点封面播放：播放地址有时效，现取一个 */
async function openPlay(v, e) {
  e?.stopPropagation?.()
  if (playLoading.value) return
  playLoading.value = v.key
  try {
    // 走同源代理：直接把抖音 CDN 地址给 <video> 会报 Format error
    playing.value = {
      key: v.key,
      title: v.title,
      url: `/api/blogger/stream/${v.awemeId}`,
    }
  } catch (err) {
    bloggerError.value = String(err.message || err)
  } finally {
    playLoading.value = ''
  }
}

/** 提取选中作品的口播文案，带着原文案跳第二步（复刻模式） */
async function extractAndNext(row) {
  const v = row || pickedVideo.value
  if (!v || extracting.value) return
  extracting.value = true
  extractKey.value = v.key
  extractMsg.value = '正在下载视频并识别口播…（约 30 秒）'
  bloggerError.value = ''
  try {
    const r = await fetch('/api/blogger/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ awemeId: v.awemeId }),
    })
    const d = await safeJson(r)
    if (!d.ok) {
      bloggerError.value = d.error || '提取失败'
      extractMsg.value = ''
      return
    }
    extractMsg.value = ''
    emit('next', {
      title: (d.data.title || v.title || '').slice(0, 60),
      original: d.data.text,
      why: `复刻 · ${v.nickname} · ♥${fmtFans(v.likeCount)}`,
      fw: '',
      els: [],
    })
  } catch (e) {
    bloggerError.value = String(e.message || e)
    extractMsg.value = ''
  } finally {
    extracting.value = false
    extractKey.value = ''
  }
}

async function removeBlogger(id) {
  await fetch(`/api/blogger/${id}`, { method: 'DELETE' })
  selectedBloggers.value = selectedBloggers.value.filter((x) => x !== id)
  await loadBloggers()
}

onMounted(() => {
  restoreTrends()
  loadBloggers()
})
onActivated(() => {
  loadBloggers()
})


/* ---------------- 选题生成（真实 LLM） ---------------- */
const frameworks = FRAMEWORKS

/** 薛辉八大爆款元素（模型定骨架，元素长肉） */
const count = ref(5)
const generating = ref(false)
const genError = ref('')
/** 热榜出题前搜到的真实作品，给个可见反馈 */
const searchInfo = ref(null)
const topics = ref([])

const pickedTopic = computed(() => topics.value.find((t) => t.id === picked.value))

const pickedSource = computed(() => {
  if (tab.value === 'trend') {
    return picked.value ? shownTrends.value.find((t) => t.id === picked.value)?.title || '' : ''
  }
  return pickedVideo.value?.title || ''
})

async function generate() {
  generating.value = true
  genError.value = ''

  let material = ''

  if (tab.value === 'trend') {
    const list = shownTrends.value
    material = pickedSource.value
      ? `【必须用来出题的那一条】\n${pickedSource.value}\n\n【同平台其他热榜 —— 只用来了解当下语境，禁止拿它们出题】\n${list
          .slice(0, 12)
          .map((t, i) => `${i + 1}. ${t.title}`)
          .join('\n')}`
      : list
          .slice(0, 15)
          .map((t, i) => `${i + 1}. ${t.title}`)
          .join('\n')
    if (!material.trim()) {
      generating.value = false
      genError.value = '还没有素材，先选一条热榜'
      return
    }
  } else {
    // 对标博主：用选中那条的真实数据当素材，再带上同博主其他作品做参考
    const v = pickedVideo.value
    if (!v) {
      generating.value = false
      genError.value = '先在左边选一条作品'
      return
    }
    const siblings = feedVideos.value.filter((x) => x.bloggerId === v.bloggerId && x.key !== v.key).slice(0, 8)
    const stat = `♥${v.likeCount} 💬${v.commentCount}${v.durationMs ? ` ⏱${Math.round(v.durationMs / 1000)}s` : ''}`
    material = [
      '【必须用来出题的那一条】',
      `${v.title}（作者 ${v.nickname}，${stat}）`,
      siblings.length
        ? `\n【同博主其他作品 —— 只用来参考他的选题风格，禁止拿它们顶替出题】\n${siblings
            .map((x, i) => `${i + 1}. ${x.title}`)
            .join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  try {
    const res = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: material,
        count: count.value,
        search: tab.value === 'trend',
      }),
    })
    const data = await safeJson(res)
    if (!data.ok) {
      genError.value = data.error || '生成失败'
      return
    }
    topics.value = data.data.topics
    searchInfo.value = data.searched || null
  } catch (e) {
    genError.value = String(e.message || e)
  } finally {
    generating.value = false
  }
}

const emit = defineEmits(['next'])
</script>

<template>
  <div class="step">
    <!-- 左：素材来源 -->
    <section class="pane">
      <header class="pane-head">
        <h3>素材来源</h3>
        <div class="seg">
          <button :class="{ on: tab === 'trend' }" @click="tab = 'trend'">热榜热点</button>
          <button :class="{ on: tab === 'bench' }" @click="tab = 'bench'">对标博主</button>
        </div>
      </header>

      <!-- 热榜 -->
      <div v-if="tab === 'trend'" class="list">
        <div v-if="trendLoaded" class="plat-row">
          <button
            v-for="p in platforms"
            :key="p.key"
            class="plat"
            :class="{ on: platform === p.key }"
            @click="platform = p.key"
          >
            {{ p.label }}
          </button>
        </div>

        <div v-if="trendLoaded || trendsLoading" class="list-meta">
          <span v-if="trendsLoading">{{ shownTrends.length ? '刷新中…' : '拉取中…' }}</span>
          <span v-else-if="trendsError" class="err">{{ trendsError }}</span>
          <span v-else>{{ shownTrends.length }} 条 · 同步于 {{ lastSync || '—' }}</span>
          <button class="link-btn" @click="loadTrends(true)">
            <Icon name="trend" :size="12" />刷新
          </button>
        </div>

        <!-- 空态：不自动抓取，先让人确认再动手 -->
        <div v-if="!trendLoaded && !trendsLoading" class="empty-fetch">
          <span class="ef-ico"><Icon name="trend" :size="20" /></span>
          <p class="ef-title">还没拉取今日热榜</p>
          <p class="ef-sub">点一下拉取微博 / 抖音 / 知乎 / B站 / 百度 / 头条的实时榜单</p>
          <button class="ef-btn" @click="loadTrends()">获取今日热榜</button>
        </div>

        <div v-if="trendsLoading && !shownTrends.length" class="skeleton">
          <span v-for="i in 6" :key="i" class="sk-row"></span>
        </div>

        <template v-if="trendLoaded">
          <button
            v-for="t in shownTrends"
            :key="t.id"
            class="row"
            :class="{ on: picked === t.id }"
            @click="picked = t.id"
          >
            <span class="radio"></span>
            <span class="row-rank" :class="{ top: t.rank <= 3 }">{{ t.rank }}</span>
            <span class="row-main">
              <span class="row-title">{{ t.title }}</span>
              <span class="row-sub">{{ t.src }} · {{ t.time }}</span>
            </span>
          </button>
        </template>


      </div>

      <!-- 对标博主（TikHub 直采） -->
      <div v-else class="list">
        <!-- 只在没配 Token 时才提示，配好了不占地方 -->
        <div v-if="channelInfo !== 'tikhub'" class="dy-bar">
          <span class="dy-dot"></span>
          <span class="dy-txt">还没配 TikHub Token · 去设置里填一个就能采集</span>
          <button class="link-btn" @click="openSettings('svc')">
            <Icon name="settings" :size="12" />去配置
          </button>
        </div>

        <!-- ① 单条采集（放最上面） -->
        <div class="one-row">
          <input
            v-model="oneUrl"
            class="one-input"
            placeholder="粘抖音视频链接，只采这一条"
            :disabled="channelInfo !== 'tikhub'"
            @keyup.enter="fetchOne"
          />
          <button
            class="mini-ok one-btn"
            :disabled="channelInfo !== 'tikhub' || oneBusy || !oneUrl.trim()"
            @click="fetchOne"
          >
            {{ oneBusy ? '采集中…' : '单采集' }}
          </button>
        </div>

        <!-- ② 博主采集（放下面，按钮和单采集同尺寸） -->
        <div class="bp-block">
          <div class="bp-head">
            <span class="bp-title">
              博主采集<em v-if="selectedBloggers.length">已选 {{ selectedBloggers.length }}</em>
            </span>
            <button
              v-if="channelInfo === 'tikhub'"
              class="mini-ok one-btn"
              :disabled="syncing || !selectedBloggers.length"
              :title="selectedBloggers.length ? `采集 ${selectedBloggers.length} 位博主的作品` : '先勾选博主'"
              @click="syncSelected"
            >
              {{ syncing ? `采集中 ${syncSec}s` : '采集' }}
            </button>
          </div>

          <div class="bp-chips">
            <button
              v-for="b in bloggers"
              :key="b.id"
              class="bp-chip"
              :class="{ on: selectedBloggers.includes(b.id) }"
              :title="`${b.nickname} · ${fmtFans(b.followerCount)} 粉丝`"
              @click="toggleBlogger(b.id)"
            >
              <img v-if="b.avatar" class="bp-ava" :src="b.avatar" alt="" referrerpolicy="no-referrer" />
              <span v-else class="bp-ava bp-ava--txt">{{ (b.nickname || '?').slice(0, 1) }}</span>
              <span class="bp-name">{{ b.nickname }}</span>
              <i class="bp-n">{{ recentCount(b) }}</i>
              <span class="bp-x" title="移除" @click.stop="removeBlogger(b.id)">×</span>
            </button>

            <!-- 添加：点开才出输入框 -->
            <div v-if="!adding" class="bp-add" @click="adding = true">
              <span class="plus">+</span>添加博主
            </div>
            <div v-else class="bp-addbox">
              <input
                v-model="newUrl"
                class="bp-input"
                placeholder="主页链接或 sec_uid"
                autofocus
                @keyup.enter="addBlogger"
                @keyup.esc="adding = false"
              />
              <button class="mini-ok" :disabled="bloggerBusy || !newUrl.trim()" @click="addBlogger">
                {{ bloggerBusy ? '…' : '确定' }}
              </button>
              <button class="mini-cancel" @click="adding = false">×</button>
            </div>
          </div>
        </div>

        <p v-if="syncing" class="sync-note">
          正在采集 {{ selectedBloggers.length }} 位博主的作品，约 {{ Math.max(3, Math.ceil(selectedBloggers.length * 2.6)) }} 秒（每 3 位并发）
        </p>
        <p v-else-if="lastSyncText" class="sync-note sync-note--done">
          上次采集 {{ lastSyncText }} · 共 {{ totalCollected }} 条，换页面 / 刷新都还在
        </p>

        <!-- 时间范围 -->
        <div class="range-row">
          <span class="range-label">看多久内发的</span>
          <div class="range-tabs">
            <button
              v-for="r in RANGES"
              :key="r.days"
              class="range-tab"
              :class="{ on: rangeDays === r.days }"
              @click="rangeDays = r.days"
            >
              {{ r.label }}
            </button>
          </div>
        </div>

<!-- 作品列表：单选 -->
        <div class="feed-head">
          <span>{{ RANGES.find((r) => r.days === rangeDays)?.label }}内作品<em v-if="feedVideos.length">{{ feedVideos.length }}</em></span>
          <span class="feed-tip">{{ pickedVideo ? '已选中 1 条 · 右侧可生成选题' : '选一条，右侧生成选题' }}</span>
        </div>

        <div v-if="!feedVideos.length" class="empty-fetch empty-fetch--sm">
          <span class="ef-ico"><Icon name="trend" :size="18" /></span>
          <p class="ef-title">
            {{ hasAnyVideo ? '这个时间段没有新作品' : '还没有作品' }}
          </p>
          <p class="ef-sub">
            <template v-if="hasAnyVideo && latestTs">
              已采集的 {{ selectedBloggers.length }} 位博主，最近一条是 {{ latestText }}，
              不在「{{ RANGES.find((r) => r.days === rangeDays)?.label }}」范围内
            </template>
            <template v-else-if="bloggers.length">
              点「采集」拉一次；如果博主更新慢，把范围放宽到近一月
            </template>
            <template v-else>
              先点「添加博主」，填一个抖音主页链接
            </template>
          </p>
          <button
            v-if="hasAnyVideo && suggestDays && suggestDays > rangeDays"
            class="ef-btn"
            @click="rangeDays = suggestDays"
          >
            放宽到{{ RANGES.find((r) => r.days === suggestDays)?.label }}
          </button>
        </div>

        <div
          v-for="v in feedVideos"
          :key="v.key"
          class="vrow"
          :class="{ on: pickedVideo?.key === v.key }"
          role="button"
          tabindex="0"
          @click="pickVideo(v)"
          @keyup.enter="pickVideo(v)"
        >
          <span class="radio"></span>
          <span class="vc-wrap" @click.stop="openPlay(v, $event)">
            <img v-if="v.cover" class="vc" :src="v.cover" alt="" referrerpolicy="no-referrer" />
            <span v-else class="vc vc--ph"></span>
            <span class="vc-play">{{ playLoading === v.key ? '…' : '▶' }}</span>
          </span>
          <span class="vm">
            <span class="vt">{{ v.title || '（无标题）' }}</span>
            <span class="vs">
              <i class="vname">{{ v.nickname }}</i>
              <span>♥ {{ fmtFans(v.likeCount) }}</span>
              <span>💬 {{ fmtFans(v.commentCount) }}</span>
              <span>⏱ {{ fmtDur(v.durationMs) }}</span>
              <span>{{ fmtWhen(v.createTime) }}</span>
            </span>
          </span>

          <!-- 选中这一条，按钮就地出现：一键提取口播文案去第二步改写 -->
          <span
            v-if="pickedVideo?.key === v.key"
            class="vrow-act"
            :class="{ busy: extractKey === v.key }"
            role="button"
            tabindex="0"
            @click.stop="extractAndNext(v)"
            @keyup.enter.stop="extractAndNext(v)"
          >
            <Icon name="sparkle" :size="12" />
            {{ extractKey === v.key ? '识别中…' : '提取文案' }}
            <Icon v-if="extractKey !== v.key" name="arrowRight" :size="11" />
          </span>
        </div>

        <p v-if="extracting" class="extract-note">
          {{ extractMsg }}
        </p>
        <p v-if="bloggerError && tab === 'bench'" class="err-line">{{ bloggerError }}</p>

        <!-- 播放弹层 -->
        <div v-if="playing" class="play-mask" @click="playing = null">
          <div class="play-box" @click.stop>
            <div class="play-head">
              <span>{{ playing.title || '预览' }}</span>
              <button class="play-x" @click="playing = null">×</button>
            </div>
            <video
              class="play-video"
              :src="playing.url"
              controls
              autoplay
              playsinline
              referrerpolicy="no-referrer"
            ></video>
            <p class="play-tip">播放链接有时效，打不开就关掉重点一次</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 右：选题 -->
    <section class="pane">
      <header class="pane-head">
        <h3>选题池</h3>
        <span class="pane-note">只管出题，不选方向</span>
      </header>

      <div class="gen-bar">
        <span class="gen-hint">
          {{ tab === 'bench'
            ? '点左边某条 → 行内「提取文案」复刻；也可以在这里提炼选题走原创'
            : '从左边素材里提炼角度 · 想写哪个方向留到第二步再选' }}
        </span>
        <div class="gen-right">
          <div class="stepper">
            <button @click="count = Math.max(1, count - 1)">−</button>
            <span>{{ count }}</span>
            <button @click="count = Math.min(10, count + 1)">+</button>
          </div>
          <button
            class="primary sm"
            :disabled="generating || (tab === 'bench' ? !pickedVideo : !picked)"
            @click="generate"
          >
            <Icon name="sparkle" :size="13" />
            {{ generating ? '生成中…' : '生成选题' }}
          </button>
        </div>
      </div>

      <p v-if="genError" class="err-line">{{ genError }}</p>
      <p v-if="searchInfo" class="search-note">
        <Icon name="trend" :size="11" />
        出题前先在抖音搜了「{{ searchInfo.keyword }}」，参考了 {{ searchInfo.items.length }} 条真实作品
      </p>

      <div class="topics">
        <div v-if="generating" class="skeleton">
          <span v-for="i in 3" :key="i" class="sk-card"></span>
        </div>
        <div v-else-if="!topics.length" class="empty">
          <Icon name="sparkle" :size="20" />
          <p>{{ tab === 'trend' ? (picked ? '点「生成选题」，围绕这条出题' : '先在左边点圆圈选一条热榜') : '左边选一条作品，点「生成选题」' }}</p>
          <span>会出 {{ count }} 条可直接拍的选题，方向留到第二步挑</span>
        </div>
        <template v-else>
          <button
            v-for="t in topics"
            :key="t.id"
            class="topic"
            :class="{ on: picked === t.id }"
            @click="picked = t.id"
          >
            <span class="topic-main">
              <span class="topic-title">{{ t.title }}</span>
              <span class="topic-tags">
                <i v-if="t.hook">钩子 · {{ t.hook }}</i>
                <i v-else-if="t.why">{{ t.why }}</i>
              </span>
            </span>
            <span class="topic-hot">
              <b>{{ t.hot }}</b>
              <em>潜力</em>
            </span>
          </button>
        </template>
      </div>

      <div class="next-bar">
        <span class="next-hint">
          {{ pickedTopic ? '已选：' + pickedTopic.title : '选一条选题，进入文案环节' }}
        </span>
        <button class="primary" :disabled="!pickedTopic" @click="emit('next', pickedTopic)">
          下一步 · 写文案
          <Icon name="arrowRight" :size="14" />
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.step {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 14px;
  align-items: start;
}

.pane {
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 10px 28px rgba(60, 60, 110, 0.06);
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  /* 固定高度：内容再多也在框内滚动，不把整页撑长 */
  height: clamp(440px, calc(100vh - 300px), 780px);
  overflow: hidden;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.pane-head h3 {
  font-size: 13.5px;
  font-weight: 600;
  color: #26263a;
}

.pane-note {
  font-size: 10.5px;
  color: #a3a3b7;
}

.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 9px;
  background: rgba(244, 244, 250, 0.95);
  gap: 2px;
}

.seg button {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 7px;
  color: #6f6f86;
  transition: all 0.16s ease;
}

.seg button.on {
  background: #fff;
  color: #1d1d2b;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(40, 40, 80, 0.1);
}

.list {
  flex: 1;
  min-height: 0; /* flex 子项要能滚必须有这行 */
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0 -4px;
  padding: 0 4px 2px;
}

/* 细滚动条，别太抢眼 */
.list::-webkit-scrollbar,
.topics::-webkit-scrollbar {
  width: 6px;
}
.list::-webkit-scrollbar-thumb,
.topics::-webkit-scrollbar-thumb {
  background: rgba(40, 40, 80, 0.14);
  border-radius: 999px;
}
.list::-webkit-scrollbar-thumb:hover,
.topics::-webkit-scrollbar-thumb:hover {
  background: rgba(40, 40, 80, 0.26);
}
.list::-webkit-scrollbar-track,
.topics::-webkit-scrollbar-track {
  background: transparent;
}

.empty-fetch {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 46px 20px 34px;
}
.ef-ico {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #4f7df3;
  background: rgba(79, 125, 243, 0.08);
  border: 1px solid rgba(79, 125, 243, 0.16);
  margin-bottom: 14px;
}
.ef-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #2a2a40;
}
.ef-sub {
  margin-top: 6px;
  font-size: 11px;
  color: #8c8ca4;
  line-height: 1.5;
  max-width: 300px;
}
.ef-btn {
  margin-top: 16px;
  height: 34px;
  padding: 0 20px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  border: none;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  box-shadow: 0 6px 16px rgba(79, 125, 243, 0.28);
  cursor: pointer;
  transition: all 0.16s ease;
}
.ef-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(79, 125, 243, 0.34);
}
.plat-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding-bottom: 9px;
}

.plat {
  font-size: 10.5px;
  padding: 3.5px 9px;
  border-radius: 7px;
  color: #6f6f86;
  background: rgba(246, 246, 252, 0.9);
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.plat:hover {
  color: #33334a;
}

.plat.on {
  background: rgba(255, 240, 250, 0.95);
  border-color: rgba(255, 206, 238, 0.9);
  color: #8a4f7d;
  font-weight: 500;
}


/* ---- 博主多选 ---- */
.bp-block {
  margin-bottom: 10px;
}
.bp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}
.bp-title {
  font-size: 11px;
  color: #8c8ca4;
  display: flex;
  align-items: center;
  gap: 6px;
}
.bp-title em {
  font-style: normal;
  font-size: 9.5px;
  color: #2f5cd6;
  background: rgba(79, 125, 243, 0.1);
  padding: 1px 7px;
  border-radius: 999px;
}
.bp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bp-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(30, 30, 60, 0.09);
  font-size: 11.5px;
  color: #5f5f78;
  transition: all 0.15s ease;
  max-width: 220px;
}
.bp-chip:hover {
  border-color: rgba(79, 125, 243, 0.3);
}
.bp-chip.on {
  background: rgba(79, 125, 243, 0.08);
  border-color: rgba(79, 125, 243, 0.45);
  color: #2f5cd6;
  font-weight: 500;
}
.bp-ava {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 auto;
  background: #e8ecf6;
}
.bp-ava--txt {
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(150deg, #8fb3f7, #6d9cfb);
}
.bp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-n {
  font-style: normal;
  font-size: 9.5px;
  color: #a0a0b4;
  background: rgba(40, 40, 80, 0.05);
  padding: 1px 5px;
  border-radius: 999px;
}
.bp-chip.on .bp-n {
  color: #2f5cd6;
  background: rgba(79, 125, 243, 0.12);
}
.bp-x {
  font-size: 12px;
  color: #c8c8d6;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.bp-chip:hover .bp-x {
  opacity: 1;
}
.bp-x:hover {
  color: #d0503a;
}
.bp-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px dashed rgba(79, 125, 243, 0.4);
  font-size: 11.5px;
  color: #5f7fc4;
  cursor: pointer;
  transition: all 0.15s ease;
}
.bp-add:hover {
  background: rgba(79, 125, 243, 0.06);
  border-color: rgba(79, 125, 243, 0.7);
}
.plus {
  font-size: 13px;
  line-height: 1;
}
.bp-addbox {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
}
.bp-input {
  width: 190px;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 11.5px;
  border: 1px solid rgba(79, 125, 243, 0.45);
  background: #fff;
  outline: none;
}
.mini-ok {
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 11px;
  color: #fff;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  border: none;
}
.mini-ok:disabled {
  opacity: 0.5;
}
.mini-cancel {
  height: 30px;
  width: 24px;
  border-radius: 8px;
  font-size: 13px;
  color: #9a9ab0;
  background: transparent;
}
.mini-cancel:hover {
  background: rgba(40, 40, 80, 0.06);
}

/* ---- 时间范围 ---- */
.sync-note {
  font-size: 10.5px;
  color: #6d8a6f;
  background: rgba(237, 249, 240, 0.9);
  border: 1px solid rgba(70, 185, 138, 0.2);
  border-radius: 8px;
  padding: 6px 9px;
  margin-bottom: 8px;
  line-height: 1.5;
}
/* 采完之后的常驻提示：不抢眼，但让他知道数据在 */
.sync-note--done {
  color: #7d8598;
  background: rgba(246, 247, 251, 0.9);
  border-color: rgba(30, 30, 60, 0.07);
  padding: 5px 9px;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.range-label {
  font-size: 10.5px;
  color: #a0a0b4;
  flex: 0 0 auto;
}
.range-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(244, 244, 250, 0.95);
}
.range-tab {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 7px;
  color: #6f6f86;
  transition: all 0.15s ease;
}
.range-tab:hover {
  color: #33334a;
}
.range-tab.on {
  background: #fff;
  color: #1d1d2b;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(40, 40, 80, 0.1);
}

/* ---- 单条采集 ---- */
.one-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.one-input {
  flex: 1;
  height: 32px;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 11.5px;
  color: #22223a;
  border: 1px solid rgba(30, 30, 60, 0.09);
  background: rgba(255, 255, 255, 0.9);
  outline: none;
}
.one-input:focus {
  border-color: rgba(79, 125, 243, 0.45);
}
.one-btn {
  height: 32px;
  min-width: 64px;      /* 两个采集按钮定死同宽，字数不一样也齐 */
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

/* ---- 作品列表 ---- */
.feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 2px 8px;
  border-top: 1px solid rgba(30, 30, 60, 0.05);
  margin-top: 4px;
}
.feed-head > span:first-child {
  font-size: 11px;
  color: #8c8ca4;
  display: flex;
  align-items: center;
  gap: 5px;
}
.feed-head em {
  font-style: normal;
  font-size: 9.5px;
  color: #6d7a99;
  background: rgba(40, 40, 80, 0.06);
  padding: 1px 6px;
  border-radius: 999px;
}
.feed-tip {
  font-size: 10px;
  color: #b0b0c2;
}
.vrow {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border-radius: 10px;
  text-align: left;
  background: transparent;   /* 原来是 button，改成 div 后要手动重置 */
  border: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition: background 0.14s ease, box-shadow 0.14s ease;
  margin-bottom: 3px;
}
.vrow:hover {
  background: rgba(255, 255, 255, 0.9);
}
.vrow.on {
  background: linear-gradient(100deg, rgba(240, 246, 255, 0.96), rgba(250, 245, 255, 0.92));
  box-shadow: inset 0 0 0 1px rgba(79, 125, 243, 0.28);
}
/* 选中行才出现的动作按钮：提取文案 → 去第二步 */
.vrow-act {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 11px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  box-shadow: 0 3px 10px rgba(79, 125, 243, 0.3);
  cursor: pointer;
  user-select: none;
  transition: filter 0.15s ease;
  animation: actIn 0.16s ease;
}
.vrow-act:hover {
  filter: brightness(1.07);
}
.vrow-act.busy {
  background: linear-gradient(150deg, #a9bce6, #8fa6d8);
  box-shadow: none;
  cursor: progress;
}
@keyframes actIn {
  from { opacity: 0; transform: translateX(4px); }
  to { opacity: 1; transform: translateX(0); }
}
.extract-note {
  font-size: 10.5px;
  color: #6d7a99;
  padding: 6px 9px;
  margin-top: 2px;
  background: rgba(240, 246, 255, 0.9);
  border: 1px solid rgba(79, 125, 243, 0.16);
  border-radius: 8px;
}
.radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid rgba(30, 30, 60, 0.18);
  flex: 0 0 auto;
  position: relative;
  transition: all 0.14s ease;
}
.vrow.on .radio,
.row.on .radio {
  border-color: #4f7df3;
  background: #4f7df3;
}
.vrow.on .radio::after,
.row.on .radio::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fff;
}
.vc-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}
.vc-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(20, 20, 35, 0.28);
  color: #fff;
  font-size: 13px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.vc-wrap:hover .vc-play {
  opacity: 1;
}
.play-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(18, 18, 30, 0.55);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  padding: 24px;
}
.play-box {
  width: min(420px, 92vw);
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.play-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  font-size: 11.5px;
  color: #33334a;
  border-bottom: 1px solid rgba(30, 30, 60, 0.06);
}
.play-head span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.play-x {
  font-size: 16px;
  color: #9a9ab0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex: 0 0 auto;
}
.play-x:hover {
  background: rgba(40, 40, 80, 0.07);
}
.play-video {
  width: 100%;
  max-height: 70vh;
  display: block;
  background: #000;
}
.play-tip {
  font-size: 10px;
  color: #a8a8bc;
  padding: 7px 12px;
}
.vc {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  flex: 0 0 auto;
  background: #eef0f6;
}
.vc--ph {
  display: block;
}
.vm {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.vt {
  font-size: 12px;
  color: #2a2a40;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.vs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 10px;
  color: #a5a5b8;
}
.vname {
  font-style: normal;
  color: #7d8fbf;
}
.empty-fetch--sm {
  padding: 18px 10px 10px;
}
.empty-fetch--sm .ef-title {
  font-size: 12px;
}
.empty-fetch--sm .ef-sub {
  font-size: 10.5px;
}
.empty-fetch--sm .ef-btn {
  margin-top: 12px;
  height: 30px;
  padding: 0 16px;
  font-size: 11.5px;
  border-radius: 9px;
}

.dy-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 10px;
  background: rgba(255, 193, 92, 0.1);
  border: 1px solid rgba(214, 158, 46, 0.22);
  margin-bottom: 10px;
}
.dy-bar.on {
  background: rgba(70, 185, 138, 0.09);
  border-color: rgba(70, 185, 138, 0.24);
}
.dy-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d69e2e;
  flex: 0 0 auto;
}
.dy-bar.on .dy-dot {
  background: #46b98a;
}
.dy-txt {
  flex: 1;
  font-size: 11px;
  color: #7a6a3a;
}
.dy-bar.on .dy-txt {
  color: #2f7a5c;
}
.add-row {
  display: flex;
  gap: 7px;
  margin-bottom: 6px;
}
.add-inp {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 11.5px;
  color: #22223a;
  background: #fff;
  border: 1px solid rgba(30, 30, 60, 0.11);
  outline: none;
}
.add-inp:focus {
  border-color: rgba(79, 125, 243, 0.5);
  box-shadow: 0 0 0 3px rgba(79, 125, 243, 0.1);
}
.add-btn {
  flex: 0 0 auto;
  height: 32px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 600;
  color: #fff;
  border: none;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
}
.add-btn:disabled {
  opacity: 0.55;
}
.add-hint {
  font-size: 10px;
  color: #a8a8bc;
  margin-bottom: 10px;
}
.search-note {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #6d8fbf;
  background: rgba(79, 125, 243, 0.06);
  border-radius: 8px;
  padding: 6px 9px;
  margin-bottom: 8px;
  line-height: 1.45;
}
.err-line {
  font-size: 11px;
  color: #d0503a;
  margin-bottom: 8px;
  line-height: 1.45;
}
.avatar-img {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 auto;
  background: #eef0f6;
}
.del-btn {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #c0c0d0;
  font-size: 15px;
  line-height: 1;
}
.del-btn:hover {
  background: rgba(208, 80, 58, 0.1);
  color: #d0503a;
}
.video-cover {
  width: 38px;
  height: 50px;
  border-radius: 6px;
  object-fit: cover;
  flex: 0 0 auto;
  background: #eceef4;
}
.video-cover--ph {
  display: block;
}
.video-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.video-title {
  font-size: 11.5px;
  color: #3a3a52;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.video-stats {
  display: flex;
  gap: 9px;
  font-size: 10px;
  color: #9a9ab0;
}
.videos-empty {
  font-size: 11px;
  color: #a8a8bc;
  padding: 6px 0;
}
.list-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: #a5a5b8;
  padding: 0 2px 8px;
}

.list-meta .err {
  color: #d4756b;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: #6d8fc4;
  padding: 2px 5px;
  border-radius: 6px;
}

.link-btn:hover {
  background: rgba(109, 143, 196, 0.1);
}

.notice {
  font-size: 10px;
  color: #b08a6a;
  background: rgba(255, 246, 235, 0.9);
  border: 1px solid rgba(255, 226, 198, 0.9);
  border-radius: 8px;
  padding: 6px 9px;
  margin-bottom: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px;
  border-radius: 10px;
  text-align: left;
  transition: background 0.15s ease;
}

.row:hover {
  background: rgba(246, 246, 252, 0.9);
}

.row.on {
  background: linear-gradient(100deg, rgba(255, 238, 249, 0.9), rgba(244, 248, 255, 0.9));
  box-shadow: inset 0 0 0 1px rgba(79, 125, 243, 0.28);
}

.row-rank {
  width: 18px;
  font-size: 11.5px;
  font-weight: 700;
  color: #b9b9cb;
  text-align: center;
  flex: 0 0 auto;
}

.row-rank.top {
  color: #f07a5f;
}

.row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: 12.5px;
  color: #2c2c40;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub {
  font-size: 10.5px;
  color: #a5a5b8;
}

.blogger {
  border-radius: 10px;
  margin-bottom: 2px;
}

.blogger-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border-radius: 10px;
  text-align: left;
}

.blogger-head:hover {
  background: rgba(246, 246, 252, 0.9);
}

.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #6a7a9c;
  background: linear-gradient(150deg, #e6edfa, #d3dff5);
  flex: 0 0 auto;
}

.blogger-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.blogger-meta strong {
  font-size: 12px;
  font-weight: 600;
  color: #2c2c40;
}

.blogger-meta em {
  font-style: normal;
  font-size: 10px;
  color: #a5a5b8;
}

.caret {
  color: #b0b0c2;
  transition: transform 0.2s ease;
}

.caret.open {
  transform: rotate(180deg);
}

.videos {
  padding: 2px 0 6px 44px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.video-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;
  font-size: 11.5px;
}

.video-row:hover {
  background: rgba(246, 246, 252, 0.95);
}

.video-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d5d5e2;
  flex: 0 0 auto;
}

.video-dot.live {
  background: #4fcaa0;
}

.video-title {
  flex: 1;
  color: #45455c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-stat {
  font-size: 10px;
  color: #a9a9bc;
  flex: 0 0 auto;
}

.gen-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(30, 30, 60, 0.06);
  margin-bottom: 10px;
}




.gen-right {
  display: flex;
  align-items: center;
  gap: 7px;
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(244, 244, 250, 0.95);
}

.stepper button {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 13px;
  color: #6f6f86;
  display: grid;
  place-items: center;
}

.stepper button:hover {
  background: #fff;
}

.stepper span {
  font-size: 11.5px;
  min-width: 16px;
  text-align: center;
  color: #33334a;
}

.search-note {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #6d8fbf;
  background: rgba(79, 125, 243, 0.06);
  border-radius: 8px;
  padding: 6px 9px;
  margin-bottom: 8px;
  line-height: 1.45;
}
.err-line {
  font-size: 10.5px;
  color: #d4756b;
  padding: 0 2px 8px;
}

.primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  box-shadow: 0 3px 10px rgba(79, 125, 243, 0.28);
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.primary.sm {
  height: 28px;
  padding: 0 11px;
  font-size: 11.5px;
}

.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

.primary:disabled {
  opacity: 0.42;
  box-shadow: none;
  cursor: not-allowed;
}


/* ---- 八大爆款元素 ---- */
.el-tag {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 600;
  color: #b06a2a;
  background: rgba(214, 158, 46, 0.12);
  padding: 2px 6px;
  border-radius: 5px;
}
/* ---- 列表行上的「写稿 ›」 ---- */
.row-go {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: #4f7df3;
  opacity: 0.5;
  transition: opacity 0.14s ease;
  padding: 2px 4px;
  border-radius: 5px;
}
.row:hover .row-go,
.video-row:hover .row-go {
  opacity: 1;
}
.row-go:hover {
  background: rgba(79, 125, 243, 0.1);
}
.topics {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: #b0b0c2;
  text-align: center;
  padding: 30px 10px;
}

.empty p {
  font-size: 12px;
  color: #7c7c94;
  font-weight: 500;
}

.empty span {
  font-size: 10.5px;
}

.topic {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 11px;
  border: 1px solid rgba(30, 30, 60, 0.06);
  background: rgba(255, 255, 255, 0.6);
  text-align: left;
  transition: all 0.16s ease;
}

.topic:hover {
  border-color: rgba(79, 125, 243, 0.28);
  background: #fff;
}

.topic.on {
  border-color: rgba(79, 125, 243, 0.55);
  background: linear-gradient(100deg, rgba(240, 246, 255, 0.95), rgba(250, 245, 255, 0.9));
  box-shadow: 0 3px 12px rgba(79, 125, 243, 0.12);
}

.topic-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.topic-title {
  font-size: 12.5px;
  font-weight: 500;
  color: #23233a;
  line-height: 1.42;
}

.topic-tags {
  display: flex;
  align-items: center;
  gap: 6px;
}

.topic-tags em {
  font-style: normal;
  font-size: 9.5px;
  padding: 1.5px 6px;
  border-radius: 5px;
  background: rgba(236, 240, 252, 0.95);
  color: #6d84b8;
}

.topic-tags i {
  font-style: normal;
  font-size: 10px;
  color: #a5a5b8;
}

.topic-hot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}

.topic-hot b {
  font-size: 14px;
  font-weight: 700;
  color: #e2647a;
}

.topic-hot em {
  font-style: normal;
  font-size: 9px;
  color: #b9b9cb;
}

.next-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid rgba(30, 30, 60, 0.06);
}

.next-hint {
  font-size: 11px;
  color: #a5a5b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px;
}

.sk-row,
.sk-card {
  display: block;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(
    90deg,
    rgba(240, 240, 248, 0.9),
    rgba(248, 248, 252, 0.9),
    rgba(240, 240, 248, 0.9)
  );
  background-size: 200% 100%;
  animation: shimmer 1.3s linear infinite;
}

.sk-card {
  height: 58px;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@media (max-width: 1100px) {
  .step {
    grid-template-columns: minmax(0, 1fr);
  }
  .pane {
    height: auto;
    min-height: 380px;
    max-height: 70vh;
  }
}
</style>
