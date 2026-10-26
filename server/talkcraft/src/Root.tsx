import React from 'react';
import {Composition} from 'remotion';
import {MainVideo} from './MainVideo';
import {SHOTS} from './shots';
import timing from './timing.json';

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

/** 片长 = max(配音总长, 最后一镜终点)；不再写死，时长由音频决定 */
const fromShots = SHOTS.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0);
const fromTiming = (timing as {totalSec?: number}).totalSec ?? 0;
/**
 * 片长以「镜头表末点」为准（末镜一定抵到音频结尾）。
 * 不能用 max(shots, timing)：时间戳一旦溢出配音长度，成片尾部会拖出静止黑屏。
 */
const DURATION = Math.max(
  1,
  Math.round((fromShots > 0 ? fromShots : fromTiming) * FPS),
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Main"
    component={MainVideo}
    durationInFrames={DURATION}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
