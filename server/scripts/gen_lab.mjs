import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 生成卡片实验台入口
 *
 * 扫 src/lab/cards/*.tsx，自动按每张卡的入参形态决定怎么渲染：
 *   - 有 hostSrc  → 传数字人原片（public/video/host.mp4）
 *   - 有 src      → 不传（crash-zoom-punch 的 src 是截图，塞视频会渲染失败）
 *   - 都没有      → 裸渲染
 *
 * 这样补卡时只要把 tsx 拷进 cards/ 目录、跑一次这个脚本，不用手写 import。
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'talkcraft')
const CARD_DIR = path.join(ROOT, 'src/lab/cards')
const OUT = path.join(ROOT, 'src/lab/LabRoot.tsx')

const files = fs
  .readdirSync(CARD_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort()

const items = files.map((f) => {
  const id = f.replace('.tsx', '')
  const src = fs.readFileSync(path.join(CARD_DIR, f), 'utf8')
  const hasHost = /hostSrc\??:/.test(src)
  const hasSrc = /(^|\n)\s*src\??:/.test(src)
  const mode = hasHost ? 'host' : 'plain'
  return { id, mode, hasSrc }
})

const varName = (id) => 'c_' + id.replace(/[^a-zA-Z0-9]/g, '_')

const imports = items
  .map((it) => `import * as ${varName(it.id)} from './cards/${it.id}';`)
  .join('\n')

const list = items
  .map((it) => `  {id: 'lab-${it.id}', mod: ${varName(it.id)}, mode: '${it.mode}'},`)
  .join('\n')

const out = `import React from 'react';
import {Composition, staticFile} from 'remotion';

/**
 * 卡片实验台（自动生成，勿手改 —— 改 scripts/gen_lab.mjs）
 *
 * 目的：把技能里的卡片逐个真渲一遍，看它到底长什么样、要喂什么内容。
 * 只用名字猜出来的说明书不可靠，这里全部按实测写。
 *
 * ${items.length} 张卡，各按自己的 meta 时长、960×540 渲。
 * 人物素材用后台那条 12 秒数字人原片。
 */
${imports}

const HOST = 'video/host.mp4';

const hostBox = (Comp: React.ComponentType<any>) => {
  const W: React.FC = () => <Comp hostSrc={staticFile(HOST)} />;
  return W;
};
const plain = (Comp: React.ComponentType<any>) => {
  const W: React.FC = () => <Comp />;
  return W;
};

const LAB = [
${list}
] as const;

export const LabRoot: React.FC = () => (
  <>
    {LAB.map(({id, mod, mode}) => {
      const Comp = (mod as any).default as React.ComponentType<any>;
      const dur = Math.max(30, Number((mod as any).meta?.durationInFrames) || 90);
      const W = mode === 'host' ? hostBox(Comp) : plain(Comp);
      return (
        <Composition key={id} id={id} component={W} durationInFrames={dur} fps={30} width={960} height={540} />
      );
    })}
  </>
);
`

fs.writeFileSync(OUT, out)
console.log(`生成 ${items.length} 个合成 → src/lab/LabRoot.tsx`)
const byMode = items.reduce((m, it) => ((m[it.mode] = (m[it.mode] || 0) + 1), m), {})
console.log('入参形态：', byMode)
const withSrc = items.filter((it) => it.hasSrc && it.mode === 'plain').map((it) => it.id)
if (withSrc.length) console.log('带 src 但没 hostSrc（不传 props）：', withSrc.join(', '))
