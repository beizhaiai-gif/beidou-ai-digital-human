import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from 'remotion';
import {CameraRig} from '../camera';
import {SHOT_BY_ID, Shot} from '../shots';
import {C, FONT} from '../theme';
import CT from '../content.json';
import {useParams, ParamField} from '../params';

/**
 * broll · 实拍/录屏（第五种版式）
 *
 * 用途：要在画面上「真的看到那个东西」的段落 —— 产品界面、后台截图、操作录屏、外部素材。
 * 口播变画外音，人物不出镜（或只在片头出现过），画面主体是全屏素材。
 *
 * 为什么需要它：另外四种版式都只能演 3–6 秒的卡片动画。3 分钟以上的演示稿，
 * 每镜动辄 40–60 秒，卡片演完就定住（实测一条 3 分 26 秒的稿子，88% 时间是死画面）。
 * 这一段交给「会自己动的素材」才成立。
 *
 * 画面结构：
 *   全屏素材 → 左上角章节角标 → 2–3 处引线标注 → 底部渐暗（压住字幕底，保证白字可读）
 */

/** 标注的落位：左侧两条、右侧一条。y 是标签顶边，tx/ty 是引线指向的画面内坐标 */
const SLOTS = [
  {x: 118, y: 686, w: 300, at: 0.34, tx: 790, ty: 520},
  {x: 118, y: 768, w: 300, at: 0.82, tx: 1060, ty: 700},
  {x: 1468, y: 158, w: 334, at: 1.26, tx: 1210, ty: 330},
] as const;

/** 拆解契约：工作台面板可调的三个标注文案 */
export const PARAMS = [
  {type: 'text', key: 'c1', label: '标 1', default: '数据一屏看完'},
  {type: 'text', key: 'c2', label: '标 2', default: '不用来回切软件'},
  {type: 'text', key: 'c3', label: '标 3', default: '随时往里加'},
] as const satisfies readonly ParamField[];

type Media = {src: string; type: 'video' | 'image'};

/** payload.media 可以是字符串、{src,type}，缺省回落到人物原片（保证不黑屏） */
function resolveMedia(raw: unknown): Media {
  let src = '';
  let type: '' | 'video' | 'image' = '';
  if (typeof raw === 'string') src = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as {src?: string; type?: string};
    src = String(o.src || '');
    if (o.type === 'video' || o.type === 'image') type = o.type;
  }
  if (!src) src = 'video/host.mp4';
  if (!type) type = /\.(png|jpe?g|webp|gif)$/i.test(src) ? 'image' : 'video';
  return {src, type};
}

const Label: React.FC<{text: string; slot: (typeof SLOTS)[number]; k: number}> = ({text, slot, k}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const at = slot.at * k;
  const p = interpolate(t, [at, at + 0.22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  if (!text || p <= 0) return null;

  const isRight = slot.x > 960;
  const lineX1 = isRight ? slot.x : slot.x + slot.w;
  return (
    <>
      <svg style={{position: 'absolute', inset: 0, width: 1920, height: 1080, pointerEvents: 'none'}}>
        <line
          x1={lineX1}
          y1={slot.y + 30}
          x2={slot.tx}
          y2={slot.ty}
          stroke={C.accent}
          strokeWidth={1.6}
          opacity={p * 0.72}
        />
        <circle cx={slot.tx} cy={slot.ty} r={6} fill={C.accent} opacity={p} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: slot.x,
          top: slot.y,
          width: slot.w,
          height: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingLeft: 18,
          paddingRight: 14,
          background: 'rgba(12, 12, 16, 0.88)',
          border: '1px solid rgba(224, 69, 44, 0.5)',
          borderRadius: 10,
          opacity: p,
          transform: `translateY(${interpolate(p, [0, 1], [12, 0])}px)`,
          fontFamily: FONT.cn,
          fontSize: 27,
          fontWeight: 600,
          color: C.text,
          letterSpacing: 0.5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span style={{width: 9, height: 9, borderRadius: 99, background: C.accent, flex: '0 0 auto'}} />
        {text}
      </div>
    </>
  );
};

export const S05: React.FC<{shot: Shot; payload: any}> = ({shot, payload}) => {
  const S = shot ?? SHOT_BY_ID.s05;
  const k = S?.tScale ?? 1;
  const p = useParams(shot?.id ?? 's05', PARAMS);
  const D: any = payload ?? (CT as any).broll ?? {};

  const media = resolveMedia(D.media);
  const labels: string[] = (D.labels?.length ? D.labels : [p.c1, p.c2, p.c3]) || [];
  const caption: string = D.caption || '';

  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  // 素材层入场：极短淡入，避免硬切
  const fadeIn = interpolate(t, [0, 0.3], [0, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.quad)});
  // 角标：0.12s 后从左侧滑入
  const capIn = interpolate(t, [0.12, 0.42], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{background: '#0B0B10'}}>
      <CameraRig path={S?.path ?? []} durationSec={S?.durationSec ?? 4}>
        <AbsoluteFill style={{opacity: fadeIn}}>
          {media.type === 'image' ? (
            <Img src={staticFile(media.src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            <OffthreadVideo
              src={staticFile(media.src)}
              muted
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          )}
        </AbsoluteFill>
      </CameraRig>

      {/* 底部渐暗：界面多半是浅色，压一层才保证字幕白字读得清 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(7,11,20,0) 58%, rgba(7,11,20,0.55) 82%, rgba(7,11,20,0.86) 100%)',
          pointerEvents: 'none',
        }}
      />
      {/* 四角轻微压暗，把注意力收到中央 */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 88% 76% at 50% 46%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.34) 100%)',
          pointerEvents: 'none',
        }}
      />

      {caption ? (
        <div
          style={{
            position: 'absolute',
            left: 82,
            top: 74,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px 10px 18px',
            borderRadius: 999,
            background: 'rgba(12, 12, 16, 0.84)',
            border: '1px solid rgba(245,245,247,0.14)',
            opacity: capIn,
            transform: `translateX(${interpolate(capIn, [0, 1], [-18, 0])}px)`,
            fontFamily: FONT.cn,
            fontSize: 28,
            fontWeight: 600,
            color: C.text,
            letterSpacing: 1,
          }}
        >
          <span style={{width: 10, height: 10, borderRadius: 99, background: C.accent}} />
          {caption}
        </div>
      ) : null}

      {SLOTS.map((slot, i) => (
        <Label key={i} text={labels[i] || ''} slot={slot} k={k} />
      ))}
    </AbsoluteFill>
  );
};

export default S05;
