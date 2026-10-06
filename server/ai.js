/**
 * DeepSeek（OpenAI 兼容协议）客户端
 * ------------------------------------------------------------------
 * - 纯 fetch 实现，无第三方 SDK
 * - 支持流式（SSE）输出，逐 token 回调
 * - 支持把「需求指定的模型 id」解析成 /models 中真实存在的 id
 */
import { config } from './config.js';

/** @type {{id:string,name:string}[]|null} */
let cachedModels = null;
let resolvedModel = null;

/**
 * 规范化模型名：去掉大小写、连字符、点、空格等差异，便于模糊匹配。
 * 例：deepseek-V41-Flash -> deepseekv41flash（可与 name "DeepSeek-V4.1-Flash" 匹配）
 * @param {string} value
 */
export function normalizeModelName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * 拉取模型列表（带内存缓存）。
 * @param {{force?:boolean}} [options]
 * @returns {Promise<{id:string,name:string}[]>}
 */
export async function listModels(options = {}) {
  if (cachedModels && !options.force) return cachedModels;
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`获取模型列表失败（HTTP ${response.status}）${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  const data = await response.json();
  cachedModels = (data?.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
  return cachedModels;
}

/**
 * 把配置中的模型 id 解析成真实可用 id。
 * 依次尝试：精确匹配 -> 忽略大小写 -> 规范化匹配（id 或展示名）。
 * @returns {Promise<{requested:string,resolved:string,matchedBy:string}>}
 */
export async function resolveModel() {
  const requested = config.model;
  if (resolvedModel) return resolvedModel;
  if (config.mock) {
    resolvedModel = { requested, resolved: requested, matchedBy: 'mock' };
    return resolvedModel;
  }
  try {
    const models = await listModels();
    const exact = models.find((m) => m.id === requested);
    if (exact) {
      resolvedModel = { requested, resolved: exact.id, matchedBy: 'exact' };
      return resolvedModel;
    }
    const lower = models.find((m) => m.id.toLowerCase() === requested.toLowerCase());
    if (lower) {
      resolvedModel = { requested, resolved: lower.id, matchedBy: 'case-insensitive' };
      return resolvedModel;
    }
    const target = normalizeModelName(requested);
    const fuzzy = models.find(
      (m) => normalizeModelName(m.id) === target || normalizeModelName(m.name) === target,
    );
    if (fuzzy) {
      resolvedModel = { requested, resolved: fuzzy.id, matchedBy: 'normalized-name' };
      return resolvedModel;
    }
    // 解析不到就原样使用，交给服务端报错，同时记录可用列表便于排查
    resolvedModel = {
      requested,
      resolved: requested,
      matchedBy: 'fallback',
      available: models.map((m) => m.id),
    };
    return resolvedModel;
  } catch (error) {
    resolvedModel = { requested, resolved: requested, matchedBy: 'error', error: String(error?.message || error) };
    return resolvedModel;
  }
}

/** 仅供测试重置缓存 */
export function __resetModelCache() {
  cachedModels = null;
  resolvedModel = null;
}

/**
 * 解析一段 SSE 数据块，回调每个事件。
 * @param {string} chunk
 * @param {(event:{event:string,data:string}) => void} onEvent
 */
function parseSseChunk(chunk, onEvent) {
  // 事件之间以空行分隔
  const blocks = chunk.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = 'message';
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue; // 注释 / 心跳
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) onEvent({ event, data: dataLines.join('\n') });
  }
}

/**
 * 流式对话补全（OpenAI 兼容 /chat/completions）。
 *
 * @param {Object} options
 * @param {Array<{role:string,content:string}>} options.messages
 * @param {number} [options.temperature]
 * @param {number} [options.maxTokens]
 * @param {string} [options.model]
 * @param {AbortSignal} [options.signal]
 * @param {(delta:{content?:string,reasoning?:string}) => void} [options.onDelta]
 * @returns {Promise<{content:string,reasoning:string,usage:any,finishReason:string|null,model:string}>}
 */
export async function streamChat(options) {
  const {
    messages,
    temperature = 0.7,
    maxTokens = 8192,
    signal,
    onDelta,
    model,
  } = options;

  const { resolved } = await resolveModel();
  const useModel = model || resolved;

  const body = {
    model: useModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: combinedSignal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message || text;
    } catch {
      /* 保留原始文本 */
    }
    throw new Error(`大模型接口返回 HTTP ${response.status}：${String(message).slice(0, 400)}`);
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;

  /** 处理一个完整的 SSE 事件块 */
  const handleBlock = (block) => {
    parseSseChunk(block, ({ data }) => {
      if (data === '[DONE]') return;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        return; // 忽略无法解析的心跳/脏数据
      }
      if (json.usage) usage = json.usage;
      const choice = json.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        onDelta?.({ reasoning: delta.reasoning_content });
      }
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta?.({ content: delta.content });
      }
    });
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      handleBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleBlock(buffer);

  if (!content.trim() && !reasoning.trim()) {
    throw new Error('大模型没有返回任何内容，请重试或检查模型配置。');
  }

  return { content, reasoning, usage, finishReason, model: useModel };
}
