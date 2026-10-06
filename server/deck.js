/**
 * 模型输出解析与规范化
 * ------------------------------------------------------------------
 * 包含三件事：
 *   1. 宽松 JSON 提取（去掉代码块围栏、前后废话）
 *   2. 截断/脏数据的修复与解析
 *   3. 流式增量扫描：每完成一个 slide 对象就立刻抛给前端（实时渲染进度）
 */
import { LAYOUTS, toStringList } from '../shared/slide-render.js';

/** 单个字段长度上限，避免模型啰嗦导致溢出 */
const LIMITS = {
  title: 80,
  subtitle: 200,
  bullet: 200,
  bullets: 6,
  columns: 3,
  columnItems: 6,
  stats: 4,
  timeline: 6,
  notes: 500,
};

/**
 * 截断字符串。
 * @param {unknown} value
 * @param {number} max
 */
function clampText(value, max) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\s+/g, ' ').trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * 从模型原始输出中提取 JSON 文本。
 * @param {string} raw
 * @returns {string}
 */
export function extractJsonText(raw) {
  let text = String(raw || '').trim();
  // 去掉 ```json ... ``` 围栏
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // 去掉常见前后缀
  text = text.replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
  // 若整体是数组，包成 slides 结构
  if (text.startsWith('[')) text = `{"slides":${text}}`;
  return text;
}

/**
 * 修复常见 JSON 问题：尾随逗号、被截断的括号/字符串。
 * @param {string} text
 * @returns {string}
 */
export function repairJson(text) {
  let out = text;
  // 去掉对象/数组中的尾随逗号
  out = out.replace(/,\s*([}\]])/g, '$1');

  // 扫描状态，补齐未闭合的字符串与括号
  let inString = false;
  let escaped = false;
  const stack = [];
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) out += '"';
  // 截断时可能停在 "key": 或 "key":  之后，补一个 null
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  while (stack.length) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }
  return out;
}

/**
 * 解析模型输出的 JSON（先直接解析，失败则修复后重试）。
 * @param {string} raw
 * @returns {{data:any, repaired:boolean}}
 */
export function parseModelJson(raw) {
  const text = extractJsonText(raw);
  try {
    return { data: JSON.parse(text), repaired: false };
  } catch (error) {
    try {
      return { data: JSON.parse(repairJson(text)), repaired: true };
    } catch {
      throw new Error(`无法解析模型返回的 JSON：${error?.message || error}`);
    }
  }
}

/**
 * 规范化单页。
 * @param {Record<string, any>} raw
 * @param {number} index
 */
export function normalizeSlide(raw, index = 0) {
  const slide = raw && typeof raw === 'object' ? raw : {};
  const declared = typeof slide.layout === 'string' ? slide.layout.trim().toLowerCase() : '';
  const bullets = toStringList(slide.bullets, LIMITS.bullets).map((b) => clampText(b, LIMITS.bullet));

  /** @type {Record<string, any>} */
  const out = {
    layout: LAYOUTS.includes(declared) ? declared : '',
    title: clampText(slide.title ?? slide.heading ?? '', LIMITS.title),
    subtitle: clampText(slide.subtitle ?? slide.sub ?? '', LIMITS.subtitle),
    notes: clampText(slide.notes ?? slide.note ?? slide.speakerNotes ?? '', LIMITS.notes),
  };
  if (slide.eyebrow) out.eyebrow = clampText(slide.eyebrow, 40);
  if (bullets.length) out.bullets = bullets;

  if (Array.isArray(slide.columns) && slide.columns.length) {
    out.columns = slide.columns.slice(0, LIMITS.columns).map((col) => ({
      heading: clampText(col?.heading ?? col?.title ?? '', LIMITS.title),
      items: toStringList(col?.items ?? col?.bullets ?? col?.points, LIMITS.columnItems).map((i) =>
        clampText(i, LIMITS.bullet),
      ),
    }));
  }

  if (Array.isArray(slide.stats) && slide.stats.length) {
    out.stats = slide.stats.slice(0, LIMITS.stats).map((s) => ({
      value: clampText(s?.value ?? s?.number ?? '', 24),
      label: clampText(s?.label ?? s?.name ?? s?.text ?? '', 60),
    }));
  }

  if (Array.isArray(slide.timeline) && slide.timeline.length) {
    out.timeline = slide.timeline.slice(0, LIMITS.timeline).map((t) => ({
      time: clampText(t?.time ?? t?.date ?? t?.step ?? '', 40),
      text: clampText(t?.text ?? t?.title ?? t?.desc ?? '', LIMITS.bullet),
    }));
  }

  const quote = slide.quote;
  if (quote) {
    out.quote =
      typeof quote === 'string'
        ? { text: clampText(quote, LIMITS.subtitle), author: '' }
        : { text: clampText(quote.text ?? '', LIMITS.subtitle), author: clampText(quote.author ?? '', 60) };
  }

  if (!out.layout) {
    // 留给渲染器推断，这里只保证不出现非法值
    delete out.layout;
  }
  if (index === 0 && !out.layout && (out.subtitle || out.bullets)) out.layout = 'cover';
  return out;
}

/**
 * 规范化整份演示文稿。
 * @param {any} data
 * @param {{maxSlides?:number, fallbackTitle?:string}} [options]
 */
export function normalizeDeck(data, options = {}) {
  const { maxSlides = 30, fallbackTitle = '未命名演示文稿' } = options;
  const source = Array.isArray(data) ? { slides: data } : data && typeof data === 'object' ? data : {};
  const rawSlides = Array.isArray(source.slides)
    ? source.slides
    : Array.isArray(source.pages)
      ? source.pages
      : [];

  const slides = rawSlides
    .filter((s) => s && typeof s === 'object')
    .slice(0, maxSlides)
    .map((s, i) => normalizeSlide(s, i))
    // 过滤掉完全空白的页
    .filter((s) => s.title || s.bullets?.length || s.stats?.length || s.timeline?.length || s.quote?.text || s.columns?.length);

  const title = clampText(source.title ?? source.name ?? fallbackTitle, LIMITS.title) || fallbackTitle;
  return {
    title,
    subtitle: clampText(source.subtitle ?? source.description ?? '', LIMITS.subtitle),
    slideCount: slides.length,
    slides,
    meta: {
      generatedAt: new Date().toISOString(),
      declaredSlideCount: Number(source.slideCount) || slides.length,
    },
  };
}

/**
 * 若模型没写 layout，按内容推断，保证前端和导出一致。
 * @param {Record<string, any>} slide
 * @param {number} index
 * @param {number} total
 */
export function finalizeLayouts(deck) {
  const total = deck.slides.length;
  deck.slides = deck.slides.map((slide, index) => {
    if (slide.layout) return slide;
    const layout = inferLayout(slide, index, total);
    return { ...slide, layout };
  });
  return deck;
}

/**
 * @param {Record<string, any>} slide
 * @param {number} index
 * @param {number} total
 */
function inferLayout(slide, index, total) {
  if (slide.quote?.text) return 'quote';
  if (slide.stats?.length) return 'stats';
  if (slide.timeline?.length) return 'timeline';
  if (slide.columns?.length) return 'two-column';
  if (index === 0) return 'cover';
  if (index === total - 1 && !slide.bullets?.length) return 'closing';
  if (slide.bullets?.length) return 'bullets';
  return 'section';
}

/**
 * 流式增量扫描器：从模型输出的 JSON 文本流里，逐个提取已完成的 slide。
 *
 * 原理：定位 `"slides"` 后的 `[`，然后逐字符扫描并维护「字符串/转义/花括号深度」
 * 状态；当某个顶层对象闭合时，取出该片段并 JSON.parse 成 slide。
 */
export class SlideStreamScanner {
  constructor() {
    /** @type {string} */
    this.buffer = '';
    this.pos = 0;
    this.started = false;
    this.finished = false;
    this.depth = 0;
    this.objStart = -1;
    this.inString = false;
    this.escaped = false;
    /** @type {object[]} */
    this.slides = [];
    /** 顶层元信息（title/subtitle/slideCount），尽可能早地给前端 */
    this.meta = {};
  }

  /**
   * 喂入新的文本片段，返回本次新完成的 slide 数组。
   * @param {string} chunk
   * @returns {{slides:object[], meta:object}}
   */
  push(chunk) {
    this.buffer += chunk;
    /** @type {object[]} */
    const found = [];
    let metaChanged = false;

    if (!this.started) {
      const key = this.buffer.indexOf('"slides"');
      if (key === -1) {
        // 还没到 slides 字段，先尝试从已到达的文本里嗅探 title/subtitle/slideCount
        metaChanged = this.sniffMeta();
        return { slides: found, meta: metaChanged ? { ...this.meta } : {} };
      }
      const bracket = this.buffer.indexOf('[', key);
      if (bracket === -1) return { slides: found, meta: {} };
      this.started = true;
      this.pos = bracket + 1;
      metaChanged = this.sniffMeta();
    }

    for (let i = this.pos; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === '\\') this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') {
        this.inString = true;
        continue;
      }
      if (ch === '{') {
        if (this.depth === 0) this.objStart = i;
        this.depth += 1;
        continue;
      }
      if (ch === '}') {
        this.depth -= 1;
        if (this.depth === 0 && this.objStart >= 0) {
          const slice = this.buffer.slice(this.objStart, i + 1);
          try {
            const parsed = JSON.parse(repairJson(slice));
            const slide = normalizeSlide(parsed, this.slides.length);
            this.slides.push(slide);
            found.push(slide);
          } catch {
            // 忽略单页解析失败，最终还有整体解析兜底
          }
          this.objStart = -1;
        }
        continue;
      }
      if (ch === ']' && this.depth === 0 && this.objStart === -1) {
        // slides 数组结束
        this.finished = true;
        this.pos = i + 1;
        return { slides: found, meta: metaChanged ? { ...this.meta } : {} };
      }
    }
    this.pos = this.buffer.length;
    return { slides: found, meta: metaChanged ? { ...this.meta } : {} };
  }

  /** 从尚未完成的文本里嗅探顶层标题等元信息 */
  sniffMeta() {
    let changed = false;
    const patterns = [
      ['title', /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/],
      ['subtitle', /"subtitle"\s*:\s*"((?:[^"\\]|\\.)*)"/],
      ['slideCount', /"slideCount"\s*:\s*(\d+)/],
    ];
    for (const [key, re] of patterns) {
      const m = this.buffer.match(re);
      if (!m) continue;
      let value = m[1];
      if (key === 'slideCount') value = Number(value);
      else {
        try {
          value = JSON.parse(`"${value}"`);
        } catch {
          /* 保留原值 */
        }
      }
      if (this.meta[key] !== value) {
        this.meta[key] = value;
        changed = true;
      }
    }
    return changed;
  }
}
