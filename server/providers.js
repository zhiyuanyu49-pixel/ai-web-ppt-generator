/**
 * 模型供应商注册表
 * ------------------------------------------------------------------
 * DeepSeek、智谱 GLM、Kimi（Moonshot）三家都提供 OpenAI 兼容协议，
 * 差异只体现在三处：base_url、API Key、模型 id。
 * 因此调用层可以完全共用同一套 SSE 解析与流式逻辑，只需在这里登记元数据。
 *
 * 如果需要接入第四家 OpenAI 兼容服务，只要在这里加一条即可，无需改动 ai.js。
 */

/** 下拉展示顺序 */
export const PROVIDER_ORDER = ['deepseek', 'zhipu', 'kimi'];

/**
 * @typedef {Object} ProviderDef
 * @property {string} id
 * @property {string} label            供应商展示名
 * @property {string} envKey           API Key 的环境变量名
 * @property {string} baseUrlEnv       base_url 的环境变量名
 * @property {string} modelEnv         默认模型 id 的环境变量名
 * @property {string} defaultBaseUrl   未配置时使用的官方端点
 * @property {string} defaultModel     未配置时使用的推荐模型
 * @property {string} docsUrl          控制台/文档地址，便于报错时提示
 * @property {{id:string,name:string,note?:string}[]} models 下拉候选模型
 */

/** @type {Record<string, ProviderDef>} */
export const PROVIDER_DEFS = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash', note: '速度快、成本低，日常首选' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', note: '通用能力均衡' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', note: '深度推理，结构更严谨' },
    ],
  },

  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    envKey: 'ZHIPU_API_KEY',
    baseUrlEnv: 'ZHIPU_BASE_URL',
    modelEnv: 'ZHIPU_MODEL',
    // 国内端：open.bigmodel.cn；国际端：api.z.ai，两者路径一致，可在 .env 覆盖
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-4.7', name: 'GLM-4.7', note: '性价比好，推荐' },
      { id: 'glm-4.6', name: 'GLM-4.6', note: '旗舰，推理与工具能力强' },
      { id: 'glm-4.5-air', name: 'GLM-4.5-Air', note: '轻量快速' },
      { id: 'glm-4-flash', name: 'GLM-4-Flash', note: '有免费额度' },
    ],
  },

  kimi: {
    id: 'kimi',
    label: 'Kimi',
    envKey: 'KIMI_API_KEY',
    baseUrlEnv: 'KIMI_BASE_URL',
    modelEnv: 'KIMI_MODEL',
    // 国内端：api.moonshot.cn；国际端：api.moonshot.ai，路径一致
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k2.5', name: 'Kimi K2.5', note: '旗舰模型，复杂任务首选' },
      { id: 'kimi-latest', name: 'Kimi Latest', note: '始终跟随最新 Kimi 模型' },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 · 128K', note: '长文档处理' },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 · 32K', note: '中等长度任务' },
    ],
  },
};

/**
 * 取供应商定义，未知 id 一律回退到 DeepSeek。
 * @param {string} [id]
 * @returns {ProviderDef}
 */
export function getProviderDef(id) {
  return PROVIDER_DEFS[String(id || '').toLowerCase()] || PROVIDER_DEFS.deepseek;
}

/**
 * 校验并归一化供应商 id。
 * @param {string|undefined|null} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeProviderId(value, fallback = 'deepseek') {
  const id = String(value || '').trim().toLowerCase();
  if (PROVIDER_DEFS[id]) return id;
  return PROVIDER_DEFS[fallback] ? fallback : 'deepseek';
}
