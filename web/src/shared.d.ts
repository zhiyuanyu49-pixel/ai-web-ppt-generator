/** 共享 JS 模块的类型声明（这些文件本身是纯 JS，前后端共用） */

declare module '*shared/themes.js' {
  import type { Theme } from '../types';
  export const THEMES: Theme[];
  export const DEFAULT_THEME_ID: string;
  export const THEME_IDS: string[];
  export function getTheme(id?: string): Theme;
  export function themeVarsInline(id?: string): string;
  export function themeCssRules(): string;
}

declare module '*shared/slide-render.js' {
  import type { RenderOptions, Slide } from '../types';
  export const LAYOUTS: string[];
  export function escapeHtml(value: unknown): string;
  export function richText(value: unknown): string;
  export function toStringList(value: unknown, max?: number): string[];
  export function resolveLayout(slide: Record<string, unknown>, index?: number): string;
  export function resolveDensity(slide: Record<string, unknown>, layout: string): string;
  export function renderSlide(slide: Slide | Record<string, unknown>, options?: RenderOptions): string;
  export function renderSlides(slides: Slide[], options?: RenderOptions): string;
}
