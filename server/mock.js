/**
 * 本地模拟模型（MOCK_AI=1）
 * ------------------------------------------------------------------
 * 用途：自动化测试与离线演示。把用户文案按句子切分，套进合规的 JSON 结构，
 * 再以「逐 token」的方式流式吐出来，行为与真实模型一致（含 SSE 事件节奏）。
 */

/**
 * 按句子切分长文案。
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 1);
}

/**
 * 根据输入构造一份演示文稿结构。
 * @param {{text:string, slideCount?:number, title?:string}} input
 */
export function buildMockDeck(input) {
  const { text, slideCount = 0, title = '' } = input;
  const sentences = splitSentences(text);
  const firstLine = (String(text).split('\n').find((l) => l.trim()) || 'AI 网页 PPT').trim();
  const docTitle = title.trim() || firstLine.slice(0, 40);
  const wanted = slideCount > 0 ? slideCount : Math.min(12, Math.max(6, Math.ceil(sentences.length / 3) + 2));

  /** @type {any[]} */
  const slides = [];
  slides.push({
    layout: 'cover',
    eyebrow: 'AI GENERATED DECK',
    title: docTitle,
    subtitle: sentences[0]?.slice(0, 60) || '由长文案自动生成的网页演示文稿',
    bullets: ['全屏演示 · 键盘翻页', '多套配色主题 · 一键切换', '导出独立 HTML · 随处分享'],
    notes: '开场用一句话说明这次分享要解决什么问题，让听众建立预期。',
  });

  const bodySentences = sentences.slice(1);
  const perSlide = 4;
  const bodySlideCount = Math.max(1, wanted - 2);
  for (let i = 0; i < bodySlideCount; i += 1) {
    const chunk = bodySentences.slice(i * perSlide, i * perSlide + perSlide);
    if (!chunk.length) break;
    const isStats = i === 1 && bodySentences.length > 6;
    const isTimeline = i === 2 && bodySentences.length > 9;
    if (isStats) {
      slides.push({
        layout: 'stats',
        title: `关键数据（第 ${i} 组）`,
        stats: chunk.slice(0, 3).map((c, idx) => ({
          value: `${(idx + 1) * 32}%`,
          label: c.slice(0, 14),
        })),
        notes: '数据页要放慢语速，逐个指标解释口径与来源。',
      });
    } else if (isTimeline) {
      slides.push({
        layout: 'timeline',
        title: '推进路径',
        timeline: chunk.slice(0, 4).map((c, idx) => ({
          time: `第 ${idx + 1} 阶段`,
          text: c.slice(0, 30),
        })),
        notes: '按阶段讲清里程碑与责任人，避免平均用力。',
      });
    } else {
      slides.push({
        layout: 'bullets',
        title: chunk[0].slice(0, 22) || `要点 ${i + 1}`,
        bullets: chunk.map((c) => c.slice(0, 40)),
        notes: '这一页聚焦结论，先给观点再给支撑论据。',
      });
    }
  }

  slides.push({
    layout: 'closing',
    title: '总结与下一步',
    subtitle: '把上面的结论落到一个明确的行动上。',
    bullets: ['回顾核心结论', '明确责任人与时间点', '约定复盘节点'],
    notes: '结尾给出清晰的行动号召，并留出提问时间。',
  });

  if (slideCount > 0) {
    // 严格满足用户页数要求
    while (slides.length > slideCount) slides.pop();
    let i = 1;
    while (slides.length < slideCount) {
      slides.splice(slides.length - 1, 0, {
        layout: 'bullets',
        title: `补充要点 ${i}`,
        bullets: [`第 ${i} 条补充说明`, '结合原文进一步展开', '保持每页一个核心观点'],
        notes: '补充页用于展开细节，可按现场时间取舍。',
      });
      i += 1;
    }
  }

  return {
    title: docTitle,
    subtitle: '由长文案自动生成的演讲型演示文稿',
    slideCount: slides.length,
    slides,
  };
}

/**
 * 以流式片段的形式产出 JSON 文本（模拟真实模型的 token 流）。
 * @param {string} json
 * @param {{chunkSize?:number, delayMs?:number, signal?:AbortSignal}} [options]
 * @returns {AsyncGenerator<string>}
 */
export async function* streamMockJson(json, options = {}) {
  const { chunkSize = 22, delayMs = 6, signal } = options;
  for (let i = 0; i < json.length; i += chunkSize) {
    if (signal?.aborted) throw new Error('已取消');
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield json.slice(i, i + chunkSize);
  }
}
