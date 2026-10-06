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

export interface GenerateInput {
  text: string;
  title?: string;
  slideCount?: number;
  language?: LanguageId;
  style?: StyleId;
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
}

export interface HealthInfo {
  ok: boolean;
  hasApiKey: boolean;
  mock: boolean;
  baseUrl: string;
  requestedModel: string;
  resolvedModel: string;
  matchedBy: string;
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
