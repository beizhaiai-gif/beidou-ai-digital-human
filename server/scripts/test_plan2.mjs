import '../lib/env.js'
import { planStoryboard, shotsToPlan } from '../lib/plan.js'

const cases = {
  '短稿（无列举）': `很多人做口播视频，一条要录十几遍。其实你只要把稿子写好，交给数字人念就行。
第一步把口播稿拆成分段，每段三句话。
第二步挑一个你自己训练的形象，导入手机里那张正面照就能训练。
第三步点生成，二十分钟后就能下载成片。`,
  '有两大段方法': `做短视频最难的不是拍摄，是想清楚讲什么。
先讲第一段：选题。你要从同行的爆款里找共性，不是抄标题，是抄结构。
再讲第二段：开头。前三秒必须给冲突，观众才愿意留下来。
最后记住一句话，形式永远服从内容。`,
  '纯观点（无步骤）': `我不建议新手一上来就买设备。
你缺的不是相机，是一条能被看完的内容。
设备解决的是画质，内容解决的是有没有人看。
先把内容做对，再谈机器。`,
}

for (const [name, script] of Object.entries(cases)) {
  const lines = script.split('\n').filter(Boolean)
  const sentences = lines.map((t, i) => ({ text: t, start: i * 2.5, end: (i + 1) * 2.5 }))
  const total = sentences.length * 2.5
  const bounds = sentences.map(s => ({ start: s.start, end: s.end }))
  const r = await planStoryboard({ script, sentences, total })
  if (!r.ok) { console.log(name, '失败:', r.error); continue }
  const plan = shotsToPlan(bounds, total, r.shots)
  console.log(`\n【${name}】${r.shots.length} 镜`)
  console.log(' ', r.shots.map(s => `${s.kind}(→${s.cutAfter + 1}句)`).join('  '))
  console.log(' ', plan ? plan.map(p => `${p.kind} ${p.durationSec.toFixed(1)}s`).join(' | ') : '时长不可用')
}
