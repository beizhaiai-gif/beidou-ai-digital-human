import React from 'react';
import {AbsoluteFill, Composition, Sequence} from 'remotion';
import {renderLiveCard} from '../cards-live';
import {PipHost} from '../PipHost';

/**
 * 注入验证：用分镜脚本里的真实 fields 渲染每张卡，确认「文案能进画面」。
 *
 * 六镜串起来，每镜 3.5s，人物走右上角小窗（避开贴底文字的卡）。
 * 文案全部取自 51 镜分镜稿的实际输出，不是编的。
 */

const DUR = 105; // 3.5s @30fps

const SAMPLES: {card: string; fields: Record<string, any>; corner: 'br' | 'tr'}[] = [
  {
    card: 'keyword-pop-highlight',
    fields: {text: '你们知道做自媒体有多大工程量吗？', keyword: '工程量'},
    corner: 'tr',
  },
  {
    card: 'quote-card',
    fields: {line1: '没遇到你之前', line2: '我简直是在乱忙活'},
    corner: 'tr',
  },
  {
    card: 'line-by-line-slide',
    fields: {lines: ['打开总览台面看看', '不花哨', '不晃眼']},
    corner: 'tr',
  },
  {
    card: 'info-term-card',
    fields: {term: 'StepFun Preview', abbr: 'SFP', gloss: 'WorkBuddy 新接入的模型'},
    corner: 'br',
  },
  {
    card: 'chapter-title-card',
    fields: {num: '1', name: '选题库与热点', sub: '两大亮点模块'},
    corner: 'tr',
  },
  {
    card: 'hand-drawn-ellipse',
    fields: {target: 'P1 P0 P2'},
    corner: 'br',
  },
];

const CardLayer: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: 960,
      height: 540,
      transform: 'scale(2)',
      transformOrigin: '0 0',
    }}
  >
    {children}
  </div>
);

export const LiveDemo: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#0B0B10'}}>
    {SAMPLES.map((s, i) => {
      const r = renderLiveCard(s.card, s.fields);
      if (!r) return null;
      const {Comp, props} = r;
      return (
        <Sequence key={s.card} from={i * DUR} durationInFrames={DUR}>
          <CardLayer>
            <Comp {...props} />
          </CardLayer>
          <PipHost cfg={{cx: 0.5, cy: 0.3, w: 0.28, boxW: 300, boxH: 380, corner: s.corner}} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

export const LiveRoot: React.FC = () => (
  <Composition
    id="live-inject"
    component={LiveDemo}
    durationInFrames={DUR * SAMPLES.length}
    fps={30}
    width={1920}
    height={1080}
  />
);
