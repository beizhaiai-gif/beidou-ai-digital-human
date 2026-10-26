import React, {useMemo} from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {timing, CharStamp} from './timing';
import {C, FONT} from './theme';

type Phrase = {chars: CharStamp[]; start: number; end: number};

const BREAKS = new Set(['，', '。', '？', '！', '；', '：', '、']);

// Pre-split every scene's text into phrases at punctuation so the subtitle
// line stays short. Times are absolute seconds from the ASR alignment.
const buildPhrases = (): Phrase[] => {
  const phrases: Phrase[] = [];
  for (const scene of timing.scenes) {
    let current: CharStamp[] = [];
    for (const c of scene.chars) {
      current.push(c);
      if (BREAKS.has(c.ch) && current.some((x) => x.ch.trim() && !BREAKS.has(x.ch))) {
        phrases.push({
          chars: current,
          start: current[0].t,
          end: current[current.length - 1].e,
        });
        current = [];
      }
    }
    if (current.some((x) => x.ch.trim() && !BREAKS.has(x.ch))) {
      phrases.push({
        chars: current,
        start: current[0].t,
        end: current[current.length - 1].e,
      });
    }
  }
  return phrases;
};

/** 保留原 Subtitles.find 的优先级：前句的 0.3s 留白结束后，后句才可接管。
 * 两条渲染路径共用实际可见窗口，避免拆解后提前切到下一句。时间戳按时间顺序排列。 */
const buildVisiblePhrases = (): Phrase[] => {
  let coveredUntil = -Infinity;
  return buildPhrases().flatMap((p) => {
    const start = Math.max(p.start, coveredUntil);
    const end = p.end + 0.3;
    coveredUntil = Math.max(coveredUntil, end);
    return end > start ? [{...p, start, end}] : [];
  });
};

/** 拆解契约：全部可见字幕段，起止窗口与 Subtitles 共用。 */
export type SubPhrase = {text: string; start: number; end: number; dark: boolean};
export const phrases = (): SubPhrase[] => {
  return buildVisiblePhrases().map((p) => ({
    text: p.chars.map((c) => c.ch).join('').trim(),
    start: p.start,
    end: p.end,
    dark: false,
  }));
};

/** 拆解契约：单句静态渲染（与下面 Subtitles 同一套样式；工作台字幕句片段用它画，改文本不改样式） */
export const SubtitleLine: React.FC<{text: string; dark?: boolean; bottom?: number; fontSize?: number; maxWidth?: number | string}> = ({
  text,
  bottom = 100,
  fontSize = 44,
  maxWidth = '66%',
}) => {
  if (!text) return null;
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          marginBottom: bottom,
          padding: '14px 42px',
          borderRadius: 14,
          background: 'rgba(7, 11, 20, 0.72)',
          border: `1px solid ${C.line}`,
          fontFamily: FONT.cn,
          fontSize: text.length > 24 ? Math.round(fontSize * 0.86) : fontSize,
          fontWeight: 600,
          letterSpacing: 2,
          maxWidth,
          textAlign: 'center',
          textWrap: 'balance',
          color: C.text,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

type KeywordRun = {from: number; to: number; at: number}; // char index range [from, to) + 语音锚点秒

/** 三种字幕版式：karaoke 逐字高亮 / line 整句上屏 / punch 大字冲击 */
export type CaptionVariant = 'karaoke' | 'line' | 'punch';

// 在一个 phrase 里找关键词的字符区间（每个 phrase 只取首次出现），锚点 = 首字的 ASR 时间戳。
const findRuns = (phrase: Phrase, keywords: string[]): KeywordRun[] => {
  const text = phrase.chars.map((c) => c.ch).join('');
  const runs: KeywordRun[] = [];
  for (const kw of keywords) {
    const i = text.indexOf(kw);
    if (i >= 0) runs.push({from: i, to: i + kw.length, at: phrase.chars[i].t});
  }
  return runs;
};

/**
 * 底部跟读字幕。三种版式由 variant 切换（工程从 content.json 的 captionStyle 注入）：
 * - line（默认）：整句硬现、整句硬走，无淡入淡出、无逐字上色 —— 素排版红线。
 * - karaoke：按字级时间戳逐字点亮 —— 没说的字压暗、正在说的字用强调色、说过的字常亮。
 * - punch：无底框大字号冲击版，整句带一次 0.18s 回弹入场。
 * keywords prop 做 keyword-pop-highlight，全片最多 3 处，karaoke 下不参与。
 */
export const Subtitles: React.FC<{
  bottom?: number;
  fontSize?: number;
  maxWidth?: number | string;
  /** 关键词弹出（keyword-pop-highlight）用的词表；每词按 phrase 文本连续匹配 */
  keywords?: string[];
  /** 关键词 >3 个时的显式放行开关，只在用户明确要求更多时打开 */
  allowExtraKeywordPops?: boolean;
  accent?: string;
  /** 字幕版式，默认 line */
  variant?: CaptionVariant;
}> = ({
  bottom = 100,
  fontSize = 44,
  maxWidth = '66%',
  keywords = [],
  allowExtraKeywordPops = false,
  accent = C.cyan,
  variant = 'line',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const allPhrases = useMemo(buildVisiblePhrases, []);

  const allRuns = useMemo(() => {
    const map = new Map<Phrase, KeywordRun[]>();
    let total = 0;
    for (const p of allPhrases) {
      const runs = findRuns(p, keywords);
      if (runs.length) {
        map.set(p, runs);
        total += runs.length;
      }
    }
    if (total > 3 && !allowExtraKeywordPops) {
      throw new Error(
        `Subtitles: keyword-pop 命中 ${total} 处，超过全片上限 3 次。` +
          `减少 keywords，或在用户明确要求更多时传 allowExtraKeywordPops。`
      );
    }
    return map;
  }, [allPhrases, keywords, allowExtraKeywordPops]);

  const phrase = allPhrases.find((p) => t >= p.start && t < p.end);
  if (!phrase) return null;

  const runs = allRuns.get(phrase) ?? [];
  const runOf = (i: number) => runs.find((r) => i >= r.from && i < r.to);

  const isPunch = variant === 'punch';
  const isKaraoke = variant === 'karaoke';

  // punch：整句入场回弹（0.18s 1.16 → 1）
  const punchScale = isPunch
    ? interpolate(t - phrase.start, [0, 0.18], [1.16, 1], {
        easing: Easing.out(Easing.cubic),
        extrapolateRight: 'clamp',
      })
    : 1;

  const common: React.CSSProperties = {
    marginBottom: bottom,
    fontFamily: FONT.cn,
    maxWidth,
    textAlign: 'center',
    textWrap: 'balance',
    color: C.text,
  };

  const boxStyle: React.CSSProperties = isPunch
    ? {
        ...common,
        padding: '4px 20px',
        background: 'transparent',
        fontSize: phrase.chars.length > 24 ? Math.round(fontSize * 1.16) : Math.round(fontSize * 1.42),
        fontWeight: 900,
        letterSpacing: 1,
        lineHeight: 1.22,
        textShadow: '0 8px 28px rgba(0,0,0,0.62), 0 2px 4px rgba(0,0,0,0.8)',
        transform: `scale(${punchScale})`,
      }
    : {
        ...common,
        padding: '14px 42px',
        borderRadius: 14,
        background: 'rgba(7, 11, 20, 0.72)',
        border: `1px solid ${C.line}`,
        fontSize: phrase.chars.length > 24 ? Math.round(fontSize * 0.86) : fontSize,
        fontWeight: 600,
        letterSpacing: 2,
      };

  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none'}}>
      <div style={boxStyle}>
        {phrase.chars.map((c, i) => {
          const run = runOf(i);
          let scale = 1;
          let popped = false;
          if (run && t >= run.at) {
            popped = true;
            const since = t - run.at;
            // keyword-pop-highlight 落到字幕上的适配：整句先素排可读，
            // 关键词到自己的语音时间戳才弹（1→1.65 punch 0.18s → 回落 1.15 带过冲 0.22s），
            // 之后保持 1.15 + 强调色常驻。
            scale =
              since < 0.18
                ? interpolate(since, [0, 0.18], [1, 1.65], {easing: Easing.out(Easing.quad)})
                : since < 0.4
                  ? interpolate(since, [0.18, 0.3, 0.4], [1.65, 1.08, 1.15], {
                      easing: Easing.inOut(Easing.quad),
                      extrapolateRight: 'clamp',
                    })
                  : 1.15;
          }

          // karaoke：按字自己的时间戳决定亮到哪儿
          const spoken = t >= c.t;
          const speaking = spoken && t < c.e;
          const karaokeColor = isKaraoke
            ? speaking
              ? accent
              : spoken
                ? C.text
                : 'rgba(255,255,255,0.34)'
            : undefined;

          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                color: popped ? accent : karaokeColor,
                fontWeight: popped ? 700 : isKaraoke && speaking ? 800 : undefined,
                transform: scale !== 1 ? `scale(${scale})` : undefined,
              }}
            >
              {/* inline-block span 里普通空格塌为零宽（英文短语会连成一串），换 NBSP */}
              {c.ch === ' ' ? '\u00A0' : c.ch}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
