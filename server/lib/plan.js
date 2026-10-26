import { callLLM } from './xuehui.js'

/**
 * 语义分镜 + 卡片文案提炼（大模型）
 *
 * 镜数不再固定：由模型按稿子内容判断，2–8 镜。
 * 版式（kind）五种，可省略、可复用：
 *   hook   钩子：不是 A 而是 B 的划线替换
 *   steps  步骤：章节卡压入 + 三步骤时间轴
 *   list   列举：三张并列卡
 *   broll  实拍：全屏素材（产品界面 / 录屏）+ 引线标注，口播变画外音
 *   outro  收尾：杂志框 + 三处标注
 *
 * broll 是「长稿专用」：前四种只能演出 3–6 秒的卡片动画，
 * 塞进 3 分钟演示稿会每镜 40–60 秒、卡片演完就定住。凡是要「真的看到那个东西」的段落，
 * 一律交给 broll。**没有素材时禁用**（会回落成人物全屏，没有意义）。
 *
 * 约束（模型可能不守，代码里会再校一遍）：
 *   - 首镜必须 hook，末镜必须 outro
 *   - 中间只能是 steps / list / broll；steps ≤2、list ≤2、broll ≤3
 *   - steps / list 同类不能相邻；broll 可以相邻（两个不同界面）
 *   - 每镜至少 1.2s（否则卡片动画演不完）
 *
 * 失败一律返回 { ok:false }，调用方回落到原来的规则 4 镜版，绝不让剪辑挂掉。
 */

const SYSTEM = `你是短视频剪辑师，负责把一条口播稿拆成若干镜头，并写出画面上要显示的卡片文案。

## 五种镜头版式（只能用这五种）
- hook  钩子：开场制造反差，画面是「不是 A，而是 B」的划线替换
- steps 步骤：讲方法/流程，画面是章节标题卡 + 竖向三步骤时间轴
- list  列举：讲三样并列的东西（要素 / 证据 / 对比项），画面是三张并列卡
- broll 实拍：画面是全屏的真实素材（产品界面 / 后台 / 操作录屏）+ 两三处引线标注，人物不出镜
- outro 收尾：给结论，画面是杂志框 + 三处标注

## broll 什么时候必须用（重要）
- **稿件超过 90 秒**：长稿必须有 broll 撑着，否则一张卡片要定住几十秒
- 稿子里出现「打开…看看」「往下翻一下」「这里是…」「你看这个页面」这类**要让观众真的看到界面**的描述
- 有并列的多个模块要依次展示（每个模块一个 broll，可以连着出现）
- 反过来：只是在讲道理、讲步骤、讲对比时**不要**用 broll

## 镜数由你判断
- 稿子短、内容单一 → **2 镜也行**（hook → outro），别硬拆步骤
- 稿子是「讲方法/流程」→ hook → steps → outro
- 稿子里有明确的并列列举 → 中间加一个 list
- 稿子有两段互不相干的方法 → 两个 steps
- 稿子只是在讲一个观点、没有步骤也没有并列 → hook → outro，两镜就够，**不要硬套 steps**
- 稿子长、要展示多个界面 → hook → steps → broll → broll → … → outro
- 最多 10 镜，别再多了
- **每镜 15–30 秒最舒服。某一镜会超过 45 秒，就必须再切一刀**（哪怕切出来的也是 broll）

## 硬规则
- 第一镜必须是 hook，最后一镜必须是 outro
- 中间只能是 steps / list / broll
- steps 最多 2 个，list 最多 2 个，broll 最多 4 个
- steps 和 list 不能连着出现；broll 可以连着出现
- cutAfter 是「这一镜讲到第几句为止」的句子序号，必须严格递增，最后一镜的 cutAfter = 最后一句的序号
- 只输出 JSON，不要解释文字、不要 markdown 代码块
- 所有文案是「提炼」不是截断：语意要完整，不能出现「然后再把素」这种断头话
- 全部中文，不用引号书名号，结尾不带句号
- 严格遵守字数上限，超了算失败`

const guide = `## 输出结构（严格照抄字段名）
{
  "shots": [
    { "kind": "hook", "cutAfter": 0,
      "payload": { "line": "铺垫半句，4-10字，不含 from 的内容", "from": "被划掉的旧说法，2-6字", "to": "换上的新说法，2-6字" } },

    { "kind": "steps", "cutAfter": 3,
      "payload": { "name": "章节名，4-8字",
        "steps": [ {"title": "动作短语，4-10字"}, {"title": "动作短语，4-10字"}, {"title": "动作短语，4-10字"} ] } },

    { "kind": "list", "cutAfter": 5,
      "payload": { "items": ["并列项，2-6字", "并列项，2-6字", "并列项，2-6字"] } },

    { "kind": "broll", "cutAfter": 9,
      "payload": {
        "media": "素材 key（只能填下面给的清单里的 key，不能自己编）",
        "caption": "左上角角标，2-6字，写这一段在看什么",
        "labels": ["标注，3-8字", "标注，3-8字", "标注，3-8字"]
      } },

    { "kind": "outro", "cutAfter": 12,
      "payload": { "labels": ["标注，2-6字", "标注，2-6字", "标注，2-6字"] } }
  ]
}
上面只是把所有 kind 的写法列出来给你看，实际按需要删减镜数，不要五种都写死。

## broll 的 labels 怎么写
不是画面标题，是**指着画面上某个具体东西说话**的一句话：
✅ 「发布 32 条」「播放 18.6 万」「三十多条排队」
❌ 「数据」「内容」「功能」  ← 太空泛，等于没标

## hook 的写法（最容易写错，务必照做）
这一镜动画是「不是 A，而是 B」：先显示 line，再把 from 划掉、换成 to。
line 里**绝对不能包含 from 的内容**，否则屏幕上会出现两遍一样的字。
拼起来读要通顺：line + from +「而是」+ to
line 只要「主语 + 动词」的半句，**不要把结论写进 line**（写了就和 from 撞语义）。

✅ 正确：line "做短视频不用" / from "买相机请团队" / to "手机加数字人"
❌ 错误：line "做短视频不用买相机请团队" / from "买相机请团队" / to "手机加数字人"
❌ 错误：line "做自媒体工程量巨大" / from "一个人乱忙活" / to "AI 工作台"
   （前半句已经把 from 的意思说完了，拼起来重复）`

function buildPrompt(script, sentences, total, assets) {
  const lines = sentences
    .map((s, i) => {
      const t = `${s.start.toFixed(1)}-${s.end.toFixed(1)}s`
      return `${i}. [${t}] ${s.text}`
    })
    .join('\n')

  /**
   * 单镜最短时长。
   * 注意不能用 `total × 6%` 直接当门槛 —— 那是短稿的算法，到 3 分半的稿子上会变成 12 秒，
   * 于是「只要有一镜 10 秒」整条就判废、回落规则版。这里给 6 秒封顶。
   */
  const minSec = Math.max(1.2, Math.min(6, total * 0.06)).toFixed(1)
  /**
   * 按总长算一个建议镜数：每镜 22 秒左右。
   * 不写这条的话，模型拿到 3 分半的稿子仍然只给 4–6 镜，每镜四五十秒，卡片演完就定住。
   */
  const target = Math.min(10, Math.max(3, Math.round(total / 22)))

  const assetBlock = assets?.length
    ? `## 可用实拍素材（broll 的 media 只能填这里的 key，一个字都不能改）
${assets.map((a) => `- ${a.key}：${a.hint || a.key}`).join('\n')}

用得到几个就用几个，用不到的模块不要硬凑 broll。`
    : `## 可用实拍素材
（本次没有提供任何实拍素材 —— **禁止使用 broll**，只能从 hook / steps / list / outro 里选）`

  return `## 口播稿全文
${script}

## 按句切好的时间轴（共 ${sentences.length} 句，总长 ${total.toFixed(1)}s，约 ${(total / 60).toFixed(1)} 分钟）
${lines}

${assetBlock}

## 这条稿子建议切 ${target} 镜
总长 ${total.toFixed(0)} 秒，按每镜 20–25 秒算大约是 ${target} 镜（可以少 1 镜或多 1 镜）。
如果你给的镜数明显少于 ${target}，说明有某一镜会超过 45 秒 —— 那样画面会长时间定住，必须再切。

## 任务
1. 判断这条稿子该分几镜、每镜用什么版式
2. 决定每镜讲到第几句为止（cutAfter）
3. 按每镜的内容写出卡片文案

注意：每一镜至少要有 ${minSec} 秒，别让某一镜只跑到半句。

${guide}`
}

/* ---------------- 文案清洗 ---------------- */

/**
 * 截断到 max 字，但**不切断英文单词**。
 * 原来直接 slice，会出现「选中StepFun Pr」这种被切一半的单词，直接上屏。
 */
function trim(s, max) {
  let t = String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[「」『』""''《》]/g, '')
    .replace(/[，,。！？；、,.!?;:：\s]+$/g, '')
    .trim()

  if (t.length > max) {
    t = t.slice(0, max)
    // 切口落在英文/数字单词中间 → 把整个残词去掉
    if (/[A-Za-z0-9]$/.test(t) && /[A-Za-z0-9]/.test(String(s).charAt(max) || '')) {
      t = t.replace(/[A-Za-z0-9]+$/, '')
    }
    t = t.replace(/[，,。！？；、,.!?;:：\s]+$/g, '').trim()
  }
  return t
}

function arrOf(v, n, maxLen, fallback) {
  const out = Array.isArray(v) ? v.map((x) => trim(x, maxLen)).filter(Boolean) : []
  while (out.length < n) out.push(fallback[out.length] || '—')
  return out.slice(0, n)
}

const KINDS = ['hook', 'steps', 'list', 'broll', 'outro']

/** 把模型给的 payload 洗一遍，缺字段用兜底值顶上 */
function cleanPayload(kind, raw = {}, assetKeys = []) {
  if (kind === 'hook') {
    const from = trim(raw.from, 6)
    const line0 = trim(raw.line, 14)
    // line 里混进 from 会在屏幕上出现两遍；剥掉后如果空了要用中性半句兜底（不能留空）
    const stripped = line0 && from && line0.includes(from) ? line0.split(from).join('').trim() : line0
    return {
      line: stripped || '这件事其实不用',
      from: from || '老办法',
      to: trim(raw.to, 6) || '新办法',
    }
  }
  if (kind === 'steps') {
    return {
      num: '01',
      name: trim(raw.name, 10) || '拆解流程',
      sub: 'CHAPTER 01',
      steps: [0, 1, 2].map((i) => ({
        kicker: `第${'一二三'[i]}步`,
        title: trim(raw.steps?.[i]?.title, 12) || '—',
      })),
    }
  }
  if (kind === 'list') return { items: arrOf(raw.items, 3, 8, ['画面', '素材', '声音']) }
  if (kind === 'broll') {
    // media 必须命中真实素材，编的一律回落第一个，避免渲染时 staticFile 找不到文件
    const want = String(raw.media || '').trim()
    const media = assetKeys.includes(want) ? want : assetKeys[0] || ''
    return {
      media,
      caption: trim(raw.caption, 8) || '',
      labels: arrOf(raw.labels, 3, 10, ['看这里', '', '']).filter(Boolean),
    }
  }
  return { labels: arrOf(raw.labels, 3, 8, ['人物', '字幕', '流程']), frameNote: 'PREVIEW' }
}

/**
 * 校验并修补模型给的镜头表。
 * @param {any[]} raw 模型返回的 shots
 * @param {number} n 句子总数
 * @param {string[]} assetKeys 可用实拍素材 key（空 = 不允许 broll）
 * @returns {Array<{kind:string,cutAfter:number,payload:object}>|null}
 */
function normalizeShots(raw, n, assetKeys = []) {
  const allowBroll = assetKeys.length > 0
  let list = Array.isArray(raw) ? raw : []
  list = list
    .filter((s) => s && KINDS.includes(s.kind))
    // 没有素材就别用 broll（会回落成人物全屏，等于白切一镜）
    .filter((s) => s.kind !== 'broll' || allowBroll)
    .map((s) => ({ kind: s.kind, cutAfter: Number(s.cutAfter), payload: s.payload || {} }))
    .filter((s) => Number.isInteger(s.cutAfter))

  if (list.length < 2) return null

  // 首 hook / 尾 outro：模型漏了就补，别整条作废
  if (list[0].kind !== 'hook') list.unshift({ kind: 'hook', cutAfter: -1, payload: {} })
  if (list[list.length - 1].kind !== 'outro') list.push({ kind: 'outro', cutAfter: n - 1, payload: {} })

  // steps / list 同类不相邻（版式一模一样，连着出现像卡住）；broll 例外，两个不同界面连着切是正常的
  list = list.filter((s, i) => {
    if (i === 0) return true
    const prev = list[i - 1]
    if (s.kind === 'broll' && prev.kind === 'broll') return true
    return s.kind !== prev.kind
  })

  // 中间只允许 steps / list / broll
  list = list.filter((s, i) => {
    if (i === 0 || i === list.length - 1) return true
    return s.kind === 'steps' || s.kind === 'list' || s.kind === 'broll'
  })

  // 数量上限
  let steps = 0
  let lists = 0
  let brolls = 0
  list = list.filter((s) => {
    if (s.kind === 'steps') return ++steps <= 2
    if (s.kind === 'list') return ++lists <= 2
    if (s.kind === 'broll') return ++brolls <= 4
    return true
  })

  if (list.length > 10) list = [...list.slice(0, 9), list[list.length - 1]]

  // 镜数不能超过句子数（每镜至少得有一句话），超了就把中间的砍掉
  while (list.length > n) {
    const dropIdx = list.length - 2 // 优先砍倒数第二镜（保留 hook 与 outro）
    if (dropIdx <= 0) break
    list.splice(dropIdx, 1)
  }

  /**
   * cutAfter 从后往前分配：
   * 末镜 = 最后一句；往前每镜至少比后一镜小 1，同时给前面留够位置。
   * （早版是正着递增，遇到「模型把最后两镜都给最后一句」时会卡死，导致整条不可用）
   */
  const m = list.length
  let prev = n - 1
  list[m - 1].cutAfter = n - 1
  for (let i = m - 2; i >= 0; i--) {
    let c = Number.isInteger(list[i].cutAfter) ? list[i].cutAfter : prev - 1
    c = Math.min(c, prev - 1) // 必须比后一镜小
    c = Math.max(c, i) // 前面还得给 i 镜留位置
    list[i].cutAfter = c
    prev = c
  }

  if (list.length < 2) return null
  return list
}

/* ---------------- 对外 ---------------- */

/**
 * @param {{script:string, sentences:{text:string,start:number,end:number}[], total:number,
 *          assets?:{key:string,hint?:string}[]}} p
 * @returns {Promise<{ok:boolean, shots?:{id:string,kind:string,cutAfter:number}[], contents?:Record<string,object>, error?:string, model?:string, fixed?:boolean}>}
 */
export async function planStoryboard({ script, sentences, total, assets = [] }) {
  if (!sentences?.length) return { ok: false, error: '没有句子可切' }
  if (sentences.length < 3) return { ok: false, error: `句子太少（${sentences.length} 句），走规则分镜更稳` }

  const assetKeys = (assets || []).map((a) => String(a.key)).filter(Boolean)

  const r = await callLLM(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(script, sentences, total, assets) },
    ],
    { temperature: 0.35, maxTokens: 8192, json: true, effort: 'none' },
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

  const rawShots = Array.isArray(d.shots) ? d.shots : null
  if (!rawShots) return { ok: false, error: '没有 shots 字段' }

  const shots = normalizeShots(rawShots, sentences.length, assetKeys)
  if (!shots) return { ok: false, error: '镜头表不可用（少于 2 镜或字段全错）' }

  // 按镜生成 id + 清洗文案
  const contents = {}
  const out = shots.map((s, i) => {
    const id = `s${String(i + 1).padStart(2, '0')}`
    contents[id] = cleanPayload(s.kind, s.payload, assetKeys)
    return { id, kind: s.kind, cutAfter: s.cutAfter }
  })

  const fixed = out.length !== rawShots.length
  return { ok: true, shots: out, contents, model: r.model, fixed }
}

/**
 * 按镜头表 + 句子边界算出每镜的起止秒。
 * 每镜不足 minSec 就返回 null（调用方回落规则版）。
 */
export function shotsToPlan(bounds, total, shots, minSec) {
  const need = minSec ?? Math.max(1.2, Math.min(6, total * 0.06))
  const plan = []
  let from = 0
  for (const s of shots) {
    const to = s.cutAfter >= bounds.length - 1 ? total : bounds[s.cutAfter]?.end
    if (!(to > from)) return null
    if (to - from < need) return null
    plan.push({ id: s.id, kind: s.kind, startSec: from, durationSec: to - from })
    from = to
  }
  // 末镜抵到片尾（不允许留黑）
  if (plan.length && Math.abs(plan[plan.length - 1].startSec + plan[plan.length - 1].durationSec - total) > 0.05) {
    const last = plan[plan.length - 1]
    last.durationSec = Math.max(need, total - last.startSec)
  }
  return plan
}
