import fs from 'node:fs'
import path from 'node:path'

const MASTER = '/Users/mac/WorkBuddy/数字人/beizhai-workbench/server/talkcraft'

const shots = [
  { id: 's01', kind: 'hook', tScale: 1.3, start: 0.0, dur: 4.0 },
  { id: 's02', kind: 'broll', tScale: 1.15, start: 4.0, dur: 6.5 },
  { id: 's03', kind: 'outro', tScale: 1.0, start: 10.5, dur: 2.0 },
]

const path_of = (kind, dur) => {
  const P = { hook: [1.0, 1.058], broll: [1.0, 1.048], outro: [1.0, 1.062] }
  const [a, b] = P[kind]
  const n = Math.max(4, Math.ceil(dur / 3))
  return Array.from({ length: n }, (_, i) => {
    const p = i / (n - 1)
    const t = i === n - 1 ? dur : dur * p
    return `      {t: ${t.toFixed(2)}, scale: ${(a + (b - a) * p).toFixed(4)}},`
  }).join('\n')
}

const body = shots
  .map(
    (s) => `  {
    id: '${s.id}',
    kind: '${s.kind}' as const,
    tScale: ${s.tScale},
    startSec: ${s.start.toFixed(2)},
    durationSec: ${s.dur.toFixed(2)},
    lead: 0,
    tail: 0,
    path: [
${path_of(s.kind, s.dur)}
    ],
    impulses: [],
  },`,
  )
  .join('\n')

const ts = `import type {CamImpulse, CamKey} from './camera';

export type ShotKind = 'hook' | 'steps' | 'list' | 'broll' | 'outro';

export type Shot = {
  id: string;
  kind: ShotKind;
  tScale: number;
  startSec: number;
  durationSec: number;
  lead: number;
  tail: number;
  path: CamKey[];
  impulses: CamImpulse[];
};

export const SHOTS: Shot[] = [
${body}
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
fs.writeFileSync(path.join(MASTER, 'src/shots.ts'), ts)

const content = {
  captionStyle: 'karaoke',
  shots: {
    s01: { line: '做自媒体', from: '一个人硬扛', to: '交给 AI 工作台' },
    s02: {
      media: { src: 'broll/demo-overview.png', type: 'image' },
      caption: '总览台面',
      labels: ['发布 32 条', '播放 18.6 万', '爆款一眼扫完'],
    },
    s03: { labels: ['自动复盘', '数据中台', '越攒越值钱'], frameNote: 'PREVIEW' },
  },
  s01: { line: '做自媒体', from: '一个人硬扛', to: '交给 AI 工作台' },
  broll: {
    media: { src: 'broll/demo-overview.png', type: 'image' },
    caption: '总览台面',
    labels: ['发布 32 条', '播放 18.6 万', '爆款一眼扫完'],
  },
  s04: { labels: ['自动复盘', '数据中台', '越攒越值钱'], frameNote: 'PREVIEW' },
}
fs.writeFileSync(path.join(MASTER, 'src/content.json'), JSON.stringify(content, null, 2))
console.log('3 镜工程已写好（hook / broll / outro）')
