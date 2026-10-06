/**
 * 幻灯片渲染器（前后端共用，纯函数，无任何 import）
 * ------------------------------------------------------------------
 * ⚠️ 约束：本文件必须保持「零 import / 零依赖」并且只使用 `export function`
 * 声明，因为导出独立 HTML 时会把源码内联进 <script type="module">，
 * 只做 `export ` 关键字剥离（见 server/export.js）。
 *
 * 站内（React 用 dangerouslySetInnerHTML）与导出 HTML 使用同一个渲染函数，
 * 保证「所见即所得」。
 */

/** 支持的版式 */
export const LAYOUTS = [
  'cover',
  'section',
  'bullets',
  'two-column',
  'stats',
  'timeline',
  'quote',
  'closing',
];

/**
 * HTML 转义，防止模型输出或用户文案破坏结构。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 轻量富文本：支持 **加粗** 与 `行内代码`（先转义再替换，安全）。
 * @param {unknown} value
 * @returns {string}
 */
export function richText(value) {
  let out = escapeHtml(value);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

/**
 * 取字符串数组，过滤空值并限制条数。
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string[]}
 */
export function toStringList(value, max = 8) {
  if (!Array.isArray(value)) return [];
  const list = value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        // 容错：模型偶尔会输出 {text: "..."} / {title: "..."}
        const t = item.text ?? item.title ?? item.label ?? item.value ?? '';
        const extra = item.desc ?? item.description ?? item.detail ?? '';
        return String(t + (extra ? `：${extra}` : '')).trim();
      }
      return String(item ?? '').trim();
    })
    .filter(Boolean);
  return list.slice(0, max);
}

/**
 * 推断版式（模型没给或给错时兜底）。
 * @param {Record<string, any>} slide
 * @param {number} index
 * @returns {string}
 */
export function resolveLayout(slide, index = 0) {
  const declared = typeof slide?.layout === 'string' ? slide.layout.trim().toLowerCase() : '';
  if (LAYOUTS.includes(declared)) return declared;
  if (slide?.quote && (slide.quote.text || typeof slide.quote === 'string')) return 'quote';
  if (Array.isArray(slide?.stats) && slide.stats.length) return 'stats';
  if (Array.isArray(slide?.timeline) && slide.timeline.length) return 'timeline';
  if (Array.isArray(slide?.columns) && slide.columns.length) return 'two-column';
  if (toStringList(slide?.bullets).length) return 'bullets';
  if (index === 0 && (slide?.subtitle || slide?.meta)) return 'cover';
  return 'section';
}

/**
 * 计算内容密度，供 CSS 自适应字号。
 * @param {Record<string, any>} slide
 * @param {string} layout
 * @returns {'normal'|'compact'|'dense'}
 */
export function resolveDensity(slide, layout) {
  const bullets = toStringList(slide?.bullets, 99);
  const columns = Array.isArray(slide?.columns) ? slide.columns : [];
  let units = bullets.length;
  let chars = (String(slide?.title || '') + String(slide?.subtitle || '')).length;
  for (const b of bullets) chars += b.length;
  for (const col of columns) {
    const items = toStringList(col?.items, 99);
    units += items.length / 2;
    for (const it of items) chars += it.length;
    chars += String(col?.heading || '').length;
  }
  if (Array.isArray(slide?.stats)) units += slide.stats.length * 0.5;
  if (Array.isArray(slide?.timeline)) units += slide.timeline.length * 0.6;
  if (layout === 'quote') {
    chars = String(slide?.quote?.text || slide?.quote || '').length;
    units = 1;
  }
  const score = units + chars / 55;
  if (score >= 7.5) return 'dense';
  if (score >= 4.5) return 'compact';
  return 'normal';
}

/**
 * @typedef {Object} RenderOptions
 * @property {number} [index] 0 基序号
 * @property {number} [total] 总页数
 * @property {string} [brand] 页脚品牌/标题
 * @property {boolean} [notes] 是否渲染讲者备注（默认渲染，导出端用 CSS 控制显隐）
 */

/**
 * 渲染单页幻灯片为 HTML 字符串。
 * @param {Record<string, any>} rawSlide
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function renderSlide(rawSlide, options = {}) {
  const slide = rawSlide && typeof rawSlide === 'object' ? rawSlide : {};
  const index = Number.isFinite(options.index) ? options.index : 0;
  const total = Number.isFinite(options.total) ? options.total : 0;
  const brand = options.brand || '';
  const layout = resolveLayout(slide, index);
  const density = resolveDensity(slide, layout);

  const title = slide.title ?? slide.heading ?? '';
  const subtitle = slide.subtitle ?? slide.sub ?? '';
  const bullets = toStringList(slide.bullets);
  const columns = Array.isArray(slide.columns) ? slide.columns.slice(0, 3) : [];
  const stats = Array.isArray(slide.stats) ? slide.stats.slice(0, 4) : [];
  const timeline = Array.isArray(slide.timeline) ? slide.timeline.slice(0, 6) : [];
  const quote = slide.quote && typeof slide.quote === 'object' ? slide.quote : { text: slide.quote || '' };
  const notes = typeof slide.notes === 'string' ? slide.notes.trim() : '';

  const head = [];
  if (slide.eyebrow) {
    head.push(`<p class="slide__eyebrow">${richText(slide.eyebrow)}</p>`);
  }
  if (title) {
    const tag = layout === 'cover' || layout === 'closing' ? 'h1' : 'h2';
    head.push(`<${tag} class="slide__title">${richText(title)}</${tag}>`);
  }
  if (subtitle) head.push(`<p class="slide__subtitle">${richText(subtitle)}</p>`);

  let body = '';
  if (layout === 'bullets' || layout === 'cover' || layout === 'closing' || layout === 'section') {
    if (bullets.length) {
      body = `<ul class="slide__bullets">${bullets
        .map((b, i) => `<li style="--i:${i}">${richText(b)}</li>`)
        .join('')}</ul>`;
    }
  } else if (layout === 'two-column') {
    body = `<div class="slide__columns">${columns
      .map((col) => {
        const items = toStringList(col?.items ?? col?.bullets ?? col?.points, 6);
        return `<div class="slide__column">
        ${col?.heading ? `<h3 class="slide__column-title">${richText(col.heading)}</h3>` : ''}
        <ul class="slide__bullets">${items.map((it, i) => `<li style="--i:${i}">${richText(it)}</li>`).join('')}</ul>
      </div>`;
      })
      .join('')}</div>`;
  } else if (layout === 'stats') {
    body = `<div class="slide__stats">${stats
      .map(
        (s) => `<div class="slide__stat">
        <div class="slide__stat-value">${richText(s?.value ?? '')}</div>
        <div class="slide__stat-label">${richText(s?.label ?? s?.name ?? '')}</div>
      </div>`,
      )
      .join('')}</div>`;
  } else if (layout === 'timeline') {
    body = `<ol class="slide__timeline">${timeline
      .map(
        (t) => `<li class="slide__timeline-item">
        <span class="slide__timeline-dot" aria-hidden="true"></span>
        <div class="slide__timeline-time">${richText(t?.time ?? t?.date ?? '')}</div>
        <div class="slide__timeline-text">${richText(t?.text ?? t?.title ?? '')}</div>
      </li>`,
      )
      .join('')}</ol>`;
  } else if (layout === 'quote') {
    body = `<blockquote class="slide__quote">
      <p class="slide__quote-text">${richText(quote?.text ?? quote ?? '')}</p>
      ${quote?.author ? `<footer class="slide__quote-author">—— ${richText(quote.author)}</footer>` : ''}
    </blockquote>`;
  }

  const footerBits = [];
  if (brand) footerBits.push(`<span class="slide__brand">${escapeHtml(brand)}</span>`);
  footerBits.push(`<span class="slide__page">${total ? `${index + 1} / ${total}` : `${index + 1}`}</span>`);

  return `<section class="slide" data-layout="${layout}" data-density="${density}" data-index="${index}" aria-label="${escapeHtml(
    String(title || `第 ${index + 1} 页`),
  )}">
  ${
    head.length
      ? `<header class="slide__head">
    ${head.join('\n    ')}
  </header>`
      : ''
  }
  ${body ? `<div class="slide__body">${body}</div>` : ''}
  <footer class="slide__foot">${footerBits.join('')}</footer>
  ${notes ? `<aside class="slide__notes"><span class="slide__notes-tag">讲者备注</span>${richText(notes)}</aside>` : ''}
</section>`;
}

/**
 * 批量渲染。
 * @param {Array<Record<string, any>>} slides
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function renderSlides(slides, options = {}) {
  const list = Array.isArray(slides) ? slides : [];
  return list.map((s, i) => renderSlide(s, { ...options, index: i, total: list.length })).join('\n');
}

/** 模板骨架 */
export const LAYOUT_TEMPLATES = LAYOUTS;
