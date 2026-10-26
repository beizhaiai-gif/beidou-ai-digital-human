/**
 * talkcraft 后期引擎（第④步真链路）
 *
 * 把 video-talkcraft 的 8 步规范压成一次可编程调用：
 *   ① 音频提取 → ② FireRed 字级时间戳 → ③ 按句切四镜 → ④ 素材采集（抽帧/波形）
 *   → ⑤ 生成 shots.ts + sfx-cues.json + content.json → ⑥ Remotion 渲染
 *   → ⑦ motion_check 静止闸 → ⑧ 输出成片
 *
 * 母版固定在 server/talkcraft/（node_modules 软链到 talkcraft runtime，不复制 760MB）。
 * 渲染是重任务，用队列串行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { planStoryboard, shotsToPlan } from './plan.js'
import { planShotList } from './shotlist.js'
import { CARD_BY_ID } from './cards.js'
import { NODE_BIN, PY_BIN, FFMPEG_BIN, FFPROBE_BIN, TALK_CRAFT_HOME, dataDir } from './env.js'

const HOME = process.env.HOME
const TK = TALK_CRAFT_HOME
const PY = PY_BIN
const NODE = NODE_BIN
const FFMPEG = FFMPEG_BIN
const FFPROBE = FFPROBE_BIN

/** 用 fileURLToPath：中文目录经 URL.pathname 会被百分号编码，fs 打不开 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MASTER = path.join(ROOT, 'talkcraft')
const JOBS = dataDir('jobs', ROOT)

/* ---------------- 串行队列（渲染吃满 CPU，不能并发） ---------------- */
let chain = Promise.resolve()
const enqueue = (fn) => {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

function run(cmd, args, { cwd, timeout = 900000, env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL') } catch {}
    }, timeout)
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

/** 中文稿切句：按句末标点与换行 */
export function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])/))
    .map((s) => s.trim())
    .filter((s) => s.replace(/[\s，。！？；、,.!?;:：""''（）()]/g, '').length > 0)
}

function probeDuration(file) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ])
  return parseFloat(String(r.stdout || '0').trim()) || 0
}

/**
 * 四镜分配：按句子边界切（钩子 / 步骤 / 列举 / 例证）
 * 句子太少时退化为按时间比例切。
 */
function planShots(bounds, total) {
  const n = bounds.length
  if (n < 4) {
    const cut = [0, total * 0.25, total * 0.5, total * 0.78, total]
    return [
      { id: 's01', from: cut[0], to: cut[1] },
      { id: 's02', from: cut[1], to: cut[2] },
      { id: 's03', from: cut[2], to: cut[3] },
      { id: 's04', from: cut[3], to: cut[4] },
    ]
  }

  /**
   * 均衡切分：目标每镜 total/4，在最近的句子边界断开。
   * 按句子比例切会让某一镜吃到 13s，卡内动画早播完，后面就是干等（也是静止闸的根源）。
   */
  /**
   * 切点 = 每句结束时「离目标时刻最近」的那一句。
   * 早版取「第一个超过目标」的句子，遇到长句就把整镜吃掉（33s 稿会切出 16.8s 的第一镜）。
   */
  const cuts = []
  let last = 0
  for (let k = 1; k <= 3; k++) {
    const aim = (total * k) / 4
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < n - 1; i++) {
      const e = bounds[i].end
      if (e <= last + 1.2) continue // 每镜至少 1.2s
      const dist = Math.abs(e - aim)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    if (best < 0) break
    cuts.push(bounds[best].end)
    last = bounds[best].end
  }
  const edges = [0, ...cuts.sort((a, b) => a - b), total]
  return ['s01', 's02', 's03', 's04'].map((id, i) => ({ id, from: edges[i], to: edges[i + 1] }))
}

const CAM = {
  hook: [[0, 1.0], [1, 1.035]],
  steps: null, // 按段生成加密推近（过静止闸）
  list: 'pull',
  outro: 'push',
}

/* ---------------- 版式 ↔ 内容键 ↔ 时间基准 ---------------- */

/** 版式：hook 钩子 / steps 步骤 / list 列举 / broll 实拍录屏 / outro 收尾 */
const KINDS = ['hook', 'steps', 'list', 'broll', 'outro']
/** 规则版固定 4 镜的 id → 版式 */
const KIND_OF_RULE_ID = { s01: 'hook', s02: 'steps', s03: 'list', s04: 'outro' }
/** 版式 → 旧的顶层内容键（content.json 的 s01..s04，兼容老母版与工作台） */
const KIND_TO_LEGACY = { hook: 's01', steps: 's02', list: 's03', outro: 's04', broll: 'broll' }
/**
 * 每种版式「动画演完」的标准镜长（秒）。
 * 镜比这个长 → 动画放慢铺满，镜短 → 加速演完。夹在 0.8–1.8 之间，
 * 再慢就拖沓、再快就看不清。
 * broll 基准给到 5s：它只有「角标 + 三条引线」要演，演完画面就交给素材本身在动。
 */
const BASE_DUR = { hook: 3.1, steps: 3.6, list: 3.5, outro: 2.8, broll: 5.0 }

function timeScaleOf(kind, dur) {
  const base = BASE_DUR[kind] || 3.2
  return Math.min(1.8, Math.max(0.8, +(dur / base).toFixed(3)))
}

/**
 * 单镜最长 38 秒，超了就在最近的句边界劈开。
 *
 * 为什么必须代码兜底：模型答应「每镜 15–30 秒」，实测 3 分半的稿子它仍然会给出
 * 一个 58 秒的 broll。一张画面定住近一分钟，观感就是卡了。
 * 劈开时后半段沿用同一版式和同一素材，只是把标注清空 ——
 * 相当于「这一段界面还在讲，但不再重复指前面的点了」，正是真实产品演示的剪法。
 *
 * @param {Array<{id:string,kind:string,startSec:number,durationSec:number}>} plan
 * @param {{start:number,end:number}[]} bounds
 * @param {number} maxSec
 */
export function splitLongShots(plan, bounds, maxSec = 38) {
  let seq = 0
  const out = []
  for (const s of plan) {
    const parts = [{ ...s, srcId: s.id, part: 0 }]
    for (let guard = 0; guard < 4; guard++) {
      const idx = parts.findIndex((p) => p.durationSec > maxSec)
      if (idx < 0) break
      const p = parts[idx]
      // 切点必须离两端都留够 7 秒，否则切出来的半镜比原问题更糟
      const cands = bounds.filter((b) => b.end > p.startSec + 7 && b.end < p.startSec + p.durationSec - 7)
      if (!cands.length) break
      const mid = p.startSec + p.durationSec / 2
      const best = cands.reduce((a, b) => (Math.abs(b.end - mid) < Math.abs(a.end - mid) ? b : a))
      const head = { ...p, durationSec: best.end - p.startSec }
      const tailEnd = p.startSec + p.durationSec
      const tail = {
        ...p,
        id: `${s.id}_${++seq}`,
        startSec: best.end,
        durationSec: tailEnd - best.end,
        part: p.part + 1,
      }
      parts.splice(idx, 1, head, tail)
    }
    out.push(...parts)
  }
  return out
}

function shotsTs(shots) {
  /**
   * 相机 path 统一 4 点加密：静止闸按「画面变化量」判定，
   * 匀速缓推在长 hold 段会掉到阈值以下，必须把推近量压到每段都可感知。
   * 每镜总位移按版式定：hook 推近 / steps 推近 / list 拉出 / outro 推近
   */
  const PATHS = {
    hook: [1.0, 1.058],
    steps: [1.0, 1.055],
    list: [1.058, 1.0],
    outro: [1.0, 1.062],
    // broll 只能推不能拉：素材是满幅铺的，拉出会露黑边
    broll: [1.0, 1.048],
  }

  /**
   * 关键帧密度按「每 3 秒一点」排：
   * 静止闸看的是画面变化量，长镜（如 13s）用 4 点会把后段压到 0.4% 以下而判静止。
   */
  const dump = (s) => {
    const [from, to] = PATHS[s.kind] || PATHS.hook
    const dur = s.durationSec
    const n = Math.max(4, Math.ceil(dur / 3))
    const path = Array.from({ length: n }, (_, i) => {
      const p = i / (n - 1)
      const t = i === n - 1 ? dur : dur * p
      const scale = from + (to - from) * p
      return `      {t: ${t.toFixed(2)}, scale: ${scale.toFixed(4)}},`
    }).join('\n')
    return `  {
    id: '${s.id}',
    kind: '${s.kind}' as const,
    tScale: ${(s.tScale ?? 1).toFixed(3)},
    startSec: ${s.startSec.toFixed(2)},
    durationSec: ${dur.toFixed(2)},
    lead: 0,
    tail: 0,
    path: [
${path}
    ],
    impulses: [],
  },`
  }

  return `import type {CamImpulse, CamKey} from './camera';

export type ShotKind = 'hook' | 'steps' | 'list' | 'broll' | 'outro';

/** 镜头表（秒制，24fps 成片）。人物层由 HostBox 单独驱动，这里的 path 只驱动内容层的相机。 */
export type Shot = {
  id: string;
  kind: ShotKind;
  /** 动画时间缩放：镜比版式基准长就 >1（放慢），短就 <1（加速） */
  tScale: number;
  startSec: number;
  durationSec: number;
  lead: number;
  tail: number;
  path: CamKey[];
  impulses: CamImpulse[];
};

export const SHOTS: Shot[] = [
${shots.map(dump).join('\n')}
];

export const SHOT_BY_ID = SHOTS.reduce<Record<string, Shot>>((m, s) => {
  m[s.id] = s;
  return m;
}, {});

/** 镜头在时间线上的落点与长度（帧） */
export function shotSequence(shot: Shot, fps: number) {
  const from = Math.round((shot.startSec - shot.lead) * fps);
  const duration = Math.round((shot.durationSec + shot.lead + shot.tail) * fps);
  return {from, duration};
}
`
}

/**
 * 音效 cue：按「版式」的相对时刻生成，再乘该镜的 tScale。
 * 这样动画放慢时音效点跟着走，不会出现"画面还没砸下去音效先响"。
 */
const CUE_BY_KIND = {
  hook: [
    [0.9, 'scratch', -4, '划线（否定）'],
    [1.6, 'pop', -6, '新值替换'],
    [2.0, 'whoosh', -10, '人物缩窗'],
  ],
  steps: [
    [0.05, 'slam', -2, '章节卡压入'],
    [1.72, 'swipe', -8, '章节卡扫出'],
    [2.5, 'tick', -12, '节点 1'],
    [2.68, 'tick', -13, '节点 2'],
    [2.86, 'tick', -14, '节点 3'],
    [2.98, 'ding', -8, '空心环升级'],
  ],
  list: [
    [0.22, 'pop', -8, '三卡 1'],
    [0.66, 'pop', -8, '三卡 2'],
    [1.1, 'pop', -8, '三卡 3'],
    [2.94, 'pk-ui-pop', -10, '焦点 1'],
    [3.3, 'pk-ui-pop', -10, '焦点 2'],
  ],
  outro: [
    [0.2, 'paper', -8, '杂志框上台'],
    [2.42, 'tick', -10, 'label 1'],
    [2.94, 'tick', -9, 'label 2'],
    [3.3, 'tick', -8, 'label 3'],
  ],
  // broll：素材切入一记轻推，随后三条引线依次「钉」上去
  broll: [
    [0.12, 'whoosh', -14, '画面切入'],
    [0.34, 'tick', -15, '标注 1'],
    [0.82, 'tick', -15, '标注 2'],
    [1.26, 'tick', -14, '标注 3'],
  ],
}

function cuesFor(shots, total) {
  const out = []
  for (const s of shots) {
    const table = CUE_BY_KIND[s.kind] || CUE_BY_KIND.steps
    const k = s.tScale ?? 1
    for (const [rel, sfx, db, event] of table) {
      const t = +(s.startSec + rel * k).toFixed(2)
      // 落在本镜之内、且不贴片头片尾才要
      if (t <= 0.3 || t >= total - 0.1) continue
      if (t >= s.startSec + s.durationSec - 0.05) continue
      out.push({ t, sfx, db, event })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * 实拍素材（broll）：放在 `server/talkcraft/public/broll/` 下的录屏或截图。
 * 文件名（去扩展名）就是模型能选的 key；同目录放 `hints.json` 可以给每个 key 写一句说明，
 * 模型才知道「这段该配哪个界面」。
 *
 * 也支持按任务放：`server/jobs/<jobId>/broll/` —— 渲染前会拷进母版 public/broll/。
 */
const BROLL_DIR = path.join(MASTER, 'public/broll')
const BROLL_EXT = ['.mp4', '.webm', '.mov', '.png', '.jpg', '.jpeg', '.webp']

function scanBrollDir(dir) {
  if (!fs.existsSync(dir)) return []
  let hints = {}
  const hintFile = path.join(dir, 'hints.json')
  if (fs.existsSync(hintFile)) {
    try { hints = JSON.parse(fs.readFileSync(hintFile, 'utf8')) || {} } catch {}
  }
  const out = []
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.startsWith('.')) continue
    const ext = path.extname(f).toLowerCase()
    if (!BROLL_EXT.includes(ext)) continue
    const key = f.slice(0, -ext.length)
    out.push({
      key,
      type: ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : 'image',
      src: `broll/${f}`,
      file: path.join(dir, f),
      hint: hints[key] || '',
    })
  }
  return out
}

/** 任务级素材优先，其次母版公共素材；同名时任务级覆盖 */
function listBrollAssets(jobDir) {
  const map = new Map()
  for (const a of scanBrollDir(BROLL_DIR)) map.set(a.key, a)
  if (jobDir) for (const a of scanBrollDir(path.join(jobDir, 'broll'))) map.set(a.key, a)
  return [...map.values()]
}
/**
 * 默认文案兜底
 * 纪律：兜底必须"语义安全"，宁可通用名词也不从句子硬切（切片会产出「第一步，我」这种脏词）。
 * 真正贴合内容的文案由上游第②步薛辉稿件 + content 参数注入。
 */
function defaultContent(sentences) {
  const clean = (t) =>
    String(t || '')
      .replace(/[，,。！？；、,.!?;:：]\s*/g, '')
      .replace(/^(第一步|第二步|第三步|第[一二三四五六七八九十]步)/, '')
      .trim()
  const cand = sentences.map(clean).filter((x) => x.length >= 3 && x.length <= 12)
  return {
    s01: { line: '你看到的我，是', from: '真人', to: 'AI 生成' },
    s02: {
      num: '01',
      name: cand[0]?.slice(0, 8) || '拆解流程',
      sub: 'CHAPTER 01',
      steps: [
        { kicker: '第一步', title: cand[1]?.slice(0, 10) || '先定方向' },
        { kicker: '第二步', title: cand[2]?.slice(0, 10) || '再定素材' },
        { kicker: '第三步', title: cand[3]?.slice(0, 10) || '最后出片' },
      ],
    },
    s03: { items: ['画面', '素材', '声音'] },
    s04: { labels: ['人物', '字幕', '流程'], frameNote: 'PREVIEW' },
    // broll 兜底：没有大模型文案时也给一组能上屏的中性标注（不硬切句子）
    broll: { media: '', caption: '看这里', labels: ['数据一屏', '不用切软件', '随时能加'] },
  }
}

/**
 * 跑一次完整后期
 * @param {string} jobId
 * @param {{videoPath:string, script:string, content?:object, workbench?:object}} opts
 * @param {(p:{stage:string, progress:number})=>void} onProgress
 */
export function runTalkcraft(jobId, opts, onProgress = () => {}) {
  return enqueue(() => doRun(jobId, opts, onProgress))
}

/**
 * 为一个任务准备独立的渲染工程。
 *
 * 为什么要隔离：Remotion 的镜头表 / 卡片文案 / 字幕时间都写在工程 src 里，
 * 原来是全站共用一份 server/talkcraft/src —— 两个任务同时跑，后一个会把前一个的
 * content.json 覆盖掉，第一个人渲染出来的可能是别人的内容。
 *
 * 成本控制：src 只有 1.6MB，直接复制；node_modules 760MB，用软链；
 * public 里是任务自己的素材（配音/原视频），软链过去。
 * lab 目录是卡片实验台（108 个 tsx），生产渲染用不到，复制时排除。
 */
/**
 * 音频统一成 24k 单声道 wav，并顺手把响度拉回正常。
 *
 * 为什么要自动修：用户导出的 mp3 音量可能低到 -70 LUFS（实测遇到过一次），
 * 直接渲染出来等于没声音。而且 loudnorm 对这么低的电平完全失效（输出还是 -81dB），
 * 所以按峰值算一个固定增益，再限幅兜底。
 */
async function loudnessFix(input, out) {
  const probe = await run(FFMPEG, ['-v', 'info', '-i', input, '-af', 'volumedetect', '-f', 'null', '/dev/null'])
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(probe.err || '')
  const maxDb = m ? parseFloat(m[1]) : -3
  const gain = Math.min(70, Math.max(0, -1.5 - maxDb))
  const af = gain > 1 ? `volume=${gain.toFixed(1)}dB,alimiter=limit=0.95` : 'anull'
  const r = await run(FFMPEG, [
    '-y', '-v', 'error', '-i', input, '-af', af, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out,
  ])
  return {...r, gain: gain > 1 ? gain : 0, maxDb}
}

function prepareEngine(dir) {  const engine = path.join(dir, 'engine')
  const pub = path.join(dir, 'public')
  for (const d of [pub, path.join(pub, 'video'), path.join(pub, 'stills')]) {
    fs.mkdirSync(d, { recursive: true })
  }

  // 重试时复用已有 engine，不重复复制
  if (!fs.existsSync(path.join(engine, 'src'))) {
    fs.mkdirSync(engine, { recursive: true })
    fs.cpSync(path.join(MASTER, 'src'), path.join(engine, 'src'), {
      recursive: true,
      filter: (s) => !s.includes(`${path.sep}lab`),
    })
    const nm = path.join(engine, 'node_modules')
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(MASTER, 'node_modules'), nm)
    const ep = path.join(engine, 'public')
    if (!fs.existsSync(ep)) fs.symlinkSync(pub, ep)
  }

  /**
   * 配置文件每次都补齐（缺一个就渲不出来）。
   * remotion.config.ts 必须带上：没有它 Remotion 走默认配置，
   * 实测会在 setup-cache 阶段直接崩（错误信息还很难读）。
   */
  for (const f of ['package.json', 'tsconfig.json', 'remotion.config.ts', 'overrides.json']) {
    const sp = path.join(MASTER, f)
    const dp = path.join(engine, f)
    if (fs.existsSync(sp) && !fs.existsSync(dp)) fs.copyFileSync(sp, dp)
  }

  return { engine, pub }
}

/**
 * PIP 小窗停哪一角：按卡片文字最多的地方错开（左上永远留给片头/字幕）。
 * 抽成常量是因为「换卡重渲」时角位要跟着新卡重新算。
 */
const CORNER = {
  'keyword-pop-highlight': 'tr',
  'line-by-line-slide': 'tr',
  'quote-card': 'tr',
  'chapter-title-card': 'tr',
  'info-term-card': 'bl',
  'hand-drawn-ellipse': 'br',
  'chat-gpt': 'br',
  'subscribe-cta': 'br',
}

/** 卡片自然时长 → 镜级动画缩放（镜短就加速演完，镜长就放慢铺满，夹在 0.55–1.8） */
function scaleFor(card, dur) {
  const natural = CARD_BY_ID[card]?.dur ?? 3
  return +Math.min(1.8, Math.max(0.55, dur / Math.max(0.4, natural))).toFixed(3)
}

/**
 * 把分镜数组写成 Remotion 工程认识的三个文件。
 *
 * 抽出来的原因：初次渲染和「改卡重渲」必须走同一份写入逻辑，
 * 否则两条路生成的 shots.ts 会有细微差异（字段顺序 / tScale 算法），
 * 表现就是「只换了张卡，别的镜也变了」。
 *
 * @param shots [{id, kind, card, tScale, startSec, durationSec, corner, fields, text}]
 */
function emitShotFiles({ engine, shots, total, timingScenes, capStyle }) {
  const shotLines = []
  const contentShots = {}

  for (const s of shots) {
    const dur = Number(s.durationSec) || 0.4
    const path =
      s.kind === 'card'
        ? `[{t: 0, scale: 1}, {t: ${dur.toFixed(2)}, scale: 1.028}]`
        : `[{t: 0, scale: 1}, {t: ${dur.toFixed(2)}, scale: 1}]`

    shotLines.push(
      `  {\n` +
        `    id: '${s.id}',\n` +
        `    kind: '${s.kind}' as const,\n` +
        `    cardId: '${s.card}' as const,\n` +
        `    tScale: ${Number(s.tScale) || 1},\n` +
        `    startSec: ${Number(s.startSec).toFixed(2)},\n` +
        `    durationSec: ${dur.toFixed(2)},\n` +
        `    lead: 0,\n` +
        `    tail: 0,\n` +
        `    path: ${path},\n` +
        `    impulses: [],\n` +
        `  },`,
    )

    contentShots[s.id] = {
      card: s.card,
      fields: s.fields || {},
      corner: s.corner || CORNER[s.card] || 'tr',
      text: s.text || '',
      note: s.note || '',
    }
  }

  const type = `import type {CamImpulse, CamKey} from './camera';

export type ShotKind = 'hook' | 'steps' | 'list' | 'outro' | 'broll' | 'card' | 'person';

export type Shot = {
  id: string;
  kind: ShotKind;
  /** kind='card' 时用哪张卡（cards-live 注册表里的 id） */
  cardId?: string;
  /** 卡片动画时间缩放：镜短就加速，镜长就放慢 */
  tScale: number;
  startSec: number;
  durationSec: number;
  lead: number;
  tail: number;
  path: CamKey[];
  impulses: CamImpulse[];
};

export const SHOTS: Shot[] = [
${shotLines.join('\n')}
];

export const SHOT_BY_ID = SHOTS.reduce<Record<string, Shot>>((m, s) => {
  m[s.id] = s;
  return m;
}, {});

export function shotSequence(shot: Shot, fps: number) {
  const from = Math.round((shot.startSec - shot.lead) * fps);
  const duration = Math.round((shot.durationSec + shot.lead + shot.tail) * fps);
  return {from, duration};
}
`
  fs.writeFileSync(path.join(engine, 'src/shots.ts'), type)

  const content = {
    captionStyle: ['karaoke', 'line', 'punch'].includes(capStyle) ? capStyle : 'line',
    // 用原片字幕（原视频自带、和配音同源）；换成干净素材时把 on 设成 true
    captions: { on: false },
    pip: { on: true, cx: 0.5, cy: 0.3, w: 0.28, boxW: 300, boxH: 380 },
    shots: contentShots,
  }
  fs.writeFileSync(path.join(engine, 'src/content.json'), JSON.stringify(content, null, 1))
  fs.writeFileSync(
    path.join(engine, 'src/timing.json'),
    JSON.stringify({ totalSec: +Number(total).toFixed(2), scenes: timingScenes || [] }, null, 1),
  )
  // 老母版还会读这个，写个空的避免 undefined
  fs.writeFileSync(
    path.join(engine, 'src/sfx-cues.json'),
    JSON.stringify({ note: 'shotlist 模式暂不加音效', cues: [] }, null, 1),
  )

  return contentShots
}

/** 字级时间按镜切开，给字幕用（改卡不影响，但重渲必须带同一份） */
function buildTiming(ts, shots) {
  const chars = []
  for (const s of ts.sentences || []) {
    for (const w of s.words || []) {
      chars.push({ ch: w.text, t: +Number(w.start).toFixed(2), e: +Number(w.end).toFixed(2) })
    }
  }
  const scenes = []
  for (const s of shots) {
    const end = s.startSec + s.durationSec
    const pick = chars.filter((c) => c.t >= s.startSec - 0.05 && c.t < end)
    if (pick.length) {
      scenes.push({
        id: s.id,
        text: s.text || '',
        startSec: +Number(s.startSec).toFixed(2),
        durationSec: +Number(s.durationSec).toFixed(2),
        chars: pick,
      })
    }
  }
  return scenes
}

/** 调 Remotion 出片（串行队列保证同一时刻只有一个渲染在吃 CPU） */
function renderEngine(engine, out) {
  const env = { ...process.env }
  delete env.NODE_OPTIONS // 绕开 broker shim
  return new Promise((resolve) => {
    const p = spawn(
      NODE,
      [path.join(engine, 'node_modules/.bin/remotion'), 'render', 'src/index.ts', 'Main', out, '--log=error'],
      { cwd: engine, env, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let e = ''
    p.stderr.on('data', (d) => (e += d.toString()))
    p.on('close', (code) => resolve({ code, err: e }))
  })
}

/**
 * 51 镜链路：逐句切段 → 大模型逐段挑卡 → 渲染。
 *
 * 和旧的「5 版式」链路并行存在，由 /api/edit 的 `mode` 决定走哪条：
 *   shotlist（默认）—— 每 3–5 秒一镜，每镜配一张具体卡片，视觉更密
 *   legacy          —— 老的 4 镜卡片 + broll 版式
 *
 * 时间轴直接用 FireRed 的真实字级时间戳切，不做估算，
 * 所以镜长天然和配音对得上，不需要二次对齐。
 */
async function runShotlistMode(ctx) {
  const {jobId, dir, engine, pub, wav, total, ts, up, say, script, capStyle} = ctx

  /* ① 逐句切段 + 挑卡 */
  up('分镜规划', 42)
  /**
   * 时间戳清洗：强制对齐在「稿子和配音不是同一份」时会给出重叠起点、终点超出片长。
   * 不清洗的话切段会算出负时长。
   */
  const timed = []
  let lastEnd = 0
  for (const s of ts.sentences || []) {
    const start = Math.max(lastEnd, Math.min(Math.max(0, Number(s.start) || 0), total))
    const end = Math.min(total, Math.max(start + 0.2, Number(s.end) || 0))
    if (start >= total - 0.05) break
    timed.push({text: s.text || '', start, end})
    lastEnd = end
  }
  if (!timed.length) throw new Error('时间戳清洗后没有可用句子')
  const r = await planShotList({sentences: timed, total, script})
  if (!r.ok) throw new Error('分镜失败：' + r.error)
  const shots = r.shots
  say(`逐句配卡 ${shots.length} 镜｜平均 ${r.stats.avgDur}s｜纯人物 ${r.stats.personPct}%`)
  say('卡片分布：' + r.stats.cards.map((c) => `${c.name}×${c.n}`).join(' / '))

  /* ② 生成工程文件 */
  up('生成工程', 50)

  /** 归一化后的分镜序列：落盘成 shotlist.json，前端「改卡重渲」就改这一份 */
  const seq = shots.map((s, i) => {
    const id = `s${String(i + 1).padStart(2, '0')}`
    const kind = s.type === 'person' ? 'person' : 'card'
    const durationSec = Math.max(0.4, +(s.endSec - s.startSec).toFixed(2))
    const fields = {...(s.fields || {})}
    // 手绘圈卡要「首行铺垫 + 被圈住的词」两段，分镜只给 target 时从台词补首行
    if (s.card === 'hand-drawn-ellipse' && !fields.lead && fields.target) {
      const t = s.text || ''
      const idx = t.replace(/\s/g, '').indexOf(String(fields.target).replace(/\s/g, ''))
      const head = (idx > 0 ? t.slice(0, idx) : t.slice(0, 6)).replace(/[，。、；：]$/, '').trim()
      if (head) fields.lead = head.slice(-10)
    }
    return {
      id,
      kind,
      card: s.card,
      // 人镜不需要动画缩放
      tScale: kind === 'person' ? 1 : scaleFor(s.card, durationSec),
      startSec: +(+s.startSec).toFixed(2),
      durationSec,
      corner: CORNER[s.card] || 'tr',
      fields,
      text: s.text || '',
      note: s.note || '',
    }
  })

  const contentShots = emitShotFiles({
    engine,
    shots: seq,
    total,
    timingScenes: buildTiming(ts, seq),
    capStyle,
  })

  // 分镜底稿：改卡重渲的唯一数据源（不含时间戳，几十 KB）
  const capFinal = ['karaoke', 'line', 'punch'].includes(capStyle) ? capStyle : 'line'
  fs.writeFileSync(
    path.join(dir, 'shotlist.json'),
    JSON.stringify(
      {version: 1, jobId, mode: 'shotlist', totalSec: +total.toFixed(2), capStyle: capFinal, at: Date.now(), shots: seq},
      null,
      1,
    ),
  )

  /* ③ 素材：配音 + 原视频（人物镜和 PIP 都要用同一份） */
  up('准备素材', 54)
  fs.copyFileSync(wav, path.join(pub, 'narration.wav'))
  const hostPath = path.join(pub, 'video/host.mp4')
  // ② 阶段已经在 job 目录生成过 host.mp4（30fps、裁到音频长度），直接搬过来
  const staged = path.join(dir, 'host.mp4')
  if (fs.existsSync(staged)) fs.copyFileSync(staged, hostPath)
  else fs.copyFileSync(ctx.videoPath, hostPath)
  const srcPath = path.join(pub, 'video/source.mp4')
  // 不重编码，直接硬链接（同盘零成本）；跨盘才复制
  try {
    if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath)
    fs.linkSync(hostPath, srcPath)
  } catch {
    fs.copyFileSync(hostPath, srcPath)
  }

  /* ④ 渲染 */
  up('Remotion 渲染', 58)
  const out = path.join(dir, 'final_1080p.mp4')
  const rr = await renderEngine(engine, out)
  if (rr.code !== 0 || !fs.existsSync(out)) throw new Error('渲染失败：' + rr.err.slice(-500))
  say('渲染完成 ' + (fs.statSync(out).size / 1048576).toFixed(1) + 'MB')

  /* ⑤ 质量闸 */
  up('质量闸', 94)
  const mc = spawnSync(PY, [path.join(TK, 'scripts/motion_check.py'), out], {encoding: 'utf8', timeout: 180000})
  const verdict = (mc.stdout || '').includes('PASS') ? 'PASS' : 'WARN'
  say('motion_check: ' + verdict)

  return {
    ok: true,
    mode: 'shotlist',
    video: `/jobs/${jobId}/final_1080p.mp4`,
    duration: +total.toFixed(2),
    shots: shots.map((s, i) => ({
      id: `s${String(i + 1).padStart(2, '0')}`,
      kind: s.type === 'person' ? 'person' : 'card',
      card: s.card,
      start: +(+s.startSec).toFixed(2),
      dur: +(s.endSec - s.startSec).toFixed(2),
    })),
    cues: 0,
    gate: verdict,
    planMode: 'shotlist',
    planNote: `逐句配卡 ${shots.length} 镜`,
    cards: {
      s01: contentShots.s01?.fields?.line || contentShots.s01?.fields?.text || '',
      s02: '',
      s03: '',
    },
  }
}

async function doRun(jobId, opts, onProgress) {
  const { videoPath, content: userContent, capStyle, smartPlan } = opts
  const dir0 = path.join(JOBS, jobId)
  /**
   * 稿子兜底：重试时前端不一定带 script，但 job 目录里有上次的 script.json，
   * 直接拿回来用，否则会报「口播稿为空」。
   */
  let script = opts.script || ''
  if (!script) {
    const sj = path.join(dir0, 'script.json')
    if (fs.existsSync(sj)) {
      try {
        script = (JSON.parse(fs.readFileSync(sj, 'utf8')).sentences || []).join('')
      } catch {}
    }
  }
  const up = (stage, progress) => onProgress({ stage, progress })
  const dir = path.join(JOBS, jobId)
  fs.mkdirSync(dir, { recursive: true })
  const { engine, pub } = prepareEngine(dir)
  const log = []
  const say = (s) => { log.push(s); try { fs.writeFileSync(path.join(dir, 'pipeline.log'), log.join('\n')) } catch {} }

  try {
    /* ① 音频：优先用单独上传的配音，没有才从视频抽轨 */
    up('音频提取', 8)
    const wav = path.join(dir, 'narration.wav')
    const audioIn = opts.audioPath && fs.existsSync(opts.audioPath) ? opts.audioPath : videoPath
    say(audioIn === videoPath ? '音频来源：视频自带音轨' : '音频来源：单独上传的配音')
    let r = await loudnessFix(audioIn, wav)
    if (r.code !== 0) throw new Error('音频处理失败：' + r.err.slice(-300))
    const total = probeDuration(wav)
    if (!total) throw new Error('音频为空')
    say(`音频 ${total.toFixed(2)}s（${r.gain ? '响度 +' + r.gain.toFixed(1) + 'dB' : '响度正常'}）`)

    /* ② 素材：人物裁到音频长度 / 抽帧 / 波形 */
    up('素材采集', 18)
    const host = path.join(dir, 'host.mp4')
    // 帧率必须和 Root.tsx 的 FPS 一致（30）——写成 24 会让时间轴整体 0.8 倍速错位
    r = await run(FFMPEG, ['-y', '-v', 'error', '-i', videoPath, '-t', String(total),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-an', host])
    if (r.code !== 0) throw new Error('人物裁切失败：' + r.err.slice(-300))

    const stills = path.join(dir, 'stills')
    fs.mkdirSync(stills, { recursive: true })
    await run(FFMPEG, ['-y', '-v', 'error', '-ss', String(Math.max(1, total * 0.45)), '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=1000:562', path.join(stills, 'dh.png')])
    await run(FFMPEG, ['-y', '-v', 'error', '-i', wav, '-filter_complex',
      'showwavespic=s=1400x480:colors=#E0452C', '-frames:v', '1', path.join(stills, 'wave.png')])
    // 形象图：用人物视频首帧（真素材，不用占位）
    await run(FFMPEG, ['-y', '-v', 'error', '-ss', '0.2', '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=1000:562', path.join(stills, 'ref.png')])

    /* ③ FireRed 字级时间戳 */
    up('字级时间戳', 30)
    const sentences = splitSentences(script)
    if (!sentences.length) throw new Error('口播稿为空，无法对齐')
    const scriptJson = path.join(dir, 'script.json')
    fs.writeFileSync(scriptJson, JSON.stringify({ sentences }, null, 2))
    const tsJson = path.join(dir, 'timestamps.json')
    /**
     * 时间戳复用：同一个 job 重跑（脚本改过、渲染失败重试）时不必再对齐一遍，
     * FireRed 跑 123 秒音频要约 10 分钟，是整条链路最贵的一步。
     */
    if (fs.existsSync(tsJson)) {
      say('时间戳：复用已有的 ' + tsJson.split('/').pop())
    } else {
      r = await run(PY, [path.join(TK, 'scripts/timestamps_cpu.py'), wav, scriptJson, tsJson], { timeout: 1200000 })
      if (r.code !== 0) throw new Error('时间戳对齐失败：' + r.err.slice(-400))
      say('时间戳：' + (r.out.trim().split('\n').slice(-3).join(' | ')))
    }
    const ts = JSON.parse(fs.readFileSync(tsJson, 'utf8'))
    /**
     * 时间戳清洗：强制对齐在「稿子和配音不是同一份」时会给出离谱结果
     * （起点重叠、终点超出片长）。不修的话分镜算出非法时长，整条回落到规则版。
     * 这里把每句裁进 [0, total] 并强制递增，坏数据最多让字幕错位，不会让出片失败。
     */
    const rawBounds = (ts.sentences || []).map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0 }))
    const bounds = []
    let lastEnd = 0
    for (const b of rawBounds) {
      const start = Math.max(lastEnd, Math.min(Math.max(0, b.start), total))
      const end = Math.min(total, Math.max(start + 0.2, b.end))
      if (start >= total - 0.05) break
      bounds.push({ start, end })
      lastEnd = end
    }
    if (!bounds.length) throw new Error('时间戳结果为空')

    /**
     * 默认走 51 镜链路（逐句配卡）。
     * 传 mode='legacy' 才走老的 5 版式（钩子/步骤/列举/收尾/broll）。
     */
    if (opts.mode !== 'legacy') {
      return await runShotlistMode({jobId, dir, engine, pub, wav, total, ts, up, say, script, capStyle, videoPath})
    }

    /* ④ 分镜规划：先让大模型判语义，拿不到再回落规则版 */
    up('分镜规划', 42)

    const timedSentences = (ts.sentences || []).map((s, i) => ({
      text: s.text || sentences[i] || '',
      start: s.start,
      end: s.end,
    }))
    let plan = null
    let shotContents = null
    let planMode = 'rule'
    let planNote = ''

    // 实拍素材清单：先扫描，模型要靠它决定「这段能不能用 broll」
    const brollAssets = listBrollAssets(dir)
    if (brollAssets.length) say(`实拍素材 ${brollAssets.length} 个：${brollAssets.map((a) => a.key).join(' / ')}`)

    if (smartPlan !== false) {
      const ai = await planStoryboard({ script, sentences: timedSentences, total, assets: brollAssets })
      if (!ai.ok) {
        planNote = `大模型分镜不可用，已回落规则分镜：${ai.error}`
        say(planNote)
      } else {
        const p = shotsToPlan(bounds, total, ai.shots)
        if (!p) {
          planNote = '大模型给的镜头表挪不出合法时长，回落规则分镜'
          say(planNote)
        } else {
          plan = p
          shotContents = ai.contents
          planMode = 'llm'
          const kinds = ai.shots.map((s) => `${s.id}:${s.kind}`).join(' → ')
          say(`语义分镜 OK（${ai.model}）：共 ${p.length} 镜 ${kinds}`)
          if (ai.fixed) say('（模型给的镜头表有小问题，已按规则修补）')
        }
      }
    } else {
      planNote = '已关闭智能分镜，走规则版'
    }

    up('分镜规划', 48)
    if (!plan) {
      // 规则兜底：固定 4 镜（钩子 / 步骤 / 列举 / 收尾）
      plan = planShots(bounds, total).map((s) => ({
        id: s.id,
        kind: KIND_OF_RULE_ID[s.id] || 'steps',
        startSec: s.from,
        durationSec: Math.max(0.8, s.to - s.from),
      }))
      // 末镜抵到片尾（不允许留黑）
      const last = plan[plan.length - 1]
      last.durationSec = Math.max(0.8, total - last.startSec)
      shotContents = null
    }

    /**
     * 兜底：单镜超过 38 秒就沿句边界再切一刀（模型不一定会照做）。
     * 切完重排序号，并把每段的「内容来源镜」记在 srcId 上。
     */
    const beforeCount = plan.length
    plan = splitLongShots(plan, bounds).map((s, i) => ({ ...s, id: `s${String(i + 1).padStart(2, '0')}` }))
    if (plan.length > beforeCount) say(`有长镜超过 38s，自动再切：${beforeCount} → ${plan.length} 镜`)

    // 每镜的时间缩放系数：镜比版式基准长就放慢动画，短就加速（夹在 0.8–1.8）
    for (const s of plan) {
      s.tScale = timeScaleOf(s.kind, s.durationSec)
    }

    // 文案：镜级 payload 放 content.shots，顶层保留 s01..s04 兼容旧母版
    const base = defaultContent(sentences)
    const content = { ...base }
    content.shots = {}
    for (const s of plan) {
      const src = shotContents?.[s.srcId || s.id]
      const fallback = base[KIND_TO_LEGACY[s.kind]] || base.s01
      /**
       * 被切开的后半段（part > 0）：沿用同一素材和版式，但清空标注。
       * 否则同一批标注会在三十秒后再弹一遍，像卡带。
       */
      const isTail = Number(s.part) > 0
      content.shots[s.id] = isTail && s.kind === 'broll' ? { ...fallback, ...(src || {}), labels: [] } : { ...fallback, ...(src || {}) }
      /**
       * broll 的 media 是「素材 key」，这里翻译成母版里的真实路径 + 类型。
       * 不翻译的话组件拿到的是裸 key，staticFile 会 404。
       */
      if (s.kind === 'broll') {
        const c = content.shots[s.id]
        const key = typeof c.media === 'string' ? c.media : ''
        const hit = brollAssets.find((a) => a.key === key) || brollAssets[0]
        c.media = hit ? { src: hit.src, type: hit.type } : undefined
        if (!hit) say(`⚠ ${s.id} 是 broll 但没有可用素材，回落成人物全屏`)
      }
      // 旧的顶层键也填上，工作台/老组件读得到
      if (!content[KIND_TO_LEGACY[s.kind]] || src) content[KIND_TO_LEGACY[s.kind]] = content.shots[s.id]
    }
    // 用户手填的覆盖（按 kind 对齐）
    if (userContent && typeof userContent === 'object') Object.assign(content, userContent)
    // 字幕版式：MainVideo 从 content.json 读 captionStyle 决定 karaoke / line / punch
    const CAPTION_OK = ['karaoke', 'line', 'punch']
    content.captionStyle = CAPTION_OK.includes(capStyle) ? capStyle : 'line'
    fs.writeFileSync(path.join(engine, 'src/content.json'), JSON.stringify(content, null, 2))
    fs.writeFileSync(path.join(engine, 'src/shots.ts'), shotsTs(plan))
    const timingOut = path.join(engine, 'src/timing.json')
    const mt = await run(PY, [path.join(TK, 'scripts/make_timing.py'), tsJson, timingOut])
    if (mt.code !== 0) throw new Error('timing 生成失败：' + mt.err.slice(-300))

    // 音效 cue
    const cues = cuesFor(plan, total)
    fs.writeFileSync(path.join(engine, 'src/sfx-cues.json'), JSON.stringify({ note: '按镜头动作点生成', cues }, null, 2))
    fs.writeFileSync(path.join(dir, 'cues.json'), JSON.stringify(cues, null, 2))

    // 素材落到母版 public
    fs.copyFileSync(wav, path.join(pub, 'narration.wav'))
    fs.copyFileSync(host, path.join(pub, 'video/host.mp4'))
    for (const f of ['dh.png', 'ref.png', 'wave.png']) {
      fs.copyFileSync(path.join(stills, f), path.join(pub, 'stills', f))
    }
    // 任务自带实拍素材（jobs/<id>/broll/）要拷进母版，Remotion 只能从 public 取静态资源
    const jobBroll = path.join(dir, 'broll')
    if (fs.existsSync(jobBroll)) {
      fs.mkdirSync(BROLL_DIR, { recursive: true })
      for (const a of brollAssets) {
        const from = path.join(jobBroll, path.basename(a.file))
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(BROLL_DIR, path.basename(a.file)))
      }
    }
    // s04 的「成片框」素材：有上一版成片就用，否则用本次人物原片兜底
    const previewSrc = opts.previousVideo && fs.existsSync(opts.previousVideo)
      ? opts.previousVideo
      : host
    fs.copyFileSync(previewSrc, path.join(pub, 'video/preview.mp4'))

    /* ⑤ 渲染 */
    up('Remotion 渲染', 55)
    const out = path.join(dir, 'final_1080p.mp4')
    const env = { ...process.env }
    delete env.NODE_OPTIONS // 绕开 broker shim（否则 webpack 临时目录被拦）
    r = await new Promise((resolve) => {
      const p = spawn(NODE, [
        path.join(engine, 'node_modules/.bin/remotion'), 'render', 'src/index.ts', 'Main', out, '--log=error',
      ], { cwd: engine, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let e = ''
      p.stderr.on('data', (d) => (e += d.toString()))
      p.on('close', (code) => resolve({ code, err: e }))
    })
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error('渲染失败：' + r.err.slice(-500))
    say('渲染完成 ' + (fs.statSync(out).size / 1048576).toFixed(1) + 'MB')

    /* ⑥ 静止闸 */
    up('质量闸', 94)
    const mc = spawnSync(PY, [path.join(TK, 'scripts/motion_check.py'), out], { encoding: 'utf8', timeout: 180000 })
    const verdict = (mc.stdout || '').includes('PASS') ? 'PASS' : 'WARN'
    say('motion_check: ' + verdict)

    return {
      ok: true,
      video: `/jobs/${jobId}/final_1080p.mp4`,
      duration: total,
      shots: plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        start: +s.startSec.toFixed(2),
        dur: +s.durationSec.toFixed(2),
      })),
      cues: cues.length,
      gate: verdict,
      planMode,
      planNote,
      // 给前端展示每一镜用了什么版式、卡片上写了什么
      cards: plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: shotContents?.[s.id]
          ? shotContents[s.id].name ||
            shotContents[s.id].line ||
            shotContents[s.id].caption ||
            (shotContents[s.id].items || []).join('·') ||
            (shotContents[s.id].labels || []).join('·')
          : '',
      })),
    }
  } catch (e) {
    say('ERROR ' + e.message)
    return { ok: false, error: e.message, log: log.slice(-8) }
  }
}

/* ---------------- 卡片可干预：改卡 / 改文案后只重渲 ---------------- */

/**
 * 老作品反推底稿。
 *
 * shotlist.json 是后加的，之前渲的几十条都没有。但它们盘上留着
 * engine/src/shots.ts + content.json —— 时间轴和每镜文案本来就在那里，
 * 直接解析回来就有了，不需要重跑（重跑要 8 分钟 + 一次大模型调用）。
 */
function deriveShotlist(dir, jobId) {
  const cf = path.join(dir, 'engine/src/content.json')
  const sf = path.join(dir, 'engine/src/shots.ts')
  const tf = path.join(dir, 'engine/src/timing.json')
  if (!fs.existsSync(cf) || !fs.existsSync(sf)) return null

  let content
  try {
    content = JSON.parse(fs.readFileSync(cf, 'utf8'))
  } catch {
    return null
  }
  let timing = {}
  try {
    timing = JSON.parse(fs.readFileSync(tf, 'utf8'))
  } catch {}

  // shots.ts 是生成的，格式固定：每镜一个 `  {\n ... }` 块
  const blocks = fs.readFileSync(sf, 'utf8').split(/\n  \{\n/).slice(1)
  const shots = []
  for (const b of blocks) {
    const s = (k) => {
      const m = new RegExp(`${k}:\\s*'([^']*)'`).exec(b)
      return m ? m[1] : ''
    }
    const n = (k) => {
      const m = new RegExp(`${k}:\\s*([\\d.]+)`).exec(b)
      return m ? Number(m[1]) : 0
    }
    const id = s('id')
    if (!id) continue
    const c = content.shots?.[id] || {}
    shots.push({
      id,
      kind: s('kind') || 'card',
      card: c.card || s('cardId') || 'line-by-line-slide',
      tScale: n('tScale') || 1,
      startSec: n('startSec'),
      durationSec: n('durationSec'),
      corner: c.corner || 'tr',
      fields: c.fields || {},
      text: c.text || '',
      note: c.note || '',
    })
  }
  if (!shots.length) return null

  const totalSec =
    Number(timing.totalSec) || shots.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0)
  const doc = {
    version: 1,
    jobId,
    mode: 'shotlist',
    totalSec: +totalSec.toFixed(2),
    capStyle: ['karaoke', 'line', 'punch'].includes(content.captionStyle) ? content.captionStyle : 'line',
    at: Date.now(),
    derived: true,
    shots,
  }
  try {
    fs.writeFileSync(path.join(dir, 'shotlist.json'), JSON.stringify(doc, null, 1))
  } catch {}
  return doc
}

/**
 * 读一条作品的分镜底稿。
 * 没有就拿工程文件反推一份，反推不出来才是真的没有。
 */
export function readShotlist(jobId) {
  const dir = path.join(JOBS, path.basename(String(jobId)))
  const f = path.join(dir, 'shotlist.json')
  if (!fs.existsSync(f)) {
    const d = deriveShotlist(dir, jobId)
    if (!d) return {ok: false, error: '这条作品没有分镜数据（工程文件已被清理），请用「重跑」重新生成'}
    return {ok: true, data: d}
  }
  try {
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!Array.isArray(doc.shots) || !doc.shots.length) return {ok: false, error: '分镜底稿是空的'}
    return {ok: true, data: doc}
  } catch (e) {
    return {ok: false, error: '分镜底稿读取失败：' + e.message}
  }
}

/**
 * 只重渲，不重做分镜、不重跑时间戳。
 *
 * 用户改的是「这一镜用哪张卡 / 卡上写什么」，时间轴完全不动 ——
 * 这是刻意的：重切片长会让配音和画面对不上，而一条 123 秒的片子重跑
 * 时间戳要 10 分钟，改个错别字不该付这个代价。
 *
 * @param patches [{id, card?, fields?, text?}] 只带要改的镜，没带的保持原样
 */
export function rerenderJob(jobId, patches, onProgress = () => {}) {
  return enqueue(() => doRerender(jobId, patches, onProgress))
}

async function doRerender(jobId, patches, onProgress) {
  const up = (stage, progress) => onProgress({stage, progress})
  const dir = path.join(JOBS, path.basename(String(jobId)))
  const base = readShotlist(jobId)
  if (!base.ok) return {ok: false, error: base.error}
  const doc = base.data

  const log = []
  const say = (s) => {
    log.push(s)
    try {
      fs.writeFileSync(path.join(dir, 'pipeline.log'), log.join('\n'))
    } catch {}
  }

  try {
    const byId = new Map((patches || []).filter((p) => p && p.id).map((p) => [String(p.id), p]))

    /* ① 合并改动：换卡要重算动画缩放和 PIP 角位，改文案不动时间轴 */
    up('合并改动', 20)
    let changed = 0
    const shots = doc.shots.map((s) => {
      const p = byId.get(s.id)
      if (!p) return s
      const card = String(p.card || s.card)
      if (!CARD_BY_ID[card]) throw new Error(`第 ${s.id} 镜的卡片 ${card} 不存在`)
      const kind = p.kind === 'person' || p.kind === 'card' ? p.kind : s.kind
      const durationSec = Number(s.durationSec) || 0.4
      const fields = p.fields !== undefined ? p.fields || {} : s.fields || {}
      const next = {
        ...s,
        kind,
        card,
        fields,
        text: p.text !== undefined ? String(p.text) : s.text,
        // 人镜不铺卡，缩放恒为 1
        tScale: kind === 'person' ? 1 : scaleFor(card, durationSec),
        corner: CORNER[card] || 'tr',
      }
      if (JSON.stringify(next) !== JSON.stringify(s)) changed += 1
      return next
    })
    if (!changed) return {ok: true, data: {jobId, changed: 0, video: `/jobs/${jobId}/final_1080p.mp4`}}
    say(`改动 ${changed} 镜／共 ${shots.length} 镜`)

    /* ② 重写工程文件 */
    up('写入工程', 32)
    const {engine, pub} = prepareEngine(dir)
    // 素材齐了才写：重渲不带素材（复用上次的），缺了就是历史目录被清过
    for (const f of [path.join(pub, 'narration.wav'), path.join(pub, 'video/host.mp4')]) {
      if (!fs.existsSync(f)) throw new Error('渲染素材缺失（' + path.basename(f) + '），请用「重跑」重新生成')
    }

    const tsFile = path.join(dir, 'timestamps.json')
    if (!fs.existsSync(tsFile)) throw new Error('时间戳文件缺失，请用「重跑」重新生成')
    const ts = JSON.parse(fs.readFileSync(tsFile, 'utf8'))

    emitShotFiles({
      engine,
      shots,
      total: doc.totalSec,
      timingScenes: buildTiming(ts, shots),
      capStyle: doc.capStyle,
    })

    /* ③ 旧成片留一份，改坏了还能退回去 */
    up('渲染', 45)
    const out = path.join(dir, 'final_1080p.mp4')
    if (fs.existsSync(out)) {
      try {
        fs.copyFileSync(out, path.join(dir, 'final_prev.mp4'))
      } catch {}
    }

    const rr = await renderEngine(engine, out)
    if (rr.code !== 0 || !fs.existsSync(out)) throw new Error('渲染失败：' + rr.err.slice(-500))
    say('重渲完成 ' + (fs.statSync(out).size / 1048576).toFixed(1) + 'MB')

    /* ④ 底稿回写：下次再改就在这一版上改 */
    doc.shots = shots
    doc.at = Date.now()
    doc.revision = (doc.revision || 1) + 1
    fs.writeFileSync(path.join(dir, 'shotlist.json'), JSON.stringify(doc, null, 1))

    up('质量闸', 92)
    const mc = spawnSync(PY, [path.join(TK, 'scripts/motion_check.py'), out], {encoding: 'utf8', timeout: 180000})
    const gate = (mc.stdout || '').includes('PASS') ? 'PASS' : 'WARN'
    say('motion_check: ' + gate)

    return {
      ok: true,
      changed,
      data: {
        jobId,
        changed,
        revision: doc.revision,
        video: `/jobs/${jobId}/final_1080p.mp4`,
        gate,
        shots: shots.length,
      },
    }
  } catch (e) {
    say('ERROR ' + e.message)
    return {ok: false, error: e.message}
  }
}
