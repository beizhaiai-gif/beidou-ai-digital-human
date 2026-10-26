import json, re, difflib, sys

"""把 v3 分镜稿的 51 镜映射到真实音频时间轴。

思路：分镜内容一个字都不改，改的只是「每一镜从第几秒到第几秒」。
做法是词级序列对齐 —— v3 台词和实际配音是同一篇稿子（个别字有识别差异，比如
「扒资料」被听成「发资料」），用 difflib 对齐后，每镜的起止 token 就能落到真实秒数上。
比按字数等比缩放准，因为换气、重音、语速波动都会自然带上。
"""

BOARD = '/tmp/board9.json'
TS = 'server/jobs/test-1025/timestamps.json'

board = json.load(open(BOARD))
ts = json.load(open(TS))

def tok(s):
    """和 timestamps 的 words 同规则：中文单字 + 拉丁/数字整段"""
    return re.findall(r'[\u4e00-\u9fff]|[A-Za-z0-9]+', s)

real = []
for s in ts['sentences']:
    for w in (s.get('words') or []):
        real.append((w['text'], float(w['start']), float(w['end'])))
real_tok = [r[0] for r in real]

v3, spans = [], []
for sh in board['shots']:
    t = tok(sh['text'])
    spans.append((len(v3), len(v3) + len(t)))
    v3.extend(t)

sm = difflib.SequenceMatcher(None, v3, real_tok, autojunk=False)
ratio = sm.ratio()

# v3 token idx → real token idx
m = {}
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        for k in range(i2 - i1):
            m[i1 + k] = j1 + k
    elif tag == 'replace':
        n = min(i2 - i1, j2 - j1)
        for k in range(n):
            m[i1 + k] = j1 + k
        for k in range(n, i2 - i1):
            m[i1 + k] = min(len(real) - 1, j2 - 1)
    elif tag == 'delete':
        for k in range(i1, i2):
            m[k] = min(len(real) - 1, j1)

def t_of(idx):
    if not real:
        return 0.0
    return real[min(len(real) - 1, max(0, idx))]

shots = []
prev_end = 0.0
for i, sh in enumerate(board['shots']):
    a, b = spans[i]
    if a >= b:
        shots.append({**sh, 'realStart': prev_end, 'realEnd': prev_end})
        continue
    start = t_of(m.get(a, 0))[1]
    end = t_of(m.get(b - 1, len(real) - 1))[2]
    # 保底：不允许倒退、不允许太短
    start = max(start, prev_end)
    if end <= start + 0.35:
        end = start + 0.35
    shots.append({**sh, 'realStart': round(start, 2), 'realEnd': round(end, 2)})
    prev_end = round(end, 2)

total = float(ts['total'])
# 末镜抵到片尾，别留黑尾
if shots:
    shots[-1]['realEnd'] = round(total, 2)

print(f'对齐相似度 {ratio:.3f}｜v3 token {len(v3)}｜实际 token {len(real)}｜总长 {total}s')
print(f'{"#":>3} {"起":>7} {"止":>7} {"秒":>5}  卡 / 台词')
short = 0
for i, s in enumerate(shots, 1):
    d = s['realEnd'] - s['realStart']
    if d < 1.2:
        short += 1
    tag = '人物' if s.get('type') == 'person' else s.get('card', '')
    print(f'{i:>3} {s["realStart"]:>7.2f} {s["realEnd"]:>7.2f} {d:>5.2f}  {tag[:18]:<18} {s["text"][:22]}')

durs = [s['realEnd'] - s['realStart'] for s in shots]
print(f'\n镜数 {len(shots)}｜平均 {sum(durs)/len(durs):.2f}s｜最短 {min(durs):.2f}s｜最长 {max(durs):.2f}s｜<1.2s 的 {short} 镜')

json.dump({'shots': shots, 'total': total, 'ratio': ratio}, open('/tmp/timeline.json', 'w'), ensure_ascii=False, indent=1)
print('→ /tmp/timeline.json')
