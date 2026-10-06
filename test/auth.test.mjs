/**
 * 分享保护测试：访问口令 + 配额限流
 * 单独进程运行（需要在 import 配置前设置环境变量）：
 *   node --test --test-isolation=none test/auth.test.mjs
 */
process.env.MOCK_AI = '1';
process.env.NODE_ENV = 'test';
process.env.ACCESS_PASSWORD = 'test-pass-123';

import assert from 'node:assert/strict';
import test from 'node:test';

const { createApp } = await import('../server/index.js');
const { config } = await import('../server/config.js');
const { __resetLimits } = await import('../server/ratelimit.js');
const { issueToken, verifyToken, checkPassword } = await import('../server/auth.js');

const SMALL_TEXT = '这是用于测试限流与口令的文案，需要超过二十个字符才能通过校验。';

async function withServer(run) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** 登录并返回 Cookie 头 */
async function login(base, password = 'test-pass-123') {
  const response = await fetch(`${base}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = (response.headers.getSetCookie?.() || [])[0] || response.headers.get('set-cookie') || '';
  return { status: response.status, cookie: cookie.split(';')[0] };
}

/** 发起一次生成，返回状态码（不读取整个流，够用即可） */
async function tryGenerate(base, cookie, ip) {
  const response = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: JSON.stringify({ text: SMALL_TEXT, slideCount: 6 }),
  });
  if (response.status !== 200) {
    const data = await response.json().catch(() => ({}));
    return { status: response.status, error: data.error };
  }
  // 消费掉整个流，确保服务端 finally 释放并发计数
  const reader = response.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  return { status: 200 };
}

test('口令工具函数：签名校验与口令比较', () => {
  const token = issueToken();
  assert.equal(verifyToken(token), true);
  assert.equal(verifyToken(`${token}x`), false, '被篡改的签名必须失败');
  assert.equal(verifyToken('123.abc'), false);
  assert.equal(verifyToken(undefined), false);
  assert.equal(verifyToken(`${Date.now() - 1000}.${token.split('.')[1]}`), false, '过期令牌必须失败');
  assert.equal(checkPassword('test-pass-123'), true);
  assert.equal(checkPassword('wrong'), false);
  assert.equal(checkPassword(''), false);
});

test('未登录：页面请求返回登录页，接口返回 401', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /访问口令/, '应返回登录页');
    assert.ok(!html.includes('<div id="root">'), '未登录不应拿到应用页面');

    const themes = await fetch(`${base}/api/themes`);
    assert.equal(themes.status, 401);
    const body = await themes.json();
    assert.equal(body.authRequired, true);

    const generate = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SMALL_TEXT }),
    });
    assert.equal(generate.status, 401, '未登录不能调用生成接口');
  });
});

test('健康检查保持公开，便于探活', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.authRequired, true);
    assert.ok(info.usage && typeof info.usage.globalDayTotal === 'number');
    assert.ok(!JSON.stringify(info).includes(config.apiKey || 'undefined'), '健康检查不能泄露 Key');
  });
});

test('口令错误：JSON 请求 401，表单请求回到登录页并提示', async () => {
  await withServer(async (base) => {
    const json = await fetch(`${base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(json.status, 401);

    const form = await fetch(`${base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: 'password=nope',
    });
    assert.equal(form.status, 401);
    assert.match(await form.text(), /口令不正确/);
  });
});

test('口令正确：拿到 Cookie 后可访问页面与接口', async () => {
  await withServer(async (base) => {
    const { status, cookie } = await login(base);
    assert.equal(status, 200);
    assert.match(cookie, /^ppt_access=/);

    const page = await fetch(`${base}/`, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('<div id="root">'), '登录后应拿到应用页面');

    const themes = await fetch(`${base}/api/themes`, { headers: { Cookie: cookie } });
    assert.equal(themes.status, 200);
    const data = await themes.json();
    assert.ok(data.themes.length >= 3);

    // 表单提交（浏览器默认行为）应 303 跳回首页
    const form = await fetch(`${base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: 'password=test-pass-123',
      redirect: 'manual',
    });
    assert.equal(form.status, 303);
    assert.equal(form.headers.get('location'), '/');
  });
});

test('伪造 Cookie 无法绕过口令', async () => {
  await withServer(async (base) => {
    const forged = `ppt_access=${Date.now() + 100000}.deadbeef`;
    const response = await fetch(`${base}/api/themes`, { headers: { Cookie: forged } });
    assert.equal(response.status, 401, '签名不匹配必须拒绝');
  });
});

test('限流：单 IP 每天次数上限生效', async () => {
  __resetLimits();
  const original = { day: config.ratePerDay, minute: config.ratePerMinute, global: config.ratePerDayGlobal };
  config.ratePerDay = 2;
  config.ratePerMinute = 5;
  config.ratePerDayGlobal = 100;
  try {
    await withServer(async (base) => {
      const { cookie } = await login(base);
      const first = await tryGenerate(base, cookie, '10.0.0.1');
      const second = await tryGenerate(base, cookie, '10.0.0.1');
      const third = await tryGenerate(base, cookie, '10.0.0.1');
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429, '第 3 次应被每日配额拦住');
      assert.match(third.error, /每天/);

      // 换一个 IP 不受影响（说明按 IP 维度统计）
      const otherIp = await tryGenerate(base, cookie, '10.0.0.2');
      assert.equal(otherIp.status, 200);
    });
  } finally {
    config.ratePerDay = original.day;
    config.ratePerMinute = original.minute;
    config.ratePerDayGlobal = original.global;
    __resetLimits();
  }
});

test('限流：每分钟请求数上限生效', async () => {
  __resetLimits();
  const original = { day: config.ratePerDay, minute: config.ratePerMinute, global: config.ratePerDayGlobal };
  config.ratePerDay = 50;
  config.ratePerMinute = 2;
  config.ratePerDayGlobal = 100;
  try {
    await withServer(async (base) => {
      const { cookie } = await login(base);
      assert.equal((await tryGenerate(base, cookie, '10.1.0.1')).status, 200);
      assert.equal((await tryGenerate(base, cookie, '10.1.0.1')).status, 200);
      const third = await tryGenerate(base, cookie, '10.1.0.1');
      assert.equal(third.status, 429);
      assert.match(third.error, /秒后再试|稍后/);
    });
  } finally {
    config.ratePerDay = original.day;
    config.ratePerMinute = original.minute;
    config.ratePerDayGlobal = original.global;
    __resetLimits();
  }
});

test('限流：全站每日总额度与并发上限', async () => {
  __resetLimits();
  const original = { day: config.ratePerDay, minute: config.ratePerMinute, global: config.ratePerDayGlobal, concurrent: config.maxConcurrent };
  config.ratePerDay = 50;
  config.ratePerMinute = 50;
  config.ratePerDayGlobal = 1;
  try {
    await withServer(async (base) => {
      const { cookie } = await login(base);
      assert.equal((await tryGenerate(base, cookie, '10.2.0.1')).status, 200);
      const blocked = await tryGenerate(base, cookie, '10.2.0.2');
      assert.equal(blocked.status, 429);
      assert.match(blocked.error, /全站/);
    });
  } finally {
    config.ratePerDay = original.day;
    config.ratePerMinute = original.minute;
    config.ratePerDayGlobal = original.global;
    __resetLimits();
  }

  config.maxConcurrent = 0;
  try {
    await withServer(async (base) => {
      const { cookie } = await login(base);
      const blocked = await tryGenerate(base, cookie, '10.3.0.1');
      assert.equal(blocked.status, 429);
      assert.match(blocked.error, /正在进行/);
    });
  } finally {
    config.maxConcurrent = original.concurrent;
    __resetLimits();
  }
});
