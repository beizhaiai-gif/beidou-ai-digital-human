import '../lib/env.js'
import { estimateSentences, buildSegments, planShotList } from '../lib/shotlist.js'

const script = `你们知道做自媒体有多大工程量吗？这是一个人跑完全流程的我，扒资料，找选题，写脚本，盯数据，消息一多就容易乱，每次复盘都要在十几个软件里跳来跳去。而这是让 AI 工作台干活的我，动动手指就能拿到所有数据。WorkBuddy，没遇到你之前，我简直是在乱忙活。你可能很难相信，WorkBuddy 这次全新接入的 StepFun Preview 用起来到底有多爽。不用装插件，不用配环境，而且整个搭建过程超级简单，只需要几句话就能收获一个属于你的个性化 AI 工作台。我现在就演示给你看。首先我们选中 StepFun Preview 模型，在这里我希望成果能手动录入，自动监测也能持续更新，并且服务于单独账号。于是呢，我直接把我过往的视频数据，选题库，运营复盘，对标账号都一股脑的丢给它，用最直白的话告诉它，我需要一个能点，能看图，还能一直往里添东西的工作台。我全程没有操心，喝杯水的功夫，它就能自动把我的数据整理清晰，把成品放到我的眼前来。打开总览台面看看，不花哨，不晃眼，还怪有审美水平的。我们挨个看它到底装了些啥，发了多少条，跑了多少播放，哪条爆了，数字配图一眼就扫完了。往下翻一下，发布数据，过往选题，运营复盘都完全匹配。那最让我意外的呢，是选题库和热点速览这两个模块。选题库里三十多条排在队里，先拍哪个，压哪个，点一下就改了，灵感来了随时都可以往里面加。热点速览呢，是把九月和十月的大事连成了一条线，每周往上续就可以了。而这两个模块的共同点是，它自动分析了事件的重要程度，并且划分了执行的等级，自动标注了 P1，P0，P2，让人一目了然。我没有额外下指令，它却替我先行了一步，帮我加快了创作决策的速度。这对于自媒体人追热点的需求来说，无疑是一位天选爆款制造机啊。复盘也不用我记了，动一下它就自动留条，想整体备份，点一下就导出来了。等于我以前散养的账号，现在有了一个能自己长血肉的中台。资料呢，是越攒越值钱。不管你是自媒体人，还是被繁琐的数据报表追着跑的打工人，都可以试试让 WorkBuddy 给你搭这么一个专属 AI 工作台。现在 StepFun Preview 已经上线 WorkBuddy，还不赶紧去试试。`

const { sentences, total } = estimateSentences(script)
const segs = buildSegments(sentences, total)

console.log(`原稿 ${sentences.length} 句 / ${total}s`)
console.log(`切段后 ${segs.length} 段 / 平均 ${(total / segs.length).toFixed(1)}s`)
const ds = segs.map((s) => s.dur).sort((a, b) => a - b)
console.log(`时长分布：最短 ${ds[0]}s / 中位 ${ds[Math.floor(ds.length / 2)]}s / 最长 ${ds[ds.length - 1]}s`)
const outOfRange = segs.filter((s) => s.dur < 2.5 || s.dur > 6)
console.log(`超出 2.5–6s 的段：${outOfRange.length} 个`)
outOfRange.slice(0, 6).forEach((s) => console.log(`   #${s.i} ${s.dur}s「${s.text}」`))
console.log('\n前 20 段：')
segs.slice(0, 20).forEach((s) => console.log(`  ${String(s.i).padStart(2)} [${s.dur.toFixed(1)}s] ${s.text}`))

if (process.argv.includes('--llm')) {
  const t0 = Date.now()
  const r = await planShotList({ sentences, total, script })
  console.log(`\n配卡耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  ok=${r.ok}  ${r.error || ''}`)
  if (r.ok) {
    console.log(`镜数 ${r.stats.count} · 平均 ${r.stats.avgDur}s · 纯人物镜 ${r.stats.person} 段（${r.stats.personPct}%）`)
    console.log('卡分布：', r.stats.cards.map((c) => `${c.name}×${c.n}`).join('  '))
    console.log('')
    for (const s of r.shots) {
      const f = Object.entries(s.fields).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`).join(' ')
      console.log(`${String(s.i + 1).padStart(2)} [${s.dur.toFixed(1)}s] ${s.type === 'person' ? '人物' : '卡片'} ${s.cardName.padEnd(10, '　')} ${f}  ｜ ${s.text.slice(0, 16)}`)
    }
  }
}
