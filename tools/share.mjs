/**
 * 公网分享：把本机服务映射成一个公网 https 链接
 * ------------------------------------------------------------------
 * 两种隧道方式（都不需要账号、不需要备案）：
 *   1) ssh      —— 使用 Windows 自带的 ssh.exe 连到 localhost.run，零下载、秒级可用（默认）
 *   2) cloudflared —— Cloudflare Quick Tunnel，更稳定，首次需下载约 55MB
 *
 * 用法：
 *   node tools/share.mjs                     # 自动选择（有 cloudflared.exe 就用它，否则用 ssh）
 *   node tools/share.mjs --provider ssh
 *   node tools/share.mjs --provider cloudflared
 *   node tools/share.mjs --port 8787
 *
 * 把打印出来的链接 + 访问口令发给别人即可；本进程保持运行，Ctrl+C 结束分享。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLOUDFLARED = path.join(ROOT, 'tools', 'cloudflared.exe');
const DOWNLOAD_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

const argv = process.argv.slice(2);
const readArg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(readArg('port', process.env.PORT || 8787));
let provider = String(readArg('provider', 'auto')).toLowerCase();

/** 读取 .env 里的访问口令，用于提示分享信息 */
function readAccessPassword() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('ACCESS_PASSWORD='));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

/** 先确认本机服务在跑 */
async function assertServerUp() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(
      `本机服务（http://127.0.0.1:${PORT}）未启动或不可用：${error.message}\n        请先运行 npm start（或双击 start.bat）`,
    );
  }
}

/** 下载 cloudflared（仅 cloudflared 方式需要） */
async function ensureCloudflared() {
  if (fs.existsSync(CLOUDFLARED)) return true;
  process.stdout.write('[share] 首次使用 cloudflared，正在下载（约 55MB，网络慢时请改用 --provider ssh）...\n');
  try {
    const response = await fetch(DOWNLOAD_URL, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(CLOUDFLARED, buffer);
    console.log(`[share] 已保存 tools/cloudflared.exe（${(buffer.length / 1048576).toFixed(1)} MB）`);
    return true;
  } catch (error) {
    console.log(`[share] cloudflared 下载失败（${error.message}），改用 ssh 隧道`);
    return false;
  }
}

/** 是否检测到 ssh 客户端 */
function hasSsh() {
  const candidates = [
    'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'OpenSSH\\ssh.exe') : '',
  ];
  return candidates.some((p) => p && fs.existsSync(p));
}

/** 打印分享信息 */
function announce(url, password) {
  console.log('');
  console.log('  ============================================================');
  console.log(`   公网链接: ${url}`);
  if (password) console.log(`   访问口令: ${password}`);
  console.log('  ============================================================');
  console.log('');
  console.log('   把上面两行发给别人，他们打开链接、输入口令即可使用。');
  console.log('   保持本窗口开着；按 Ctrl+C 结束分享（链接立即失效）。');
  console.log('');
}

// ------------------------------ 主流程 ------------------------------
const health = await assertServerUp();
const password = readAccessPassword();

console.log('');
console.log('  ✦ 正在建立公网隧道');
console.log(`  ➜ 本机服务: http://127.0.0.1:${PORT}（模型 ${health.resolvedModel}${health.mock ? ' · MOCK' : ''}）`);
console.log(`  ➜ 访问口令: ${password ? password : '（未设置！任何人拿到链接都能用你的额度，建议在 .env 配置 ACCESS_PASSWORD）'}`);

if (provider === 'auto') {
  provider = (await ensureCloudflared()) ? 'cloudflared' : 'ssh';
}
if (provider === 'cloudflared' && !(await ensureCloudflared())) provider = 'ssh';
if (provider === 'ssh' && !hasSsh()) {
  throw new Error('未找到 ssh 客户端。请安装"OpenSSH 客户端"功能，或使用 --provider cloudflared');
}

console.log(`  ➜ 隧道方式: ${provider}`);
console.log('  ➜ 正在连接，请稍候...');

/** 启动一次隧道进程 */
function spawnTunnel() {
  if (provider === 'cloudflared') {
    return spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return spawn(
    'ssh',
    [
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      `UserKnownHostsFile=${path.join(ROOT, 'tools', 'known_hosts')}`,
      '-o',
      'ServerAliveInterval=20',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'TCPKeepAlive=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      `80:127.0.0.1:${PORT}`,
      'nokey@localhost.run',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

// 只匹配真正的隧道地址（localhost.run 的欢迎信息里会出现 admin.localhost.run，必须排除）
const URL_RE = /https:\/\/[a-z0-9-]+\.(?:trycloudflare\.com|lhr\.life)/i;
const MAX_RETRIES = 20;
let announced = false;
let stopping = false;
let attempts = 0;
/** @type {import('node:child_process').ChildProcess|null} */
let child = null;
/** @type {NodeJS.Timeout|null} */
let retryTimer = null;

function startTunnel() {
  child = spawnTunnel();

  const onData = (chunk) => {
    const text = chunk.toString();
    if (process.env.SHARE_DEBUG) process.stderr.write(text);
    const match = text.match(URL_RE);
    if (match && !announced) {
      announced = true;
      attempts = 0;
      announce(match[0], password);
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('exit', (code) => {
    if (stopping) {
      console.log('[share] 隧道已按你的要求关闭，分享结束。');
      process.exit(0);
    }
    attempts += 1;
    if (attempts > MAX_RETRIES) {
      console.log(`[share] 隧道连续断开 ${MAX_RETRIES} 次，停止重连。请检查网络后重新运行。`);
      process.exit(1);
    }
    if (announced) {
      console.log('');
      console.log(`[share] ⚠ 隧道被断开（code=${code}），${Math.min(5 + attempts * 3, 20)} 秒后自动重连（第 ${attempts}/${MAX_RETRIES} 次）。`);
      console.log('[share] ⚠ 免费隧道重连后地址会变化，请把新的链接重新发给对方。');
    }
    announced = false;
    retryTimer = setTimeout(startTunnel, Math.min(5 + attempts * 3, 20) * 1000);
  });
}

startTunnel();

const shutdown = () => {
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  child?.kill();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 兜底：60 秒还没拿到地址就提示排查
setTimeout(() => {
  if (!announced && attempts === 0) {
    console.log('[share] 60 秒内未获取到公网地址，正在退出。可加 SHARE_DEBUG=1 查看隧道原始日志。');
    stopping = true;
    child?.kill();
    process.exit(1);
  }
}, 60_000);
