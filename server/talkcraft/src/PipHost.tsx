import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing} from 'remotion';
import {C, FONT} from './theme';

/**
 * PipHost · 人物角落窗（画中画）
 *
 * 为什么需要它：用户提供的是「已经做完后期的成片」——画面里自带特效、贴图卡片。
 * 我们要拿它当纯口播原片用，就必须先解决两件事：
 *   ① 原卡片不能被带进来（整帧缩进小窗 = 视频套视频，很丑）
 *   ② 人物要小而稳，把整个画幅让给我们自己的卡片
 *
 * 所以这里裁的是「原视频里一块指定区域」，而不是整帧缩放：
 *   crop.cx / crop.cy  裁取区域的中心点（归一化 0–1）
 *   crop.w             裁取区域宽度占原视频宽度的比例
 *   高度由「小窗宽高比」反推，保证等比例、任何参数组合都不会拉变形。
 *
 * 坐标系说明：本组件按 1920×1080 设计（母版 Root 的分辨率），
 * 所以在 960×540 的卡片外层使用时，父级会整体 scale(2)，不需要换算。
 */

export type PipCfg = {
  /** 裁取区域中心点，归一化；默认取画面中间偏上（人脸通常在上三分之一） */
  cx?: number;
  cy?: number;
  /** 裁取宽度占原视频宽度的比例；太大会被自动收敛（保证不超出画面高度） */
  w?: number;
  /** 小窗尺寸与位置（1920×1080 坐标） */
  boxW?: number;
  boxH?: number;
  margin?: number;
  r?: number;
  /**
   * 停在哪一角。默认右下。
   * 为什么需要选角：卡片内容的分布差别很大 —— 金句卡文字在中间、底部有出处，
   * 放右下会压住落款；关键词卡是一整行贴底，右下更会切字。
   * 所以由卡片清单给每张卡标一个默认角，跟画面里文字最多的位置错开。
   */
  corner?: 'br' | 'tr' | 'bl' | 'tl';
  /** 入场延后（秒），避免和卡片动画抢注意力 */
  delay?: number;
};

const SRC_W = 1920;
const SRC_H = 1080;

export type PipSrc = {
  /** 人物素材路径（相对 public）；默认老工程的 video/host.mp4 */
  src?: string;
  /** 从素材的第几秒开始取 —— 卡片镜头要取原视频同一时刻的画面，不能从头播 */
  fromSec?: number;
};

export const PipHost: React.FC<{cfg?: PipCfg; src?: PipSrc}> = ({cfg = {}, src: srcCfg = {}}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const startFrom = Math.round((srcCfg.fromSec ?? 0) * fps);

  const boxW = cfg.boxW ?? 300;
  const boxH = cfg.boxH ?? 380;
  const margin = cfg.margin ?? 52;
  const r = cfg.r ?? 20;
  const corner = cfg.corner ?? 'br';

  const posStyle: React.CSSProperties =
    corner === 'br'
      ? {right: margin, bottom: margin}
      : corner === 'tr'
        ? {right: margin, top: margin}
        : corner === 'bl'
          ? {left: margin, bottom: margin}
          : {left: margin, top: margin};

  let cw = Math.min(1, Math.max(0.08, cfg.w ?? 0.44));
  // 等比例：裁取高度(归一化) = cw * SRC_W * boxH / (boxW * SRC_H)
  let ch = (cw * SRC_W * boxH) / (boxW * SRC_H);
  if (ch > 1) {
    // 小窗太竖，原画面高度不够 —— 收敛裁取宽度，避免取到画面外
    cw = (boxW * SRC_H) / (SRC_W * boxH);
    ch = 1;
  }
  const cx = Math.min(1 - cw / 2, Math.max(cw / 2, cfg.cx ?? 0.5));
  const cy = Math.min(1 - ch / 2, Math.max(ch / 2, cfg.cy ?? 0.34));

  // 原视频在容器里的实际尺寸（这样裁取区域刚好铺满容器）
  const vidW = boxW / cw;
  const vidH = boxH / ch;
  const left = -cx * vidW + boxW / 2;
  const top = -cy * vidH + boxH / 2;

  // 入场：轻微上浮 + 淡入，0.36s；delay 之前不出现
  const d = cfg.delay ?? 0.18;
  const p = interpolate(t, [d, d + 0.36], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  if (p <= 0) return null;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          ...posStyle,
          width: boxW,
          height: boxH,
          borderRadius: r,
          overflow: 'hidden',
          background: '#0E0E14',
          boxShadow: `0 0 0 1.5px rgba(245,245,247,0.14), 0 18px 48px rgba(0,0,0,0.55)`,
          transform: `translateY(${(1 - p) * 18}px)`,
          opacity: p,
        }}
      >
        <div style={{position: 'absolute', width: vidW, height: vidH, left, top}}>
          <OffthreadVideo
            src={staticFile(srcCfg.src ?? 'video/host.mp4')}
            startFrom={startFrom}
            muted
            style={{width: '100%', height: '100%', objectFit: 'fill'}}
          />
        </div>
        {/* 底部压一层暗，小窗里的人不会和卡片抢视线 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, transparent 62%, rgba(8,8,12,0.42) 100%)',
          }}
        />
        {/* 左上角一个小红点，表示「人在说话」 */}
        <div
          style={{
            position: 'absolute',
            left: 14,
            top: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontFamily: FONT.cn,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: 'rgba(245,245,247,0.86)',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: C.accent,
              opacity: 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2)),
            }}
          />
          REC
        </div>
      </div>
    </AbsoluteFill>
  );
};
