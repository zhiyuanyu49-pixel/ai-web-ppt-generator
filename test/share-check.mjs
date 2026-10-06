/**
 * 分享链接自检
 * ------------------------------------------------------------------
 * 用法：
 *   node test/share-check.mjs                                  # 检查本机 http://127.0.0.1:8787
 *   node test/share-check.mjs https://xxx.trycloudflare.com 口令
 *
 * 检查内容：口令拦截是否生效 → 口令是否正确可登录 → 登录后能否生成 PPT（真实跑一次）
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const PASSWORD = process.argv[3] || process.env.ACCESS_PASSWORD || '';
const GENERATE = !process.argv.includes('--no-generate');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TEXT = `分享链接自检用的示例文案。我们希望通过这段文字验证：访问口令是否生效、登录后能否正常调用大模型生成网页 PPT、流式进度是否可用、导出功能是否正常。

第一，口令拦截：未登录时应当看到登录页，接口应返回 401。
第二，登录流程：输入正确口令后应拿到 Cookie，并能访问应用页面。
第三，生成能力：登录后应能调用流式生成接口，产出结构化的多页内容。
第四，配额保护：每个 IP 每天与每分钟都有次数限制，避免额度被刷爆。`;

console.log(`\n自检目标：${BASE}\n`);

// ------------------------------ 1. 健康检查 ------------------------------
let health = null;
try {
  const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(15000) });
  health = await response.json();
  check('服务可达（/api/health）', response.status === 200 && health.ok === true, `模型 ${health.resolvedModel}`);
  check('返回的运行信息不含 API Key', !JSON.stringify(health).includes('sk-'), '');
  console.log(
    `    口令保护: ${health.authRequired ? '已开启' : '未开启'} | 模式: ${health.mock ? 'MOCK' : '真实调用'} | 配额: 每人每天 ${health.usage?.perDay} 次`,
  );
} catch (error) {
  check('服务可达（/api/health）', false, error.message);
  console.log('\n❌ 服务不可达，后续检查跳过');
  process.exit(1);
}

// ------------------------------ 2. 未登录拦截 ------------------------------
const page = await fetch(`${BASE}/`);
const pageHtml = await page.text();
check('未登录时返回登录页', page.status === 200 && pageHtml.includes('访问口令'), `HTTP ${page.status}`);
check('未登录时拿不到应用页面', !pageHtml.includes('<div id="root">'), '');

const themes401 = await fetch(`${BASE}/api/themes`);
check('未登录时接口返回 401', themes401.status === 401, `HTTP ${themes401.status}`);

// ------------------------------ 3. 口令校验 ------------------------------
if (health.authRequired) {
  const wrong = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ password: 'definitely-wrong' }),
  });
  check('错误口令被拒绝', wrong.status === 401, `HTTP ${wrong.status}`);
}

let cookie = '';
if (health.authRequired) {
  if (!PASSWORD) {
    check('使用正确口令登录', false, '未提供口令（用法：node test/share-check.mjs <地址> <口令>）');
  } else {
    const login = await fetch(`${BASE}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    cookie = ((login.headers.getSetCookie?.() || [])[0] || login.headers.get('set-cookie') || '').split(';')[0];
    check('使用正确口令登录成功', login.status === 200 && cookie.startsWith('ppt_access='), `HTTP ${login.status}`);
  }
} else {
  check('无需口令（未开启保护）', true, '');
}

const authHeaders = cookie ? { Cookie: cookie } : {};

// ------------------------------ 4. 登录后可用 ------------------------------
const appPage = await fetch(`${BASE}/`, { headers: authHeaders });
const appHtml = await appPage.text();
check('登录后拿到应用页面', appHtml.includes('<div id="root">'), `${(appHtml.length / 1024).toFixed(1)} KB`);

const themes = await fetch(`${BASE}/api/themes`, { headers: authHeaders });
check('登录后可读取主题', themes.status === 200, `HTTP ${themes.status}`);

const sample = await fetch(`${BASE}/api/deck/sample`, { headers: authHeaders });
check('登录后可读取示例文案', sample.status === 200, '');

// ------------------------------ 5. 真实生成一次 ------------------------------
if (GENERATE) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ text: TEXT, slideCount: 6, language: 'zh', style: 'business' }),
  });
  if (response.status !== 200) {
    const data = await response.json().catch(() => ({}));
    check('调用生成接口', false, `HTTP ${response.status} ${data.error || ''}`);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let slides = 0;
    let tokens = 0;
    let deck = null;
    let streamError = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
        const name = block.match(/^event: (\w+)/m)?.[1];
        const dataLine = block.match(/^data: (.*)$/m)?.[1];
        if (!name || !dataLine) continue;
        if (name === 'slide') slides += 1;
        if (name === 'token') tokens += 1;
        if (name === 'deck') {
          try {
            deck = JSON.parse(dataLine).deck;
          } catch {
            /* 忽略 */
          }
        }
        if (name === 'error') {
          try {
            streamError = JSON.parse(dataLine).message;
          } catch {
            streamError = dataLine;
          }
        }
      }
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    check('生成接口可流式返回', tokens > 10, `${tokens} 个 token 事件`);
    check('逐页增量推送正常', slides >= 2, `${slides} 页`);
    check('产出完整 deck', Boolean(deck?.slides?.length), deck ? `${deck.slides.length} 页 · ${deck.title}` : streamError);
  }

  // ------------------------------ 6. 导出接口 ------------------------------
  if (cookie || !health.authRequired) {
    const exportResponse = await fetch(`${BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        deck: { title: '自检导出', slides: [{ layout: 'cover', title: '自检封面' }, { layout: 'bullets', title: '要点', bullets: ['一', '二'] }] },
        theme: 'ocean',
      }),
    });
    const html = await exportResponse.text();
    check('导出独立 HTML 正常', exportResponse.status === 200 && html.includes('<!DOCTYPE html>'), `${(html.length / 1024).toFixed(1)} KB`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n自检结果：${results.length - failed.length}/${results.length} 通过${failed.length ? ' ❌' : ' ✅'}`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `（${f.detail}）` : ''}`);
  process.exitCode = 1;
}
