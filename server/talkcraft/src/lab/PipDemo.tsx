import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {PipHost, PipCfg} from '../PipHost';
import QuoteCard from './cards/quote-card';
import KeywordPop from './cards/keyword-pop-highlight';

/**
 * PIP 版式验证：卡片全屏铺满 + 人物缩到右下角小窗。
 *
 * 这是「拿成品视频当纯口播原片」这个方案的核心画面结构：
 * 原视频自带特效卡片，必须被我们自己的卡片整块盖住；人物只留一小块在角落，
 * 观众知道有人在讲，但注意力全在卡片上。
 *
 * 两个镜头各演一半，用来确认不同卡片（深色底板 / 无底板）下小窗都成立。
 */

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

export const PipDemo: React.FC<{cfg: PipCfg}> = ({cfg}) => {
  return (
    <AbsoluteFill style={{backgroundColor: '#0B0B10'}}>
      <CardLayer>
        <QuoteCard />
      </CardLayer>
      <PipHost cfg={cfg} />
    </AbsoluteFill>
  );
};

export const PipDemo2: React.FC<{cfg: PipCfg}> = ({cfg}) => {
  return (
    <AbsoluteFill style={{backgroundColor: '#0B0B10'}}>
      <CardLayer>
        <KeywordPop />
      </CardLayer>
      <PipHost cfg={cfg} />
    </AbsoluteFill>
  );
};

export const PipRoot: React.FC = () => (
  <>
    <Composition
      id="pip-quote"
      component={PipDemo}
      durationInFrames={123}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{cfg: {cx: 0.5, cy: 0.3, w: 0.28, boxW: 300, boxH: 380, corner: 'br'}}}
    />
    {/* 关键词卡整行贴底 —— 小窗必须让到右上，否则会切字 */}
    <Composition
      id="pip-keyword"
      component={PipDemo2}
      durationInFrames={96}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{cfg: {cx: 0.5, cy: 0.3, w: 0.28, boxW: 300, boxH: 380, corner: 'tr'}}}
    />
    {/* 对照：同样的窄裁切放右下，验证遮挡差异 */}
    <Composition
      id="pip-tight"
      component={PipDemo2}
      durationInFrames={96}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{cfg: {cx: 0.5, cy: 0.3, w: 0.28, boxW: 300, boxH: 380, corner: 'br'}}}
    />
  </>
);
