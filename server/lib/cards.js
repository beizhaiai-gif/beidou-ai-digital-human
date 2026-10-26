import { PART1 } from './cards/part1.js'
import { PART2 } from './cards/part2.js'
import { PART3 } from './cards/part3.js'

/**
 * 卡片库 · 索引层
 *
 * 108 张全部来自 `~/.workbuddy/skills/video-talkcraft/workbench/tplcards/`，
 * 且**全部真实渲染过**（server/talkcraft/src/lab/），说明书按实测画面写。
 *
 * 数据分三个文件放，避免单文件过大：
 *   cards/part1.js  20 张（最早那批）
 *   cards/part2.js  30 张
 *   cards/part3.js  58 张
 *
 * 字段说明见 part1.js 顶部。
 */

export const CARDS = [...PART1, ...PART2, ...PART3]

/** 纯人物镜统一用这张（不铺卡片，只让人出镜 + 字幕） */
export const PERSON_CARD = 'host-shrink-to-chip'

export const CARD_BY_ID = CARDS.reduce((m, c) => {
  m[c.id] = c
  return m
}, {})

/** 需要自带图片素材的卡（渲染出来是灰块，暂时不进模型可选清单） */
export const NEED_ASSET = CARDS.filter((c) => c.need === 'image').map((c) => c.id)

/** 能进模型可选清单的卡 */
export const USABLE = CARDS.filter((c) => !c.need)

/** 只能放片尾的卡（片尾引流、logo） */
export const TAIL_ONLY = CARDS.filter((c) => c.tag === 'tail').map((c) => c.id)

/**
 * 「某个字段必须出现在另一个字段里」的关系校验。
 * 放在这里而不是数据文件里，是因为它属于校验规则、不属于卡片描述。
 */
const IN_CHECK = {
  'impact-open-title': [['accent', 'title']],
  'chip-grid-single-select': [['picked', 'options']],
  'magnifier-detail': [['hit', 'rows']],
  'focus-dim-spotlight': [['hit', 'rows']],
  'scribble-annotation': [['hit', 'text']],
  'evidence-scroll-tour': [['hit', 'items']],
}

/**
 * 字段校验：填错了就换卡，绝不让一张带坏数据的卡上屏。
 * 通用规则（必填位 / 数组条数）+ 少量特殊规则（数字 / 标签:数值 / 包含关系）。
 */
export function validateFields(cardId, f = {}) {
  const def = CARD_BY_ID[cardId]
  if (!def) return false

  const has = (k) => {
    const v = f[k]
    if (Array.isArray(v)) return v.filter((x) => String(x).trim()).length > 0
    return v != null && String(v).trim() !== ''
  }

  for (const s of def.slots || []) if (s.req && !has(s.k)) return false

  for (const [k, n] of Object.entries(def.arrMin || {})) {
    const arr = Array.isArray(f[k]) ? f[k].filter((x) => String(x).trim()) : []
    if (arr.length < n) return false
  }

  if (def.check === 'number') {
    if (!/\d/.test(String(f.value ?? f.target ?? ''))) return false
  }
  if (def.check === 'pairs') {
    const ok = (Array.isArray(f.bars) ? f.bars : []).filter((x) => /[:：]\s*-?\d/.test(String(x))).length
    if (ok < 3) return false
  }
  if (def.check === 'contains') {
    const body = String(f.body ?? '')
    const quote = String(f.quote ?? '')
    if (!body || !quote || !body.includes(quote)) return false
  }

  for (const [a, b] of IN_CHECK[cardId] || []) {
    const av = String(f[a] ?? '')
    const bv = Array.isArray(f[b]) ? f[b].join(' ') : String(f[b] ?? '')
    if (av && bv && !bv.includes(av)) return false
  }

  return true
}

/** 第一阶段用：极简索引（id｜名｜类｜时长｜一句话用途），108 张也才三千多字 */
export function cardIndexText(ids) {
  const list = ids ? CARDS.filter((c) => ids.includes(c.id)) : CARDS
  return list
    .map((c) => `${c.id}｜${c.name}｜${c.cat}｜${c.dur}s｜${String(c.use).replace(/\*\*/g, '').slice(0, 34)}`)
    .join('\n')
}

/** 第二阶段用：完整说明书（含要填哪些位）。传 ids 就只出这几张 */
export function cardMenuText(ids) {
  const list = ids ? CARDS.filter((c) => ids.includes(c.id) && !c.need) : USABLE
  return list
    .map((c) => {
      const slots = (c.slots || [])
        .map((s) => `${s.k}${s.opt ? '?' : ''}(≤${s.max}字)`)
        .join(' / ')
      const need = slots ? `\n    要填：${slots}` : '\n    不用填，纯画面'
      const tagHint = c.tag === 'tail' ? '｜**只能放片尾**' : c.tag === 'person' ? '｜纯人物镜' : ''
      return `- ${c.id}｜${c.name}｜${c.cat}｜约${c.dur}s${tagHint}｜${c.use}${need}`
    })
    .join('\n')
}

/** 前端表格 / 卡片清单用 */
export function cardList() {
  return CARDS.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.cat,
    dur: c.dur,
    usable: !c.need,
    tail: c.tag === 'tail',
    person: c.tag === 'person',
    // 下面几个给「改卡」界面用：没有 slots 就不知道该让人改哪几个字
    use: String(c.use || '').replace(/\*\*/g, ''),
    slots: (c.slots || []).map((s) => ({k: s.k, label: s.label, max: s.max, req: !s.opt})),
    arrMin: c.arrMin || {},
    note: c.note || '',
  }))
}
