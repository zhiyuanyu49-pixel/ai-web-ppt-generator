/**
 * 提示词工程：把用户长文案转成严格 JSON 结构的 PPT 大纲
 */
import { LAYOUTS } from '../shared/slide-render.js';

/** 版式说明，注入系统提示词 */
const LAYOUT_DOC = `
可用版式（layout 字段必须从下列取值中选一个）：
- "cover"      封面：title + subtitle（+ bullets 可选，作为亮点），仅第 1 页使用
- "section"    章节过渡页：title（章节名）+ subtitle（一句话导语）
- "bullets"    要点页：title + bullets（3-5 条，每条 <= 40 字，可用 **加粗** 强调关键词）
- "two-column" 对比/并列页：title + columns: [{heading, items:[...]}]（2-3 栏，每栏 2-4 条）
- "stats"      数据页：title + stats: [{value:"87%", label:"说明"}]（2-4 个关键指标）
- "timeline"   时间线/流程页：title + timeline: [{time:"第一步", text:"说明"}]（3-6 项）
- "quote"      金句页：quote: {text, author}
- "closing"    结尾页：title + subtitle（+ bullets 作为行动建议）
`;

const STYLE_HINTS = {
  business: '商务汇报口吻：结论先行、数据支撑、术语准确、克制专业。',
  tech: '科技产品口吻：强调架构、能力、指标与落地场景，允许使用准确的技术名词。',
  edu: '教学培训口吻：概念解释清晰、循序渐近、多用类比与要点拆分。',
  creative: '创意营销口吻：有记忆点、有节奏感、标题有张力，但避免浮夸空话。',
  report: '研究报告口吻：结构化、可追溯、重视论据与分组归纳。',
};

/**
 * 构造系统提示词
 * @param {{slideCount?:number, language?:string, style?:string}} options
 */
export function buildSystemPrompt(options = {}) {
  const { slideCount = 0, language = 'zh', style = 'business' } = options;
  const countRule = slideCount > 0
    ? `用户要求生成 **恰好 ${slideCount} 页**（slides 数组长度必须等于 ${slideCount}），请合理分配内容。`
    : '请自行判断页数：一般 8-14 页，内容信息量大时可到 16 页；不要为了凑页数而灌水。';

  return `你是一位资深的演示文稿（PPT）架构师，擅长把长文案提炼成结构清晰、层层递进的演讲型演示文稿。

## 输出要求
1. 只输出**一个 JSON 对象**，不要输出任何解释文字、Markdown 代码块标记或前后缀。
2. JSON 必须严格合法：双引号、无尾随逗号、无注释、字符串内换行必须写成 \\n。
3. 字段顺序必须为：title, subtitle, slideCount, slides。**slideCount 必须写在 slides 前面**，且等于 slides 的长度。
4. 语言：${language === 'en' ? '全部内容使用英文。' : language === 'auto' ? '与用户原文保持一致的语言。' : '全部内容使用简体中文（专有名词可保留英文）。'}
5. 风格：${STYLE_HINTS[style] || STYLE_HINTS.business}
6. 内容必须**忠于用户原文**：不得编造原文没有的数据、人名、机构或结论；原文没有数据时不要虚构 stats。
7. 每页信息密度适中：标题 <= 24 字；要点 3-5 条、每条 <= 40 字；避免把整段话直接贴进页面。
8. 每页都要写 notes（讲者备注，40-120 字），用于提示演讲者这一页怎么讲。
9. 结构建议：cover -> section/bullets 交替 -> （可选 stats / timeline / two-column / quote）-> closing。
10. ${countRule}

## JSON 结构
{
  "title": "演示文稿总标题",
  "subtitle": "副标题/一句话价值主张",
  "slideCount": 10,
  "slides": [
    { "layout": "cover", "title": "主标题", "subtitle": "副标题", "bullets": ["可选亮点"], "notes": "讲者备注" },
    { "layout": "bullets", "title": "页面标题", "bullets": ["要点一", "要点二 **重点**", "要点三"], "notes": "讲者备注" },
    { "layout": "two-column", "title": "对比标题", "columns": [{"heading":"方案 A","items":["...","..."]},{"heading":"方案 B","items":["...","..."]}], "notes": "讲者备注" },
    { "layout": "stats", "title": "关键数据", "stats": [{"value":"3.2x","label":"效率提升"}], "notes": "讲者备注" },
    { "layout": "timeline", "title": "实施路径", "timeline": [{"time":"第 1 阶段","text":"..."}], "notes": "讲者备注" },
    { "layout": "quote", "quote": {"text":"金句内容","author":"出处"}, "notes": "讲者备注" },
    { "layout": "closing", "title": "总结与行动", "subtitle": "...", "bullets": ["..."], "notes": "讲者备注" }
  ]
}

${LAYOUT_DOC}

再次强调：直接以 { 开头，以 } 结尾，中间不能出现任何非 JSON 内容。`;
}

/**
 * 构造用户消息
 * @param {{text:string, slideCount?:number, language?:string, style?:string, title?:string}} input
 */
export function buildUserPrompt(input) {
  const { text, slideCount = 0, title = '' } = input;
  const parts = [];
  if (title.trim()) parts.push(`用户指定的标题（可参考，也可根据内容优化）：${title.trim()}`);
  parts.push(
    slideCount > 0 ? `期望页数：${slideCount} 页。` : '期望页数：由你根据内容量决定。',
  );
  parts.push('以下是需要转化的原始文案（请完整理解后重新组织，不要逐句照抄）：');
  parts.push('"""');
  parts.push(text.trim());
  parts.push('"""');
  parts.push('请输出符合要求的 JSON。');
  return parts.join('\n');
}

/**
 * 组装完整消息数组
 * @param {Object} input
 * @param {string} input.text
 * @param {number} [input.slideCount]
 * @param {string} [input.language]
 * @param {string} [input.style]
 * @param {string} [input.title]
 */
export function buildMessages(input) {
  return [
    { role: 'system', content: buildSystemPrompt(input) },
    { role: 'user', content: buildUserPrompt(input) },
  ];
}

export { LAYOUTS };
