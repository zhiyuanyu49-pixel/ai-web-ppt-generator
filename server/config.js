/**
 * 配置加载
 * ------------------------------------------------------------------
 * 优先读取项目根目录的 .env，其次读取进程环境变量（环境变量优先级更高）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * 极简 .env 解析（避免引入 dotenv 依赖）。
 * @param {string} file
 * @returns {Record<string,string>}
 */
function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT_DIR, '.env'));

/**
 * @param {string} key
 * @param {string} [fallback]
 */
function read(key, fallback = '') {
  const value = process.env[key] ?? fileEnv[key];
  return value === undefined || value === '' ? fallback : value;
}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));

export const config = {
  port: Number(read('PORT', '8787')),
  host: read('HOST', '127.0.0.1'),
  apiKey: read('DEEPSEEK_API_KEY'),
  baseUrl: read('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  /** 需求中指定的模型 id；启动时通过 /models 解析为真实可用 id */
  model: read('DEEPSEEK_MODEL', 'deepseek-V41-Flash'),
  requestTimeoutMs: Number(read('AI_TIMEOUT_MS', '300000')),
  /** 演示 / 自动化测试用的本地模拟模型（不消耗 API 额度） */
  mock: truthy(read('MOCK_AI', '0')),
  /** MOCK 模式的出字间隔（毫秒），测试里可以调大以便观察流式过程 */
  mockDelayMs: Number(read('MOCK_DELAY_MS', '6')),
  /** 生成上限，防止异常输出 */
  maxSlides: Number(read('MAX_SLIDES', '30')),
  /** 输入文案截断长度（字符） */
  maxInputChars: Number(read('MAX_INPUT_CHARS', '14000')),

  // ---------------- 分享 / 安全相关 ----------------
  /** 访问口令；为空则不校验（本地使用） */
  accessPassword: read('ACCESS_PASSWORD', ''),
  /** 每个 IP 每天可生成次数（保护额度） */
  ratePerDay: Number(read('RATE_LIMIT_PER_DAY', '15')),
  /** 每个 IP 每分钟请求数（防连点） */
  ratePerMinute: Number(read('RATE_LIMIT_PER_MINUTE', '3')),
  /** 全站每天生成总次数上限 */
  ratePerDayGlobal: Number(read('RATE_LIMIT_PER_DAY_GLOBAL', '200')),
  /** 同时进行的生成任务上限 */
  maxConcurrent: Number(read('MAX_CONCURRENT', '3')),
  /** 受信任的代理层数（内网穿透/反向代理下取真实 IP 用） */
  trustProxy: read('TRUST_PROXY', '1'),

  distDir: path.join(ROOT_DIR, 'dist'),
  sharedDir: path.join(ROOT_DIR, 'shared'),
};

export const hasApiKey = Boolean(config.apiKey);
