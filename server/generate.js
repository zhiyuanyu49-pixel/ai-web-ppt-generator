/**
 * 生成编排：把「用户文案 -> 流式大模型输出 -> 增量 slide 事件 -> 完整 deck」
 * 串成一条流水线，通过 emit(event, data) 回调把进度实时推给前端。
 */
import { config } from './config.js';
import { resolveModel, streamChat } from './ai.js';
import { buildMessages } from './prompt.js';
import { buildMockDeck, streamMockJson } from './mock.js';
import {
  SlideStreamScanner,
  finalizeLayouts,
  normalizeDeck,
  parseModelJson,
} from './deck.js';

/**
 * @typedef {(event:string, data:any) => void} Emit
 */

/**
 * 生成演示文稿。
 *
 * 事件序列：
 *   meta      {requestedModel,resolvedModel,matchedBy,mock,slidesExpected}
 *   status    {phase,message}
 *   thinking  {text}                     模型的思维链增量（若模型返回）
 *   token     {text}                     JSON 文本增量
 *   progress  {slidesDone,slidesExpected,chars,elapsedMs}
 *   slide     {index,slide}              单页完成（前端可立即渲染）
 *   usage     {prompt_tokens,completion_tokens,total_tokens}
 *   deck      {deck}                     最终结果
 *   done      {elapsedMs,repaired}
 *   error     {message}
 *
 * @param {{text:string, slideCount?:number, language?:string, style?:string, title?:string}} input
 * @param {Emit} emit
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{deck:any, elapsedMs:number, repaired:boolean, usage:any}>}
 */
export async function generateDeck(input, emit, options = {}) {
  const { signal } = options;
  const startedAt = Date.now();
  const text = String(input.text || '').slice(0, config.maxInputChars);
  const slideCount = Number(input.slideCount) || 0;
  const slidesExpected = slideCount > 0 ? slideCount : 0;

  emit('status', {
    phase: 'preparing',
    message: config.mock ? '正在使用本地模拟模型生成…' : '正在准备提示词并连接大模型…',
  });

  const scanner = new SlideStreamScanner();
  let chars = 0;
  let tokenCount = 0;
  let lastProgressAt = 0;
  let slidesDone = 0;

  /** 统一的增量处理 */
  const consume = (piece) => {
    chars += piece.length;
    tokenCount += 1;
    emit('token', { text: piece });
    const { slides, meta } = scanner.push(piece);
    if (meta && Object.keys(meta).length) {
      emit('meta', { ...meta, slidesExpected: meta.slideCount || slidesExpected });
    }
    for (const slide of slides) {
      slidesDone += 1;
      emit('slide', { index: slidesDone - 1, slide });
    }
    const now = Date.now();
    if (slides.length || now - lastProgressAt > 240) {
      lastProgressAt = now;
      emit('progress', {
        slidesDone,
        slidesExpected: scanner.meta.slideCount || slidesExpected,
        chars,
        elapsedMs: now - startedAt,
      });
    }
  };

  let rawContent = '';
  let usage = null;
  let modelInfo = { requested: config.model, resolved: config.model, matchedBy: 'unknown' };

  // 思维链增量很多（实测一次生成可达 2000+ 个 delta），前端只需要「正在思考」的指示，
  // 因此按时间窗口聚合成较大的片段再推送，显著减少 SSE 事件数量。
  let thinkingBuffer = '';
  let lastThinkingAt = 0;
  const flushThinking = (force = false) => {
    if (!thinkingBuffer) return;
    const now = Date.now();
    if (!force && now - lastThinkingAt < 200) return;
    lastThinkingAt = now;
    emit('thinking', { text: thinkingBuffer });
    thinkingBuffer = '';
  };

  if (config.mock) {
    const mockDeck = buildMockDeck({ text, slideCount, title: input.title });
    modelInfo = { requested: config.model, resolved: 'mock-local-model', matchedBy: 'mock' };
    emit('meta', {
      requestedModel: modelInfo.requested,
      resolvedModel: modelInfo.resolved,
      matchedBy: 'mock',
      mock: true,
      slidesExpected: mockDeck.slideCount,
    });
    emit('status', { phase: 'streaming', message: '模型正在流式输出结构…' });
    const json = JSON.stringify(mockDeck);
    for await (const piece of streamMockJson(json, { signal, delayMs: config.mockDelayMs })) {
      rawContent += piece;
      consume(piece);
    }
  } else {
    const resolved = await resolveModel();
    modelInfo = resolved;
    emit('meta', {
      requestedModel: resolved.requested,
      resolvedModel: resolved.resolved,
      matchedBy: resolved.matchedBy,
      mock: false,
      slidesExpected,
    });
    emit('status', { phase: 'streaming', message: `已连接 ${resolved.resolved}，正在流式生成结构…` });

    const messages = buildMessages({ text, slideCount, language: input.language, style: input.style, title: input.title });
    const result = await streamChat({
      messages,
      temperature: 0.65,
      maxTokens: 8192,
      signal,
      onDelta: ({ content, reasoning }) => {
        if (reasoning) {
          thinkingBuffer += reasoning;
          flushThinking();
        }
        if (content) {
          rawContent += content;
          consume(content);
        }
      },
    });
    usage = result.usage;
  }

  flushThinking(true);
  if (usage) emit('usage', usage);

  emit('status', { phase: 'parsing', message: '正在校验并整理页面结构…' });
  let repaired = false;
  /** @type {any} */
  let deck;
  try {
    const parsed = parseModelJson(rawContent);
    repaired = parsed.repaired;
    deck = normalizeDeck(parsed.data, { maxSlides: config.maxSlides, fallbackTitle: input.title });
  } catch (error) {
    if (!scanner.slides.length) throw error;
    // 整体解析失败但增量扫描已拿到部分页面：降级使用已解析的内容
    deck = normalizeDeck(
      { title: scanner.meta.title, subtitle: scanner.meta.subtitle, slides: scanner.slides },
      { maxSlides: config.maxSlides, fallbackTitle: input.title },
    );
    repaired = true;
    emit('status', { phase: 'parsing', message: 'JSON 不完整，已使用已生成的部分页面。' });
  }

  finalizeLayouts(deck);
  if (!deck.slides.length) throw new Error('生成结果为空，请检查文案内容或重试。');

  deck.meta = {
    ...deck.meta,
    model: modelInfo.resolvedModel || modelInfo.resolved,
    requestedModel: modelInfo.requested || modelInfo.requestedModel,
    matchedBy: modelInfo.matchedBy,
    mock: Boolean(config.mock),
    elapsedMs: Date.now() - startedAt,
    repaired,
  };

  emit('deck', { deck });
  const elapsedMs = Date.now() - startedAt;
  emit('done', { elapsedMs, repaired, slides: deck.slides.length });
  return { deck, elapsedMs, repaired, usage };
}
