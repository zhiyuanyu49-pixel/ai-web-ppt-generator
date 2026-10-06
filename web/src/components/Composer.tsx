/** 文案输入与生成参数面板 */
import { useMemo } from 'react';
import type { LanguageId, ModelOption, ProviderId, ProviderOption, StyleId } from '../types';

const STYLE_OPTIONS: { id: StyleId; label: string; hint: string }[] = [
  { id: 'business', label: '商务汇报', hint: '结论先行、数据支撑' },
  { id: 'tech', label: '科技产品', hint: '架构、能力与指标' },
  { id: 'edu', label: '教学培训', hint: '概念清晰、循序渐进' },
  { id: 'creative', label: '创意营销', hint: '有记忆点与节奏感' },
  { id: 'report', label: '研究报告', hint: '结构化、重论据' },
];

const LANGUAGE_OPTIONS: { id: LanguageId; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'auto', label: '跟随原文' },
];

const COUNT_OPTIONS = [0, 6, 8, 10, 12, 16, 20];

export interface ComposerProps {
  text: string;
  title: string;
  slideCount: number;
  language: LanguageId;
  style: StyleId;
  providers: ProviderOption[];
  provider: ProviderId;
  model: string;
  running: boolean;
  onTextChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onSlideCountChange: (value: number) => void;
  onLanguageChange: (value: LanguageId) => void;
  onStyleChange: (value: StyleId) => void;
  onProviderChange: (value: ProviderId) => void;
  onModelChange: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onSample: () => void;
  onClear: () => void;
  onExportJson?: () => void;
  hasDeck: boolean;
}

export function Composer(props: ComposerProps) {
  const {
    text,
    title,
    slideCount,
    language,
    style,
    providers,
    provider,
    model,
    running,
    onTextChange,
    onTitleChange,
    onSlideCountChange,
    onLanguageChange,
    onStyleChange,
    onProviderChange,
    onModelChange,
    onGenerate,
    onCancel,
    onSample,
    onClear,
    onExportJson,
    hasDeck,
  } = props;

  const charCount = text.trim().length;
  const canGenerate = charCount >= 20 && !running;

  // 当前供应商及其模型候选；未配置 Key 的供应商在下拉里置灰
  const activeProvider = providers.find((item) => item.id === provider) ?? null;
  const modelChoices = useMemo<ModelOption[]>(() => {
    const list: ModelOption[] = (activeProvider?.models ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      note: item.note,
    }));
    // 服务端允许使用未登记的模型 id，选中时要能正确显示
    if (model && !list.some((item) => item.id === model)) {
      list.unshift({ id: model, name: model, note: '自定义' });
    }
    if (!list.length) list.push({ id: model || '', name: model || '读取配置中…' });
    return list;
  }, [activeProvider, model]);
  const estimate = useMemo(() => {
    if (slideCount > 0) return `${slideCount} 页`;
    const guess = Math.min(16, Math.max(6, Math.round(charCount / 260) + 3));
    return charCount < 20 ? '—' : `约 ${guess} 页（自动）`;
  }, [charCount, slideCount]);

  return (
    <section className="card composer" aria-label="文案输入">
      <header className="card__head">
        <div>
          <h2 className="card__title">原始文案</h2>
          <p className="card__desc">粘贴讲座稿、产品文档、报告或任意长文，AI 会重新组织成演讲型页面结构。</p>
        </div>
        <span className="chip chip--ghost">{charCount} 字</span>
      </header>

      <textarea
        id="source-text"
        className="composer__input"
        value={text}
        placeholder="在这里粘贴你的长文案，例如：一份 3000 字的产品方案、课程讲义或调研报告……"
        onChange={(event) => onTextChange(event.target.value)}
        spellCheck={false}
        aria-label="原始文案"
      />

      <div className="composer__row">
        <label className="field field--grow">
          <span className="field__label">演示标题（可选）</span>
          <input
            className="field__input"
            type="text"
            value={title}
            placeholder="留空则由 AI 根据内容拟定"
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">页数</span>
          <select
            className="field__input"
            value={slideCount}
            onChange={(event) => onSlideCountChange(Number(event.target.value))}
          >
            {COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count === 0 ? '自动' : `${count} 页`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="composer__row">
        <label className="field">
          <span className="field__label">模型供应商</span>
          <select
            className="field__input"
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as ProviderId)}
            disabled={running}
          >
            {providers.length ? (
              providers.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.configured}>
                  {option.label}
                  {option.configured ? '' : `（未配置 ${option.needsKeyEnv || 'API Key'}）`}
                </option>
              ))
            ) : (
              <option value="deepseek">DeepSeek</option>
            )}
          </select>
        </label>
        <label className="field field--grow">
          <span className="field__label">模型</span>
          <select
            className="field__input"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={running}
          >
            {modelChoices.map((choice) => (
              <option key={choice.id || choice.name} value={choice.id}>
                {choice.name}
                {choice.note ? ` · ${choice.note}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="composer__row composer__row--split">
        <div className="field">
          <span className="field__label">语言</span>
          <div className="segmented" role="group" aria-label="语言">
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`segmented__item ${language === option.id ? 'is-active' : ''}`}
                onClick={() => onLanguageChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field__label">风格</span>
          <div className="segmented segmented--wrap" role="group" aria-label="风格">
            {STYLE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.hint}
                className={`segmented__item ${style === option.id ? 'is-active' : ''}`}
                onClick={() => onStyleChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="composer__actions">
        {running ? (
          <button type="button" className="btn btn--danger" onClick={onCancel}>
            停止生成
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={onGenerate} disabled={!canGenerate}>
            <span aria-hidden="true">✦</span> 生成网页 PPT
          </button>
        )}
        <button type="button" className="btn" onClick={onSample} disabled={running}>
          填入示例
        </button>
        <button type="button" className="btn" onClick={onClear} disabled={running || !text}>
          清空
        </button>
        {hasDeck && onExportJson && (
          <button type="button" className="btn" onClick={onExportJson}>
            下载 JSON
          </button>
        )}
        <span className="composer__hint">
          {charCount < 20 ? '至少输入 20 个字' : `预计篇幅：${estimate}`}
        </span>
      </div>
    </section>
  );
}
