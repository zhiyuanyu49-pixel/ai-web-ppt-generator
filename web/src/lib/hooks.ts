/** 生成流程的 React 状态管理（含流式节流刷新） */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Deck, GenerateInput, ModelInfo, ProgressState, Slide } from '../types';
import { streamGenerate } from './api';

export type GenerationStatus = 'idle' | 'running' | 'done' | 'error';

export interface GenerationState {
  status: GenerationStatus;
  progress: ProgressState;
  slides: Slide[];
  streamTail: string;
  thinkingTail: string;
  model: ModelInfo | null;
  deck: Deck | null;
  usage: Record<string, number> | null;
  error: string | null;
}

const initialState: GenerationState = {
  status: 'idle',
  progress: { phase: 'idle', message: '', slidesDone: 0, slidesExpected: 0, chars: 0, elapsedMs: 0 },
  slides: [],
  streamTail: '',
  thinkingTail: '',
  model: null,
  deck: null,
  usage: null,
  error: null,
};

const TAIL_LIMIT = 3000;

export function useGeneration() {
  const [state, setState] = useState<GenerationState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const pendingSlidesRef = useRef<Slide[]>([]);
  const rawRef = useRef({ text: '', thinking: '' });
  const progressRef = useRef<ProgressState>(initialState.progress);
  const timerRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    const pending = pendingSlidesRef.current;
    pendingSlidesRef.current = [];
    setState((prev) => ({
      ...prev,
      slides: pending.length ? [...prev.slides, ...pending] : prev.slides,
      streamTail: rawRef.current.text.slice(-TAIL_LIMIT),
      thinkingTail: rawRef.current.thinking.slice(-600),
      progress: { ...progressRef.current },
    }));
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const reset = useCallback(() => {
    stopTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    pendingSlidesRef.current = [];
    rawRef.current = { text: '', thinking: '' };
    progressRef.current = initialState.progress;
    setState(initialState);
  }, [stopTimer]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopTimer();
    setState((prev) => ({ ...prev, status: 'idle', progress: { ...prev.progress, message: '已取消生成' } }));
  }, [stopTimer]);

  const start = useCallback(
    async (input: GenerateInput) => {
      stopTimer();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      pendingSlidesRef.current = [];
      rawRef.current = { text: '', thinking: '' };
      progressRef.current = { ...initialState.progress, phase: 'preparing', message: '正在连接…' };
      setState({ ...initialState, status: 'running', progress: progressRef.current });

      // 节流刷新，避免每个 token 都触发一次 React 渲染
      timerRef.current = window.setInterval(flush, 120);

      try {
        const deck = await streamGenerate(input, {
          signal: controller.signal,
          onEvent: (event, data) => {
            switch (event) {
              case 'meta':
                setState((prev) => ({ ...prev, model: data as ModelInfo }));
                if (data?.slidesExpected) {
                  progressRef.current = { ...progressRef.current, slidesExpected: Number(data.slidesExpected) || 0 };
                }
                break;
              case 'status':
                progressRef.current = { ...progressRef.current, phase: data.phase, message: data.message };
                break;
              case 'thinking':
                rawRef.current.thinking += String(data.text || '');
                break;
              case 'token':
                rawRef.current.text += String(data.text || '');
                break;
              case 'progress':
                progressRef.current = {
                  ...progressRef.current,
                  slidesDone: Number(data.slidesDone) || 0,
                  slidesExpected: Number(data.slidesExpected) || progressRef.current.slidesExpected,
                  chars: Number(data.chars) || 0,
                  elapsedMs: Number(data.elapsedMs) || 0,
                };
                break;
              case 'slide':
                if (data?.slide) pendingSlidesRef.current.push(data.slide as Slide);
                break;
              case 'usage':
                setState((prev) => ({ ...prev, usage: data }));
                break;
              case 'deck':
                setState((prev) => ({ ...prev, deck: data.deck as Deck }));
                break;
              default:
                break;
            }
          },
        });

        stopTimer();
        // 收尾：把剩余增量一次性写入
        const pending = pendingSlidesRef.current;
        pendingSlidesRef.current = [];
        setState((prev) => ({
          ...prev,
          status: deck ? 'done' : 'idle',
          deck: deck ?? prev.deck,
          slides: deck?.slides ?? (pending.length ? [...prev.slides, ...pending] : prev.slides),
          streamTail: rawRef.current.text.slice(-TAIL_LIMIT),
          progress: { ...progressRef.current },
        }));
      } catch (error: any) {
        stopTimer();
        const message = String(error?.message || error);
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: message,
          progress: { ...prev.progress, message },
        }));
      } finally {
        abortRef.current = null;
      }
    },
    [flush, stopTimer],
  );

  return { state, start, cancel, reset };
}
