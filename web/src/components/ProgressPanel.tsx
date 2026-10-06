/** 生成过程中的实时进度面板：进度条 + 流式原文 + 逐页出现的缩略图 */
import { useEffect, useRef } from 'react';
import type { GenerationState } from '../lib/hooks';
import { SlideThumb } from './SlidePreview';

export interface ProgressPanelProps {
  state: GenerationState;
  onOpenDeck: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  idle: '等待开始',
  preparing: '准备提示词',
  streaming: '模型流式输出中',
  parsing: '校验与整理',
};

export function ProgressPanel({ state, onOpenDeck }: ProgressPanelProps) {
  const { status, progress, slides, streamTail, thinkingTail, model, deck, error } = state;
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamTail]);

  const expected = progress.slidesExpected || deck?.slideCount || 0;
  const done = Math.max(progress.slidesDone, status === 'done' ? slides.length : 0);
  const percent = expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : status === 'done' ? 100 : 0;
  const indeterminate = status === 'running' && expected === 0;

  return (
    <section className="card progress-panel" aria-label="生成进度" aria-live="polite">
      <header className="card__head">
        <div>
          <h2 className="card__title">
            {status === 'done' ? '生成完成' : status === 'error' ? '生成失败' : status === 'running' ? '正在生成' : '预览'}
          </h2>
          <p className="card__desc">{progress.message || '生成结果会在这里实时出现，每完成一页就立刻渲染。'}</p>
        </div>
        <div className="progress-panel__badges">
          {model?.resolvedModel && (
            <span className="chip" title={`请求模型：${model.requestedModel || '-'}｜匹配方式：${model.matchedBy || '-'}`}>
              <span className="dot" aria-hidden="true" /> {model.resolvedModel}
              {model.mock ? ' · MOCK' : ''}
            </span>
          )}
          {deck?.meta?.mock && <span className="chip chip--warn">本地模拟</span>}
          {deck?.meta?.repaired && <span className="chip chip--warn">已修复 JSON</span>}
        </div>
      </header>

      <div className={`progress-bar ${indeterminate ? 'is-indeterminate' : ''}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: indeterminate ? '35%' : `${percent}%` }} />
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat__value">
            {done}
            {expected ? <small>/{expected}</small> : null}
          </span>
          <span className="stat__label">已完成页</span>
        </div>
        <div className="stat">
          <span className="stat__value">{(progress.chars / 1000).toFixed(1)}k</span>
          <span className="stat__label">接收字符</span>
        </div>
        <div className="stat">
          <span className="stat__value">{(progress.elapsedMs / 1000).toFixed(1)}s</span>
          <span className="stat__label">耗时</span>
        </div>
        <div className="stat">
          <span className="stat__value">{PHASE_LABEL[progress.phase] || progress.phase || '—'}</span>
          <span className="stat__label">当前阶段</span>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <strong>生成失败：</strong>
          {error}
        </div>
      )}

      {(status === 'running' || streamTail) && (
        <details className="raw-stream" open={status === 'running'}>
          <summary>
            模型原始输出（JSON 流）
            {thinkingTail && <span className="chip chip--ghost">含思考过程</span>}
          </summary>
          <pre ref={preRef}>{streamTail || '等待首个 token…'}</pre>
        </details>
      )}

      <div className="progress-panel__slides">
        {slides.length === 0 && status !== 'done' && !error && (
          <div className="empty-state">
            <p className="empty-state__title">生成中，页面会逐页出现</p>
            <ol className="empty-state__list">
              <li>把长文案粘贴到左侧输入框</li>
              <li>选择页数、语言与风格（可留默认）</li>
              <li>点击「生成网页 PPT」，随后可直接进入全屏演示</li>
            </ol>
          </div>
        )}
        {slides.map((slide, index) => (
          <SlideThumb key={index} slide={slide} index={index} total={slides.length} brand={deck?.title} />
        ))}
      </div>

      {status === 'done' && slides.length > 0 && (
        <div className="progress-panel__cta">
          <button type="button" className="btn btn--primary" onClick={onOpenDeck}>
            进入演示模式
          </button>
        </div>
      )}
    </section>
  );
}
