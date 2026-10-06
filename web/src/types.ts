/** 前后端共享的数据结构定义 */

export type SlideLayout =
  | 'cover'
  | 'section'
  | 'bullets'
  | 'two-column'
  | 'stats'
  | 'timeline'
  | 'quote'
  | 'closing';

export interface Column {
  heading?: string;
  items?: string[];
}

export interface Stat {
  value?: string;
  label?: string;
}

export interface TimelineItem {
  time?: string;
  text?: string;
}

export interface Quote {
  text?: string;
  author?: string;
}

export interface Slide {
  layout?: SlideLayout;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  columns?: Column[];
  stats?: Stat[];
  timeline?: TimelineItem[];
  quote?: Quote;
  notes?: string;
}

export interface DeckMeta {
  generatedAt?: string;
  model?: string;
  requestedModel?: string;
  matchedBy?: string;
  mock?: boolean;
  elapsedMs?: number;
  repaired?: boolean;
  declaredSlideCount?: number;
}

export interface Deck {
  title: string;
  subtitle?: string;
  slideCount: number;
  slides: Slide[];
  meta?: DeckMeta;
}

export interface ThemeTokens {
  [key: string]: string;
}

export interface Theme {
  id: string;
  name: string;
  desc: string;
  mode: 'dark' | 'light';
  tokens: ThemeTokens;
}

export type StyleId = 'business' | 'tech' | 'edu' | 'creative' | 'report';
export type LanguageId = 'zh' | 'en' | 'auto';

export type ProviderId = 'deepseek' | 'zhipu' | 'kimi';

/** 供应商下拉里的一个候选模型 */
export interface ModelOption {
  id: string;
  name: string;
  note?: string;
}

/** 健康检查返回的供应商信息（不含任何密钥） */
export interface ProviderOption {
  id: ProviderId;
  label: string;
  configured: boolean;
  needsKeyEnv?: string;
  models: ModelOption[];
  defaultModel: string;
}

export interface GenerateInput {
  text: string;
  title?: string;
  slideCount?: number;
  language?: LanguageId;
  style?: StyleId;
  /** 模型供应商，缺省由服务端默认配置决定 */
  provider?: ProviderId;
  /** 模型 id，缺省使用该供应商的默认模型 */
  model?: string;
}

export interface ProgressState {
  phase: string;
  message: string;
  slidesDone: number;
  slidesExpected: number;
  chars: number;
  elapsedMs: number;
}

export interface ModelInfo {
  requestedModel?: string;
  resolvedModel?: string;
  matchedBy?: string;
  mock?: boolean;
  slidesExpected?: number;
  provider?: ProviderId;
  providerLabel?: string;
}

export interface HealthInfo {
  ok: boolean;
  hasApiKey: boolean;
  mock: boolean;
  baseUrl: string;
  requestedModel: string;
  resolvedModel: string;
  matchedBy: string;
  provider: string;
  providers: ProviderOption[];
  themes: string[];
}

export interface RenderOptions {
  index?: number;
  total?: number;
  brand?: string;
  notes?: boolean;
}

export type GenerateEventName =
  | 'meta'
  | 'status'
  | 'thinking'
  | 'token'
  | 'progress'
  | 'slide'
  | 'usage'
  | 'deck'
  | 'done'
  | 'error';
