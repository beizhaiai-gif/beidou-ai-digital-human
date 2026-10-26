import React from 'react';
import {AbsoluteFill, staticFile} from 'remotion';
import {CameraRig} from '../camera';
import {CardScaled} from './CardScaled';
import {SHOT_BY_ID, Shot} from '../shots';
import CT from '../content.json';
import {useParams, ParamField} from '../params';
import ParallelCard from '../cards/parallel-items-with-host';

const S = SHOT_BY_ID.s03;

/**
 * 拆解契约：工作台面板可调参数。
 * 这一镜的内容主体是 items（三张并列卡），数组控件工作台暂不支持，
 * 文案改 content.json，面板这里留空。
 */
export const PARAMS = [] as const satisfies readonly ParamField[];

/** s03 · 列举（步骤/证据）：三样参照一起交进去，人物缩成顶部小框继续说话 */
export const S03: React.FC<{shot: Shot; payload: any}> = ({shot, payload}) => {
  const S = shot ?? SHOT_BY_ID.s03;
  const k = S.tScale ?? 1;
  const p = useParams(shot?.id ?? 's03', PARAMS);
  const V: any = {...p, ...(payload ?? (CT as any).s03 ?? {})};
  return (
    <AbsoluteFill style={{background: '#0B0B10'}}>
      <CameraRig path={S.path} durationSec={S.durationSec}>
        <CardScaled width={1920} height={1080}>
          <ParallelCard
            layout="side-column"
            items={V.items}
            srcs={[
              staticFile('stills/dh.png'),
              staticFile('stills/ref.png'),
              staticFile('stills/wave.png'),
            ]}
            hostSrc={staticFile('video/host.mp4')}
            tScale={k}
          />
        </CardScaled>
      </CameraRig>
    </AbsoluteFill>
  );
};
