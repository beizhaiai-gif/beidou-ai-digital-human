import React from 'react';
import {AbsoluteFill, Sequence, useVideoConfig} from 'remotion';
import {CameraRig} from '../camera';
import {CardScaled} from './CardScaled';
import {HostBox} from '../HostBox';
import {SHOT_BY_ID, Shot} from '../shots';
import CT from '../content.json';

/** content.json 由后端每次生成，键不固定 —— 用宽松视图读，缺键不炸 */
const CX: any = CT as any;
import {useParams, ParamField} from '../params';
import ChapterCard from '../cards/chapter-title-card';
import TimelineCard from '../cards/step-timeline-vertical';

const S = SHOT_BY_ID.s02;

/** 拆解契约：工作台面板可调参数（章节卡的三个文案位） */
export const PARAMS = [
  {type: 'text', key: 'num', label: '章节号', default: CX.s02?.num ?? '01'},
  {type: 'text', key: 'name', label: '章节名', default: CX.s02?.name ?? ''},
  {type: 'text', key: 'sub', label: '副标题', default: CX.s02?.sub ?? ''},
] as const satisfies readonly ParamField[];

/**
 * s02 · 步骤（含章节转场件）
 * 镜内 0.00–2.05 章节卡压屏盖满 → 2.05 扫出，露出已经在画的时间轴 → 空心环指向第一步
 */
export const S02: React.FC<{shot: Shot; payload: any}> = ({shot, payload}) => {
  const S = shot ?? SHOT_BY_ID.s02;
  const k = S.tScale ?? 1;
  const {fps} = useVideoConfig();
  const p = useParams('s02', PARAMS);
  const V: any = {...p, ...(payload ?? (CX as any).s02 ?? {})};

  return (
    <AbsoluteFill style={{background: '#0B0B10'}}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 72% 18%, #1A1A24 0%, transparent 62%),' +
            'radial-gradient(ellipse 44% 40% at 16% 84%, #141419 0%, transparent 58%),' +
            '#0B0B10',
        }}
      />

      {/* L3 时间轴白卡面板（人物让到右下，面板靠左） */}
      <CameraRig path={S.path} durationSec={S.durationSec}>
        <Sequence from={Math.round(1.55 * k * fps)} layout="none">
          <div style={{position: 'absolute', left: 72, top: 132, width: 1400, height: 787}}>
            <CardScaled
              width={1400}
              height={787}
              radius={30}
              shadow="0 44px 130px rgba(0,0,0,.66)"
            >
              <TimelineCard steps={V.steps} stretch={Math.min(1.8, Math.max(1, (S.durationSec - 1.55 * k) / 3.6))} />
            </CardScaled>
          </div>
        </Sequence>
      </CameraRig>

      {/* L4 章节卡（转场件）：压入盖满 → hold → 扫出 */}
      <Sequence from={0} durationInFrames={Math.round(Math.min(S.durationSec, 2.15 * k) * fps)}>
        <CardScaled width={1920} height={1080}>
          <ChapterCard num={V.num} name={V.name} sub={V.sub} tScale={k} />
        </CardScaled>
      </Sequence>

      <HostBox mode="corner-br" />
    </AbsoluteFill>
  );
};
