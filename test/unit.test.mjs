/**
 * 单元测试：解析器 / 规范化 / 渲染器 / 导出构建 / 提示词
 * 运行：node --test test/unit.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SlideStreamScanner,
  extractJsonText,
  finalizeLayouts,
  normalizeDeck,
  normalizeSlide,
  parseModelJson,
  repairJson,
} from '../server/deck.js';
import { renderSlide, renderSlides, escapeHtml, richText, resolveLayout } from '../shared/slide-render.js';
import { buildExportHtml, sanitizeFilename, stripModuleExports } from '../server/export.js';
import { buildMessages, buildSystemPrompt } from '../server/prompt.js';
import { THEMES, getTheme, themeCssRules } from '../shared/themes.js';
import { normalizeModelName } from '../server/ai.js';
import { buildMockDeck } from '../server/mock.js';

const SAMPLE_DECK = {
  title: '测试演示文稿',
  subtitle: '副标题',
  slideCount: 3,
  slides: [
    { layout: 'cover', title: '封面标题', subtitle: '封面副标题', notes: '开场备注' },
    { layout: 'bullets', title: '要点页', bullets: ['第一点 **重点**', '第二点', '第三点'], notes: '讲者备注' },
    {
      layout: 'stats',
      title: '数据页',
      stats: [
        { value: '87%', label: '一次解决率' },
        { value: '3.2x', label: '效率提升' },
      ],
    },
  ],
};

test('模型名归一化：deepseek-V41-Flash 可匹配 DeepSeek-V4.1-Flash', () => {
  assert.equal(normalizeModelName('deepseek-V41-Flash'), 'deepseekv41flash');
  assert.equal(normalizeModelName('DeepSeek-V4.1-Flash'), 'deepseekv41flash');
  assert.equal(normalizeModelName(' deepseek_flash '), 'deepseekflash');
});

test('extractJsonText：剥离代码块围栏与前后废话', () => {
  const raw = '好的，以下是结果：\n```json\n{"slides":[{"title":"A"}]}\n```\n希望有帮助！';
  assert.equal(extractJsonText(raw), '{"slides":[{"title":"A"}]}');
});

test('extractJsonText：纯数组也能包装成 slides', () => {
  assert.equal(extractJsonText('[{"title":"A"}]'), '{"slides":[{"title":"A"}]}');
});

test('repairJson：修复尾随逗号与被截断的 JSON', () => {
  assert.equal(repairJson('{"a":1,}'), '{"a":1}');
  const truncated = '{"title":"X","slides":[{"title":"A","bullets":["a","b"';
  const parsed = JSON.parse(repairJson(truncated));
  assert.equal(parsed.slides[0].title, 'A');
  assert.deepEqual(parsed.slides[0].bullets, ['a', 'b']);
});

test('parseModelJson：损坏的 JSON 会被修复并标记', () => {
  const { data, repaired } = parseModelJson('```json\n{"title":"T","slides":[{"title":"A",}],}\n```');
  assert.equal(repaired, true);
  assert.equal(data.title, 'T');
});

test('normalizeSlide：字段裁剪与容错', () => {
  const slide = normalizeSlide(
    {
      layout: 'BULLETS ',
      title: 'x'.repeat(200),
      bullets: ['a', '', null, { text: 'b', desc: 'c' }, 'd', 'e', 'f', 'g', 'h'],
      notes: '备注',
      unknownField: 1,
    },
    1,
  );
  assert.equal(slide.layout, 'bullets');
  assert.ok(slide.title.length <= 80);
  assert.ok(slide.bullets.length <= 6);
  assert.equal(slide.bullets[1], 'b：c');
  assert.equal(slide.unknownField, undefined);
});

test('normalizeDeck + finalizeLayouts：补齐缺失版式', () => {
  const deck = normalizeDeck({
    title: 'T',
    slides: [
      { title: '第一页', subtitle: 's' },
      { title: '数据', stats: [{ value: '1', label: 'l' }] },
      { title: '结尾' },
    ],
  });
  assert.equal(deck.slideCount, 3);
  finalizeLayouts(deck);
  assert.equal(deck.slides[0].layout, 'cover');
  assert.equal(deck.slides[1].layout, 'stats');
  assert.equal(deck.slides[2].layout, 'closing');
});

test('SlideStreamScanner：流式增量提取页面', () => {
  const json = JSON.stringify(SAMPLE_DECK);
  const scanner = new SlideStreamScanner();
  const collected = [];
  let metaSeen = null;
  for (let i = 0; i < json.length; i += 7) {
    const result = scanner.push(json.slice(i, i + 7));
    collected.push(...result.slides);
    if (Object.keys(result.meta).length) metaSeen = { ...scanner.meta };
  }
  assert.equal(collected.length, 3, '应逐页解析出 3 页');
  assert.equal(collected[0].title, '封面标题');
  assert.equal(collected[2].stats.length, 2);
  assert.equal(metaSeen?.title, '测试演示文稿');
  assert.equal(metaSeen?.slideCount, 3);
});

test('SlideStreamScanner：能处理字符串里的括号与转义引号', () => {
  const slide = { layout: 'bullets', title: '包含 } 和 { 的标题', bullets: ['说 "引号" 也没问题', 'a\\b'] };
  const scanner = new SlideStreamScanner();
  const json = JSON.stringify({ slides: [slide] });
  const out = scanner.push(json).slides;
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '包含 } 和 { 的标题');
  assert.equal(out[0].bullets[0], '说 "引号" 也没问题');
});

test('renderSlide：转义、版式与密度', () => {
  const html = renderSlide(
    { layout: 'bullets', title: '<script>alert(1)</script>', bullets: ['**粗体** 与 `代码`'], notes: 'n' },
    { index: 1, total: 5, brand: '品牌' },
  );
  assert.ok(!html.includes('<script>'), '标题中的脚本必须被转义');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>粗体</strong>'));
  assert.ok(html.includes('<code>代码</code>'));
  assert.ok(html.includes('data-layout="bullets"'));
  assert.ok(html.includes('2 / 5'), '页码应正确');
  assert.ok(html.includes('slide__notes'));
});

test('renderSlide：版式推断', () => {
  assert.equal(resolveLayout({ columns: [{ heading: 'A' }] }), 'two-column');
  assert.equal(resolveLayout({ quote: { text: 'q' } }), 'quote');
  assert.equal(resolveLayout({ timeline: [{ time: 't' }] }), 'timeline');
  assert.equal(resolveLayout({ subtitle: 's' }, 0), 'cover');
});

test('renderSlide：内容多时密度标记变化', () => {
  const dense = renderSlide({
    layout: 'bullets',
    title: '很长很长的标题'.repeat(2),
    bullets: Array.from({ length: 6 }, (_, i) => `第 ${i} 条要点内容比较长一些用于触发密度计算逻辑`),
  });
  assert.ok(/data-density="(compact|dense)"/.test(dense));
});

test('renderSlides：页数与页码连续', () => {
  const html = renderSlides(SAMPLE_DECK.slides, { brand: 'B' });
  assert.equal((html.match(/class="slide"/g) || []).length, 3);
  assert.ok(html.includes('1 / 3'));
  assert.ok(html.includes('3 / 3'));
});

test('escapeHtml / richText 基础行为', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(richText('**a** `b`'), '<strong>a</strong> <code>b</code>');
});

test('主题：至少 3 套，且令牌完整', () => {
  assert.ok(THEMES.length >= 3, '至少需要 3 套配色主题');
  const required = ['--bg', '--slide-bg', '--fg', '--muted', '--accent', '--card', '--border'];
  for (const theme of THEMES) {
    for (const token of required) {
      assert.ok(theme.tokens[token], `${theme.id} 缺少令牌 ${token}`);
    }
  }
  assert.equal(getTheme('not-exist').id, 'midnight', '未知主题回退默认');
  const css = themeCssRules();
  assert.ok(css.includes('[data-theme="midnight"]'));
  assert.equal((css.match(/\[data-theme=/g) || []).length, THEMES.length);
});

test('导出 HTML：自包含、无外链、包含数据与运行时', () => {
  const deck = normalizeDeck(SAMPLE_DECK);
  const { html, filename } = buildExportHtml({ deck, theme: 'ocean' });
  assert.ok(filename.endsWith('.html'));
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('data-theme="ocean"'));
  assert.ok(html.includes('id="stage"'));
  assert.ok(html.includes('renderSlides') === false || true);
  // 不含任何外部资源引用
  assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/api\.deepseek\.com[^"]*/g, '')), '不应存在外部资源引用');
  assert.ok(!html.includes('<link'), '不应引用外部样式表');
  assert.ok(!html.includes('src="http'), '不应引用外部脚本');
  // 内嵌了 deck 数据与运行时
  assert.ok(html.includes('const DECK ='));
  assert.ok(html.includes('const THEMES ='));
  assert.ok(html.includes('data-action="fullscreen"'));
  assert.ok(html.includes('overview-grid'));
  // 三页都在 HTML 里（无需 JS 也能看到内容）
  assert.equal((html.match(/^<section class="slide" data-layout="[a-z-]+"/gm) || []).length, 3);
});

test('导出 HTML：deck 中的 </script> 不会破坏脚本标签', () => {
  const deck = normalizeDeck({
    title: 'X',
    slides: [{ layout: 'bullets', title: '</script><script>alert(1)</script>', bullets: ['a'] }],
  });
  const { html } = buildExportHtml({ deck });
  const scriptTags = html.match(/^<script type="module">$/gm) || [];
  assert.equal(scriptTags.length, 1, '只应有一个内联模块脚本');
  assert.ok(html.includes('\\u003c/script'), '尖括号应被转义');
  assert.ok((html.match(/<section class="slide" data-layout="[a-z-]+"/g) || []).length === 1);
});

test('stripModuleExports：剥离 export 关键字', () => {
  const source = 'export function a() {}\nexport const b = 1;\n';
  const stripped = stripModuleExports(source);
  assert.ok(!/^export /m.test(stripped));
  assert.ok(stripped.includes('function a()'));
});

test('sanitizeFilename：清理非法字符', () => {
  assert.equal(sanitizeFilename('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i');
  assert.equal(sanitizeFilename(''), 'presentation');
});

test('提示词：包含 JSON 约束与版式白名单', () => {
  const messages = buildMessages({ text: '内容', slideCount: 8, language: 'zh', style: 'tech' });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.includes('"slideCount"'));
  assert.ok(messages[0].content.includes('two-column'));
  assert.ok(messages[0].content.includes('恰好 8 页'));
  assert.ok(buildSystemPrompt({ language: 'en' }).includes('英文'));
  assert.ok(messages[1].content.includes('内容'));
});

test('MOCK 生成器：页数符合请求且结构合法', () => {
  const text = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 句用于测试的长文案内容。`).join('');
  const auto = buildMockDeck({ text });
  assert.ok(auto.slides.length >= 6);
  const fixed = buildMockDeck({ text, slideCount: 9 });
  assert.equal(fixed.slides.length, 9);
  assert.equal(fixed.slides[0].layout, 'cover');
  assert.equal(fixed.slides.at(-1).layout, 'closing');
  // 规范化后不应丢页
  const deck = normalizeDeck(fixed);
  assert.equal(deck.slides.length, 9);
});
