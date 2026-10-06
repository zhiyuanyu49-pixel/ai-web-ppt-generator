/**
 * 独立 HTML 导出
 * ------------------------------------------------------------------
 * 产出一个「零外部依赖」的单文件网页：
 *   - 内联所有 CSS（主题变量 + 幻灯片样式 + 演示外壳样式）
 *   - 内联渲染器与运行时（同一个 shared/slide-render.js，剥离 export 关键字）
 *   - 内嵌完整 deck JSON
 * 双击即可在浏览器打开、全屏演示、键盘翻页、切换主题、打印为 PDF。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSlides } from '../shared/slide-render.js';
import { THEMES, getTheme, themeCssRules } from '../shared/themes.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cache = new Map();
/**
 * 读取共享资源（带缓存）。
 * @param {string} file
 */
function readShared(file) {
  if (!cache.has(file)) {
    cache.set(file, fs.readFileSync(path.join(config.sharedDir, file), 'utf8'));
  }
  return cache.get(file);
}

/**
 * 把 ES module 源码转成可直接内联的脚本：去掉 `export ` 关键字。
 * shared/slide-render.js 保持「零 import、只 export function」的约束，
 * 因此这里可以安全剥离。
 * @param {string} source
 */
export function stripModuleExports(source) {
  return String(source).replace(/^export\s+/gm, '');
}

/** 防止内嵌 JSON 破坏 <script> 标签 */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** HTML 转义（用于 title 等） */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 生成独立 HTML 文件内容。
 * @param {Object} options
 * @param {any} options.deck 已规范化的 deck（含 title/subtitle/slides）
 * @param {string} [options.theme] 主题 id
 * @param {boolean} [options.notes] 是否默认展示讲者备注
 * @param {boolean} [options.anim] 是否启用入场动画
 * @returns {{html:string, filename:string}}
 */
export function buildExportHtml({ deck, theme = 'midnight', notes = false, anim = true }) {
  const safeDeck = deck && typeof deck === 'object' ? deck : { title: '演示文稿', slides: [] };
  const slides = Array.isArray(safeDeck.slides) ? safeDeck.slides : [];
  const brand = safeDeck.title || '';
  const activeTheme = getTheme(theme);

  const slidesHtml = renderSlides(slides, { brand, notes: true });
  const chromeCss = readShared('export-chrome.css');
  const slideCss = readShared('slide.css');
  const rendererSrc = stripModuleExports(readShared('slide-render.js'));
  const runtimeSrc = readShared('export-runtime.js');

  const themePayload = THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    desc: t.desc,
    accent: t.tokens['--accent'],
    bg: t.tokens['--bg'],
  }));

  const title = safeDeck.title || '网页演示文稿';

  return {
    filename: `${sanitizeFilename(title)}.html`,
    html: `<!DOCTYPE html>
<html lang="zh-CN" data-export="ai-web-ppt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="generator" content="AI 网页 PPT 生成器" />
<meta name="description" content="${escapeHtml(safeDeck.subtitle || title)}" />
<title>${escapeHtml(title)}</title>
<style>
/* ---------- 主题变量 ---------- */
${themeCssRules()}

/* ---------- 基础变量 ---------- */
:root {
  --font-sans: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  --font-display: 'Segoe UI Semibold', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  --font-mono: ui-monospace, 'Cascadia Mono', SFMono-Regular, Consolas, monospace;
}

/* ---------- 幻灯片样式 ---------- */
${slideCss}

/* ---------- 演示外壳样式 ---------- */
${chromeCss}
</style>
</head>
<body data-theme="${escapeHtml(activeTheme.id)}"${notes ? ' class="show-notes"' : ''}>
<div class="deck" id="deck" data-anim="${anim ? 'on' : 'off'}">
  <div class="deck__progress"><span id="progress-bar"></span></div>
  <div class="deck__viewport" id="viewport">
    <div class="stage" id="stage" data-inset="false">
${slidesHtml}
    </div>
  </div>

  <div class="deck__hint no-print">← → 翻页 · F 全屏 · O 总览 · T 换主题 · N 备注 · P 打印</div>

  <div class="deck__controls no-print" role="toolbar" aria-label="演示控制">
    <button class="deck__btn" type="button" data-action="prev" aria-label="上一页">‹ <span class="deck__btn__label">上一页</span></button>
    <span class="deck__counter" id="page-counter">1 / ${slides.length}</span>
    <button class="deck__btn" type="button" data-action="next" aria-label="下一页"><span class="deck__btn__label">下一页</span> ›</button>
    <span class="deck__divider" aria-hidden="true"></span>
    <span id="theme-bar" role="group" aria-label="配色主题"></span>
    <span class="deck__divider" aria-hidden="true"></span>
    <button class="deck__btn deck__btn--icon" type="button" data-action="overview" title="总览 (O)" aria-label="总览">▦</button>
    <button class="deck__btn deck__btn--icon" type="button" data-action="notes" title="讲者备注 (N)" aria-label="讲者备注">🗒</button>
    <button class="deck__btn deck__btn--icon" type="button" data-action="print" title="打印 / 导出 PDF (P)" aria-label="打印">🖨</button>
    <button class="deck__btn deck__btn--icon" type="button" data-action="fullscreen" title="全屏 (F)" aria-label="全屏">⛶</button>
  </div>

  <div class="deck__overview" id="overview" hidden>
    <div class="deck__overview-head">
      <h2 class="deck__overview-title">${escapeHtml(title)} · 共 ${slides.length} 页</h2>
      <button class="deck__btn" type="button" data-action="overview">关闭总览 (Esc)</button>
    </div>
    <div class="deck__overview-grid" id="overview-grid"></div>
  </div>
</div>

<script type="module">
/* ================= 渲染器（由 shared/slide-render.js 内联） ================= */
${rendererSrc}

/* ================= 数据 ================= */
const DECK = ${safeJson(safeDeck)};
const THEMES = ${safeJson(themePayload)};

/* ================= 运行时（由 shared/export-runtime.js 内联） ================= */
${runtimeSrc}
</script>
</body>
</html>
`,
  };
}

/**
 * 文件名清洗，避免非法字符。
 * @param {string} name
 */
export function sanitizeFilename(name) {
  const cleaned = String(name || 'presentation')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'presentation';
}
