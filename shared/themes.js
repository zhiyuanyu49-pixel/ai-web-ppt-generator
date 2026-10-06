/**
 * 主题定义（前后端共用）
 * ------------------------------------------------------------------
 * 同一份主题令牌同时用于：
 *   1) 站内演示（前端把令牌写成 CSS 变量注入舞台根节点）
 *   2) 独立 HTML 导出（服务端把令牌渲染成 [data-theme="xx"] { ... } 规则）
 * 因此新增主题只需要在这里加一项，两端自动生效。
 */

/** @typedef {{id:string,name:string,desc:string,mode:'dark'|'light',tokens:Record<string,string>}} Theme */

/** @type {Theme[]} */
export const THEMES = [
  {
    id: 'midnight',
    name: '深空蓝',
    desc: '深色科技风，适合产品发布与技术分享',
    mode: 'dark',
    tokens: {
      '--bg': '#070b18',
      '--bg-soft': '#0d1428',
      '--slide-bg': 'radial-gradient(120% 120% at 12% 0%, #1b2a5e 0%, #0b1226 45%, #05070f 100%)',
      '--fg': '#eef3ff',
      '--muted': '#9fb0d4',
      '--accent': '#6ea8fe',
      '--accent-2': '#a78bfa',
      '--card': 'rgba(255,255,255,0.06)',
      '--border': 'rgba(255,255,255,0.14)',
      '--shadow': '0 30px 80px rgba(0,0,0,0.55)',
      '--grid': 'rgba(110,168,254,0.10)',
    },
  },
  {
    id: 'paper',
    name: '极简白',
    desc: '明亮干净的商务风，适合汇报与提案',
    mode: 'light',
    tokens: {
      '--bg': '#eef1f6',
      '--bg-soft': '#ffffff',
      '--slide-bg': 'linear-gradient(160deg, #ffffff 0%, #f4f7fd 60%, #e9eff9 100%)',
      '--fg': '#12192b',
      '--muted': '#5a6580',
      '--accent': '#2563eb',
      '--accent-2': '#0ea5e9',
      '--card': 'rgba(37,99,235,0.06)',
      '--border': 'rgba(18,25,43,0.12)',
      '--shadow': '0 24px 60px rgba(23,42,84,0.18)',
      '--grid': 'rgba(37,99,235,0.08)',
    },
  },
  {
    id: 'ocean',
    name: '深海青',
    desc: '青绿渐变的清爽科技风',
    mode: 'dark',
    tokens: {
      '--bg': '#04141a',
      '--bg-soft': '#0a2029',
      '--slide-bg': 'radial-gradient(120% 120% at 85% 10%, #0e4a52 0%, #062029 50%, #020c11 100%)',
      '--fg': '#e8feff',
      '--muted': '#8fc9cf',
      '--accent': '#22d3ee',
      '--accent-2': '#34d399',
      '--card': 'rgba(34,211,238,0.08)',
      '--border': 'rgba(232,254,255,0.16)',
      '--shadow': '0 30px 80px rgba(0,0,0,0.5)',
      '--grid': 'rgba(34,211,238,0.12)',
    },
  },
  {
    id: 'sunset',
    name: '落日暖阳',
    desc: '暖色高对比，适合创意与营销主题',
    mode: 'dark',
    tokens: {
      '--bg': '#170a12',
      '--bg-soft': '#26101d',
      '--slide-bg': 'radial-gradient(130% 120% at 10% 0%, #6d1b3c 0%, #33122b 48%, #150711 100%)',
      '--fg': '#fff3ec',
      '--muted': '#e3b6bd',
      '--accent': '#fb7185',
      '--accent-2': '#fbbf24',
      '--card': 'rgba(251,113,133,0.10)',
      '--border': 'rgba(255,243,236,0.18)',
      '--shadow': '0 30px 80px rgba(0,0,0,0.55)',
      '--grid': 'rgba(251,113,133,0.12)',
    },
  },
  {
    id: 'forest',
    name: '青竹绿',
    desc: '自然清新的浅色风，适合教育与方法论',
    mode: 'light',
    tokens: {
      '--bg': '#e9f1ea',
      '--bg-soft': '#ffffff',
      '--slide-bg': 'linear-gradient(155deg, #ffffff 0%, #f1f8f0 55%, #e3efe4 100%)',
      '--fg': '#0f2417',
      '--muted': '#4b6a55',
      '--accent': '#15803d',
      '--accent-2': '#0d9488',
      '--card': 'rgba(21,128,61,0.07)',
      '--border': 'rgba(15,36,23,0.12)',
      '--shadow': '0 24px 60px rgba(19,64,40,0.18)',
      '--grid': 'rgba(21,128,61,0.09)',
    },
  },
  {
    id: 'graphite',
    name: '石墨黑',
    desc: '黑白极简，适合设计与严肃场合',
    mode: 'dark',
    tokens: {
      '--bg': '#0b0b0c',
      '--bg-soft': '#151517',
      '--slide-bg': 'linear-gradient(150deg, #1c1c1f 0%, #101012 55%, #08080a 100%)',
      '--fg': '#f4f4f5',
      '--muted': '#a1a1aa',
      '--accent': '#e5e7eb',
      '--accent-2': '#9ca3af',
      '--card': 'rgba(255,255,255,0.05)',
      '--border': 'rgba(255,255,255,0.16)',
      '--shadow': '0 30px 80px rgba(0,0,0,0.6)',
      '--grid': 'rgba(255,255,255,0.07)',
    },
  },
];

export const DEFAULT_THEME_ID = 'midnight';

/** @type {string[]} */
export const THEME_IDS = THEMES.map((t) => t.id);

/**
 * 取主题对象，未知 id 回退到默认主题。
 * @param {string} [id]
 * @returns {Theme}
 */
export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID) || THEMES[0];
}

/**
 * 把主题令牌拼成一段 CSS 变量声明，便于内联到 style 属性。
 * @param {string} [id]
 * @returns {string}
 */
export function themeVarsInline(id) {
  const theme = getTheme(id);
  return Object.entries(theme.tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/**
 * 生成所有主题的 CSS 变量规则（导出 HTML 时使用）。
 * @returns {string}
 */
export function themeCssRules() {
  return THEMES.map((theme) => {
    const body = Object.entries(theme.tokens)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return `[data-theme="${theme.id}"] {\n${body}\n  color-scheme: ${theme.mode};\n}`;
  }).join('\n\n');
}
