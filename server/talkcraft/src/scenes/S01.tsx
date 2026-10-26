import React from 'react';
import {AbsoluteFill} from 'remotion';
import {CameraRig} from '../camera';
import {CardScaled} from './CardScaled';
import {HostBox} from '../HostBox';
import {SHOT_BY_ID, Shot} from '../shots';
import CT from '../content.json';

/** content.json 由后端每次生成，键不固定 —— 用宽松视图读，缺键不炸 */
const CX: any = CT as any;
import {useParams, ParamField} from '../params';
import StrikeCard from '../cards/strike-and-replace';

const S = SHOT_BY_ID.s01;

/** 拆解契约：工作台面板可调参数（只放语境级：文案），节奏命门不进表 */
export const PARAMS = [
  {type: 'text', key: 'line', label: '主文案', default: CX.s01?.line ?? ''},
  {type: 'text', key: 'from', label: '替换前', default: CX.s01?.from ?? ''},
  {type: 'text', key: 'to', label: '替换后', default: CX.s01?.to ?? ''},
] as const satisfies readonly ParamField[];

/** s01 · 钩子（转折 / 对比）：屏幕上这个人不是真人 → 人物缩角标，文字接管 */
export const S01: React.FC<{shot: Shot; payload: any}> = ({shot, payload}) => {
  const S = shot ?? SHOT_BY_ID.s01;
  const k = S.tScale ?? 1;
  const p = useParams('s01', PARAMS);
  const V: any = {...p, ...(payload ?? (CX as any).s01 ?? {})};
  return (
    <AbsoluteFill style={{background: '#0B0B10'}}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 68% 52% at 26% 20%, #1C1C28 0%, transparent 64%),' +
            'radial-gradient(ellipse 46% 42% at 84% 82%, #15151D 0%, transparent 60%),' +
            '#0B0B10',
        }}
      />
      <HostBox mode="shrink" />
      {/* 左侧 scrim：文字区压暗，人物主光保持，读得清又不糊脸 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(11,11,16,.90) 0%, rgba(11,11,16,.74) 34%, rgba(11,11,16,.18) 56%, transparent 68%)',
        }}
      />
      {/* 文字面压人物之上：人物全屏时它落在胸口，缩成角标后落在人物对侧 */}
      <CameraRig path={S.path} durationSec={S.durationSec}>
        <CardScaled width={1920} height={1080}>
          <StrikeCard from={V.from} to={V.to} line={V.line} tScale={k} />
        </CardScaled>
      </CameraRig>
    </AbsoluteFill>
  );
};
