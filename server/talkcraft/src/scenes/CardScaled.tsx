import React from 'react';

/**
 * 动效卡舞台适配器（蒙皮的一部分，不改卡内运动）
 *
 * 108 张卡全部按 960×540 舞台做几何，本片成片是 1920×1080。
 * 等比放大 = 几何比例原封不动，只是把 1 单位变成 2 单位（SHOTBOOK §0「运动命门不动」）。
 */
export const CardScaled: React.FC<{
  width: number;
  height: number;
  radius?: number;
  shadow?: string;
  children: React.ReactNode;
}> = ({width, height, radius = 0, shadow, children}) => {
  const scale = width / 960;
  return (
    <div
      style={{
        position: 'absolute',
        width,
        height,
        overflow: 'hidden',
        borderRadius: radius,
        boxShadow: shadow,
        background: 'transparent',
      }}
    >
      <div
        style={{
          width: 960,
          height: 540,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
};
