import React from 'react';
import {S01, PARAMS as P01} from './S01';
import {S02, PARAMS as P02} from './S02';
import {S03, PARAMS as P03} from './S03';
import {S04, PARAMS as P04} from './S04';
import {S05, PARAMS as P05} from './S05';

/**
 * 版式 → 组件（不是镜头 id → 组件）。
 * 同一条片里可以有多个 steps / list / broll，各镜内容由 content.shots[镜头id] 注入。
 */
export const SCENES: Record<string, React.FC<any>> = {
  hook: S01,
  steps: S02,
  list: S03,
  outro: S04,
  broll: S05,
};

/** 拆解契约：每种版式的可调参数表（工作台按镜头 kind 找） */
export const SCENE_PARAMS: Record<string, readonly unknown[]> = {
  hook: P01,
  steps: P02,
  list: P03,
  outro: P04,
  broll: P05,
};
