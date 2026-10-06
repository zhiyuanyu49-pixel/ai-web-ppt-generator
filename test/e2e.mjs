/**
 * 端到端测试（真实浏览器 · CDP 驱动）
 * ------------------------------------------------------------------
 * 覆盖完整链路：
 *   1. 打开应用 → 粘贴文案 → 点击生成
 *   2. 观察流式进度：进度条 / token 流 / 逐页出现的缩略图
 *   3. 自动进入演示模式 → 键盘翻页 / 首页末页 / 总览
 *   4. 切换配色主题（页面与幻灯片联动）
 *   5. 导出独立 HTML（真实下载）→ 用浏览器打开导出文件再次验证演示
 *   6. 响应式：移动端视口无横向溢出
 *
 * 运行：
 *   node test/e2e.mjs          # 使用 MOCK 模型（快、稳定、不消耗额度）
 *   node test/e2e.mjs --live   # 使用真实 DeepSeek 模型（验证完整 AI 链路）
 */
process.env.MOCK_AI = process.argv.includes('--live') ? '0' : '1';
process.env.MOCK_DELAY_MS = process.env.MOCK_DELAY_MS || '25';
process.env.NODE_ENV = 'test';
// 端到端测的是产品功能，关闭访问口令（分享场景的登录门禁由 share-browser-check.mjs 覆盖）
process.env.ACCESS_PASSWORD = '';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { createApp, SAMPLE_TEXT } = await import('../server/index.js');
const { getFreePort, launchBrowser, waitFor, delay } = await import('./lib/cdp.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'tmp');
const DOWNLOADS = path.join(TMP, 'downloads');
const SHOTS = path.join(TMP, 'shots');
const LIVE = process.argv.includes('--live');

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const browserPath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!browserPath) throw new Error('未找到 Edge/Chrome，无法执行端到端测试');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('缺少前端构建产物，请先执行 npm run build');
  }

  // 清理上次产物（容错：若有其它测试/浏览器正在占用临时目录，不影响本次运行）
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (error) {
    console.log(`  · 临时目录清理警告（忽略）：${error.code || error.message}`);
  }
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  // ------------------------------ 启动服务 ------------------------------
  const app = createApp();
  const port = await getFreePort();
  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`\n本地服务已启动：${baseUrl}（模型模式：${LIVE ? 'DeepSeek 真实调用' : 'MOCK'}）\n`);

  // ------------------------------ 启动浏览器 ------------------------------
  const debugPort = await getFreePort();
  const browser = await launchBrowser({
    browserPath,
    userDataDir: path.join(TMP, 'browser-profile'),
    port: debugPort,
  });
  console.log(`浏览器：${browser.version}\n`);

  let page;
  const consoleErrors = [];
  try {
    await browser.client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOADS,
      eventsEnabled: true,
    }, null);

    page = await browser.client.newPage('about:blank');
    await page.goto(baseUrl);

    // ------------------------------ 1. 首屏 ------------------------------
    const title = await page.eval('document.title');
    step('页面加载：标题正确', title.includes('AI 网页 PPT'), title);
    const hasComposer = await page.eval(`Boolean(document.querySelector('#source-text'))`);
    step('首屏渲染：存在文案输入框', hasComposer === true);
    const themeDots = await page.eval(`document.querySelectorAll('.theme-dot').length`);
    step('主题数量不少于 3 套', themeDots >= 3, `${themeDots} 套`);
    // 健康检查是异步的，等徽标出现
    await page.waitForExpression(`Boolean(document.querySelector('.app__header-right .chip'))`, { timeout: 10000 });
    const healthBadge = await page.eval(`document.querySelector('.app__header-right .chip')?.textContent?.trim() || ''`);
    step('页头显示模型信息', healthBadge.length > 0, healthBadge);
    await page.screenshot(path.join(SHOTS, '01-compose.png'));

    // 未输入文案时按钮禁用
    const disabled = await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成网页 PPT'));
      return btn ? btn.disabled : null;
    })()`);
    step('空文案时生成按钮禁用', disabled === true);

    // ------------------------------ 2. 填入文案并生成 ------------------------------
    await page.fillReactInput('#source-text', LIVE ? SAMPLE_TEXT.slice(0, 800) : SAMPLE_TEXT);
    await delay(120);
    const filled = await page.eval(`document.querySelector('#source-text').value.length`);
    step('文案写入成功', filled > 200, `${filled} 字`);

    // 固定 8 页，便于断言
    await page.eval(`(() => {
      const select = document.querySelector('.composer select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, '8');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);

    const generateClicked = await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成网页 PPT'));
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()`);
    step('点击生成按钮', generateClicked === true);

    // ------------------------------ 3. 流式进度 ------------------------------
    await page.waitForExpression(`document.querySelectorAll('.thumb').length >= 2`, { timeout: 30000 });
    const midThumbs = await page.eval(`document.querySelectorAll('.thumb').length`);
    step('流式进度：页面逐页出现', midThumbs >= 2, `已渲染 ${midThumbs} 页缩略图`);
    const streamPreview = await page.eval(`document.querySelector('.raw-stream pre')?.textContent?.length || 0`);
    step('流式进度：显示模型原始输出', streamPreview > 20, `${streamPreview} 字符`);
    const progressText = await page.eval(`document.querySelector('.stat__value')?.textContent?.trim() || ''`);
    step('流式进度：完成页计数可见', /\d/.test(progressText), progressText);
    const running = await page.eval(`document.body.textContent.includes('正在生成') || document.body.textContent.includes('生成完成')`);
    step('流式进度：进度面板处于生成中状态', running === true);
    await page.screenshot(path.join(SHOTS, '02-streaming.png'));

    // 等待生成结束并自动进入演示模式
    await page.waitForExpression(`Boolean(document.querySelector('.deck-shell'))`, { timeout: LIVE ? 180000 : 30000 });
    step('生成完成后自动进入演示模式', true);
    const deckTitle = await page.eval(`document.querySelector('.deck-topbar__title')?.textContent?.trim() || ''`);
    step('演示模式显示文稿标题', deckTitle.length > 0, deckTitle);
    const totalPages = await page.eval(`document.querySelectorAll('.deck-topbar .chip')[0]?.textContent?.trim() || ''`);
    step('页数徽标正确', /8 页/.test(totalPages) || LIVE, totalPages);
    // 等入场动画结束，验证内容真正可见（不是被动画或裁剪藏起来）
    await delay(900);
    const coverBullets = await page.eval(`(() => {
      const lis = [...document.querySelectorAll('.slide-host .slide__bullets li')];
      return {
        count: lis.length,
        opacity: lis.map((l) => getComputedStyle(l).opacity),
        widths: lis.map((l) => Math.round(l.getBoundingClientRect().width)),
        texts: lis.map((l) => l.textContent.trim()),
      };
    })()`);
    step(
      '封面页要点完整可见',
      coverBullets.count === 0
        ? LIVE // 真实模型可能不给封面写要点，MOCK 一定有
        : coverBullets.opacity.every((o) => Number(o) > 0.9) && coverBullets.widths.every((w) => w > 40),
      `${coverBullets.count} 条 / opacity ${coverBullets.opacity.join(',')} / 宽 ${coverBullets.widths.join(',')}`,
    );
    // 幻灯片内容不得溢出舞台
    const overflow = await page.eval(`(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      return [...document.querySelectorAll('.slide-host .slide__bullets li, .slide-host .slide__title')].map((el) => {
        const r = el.getBoundingClientRect();
        return Math.round(Math.max(0, r.right - stage.right)) + Math.round(Math.max(0, r.bottom - stage.bottom));
      });
    })()`);
    step('内容未溢出舞台', overflow.every((v) => v <= 2), `溢出量 ${overflow.join(',')}px`);
    await page.screenshot(path.join(SHOTS, '03-present.png'));

    // ------------------------------ 4. 键盘翻页 ------------------------------
    const counterAt = () => page.eval(`document.querySelector('[data-testid="page-counter"]')?.textContent?.trim()`);
    const before = await counterAt();
    await page.pressKey('ArrowRight');
    await page.waitForExpression(
      `document.querySelector('[data-testid="page-counter"]')?.textContent?.trim() !== ${JSON.stringify(before)}`,
      { timeout: 5000 },
    );
    const afterNext = await counterAt();
    step('键盘 → 翻到下一页', afterNext !== before, `${before} → ${afterNext}`);

    await page.pressKey('ArrowLeft');
    await page.waitForExpression(
      `document.querySelector('[data-testid="page-counter"]')?.textContent?.trim() === ${JSON.stringify(before)}`,
      { timeout: 5000 },
    );
    step('键盘 ← 返回上一页', true);

    await page.pressKey('End');
    await page.waitForExpression(`document.querySelector('[data-testid="page-counter"]')?.textContent?.includes('/ 8') || true`, { timeout: 5000 });
    const last = await counterAt();
    step('键盘 End 跳到末页', /8 \/ 8/.test(last || '') || LIVE, last);

    await page.pressKey('Home');
    const first = await counterAt();
    step('键盘 Home 回到首页', /1 \//.test(first || ''), first);

    const slideTitle = await page.eval(`document.querySelector('.slide__title')?.textContent?.trim() || ''`);
    step('舞台渲染出页面内容', slideTitle.length > 0, slideTitle);

    // ------------------------------ 5. 总览 ------------------------------
    await page.pressKey('o');
    await page.waitForExpression(`Boolean(document.querySelector('.overview'))`, { timeout: 5000 });
    const overviewThumbs = await page.eval(`document.querySelectorAll('.overview .thumb').length`);
    step('总览（O）显示全部页面缩略图', overviewThumbs >= 2, `${overviewThumbs} 页`);
    await page.screenshot(path.join(SHOTS, '04-overview.png'));
    await page.clickSelector('.overview .thumb', { index: 2 });
    await page.waitForExpression(`!document.querySelector('.overview')`, { timeout: 5000 });
    const jumped = await counterAt();
    step('点击总览缩略图可跳页', jumped?.startsWith('3'), jumped);

    // ------------------------------ 6. 主题切换 ------------------------------
    const themesBefore = await page.eval(`document.querySelector('.app').dataset.theme`);
    const tokensBefore = await page.eval(`getComputedStyle(document.querySelector('.app')).getPropertyValue('--bg').trim()`);
    const stageBgBefore = await page.eval(`getComputedStyle(document.querySelector('.stage')).backgroundImage`);
    await page.clickSelector('[data-testid="theme-paper"]');
    await delay(400);
    const themesAfter = await page.eval(`document.querySelector('.app').dataset.theme`);
    const tokensAfter = await page.eval(`getComputedStyle(document.querySelector('.app')).getPropertyValue('--bg').trim()`);
    const stageBgAfter = await page.eval(`getComputedStyle(document.querySelector('.stage')).backgroundImage`);
    step('切换到「极简白」主题', themesAfter === 'paper', `${themesBefore} → ${themesAfter}`);
    step('主题令牌已注入应用（--bg 变化）', tokensBefore !== tokensAfter && tokensAfter.length > 0, `${tokensBefore} → ${tokensAfter}`);
    step('幻灯片配色随主题联动', stageBgBefore !== stageBgAfter);
    const slideTextColor = await page.eval(`getComputedStyle(document.querySelector('.slide')).color`);
    step('浅色主题下文字颜色变深', /rgb\(1[0-9]|rgb\([0-9],/.test(slideTextColor), slideTextColor);
    const appBg = await page.eval(`getComputedStyle(document.querySelector('.app')).backgroundColor`);
    step('页面外壳背景随主题变浅', !/^rgb\((0|1|2|3|4|5|6|7|8|9|1[0-9]|2[0-9]),/.test(appBg), appBg);
    await page.screenshot(path.join(SHOTS, '05-theme-paper.png'));

    // 键盘 T 循环主题
    await page.pressKey('t');
    await delay(200);
    const cycled = await page.eval(`document.querySelector('.app').dataset.theme`);
    step('键盘 T 循环切换主题', cycled !== 'paper', cycled);

    await page.clickSelector('[data-testid="theme-midnight"]');
    await delay(300);

    // 数据页数字必须可见（渐变文字依赖主题令牌，令牌缺失会变成透明文字）
    await page.pressKey('o');
    await page.waitForExpression(`Boolean(document.querySelector('.overview'))`, { timeout: 5000 });
    const statsIndex = await page.eval(
      `[...document.querySelectorAll('.overview .thumb')].findIndex((t) => t.querySelector('.slide__stat-value'))`,
    );
    if (statsIndex >= 0) {
      await page.clickSelector('.overview .thumb', { index: statsIndex });
      await delay(400);
      const stat = await page.eval(`(() => {
        const el = document.querySelector('.slide__stat-value');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), bg: cs.backgroundImage, color: cs.color };
      })()`);
      step(
        '数据页数字可见并使用主题渐变',
        Boolean(stat && stat.text && stat.bg.includes('gradient')),
        JSON.stringify(stat).slice(0, 140),
      );
    } else {
      step('数据页数字可见并使用主题渐变', false, '未找到 stats 版式页面');
    }

    // ------------------------------ 7. 讲者备注 ------------------------------
    await page.pressKey('n');
    await delay(250);
    const notesVisible = await page.eval(`Boolean(document.querySelector('.deck-notes'))`);
    step('键盘 N 显示讲者备注', notesVisible === true);
    await page.pressKey('n');
    await delay(200);

    // ------------------------------ 8. 导出独立 HTML ------------------------------
    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出独立 HTML'));
      btn.click();
      return true;
    })()`);

    const downloaded = await waitFor('导出文件下载完成', async () => {
      const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.html'));
      if (!files.length) return null;
      const file = path.join(DOWNLOADS, files[0]);
      const stat = fs.statSync(file);
      if (stat.size < 5000) return null;
      return file;
    }, { timeout: 30000 });

    const exportedHtml = fs.readFileSync(downloaded, 'utf8');
    step('导出文件已下载', true, `${path.basename(downloaded)}（${(exportedHtml.length / 1024).toFixed(1)} KB）`);
    step('导出文件自包含（无外链资源）', !/<link[^>]+href="http/.test(exportedHtml) && !/<script[^>]+src="/.test(exportedHtml));
    step('导出文件包含全部页面', (exportedHtml.match(/<section class="slide" data-layout="[a-z-]+"/g) || []).length >= 2,
      `${(exportedHtml.match(/<section class="slide" data-layout="[a-z-]+"/g) || []).length} 页`);
    const toastText = await page.eval(`document.querySelector('.toast')?.textContent || ''`);
    step('导出后给出提示', toastText.includes('已导出') || toastText.includes('导出'), toastText);
    await page.screenshot(path.join(SHOTS, '06-after-export.png'));

    // ------------------------------ 9. 打开导出文件 ------------------------------
    const exportPage = await browser.client.newPage('about:blank');
    const fileUrl = `file:///${downloaded.replace(/\\/g, '/')}`;
    await exportPage.goto(fileUrl);
    await exportPage.waitForExpression(`document.querySelectorAll('.slide').length >= 2`, { timeout: 15000 });
    const exportSlides = await exportPage.eval(`document.querySelectorAll('.slide').length`);
    step('导出文件在浏览器中正常渲染', exportSlides >= 2, `${exportSlides} 页`);
    const exportActive = await exportPage.eval(`document.querySelector('.slide.is-active') ? 1 : 0`);
    step('导出文件默认展示第 1 页', exportActive === 1);

    const exportCounterBefore = await exportPage.eval(`document.getElementById('page-counter').textContent.trim()`);
    await exportPage.pressKey('ArrowRight');
    await delay(350);
    const exportCounterAfter = await exportPage.eval(`document.getElementById('page-counter').textContent.trim()`);
    step('导出文件支持键盘翻页', exportCounterBefore !== exportCounterAfter, `${exportCounterBefore} → ${exportCounterAfter}`);

    await exportPage.eval(`document.querySelector('[data-action="overview"]').click(); true`);
    await delay(400);
    const exportOverview = await exportPage.eval(`document.querySelectorAll('#overview-grid .thumb, #overview-grid .deck__thumb').length`);
    step('导出文件支持总览', exportOverview >= 2, `${exportOverview} 页`);
    await exportPage.eval(`document.querySelector('[data-action="overview"]').click(); true`);
    await delay(200);

    // 导出文件里的主题切换
    const exportThemeBefore = await exportPage.eval(`document.body.dataset.theme`);
    await exportPage.eval(`document.querySelectorAll('#theme-bar .deck__theme-dot')[1].click(); true`);
    await delay(250);
    const exportThemeAfter = await exportPage.eval(`document.body.dataset.theme`);
    step('导出文件支持主题切换', exportThemeBefore !== exportThemeAfter, `${exportThemeBefore} → ${exportThemeAfter}`);
    await exportPage.screenshot(path.join(SHOTS, '07-export-standalone.png'));

    const exportErrors = exportPage.pageErrors.length;
    step('导出文件无脚本错误', exportErrors === 0, exportPage.pageErrors.join(' | ').slice(0, 200));

    // ------------------------------ 10. 响应式 ------------------------------
    await exportPage.setViewport(390, 844, { mobile: true, deviceScaleFactor: 2 });
    await delay(300);
    const exportMobileOverflow = await exportPage.eval(
      `document.documentElement.scrollWidth - window.innerWidth`,
    );
    step('导出文件移动端无横向溢出', exportMobileOverflow <= 1, `溢出 ${exportMobileOverflow}px`);
    await exportPage.screenshot(path.join(SHOTS, '08-export-mobile.png'));

    // 应用页移动端
    await page.setViewport(390, 844, { mobile: true, deviceScaleFactor: 2 });
    await delay(400);
    const mobileOverflow = await page.eval(`document.documentElement.scrollWidth - window.innerWidth`);
    step('应用移动端无横向溢出', mobileOverflow <= 1, `溢出 ${mobileOverflow}px`);
    const mobileStageVisible = await page.eval(`(() => {
      const stage = document.querySelector('.stage');
      if (!stage) return false;
      const r = stage.getBoundingClientRect();
      return r.width > 200 && r.height > 100;
    })()`);
    step('移动端舞台自适应缩放', mobileStageVisible === true);
    await page.screenshot(path.join(SHOTS, '09-app-mobile-present.png'));

    // 回到编辑页看移动端表单
    await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回编辑'))?.click(); true`);
    await delay(400);
    const mobileComposeOk = await page.eval(`(() => {
      const ta = document.querySelector('#source-text');
      if (!ta) return false;
      const r = ta.getBoundingClientRect();
      return r.width > 200 && document.documentElement.scrollWidth - window.innerWidth <= 1;
    })()`);
    step('移动端编辑页布局正常', mobileComposeOk === true);
    await page.screenshot(path.join(SHOTS, '10-app-mobile-compose.png'));

    await page.setViewport(1440, 900);
    await delay(300);

    // ------------------------------ 11. 控制台错误 ------------------------------
    const fatal = page.consoleErrors.filter((e) => !/favicon/i.test(e));
    step('应用无控制台错误', fatal.length === 0, fatal.slice(0, 3).join(' | '));
    const pageErr = page.pageErrors.filter((e) => !/favicon/i.test(e));
    step('应用无未捕获异常', pageErr.length === 0, pageErr.slice(0, 2).join(' | '));

    consoleErrors.push(...fatal);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  // ------------------------------ 汇总 ------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log('\n================= 端到端结果 =================');
  console.log(`通过 ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `（${f.detail}）` : ''}`);
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✅');
  }
  console.log(`截图目录：${SHOTS}`);
  console.log(`导出文件：${DOWNLOADS}`);
}

main().catch((error) => {
  console.error('\n❌ 端到端测试异常终止：', error);
  process.exitCode = 1;
});
