/**
 * 首页内嵌对话 ↔ 完整对话页 的交接点
 *
 * 首页那个框聊到一半想放大看？把消息搬到完整页继续，不用重开一轮。
 */
import { reactive } from 'vue'

export const chatBridge = reactive({
  /** 待承接的历史消息（进 ChatView 时消费掉） */
  messages: null,
})
