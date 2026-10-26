import {CUES} from './SfxLayer';

export type Cue = {t: number; sfx: string; db: number; event?: string};

/**
 * 拆解契约：音效 cue 表。
 * 真实数据在 sfx-cues.json（后端每次按镜头动作点重新生成），这里是给工作台读的稳定出口。
 */
export const SFX_CUES: Cue[] = CUES;
