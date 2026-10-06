/**
 * 分享链接的浏览器端自检：模拟"别人"从公网链接进入并生成一份 PPT
 * ------------------------------------------------------------------
 * 用法：
 *   node test/share-browser-check.mjs                                  # 本机 8787
 *   node test/share-browser-check.mjs https://xxx.lhr.life 口令
 *
 * 流程：打开链接 → 看到登录页 → 输入口令 → 进入应用 → 填入示例 → 生成 →
 *       演示模式 → 截图。产出截图到 samples/case-shots/（分享场景）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort, launchBrowser, waitFor, delay } from './lib/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'samples', 'case-shots');
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const PASSWORD = process.argv[3] || process.env.ACCESS_PASSWORD || '';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) throw new Error('未找到 Edge/Chrome');

fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const PROFILE = path.join(ROOT, 'test', 'tmp', 'share-profile');
// 每次都用全新的浏览器配置目录：否则上次留下的登录 Cookie / 缓存会让"未登录"检查失真
fs.rmSync(PROFILE, { recursive: true, force: true });

const browser = await launchBrowser({
  browserPath,
  userDataDir: PROFILE,
  port: await getFreePort(),
  windowSize: '1440,900',
});
const page = await browser.client.newPage('about:blank');

try {
  console.log(`\n浏览器自检目标：${BASE}\n`);
  await page.goto(BASE, { timeout: 60000 });
  await delay(800);

  // ------------------------------ 登录页 ------------------------------
  const loginVisible = await page.eval(`Boolean(document.querySelector('input[type=password]'))`);
  const hasRoot = await page.eval(`Boolean(document.querySelector('#root'))`);
  check('未登录时看到登录页', loginVisible === true, hasRoot ? '（意外看到应用页面）' : '');
  await page.screenshot(path.join(SHOTS, 'share-01-登录页.png'));

  if (loginVisible && PASSWORD) {
    await page.fillReactInput('input[type=password]', PASSWORD);
    await delay(150);
    await page.eval(`document.querySelector('form').submit(); true`);
    await page.waitForExpression(`Boolean(document.querySelector('#source-text'))`, { timeout: 30000 });
    check('输入口令后进入应用', true, '');
  } else if (!loginVisible) {
    check('输入口令后进入应用', true, '（未开启口令保护）');
  } else {
    throw new Error('需要提供访问口令：node test/share-browser-check.mjs <url> <password>');
  }

  check('页面标题正确', (await page.eval('document.title')).includes('AI 网页 PPT'), '');
  const themeDots = await page.eval(`document.querySelectorAll('.theme-dot').length`);
  check('主题可选（≥3 套）', themeDots >= 3, `${themeDots} 套`);
  await page.screenshot(path.join(SHOTS, 'share-02-登录后的应用.png'));

  // ------------------------------ 生成 ------------------------------
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('填入示例')).click(); true`);
  // 隧道 RTT 较大，等文案真正写入后继续（而不是固定延时）
  await page.waitForExpression(`(document.querySelector('#source-text')?.value.length || 0) > 200`, { timeout: 30000 });
  const chars = await page.eval(`document.querySelector('#source-text').value.length`);
  check('一键填入示例文案', chars > 200, `${chars} 字`);

  const started = Date.now();
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成网页 PPT')).click(); true`);
  await page.waitForExpression(`document.querySelectorAll('.thumb').length >= 1`, { timeout: 60000 });
  check('流式进度可用（缩略图逐页出现）', true, `${await page.eval(`document.querySelectorAll('.thumb').length`)} 页`);
  await page.screenshot(path.join(SHOTS, 'share-03-流式生成中.png'));

  await page.waitForExpression(`Boolean(document.querySelector('.deck-shell'))`, { timeout: 240000 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const title = await page.eval(`document.querySelector('.deck-topbar__title')?.textContent?.trim() || ''`);
  const counter = await page.eval(`document.querySelector('[data-testid="page-counter"]')?.textContent?.trim() || ''`);
  check('生成完成并进入演示模式', Boolean(title), `${title}（${counter}，${seconds}s）`);
  await delay(900);
  await page.screenshot(path.join(SHOTS, 'share-04-演示模式.png'));

  // ------------------------------ 交互 ------------------------------
  await page.pressKey('ArrowRight');
  await delay(400);
  const after = await page.eval(`document.querySelector('[data-testid="page-counter"]')?.textContent?.trim() || ''`);
  check('键盘翻页正常', after !== counter, `${counter} → ${after}`);

  await page.pressKey('o');
  await page.waitForExpression(`Boolean(document.querySelector('.overview'))`, { timeout: 5000 });
  check('总览正常', (await page.eval(`document.querySelectorAll('.overview .thumb').length`)) >= 2, '');
  await page.screenshot(path.join(SHOTS, 'share-05-总览.png'));
  await page.pressKey('Escape');
  await delay(300);

  await page.clickSelector('[data-testid="theme-paper"]');
  await delay(500);
  check('主题切换正常', (await page.eval(`document.querySelector('.app').dataset.theme`)) === 'paper', '');
  await page.screenshot(path.join(SHOTS, 'share-06-切换主题.png'));

  const errors = page.consoleErrors.filter((e) => !/favicon/i.test(e));
  check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n浏览器自检：${results.length - failed.length}/${results.length} 通过${failed.length ? ' ❌' : ' ✅'}`);
console.log(`截图目录：${SHOTS}`);
if (failed.length) process.exitCode = 1;
