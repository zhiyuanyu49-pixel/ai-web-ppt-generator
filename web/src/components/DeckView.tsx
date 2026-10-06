/** 站内演示视图：全屏演示、键盘翻页、总览、主题切换、导出 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderSlide } from '../../../shared/slide-render.js';
import type { Deck, Theme } from '../types';
import { SlideThumb } from './SlidePreview';

export interface DeckViewProps {
  deck: Deck;
  themes: Theme[];
  theme: string;
  onThemeChange: (id: string) => void;
  onBack: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
  onCopyJson: () => void;
  exporting: boolean;
  toast?: string | null;
}

export function DeckView(props: DeckViewProps) {
  const { deck, themes, theme, onThemeChange, onBack, onExportHtml, onExportJson, onCopyJson, exporting } = props;
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const slides = deck.slides;
  const total = slides.length;

  const goTo = useCallback(
    (next: number) => setIndex((prev) => {
      const target = Math.min(total - 1, Math.max(0, next));
      return target === prev ? prev : target;
    }),
    [total],
  );
  const go = useCallback((delta: number) => setIndex((prev) => Math.min(total - 1, Math.max(0, prev + delta))), [total]);

  useEffect(() => {
    setIndex(0);
  }, [deck]);

  const toggleFullscreen = useCallback(() => {
    const target = viewportRef.current;
    if (!target) return;
    if (!document.fullscreenElement) {
      target.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      const lower = key.toLowerCase();
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) {
        event.preventDefault();
        if (overview) setOverview(false);
        else go(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) {
        event.preventDefault();
        if (!overview) go(-1);
      } else if (key === 'Home') {
        event.preventDefault();
        goTo(0);
      } else if (key === 'End') {
        event.preventDefault();
        goTo(total - 1);
      } else if (lower === 'f') {
        toggleFullscreen();
      } else if (lower === 'o') {
        setOverview((v) => !v);
      } else if (lower === 't') {
        const ids = themes.map((t) => t.id);
        const current = ids.indexOf(theme);
        onThemeChange(ids[(current + 1) % ids.length]);
      } else if (lower === 'n') {
        setShowNotes((v) => !v);
      } else if (key === 'Escape') {
        setOverview(false);
      } else if (/^[1-9]$/.test(key)) {
        goTo(Number(key) - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, goTo, onThemeChange, overview, theme, themes, toggleFullscreen, total]);

  const activeSlide = slides[index];
  const activeHtml = useMemo(
    () => (activeSlide ? renderSlide(activeSlide as Record<string, unknown>, { index, total, brand: deck.title }) : ''),
    [activeSlide, deck.title, index, total],
  );

  const touchRef = useRef({ x: 0, y: 0 });

  return (
    <div className={`deck-shell ${fullscreen ? 'is-fullscreen' : ''}`}>
      <div className="deck-topbar no-print">
        <div className="deck-topbar__left">
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            ← 返回编辑
          </button>
          <strong className="deck-topbar__title" title={deck.title}>
            {deck.title}
          </strong>
          <span className="chip chip--ghost">{deck.slideCount} 页</span>
          {deck.meta?.model && <span className="chip chip--ghost">{deck.meta.model}</span>}
        </div>
        <div className="deck-topbar__right">
          <button type="button" className="btn" onClick={onCopyJson}>
            复制 JSON
          </button>
          <button type="button" className="btn" onClick={onExportJson}>
            下载 JSON
          </button>
          <button type="button" className="btn btn--primary" onClick={onExportHtml} disabled={exporting}>
            {exporting ? '导出中…' : '导出独立 HTML'}
          </button>
        </div>
      </div>

      <div className="deck-main">
        <div
          className="deck-viewport"
          ref={viewportRef}
          data-testid="deck-viewport"
          onTouchStart={(event) => {
            touchRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
          }}
          onTouchEnd={(event) => {
            const dx = event.changedTouches[0].clientX - touchRef.current.x;
            const dy = event.changedTouches[0].clientY - touchRef.current.y;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
          }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
            go(ratio < 0.2 ? -1 : 1);
          }}
        >
          <div className="stage" id="stage" data-testid="stage">
            <div className="slide-host" dangerouslySetInnerHTML={{ __html: activeHtml }} />
          </div>
          <div className="deck-progress" aria-hidden="true">
            <span style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
          {showNotes && activeSlide?.notes && (
            <div className="deck-notes">
              <span className="deck-notes__tag">讲者备注</span>
              {activeSlide.notes}
            </div>
          )}
        </div>
      </div>

      <div className="deck-toolbar no-print">
        <button type="button" className="btn btn--icon" onClick={() => go(-1)} disabled={index === 0} aria-label="上一页">
          ‹
        </button>
        <span className="deck-toolbar__counter" data-testid="page-counter">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => go(1)}
          disabled={index === total - 1}
          aria-label="下一页"
        >
          ›
        </button>

        <span className="deck-toolbar__divider" />

        <div className="theme-dots" role="group" aria-label="配色主题">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-dot ${theme === t.id ? 'is-active' : ''}`}
              style={{ ['--dot' as string]: t.tokens['--accent'], ['--dot-bg' as string]: t.tokens['--bg'] }}
              title={`${t.name} · ${t.desc}`}
              aria-label={`切换到主题 ${t.name}`}
              data-testid={`theme-${t.id}`}
              onClick={() => onThemeChange(t.id)}
            />
          ))}
        </div>

        <span className="deck-toolbar__divider" />

        <button type="button" className="btn btn--icon" onClick={() => setOverview(true)} title="总览 (O)" aria-label="总览">
          ▦
        </button>
        <button
          type="button"
          className={`btn btn--icon ${showNotes ? 'is-active' : ''}`}
          onClick={() => setShowNotes((v) => !v)}
          title="讲者备注 (N)"
          aria-label="讲者备注"
        >
          🗒
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={toggleFullscreen}
          title="全屏 (F)"
          aria-label="全屏"
        >
          ⛶
        </button>
      </div>

      {overview && (
        <div className="overview no-print" role="dialog" aria-label="幻灯片总览">
          <div className="overview__head">
            <h2 className="overview__title">
              {deck.title} · 共 {total} 页
            </h2>
            <button type="button" className="btn" onClick={() => setOverview(false)}>
              关闭总览 (Esc)
            </button>
          </div>
          <div className="overview__grid">
            {slides.map((slide, i) => (
              <SlideThumb
                key={i}
                slide={slide}
                index={i}
                total={total}
                brand={deck.title}
                active={i === index}
                onClick={() => {
                  goTo(i);
                  setOverview(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
