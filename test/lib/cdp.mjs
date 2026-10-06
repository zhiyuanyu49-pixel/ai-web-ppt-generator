/**
 * 极简 CDP（Chrome DevTools Protocol）客户端
 * ------------------------------------------------------------------
 * 只依赖 Node 内置的全局 WebSocket，用于驱动 Edge/Chrome 做端到端测试：
 * 打开页面、真实输入、点击、键盘、下载、截图、读取 DOM。
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

/** 取一个空闲端口 */
export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 轮询等待某个异步条件成立 */
export async function waitFor(label, fn, { timeout = 30000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }
  throw new Error(`等待超时：${label}${lastError ? `（最后错误：${lastError.message}）` : ''}`);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动浏览器并返回控制句柄。
 * @param {{browserPath:string, userDataDir:string, port:number, windowSize?:string, headless?:boolean}} options
 */
export async function launchBrowser(options) {
  const { browserPath, userDataDir, port, windowSize = '1440,900', headless = true } = options;
  fs.mkdirSync(userDataDir, { recursive: true });
  const args = [
    headless ? '--headless=new' : '--start-maximized',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate,OptimizationHints',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${windowSize}`,
    'about:blank',
  ];
  // stdio: 'ignore' —— 受限环境不允许创建管道
  const child = spawn(browserPath, args, { stdio: 'ignore', detached: false });

  const endpoint = await waitFor('浏览器调试端口', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) return null;
    const info = await response.json();
    return info.webSocketDebuggerUrl ? info : null;
  }, { timeout: 30000 });

  const client = new CdpClient(endpoint.webSocketDebuggerUrl);
  await client.connect();
  return {
    child,
    client,
    version: endpoint.Browser,
    async close() {
      try {
        await client.send('Browser.close');
      } catch {
        /* 忽略 */
      }
      client.dispose();
      await delay(300);
      if (!child.killed) child.kill();
    },
  };
}

/** CDP 客户端 */
export class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.sessionId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      // 使用 ws 库：Node 内置 WebSocket 会与 Edge 协商 permessage-deflate，
      // 导致浏览器收到命令后不回包（CDP 命令全部超时）。
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('连接 CDP 超时')), 15000);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`CDP 连接失败：${error?.message || 'unknown'}`));
      });
      ws.on('message', (data) => {
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message.id && this.pending.has(message.id)) {
          const { resolve: res, reject: rej } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) rej(new Error(`${message.error.message}（${JSON.stringify(message.error.data ?? '')}）`));
          else res(message.result);
          return;
        }
        for (const listener of this.listeners) listener(message);
      });
    });
  }

  /** 发送命令 */
  send(method, params = {}, sessionId = this.sessionId, timeoutMs = 30000) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('CDP 未连接');
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 命令超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** 订阅事件 */
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 新建标签页并附加（flatten 模式） */
  async newPage(url = 'about:blank') {
    const { targetId } = await this.send('Target.createTarget', { url }, null);
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true }, null);
    const page = new CdpPage(this, sessionId, targetId);
    await page.init();
    return page;
  }

  dispose() {
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
  }
}

/** 页面级封装 */
export class CdpPage {
  constructor(client, sessionId, targetId) {
    this.client = client;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.consoleErrors = [];
    this.consoleLogs = [];
    this.pageErrors = [];
    this.networkFailures = [];
  }

  async init() {
    const { client, sessionId } = this;
    client.onEvent((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ');
        this.consoleLogs.push({ type: message.params.type, text });
        if (message.params.type === 'error') this.consoleErrors.push(text);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const d = message.params.exceptionDetails;
        this.pageErrors.push(d.exception?.description || d.text || 'unknown exception');
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.consoleErrors.push(message.params.entry.text);
      }
      if (message.method === 'Network.loadingFailed') {
        this.networkFailures.push(message.params.errorText);
      }
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Network.enable');
  }

  send(method, params, timeoutMs) {
    return this.client.send(method, params, this.sessionId, timeoutMs);
  }

  /** 执行 JS 并取回值 */
  async eval(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `页面执行出错：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`,
      );
    }
    return result.result?.value;
  }

  /** 轮询等待页面内条件 */
  waitForExpression(expression, options) {
    return waitFor(expression, () => this.eval(`(() => { try { return Boolean(${expression}); } catch (e) { return false; } })()`), options);
  }

  async goto(url, { waitUntil = 'load', timeout = 30000 } = {}) {
    const loaded = new Promise((resolve) => {
      const off = this.client.onEvent((message) => {
        if (message.sessionId !== this.sessionId) return;
        if (message.method === 'Page.loadEventFired') {
          off();
          resolve();
        }
      });
      setTimeout(() => {
        off();
        resolve();
      }, timeout);
    });
    await this.send('Page.navigate', { url });
    if (waitUntil === 'load') await loaded;
  }

  /** 真实键盘输入 */
  async pressKey(key, options = {}) {
    const map = {
      ArrowRight: { code: 'ArrowRight', keyCode: 39, text: '' },
      ArrowLeft: { code: 'ArrowLeft', keyCode: 37, text: '' },
      ArrowUp: { code: 'ArrowUp', keyCode: 38, text: '' },
      ArrowDown: { code: 'ArrowDown', keyCode: 40, text: '' },
      Home: { code: 'Home', keyCode: 36, text: '' },
      End: { code: 'End', keyCode: 35, text: '' },
      Escape: { code: 'Escape', keyCode: 27, text: '' },
      Enter: { code: 'Enter', keyCode: 13, text: '\r' },
      Tab: { code: 'Tab', keyCode: 9, text: '' },
    };
    const info = map[key] || { code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key };
    const base = {
      key,
      code: info.code,
      windowsVirtualKeyCode: info.keyCode,
      nativeVirtualKeyCode: info.keyCode,
      ...(options.text ?? info.text ? { text: options.text ?? info.text } : {}),
      modifiers: options.modifiers || 0,
    };
    await this.send('Input.dispatchKeyEvent', { type: info.text ? 'keyDown' : 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, text: undefined });
  }

  /** 输入文本（逐字符，触发真实键盘事件） */
  async typeText(text) {
    for (const char of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', text: char, unmodifiedText: char });
    }
  }

  /** 在元素上派发真实鼠标点击（按坐标） */
  async clickSelector(selector, { index = 0 } = {}) {
    const box = await this.eval(`(() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      const el = els[${index}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);
    if (!box) throw new Error(`找不到元素：${selector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return box;
  }

  /** React 受控输入：用原生 setter 写值并派发 input 事件 */
  async fillReactInput(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async setDownloadBehavior(downloadPath) {
    await this.client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true,
    }, null);
  }

  /**
   * 截图（诊断用途：失败只告警，不影响测试结论）
   * @param {string} filePath
   */
  async screenshot(filePath, { retries = 2 } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, 60000);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
        return filePath;
      } catch (error) {
        if (attempt >= retries) {
          console.warn(`  · 截图失败（忽略）：${path.basename(filePath)} — ${error.message}`);
          return null;
        }
        await delay(600);
      }
    }
  }

  async setViewport(width, height, { mobile = false, deviceScaleFactor = 1 } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile,
    });
  }
}
