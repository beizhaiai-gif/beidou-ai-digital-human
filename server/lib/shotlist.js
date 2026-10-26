import { callLLM } from './xuehui.js'
import {
  CARDS,
  CARD_BY_ID,
  PERSON_CARD,
  USABLE,
  cardMenuText,
  cardIndexText,
  validateFields,
  cardList,
} from './cards.js'

/**
 * 分镜口播稿（只出文本，不渲染）
 *
 * 两步：
 *   ① 切段（纯算法）：按标点切句 → 长句再按「3–5 秒」切成语流片段
 *   ② 配卡（大模型）：给每一段挑一张卡 + 填卡上文案，允许纯人物镜
 *
 * 为什么切段要算法做、不交给模型：
 * 模型数时间不可靠（会给「第 3 段 7.5 秒」这种）。时间轴交给代码，模型只管「这段配什么画面」。
 */

const CPS = 4.3 // 中文口播 4.3 字/秒（实测 edge-tts 与真人语速的中间值）

/** 没有配音时，按字数估一句的起止秒 */
export function estimateSentences(script) {
  const raw = String(script || '')
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean)
  let t = 0
  const out = raw.map((text) => {
    const dur = Math.max(1.0, text.replace(/\s/g, '').length / CPS)
    const s = { text, start: +t.toFixed(2), end: +(t + dur).toFixed(2) }
    t += dur
    return s
  })
  return { sentences: out, total: +t.toFixed(2) }
}

const BREAK_AFTER = '，、；：。！？,.!?;:'

/**
 * 软断点：这类词前面通常是「一个意思说完了」。
 * 长句没有标点时靠它们落脚，比在字中间硬切读起来顺得多。
 */
const SOFT_CUES = [
  '所以', '但是', '但', '于是', '然后', '因为', '如果', '不过', '而且', '并且',
  '其实', '等于', '不管', '无论', '只要', '现在', '首先', '其次', '最后',
  '这里', '这时候', '也就是说', '说白了', '关键是', '而', '那',
]

/**
 * 把一句话按 3–5 秒切成若干语流片段。
 * 优先在标点后断（读起来顺），没有标点就在字边界按比例硬切。
 */
function splitSentence(s, minS = 3, target = 4, maxS = 5) {
  const dur = s.end - s.start
  const chars = [...s.text]
  const n = chars.length
  if (!n) return []
  // 第 i 个字开始的时间（按字数比例插值，中文等距发音，够分镜用）
  const at = (i) => (i >= n ? s.end : s.start + (dur * i) / n)

  if (dur <= maxS + 1 || n <= 4) return [{ text: s.text, start: s.start, end: s.end }]

  // 候选断点：标点之后的位置
  const cuts = []
  chars.forEach((ch, i) => {
    if (BREAK_AFTER.includes(ch) && i + 1 < n) cuts.push(i + 1)
  })
  // 软断点：这类词**前面**断（这些词开启新的一小句）
  const text0 = chars.join('')
  for (const cue of SOFT_CUES) {
    let p = text0.indexOf(cue)
    while (p > 0) {
      cuts.push(p)
      p = text0.indexOf(cue, p + 1)
    }
  }
  const uniqCuts = [...new Set(cuts)].sort((a, b) => a - b)

  const out = []
  let from = 0
  let guard = 0
  const isWord = (ch) => /[A-Za-z0-9]/.test(ch || '')

  /** 断点落在英文/数字单词中间就往回或往前挪到词边界（不然会出现「StepFunPrev」+「iew」） */
  const snapWord = (p) => {
    if (p <= from || p >= n) return p
    if (!isWord(chars[p - 1]) || !isWord(chars[p])) return p
    let a = p
    while (a > from && isWord(chars[a - 1])) a--
    let b = p
    while (b < n && isWord(chars[b])) b++
    // 哪边离得近往哪边挪；往回挪会切出太空的一段就不要
    const back = p - a
    const fwd = b - p
    if (back <= fwd && at(p) - at(a) <= 1.2) return a
    return b
  }

  while (from < n && guard++ < 40) {
    const t0 = at(from)
    const remain = s.end - t0

    const inWindow = uniqCuts.filter((c) => {
      if (c <= from) return false
      const d = at(c) - t0
      return d >= minS && d <= maxS + 0.6
    })

    // 收尾：剩得不多了，或者没有标点可依且切了会把词切碎 —— 整段收掉
    if (remain <= maxS + 0.8 || (!inWindow.length && remain <= 6.5)) {
      out.push({ text: chars.slice(from).join(''), start: t0, end: s.end })
      break
    }

    let pick
    if (inWindow.length) {
      pick = inWindow.reduce((a, b) => (Math.abs(at(b) - t0 - target) < Math.abs(at(a) - t0 - target) ? b : a))
    } else {
      // 没有合适标点：按剩余比例取一个 4 秒左右的字边界
      const step = Math.round((n - from) * (target / Math.max(target, remain)))
      pick = Math.min(n, from + Math.max(2, step))
    }
    pick = snapWord(pick)
    if (at(pick) - t0 < 2.2) {
      out.push({ text: chars.slice(from).join(''), start: t0, end: s.end })
      break
    }
    out.push({ text: chars.slice(from, pick).join(''), start: t0, end: at(pick) })
    from = pick
  }
  return out
}

/** 太短的碎镜（<2s）并到前一段，避免闪一下就换画面 */
function mergeTiny(segs, minS = 2.0) {
  const out = []
  for (const s of segs) {
    const dur = s.end - s.start
    if (out.length && dur < minS && out[out.length - 1].end - out[out.length - 1].start < 6.5) {
      const prev = out[out.length - 1]
      prev.text += s.text
      prev.end = s.end
    } else {
      out.push({ ...s })
    }
  }
  return out
}

/** ① 切段 */
export function buildSegments(sentences, total) {
  const flat = []
  for (const s of sentences) flat.push(...splitSentence(s))
  const merged = mergeTiny(flat)
  return merged.map((s, i) => ({
    i,
    startSec: +s.start.toFixed(2),
    endSec: +s.end.toFixed(2),
    dur: +(s.end - s.start).toFixed(2),
    text: s.text.replace(/\s+/g, ' ').trim(),
  }))
}

const SYSTEM = `你是短视频分镜师。任务：给已经切好的每一段口播配一张画面卡，并填好卡上要显示的字。

你只决定「这一段配什么画面、画面上写什么」；时间轴已经定好，不许改。`

/* ---------------- 第一步：从 108 张里圈出这一条用得上的 ---------------- */

const POOL_SYSTEM = `你是短视频分镜师。短片剪辑前，先从卡片库里挑出这次会用的一小批画面卡。`

function buildPoolPrompt(script, segments, total) {
  const preview = segments
    .slice(0, 12)
    .map((s) => `${s.i}. ${s.text}`)
    .join('\n')
  const target = Math.min(18, Math.max(12, Math.round(segments.length / 3.5)))
  return `## 卡片库（${CARDS.length} 张，全在这）
${cardIndexText()}

## 这条稿子（总长 ${total.toFixed(1)}s，会切成 ${segments.length} 段，每段 3–5 秒）
${String(script).slice(0, 700)}

前 12 段的样子：
${preview}

## 任务
从上面挑 **${target} 张左右**「这一条真的用得上」的卡。

要求：
1. 必须覆盖「整句字幕 / 关键词强调 / 讲重点」这类高频需求（口播里它们天然占一半）
2. 稿子里确实出现的东西才挑：有具体数字 → 挑数字卡；讲步骤 → 挑步骤卡；讲界面操作 → 挑假界面卡；
   出现行话 → 挑名词解释卡；有对比 → 挑对比卡
3. 稿子里没有的内容类型，一张都不要挑（挑了你也没内容可填）
4. 纯人物镜那张（${PERSON_CARD}）一定要挑进来
5. 片尾专用的卡最多挑 1 张
6. 不要挑需要图片素材的（清单里已经剔除）

只输出 JSON：{"pool": ["卡 id", "..."], "reason": "一句话说明为什么挑这些"}`
}

async function pickCardPool({ script, segments, total }) {
  const r = await callLLM(
    [
      { role: 'system', content: POOL_SYSTEM },
      { role: 'user', content: buildPoolPrompt(script, segments, total) },
    ],
    { temperature: 0.3, maxTokens: 2048, json: true, effort: 'none' },
  )
  const usableIds = USABLE.map((c) => c.id)
  if (!r.ok) return { ok: false, ids: defaultPool(), error: r.error }

  let d
  try {
    d = JSON.parse(r.text)
  } catch {
    const m = r.text.match(/\{[\s\S]*\}/)
    if (!m) return { ok: false, ids: defaultPool(), error: '选池返回的不是 JSON' }
    try {
      d = JSON.parse(m[0])
    } catch {
      return { ok: false, ids: defaultPool(), error: '选池 JSON 解析失败' }
    }
  }
  let ids = (Array.isArray(d?.pool) ? d.pool : []).filter((x) => usableIds.includes(x))
  ids = [...new Set(ids)]
  // 纯人物镜必须在内，否则整条片没有呼吸
  if (!ids.includes(PERSON_CARD)) ids.push(PERSON_CARD)
  if (ids.length < 6) return { ok: false, ids: defaultPool(), error: `选池只给了 ${ids.length} 张，太少` }
  return { ok: true, ids, reason: String(d?.reason || '') }
}

/** 选池失败时的兜底：一组通用卡（不依赖具体内容） */
function defaultPool() {
  return [
    'keyword-pop-highlight',
    'quote-card',
    'quote-hold-arrow',
    'strike-and-replace',
    'hand-drawn-ellipse',
    'number-slab-pop',
    'numbered-step-stack',
    'step-timeline-vertical',
    'ui-flow-theater',
    'alt-block-lines',
    'impact-open-title',
    'chapter-title-card',
    PERSON_CARD,
  ]
}

function buildPrompt(segments, total, pool) {
  const lines = segments
    .map((s) => `${s.i}. [${s.dur.toFixed(1)}s] ${s.text}`)
    .join('\n')

  const personMax = Math.max(1, Math.round(segments.length * 0.28))
  return `## 可用卡片（只能从这里挑，不能编）
${cardMenuText(pool)}

## 待配卡的分镜段（共 ${segments.length} 段，总长 ${total.toFixed(1)}s）
${lines}

## 任务
给 0 到 ${segments.length - 1} 每一段挑一张卡、填好 fields。

## 硬规则
1. 段号必须从 0 到 ${segments.length - 1} 全覆盖，一段都不能漏，顺序不能乱
2. card 只能填上面这份清单里的 id
3. fields 只填那张卡里列出的键；不知道填什么就省略可选键，不要编
4. 文案是「提炼」不是照抄：除了 keyword-pop-highlight 的 text 要铺整句，其余都提炼成 2–10 字
5. 数字必须来自稿子原话，不许自己编数字
6. **纯人物镜**：card 填 "${PERSON_CARD}"，fields 留空。全片放 ${Math.round(segments.length * 0.2)}–${personMax} 段，不要连用两次
7. 同一张卡不要连续出现 3 次以上；连着用同一张卡时文案必须明显不同
8. 相邻两段尽量不要用同一张卡（除非确实在讲同一个东西的延续）
8.5 **画面要多变**：这 ${pool.length} 张里至少用到 ${Math.min(pool.length, 8)} 种；
   任何单张卡不超过 ${Math.max(3, Math.ceil(segments.length * 0.1))} 段。
   如果你只用了三四种卡，观众会觉得这三分多钟一直在看字幕 —— 那就失败了
8.6 标着「只能放片尾」的卡只能用在最后一镜
   如果你只用了三四种卡，观众会觉得这三分多钟一直在看字幕 —— 那就失败了。
9. **keyword-pop-highlight 最多占全片的 20%**（约 ${Math.round(segments.length * 0.2)} 段）。超了说明你在偷懒：
   讲数字用 number-counter，讲趋势用 bar-chart-growth，讲清单用 numbered-step-stack，
   下判断用 quote-card，要圈重点用 hand-drawn-ellipse
10. **按内容对号入座**（别老用同一张）：
   - 单个指标 + 走势（效率涨了 X%、播放量到多少）→ metric-with-sparkline
   - 一年比一年多、从多少涨到多少 → chart-grow
   - 出现行话 / 缩写 / 新概念要解释 → info-term-card
   - 「界面上有这个东西」「我点了哪一下」→ ui-flow-theater（**假界面，不需要真录屏**）
   - 「我提要求、对方回我」这种对话 → chat-message-flow
   - 政策 / 行业消息 / 热点新闻 → news-card-desk
   - 讲完一块要换章、换主题 → chapter-title-card（全片 1–2 次就够）
   - 报告 / 条款 / 长文本里挑一句 → highlighter-sweep
   - 指着某个具体条目说「就是这个」→ crash-zoom-punch
   - 具体数字 → number-counter；讲趋势 → bar-chart-growth；讲清单 → numbered-step-stack
   - 下结论 / 金句 → quote-card；「不是 A 而是 B」→ strike-and-replace
   - 要强调某一个词 → keyword-pop-highlight；要圈一样东西 → hand-drawn-ellipse
11. note 写 6 个字以内，说明为什么用这张（给作者复核用）

## 输出（只输出 JSON）
**每条都必须带 at**：填那一段台词的开头 6 个字，原样照抄、不许改写、不许改标点。
这是用来对齐段落的键，填错整条会错位。
{"shots":[{"at":"你们知道做自媒","card":"keyword-pop-highlight","fields":{"text":"...","keyword":"..."},"note":"强调关键字"}]}`
}

/**
 * 一句台词拆两行（金句卡用），优先在逗号处断，读起来才连得住。
 * 拆不出来就返回 null，让调用方别硬拆。
 */
function splitTwoLines(raw) {
  const t = String(raw || '')
    .replace(/[\s]+/g, '')
    .replace(/[，,。！？；、.!?;:：]+$/g, '')
  if (t.length < 4) return null
  const m = t.match(/^(.{2,12})[，,、；;]\s*(.{2,12})$/)
  if (m) return [m[1], m[2]]
  if (t.length <= 10) return [t, '']
  const cut = Math.ceil(t.length / 2)
  return [t.slice(0, cut), t.slice(cut)]
}

/** 按字数截断，但不切断英文单词（StepFun Preview 不能被切成 StepFun Prev） */
/**
 * 裁剪到字段容量。
 *
 * 原来的实现是「到 max 就硬切」，问题很直接：
 * 「收获专属 AI 工作台」上限 10 字 → 切完变成「收获专属 AI 工作」，「台」没了。
 * 上屏就是半截话，观众以为是我们打错了。
 *
 * 现在按优先级找切口：
 *   ① 标点（，。、；：！？）—— 切在分句处，读起来是完整的
 *   ② 空格 / 英文词边界 —— 不把 StepFun 切成 StepFu
 *   ③ 都找不到才硬切（但至少要保留 55% 的内容，不然不如不显示）
 */
function cutSafe(v, max) {
  const s = String(v).trim()
  if (s.length <= max) return s

  const head = s.slice(0, max + 1)
  const floor = Math.max(2, Math.floor(max * 0.55))

  // ① 标点优先
  const PUNC = /[，。、；：！？,.;:!?]/
  for (let i = head.length - 1; i >= floor; i--) {
    if (PUNC.test(head[i])) return head.slice(0, i).trim()
  }
  // ② 空格
  for (let i = head.length - 1; i >= floor; i--) {
    if (head[i] === ' ') return head.slice(0, i).trim()
  }
  // ③ 硬切，但不能切断英文/数字
  let t = s.slice(0, max)
  if (/[A-Za-z0-9]$/.test(t) && /[A-Za-z0-9]/.test(s.charAt(max))) t = t.replace(/[A-Za-z0-9]+$/, '')
  return t.trim()
}

/**
 * 「整句/短句文字卡」互相之间可以安全替换 —— 字段都能从台词直接推出来。
 * 这不是随便换卡：换的只是视觉包装，内容还是那句话。
 */
const TEXT_ROTATION = [
  'keyword-pop-highlight',
  'quote-card',
  'line-by-line-slide',
  'alt-block-lines',
  'soft-blur-in',
  'tracking-in',
]

/** 按目标卡的要求，从台词推出可用字段；推不出来返回 null */
function deriveFields(card, text) {
  const t = String(text).replace(/[。！？]+$/, '').trim()
  const two = splitTwoLines(t)
  if (card === 'keyword-pop-highlight') return { text: t.slice(0, 20) }
  if (card === 'quote-card' || card === 'alt-block-lines') {
    if (!two) return null
    const f = { line1: two[0] }
    if (two[1]) f.line2 = two[1]
    return f
  }
  if (card === 'line-by-line-slide') {
    const parts = t.split(/[，,、；;]/).map((x) => x.trim()).filter(Boolean)
    if (parts.length < 2) return null
    return { lines: parts.slice(0, 4) }
  }
  if (card === 'soft-blur-in') return t.length <= 14 ? { text: t } : null
  if (card === 'tracking-in') return t.length <= 10 ? { text: t } : null
  return null
}

/**
 * 文字卡配额平衡。
 *
 * 实测模型不管 prompt 怎么写，都会把 30% 以上的镜头塞成「整句字幕」——
 * 因为那张最万金油。这里硬压：任何一张文字卡不超过 total×10%，
 * 超了就轮换到同池里另一张没用满的文字卡（内容不变，只换视觉包装）。
 */
function rebalanceTextCards(out, pool, total) {
  const cap = Math.max(3, Math.ceil(total * 0.1))
  const rot = TEXT_ROTATION.filter((id) => pool.includes(id))
  if (rot.length < 2) return out

  const tally = () => {
    const m = {}
    for (const s of out) m[s.card] = (m[s.card] || 0) + 1
    return m
  }

  for (let guard = 0; guard < 40; guard++) {
    const c = tally()
    const over = rot.filter((id) => (c[id] || 0) > cap).sort((a, b) => (c[b] || 0) - (c[a] || 0))
    if (!over.length) break
    const worst = over[0]
    const target = rot.find((id) => id !== worst && (c[id] || 0) < cap)
    if (!target) break

    let swapped = false
    for (let i = out.length - 1; i >= 1; i--) {
      if (out[i].card !== worst) continue
      if (out[i - 1]?.card === target || out[i + 1]?.card === target) continue
      const f = deriveFields(target, out[i].text)
      if (!f || !validateFields(target, f)) continue
      out[i] = { ...out[i], card: target, cardName: CARD_BY_ID[target].name, fields: f, note: '轮换换卡' }
      swapped = true
      break
    }
    if (!swapped) break
  }
  return out
}

/** 校验 + 修：段落对齐、卡 id、keyword 命中、连续重复 */
function normalize(raw, segments, pool) {
  const norm = (s) => String(s || '').replace(/[\s，,。！？；、.!?;:：]/g, '')
  // 用「台词前缀」对齐，不用模型数出来的序号 —— 实测它会把第 12 段的文案写到第 11 段
  const cands = segments.map((s) => ({ i: s.i, key: norm(s.text) }))
  const used = new Set()
  const byIdx = new Map()

  const matchIdx = (at) => {
    const k = norm(at)
    if (k.length < 3) return -1
    // 只认「开头匹配」，逐级缩短前缀；不用 includes —— 那会让模型把下一段的话套到上一段
    let hit = cands.find((p) => !used.has(p.i) && p.key.startsWith(k))
    for (let n = Math.min(k.length, 6); !hit && n >= 4; n--) {
      const kk = k.slice(0, n)
      hit = cands.find((p) => !used.has(p.i) && p.key.startsWith(kk))
    }
    if (!hit) return -1
    used.add(hit.i)
    return hit.i
  }

  for (const s of Array.isArray(raw) ? raw : []) {
    if (!CARD_BY_ID[s?.card]) continue
    // 只认这次选池里的卡（模型有时会从旧记忆里掏出清单外的 id）
    if (pool && !pool.includes(s.card)) continue
    let i = matchIdx(s.at)
    if (i < 0) {
      const n = Number(s.i)
      if (Number.isInteger(n) && n >= 0 && n < segments.length && !used.has(n)) {
        i = n
        used.add(n)
      }
    }
    if (i < 0 || byIdx.has(i)) continue
    byIdx.set(i, {
      card: s.card,
      fields: s.fields && typeof s.fields === 'object' ? s.fields : {},
      note: String(s.note || '').slice(0, 10),
    })
  }

  const out = []
  for (let i = 0; i < segments.length; i++) {
    let pick = byIdx.get(i)
    if (!pick) {
      pick = { card: 'keyword-pop-highlight', fields: { text: segments[i].text.slice(0, 20) }, note: '补位' }
    }
    const def = CARD_BY_ID[pick.card]
    // 按 slots 裁字 + 丢掉不认识的键
    const fields = {}
    for (const slot of def.slots) {
      let v = pick.fields[slot.k]
      if (v == null) continue
      if (Array.isArray(v)) {
        v = v.map((x) => String(x).trim()).filter(Boolean)
        fields[slot.k] = slot.k === 'steps' || slot.k === 'items' ? v.slice(0, 4) : v
      } else {
        v = String(v).trim()
        if (!v) continue
        const max = Number(slot.max) || 20
        fields[slot.k] = cutSafe(v, max)
      }
    }
    /**
     * keyword 必须能在（已裁断的）text 里原样找到。
     * 裁断很容易把关键词切成半截（StepFun Preview → StepFu），半截词弹出来很怪。
     * 找不到就**换一张卡**（金句卡），别留成一张等于字幕的空卡。
     */
    if (pick.card === 'keyword-pop-highlight') {
      if (!fields.text) fields.text = segments[i].text.slice(0, 20)
      const rawKw = String(pick.fields.keyword || '').trim()
      const truncated = rawKw && rawKw.length > 6
      if (!fields.keyword || truncated || !fields.text.includes(fields.keyword)) {
        const two = splitTwoLines(segments[i].text)
        if (two) {
          const f2 = { line1: two[0] }
          if (two[1]) f2.line2 = two[1]
          out.push({
            ...segments[i],
            type: 'card',
            card: 'quote-card',
            cardName: CARD_BY_ID['quote-card'].name,
            fields: f2,
            note: '关键词没命中',
          })
          continue
        }
        delete fields.keyword
      }
    }

    /**
     * 划线卡的 line 如果和 from 撞了，屏幕上同一个词会出现两遍（"乱忙活" + 划掉"乱忙活"）。
     * 剥掉；剥空了就整条不要 —— line 本来就是可选位。
     */
    if (pick.card === 'strike-and-replace' && fields.line && fields.from && fields.line.includes(fields.from)) {
      const rest = fields.line.split(fields.from).join('').trim()
      if (rest) fields.line = rest
      else delete fields.line
    }

    // 数组类字段按卡片的版面容量截断（版面只画得下这么多行）
    const ARR_CAP = { rows: 3, messages: 4, bars: 5, axis: 4, steps: 4, items: 3 }
    for (const [k, cap] of Object.entries(ARR_CAP)) {
      if (Array.isArray(fields[k]) && fields[k].length > cap) fields[k] = fields[k].slice(0, cap)
    }

    /**
     * 字段不合规就换卡。宁可退回「整句字幕」也不能让一张空卡上屏
     * （实测：number-counter 填「播放量」、bar-chart 只给 2 个值、chat-gpt 只有问句）。
     */
    if (!validateFields(pick.card, fields)) {
      out.push({
        ...segments[i],
        type: 'card',
        card: 'keyword-pop-highlight',
        cardName: CARD_BY_ID['keyword-pop-highlight'].name,
        fields: { text: segments[i].text.slice(0, 20) },
        note: `${def.name}字段不全`,
      })
      continue
    }

    // 纯人物镜不铺卡，也就没有「卡上文案」——模型给的 line 常常是半句话，一律清掉
    const isPerson = pick.card === PERSON_CARD
    out.push({
      ...segments[i],
      type: isPerson ? 'person' : 'card',
      card: pick.card,
      cardName: def.name,
      fields: isPerson ? {} : fields,
      note: pick.note,
    })
  }

  // 同一张卡连着 3 次以上：把中间那段换成纯人物镜（节奏也能松一下）
  let run = 1
  for (let i = 1; i < out.length; i++) {
    run = out[i].card === out[i - 1].card ? run + 1 : 1
    if (run >= 3 && out[i].card !== PERSON_CARD) {
      out[i] = {
        ...out[i],
        type: 'person',
        card: PERSON_CARD,
        cardName: CARD_BY_ID[PERSON_CARD].name,
        fields: {},
        note: '拆重复',
      }
      run = 1
    }
  }
  // 纯人物镜不许连着两段
  for (let i = 1; i < out.length; i++) {
    if (out[i].type === 'person' && out[i - 1].type === 'person') {
      const seg = out[i]
      out[i] = {
        ...seg,
        type: 'card',
        card: 'keyword-pop-highlight',
        cardName: CARD_BY_ID['keyword-pop-highlight'].name,
        fields: { text: seg.text.slice(0, 20) },
        note: '避免连用',
      }
    }
  }

  const total = out.length
  const kpCap = Math.max(2, Math.ceil(total * 0.2))
  const personCap = Math.floor(total * 0.35)
  let kp = out.filter((s) => s.card === 'keyword-pop-highlight').length
  let person = out.filter((s) => s.type === 'person').length
  for (let i = out.length - 1; i >= 1 && kp > kpCap && person < personCap; i--) {
    const s = out[i]
    if (s.card !== 'keyword-pop-highlight') continue
    // 不许和邻居撞：前后只要有一段纯人物镜就跳过
    if (out[i - 1]?.type === 'person' || out[i + 1]?.type === 'person') continue
    out[i] = {
      ...s,
      type: 'person',
      card: PERSON_CARD,
      cardName: CARD_BY_ID[PERSON_CARD].name,
      fields: {},
      note: '让节奏',
    }
    kp--
    person++
  }

  /**
   * 纯人物镜保底 18%：卡片再好，连着看十几张也会累。
   * 用户要的是「卡片 → 卡片 → 人物 → 卡片」的呼吸感，所以不够就补。
   */
  const personFloor = Math.floor(total * 0.18)
  if (person < personFloor) {
    const need = personFloor - person
    let added = 0
    for (let i = 3; i < out.length - 1 && added < need; i++) {
      if (out[i].type === 'person') continue
      // 每 3 段挑一段，别把人物镜堆在一起
      if (i % 3 !== 0) continue
      if (out[i - 1]?.type === 'person' || out[i + 1]?.type === 'person') continue
      out[i] = {
        ...out[i],
        type: 'person',
        card: PERSON_CARD,
        cardName: CARD_BY_ID[PERSON_CARD].name,
        fields: {},
        note: '留呼吸',
      }
      added++
    }
  }

  /**
   * 纯人物镜上限 28%：模型有时会塞到三分之一，那就不是在讲内容、是在看人脸。
   * 超出的转成文字卡（后面还会被轮换摊平）。
   */
  const personCeil = Math.max(2, Math.ceil(total * 0.28))
  let over = out.filter((x) => x.type === 'person').length - personCeil
  for (let i = out.length - 2; i >= 1 && over > 0; i--) {
    if (out[i].type !== 'person') continue
    if (out[i - 1]?.type === 'person' || out[i + 1]?.type === 'person') continue
    const target = TEXT_ROTATION.filter((c) => (pool || []).includes(c)).sort(
      (a, b) => out.filter((x) => x.card === a).length - out.filter((x) => x.card === b).length,
    )[0]
    const f = target && deriveFields(target, out[i].text)
    if (!f || !validateFields(target, f)) continue
    out[i] = { ...out[i], type: 'card', card: target, cardName: CARD_BY_ID[target].name, fields: f, note: '人物太多' }
    over--
  }

  // 最后统一把文字卡摊平（内容不变，只换视觉包装）
  rebalanceTextCards(out, pool || [], total)

  return out
}

/**
 * ② 配卡（两步）
 *   第一步 选池：从 108 张里圈出这一条用得上的 10–16 张
 *   第二步 挑卡：只在池子里逐段挑 + 填文案
 *
 * 为什么要分两步：108 张的完整说明书一万三千多字，一次性塞给模型会让它注意力分散、
 * 反复扎堆用那几张最顺手的。先选池既省 token，也让「换卡」变得可行。
 */
export async function planShotList({ sentences, total, script }) {
  if (!sentences?.length) return { ok: false, error: '没有可切分的句子' }
  const segments = buildSegments(sentences, total)
  if (!segments.length) return { ok: false, error: '切段结果为空' }

  const pool = await pickCardPool({ script: script || '', segments, total })

  const r = await callLLM(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(segments, total, pool.ids) },
    ],
    { temperature: 0.4, maxTokens: 8192, json: true, effort: 'none' },
  )
  if (!r.ok) return { ok: false, error: r.error }

  let d
  try {
    d = JSON.parse(r.text)
  } catch {
    const m = r.text.match(/\{[\s\S]*\}/)
    if (!m) return { ok: false, error: '返回的不是 JSON' }
    try {
      d = JSON.parse(m[0])
    } catch {
      return { ok: false, error: 'JSON 解析失败' }
    }
  }

  const shots = normalize(d.shots, segments, pool.ids)
  const personCount = shots.filter((s) => s.type === 'person').length
  return {
    ok: true,
    model: r.model,
    total,
    segments: segments.length,
    pool: pool.ids,
    poolNote: pool.ok ? pool.reason : `选池失败（${pool.error}），用通用兜底池`,
    shots,
    stats: {
      count: shots.length,
      avgDur: +(total / shots.length).toFixed(1),
      person: personCount,
      personPct: Math.round((personCount / shots.length) * 100),
      cards: countBy(shots.map((s) => s.card)),
    },
  }
}

function countBy(arr) {
  const m = {}
  for (const k of arr) m[k] = (m[k] || 0) + 1
  return Object.entries(m)
    .map(([id, n]) => ({ id, name: CARD_BY_ID[id]?.name || id, n }))
    .sort((a, b) => b.n - a.n)
}

/** 前端拿到可用卡片清单（含「能不能用」标记） */
export function availableCards() {
  return cardList()
}
