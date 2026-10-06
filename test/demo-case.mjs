/**
 * 案例演示脚本
 * ------------------------------------------------------------------
 * 用一个真实的「校园咖啡店创业计划书」长文案，走完整流程并逐步截图：
 *   粘贴文案 → 设置参数 → 生成（流式进度）→ 演示模式 → 总览 → 换主题
 *   → 导出独立 HTML（保存到 samples/）
 *
 * 运行：node test/demo-case.mjs
 */
process.env.NODE_ENV = 'test';
// 案例演示脚本自带服务：关闭访问口令，聚焦生成与导出流程
process.env.ACCESS_PASSWORD = '';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { createApp } = await import('../server/index.js');
const { getFreePort, launchBrowser, waitFor, delay } = await import('./lib/cdp.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples');
const SHOTS = path.join(SAMPLES, 'case-shots');
const DOWNLOADS = path.join(ROOT, 'test', 'tmp', 'demo-downloads');

const CASE_TITLE = '校园咖啡店「第三空间」创业计划书';
const CASE_TEXT = `校园咖啡店「第三空间」创业计划书

一、项目概述
我们计划在大学城核心位置开设一家 60 平方米的社区咖啡店，定位「学生的第三空间」：不只是卖咖啡，而是提供自习、小组讨论与轻社交的场所。目标客群是在校本科生与研究生，人均消费 15 到 22 元。

二、市场分析
大学城现有 4 所高校，在校生约 5.2 万人，周边咖啡门店 7 家，但普遍存在三个问题：座位少、插座少、营业时间与自习需求错配。调研显示，68% 的受访学生每周至少需要 2 次校外自习座位，其中 41% 愿意为座位付费。同类门店日均出杯量约 180 杯，客单价 18 元，月营业额约 9.7 万元。

三、产品与定价
主推三档产品：基础美式 12 元、招牌燕麦拿铁 18 元、季节限定 22 元。设置自习套餐：一杯饮品加 4 小时座位，28 元。会员卡 99 元每月，含 10 杯基础饮品与优先选座。毛利率目标 65%。

四、选址与运营
选址标准：距教学楼步行 8 分钟内、临街可见、可用面积 55 到 70 平方米。营业时间 7:30 到 23:00，覆盖早课与晚自习。人力配置：店长 1 名、咖啡师 2 名、兼职 3 名，人力成本控制在营收的 22% 以内。

五、财务测算
初始投入 32 万元：装修 14 万、设备 11 万、首批物料与证照 4 万、流动资金 3 万。月度成本合计 6.6 万元，其中房租 1.6 万、人力 2.1 万、物料 2.4 万、其它 0.5 万。按日均 200 杯、客单价 18 元测算，月营收 10.8 万元，月净利约 3.1 万元，回本周期约 11 个月。

六、风险与对策
客流季节性波动：寒暑假营收预计下降 55%，对策是推出外送与企业团单；同质化竞争：以座位体验与会员体系建立差异；食品安全与合规：建立每日自查表与供应商双源机制。

七、90 天启动计划
第 1 到 30 天完成选址签约、证照办理与设备采购；第 31 到 60 天完成装修施工、招聘培训、产品试制与试营业；第 61 到 90 天正式开业，上线会员体系与校园推广，目标日均 150 杯。`;

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) throw new Error('未找到 Edge/Chrome');

fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------ 启动服务 ------------------------------
const app = createApp();
const port = await getFreePort();
const server = app.listen(port, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`服务已启动：${baseUrl}`);

const browser = await launchBrowser({
  browserPath,
  userDataDir: path.join(ROOT, 'test', 'tmp', 'demo-profile'),
  port: await getFreePort(),
  windowSize: '1440,900',
});
const page = await browser.client.newPage('about:blank');
const errors = [];

try {
  await browser.client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
    eventsEnabled: true,
  }, null);

  // ------------------------------ 步骤 1：粘贴文案 ------------------------------
  await page.goto(baseUrl);
  await page.waitForExpression(`Boolean(document.querySelector('#source-text'))`);
  await page.fillReactInput('#source-text', CASE_TEXT);
  await delay(200);
  await page.eval(`(() => {
    const select = document.querySelector('.composer select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, '10');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await delay(300);
  await page.screenshot(path.join(SHOTS, '01-粘贴文案并设置参数.png'));
  console.log('步骤 1 ✔ 文案已粘贴（' + CASE_TEXT.length + ' 字），页数设为 10，风格商务汇报');

  // ------------------------------ 步骤 2：生成 ------------------------------
  const t0 = Date.now();
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成网页 PPT')).click(); true`);
  await page.waitForExpression(`document.querySelectorAll('.thumb').length >= 2`, { timeout: 60000 });
  await delay(2500);
  await page.screenshot(path.join(SHOTS, '02-流式生成中.png'));
  const midState = await page.eval(`(() => ({
    thumbs: document.querySelectorAll('.thumb').length,
    done: document.querySelector('.stat__value')?.textContent?.trim(),
    chars: document.querySelectorAll('.stat__value')[1]?.textContent?.trim(),
    phase: document.querySelectorAll('.stat__value')[3]?.textContent?.trim(),
  }))()`);
  console.log(`步骤 2 ✔ 流式生成中：已渲染 ${midState.thumbs} 页缩略图 / ${midState.done} 页 / ${midState.chars} 字符 / ${midState.phase}`);

  await page.waitForExpression(`Boolean(document.querySelector('.deck-shell'))`, { timeout: 240000 });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const deck = await page.eval(`(() => {
    const slides = [...document.querySelectorAll('.overview .thumb, .thumb')];
    return { title: document.querySelector('.deck-topbar__title')?.textContent?.trim() };
  })()`);
  console.log(`步骤 3 ✔ 生成完成（${elapsed}s），自动进入演示模式：${deck.title}`);
  await delay(900);
  await page.screenshot(path.join(SHOTS, '03-演示模式-封面页.png'));

  // ------------------------------ 步骤 4：总览 + 逐页查看 ------------------------------
  await page.pressKey('o');
  await page.waitForExpression(`Boolean(document.querySelector('.overview'))`);
  await delay(500);
  await page.screenshot(path.join(SHOTS, '04-总览.png'));

  // 找到数据页与时间线页，分别截图
  const layouts = await page.eval(`[...document.querySelectorAll('.overview .thumb')].map((t) => t.querySelector('.slide')?.dataset.layout)`);
  console.log('  版式序列：' + layouts.join(' → '));

  const shotLayout = async (layout, filename, label) => {
    const index = layouts.indexOf(layout);
    if (index < 0) return;
    await page.clickSelector('.overview .thumb', { index });
    await delay(800);
    await page.screenshot(path.join(SHOTS, filename));
    console.log(`步骤 ✔ ${label}（第 ${index + 1} 页）`);
  };

  await shotLayout('stats', '05-数据页.png', '数据页截图');
  // 重新打开总览继续找
  await page.pressKey('o');
  await page.waitForExpression(`Boolean(document.querySelector('.overview'))`);
  await delay(300);
  await shotLayout('timeline', '06-时间线页.png', '时间线页截图');
  await page.pressKey('o');
  await page.waitForExpression(`Boolean(document.querySelector('.overview'))`);
  await delay(300);
  await shotLayout('two-column', '07-两栏对比页.png', '两栏对比页截图');

  // 回到封面
  await page.pressKey('Home');
  await delay(600);

  // ------------------------------ 步骤 5：换主题 ------------------------------
  await page.clickSelector('[data-testid="theme-sunset"]');
  await delay(700);
  await page.screenshot(path.join(SHOTS, '08-切换主题-落日暖阳.png'));
  const themeNow = await page.eval(`document.querySelector('.app').dataset.theme`);
  console.log(`步骤 5 ✔ 一键切换主题 → ${themeNow}`);
  await page.clickSelector('[data-testid="theme-midnight"]');
  await delay(500);

  // ------------------------------ 步骤 6：导出独立 HTML ------------------------------
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出独立 HTML')).click(); true`);
  const downloaded = await waitFor('导出完成', async () => {
    const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.html'));
    if (!files.length) return null;
    const file = path.join(DOWNLOADS, files[0]);
    return fs.statSync(file).size > 10000 ? file : null;
  }, { timeout: 60000 });
  await delay(400);
  await page.screenshot(path.join(SHOTS, '09-导出完成.png'));

  const target = path.join(SAMPLES, 'case-campus-cafe.html');
  fs.copyFileSync(downloaded, target);
  const size = (fs.statSync(target).size / 1024).toFixed(1);
  console.log(`步骤 6 ✔ 已导出独立 HTML：samples/case-campus-cafe.html（${size} KB）`);

  // ------------------------------ 步骤 7：验证导出文件能独立演示 ------------------------------
  const exportPage = await browser.client.newPage('about:blank');
  await exportPage.goto(`file:///${target.replace(/\\/g, '/')}`);
  await exportPage.waitForExpression(`document.querySelectorAll('.slide').length >= 2`);
  await delay(700);
  await exportPage.screenshot(path.join(SHOTS, '10-导出文件独立打开.png'));
  await exportPage.pressKey('ArrowRight');
  await delay(400);
  await exportPage.pressKey('o');
  await delay(600);
  await exportPage.screenshot(path.join(SHOTS, '11-导出文件总览.png'));
  console.log(`步骤 7 ✔ 导出文件在浏览器中独立打开可用（${await exportPage.eval(`document.querySelectorAll('.stage > .slide').length`)} 页，支持翻页与总览）`);

  if (page.consoleErrors.length) errors.push(...page.consoleErrors);
  console.log(`\n控制台错误：${errors.length}`);
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(path.join(ROOT, 'test', 'tmp', 'demo-profile'), { recursive: true, force: true });
}

console.log(`\n截图目录：${SHOTS}`);
