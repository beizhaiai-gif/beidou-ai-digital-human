import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  getInputProps,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {C} from './theme';
import {Subtitles, CaptionVariant} from './Subtitles';
import {Environment} from './env';
import {SHOTS, Shot, shotSequence} from './shots';
import {PipHost, PipCfg} from './PipHost';
import {renderLiveCard} from './cards-live';
import {S01} from './scenes/S01';
import {S02} from './scenes/S02';
import {S03} from './scenes/S03';
import {S04} from './scenes/S04';
import {S05} from './scenes/S05';
import CT from './content.json';

/**
 * 主时间线
 *
 * 两种镜头：
 *   card   —— 卡片全屏铺满（960×540 的卡按 2 倍放大到 1080p），人物缩到角落小窗
 *   person —— 原视频全屏，只有字幕；底部压一层暗把原片自带字幕盖掉
 *
 * 老的五种版式（hook / steps / list / outro / broll）保留兼容，走 KIND_COMP。
 */

type Ctx = {
  pip?: PipCfg & {on?: boolean};
  captions?: {on?: boolean};
  shots?: Record<string, {card?: string; fields?: Record<string, any>; corner?: string; text?: string}>;
  captionStyle?: string;
};

const CX = CT as unknown as Ctx;

const KIND_COMP: Record<string, React.FC<{shot: Shot; payload: any}>> = {
  hook: S01,
  steps: S02,
  list: S03,
  outro: S04,
  broll: S05,
};

const CAPTION_VARIANT = (CX.captionStyle || 'line') as CaptionVariant;
const VALID_VARIANTS: CaptionVariant[] = ['karaoke', 'line', 'punch'];

/** 卡片层：108 张卡都是 960×540，整体 2 倍放大到 1920×1080（矢量渲染，放大不糊） */
const CardLayer: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: 960,
      height: 540,
      transform: 'scale(2)',
      transformOrigin: '0 0',
    }}
  >
    {children}
  </div>
);

export const MainVideo: React.FC = () => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const solo = Boolean((getInputProps() as {sfxSolo?: boolean}).sfxSolo);
  const pipOn = CX.pip?.on !== false;

  /**
   * 字幕策略
   *
   * 这条片子的原视频自带字幕（而且是精修过的：黑底白字 + 关键词标红），
   * 内容就是原配音的逐字稿 —— 和我们的 timing 完全一致，没有必要再叠一层。
   * 实测叠上去会变成两层字压在一起，而且原字幕在画面 55% 高度（不在底部），
   * 用底部黑带根本遮不住。
   *
   * 所以：默认用原片字幕（captions.on = false）。
   * 换成干净无声素材时，把 content.json 的 captions.on 设成 true 就切回我们的。
   */
  const ownCaptions = CX.captions?.on === true;
  const t = frame / fps;
  const cur = SHOTS.find((s) => t >= s.startSec && t < s.startSec + s.durationSec);
  const showSub = ownCaptions && cur?.kind === 'person';

  return (
    <AbsoluteFill style={{backgroundColor: C.bg}}>
      {/* 配音：用户提供的原配音（口型与声音同源，天然对齐） */}
      {!solo && <Audio src={staticFile('narration.wav')} />}

      {SHOTS.map((shot) => {
        const {from, duration} = shotSequence(shot, fps);
        const c = CX.shots?.[shot.id] || {};
        const startFrom = Math.round(shot.startSec * fps);

        // ---- 通用卡片镜 ----
        if (shot.kind === 'card') {
          let live = shot.cardId ? renderLiveCard(shot.cardId, c.fields || {}) : null;
          /**
           * 兜底：这张卡还没接进生产线时，用「逐行滑入」把台词铺上去。
           * 绝不能返回 null —— 那一镜会直接黑屏（实测踩过，成片尾部一片黑）。
           */
          if (!live) {
            live = renderLiveCard('line-by-line-slide', {lines: [c.text || '']});
          }
          if (live) {
            const {Comp, props} = live;
            return (
              <Sequence key={shot.id} from={from} durationInFrames={duration}>
                <CardLayer>
                  <Comp {...props} tScale={shot.tScale} />
                </CardLayer>
                {pipOn ? (
                  <PipHost
                    cfg={{...CX.pip, corner: (c.corner as PipCfg['corner']) || 'br'}}
                    src={{src: 'video/source.mp4', fromSec: shot.startSec}}
                  />
                ) : null}
              </Sequence>
            );
          }
        }

        // ---- 纯人物镜：原视频全屏 ----
        if (shot.kind === 'person') {
          return (
            <Sequence key={shot.id} from={from} durationInFrames={duration}>
              <AbsoluteFill style={{overflow: 'hidden'}}>
                <OffthreadVideo
                  src={staticFile('video/source.mp4')}
                  startFrom={startFrom}
                  muted
                  style={{width: '100%', height: '100%', objectFit: 'cover'}}
                />
              </AbsoluteFill>
            </Sequence>
          );
        }

        // ---- 老版式兼容 ----
        const Comp = KIND_COMP[shot.kind];
        if (!Comp) return null;
        const payload = CX.shots?.[shot.id] ?? (CT as any)[shot.kind] ?? {};
        return (
          <Sequence key={shot.id} from={from} durationInFrames={duration}>
            <Comp shot={shot} payload={payload} />
          </Sequence>
        );
      })}

      {/* 字幕：只在人物镜出现（卡片镜由卡片自己承担台词） */}
      {showSub ? (
        <Subtitles
          bottom={64}
          fontSize={52}
          maxWidth="72%"
          variant={VALID_VARIANTS.includes(CAPTION_VARIANT) ? CAPTION_VARIANT : 'line'}
        />
      ) : null}

      {/* 环境动效：呼吸式暗角 + 光影扫过 —— 也是静止闸要求的 environment motion */}
      <Environment breathe sweep vignette={0.28} />
    </AbsoluteFill>
  );
};
