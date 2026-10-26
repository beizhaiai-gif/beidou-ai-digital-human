<template>
  <Teleport to="body">
    <div v-if="open" class="se-mask" @click.self="requestClose">
      <section class="se-panel">
        <header class="se-head">
          <div class="se-title">
            <h3>改分镜卡片</h3>
            <p v-if="doc" class="se-sub">
              {{ doc.shots.length }} 镜 · {{ fmtTime(doc.totalSec) }} · 第 {{ doc.revision || 1 }} 版
              <span v-if="dirtyCount" class="se-dirty">{{ dirtyCount }} 处未保存</span>
            </p>
          </div>
          <button class="se-x" title="关闭" @click="requestClose">
            <Icon name="close" :size="15" />
          </button>
        </header>

        <p v-if="error" class="se-err">{{ error }}</p>

        <div v-if="loading" class="se-load">
          <i class="spin"></i>
          读取分镜底稿…
        </div>

        <template v-else-if="doc">
          <p class="se-tip">
            换卡只改画面，不动配音和时长 —— 时间轴一帧都不变，所以改完还是对得上。
          </p>

          <div class="se-list thin-scroll">
            <article v-for="(s, i) in rows" :key="s.id" class="se-row" :class="{ on: s.$open }">
              <div class="se-bar" @click="s.$open = !s.$open">
                <span class="se-idx">{{ i + 1 }}</span>
                <span class="se-tc">{{ s.startSec.toFixed(1) }}–{{ (s.startSec + s.durationSec).toFixed(1) }}s</span>
                <span class="se-dur">{{ s.durationSec.toFixed(1) }}s</span>
                <i class="se-kind" :class="s.kind">{{ s.kind === 'person' ? '人物' : '卡片' }}</i>
                <span class="se-cardname">{{ cardName(s.card) }}</span>
                <span v-if="dirty.has(s.id)" class="se-dot"></span>
                <Icon :name="s.$open ? 'chevronDown' : 'chevron'" :size="13" class="se-cv" />
              </div>

              <div v-if="s.$open" class="se-body">
                <p class="se-line">{{ s.text || '（这一镜没有台词）' }}</p>

                <div class="se-grid">
                  <label class="se-f">
                    <span>出镜方式</span>
                    <div class="se-seg">
                      <button
                        :class="{ act: s.kind === 'person' }"
                        @click="setKind(s, 'person')"
                      >
                        纯人物
                      </button>
                      <button :class="{ act: s.kind === 'card' }" @click="setKind(s, 'card')">
                        铺卡片
                      </button>
                    </div>
                  </label>

                  <label class="se-f">
                    <span>卡片</span>
                    <select :value="s.card" :disabled="s.kind === 'person'" @change="onCard(s, $event)">
                      <optgroup label="卡片">
                        <option v-for="c in cardOptions" :key="c.id" :value="c.id">
                          {{ c.name }}（{{ c.category }}）
                        </option>
                      </optgroup>
                    </select>
                  </label>
                </div>

                <p v-if="s.kind === 'person'" class="se-note">人物镜不铺卡片，只出人像 + 字幕。</p>

                <template v-else>
                  <p v-if="!slotsOf(s.card).length" class="se-note">这张卡是纯画面，不用填文案。</p>
                  <div v-else class="se-fields">
                    <label v-for="slot in slotsOf(s.card)" :key="slot.k" class="se-f full">
                      <span>
                        {{ slot.label }}
                        <em v-if="slot.req">必填</em>
                        <b>≤{{ slot.max }} 字</b>
                      </span>
                      <textarea
                        v-if="isArr(s, slot.k)"
                        rows="2"
                        :value="fieldText(s, slot.k)"
                        :placeholder="'一行一条，最多 ' + (arrMin(s.card, slot.k) || 1) + ' 条起'"
                        @input="setField(s, slot.k, $event.target.value)"
                      ></textarea>
                      <input
                        v-else
                        :value="fieldText(s, slot.k)"
                        :maxlength="slot.max + 8"
                        @input="setField(s, slot.k, $event.target.value)"
                      />
                    </label>
                  </div>
                </template>
              </div>
            </article>
          </div>
        </template>

        <footer class="se-foot">
          <p v-if="progress" class="se-prog">{{ progress }}</p>
          <p v-else-if="savedMsg" class="se-saved">{{ savedMsg }}</p>
          <p v-else class="se-hint">改完点右边重渲，大约 2–3 分钟（和成片时长相关）</p>

          <div class="se-acts">
            <button class="se-btn" :disabled="busy" @click="requestClose">
              {{ busy ? '渲染中…' : '关闭' }}
            </button>
            <button
              class="se-btn primary"
              :disabled="busy || !dirtyCount"
              @click="save"
            >
              <Icon name="sparkle" :size="13" />
              {{ busy ? '重渲中…' : dirtyCount ? `保存并重渲（${dirtyCount}）` : '没有改动' }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Icon from '../Icon.vue'

const props = defineProps({
  jobId: { type: String, default: '' },
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'done'])

const loading = ref(false)
const busy = ref(false)
const error = ref('')
const savedMsg = ref('')
const progress = ref('')
const doc = ref(null)
const rows = ref([])
const cards = ref([])
const dirty = ref(new Set())
let pollTimer = null

const cardMap = computed(() => Object.fromEntries(cards.value.map((c) => [c.id, c])))
const cardOptions = computed(() => cards.value.filter((c) => c.usable && !c.tail && !c.person))
const dirtyCount = computed(() => dirty.value.size)

function cardName(id) {
  return cardMap.value[id]?.name || id || '—'
}
function slotsOf(id) {
  return cardMap.value[id]?.slots || []
}
function arrMin(id, k) {
  return cardMap.value[id]?.arrMin?.[k]
}
function isArr(s, k) {
  const v = s.fields?.[k]
  return Array.isArray(v) || k in (cardMap.value[s.card]?.arrMin || {})
}
function fieldText(s, k) {
  const v = s.fields?.[k]
  return Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v)
}

function markDirty(s) {
  dirty.value = new Set([...dirty.value, s.id])
}

function setField(s, k, val) {
  const next = { ...(s.fields || {}) }
  if (isArr(s, k)) {
    next[k] = String(val)
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
  } else {
    next[k] = val
  }
  s.fields = next
  markDirty(s)
}

function setKind(s, kind) {
  if (s.kind === kind) return
  s.kind = kind
  if (kind === 'card') {
    const usable = cardOptions.value
    // 人镜默认卡是 host-shrink-to-chip，不是真卡片，切过来要给一张能用的
    if (!usable.some((c) => c.id === s.card)) s.card = usable[0]?.id || 'line-by-line-slide'
  }
  markDirty(s)
}

function onCard(s, e) {
  const id = e.target.value
  if (id === s.card) return
  s.card = id
  // 换卡只保留同名文案位 —— 剩下的全是这张卡不认识的，留着会渲染出脏数据
  const keep = {}
  for (const slot of slotsOf(id)) {
    const v = s.fields?.[slot.k]
    if (v != null && String(v).trim() !== '') keep[slot.k] = v
  }
  s.fields = keep
  markDirty(s)
}

async function load() {
  if (!props.jobId) return
  loading.value = true
  error.value = ''
  savedMsg.value = ''
  progress.value = ''
  dirty.value = new Set()
  try {
    const r = await fetch(`/api/works/${props.jobId}/shotlist`)
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '读取失败')
    cards.value = d.data.cards || []
    doc.value = { ...d.data, shots: d.data.shots }
    rows.value = (d.data.shots || []).map((s, i) => ({
      ...s,
      fields: JSON.parse(JSON.stringify(s.fields || {})),
      $open: i === 0,
    }))
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!dirty.value.size || busy.value) return
  busy.value = true
  error.value = ''
  savedMsg.value = ''
  progress.value = '提交中…'
  try {
    const shots = rows.value
      .filter((s) => dirty.value.has(s.id))
      .map((s) => ({ id: s.id, kind: s.kind, card: s.card, fields: s.fields }))
    const r = await fetch(`/api/works/${props.jobId}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots }),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || '提交失败')
    dirty.value = new Set()
    emit('done', { jobId: props.jobId, pending: true })
    await poll()
  } catch (e) {
    error.value = String(e.message || e)
    progress.value = ''
    busy.value = false
  }
}

function poll() {
  return new Promise((resolve) => {
    const jobId = props.jobId
    const tick = async () => {
      try {
        const r = await fetch(`/api/edit/${jobId}`)
        const d = await r.json()
        const t = d.data || {}
        if (d.ok && (t.status === 'SUCCESS' || t.status === 'FAILED')) {
          clearInterval(pollTimer)
          pollTimer = null
          busy.value = false
          progress.value = ''
          if (t.status === 'FAILED') {
            error.value = t.error || '重渲失败'
          } else {
            savedMsg.value = `已重渲完成（第 ${t.revision || doc.value?.revision || 1} 版）`
            await load()
            emit('done', { jobId, pending: false })
          }
          resolve()
          return
        }
        progress.value = `重渲中… ${t.step || '排队'}${t.progress ? ' · ' + t.progress + '%' : ''}`
      } catch {
        /* 网络抖动不打断轮询 */
      }
    }
    tick()
    pollTimer = setInterval(tick, 2500)
  })
}

function fmtTime(s) {
  const m = Math.floor((s || 0) / 60)
  const r = (s || 0) - m * 60
  return `${m}:${r.toFixed(0).padStart(2, '0')}`
}

function requestClose() {
  if (busy.value) return
  if (dirty.value.size && !window.confirm('还有改动没保存，确定关掉？')) return
  clearInterval(pollTimer)
  pollTimer = null
  emit('close')
}

watch(
  () => props.open,
  (v) => {
    if (v) load()
    else {
      clearInterval(pollTimer)
      pollTimer = null
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.se-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(22, 22, 40, 0.34);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.se-panel {
  width: min(880px, 100%);
  max-height: min(86vh, 900px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 70px rgba(20, 20, 50, 0.24);
  overflow: hidden;
}

.se-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(30, 30, 60, 0.07);
}
.se-title h3 {
  margin: 0 0 3px;
  font-size: 15px;
  font-weight: 700;
  color: #1c1c30;
}
.se-sub {
  margin: 0;
  font-size: 11px;
  color: #9a9ab0;
}
.se-dirty {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(224, 69, 44, 0.1);
  color: #c0563a;
  font-size: 10px;
}
.se-x {
  border: 0;
  background: rgba(30, 30, 60, 0.05);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #6d6d86;
  cursor: pointer;
}
.se-x:hover {
  background: rgba(30, 30, 60, 0.09);
}

.se-tip {
  margin: 0;
  padding: 10px 18px;
  font-size: 11px;
  color: #7b7b95;
  background: rgba(79, 125, 243, 0.05);
  border-bottom: 1px solid rgba(79, 125, 243, 0.08);
}

.se-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.se-row {
  /* 31 行会把 flex 容器撑爆，不锁住就会被全部压扁成一条线 */
  flex: 0 0 auto;
  border: 1px solid rgba(30, 30, 60, 0.07);
  border-radius: 10px;
  background: #fcfcfe;
  overflow: hidden;
}
.se-row.on {
  border-color: rgba(79, 125, 243, 0.28);
  background: #fff;
  box-shadow: 0 4px 14px rgba(60, 80, 160, 0.06);
}

.se-bar {
  display: grid;
  grid-template-columns: 30px 92px 46px 40px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
}
.se-bar:hover {
  background: rgba(79, 125, 243, 0.035);
}
.se-idx {
  font-size: 10.5px;
  font-weight: 700;
  color: #a4a4bb;
}
.se-tc {
  font-size: 10.5px;
  color: #8686a0;
  font-variant-numeric: tabular-nums;
}
.se-dur {
  font-size: 10.5px;
  color: #8686a0;
  font-variant-numeric: tabular-nums;
}
.se-kind {
  font-style: normal;
  font-size: 9.5px;
  text-align: center;
  padding: 1px 0;
  border-radius: 999px;
  background: rgba(40, 40, 80, 0.06);
  color: #6d7a99;
}
.se-kind.card {
  background: rgba(79, 125, 243, 0.1);
  color: #3a5fd0;
}
.se-cardname {
  font-size: 11.5px;
  color: #2a2a44;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.se-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e0452c;
}
.se-cv {
  color: #b0b0c4;
}

.se-body {
  padding: 0 12px 12px 42px;
  border-top: 1px dashed rgba(30, 30, 60, 0.08);
  margin-top: 2px;
  padding-top: 10px;
}
.se-line {
  margin: 0 0 10px;
  font-size: 11.5px;
  line-height: 1.65;
  color: #55556e;
  background: rgba(40, 40, 80, 0.03);
  padding: 8px 10px;
  border-radius: 8px;
}

.se-grid {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 10px;
  margin-bottom: 10px;
}
.se-f {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.se-f > span {
  font-size: 10px;
  color: #8a8aa4;
  display: flex;
  align-items: center;
  gap: 5px;
}
.se-f > span em {
  font-style: normal;
  color: #c0563a;
  font-size: 9px;
}
.se-f > span b {
  font-weight: 400;
  color: #b6b6c8;
  font-size: 9px;
}
.se-f input,
.se-f select,
.se-f textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(30, 30, 60, 0.12);
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 11.5px;
  font-family: inherit;
  color: #1c1c30;
  background: #fff;
  outline: none;
  resize: vertical;
}
.se-f input:focus,
.se-f select:focus,
.se-f textarea:focus {
  border-color: rgba(79, 125, 243, 0.55);
  box-shadow: 0 0 0 3px rgba(79, 125, 243, 0.1);
}
.se-f select:disabled {
  background: #f4f4f8;
  color: #a4a4bb;
}

.se-seg {
  display: flex;
  border: 1px solid rgba(30, 30, 60, 0.12);
  border-radius: 7px;
  overflow: hidden;
}
.se-seg button {
  flex: 1;
  border: 0;
  background: #fff;
  padding: 6px 0;
  font-size: 11px;
  color: #6d6d86;
  cursor: pointer;
  font-family: inherit;
}
.se-seg button.act {
  background: rgba(79, 125, 243, 0.12);
  color: #3a5fd0;
  font-weight: 600;
}

.se-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.se-fields .full {
  grid-column: 1 / -1;
}

.se-note {
  margin: 0 0 8px;
  font-size: 10.5px;
  color: #a0a0b6;
}

.se-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid rgba(30, 30, 60, 0.07);
  background: #fbfbfd;
}
.se-hint,
.se-prog,
.se-saved {
  margin: 0;
  font-size: 10.5px;
  color: #9a9ab0;
}
.se-prog {
  color: #3a5fd0;
}
.se-saved {
  color: #2f7d5c;
}
.se-acts {
  display: flex;
  gap: 8px;
}
.se-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(30, 30, 60, 0.12);
  background: #fff;
  font-size: 11.5px;
  color: #5f5f78;
  cursor: pointer;
  font-family: inherit;
}
.se-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.se-btn.primary {
  background: #1c1c30;
  border-color: #1c1c30;
  color: #fff;
}
.se-btn.primary:disabled {
  background: rgba(28, 28, 48, 0.35);
  border-color: transparent;
}

.se-load {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 11.5px;
  color: #8a8aa4;
  padding: 60px 0;
}
.spin {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(79, 125, 243, 0.2);
  border-top-color: #4f7df3;
  animation: sp 0.8s linear infinite;
}
@keyframes sp {
  to {
    transform: rotate(360deg);
  }
}

.se-err {
  margin: 10px 18px 0;
  font-size: 11px;
  color: #c0563a;
  background: rgba(224, 69, 44, 0.06);
  padding: 8px 10px;
  border-radius: 8px;
}
</style>
