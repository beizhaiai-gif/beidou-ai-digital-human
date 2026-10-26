export const C = {
  bg: '#0B0B10',
  bgPanel: 'rgba(22, 22, 31, 0.9)',
  /** 全片唯一强调色（SHOTBOOK §0 G0） */
  accent: '#E0452C',
  cyan: '#E0452C',
  gold: '#F5F5F7',
  red: '#E0452C',
  green: '#F5F5F7',
  text: '#F5F5F7',
  dim: '#8A8A96',
  line: 'rgba(245, 245, 247, 0.10)',
  ink: '#101014',
  panel: '#FFFFFF',
};

export const FONT = {
  cn: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  mono: 'Menlo, "SF Mono", "Cascadia Code", monospace',
};

export const gridBg: React.CSSProperties = {
  backgroundColor: C.bg,
  backgroundImage:
    `linear-gradient(${C.line} 1px, transparent 1px),` +
    `linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
  backgroundSize: '72px 72px',
};

/** 幕底 token（design-language §1.1，2026-09-05 用户选定 12 款）：场景整幕 `<Backdrop kind={bg.light} />`；
 *  按幕替换时在 SHOTBOOK §0 声明。全部 kind 见 backdrop.tsx 的 BackdropKind。 */
export const bg = {light: 'mesh-flow-dark', dark: 'mesh-flow-dark'} as const;
