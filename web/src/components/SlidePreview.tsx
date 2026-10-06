/** 幻灯片缩略图（与正式演示共用同一个渲染器，所见即所得） */
import { renderSlide } from '../../../shared/slide-render.js';
import type { Slide } from '../types';

export interface SlideThumbProps {
  slide: Slide;
  index: number;
  total: number;
  brand?: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}

export function SlideThumb({ slide, index, total, brand, active, badge, onClick }: SlideThumbProps) {
  const html = renderSlide(slide as Record<string, unknown>, { index, total, brand });
  const interactive = typeof onClick === 'function';
  const className = `thumb ${active ? 'is-active' : ''} ${interactive ? 'thumb--clickable' : ''}`;
  const content = (
    <>
      <div className="thumb__stage" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="thumb__index">{badge ?? index + 1}</span>
    </>
  );
  if (interactive) {
    return (
      <button type="button" className={className} onClick={onClick} aria-label={`跳转到第 ${index + 1} 页`}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
