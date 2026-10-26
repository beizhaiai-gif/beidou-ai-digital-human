import React from 'react';
import KeywordPop from './keyword-pop-highlight';
import QuoteCard, {QuoteLine} from './quote-card';
import LineByLineSlide from './line-by-line-slide';
import InfoTermCard from './info-term-card';
import HandDrawnEllipse from './hand-drawn-ellipse';
import ChapterTitleCard from './chapter-title-card';

/**
 * 生产卡片注册表
 *
 * 作用：把分镜脚本产出的 `{card, fields}` 翻译成卡片组件的 props。
 *
 * 为什么需要适配层：108 张卡是通用模板，字段设计各不相同 ——
 *   · keyword-pop 要「前文 / 关键词 / 后文」三段，分镜给的是整句 + 关键词
 *   · quote-card 要行数组，分镜给的是 line1 / line2
 * 加一层适配，卡片本身就可以保持原样、不用为每种字段组合改代码。
 *
 * 所有卡都传 hideHost：人物走 PipHost 小窗，卡片自带的整帧人物必须关掉。
 */

type Fields = Record<string, any>;

export type LiveCard = {
  comp: React.FC<any>;
  /** fields → props */
  props: (f: Fields) => Record<string, any>;
};

/** 整句 + 关键词 → 三段（关键词不在句子里就不弹，宁可素排） */
function splitKeyword(f: Fields) {
  const text = String(f.text || '');
  const kw = String(f.keyword || '');
  const i = kw ? text.indexOf(kw) : -1;
  if (i < 0) return {before: text, kw: '', after: ''};
  return {before: text.slice(0, i), kw, after: text.slice(i + kw.length)};
}

/** line1 / line2 / ... → 行数组；可用 kw 指定某一行要高亮的词 */
function toQuoteLines(f: Fields) {
  const out: QuoteLine[] = [];
  for (let i = 1; i <= 4; i++) {
    const t = f[`line${i}`];
    if (t) out.push({text: String(t)});
  }
  if (!out.length && f.text) out.push({text: String(f.text)});
  if (f.kw && out.length) {
    const last = out[out.length - 1];
    const k = String(f.kw);
    if (last.text.includes(k)) last.kw = k;
  }
  return {lines: out, source: f.source};
}

export const LIVE_CARDS: Record<string, LiveCard> = {
  'keyword-pop-highlight': {comp: KeywordPop, props: splitKeyword},
  'quote-card': {comp: QuoteCard, props: toQuoteLines},
  'line-by-line-slide': {
    comp: LineByLineSlide,
    props: (f) => ({lines: Array.isArray(f.lines) ? f.lines.map(String) : undefined}),
  },
  'info-term-card': {
    comp: InfoTermCard,
    props: (f) => ({term: f.term, abbr: f.abbr, gloss: f.gloss, icon: f.icon}),
  },
  'hand-drawn-ellipse': {
    comp: HandDrawnEllipse,
    props: (f) => ({lead: f.lead, target: f.target}),
  },
  'chapter-title-card': {
    comp: ChapterTitleCard,
    props: (f) => ({num: f.num, name: f.name, sub: f.sub}),
  },
  /**
   * 以下两张还没做参数化（chat-gpt 393 行、subscribe-cta 在内部写死），
   * 先用金句卡兜住：**宁可样式不完全对应，也绝不能返回空 → 那一镜会直接黑屏**。
   * 优先级：接原生卡 > 换等价卡 > 黑屏（永远不要最后这个）。
   */
  'chat-gpt': {
    comp: QuoteCard,
    props: (f) => ({
      lines: [f.ask ? {text: String(f.ask)} : null, f.answer ? {text: String(f.answer), kw: ''} : null].filter(
        Boolean,
      ) as QuoteLine[],
      source: '一问一答',
    }),
  },
  'subscribe-cta': {
    comp: QuoteCard,
    props: (f) => ({lines: [{text: String(f.text || '关注 · 一键三连')}], source: ''}),
  },
};

export function hasLiveCard(id: string) {
  return Boolean(LIVE_CARDS[id]);
}

export function renderLiveCard(id: string, fields: Fields): {Comp: React.FC<any>; props: any} | null {
  const c = LIVE_CARDS[id];
  if (!c) return null;
  return {Comp: c.comp, props: {hideHost: true, ...c.props(fields || {})}};
}
