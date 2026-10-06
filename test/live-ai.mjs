/**
 * 真实大模型链路验证（会消耗少量额度）
 * 运行：node test/live-ai.mjs
 * 验证内容：模型 id 解析 -> 流式输出 -> 增量解析 -> 最终 deck
 */
import { config } from '../server/config.js';
import { resolveModel } from '../server/ai.js';
import { generateDeck } from '../server/generate.js';

const TEXT = `企业知识库智能问答系统建设方案

背景：公司内部文档分散在网盘、邮件与工单系统中，新员工平均需要两周才能找到关键流程说明，客服团队每天约 30% 的时间花在重复查询已有资料上。

建设目标：用检索增强生成（RAG）方式搭建统一的智能问答入口，把分散文档接入统一检索层；回答必须给出引用来源；无法回答时明确提示并转人工。

技术方案：文档解析层支持 PDF、Word、Markdown 与网页快照，统一切成 500 字左右的片段并保留标题层级；向量检索使用混合检索（关键词 BM25 加向量相似度），召回前 20 条后重排取前 5 条；生成层使用大模型，并在提示词中强制要求引用编号；所有问答记录写入审计表，保留 180 天。

实施计划：第一期 6 周完成文档接入与检索链路，选取客服与人力两个场景试点，评测集 200 条；第二期 4 周接入企业微信与内部搜索入口，加入权限过滤与敏感信息脱敏；第三期上线运营看板，跟踪一次解决率、引用准确率与人工转接率。

风险与对策：权限越权风险通过检索层权限过滤和答案溯源缓解；幻觉风险通过引用必填与低置信度转人工缓解；成本风险通过缓存高频问题与限制上下文长度缓解。`;

const events = [];
const started = Date.now();

console.log('base_url :', config.baseUrl);
console.log('请求模型 :', config.model);
console.log('模式     :', config.mock ? 'MOCK' : '真实调用');
console.log('');

const resolved = await resolveModel();
console.log('模型解析 :', JSON.stringify(resolved));
console.log('');

const { deck, elapsedMs, repaired, usage } = await generateDeck(
  { text: TEXT, slideCount: 0, language: 'zh', style: 'business' },
  (event, data) => {
    events.push(event);
    if (event === 'status') console.log(`  [status] ${data.phase} — ${data.message}`);
    if (event === 'slide') console.log(`  [slide ${data.index + 1}] ${data.slide.layout || '?'} · ${data.slide.title || ''}`);
    if (event === 'thinking') process.stdout.write('.');
    if (event === 'error') console.log('  [error]', data.message);
  },
);

const counts = events.reduce((acc, name) => ({ ...acc, [name]: (acc[name] || 0) + 1 }), {});
console.log('');
console.log('事件统计 :', JSON.stringify(counts));
console.log('耗时     :', elapsedMs, 'ms');
console.log('usage    :', JSON.stringify(usage));
console.log('JSON 修复:', repaired);
console.log('');
console.log('=== 生成结果 ===');
console.log('标题:', deck.title);
console.log('副标题:', deck.subtitle);
console.log('页数:', deck.slides.length);
for (const [i, slide] of deck.slides.entries()) {
  console.log(
    `  ${String(i + 1).padStart(2)}. [${(slide.layout || '?').padEnd(10)}] ${slide.title || '(无标题)'}${
      slide.bullets?.length ? ` · ${slide.bullets.length} 条要点` : ''
    }${slide.stats?.length ? ` · ${slide.stats.length} 项数据` : ''}${
      slide.timeline?.length ? ` · ${slide.timeline.length} 项时间线` : ''
    }${slide.columns?.length ? ` · ${slide.columns.length} 栏` : ''}${slide.quote ? ' · 引用' : ''}`,
  );
  console.log(`      备注: ${(slide.notes || '').slice(0, 60)}${(slide.notes || '').length > 60 ? '…' : ''}`);
}

// 断言
const problems = [];
if (deck.slides.length < 4) problems.push(`页数过少：${deck.slides.length}`);
if (!deck.title) problems.push('缺少标题');
if (!events.includes('token')) problems.push('没有流式 token 事件');
if (!events.includes('slide')) problems.push('没有增量 slide 事件');
if (counts.token < 50) problems.push(`token 事件过少：${counts.token}`);
const layouts = deck.slides.map((s) => s.layout);
if (!layouts.includes('cover')) problems.push('缺少封面页');
if (deck.slides.some((s) => !s.title && !s.quote?.text)) problems.push('存在无标题页');
if (deck.slides.some((s) => !s.notes)) problems.push('存在缺少讲者备注的页面');

if (problems.length) {
  console.error('\n❌ 校验未通过：');
  for (const p of problems) console.error('   -', p);
  process.exit(1);
}
console.log(`\n✅ 真实链路验证通过（${deck.slides.length} 页，${Date.now() - started}ms）`);
