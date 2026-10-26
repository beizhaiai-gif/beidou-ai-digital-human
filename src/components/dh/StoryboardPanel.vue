<script setup>
import { ref, computed } from 'vue'
import Icon from '../Icon.vue'
import { readStore, writeStore } from '../../lib/store.js'

const props = defineProps({
  script: { type: String, default: '' },
})

/** 上次生成的结果存档：切菜单 / 刷新回来还在 */
const SAVED = readStore('board', {}) || {}

const shots = ref(SAVED.shots || [])
const stats = ref(SAVED.stats || null)
const total = ref(SAVED.total || 0)
const at = ref(SAVED.at || 0)

const busy = ref(false)
const sec = ref(0)
const errorMsg = ref('')
let timer = null

const hasScript = computed(() => Boolean(props.script && props.script.trim()))

function fmtTime(s) {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

/** 卡上文案：keyword-pop 只显示被强调的词（整句已经在台词列了），其余逐键列出 */
function fieldsText(s) {
  const f = s.fields || {}
  if (s.card === 'keyword-pop-highlight') {
    return f.keyword ? `整句字幕 · 弹出「${f.keyword}」` : '整句字幕'
  }
  const parts = Object.entries(f)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => (Array.isArray(v) ? `${k} ${v.join(' / ')}` : k === 'line1' ? v : `${k} ${v}`))
  return parts.length ? parts.join(' · ') : '—'
}

/** 秒数只留一位小数，表格里更干净 */
function fmtDur(d) {
  return Number(d).toFixed(1)
}

function fmtAt(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function generate() {
  if (busy.value || !hasScript.value) return
  busy.value = true
  sec.value = 0
  errorMsg.value = ''
  timer = setInterval(() => (sec.value += 1), 1000)
  try {
    const r = await fetch('/api/storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: props.script }),
    })
    const d = await r.json()
    if (!d.ok) {
      errorMsg.value = d.error || '生成失败'
      return
    }
    shots.value = d.shots || []
    stats.value = d.stats || null
    total.value = d.total || 0
    at.value = Date.now()
    writeStore('board', {
      shots: shots.value,
      stats: stats.value,
      total: total.value,
      at: at.value,
    })
  } catch (e) {
    errorMsg.value = String(e.message || e)
  } finally {
    clearInterval(timer)
    busy.value = false
  }
}
</script>

<template>
  <section class="board">
    <header class="bd-head">
      <div class="bd-title">
        <h3>分镜口播稿</h3>
        <span v-if="at" class="bd-when">{{ fmtAt(at) }} · {{ shots.length }} 镜</span>
        <span v-else class="bd-when">按 3–5 秒一句切，逐段配卡</span>
      </div>
      <div class="bd-acts">
        <span v-if="!hasScript" class="need">还没有口播稿 · 先去第 ② 步写一版</span>
        <button class="primary sm" :disabled="busy || !hasScript" @click="generate">
          <Icon name="sparkle" :size="13" />
          {{ busy ? `生成中… ${sec}s` : shots.length ? '重新生成' : '生成分镜稿' }}
        </button>
      </div>
    </header>

    <div v-if="stats" class="bd-stats">
      <div class="st">
        <b>{{ fmtTime(total) }}</b>
        <em>总时长</em>
      </div>
      <div class="st">
        <b>{{ stats.count }}</b>
        <em>镜数</em>
      </div>
      <div class="st">
        <b>{{ stats.avgDur }}s</b>
        <em>平均每镜</em>
      </div>
      <div class="st">
        <b>{{ stats.person }}</b>
        <em>纯人物镜 {{ stats.personPct }}%</em>
      </div>
      <div class="st-cards">
        <span v-for="c in stats.cards" :key="c.id" class="cc">
          {{ c.name }}<i>{{ c.n }}</i>
        </span>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

    <div v-if="!shots.length" class="empty">
      <Icon name="film" :size="26" />
      <p class="em-t">还没有分镜稿</p>
      <p class="em-s">点右上「生成分镜稿」，会按 3–5 秒把口播切成若干镜，每镜配一张画面卡</p>
    </div>

    <div v-else class="table-wrap">
      <table class="bd-table">
        <thead>
          <tr>
            <th class="c-no">#</th>
            <th class="c-time">时间</th>
            <th class="c-dur">秒</th>
            <th class="c-line">台词</th>
            <th class="c-card">画面卡</th>
            <th class="c-fields">卡上文案</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in shots" :key="i" :class="{ person: s.type === 'person' }">
            <td class="c-no">{{ String(i + 1).padStart(2, '0') }}</td>
            <td class="c-time">{{ fmtTime(s.startSec) }}–{{ fmtTime(s.endSec) }}</td>
            <td class="c-dur">{{ fmtDur(s.dur) }}</td>
            <td class="c-line">{{ s.text }}</td>
            <td class="c-card">
              <span class="tag" :class="{ tperson: s.type === 'person' }">
                {{ s.type === 'person' ? '纯人物' : s.cardName }}
              </span>
              <i v-if="s.note" class="note">{{ s.note }}</i>
            </td>
            <td class="c-fields">{{ fieldsText(s) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  height: clamp(520px, calc(100vh - 200px), 900px);
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(40, 40, 80, 0.03), 0 10px 28px rgba(60, 60, 110, 0.06);
  padding: 14px 16px 0;
  overflow: hidden;
}
.bd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
}
.bd-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.bd-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1c1c30;
}
.bd-when {
  font-size: 10.5px;
  color: #9a9aae;
  white-space: nowrap;
}
.bd-acts {
  display: flex;
  align-items: center;
  gap: 10px;
}
.need {
  font-size: 10.5px;
  color: #c0703a;
}

.bd-stats {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 9px 12px;
  margin-bottom: 10px;
  border-radius: 10px;
  background: rgba(246, 247, 251, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.05);
}
.st {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 62px;
}
.st b {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c30;
  font-variant-numeric: tabular-nums;
}
.st em {
  font-style: normal;
  font-size: 9.5px;
  color: #9a9aae;
}
.st-cards {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: auto;
}
.cc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9.5px;
  color: #6d7a99;
  background: rgba(79, 125, 243, 0.07);
  border-radius: 999px;
  padding: 2px 7px;
}
.cc i {
  font-style: normal;
  font-weight: 600;
  color: #4f7df3;
}

.err {
  font-size: 11px;
  color: #c0392b;
  background: rgba(253, 240, 238, 0.9);
  border: 1px solid rgba(224, 69, 44, 0.2);
  border-radius: 8px;
  padding: 7px 10px;
  margin: 0 0 8px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #b0b0c2;
  padding-bottom: 40px;
}
.em-t {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: #7a7a92;
}
.em-s {
  margin: 0;
  font-size: 10.5px;
  color: #a8a8bd;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0 -16px;
  padding: 0 16px 14px;
}
.table-wrap::-webkit-scrollbar {
  width: 7px;
}
.table-wrap::-webkit-scrollbar-thumb {
  background: rgba(40, 40, 80, 0.14);
  border-radius: 999px;
}

.bd-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.bd-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  text-align: left;
  font-size: 10px;
  font-weight: 500;
  color: #9a9aae;
  background: rgba(250, 250, 253, 0.97);
  backdrop-filter: blur(8px);
  padding: 7px 8px;
  border-bottom: 1px solid rgba(30, 30, 60, 0.08);
}
.bd-table td {
  font-size: 11px;
  color: #33334a;
  padding: 8px;
  vertical-align: top;
  border-bottom: 1px solid rgba(30, 30, 60, 0.045);
  line-height: 1.5;
}
.bd-table tbody tr:hover td {
  background: rgba(79, 125, 243, 0.038);
}
.bd-table tbody tr.person td {
  background: rgba(240, 244, 252, 0.5);
}
.c-no {
  width: 38px;
  color: #a8a8bd !important;
  font-variant-numeric: tabular-nums;
}
.c-time {
  width: 108px;
  font-variant-numeric: tabular-nums;
  color: #6d7a99 !important;
  white-space: nowrap;
}
.c-dur {
  width: 44px;
  font-variant-numeric: tabular-nums;
  color: #9a9aae !important;
}
.c-line {
  width: 30%;
}
.c-card {
  width: 152px;
}
.c-fields {
  color: #5f5f78 !important;
}
.tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  color: #4f7df3;
  background: rgba(79, 125, 243, 0.09);
  border-radius: 6px;
  padding: 2px 6px;
  white-space: nowrap;
}
.tag.tperson {
  color: #1a8a6a;
  background: rgba(26, 138, 106, 0.1);
}
.note {
  display: block;
  margin-top: 3px;
  font-style: normal;
  font-size: 9px;
  color: #b0b0c2;
}
</style>
