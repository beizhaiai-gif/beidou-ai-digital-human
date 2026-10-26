import '../lib/env.js'
import { planStoryboard, shotsToPlan } from '../lib/plan.js'
import { splitLongShots } from '../lib/talkcraft.js'

const script = `你们知道做自媒体有多大工程量吗？这是一个人跑完全流程的我，扒资料，找选题，写脚本，盯数据，消息一多就容易乱，每次复盘都要在十几个软件里跳来跳去。而这是让 AI 工作台干活的我，动动手指就能拿到所有数据。WorkBuddy，没遇到你之前，我简直是在乱忙活。你可能很难相信，WorkBuddy 这次全新接入的 StepFun Preview 用起来到底有多爽。不用装插件，不用配环境，而且整个搭建过程超级简单，只需要几句话就能收获一个属于你的个性化 AI 工作台。我现在就演示给你看。首先我们选中 StepFun Preview 模型，在这里我希望成果能手动录入，自动监测也能持续更新，并且服务于单独账号。于是呢，我直接把我过往的视频数据，选题库，运营复盘，对标账号都一股脑的丢给它，用最直白的话告诉它，我需要一个能点，能看图，还能一直往里添东西的工作台。我全程没有操心，喝杯水的功夫，它就能自动把我的数据整理清晰，把成品放到我的眼前来。打开总览台面看看，不花哨，不晃眼，还怪有审美水平的。我们挨个看它到底装了些啥，发了多少条，跑了多少播放，哪条爆了，数字配图一眼就扫完了。往下翻一下，发布数据，过往选题，运营复盘都完全匹配。那最让我意外的呢，是选题库和热点速览这两个模块。选题库里三十多条排在队里，先拍哪个，压哪个，点一下就改了，灵感来了随时都可以往里面加。热点速览呢，是把九月和十月的大事连成了一条线，每周往上续就可以了。而这两个模块的共同点是，它自动分析了事件的重要程度，并且划分了执行的等级，自动标注了 P1，P0，P2，让人一目了然。我没有额外下指令，它却替我先行了一步，帮我加快了创作决策的速度。这对于自媒体人追热点的需求来说，无疑是一位天选爆款制造机啊。复盘也不用我记了，动一下它就自动留条，想整体备份，点一下就导出来了。等于我以前散养的账号，现在有了一个能自己长血肉的中台。资料呢，是越攒越值钱。不管你是自媒体人，还是被繁琐的数据报表追着跑的打工人，都可以试试让 WorkBuddy 给你搭这么一个专属 AI 工作台。现在 StepFun Preview 已经上线 WorkBuddy，还不赶紧去试试。`

/** 按句末标点切句（真链路由 ASR 给时间戳，这里按 4.3 字/秒估算） */
const CPS = 4.3
const raw = script
  .split(/(?<=[。！？])/)
  .map((s) => s.trim())
  .filter(Boolean)

let t = 0
const sentences = raw.map((text) => {
  const dur = Math.max(1.0, text.replace(/\s/g, '').length / CPS)
  const s = { text, start: +t.toFixed(2), end: +(t + dur).toFixed(2) }
  t += dur
  return s
})
const total = +t.toFixed(2)
const bounds = sentences.map((s) => ({ start: s.start, end: s.end }))

console.log(`句数 ${sentences.length} · 估算总长 ${total}s（${Math.floor(total / 60)}分${Math.round(total % 60)}秒）`)
console.log('—'.repeat(60))
sentences.forEach((s, i) => console.log(`${String(i).padStart(2)} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`))
console.log('—'.repeat(60))

const t0 = Date.now()
const assets = [
  { key: 'demo-overview', hint: '工作台总览页面：发了多少条、跑了多少播放、哪条爆了、数据配图' },
  { key: 'demo-topics', hint: '选题库界面：三十多条选题排队、优先级可拖动、随时新增' },
  { key: 'demo-trends', hint: '热点速览：九月十月大事时间线、自动标注 P1/P0/P2 优先级' },
]
const r = await planStoryboard({ script, sentences, total, assets })
console.log(`\n调用耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  ok=${r.ok}  ${r.error || ''}\n`)
if (!r.ok) process.exit(0)

const plan0 = shotsToPlan(bounds, total, r.shots)
if (!plan0) {
  console.log('时长校验不可用')
  process.exit(0)
}
// 和真实流水线一样：超 38 秒的镜强制再切
const plan = splitLongShots(plan0, bounds)
  .map((s, i) => ({ ...s, id: `s${String(i + 1).padStart(2, '0')}` }))

console.log(`模型给 ${r.shots.length} 镜${r.fixed ? '（被代码修补过）' : ''} → 强制切长镜后 ${plan.length} 镜\n`)
console.log(
  plan
    .map((p) => `  ${p.id} ${p.kind.padEnd(5)} ${p.startSec.toFixed(1)}-${(p.startSec + p.durationSec).toFixed(1)}s（${p.durationSec.toFixed(1)}s）${p.part ? ' ← 切出来的后半段' : ''}`)
    .join('\n'),
)
console.log('')
for (const p of plan) {
  const srcId = p.srcId
  const c = r.contents[srcId]
  const seg = plan0.find((q) => q.id === srcId)
  console.log(`${p.id} ${p.kind}${p.part ? '（后半段，标注已清空）' : ''} · 对应原镜 ${srcId}${seg ? ` · 原 ${seg.durationSec.toFixed(1)}s` : ''}`)
  if (!c) continue
  if (p.kind === 'hook') console.log(`   line「${c.line}」  ${c.from} → ${c.to}`)
  if (p.kind === 'steps') console.log(`   章节「${c.name}」  步骤: ${c.steps.map((x) => x.title).join(' / ')}`)
  if (p.kind === 'list') console.log(`   三卡: ${c.items.join(' / ')}`)
  if (p.kind === 'broll') console.log(`   素材「${c.media}」· 角标「${c.caption}」· 标注: ${(c.labels || []).join(' / ') || '（无）'}`)
  if (p.kind === 'outro') console.log(`   三标注: ${c.labels.join(' / ')}`)
  console.log('')
}
