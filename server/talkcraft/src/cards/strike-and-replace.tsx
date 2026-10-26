import React from "react";
import { AbsoluteFill, Loop, OffthreadVideo, useCurrentFrame } from "remotion";

// strike-and-replace · 划线纠错替换 —— 自包含 Remotion 源码（与 demos/strike-and-replace/index.html 同画面）
// 复制本文件进你的工程即可用；主持人视频经 hostSrc prop 注入，不传则灰阶剪影占位。
export const meta = { width: 960, height: 540, fps: 30, durationInFrames: 98 };

const FPS = meta.fps;

// ─────────────────────────────────────────────────────────────────────────
// 可摘走的核心动画：划线纠错替换（"不是 A，而是 B"）
//   三拍：
//     快斩    划掉线 scaleX 0→1，0.15s power3.out（origin left，线高 = 字号 8%）
//     立换    +0.1s 旧值淡出 + 新值从 y+8 同位淡入 0.25s（同位叠放 ⇒ 替换感）
//     定格    划线与新值同屏 hold：论证已完成，让观众读
//   变体 b（value-swap）：把 from/to 里更长的字符串当隐形尺子撑宽容器，
//   换值零位移——本卡的 .ruler 就是它，两个变体共用同一套骨架。
// ─────────────────────────────────────────────────────────────────────────
const CONFIG = {
  strikeDur: 0.15,   // 划线时长 s：一瞬间的快斩（>0.4s 读作"慢慢涂"）
  swapLag: 0.50,     // 蒙皮：「而是」1.76 才念，等口播
  swapDur: 0.25,     // 交换时长 s（旧值淡出 + 新值升入）
  hold: 2.0,         // 定格 s：划线 + 新值同屏，让观众读完"旧 → 新"
  lead: 1.05,        // 蒙皮：「不」1.08 起手，「是」1.20 落斩
  toRise: 8,         // 新值从下方多少 px 升入（约字号 20%）
  keepStrike: true,  // 划线是否留在屏上（false = 交换时一起淡出，读作"改完了"）
  from: "真人出镜",  // 旧值
  to: "Codex 生成",  // 新值
};

/* 时间表（demo 秒）
   0.35–0.50  划线 scaleX 0→1（power3.out）
   0.60–0.85  旧值淡出（power1.out）+ 新值 y 8→0 淡入（power2.out）
   0.85–2.85  hold 定格 */

// —— 缓动与 tween helper（对照 GSAP 名字）——
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const tw = (t: number, t0: number, d: number, ease: (x: number) => number) =>
  ease(clamp01((t - t0) / d));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const power1Out = (x: number) => 1 - Math.pow(1 - x, 2);
const power2Out = (x: number) => 1 - Math.pow(1 - x, 3);
const power3Out = (x: number) => 1 - Math.pow(1 - x, 4);

// 主持人占位：演示语境素材，不属于动效本体
const Host: React.FC<{ src?: string }> = ({ src }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex",
                alignItems: "flex-end", justifyContent: "center", background: "#fff" }}>
    {src ? (
      <Loop durationInFrames={13 * FPS}>
        <OffthreadVideo src={src} muted transparent style={{
          position: "absolute", bottom: 0, left: "50%",
          transform: "translateX(-50%)", height: "88%" }} />
      </Loop>
    ) : (
      <div style={{ width: "42%", height: "78%", background:
        "radial-gradient(ellipse 46% 26% at 50% 13%, #e3e3e6 60%, transparent 61%)," +
        "radial-gradient(ellipse 50% 62% at 50% 84%, #ececef 60%, transparent 61%)" }} />
    )}
  </div>
);

// —— 演示语境（不属于动效）：主持人占左一列，右侧白区排一句口播句子 ——
const CSS = `
.host-wrap { position: absolute; left: 0; top: 0; bottom: 0; width: 47%; overflow: hidden; }
.sr-line {
  position: absolute;
  left: 6%; right: 26%;
  top: 68%; transform: translateY(-50%);
  font-size: 38px; font-weight: 700; line-height: 1.5;
  white-space: nowrap;                  /* 单行：替换槽后面必须还有字，才看得出"零位移" */
  color: #F5F5F7;
}
/* 替换槽：inline-block，宽度由"隐形尺子"撑住——旧字与新字都绝对定位在它里面，占同一个位置 */
.slot { position: relative; display: inline-block; vertical-align: baseline; }
/* 隐形尺子：把 from / to 里更长的那一串排进来占位、visibility:hidden。容器宽度一次定死，换值零位移 */
.ruler { visibility: hidden; white-space: nowrap; }
/* 两个值都以槽的中线为锚（translateX(-50%)），短值在预留宽度里居中 */
.word {
  position: absolute; left: 0; top: 0;
  white-space: nowrap;
  will-change: transform, opacity;
}
.word.from { color: #F5F5F7; }          /* 旧值保持墨色——语义色只上那条线 */
.word.to { color: #F5F5F7; }            /* 新值也是墨色：变色会抢掉"划掉"这一拍 */
/* 划掉线：唯一的语义色。origin left + scaleX 0→1。它是 .word.from 的子节点 ⇒ 旧值淡出时线跟着一起走 */
.strike {
  position: absolute; left: 0; top: 50%;
  height: 3px;                          /* = 字号 8%，随字号等比 */
  width: 100%;
  background: #e0452c;
  border-radius: 2px;
  transform-origin: left center;
  will-change: transform;
}
`;

export default function StrikeAndReplace({ hostSrc, from, to, line, tScale = 1 }: {
  hostSrc?: string; from?: string; to?: string; line?: string; tScale?: number;
}) {
  /** 文案可覆盖：母版默认值来自 CONFIG，工程按 content.json 注入 */
  const FROM = from ?? CONFIG.from;
  const TO = to ?? CONFIG.to;
  const LINE = line ?? "这个「我」不是";
  const t = useCurrentFrame() / FPS / Math.max(0.5, tScale);

  // ① 划线：一瞬间快斩到底（power3.out 冲出去收住）
  const strikeX = tw(t, CONFIG.lead, CONFIG.strikeDur, power3Out);

  // ② 交换：斩完立刻换——旧值淡出、新值从 y+8 淡入回落（同位叠放 ⇒ 替换感）
  const swapAt = CONFIG.lead + CONFIG.strikeDur + CONFIG.swapLag;
  // 错峰：旧值先快速退（前 45%），新值后段才升入（后 75%）——同时可见会叠成重影
  const fromOpacity = 1 - tw(t, swapAt, CONFIG.swapDur * 0.45, power3Out);
  const toP = tw(t, swapAt + CONFIG.swapDur * 0.25, CONFIG.swapDur * 0.75, power2Out);
  const toY = lerp(CONFIG.toRise, 0, toP);
  const strikeOpacity = CONFIG.keepStrike ? 1 : fromOpacity;

  // 尺子：from / to 里更长的那一串
  const longer = FROM.length >= TO.length ? FROM : TO;

  return (
    <AbsoluteFill style={{
      background: "transparent", color: "#F5F5F7", overflow: "hidden",
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    }}>
      <style>{CSS}</style>
      <div className="sr-line">
        {LINE}
        <span className="slot">
          <span className="ruler">{longer}</span>
          <span className="word from" style={{
            opacity: fromOpacity,
          }}>
            {FROM}
            <span className="strike" style={{
              opacity: strikeOpacity,
              transform: `translateY(-50%) scaleX(${strikeX})`,
            }} />
          </span>
          <span className="word to" style={{
            opacity: toP, transform: `translateY(${toY}px)`,
          }}>{TO}</span>
        </span>
        
      </div>
    </AbsoluteFill>
  );
}
