/**
 * 接口测试（使用 MOCK_AI=1，不消耗真实额度）
 * 覆盖：健康检查、主题列表、SSE 流式生成事件序列、导出 HTML、参数校验
 * 运行：node --test --test-isolation=none test/api.test.mjs
 */
process.env.MOCK_AI = '1';
process.env.NODE_ENV = 'test';
// 本文件测业务接口本身：显式关闭访问口令（口令与限流由 auth.test.mjs 覆盖）
process.env.ACCESS_PASSWORD = '';

import assert from 'node:assert/strict';
import test from 'node:test';

const { createApp } = await import('../server/index.js');
const { SAMPLE_TEXT } = await import('../server/index.js');

/** 启动一个临时 HTTP 服务 */
async function withServer(run) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    return await run(base);
  } finally {
    // Undici 的 keep-alive 连接会让 server.close() 一直等待，先强制断开
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** 读取 SSE 响应，返回事件数组 */
async function readSse(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      if (!block.trim() || block.startsWith(':')) continue;
      let name = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      let data = dataLines.join('\n');
      try {
        data = JSON.parse(data);
      } catch {
        /* 保留原文 */
      }
      events.push({ event: name, data });
    }
  }
  return events;
}

test('GET /api/health：返回模型与主题信息', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.ok, true);
    assert.equal(info.mock, true);
    assert.equal(info.resolvedModel, 'mock-local-model');
    assert.ok(Array.isArray(info.themes) && info.themes.length >= 3);
  });
});

test('GET /api/themes：至少 3 套主题且包含令牌', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/themes`);
    const data = await response.json();
    assert.ok(data.themes.length >= 3);
    for (const theme of data.themes) {
      assert.ok(theme.id && theme.name && theme.tokens['--accent']);
    }
  });
});

test('POST /api/generate：SSE 事件序列完整且增量页面可用', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SAMPLE_TEXT, slideCount: 8, language: 'zh', style: 'business' }),
    });
    const events = await readSse(response);
    const names = events.map((e) => e.event);

    assert.equal(names[0], 'status', '首个事件应为 status（连接中）');
    assert.ok(names.slice(0, 4).includes('meta'), 'meta 应在流早期到达');
    assert.ok(names.indexOf('meta') < names.indexOf('token'), 'meta 必须先于 token');
    assert.ok(names.includes('status'));
    assert.ok(names.includes('token'), '应有 token 增量事件');
    assert.ok(names.includes('slide'), '应有增量 slide 事件');
    assert.ok(names.includes('progress'));
    assert.ok(names.includes('deck'));
    assert.equal(names.at(-1), 'end');

    const tokenCount = names.filter((n) => n === 'token').length;
    assert.ok(tokenCount > 20, `token 事件应足够多（实际 ${tokenCount}）`);

    const slideEvents = events.filter((e) => e.event === 'slide');
    assert.equal(slideEvents.length, 8, '增量 slide 数量应等于请求页数');
    slideEvents.forEach((e) => {
      assert.equal(typeof e.data.index, 'number');
      assert.ok(e.data.slide.title || e.data.slide.bullets, 'slide 内容不应为空');
    });

    // 增量 slide 与最终 deck 应一致
    const deck = events.find((e) => e.event === 'deck').data.deck;
    assert.equal(deck.slides.length, 8);
    assert.equal(deck.slides[0].layout, 'cover');
    assert.equal(deck.slides.at(-1).layout, 'closing');
    assert.ok(deck.meta.mock);
    assert.equal(slideEvents[0].data.slide.title, deck.slides[0].title);

    // token 拼接后应是合法 JSON
    const raw = events
      .filter((e) => e.event === 'token')
      .map((e) => e.data.text)
      .join('');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.slideCount, 8);
  });
});

test('POST /api/generate：文案过短返回 400', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '太短' }),
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.match(data.error, /至少/);
  });
});

test('POST /api/export：返回可下载的独立 HTML', async () => {
  await withServer(async (base) => {
    const deck = {
      title: '接口导出测试',
      slides: [
        { layout: 'cover', title: '封面', subtitle: '副标题' },
        { layout: 'bullets', title: '要点', bullets: ['一', '二'] },
        { layout: 'closing', title: '结束' },
      ],
    };
    const response = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck, theme: 'sunset' }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(response.headers.get('content-disposition') || '', /attachment/);
    const html = await response.text();
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('data-theme="sunset"'));
    assert.equal((html.match(/<section class="slide" data-layout="[a-z-]+"/g) || []).length, 3);
    assert.ok(!html.includes('<link rel="stylesheet"'), '导出文件不应依赖外部样式');
  });
});

test('POST /api/export：缺少数据时返回 400', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.match(data.error, /缺少/);
  });
});

test('未知接口返回 404', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/not-exist`);
    assert.equal(response.status, 404);
  });
});

test('GET /api/deck/sample：返回示例文案', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/deck/sample`);
    const data = await response.json();
    assert.ok(data.text.length > 500);
  });
});

test('前端产物存在时，/ 返回 index.html', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/`);
    if (response.status === 503) {
      // 未构建前端时允许返回提示页
      assert.match(await response.text(), /尚未构建/);
      return;
    }
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<div id="root">/);
  });
});
