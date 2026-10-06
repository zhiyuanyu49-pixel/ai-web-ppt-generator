/** AI 网页 PPT 生成器 · 应用主入口 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { DeckView } from './components/DeckView';
import { ProgressPanel } from './components/ProgressPanel';
import { useGeneration } from './lib/hooks';
import {
  copyText,
  exportDeckHtml,
  exportDeckJson,
  fetchHealth,
  fetchSampleText,
  fetchThemes,
} from './lib/api';
import { THEMES as FALLBACK_THEMES, getTheme } from '../../shared/themes.js';
import type { CSSProperties } from 'react';
import type { HealthInfo, LanguageId, ProviderId, ProviderOption, StyleId, Theme } from './types';

/**
 * 取供应商的默认模型。
 * 服务端给的默认值（来自 .env）若在候选清单里不存在——比如老配置写了别名
 * `deepseek-V41-Flash`——就回退到清单第一项，避免下拉显示出一个孤零零的选项。
 */
function pickDefaultModel(provider?: ProviderOption): string {
  if (!provider) return '';
  if (provider.models.some((item) => item.id === provider.defaultModel)) return provider.defaultModel;
  return provider.models[0]?.id ?? '';
}

type View = 'compose' | 'present';

export default function App() {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [slideCount, setSlideCount] = useState(0);
  const [language, setLanguage] = useState<LanguageId>('zh');
  const [style, setStyle] = useState<StyleId>('business');
  const [provider, setProvider] = useState<ProviderId>('deepseek');
  const [model, setModel] = useState<string>('');

  const [themes, setThemes] = useState<Theme[]>(FALLBACK_THEMES as Theme[]);
  const [theme, setTheme] = useState<string>(() => {
    try {
      return window.localStorage.getItem('webppt:theme') || 'midnight';
    } catch {
      return 'midnight';
    }
  });
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [view, setView] = useState<View>('compose');
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const { state, start, cancel, reset } = useGeneration();
  const { status, deck, slides } = state;

  // 当前主题：令牌需要尽早算出来，供下面的副作用与根节点样式使用
  const activeTheme = useMemo(() => getTheme(theme), [theme]);
  // 关键：把主题令牌注入到应用根节点，幻灯片、缩略图与页面外壳共享同一套 CSS 变量
  const themeStyle = useMemo(
    () => Object.fromEntries(Object.entries(activeTheme.tokens)) as CSSProperties,
    [activeTheme],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // 初始化：主题列表 + 服务端状态
  useEffect(() => {
    let alive = true;
    fetchThemes()
      .then((list) => {
        if (alive && list.length) setThemes(list);
      })
      .catch(() => undefined);
    fetchHealth()
      .then((info) => {
        if (alive) setHealth(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 服务连通后，默认选中第一个「已配置 Key」的供应商及其推荐模型（只做一次）
  const providerPickedRef = useRef(false);
  useEffect(() => {
    const list = health?.providers;
    if (!list?.length || providerPickedRef.current) return;
    const first = list.find((item) => item.configured) ?? list[0];
    providerPickedRef.current = true;
    setProvider(first.id);
    setModel(pickDefaultModel(first));
  }, [health]);

  // 主题持久化 + 同步到 body（避免滚动越界时露出底色）
  useEffect(() => {
    try {
      window.localStorage.setItem('webppt:theme', theme);
    } catch {
      /* 忽略隐私模式报错 */
    }
    document.body.style.background = activeTheme.tokens['--bg'] || '#070b18';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', activeTheme.tokens['--bg'] || '#070b18');
  }, [theme, activeTheme]);

  // 生成完成后自动进入演示模式
  useEffect(() => {
    if (status === 'done' && deck && deck.slides.length) {
      const timer = window.setTimeout(() => setView('present'), 650);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [status, deck]);

  const handleProviderChange = useCallback(
    (next: ProviderId) => {
      setProvider(next);
      // 切换供应商时同步到该供应商的推荐模型，避免拿 A 家的 id 去调 B 家
      const target = health?.providers?.find((item) => item.id === next);
      setModel(pickDefaultModel(target));
    },
    [health],
  );

  const handleGenerate = useCallback(() => {
    setView('compose');
    void start({ text, title, slideCount, language, style, provider, model });
  }, [language, model, provider, slideCount, start, style, text, title]);

  const handleSample = useCallback(async () => {
    const sample = await fetchSampleText();
    if (sample) {
      setText(sample);
      showToast('已填入示例文案');
    }
  }, [showToast]);

  const handleClear = useCallback(() => {
    setText('');
    setTitle('');
    reset();
  }, [reset]);

  const handleExportHtml = useCallback(async () => {
    if (!deck) return;
    setExporting(true);
    try {
      const filename = await exportDeckHtml(deck, theme, false);
      showToast(`已导出 ${filename}`);
    } catch (error: any) {
      showToast(`导出失败：${error?.message || error}`);
    } finally {
      setExporting(false);
    }
  }, [deck, showToast, theme]);

  const handleCopyJson = useCallback(async () => {
    if (!deck) return;
    const ok = await copyText(JSON.stringify(deck, null, 2));
    showToast(ok ? '已复制 deck JSON' : '复制失败，请手动下载 JSON');
  }, [deck, showToast]);

  const currentSlides = deck?.slides ?? slides;

  // Ctrl/Cmd + Enter 触发生成
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && view === 'compose') {
        event.preventDefault();
        if (text.trim().length >= 20 && status !== 'running') handleGenerate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleGenerate, status, text, view]);

  return (
    <div className="app" data-theme={activeTheme.id} data-view={view} style={themeStyle}>
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ✦
          </span>
          <span className="brand__text">
            <strong>AI 网页 PPT 生成器</strong>
            <small>长文案 → 可演示的网页幻灯片</small>
          </span>
        </div>

        <div className="app__header-right">
          {health && (
            <span
              className={`chip ${health.mock ? 'chip--warn' : 'chip--ok'}`}
              title={`base_url: ${health.baseUrl}\n请求模型: ${health.requestedModel}\n实际模型: ${health.resolvedModel}\n匹配方式: ${health.matchedBy}`}
            >
              <span className="dot" aria-hidden="true" />
              {health.mock ? 'MOCK 模式' : health.resolvedModel}
            </span>
          )}
          <div className="theme-picker" role="group" aria-label="配色主题">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-dot ${theme === t.id ? 'is-active' : ''}`}
                style={{ ['--dot' as string]: t.tokens['--accent'], ['--dot-bg' as string]: t.tokens['--bg'] }}
                title={`${t.name} · ${t.desc}`}
                aria-label={`切换到主题 ${t.name}`}
                onClick={() => setTheme(t.id)}
              />
            ))}
            <span className="theme-picker__name">{activeTheme.name}</span>
          </div>
          {currentSlides.length > 0 && view === 'compose' && (
            <button type="button" className="btn btn--small" onClick={() => setView('present')}>
              演示模式
            </button>
          )}
        </div>
      </header>

      <main className="app__main">
        {view === 'present' && deck && deck.slides.length ? (
          <DeckView
            deck={deck}
            themes={themes}
            theme={theme}
            onThemeChange={setTheme}
            onBack={() => setView('compose')}
            onExportHtml={handleExportHtml}
            onExportJson={() => {
              exportDeckJson(deck);
              showToast('已开始下载 JSON');
            }}
            onCopyJson={handleCopyJson}
            exporting={exporting}
          />
        ) : (
          <div className="compose-grid">
            <Composer
              text={text}
              title={title}
              slideCount={slideCount}
              language={language}
              style={style}
              providers={health?.providers ?? []}
              provider={provider}
              model={model}
              running={status === 'running'}
              hasDeck={Boolean(deck)}
              onTextChange={setText}
              onTitleChange={setTitle}
              onSlideCountChange={setSlideCount}
              onLanguageChange={setLanguage}
              onStyleChange={setStyle}
              onProviderChange={handleProviderChange}
              onModelChange={setModel}
              onGenerate={handleGenerate}
              onCancel={cancel}
              onSample={handleSample}
              onClear={handleClear}
              onExportJson={deck ? () => exportDeckJson(deck) : undefined}
            />
            <ProgressPanel state={state} onOpenDeck={() => setView('present')} />
          </div>
        )}
      </main>

      <footer className="app__footer">
        <span>流式生成 · 多主题 · 独立 HTML 导出</span>
        <span className="app__footer-hint">
          快捷键：← → 翻页 · F 全屏 · O 总览 · T 主题 · N 备注 · Ctrl/⌘ + Enter 生成
        </span>
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
