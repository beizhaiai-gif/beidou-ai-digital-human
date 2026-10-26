/**
 * 卡片说明书 · 第 1 批（20 张）
 *
 * 字段：
 *   id     卡片 id（= tplcards 里的文件名）
 *   name   中文名
 *   cat    分类
 *   dur    建议配多长（秒）—— 不是完整动画时长，是「配它多长合适」
 *   use    什么时候该用（给模型挑卡用）
 *   slots  要填的文案位：k 键名 / label 说明 / max 字数上限 / opt 可选 / req 必填
 *   arrMin 数组位最少几条（不满足就换卡）
 *   check  额外校验：number 必须含数字 / pairs 必须是「标签:数值」 / contains 后者要含在前者里
 *   tag    mid（默认可进中间镜）/ tail（只能放片尾）/ person（纯人物镜）
 *   need   'image' = 要自带图片素材，暂时不进菜单
 *   note   使用规则
 */

export const PART1 = [
  {
    id: 'strike-and-replace',
    name: '划线纠错替换',
    cat: '强调标注',
    dur: 3.3,
    use: '先显示半句，再把旧说法划掉、换成新说法。用于「不是 A，而是 B」「以前这样做 / 其实应该那样」',
    slots: [
      { k: 'line', label: '引子半句', max: 10, opt: 1 },
      { k: 'from', label: '被划掉的旧说法', max: 6, req: 1 },
      { k: 'to', label: '换上的新说法', max: 6, req: 1 },
    ],
    note: 'line 里不能包含 from，否则屏幕上同一个词出现两遍',
  },
  {
    id: 'quote-card',
    name: '金句大字卡',
    cat: '字幕花字',
    dur: 4.2,
    use: '把一句观点砸在屏幕上。下结论、给判断、说金句时用',
    slots: [
      { k: 'line1', label: '正文第一行', max: 16, req: 1 },
      { k: 'line2', label: '正文第二行（更短更狠）', max: 14, opt: 1 },
      { k: 'source', label: '角落小字出处', max: 12, opt: 1 },
    ],
    note: '两行要能连读成一句，不能各说一半',
  },
  {
    id: 'keyword-pop-highlight',
    name: '关键词弹出强调',
    cat: '字幕花字',
    dur: 1.5,
    use: '整句字幕铺在屏上，其中一个词弹出来放大 + 整屏微震。口播里最常见的重音',
    slots: [
      { k: 'text', label: '整句字幕', max: 28, req: 1 },
      { k: 'keyword', label: '要弹的词（必须是整句里连续一段）', max: 6, opt: 1 },
    ],
    note: 'keyword 找不到就换卡。只有 1.5 秒，太快，别配长句',
  },
  {
    id: 'hand-drawn-ellipse',
    name: '手绘圈重点',
    cat: '强调标注',
    dur: 3.5,
    use: '手绘椭圆把屏幕上一个东西圈住。说「就看这一个」「关键是它」时用',
    slots: [{ k: 'target', label: '被圈住的内容', max: 8, req: 1 }],
    note: '只圈一个，圈两个以上就乱',
  },
  {
    id: 'number-counter',
    name: '数字滚动计数',
    cat: '数据信息图',
    dur: 2.9,
    use: '一个数字从 0 滚到目标值。稿子里出现条数、播放量、金额、倍数时首选',
    slots: [
      { k: 'target', label: '目标数字（纯数字，可带单位）', max: 12, req: 1 },
      { k: 'label', label: '数字下方说明', max: 10, opt: 1 },
    ],
    check: 'number',
    note: '数字必须来自稿子原话，不许编',
  },
  {
    id: 'bar-chart-growth',
    name: '柱状生长',
    cat: '数据信息图',
    dur: 3.7,
    use: '一排柱子依次长起来。说「越来越多」「一个月比一个月高」时用',
    slots: [
      { k: 'title', label: '图表标题', max: 12, req: 1 },
      { k: 'bars', label: '柱子，每项写成「标签:数值」', max: 40, req: 1 },
    ],
    check: 'pairs',
    arrMin: { bars: 3 },
    note: '只在讲变化/趋势时用；单点数字用 number-counter',
  },
  {
    id: 'numbered-step-stack',
    name: '编号步骤堆入',
    cat: '数据信息图',
    dur: 3.6,
    use: '几条带编号的横条依次堆进来。说「第一步…第二步…」或罗列清单时用',
    slots: [
      { k: 'title', label: '标题', max: 10, opt: 1 },
      { k: 'steps', label: '3–4 条，每条一个动作短语', max: 40, req: 1 },
    ],
    arrMin: { steps: 2 },
    note: '每条都要动词开头，别写名词',
  },
  {
    id: 'parallel-items-with-host',
    name: '并列句排版（人物在场）',
    cat: '人物互动',
    dur: 3.5,
    use: '人物留在画面里，旁边排三样并列的东西。说「三样东西」「三个原因」时用',
    slots: [{ k: 'items', label: '3 个并列项', max: 20, req: 1 }],
    arrMin: { items: 3 },
    note: '三项必须同层级；有一项明显更大就别用',
  },
  {
    id: 'chat-gpt',
    name: 'ChatGPT 对话框',
    cat: '素材呈现',
    dur: 4.0,
    use: '屏上打出「我让它干什么」和「它回了什么」。讲提需求、下指令、AI 回应时用',
    slots: [
      { k: 'ask', label: '我问的话（第一人称口语）', max: 20, req: 1 },
      { k: 'answer', label: '它答的话（像真回复）', max: 24, req: 1 },
    ],
    note: 'answer 别写成广告词',
  },
  {
    id: 'host-shrink-to-chip',
    name: '人物缩位让台',
    cat: '人物互动',
    dur: 3.9,
    tag: 'person',
    use: '人物从全屏缩到角落。**这是纯人物镜的主力卡**，画面就是数字人 + 字幕',
    slots: [],
    note: '纯人物镜用它，不铺任何卡片',
  },

  {
    id: 'metric-with-sparkline',
    name: '数字带趋势',
    cat: '数据信息图',
    dur: 3.9,
    use: '左边指标名 + 大数字 + 涨跌箭头 + 4 点折线，右边真人竖版。讲「涨了多少」「效率提升 X%」',
    slots: [
      { k: 'label', label: '指标名', max: 10, req: 1 },
      { k: 'value', label: '数字本身', max: 8, req: 1 },
      { k: 'unit', label: '单位', max: 3, opt: 1 },
      { k: 'trend', label: '填 涨 或 跌', max: 2, opt: 1 },
      { k: 'axis', label: '横轴 4 个标签', max: 16, req: 1 },
    ],
    check: 'number',
    arrMin: { axis: 2 },
    note: '横轴 4 个标签要同层级（周一/周二 或 1月/2月）',
  },
  {
    id: 'chart-grow',
    name: '柱状生长（白底）',
    cat: '数据信息图',
    dur: 2.3,
    use: '白底柱状图 5 根从 0 长起来，**最后一根自动变红**。讲「从 12 涨到 86」这类趋势',
    slots: [
      { k: 'title', label: '图表标题（带单位）', max: 12, req: 1 },
      { k: 'bars', label: '每项写成「标签:数值」', max: 40, req: 1 },
    ],
    check: 'pairs',
    arrMin: { bars: 3 },
    note: '关键数字放最后（会被高亮）。只有 2.3 秒，适合短促重音',
  },
  {
    id: 'info-term-card',
    name: '名词解释卡',
    cat: '数据信息图',
    dur: 3.0,
    use: '真人全屏，右侧弹一张小卡解释名词：名词 + 英文缩写 + 一句解释。出现行话、缩写时用',
    slots: [
      { k: 'term', label: '要解释的名词', max: 16, req: 1 },
      { k: 'abbr', label: '英文缩写或标签', max: 5, opt: 1 },
      { k: 'gloss', label: '一句完整解释', max: 40, req: 1 },
    ],
    note: '卡片只在前 3 秒，之后是纯人物，所以按 3 秒配它',
  },
  {
    id: 'ui-flow-theater',
    name: '界面流程剧场',
    cat: '素材呈现',
    dur: 5.0,
    use: '**纯代码画的假界面**：设置面板 + 3 行设置项 + 光标点按钮 + 右下角弹「已保存」。讲「界面上有这个东西」「我点了哪一下」——不需要录屏',
    slots: [
      { k: 'title', label: '面板标题', max: 8, req: 1 },
      { k: 'rows', label: '2–3 行设置项，每行「名称｜说明」', max: 60, req: 1 },
      { k: 'cta', label: '按钮上的字', max: 4, opt: 1 },
      { k: 'toast', label: '点完弹出的提示', max: 14, opt: 1 },
    ],
    arrMin: { rows: 2 },
    note: '设置项名称要短（4–6字），说明 8–14 字。完整动画 9.4 秒，按 5 秒用只演前半段',
  },
  {
    id: 'chat-message-flow',
    name: '聊天记录自演',
    cat: '素材呈现',
    dur: 4.5,
    use: '微信式聊天窗，消息依次冒出（我发的在右、对方在左），左下角是数字人头像。讲「我提要求、对方回我」',
    slots: [
      { k: 'peer', label: '对方名字 + 身份', max: 12, req: 1 },
      { k: 'messages', label: '2–4 条消息，每条「我/对方｜内容」', max: 72, req: 1 },
    ],
    arrMin: { messages: 2 },
    note: '消息要口语短句，至少一问我答。完整 9.2 秒，按 4–5 秒用只演前几条',
  },
  {
    id: 'news-card-desk',
    name: '新闻卡片划重点',
    cat: '素材呈现',
    dur: 5.0,
    use: '报纸风格大卡（报头 + 日期版次 + 大标题 + 下划线重点）+ 右侧叠一张快讯卡。讲政策、行业消息、热点',
    slots: [
      { k: 'masthead', label: '报头', max: 8, req: 1 },
      { k: 'meta', label: '日期 + 版次', max: 12, opt: 1 },
      { k: 'headline', label: '主标题（新闻陈述句）', max: 20, req: 1 },
      { k: 'highlight', label: '主标题里要划重点那几个字', max: 10, opt: 1 },
      { k: 'brief', label: '右侧快讯标题', max: 16, opt: 1 },
    ],
    note: '主标题写成陈述句不要口号；highlight 必须能在 headline 里找到',
  },
  {
    id: 'chapter-title-card',
    name: '章节标题卡',
    cat: '转场结构',
    dur: 5.0,
    use: '真人缩到左半 → 右半浮出深色章节卡（大号数字 + 章节名 + 副标题）→ 满屏 → 回真人。讲完一块进下一块时用',
    slots: [
      { k: 'num', label: '章节数字', max: 2, req: 1 },
      { k: 'name', label: '章节名', max: 10, req: 1 },
      { k: 'sub', label: '副标题小字', max: 16, opt: 1 },
    ],
    note: '全片用 1–2 次，别每段都来一个',
  },
  {
    id: 'highlighter-sweep',
    name: '荧光笔划重点',
    cat: '强调标注',
    dur: 2.0,
    use: '屏上一段正文，其中一句被黄色荧光笔扫过高亮。讲报告、条款、长文本里的关键句时用',
    slots: [
      { k: 'body', label: '整段正文', max: 60, req: 1 },
      { k: 'quote', label: '要划的那一句（必须在正文里）', max: 24, req: 1 },
      { k: 'source', label: '角落出处小字', max: 16, opt: 1 },
    ],
    check: 'contains',
    note: '只有 2 秒，全靠这一句撑住，别写废话',
  },
  {
    id: 'crash-zoom-punch',
    name: '急推特写',
    cat: '强调标注',
    dur: 4.8,
    use: '一个设置页被猛地推近，定在某一行的标题上（大标题 + 副文案）。指着某个条目说「就是这个」时用',
    slots: [
      { k: 'title', label: '推到的那一行标题', max: 10, req: 1 },
      { k: 'sub', label: '副文案（数字、时间、条件）', max: 22, opt: 1 },
    ],
    note: '它有 src 参数但只能吃图片，塞视频会渲染失败',
  },
  {
    id: 'split-compare-slider',
    name: '对比双分屏',
    cat: '素材呈现',
    dur: 9.9,
    need: 'image',
    use: '左右分屏，中间圆形拖拽手柄往两边推。**需要两张真实图片**（前 / 后）',
    slots: [
      { k: 'before', label: '左半边图片', max: 40, req: 1 },
      { k: 'after', label: '右半边图片', max: 40, req: 1 },
      { k: 'labelA', label: '左标签', max: 6, opt: 1 },
      { k: 'labelB', label: '右标签', max: 6, opt: 1 },
    ],
    note: '没有图片素材就用不了，等接了素材上传再放出来',
  },
]
