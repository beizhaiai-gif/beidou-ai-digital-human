import json, os, re, subprocess

"""把「v3 分镜 + 真实音频时间轴」组装成 Remotion 工程文件。

产出：
  src/shots.ts    51 镜镜头表（kind = card / person，带卡片 id 与时间缩放）
  src/content.json 每镜的卡片文案 + PIP 配置
  src/timing.json  字幕用的字级时间（按镜切，避免跨镜串字）
  public/narration.wav  配音
  public/video/source.mp4 原始无声视频（PIP 与人物镜都要用）

不改分镜内容，只换时间。
"""

ROOT = 'server/talkcraft'
TL = json.load(open('/tmp/timeline.json'))
DURS = json.load(open('/tmp/lab/durs.json'))
SRC_VIDEO = '/Users/mac/Downloads/数字人素材/10月25日数字人无声测试/10月25日数字人无声测试.mp4'
SRC_AUDIO = 'server/jobs/test-1025/voice.mp3'

shots = TL['shots']
total = TL['total']
FPS = 30

# PIP 小窗该停哪一角：按卡片文字最多的地方错开
CORNER = {
    'keyword-pop-highlight': 'tr',   # 整行贴底
    'line-by-line-slide': 'tr',      # 三行居中偏左，右上最空
    'quote-card': 'tr',              # 居中线，右侧留白
    'chapter-title-card': 'tr',      # 章节名居中
    'info-term-card': 'bl',          # 卡片本体在右侧，小窗必须让到左边
    'hand-drawn-ellipse': 'br',      # 文字在中间偏上
    'chat-gpt': 'br',
    'subscribe-cta': 'br',
}

def kind_of(s):
    return 'person' if s.get('type') == 'person' else 'card'

lines = []
content_shots = {}
timing_scenes = []

for i, s in enumerate(shots, 1):
    sid = f's{i:02d}'
    dur = round(s['realEnd'] - s['realStart'], 2)
    kind = kind_of(s)
    card = s.get('card') or 'host-shrink-to-chip'

    # 动画按镜长缩放：卡片自然时长比镜长 → 加速演完；比镜长 → 放慢铺满
    natural = DURS.get(card, 3.0) if kind == 'card' else dur
    tscale = round(min(1.8, max(0.55, dur / max(0.4, natural))), 3)

    # 相机：卡片镜轻微推近（过静止闸），人物镜不动（原片自身在动）
    if kind == 'card':
        path = [(0, 1.0), (dur, 1.028)]
    else:
        path = [(0, 1.0), (dur, 1.0)]

    lines.append(
        f"  {{\n"
        f"    id: '{sid}',\n"
        f"    kind: '{kind}' as const,\n"
        f"    cardId: '{card}' as const,\n"
        f"    tScale: {tscale},\n"
        f"    startSec: {s['realStart']:.2f},\n"
        f"    durationSec: {dur:.2f},\n"
        f"    lead: 0,\n"
        f"    tail: 0,\n"
        f"    path: [{', '.join(f'{{t: {t:.2f}, scale: {sc:.4f}}}' for t, sc in path)}],\n"
        f"    impulses: [],\n"
        f"  }},"
    )

    fields = dict(s.get('fields') or {})
    content_shots[sid] = {
        'card': card,
        'fields': fields,
        'corner': CORNER.get(card, 'tr'),
        'text': s['text'],
        'note': s.get('note') or '',
    }

# ---- shots.ts ----
shots_ts = f"""import type {{CamImpulse, CamKey}} from './camera';

export type ShotKind = 'hook' | 'steps' | 'list' | 'outro' | 'broll' | 'card' | 'person';

export type Shot = {{
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
}};

export const SHOTS: Shot[] = [
{chr(10).join(lines)}
];

export const SHOT_BY_ID = SHOTS.reduce<Record<string, Shot>>((m, s) => {{
  m[s.id] = s;
  return m;
}}, {{}});

export function shotSequence(shot: Shot, fps: number) {{
  const from = Math.round((shot.startSec - shot.lead) * fps);
  const duration = Math.round((shot.durationSec + shot.lead + shot.tail) * fps);
  return {{from, duration}};
}}
"""
open(f'{ROOT}/src/shots.ts', 'w').write(shots_ts)

# ---- content.json ----
content = {
    'captionStyle': 'karaoke',
    'shots': content_shots,
    'pip': {'on': True, 'cx': 0.5, 'cy': 0.3, 'w': 0.28, 'boxW': 300, 'boxH': 380},
}
json.dump(content, open(f'{ROOT}/src/content.json', 'w'), ensure_ascii=False, indent=1)

# ---- timing.json（按镜切，chars 带绝对时间）----
ts = json.load(open('server/jobs/test-1025/timestamps.json'))
real = []
for s0 in ts['sentences']:
    for w in (s0.get('words') or []):
        real.append({'ch': w['text'], 't': round(float(w['start']), 2), 'e': round(float(w['end']), 2)})

for i, s in enumerate(shots, 1):
    a, b = s['realStart'], s['realEnd']
    chars = [c for c in real if c['t'] >= a - 0.05 and c['t'] < b]
    if not chars:
        continue
    timing_scenes.append({
        'id': f's{i:02d}',
        'text': s['text'],
        'startSec': round(a, 2),
        'durationSec': round(b - a, 2),
        'chars': chars,
    })

json.dump({'totalSec': round(total, 2), 'scenes': timing_scenes},
          open(f'{ROOT}/src/timing.json', 'w'), ensure_ascii=False, indent=1)

# ---- 素材 ----
FFMPEG = os.path.expanduser('~/.workbuddy/bin/ffmpeg')
os.makedirs(f'{ROOT}/public/video', exist_ok=True)
subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', SRC_AUDIO, '-ac', '1', '-ar', '16000',
                f'{ROOT}/public/narration.wav'], check=True)
subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', SRC_VIDEO, '-an', '-c:v', 'libx264',
                '-crf', '20', '-preset', 'fast', f'{ROOT}/public/video/source.mp4'], check=True)

print(f'51 镜工程已生成')
print(f'  镜数 {len(shots)}｜总长 {total}s')
print(f'  card 镜 {sum(1 for s in shots if s.get("type") != "person")}｜person 镜 {sum(1 for s in shots if s.get("type") == "person")}')
print(f'  字幕镜 {len(timing_scenes)}｜字 token {len(real)}')
print(f'  tScale 范围 {min(float(re.search(r"tScale: ([0-9.]+)", l).group(1)) for l in lines):.2f} – {max(float(re.search(r"tScale: ([0-9.]+)", l).group(1)) for l in lines):.2f}')
