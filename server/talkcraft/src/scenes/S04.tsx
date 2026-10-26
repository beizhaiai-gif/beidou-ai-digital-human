import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from 'remotion';
import {CameraRig} from '../camera';
import {HostBox} from '../HostBox';
import {SHOT_BY_ID, Shot} from '../shots';
import {ThemeFrame} from '../theme-frame';
import {C, FONT} from '../theme';
import CT from '../content.json';

/** content.json 由后端每次生成，键不固定 —— 用宽松视图读，缺键不炸 */
const CX: any = CT as any;
import {useParams, ParamField} from '../params';

const S = SHOT_BY_ID.s04;

const FRAME_W = 1400;
const FRAME_H = 787;
const FRAME_L = 190;
const FRAME_T = 120;

/** 三个强调 label 的几何与时刻：进场 0.2s，落位后引线指向真成片里的对应区域 */
const LABEL_POS = [
  {x: 210, y: 790, atSec: 2.42, tx: FRAME_L + 1120, ty: 700},
  {x: 700, y: 786, atSec: 2.94, tx: FRAME_L + 700, ty: 830},
  {x: 1602, y: 250, atSec: 3.30, tx: FRAME_L + 1240, ty: 330},
];

type L = {text: string; x: number; y: number; atSec: number; tx: number; ty: number};

/** 拆解契约：工作台面板可调参数（三处强调标文案） */
export const PARAMS = [
  {type: 'text', key: 'l1', label: '标 1', default: CX.s04?.labels?.[0] ?? ''},
  {type: 'text', key: 'l2', label: '标 2', default: CX.s04?.labels?.[1] ?? ''},
  {type: 'text', key: 'l3', label: '标 3', default: CX.s04?.labels?.[2] ?? ''},
] as const satisfies readonly ParamField[];

const Label: React.FC<{l: L}> = ({l}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const p = interpolate(t, [l.atSec, l.atSec + 0.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  if (p <= 0) return null;
  const w = 168;
  return (
    <>
      <svg
        style={{position: 'absolute', inset: 0, width: 1920, height: 1080, pointerEvents: 'none'}}
      >
        <line
          x1={l.x + (l.x < l.tx ? w : 0) - (l.x > l.tx ? 0 : 0)}
          y1={l.y + 26}
          x2={l.tx}
          y2={l.ty}
          stroke={C.accent}
          strokeWidth={1.5}
          opacity={p * 0.7}
        />
        <circle cx={l.tx} cy={l.ty} r={5} fill={C.accent} opacity={p} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: l.x,
          top: l.y,
          width: w,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingLeft: 18,
          background: 'rgba(16,16,20,.9)',
          border: `1px solid rgba(224,69,44,.55)`,
          borderRadius: 10,
          opacity: p,
          transform: `translateY(${interpolate(p, [0, 1], [10, 0])}px)`,
          fontFamily: FONT.cn,
          fontSize: 26,
          fontWeight: 600,
          color: C.text,
          letterSpacing: 1,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 99,
            background: C.accent,
            flex: '0 0 auto',
          }}
        />
        {l.text}
      </div>
    </>
  );
};

/** s04 · 例证（强调）：真成片进杂志框，三个 label 依次点名人物 / 字幕 / 流程图 */
export const S04: React.FC<{shot: Shot; payload: any}> = ({shot, payload}) => {
  const S = shot ?? SHOT_BY_ID.s04;
  const k = S.tScale ?? 1;
  const p = useParams(shot?.id ?? 's04', PARAMS);
  const D: any = payload ?? (CX as any).s04 ?? {};
  const LABELS: L[] = LABEL_POS.map((b, i) => ({
    ...b,
    // 时刻跟着镜长缩放，长镜里三条引线不会全挤在前 3 秒
    atSec: b.atSec * k,
    text: (D.labels?.[i] ?? [p.l1, p.l2, p.l3][i]) || '',
  }));
  return (
  <AbsoluteFill style={{background: '#0B0B10'}}>
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(ellipse 58% 48% at 30% 24%, #1A1A24 0%, transparent 62%),' +
          '#0B0B10',
      }}
    />
    <CameraRig path={S.path} durationSec={S.durationSec}>
      <div style={{position: 'absolute', left: FRAME_L, top: FRAME_T}}>
        <ThemeFrame kind="magazine" width={FRAME_W} height={FRAME_H} label="PREVIEW" sub="20s">
          <OffthreadVideo
            src={staticFile('video/preview.mp4')}
            muted
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        </ThemeFrame>
      </div>
    </CameraRig>
    {LABELS.map((l) => (
      <Label key={l.text} l={l} />
    ))}
  </AbsoluteFill>
  );
};
