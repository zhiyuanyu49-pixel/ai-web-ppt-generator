/**
 * 访问口令（可选）
 * ------------------------------------------------------------------
 * 当 .env 里配置了 ACCESS_PASSWORD 时：
 *   - 页面与接口都需要先通过口令校验（一次性输入，浏览器记住 30 天）
 *   - 校验方式是 HMAC 签名的 Cookie，密钥由口令派生，重启服务不会掉线
 *   - 未通过校验时：页面请求返回登录页，接口请求返回 401
 * 未配置口令时全部放行（本地使用场景，零打扰）。
 */
import crypto from 'node:crypto';
import { config } from './config.js';

export const COOKIE_NAME = 'ppt_access';
const MAX_AGE_SECONDS = 30 * 24 * 3600;

/** 是否开启口令保护 */
export function authEnabled() {
  return Boolean(config.accessPassword);
}

/**
 * 生成签名：把「过期时间」用口令派生密钥签名。
 * @param {number} expiresAt 毫秒时间戳
 */
function sign(expiresAt) {
  return crypto.createHmac('sha256', `ppt:${config.accessPassword}`).update(String(expiresAt)).digest('hex');
}

/**
 * 生成登录成功的 Cookie 值。
 * @returns {string}
 */
export function issueToken() {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(expiresAt)}`;
}

/**
 * 校验 Cookie 值。
 * @param {string|undefined} token
 * @returns {boolean}
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [rawExpires, signature] = token.split('.');
  const expiresAt = Number(rawExpires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = sign(expiresAt);
  const a = Buffer.from(String(signature || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 校验用户输入的口令（定长比较，避免时序侧信道）。
 * @param {string} input
 */
export function checkPassword(input) {
  if (!authEnabled()) return true;
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(config.accessPassword);
  if (a.length !== b.length) {
    // 长度不同也要走一次比较，避免快速失败泄露信息
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** 解析请求里的 Cookie */
function readCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** 该请求是否已通过校验 */
export function isAuthorized(req) {
  if (!authEnabled()) return true;
  return verifyToken(readCookie(req));
}

/**
 * 把 Cookie 写入响应。
 * @param {import('express').Response} res
 */
export function setAuthCookie(res) {
  const token = issueToken();
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`,
  );
}

/**
 * 访问口令中间件：未通过校验时，页面给登录页、接口给 401。
 * @returns {import('express').RequestHandler}
 */
export function authMiddleware() {
  return (req, res, next) => {
    if (!authEnabled() || isAuthorized(req)) return next();
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: '需要访问口令', authRequired: true });
      return;
    }
    // 登录页必须禁用缓存：否则浏览器可能把「未登录时看到的页面」缓存下来
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type('html').send(renderLoginPage());
  };
}

/**
 * 登录页（无需前端构建，样式跟随默认主题）。
 * @param {{error?:string}} [options]
 */
export function renderLoginPage(options = {}) {
  const error = options.error
    ? `<p class="error">${options.error.replace(/[<>&]/g, '')}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>需要访问口令 · AI 网页 PPT 生成器</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; min-height: 100dvh;
    display: grid; place-items: center; padding: 24px;
    font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: radial-gradient(900px 520px at 20% 0%, #1b2a5e 0%, #0b1226 45%, #05070f 100%);
    color: #eef3ff;
  }
  .card {
    width: min(420px, 100%); padding: 28px;
    border-radius: 18px; border: 1px solid rgba(255,255,255,0.14);
    background: rgba(13,20,40,0.82); box-shadow: 0 30px 80px rgba(0,0,0,0.55);
    backdrop-filter: blur(12px);
  }
  h1 { margin: 0 0 6px; font-size: 19px; }
  p { margin: 0 0 18px; font-size: 13.5px; line-height: 1.7; color: #9fb0d4; }
  input {
    width: 100%; padding: 12px 14px; margin-bottom: 14px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,0.18);
    background: rgba(5,7,15,0.6); color: #eef3ff; font: inherit; font-size: 15px;
  }
  input:focus { outline: none; border-color: #6ea8fe; box-shadow: 0 0 0 3px rgba(110,168,254,0.25); }
  button {
    width: 100%; padding: 12px 16px; border: none; border-radius: 999px; cursor: pointer;
    font: inherit; font-size: 15px; font-weight: 700; color: #070b18;
    background: linear-gradient(120deg, #6ea8fe, #a78bfa);
  }
  button:active { transform: scale(0.98); }
  .error { color: #fda4af; font-size: 13px; margin: 0 0 12px; }
  .tip { margin: 16px 0 0; font-size: 12px; color: #7c8bb0; }
</style>
</head>
<body>
  <form class="card" method="POST" action="/api/auth">
    <h1>✦ AI 网页 PPT 生成器</h1>
    <p>这是一个受保护的分享链接，请输入访问口令后开始使用。</p>
    ${error}
    <input type="password" name="password" placeholder="访问口令" autocomplete="current-password" autofocus required />
    <button type="submit">进入</button>
    <p class="tip">口令由分享者提供。验证通过后本设备 30 天内免输入。</p>
  </form>
</body>
</html>`;
}
