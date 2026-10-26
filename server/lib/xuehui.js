import { resolveLlm } from './settings.js'

/**
 * 模型来源：工作台「设置 → 大模型」优先，回退 ~/.workbuddy/models.json。
 * 用户在界面改完 key 立刻生效，不用重启服务。
 */
function loadModel() {
  return resolveLlm()
}

/** 给剪辑链路复用：语义分镜 / 卡片文案提炼都要大模型 */
export { callLLM }

async function callLLM(messages, { temperature = 0.85, maxTokens = 8192, json = false, effort } = {}) {  const model = loadModel()
  if (!model) return { ok: false, error: '还没配置大模型 —— 打开左下角「设置 → 大模型」填 API Key' }

  const body = {
    model: model.model || 'deepseek-v4-pro',
    messages,
    temperature: temperature ?? model.temperature ?? 0.85,
    // V4 是推理模型：先思考再写，token 给少了正文会是空的
    max_tokens: Math.max(8192, maxTokens),
  }
  if (json) body.response_format = { type: 'json_object' }
  if (['deepseek-v4-pro', 'deepseek-flash'].includes(body.model)) {
    // effort='none' 表示别思考：写稿实测 68s → 4s，质量没掉
    const eff = effort ?? model.effort ?? 'low'
    if (eff) body.reasoning_effort = eff
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 240_000)

  try {
    const res = await fetch(model.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const t = await res.text()
      return { ok: false, error: `LLM ${res.status}: ${t.slice(0, 300)}` }
    }
    const data = await res.json()
    const msg = data?.choices?.[0]?.message || {}
    const text = (msg.content || '').trim()
    if (!text) {
      return {
        ok: false,
        error: msg.reasoning_content
          ? '模型只在思考、正文没写出来（max_tokens 不够），稍后重试'
          : 'LLM 返回空内容',
      }
    }
    return { ok: true, text, model: model.name || body.model }
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, error: e.name === 'AbortError' ? 'LLM 超时（240s）' : String(e.message || e) }
  }
}

/** 薛辉体系 system prompt（蒸馏自 ~/.workbuddy/skills/xuehui） */
export const SYSTEM = `你是「薛辉」——短视频商业化变现教练，风格直接、犀利、一针见血。只给能落地的方法，不说空话。

## 价值铁律（不可打破的排序）
内容 > 情绪 > 文案 > 技术

## 四大脚本模型
1. 晒过程：钩子(3s 好奇画面) → 过程展示(真实、有特写) → 价值点(专业壁垒/用心处) → 引导(询价/私信)
2. 讲故事：钩子(3s 悬念或冲突) → 事件展开(时间线、细节、对话、情绪起伏) → 转折/教训 → 引导
3. 教知识：钩子(3s 反常识/直击痛点) → 知识点展开(讲透、给实操步骤) → 证据案例 → 引导
4. 说观点：钩子(3s 颠覆认知的观点) → 论证(事实/数据/案例) → 对比冲突 → 引导

## 八大爆款元素
特定人群 · 成本 · 名人 · 奇葩 · 女人 · 最差 · 反差 · 怀旧

## 写作硬要求
- 白描，不写"我感受到"，只写看见什么、听见什么
- 禁止"我们的产品特别好"这类空话，用具体数字和动作替代
- 开场 3 秒必须让目标人群觉得"这说的是我"
- 结尾必须给一个具体动作，不要"希望对你有帮助"
- 口语化，能直接念出来
- 不出现 emoji、不出现 markdown 标题`

const FW_MAP = { process: '晒过程', story: '讲故事', teach: '教知识', view: '说观点' }


/**
 * 薛辉「八大爆款元素」（SKILL.md 模型三）
 * 四大脚本模型是骨架，八元素是长在上面的"肉"：一条选题配 2–3 个元素。
 */
export const ELEMENTS = {
  特定人群: '精准锁定某类人群的身份标签（空姐/柜姐/单亲妈妈/程序员/创业者），让这群人觉得"这说的是我"',
  成本: '展示极低的启动成本或极高的投入产出比，打破"我做不到"的心理门槛',
  名人: '借势知名人物（行业大佬/明星/网红）的观点、故事或名言，用他的势能给自己背书',
  奇葩: '挖掘行业或客户里最反常、最出人意料的人或事，用认知冲击制造传播',
  女人: '以女性视角或女性用户为中心（真实痛点、情感、生活方式），注意不做物化',
  最差: '反向操作——不展示最好的，而展示最差的案例，教训比经验更有传播力',
  反差: '制造预期与现实的巨大落差（你以为是这样，结果那样），反差越大记忆越深',
  怀旧: '唤起对过去某个时代的共同记忆，用集体回忆建立情感连接',
};
const TONE_MAP = { direct: '直接犀利', warm: '温和亲切', dry: '干货理性' }

/** ① 从素材生成选题 */
/**
 * 生成选题
 *
 * framework / elements 都是**可选**：第一步只管从素材里提炼角度，
 * 模型和元素留到第二步写稿时再定。传了也不冲突（用于定向出题）。
 */
export async function generateTopics({ source, framework = '', count = 5, elements = [], effort = 'none' }) {
  const els = (elements || []).filter((e) => ELEMENTS[e]).slice(0, 3)
  const fwLine = framework
    ? `- 脚本模型：${Math.ceil(count / 2) >= count ? '全部' : `至少 ${Math.ceil(count / 2)} 条`}用「${FW_MAP[framework] || '教知识'}」，剩下的可以混入其他三个模型制造差异`
    : '- 脚本模型：每条自己挑最合适的（晒过程 / 讲故事 / 教知识 / 说观点），尽量覆盖 2–3 种，别全挤在一个模型里'
  const elLine = els.length
    ? `- **必须融合这些爆款元素**：${els.join('、')}`
    : '- 爆款元素：每条自己挑 1–3 个最贴合的（特定人群 / 成本 / 名人 / 奇葩 / 女人 / 最差 / 反差 / 怀旧）'

  const sys = `${SYSTEM}

## 本次任务
你是选题策划。基于用户给的素材（热榜条目 / 对标视频标题），产出可以直接拍的选题。

输出严格 JSON：
{"topics":[{"title":"选题标题（口语化、有钩子感，不超过 25 字）","fw":"模型名","els":["元素名","元素名"],"hook":"勾子描述，10 字内","hot":85,"why":"为什么这条能爆，一句话"}]}

要求：
- **【必须用来出题的那一条】是你的唯一命题对象**，${count} 条全部围绕它。素材里另外列出的其他条目只是帮你判断当下语境，**拿它们出题一律算跑题**
- 如果那一条本身不好直接转化（硬新闻、政策、赛事），就找它能引出的**道理 / 方法 / 冲突**来切，绝不能换一条来写
- 数量：${count} 条
${fwLine}
${elLine}
${els.length ? '元素定义：\n' + els.map((e) => `  · ${e}：${ELEMENTS[e]}`).join('\n') : ''}
- 每条选题在 els 字段里列出用到的 1-3 个元素名（必须来自八大元素）
- hot 是 60-99 的整数，代表预估爆发潜力。**必须参考素材里的真实信号**：点赞/评论明显高于同量级、且是近期发布的 → 可以给高分（85+）；素材本身就是冷启动或老内容 → 别硬给 90 以上；没依据的选题压在 60-75
- 标题必须具体、有画面感，禁止"如何提升效率"这类空泛表述
- hook 要能一眼看到冲突或利益，10 字以内`

  const r = await callLLM(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `素材：\n${source}\n\n请出 ${count} 条选题。` },
    ],
    { temperature: 0.9, maxTokens: 8192, json: true, effort },
  )
  if (!r.ok) return r

  try {
    const parsed = JSON.parse(r.text)
    const topics = (parsed.topics || []).slice(0, count).map((t, i) => ({
      id: `p${Date.now()}_${i}`,
      title: t.title,
      fw: t.fw || FW_MAP[framework] || '教知识',
      els: Array.isArray(t.els) ? t.els.filter((e) => ELEMENTS[e]).slice(0, 3) : [],
      hook: t.hook || '',
      hot: Number(t.hot) || 80,
      why: t.why || '',
    }))
    return { ok: true, data: { topics, model: r.model } }
  } catch {
    return { ok: false, error: 'LLM 返回的不是合法 JSON', raw: r.text.slice(0, 300) }
  }
}

/** ② 写口播稿 */
/**
 * 中文口播语速（实测 edge-tts 云希：132 字 → 27.6 秒，去标点约 120 字 → 4.3 字/秒）
 * 定这个数要小心：定大了目标字数就多，稿子念出来必然超时。
 */
export const CHARS_PER_SEC = 4.3

/** 统一字数口径：去掉空白 + 标点，只数真正念出来的字 */
export function countChars(text) {
  return String(text || '').replace(/[\s，。！？、；：""''（）《》〈〉…—～·,.!?;:'"()\[\]{}<>]/g, '').length
}

/**
 * 构造写稿提示词（流式和非流式共用，别写两份）
 * @returns {{ prompt:string, low:number, high:number, isRewrite:boolean }}
 */
export function buildScriptPrompt({ topic, framework, tone, duration, extra, elements = [], original = '' }) {
  const target = Math.round(duration * CHARS_PER_SEC)
  const low = Math.round(target * 0.88)
  const high = Math.round(target * 1.06)

  const isRewrite = Boolean(original && original.trim().length > 10)

  const prompt = isRewrite
    ? `把下面这段别人的口播稿，改写成**你自己的**一条口播稿（复刻结构，不抄内容）。

【原文案（参考它的结构和节奏，不要照抄句子）】
${original}

改写要求：
1. 用「${FW_MAP[framework] || '教知识'}」模型重搭结构：钩子 → 主体 → 转折/证据 → 引导
2. 保留原文案里**最有说服力的论点和事实**，但必须用自己的话重讲
3. 换掉原文案里的具体人名/品牌/案例，除非它就是核心信息
4. 语气：${TONE_MAP[tone] || '直接犀利'}
5. 目标时长：${duration} 秒
${(elements || []).length ? `6. 必须融合这些爆款元素：${elements.join('、')}（${elements.map((e) => `${e}=${ELEMENTS[e] || ''}`).join('；')}）` : ''}
${extra ? `参考素材：\n${extra}` : ''}

【硬性字数约束】全文去掉空格和标点后必须落在 ${low}–${high} 字之间，宁多不少。
**标点必须齐全**，每句之间要有逗号句号，不许连成没有标点的一长串。
按语义分段，每段 2–4 句，段落之间空一行。
不要写解释、不要写标题、不要写"以下是稿子"，直接输出可以念的文本。`
    : `请按「${FW_MAP[framework] || '教知识'}」脚本模型，写一条口播稿。

选题：${topic}
语气：${TONE_MAP[tone] || '直接犀利'}
目标时长：${duration} 秒

【硬性字数约束】全文去掉空格和标点后必须落在 ${low}–${high} 字之间。
**宁多不少**：写不够 ${low} 字说明内容不够，要把论点讲透、把例子补足，不要草草收尾；超了 ${high} 字再删。
写完自己数一遍。

${(elements || []).length ? `必须融合这些爆款元素：${elements.join('、')}\n（元素定义：${elements.map((e) => `${e}=${ELEMENTS[e] || ''}`).join('；')}）\n` : ''}${extra ? '参考素材：\n' + extra + '\n' : ''}
要求：
1. 严格按该模型的结构走（钩子 → 主体 → 转折/证据 → 引导）
2. **标点必须齐全**：每句话之间要有逗号、句号，绝对不许把几句话连成没有标点的一长串。这是给人念的稿子，没有标点没法读
3. **分段要清楚**：按语义分段，每段 2–4 句、40–80 字，段落之间空一行；不要一大坨
4. 不要写任何解释、不要写标题、不要写"以下是稿子"`

  return { prompt, low, high, isRewrite }
}

export async function generateScript({ topic, framework, tone, duration, extra, elements = [], original = '' }) {
  const { prompt, low, high } = buildScriptPrompt({
    topic, framework, tone, duration, extra, elements, original,
  })

  const r = await callLLM(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.85, maxTokens: 16384, effort: 'none' },
  )
  if (!r.ok) return r

  let script = r.text.trim()

  // 模型对字数很不听话（尤其 60s 这种长稿，能写到 1.4 倍）。
  // 超了 15% 就自动压，最多压两轮；每轮必须真的变短才采用。
  for (let round = 0; round < 2; round++) {
    const got = countChars(script)
    if (got <= high * 1.03) break

    const fixed = await callLLM(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `重写下面这段口播稿，**严格控制在 ${low}–${high} 字之间**（不含标点）。

现在它是 ${got} 字，必须再砍掉至少 ${got - high} 字。

重写规则：
1. 第一句钩子照抄，最后一句引导照抄
2. 中间只留 2–3 个最有力的点，一句话讲完一个点，不要展开举例
3. 宁可短不要长：写到 ${low} 字也完全合格
4. 不新增观点、不改语气、不写任何说明文字

直接输出重写后的完整稿子：

${script}`,
        },
      ],
      { temperature: 0.4, maxTokens: 16384, effort: 'none' },
    )
    if (!fixed.ok) break
    const after = countChars(fixed.text)
    if (after >= got) break // 没变短就放弃，别反复烧 token
    script = fixed.text.trim()
  }

  return { ok: true, data: { script, model: r.model, chars: countChars(script) } }
}
