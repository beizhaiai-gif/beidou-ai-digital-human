import '../lib/env.js'
import { planStoryboard, shotsToPlan } from '../lib/plan.js'

const script = `很多老板以为做短视频要先买相机、请团队。其实一部手机加一个数字人，一晚上就能出十条。
第一步，先把你要讲的东西写成口播稿，别想着剪辑。
第二步，用数字人把稿子念出来，口型对得比你自己录还准。
第三步，加上字幕和动效，一条片子就出来了。
这里面最关键的是三样东西：稿子的结构、配音的语气、字幕的节奏。
稿子决定别人愿不愿意看下去，配音决定他信不信你，字幕决定他记不记得住。
我这套流程跑下来，一条片子从写稿到发布，四十分钟。
你不用会剪辑，也不用会写代码。`

const sentences = script.split('\n').map((t, i) => ({ text: t, start: i * 2.2, end: (i + 1) * 2.2 }))
const total = sentences.length * 2.2
const bounds = sentences.map(s => ({ start: s.start, end: s.end }))

const t0 = Date.now()
const r = await planStoryboard({ script, sentences, total })
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  ok=${r.ok}`, r.error || '', '| fixed:', r.fixed)
if (r.ok) {
  console.log('镜数:', r.shots.length)
  console.log('镜头表:', r.shots.map(s => `${s.id}:${s.kind}(→第${s.cutAfter + 1}句)`).join('  '))
  const plan = shotsToPlan(bounds, total, r.shots)
  console.log('时长:', plan ? plan.map(p => `${p.id} ${p.durationSec.toFixed(1)}s`).join(' | ') : '不可用')
  for (const s of r.shots) {
    const c = r.contents[s.id]
    const brief = c.name ? `${c.name} / ${c.steps.map(x => x.title).join('·')}` : c.line ? `${c.line} → ${c.from} ⇒ ${c.to}` : c.items ? c.items.join('·') : c.labels.join('·')
    console.log(`  ${s.id} ${s.kind}: ${brief}`)
  }
}
