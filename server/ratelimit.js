/**
 * 轻量限流（内存实现）
 * ------------------------------------------------------------------
 * 目的：公网分享时保护你的大模型额度。三重限制：
 *   1. 单 IP 每分钟请求数（防连点）
 *   2. 单 IP 每天生成次数（防单人刷爆）
 *   3. 全局每天生成次数 + 并发上限（防整体超支）
 * 只对真正花钱的 /api/generate 计数，普通浏览不受影响。
 */
import { config } from './config.js';

const minuteHits = new Map();
const dayHits = new Map();

let dayKey = new Date().toISOString().slice(0, 10);
let dayTotal = 0;
let running = 0;

function rolloverIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayTotal = 0;
    dayHits.clear();
    minuteHits.clear();
  }
}

/**
 * 取客户端 IP（兼容内网穿透/反向代理）。
 * @param {import('express').Request} req
 */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * 检查是否允许本次生成。
 * @param {import('express').Request} req
 * @returns {{allowed:true}|{allowed:false, status:number, message:string, retryAfter?:number}}
 */
export function checkGenerateLimit(req) {
  rolloverIfNeeded();
  const ip = clientIp(req);
  const now = Date.now();

  if (running >= config.maxConcurrent) {
    return { allowed: false, status: 429, message: `当前有 ${running} 个生成任务正在进行，请稍后再试。` };
  }

  const minute = minuteHits.get(ip) || [];
  const recent = minute.filter((t) => now - t < 60_000);
  if (recent.length >= config.ratePerMinute) {
    const wait = Math.ceil((60_000 - (now - recent[0])) / 1000);
    minuteHits.set(ip, recent);
    return { allowed: false, status: 429, message: `操作太快了，请 ${wait} 秒后再试。`, retryAfter: wait };
  }

  const today = dayHits.get(ip) || 0;
  if (today >= config.ratePerDay) {
    return { allowed: false, status: 429, message: `今天的生成次数已用完（每人每天 ${config.ratePerDay} 次），请明天再来。` };
  }

  if (dayTotal >= config.ratePerDayGlobal) {
    return { allowed: false, status: 429, message: '今天的全站生成额度已用完，请明天再来。' };
  }

  return { allowed: true };
}

/**
 * 记录一次已开始的生成（在通过校验后调用）。
 * @param {import('express').Request} req
 * @returns {() => void} 结束回调（在生成完成或中断时调用，释放并发计数）
 */
export function recordGenerateStart(req) {
  rolloverIfNeeded();
  const ip = clientIp(req);
  const now = Date.now();
  minuteHits.set(ip, [...(minuteHits.get(ip) || []).filter((t) => now - t < 60_000), now]);
  dayHits.set(ip, (dayHits.get(ip) || 0) + 1);
  dayTotal += 1;
  running += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      running = Math.max(0, running - 1);
    }
  };
}

/** 当前用量快照（供 /api/health 展示） */
export function usageSnapshot() {
  rolloverIfNeeded();
  return {
    day: dayKey,
    perDay: config.ratePerDay,
    perMinute: config.ratePerMinute,
    globalDayTotal: dayTotal,
    globalPerDay: config.ratePerDayGlobal,
    running,
    maxConcurrent: config.maxConcurrent,
    visitorsToday: dayHits.size,
  };
}

/** 仅供测试：重置计数 */
export function __resetLimits() {
  minuteHits.clear();
  dayHits.clear();
  dayTotal = 0;
  running = 0;
}
