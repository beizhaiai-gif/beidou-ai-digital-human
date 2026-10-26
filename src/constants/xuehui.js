/**
 * 薛辉体系常量（两个步骤共用，别各写一份）
 *
 * 四大脚本模型 = 骨架（决定这条视频怎么讲）
 * 八大爆款元素 = 长在骨架上的肉（决定哪类人一看就想点）
 */

export const FRAMEWORKS = [
  { key: 'process', label: '晒过程', hint: '展示真实操作过程' },
  { key: 'story', label: '讲故事', hint: '用故事带出观点' },
  { key: 'teach', label: '教知识', hint: '给具体方法步骤' },
  { key: 'view', label: '说观点', hint: '犀利表达立场' },
]

/** 中文标签 → key（第一步传过来的是 label，第二步要还原成 key） */
export const FW_KEY_BY_LABEL = {
  晒过程: 'process',
  讲故事: 'story',
  教知识: 'teach',
  说观点: 'view',
}

export const FW_LABEL_BY_KEY = {
  process: '晒过程',
  story: '讲故事',
  teach: '教知识',
  view: '说观点',
}

/** 把第一步带过来的 fw（中文 label 或英文 key）统一成 key */
export function normalizeFw(fw, fallback = 'teach') {
  if (!fw) return fallback
  if (FW_LABEL_BY_KEY[fw]) return fw
  return FW_KEY_BY_LABEL[fw] || fallback
}

export const ELEMENTS = [
  { name: '特定人群', desc: '锁定一类人的身份标签' },
  { name: '成本', desc: '极低成本 / 极高产出比' },
  { name: '名人', desc: '借大佬明星的势' },
  { name: '奇葩', desc: '最反常的人或事' },
  { name: '女人', desc: '女性视角 / 女性用户' },
  { name: '最差', desc: '反向：拿最差案例说事' },
  { name: '反差', desc: '预期与现实的落差' },
  { name: '怀旧', desc: '唤起集体记忆' },
]

export const ELEMENT_NAMES = ELEMENTS.map((e) => e.name)

/** 最多选 3 个 */
export function toggleElement(list, name, max = 3) {
  const next = [...list]
  const i = next.indexOf(name)
  if (i >= 0) next.splice(i, 1)
  else if (next.length < max) next.push(name)
  return next
}

/** 中文口播语速：实测 4.3 字/秒（edge-tts 云希 132 字 27.6 秒），和 server 保持一致 */
export const CHARS_PER_SEC = 4.3

/** 统一字数口径：去掉空白 + 标点，只数真正念出来的字 */
export function countChars(text) {
  return String(text || '').replace(/[\s，。！？、；：""''（）《》〈〉…—～·,.!?;:'"()\[\]{}<>]/g, '').length
}
