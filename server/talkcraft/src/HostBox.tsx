import React from 'react';
import {OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing} from 'remotion';
import {C} from './theme';

/**
 * 人物层（SHOTBOOK §1–§4 的「人物形态·方位」列落地）
 *
 * 硬规（host-footage §5）：有素材的镜头人物一律降级成角标常驻，不许切走、不许占满画幅；
 * 唯一例外是片头 0–2.2s 的自我介绍期。s03 用「顶部小框」是 parallel-items-with-host 的 side-column 版式要求。
 */
export type HostMode = 'shrink' | 'corner-br' | 'chip';

const W = 1920;
const H = 1080;
const M = 56;

const CORNER = {w: 520, h: 292, left: W - 520 - M, top: H - 292 - M, r: 24};
const CHIP = {w: 240, h: 252, left: W - 240 - 64, top: 64, r: 52};

export const HostBox: React.FC<{mode: HostMode}> = ({mode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  let box: {w: number; h: number; left: number; top: number; r: number; border: number; shadow: string};

  if (mode === 'shrink') {
    // 0–2.24 全屏 → 2.24–2.94 缩到右下角标（让位给文字面）
    const p = interpolate(t, [2.24, 2.94], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
    box = {
      w: interpolate(p, [0, 1], [W, CORNER.w]),
      h: interpolate(p, [0, 1], [H, CORNER.h]),
      left: interpolate(p, [0, 1], [0, CORNER.left]),
      top: interpolate(p, [0, 1], [0, CORNER.top]),
      r: interpolate(p, [0, 1], [0, CORNER.r]),
      border: p > 0.02 ? 1.5 : 0,
      shadow: `0 ${interpolate(p, [0, 1], [0, 28])}px ${interpolate(p, [0, 1], [0, 90])}px rgba(0,0,0,${interpolate(p, [0, 1], [0, 0.62])})`,
    };
  } else if (mode === 'chip') {
    box = {...CHIP, border: 1.5, shadow: '0 18px 60px rgba(0,0,0,.55)'};
  } else {
    // 右下角标；s02 的 7.68s 让位到左下由 scene 层用 offset 处理，这里只给右下
    box = {...CORNER, border: 1.5, shadow: '0 28px 90px rgba(0,0,0,.62)'};
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.w,
        height: box.h,
        borderRadius: box.r,
        overflow: 'hidden',
        border: box.border ? `${box.border}px solid rgba(245,245,247,0.22)` : 'none',
        boxShadow: box.shadow,
        background: '#000',
      }}
    >
      <OffthreadVideo
        src={staticFile('video/host.mp4')}
        muted
        style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 28%'}}
      />
      {mode === 'chip' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            boxShadow: `inset 0 0 0 2px ${C.accent}`,
            opacity: 0,
          }}
        />
      ) : null}
    </div>
  );
};
