/**
 * 前端 API 客户端
 * - 流式生成：POST + fetch ReadableStream 手工解析 SSE（比 EventSource 更灵活，支持 POST 大文本）
 * - 导出：直接把服务端生成的独立 HTML 保存为文件
 */
import type { Deck, GenerateEventName, GenerateInput, HealthInfo, Theme } from '../types';

export interface StreamHandlers {
  onEvent?: (event: GenerateEventName, data: any) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  signal?: AbortSignal;
}

/** 会话失效（口令过期 / 被清除）时回到登录页 */
function handleUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.reload();
    return true;
  }
  return false;
}

/** 解析单块 SSE 文本，返回事件数组 */
function parseSseBlocks(buffer: string): { events: { event: string; data: any }[]; rest: string } {
  const events: { event: string; data: any }[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    if (!block.trim() || block.startsWith(':')) continue;
    let name = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    let data: any = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* 保留原始字符串 */
    }
    events.push({ event: name, data });
  }
  return { events, rest };
}

/**
 * 调用 /api/generate 流式生成 PPT。
 * @returns 最终 deck（若流在结束前中断则返回 null）
 */
export async function streamGenerate(input: GenerateInput, handlers: StreamHandlers = {}): Promise<Deck | null> {
  let deck: Deck | null = null;
  let errorMessage = '';
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: handlers.signal,
    });

    if (!response.ok) {
      if (handleUnauthorized(response)) throw new Error('访问口令已失效，正在返回登录页…');
      const text = await response.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text)?.error || text;
      } catch {
        /* 保留原文 */
      }
      throw new Error(message || `请求失败（HTTP ${response.status}）`);
    }
    if (!response.body) throw new Error('当前浏览器不支持流式响应。');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseBlocks(buffer);
      buffer = rest;
      for (const { event, data } of events) {
        if (event === 'end') continue;
        handlers.onEvent?.(event as GenerateEventName, data);
        if (event === 'deck') deck = data?.deck ?? null;
        if (event === 'error') errorMessage = String(data?.message || '生成失败');
      }
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      handlers.onClose?.();
      return null;
    }
    throw error;
  }
  if (errorMessage) throw new Error(errorMessage);
  handlers.onClose?.();
  return deck;
}

/** 健康检查 / 模型信息 */
export async function fetchHealth(): Promise<HealthInfo> {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error(`健康检查失败（HTTP ${response.status}）`);
  return response.json();
}

/** 主题列表 */
export async function fetchThemes(): Promise<Theme[]> {
  const response = await fetch('/api/themes');
  if (handleUnauthorized(response)) throw new Error('需要访问口令');
  if (!response.ok) throw new Error(`获取主题失败（HTTP ${response.status}）`);
  const data = await response.json();
  return data.themes as Theme[];
}

/** 示例文案 */
export async function fetchSampleText(): Promise<string> {
  const response = await fetch('/api/deck/sample');
  if (!response.ok) return '';
  const data = await response.json();
  return String(data.text || '');
}

/** 触发浏览器下载 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 导出独立 HTML（由服务端渲染内联样式与运行时）。
 */
export async function exportDeckHtml(deck: Deck, theme: string, notes: boolean): Promise<string> {
  const response = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck, theme, notes }),
  });
  if (!response.ok) {
    if (handleUnauthorized(response)) throw new Error('访问口令已失效，正在返回登录页…');
    const text = await response.text().catch(() => '');
    let message = text;
    try {
      message = JSON.parse(text)?.error || text;
    } catch {
      /* 保留原文 */
    }
    throw new Error(message || `导出失败（HTTP ${response.status}）`);
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = match ? decodeURIComponent(match[1]) : `${deck.title || 'presentation'}.html`;
  const blob = await response.blob();
  downloadBlob(blob, filename);
  return filename;
}

/** 导出 deck JSON（便于二次加工） */
export function exportDeckJson(deck: Deck) {
  const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `${(deck.title || 'presentation').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)}.json`);
}

/** 复制文本 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
