import React from 'react';
import {Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import cueFile from './sfx-cues.json';

export type Cue = {t: number; sfx: string; db: number; event?: string};

/** 音效 cue 表（绝对秒）——与 SHOTBOOK §音效表 对齐 */
export const CUES: Cue[] = (cueFile as {cues: Cue[]}).cues;

/** dB → 线性增益（Remotion 的 volume 是线性 0–1） */
const gain = (db: number) => Math.pow(10, db / 20);

/**
 * 音效层（L7）
 *
 * 纪律：音效永远低于人声约 12dB；同一事件的多次同音色用递弱/递强表达累积。
 * 每条 cue 独立 Sequence，起点 = 绝对秒；不 trim 长度（采样自身短于 0.6s）。
 */
export const SfxLayer: React.FC = () => {
  const {fps} = useVideoConfig();

  return (
    <>
      {CUES.map((c, i) => (
        <Sequence key={`${c.sfx}-${c.t}-${i}`} from={Math.round(c.t * fps)} layout="none">
          <Audio src={staticFile(`sfx/${c.sfx}.mp3`)} volume={gain(c.db)} />
        </Sequence>
      ))}
    </>
  );
};
