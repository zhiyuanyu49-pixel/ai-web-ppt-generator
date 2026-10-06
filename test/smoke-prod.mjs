/**
 * 生产模式冒烟测试：验证 `npm start` 起来后的真实站点
 * 前置：先运行 npm run build && npm start （默认 http://127.0.0.1:8787）
 * 运行：node test/smoke-prod.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort, launchBrowser, delay } from './lib/cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 .env 读取访问口令（若已开启分享保护） */
function readEnvPassword() {
  try {
    const line = fs
      .readFileSync(path.join(ROOT, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('ACCESS_PASSWORD='));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch {
    return '';
  }
}
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) throw new Error('未找到 Edge/Chrome');

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log('服务健康检查：', JSON.stringify(health));

const browser = await launchBrowser({
  browserPath,
  userDataDir: path.join(ROOT, 'test', 'tmp', 'prod-profile'),
  port: await getFreePort(),
});
const page = await browser.client.newPage('about:blank');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  await page.goto(BASE);

  // 若开启了访问口令，先登录（口令从 .env 读取，或作为第二个参数传入）
  await delay(600);
  if (await page.eval(`Boolean(document.querySelector('input[type=password]'))`)) {
    const password = process.argv[3] || readEnvPassword();
    check('开启了访问口令保护', true, password ? '' : '（未找到 ACCESS_PASSWORD，无法登录）');
    if (password) {
      await page.fillReactInput('input[type=password]', password);
      await page.eval(`document.querySelector('form').submit(); true`);
    }
  } else {
    check('开启了访问口令保护', false, '未看到登录页');
  }

  await page.waitForExpression(`Boolean(document.querySelector('#source-text'))`, { timeout: 30000 });
  check('生产站点正常渲染 React 应用', true);
  check('静态资源加载成功（无 404）', page.networkFailures.filter((f) => !/favicon/i.test(f)).length === 0,
    page.networkFailures.slice(0, 2).join(' | '));
  await page.waitForExpression(`Boolean(document.querySelector('.app__header-right .chip'))`, { timeout: 10000 });
  const chip = await page.eval(`document.querySelector('.app__header-right .chip').textContent.trim()`);
  check('页头展示已解析的真实模型 id', chip.includes(health.resolvedModel), chip);
  check('模型 id 由 deepseek-V41-Flash 解析而来', health.matchedBy === 'normalized-name', `${health.requestedModel} → ${health.resolvedModel}（${health.matchedBy}）`);
  check('主题数量 ≥ 3', (await page.eval(`document.querySelectorAll('.theme-dot').length`)) >= 3);
  const spaOk = await fetch(`${BASE}/some/spa/route`).then((r) => r.status);
  check('SPA 路由回退可用', spaOk === 200, `HTTP ${spaOk}`);
  await page.setViewport(390, 844, { mobile: true });
  await delay(300);
  check('移动端无横向溢出', (await page.eval(`document.documentElement.scrollWidth - window.innerWidth`)) <= 1);
} finally {
  await browser.close();
  fs.rmSync(path.join(ROOT, 'test', 'tmp', 'prod-profile'), { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n生产模式冒烟：${checks.length - failed.length}/${checks.length} 通过${failed.length ? ' ❌' : ' ✅'}`);
process.exitCode = failed.length ? 1 : 0;
